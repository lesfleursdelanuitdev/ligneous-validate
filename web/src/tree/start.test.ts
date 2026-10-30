import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { relativesWithin, suggestStart } from './start';
import { buildGraph } from './graph';
import type { GraphInput, GraphPerson, GraphUnion } from './graph';
import { readEnriched } from './tables';
import ownAncestorJSON from '../testdata/tree/own-ancestor.json';

const NO_HOME = { home: '', root: '', submitter: '' };
const p = (id: string): GraphPerson => ({
  id, xref: id, firstName: id, lastName: '', birthYear: null, deathYear: null,
  birthPlace: null, deathPlace: null, gender: null, isLiving: false,
});
const u = (id: string, husb: string, wife: string, ...kids: string[]): GraphUnion =>
  ({ id, husb, wife, children: kids.map(k => ({ id: k, pedi: 'birth' })) });

// G1+G2 → A, B; A+W → C, D; C+X → E. B has nobody else.
const family: GraphInput = {
  people: ['@G1@', '@G2@', '@A@', '@B@', '@W@', '@C@', '@D@', '@X@', '@E@', '@L@'].map(p),
  unions: [u('@F1@', '@G1@', '@G2@', '@A@', '@B@'), u('@F2@', '@A@', '@W@', '@C@', '@D@'), u('@F3@', '@C@', '@X@', '@E@')],
};

describe('the starting person (T26)', () => {
  it('is the header\'s home person when it names someone, _HOME, then _ROOT, then the submitter', () => {
    expect(suggestStart(family, { home: '@C@', root: '@A@', submitter: '@B@' })).toEqual({ id: '@C@', reason: 'home' });
    expect(suggestStart(family, { home: '', root: '@A@', submitter: '@B@' })).toEqual({ id: '@A@', reason: 'root' });
    expect(suggestStart(family, { home: '', root: '', submitter: '@B@' })).toEqual({ id: '@B@', reason: 'submitter' });
  });

  it('skips a pointer to someone who isn\'t in the file, or to a placeholder', () => {
    const withPlaceholder: GraphInput = {
      people: [...family.people, { ...p('@F9@:unknown-husb'), xref: null, _unknownPlaceholder: true }],
      unions: family.unions,
    };
    expect(suggestStart(withPlaceholder, { home: '@I404@', root: '@F9@:unknown-husb', submitter: '@E@' }))
      .toEqual({ id: '@E@', reason: 'submitter' });
  });

  it('otherwise is the person with the most relatives within 3 steps (a parent, a child or a partner each)', () => {
    // Seven generations, P1 → … → P7, each with an unknown mother: P4 reaches all six.
    const ids = ['@P1@', '@P2@', '@P3@', '@P4@', '@P5@', '@P6@', '@P7@'];
    const line: GraphInput = {
      people: [...ids.map(p), ...ids.slice(0, -1).map((_, i) => ({ ...p(`@L${i}@:unknown-wife`), xref: null, _unknownPlaceholder: true }))],
      unions: ids.slice(0, -1).map((id, i) => u(`@L${i}@`, id, `@L${i}@:unknown-wife`, ids[i + 1])),
    };
    expect([...relativesWithin(line, 3).values()]).toEqual([3, 4, 5, 6, 5, 4, 3]);
    expect(suggestStart(line, NO_HOME)).toEqual({ id: '@P4@', reason: 'most-relatives', relatives: 6 });
  });

  it('counts each relative once, never the person, never a placeholder, and stops at 3 steps', () => {
    const counts = relativesWithin(family, 3);
    expect(counts.get('@A@')).toBe(8); // G1 G2 W C D (1 step), B X E (2), nobody new at 3
    expect(counts.get('@E@')).toBe(7); // C X (1), A W (2), G1 G2 D (3); not B (4 steps)
    expect(counts.get('@L@')).toBe(0); // in no family
    const lonely: GraphInput = {
      people: [p('@M@'), p('@K@'), { ...p('@F1@:unknown-husb'), xref: null, _unknownPlaceholder: true }],
      unions: [u('@F1@', '@F1@:unknown-husb', '@M@', '@K@')],
    };
    expect(relativesWithin(lonely, 3)).toEqual(new Map([['@M@', 1], ['@K@', 1]]));
    expect(relativesWithin(family, 1).get('@A@')).toBe(5);
  });

  it('a tie goes to whoever comes first in the file', () => {
    const twins: GraphInput = { people: ['@P@', '@Q@'].map(p), unions: [u('@F1@', '@P@', '@Q@')] };
    expect(suggestStart(twins, NO_HOME)).toEqual({ id: '@P@', reason: 'most-relatives', relatives: 1 });
  });

  it('finishes on a family that is its own ancestor', () => {
    const t = buildGraph(readEnriched(ownAncestorJSON), { thisYear: 2026 });
    expect(suggestStart(t.graph, NO_HOME)).toEqual({ id: '@I1@', reason: 'most-relatives', relatives: 1 });
  });

  it('is nobody in an empty file', () => {
    expect(suggestStart({ people: [], unions: [] }, NO_HOME)).toBeNull();
  });

  it('royal92: no home person in the header, so the best-connected person', () => {
    const json = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../testdata/tree/royal92.json.gz', import.meta.url)))));
    const t = buildGraph(readEnriched(json), { thisYear: 2026 });
    const s = suggestStart(t.graph, readEnriched(json).home);
    const counts = relativesWithin(t.graph, 3);
    if (s?.reason !== 'most-relatives') throw new Error(`suggested ${JSON.stringify(s)}`);
    expect(s.relatives).toBe(Math.max(...counts.values()));
    const first = t.graph.people.find(x => counts.get(x.id) === s.relatives);
    expect(s.id).toBe(first?.id);
  });
});
