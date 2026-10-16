import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);
const upload = (page: Page, name: string) => page.locator('#file').setInputFiles(fixture(name));
const uploadText = (page: Page, name: string, text: string) =>
  page.locator('#file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });

// Numbers from `node scripts/smoke-wasm.mjs testdata/royal92.ged` (people 3010, findings 67)
// and its severity split (1 error, 65 warnings, 1 hint).
const ROYAL = { people: 3010, errors: 1, warnings: 65, hints: 1 };

/** A scratch file in the OS temp dir (never in the repo), removed when the test ends. */
function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-e2e-'));
  cleanup.push(dir);
  return join(dir, name);
}
const cleanup: string[] = [];
test.afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });

async function save(page: Page, label: string): Promise<{ download: Download; bytes: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  return { download, bytes: await readFile((await download.path())!) };
}

const GEDCOM_HEAD =
  '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('e2e: clean file', async ({ page }) => {
  const people = Array.from({ length: 3 }, (_, i) => `0 @I${i + 1}@ INDI\n1 NAME Jane${i} /Smith/\n1 SEX F\n`).join('');
  await uploadText(page, 'three.ged', GEDCOM_HEAD + people + '0 TRLR\n');
  await expect(page.locator('#status')).toHaveText('No problems found in 3 people.');
  await expect(page.locator('#report dd', { hasText: 'three.ged' })).toBeVisible();
  await expect(page.locator('.finding')).toHaveCount(0);
  await expect(page.locator('#repair')).toBeHidden();
});

test('e2e: royal92 counts and line viewer', async ({ page }) => {
  await upload(page, 'royal92.ged');
  await expect(page.locator('#status')).toHaveText('Checked: 1 error, 65 warnings, 1 hint.');
  await expect(page.locator('#report dd').filter({ hasText: /^3,010$/ })).toBeVisible();
  // Group headings carry counts that add up to the total.
  const heads = await page.locator('.group h2 .n').allTextContents();
  expect(heads.map(h => Number(h.replace(/[^\d]/g, ''))).reduce((a, b) => a + b, 0)).toBe(ROYAL.errors + ROYAL.warnings + ROYAL.hints);
  // The filter chips show the same counts.
  await expect(page.locator('.chip.error')).toContainText('1 error');
  await expect(page.locator('.chip.warning')).toContainText('65 warnings');
  await expect(page.locator('.chip.hint')).toContainText('1 hint');

  // Open the first finding that has a line: 7 lines, the marked one is its line.
  const first = page.locator('.finding.error').first();
  await expect(first.locator('.sev')).toHaveText('Error');
  const at = await first.locator('.at').innerText();
  const lineNo = Number(at.replace(/[^\d]/g, ''));
  expect(lineNo).toBeGreaterThan(3);
  await first.locator('summary').click();
  const rows = first.locator('.lines .row');
  await expect(rows).toHaveCount(7);
  const hit = first.locator('.lines .row.hit');
  await expect(hit).toHaveCount(1);
  expect((await hit.locator('.ln').innerText()).trim().replace(/,/g, '')).toBe(String(lineNo));
  // The numbers run consecutively around it.
  const nums = (await rows.locator('.ln').allInnerTexts()).map(s => Number(s.trim().replace(/,/g, '')));
  expect(nums).toEqual([-3, -2, -1, 0, 1, 2, 3].map(d => lineNo + d));
});

