package check

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/repair"
)

// suggested.ged has one blank line (a format kind), two broken links in
// people and families (one with a line under it), an empty family, a family
// whose only member is a broken link, and no submitter.
const suggested = "testdata/repair/suggested.ged"

func fixesOf(infos []repair.FixInfo) []repair.Fix {
	out := []repair.Fix{}
	for _, i := range infos {
		out = append(out, i.Fix)
	}
	return out
}

func TestRepairWithOptionsDefaultIsRepair(t *testing.T) {
	for _, p := range []string{"testdata/repair/cr-only.ged", "testdata/royal92.ged", suggested} {
		raw := read(t, p)
		before := countFindings(Check(raw))
		got, err := RepairWithOptions(raw, before, repair.Options{})
		if err != nil {
			t.Fatal(err)
		}
		want, err := RepairWithBefore(raw, before)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: RepairWithOptions(Options{}) differs from RepairWithBefore", p)
		}
		if got.Available == nil || got.Applied == nil || got.Skipped == nil {
			t.Fatalf("%s: nil lists: %+v", p, got)
		}
	}
}

func TestRepairWithOptionsAvailable(t *testing.T) {
	raw := read(t, suggested)
	out, err := RepairWithOptions(raw, countFindings(Check(raw)), repair.Options{})
	if err != nil {
		t.Fatal(err)
	}
	want := []repair.Fix{repair.FixBlankLines, repair.FixBrokenLinks, repair.FixEmptyFamilies, repair.FixSubmitter}
	if got := fixesOf(out.Available); !reflect.DeepEqual(got, want) {
		t.Fatalf("available = %v, want %v", got, want)
	}
	// The default runs only the format kinds.
	if got := fixesOf(out.Applied); !reflect.DeepEqual(got, []repair.Fix{repair.FixBlankLines}) {
		t.Fatalf("applied = %v", got)
	}
	if !bytes.Contains(out.Data, []byte("1 FAMC @F9@")) {
		t.Fatal("the default removed a broken link")
	}
}

func TestRepairWithOptionsBrokenLinks(t *testing.T) {
	raw := read(t, suggested)
	out, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: []repair.Fix{repair.FixBrokenLinks}})
	if err != nil {
		t.Fatal(err)
	}
	want := strings.NewReplacer("1 FAMC @F9@\n2 PEDI birth\n", "", "1 CHIL @I7@\n", "", "1 HUSB @I99@\n", "").Replace(string(raw))
	if string(out.Data) != want {
		t.Fatalf("data =\n%s\nwant\n%s", out.Data, want)
	}
	var removed []string
	for _, c := range out.Changes {
		if c.Fix != repair.FixBrokenLinks {
			t.Errorf("change of kind %q", c.Fix)
		}
		removed = append(removed, c.Removed...)
	}
	if !reflect.DeepEqual(removed, []string{"2 PEDI birth"}) {
		t.Errorf("removed = %v", removed)
	}
	if got := fixesOf(out.Applied); !reflect.DeepEqual(got, []repair.Fix{repair.FixBrokenLinks}) {
		t.Errorf("applied = %v", got)
	}
	// After is counted on the repaired copy: the three broken-link findings are gone.
	if out.After.Errors+out.After.Warnings+out.After.Hints >= countFindings(Check(raw)).Errors+countFindings(Check(raw)).Warnings+countFindings(Check(raw)).Hints {
		t.Errorf("after = %+v", out.After)
	}
}

func TestRepairWithOptionsSubmitter(t *testing.T) {
	raw := read(t, suggested)
	fixes := []repair.Fix{repair.FixSubmitter}
	out, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: fixes})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Data, raw) || len(out.Skipped) != 1 || out.Skipped[0].Reason != "needs a name" {
		t.Fatalf("without a name: skipped = %+v", out.Skipped)
	}
	out, err = RepairWithOptions(raw, Counts{}, repair.Options{Fixes: fixes, SubmitterName: "Jo March"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Data, []byte("0 @SUBM1@ SUBM\n1 NAME Jo March\n0 TRLR\n")) || !bytes.Contains(out.Data, []byte("1 SUBM @SUBM1@\n")) {
		t.Fatalf("data =\n%s", out.Data)
	}
}

