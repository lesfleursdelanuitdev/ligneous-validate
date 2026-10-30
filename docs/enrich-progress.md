# Tree viewer step 2: `enrich` and the conversion (ledger)

Branch `tree-viewer-enrich` (from `tree-viewer` 8d58e47), worktree `~/ligneous-validate-enrich`. Plan: `docs/tree-viewer-spec.md`, Part 2 (the copy in `~/ligneous-validate-tree` is the newer one). Library: ligneous-gedcom-lib v0.3.1, read only.

## Baseline (2026-10-30, before any change)

| Command | Result |
|---|---|
| `GOFLAGS=-mod=mod go test ./...` | ok (check) |
| `npm run test:wasm` | ok |
| `npx vitest run` | 216 passed, 11 files |
| `npx tsc --noEmit -p .` | exit 0 |

`npm ci` ran once under the lease "tree-viewer enrich: npm ci".

## Steps

### 1. A 70,000-person test file

`bench/cmd/gen` gained `-people N`: it writes only `people<N>.ged`, about N linked people in the synth files' shape (seed N). Without the flag the output is unchanged: the default run still gives 70,000/0, 49,989/12,736 and 125,153/32,066 people/families, and synth20.ged is still 21,041,866 bytes.

    cd bench && GOFLAGS=-mod=mod go run ./cmd/gen -out DIR -people 70000
    # people70000.ged: 29,642,841 bytes, 70,002 people, 18,026 families

### 2. `check.Enrich` and `ligneous.enrich`

- `check/enrich.go`: `Enrich(raw)` / `EnrichWithProgress(raw, progress)`. Same parse as `Check` (`ParseWithOptions`, Lenient on, which decodes), then `enricher.Enrich`. Returns `{isGedcom, parseFindings: {errors, warnings, hints}, tables: {…}, lines: {individuals, families}, error?}`.
  - `tables` holds whole tables of `EnrichedDocument` under its own field names and types (a test checks name, type and rows against the library's own output). Empty tables are `[]`, never `null`. The `Document` is never serialized.
  - `lines.individuals[i]` is the line of `tables.Individuals[i]` (likewise families): records sharing an xref keep their own lines.
  - Stages: `parse`, `enrich`, `finish`. A file that isn't GEDCOM stops after `parse`. A panic becomes `error`.
  - `Check` now uses the same `isGedcom` rule function (no change in behaviour).
- `wasm/main.go`: `ligneous.enrich(u8, progress?) → JSON string`.
- Fixtures: `check/testdata/tree/*.ged` → `web/src/testdata/tree/*.json` (and `royal92.json.gz`, 357 KB), rewritten by `UPDATE_ENRICH=1 go test ./check`, checked by `TestEnrichFixtures`.

Tests: `GOFLAGS=-mod=mod go test ./...` 44 top-level tests pass in `check` (10 new: tables unchanged, JSON shape, lines, duplicate-xref lines, parse counts, not GEDCOM, panic, stages, every sample (70 files: the library's 42 and this repo's 28), fixtures). `npm run test:wasm` 8 pass (2 new).

## Commits

| Commit | What |
|---|---|
