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

func checkFn(_ js.Value, args []js.Value) (ret any) {
	defer func() {
		if r := recover(); r != nil {
			ret = errJSON(fmt.Sprint(r))
		}
	}()
	if len(args) < 1 {
		return errJSON("check needs a Uint8Array")
	}
	b, err := json.Marshal(check.Check(bytesIn(args[0])))
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
	out, err := check.Repair(bytesIn(args[0]))
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

func main() {
	api := map[string]any{
		"check":  js.FuncOf(checkFn),
		"repair": js.FuncOf(repairFn),
	}
	js.Global().Set("ligneous", js.ValueOf(api))
	js.Global().Set("ligneousReady", true)
	select {}
}
