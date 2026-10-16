import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);
const NOT_GEDCOM =
  'This doesn\'t look like a GEDCOM file. GEDCOM files usually end in .ged and start with "0 HEAD".';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('e2e: not a gedcom file', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.locator('#file').setInputFiles(fixture('pixel.png'));
  await expect(page.locator('#status')).toHaveText(NOT_GEDCOM);
  // No empty report: nothing at all in the report area.
  await expect(page.locator('#report')).toBeEmpty();
  await expect(page.locator('#report .card')).toHaveCount(0);
  expect(errors).toEqual([]);
  // The page still works afterwards.
  await page.locator('#file').setInputFiles(fixture('clean.ged'));
  await expect(page.locator('#report .card')).toBeVisible();
});

test('e2e: second file resets the report', async ({ page }) => {
  await page.locator('#file').setInputFiles(fixture('cr-only.ged'));
  await expect(page.locator('#report .card')).toBeVisible();
  await expect(page.locator('#report dd', { hasText: 'cr-only.ged' })).toBeVisible();
  await expect(page.locator('#repair')).toBeVisible();
  const first = page.locator('.finding').first();
  await expect(first).toBeVisible();
  await first.locator('summary').click();
  await expect(page.locator('.lines')).toBeVisible();

  // A clean file replaces everything from the first.
  await page.locator('#file').setInputFiles(fixture('clean.ged'));
  await expect(page.locator('#status')).toHaveText(/^No problems found in 1 person\.$/);
  await expect(page.locator('#report dd', { hasText: 'clean.ged' })).toBeVisible();
  await expect(page.locator('#report dd', { hasText: 'cr-only.ged' })).toHaveCount(0);
  await expect(page.locator('.finding')).toHaveCount(0);
  await expect(page.locator('.lines')).toHaveCount(0);
  await expect(page.locator('#repair')).toBeHidden();
  await expect(page.locator('#downloads')).toBeHidden();

  // And so does a file that isn't GEDCOM.
  await page.locator('#file').setInputFiles(fixture('pixel.png'));
  await expect(page.locator('#status')).toHaveText(NOT_GEDCOM);
  await expect(page.locator('#report')).toBeEmpty();
});

test('e2e: downloads', async ({ page }) => {
  // A file with no end marker: the repair adds "0 TRLR", and the catalog's `0 TRLR` shows as <code>.
  await page.locator('#file').setInputFiles(fixture('no-trailer.ged'));
  await expect(page.locator('#repair')).toBeVisible();
  await expect(page.locator('#repair h2')).toHaveText('We can fix 1 format problem automatically');
  await expect(page.locator('#report')).not.toContainText('`');
  await expect(page.locator('.finding .meaning code').first()).toHaveText('0 TRLR');

  const grab = async (label: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
    return { name: dl.suggestedFilename(), bytes: await readFile((await dl.path())!) };
  };

  const fixed = await grab('Download repaired file');
  expect(fixed.name).toBe('no-trailer-repaired.ged');
  expect(fixed.bytes.equals(await readFile(fixture('no-trailer.repaired.ged')))).toBe(true);

  const txt = await grab('Download report (text)');
  expect(txt.name).toBe('no-trailer-report.txt');
  const text = txt.bytes.toString('utf8');
  expect(text).toMatch(/^Check report for no-trailer\.ged\n/);
  expect(text).not.toContain('`');

  const csv = await grab('Download report (spreadsheet)');
  expect(csv.name).toBe('no-trailer-report.csv');
  expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.bytes.toString('utf8').slice(1)).toMatch(/^"severity","code","line"/);
});
