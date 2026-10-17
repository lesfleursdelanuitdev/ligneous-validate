# tree-viewer.ligneous.org: spec

Status: PROPOSED 2026-10-17, for momolig's review. Branch `tree-viewer` in `ligneous-validate`.

## Goal

A free public page at https://tree-viewer.ligneous.org/ where anyone can open a GEDCOM file and **see their family tree**. It offers descendancy, pedigree, vertical pedigree and fan charts. Visitors can search, start from any person, and export a picture or PDF.

Like validate.ligneous.org, **the file never leaves the visitor's computer**: it is read in the browser by our Go library compiled to WebAssembly.

The same work fixes and shares the chart code the Gonsalves family site uses today. Both sites then draw trees with one engine and one renderer.

**Success means:**
1. Any GEDCOM file that validate.ligneous.org can read opens as a tree. The page doesn't freeze on 10,000+ people.
2. All four charts work on desktop and phone, by mouse, touch or keyboard.
3. No request leaves the page. This is enforced by the CSP, like the validator, and proved by an e2e test.
4. The Gonsalves site keeps working, with the bug fixes below, on the shared engine and renderer.
5. The validator and the viewer hand a file to each other in the browser, with nothing uploaded.

## Decisions

| # | Decision | Who |
|---|---|---|
| T1 | Fix the shared `@ligneous/visualization-engine` (the refactor plan and the bug list), then move the Gonsalves site onto it. | momolig, 2026-10-17 |
| T2 | Extract a shared renderer, `@ligneous/visualization-react`, from the Gonsalves app's tree viewer. Gonsalves and the new viewer both use it. This brings forward the tree-viewer part of step 7 of the Gonsalves extraction plan. | momolig |
| T3 | Living people: show everyone on screen. A **Hide living people** switch is off on screen and **on by default when exporting**. | momolig |
| T4 | v1 includes all four charts, search and choosing the starting person, PNG/SVG/PDF export, and the link with the validator. | momolig |
| T5 | *Proposed.* The viewer is a second app in the **`ligneous-validate` repo**, deployed to its own site folder `tree-viewer`. It shares the wasm, the worker, file loading, the progress bar and the Layout C styles. The repo may be renamed `ligneous-tools` later, but not now. | proposed |
| T6 | *Proposed.* The engine and the renderer get a build step (JS + `.d.ts`) and semver tags. The viewer installs them from GitHub tags (`github:lesfleursdelanuitdev/…#vX.Y.Z`). Gonsalves keeps its `file:` links, as decided in extraction plan EX-Q4. | proposed |
| T7 | *Proposed.* The GEDCOM → chart graph conversion lives in the **Go library**, in a new `chart` package, so it is the same everywhere and tested in Go. The wasm returns a compact graph JSON. It never returns the whole EnrichedDocument. | proposed |
| T8 | *Proposed.* PDF export uses the browser's print to PDF, with a print stylesheet: no new dependency. PNG export rasterises the pure-SVG chart on a canvas. | proposed |
| T9 | *Proposed.* The two sites hand a file to each other through `window.open` plus `postMessage`, with origins checked on both sides (see Part 4). | proposed |

## What exists today (from the 2026-10-17 audit)

Full reports are in the session scratchpad, `viz-audit/completeness.md` and `viz-bugs/bugs.md` (18 bugs reproduced with tests). They are summarised here.

- **The engine** is about 7,600 lines of TypeScript. It lays out four charts (descendancy, pedigree left to right, vertical pedigree, fan) and has a reducer with history, pan/zoom hooks, and depth and search helpers. **It draws nothing.**
- **The renderer** is about 21,400 lines of SVG and `<foreignObject>`, in `the-gonsalves-family/src/components/{TreeViewer,DescendancyChart}`. It depends on `next/link`, sign-in, app libraries and the `/api` drawers.
- **`REFACTOR_PLAN.md`:** phases 0–6 are not started. Phase 7 (tests) is partly done: 74 tests live in the app, and none in the package.
- **Coupling that blocks a standalone viewer:**
  - the hard-coded `/api/tree/*` routes;
  - a private wire format;
  - the global `currentBuilder`;
  - about 900 lines of server logic the engine relies on (sibling view, parent-family choice, pedigree rules, redaction);
  - an unguarded `process.env`;
  - a default root that is a Gonsalves person, `@I0082@`.