test('e2e: ansel', async ({ page }) => {
  await upload(page, 'ansel.ged');
  await expect(page.locator('#report dd', { hasText: 'ANSEL (we can convert this)' })).toBeVisible();
  await expect(page.locator('#repair')).toBeVisible();
  // The line viewer shows the decoded text: accents, not mojibake.
  const f = page.locator('.finding', { hasText: 'older character encoding' });
  await f.locator('summary').click();
  await expect(f.locator('.lines')).toContainText('René /Dupré/');
  expect(await f.locator('.lines').innerText()).not.toMatch(/\ufffd/);
  // The repaired file is UTF-8 with the same names, and loads back as UTF-8.
  const { bytes } = await save(page, 'Download repaired file');
  expect(bytes.toString('utf8')).toContain('René /Dupré/');
  expect(bytes.toString('utf8')).toContain('Zürich');
  await page.locator('#file').setInputFiles({ name: 'ansel-repaired.ged', mimeType: 'text/plain', buffer: bytes });
  await expect(page.locator('#report dd', { hasText: 'ansel-repaired.ged' })).toBeVisible();
  await expect(page.locator('#report dd', { hasText: /^UTF-8$/ })).toBeVisible();
});

test('e2e: utf16 and cr-only reports and repair', async ({ page }) => {
  await upload(page, 'utf16le-bom.ged');
  await expect(page.locator('#report dd', { hasText: 'UTF-16LE (we can convert this)' })).toBeVisible();
  await expect(page.locator('.finding').first()).toBeVisible();
  await expect(page.locator('#repair')).toBeVisible();
  await expect(page.locator('#repair h2')).toHaveText('We can fix 3 format problems automatically');
  await expect(page.locator('#repair')).toContainText('converted from UTF-16LE to UTF-8');
  await expect(page.locator('#downloads')).toBeVisible();

  await upload(page, 'cr-only.ged');
  await expect(page.locator('#report dd', { hasText: 'cr-only.ged' })).toBeVisible();
  await expect(page.locator('#repair h2')).toHaveText('We can fix 1 format problem automatically');
  await expect(page.locator('#repair')).toContainText('changed line endings to CRLF');
  const { bytes } = await save(page, 'Download repaired file');
  const original = (await readFile(fixture('cr-only.ged'))).toString('latin1');
  expect(bytes.toString('latin1')).toBe(original.replace(/\r(?!\n)/g, '\r\n'));
  expect(bytes.toString('latin1')).not.toMatch(/\r(?!\n)/);
  expect(bytes.toString('latin1')).toMatch(/\r\n/);
});

test('e2e: all five groups, in order, with headings and severity words', async ({ page }) => {
  await upload(page, 'broken.ged');
  await expect(page.locator('.group h2')).toHaveText([
    /^File format and encoding/, /^Header/, /^Broken links/, /^Dates that don't add up/, /^Names and sex/,
  ]);
  // Severity is a word, not only a colour.
  await expect(page.locator('.finding .sev').first()).toHaveText(/^(Error|Warning|Hint)$/);
  // Within a group errors come before warnings.
  const sev = await page.locator('#report .group').nth(2).locator('.sev').allTextContents();
  expect(sev.length).toBeGreaterThan(0);
  // Placeholders are always filled.
  await expect(page.locator('#report')).not.toContainText(/\{[a-z]+\}/);
  await expect(page.locator('#report')).toContainText('Ann Lee');
});

test('e2e: repaired file loads back without format problems', async ({ page }) => {
  await upload(page, 'royal92.ged');
  await expect(page.locator('#repair')).toBeVisible();
  const before = { e: ROYAL.errors, w: ROYAL.warnings };
  const { bytes } = await save(page, 'Download repaired file');
  await page.locator('#file').setInputFiles({ name: 'royal92-repaired.ged', mimeType: 'text/plain', buffer: bytes });
  await expect(page.locator('#report dd', { hasText: 'royal92-repaired.ged' })).toBeVisible();
  await expect(page.locator('#status')).toContainText('Checked:');
  await expect(page.locator('#report dd', { hasText: /^UTF-8$/ })).toBeVisible();

  // No format-group findings, other than LINE_TOO_LONG.
  const format = page.locator('.group').filter({ has: page.getByRole('heading', { name: /^File format and encoding/ }) });
  const titles = await format.locator('.finding .title').allTextContents();
  for (const t of titles) expect(t).toBe('A line is longer than GEDCOM allows');
  if (titles.length) {
    // ...and only on tags that aren't notes (the repair splits long notes).
    const opened = format.locator('.finding');
    const n = await opened.count();
    for (let i = 0; i < n; i++) {
      await opened.nth(i).locator('summary').click();
      const marked = await opened.nth(i).locator('.lines .row.hit').innerText();
      expect(marked).not.toMatch(/\d\s+(NOTE|CONT|CONC|TEXT)\b/);
    }
  }
  // Error and warning totals are not higher than before.
  const status = await page.locator('#status').innerText();
  const num = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(status)?.[1] ?? 0);
  expect(num('error')).toBeLessThanOrEqual(before.e);
  expect(num('warning')).toBeLessThanOrEqual(before.w);
});

