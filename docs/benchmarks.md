# GEDCOM benchmarks

This page answers two questions:

1. How much slower is our checker's WebAssembly build (what validate.ligneous.org runs in the browser) than the same Go library run natively?
2. How does our library compare with two other GEDCOM libraries, gedcom-go (Go) and read-gedcom (JavaScript)?

The numbers below come from one run of `bench/run.sh` on 2026-10-17, from 01:42 to 02:28 UTC. The raw results are in `bench/results/2026-10-17T0142Z.json` and `bench/results/2026-10-17T0142Z.md`. To rerun everything, see [bench/README.md](../bench/README.md).

## Summary

- **Web against Go.** The site's full check is about 3 times slower as wasm than as native Go. On every file from royal92 up it is 2.4 to 3.4 times slower, and Node and Chromium are within about 12% of each other. For example, the 20 MB file takes 3.1 s natively, and 10.6 s in Node or 10.4 s in Chromium. Parse alone shows a similar gap: 3.1 to 3.8 times slower on the 20 MB and 50 MB files, and about 5 times slower on indented2.
- **Parsing in Go: ours and gedcom-go are about even.** The medians are within 10% of each other on every file except indented2, where ours is 16% faster (217 ms against 258 ms), and the min–max ranges overlap on every file. gedcom-go allocates less: 579 MB in total for the 20 MB file, against 867 MB for ours, and its heap peaks at 284 MB against our 330 MB.
- **Parsing in JavaScript: it depends on the runtime and the size.**
  - In Chromium, read-gedcom (plain JavaScript) is faster than our wasm on the small and medium files. It takes 43 ms on royal92 against our 96 ms, and 1.7 s on the 20 MB file against our 1.9 s. It is slower on the 50 MB file: 6.2 s against our 5.0 s.
  - In Node 22, read-gedcom is slower than our wasm on everything but royal92 (91 ms against our 101 ms). On the 50 MB file it takes 21 s against our 5.6 s. It keeps a large JS heap: 1.2 GB still held after parsing the 20 MB file.
- **read-gedcom rejects indented lines.** It fails on `indented2.ged`, where each line starts with spaces, in both Node and Chromium. All the other results have the right counts, including read-gedcom and gedcom-go on the ANSEL file royal92.
- **Validation is not like-for-like.** gedcom-go's full `ValidateAll` is dominated by its duplicate-person detection, which compares every pair of people who share a surname. It took 68 s on the 20 MB file, and did not finish one run within 120 s on the 5.5 MB file (70,000 people, all named Lee) or on the 50 MB file. Without that step, gedcom-go validates 7 to 25 times faster than ours. It also reports far fewer findings on these files, for example 1 against our 137 on the 20 MB file, because the two libraries check different things.
- **Noise.** The server is shared, and the load average was 21 at the start of the run, during the small-file Go measurements. That is likely why royal92 parsed in a 61 ms median here, against about 23 ms in an earlier single-run trial at a load of about 5. For the small files, trust the ratios less than for the large ones.

## Method

### What is measured

| Task | Ours | gedcom-go | read-gedcom |
|---|---|---|---|
| Parse only: bytes in, in-memory tree out | `parser.ParseWithOptions(bytes.NewReader(raw), opts)` with `opts := parser.DefaultOptions(); opts.Lenient = true`. It includes our decoding step (`parser.Decode`: charset detection, ANSEL, Latin-1 and UTF-16 to UTF-8), because the other two libraries also decode. | `gedcomgo.Decode(bytes.NewReader(raw))`: the README's "Parse a GEDCOM File" call, default options (`StrictMode: false`). It decodes through `charset.NewReader` (ANSEL, Latin-1, UTF-16 to UTF-8). | `readGedcom(arrayBuffer)`: the README's call, default options (index built, CONC/CONT inlined, charset detection). |
| Full check (ours only) | The site's `check.Check(raw)` (decode, `ParseWithOptions` Lenient, `validator.ValidateWithOptions` with `DateConsistency: true`, `enricher.Enrich`, summary, findings), then `json.Marshal` of the result. In wasm: the site's `ligneous.check(u8)` from `scripts/build-wasm.sh`, which does the same and returns the JSON string. | – | – |
| Validation of an already-parsed tree (indicative only) | `validator.ValidateWithOptions(doc, opts)` with `opts := validator.DefaultOptions(); opts.DateConsistency = true` | (a) `gedcomgo.ValidateAll(doc)`: the README's "comprehensive validation" call. (b) "ValidateAll minus duplicates": the same public parts in the same order (header, date logic, references, xref, encoding), with the same default errors-and-warnings filter, and without `FindDuplicates`. Our validator has no duplicate detection, so (b) is the closer match. | – (it has no validation API) |