- **High-severity bugs:**
  - one global builder is shared by every chart (a modal can corrupt the profile chart);
  - no stale-fetch guard (a quick A→B root switch can show A's chart);
  - the descendancy build is O(N²) (10,000 people take 8–9 s for each "toggle all partners");
  - every unknown father becomes one shared "Unknown" person.

## Part 1: the engine (`@ligneous/visualization-engine` v0.1.0)

This follows `REFACTOR_PLAN.md` phases 0–5 and 7, plus the bug list.

1. **Tooling.**
   - Add `typescript`, `vitest` and `@types/node` as dev dependencies.
   - Add `tsc --noEmit`, a test script and a build to `dist/` (ESM plus `.d.ts`).
   - Move the app's 74 engine tests into the package, along with the 21 bug-repro tests from the audit, rewritten as **failing tests that the fixes turn green**.
2. **`GraphSnapshot` input** (plan phase 1).
   - Define one exported type: `{ people, unions, … }`, with the derived indexes built in one place.
   - `buildTree`, the strategies and the reducers read only from the snapshot passed in.
   - `testdata` is used only in tests and demos (plan phase 2).
3. **No global builder** (plan phase 3). Remove `currentBuilder`. Each chart session owns its snapshot, built through `createChartSession({ graph, viewState, options })`. Of the 92 unused exports, delete what is dead and keep the API the plan agreed.
4. **Fetching is not the engine's job** (plan phase 4).
   - `useChartViewFetch` takes a `fetchGraph(request) → Promise<GraphSnapshot input>` function instead of hard-coded routes.
   - Its abort and stale-response guard keeps only the newest request and ignores the rest (fixes the high-severity bug).
   - Export the parsers for the Gonsalves wire format (`ApiPerson`/`ApiUnion`), so the app keeps its routes.
   - Guard `process.env`.
   - Remove the default root.
5. **Bug fixes.** Each one starts as a failing test.
   - The O(N²) descendancy build: build the union index once.
   - Unknown spouses: a placeholder **per family** (`<familyId>:unknown-husb` / `…-wife`), never one shared `""`.
   - Wheel and pinch zoom keep the point under the pointer (`baseX`/`baseY`). Wheel listeners are non-passive, attached with `addEventListener(…, { passive: false })`.
   - "Show children" at max depth no longer re-roots; `expandDownTopRow` is either used or removed.
   - Two FAM records for the same couple keep both families' children.
   - "+N" descendant counts are path-independent and don't double-count under pedigree collapse.
   - `personWidth` is honoured by node spacing and bounds, and `personHeight` by pedigree connectors.
   - A response faster than the timer no longer gets stuck loading.
   - Bounds changes don't reset the zoom.
   - `applyCloseSpouse` closes only the chosen partner.
   - Depth is clamped, and revealed rows respect the cap.
   - Fan-chart bounds are right.
   - Initials split by grapheme, not by UTF-16 code unit.
   - The pedigree honours `pedigreeFamcFamilyXref`/overrides, so a chosen parent family takes effect on the client too.
   - A missing `isLiving` is treated as **living**.
   - No `console.log` in production.
   - The audit's suspected bugs each get a test. Fix what reproduces: root change keeping the old scope, `panToPersonId` never cleared, fit-to-screen ignoring the centre, and sibling order.
6. **Unfinished features.**
   - The 8 card actions marked "TBD" are either implemented or removed from the menu, case by case. The implementer lists the decision for each.
   - Search gets paging and years.
7. **Release** as `v0.1.0`: tag it, note the breaking changes, and add a CHANGELOG.

## Part 2: the library (`ligneous-gedcom-lib` v0.4.0, package `chart`)

```go
// chart.Build turns a parsed/enriched document into the engine's graph input.
func Build(doc *gedcom.GedcomDocument, ed *enricher.EnrichedDocument, opt Options) *Graph
type Graph struct {
  People []Person `json:"people"`
  Unions []Union  `json:"unions"`
  Home   string   `json:"home,omitempty"` // suggested starting person (see Part 4)
}
type Person struct {
  ID, Given, Surname, Full, Sex string     // Full has the GEDCOM slashes removed; Sex is "M","F","U","X"
  Birth, Death Event                       // Year int, Text (as written, e.g. "ABT 1850"), Place
  Dead     bool                            // any DEAT/BURI/CREM, dated or not
  Living   bool                            // see the living rule
  Line     int                             // the INDI's line in the file, for "Open in the editor"
}
type Union struct {
  ID, Husb, Wife string                    // a missing partner gets "<ID>:unknown-husb" / "-wife"
  Children []Child                         // {ID, Pedi: "birth"|"adopted"|"foster"|"sealing"|""}
  Marriage Event
}
```

- **The living rule:** no DEAT, BURI or CREM event, and either born within the last 100 years or no dates at all. If a death year can't be read, the person counts as dead.
- **Names:**
  - The given name and surname come from the NAME's `/surname/` part, or from GIVN/SURN if they are present.
  - A person with no name gets `""`; the renderer shows "Unnamed".
- **Child type (pedi)** collapses to one value per family and child, from the FAMC.PEDI of that family.
- **JSON tags** use camelCase.
- **Size:** the graph for 70,000 people must stay under about 10 MB of JSON.
- **Tests:**
  - every sample and fixture;
  - cousin marriage, a person who is their own ancestor, adoption, no partner;
  - the living rule at its edges;
  - a golden graph for royal92.
- Release as `v0.4.0`.

## Part 3: the renderer (`@ligneous/visualization-react` v0.1.0)

- **Where it lives:** a new package `packages/visualization-react` in the Gonsalves umbrella, with its own public GitHub repo, like the engine.
- **Extraction.** It is extracted from `the-gonsalves-family/src/components/{TreeViewer,DescendancyChart}`.
  - **Pure drawing goes into the package:** charts, cards, connectors, controls, pan/zoom surface, fan geometry.
  - **App concerns become props or slots:**
    - `renderLink(person)`: the app passes `next/link`, and the viewer passes a button;
    - `onOpenPerson(id)` and `onCardAction(action, id)`;
    - `detailsPanel` as a slot;
    - `privacy: "show" | "hide-living"`;
    - theme tokens as CSS variables, so Gonsalves keeps its look and the viewer uses Layout C.
  - **Auth, API drawers and Next-only code stay in the app.**
- **Pure-SVG cards.** Cards render as pure SVG (text and shapes, no `<foreignObject>`), at least in export mode, so PNG export is reliable. If on-screen cards keep `foreignObject` for rich layout, export switches to the SVG variant.
- **Large trees.** Cull to the viewport: don't render nodes far outside the visible area, so that 10,000 people stay smooth.
- **Accessibility.**
  - Keyboard: arrows move between people, Enter opens them, +/− zoom, 0 fits to screen.
  - Each card has an accessible name ("Mary Smith, 1850–1921").
  - A tree outline is available as a list for screen readers.
- **Tests.**
  - Component tests: vitest + testing-library.
  - Gonsalves keeps its 45 public test files passing.
  - Playwright screenshots of each chart before and after extraction. Pixel differences are reviewed, not ignored.

**Moving Gonsalves over.** The Gonsalves site moves onto engine v0.1.0 (Part 1), then onto the renderer (Part 3). Each step is its own reviewed branch in a worktree of the umbrella repo, following the extraction plan's rules: both apps' test suites, `next build`, and saved page answers. It deploys with momolig's OK.

## Part 4: the viewer site

The viewer is a second Vite entry in `ligneous-validate` (`web/tree/`), sharing `web/src/{worker,progress,bar,…}`. The wasm gains `graph(bytes) → Graph JSON`, built from library v0.4.0's `chart.Build` through the existing worker.

1. **Opening a file:** the same drop zone, privacy line and progress bar as the validator. Wording:
   - title: `See your family tree`
   - lead: `Open a GEDCOM file to see it as a tree. Nothing is uploaded.`
2. **Choosing the starting person.**
   - The suggestion is the file's home person if HEAD has `_HOME`/`1 _ROOT`/the submitter's own INDI. Otherwise it is the person with the most relatives within 3 generations.
   - A search box sits at the top of every chart, with typeahead on names and years, paged.
   - "Start from this person" is on every card.
3. **Charts.**
   - Tabs: **Descendants**, **Ancestors** (left to right), **Ancestors (vertical)** and **Fan**.
   - Each chart has depth controls, Fit to screen and pan/zoom. The tab, the root and the depth are kept in the URL fragment (`#chart=fan&root=@I12@&depth=4`), so Back and Forward work. Nothing is stored.
4. **Details panel.** Selecting a person opens a side panel (a sheet on phones) with:
   - birth, death and marriage, with places;
   - parents, partners and children as links;
   - **Open in the validator's editor at this person's line**, using the handoff below.
5. **Living people (T3).** A **Hide living people** switch in the toolbar is off on screen. Living people then show as `Living` with no dates, places or details.
6. **Export (T4, T8).** An **Export** menu offers PNG, SVG and PDF. The export dialog has **Hide living people** ticked by default. The files:
   - **SVG:** the chart's pure-SVG variant, fonts embedded or outlined.
   - **PNG:** that SVG drawn on a canvas, at 2× scale.
   - **PDF:** a print stylesheet plus `window.print()`, with the chart scaled to fit and paged for big trees.

   Export file names follow `<file>-<chart>-<root name>.png`.
7. **Handoff with the validator (T9).**
   - **Validate → viewer.** A **See this tree** button on the report calls `window.open('https://tree-viewer.ligneous.org/#from=validate')`. The viewer posts `{type:'ready'}` to `window.opener`, addressed to `https://validate.ligneous.org`. The validator replies `{type:'file', name, bytes}`, transferring the bytes. The viewer accepts the message only if `event.origin` is exactly `https://validate.ligneous.org`. If the editor has unsaved edits, the validator asks whether to send the edited text or the original.
   - **Viewer → validate.** **Check this file** and **Edit this person** open the validator the same way, with `{type:'file', name, bytes, line?}`. The validator opens its editor at `line` when it's given.
   - **Blocked pop-ups:** both sides show `Your browser blocked the new tab. Allow pop-ups for this site, or open the file there yourself.`
   - **The CSP** in both sites stays the same: `postMessage` needs no `connect-src`.
8. **Privacy and CSP.** The viewer uses the validator's CSP, with `img-src 'self' data: blob:` added for export previews. The privacy e2e test covers loading, every chart, search, export and the handoff.
9. **Performance.**
   - The graph is built in the worker.
   - Layout runs in the main thread on the engine's O(N) build.
   - The renderer culls to the viewport.
   - Budgets: royal92 ready in under 2 s, and 70,000 people ready in under 10 s on the server's Chromium.
   - Pan and zoom stay at 60 fps with 10,000 nodes in the tree. If they can't, cap the default depth and say so.
10. **Accessibility and phones.** Layout C, touch pan/pinch (which the engine already handles), the keyboard controls from Part 3, and 44px targets. The details panel becomes a bottom sheet on phones.

## Part 5: deploy

1. **Certificate:** add `tree-viewer.ligneous.org` to ligneous.org's certificate. That's either pammy-setup#5, or once, by hand: `sudo certbot certonly --nginx --cert-name ligneous.org -d ligneous.org -d www.ligneous.org -d validate.ligneous.org -d tree-viewer.ligneous.org`, followed by `certbot reconfigure … --webroot`. Then add `tree-viewer` to the domain's certificate names in the panel.
2. **Panel:** add a static folder `tree-viewer` (with "own host" unticked), and a host `tree-viewer` whose route `/` points at that folder. Run `setfacl` once on the new folder (pammy-setup#2's ACL fix isn't built yet).
3. **Deploy script:** `deploy-ligneous-validate.sh` deploys both apps from one build. Its probes are extended to tree-viewer.
4. **Links:** ligneous.org's landing page links to both tools, and each tool links to the other.

## Order of work

Each step is its own branch and review. Nothing is merged, pushed, tagged or deployed without momolig's OK. Gonsalves deploys are called out separately, because the site is live.

1. Engine v0.1.0 (Part 1).
2. Gonsalves on engine v0.1.0: deploy, so the live site gets its bug fixes.
3. Library v0.4.0, `chart` package (Part 2). This can run in parallel with steps 1 and 2.
4. Renderer v0.1.0 (Part 3), then Gonsalves on the renderer, then deploy.
5. The viewer site (Part 4), plus the validator's handoff button.
6. Deploy (Part 5).

## Out of scope for v1

- An hourglass chart (none exists today).
- Editing the tree in the viewer (the editor stays in the validator).
- Photos: GEDCOM media paths are relative, so photos would need a zip upload.
- Saving or sharing trees online.
- Merging files.
- Showing GEDCOM 7-specific structures.

## Open questions for momolig

These are the proposed decisions T5–T9, plus one more:
- **Repo name:** keep `ligneous-validate` for both tools (T5), or create a separate `ligneous-tree-viewer` repo that copies the shared parts?
- **Card actions:** for the 8 "TBD" card actions, decide case by case during Part 1, or decide now which ones Gonsalves actually needs?
