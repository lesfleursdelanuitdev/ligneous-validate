// Checker failures, huge repairs, big files, honest repair copy, load failures.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = (name: string) => join('e2e', 'fixtures', name);
const upload = (page: Page, name: string) => page.locator('#file').setInputFiles(fixture(name));
const uploadText = (page: Page, name: string, text: string) =>
  page.locator('#file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });

const FAILED = 'The checker ran into a problem with this file and had to stop. Your file has not been changed. ' +
  'If it is very large, try exporting a smaller part of your tree.';
const NOT_GEDCOM = 'This doesn\'t look like a GEDCOM file. GEDCOM files usually end in .ged and start with "0 HEAD".';
const NO_WASM = "This browser couldn't start the checker. Try a current version of Firefox, Chrome, Safari or Edge.";
const LOAD_FAILED = "The checker didn't finish loading. Check your connection and try again.";
const HEAD = '0 HEAD\n1 SOUR TestSystem\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @U1@\n0 @U1@ SUBM\n1 NAME Test\n';

const cleanup: string[] = [];
test.afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });
function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-e2e-'));
  cleanup.push(dir);
  return join(dir, name);
}

/** A GEDCOM file of about `bytes` bytes of plain people, with `extra` appended before the trailer. */
function bigFile(bytes: number, extra = ''): string {
  const path = scratch('big.ged');
  const chunks = [HEAD];
  let size = HEAD.length;
  for (let i = 1; size < bytes; i++) {
    const r = `0 @I${i}@ INDI\n1 NAME Person${i} /Family${i % 500}/\n1 SEX ${i % 2 ? 'M' : 'F'}\n1 NOTE A note to give the file some weight, number ${i}.\n`;
    chunks.push(r);
    size += r.length;
  }
  chunks.push(extra, '0 TRLR\n');
  writeFileSync(path, chunks.join(''));
  return path;
}

