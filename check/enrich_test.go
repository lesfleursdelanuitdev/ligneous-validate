package check

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/enricher"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/parser"
)

const smallTree = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n" +
	"0 @I1@ INDI\n1 NAME John /Smith/\n1 SEX M\n1 BIRT\n2 DATE 1 JAN 1900\n2 PLAC Boston, Suffolk, Massachusetts, USA\n1 FAMS @F1@\n" +
	"0 @I2@ INDI\n1 NAME Mary /Jones/\n1 SEX F\n1 FAMS @F1@\n" +
	"0 @I3@ INDI\n1 NAME Ann /Smith/\n1 FAMC @F1@\n2 PEDI adopted\n" +
	"0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 CHIL @I3@\n1 MARR\n2 DATE 1925\n" +
	"0 TRLR\n"

// enrichDirect is what the library itself gives for raw: the reference
// Enrich's tables must equal.
func enrichDirect(t *testing.T, raw []byte) *enricher.EnrichedDocument {
	t.Helper()
	opts := parser.DefaultOptions()
	opts.Lenient = true
	doc, _, err := parser.ParseWithOptions(bytes.NewReader(raw), opts)
	if err != nil || doc == nil {
		t.Fatalf("parse: %v", err)
	}
	return enricher.Enrich(doc)
}

// sameTables reports the first table of out that isn't the enricher's own,
// unchanged: every field of Tables must hold a field of EnrichedDocument with
// the same name and row type, with the same rows (nil and empty are equal).
func sameTables(out Tables, ed *enricher.EnrichedDocument) string {
	tv, ev := reflect.ValueOf(out), reflect.ValueOf(*ed)
	for i := 0; i < tv.NumField(); i++ {
		name := tv.Type().Field(i).Name
		ef, ok := ev.Type().FieldByName(name)
		if !ok || ef.Type != reflect.SliceOf(tv.Type().Field(i).Type.Elem()) {
			return name + ": not a table of EnrichedDocument with the same row type"
		}
		got, want := tv.Field(i).Convert(ef.Type), ev.FieldByName(name)
		if got.Len() == 0 && want.Len() == 0 {
			continue
		}
		if !reflect.DeepEqual(got.Interface(), want.Interface()) {
			return name + ": rows differ from the enricher's"
		}
	}
	return ""
}

// plainRecords is a table as encoding/json writes it, read back: one map per row.
func plainRecords(t *testing.T, rows any) []map[string]any {
	t.Helper()
	b, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var out []map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// compactRecords reads a compact table back into one map per row, as the
// page does (web/src/tree/tables.ts): a null value is a field left out.
func compactRecords(t *testing.T, b []byte) []map[string]any {
	t.Helper()
	var c struct {
		Columns []string `json:"columns"`
		Rows    [][]any  `json:"rows"`
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		t.Fatalf("compact table: %v in %.200s", err, b)
	}
	if c.Columns == nil || c.Rows == nil {
		t.Fatalf("compact table without columns or rows: %.200s", b)
	}
	out := make([]map[string]any, len(c.Rows))
	for i, r := range c.Rows {
		if len(r) != len(c.Columns) {
			t.Fatalf("row %d has %d values for %d columns", i, len(r), len(c.Columns))
		}
		out[i] = map[string]any{}
		for j, v := range r {
			if v != nil {
				out[i][c.Columns[j]] = v
			}
		}
	}
	return out
}

// sameRecords reports the first table whose compact JSON doesn't read back as
// exactly the records encoding/json would write for it.
func sameRecords(t *testing.T, out Tables) string {
	t.Helper()
	tv := reflect.ValueOf(out)
	for i := 0; i < tv.NumField(); i++ {
		name := tv.Type().Field(i).Name
		f := tv.Field(i)
		b, err := json.Marshal(f.Interface())
		if err != nil {
			return name + ": " + err.Error()
		}
		got := compactRecords(t, b)
		want := plainRecords(t, f.Convert(reflect.SliceOf(f.Type().Elem())).Interface())
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			return name + ": the compact rows read back differently"
		}
	}
	return ""
}

func TestEnrichReturnsTheEnrichersTablesUnchanged(t *testing.T) {
	out := Enrich([]byte(smallTree))
	if out.Error != "" || !out.IsGedcom {
		t.Fatalf("out = %+v", out)
	}
	if msg := sameTables(out.Tables, enrichDirect(t, []byte(smallTree))); msg != "" {
		t.Fatal(msg)
	}
	if len(out.Tables.Individuals) != 3 || len(out.Tables.Families) != 1 || len(out.Tables.ParentChild) != 2 {
		t.Fatalf("tables = %+v", out.Tables)
	}
}

