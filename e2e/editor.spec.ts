// The GEDCOM editor (docs/editor-spec.md): Edit line N, highlighting, lint
// markers, Next / Previous, Check again, pointers, Download edited file, the
// unsaved-edits prompts, Esc and focus, CSP, lazy loading and big files.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);
const upload = (page: Page, name: string) => page.locator('#file').setInputFiles(fixture(name));
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

const HEAD = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n';
const EDITOR_LINES = readFileSync(fixture('editor.ged'), 'utf8').split('\n');

const cleanup: string[] = [];
test.afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });
function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-e2e-'));
  cleanup.push(dir);
  return join(dir, name);
}

const dialog = (page: Page) => page.getByRole('dialog');
const live = (page: Page) => page.locator('#ed-live');
const pos = (page: Page) => page.locator('#ed-pos');

/** Checks `name` and waits for the report. */
async function report(page: Page, name: string) {
  await upload(page, name);
  await expect(page.locator('#status')).toHaveText(/^Checked: /);
}

/** Clicks the card's "Edit line N" button and waits for the editor. */
async function editLine(page: Page, line: number) {
  await page.getByRole('button', { name: `Edit line ${fmt(line)}`, exact: true }).first().click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('e2e editor: Edit line opens the editor at that line, visible and highlighted', async ({ page }) => {
  await report(page, 'editor.ged');
  // Every finding with a line has the button; it is named after the line.
  await expect(page.getByRole('button', { name: 'Edit line 12', exact: true })).toBeVisible();
  await editLine(page, 12);
  await expect(dialog(page)).toHaveAccessibleName('editor.ged');
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('.cm-content')).toHaveAttribute('aria-label', 'GEDCOM text of editor.ged');
  // The line is on screen, highlighted, with the cursor at the start of its value.
  const flash = page.locator('.cm-line.gx-flash');
  await expect(flash).toHaveCount(1);
  await expect(flash).toHaveText(EDITOR_LINES[11]);
  await expect(flash).toBeInViewport();
  await expect(page.locator('.cm-activeLine')).toHaveText(EDITOR_LINES[11]);
  await expect(page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^12$/ })).toBeInViewport();
  await expect(pos(page)).toHaveText('Line 12, column 9'); // "  1 SEX F": the value F
  // The flash fades on its own.
  await expect(flash).toHaveCount(0, { timeout: 4000 });
  // One button per card (whole-file findings have none: render.test.ts).
  await page.keyboard.press('Escape');
  await expect(page.locator('.findings > li .edit-line')).toHaveCount(await page.locator('.finding').count());
});

test('e2e editor: an open card shows the button under its line viewer', async ({ page }) => {
  await report(page, 'editor.ged');
  const card = page.locator('.findings > li', { hasText: 'A line starts with spaces' });
  await card.locator('summary').click();
  await expect(card.locator('.lines')).toBeVisible();
  const button = card.getByRole('button', { name: 'Edit line 12', exact: true });
  await expect(button).toBeVisible();
  // One button per card, below the lines (and the fix), inside the card.
  await expect(page.getByRole('button', { name: 'Edit line 12', exact: true })).toHaveCount(1);
  // Measured once the card has finished opening.
  await expect.poll(async () => {
    const lines = (await card.locator('.lines').boundingBox())!;
    const b = (await button.boundingBox())!;
    const li = (await card.boundingBox())!;
    return b.y > lines.y + lines.height && b.y + b.height <= li.y + li.height;
  }).toBe(true);
  await button.click();
  await expect(page.locator('.cm-line.gx-flash')).toHaveText(EDITOR_LINES[11]);
});

test('e2e editor: Open the editor opens at line 1', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(pos(page)).toHaveText('Line 1, column 1');
  await expect(page.locator('#ed-name')).toHaveText('editor.ged');
  await expect(page.locator('#ed-count')).toHaveText('2 problems');
});

