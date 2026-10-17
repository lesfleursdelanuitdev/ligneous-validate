# GEDCOM benchmarks

This page answers two questions:

1. How much slower is our checker's WebAssembly build (what validate.ligneous.org runs in the browser) than the same Go library run natively?
2. How does our library compare with two other GEDCOM libraries, gedcom-go (Go) and read-gedcom (JavaScript)?

The numbers below come from one run of `bench/run.sh` on 2026-10-17, from 04:16 to 04:59 UTC, with **ligneous-gedcom-lib v0.3.1**. The raw results are in `bench/results/2026-10-17T0416Z.json` and `.md`. To rerun everything, see [bench/README.md](../bench/README.md).

An earlier run (`bench/results/2026-10-17T0142Z.*`) used v0.2.1, at a much higher server load, with read-gedcom's buffer copy outside the timer. It is kept for history. Don't compare its numbers with the ones below.

Sizes and memory are in MiB (2^20 bytes) and KiB (2^10 bytes) throughout.

## Summary

- **Web against Go.** The site's full check is about 3 to 4 times slower as wasm than as native Go. On every file from royal92 up, it is 3.1 to 3.8 times slower in Node and 3.2 to 4.1 times slower in Chromium. For example, the 20 MiB file takes 3.1 s natively, 10.8 s in Node and 10.8 s in Chromium. Parse alone shows a gap of 3 to 5 times: 2.8 to 5.5 times in Node and 2.7 to 5.4 times in Chromium. The top of that range is indented2 in both runtimes.
- **Parsing in Go: ours and gedcom-go are about even.** Leaving out minimal551, where both take a few hundredths of a millisecond, the medians are within about 12% of each other on every file (the widest gap is indented2: 190 ms against 212 ms), and the min–max ranges overlap. Ours is ahead on four files and gedcom-go on one (pres2020). gedcom-go allocates less: 579 MiB in total for the 20 MiB file, against 867 MiB for ours, and its heap peaks at 287 MiB against our 376 MiB.
- **Parsing in JavaScript: it depends on the runtime and the size.**
  - In Chromium, read-gedcom (plain JavaScript) is faster than our wasm on the small files: 2.1 times on royal92 (41 ms against 86 ms) and 1.6 times on pres2020 (54 ms against 86 ms). The two are about even on the 20 MiB file (1.94 s against 1.88 s). Our wasm is faster on the 50 MiB file (4.8 s against 5.6 s).
  - In Node 22, read-gedcom is faster than our wasm on royal92 (72 ms against 88 ms) and slower on every larger file. On the 50 MiB file it takes 8.4 s against our 5.1 s.
- **read-gedcom rejects indented lines.** It throws on `indented2.ged`, where every line below level 0 starts with spaces, in both Node and Chromium. All the other results have the right people and family counts, including read-gedcom and gedcom-go on the ANSEL file royal92.
- **Validation is not like-for-like.** gedcom-go's own `ValidateAll` is dominated by its duplicate-person detection, which compares every pair of people who share a surname. It took 64 s on the 20 MiB file. It did not finish one run within 120 s on indented2 (70,000 people, all named Lee) or on the 50 MiB file. The fast gedcom-go column is **our hand-built variant, `ValidateAll` minus `FindDuplicates`**. gedcom-go offers no such API: we assembled it from its public parts. That variant is 6 to 34 times faster than our validator, but it reports fewer findings on most files: 20 against our 66 on royal92, 1 against 41 on pres2020, 1 against 137 on the 20 MiB file and 1 against 292 on the 50 MiB file. The exceptions are indented2, where it reports 1 and ours 0, and minimal551, where both report 1. The two do different work.
- **Noise.** The server is shared. The load average was 0.26 at the start and 3.54 at the end, so this run was quieter than the earlier one, where royal92 parsed in a 61 ms median against 24 ms here. Each runtime runs in its own stage of the script, minutes apart: first Go, then Node, then Chromium. A change in load between stages moves the cross-runtime ratios (wasm against native, read-gedcom against ours) as well as the times. On files under about 1 MiB, the run-to-run spread is about ±15%, so ratios there carry about that much uncertainty. Ratios under about 1.2× are within noise.

## Method

### What is measured