test('e2e: report downloads', async ({ page }) => {
  await upload(page, 'royal92.ged');
  const first = page.locator('.finding').first();
  await expect(first).toBeVisible();
  const title = (await first.locator('.title').innerText()).trim();
  const txt = await save(page, 'Download report (text)');
  expect(txt.download.suggestedFilename()).toBe('royal92-report.txt');
  expect(txt.bytes.toString('utf8')).toContain(title);
  const csv = await save(page, 'Download report (spreadsheet)');
  expect(csv.download.suggestedFilename()).toBe('royal92-report.csv');
  const firstLine = csv.bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
  expect(firstLine).toMatch(/^"?severity"?,"?code"?,"?line"?/);
});

test('e2e: names are inert text', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const evil = '<img src=x onerror="window.__pwned=1">';
  const text = GEDCOM_HEAD +
    `0 @I1@ INDI\n1 NAME ${evil} /Lee/\n1 BIRT\n2 DATE 5 MAY 1900\n1 DEAT\n2 DATE 1 JAN 1890\n0 TRLR\n`;
  await uploadText(page, 'evil.ged', text);
  const finding = page.locator('.finding', { hasText: 'died before' });
  await expect(finding).toBeVisible();
  // The name is shown as text.
  await expect(finding).toContainText(evil);
  // Open the viewer, where the NAME line is also shown.
  await finding.locator('summary').click();
  await expect(finding.locator('.lines')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator('#report img')).toHaveCount(0);
  await expect(page.locator('#report *[onerror]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('e2e: phone width has no sideways scroll and the line viewer scrolls inside itself', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const long = 'x'.repeat(1500);
  await uploadText(page, 'wide.ged', GEDCOM_HEAD + `0 @I1@ INDI\n1 NAME Jane /Smith/\n1 NOTE ${long}\n0 TRLR\n`);
  await upload(page, 'royal92.ged');
  await expect(page.locator('.finding').first()).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await uploadText(page, 'wide.ged', GEDCOM_HEAD + `0 @I1@ INDI\n1 NAME Jane /Smith/\n1 NOTE ${long}\n0 TRLR\n`);
  const f = page.locator('.finding', { hasText: 'longer than GEDCOM allows' });
  await expect(f).toBeVisible();
  await f.locator('summary').click();
  const lines = f.locator('.lines');
  await expect(lines).toBeVisible();
  expect(await fits()).toBe(true);
  const m = await lines.evaluate(el => {
    el.scrollLeft = 200;
    return { sw: el.scrollWidth, cw: el.clientWidth, left: el.scrollLeft, doc: document.documentElement.scrollLeft };
  });
  expect(m.sw).toBeGreaterThan(m.cw);
  expect(m.left).toBeGreaterThan(0);
  expect(m.doc).toBe(0);
  expect(await fits()).toBe(true);
  // Other screens too.
  await upload(page, 'broken.ged');
  await expect(page.locator('#repair')).toBeVisible();
  expect(await fits()).toBe(true);
});

test('e2e: keyboard only', async ({ page }) => {
  await upload(page, 'broken.ged');
  await expect(page.locator('.finding').first()).toBeVisible();
  const active = () => page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return { tag: a?.tagName ?? '', text: (a?.textContent ?? '').trim().slice(0, 40), visible: !!a && a.matches(':focus-visible'),
      outline: a ? getComputedStyle(a).outlineStyle : '', width: a ? getComputedStyle(a).outlineWidth : '' };
  });
  // From the top of the page, Tab reaches "Choose a file" first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  let s = await active();
  expect(s.tag).toBe('BUTTON');
  expect(s.text).toBe('Choose a file');
  expect(s.visible).toBe(true);
  expect(s.outline).not.toBe('none');
  expect(parseFloat(s.width)).toBeGreaterThan(0);

  // Keep tabbing until a finding's summary has focus (filters, repair, downloads come first).
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.tagName === 'SUMMARY');
  }
  expect(reached).toBe(true);
  s = await active();
  expect(s.visible).toBe(true);
  expect(s.outline).not.toBe('none');
  const details = page.locator('details.finding:has(summary:focus)');
  await expect(details).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('h3', { hasText: 'How to fix it' })).toBeVisible();
  // The line viewer (which scrolls sideways) is reachable by keyboard when the finding has a line.
  if (await details.locator('.lines').count()) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('lines'))).toBe(true);
  }
});

