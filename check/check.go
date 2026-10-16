// Package check turns the GEDCOM library's output into the one result the
// validate.ligneous.org page needs. It is compiled to WebAssembly.
package check

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/enricher"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/explain"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/gedcom"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/parser"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/validator"
)

// Result is everything the page shows for one file.
type Result struct {
	Encoding gedcom.EncodingInfo `json:"encoding"`
	Summary  Summary             `json:"summary"`
	Findings []Finding           `json:"findings"`
	Names    map[string]string   `json:"names"`
	Text     string              `json:"text"`
	IsGedcom bool                `json:"isGedcom"`
	// Error is set when the checker itself failed (a recovered panic).
	Error string `json:"error,omitempty"`
	// BOM and BareCR describe the raw bytes: a byte order mark, and a line
	// ending in a lone CR. The library has no finding for either, but the
	// repair fixes both.
	BOM    bool `json:"bom"`
	BareCR bool `json:"bareCR"`
}

// afterParse runs right after parsing; tests use it to make Check panic.
var afterParse = func() {}

// Finding is one problem, with its plain-English explanation.
type Finding struct {
	Code     string            `json:"code"`
	Severity string            `json:"severity"`
	Group    string            `json:"group"`
	Title    string            `json:"title"`
	Meaning  string            `json:"meaning"`
	HowToFix string            `json:"howToFix"`
	Line     int               `json:"line"`
	Details  map[string]string `json:"details"`
	Xrefs    []string          `json:"xrefs"`
	Roles    map[string]string `json:"roles"`
}

// Check parses and validates raw bytes. It never panics on bad input.
func Check(raw []byte) (res Result) {
	res = Result{Findings: []Finding{}, Names: map[string]string{}, Encoding: gedcom.EncodingInfo{}}
	defer func() {
		if r := recover(); r != nil {
			res.IsGedcom = false
			res.Error = fmt.Sprint(r)
		}
	}()
	res.BOM = hasBOM(raw)
	res.BareCR = hasBareCR(raw)

	if text, _, _ := parser.Decode(raw); text != nil {
		res.Text = strings.TrimPrefix(string(text), "\uFEFF")
	}

	afterParse()
	popts := parser.DefaultOptions()
	popts.Lenient = true
	doc, perrs, err := parser.ParseWithOptions(bytes.NewReader(raw), popts)
	for _, pe := range perrs {
		res.Findings = append(res.Findings, newFinding(pe.Code, pe.Severity, pe.Message, pe.Line, pe.Details, nil, nil))
	}
	if doc == nil {
		return res
	}
	res.Encoding = doc.Encoding
	hasHead := doc.Header.Tag == "HEAD"
	records := len(doc.Individuals) + len(doc.Families) + len(doc.Sources) + len(doc.Notes) +
		len(doc.Repositories) + len(doc.Media) + len(doc.Submitters)
	res.IsGedcom = err == nil && (hasHead || records > 0)

	vopts := validator.DefaultOptions()
	vopts.DateConsistency = true
	verrs := validator.ValidateWithOptions(doc, vopts)

	ed := enricher.Enrich(doc)
	res.Names = buildNames(ed)
	res.Summary = buildSummary(doc, ed)

	idx := newIndex(doc)
	for _, ve := range verrs {
		f := newFinding(ve.Code, severityName(int(ve.Severity)), ve.Message, ve.Line, ve.Details, ve.AssociatedXrefs, nil)
		f.Roles = rolesFor(ve, idx)
		res.Findings = append(res.Findings, f)
	}
	return res
}

func severityName(s int) string {
	switch s {
	case 2:
		return "error"
	case 1:
		return "warning"
	default:
		return "hint"
	}
}

func newFinding(code, severity, message string, line int, details map[string]string, xrefs []string, roles map[string]string) Finding {
	f := Finding{Code: code, Severity: severity, Line: line, Details: map[string]string{}, Xrefs: []string{}, Roles: map[string]string{}}
	for k, v := range details {
		f.Details[k] = v
	}
	f.Xrefs = append(f.Xrefs, xrefs...)
	for k, v := range roles {
		f.Roles[k] = v
	}
	if e, ok := explain.Lookup(code); ok {
		f.Group, f.Title, f.Meaning, f.HowToFix = e.Group, e.Title, e.Meaning, e.HowToFix
	} else {
		f.Title, f.Meaning = code, message
	}
	if f.Title == "" {
		f.Title = code
	}
	return f
}

// hasBOM reports whether raw starts with a UTF-8 or UTF-16 byte order mark.
func hasBOM(raw []byte) bool {
	return bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}) ||
		bytes.HasPrefix(raw, []byte{0xFF, 0xFE}) || bytes.HasPrefix(raw, []byte{0xFE, 0xFF})
}

// hasBareCR reports whether some line ends in a CR with no LF after it.
func hasBareCR(raw []byte) bool {
	for i := bytes.IndexByte(raw, '\r'); i >= 0; {
		if i+1 >= len(raw) || raw[i+1] != '\n' {
			return true
		}
		j := bytes.IndexByte(raw[i+1:], '\r')
		if j < 0 {
			return false
		}
		i += 1 + j
	}
	return false
}
