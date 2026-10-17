# GEDCOM editor: spec

Status: PROPOSED 2026-10-17. Branch `editor`.

## Goal

People who find a problem can fix it right there, in the browser, by editing the GEDCOM text, without installing anything and without uploading the file. From any finding, **Edit line N** opens the editor at that line. **Check again** re-runs the checker on the edited text. **Download edited file** saves the result.

## Decisions (momolig, 2026-10-17)

| # | Decision |
|---|---|
| E1 | Use **CodeMirror 6**. It is the page's first runtime dependency. It is bundled with the site, and loaded only the first time the editor opens. |
| E2 | Save **always as UTF-8**. The header's CHAR is set to `UTF-8` (inserted if it is missing), and the page says so before saving. |
| E3 | **No drafts.** Nothing is stored in the browser. The browser asks before closing or reloading a tab with unsaved edits. |
| E4 | The editor opens **full screen over the page**. Closing it returns to the report, at the finding it was opened from. |

## What the editor shows

- **The text.** The editor shows the whole file as the checker decoded it (`result.text`, UTF-8). Line numbers are the file's own, so they match the report.
- **Syntax highlighting** comes from a small GEDCOM tokeniser (`StreamLanguage`). It distinguishes these parts:
  - leading whitespace, which is marked as a problem;
  - the level number;
  - an `@xref@` id that defines a record (on level-0 lines);
  - the tag, in three kinds: standard GEDCOM 5.5.1/7 tags, custom `_TAGS`, and unknown tags;
  - pointer values (`@I12@`);
  - the value text;
  - `CONC`/`CONT` lines, shown slightly dimmed so their text reads as a continuation;
  - a line that doesn't parse (no level), marked invalid.
- **Colours** come from the Layout C tokens, with light and dark themes, and every colour meets AA contrast as text on the editor's background.
- **Findings appear as lint markers** in the gutter, coloured by severity, with the same icons as the cards.
  - Hovering a marker, or tapping it on phones, shows the finding's title and meaning, filled in exactly as on the report.
  - Markers move with edits. As soon as the text changes, they are marked "may be out of date" until **Check again** runs.
- **Pointers are links.** Ctrl- or Cmd-click on `@I12@`, or the **Go to record** item in the marker tooltip, jumps to `0 @I12@ …`. If no such record exists, it says so.
- **Standard editor features:** search and replace (CodeMirror's search panel), undo and redo, line wrapping (off by default, with a toggle), and a status line that shows the line and column.

## Toolbar

The toolbar is one row that wraps on phones. It holds:

- the file name, plus `· edited` when there are unsaved edits;
- **Previous problem** and **Next problem**, with `3 of 67`;
- **Check again**;
- **Download edited file**;
- **Close**.

The existing progress bar shows inside the toolbar while **Check again** runs.

## Entry points

- **Edit line N.** Every finding card gets a button labelled `Edit line 1,204`. It is also shown under the line viewer when the card is open. It opens the editor with that line scrolled into the middle, the cursor at the start of the value, and the line briefly highlighted.
- **Open the editor.** The results toolbar gets an **Open the editor** button that opens at line 1.
- **Whole-file findings** (line 0) have no Edit button.

## Check again

1. Encode the editor's text as UTF-8.
2. Run it through the same worker pipeline (`check` with progress).
3. Replace the report and the markers.
4. Keep the editor open, with the cursor where it was.

Check again checks what Download edited file would give: the text first goes through `SaveUTF8`, so its CHAR is set as the download sets it, and the report matches the downloaded file (decided 2026-10-17). The report from Check again shows the editor's line numbers, mapped the same way as the markers, so report and editor agree; a finding on a CHAR line that only the download has shows as "Whole file".

Findings that disappeared are simply gone. The counts in the toolbar update.

## Download edited file

1. Encode the text as UTF-8.
2. Run it through `RepairWithOptions` with only `encoding` selected (library v0.3.0). That sets or inserts `1 CHAR UTF-8` exactly as the repair does. Nothing else changes.
3. Save as `<name>-edited.ged` with `application/octet-stream`.
4. Before the first save, show this one line once: `Your edited file is saved as UTF-8, and its header says so. Line endings are made consistent.`

The text is saved exactly as edited, except that the file is UTF-8 without a byte order mark, and uses one line-ending style throughout: the file's first one (decided 2026-10-17).

## Leaving

- Close with unsaved edits: ask `Close the editor? Your edits stay here until you download them or check another file.` (Closing does not throw edits away. Reopening shows them again.)
- Choosing another file with unsaved edits: ask `Check another file? Your edits to {name} will be lost.`
- Closing or reloading the tab with unsaved edits: the browser's standard prompt (`beforeunload`).

## Privacy and CSP

- No network requests other than the site's own hashed editor chunk.
- No storage of any kind.
- The privacy e2e test includes opening the editor, editing, checking again and downloading.
- **CSP.** CodeMirror injects its styles with constructable stylesheets (`adoptedStyleSheets`), which `style-src 'self'` doesn't block. Verify this in Chromium. If any `<style>` element injection remains, stop and report it rather than loosening the CSP.
- **Browser CSP reports.** In Chromium, typing over a selection of several lines makes the browser's own contenteditable set a style attribute, which `style-src` blocks: one `style-src-attr` report with no source file. It comes from the browser, not CodeMirror, and changes nothing; the CSP e2e test ignores exactly that kind (empty source file, `style-src-attr`) and no other.
- **Browsers without adopted style sheets** (Safari before 16.4, Firefox before 101) can't run the editor under this CSP: they get no editor buttons and the line `This browser can't run the editor. Try a current version of Firefox, Chrome, Safari or Edge.`

## Performance

- The editor chunk is loaded on first open, under 200 KB gzipped.
- A 20 MB file opens and scrolls smoothly on the server's Chromium. The budget is under 3 s to first paint of the editor. The lint markers for up to 5,000 findings render without blocking.

## Accessibility

- The editor is `role="dialog"` with `aria-modal="true"` and named after the file. Focus is trapped inside it and goes back to the button that opened it.
- Esc closes the editor, with the unsaved-edits prompt where it applies. While the search panel is open, Esc closes the panel first.
- The editor's content has an `aria-label` such as `GEDCOM text of royal92.ged`.
- Next and Previous problem announce the finding's title through the live region.
- All toolbar buttons are reachable by keyboard, and are at least 44px tall on touch screens.

## Tests

- **Unit tests:**
  - the tokeniser, for each token kind, including malformed lines, a lone `@` and tabs;
  - the mapping from findings to markers;
  - the pointer-target lookup.
- **e2e tests, desktop and phone:**
  - **Edit line** opens the editor at the right line, which is visible and highlighted;
  - the highlighting classes are present for the level, tag, xref, pointer and custom tag;
  - a gutter marker shows its tooltip;
  - Next and Previous problem move between findings;
  - after an edit that fixes a finding, **Check again** removes that finding from both the report and the markers;
  - Ctrl-click on a pointer jumps to its record;
  - the downloaded file is UTF-8 and has `CHAR UTF-8`, on an ANSEL input;
  - the unsaved-edits prompts appear;
  - privacy holds, with the editor included;
  - Esc closes the editor and focus returns to the opener.
- Run the full `npm run check`.

## Out of scope

Structured editing (forms for people and families), collaborative editing, saving to the cloud, and GEDCOM 7-specific features.