test('e2e editor: highlighting classes for level, tag, xref, pointer and custom tag', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  const c = page.locator('.cm-content');
  await expect(c.locator('.gx-level').first()).toHaveText('0');
  await expect(c.locator('.gx-xref', { hasText: '@I1@' })).toHaveCount(1);
  await expect(c.locator('.gx-tag', { hasText: /^HEAD$/ })).toHaveCount(1);
  await expect(c.locator('.gx-pointer', { hasText: '@F9@' })).toHaveCount(1);
  await expect(c.locator('.gx-custom', { hasText: '_UID' })).toHaveCount(1);
  await expect(c.locator('.gx-space')).toHaveCount(1);
  // The colours differ from plain text.
  const color = (sel: string) => c.locator(sel).first().evaluate(e => getComputedStyle(e).color);
  expect(await color('.gx-tag')).not.toBe(await color('.gx-value'));
  expect(await color('.gx-pointer')).not.toBe(await color('.gx-value'));
});

test('e2e editor: a gutter marker shows its finding, filled in', async ({ page, isMobile }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  const markers = page.locator('.cm-lint-marker');
  await expect(markers).toHaveCount(2);
  await expect(markers.first()).toHaveClass(/cm-lint-marker-warning/);
  await expect(markers.nth(1)).toHaveClass(/cm-lint-marker-error/);
  // Hover on a desktop, tap on a phone.
  if (isMobile) await markers.nth(1).tap(); else await markers.nth(1).hover();
  const tip = page.locator('.cm-tooltip-lint');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Error');
  await expect(tip).toContainText("Ann Lee is a child of a family that doesn't exist");
  await expect(tip).not.toContainText('{');
  await expect(tip.locator('[translate="no"]', { hasText: 'Ann Lee' }).first()).toBeAttached();
  // Go to record: there is no family @F9@, and it says so.
  await tip.getByRole('button', { name: /Go to record/ }).click();
  await expect(live(page)).toHaveText("There's no record @F9@ in this file.");
});

