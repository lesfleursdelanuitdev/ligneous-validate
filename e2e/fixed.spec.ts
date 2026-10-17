// After a repair the visitor asks for, the findings its copy no longer has are
// marked in the list: struck through, muted, with a badge that says the fix is
// in the repaired copy (the original still has them).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);

const BLANK = 'Remove blank lines';
const BROKEN = "Remove links to records that don't exist";
const box = (page: Page, label: string) => page.getByRole('checkbox', { name: label, exact: true });
const fixedCards = (page: Page) => page.locator('.finding.is-fixed');
const chip = (page: Page) => page.locator('.chip.fixed');
const heading = (page: Page, name: string) => page.locator('.group h2', { hasText: name });

/** suggested.ged, checked, with its automatic copy made. */
async function open(page: Page) {
  await page.goto('/');
  await page.locator('#file').setInputFiles(fixture('suggested.ged'));
  await expect(page.locator('#status')).toHaveText(/^Checked: /);
  await expect(page.getByRole('button', { name: 'Download repaired file' })).toBeVisible();
}

async function save(page: Page, label: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  return (await readFile((await download.path())!)).toString('utf8');
}

test('e2e fixed: the automatic copy marks nothing; Repair everything marks what its copy fixed, with counts', async ({ page }) => {
  await open(page);
  await expect(fixedCards(page)).toHaveCount(0);
  await expect(chip(page)).toBeHidden();
  await page.getByRole('button', { name: 'Repair everything' }).click();
  await expect(page.locator('#status')).toHaveText(/^Repaired: /);
  // The submitter needs a name, so it is left out: that finding stays unmarked.
  await expect(fixedCards(page).locator('.title')).toHaveText([
    'Blank line',
    "Ann Lee is a child of a family that doesn't exist",
    "A family's child doesn't exist",
    "A family's husband doesn't exist",
    'A family with nobody in it',
  ]);
  await expect(page.locator('.finding:not(.is-fixed) .title')).toHaveText(["The file doesn't say who made it"]);
  // Struck through, and said in text too.
  await expect(fixedCards(page).locator('.title s')).toHaveCount(5);
  await expect(fixedCards(page).locator('.fixed-badge')).toHaveText(Array(5).fill('Fixed in your repaired copy'));
  await expect(fixedCards(page).first().locator('summary')).toContainText('Fixed in your repaired copy');
  await expect(heading(page, 'File format and encoding')).toHaveText('File format and encoding (1 · 1 fixed in the repaired copy)');
  await expect(heading(page, 'Header')).toHaveText('Header (1)');
  await expect(heading(page, 'Broken links')).toHaveText('Broken links (4 · 4 fixed in the repaired copy)');
  await expect(chip(page)).toHaveText('5 fixed in the repaired copy');
  // Never just "Fixed".
  await expect(page.locator('#findings')).not.toContainText(/Fixed(?! in)/);
  // The spreadsheet says which, with the formula protection kept (every field quoted).
  const csv = await save(page, 'Download report (spreadsheet)');
  const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
  expect(rows[0]).toBe('"severity","code","line","title","people","meaning","fixed in the repaired copy"');
  expect(rows.filter(r => r.endsWith(',"yes"'))).toHaveLength(5);
  expect(rows.filter(r => r.endsWith(',"no"'))).toHaveLength(1);
  const text = await save(page, 'Download report (text)');
  expect(text).toContain('5 of these are fixed in the repaired copy; your original file still has them.');
  expect(text).toContain('Blank line [fixed in the repaired copy]');
});

test('e2e fixed: a partial repair marks only what it fixed', async ({ page }) => {
  await open(page);
  await box(page, BROKEN).check(); // blank lines (ticked by default) and broken links
  await page.getByRole('button', { name: 'Repair selected (2)' }).click();
  await expect(page.locator('#status')).toHaveText(/^Repaired: /);
  await expect(fixedCards(page).locator('.title')).toHaveText([
    'Blank line',
    "Ann Lee is a child of a family that doesn't exist",
    "A family's child doesn't exist",
    "A family's husband doesn't exist",
  ]);
  await expect(chip(page)).toHaveText('4 fixed in the repaired copy');
  await expect(heading(page, 'Broken links')).toHaveText('Broken links (4 · 3 fixed in the repaired copy)');
  // Only blank lines this time: the marks are replaced.
  await box(page, BROKEN).uncheck();
  await page.getByRole('button', { name: 'Repair selected (1)' }).click();
  await expect(chip(page)).toHaveText('1 fixed in the repaired copy');
  await expect(fixedCards(page).locator('.title')).toHaveText(['Blank line']);
});

test('e2e fixed: when the choices change, the marks say they are the last copy\'s', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Repair selected (1)' }).click();
  await expect(chip(page)).toHaveText('1 fixed in the repaired copy');
  await box(page, BLANK).uncheck();
  await expect(page.locator('#repair .stale')).toBeVisible();
  await expect(chip(page)).toHaveText('1 fixed in the last repaired copy');
  await expect(fixedCards(page).locator('.fixed-badge')).toHaveText(['Fixed in the last repaired copy']);
  await expect(heading(page, 'File format and encoding')).toHaveText('File format and encoding (1 · 1 fixed in the last repaired copy)');
  const csv = await save(page, 'Download report (spreadsheet)');
  expect(csv.split('\r\n')[0]).toContain('"fixed in the last repaired copy"');
  // Back to the choices of the run: the copy is up to date again.
  await box(page, BLANK).check();
  await expect(page.locator('#repair .stale')).toBeHidden();
  await expect(chip(page)).toHaveText('1 fixed in the repaired copy');
});

test('e2e fixed: the filter hides the fixed findings and shows them again', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Repair everything' }).click();
  await expect(chip(page)).toHaveText('5 fixed in the repaired copy');
  await expect(page.locator('.finding')).toHaveCount(6);
  const pill = page.getByRole('checkbox', { name: '5 fixed in the repaired copy' });
  await expect(pill).toBeChecked();
  await pill.uncheck();
  await expect(page.locator('.finding')).toHaveCount(1);
  await expect(fixedCards(page)).toHaveCount(0);
  await expect(page.locator('.group h2')).toHaveText(['Header (1)']);
  // Unticking the severities too says how to get them back.
  for (const name of ['3 errors', '3 warnings', '0 hints']) await page.getByRole('checkbox', { name }).uncheck();
  await expect(page.locator('#findings .empty')).toHaveText('Nothing to show. Tick Errors, Warnings, Hints or the fixed ones above.');
  for (const name of ['3 errors', '3 warnings', '0 hints']) await page.getByRole('checkbox', { name }).check();
  await pill.check();
  await expect(page.locator('.finding')).toHaveCount(6);
  await expect(fixedCards(page)).toHaveCount(5);
});

test('e2e fixed: Check again from the editor replaces the report, and the marks go', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Repair selected (1)' }).click();
  await expect(fixedCards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Open the editor' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('#ed-live')).toHaveText(/^Checked: /);
  await expect(fixedCards(page)).toHaveCount(0);
  await expect(chip(page)).toBeHidden();
  await expect(page.locator('.group h2 .n').first()).not.toContainText('fixed');
});
