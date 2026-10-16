// The progress bar above the dropzone, and the smooth open/close of finding cards.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);
const HEAD = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n';

const cleanup: string[] = [];
test.afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });
function bigFile(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-e2e-'));
  cleanup.push(dir);
  const path = join(dir, 'big.ged');
  const chunks = [HEAD];
  let size = HEAD.length;
  for (let i = 1; size < bytes; i++) {
    const r = `0 @I${i}@ INDI\n1 NAME Person${i} /Family${i % 500}/\n1 SEX ${i % 2 ? 'M' : 'F'}\n`;
    chunks.push(r);
    size += r.length;
  }
  chunks.push('0 TRLR\n');
  writeFileSync(path, chunks.join(''));
  return path;
}

/** Records every [step text, aria-valuenow] the bar shows, from now on. */
async function recordBar(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __bar: [string, number][] };
    w.__bar = [];
    const bar = document.querySelector('[role="progressbar"]')!;
    const note = () => w.__bar.push([
      document.getElementById('progress-step')!.textContent ?? '', Number(bar.getAttribute('aria-valuenow'))]);
    new MutationObserver(note).observe(bar, { attributes: true, attributeFilter: ['aria-valuenow', 'aria-valuetext'] });
  });
}
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __bar: [string, number][] }).__bar);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('e2e: progress bar above the dropzone, rising through real stages, then gone', async ({ page }) => {
  await recordBar(page);
  const bar = page.getByRole('progressbar');
  await expect(bar).toBeHidden();
  await page.locator('#file').setInputFiles(fixture('royal92.ged'));
  await expect(bar).toBeVisible();
  const barBox = (await page.locator('#progress').boundingBox())!;
  const dropBox = (await page.locator('#drop').boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(dropBox.y);
  await expect(bar).toHaveAttribute('aria-valuemin', '0');
  await expect(bar).toHaveAttribute('aria-valuemax', '100');
  await expect(bar).toHaveAccessibleName(/^(Reading your file…|Getting the checker ready…|Checking…)$/);
  // The dropzone stays usable below it.
  await expect(page.getByRole('button', { name: 'Choose a file' })).toBeEnabled();

  await expect(page.locator('#report .card').first()).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(page.locator('#status')).toContainText('Checked:');

  const seen = await recorded(page);
  const checking = seen.filter(([step]) => step === 'Checking…').map(([, v]) => v);
  // Never backwards within a step, and at least three distinct values while checking.
  for (let i = 1; i < checking.length; i++) expect(checking[i]).toBeGreaterThanOrEqual(checking[i - 1]);
  expect(new Set(checking).size).toBeGreaterThanOrEqual(3);
  expect(checking.at(-1)).toBe(100);
  // valuetext is the step plus the percentage.
  await expect(page.locator('#progress-bar')).toHaveAttribute('aria-valuetext', 'Checking… 100%');
});

test('e2e: Stop hides the bar at once', async ({ page }) => {
  test.setTimeout(120_000);
  await page.locator('#file').setInputFiles(bigFile(3 * 1024 * 1024));
  const bar = page.getByRole('progressbar');
  await expect(bar).toBeVisible();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  // Stop sits on the bar's label row.
  expect(await stop.evaluate(b => b.closest('#progress') !== null)).toBe(true);
  const hiddenRightAway = await page.evaluate(() => {
    (document.getElementById('stop') as HTMLButtonElement).click();
    return document.getElementById('progress')!.hidden;
  });
  expect(hiddenRightAway).toBe(true);
  await expect(page.locator('#status')).toHaveText('Stopped.');
});

test('e2e: on a slow connection the first load shows real download progress', async ({ page }) => {
  // A fresh page whose checker download is held back, then sent.
  await page.route('**/*.wasm', async route => {
    try {
      const res = await route.fetch();
      const body = await res.body();
      await new Promise(r => setTimeout(r, 1500));
      await route.fulfill({ status: 200, body, headers: { 'content-type': 'application/wasm', 'content-length': String(body.length) } });
    } catch {
      // the first page (from beforeEach) navigated away mid-request
    }
  });
  await page.goto('/');
  await recordBar(page);
  await page.locator('#file').setInputFiles(fixture('clean.ged'));
  await expect(page.locator('#progress-step')).toHaveText('Getting the checker ready…');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.', { timeout: 30_000 });
  const loading = (await recorded(page)).filter(([step]) => step === 'Getting the checker ready…').map(([, v]) => v);
  const nonZero = loading.filter(v => v > 0);
  expect(nonZero.length).toBeGreaterThan(0);
  for (let i = 1; i < loading.length; i++) expect(loading[i]).toBeGreaterThanOrEqual(loading[i - 1]);
  expect(Math.max(...loading)).toBeGreaterThan(Math.min(...loading));
});

// ------------------------------------------------------------------ cards

async function royalReport(page: Page) {
  await page.locator('#file').setInputFiles(fixture('royal92.ged'));
  await expect(page.locator('.finding').first()).toBeVisible();
  // Settled: the bar has gone and the repaired copy (made by itself for this file) is shown.
  await expect(page.locator('#progress')).toBeHidden();
  await expect(page.getByRole('button', { name: /repaired/i }).first()).toBeVisible();
}

/** Clicks the first finding's summary in the page and samples its height every frame for 400 ms. */
function clickAndSample(page: Page, index = 0) {
  return page.evaluate(async i => {
    const d = document.querySelectorAll<HTMLDetailsElement>('details.finding')[i];
    const out: { t: number; h: number }[] = [];
    const t0 = performance.now();
    d.querySelector('summary')!.click();
    out.push({ t: 0, h: d.getBoundingClientRect().height });
    while (performance.now() - t0 < 400) {
      await new Promise(r => requestAnimationFrame(r));
      out.push({ t: performance.now() - t0, h: d.getBoundingClientRect().height });
    }
    return { samples: out, open: d.open, final: d.getBoundingClientRect().height };
  }, index);
}

test('e2e: a finding card opens and closes smoothly', async ({ page }) => {
  await royalReport(page);
  const card = page.locator('details.finding').first();
  const closedH = (await card.boundingBox())!.height;
  const opened = await clickAndSample(page);
  expect(opened.open).toBe(true);
  await expect(card).toHaveAttribute('open', '');
  const early = opened.samples.filter(s => s.t > 0 && s.t < 200).map(s => s.h);
  expect(early.length).toBeGreaterThanOrEqual(2);
  expect(new Set(early.map(h => Math.round(h))).size).toBeGreaterThanOrEqual(2); // it grows over time
  expect(early[0]).toBeLessThan(opened.final);
  expect(opened.final).toBeGreaterThan(closedH + 20);
  expect(opened.samples.at(-1)!.h).toBeCloseTo(opened.final, 0); // the final height is reached

  const closed = await clickAndSample(page);
  expect(closed.open).toBe(false);
  const shrinking = closed.samples.filter(s => s.t > 0 && s.t < 200).map(s => s.h);
  expect(new Set(shrinking.map(h => Math.round(h))).size).toBeGreaterThanOrEqual(2);
  expect(closed.final).toBeCloseTo(closedH, 0);
  await expect(card).not.toHaveAttribute('open', '');
});

test('e2e: a click in the middle of opening reverses without a jump', async ({ page }) => {
  await royalReport(page);
  const r = await page.evaluate(async () => {
    const d = document.querySelector<HTMLDetailsElement>('details.finding')!;
    const s = d.querySelector('summary')!;
    const closedH = d.getBoundingClientRect().height;
    s.click();
    await new Promise(r => setTimeout(r, 90));
    const before = d.getBoundingClientRect().height;
    s.click();
    const after = d.getBoundingClientRect().height;
    await new Promise(r => setTimeout(r, 400));
    return { closedH, before, after, open: d.open, end: d.getBoundingClientRect().height };
  });
  expect(r.before).toBeGreaterThan(r.closedH);
  expect(Math.abs(r.after - r.before)).toBeLessThan(4); // no jump
  expect(r.open).toBe(false);
  expect(r.end).toBeCloseTo(r.closedH, 0);
});

test('e2e: an opened card stays in its own column, and the page does not move', async ({ page, isMobile }) => {
  await royalReport(page);
  const li = page.locator('.findings > li').first();
  const summary = li.locator('summary');
  await summary.scrollIntoViewIfNeeded();
  const before = (await li.boundingBox())!;
  const sumBefore = (await summary.boundingBox())!;
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await summary.click();
  await expect(li.locator('details')).toHaveAttribute('open', '');
  await page.waitForTimeout(300);
  const after = (await li.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  if (!isMobile) {
    // Two columns on a desktop: the card did not take the whole row.
    const list = (await page.locator('.findings').first().boundingBox())!;
    expect(after.width).toBeLessThan(list.width * 0.75);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect((await summary.boundingBox())!.y).toBeCloseTo(sumBefore.y, 0);
});

test('e2e: Enter on a focused summary opens it, and the line viewer is built', async ({ page }) => {
  await royalReport(page);
  const card = page.locator('details.finding').first();
  await expect(card.locator('.lines')).toHaveCount(0); // built lazily
  await card.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('open', '');
  await expect(card.locator('.lines')).toBeVisible();
  await expect(card.locator('h3', { hasText: 'How to fix it' })).toBeVisible();
  await page.keyboard.press(' ');
  await expect(card).not.toHaveAttribute('open', '');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('e2e: with reduced motion a card opens at once', async ({ page }) => {
    await royalReport(page);
    const r = await page.evaluate(async () => {
      const d = document.querySelector<HTMLDetailsElement>('details.finding')!;
      d.querySelector('summary')!.click();
      await new Promise(r => requestAnimationFrame(r));
      const first = d.getBoundingClientRect().height;
      await new Promise(r => setTimeout(r, 300));
      return { open: d.open, first, end: d.getBoundingClientRect().height };
    });
    expect(r.open).toBe(true);
    expect(r.first).toBeCloseTo(r.end, 0);
  });
});