test('e2e editor: Next and Previous problem move between findings and announce them', async ({ page }) => {
  await report(page, 'royal92.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('#ed-count')).toHaveText('67 problems');
  await page.getByRole('button', { name: 'Next problem' }).click();
  await expect(page.locator('#ed-count')).toHaveText('1 of 67');
  await expect(pos(page)).toHaveText(/^Line 6, /);
  await expect(live(page)).toHaveText('Line 6: This file uses an older character encoding (ANSEL)');
  await page.getByRole('button', { name: 'Next problem' }).click();
  await expect(page.locator('#ed-count')).toHaveText('2 of 67');
  await expect(pos(page)).toHaveText(/^Line 1,818, /);
  await expect(live(page)).toHaveText(/^Line 1,818: .+ was born before their mother$/);
  await expect(page.locator('.cm-activeLine')).toBeInViewport();
  await page.getByRole('button', { name: 'Previous problem' }).click();
  await expect(page.locator('#ed-count')).toHaveText('1 of 67');
  await expect(pos(page)).toHaveText(/^Line 6, /);
  // Previous from the first wraps to the last.
  await page.getByRole('button', { name: 'Previous problem' }).click();
  await expect(page.locator('#ed-count')).toHaveText('67 of 67');
});

/** Replaces line `n` (the cursor's line) with `text` from the keyboard. */
async function retype(page: Page, text: string) {
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

test('e2e editor: Check again after a fix removes the finding from the report and the markers', async ({ page }) => {
  await report(page, 'editor.ged');
  await expect(page.locator('.finding', { hasText: 'A line starts with spaces' })).toHaveCount(1);
  await editLine(page, 12);
  await expect(page.locator('#ed-stale')).toBeHidden();
  await retype(page, '1 SEX F');
  await expect(page.locator('.cm-activeLine')).toHaveText('1 SEX F');
  await expect(page.locator('#ed-edited')).toBeVisible();
  await expect(page.locator('#ed-stale')).toHaveText('Markers may be out of date. Check again to update them.');
  await expect(page.locator('#ed-stale')).toBeVisible();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(live(page)).toHaveText('Checked: 1 error, 0 warnings, 0 hints.');
  await expect(page.locator('#ed-stale')).toBeHidden();
  await expect(page.locator('.cm-lint-marker')).toHaveCount(1);
  await expect(page.locator('#ed-count')).toHaveText('1 problem');
  // Still open, with the cursor where it was; edits are still unsaved.
  await expect(dialog(page)).toBeVisible();
  await expect(pos(page)).toHaveText('Line 12, column 8');
  await expect(page.locator('#ed-edited')).toBeVisible();
  // The report behind it changed too.
  await expect(page.locator('.finding', { hasText: 'A line starts with spaces' })).toHaveCount(0);
  await expect(page.locator('.finding')).toHaveCount(1);
});

test('e2e editor: when Check again finds nothing left, the editor can still be reopened', async ({ page }) => {
  await report(page, 'editor.ged');
  await editLine(page, 12);
  await retype(page, '1 SEX F');
  // Line 15 points to a family that doesn't exist: delete the line.
  await page.locator('.cm-line', { hasText: '1 FAMC @F9@' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(live(page)).toHaveText('No problems found in 1 person.');
  await expect(page.locator('#ed-count')).toHaveText('No problems');
  await expect(page.locator('.cm-lint-marker')).toHaveCount(0);
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // No findings, so no toolbar: the button by the status line opens it again, with the edits.
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
  const reopen = page.getByRole('button', { name: 'Open the editor' });
  await expect(reopen).toBeFocused();
  await reopen.click();
  await expect(page.locator('.cm-content')).not.toContainText('@F9@');
  await expect(page.locator('#ed-edited')).toBeVisible();
});

test('e2e editor: Check again checks what Download gives, so an ANSEL file is not called mislabelled', async ({ page }) => {
  await report(page, 'ansel.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.locator('.cm-line', { hasText: 'René /Dupré/' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Jr');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(live(page)).toHaveText(/^Checked: /);
  const status = await live(page).innerText();
  // No "The file says it's ANSEL, but it's really UTF-8".
  await expect(page.locator('#report')).not.toContainText("but it's really");
  const cards = async () => (await page.locator('.finding summary').allInnerTexts()).sort();
  const afterCheck = await cards();
  // The downloaded file, checked as a file of its own, gives the same report.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download edited file' }).click(),
  ]);
  const bytes = await readFile((await download.path())!);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#file').setInputFiles({ name: 'ansel.ged', mimeType: 'text/plain', buffer: bytes });
  await expect(page.locator('#status')).toHaveText(status);
  expect(await cards()).toEqual(afterCheck);
});

test('e2e editor: after Check again inserts the CHAR line, the line below keeps its marker, Next and Edit line', async ({ page }) => {
  // No CHAR line, and a line too long right after 2 FORM: the download inserts
  // "1 CHAR UTF-8" just above it.
  await report(page, 'no-char.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(live(page)).toHaveText(/^Checked: /);
  await expect(page.locator('.cm-lint-marker')).toHaveCount(3);
  // The report shows the editor's line numbers: the long line is line 6 here.
  await expect(page.locator('.finding', { hasText: 'longer than GEDCOM allows' }).locator('.at')).toHaveText('Line 6');
  await page.getByRole('button', { name: 'Next problem' }).click();
  await expect(pos(page)).toHaveText(/^Line 6, /);
  await expect(page.locator('.cm-activeLine')).toHaveText(/^1 NOTE x+$/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit line 6', exact: true }).click();
  await expect(page.locator('.cm-line.gx-flash')).toHaveText(/^1 NOTE x+$/);
  await expect(pos(page)).toHaveText(/^Line 6, /);
});

test('e2e editor: Edit line for a line that has been deleted opens the nearest line and says so', async ({ page }) => {
  await report(page, 'editor.ged');
  await editLine(page, 12);
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(page.locator('.cm-activeLine')).toHaveText('1 _UID 1234');
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit line 12', exact: true }).click();
  await expect(live(page)).toHaveText('That line no longer exists; showing line 12.');
  await expect(page.locator('.cm-activeLine')).toHaveText('1 _UID 1234');
});

test('e2e editor: closing the dialog another way still returns focus and puts the bar back', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(live(page)).toHaveText(/^Checked: /);
  await expect(dialog(page).locator('#progress')).toBeAttached();
  await page.evaluate(() => (document.querySelector('dialog#editor') as HTMLDialogElement).close());
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#progress + #drop')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Open the editor' })).toBeFocused();
});

test('e2e editor: leaving with unsaved edits sets returnValue and cancels beforeunload', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.type('x');
  await expect(page.locator('#ed-edited')).toBeVisible();
  const r = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true }) as Event & { returnValue: unknown };
    Object.defineProperty(e, 'returnValue', { value: '', writable: true });
    window.dispatchEvent(e);
    return { prevented: e.defaultPrevented, value: e.returnValue };
  });
  expect(r.prevented).toBe(true);
  expect(typeof r.value === 'string' && r.value.length > 0).toBe(true);
});

