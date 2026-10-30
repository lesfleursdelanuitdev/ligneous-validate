package check

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Table is one of the enricher's tables, its rows unchanged. As JSON it names
// its fields once (spec T24) instead of once per row:
//
//	{"columns": ["xref", "full_name", …], "rows": [["@I1@", "Victoria /Hanover/", …], …]}
//
// Each row holds, in the columns' order, the values encoding/json would write
// for that record, and null where it would leave the field out (an omitempty
// field that is empty). A column that would be null in every row is left out.
// So reading a row back (a null is a field left out) gives exactly the record
// the plain encoding gives. The page does that in web/src/tree/tables.ts.
type Table[T any] []T

// field is one JSON field of a row type.
type field struct {
	name      string
	index     int
	omitEmpty bool
}

// fieldsOf lists the JSON fields of a struct type, in declaration order, by
// encoding/json's rules for the tags the enricher uses.
func fieldsOf(t reflect.Type) []field {
	var out []field
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		tag := f.Tag.Get("json")
		if tag == "-" {
			continue
		}
		name, opts, _ := strings.Cut(tag, ",")
		if name == "" {
			name = f.Name
		}
		out = append(out, field{name: name, index: i, omitEmpty: strings.Contains(","+opts+",", ",omitempty,")})
	}
	return out
}

// isEmpty is encoding/json's test for omitempty, for the kinds rows use.
func isEmpty(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.String, reflect.Slice:
		return v.Len() == 0
	case reflect.Bool:
		return !v.Bool()
	case reflect.Int, reflect.Int64:
		return v.Int() == 0
	case reflect.Float64:
		return v.Float() == 0
	case reflect.Pointer:
		return v.IsNil()
	}
	return false
}

func (t Table[T]) MarshalJSON() ([]byte, error) {
	rt := reflect.TypeFor[T]()
	if rt.Kind() != reflect.Struct {
		return nil, fmt.Errorf("compact table of %s: rows must be structs", rt)
	}
	all := fieldsOf(rt)
	null := func(row reflect.Value, f field) bool { return f.omitEmpty && isEmpty(row.Field(f.index)) }
	// Only the columns some row has a value for.
	var cols []field
	for _, f := range all {
		for i := range t {
			if !null(reflect.ValueOf(&t[i]).Elem(), f) {
				cols = append(cols, f)
				break
			}
		}
	}
	var b bytes.Buffer
	b.Grow(64 + len(t)*16*max(len(cols), 1))
	b.WriteString(`{"columns":[`)
	for i, f := range cols {
		if i > 0 {
			b.WriteByte(',')
		}
		appendString(&b, f.name)
	}
	b.WriteString(`],"rows":[`)
	for i := range t {
		row := reflect.ValueOf(&t[i]).Elem()
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('[')
		for j, f := range cols {
			if j > 0 {
				b.WriteByte(',')
			}
			if null(row, f) {
				b.WriteString("null")
				continue
			}
			if err := appendValue(&b, row.Field(f.index)); err != nil {
				return nil, fmt.Errorf("compact table of %s, %s: %w", rt, f.name, err)
			}
		}
		b.WriteByte(']')
	}
	b.WriteString(`]}`)
	return b.Bytes(), nil
}

// appendValue writes one value as JSON, for the kinds the enricher's rows use.
func appendValue(b *bytes.Buffer, v reflect.Value) error {
	switch v.Kind() {
	case reflect.String:
		appendString(b, v.String())
	case reflect.Int, reflect.Int64:
		b.WriteString(strconv.FormatInt(v.Int(), 10))
	case reflect.Bool:
		b.WriteString(strconv.FormatBool(v.Bool()))
	case reflect.Float64:
		f := v.Float()
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Errorf("unsupported value %v", f)
		}
		b.WriteString(strconv.FormatFloat(f, 'g', -1, 64))
	case reflect.Pointer:
		if v.IsNil() {
			b.WriteString("null")
			return nil
		}
		return appendValue(b, v.Elem())
	case reflect.Slice:
		if v.Type().Elem().Kind() != reflect.String {
			return fmt.Errorf("unsupported list of %s", v.Type().Elem())
		}
		if v.IsNil() {
			b.WriteString("null")
			return nil
		}
		b.WriteByte('[')
		for i := 0; i < v.Len(); i++ {
			if i > 0 {
				b.WriteByte(',')
			}
			appendString(b, v.Index(i).String())
		}
		b.WriteByte(']')
	default:
		return fmt.Errorf("unsupported kind %s", v.Kind())
	}
	return nil
}

// appendString writes s as a JSON string. Like encoding/json, invalid UTF-8
// becomes U+FFFD; unlike it, <, > and & are not escaped (the answer is parsed,
// never put in a page).
func appendString(b *bytes.Buffer, s string) {
	const hex = "0123456789abcdef"
	b.WriteByte('"')
	start := 0
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			if c >= 0x20 && c != '"' && c != '\\' {
				i++
				continue
			}
			b.WriteString(s[start:i])
			switch c {
			case '"', '\\':
				b.WriteByte('\\')
				b.WriteByte(c)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				b.WriteString(`\u00`)
				b.WriteByte(hex[c>>4])
				b.WriteByte(hex[c&0xF])
			}
			i++
			start = i
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteString(s[start:i])
			b.WriteString(`�`)
			i += size
			start = i
			continue
		}
		i += size
	}
	b.WriteString(s[start:])
	b.WriteByte('"')
}

var _ json.Marshaler = Table[struct{}]{}