| Task | Ours | gedcom-go | read-gedcom |
|---|---|---|---|
| Parse only: bytes in, in-memory tree out | `parser.ParseWithOptions(bytes.NewReader(raw), opts)` with `opts := parser.DefaultOptions(); opts.Lenient = true`. It includes our decoding step (`parser.Decode`: charset detection, ANSEL, Latin-1 and UTF-16 to UTF-8), because the other two also decode. | `gedcomgo.Decode(bytes.NewReader(raw))`: the README's "Parse a GEDCOM File" call, with default options (`StrictMode: false`). It decodes through `charset.NewReader` (ANSEL, Latin-1, UTF-16 to UTF-8). | `readGedcom(arrayBuffer)`: the README's call, with default options (index built, CONC/CONT inlined, charset detection). |
| Full check (ours only) | The site's `check.Check(raw)`: decode, `ParseWithOptions` with Lenient on, `validator.ValidateWithOptions` with `DateConsistency: true`, `enricher.Enrich`, summary and findings. Then `json.Marshal` of the result. In wasm: the site's `ligneous.check(u8)`, which does the same and returns the JSON string. | – | – |
| Validation of an already-parsed tree (indicative only) | `validator.ValidateWithOptions(doc, opts)` with `opts := validator.DefaultOptions(); opts.DateConsistency = true` | (a) `gedcomgo.ValidateAll(doc)`: the README's "comprehensive validation" call. (b) **Our hand-built variant**, "ValidateAll minus duplicates": `ValidateAll`'s public parts in the same order (header, date logic, references, xref, encoding), with its default errors-and-warnings filter, and without `FindDuplicates`. gedcom-go offers no such call. Our validator has no duplicate detection, so (b) is closer in scope. | – (it has no validation API) |

### Notes on the calls

The same rules apply to every library:

- **Counting.** For parse only, counting the people and families is inside the timed region for every library: `len(doc.Individuals)` for ours (in Go, also in the wasm build), `len(doc.Individuals())` for gedcom-go (which walks its records), and `getIndividualRecord().length` and `getFamilyRecord().length` for read-gedcom. For the full check, the counts are part of the result, and they are read after the timer stops in every runtime: from the Go struct natively, and from the JSON string in wasm.
- **Input copy.** Each call copies its input inside the timed region. Our wasm copies the bytes into the Go heap. read-gedcom's `ArrayBuffer` is copied from the file's bytes inside the timer, in Node and in the worker. Natively, ours reads the `bytes.Reader` with `io.ReadAll`, and gedcom-go streams it.
- **Warm-up and GC.** One untimed warm-up, then 10 timed runs, with a garbage collection before each run that is not timed:
  - Go: `runtime.GC()`;
  - Node and Chromium: `gc()`, made available by `--expose-gc`;
  - the parse-only wasm: also the Go runtime's own `runtime.GC()`.

The differences that remain:

- **Options.** Ours runs with `Lenient = true`, as the site does: line-level errors become findings, and the line is skipped. gedcom-go and read-gedcom run with their defaults, as their READMEs show.
- **The full check in wasm:**
  - It is called without the progress callback that the site's worker passes.
  - The site's `JSON.parse` of the returned string is not timed, and natively the timed region ends after `json.Marshal`.
  - The site's wasm has no Go GC hook, so those runs get only the JS `gc()` between runs.
- **The parse-only wasm.** It is `bench/wasm`, a small build of the same library that exposes `ligneousBench.parse(u8)`. It makes the same `ParseWithOptions` call and returns the two counts. It is built with the same flags as the site (`GOOS=js GOARCH=wasm`, `-ldflags='-s -w'`).
- **The site's wasm.** It is the site's own `wasm/` package, built from `bench/go.mod` so that it links v0.3.1 like the native runs. The site's `go.mod` on this branch still pins v0.2.1, so `scripts/build-wasm.sh` alone would link the older library. The build command and flags are the same as that script's.

### Versions

