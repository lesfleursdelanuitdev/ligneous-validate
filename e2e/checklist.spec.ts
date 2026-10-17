// The repair checklist: choosing which fixes to apply (library v0.3.0).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
  await expect(page.locator('#repair h2')).toHaveText('We can fix 1 kind of format problem');
  const format = page.getByRole('group', { name: 'Format fixes' });
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
  const data = page.getByRole('group', { name: 'Suggested fixes — these change your family data' });
  await expect(data).toBeVisible();
  await expect(data).toContainText('These remove or add records. Look at what they change before you download.');
  for (const label of [BROKEN, EMPTY, SUBMITTER]) await expect(box(page, label)).not.toBeChecked();
  await expect(box(page, 'Remove blank lines')).toBeChecked();
  await expect(row(page, 'broken-links').locator('.fix-count')).toHaveText('4 lines removed');

  // Show lines lists each link with the lines nested under it.
  await row(page, 'broken-links').getByRole('button', { name: 'Show lines' }).click();
  const lines = row(page, 'broken-links').locator('.fix-lines-body');
  await expect(lines.locator('ol.ex > li > .ex-line code')).toHaveText(['1 FAMC @F9@', '1 CHIL @I7@', '1 HUSB @I99@']);
  await expect(lines.locator('.ex-nested code')).toHaveText(['2 PEDI birth']);

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
  await expect(page.locator('#repair h2')).toHaveText('No format problems to fix');
  await expect(box(page, SUBMITTER)).not.toBeChecked();
  await expect(page.locator('#repair-result')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Download/ }).filter({ hasText: 'repaired' })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Repair selected (2)' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Repaired: 2 kinds of fix applied.');
  const show = page.locator('#fix-broken-links-show');
  await expect(show).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#fix-broken-links-lines')).toBeVisible();
  await expect(page.locator('#fix-broken-links-lines .ex-nested code')).toHaveText(['2 PEDI birth']);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('repair-selected');
});
