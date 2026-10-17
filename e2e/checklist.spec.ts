// The repair checklist: choosing which fixes to apply (library v0.3.0).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);
const upload = (page: Page, name: string) => page.locator('#file').setInputFiles(fixture(name));

async function save(page: Page, label: string): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  return readFile((await download.path())!);
}

const ENCODING = 'Convert to UTF-8 (and say so in the header)';
const BROKEN = "Remove links to records that don't exist";
const EMPTY = 'Remove families with nobody in them';
const SUBMITTER = 'Add you as the person who made this file';
const box = (page: Page, label: string) => page.getByRole('checkbox', { name: label, exact: true });
const row = (page: Page, fix: string) => page.locator(`#repair li.fix[data-fix="${fix}"]`);

/** Lines of a text file, without the ones given (1-based). */
function without(text: string, drop: number[]): string {
  const lines = text.split('\n');
  return lines.filter((_, i) => !drop.includes(i + 1)).join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('e2e: royal92 shows the format list with encoding ticked', async ({ page }) => {
  await upload(page, 'royal92.ged');
  await expect(page.locator('#repair h2')).toHaveText('What we can fix');
  const format = page.getByRole('group', { name: 'Formatting fixes' });
  await expect(format).toBeVisible();
  await expect(format.getByRole('checkbox')).toHaveCount(1);
  await expect(box(page, ENCODING)).toBeChecked();
  await expect(box(page, ENCODING)).toBeEnabled();
  await expect(row(page, 'encoding').locator('.fix-count')).toHaveText('whole file');
  // Its Show lines opens on what the repair changed.
  await row(page, 'encoding').getByRole('button', { name: 'Show lines' }).click();
  await expect(row(page, 'encoding').locator('.fix-lines-body')).toContainText('1 CHAR');
  await expect(page.getByRole('button', { name: 'Repair selected (1)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download repaired file' })).toBeVisible();
});

test('e2e: the suggested fixes start unticked; broken links alone removes exactly those lines', async ({ page }) => {
  await upload(page, 'suggested.ged');
  const data = page.getByRole('group', { name: 'Suggested fixes for your family data' });
  await expect(data).toBeVisible();
  await expect(data).toContainText('These remove or add records. Look at what they change before you download.');
  for (const label of [BROKEN, EMPTY, SUBMITTER]) await expect(box(page, label)).not.toBeChecked();
  await expect(box(page, 'Remove blank lines')).toBeChecked();
  await expect(row(page, 'broken-links').locator('.fix-count')).toHaveText('4 lines removed');

  // Show lines lists each link with the lines nested under it.
  await row(page, 'broken-links').getByRole('button', { name: 'Show lines' }).click();
  const lines = row(page, 'broken-links').locator('.fix-lines-body');
  await expect(lines.locator('.ex-line:not(.nested) code')).toHaveText(['1 FAMC @F9@', '1 CHIL @I7@', '1 HUSB @I99@']);
  await expect(lines.locator('.ex-line.nested code')).toHaveText(['2 PEDI birth']);

  await box(page, BROKEN).check();
  await page.getByRole('button', { name: 'Repair selected (2)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 2 kinds of fix applied.');
  await expect(page.locator('#repair h4', { hasText: BROKEN })).toBeVisible();
  const bytes = await save(page, 'Download repaired file');
  const original = (await readFile(fixture('suggested.ged'))).toString('utf8');
  // Lines 11-12 (FAMC @F9@ and its PEDI), 22 (CHIL @I7@), 27 (HUSB @I99@), and the blank line 18.
  expect(bytes.toString('utf8')).toBe(without(original, [11, 12, 18, 22, 27]));
});

test('e2e: Repair everything leaves the submitter out without a name, and adds it with one', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await page.getByRole('button', { name: 'Repair everything' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 3 kinds of fix applied, 1 not applied.');
  await expect(page.locator('#run-note')).toHaveText(`Left out “${SUBMITTER}”: type your name to include it.`);
  await expect(page.locator('#repair .not-applied li')).toHaveText([`${SUBMITTER} — Type your name to include this.`]);
  await expect(row(page, 'submitter').locator('.fix-note')).toHaveText('Type your name to include this.');
  const original = (await readFile(fixture('suggested.ged'))).toString('utf8');
  // Broken links, the empty family F2 with its FAMS link, F3 (empty once its broken HUSB is gone), the blank line.
  const everything = without(original, [11, 12, 17, 18, 22, 23, 24, 25, 26, 27]);
  expect((await save(page, 'Download repaired file')).toString('utf8')).toBe(everything);

  const name = page.getByRole('textbox', { name: 'Your name' });
  await expect(name).toHaveAttribute('maxlength', '120');
  await name.fill('Jo March');
  await expect(page.locator('#repair .stale')).toHaveText('out of date — repair again');
  await page.getByRole('button', { name: 'Repair everything' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 4 kinds of fix applied.');
  await expect(page.locator('#repair .stale')).toBeHidden();
  const withName = everything
    .replace('1 CHAR UTF-8\n', '1 CHAR UTF-8\n1 SUBM @SUBM1@\n')
    .replace('0 TRLR\n', '0 @SUBM1@ SUBM\n1 NAME Jo March\n0 TRLR\n');
  expect((await save(page, 'Download repaired file')).toString('utf8')).toBe(withName);
});

test('e2e: ticking empty families ticks broken links too, with a note', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await expect(row(page, 'empty-families').locator('.fix-reason')).toContainText('needs “Remove links');
  await box(page, EMPTY).check();
  await expect(box(page, BROKEN)).toBeChecked();
  await expect(row(page, 'empty-families').locator('.fix-note')).toHaveText(`Also ticked “${BROKEN}”, which this needs.`);
});

test('e2e: unticking encoding keeps an ANSEL file in ANSEL, and long lines say why they wait', async ({ page }) => {
  await upload(page, 'ansel-long.ged');
  const long = box(page, 'Split lines that are too long');
  await expect(long).toBeChecked();
  await expect(long).toBeEnabled();
  await box(page, ENCODING).uncheck();
  await expect(long).toBeDisabled();
  await expect(long).not.toBeChecked();
  const reason = row(page, 'long-lines').locator('.fix-reason');
  await expect(reason).toHaveText(`This needs “${ENCODING}” too.`);
  // The reason is tied to the checkbox.
  expect(await long.getAttribute('aria-describedby')).toContain('fix-long-lines-reason');
  await expect(page.locator('#repair .stale')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download the last repaired copy' })).toBeVisible();

  await page.getByRole('button', { name: 'Repair selected (1)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 1 kind of fix applied.');
  const original = await readFile(fixture('ansel-long.ged'));
  const bytes = await save(page, 'Download repaired file');
  // Only the blank line went; the ANSEL bytes and the header stay as they were.
  expect(bytes.equals(Buffer.from(original.toString('latin1').replace('\r\n\r\n0 TRLR', '\r\n0 TRLR'), 'latin1'))).toBe(true);
  expect(bytes.toString('latin1')).toContain('1 CHAR ANSEL');

  // Ticking encoding again makes long lines available.
  await box(page, ENCODING).check();
  await expect(long).toBeEnabled();
  await expect(long).toBeChecked();
});

test('e2e: a UTF-16 file shows encoding as required', async ({ page }) => {
  await upload(page, 'utf16le-bom.ged');
  const enc = box(page, ENCODING);
  await expect(enc).toBeChecked();
  await expect(enc).toBeDisabled();
  await expect(row(page, 'encoding').locator('.fix-reason')).toHaveText('This file is UTF-16, so it has to be converted first.');
  expect(await enc.getAttribute('aria-describedby')).toContain('fix-encoding-reason');
});

test('e2e: changing the ticks after a run marks the result out of date', async ({ page }) => {
  await upload(page, 'suggested.ged');
  const dl = page.locator('#download-repaired');
  await expect(dl).toHaveText('Download repaired file');
  await expect(page.locator('#repair .stale')).toBeHidden();
  await box(page, BROKEN).check();
  await expect(page.locator('#repair .stale')).toHaveText('out of date — repair again');
  await expect(page.locator('#repair-live')).toHaveText('Your choices changed. Repair again to update the copy.');
  await expect(dl).toHaveText('Download the last repaired copy');
  await expect(page.getByRole('button', { name: 'Repair selected (2)' })).toBeVisible();
  // Putting the tick back makes it current again.
  await box(page, BROKEN).uncheck();
  await expect(page.locator('#repair .stale')).toBeHidden();
  await expect(dl).toHaveText('Download repaired file');
});

test('e2e: the checklist has 44px targets and its keyboard order follows the page', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await expect(box(page, BROKEN)).toBeVisible();
  for (const fix of ['blank-lines', 'broken-links', 'empty-families', 'submitter']) {
    const h = await row(page, fix).locator('.fix-label').evaluate(e => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  }
  for (const fix of ['blank-lines', 'broken-links', 'empty-families', 'submitter']) {
    const h = await row(page, fix).locator('.show-lines').evaluate(e => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  }
  for (const name of ['Repair everything', /^Repair selected/]) {
    const h = await page.getByRole('button', { name }).evaluate(e => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  }
  // From the first checkbox, Tab goes down the rows: checkbox, its Show lines button, the next checkbox…
  await box(page, 'Remove blank lines').focus();
  const order: string[] = [];
  for (let i = 0; i < 9; i++) {
    order.push(await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      return a.tagName === 'INPUT' ? `box:${(a as HTMLInputElement).value}` : a.classList.contains('show-lines') ? 'show' : a.textContent ?? '';
    }));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual([
    'box:blank-lines', 'show', 'box:broken-links', 'show', 'box:empty-families', 'show', 'box:submitter', 'show', 'Repair everything',
  ]);
});

test('e2e: a non-ASCII name on an ANSEL file without the conversion is not applied, with the library reason', async ({ page }) => {
  await upload(page, 'ansel-long.ged');
  await expect(page.locator('#download-repaired')).toBeVisible();
  await box(page, ENCODING).uncheck();
  await box(page, SUBMITTER).check();
  await page.getByRole('textbox', { name: 'Your name' }).fill('José');
  await page.getByRole('button', { name: 'Repair selected (2)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 1 kind of fix applied, 1 not applied.');
  await expect(page.locator('#repair .not-applied li')).toHaveText([`${SUBMITTER} — This needs “${ENCODING}” too.`]);
  expect((await save(page, 'Download repaired file')).toString('latin1')).not.toContain('SUBM');
});

test('e2e: a file with only suggested fixes gets the checklist and no unchanged copy', async ({ page }) => {
  const text = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Ann /Lee/\n1 SEX F\n0 TRLR\n';
  await page.locator('#file').setInputFiles({ name: 'nosubm.ged', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('#repair h2')).toHaveText('What we can fix');
  await expect(box(page, SUBMITTER)).not.toBeChecked();
  await expect(page.locator('#repair-result')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Download/ }).filter({ hasText: 'repaired' })).toHaveCount(0);
});

// ------------------------------------------------------------------ the heading and its summary

const summary = (page: Page) => page.locator('#repair ul.fix-summary > li');

test('e2e: no format problems but some data fixes: a neutral heading, and the summary says which area has them', async ({ page }) => {
  const text = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Ann /Lee/\n1 SEX F\n0 TRLR\n';
  await page.locator('#file').setInputFiles({ name: 'nosubm.ged', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('#repair h2')).toHaveText('What we can fix');
  await expect(page.locator('#repair')).not.toContainText('No format problems');
  await expect(summary(page)).toHaveText([
    'Formatting issues: 0 found',
    'Family data with a suggested fix: 1 kind (1 place)These fixes change your family data.',
    'Problems to fix in your family tree program: 0 found',
  ]);
  // Labels are <strong>; only an area with a section below links to it.
  await expect(summary(page).locator('strong')).toHaveText([
    'Formatting issues:', 'Family data with a suggested fix:', 'Problems to fix in your family tree program:']);
  await expect(summary(page).locator('a')).toHaveCount(1);
  const link = page.getByRole('link', { name: 'Family data with a suggested fix: 1 kind (1 place)' });
  await expect(link).toHaveAttribute('href', '#fixes-data');
  await expect(page.getByRole('group', { name: 'Formatting fixes' })).toHaveCount(0);
  await link.click();
  await expect(page.getByRole('group', { name: 'Suggested fixes for your family data' })).toBeInViewport();
  await expect(page.locator('#suggested-warn')).toHaveText('These remove or add records. Look at what they change before you download.');
});

test('e2e: both kinds: the summary counts each area and links to its section', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await expect(page.locator('#repair h2')).toHaveText('What we can fix');
  await expect(summary(page)).toHaveText([
    "Formatting issues: 1 kind (1 line)Fixing these doesn't change your family data.",
    'Family data with a suggested fix: 3 kinds (5 places)These fixes change your family data.',
    'Problems to fix in your family tree program: 0 found',
  ]);
  await expect(page.getByRole('link', { name: 'Formatting issues: 1 kind (1 line)' })).toHaveAttribute('href', '#fixes-format');
  await expect(page.getByRole('link', { name: 'Family data with a suggested fix: 3 kinds (5 places)' })).toHaveAttribute('href', '#fixes-data');
  await expect(page.locator('#fixes-format legend')).toHaveText('Formatting fixes');
  await expect(page.locator('#fixes-data legend')).toHaveText('Suggested fixes for your family data');
  // Spacing is even: the box's padding is the same left and right, and top and bottom.
  const pad = await page.locator('#repair ul.fix-summary').evaluate(e => {
    const s = getComputedStyle(e);
    return [s.paddingLeft === s.paddingRight, s.paddingTop === s.paddingBottom];
  });
  expect(pad).toEqual([true, true]);
});

test('e2e: neither kind: the heading says so plainly, and the rest is for the family tree program', async ({ page }) => {
  // An empty family with information of its own: listed, but not offered.
  const text = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n'
    + '0 @I1@ INDI\n1 NAME Ann /Lee/\n1 SEX F\n0 @F1@ FAM\n1 MARR\n2 DATE 1 JAN 1900\n1 NOTE A family with no people\n0 TRLR\n';
  await page.locator('#file').setInputFiles({ name: 'kept.ged', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('#repair h2')).toHaveText('Nothing here we can fix for you');
  await expect(summary(page)).toHaveText([
    'Formatting issues: 0 found',
    'Family data with a suggested fix: 0 found',
    'Problems to fix in your family tree program: 1 found',
  ]);
  const link = page.getByRole('link', { name: 'Problems to fix in your family tree program: 1 found' });
  await expect(link).toHaveAttribute('href', '#findings');
  await link.click();
  await expect(page.locator('#findings')).toBeInViewport();
});

test('e2e: only hints: an optional tidy-up, in the same pattern', async ({ page }) => {
  await upload(page, 'clean-cr.ged');
  await expect(page.locator('#repair h2')).toHaveText('Optional tidy-up');
  await expect(summary(page)).toHaveText([
    "Formatting issues: 1 kind (15 lines)Fixing these doesn't change your family data.",
    'Family data with a suggested fix: 0 found',
    'Problems to fix in your family tree program: 0 found',
  ]);
});

test('e2e: what is left splits into what a fix above can fix and the rest', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await expect(page.locator('#repair h3', { hasText: 'Tick a fix above to fix these here:' })).toBeVisible();
  await expect(page.locator('#repair .left.fixable li', { hasText: "A family's child doesn't exist" })).toBeVisible();
  await expect(page.locator('#repair .left.fixable li', { hasText: "The file doesn't say who made it" })).toBeVisible();
  await expect(page.locator('#repair .left:not(.fixable) li')).toHaveCount(0); // everything left here has a fix above
  await box(page, BROKEN).check();
  await box(page, EMPTY).check();
  await page.getByRole('textbox', { name: 'Your name' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Repair selected/ }).click();
  await expect(page.locator('#status')).toHaveText(/^Repaired: /);
  await expect(page.locator('#repair .left.fixable li')).toHaveText([/^The file doesn't say who made it/]);
});

test('e2e: an open Show lines panel and the focus survive a run', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await row(page, 'broken-links').getByRole('button', { name: 'Show lines' }).click();
  await box(page, BROKEN).check();
  // The runs wait for the plan of the new ticks.
  await expect(page.getByRole('button', { name: 'Repair selected (2)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Repair selected (2)' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Repaired: 2 kinds of fix applied.');
  const show = page.locator('#fix-broken-links-show');
  await expect(show).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#fix-broken-links-lines')).toBeVisible();
  await expect(page.locator('#fix-broken-links-lines .ex-line.nested code')).toHaveText(['2 PEDI birth']);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('repair-selected');
});

/** The original lines a kind's Show lines says will go: each unit's line and the rows under it. */
async function previewRemoved(page: Page, fix: string): Promise<number[]> {
  const show = page.locator(`#fix-${fix}-show`);
  if (await show.getAttribute('aria-expanded') !== 'true') await show.click();
  return page.locator(`#fix-${fix}-lines`).evaluate(body => {
    const out: number[] = [];
    for (const li of body.querySelectorAll('ol.ex > li')) {
      const line = Number((li.querySelector('.ex-at')!.textContent ?? '').replace(/[^\d]/g, ''));
      const rows = li.querySelectorAll('.ex-line:not(.added)').length;
      for (let i = 0; i < Math.max(rows, 1); i++) out.push(line + i);
    }
    return out;
  });
}

test('e2e: a blank line inside a family: the family with a wife stays in the preview', async ({ page }) => {
  await upload(page, 'blank-in-fam.ged');
  await expect(row(page, 'empty-families').locator('.fix-count')).toHaveText('4 lines removed'); // alone: F2 and its link
  await box(page, BROKEN).check();
  // Planned again with broken-links: F3 (empty once its broken HUSB goes) joins; F4 keeps its WIFE.
  await expect(row(page, 'empty-families').locator('.fix-count')).toHaveText('6 lines removed');
  await page.locator('#fix-empty-families-show').click();
  const body = page.locator('#fix-empty-families-lines');
  await expect(body.locator('.ex-at')).toHaveText(['Line 17', 'Line 23', 'Line 26']);
  await expect(body).not.toContainText('@F4@');
});

test('e2e: the combined broken-links and empty-families preview is what the download removes', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await box(page, BROKEN).check();
  await box(page, EMPTY).check();
  await expect(row(page, 'empty-families').locator('.fix-count')).toHaveText('6 lines removed');
  // The preview of the three kinds, once Plan has answered for these ticks.
  const preview = async () => {
    const removed = new Set<number>();
    for (const fix of ['blank-lines', 'broken-links', 'empty-families']) for (const n of await previewRemoved(page, fix)) removed.add(n);
    return [...removed].sort((a, b) => a - b);
  };
  await expect.poll(preview).toEqual([11, 12, 17, 18, 22, 23, 24, 25, 26, 27]);
  const removed = await preview();
  await page.getByRole('button', { name: 'Repair selected (3)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 3 kinds of fix applied.');
  const original = (await readFile(fixture('suggested.ged'))).toString('utf8');
  const bytes = await save(page, 'Download repaired file');
  expect(bytes.toString('utf8')).toBe(without(original, removed));
  // The result lists each unit with the lines that really went.
  await expect(page.locator('#repair .changes li', { hasText: 'Removed an empty family @F2@' })).toHaveText('Removed an empty family @F2@: line 23, 3 lines removed');
});

test('e2e: a file over 10 MB shows the real counts from Plan, and waits for a click', async ({ page }) => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'validate-e2e-'));
  try {
    const head = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n';
    const parts = [head];
    let size = head.length;
    for (let i = 1; size < 10.5 * 1024 * 1024; i++) {
      const r = `0 @I${i}@ INDI\n1 NAME Person${i} /Family${i % 500}/\n1 SEX ${i % 2 ? 'M' : 'F'}\n1 NOTE A note to give the file some weight, number ${i}.\n`;
      parts.push(r);
      size += r.length;
      if (i === 1000 || i === 2000 || i === 3000) parts.push('\n');
    }
    parts.push('0 TRLR\n');
    const path = join(dir, 'big.ged');
    writeFileSync(path, parts.join(''));
    await page.locator('#file').setInputFiles(path);
    await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 240_000 });
    await expect(row(page, 'blank-lines').locator('.fix-count')).toHaveText('3 lines', { timeout: 60_000 });
    await expect(box(page, 'Remove blank lines')).toBeChecked();
    await page.locator('#fix-blank-lines-show').click();
    await expect(page.locator('#fix-blank-lines-lines .ex-at')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Repair selected (1)' })).toBeVisible();
    await expect(page.locator('#repair-result')).toBeHidden();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("e2e: the editor's Check again refreshes the checklist from Plan", async ({ page }) => {
  await upload(page, 'suggested.ged');
  await expect(row(page, 'broken-links').locator('.fix-count')).toHaveText('4 lines removed');
  await page.getByRole('button', { name: 'Edit line 11', exact: true }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
  // Delete the broken FAMC link and its PEDI line (lines 11-12).
  await page.locator('.cm-line', { hasText: '1 FAMC @F9@' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('#ed-live')).toHaveText(/^Checked: /);
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Two links are left (lines 20 and 25 now), one line each.
  await expect(row(page, 'broken-links').locator('.fix-count')).toHaveText('2 lines removed');
  await page.locator('#fix-broken-links-show').click();
  await expect(page.locator('#fix-broken-links-lines .ex-at')).toHaveText(['Line 20', 'Line 25']);
  await expect(page.locator('#fix-broken-links-lines')).not.toContainText('@F9@');
});

// ------------------------------------------------------------------ the last round

/**
 * Test hooks around the page's workers: counts them, records the message
 * types sent, can swallow (__hold) or delay (__delay, ms) messages of a type,
 * and can turn Plan answers into errors (__planError).
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const Real = window.Worker;
    const w = window as unknown as {
      __made: number; __sent: string[]; __hold: string[]; __delay: Record<string, number>; __planError: boolean;
    };
    w.__made = 0; w.__sent = []; w.__hold = []; w.__delay = {}; w.__planError = false;
    window.Worker = class extends Real {
      constructor(...a: ConstructorParameters<typeof Worker>) { super(...a); w.__made++; }
      addEventListener(type: string, fn: (e: unknown) => void, ...rest: never[]) {
        if (type !== 'message') return super.addEventListener(type, fn as never, ...rest);
        const wrapped = (e: MessageEvent) => {
          const d = e.data as { type: string; id?: number };
          fn(w.__planError && d.type === 'planned' ? { data: { ...d, info: { available: [], error: 'forced' } } } : e);
        };
        super.addEventListener(type, wrapped as never, ...rest);
      }
      postMessage(msg: { type: string }, transfer?: never) {
        w.__sent.push(msg.type);
        if (w.__hold.includes(msg.type)) return;
        const ms = w.__delay[msg.type];
        if (ms) { setTimeout(() => super.postMessage(msg, transfer as never), ms); return; }
        super.postMessage(msg, transfer as never);
      }
    } as typeof Worker;
  });
}
const hook = (page: Page, f: (w: { __hold: string[]; __delay: Record<string, number>; __planError: boolean }) => void) =>
  page.evaluate(`(${f.toString()})(window)`);

/** A GEDCOM file of a little over `mb` MB, with a broken FAMC and a family whose only member doesn't exist. */
function bigWithLinks(dir: string, mb: number): string {
  const head = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n';
  const parts = [head];
  let size = head.length;
  for (let i = 1; size < mb * 1024 * 1024; i++) {
    const r = `0 @I${i}@ INDI\n1 NAME Person${i} /Family${i % 500}/\n1 SEX ${i % 2 ? 'M' : 'F'}\n1 NOTE A note to give the file some weight, number ${i}.\n`;
    parts.push(r);
    size += r.length;
    if (i === 10) parts.push('1 FAMC @F404@\n');
  }
  parts.push('0 @F1@ FAM\n1 HUSB @I999999@\n0 TRLR\n');
  const path = join(dir, 'big-links.ged');
  writeFileSync(path, parts.join(''));
  return path;
}

test('e2e: after Stop, the preview catches up with ticks changed during the repair', async ({ page }) => {
  test.setTimeout(300_000);
  await instrument(page);
  await page.goto('/');
  const dir = mkdtempSync(join(tmpdir(), 'validate-e2e-'));
  try {
    await page.locator('#file').setInputFiles(bigWithLinks(dir, 5.2));
    await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 240_000 });
    const famCount = row(page, 'empty-families').locator('.fix-count');
    await expect(famCount).toHaveText('2 lines, once broken links are removed', { timeout: 60_000 });
    await box(page, BROKEN).check();
    await expect(famCount).toHaveText('2 lines removed'); // planned with broken-links: F1 goes
    await expect(page.locator('#repair .fix-groups')).not.toHaveClass(/is-pending/);
    // The repair is held, so it is still running; a tick then sends a plan, which is swallowed too.
    await hook(page, w => { w.__hold = ['repair', 'plan']; });
    await page.getByRole('button', { name: 'Repair selected (1)' }).click();
    const plans = () => page.evaluate(() => (window as unknown as { __sent: string[] }).__sent.filter(t => t === 'plan').length);
    const before = await plans();
    await box(page, EMPTY).check();
    await expect(page.locator('#repair .fix-groups')).toHaveClass(/is-pending/);
    await expect.poll(plans).toBeGreaterThan(before); // sent, and swallowed with the repair
    await hook(page, w => { w.__hold = []; });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('#status')).toHaveText('Stopped.');
    // Planned again for the ticks on screen (the plan sent during the repair died with its worker).
    await expect(page.locator('#repair .fix-groups')).not.toHaveClass(/is-pending/, { timeout: 60_000 });
    await expect(famCount).toHaveText('2 lines removed');
    await page.locator('#fix-empty-families-show').click();
    await expect(page.locator('#fix-empty-families-lines')).toContainText('0 @F1@ FAM');
    await expect(page.getByRole('button', { name: 'Repair selected (2)' })).toBeEnabled();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('e2e: while a plan for the ticks on screen is on its way, the preview says so and the runs wait', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await upload(page, 'suggested.ged');
  await expect(row(page, 'broken-links').locator('.fix-count')).toHaveText('4 lines removed');
  await page.locator('#fix-empty-families-show').click();
  await expect(page.locator('#fix-empty-families-lines .ex-at')).toHaveText(['Line 17', 'Line 23']);
  await hook(page, w => { w.__delay = { plan: 1500 }; });
  await box(page, BROKEN).check();
  await expect(page.locator('#fix-empty-families-lines')).toHaveText('Working out the lines…');
  await expect(page.locator('#repair .fix-groups')).toHaveClass(/is-pending/);
  await expect(page.getByRole('button', { name: 'Repair everything' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Repair selected/ })).toBeDisabled();
  // The plan lands: the lines for these ticks, and the runs are back.
  await expect(page.locator('#fix-empty-families-lines .ex-at')).toHaveText(['Line 17', 'Line 23', 'Line 26'], { timeout: 10_000 });
  await expect(page.locator('#repair .fix-groups')).not.toHaveClass(/is-pending/);
  await expect(page.getByRole('button', { name: 'Repair selected (2)' })).toBeEnabled();
});

test("e2e: edits since the last Check again aren't in the repaired copy, and the card says so", async ({ page }) => {
  await upload(page, 'suggested.ged');
  await expect(page.locator('#download-repaired')).toHaveText('Download repaired file');
  await page.getByRole('button', { name: 'Edit line 11', exact: true }).first().click();
  await page.locator('.cm-line', { hasText: '1 NAME Ann /Lee/' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Jr');
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const NOTE = "Your edits since the last Check again aren't in this copy. Open the editor and choose Check again first.";
  await expect(page.locator('#repair .edits-note')).toHaveText(NOTE);
  await expect(page.locator('#download-repaired')).toHaveText('Download the last repaired copy');
  await box(page, BROKEN).check();
  await page.getByRole('button', { name: 'Repair selected (2)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 2 kinds of fix applied.');
  await expect(page.locator('#repair .edits-note')).toBeVisible();
  const bytes = await save(page, 'Download the last repaired copy');
  expect(bytes.toString('utf8')).toContain('1 NAME Ann /Lee/\n');
  expect(bytes.toString('utf8')).not.toContain('Jr');
});

test("e2e: a plan error doesn't stop the checker; the card says it can't preview, and repairs still run", async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await hook(page, w => { w.__planError = true; });
  await upload(page, 'suggested.ged');
  await expect(page.locator('#repair .plan-failed')).toHaveText("We couldn't preview these fixes.");
  await box(page, BROKEN).check();
  await page.getByRole('button', { name: 'Repair selected (2)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 2 kinds of fix applied.');
  await expect(page.locator('#repair h4', { hasText: BROKEN })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __made: number }).__made)).toBe(1); // never restarted
});

test('e2e: after Check again of an edited ANSEL file, the checklist plans the text Download gives', async ({ page }) => {
  await upload(page, 'ansel.ged');
  await expect(box(page, ENCODING)).toBeVisible();
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await page.locator('.cm-line', { hasText: 'René /Dupré/' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Jr');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('#ed-live')).toHaveText(/^Checked: /);
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#report')).not.toContainText('older character encoding');
  // The report has no encoding finding, and neither does the checklist.
  await expect(box(page, SUBMITTER)).toBeVisible();
  await expect(box(page, ENCODING)).toHaveCount(0);
  await expect(page.locator('#repair-result')).toBeHidden();
  await box(page, SUBMITTER).check();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Jo');
  await page.locator('#fix-submitter-show').click();
  await expect(page.locator('#fix-submitter-lines .ex-at')).toHaveText(['Added in the header', 'Added at the end']);
  await page.getByRole('button', { name: 'Repair selected (1)' }).click();
  await expect(page.locator('#status')).toHaveText('Repaired: 1 kind of fix applied.');
  const text = (await save(page, 'Download repaired file')).toString('utf8');
  expect(text).toContain('1 CHAR UTF-8');
  expect(text).toContain('René /Dupré/ Jr');
  expect(text).toContain('1 NAME Jo');
});

test('e2e: the lines in Show lines are a named, focusable region', async ({ page }) => {
  await upload(page, 'suggested.ged');
  await page.locator('#fix-broken-links-show').click();
  const region = page.getByRole('region', { name: `Lines for ${BROKEN}, line 11` });
  await expect(region).toHaveAttribute('tabindex', '0');
  await region.focus();
  await expect(region).toBeFocused();
});