| What | Version |
|---|---|
| ligneous-gedcom-lib | **v0.3.1**, released module, set in `bench/go.mod` with no replace directive |
| gedcom-go | `github.com/cacack/gedcom-go` v1.2.0 |
| read-gedcom | 0.3.2, exact pin in `bench/package.json` |
| Go | go1.24.4 (`bench/go.mod` says `go 1.24.0`, as gedcom-go needs) |
| Node | v22.23.3 |
| Chromium | 153.0.8010.12 headless shell (Playwright's cached `chromium_headless_shell-1243`), driven by the site's Playwright 1.63.0 |
| Bundler for read-gedcom in the browser | the site's Vite 8.3.0, IIFE library build (`bench/browser/vite.config.mjs`) |
| Commit the run was made from | 8c07957 on branch `bench` (main fcb3143 plus `bench/`) |
| wasm sizes | site check wasm 5,013,103 bytes; parse-only bench wasm 3,027,737 bytes |

`bench/go.mod` has one replace directive: it points the site module (`github.com/lesfleursdelanuitdev/ligneous-validate`) at `../`, so the benchmark can import the site's `check` and `wasm` packages. The library itself comes from the module proxy.

### Licences

- **ligneous-gedcom-lib** (ours): the module has no licence file. Its README says "No license file: all rights reserved."
- **gedcom-go** v1.2.0: MIT. Its LICENSE file in the module cache reads "MIT License, Copyright (c) 2025 Chris Clonch".
- **read-gedcom** 0.3.2: MIT. Its package.json has `"license": "MIT"`, and its LICENSE file reads "MIT License, Copyright (c) 2020 Florian Cassayre".
- **royal92.ged and pres2020.ged** come from our library's `testdata/`. The benchmark reads them from the Go module cache and does not copy them into this repo. The library's README calls them "widely shared public sample files". Neither file states a licence. What the files themselves say:
  - royal92 is a PAF 2.2 export dated 20 NOV 1992, submitted by Denis R. Reid.
  - pres2020 is a Family Tree Maker export dated 6 JUL 2020 (`US_Presidents_2020_2020-07-06.ged`), submitted by Paul E Stobbe. Some of its source notes quote copyright lines of the publishers they cite.
  - Nothing more is known here about their terms.
- **The generated files** are made at run time by `bench/cmd/gen` and are not stored.

### Runtimes

- **Go native:** `bench/cmd/gobench`, built with `go build`.
- **Node 22:** `bench/js/node-bench.mjs` with `--expose-gc`, one process per library so the memory numbers don't mix.
- **Chromium:** a local static server (`bench/browser/run.mjs`) serves the page, a Web Worker, the two wasm files, the read-gedcom bundle and the inputs. Playwright drives headless Chromium with `--js-flags=--expose-gc`. Each library and file pair runs in a fresh worker. The timer is `performance.now()` inside the worker, with a resolution of 0.1 ms, because the page is not cross-origin isolated.

### Inputs

| File | Size | People | Families | Charset | Source |
|---|---:|---:|---:|---|---|
| minimal551.ged | 0.2 KiB | 1 | 0 | UTF-8 | library testdata (v0.3.1 module) |
| royal92.ged | 488 KiB | 3,010 | 1,422 | ANSEL | library testdata |
| pres2020.ged | 1.05 MiB | 2,322 | 1,115 | UTF-8 | library testdata |
| indented2.ged | 5.25 MiB | 70,000 | 0 | UTF-8 | generated by `bench/cmd/gen`: every line below level 0 is indented with spaces (2 per level). It is byte-for-byte the earlier hand-made test file of that name. |
| synth20.ged | 20.07 MiB | 49,989 | 12,736 | UTF-8 | generated |
| synth50.ged | 50.71 MiB | 125,153 | 32,066 | UTF-8 | generated |

The synthetic files are deterministic. They hold linked families over several generations: husband, wife and 0 to 6 children, with spouses picked from earlier families' unmarried children of a similar age. Each person has a name with GIVN and SURN, a sex, and a birth with a date and a place. Some people also have a christening, a death, a burial, an occupation, a residence, inline notes with CONT and CONC, shared NOTE records, and source citations with PAGE and QUAY pointing to SOUR records. Names and places include non-ASCII letters (é, ü, ł, ø, å and others). About 1,900 surnames are skewed towards a few common ones. About 1 in 350 people has a burial a year before their death, so that validation has something to find.

The expected counts come from counting level-0 `INDI` and `FAM` lines in each file, independently of the three libraries. For the generated files, they are also checked against the generator's own counts.

### Timing, memory, load

- Times are the median (min–max), in milliseconds, of 10 timed runs after one warm-up.
- gedcom-go's `ValidateAll` is first run once in a child process with a 120 s limit. If it doesn't finish in time, the result is "did not finish", with no timed runs. If one run takes over 30 s, it gets 3 timed runs instead of 10, marked †.
- Memory, where available:
  - Go: `runtime.MemStats` from one extra untimed run. TotalAlloc is everything allocated. Peak HeapInuse is sampled every 2 ms, above the pre-run baseline.
  - wasm: the size of the Go heap's linear memory after the runs. It never shrinks, so it is the peak.
  - read-gedcom in Node: the JS heap still held by the returned tree, from an extra run that keeps the tree, plus the process RSS.
  - read-gedcom in Chromium: n/a, because `performance.memory` is not exposed in a worker.
- Server: 12 CPUs (AMD EPYC 9634), 31.3 GiB of RAM, kernel 6.8.0-124. Load average 0.26 / 0.34 / 0.16 at the start, 3.54 / 2.67 / 3.18 at the end. The run held the host-ops lease "gedcom benchmark" (`015c324a0fcb`). The numbers are indicative.

## Results

Times are in milliseconds: median (min–max) of 10 timed runs.

### Parse only

| File | Size | ours, Go | gedcom-go, Go | ours, Node wasm | read-gedcom, Node | ours, Chromium wasm | read-gedcom, Chromium |
|---|---:|---:|---:|---:|---:|---:|---:|
| minimal551.ged | 0.2 KiB | 0.03 (0.01–0.04) | 0.03 (0.01–0.07) | 0.21 (0.18–0.30) | 0.31 (0.22–0.41) | 0.25 (0.10–0.40) | 0.30 (0.20–0.50) |
| royal92.ged | 488 KiB | 24.2 (19.7–26.6) | 25.7 (22.2–30.3) | 88.4 (80.4–98.3) | 72.4 (70.1–87.2) | 86.3 (78.1–98.6) | 40.6 (31.0–59.4) |
| pres2020.ged | 1.05 MiB | 31.9 (26.5–36.6) | 29.8 (26.7–36.0) | 89.7 (85.9–100) | 122 (110–147) | 86.3 (80.7–89.9) | 53.6 (52.3–64.1) |
| indented2.ged | 5.25 MiB | 190 (175–224) | 212 (194–241) | 1,037 (907–1,238) | **INVALID: error** | 1,023 (907–1,310) | **INVALID: error** |
| synth20.ged | 20.07 MiB | 609 (419–672) | 618 (566–657) | 1,872 (1,706–2,277) | 2,779 (2,597–2,950) | 1,880 (1,641–1,999) | 1,935 (1,720–2,114) |
| synth50.ged | 50.71 MiB | 1,823 (1,624–2,290) | 1,902 (1,694–2,187) | 5,094 (4,818–5,316) | 8,425 (8,043–9,093) | 4,848 (4,556–5,735) | 5,594 (4,922–6,330) |

Parse-only memory for the two large files:

| File | ours, Go: total / peak heap | gedcom-go, Go: total / peak heap | ours, wasm linear memory (Node; Chromium) | read-gedcom, Node: JS heap held / RSS |
|---|---|---|---|---|
| synth20.ged | 867 / 376 MiB | 579 / 287 MiB | 480; 480 MiB | 512 / 1,381 MiB |
| synth50.ged | 2,348 / 973 MiB | 1,441 / 703 MiB | 1,552; 1,551 MiB | 1,280 / 2,569 MiB |

### Full check: native against wasm

| File | Size | Go native | Node wasm | Chromium worker wasm | Node / Go | Chromium / Go |
|---|---:|---:|---:|---:|---:|---:|
| minimal551.ged | 0.2 KiB | 0.09 (0.07–0.18) | 0.66 (0.46–0.78) | 0.70 (0.50–1.30) | 7.3× | 7.8× |
| royal92.ged | 488 KiB | 99.5 (92.4–112) | 373 (337–430) | 411 (340–451) | 3.7× | 4.1× |
| pres2020.ged | 1.05 MiB | 106 (99.3–131) | 332 (313–399) | 369 (328–514) | 3.1× | 3.5× |
| indented2.ged | 5.25 MiB | 1,718 (1,633–1,992) | 6,486 (6,120–7,711) | 6,926 (6,297–7,402) | 3.8× | 4.0× |
| synth20.ged | 20.07 MiB | 3,110 (2,857–3,665) | 10,839 (10,328–12,281) | 10,791 (10,491–11,565) | 3.5× | 3.5× |
| synth50.ged | 50.71 MiB | 8,463 (8,093–8,895) | 28,317 (26,771–31,094) | 26,681 (26,094–27,948) | 3.3× | 3.2× |

The minimal551 ratio compares fractions of a millisecond. It mostly measures the cost of calling into wasm, not of checking.

Full-check memory for the 50 MiB file: natively it allocates 5,294 MiB in total, and the heap peaks at 1,193 MiB. As wasm, the Go heap grows to 2,040 MiB in Node and 2,216 MiB in Chromium. Wasm memory is capped at 4 GiB, and phones usually allow much less.

### Validation (indicative only)

Validation of an already-parsed tree, Go native. The two libraries check different things, so the times are not a like-for-like comparison. The last two columns are **our hand-built variant** of gedcom-go's validation, not an API it offers.

| File | ours: ValidateWithOptions (DateConsistency) | findings | gedcom-go: ValidateAll | findings | our variant: gedcom-go ValidateAll minus FindDuplicates | findings |
|---|---:|---:|---:|---:|---:|---:|
| minimal551.ged | 0.03 (0.02–0.08) | 1 | 0.01 (0.01–0.02) | 1 | 0.01 (0.01–0.02) | 1 |
| royal92.ged | 33.5 (29.0–38.8) | 66 | 161 (153–188) | 20 | 2.08 (1.79–3.10) | 20 |
| pres2020.ged | 33.7 (28.5–39.5) | 41 | 93.6 (72.6–113) | 1 | 0.99 (0.95–1.72) | 1 |
| indented2.ged | 483 (454–570) | 0 | did not finish (> 120 s) | – | 21.2 (17.3–24.3) | 1 |
| synth20.ged | 1,137 (1,055–1,291) | 137 | 63,792 (63,585–75,781) † | 1 | 194 (139–259) | 1 |
| synth50.ged | 3,171 (3,002–3,372) | 292 | did not finish (> 120 s) | – | 428 (406–472) | 1 |

† One run took 76 s in the probe, so this is 3 timed runs instead of 10.

On the 20 MiB file, one `ValidateAll` run allocated 189,124 MiB in total, against 8.7 MiB without duplicate detection. Its cost grows with the square of the number of people who share a surname. On a real tree it depends on how surnames are spread, so these synthetic files are one example, not a rule. On the 20 MiB and 50 MiB files, ours reports the deliberate burials before death (137 and 292), and the gedcom-go variant reports one finding on each. It reports fewer findings than ours on royal92 and pres2020 too. The exceptions are indented2 (1 for gedcom-go, 0 for ours) and minimal551 (1 each). This benchmark does not check which library is right about each finding.

### Correctness

Every result not listed here found exactly the expected number of people and families, with no error. That covers ours in all three runtimes, gedcom-go, and read-gedcom on the other five files, including royal92 in ANSEL. Only the counts are checked, not the decoded text.

| Library | Runtime | File | Found (expected) | Status |
|---|---|---|---|---|
| read-gedcom | Node | indented2.ged | 0 people (70,000) | **invalid**: throws `Invalid format for line 2: "  1 SOUR X"`. It does not accept lines that start with spaces. |
| read-gedcom | Chromium | indented2.ged | 0 people (70,000) | **invalid**: same error |
| gedcom-go ValidateAll | Go | indented2.ged, synth50.ged | counts right (from the parse) | **did not finish** one run within 120 s; a time limit, not a wrong result |

The full table, with every count and error, is in `bench/results/2026-10-17T0416Z.md`.

## What the numbers mean

- People using validate.ligneous.org wait about three and a half times longer than a native Go server would take for the same check. A 20 MiB file takes about 11 s in the browser, against about 3 s natively. Parse alone, without the JSON, shows 2.8 to 5.5 times. That suggests most of the gap comes from running as wasm rather than from the JSON or the copy across the JS boundary, but this benchmark does not measure those parts separately.
- These runs can't tell our Go parser and gedcom-go apart on speed, but ours allocates more memory: 1.5 times gedcom-go's TotalAlloc on the 20 MiB file. Allocations are the first place to look for a speed-up.
- In Chromium, a plain JavaScript parser (read-gedcom) is 1.6 to 2.1 times as fast as our wasm parser on files of about 1 MiB. The two are even at 20 MiB, and our wasm is ahead at 50 MiB. On files up to 20 MiB, moving to wasm does not make parsing faster than plain JavaScript. What it gives the site is the same Go code as the library, with its decoding and validation.
- read-gedcom is slower in Node 22 than in Chromium 153 on the large files: 8.4 s against 5.6 s at 50 MiB. This benchmark does not show why.
- For validation, gedcom-go without duplicate detection is much faster than ours. It also reports fewer findings on most of these files, and that variant is our own assembly, not a gedcom-go API. If we compare validators again, compare which problems each one finds before comparing times.