test('e2e editor: tapping anywhere in a marker\'s gutter cell shows the tooltip', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'tap on phones');
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.waitForTimeout(700); // let the bar's fade finish
  const marker = (await page.locator('.cm-lint-marker').nth(1).boundingBox())!;
  const cell = (await page.locator('.cm-gutter-lint .cm-gutterElement:has(.cm-lint-marker-error)').boundingBox())!;
  // A point in the cell but outside the 10 px marker.
  const x = cell.x + 2, y = cell.y + cell.height / 2;
  expect(x < marker.x || x > marker.x + marker.width).toBe(true);
  // A real tap there already lands on the marker (Chromium snaps taps to it), so
  // the touch pointerup is sent to the cell itself, as a wider miss would be.
  await page.locator('.cm-gutter-lint .cm-gutterElement:has(.cm-lint-marker-error)').dispatchEvent('pointerup',
    { pointerType: 'touch', bubbles: true, composed: true, clientX: x, clientY: y });
  await expect(page.locator('.cm-tooltip-lint')).toBeVisible();
});

test('e2e editor: scrolling through a stretch with no findings does not mark again', async ({ page }) => {
  test.setTimeout(90_000);
  const path = scratch('stretch.ged');
  // 6,000 findings at the start, then 40,000 lines with none.
  const bad = Array.from({ length: 6_000 }, (_, i) => `0 @I${i + 1}@ INDI\n1 NAME A /B/\n  1 SEX M\n`).join('');
  const good = Array.from({ length: 14_000 }, (_, i) => `0 @J${i + 1}@ INDI\n1 NAME C /D/\n1 SEX F\n`).join('');
  writeFileSync(path, HEAD + bad + good + '0 TRLR\n');
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-line', { hasText: /^0 TRLR$/ })).toBeInViewport();
  await page.waitForTimeout(400);
  const runs = Number(await dialog(page).getAttribute('data-mark-runs'));
  // Up through the empty stretch.
  await page.locator('.cm-content').hover();
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -4000); await page.waitForTimeout(200); }
  // Still in the stretch with no findings (it starts at line about 18,000).
  expect(Number((await page.locator('.cm-lineNumbers .cm-gutterElement').nth(5).innerText()).replace(/,/g, ''))).toBeGreaterThan(19_000);
  expect(Number(await dialog(page).getAttribute('data-mark-runs'))).toBe(runs);
});

test('e2e editor: Ctrl-click on a pointer jumps to its record', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.locator('.cm-content .gx-pointer', { hasText: '@F1@' }).first().click({ modifiers: ['Control'] });
  await expect(pos(page)).toHaveText(/^Line 16, /);
  await expect(page.locator('.cm-activeLine')).toHaveText('0 @F1@ FAM');
  await expect(page.locator('.cm-line.gx-flash')).toHaveText('0 @F1@ FAM');
  // A pointer to nothing says so.
  await page.locator('.cm-content .gx-pointer', { hasText: '@F9@' }).click({ modifiers: ['Control'] });
  await expect(live(page)).toHaveText("There's no record @F9@ in this file.");
  // A plain click only moves the cursor.
  await page.locator('.cm-content .gx-pointer', { hasText: '@I1@' }).click();
  await expect(pos(page)).toHaveText(/^Line 17, /);
});

