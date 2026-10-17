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
	// third argument is called with each stage name.
	var out check.RepairOut
	var err error
	if len(args) > 1 && args[1].Type() == js.TypeObject {
		b := args[1]
		before := check.Counts{Errors: b.Get("errors").Int(), Warnings: b.Get("warnings").Int(), Hints: b.Get("hints").Int()}
		out, err = check.RepairWithProgress(bytesIn(args[0]), before, progressFrom(args, 2))
	} else {
		out, err = check.Repair(bytesIn(args[0]))
	}
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

// saveFn is the editor's "Download edited file": check.SaveUTF8, returned
// like repair as {data, json}; json is "{}", or {"error": …} with empty data.
func saveFn(_ js.Value, args []js.Value) (ret any) {
	fail := func(msg string) any {
		return map[string]any{"data": js.Global().Get("Uint8Array").New(0), "json": errJSON(msg)}
	}
	defer func() {
		if r := recover(); r != nil {
			ret = fail(fmt.Sprint(r))
		}
	}()
	if len(args) < 1 {
		return fail("save needs a Uint8Array")
	}
	out, err := check.SaveUTF8(bytesIn(args[0]))
	if err != nil {
		return fail(err.Error())
	}
	data := js.Global().Get("Uint8Array").New(len(out))
	js.CopyBytesToJS(data, out)
	return map[string]any{"data": data, "json": "{}"}
}

func main() {
	api := map[string]any{
		"check":  js.FuncOf(checkFn),
		"repair": js.FuncOf(repairFn),
		"save":   js.FuncOf(saveFn),
	}
	js.Global().Set("ligneous", js.ValueOf(api))
	js.Global().Set("ligneousReady", true)
	select {}
}
