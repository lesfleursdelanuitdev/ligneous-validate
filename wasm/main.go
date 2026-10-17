//go:build js && wasm

// Command wasm exposes the check package to JavaScript as globalThis.ligneous.
package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/lesfleursdelanuitdev/ligneous-validate/check"
)

func errJSON(msg string) string {
	b, _ := json.Marshal(map[string]string{"error": msg})
	return string(b)
}

func bytesIn(v js.Value) []byte {
	buf := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(buf, v)
	return buf
}

// progressFrom turns an optional JS function argument into a stage callback.
// The JS side posts each stage to the page while the check is still running.
func progressFrom(args []js.Value, i int) func(string) {
	if len(args) <= i || args[i].Type() != js.TypeFunction {
		return nil
	}
	fn := args[i]
	return func(stage string) {
		// A callback that throws must never change the result.
		defer func() { _ = recover() }()
		fn.Invoke(stage)
	}
}

func checkFn(_ js.Value, args []js.Value) (ret any) {
	defer func() {
		if r := recover(); r != nil {
			ret = errJSON(fmt.Sprint(r))
		}
	}()
	if len(args) < 1 {
		return errJSON("check needs a Uint8Array")
	}
	// An optional second argument is called with each stage name.
	b, err := json.Marshal(check.CheckWithProgress(bytesIn(args[0]), progressFrom(args, 1)))
	if err != nil {
		return errJSON(err.Error())
	}
	return string(b)
}

func repairFn(_ js.Value, args []js.Value) (ret any) {
	defer func() {
		if r := recover(); r != nil {
			ret = map[string]any{"data": js.Global().Get("Uint8Array").New(0), "json": errJSON(fmt.Sprint(r))}
		}
	}()
	fail := func(msg string) any {
		return map[string]any{"data": js.Global().Get("Uint8Array").New(0), "json": errJSON(msg)}
	}
	if len(args) < 1 {
		return fail("repair needs a Uint8Array")
	}
	// An optional second argument {errors, warnings, hints} is the page's own
	// count for the original, so it isn't checked a second time. An optional
	// third argument {fixes, submitterName} chooses the fixes (fixes missing
	// or null: every format fix; []: none). The last argument, when it is a
	// function, is called with each stage name.
	opt, err := check.ParseOptions(optionsJSON(args, 2))
	if err != nil {
		return fail("repair options: " + err.Error())
	}
	progress := progressFrom(args, len(args)-1)
	raw := bytesIn(args[0])
	var before check.Counts
	if len(args) > 1 && args[1].Type() == js.TypeObject {
		b := args[1]
		before = check.Counts{Errors: b.Get("errors").Int(), Warnings: b.Get("warnings").Int(), Hints: b.Get("hints").Int()}
	} else {
		before = check.CountsOf(check.Check(raw)) // no counts given: check the original once
	}
	out, err := check.RepairWithOptionsProgress(raw, before, opt, progress)
	if err != nil {
		return fail(err.Error())
	}
	b, err := json.Marshal(out)
	if err != nil {
		return fail(err.Error())
	}
	data := js.Global().Get("Uint8Array").New(len(out.Data))
	js.CopyBytesToJS(data, out.Data)
	return map[string]any{"data": data, "json": string(b)}
}

// optionsJSON is argument i as JSON text when it is an object, else "".
func optionsJSON(args []js.Value, i int) string {
	if len(args) <= i || args[i].Type() != js.TypeObject {
		return ""
	}
	return js.Global().Get("JSON").Call("stringify", args[i]).String()
}

// planFn is plan(bytes, options?): {available, units}, the preview of each
// kind of fix if chosen together with options.fixes (see check.Plan).
func planFn(_ js.Value, args []js.Value) (ret any) {
	defer func() {
		if r := recover(); r != nil {
			ret = errJSON(fmt.Sprint(r))
		}
	}()
	if len(args) < 1 {
		return errJSON("plan needs a Uint8Array")
	}
	opt, err := check.ParseOptions(optionsJSON(args, 1))
	if err != nil {
		return errJSON("plan options: " + err.Error())
	}
	p, err := check.Plan(bytesIn(args[0]), opt)
	if err != nil {
		return errJSON(err.Error())
	}
	b, err := json.Marshal(p)
	if err != nil {
		return errJSON(err.Error())
	}
	return string(b)
}

func main() {
	api := map[string]any{
		"check":  js.FuncOf(checkFn),
		"repair": js.FuncOf(repairFn),
		"plan":   js.FuncOf(planFn),
	}
	js.Global().Set("ligneous", js.ValueOf(api))
	js.Global().Set("ligneousReady", true)
	select {}
}