// The tables the tree viewer reads, by the enricher's own field names. A table
// left out here is left out whole.
func TestEnrichJSONShape(t *testing.T) {
	b, err := json.Marshal(Enrich([]byte(smallTree)))
	if err != nil {
		t.Fatal(err)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(b, &top); err != nil {
		t.Fatal(err)
	}
	if got := keys(top); strings.Join(got, ",") != "home,isGedcom,lines,parseFindings,tables" {
		t.Fatalf("top-level keys = %v", got)
	}
	var tables map[string]json.RawMessage
	if err := json.Unmarshal(top["tables"], &tables); err != nil {
		t.Fatal(err)
	}
	// T25: IndividualEvents, FamilyEvents and Spouses are left out.
	want := "Dates,Events,Families,FamilyChildren,GivenNames,Individuals," +
		"NameFormGivenNames,NameFormSurnames,NameForms,ParentChild,Places,Surnames"
	if got := keys(tables); strings.Join(got, ",") != want {
		t.Fatalf("tables = %v\nwant %s", got, want)
	}
	// T24: each table names its fields once, then gives the rows as lists.
	var people struct {
		Columns []string `json:"columns"`
		Rows    [][]any  `json:"rows"`
	}
	if err := json.Unmarshal(tables["Individuals"], &people); err != nil {
		t.Fatal(err)
	}
	if strings.Join(people.Columns, ",") != "xref,full_name,full_name_lower,sex,birth_date_index,birth_place_index,"+
		"death_date_index,death_place_index,primary_surname_lower,birth_country,birth_country_lower" ||
		len(people.Rows) != 3 || people.Rows[0][0] != "@I1@" || people.Rows[1][9] != nil {
		t.Fatalf("Individuals = %+v", people)
	}
	if bytes.Contains(b, []byte(`"Document"`)) || bytes.Contains(b, []byte(`"children"`)) {
		t.Fatal("the parsed document was serialized")
	}
	// A file with no events: every table still has its columns and rows.
	b, _ = json.Marshal(Enrich([]byte("0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n0 TRLR\n")))
	_ = json.Unmarshal(b, &top)
	_ = json.Unmarshal(top["tables"], &tables)
	for name, raw := range tables {
		if got := compactRecords(t, raw); got == nil {
			t.Errorf("%s: %s", name, raw)
		}
	}
	if string(tables["Events"]) != `{"columns":[],"rows":[]}` {
		t.Errorf("Events = %s", tables["Events"])
	}
}

// The compact form of a table reads back as the records encoding/json writes,
// whatever the values: omitted empty fields, odd strings, lists, pointers.
func TestCompactTable(t *testing.T) {
	type row struct {
		ID    string   `json:"id,omitempty"`
		Name  string   `json:"name"`
		N     int      `json:"n"`
		Opt   int      `json:"opt,omitempty"`
		Flag  bool     `json:"flag"`
		F     float64  `json:"f,omitempty"`
		List  []string `json:"list,omitempty"`
		Age   *int     `json:"age,omitempty"`
		Skip  string   `json:"-"`
		inner string
	}
	age := 82
	rows := Table[row]{
		{Name: "Zoë \"Q\" O'Brien\\ <b>&</b>", N: -3, Flag: true, F: 51.5, List: []string{"a", "é\u2028"}, Age: &age, Skip: "x", inner: "y"},
		{Name: "tab\tnew\nline\x01 \xff bad utf-8", Opt: 7, F: 1e21},
		{},
	}
	b, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := compactRecords(t, b), plainRecords(t, []row(rows)); !reflect.DeepEqual(got, want) {
		t.Fatalf("read back:\n%v\nwant\n%v\nfrom %s", got, want, b)
	}
	// "id" is empty in every row, so it isn't a column; "-" and unexported fields never are.
	if !bytes.HasPrefix(b, []byte(`{"columns":["name","n","opt","flag","f","list","age"],"rows":[`)) {
		t.Fatalf("got %s", b)
	}
	if b, _ := json.Marshal(Table[row](nil)); string(b) != `{"columns":[],"rows":[]}` {
		t.Fatalf("empty: %s", b)
	}
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// lineAt is line n (1-based) of the file, without its line ending.
func lineAt(raw []byte, n int) string {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	if n < 1 || n > len(lines) {
		return ""
	}
	return strings.TrimSpace(lines[n-1])
}

func TestEnrichLinesFollowTheRows(t *testing.T) {
	raw := read(t, "testdata/royal92.ged")
	out := Enrich(raw)
	if len(out.Lines.Individuals) != len(out.Tables.Individuals) || len(out.Lines.Families) != len(out.Tables.Families) {
		t.Fatalf("lines %d/%d for %d/%d rows", len(out.Lines.Individuals), len(out.Lines.Families),
			len(out.Tables.Individuals), len(out.Tables.Families))
	}
	for i, p := range out.Tables.Individuals {
		if got := lineAt(raw, out.Lines.Individuals[i]); got != "0 "+p.Xref+" INDI" {
			t.Fatalf("%s: line %d is %q", p.Xref, out.Lines.Individuals[i], got)
		}
	}
	for i, f := range out.Tables.Families {
		if got := lineAt(raw, out.Lines.Families[i]); got != "0 "+f.Xref+" FAM" {
			t.Fatalf("%s: line %d is %q", f.Xref, out.Lines.Families[i], got)
		}
	}
}

// The library has no duplicate-xref check: each record keeps its own row and
// its own line, so the viewer can name every one.
func TestEnrichLinesOfDuplicateXrefs(t *testing.T) {
	raw := read(t, libSample(t, "malformed/duplicate-xref.ged"))
	out := Enrich(raw)
	if got := out.Lines.Individuals; !reflect.DeepEqual(got, []int{5, 8, 11}) {
		t.Errorf("individual lines = %v", got)
	}
	if got := out.Lines.Families; !reflect.DeepEqual(got, []int{14, 16}) {
		t.Errorf("family lines = %v", got)
	}
	for _, p := range out.Tables.Individuals {
		if p.Xref != "@I1@" {
			t.Errorf("xref %s", p.Xref)
		}
	}
}

func TestEnrichCountsParseFindings(t *testing.T) {
	for _, c := range []struct {
		file string
		want Counts
	}{
		{libSample(t, "royal92.ged"), Counts{Hints: 1}},      // ENCODING_NOT_UTF8
		{libSample(t, "pres2020.ged"), Counts{Warnings: 23}}, // LINE_TOO_LONG
		{"testdata/repair/leading-space.ged", parseCounts(t, read(t, "testdata/repair/leading-space.ged"))},
	} {
		if got := Enrich(read(t, c.file)).ParseFindings; got != c.want {
			t.Errorf("%s: parse findings %+v, want %+v", filepath.Base(c.file), got, c.want)
		}
	}
	bad := strings.Replace(smallTree, "1 SEX F\n", "1 SEX F\nthis is not a line\n", 1)
	if got := Enrich([]byte(bad)).ParseFindings; got != parseCounts(t, []byte(bad)) || got.Errors+got.Warnings == 0 {
		t.Errorf("bad line: %+v", got)
	}
}

// parseCounts counts the parser's own findings by severity.
func parseCounts(t *testing.T, raw []byte) Counts {
	t.Helper()
	opts := parser.DefaultOptions()
	opts.Lenient = true
	_, perrs, _ := parser.ParseWithOptions(bytes.NewReader(raw), opts)
	var c Counts
	for _, pe := range perrs {
		switch pe.Severity {
		case "error":
			c.Errors++
		case "warning":
			c.Warnings++
		default:
			c.Hints++
		}
	}
	return c
}

// T26: the header's home-person pointers, as written. The page decides which
// to use (web/src/tree/start.ts).
func TestEnrichHome(t *testing.T) {
	head := "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n"
	people := "0 @I1@ INDI\n1 NAME A /B/\n0 @I2@ INDI\n0 @M1@ OBJE\n1 FILE x.jpg\n"
	for _, c := range []struct {
		name, text string
		want       HomePointers
	}{
		{"none", head + people, HomePointers{}},
		{"_HOME", head + "1 _HOME @I2@\n" + people, HomePointers{Home: "@I2@"}},
		{"_ROOT, spaces", head + "1 _ROOT  @I1@ \n" + people, HomePointers{Root: "@I1@"}},
		{"both, as written even if no one has the xref", head + "1 _HOME @I9@\n1 _ROOT @I1@\n" + people, HomePointers{Home: "@I9@", Root: "@I1@"}},
		{"a value that isn't a pointer", head + "1 _HOME me\n" + people, HomePointers{}},
		{"the submitter's own INDI", head + "1 SUBM @U1@\n" + people + "0 @U1@ SUBM\n1 NAME A B\n1 OBJE @M1@\n1 _INDI @I2@\n", HomePointers{Submitter: "@I2@"}},
		{"a submitter with no INDI", head + "1 SUBM @U1@\n" + people + "0 @U1@ SUBM\n1 NAME A B\n1 OBJE @M1@\n", HomePointers{}},
		{"not the header's submitter", head + "1 SUBM @U1@\n" + people + "0 @U1@ SUBM\n1 NAME A\n0 @U2@ SUBM\n1 _INDI @I1@\n", HomePointers{}},
		{"_HOME under SOUR is not the header's own", head + "1 SOUR X\n2 _HOME @I1@\n" + people, HomePointers{}},
	} {
		out := Enrich([]byte(c.text + "0 TRLR\n"))
		if out.Error != "" || out.Home != c.want {
			t.Errorf("%s: home %+v, want %+v (%s)", c.name, out.Home, c.want, out.Error)
		}
	}
	if h := Enrich(read(t, "testdata/royal92.ged")).Home; h != (HomePointers{}) {
		t.Errorf("royal92: %+v", h)
	}
}

func TestEnrichNotGedcom(t *testing.T) {
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0, 1, 2}, 500)...)
	for _, raw := range [][]byte{png, nil, []byte("hello, this is not a gedcom file")} {
		out := Enrich(raw)
		if out.IsGedcom || out.Error != "" || len(out.Tables.Individuals) != 0 || out.Home != (HomePointers{}) {
			t.Errorf("%q…: %+v", raw[:min(len(raw), 8)], out)
		}
		b, _ := json.Marshal(out)
		if bytes.Contains(b, []byte("null")) {
			t.Errorf("null in %s", b)
		}
	}
}

