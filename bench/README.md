# GEDCOM benchmark

Measures how fast our GEDCOM library (`github.com/lesfleursdelanuitdev/ligneous-gedcom-lib` v0.2.1) parses and checks files:

- natively in Go, and as the WebAssembly build that validate.ligneous.org runs, in Node and in headless Chromium;
- against two other libraries: [gedcom-go](https://github.com/cacack/gedcom-go) v1.2.0 (Go) and [read-gedcom](https://github.com/arbre-app/read-gedcom) 0.3.2 (JavaScript).

The method, the exact calls and the latest numbers are in [docs/benchmarks.md](../docs/benchmarks.md).

## Run it

```sh
bench/run.sh            # 10 timed runs per measurement, about 30-40 minutes
RUNS=3 bench/run.sh     # a quicker look
```

It needs, once:

- `npm ci` in the repo root (Vite and Playwright, already the site's dev dependencies);
- `npm ci` in `bench/` (read-gedcom 0.3.2, pinned exactly);
- Go 1.24 or newer (gedcom-go needs it). Set `GO=/path/to/go` if `go` is not on the PATH.
- Chromium: the cached Playwright build at `~/.cache/ms-playwright/chromium_headless_shell-1243/...`. Set `CHROMIUM=/path/to/chrome` to use another. The script never downloads a browser.

`run.sh` takes a host-ops lease named "gedcom benchmark" while it runs (through `with-lease`), builds everything it needs, generates the large inputs into a temporary directory, runs every measurement, and deletes the temporary directory at the end.

## What it writes

- `bench/results/<stamp>.json`: every result (times of each run, median, min, max, counts found and expected, status, error, memory) plus the environment (CPU count, load average at start and end, Go, Node and Chromium versions, library versions, site commit).
- `bench/results/<stamp>.md`: the same as Markdown tables: parse only, full check, validation, correctness, memory.

`<stamp>` is the UTC start time, such as `2026-10-17T0130Z`.

## Files

| Path | What it is |
|---|---|
| `run.sh` | Runs everything. |
| `cmd/gen` | Writes the generated inputs: `indented2.ged` (5.5 MB, 70,000 people on indented lines), `synth20.ged` and `synth50.ged` (about 20 and 50 MB of linked people and families with events, notes and sources, UTF-8), and their true counts. Deterministic. |
| `cmd/gobench` | Native Go runs: parse (ours, gedcom-go), full check (ours), validation (ours, gedcom-go). |
| `wasm/` | Parse-only wasm build of our library, `ligneousBench.parse(u8)`. The full check uses the site's own wasm (`scripts/build-wasm.sh`). |
| `js/node-bench.mjs` | Node runs, one library per process. |
| `browser/` | Static server, page, Web Worker and Playwright driver for the Chromium runs; `vite.config.mjs` bundles read-gedcom with the site's Vite. |
| `report.mjs` | Checks the counts and writes the results files. |
| `build/` | Build output (ignored by git). |

## Rules it follows

- Each measurement is one warm-up run, then `RUNS` timed runs. Go runs `runtime.GC()` before each run; Node and Chromium run `gc()` (and our wasm's own `runtime.GC()`) before each run. GC time is not counted.
- A result whose people or family count is wrong, or that failed, is marked invalid in the tables, never left out.
- gedcom-go's `ValidateAll` is first tried once in a child process with a 120 s limit. If it doesn't finish, the result says "did not finish". If one run takes over 30 s, it gets 3 timed runs, and the table says so.
- The numbers come from a shared server: treat them as indicative, and compare runs from the same day.
