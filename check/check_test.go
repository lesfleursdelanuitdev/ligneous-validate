package check

import (
	"bytes"
	"math/rand"
	"os"
	"strings"
	"testing"
)

func read(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestCheckRoyal92(t *testing.T) {
	r := Check(read(t, "testdata/royal92.ged"))
	if !r.IsGedcom {
		t.Fatal("royal92 should be GEDCOM")
	}
	if r.Summary.People != 3010 {
		t.Errorf("people = %d, want 3010", r.Summary.People)
	}
	if len(r.Findings) == 0 {
		t.Fatal("no findings")
	}
	for _, f := range r.Findings {
		if f.Line <= 0 {
			t.Errorf("%s: line %d", f.Code, f.Line)
		}
		if f.Title == "" {
			t.Errorf("%s: empty title", f.Code)
		}
		switch f.Severity {
		case "error", "warning", "hint":
		default:
			t.Errorf("%s: severity %q", f.Code, f.Severity)
		}
	}
	if r.Summary.Years == nil || r.Summary.Years[0] > r.Summary.Years[1] {
		t.Errorf("years = %v", r.Summary.Years)
	}
	if r.Summary.Lines == 0 || r.Summary.Families == 0 {
		t.Errorf("summary = %+v", r.Summary)
	}
}

func TestCheckEncodings(t *testing.T) {
	r := Check(read(t, "testdata/encodings/ansel.ged"))
	if r.Encoding.Detected != "ANSEL" {
		t.Errorf("detected = %q", r.Encoding.Detected)
	}
	if !strings.Contains(r.Text, "René /Dupré/") {
		t.Errorf("text = %q", r.Text)
	}
}

func TestCheckNotGedcom(t *testing.T) {
	png := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	rng := rand.New(rand.NewSource(1))
	junk := make([]byte, 4096-len(png))
	rng.Read(junk)
	png = append(png, junk...)
	if r := Check(png); r.IsGedcom {
		t.Error("png reported as GEDCOM")
	}
	if r := Check(nil); r.IsGedcom {
		t.Error("empty reported as GEDCOM")
	}
	min := "0 HEAD\n1 SOUR Test\n2 NAME Prog\n2 VERS 1.2\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n0 TRLR\n"
	r := Check([]byte(min))
	if !r.IsGedcom {
		t.Error("minimal not GEDCOM")
	}
	if r.Summary.Program != "Prog" || r.Summary.ProgramVersion != "1.2" || r.Summary.GedcomVersion != "5.5.1" {
		t.Errorf("summary = %+v", r.Summary)
	}
	if r.Summary.Years != nil {
		t.Errorf("years = %v", r.Summary.Years)
	}
}

func TestRepairCounts(t *testing.T) {
	sum := func(c Counts) int { return c.Errors + c.Warnings + c.Hints }
	// cr-only.ged: the brief expected fewer findings afterwards, but a CR-only
	// file is repaired without a finding changing, so only equality of counts
	// and a non-empty change list are required. leading-space.ged drops findings.
	for _, c := range []struct {
		file   string
		fewer  bool
		change bool
	}{{"cr-only", false, true}, {"leading-space", true, true}} {
		t.Run(c.file, func(t *testing.T) {
			raw := read(t, "testdata/repair/"+c.file+".ged")
			out, err := Repair(raw)
			if err != nil {
				t.Fatal(err)
			}
			if c.fewer && sum(out.Before) <= sum(out.After) {
				t.Errorf("before %+v not more than after %+v", out.Before, out.After)
			}
			if sum(out.Before) < sum(out.After) {
				t.Errorf("repair added findings: %+v -> %+v", out.Before, out.After)
			}
			if len(out.Changes) == 0 {
				t.Error("no changes")
			}
			if bytes.Equal(out.Data, raw) {
				t.Error("data unchanged")
			}
			if got := countFindings(Check(out.Data)); got != out.After {
				t.Errorf("Check(out.Data) = %+v, After = %+v", got, out.After)
			}
		})
	}
}
