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

// A progress callback that panics (in the page: a JS callback that throws)
// never changes the result.
func TestCheckWithProgressPanickingCallback(t *testing.T) {
	raw := read(t, "testdata/royal92.ged")
	calls := 0
	res := CheckWithProgress(raw, func(string) { calls++; panic("callback broke") })
	if calls != 5 {
		t.Errorf("callback called %d times, want 5 (once per stage, even after panicking)", calls)
	}
	if !reflect.DeepEqual(res, Check(raw)) {
		t.Fatalf("result differs from Check: error=%q", res.Error)
	}
}

func TestRepairWithProgressPanickingCallback(t *testing.T) {
	for _, p := range []string{"testdata/repair/cr-only.ged", "testdata/royal92.ged"} {
		raw := read(t, p)
		before := countFindings(Check(raw))
		out, err := RepairWithProgress(raw, before, func(string) { panic("callback broke") })
		if err != nil {
			t.Fatalf("%s: err = %v", p, err)
		}
		ref, _ := Repair(raw)
		if !reflect.DeepEqual(out, ref) {
			t.Fatalf("%s: result differs from Repair", p)
		}
	}
}