// A panic inside the library is reported as a failure, not as "this isn't a
// GEDCOM file".
func TestEnrichRecoverSetsError(t *testing.T) {
	old := afterParse
	t.Cleanup(func() { afterParse = old })
	afterParse = func() { panic("boom") }
	out := Enrich([]byte(smallTree))
	if !strings.Contains(out.Error, "boom") || out.IsGedcom {
		t.Fatalf("out = %+v", out)
	}
	b, _ := json.Marshal(out)
	if bytes.Contains(b, []byte("null")) {
		t.Errorf("null in %s", b)
	}
}

func TestEnrichWithProgressStages(t *testing.T) {
	raw := read(t, "testdata/royal92.ged")
	var got []string
	out := EnrichWithProgress(raw, func(stage string) { got = append(got, stage) })
	if strings.Join(got, ",") != "parse,enrich,finish" {
		t.Fatalf("stages = %v", got)
	}
	if !reflect.DeepEqual(out, Enrich(raw)) {
		t.Fatal("EnrichWithProgress differs from Enrich")
	}
	// A callback that panics never changes the result.
	if !reflect.DeepEqual(EnrichWithProgress(raw, func(string) { panic("no") }), out) {
		t.Fatal("a panicking callback changed the result")
	}
	got = nil
	EnrichWithProgress([]byte("not gedcom"), func(stage string) { got = append(got, stage) })
	if strings.Join(got, ",") != "parse" {
		t.Fatalf("not GEDCOM: stages = %v", got)
	}
}

