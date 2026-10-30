import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildGraph } from './graph';
import { PART_SIZE, splitTree, treeAssembler } from './parts';
import { suggestStart } from './start';
import { readEnriched } from './tables';
import type { TreeResult } from '../types';

function royal92(): TreeResult {
  const e = readEnriched(JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../testdata/tree/royal92.json.gz', import.meta.url))))));
  const tree = buildGraph(e, { thisYear: 2026 });
  return { isGedcom: true, parseFindings: e.parseFindings, ...tree, start: suggestStart(tree.graph, e.home) };
}

describe('the tree in parts, so no single copy into the page is long (T24)', () => {
  const tree = royal92();

  it('joins back into exactly the tree it was split from', () => {
    const { parts, summary } = splitTree(tree, 1000);
    const join = treeAssembler();
    for (const p of parts) join.add(structuredClone(p));
    expect(join.finish(structuredClone(summary))).toEqual(tree);
  });

  it('cuts each kind of record into parts of at most the size given, in order', () => {
    const { parts, summary } = splitTree(tree, 1000);
    const kinds = parts.map(p => `${p.kind} ${p.rows.length}`);
    expect(kinds).toEqual([
      'people 1000', 'people 1000', 'people 1000', 'people 294',
      'unions 1000', 'unions 422',
      'personDetails 1000', 'personDetails 1000', 'personDetails 1000', 'personDetails 10',
      'familyDetails 1000', 'familyDetails 422',
      'famcOrder 1000', 'famcOrder 1000', 'famcOrder 18', // 2,018 people with a FAMC
      'famsOrder 1000', 'famsOrder 1000', 'famsOrder 291', // 2,291 with a FAMS
    ]);
    expect(summary).toEqual({
      isGedcom: true, parseFindings: tree.parseFindings, problems: tree.problems, start: tree.start, parts: 18,
    });
    expect(splitTree(tree).parts).toHaveLength(6); // PART_SIZE: each kind fits in one
    expect(PART_SIZE).toBe(5_000);
  });

  it('an empty tree is no parts', () => {
    const empty: TreeResult = { ...tree, graph: { people: [], unions: [], famcOrder: new Map(), famsOrder: new Map() }, details: { people: new Map(), families: new Map() } };
    const { parts, summary } = splitTree(empty);
    expect(parts).toEqual([]);
    expect(treeAssembler().finish(summary)).toEqual(empty);
  });

  it('refuses a tree with a part missing', () => {
    const { parts, summary } = splitTree(tree, 1000);
    const join = treeAssembler();
    for (const p of parts.slice(1)) join.add(p);
    expect(() => join.finish(summary)).toThrow(/17 parts of 18/);
  });

  it('refuses a part size below 1', () => {
    expect(() => splitTree(tree, 0)).toThrow(RangeError);
  });
});