func TestRepairWithOptionsNoneAndUnknown(t *testing.T) {
	raw := read(t, suggested)
	out, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: []repair.Fix{}})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Data, raw) || len(out.Changes) != 0 || len(out.Available) != 4 {
		t.Fatalf("none: %+v", out)
	}
	if _, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: []repair.Fix{"nope"}}); err == nil {
		t.Fatal("an unknown fix was accepted")
	}
}

func TestRepairWithOptionsProgressStages(t *testing.T) {
	raw := read(t, suggested)
	var got []string
	opt := repair.Options{Fixes: []repair.Fix{repair.FixBrokenLinks}}
	out, err := RepairWithOptionsProgress(raw, Counts{Errors: 7}, opt, func(s string) { got = append(got, s) })
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"repair", "parse", "validate", "finish"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("stages = %v, want %v", got, want)
	}
	if out.Before != (Counts{Errors: 7}) {
		t.Fatalf("before = %+v: the caller's counts must be kept", out.Before)
	}
	ref, _ := RepairWithOptions(raw, Counts{Errors: 7}, opt)
	if !reflect.DeepEqual(out, ref) {
		t.Fatal("RepairWithOptionsProgress differs from RepairWithOptions")
	}
}

func TestRepairWithOptionsANSELKeepsEncoding(t *testing.T) {
	raw := read(t, "testdata/encodings/ansel.ged")
	var format []repair.Fix
	for _, f := range repair.Fixes() {
		if f != repair.FixEncoding && f != repair.FixBrokenLinks && f != repair.FixEmptyFamilies && f != repair.FixSubmitter {
			format = append(format, f)
		}
	}
	out, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: format})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Data, []byte("CHAR ANSEL")) {
		t.Fatalf("the header no longer says ANSEL:\n%s", out.Data)
	}
	for _, c := range out.Changes {
		if c.Fix == repair.FixEncoding {
			t.Fatalf("encoding change without the encoding fix: %+v", c)
		}
	}
}

func TestPlanMatchesRepairAvailable(t *testing.T) {
	for _, p := range []string{suggested, blankInFam, "testdata/royal92.ged", "testdata/encodings/ansel.ged", "testdata/repair/cr-only.ged"} {
		raw := read(t, p)
		got, err := Plan(raw, repair.Options{})
		if err != nil {
			t.Fatal(err)
		}
		full, err := RepairWithOptions(raw, Counts{}, repair.Options{})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got.Available, full.Available) {
			t.Fatalf("%s: plan = %+v, want %+v", p, got.Available, full.Available)
		}
		for _, a := range got.Available {
			if got.Units[a.Fix] == nil {
				t.Fatalf("%s: no units for %s", p, a.Fix)
			}
		}
	}
	if _, err := Plan([]byte("not gedcom"), repair.Options{}); err == nil {
		t.Fatal("no error for a file with no GEDCOM lines")
	}
	if _, err := Plan(read(t, suggested), repair.Options{Fixes: []repair.Fix{"nope"}}); err == nil {
		t.Fatal("an unknown fix was accepted")
	}
}

// blank-in-fam.ged is suggested.ged plus a family F4 whose broken CHIL is
// followed by a blank line and then a WIFE: F4 has a member, so it stays.
const blankInFam = "testdata/repair/blank-in-fam.ged"

func unitLines(us []repair.Unit) []int {
	out := []int{}
	for _, u := range us {
		out = append(out, u.Line)
	}
	return out
}

