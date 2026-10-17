//go:build js && wasm

// Run with: GOOS=js GOARCH=wasm go test -exec="$(go env GOROOT)/lib/wasm/go_js_wasm_exec" ./wasm
package main

import (
	"encoding/json"
	"os"
	"strings"
	"syscall/js"
	"testing"
)

func jsBytes(t *testing.T, path string) js.Value {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	v := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(v, b)
	return v
}

func jsObject(s string) js.Value { return js.Global().Get("JSON").Call("parse", s) }

type repairJSON struct {
	Changes []struct {
		Fix     string   `json:"fix"`
		Removed []string `json:"removed"`
	} `json:"changes"`
	Before    map[string]int `json:"before"`
	Available []struct {
		Fix  string `json:"fix"`
		Kind string `json:"kind"`
	} `json:"available"`
	Applied []struct{ Fix string }         `json:"applied"`
	Skipped []struct{ Fix, Reason string } `json:"skipped"`
	Error   string                         `json:"error"`
}

func callRepair(t *testing.T, args ...any) (repairJSON, string) {
	t.Helper()
	vals := make([]js.Value, len(args))
	for i, a := range args {
		vals[i] = js.ValueOf(a)
	}
	ret := repairFn(js.Undefined(), vals).(map[string]any)
	var out repairJSON
	if err := json.Unmarshal([]byte(ret["json"].(string)), &out); err != nil {
		t.Fatal(err)
	}
	data := ret["data"].(js.Value)
	buf := make([]byte, data.Get("length").Int())
	js.CopyBytesToGo(buf, data)
	return out, string(buf)
}

const suggested = "../check/testdata/repair/suggested.ged"

func TestRepairOptions(t *testing.T) {
	before := jsObject(`{"errors":1,"warnings":2,"hints":3}`)
	var stages []string
	progress := js.FuncOf(func(_ js.Value, a []js.Value) any { stages = append(stages, a[0].String()); return nil })
	defer progress.Release()
	out, data := callRepair(t, jsBytes(t, suggested), before, jsObject(`{"fixes":["broken-links"]}`), progress)
	if out.Error != "" {
		t.Fatal(out.Error)
	}
	if strings.Contains(data, "@F9@") || !strings.Contains(data, "\n\n") {
		t.Fatalf("only the broken links should go:\n%s", data)
	}
	if len(out.Applied) != 1 || out.Applied[0].Fix != "broken-links" || out.Before["warnings"] != 2 {
		t.Fatalf("out = %+v", out)
	}
	if strings.Join(stages, ",") != "repair,parse,validate,finish" {
		t.Fatalf("stages = %v", stages)
	}
}

func TestRepairDefaultsAndOldCall(t *testing.T) {
	// Old call (bytes, before, progress): every format fix.
	progress := js.FuncOf(func(js.Value, []js.Value) any { return nil })
	defer progress.Release()
	out, data := callRepair(t, jsBytes(t, suggested), jsObject(`{"errors":0,"warnings":0,"hints":0}`), progress)
	if out.Error != "" || strings.Contains(data, "\n\n") || !strings.Contains(data, "@F9@") {
		t.Fatalf("default repair: %+v\n%s", out, data)
	}
	// No counts: the original is checked for them.
	out, _ = callRepair(t, jsBytes(t, suggested))
	if out.Before["errors"]+out.Before["warnings"]+out.Before["hints"] == 0 {
		t.Fatalf("before = %v", out.Before)
	}
}

func TestRepairSubmitterName(t *testing.T) {
	out, data := callRepair(t, jsBytes(t, suggested), js.Undefined(), jsObject(`{"fixes":["submitter"],"submitterName":"Jo March"}`))
	if out.Error != "" || !strings.Contains(data, "1 NAME Jo March") {
		t.Fatalf("%+v\n%s", out, data)
	}
	out, _ = callRepair(t, jsBytes(t, suggested), js.Undefined(), jsObject(`{"fixes":["submitter"]}`))
	if len(out.Skipped) != 1 || out.Skipped[0].Reason != "needs a name" {
		t.Fatalf("skipped = %+v", out.Skipped)
	}
}

func TestRepairBadOptions(t *testing.T) {
	out, _ := callRepair(t, jsBytes(t, suggested), js.Undefined(), jsObject(`{"fixes":["nope"]}`))
	if out.Error == "" {
		t.Fatal("an unknown fix was accepted")
	}
	out, _ = callRepair(t, jsBytes(t, suggested), js.Undefined(), jsObject(`{"fixes":"encoding"}`))
	if out.Error == "" {
		t.Fatal("fixes as a string was accepted")
	}
}

func TestPlanRepair(t *testing.T) {
	ret := planFn(js.Undefined(), []js.Value{jsBytes(t, suggested)}).(string)
	var out repairJSON
	if err := json.Unmarshal([]byte(ret), &out); err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, a := range out.Available {
		got = append(got, a.Fix+"/"+a.Kind)
	}
	if strings.Join(got, ",") != "blank-lines/format,broken-links/data,empty-families/data,submitter/data" {
		t.Fatalf("available = %v (%s)", got, ret)
	}
	if !strings.Contains(planFn(js.Undefined(), nil).(string), "error") {
		t.Fatal("no error without bytes")
	}
}