/**
 * Counts workers and the messages sent to them, and lets a test take over
 * the first worker's answers: `__fake(type, reply)` makes every later message
 * of that type to the current worker get `reply` instead of reaching it.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const Real = window.Worker;
    const w = window as unknown as {
      __made: number; __sent: string[]; __fakes: Record<string, unknown>; __crashOn: string | null;
    };
    w.__made = 0; w.__sent = []; w.__fakes = {}; w.__crashOn = null;
    window.Worker = class extends Real {
      listeners: ((e: unknown) => void)[] = [];
      constructor(...a: ConstructorParameters<typeof Worker>) { super(...a); w.__made++; }
      addEventListener(type: string, fn: never, ...rest: never[]) {
        if (type === 'message') this.listeners.push(fn);
        super.addEventListener(type, fn, ...rest);
      }
      postMessage(msg: { type: string }, transfer?: never) {
        w.__sent.push(msg.type);
        if (w.__crashOn === msg.type) {
          w.__crashOn = null;
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'out of memory' })), 50);
          return;
        }
        const fake = w.__fakes[msg.type];
        if (fake) {
          delete w.__fakes[msg.type];
          setTimeout(() => this.listeners.forEach(f => f({ data: fake })), 50);
          return;
        }
        super.postMessage(msg, transfer as never);
      }
    } as typeof Worker;
  });
}
const made = (page: Page) => page.evaluate(() => (window as unknown as { __made: number }).__made);
const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);
const zero = { errors: 0, warnings: 0, hints: 0 };

// ------------------------------------------------------------------ item 1

test('e2e: a checker failure is not called "not GEDCOM", and the next file works', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  const summary = { people: 0, families: 0, sources: 0, notes: 0, media: 0, years: null, program: '', programVersion: '', gedcomVersion: '', lines: 0 };
  await page.evaluate(s => {
    (window as unknown as { __fakes: Record<string, unknown> }).__fakes.check = { type: 'result', result:
      { encoding: { detected: '', declared: '', reason: '' }, summary: s, findings: [], names: {}, text: '', isGedcom: false, error: 'runtime error: out of memory' } };
  }, summary);
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText(FAILED);
  await expect(page.locator('#status')).not.toHaveText(NOT_GEDCOM);
  await expect(page.locator('#report')).toBeEmpty();
  expect(await made(page)).toBe(2); // restarted
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
});

test('e2e: a worker crash during the check gives the failure message and a fresh worker', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await page.waitForTimeout(500); // the checker is loaded
  await page.evaluate(() => { (window as unknown as { __crashOn: string }).__crashOn = 'check'; });
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText(FAILED);
  await expect(page.locator('#report')).toBeEmpty();
  expect(await made(page)).toBe(2);
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
});

// ------------------------------------------------------------------ item 2

test('e2e: 280,000 repair changes are grouped, not listed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await instrument(page);
  await page.goto('/');
  await page.evaluate(() => {
    const changes = [{ line: 0, what: 'changed line endings to CRLF' }];
    for (let i = 0; i < 280_000; i++) changes.push({ line: i + 2, what: 'removed spaces before the level number' });
    (window as unknown as { __fakes: Record<string, unknown> }).__fakes.repair = { type: 'repaired', data: new ArrayBuffer(4),
      info: { changes, left: [], before: { errors: 0, warnings: 280_000, hints: 0 }, after: { errors: 0, warnings: 0, hints: 0 } } };
  });
  await upload(page, 'cr-only.ged');
  await expect(page.locator('#repair')).toBeVisible();
  await expect(page.locator('#repair .changes li')).toHaveText([
    'Changed line endings to CRLF',
    'Removed spaces before the level number: 280,000 lines (2, 3, 4, 5, 6, …)',
  ]);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ item 3

test('e2e: a large file gets a size note and can be stopped', async ({ page }) => {
  test.setTimeout(120_000);
  await instrument(page);
  await page.goto('/');
  const path = bigFile(3 * 1024 * 1024);
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#note')).toHaveText(
    'This is a large file, so checking may take up to a minute. You can use other tabs meanwhile.');
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.locator('#status')).toHaveText('Stopped.');
  await expect(page.locator('#report')).toBeEmpty();
  await expect(stop).toBeHidden();
  await expect(page.locator('#note')).toBeHidden();
  expect(await made(page)).toBe(2);
  // Start state: the next file is checked normally.
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
});

test('e2e: above 10 MB the note says a few minutes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.locator('#file').setInputFiles(bigFile(10 * 1024 * 1024 + 100));
  await expect(page.locator('#note')).toHaveText(
    'This is a large file, so checking may take a few minutes. You can use other tabs meanwhile.');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('#status')).toHaveText('Stopped.');
});

test('e2e: above 5 MB the repair waits for a click and runs in a fresh worker', async ({ page }) => {
  test.setTimeout(300_000);
  await instrument(page);
  await page.goto('/');
  const path = bigFile(5 * 1024 * 1024 + 50_000, '\n'); // one blank line: a format problem
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#status')).toHaveText(/^Checked: /, { timeout: 240_000 });
  const make = page.getByRole('button', { name: 'Make a repaired copy' });
  await expect(make).toBeVisible();
  await expect(page.locator('#repair')).toContainText('This may take several minutes.');
  expect(await sent(page)).not.toContain('repair');
  const before = await made(page);
  await make.click();
  await expect(page.locator('#repair h2')).toHaveText('We can fix 1 format problem automatically', { timeout: 240_000 });
  expect(await made(page)).toBe(before + 1);
  await expect(page.locator('#repair .changes li')).toHaveText([/^Removed a blank line: 1 line \(\d[\d,]*\)$/]);
  await expect(page.getByRole('button', { name: 'Download repaired file' })).toBeVisible();
});

test('e2e: a file with nothing to repair runs no repair', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
  await upload(page, 'broken.ged'); // has format problems, so it is repaired
  await expect(page.locator('#report .card')).toBeVisible();
  await page.waitForTimeout(500);
  const types = await sent(page);
  expect(types.filter(t => t === 'check')).toHaveLength(2);
  expect(types.filter(t => t === 'repair')).toHaveLength(1);
  expect(types.indexOf('repair')).toBeGreaterThan(types.lastIndexOf('check'));
});

// ------------------------------------------------------------------ item 4

test('e2e: a failed repair says so in one line', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await page.evaluate(z => {
    (window as unknown as { __fakes: Record<string, unknown> }).__fakes.repair =
      { type: 'repaired', data: new ArrayBuffer(0), info: { changes: [], left: [], before: z, after: z, error: 'out of memory' } };
  }, zero);
  await upload(page, 'cr-only.ged');
  await expect(page.locator('#repair')).toBeVisible();
  await expect(page.locator('#repair')).toHaveText("We couldn't make a repaired copy of this file.");
  await expect(page.locator('#repair button')).toHaveCount(0);
});

test('e2e: a clean file with a bare-CR or BOM gets an optional tidy-up', async ({ page }) => {
  await page.goto('/');
  for (const name of ['clean-cr.ged', 'clean-bom.ged']) {
    await upload(page, name);
    await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
    await expect(page.locator('#repair h2')).toHaveText('Optional tidy-up');
    await expect(page.locator('#repair')).toContainText('Keep your original file. This is a new copy.');
    await expect(page.getByRole('button', { name: 'Download repaired file' })).toBeVisible();
  }
});

test('e2e: the repair copy says the file is on this page, next to a keep-your-original note', async ({ page }) => {
  await page.goto('/');
  // No CHAR line: ENCODING_UNDECLARED, whose fix points to the repaired file.
  await uploadText(page, 'nochar.ged', HEAD.replace('1 CHAR UTF-8\n', '') + '0 @I1@ INDI\n1 NAME Ann /Lee/\n0 TRLR\n');
  const f = page.locator('.finding', { hasText: "doesn't say which character set" });
  await f.locator('summary').click();
  await expect(f).toContainText('Download the repaired file on this page, which says UTF-8 in its header.');
  await expect(page.locator('#report')).not.toContainText('repaired file below');
  const button = page.getByRole('button', { name: 'Download repaired file' });
  await expect(button).toBeVisible();
  await expect(page.locator('#repair .keep')).toHaveText('Keep your original file. This is a new copy.');
});

// ------------------------------------------------------------------ item 5

test('e2e: the leftover list names nobody', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'broken.ged');
  await expect(page.locator('#repair .left li').first()).toBeVisible();
  const items = await page.locator('#repair .left li').allTextContents();
  for (const t of items) {
    expect(t).not.toMatch(/Lee|Smith|@[A-Z]+\d+@/);
    expect(t).toMatch(/^[A-Z].*( \(\d[\d,]*\)|: \d[\d,]*)$/);
  }
});

// ------------------------------------------------------------------ item 6

test('e2e: a wasm load failure can be retried', async ({ page }) => {
  await page.context().route(/\.wasm$/, r => r.abort());
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText(LOAD_FAILED, { timeout: 20_000 });
  const retry = page.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible();
  await page.context().unroute(/\.wasm$/);
  await retry.click();
  await expect(retry).toBeHidden();
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.');
});

test('e2e: no WebAssembly keeps the browser message, with no retry', async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as { WebAssembly?: unknown }).WebAssembly; });
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText(NO_WASM);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
});

test('e2e: the status says the checker is getting ready while it loads', async ({ page }) => {
  await page.context().route(/\.wasm$/, async r => { await new Promise(res => setTimeout(res, 2500)); await r.continue(); });
  await page.goto('/');
  await upload(page, 'clean.ged');
  await expect(page.locator('#status')).toHaveText('Getting the checker ready…');
  await expect(page.locator('#status')).toHaveText('No problems found in 1 person.', { timeout: 20_000 });
});

// ------------------------------------------------------------------ minors

test('e2e: names from the file are kept away from translators', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'broken.ged');
  await expect(page.locator('.finding .title span[translate="no"]', { hasText: 'Ann Lee' }).first()).toBeVisible();
});

test('e2e: the repaired file downloads as octet-stream, and the text report lists the changes', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __types: string[] };
    w.__types = [];
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => { w.__types.push((b as Blob).type); return real(b); };
  });
  await page.goto('/');
  await upload(page, 'no-trailer.ged');
  const button = page.getByRole('button', { name: 'Download repaired file' });
  await expect(button).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(readFileSync((await dl.path())!).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __types: string[] }).__types)).toEqual(['application/octet-stream']);
  const [txt] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report (text)' }).click()]);
  const text = readFileSync((await txt.path())!, 'utf8');
  expect(text).toMatch(/^Check report for no-trailer\.ged\nChecked on \d{4}-\d\d-\d\d at validate\.ligneous\.org\n/);
  expect(text).toContain('REPAIRED COPY\n\nAdded the end-of-file marker (0 TRLR): 1 line (8)\n');
});

test('e2e: the nomodule fallback does not run in a current browser', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(300);
  await expect(page.locator('#status')).toHaveText('');
});