test('e2e editor: Download edited file on an ANSEL file gives UTF-8 with CHAR UTF-8', async ({ page }) => {
  await report(page, 'ansel.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-content')).toContainText('René /Dupré/');
  // The one line about UTF-8 shows before the first save.
  const note = page.locator('#ed-savenote');
  await expect(note).toHaveText('Your edited file is saved as UTF-8, and its header says so. Line endings are made consistent.');
  await expect(note).toBeVisible();
  // An edit: the name gets a middle name.
  await page.locator('.cm-line', { hasText: 'René /Dupré/' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Jr');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download edited file' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ansel-edited.ged');
  const bytes = await readFile((await download.path())!);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // throws if not UTF-8
  expect(text).toContain('1 CHAR UTF-8\r\n');
  expect(text).not.toContain('ANSEL');
  expect(text).toContain('René /Dupré/ Jr\r\n');
  expect(text).toContain('Zürich');
  // Saved: no "edited", and the note has gone.
  await expect(page.locator('#ed-edited')).toBeHidden();
  await expect(note).toBeHidden();
  // Closing now asks nothing.
  let asked = false;
  page.once('dialog', d => { asked = true; void d.dismiss(); });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toBeHidden();
  expect(asked).toBe(false);
});

test('e2e editor: the unsaved-edits prompts', async ({ page }) => {
  await report(page, 'editor.ged');
  await editLine(page, 12);
  await page.keyboard.type('x');
  // Close: asked, and Cancel keeps the editor open.
  let message = '';
  page.once('dialog', d => { message = d.message(); void d.dismiss(); });
  await page.getByRole('button', { name: 'Close' }).click();
  expect(message).toBe('Close the editor? Your edits stay here until you download them or check another file.');
  await expect(dialog(page)).toBeVisible();
  // OK closes; reopening shows the edits again.
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-content')).toContainText('  1 SEX xF');
  page.once('dialog', d => void d.accept());
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();

  // Another file: asked; Cancel keeps this report.
  page.once('dialog', d => { message = d.message(); void d.dismiss(); });
  await upload(page, 'royal92.ged');
  expect(message).toBe('Check another file? Your edits to editor.ged will be lost.');
  await expect(page.locator('#report dd', { hasText: 'editor.ged' })).toBeVisible();

  // Closing the tab: the browser's own prompt.
  const before = new Promise<string>(resolve => page.once('dialog', d => { resolve(d.type()); void d.dismiss(); }));
  await page.close({ runBeforeUnload: true });
  expect(await before).toBe('beforeunload');
});

test('e2e editor: another file after OK drops the edits', async ({ page }) => {
  await report(page, 'editor.ged');
  await editLine(page, 12);
  await page.keyboard.type('x');
  page.once('dialog', d => void d.accept());
  await page.keyboard.press('Escape');
  page.once('dialog', d => void d.accept());
  await report(page, 'royal92.ged');
  await expect(page.locator('#report dd', { hasText: 'royal92.ged' })).toBeVisible();
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('#ed-name')).toHaveText('royal92.ged');
  await expect(page.locator('#ed-edited')).toBeHidden();
  // No edits, so no prompts at all.
  let asked = false;
  page.on('dialog', d => { asked = true; void d.dismiss(); });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await report(page, 'editor.ged');
  expect(asked).toBe(false);
});

test('e2e editor: Esc closes the editor and focus returns to the opener; Esc closes search first', async ({ page }) => {
  await report(page, 'editor.ged');
  const opener = page.getByRole('button', { name: 'Edit line 15', exact: true });
  await opener.click();
  await expect(dialog(page)).toBeVisible();
  // The search panel: Esc closes it, not the editor.
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-search')).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(opener).toBeInViewport();
  // From the toolbar too.
  const open = page.getByRole('button', { name: 'Open the editor' });
  await open.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(open).toBeFocused();
});

test('e2e editor: focus stays inside the editor', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(dialog(page)).toBeVisible();
  const inside = () => page.evaluate(() => {
    const d = document.querySelector('dialog#editor')!;
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return !!a && (d.contains(a) || d.contains((a.getRootNode() as ShadowRoot).host ?? null));
  });
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  }
});

