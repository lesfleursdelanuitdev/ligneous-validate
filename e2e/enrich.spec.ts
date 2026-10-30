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
    interface Msg { type: string; job?: string; stage?: string; text?: string; message?: string; result?: unknown }
    const result = await new Promise<unknown>((ok, fail) => w.addEventListener('message', (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'ready') w.postMessage({ type: 'enrich', bytes }, [bytes]);
      if (m.type === 'stage') seen.push(`${m.job} ${m.stage}`);
      if (m.type === 'status') seen.push(`status ${m.text}`);
      if (m.type === 'enriched') ok(m.result);
      if (m.type === 'error') fail(new Error(m.message));
    }));
    w.terminate();
    const r = result as {
      error?: string; isGedcom: boolean; parseFindings: unknown;
      graph: { people: { id: string; isLiving: boolean }[]; unions: { id: string; children: unknown[] }[] };
      details: { people: Map<string, { line: number; fullName: string }> };
    };
    return {
      seen, error: r.error ?? '', isGedcom: r.isGedcom, parseFindings: r.parseFindings,
      people: r.graph.people.length, unions: r.graph.unions.length,
      victoria: r.graph.people.find(p => p.id === '@I1@'),
      victoriaDetails: r.details.people.get('@I1@'),
      f1Children: r.graph.unions.find(u => u.id === '@F1@')?.children.length,
    };
  }, [workerUrl, b64] as const);

  expect(out.error).toBe('');
  expect(out.seen).toEqual(['status Reading the file…', 'enrich parse', 'enrich enrich', 'enrich finish', 'enrich graph']);
  expect(out).toMatchObject({ isGedcom: true, parseFindings: { errors: 0, warnings: 0, hints: 1 }, people: 3294, unions: 1422, f1Children: 9 });
  expect(out.victoria).toMatchObject({ firstName: 'Victoria', lastName: 'Hanover', birthYear: 1819, deathYear: 1901, isLiving: false });
  expect(out.victoriaDetails).toMatchObject({ line: 41, fullName: 'Victoria  /Hanover/' });
  expect(requests.filter(u => new URL(u).origin !== origin)).toEqual([]);
});
