import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The tree viewer's read, through the site's own built worker and wasm: the
// message the viewer will send, and what comes back. The viewer page doesn't
// exist yet, so the test starts a second worker from the page's own.
test('e2e: the worker reads a file into a tree, with nothing leaving the page', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));
  const pageWorker = page.waitForEvent('worker');
  await page.goto('/');
  const workerUrl = (await pageWorker).url();
  const b64 = (await readFile(join('e2e', 'fixtures', 'royal92.ged'))).toString('base64');

  const out = await page.evaluate(async ([url, data]) => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer;
    const w = new Worker(url, { type: 'module' });
    const seen: string[] = [];
    // The tree comes in parts (web/src/tree/parts.ts), joined here as treeAssembler does.
    const people: { id: string; isLiving: boolean }[] = [];
    const unions: { id: string; children: unknown[] }[] = [];
    const details = new Map<string, { line: number; fullName: string }>();
    const famcOrder = new Map<string, string[]>();
    interface Msg {
      type: string; job?: string; stage?: string; text?: string; message?: string;
      part?: { kind: string; rows: unknown[] }; summary?: { error?: string; isGedcom: boolean; parseFindings: unknown; start: unknown; parts: number };
    }
    let parts = 0;
    const summary = await new Promise<NonNullable<Msg['summary']>>((ok, fail) => w.addEventListener('message', (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'ready') w.postMessage({ type: 'enrich', bytes }, [bytes]);
      if (m.type === 'stage') seen.push(`${m.job} ${m.stage}`);
      if (m.type === 'status') seen.push(`status ${m.text}`);
      if (m.type === 'tree-part' && m.part) {
        parts++;
        if (m.part.kind === 'people') people.push(...(m.part.rows as typeof people));
        if (m.part.kind === 'unions') unions.push(...(m.part.rows as typeof unions));
        if (m.part.kind === 'personDetails') for (const [id, d] of m.part.rows as [string, { line: number; fullName: string }][]) details.set(id, d);
        if (m.part.kind === 'famcOrder') for (const [id, f] of m.part.rows as [string, string[]][]) famcOrder.set(id, f);
      }
      if (m.type === 'enriched' && m.summary) ok(m.summary);
      if (m.type === 'error') fail(new Error(m.message));
    }));
    w.terminate();
    return {
      seen, error: summary.error ?? '', isGedcom: summary.isGedcom, parseFindings: summary.parseFindings, start: summary.start,
      parts: `${parts} of ${summary.parts}`, people: people.length, unions: unions.length,
      victoria: people.find(p => p.id === '@I1@'),
      victoriaDetails: details.get('@I1@'),
      f1Children: unions.find(u => u.id === '@F1@')?.children.length,
      famc: `${famcOrder.size} ${JSON.stringify(famcOrder.get('@I3@'))}`,
    };
  }, [workerUrl, b64] as const);

  expect(out.error).toBe('');
  expect(out.seen).toEqual(['status Reading the file…', 'enrich parse', 'enrich enrich', 'enrich finish', 'enrich graph']);
  expect(out).toMatchObject({
    isGedcom: true, parseFindings: { errors: 0, warnings: 0, hints: 1 }, parts: '6 of 6', people: 3294, unions: 1422, f1Children: 9,
    famc: '2018 ["@F1@"]', // Victoria's eldest daughter, a child of @F1@
    start: { id: '@I1@', reason: 'most-relatives', relatives: 200 },
  });
  expect(out.victoria).toMatchObject({ firstName: 'Victoria', lastName: 'Hanover', birthYear: 1819, deathYear: 1901, isLiving: false });
  expect(out.victoriaDetails).toMatchObject({ line: 41, fullName: 'Victoria  /Hanover/' });
  expect(requests.filter(u => new URL(u).origin !== origin)).toEqual([]);
});