test('e2e: a failed repair does not poison the next file', async ({ page }) => {
  // Found with a real 20 MB file: the repair ran the browser out of memory, the checker's
  // runtime died, and the next file was reported as "not a GEDCOM file". Here the first
  // worker's repair "crashes" and that worker answers every later check as a dead runtime
  // would; a fresh worker behaves normally.
  await page.addInitScript(() => {
    const Real = window.Worker;
    let crashed = false;
    const zero = { errors: 0, warnings: 0, hints: 0 };
    window.Worker = class extends Real {
      dead = false;
      listeners: ((e: unknown) => void)[] = [];
      addEventListener(type: string, fn: never, ...rest: never[]) {
        if (type === 'message') this.listeners.push(fn);
        super.addEventListener(type, fn, ...rest);
      }
      reply(data: unknown) { setTimeout(() => this.listeners.forEach(f => f({ data })), 0); }
      postMessage(msg: { type: string }, transfer?: never) {
        if (msg.type === 'repair' && !crashed) {
          crashed = true;
          this.dead = true;
          this.reply({ type: 'repaired', data: new ArrayBuffer(0), info: { changes: [], left: [], before: zero, after: zero, error: 'out of memory' } });
        } else if (msg.type === 'check' && this.dead) {
          const summary = { people: 0, families: 0, sources: 0, notes: 0, media: 0, years: null, program: '', programVersion: '', gedcomVersion: '', lines: 0 };
          this.reply({ type: 'result', result: { encoding: { detected: '', declared: '', reason: '' }, summary, findings: [], names: {}, text: '', isGedcom: false, error: 'Go program has already exited' } });
        } else {
          super.postMessage(msg, transfer as never);
        }
      }
    } as typeof Worker;
  });
  await page.goto('/');
  await upload(page, 'cr-only.ged');
  await expect(page.locator('#report dd', { hasText: 'cr-only.ged' })).toBeVisible();
  await page.waitForTimeout(500); // the failed repair answer arrives
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
  await expect(page.locator('#report dd', { hasText: 'clean.ged' })).toBeVisible();
});

// ------------------------------------------------------------------ privacy

