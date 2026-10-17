# GEDCOM benchmark

Measures how fast our GEDCOM library (`github.com/lesfleursdelanuitdev/ligneous-gedcom-lib` v0.3.1, the released module, set in `bench/go.mod`) parses and checks files:

- natively in Go, and as the WebAssembly build that validate.ligneous.org runs, in Node and in headless Chromium;
- against two other libraries: [gedcom-go](https://github.com/cacack/gedcom-go) v1.2.0 (Go) and [read-gedcom](https://github.com/arbre-app/read-gedcom) 0.3.2 (JavaScript).

The method, the exact calls and the latest numbers are in [docs/benchmarks.md](../docs/benchmarks.md).

## Run it

```sh
bench/run.sh            # 10 timed runs per measurement, about 45 minutes
RUNS=3 bench/run.sh     # a quicker look
```

It needs, once:

- `npm ci` in the repo root (Vite and Playwright, already the site's dev dependencies);
- `npm ci` in `bench/` (read-gedcom 0.3.2, pinned exactly);
- Go 1.24 or newer (gedcom-go needs it). Set `GO=/path/to/go` if `go` is not on the PATH.
- Chromium. On a clean machine, run this once first, in the repo root:

  ```sh
  npx playwright install chromium-headless-shell
  ```

  On the Ligneous server the cached build at `~/.cache/ms-playwright/chromium_headless_shell-1243/...` is used, and nothing is downloaded. Set `CHROMIUM=/path/to/chrome` to use another browser. `run.sh` itself never downloads a browser.

`run.sh` builds everything it needs, generates the large inputs into a temporary directory, runs every measurement, and deletes the temporary directory at the end.

The host-ops lease is optional. When `with-lease` is installed (the Ligneous server), `run.sh` holds the lease "gedcom benchmark" while it runs. Elsewhere, or with `NO_LEASE=1`, it runs without one and records `"lease": "none"` in the results.

The site's full check runs as the site's wasm package (`wasm/` in the repo root), built from `bench/go.mod` so that it links the same library version as the native runs. The command and flags are the same as `scripts/build-wasm.sh`.

## What it writes

- `bench/results/<stamp>.json`: every result (times of each run, median, min, max, counts found and expected, status, error, memory) plus the environment (CPU count, load average at start and end, Go, Node and Chromium versions, library versions, site commit).
- `bench/results/<stamp>.md`: the same as Markdown tables: parse only, full check, validation, correctness, memory.

`<stamp>` is the UTC start time, such as `2026-10-17T0130Z`.

## Files

| Path | What it is |
|---|---|
| `run.sh` | Runs everything. |
| `cmd/gen` | Writes the generated inputs: `indented2.ged` (5.3 MiB, 70,000 people, every line below level 0 indented with spaces), `synth20.ged` and `synth50.ged` (about 20 and 50 MiB of linked people and families with events, notes and sources, UTF-8), and `expected.json` with their true counts. The output is deterministic. To make the files by hand: `cd bench && go run ./cmd/gen -out /some/dir`. |
| `cmd/gobench` | Native Go runs: parse (ours, gedcom-go), full check (ours), validation (ours, gedcom-go). |
| `wasm/` | Parse-only wasm build of our library, `ligneousBench.parse(u8)`. The full check uses the site's wasm package, built by `run.sh` from this module. |
| `js/node-bench.mjs` | Node runs, one library per process. |
| `browser/` | Static server, page, Web Worker and Playwright driver for the Chromium runs; `vite.config.mjs` bundles read-gedcom with the site's Vite. |
| `report.mjs` | Checks the counts and writes the results files. |
| `build/` | Build output (ignored by git). |

## Rules it follows

- Each measurement is one warm-up run, then `RUNS` timed runs. Go runs `runtime.GC()` before each run; Node and Chromium run `gc()` (and our wasm's own `runtime.GC()`) before each run. GC time is not counted.
- A result whose people or family count is wrong, or that failed, is marked invalid in the tables, never left out.
- gedcom-go's `ValidateAll` is first tried once in a child process with a 120 s limit. If it doesn't finish, the result says "did not finish". If one run takes over 30 s, it gets 3 timed runs, and the table says so.
- The parse runners take the record counts inside the timed call, for every library. The check's counts are read from its result after the timer, natively and in wasm.
- Sizes and memory are in MiB (2^20 bytes).
- The numbers come from a shared server: treat them as indicative, and compare runs from the same day.

## Licences

- Our library, ligneous-gedcom-lib: no licence file; its README says "all rights reserved".
- gedcom-go v1.2.0: MIT (its LICENSE file, "Copyright (c) 2025 Chris Clonch").
- read-gedcom 0.3.2: MIT (`"license": "MIT"` in its package.json, and its LICENSE file, "Copyright (c) 2020 Florian Cassayre").
- `royal92.ged` and `pres2020.ged` are read from the library's `testdata/` in the Go module cache. They are not copied into this repo. The library's README calls them "widely shared public sample files". Neither file states a licence. royal92 is a PAF 2.2 export dated 20 NOV 1992, submitted by Denis R. Reid. pres2020 is a Family Tree Maker export dated 6 JUL 2020 (`US_Presidents_2020_2020-07-06.ged`), submitted by Paul E Stobbe, and its source notes quote copyright lines of the publishers they cite.
- The generated files are made by `cmd/gen`.
