import { describe, expect, it } from 'vitest';
import { runEnrich } from './job';
import type { EnrichApi } from './job';
import type { FromWorker } from '../types';
import cousinJSON from '../testdata/tree/cousin-marriage.json';

const BYTES = new Uint8Array([48, 32, 72, 69, 65, 68]);
const answer = JSON.stringify(cousinJSON);

/** A fake wasm: reports the given stages, then returns `reply` (or throws it). */
function fakeApi(reply: string | Error, stages = ['parse', 'enrich', 'finish']): EnrichApi & { got: Uint8Array[] } {
  const got: Uint8Array[] = [];
  return {
    got,
    enrich(bytes, progress) {
      got.push(bytes);
      for (const s of stages) progress?.(s);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

function run(api: EnrichApi, thisYear = 2026): FromWorker[] {
  const posted: FromWorker[] = [];
  runEnrich(api, BYTES, m => posted.push(m), thisYear);
  return posted;
}

const result = (posted: FromWorker[]) => {
  const last = posted.at(-1);
  if (last?.type !== 'enriched') throw new Error(`last message: ${JSON.stringify(last)}`);
  return last.result;
};

describe('the worker\'s enrich job', () => {
  it('posts a status, each Go stage as it happens, the graph stage, then the tree', () => {
    const api = fakeApi(answer);
    const posted = run(api);
    expect(api.got).toEqual([BYTES]);
    expect(posted.slice(0, -1)).toEqual([
      { type: 'status', text: 'Reading the file…' },
      { type: 'stage', job: 'enrich', stage: 'parse' },
      { type: 'stage', job: 'enrich', stage: 'enrich' },
      { type: 'stage', job: 'enrich', stage: 'finish' },
      { type: 'stage', job: 'enrich', stage: 'graph' },
    ]);
    const r = result(posted);
    expect(r.error).toBeUndefined();
    expect(r.isGedcom).toBe(true);
    expect(r.parseFindings).toEqual({ errors: 0, warnings: 0, hints: 0 });
    expect(r.graph.people).toHaveLength(9);
    expect(r.graph.unions).toHaveLength(4);
    expect(r.details.people.get('@I1@')?.line).toBe(6);
  });

  it('applies the living rule with the year it is given', () => {
    const born1900 = (y: number) => result(run(fakeApi(answer), y)).graph.people.find(p => p.id === '@I9@')?.isLiving;
    expect(born1900(2026)).toBe(false); // Henry Hall died in 1970
  });

  it('a file that isn\'t GEDCOM: an empty tree, no error', () => {
    const notGedcom = JSON.stringify({ ...cousinJSON, isGedcom: false, tables: Object.fromEntries(Object.keys(cousinJSON.tables).map(k => [k, { columns: [], rows: [] }])), lines: { individuals: [], families: [] } });
    const r = result(run(fakeApi(notGedcom, ['parse'])));
    expect(r).toMatchObject({ isGedcom: false, graph: { people: [], unions: [] } });
    expect(r.error).toBeUndefined();
  });

  it.each([
    ['the library failed (a recovered panic)', JSON.stringify({ error: 'boom' }), 'boom'],
    ['the library failed after parsing', JSON.stringify({ ...cousinJSON, isGedcom: false, error: 'late boom' }), 'late boom'],
    ['the wasm threw', new Error('wasm died'), 'wasm died'],
    ['the answer is not JSON', '{nope', 'JSON'],
    ['the answer is the wrong shape', JSON.stringify({ isGedcom: true }), 'expected shape'],
  ])('%s: an empty tree with the error, as check does', (_, reply, message) => {
    const r = result(run(fakeApi(reply)));
    expect(r.error).toContain(message);
    expect(r).toMatchObject({ isGedcom: false, parseFindings: { errors: 0, warnings: 0, hints: 0 }, graph: { people: [], unions: [] } });
    expect(r.details.people.size + r.details.families.size).toBe(0);
  });

  it('a stage callback is never needed for the answer', () => {
    const api: EnrichApi = { enrich: () => answer };
    expect(result(run(api)).graph.people).toHaveLength(9);
  });
});