test('e2e editor: toolbar buttons are big enough to tap on phones, and the page does not scroll sideways', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch sizes only');
  await report(page, 'royal92.ged');
  await page.getByRole('button', { name: 'Edit line 6', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  for (const name of ['Previous problem', 'Next problem', 'Check again', 'Download edited file', 'Close', 'Find and replace']) {
    const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, name).toBeLessThanOrEqual(360);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // A card's Edit button is big enough too.
  await page.keyboard.press('Escape');
  const edit = (await page.locator('.edit-line').first().boundingBox())!;
  expect(edit.height).toBeGreaterThanOrEqual(44);
});

test('e2e editor: line wrapping is off, with a toggle', async ({ page }) => {
  const long = 'word '.repeat(200).trim();
  await page.locator('#file').setInputFiles({ name: 'long.ged', mimeType: 'text/plain', buffer: Buffer.from(HEAD + `0 @I1@ INDI\n1 NOTE ${long}\n0 TRLR\n`) });
  await expect(page.locator('#status')).toHaveText(/^Checked: /);
  await page.getByRole('button', { name: 'Open the editor' }).click();
  const scroller = page.locator('.cm-scroller');
  const wide = () => scroller.evaluate(e => e.scrollWidth > e.clientWidth);
  expect(await wide()).toBe(true);
  await page.getByLabel('Wrap lines').check();
  await expect.poll(wide).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('e2e editor: the dialog fits the viewport at every size, long lines scroll only inside, the page behind stays put', async ({ page, isMobile }) => {
  // A 5,000-character line with no spaces, and a long line of words.
  const ged = HEAD + `0 @I1@ INDI\n1 NAME Jane /Smith/\n1 NOTE ${'x'.repeat(5000)}\n1 NOTE ${'word '.repeat(1000).trim()}\n0 TRLR\n`;
  await page.locator('#file').setInputFiles({ name: 'long-lines.ged', mimeType: 'text/plain', buffer: Buffer.from(ged) });
  await expect(page.locator('#status')).toHaveText(/^Checked: /);
  const open = page.getByRole('button', { name: 'Open the editor' });
  await open.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0); // so "the page stays put" means something
  await open.click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\bed-lock\b/);
  const scroller = page.locator('.cm-scroller');

  const measure = () => page.evaluate(() => {
    const d = document.querySelector<HTMLDialogElement>('dialog.editor')!;
    const r = d.getBoundingClientRect();
    const de = document.documentElement;
    const sc = document.querySelector('.ed-host')!.shadowRoot!.querySelector('.cm-scroller')!;
    return {
      pageWide: de.scrollWidth - de.clientWidth,
      dialog: [r.left, r.top, r.width, r.height],
      viewport: [0, 0, window.innerWidth, window.innerHeight],
      dialogScrolls: [d.scrollWidth - d.clientWidth, d.scrollHeight - d.clientHeight],
      bodyOverflow: getComputedStyle(document.body).overflow,
      bodyPosition: getComputedStyle(document.body).position,
      innerWide: sc.scrollWidth > sc.clientWidth,
    };
  });
  for (const [width, height] of [[1280, 800], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const wrap of [false, true]) {
      await page.getByLabel('Wrap lines').setChecked(wrap);
      // The cursor to the end of the 5,000-character line, then some typing there.
      await page.locator('.cm-line', { hasText: /^1 NOTE x+/ }).click();
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      await expect.poll(() => scroller.evaluate(e => e.scrollWidth > e.clientWidth), `${width} wrap ${wrap}`).toBe(!wrap);
      const m = await measure();
      const at = `${width}x${height}, wrap ${wrap}`;
      expect(m.pageWide, at).toBe(0);
      expect(m.dialog, at).toEqual(m.viewport);
      expect(m.dialogScrolls, at).toEqual([0, 0]);
      expect(m.bodyOverflow, at).toBe('hidden');
      expect(m.bodyPosition, at).toBe('fixed');
      // Every control is on screen, and the toolbar wraps instead of widening anything.
      for (const name of ['Previous problem', 'Next problem', 'Check again', 'Download edited file', 'Close', 'Find and replace']) {
        const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(box.x, `${name} ${at}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${name} ${at}`).toBeLessThanOrEqual(width);
        expect(box.y + box.height, `${name} ${at}`).toBeLessThanOrEqual(height);
      }
      // A wheel over the toolbar scrolls nothing behind it.
      await page.mouse.move(width / 2, 4);
      await page.mouse.wheel(300, 600);
      await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY, document.documentElement.scrollWidth - document.documentElement.clientWidth])).toEqual([0, 0, 0]);
    }
  }
  // Phones: the text is at least 16px, or iOS zooms the whole page in when it is tapped.
  if (isMobile) {
    const px = await page.locator('.cm-content').evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    expect(px).toBeGreaterThanOrEqual(16);
  }
  // Closing unpins the page, back where it was.
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/\bed-lock\b/);
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('static');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(open).toBeInViewport();
});