func TestPlanUnitsMatchTheRepair(t *testing.T) {
	raw := read(t, blankInFam)
	sel := []repair.Fix{repair.FixBlankLines, repair.FixBrokenLinks}
	p, err := Plan(raw, repair.Options{Fixes: sel})
	if err != nil {
		t.Fatal(err)
	}
	// With broken-links chosen, empty-families removes F2 (23) with its FAMS link (17)
	// and F3 (26, empty once its broken HUSB goes); F4 (28) keeps its WIFE.
	fam := p.Units[repair.FixEmptyFamilies]
	if got := unitLines(fam); !reflect.DeepEqual(got, []int{17, 23, 26}) {
		t.Fatalf("empty-families units at %v (%+v)", got, fam)
	}
	out, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: append(sel, repair.FixEmptyFamilies)})
	if err != nil {
		t.Fatal(err)
	}
	var want []int
	for _, c := range out.Changes {
		if c.Fix == repair.FixEmptyFamilies {
			want = append(want, c.Line)
		}
	}
	if !reflect.DeepEqual(unitLines(fam), want) {
		t.Fatalf("plan %v, repair %v", unitLines(fam), want)
	}
	if bytes.Contains(out.Data, []byte("0 @F4@ FAM")) == false || !bytes.Contains(out.Data, []byte("1 WIFE @I1@\n0 TRLR")) {
		t.Fatalf("F4 should stay with its wife:\n%s", out.Data)
	}
	for _, a := range p.Available {
		if a.Fix == repair.FixEmptyFamilies && !reflect.DeepEqual(a.Needs, []repair.Fix{repair.FixBrokenLinks}) {
			t.Fatalf("empty-families needs %v", a.Needs)
		}
	}
}

func TestPlanJSON(t *testing.T) {
	p, err := Plan(read(t, suggested), repair.Options{})
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{`"available":`, `"units":`, `"broken-links":[{"line":11,"what":`, `"lines":["2 PEDI birth"]`, `"needs":["broken-links"]`} {
		if !strings.Contains(string(b), k) {
			t.Errorf("json has no %s: %s", k, b)
		}
	}
}

func TestParseOptions(t *testing.T) {
	cases := []struct {
		in   string
		want repair.Options
		err  bool
	}{
		{``, repair.Options{}, false},
		{`null`, repair.Options{}, false},
		{`{}`, repair.Options{}, false},
		{`{"fixes":null}`, repair.Options{}, false},
		{`{"fixes":[]}`, repair.Options{Fixes: []repair.Fix{}}, false},
		{`{"fixes":["encoding","broken-links"],"submitterName":"Jo"}`,
			repair.Options{Fixes: []repair.Fix{repair.FixEncoding, repair.FixBrokenLinks}, SubmitterName: "Jo"}, false},
		{`{"fixes":"encoding"}`, repair.Options{}, true},
		{`[`, repair.Options{}, true},
	}
	for _, c := range cases {
		got, err := ParseOptions(c.in)
		if (err != nil) != c.err {
			t.Fatalf("%q: err = %v", c.in, err)
		}
		if !c.err && !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%q: got %#v, want %#v", c.in, got, c.want)
		}
		// nil and empty must stay apart: nil is every format fix, [] is none.
		if !c.err && (got.Fixes == nil) != (c.want.Fixes == nil) {
			t.Fatalf("%q: nil-ness of Fixes lost", c.in)
		}
	}
}

func TestRepairOutJSON(t *testing.T) {
	raw := read(t, suggested)
	out, err := RepairWithOptions(raw, Counts{}, repair.Options{Fixes: []repair.Fix{repair.FixBrokenLinks}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"changes", "left", "before", "after", "available", "applied", "skipped"} {
		if _, ok := m[k]; !ok {
			t.Errorf("json has no %q: %s", k, b)
		}
	}
	if !strings.Contains(string(b), `"removed":["2 PEDI birth"]`) || !strings.Contains(string(b), `"fix":"broken-links"`) {
		t.Errorf("json = %s", b)
	}
}