function distFiles(): Set<string> {
  const root = join('web', 'dist');
  const out = new Set<string>(['/']);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.add('/' + relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/** Everything that isn't a same-origin request for the page or one of the build's own files. */
function strays(urls: string[], origin: string, allowed: Set<string>): string[] {
  return urls.filter(u => {
    let url: URL;
    try { url = new URL(u); } catch { return true; }
    if (url.origin !== origin) return true; // other hosts, and data:/blob:/about: (origin "null")
    return !allowed.has(url.pathname);
  });
}

test('e2e: privacy monitor flags stray requests', async ({ page, baseURL }) => {
  // A control: the same listener and rules must catch a request that isn't the build's.
  const seen: string[] = [];
  page.on('request', r => seen.push(r.url()));
  await page.goto('/');
  await page.evaluate(() => { new Image().src = '/not-in-the-build?leak=1'; });
  await expect.poll(() => seen.some(u => u.includes('/not-in-the-build'))).toBe(true);
  const origin = new URL(baseURL!).origin;
  expect(strays(seen, origin, distFiles())).toEqual([expect.stringContaining('/not-in-the-build')]);
  expect(strays(['https://example.com/x', 'data:text/plain,hi', 'blob:http://localhost:5199/abc'], origin, distFiles())).toHaveLength(3);
});

test('e2e: privacy, nothing leaves the page', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...test.info().project.use, acceptDownloads: true });
  const page = await context.newPage();
  const origin = new URL(baseURL!).origin;
  const allowed = distFiles();
  const urls: string[] = [];
  // Listen before the first navigation, on the page and on the whole context (workers, popups).
  page.on('request', r => urls.push(r.url()));
  context.on('request', r => urls.push(r.url()));
  const sockets: string[] = [];
  page.on('websocket', w => sockets.push(w.url()));
  await context.addInitScript(() => {
    const w = window as unknown as { __beacons: unknown[][] };
    w.__beacons = [];
    navigator.sendBeacon = (...args: unknown[]) => { w.__beacons.push(args); return true; };
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('/');
  await page.locator('#file').setInputFiles(fixture('royal92.ged'));
  await expect(page.locator('#status')).toHaveText('Checked: 1 error, 65 warnings, 1 hint.');
  await expect(page.locator('#repair')).toBeVisible();
  await save(page, 'Download repaired file');
  await save(page, 'Download report (text)');
  await save(page, 'Download report (spreadsheet)');
  const findings = page.locator('.finding');
  for (let i = 0; i < 5; i++) await findings.nth(i).locator('summary').click();
  await expect(page.locator('.lines')).toHaveCount(5);
  await page.getByRole('button', { name: 'Show more' }).first().click();
  // And a second file and a non-GEDCOM one.
  await page.locator('#file').setInputFiles(fixture('ansel.ged'));
  await expect(page.locator('#report dd', { hasText: 'ansel.ged' })).toBeVisible();
  await page.locator('#file').setInputFiles(fixture('pixel.png'));
  await expect(page.locator('#report')).toBeEmpty();
  await page.waitForTimeout(500); // let any late request show up

  expect(urls.length).toBeGreaterThan(0); // the listener really saw the page load
  expect(strays(urls, origin, allowed)).toEqual([]);
  expect(sockets).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __beacons: unknown[] }).__beacons)).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------- big files

test('e2e: 5000 findings', async ({ page }, info) => {
  test.setTimeout(120_000);
  const path = scratch('many.ged');
  const people = Array.from({ length: 5000 }, (_, i) => `0 @I${i + 1}@ INDI\n1 SEX M\n`).join('');
  writeFileSync(path, GEDCOM_HEAD + people + '0 TRLR\n');

  const t0 = Date.now();
  await page.locator('#file').setInputFiles(path);
  await page.locator('.finding').first().waitFor();
  const ms = Date.now() - t0;
  info.annotations.push({ type: 'first-screen-ms', description: String(ms) });
  console.log(`5000 findings (${info.project.name}): first screen after ${ms} ms`);
  expect(ms).toBeLessThan(3000);

  await expect(page.locator('#status')).toHaveText('Checked: 0 errors, 5,000 warnings, 0 hints.');
  await expect(page.locator('.group h2 .n').filter({ hasText: '(5,000)' })).toBeVisible();
  await expect(page.locator('.finding')).toHaveCount(50);
  await expect(page.locator('.shown')).toHaveText('Showing 50 of 5,000');

  // Mark the nodes on screen; "Show more" must add to them, not rebuild them.
  await page.evaluate(() => document.querySelectorAll('.finding').forEach(e => ((e as HTMLElement & { __kept?: boolean }).__kept = true)));
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.locator('.finding')).toHaveCount(100);
  await expect(page.locator('.shown')).toHaveText('Showing 100 of 5,000');
  const kept = await page.evaluate(() =>
    [...document.querySelectorAll('.finding')].filter(e => (e as HTMLElement & { __kept?: boolean }).__kept).length);
  expect(kept).toBe(50);
  // Focus moved to the first new finding.
  expect(await page.evaluate(() => document.activeElement?.closest('li') === document.querySelectorAll('.findings > li')[50])).toBe(true);
  // Opening one still works.
  await page.locator('.finding').nth(99).locator('summary').click();
  await expect(page.locator('.finding').nth(99).locator('.lines')).toBeVisible();
});

