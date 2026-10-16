#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
GO=${GO:-$(command -v go || echo /usr/local/go/bin/go)}
mkdir -p web/src/wasm web/public
GOOS=js GOARCH=wasm "$GO" build -ldflags='-s -w' -o web/src/wasm/ligneous.wasm ./wasm
root=$("$GO" env GOROOT)
for p in "$root/lib/wasm/wasm_exec.js" "$root/misc/wasm/wasm_exec.js"; do
  if [ -f "$p" ]; then cp "$p" web/public/wasm_exec.js; break; fi
done
test -f web/public/wasm_exec.js || { echo "wasm_exec.js not found" >&2; exit 1; }
ls -l web/src/wasm/ligneous.wasm