// libDir is the library's module directory, with its sample files.
func libDir(t *testing.T) string {
	t.Helper()
	out, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", "github.com/lesfleursdelanuitdev/ligneous-gedcom-lib").Output()
	if err != nil {
		t.Fatalf("go list the library: %v", err)
	}
	return strings.TrimSpace(string(out))
}

func libSample(t *testing.T, name string) string {
	return filepath.Join(libDir(t), "testdata", name)
}

// Every sample file of the library and every fixture of this repo: enrich
// never fails, agrees with Check on what is GEDCOM, and returns the
// enricher's tables unchanged, with a line for every person and family.
func TestEnrichEverySample(t *testing.T) {
	var files []string
	for _, pattern := range []string{
		filepath.Join(libDir(t), "testdata", "*.ged"), filepath.Join(libDir(t), "testdata", "*", "*.ged"),
		"testdata/*.ged", "testdata/*/*.ged", "../e2e/fixtures/*.ged",
	} {
		m, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, m...)
	}
	if len(files) < 60 {
		t.Fatalf("only %d sample files", len(files))
	}
	for _, f := range files {
		raw := read(t, f)
		out := Enrich(raw)
		name := filepath.Base(filepath.Dir(f)) + "/" + filepath.Base(f)
		if out.Error != "" {
			t.Errorf("%s: %s", name, out.Error)
			continue
		}
		if c := Check(raw); out.IsGedcom != c.IsGedcom {
			t.Errorf("%s: isGedcom %v, Check says %v", name, out.IsGedcom, c.IsGedcom)
		}
		if msg := sameJSON(out); msg != "" {
			t.Errorf("%s: %s", name, msg)
		}
		if !out.IsGedcom {
			continue
		}
		if msg := sameTables(out.Tables, enrichDirect(t, raw)); msg != "" {
			t.Errorf("%s: %s", name, msg)
		}
		if msg := sameRecords(t, out.Tables); msg != "" {
			t.Errorf("%s: %s", name, msg)
		}
		for i, l := range append(append([]int{}, out.Lines.Individuals...), out.Lines.Families...) {
			if l <= 0 {
				t.Errorf("%s: row %d has line %d", name, i, l)
				break
			}
		}
	}
	t.Logf("%d files", len(files))
}