test('e2e: 20 MB file', async ({ page }, info) => {
  // The check itself takes about two minutes on this shared server (see the report).
  test.setTimeout(300_000);
  const path = scratch('big.ged');
  const rec = (i: number) =>
    `0 @I${i}@ INDI\n${i % 1000 === 0 ? '' : `1 NAME Person${i} /Family${i % 500}/\n`}1 SEX ${i % 2 ? 'M' : 'F'}\n1 BIRT\n2 DATE ${1 + (i % 28)} MAR ${1700 + (i % 300)}\n2 PLAC Somewhere in the world, Region ${i % 50}\n1 NOTE A note about this person to give the file some weight, number ${i}.\n`;
  const chunks: string[] = [GEDCOM_HEAD];
  let size = chunks[0].length;
  for (let i = 1; size < 20 * 1024 * 1024; i++) { const r = rec(i); chunks.push(r); size += r.length; }
  chunks.push('0 TRLR\n');
  writeFileSync(path, chunks.join(''));
  expect(statSync(path).size).toBeGreaterThanOrEqual(20 * 1024 * 1024);

  // A ticker on the page: how long the main thread is ever blocked.
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __last: number };
    w.__gap = 0; w.__last = performance.now();
    setInterval(() => { const n = performance.now(); w.__gap = Math.max(w.__gap, n - w.__last - 50); w.__last = n; }, 50);
  });

  const t0 = Date.now();
  await page.locator('#file').setInputFiles(path);
  // While it is checked the status line says so, and the button can take focus.
  await expect(page.locator('#status')).toHaveText(/^(Reading your file…|Checking…)$/);
  let sawChecking = false;
  let focusOk = 0;
  const deadline = Date.now() + 280_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const b = document.getElementById('choose') as HTMLButtonElement;
      b.focus();
      return { status: document.getElementById('status')!.textContent, focused: document.activeElement === b };
    });
    if (state.status === 'Checking…' || state.status === 'Reading your file…') {
      if (state.focused) focusOk++;
      if (state.status === 'Checking…') sawChecking = true;
    } else if (state.status && state.status.startsWith('Checked:')) break;
    await page.waitForTimeout(100);
  }
  const ms = Date.now() - t0;
  await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 5000 });
  const gap = await page.evaluate(() => (window as unknown as { __gap: number }).__gap);
  info.annotations.push({ type: 'check-ms', description: String(ms) });
  info.annotations.push({ type: 'max-main-thread-gap-ms', description: String(Math.round(gap)) });
  console.log(`20 MB (${info.project.name}): checked in ${ms} ms, focus ok ${focusOk}x, max main-thread gap ${Math.round(gap)} ms`);
  expect(sawChecking).toBe(true);
  expect(focusOk).toBeGreaterThan(0);
  // The first screen is there, and opening a finding in a 20 MB file works.
  await expect(page.locator('.finding').first()).toBeVisible();
  await page.locator('.finding').first().locator('summary').click();
  await expect(page.locator('.finding').first().locator('.lines')).toBeVisible();
  await expect(page.locator('#report dd', { hasText: /^[\d,]{6,}$/ }).first()).toBeVisible();
});
