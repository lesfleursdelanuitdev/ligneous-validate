package check

import (
	"reflect"
	"testing"
)

func TestCheckWithProgressStages(t *testing.T) {
	raw := read(t, "testdata/royal92.ged")
	var got []string
	res := CheckWithProgress(raw, func(stage string) { got = append(got, stage) })
	want := []string{"decode", "parse", "validate", "summary", "finish"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("stages = %v, want %v", got, want)
	}
	if !reflect.DeepEqual(res, Check(raw)) {
		t.Fatal("CheckWithProgress result differs from Check")
	}
}

func TestCheckWithProgressNil(t *testing.T) {
	raw := read(t, "testdata/royal92.ged")
	if !reflect.DeepEqual(CheckWithProgress(raw, nil), Check(raw)) {
		t.Fatal("nil progress result differs from Check")
	}
}

// A file that isn't GEDCOM stops early: the stages it reports are still in
// order and never repeated.
func TestCheckWithProgressNotGedcom(t *testing.T) {
	raw := []byte("hello\x00\x01 this is not a gedcom file")
	var got []string
	res := CheckWithProgress(raw, func(stage string) { got = append(got, stage) })
	order := map[string]int{"decode": 0, "parse": 1, "validate": 2, "summary": 3, "finish": 4}
	last := -1
	for _, s := range got {
		i, ok := order[s]
		if !ok || i <= last {
			t.Fatalf("stages out of order or repeated: %v", got)
		}
		last = i
	}
	if !reflect.DeepEqual(res, Check(raw)) {
		t.Fatal("result differs from Check")
	}
}

func TestRepairWithProgressStages(t *testing.T) {
	for _, p := range []string{"testdata/repair/cr-only.ged", "testdata/repair/leading-space.ged", "testdata/royal92.ged"} {
		raw := read(t, p)
		before := countFindings(Check(raw))
		var got []string
		out, err := RepairWithProgress(raw, before, func(stage string) { got = append(got, stage) })
		want := []string{"repair", "parse", "validate", "finish"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: stages = %v, want %v", p, got, want)
		}
		ref, refErr := RepairWithBefore(raw, before)
		if (err == nil) != (refErr == nil) || !reflect.DeepEqual(out, ref) {
			t.Fatalf("%s: RepairWithProgress differs from RepairWithBefore", p)
		}
		plain, _ := Repair(raw)
		if !reflect.DeepEqual(out, plain) {
			t.Fatalf("%s: RepairWithProgress differs from Repair", p)
		}
	}
}
