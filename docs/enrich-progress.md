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

### 13. Final check, round 2

`GOFLAGS=-mod=mod with-lease "tree-viewer enrich: full check incl. e2e (round 2)" -- npm run check`, exit 0: Go ok (`check` 48 top-level tests, `wasm` 9), vitest 336 passed in 16 files, the build ok, Playwright 198 passed and the same 2 phone-only tests skipped on desktop, including both privacy tests and the enrich test (now joining the 5 parts, the start and famcOrder) on desktop and phone. `npx tsc --noEmit -p .` exit 0. `go.mod`/`go.sum` unchanged; nothing fetched.

## Round 3: T32 (the living rule across the family), T33

T33 (momolig): the 3 MiB phone threshold stands as built (`PHONE_LARGE_BYTES`).

### 14. The living rule, extended (T32, amends T10)

- Dead with a DEAT, BURI or CREM event, as before. Otherwise each person's own birth year, else their own earliest dated event (their own or a family's they are a partner in), seeds one breadth-first search from every dated person at once (`livingBases` in `graph.ts`). Estimates pass from relative to relative: a parent is the year − 15, a child + 15, a partner or sibling + 0. Each person takes the estimate from the **fewest relations away**; where estimates at that distance disagree, **the earliest** (so dead if any says over 100 years). No date anywhere in their family: living.
- O(people + families + links): people and families are both nodes, so every relation is two hops through its family (in from a partner +0 or a child −15; out to a partner +0 or a child +15), and a family of many children costs its children once, not their pairs. Each node is visited once, so cycles end.
- Partner and sibling offset 0 (`SAME_GENERATION_YEARS`): most partners and siblings are born within about 10 years of each other, under the 15-year generation step, so an estimate through one is about as good as one through a parent; a margin would only move the 100-year line for everyone estimated that way.
- `details.people[…].living` says what the answer rested on: `{by: 'death'}`, `{by: 'birth' | 'event', year}`, `{by: 'relatives', year, steps}` or `{by: 'none'}`.
- Changes from T10, in `living.ged`: two parents born 1800 and 1950 now give 1815 (dead; T10 took the later parent), a child born 1960 and a parent born 1800 give 1815 (dead; T10 took the child first), and a parent with only a death in 1900 gives 1915 (dead; T10 used parents' births only).
- `check/testdata/tree/living-family.ged` (tests in `graph.test.ts`, "T32"): an undated queen with a king born 1900 (dead, 1 step) or 1960 (living); an undated sibling of one born 1910 / 1990; three undated generations under an ancestor born 1881 (1896, 1911, 1926: the third, at 100 years, living); an undated partner of an undated child of a parent born 1900 (1915, 2 steps); the fewest steps winning (a partner born 1990 over a grandparent born 1800); a tie of steps (partner 1990, parent 1800: 1815, dead); an isolated undated person (living); a person who is their own grandparent (ends; 1885, the earlier); a death beating a living partner.

**royal92: 387 of 3,010 living** (891 under T10, 1,131 under the first rule): 318 by their own birth year, 21 by their own earliest event, 46 from relatives (all one relation away) and **2 with no date anywhere in their family** (510 under T10). 504 people turned dead and none living; in the golden only `isLiving` and the new `living` detail changed. Recounted independently in Python with a person-level search (explicit partner and sibling links, no family nodes): 387 (339 own, 46 at one step, 2 none). 70k file: 19,794 living, as before (everyone there has a birth date). All bases in royal92: death 1,692, birth 448, relatives 811, event 57, none 2.

Speed, 70k, `buildGraph` alone (Node, 7 runs alternating with the T10 version on the same answer, after a warm-up): **800 ms (723-903) against 837 ms (785-975)**, so no slower (the T10 code had its own passes). Chromium, the built worker, 3 runs: royal92 ready in 397 ms (382-398); 70k in 11,889 ms (11,644-12,378), graph stage 1,246 ms (1,215 before); no main-thread task over 50 ms in any run.

Final check, round 3: `npm run check` under a lease, exit 0: Go ok (`check`, `wasm`), vitest 347 passed in 16 files, the build ok, Playwright 198 passed and the same 2 phone-only tests skipped, including both privacy tests and the enrich test on desktop and phone; `npx tsc --noEmit -p .` exit 0.

## Round 4: the life-events timeline (T40, amends T25)

### 15. Tables back, and the timeline

- `enrich` brings back **IndividualEvents and FamilyEvents** (Spouses stays out) and adds **Attributes** (OCCU, EDUC, FACT and the rest) and **Residences** (RESI): the enricher keeps occupation and residence out of Events, and the timeline shows them. Both carry their owner, so their link tables aren't needed. All four in the compact form; the every-sample test checks they read back exactly.
- `web/src/tree/timeline.ts`: `timelineSource(enriched, tree)` indexes the tables once; `timelineFor(id, source, { hideLiving })` gives one person's `TimelineEvent[]`: type (the tag), label (the enricher's `event_label`; for attributes and residence, the same catalogue, mirrored from `enricher/event_label.go`), date as written, year (for sorting), place as written, value (an occupation, an address, `Y`), `context`, and for family events and context the `relation`, `personId` and `familyId`. Own events, attributes and residences; each family's events with the partner; then context: children's births, partners' and parents' deaths, each relative once. Ordered by year, month, day; on a tie, own (in the record's order: the enricher shares one sort order across a person's events, attributes and residences), then family, then context; undated last in the same order. Under Hide living people: nothing for a living person, and no context about a living relative (a dead person's own family events still name a living partner's id; the page shows that person as Living).
- Why a source and not `timelineFor(id, tables)`: scanning 192,000 events for every click at 70k would cost more than indexing once. The worker builds the source **after posting the tree** (not in "ready") and keeps the last file's; `{type: 'timeline', id, hideLiving, request}` gets `{type: 'timeline', request, id, events}` (or `error: 'no file has been read'`). The tables never go to the page.
- Tests (`timeline.test.ts`, `check/testdata/tree/timeline.ged`): a long life (birth, christening, residence with an address, occupation twice, an EVEN with a TYPE, death, burial, an undated EDUC; a parent's dated and undated deaths), two partners (marriage, divorce, a family residence, children in each, the first partner's death; the partner's own view), undated events last in file order, a living person (nothing under Hide living people; their events otherwise), a dead grandparent whose living grandchild's birth is left out under Hide living people, nobody and a placeholder. Worker: an answer after a read, none before. Mutation checks: no living-relative filter (1 fails), undated sorted as year 0 (3 fail).

### 16. Measurements, round 4 (2026-10-30 20:55-20:58 UTC, load 0.4-1.5)

| | royal92 before → after | 70k before → after |
|---|---:|---:|
| JSON | 1,334,026 → 1,518,240 B (1.27 → 1.45 MiB, +14%) | 41,130,016 → 49,344,507 B (39.2 → 47.1 MiB, +20%) |
| Ready, Chromium, 5 runs | 397 (382-398) → 386 (364-402) ms | 11,889 (11,644-12,378) → 11,859 (11,282-12,104) ms |
| Ready, Node, 5 runs | 304 → 294 ms | 12,092 → 12,112 ms |
| Longest main-thread task | none over 50 ms | none over 50 ms |
| Timeline index, after ready (Node) | 5-12 ms | 264-452 ms |
| 1,000 timelines (Node) | 5-16 ms | 32-43 ms |
| Go heap, one read | 32 → 56 MiB | 1,008 → 1,020 MiB |
| Renderer peak, Chromium | 189 → 211 MiB | 1,648 → 1,718 MiB |

Budgets (T24): royal92 under 2 s, met; 70k about 13 s with a progress bar and no freeze, met. The time didn't move measurably: the finish stage grew about 0.1 s (1,520 → 1,628 ms), within the run-to-run spread. New tables at 70k: IndividualEvents 5.4 MB, Attributes 1.8 MB, Residences 0.6 MB, FamilyEvents 0.35 MB. The renderer keeps the timeline index (+70 MiB at 70k).

**The phone threshold (T33, 3 MiB) under T40:** pres2020 214 MiB (was 210), people5000 (1.98 MiB) 282 (267), people10000 (4.04 MiB) 545 (511), indented2 (5.25 MiB) 766 (738). Linked files put a 3 MiB file near 410 MiB; royal92's rate, now about 162 MiB per MiB of file, puts a 3 MiB file of its density near 620 MiB, over the assumed 512 MiB. Left at 3 MiB (decided); flagged for momolig: 2 MiB would keep every measured rate under 512 MiB.

`ENRICH_STAGES` unchanged: the 70k split is now 24/51/14/10, within a point or two of the table.

Final check, round 4: `npm run check` under a lease, exit 0: Go ok (`check`, `wasm`), vitest 356 passed in 17 files, the build ok, Playwright 198 passed and the same 2 phone-only tests skipped, including both privacy tests and the enrich test on desktop and phone; `npx tsc --noEmit -p .` exit 0.

## Library issues that matter to the viewer

All tested as they are now; none fixed (library read only).

- **PEDI is compared in lower case only** (enricher.go): GEDCOM 7 `ADOPTED` gets `relationship_type: "biological"` with `pedigree: "ADOPTED"`. The chart is still right because the conversion reads only the pedigree, lower-cased; the details show the enricher's values. GEDCOM 7 `OTHER` becomes `pedi: "other"`, outside the four values.
- **No duplicate-xref check.** Handled as above. The enricher is not consistent itself: its PEDI lookup takes the first record with an xref, its family surnames the last. Events of every record with that xref share one owner, so a DEAT on a second record makes the first count as dead.
- **Name parts are shared by lower case**, so `JOHN /SMITH/` shows as "John Smith" when "John /Smith/" came first. The NAME as written (what the validator shows) is in the details.
- **`@@` is not unescaped**: "Bob @@work".
- **A second HEAD replaces the first, and SUBN is dropped**: no effect on the conversion, but the home-person suggestion (spec Part 4 item 2) needs HEAD's `_HOME`/`_ROOT`/submitter, which no enricher table carries.
- **The enricher is the slowest part in wasm**: 6.3 of the 12.8 s at 70,000 people.

## Decided 2026-10-30 (momolig), done in round 2 below

The five questions of round 1 became T24 (compact JSON, new budgets, phone warning), T25 (drop three tables), T10 (the living rule) and T26 (home pointers); point 5 was the engine's request, done. The engine also asked for `famcOrder` (its `GraphInput`).

## Round 2: T24, T25, T26, T10, famcOrder

### 7. Compact JSON, three tables out, home pointers (T24, T25, T26)

- `check/compact.go`: `Table[T]` writes a table as `{"columns": […], "rows": [[…], …]}`, the values encoding/json would write, in the columns' order, `null` where it would leave a field out; a column empty in every row (`id`) is left out. `web/src/tree/tables.ts` reads each row back into the same record (a null is a field left out), so the conversion didn't change. `TestEnrichEverySample` checks every table of all 71 files reads back exactly as encoding/json writes it; `TestCompactTable` covers odd strings, invalid UTF-8, lists, pointers, omitted fields.
- The encoder body isn't generic: generic, it added 122 KB to the wasm; as one function, 57 KB.
- `Enriched.JSON()` writes the whole answer in one pass (a test reads it back as json.Marshal's on every sample): json.Marshal re-reads every table a MarshalJSON gives it. Natively 206-309 ms against 423-680 ms at 70k.
- T25: IndividualEvents, FamilyEvents and Spouses are gone.
- T26: `home: {home, root, submitter}`: HEAD's own `_HOME` and `_ROOT` (pointer values only), and the first pointer to an INDI on the submitter record HEAD's SUBM names, whatever its tag (a SUBM may also point to OBJE). Nothing in the library or its samples knew these tags; none of the samples has one. Tests: none, each tag, spaces, a value that isn't a pointer, a pointer to nobody (kept: the page decides), a submitter with no INDI, a SUBM that isn't the header's, `_HOME` under SOUR (not read).

### 8. The living rule (T10)

`graph.ts`: dead with a DEAT, BURI or CREM event (a death year that can't be read is still a death). Otherwise the birth year (the enricher's, from BIRT), or when it's missing, first of: (1) the earliest dated event of the person or of a family they are a partner in, (2) the earliest child's birth − 15, (3) the later parent's birth + 15. Births only, never another estimate. Dead when that year is over 100 years ago (1925 in 2026; 1926 is living). No dates anywhere: living.

`check/testdata/tree/living.ged` (38 people) covers each source at its edge (1926/1925), the order of the sources, the earliest event and child, the later parent, a parent with only a death, and the old cases: christened 2010 and married 2015 now count as living.

**royal92: 891 of 3,010 living** (1,131 before). Recounted independently in Python from the enrich JSON: 891, of them 318 by their birth year, 21 by their own earliest event, 19 by their children, 23 by their parents, and **510 with no dates anywhere** (813 people had no dates of their own under the old rule). 261 people turned dead and 21 living; nothing else in the golden changed.

### 9. The starting person (T26)

`web/src/tree/start.ts`: `suggestStart(graph, home)`: `_HOME`, then `_ROOT`, then the submitter's INDI, the first that names a person in the file; otherwise the person with the most relatives within 3 generations, read as **at most 3 steps, a step to a parent, a child or a partner**, each relative once, placeholders neither counted nor walked through, the first in file order on a tie. One walk per person, O(people × relatives). The worker runs it and sends `start` with the tree. royal92: Victoria (`@I1@`, 200 relatives). 70k: 190-290 ms.

### 10. famcOrder (engine's GraphInput, T20)

The enricher's tables keep each family's CHIL order, not a person's FAMC order, so `enrich` returns `famc`: each INDI record's FAMC pointers as written, in order, aligned with `tables.Individuals` like `lines`. The converter fills `graph.famcOrder` for every person whose list names a family in the file: those families only, once each, the first record's list for a shared xref. `check/testdata/tree/famc.ged`: an adopted child whose adoptive FAMC is first (`[F1, F2]`; the engine then takes F2, the first birth family), two birth families (`[F3, F2]`, not the FAM records' order), a FAMC to a missing family (left out; a person whose only FAMC is missing has no entry), a family listed twice, a child by CHIL only (no entry). royal92: 2,018 entries (counted independently from the .ged), added to the golden; nothing else in it changed.

### 11. No freeze, a bounded heap, the phone threshold

- **The tree comes in parts** (`web/src/tree/parts.ts`): `tree-part` messages of at most 5,000 records (people, unions, person details, family details, famcOrder), then `enriched` with the rest and the part count; `treeAssembler()` joins them and refuses a missing part. One message holding the 70k tree cost the page **one 358 ms main-thread task**; parts of 10,000 left one of 64 ms; parts of 5,000 leave none over 50 ms.
- **The Go heap.** It never shrinks in wasm. Reading the same 70k file six times in one instance ran out of wasm memory (`cannot allocate 12582912-byte block (4231823360 in use)`): each read in an instance roughly doubled the heap. `enrichFn` now collects first and runs under a 1 GiB soft memory limit (`debug.SetMemoryLimit`), put back after the call, so check, repair, plan and save never run under it (a wasm test checks both). Three reads of 70k, before → after: 976-1,952 MiB → 932-1,040 MiB, no slower; 125,153 people: 1,940 → 1,512 MiB, 15% slower. **The viewer should still start a fresh worker for each file**, as the validator does ("a fresh runtime for the next file").
- **Phone warning** (`web/src/tree/size.ts`): `isVeryLargeForPhones(bytes)`, true from **3 MiB** (`PHONE_LARGE_BYTES`). How it was chosen: the renderer's peak memory (the table below) is 133 MiB with nothing read, at most 267 MiB under 2 MiB, 511 MiB at 4.04 MiB; the worst rate, royal92's and the dense indented2's, is about 117 MiB per MiB of file. Assumed phone budget: about 512 MiB for the tab (a tab much above that risks being killed, or failing to grow its wasm memory, on phones with 3-4 GB). At the worst rate a 3 MiB file needs about 484 MiB. **Not tested on a phone.**

### 12. Measurements, round 2 (2026-10-30 19:49-19:54 UTC, load 2-4)

Same commands as step 5, plus `node --expose-gc scripts/enrich-times.mjs --runs 0 FILE` (one read per process, for its own Go heap) and `node scripts/enrich-browser.mjs --memory FILES` (fresh browser per file; renderer VmHWM). Chromium now runs on a blank page of the same origin with the site's CSP, and also gives the page's longest main-thread task (Long Tasks API: tasks over 50 ms).

| File | JSON (was) | Ready, Node, 5 runs | Ready, Chromium, 5 runs | Longest main-thread task | Budget |
|---|---:|---:|---:|---:|---|
| royal92.ged | 1,334,026 B, 1.27 MiB (3.47) | 304 ms (297-343) | 446 ms (383-462) | none over 50 ms | < 2 s: **met** |
| pres2020.ged | 1,170,681 B, 1.12 MiB (3.03) | 288 ms (283-303) | 442 ms (406-464) | none over 50 ms | – |
| people70000.ged | 41,130,016 B, 39.22 MiB (114.57) | 12,092 ms (11,897-15,351) | 11,932 ms (11,653-12,219) | none over 50 ms (was 358 ms) | about 13 s, progress bar, no freeze: **met** |

70k in Chromium: parse 3.0 s, enrich 6.4 s, finish 1.4 s (was 2.1), graph 1.2 s; 4 stage messages and 49 parts reach the page during the read. Node: inside `enrich()` parse 2.8, enrich 6.3, finish 0.88 s (was 1.8); JSON.parse 0.52 s, tables read back 0.16 s, graph 1.0 s, start 0.29 s. 70k JSON by table: Events 10.1 MB, Individuals 8.9, Dates 8.7, ParentChild 6.1, NameForms 1.9, FamilyChildren 1.4, the name links 1.9, Families 0.8, the rest under 0.1. Six 70k reads in one instance now end at 1,954 MiB (they ran out of memory before the fix).

Memory, one read each:

| File | Size | People | Go heap, Node | Renderer peak, Chromium | Ready, Chromium |
|---|---:|---:|---:|---:|---:|
| nothing read | – | – | – | 133 MiB | – |
| royal92.ged | 0.48 MiB | 3,010 | 32 MiB | 189 MiB | 0.47 s |
| pres2020.ged | 1.05 MiB | 2,322 | 44 MiB | 210 MiB | 0.49 s |
| people5000.ged | 1.98 MiB | 5,000 | 80 MiB | 267 MiB | 1.1 s |
| people10000.ged | 4.04 MiB | 10,002 | 280 MiB | 511 MiB | 2.1 s |
| indented2.ged (no families) | 5.25 MiB | 70,000 | 332 MiB | 738 MiB | 4.1 s |
| people20000.ged | 7.98 MiB | 20,003 | 356 MiB | 690 MiB | 3.6 s |
| people35000.ged | 14.12 MiB | 35,004 | 1,005 MiB | 1,450 MiB | 7.1 s |
| synth20.ged | 20.07 MiB | 49,989 | 888 MiB | 1,437 MiB | 10.2 s |
| people70000.ged | 28.27 MiB | 70,002 | 1,008 MiB | 1,648 MiB | 12.7 s |
| synth50.ged | 50.71 MiB | 125,153 | 1,524 MiB | 2,520 MiB | 25.3 s |

The Go heap grows in steps (Go's arenas), so neighbouring files can swap places (people35000 above synth20). Sizes: the wasm is 5,407,706 bytes (gzip -9 1,465,880), against 5,309,982 (1,445,424) before this branch; the worker bundle 12.88 kB (2.9 kB before the branch).

## Commits

| Commit | What |
|---|---|
| 2b0bc23 | bench/gen: `-people N` |
| d26773c | check, wasm: `enrich(bytes)`, Go tests, tree fixtures |
| 62d10b4 | tree: the conversion, its tests, royal92 golden |
| 1a543db | worker: the enrich message (`tree/job.ts`) |
| aa75c17 | measurement scripts, `ENRICH_STAGES`, e2e test |
| 8768742 | this ledger's measurements, findings and open questions |
| 4258a2a | `pedi` = the PEDI in lower case, as the engine asked |
| 107207d | ledger |
| 010a058 | compact tables (T24), three tables out (T25), home pointers (T26) |
| 22b4a12 | the living rule (T10) |
| d7ebaf1 | the starting person (T26) |
| 633eef0 | the compact encoder out of the generic method (−65 KB wasm) |
| fdaeab2 | `Enriched.JSON()`, one pass |
| 1bf08f1 | the tree in parts; measurement scripts: single read, longest task, renderer memory |
| 62939be | famcOrder; the Go heap collected and limited during enrich; the phone threshold |
| c3c62f7 | progress weights and threshold numbers from the final run |
| 75af2a9 | this ledger, round 2 |
| 8a5935c | T32: the living rule across the family; this ledger, round 3 |
| 1d156f7 | T40: IndividualEvents, FamilyEvents, Attributes, Residences; timelineFor; the worker's timeline message |
| bdaf86e | this ledger, round 4; the timing script times the timeline |