// The page's tree tests convert these enrich answers. They must match the
// library in go.mod; UPDATE_ENRICH=1 go test ./check rewrites them.
func TestEnrichFixtures(t *testing.T) {
	ins, err := filepath.Glob("testdata/tree/*.ged")
	if err != nil || len(ins) == 0 {
		t.Fatalf("no tree fixtures: %v", err)
	}
	type fixture struct{ in, out string }
	var all []fixture
	for _, in := range ins {
		all = append(all, fixture{in, "../web/src/testdata/tree/" + strings.TrimSuffix(filepath.Base(in), ".ged") + ".json"})
	}
	all = append(all, fixture{"testdata/royal92.ged", "../web/src/testdata/tree/royal92.json.gz"},
		fixture{libSample(t, "malformed/duplicate-xref.ged"), "../web/src/testdata/tree/duplicate-xref.json"})
	for _, f := range all {
		out := Enrich(read(t, f.in))
		if out.Error != "" || !out.IsGedcom {
			t.Fatalf("%s: %+v", f.in, out)
		}
		// The bytes enrich returns, on one line. The .ged files are the readable source.
		want, err := out.JSON()
		if err != nil {
			t.Fatal(err)
		}
		want = append(want, '\n')
		if os.Getenv("UPDATE_ENRICH") == "1" {
			if err := writeFixture(f.out, want); err != nil {
				t.Fatal(err)
			}
		}
		if got, err := readFixture(f.out); err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s is out of date (UPDATE_ENRICH=1 go test ./check): %v", f.out, err)
		}
	}
}

// sameJSON reports how out.JSON() differs from json.Marshal(out), read back
// (they differ only in escaping: JSON() leaves <, > and & as they are).
func sameJSON(out Enriched) string {
	fast, err := out.JSON()
	if err != nil {
		return "JSON(): " + err.Error()
	}
	plain, err := json.Marshal(out)
	if err != nil {
		return "json.Marshal: " + err.Error()
	}
	var a, b any
	if err := json.Unmarshal(fast, &a); err != nil {
		return "JSON() is not JSON: " + err.Error()
	}
	_ = json.Unmarshal(plain, &b)
	if !reflect.DeepEqual(a, b) {
		return "JSON() reads back differently from json.Marshal"
	}
	return ""
}

func TestEnrichJSONIsMarshal(t *testing.T) {
	for _, raw := range [][]byte{[]byte(smallTree), read(t, "testdata/royal92.ged"), nil, []byte("not gedcom")} {
		if msg := sameJSON(Enrich(raw)); msg != "" {
			t.Fatal(msg)
		}
	}
	failed := Enrich([]byte(smallTree))
	failed.Error = "boom <&>"
	if msg := sameJSON(failed); msg != "" {
		t.Fatal(msg)
	}
	b, _ := failed.JSON()
	if !bytes.HasPrefix(b, []byte(`{"isGedcom":true,"parseFindings":{`)) || !bytes.HasSuffix(b, []byte(`,"error":"boom <&>"}`)) {
		t.Fatalf("got %.80s … %s", b, b[len(b)-40:])
	}
}

// writeFixture writes b to path, gzipped when path ends in .gz (royal92's
// answer is 3 MB of JSON, about 300 KB gzipped).
func writeFixture(path string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if !strings.HasSuffix(path, ".gz") {
		return os.WriteFile(path, b, 0o644)
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if _, err := zw.Write(b); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}

// readFixture reads path, gunzipped when it ends in .gz.
func readFixture(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err != nil || !strings.HasSuffix(path, ".gz") {
		return b, err
	}
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	return io.ReadAll(zr)
}
