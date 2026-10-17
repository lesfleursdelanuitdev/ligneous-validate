#!/usr/bin/env bash
# Runs the wasm package's tests (wasm/main_test.go) under Node, with Go's own runner.
set -euo pipefail
cd "$(dirname "$0")/.."
GO=${GO:-$(command -v go || echo /usr/local/go/bin/go)}
root=$("$GO" env GOROOT)
for p in "$root/lib/wasm/go_js_wasm_exec" "$root/misc/wasm/go_js_wasm_exec"; do
  if [ -x "$p" ]; then exec env GOOS=js GOARCH=wasm "$GO" test -exec="$p" ./wasm; fi
done
echo "go_js_wasm_exec not found" >&2
exit 1
