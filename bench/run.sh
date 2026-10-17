#!/usr/bin/env bash
# Runs every benchmark measurement and writes results/<stamp>.json and
# results/<stamp>.md. See README.md.
#
#   bench/run.sh              10 timed runs per measurement (the default)
#   RUNS=3 bench/run.sh       fewer runs, for a quick look
#
# It holds a host-ops lease ("gedcom benchmark") while it runs.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
site=$(cd "$here/.." && pwd)

if [ -z "${HOST_OPS_LEASE:-}" ] && command -v with-lease >/dev/null; then
  exec with-lease "gedcom benchmark" -- "$0" "$@"
fi

RUNS=${RUNS:-10}
GO=${GO:-$(command -v go || echo /usr/local/go/bin/go)}
export PATH="$(dirname "$GO"):$PATH"
stamp=$(date -u +%Y-%m-%dT%H%MZ)

for d in "$site/node_modules/playwright" "$site/node_modules/vite" "$here/node_modules/read-gedcom"; do
  if [ ! -d "$d" ]; then
    echo "missing $d: run 'npm ci' in $site and in $here first" >&2
    exit 1
  fi
done

work=$(mktemp -d "${TMPDIR:-/tmp}/gedcom-bench.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/inputs" "$here/build" "$here/results"
log() { echo "[$(date -u +%H:%M:%S)] $*" >&2; }

load() { cut -d' ' -f1-3 /proc/loadavg; }
load_start=$(load)

log "build: site wasm, bench wasm, read-gedcom bundle, Go runner"
(cd "$site" && bash scripts/build-wasm.sh >/dev/null)
(cd "$here" && GOOS=js GOARCH=wasm "$GO" build -ldflags='-s -w' -o build/ligneous-bench.wasm ./wasm)
(cd "$here" && "$GO" build -o build/gobench ./cmd/gobench)
(cd "$here" && "$site/node_modules/.bin/vite" build --config browser/vite.config.mjs >/dev/null)

log "inputs into $work/inputs"
testdata="$("$GO" env GOMODCACHE)/github.com/lesfleursdelanuitdev/ligneous-gedcom-lib@v0.2.1/testdata"
[ -d "$testdata" ] || testdata=/srv/apps/gonsalves/ligneous-gedcom-lib/testdata
for f in minimal551.ged royal92.ged pres2020.ged; do
  cp "$testdata/$f" "$work/inputs/$f"
  chmod u+w "$work/inputs/$f"
done
(cd "$here" && "$GO" run ./cmd/gen -out "$work/inputs" >/dev/null)
files=(minimal551.ged royal92.ged pres2020.ged indented2.ged synth20.ged synth50.ged)
paths=()
for f in "${files[@]}"; do paths+=("$work/inputs/$f"); done

log "Go native: parse, check, validate"
"$here/build/gobench" -runs "$RUNS" "${paths[@]}" > "$work/1-go.jsonl"

log "Node: our wasm (parse), read-gedcom (parse), site wasm (check)"
exec_js="$site/web/public/wasm_exec.js"
node --expose-gc "$here/js/node-bench.mjs" --lib ours-parse --runs "$RUNS" \
  --wasm "$here/build/ligneous-bench.wasm" --exec "$exec_js" "${paths[@]}" > "$work/2-node-ours-parse.jsonl"
node --expose-gc "$here/js/node-bench.mjs" --lib read-gedcom --runs "$RUNS" "${paths[@]}" > "$work/3-node-read-gedcom.jsonl"
node --expose-gc --max-old-space-size=4096 "$here/js/node-bench.mjs" --lib ours-check --runs "$RUNS" \
  --wasm "$site/web/src/wasm/ligneous.wasm" --exec "$exec_js" "${paths[@]}" > "$work/4-node-ours-check.jsonl"

log "Chromium (headless, Web Worker): our wasm (parse), read-gedcom (parse), site wasm (check)"
node "$here/browser/run.mjs" --runs "$RUNS" --inputs "$work/inputs" "${files[@]}" > "$work/5-browser.jsonl"

load_end=$(load)
cat > "$work/env.json" <<EOF
{
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "runs": $RUNS,
  "nproc": $(nproc),
  "cpu": "$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ *//')",
  "memTotal": "$(grep MemTotal /proc/meminfo | awk '{print $2 " kB"}')",
  "kernel": "$(uname -r)",
  "loadStart": "$load_start",
  "loadEnd": "$load_end",
  "go": "$("$GO" env GOVERSION)",
  "node": "$(node --version)",
  "lease": "${HOST_OPS_LEASE:-none}",
  "libraries": {
    "ligneous-gedcom-lib": "v0.2.1",
    "gedcom-go": "$(cd "$here" && "$GO" list -m -f '{{.Version}}' github.com/cacack/gedcom-go)",
    "read-gedcom": "$(node -p "require('$here/node_modules/read-gedcom/package.json').version")"
  },
  "siteCommit": "$(git -C "$site" rev-parse --short HEAD)",
  "siteWasmBytes": $(stat -c %s "$site/web/src/wasm/ligneous.wasm"),
  "benchWasmBytes": $(stat -c %s "$here/build/ligneous-bench.wasm")
}
EOF
node "$here/report.mjs" --work "$work" --out "$here/results" --stamp "$stamp"
log "done: results/$stamp.json and results/$stamp.md"
