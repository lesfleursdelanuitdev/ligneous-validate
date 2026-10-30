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

### 3. The conversion (`web/src/tree/`)

- `tables.ts`: the enricher's row types (its JSON names) and `readEnriched(json)`, which checks the top level in full and the first row of each table (a wasm from another library version fails loudly). Every row isn't checked: over a million rows at 70,000 people.
- `engine.ts`: the engine's `DescendancyPerson`, `UnionChild`, `UnionRecord`, mirrored from `~/viz-engine-v010/src/types.ts` (fields the conversion fills only), until the viewer can install the engine.
- `graph.ts`: `buildGraph(enriched, { thisYear }) → { graph: { people, unions }, details: { people, families }, problems }`. One pass per table.
  - People: id = xref. firstName/lastName = the primary name form's given names and surname from the enricher's link tables (GIVN/SURN first, as the enricher reads them). Years and places from `Dates`/`Places` (`year`, `original`). Gender mapped as the Gonsalves site does (M Male, F Female, U Unknown, X Other).
  - Unions: one per FAM, id = xref. A missing husband or wife, or one pointing to a person who isn't in the file, is `<xref>:unknown-husb` / `-wife`, with its own placeholder person (`firstName: 'Unknown'`, `xref: null`, `isLiving: false`, `_unknownPlaceholder: true`).
  - Child type (`pedi`), as the engine asked on 2026-10-30: the PEDI of the enricher's parent-child edges in lower case, as written (`birth`, `adopted`, `foster`, `sealing`; anything else kept in lower case), `birth` when there is none. Only the pedigree is read: the enricher derives the relationship type from it. When the father's and mother's edges differ (only a mixed-parentage note does that), the first that isn't `birth`. The exact edges stay in `details.families[…].children`. (Until then it was the Gonsalves site's `birth`/`adopted` rule.)
  - Living rule (spec Part 2), with `thisYear` passed in: no DEAT, BURI or CREM event (dated or not), and either a birth year ≥ thisYear − 100, or no readable year on any of the person's events or their families' events.
  - Details: line, NAME as written, SEX, birth, death and marriage (date as written, year, place as written), other names with TYPE, and each child's edges.
  - Duplicate xrefs: the first record wins; `problems` lists every xref used twice with all its lines. Children of families sharing an xref merge into the first (the enricher's edges carry only the xref).
- Fixtures: cousin marriage, own ancestor (and own parent), adoption (adopted, foster, sealing, GEDCOM 7 `ADOPTED` and `OTHER`, mixed-parentage note, a child in two families), no partner (one side missing, both missing, broken partner and child pointers), the living rule's edges, names, duplicate families, the library's duplicate-xref sample. Golden graph for royal92: `web/src/testdata/tree/royal92-graph.txt.gz` (one record per line; `UPDATE_GOLDEN=1 npx vitest run web/src/tree` rewrites it).
- Mutation checks (each made the tests fail, then reverted): living window 99 years (3 fail), first-row field check off (1 fail), lines-match check off (1 fail); for the PEDI rule, not lower-cased (2 fail) and no `birth` for a missing PEDI (7 fail).
- PEDI values the enricher gives in all 70 sample files and people70000.ged: none (121,848 edges), `adopted` (3), `birth` (1), `foster` (2). Nothing outside the four.

### 4. The worker

- `web/src/tree/job.ts`: `runEnrich(api, bytes, post, thisYear)`. Posts `status`, each Go stage as `{type: 'stage', job: 'enrich'}`, then `graph`, then `{type: 'enriched', result}`. Any failure (Go panic, `{"error"}` answer, a throw, bad JSON, wrong shape) posts an empty tree with `error`, as check posts an empty result.
- `worker.ts`: routes `{type: 'enrich', bytes}` there (the year is the worker's clock). The `save` pre-step is skipped for it (`'save' in msg`, same behaviour for the others).
- `progress.ts`: `ENRICH_STAGES` parse 24, enrich 49, finish 17, graph 10, from the Chromium 70k run.
- Sizes: the wasm grows 5,309,982 → 5,332,132 bytes (gzip -9: 1,445,424 → 1,451,407). The worker bundle 2,918 → 10,149 bytes (the conversion is in it). The page's own JS is unchanged (44.79 kB).

Tests: `npx vitest run` 283 pass, 13 files (216 before); 284 after the `pedi` change. `npx tsc --noEmit -p .` exit 0. `e2e/enrich.spec.ts`: the built worker and wasm in Chromium read royal92 into a tree, with only same-origin requests (2 pass: desktop, phone).

### 5. Measurements (2026-10-30, library v0.3.1)

Commands, each under a lease:

    node --expose-gc scripts/enrich-times.mjs --runs 5 --tables royal92.ged pres2020.ged people70000.ged
    node scripts/enrich-browser.mjs --runs 5 royal92.ged pres2020.ged people70000.ged

royal92 and pres2020 are the library's `testdata/` in the module cache; people70000.ged is from step 1. Median (min-max) of 5 runs after a warm-up. Load average 1.4 to 3.3 (shared server). "Ready": from calling enrich to holding the tree (Node: after the conversion; Chromium: on the page, after the tree is copied back from the worker; each run a fresh worker started before the timer).

| File | People / families | JSON | Ready, Node | Ready, Chromium 153 | Budget |
|---|---|---:|---:|---:|---|
| royal92.ged (0.48 MiB) | 3,010 / 1,422 (+284 placeholders) | 3,637,861 B (3.47 MiB) | 331 ms (238-382) | 331 ms (316-370) | < 2 s: **met** |
| pres2020.ged (1.05 MiB) | 2,322 / 1,115 (+63) | 3,172,878 B (3.03 MiB) | 266 ms (258-281) | 316 ms (309-318) | – |
| people70000.ged (28.27 MiB) | 70,002 / 18,026 | 120,130,604 B (114.57 MiB) | 12,368 ms (12,035-12,949) | 12,758 ms (12,682-13,171) | JSON < ~10 MB: **missed, 12×**; < 10 s: **missed** |

Where the 70k time goes, Chromium: parse 3.1 s, enrich (the enricher itself) 6.3 s, finish (lines, `json.Marshal`, the string to JS, `JSON.parse`) 2.1 s, graph (conversion and the copy to the page) 1.3 s. Node: `enrich()` 10.7 s (parse 2.8, enrich 6.1, finish 1.8), `JSON.parse` 1.0 s, conversion 0.7 s. **The Go heap (wasm linear memory) was 1,328 MiB at the end of the Node runs**; it never shrinks.

Each table's share of the JSON at 70,000 people: Events 29.5 MB (24.6%), Individuals 24.6 MB (20.5%), Dates 14.7 MB, ParentChild 14.2 MB, IndividualEvents 12.2 MB, NameForms 5.9 MB, NameFormGivenNames 4.2 MB, NameFormSurnames 4.1 MB, FamilyChildren 3.6 MB, Spouses 2.9 MB, Families 2.5 MB, FamilyEvents 0.9 MB, the rest under 0.2 MB. (royal92 and pres2020 split much the same; the full lists are the script's `--tables` output.)

What leaving tables out would give at 70,000 people (computed from the same JSON):

| Tables | JSON |
|---|---:|
| all 15, as now | 120.1 MB |
| without IndividualEvents, FamilyEvents and Spouses, which the conversion doesn't read | 104.2 MB (royal92: −0.45 MB) |
| Individuals, Families and FamilyChildren alone (no years, names or child types) | 30.7 MB |
| for comparison only, not done: the same 15 tables with field names once per table instead of once per row | 47.4 MB (12 tables: 40.4 MB) |

So no choice of whole tables reaches 10 MB. Even at zero JSON cost, parse plus the enricher take 9.4 s in Chromium, against a 10 s budget.

### 6. Final check

`GOFLAGS=-mod=mod with-lease "tree-viewer enrich: full check incl. e2e" -- npm run check`, 18:39-18:41 UTC, exit 0:

- `go test ./...`: ok (check, 44 top-level tests); `npm run test:wasm`: ok (8);
- `npx vitest run`: 283 passed, 13 files; the build: ok;
- Playwright: 198 passed, 2 skipped (the two phone-only editor tests, skipped on desktop as before), including both privacy tests on desktop and phone and the new enrich test.

`npx tsc --noEmit -p .`: exit 0. `go.mod` and `go.sum` unchanged; nothing was fetched.

Rerun after the `pedi` change, 18:43 UTC, same command, exit 0: Go ok (check, wasm), vitest 284 passed (one new: the mixed-parentage case), build ok, Playwright 198 passed and the same 2 skipped, including the privacy and enrich tests on both projects.

## Library issues that matter to the viewer

All tested as they are now; none fixed (library read only).

- **PEDI is compared in lower case only** (enricher.go): GEDCOM 7 `ADOPTED` gets `relationship_type: "biological"` with `pedigree: "ADOPTED"`. The chart is still right because the conversion reads only the pedigree, lower-cased; the details show the enricher's values. GEDCOM 7 `OTHER` becomes `pedi: "other"`, outside the four values.
- **No duplicate-xref check.** Handled as above. The enricher is not consistent itself: its PEDI lookup takes the first record with an xref, its family surnames the last. Events of every record with that xref share one owner, so a DEAT on a second record makes the first count as dead.
- **Name parts are shared by lower case**, so `JOHN /SMITH/` shows as "John Smith" when "John /Smith/" came first. The NAME as written (what the validator shows) is in the details.
- **`@@` is not unescaped**: "Bob @@work".
- **A second HEAD replaces the first, and SUBN is dropped**: no effect on the conversion, but the home-person suggestion (spec Part 4 item 2) needs HEAD's `_HOME`/`_ROOT`/submitter, which no enricher table carries.
- **The enricher is the slowest part in wasm**: 6.3 of the 12.8 s at 70,000 people.

## Open questions for momolig

1. **The size budget can't be met with unchanged tables** (114.6 MiB at 70,000 people, about 1.7 KB per person). Raise the budget, allow a different encoding of the same tables, or bring the JavaScript port forward? The 1.3 GB Go heap is the bigger risk on phones.
2. Drop IndividualEvents, FamilyEvents and Spouses (unused, −16 MB at 70k)?
3. The living rule as written counts as dead someone with no birth date but a recent christening (2010) or marriage (2015), and as living everyone with no readable dates (813 of royal92's 3,010; 1,131 living in all). Use the earliest dated event as the birth year when there's none?
4. The home person: should enrich also return HEAD's pointers, or does the viewer start from the best-connected person only?
5. Done as the engine asked (2026-10-30): union ids are the FAM xref with its `@`s; placeholders set `_unknownPlaceholder: true` (and still `firstName: 'Unknown'`); `pedi` is the lower-cased PEDI. Values outside birth/adopted/foster/sealing: `other` (GEDCOM 7 `OTHER`, in a fixture only). The mixed-parentage case gives `adopted`.

## Commits

| Commit | What |
|---|---|
| 2b0bc23 | bench/gen: `-people N` |
| d26773c | check, wasm: `enrich(bytes)`, Go tests, tree fixtures |
| 62d10b4 | tree: the conversion, its tests, royal92 golden |
| 1a543db | worker: the enrich message (`tree/job.ts`) |
| aa75c17 | measurement scripts, `ENRICH_STAGES`, e2e test |
| 8768742 | this ledger's measurements, findings and open questions |
| (next) | `pedi` = the PEDI in lower case, as the engine asked |