Notes on the calls:

- For the site's wasm, the benchmark calls `ligneous.check(u8)` without the progress callback the site's worker passes. Its own `JSON.parse` of the returned string is not timed, and natively the timed region ends after `json.Marshal`. Copying the bytes into the Go heap is inside the timed region, as on the site.
- For the parse-only wasm runs, `bench/wasm` is a small build of the same library that exposes `ligneousBench.parse(u8)`. It makes the same `ParseWithOptions` call and returns the two counts. It is built with the same flags as the site (`GOOS=js GOARCH=wasm`, `-ldflags='-s -w'`).
- For read-gedcom, each file's `ArrayBuffer` is made once, in the untimed warm-up, and reused. The counts are read after the timer stops: `getIndividualRecord().length` and `getFamilyRecord().length`. Ours and gedcom-go count with `len(doc.Individuals)` and `len(doc.Individuals())`.

### Versions

| What | Version |
|---|---|
| ligneous-gedcom-lib | v0.2.1, released module, no replace directive (`bench/go.mod`) |
| gedcom-go | `github.com/cacack/gedcom-go` v1.2.0 |
| read-gedcom | 0.3.2, exact pin in `bench/package.json` |
| Go | go1.24.4 (`bench/go.mod` says `go 1.24.0`, as gedcom-go needs) |
| Node | v22.23.3 |
| Chromium | 153.0.8010.12 headless shell (Playwright's cached `chromium_headless_shell-1243`), driven by the site's Playwright 1.63.0 |
| Bundler for read-gedcom in the browser | the site's Vite 8.3.0, IIFE library build (`bench/browser/vite.config.mjs`) |
| Site commit | 744c14d (branch `bench`, from main fcb3143, plus only `bench/`) |
| wasm sizes | site `ligneous.wasm` 4,858,678 bytes; parse-only bench wasm 3,027,710 bytes |

`bench/go.mod` has one replace directive: it points the site module (`github.com/lesfleursdelanuitdev/ligneous-validate`) at `../`, so the benchmark can import the site's `check` package. The library itself comes from the module proxy at v0.2.1.

### Runtimes

- **Go native:** `bench/cmd/gobench`, built with `go build`.
- **Node 22:** `bench/js/node-bench.mjs` with `--expose-gc`, one process per library so the memory numbers don't mix.
- **Chromium:** a local static server (`bench/browser/run.mjs`) serves the page, a Web Worker, the two wasm files, the read-gedcom bundle and the inputs. Playwright drives headless Chromium with `--js-flags=--expose-gc`. Every library and file pair runs in a fresh worker, and the timer is `performance.now()` inside the worker, around the library call only. The worker's timer resolution is 0.1 ms, because the page is not cross-origin isolated.

### Inputs

| File | Size | People | Families | Charset | Source |
|---|---:|---:|---:|---|---|
| minimal551.ged | 204 B | 1 | 0 | UTF-8 | library testdata (v0.2.1 module cache) |
| royal92.ged | 488 KB | 3,010 | 1,422 | ANSEL | library testdata |
| pres2020.ged | 1.1 MB | 2,322 | 1,115 | UTF-8 | library testdata |
| indented2.ged | 5.3 MB | 70,000 | 0 | UTF-8 | generated: the same bytes as the earlier hand-made test file of that name (checked with `cmp`). Every line below level 0 starts with spaces. |
| synth20.ged | 20.1 MB | 49,989 | 12,736 | UTF-8 | generated |
| synth50.ged | 50.7 MB | 125,153 | 32,066 | UTF-8 | generated |

`bench/cmd/gen` generates the synthetic files at run time into a temporary directory, and they are deterministic. They hold linked families over several generations: husband, wife and 0 to 6 children, with spouses picked from earlier families' unmarried children of a similar age. Each person has a name with GIVN and SURN, a sex, and a birth with a date and a place. Some people also have a christening, a death, a burial, an occupation, a residence, inline notes with CONT and CONC, shared NOTE records, and source citations with PAGE and QUAY pointing to SOUR records. Names and places include non-ASCII letters (é, ü, ł, ø, å and others). About 1,900 surnames are skewed towards a few common ones, as in real trees. About 1 in 350 people has a burial a year before their death, so that validation has something to find.

Expected counts come from counting level-0 `INDI` and `FAM` lines in each file, independently of the three libraries. For the generated files, they are also checked against the generator's own counts.

### Timing, memory, load

- One warm-up run, then 10 timed runs, reported as median (min–max) in milliseconds.
- Go runs `runtime.GC()` before each run. Node and Chromium run `gc()` before each run, and for the parse-only wasm also the Go runtime's `runtime.GC()` through `ligneousBench.gc()`. GC time is not counted. The site's wasm has no GC hook, so the full-check wasm runs get only the JS `gc()`.
- gedcom-go's `ValidateAll` is first run once in a child process with a 120 s limit. If it does not finish, the result is "did not finish" and no timed runs are made. If one run takes over 30 s, it gets 3 timed runs instead of 10, and the table marks it with †.
- Memory, where available:
  - Go: `runtime.MemStats` from one extra untimed run. TotalAlloc is everything allocated. Peak HeapInuse is sampled every 2 ms, above the pre-run baseline.
  - wasm: the size of the Go heap's linear memory after the runs. It never shrinks, so it is the peak.
  - read-gedcom in Node: the JS heap still held by the returned tree (`process.memoryUsage().heapUsed` delta), plus process RSS.
  - read-gedcom in Chromium: n/a, because `performance.memory` is not exposed in a worker.
- Server: 12 CPUs (AMD EPYC 9634), 32 GB of RAM, kernel 6.8.0-124. The load average was 21.10 / 11.99 / 8.89 at the start and 1.43 / 2.35 / 4.86 at the end. The run held the host-ops lease "gedcom benchmark" (`a31b4a463613`). The server is shared, so the numbers are indicative.

## Results

Times are in milliseconds: median (min–max) of 10 timed runs.

### Parse only

| File | Size | ours, Go | gedcom-go, Go | ours, Node wasm | read-gedcom, Node | ours, Chromium wasm | read-gedcom, Chromium |
|---|---:|---:|---:|---:|---:|---:|---:|
| minimal551.ged | 0.2 KB | 0.04 (0.03–0.07) | 0.07 (0.03–0.14) | 0.31 (0.21–0.47) | 0.34 (0.24–0.52) | 0.30 (0.10–0.60) | 0.15 (0.10–0.30) |
| royal92.ged | 488 KB | 61.3 (38.7–87.0) | 56.9 (43.6–82.7) | 101 (86.8–131) | 90.9 (72.9–121) | 96.3 (80.5–130) | 42.7 (30.7–61.2) |
| pres2020.ged | 1.1 MB | 45.8 (36.7–53.8) | 43.0 (33.2–53.1) | 110 (94.6–155) | 166 (136–206) | 106 (83.6–130) | 47.4 (43.6–71.7) |
| indented2.ged | 5.3 MB | 217 (203–260) | 258 (210–289) | 1,126 (1,007–1,478) | **INVALID: error** | 1,113 (987–1,205) | **INVALID: error** |
| synth20.ged | 20.1 MB | 555 (511–779) | 609 (573–721) | 2,102 (1,738–2,421) | 3,021 (2,802–4,489) | 1,900 (1,786–2,084) | 1,718 (1,595–2,008) |
| synth50.ged | 50.7 MB | 1,778 (1,303–2,245) | 1,888 (1,740–2,079) | 5,585 (5,223–5,934) | 21,276 (12,526–22,716) | 4,984 (4,869–5,295) | 6,245 (5,165–8,610) |

Parse-only memory for the 20 MB and 50 MB files:

| File | ours, Go: total / peak heap | gedcom-go, Go: total / peak heap | ours wasm (Node and Chromium): linear memory | read-gedcom, Node: JS heap held / RSS |
|---|---|---|---|---|
| synth20.ged | 867 MB / 330 MB | 579 MB / 284 MB | 480 MB | 1,182 MB / 1,954 MB |
| synth50.ged | 2,348 MB / 984 MB | 1,441 MB / 791 MB | 1,550 MB | 1,357 MB / 3,526 MB |

### Full check: native against wasm

| File | Size | Go native | Node wasm | Chromium worker wasm | Node / Go | Chromium / Go |
|---|---:|---:|---:|---:|---:|---:|
| minimal551.ged | 0.2 KB | 0.13 (0.07–0.32) | 0.52 (0.41–0.65) | 0.60 (0.40–0.80) | 4.0× | 4.6× |
| royal92.ged | 488 KB | 162 (136–190) | 383 (330–431) | 398 (349–445) | 2.4× | 2.5× |
| pres2020.ged | 1.1 MB | 113 (99.8–144) | 330 (295–398) | 321 (296–443) | 2.9× | 2.9× |
| indented2.ged | 5.3 MB | 1,946 (1,804–2,221) | 6,287 (5,993–6,698) | 6,117 (5,811–6,817) | 3.2× | 3.1× |
| synth20.ged | 20.1 MB | 3,119 (3,017–3,422) | 10,557 (10,157–11,128) | 10,408 (9,811–11,222) | 3.4× | 3.3× |
| synth50.ged | 50.7 MB | 8,938 (8,233–9,616) | 28,794 (26,123–31,551) | 25,592 (25,032–26,918) | 3.2× | 2.9× |

Full-check memory: natively, the 50 MB file allocates 5.3 GB in total and the heap peaks at 1.36 GB. As wasm, the Go heap grows to 1,992 MB in Node and 2,216 MB in Chromium. Wasm memory is capped at 4 GB, and phones usually allow much less.

### Validation (indicative only)

Validation of an already-parsed tree, Go native. The two libraries check different things, so the times are not a like-for-like comparison.

| File | ours: ValidateWithOptions (DateConsistency) | findings | gedcom-go: ValidateAll | findings | gedcom-go: ValidateAll minus duplicates | findings |
|---|---:|---:|---:|---:|---:|---:|
| minimal551.ged | 0.06 (0.03–0.11) | 1 | 0.03 (0.02–0.09) | 1 | 0.03 (0.01–0.04) | 1 |
| royal92.ged | 52.8 (38.9–85.2) | 66 | 237 (161–266) | 20 | 2.90 (1.85–6.57) | 20 |
| pres2020.ged | 32.2 (26.6–41.0) | 41 | 162 (117–247) | 1 | 1.31 (1.06–4.32) | 1 |
| indented2.ged | 539 (507–615) | 0 | did not finish (> 120 s) | – | 21.6 (17.9–35.1) | 1 |
| synth20.ged | 1,159 (1,047–1,397) | 137 | 67,903 (61,418–108,525) † | 1 | 154 (133–189) | 1 |
| synth50.ged | 3,149 (3,015–3,633) | 292 | did not finish (> 120 s) | – | 435 (404–509) | 1 |

† One run took 76 s in the probe, so this is 3 timed runs instead of 10.

On the 20 MB file, `ValidateAll` allocated 189 GB in total over one run, against 8.7 MB without duplicate detection. Its cost grows with the square of the number of people who share a surname. On a real tree it depends on how many people share each surname, so these synthetic files are only one example.

On the generated files, ours reports the deliberate burials before death (137 on the 20 MB file), and gedcom-go reports one finding. This benchmark does not check which library is right about each finding.

### Correctness

Every result outside these rows found exactly the expected number of people and families, with no error. That covers ours in all three runtimes, gedcom-go, and read-gedcom on the other five files, including royal92 in ANSEL. This test checks counts only, not decoded text.

| Library | Runtime | File | Found (expected) | Status |
|---|---|---|---|---|
| read-gedcom | Node | indented2.ged | 0 people (70,000) | **invalid**: throws `Invalid format for line 2: "  1 SOUR X"`. It does not accept lines that start with spaces. |
| read-gedcom | Chromium | indented2.ged | 0 people (70,000) | **invalid**: same error |
| gedcom-go ValidateAll | Go | indented2.ged, synth50.ged | counts right (parse) | **did not finish** one run within 120 s; this is a time limit, not a wrong result |

The full per-result table, with every count and error, is in `bench/results/2026-10-17T0142Z.md`.

## What the numbers mean

- People using validate.ligneous.org wait about three times longer than a native Go server would take for the same check. A 20 MB file takes about 10 s in the browser, against about 3 s natively. Most of the gap is wasm itself: parse alone shows the same ratio, so it is not the JSON or the copy across the JS boundary.
- Our Go parser is neither faster nor slower than gedcom-go in a way these runs can tell apart, but it allocates more memory. Allocations (TotalAlloc 1.5 times gedcom-go's on the 20 MB file) are the first place to look for a speed-up.
- In the browser, a well-written JavaScript parser (read-gedcom) beats our wasm parser on files up to about 20 MB. Our wasm only pulls ahead at 50 MB. Moving to wasm does not make parsing faster than plain JavaScript. What it gives the site is the same Go code as the library, with its decoding and validation.
- read-gedcom in Node 22 is much slower on big files than read-gedcom in Chromium 153 (21 s against 6 s at 50 MB). It holds 1.2 to 1.4 GB of JS heap, so garbage collection pressure is the likely cause. That is a difference between the runtimes, not a property of read-gedcom alone.
- For validation, the honest comparison is gedcom-go without duplicate detection, and there gedcom-go is much faster. It is also doing much less on these files, judging by the findings. If we compare validators again, compare which problems each one finds before comparing times.