test('e2e editor: undo and redo, and search and replace', async ({ page }) => {
  await report(page, 'editor.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.locator('.cm-line', { hasText: '1 NAME Ann /Lee/' }).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('Q');
  await expect(page.locator('.cm-activeLine')).toHaveText('1 NAME QAnn /Lee/');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-activeLine')).toHaveText('1 NAME Ann /Lee/');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.cm-activeLine')).toHaveText('1 NAME QAnn /Lee/');
  // The Find and replace button opens CodeMirror's panel.
  await page.getByRole('button', { name: 'Find and replace' }).click();
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.locator('.cm-search input[name="search"]').fill('QAnn');
  await page.locator('.cm-search input[name="replace"]').fill('Anna');
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await expect(page.locator('.cm-content')).toContainText('1 NAME Anna /Lee/');
});

test('e2e editor: CodeMirror styles come from adopted style sheets, with no CSP violation', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[]; __ignored: number };
    w.__csp = [];
    w.__ignored = 0;
    document.addEventListener('securitypolicyviolation', e => {
      // Chromium's own contenteditable, typing over a selection of several lines, sets a
      // style attribute it blocks itself (no source file); that one is not CodeMirror's.
      if (e.violatedDirective === 'style-src-attr' && !e.sourceFile) { w.__ignored++; return; }
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`);
    });
  });
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await report(page, 'royal92.ged');
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: 'Next problem' }).click();
  await page.waitForTimeout(700); // the bar's fade
  await page.locator('.cm-lint-marker').first().hover();
  await page.getByRole('button', { name: 'Find and replace' }).click();
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.keyboard.press('Escape'); // closes the search panel only
  await expect(dialog(page)).toBeVisible();
  await page.mouse.move(5, 5); // away from the marker, so its tooltip closes
  await expect(page.locator('.cm-tooltip-lint')).toHaveCount(0);
  // Typing over a selection of several lines.
  await page.locator('.cm-line:visible').nth(2).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.type('Z');
  await expect(page.locator('.cm-activeLine')).toHaveText(/^Z/);
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => {
    const host = document.querySelector('.ed-host')!;
    return {
      styleTags: document.querySelectorAll('style').length,
      shadowStyleTags: host.shadowRoot!.querySelectorAll('style').length,
      adopted: host.shadowRoot!.adoptedStyleSheets.length,
      flex: getComputedStyle(host.shadowRoot!.querySelector('.cm-editor')!).display,
    };
  });
  expect(s.styleTags).toBe(0);
  expect(s.shadowStyleTags).toBe(0);
  expect(s.adopted).toBeGreaterThan(0);
  expect(s.flex).toBe('flex'); // CodeMirror's own styles really apply
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  // Each ignored report also logs one console error; nothing else may.
  const inline = /^Applying inline style violates the following Content Security Policy directive/;
  const ignored = await page.evaluate(() => (window as unknown as { __ignored: number }).__ignored);
  expect(errors.filter(e => inline.test(e))).toHaveLength(ignored);
  expect(errors.filter(e => !inline.test(e))).toEqual([]);
});

test('e2e editor: the editor is loaded only when first opened', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', r => seen.push(new URL(r.url()).pathname));
  await page.goto('/');
  await report(page, 'editor.ged');
  expect(seen.filter(p => /\/assets\/editor-[\w-]+\.js$/.test(p))).toEqual([]);
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(seen.filter(p => /\/assets\/editor-[\w-]+\.js$/.test(p))).toHaveLength(1);
});

test('e2e editor: Stop during Check again keeps the editor and the report', async ({ page }) => {
  // A big file, so the check takes long enough to stop.
  const path = scratch('big.ged');
  const chunks = [HEAD];
  for (let i = 1; i < 60_000; i++) chunks.push(`0 @I${i}@ INDI\n1 NAME P${i} /F/\n1 NOTE A note to give the file some weight, number ${i}.\n`);
  chunks.push('  1 SEX M\n0 TRLR\n');
  writeFileSync(path, chunks.join(''));
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('x');
  await page.getByRole('button', { name: 'Check again' }).click();
  // The bar shows inside the editor's toolbar while it runs.
  await expect(dialog(page).locator('#progress')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Stop' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#ed-stale')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeFocused();
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#report dd', { hasText: 'big.ged' })).toBeVisible();
  await expect(page.locator('#progress')).toBeHidden();
});

// ---------------------------------------------------------------- big files

test('e2e editor: 20 MB file opens in under 3 s and scrolls', async ({ page }, info) => {
  test.setTimeout(120_000);
  const path = scratch('big20.ged');
  const rec = (i: number) =>
    `0 @I${i}@ INDI\n${i % 1000 === 0 ? '' : `1 NAME Person${i} /Family${i % 500}/\n`}1 SEX ${i % 2 ? 'M' : 'F'}\n1 BIRT\n2 DATE ${1 + (i % 28)} MAR ${1700 + (i % 300)}\n2 PLAC Somewhere in the world, Region ${i % 50}\n1 NOTE A note about this person to give the file some weight, number ${i}.\n`;
  const chunks: string[] = [HEAD];
  let size = chunks[0].length;
  for (let i = 1; size < 20 * 1024 * 1024; i++) { const r = rec(i); chunks.push(r); size += r.length; }
  chunks.push('0 TRLR\n');
  writeFileSync(path, chunks.join(''));
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 60_000 });

  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __last: number };
    w.__gap = 0; w.__last = performance.now();
    setInterval(() => { const n = performance.now(); w.__gap = Math.max(w.__gap, n - w.__last - 50); w.__last = n; }, 50);
  });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-line').first()).toBeVisible();
  const openMs = Date.now() - t0;
  await expect(page.locator('.cm-lint-marker').first()).toBeAttached({ timeout: 10_000 }).catch(() => {});
  // Next problem goes far down the file; the end is reachable.
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Next problem' }).click();
  await expect(page.locator('#ed-count')).toHaveText(/^1 of /);
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-line', { hasText: /^0 TRLR$/ })).toBeInViewport();
  const navMs = Date.now() - t1;
  const gap = await page.evaluate(() => (window as unknown as { __gap: number }).__gap);
  info.annotations.push({ type: 'open-ms', description: String(openMs) }, { type: 'gap-ms', description: String(Math.round(gap)) });
  console.log(`editor 20 MB (${info.project.name}): opened in ${openMs} ms, next+end ${navMs} ms, max main-thread gap ${Math.round(gap)} ms, markers ${await dialog(page).getAttribute('data-markers')}`);
  expect(openMs).toBeLessThan(3000);
});

test('e2e editor: many findings get at most 5,000 markers, nearest the view', async ({ page }, info) => {
  test.setTimeout(120_000);
  const path = scratch('many.ged');
  // 12,000 people, each with a line starting with spaces: 12,000 findings.
  const people = Array.from({ length: 12_000 }, (_, i) => `0 @I${i + 1}@ INDI\n1 NAME P${i} /F/\n  1 SEX M\n`).join('');
  writeFileSync(path, HEAD + people + '0 TRLR\n');
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 60_000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-lint-marker').first()).toBeVisible();
  const ms = Date.now() - t0;
  console.log(`editor 12,000 findings (${info.project.name}): markers shown after ${ms} ms`);
  expect(Number(await dialog(page).getAttribute('data-markers'))).toBe(5000);
  const count = Number((await page.locator('#ed-count').innerText()).replace(/[^\d]/g, ''));
  expect(count).toBeGreaterThanOrEqual(12_000);
  // At the end of the file, the markers there are shown too.
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-line', { hasText: /^0 TRLR$/ })).toBeInViewport();
  const last = page.locator('.cm-lint-marker').last();
  await expect(last).toBeInViewport({ timeout: 5000 });
  expect(Number(await dialog(page).getAttribute('data-markers'))).toBe(5000);
});

test('e2e editor: a browser without adopted style sheets gets no editor buttons, one line, and no CSP violation', async ({ page }) => {
  await page.addInitScript(() => {
    delete (ShadowRoot.prototype as unknown as Record<string, unknown>).adoptedStyleSheets;
    delete (CSSStyleSheet.prototype as unknown as Record<string, unknown>).replaceSync;
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', e => w.__csp.push(e.violatedDirective));
  });
  await page.goto('/');
  await report(page, 'editor.ged');
  await expect(page.locator('.edit-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open the editor' })).toHaveCount(0);
  await expect(page.locator('.toolbar + .no-editor')).toHaveText(
    "This browser can't run the editor. Try a current version of Firefox, Chrome, Safari or Edge.");
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});
