//go:build js && wasm

// Command wasm is the parse-only benchmark build of our library for
// JavaScript. It exposes globalThis.ligneousBench with:
//
//	parse(u8: Uint8Array) -> {individuals, families, error}
//	gc()                  -> runs runtime.GC(), so runs start alike
//
// It calls the same function as the native benchmark: parser.ParseWithOptions
// with Lenient on, which decodes the bytes first.
package main

import (
	"bytes"
	"fmt"
	"runtime"
	"syscall/js"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/parser"
)

func parseFn(_ js.Value, args []js.Value) (ret any) {
	defer func() {
		if r := recover(); r != nil {
			ret = map[string]any{"individuals": 0, "families": 0, "error": fmt.Sprint(r)}
		}
	}()
	buf := make([]byte, args[0].Get("length").Int())
	js.CopyBytesToGo(buf, args[0])
	opts := parser.DefaultOptions()
	opts.Lenient = true
	doc, _, err := parser.ParseWithOptions(bytes.NewReader(buf), opts)
	if err != nil {
		return map[string]any{"individuals": 0, "families": 0, "error": err.Error()}
	}
	return map[string]any{"individuals": len(doc.Individuals), "families": len(doc.Families), "error": ""}
}

func main() {
	js.Global().Set("ligneousBench", js.ValueOf(map[string]any{
		"parse": js.FuncOf(parseFn),
		"gc":    js.FuncOf(func(js.Value, []js.Value) any { runtime.GC(); return nil }),
	}))
	js.Global().Set("ligneousBenchReady", true)
	select {}
}
