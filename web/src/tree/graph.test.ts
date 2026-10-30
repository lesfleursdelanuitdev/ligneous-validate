import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildGraph, isPlaceholder, placeholderId } from './graph';
import type { TreeData } from './graph';
import { readEnriched } from './tables';
import type { Enriched } from './tables';
// Real enrich answers, made from check/testdata/tree/*.ged by
// `UPDATE_ENRICH=1 go test ./check` (check/enrich_test.go).
import adoptionJSON from '../testdata/tree/adoption.json';
import cousinJSON from '../testdata/tree/cousin-marriage.json';
import dupFamiliesJSON from '../testdata/tree/duplicate-families.json';
import dupXrefJSON from '../testdata/tree/duplicate-xref.json';
import livingJSON from '../testdata/tree/living.json';
import namesJSON from '../testdata/tree/names.json';
import noPartnerJSON from '../testdata/tree/no-partner.json';
import ownAncestorJSON from '../testdata/tree/own-ancestor.json';

const YEAR = 2026;
const gz = (name: string) => new URL(`../testdata/tree/${name}`, import.meta.url);
const royal92 = (): Enriched =>
  readEnriched(JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(gz('royal92.json.gz'))))));

const FIXTURES: Record<string, unknown> = {
  adoption: adoptionJSON, cousin: cousinJSON, dupFamilies: dupFamiliesJSON, dupXref: dupXrefJSON,
  living: livingJSON, names: namesJSON, noPartner: noPartnerJSON, ownAncestor: ownAncestorJSON,
};
const build = (json: unknown, thisYear = YEAR) => buildGraph(readEnriched(json), { thisYear });

const person = (t: TreeData, id: string) => {
  const p = t.graph.people.find(x => x.id === id);
  if (!p) throw new Error(`no person ${id}`);
  return p;
};
const union = (t: TreeData, id: string) => {
  const u = t.graph.unions.find(x => x.id === id);
  if (!u) throw new Error(`no union ${id}`);
  return u;
};
const kids = (t: TreeData, id: string) => union(t, id).children.map(c => `${c.id} ${c.pedi}`);

describe('the whole file, in the engine\'s shape', () => {
  for (const [name, json] of Object.entries({ ...FIXTURES, royal92: null })) {
    it(`${name}: each person and family once, and every id a union names is a person`, () => {
      const t = json === null ? buildGraph(royal92(), { thisYear: YEAR }) : build(json);
      const ids = new Set(t.graph.people.map(p => p.id));
      expect(ids.size).toBe(t.graph.people.length);
      expect(new Set(t.graph.unions.map(u => u.id)).size).toBe(t.graph.unions.length);
      for (const u of t.graph.unions) {
        expect(ids.has(u.husb) && ids.has(u.wife)).toBe(true);
        for (const c of u.children) expect(ids.has(c.id)).toBe(true);
        expect(new Set(u.children.map(c => c.id)).size).toBe(u.children.length);
      }
      for (const p of t.graph.people) expect(typeof p.isLiving).toBe('boolean');
    });
  }
});

describe('cousin marriage', () => {
  const t = build(cousinJSON);

  it('first cousins who marry each appear once, as a child in one family and a partner in another', () => {
    expect(t.graph.people).toHaveLength(9);
    expect(union(t, '@F4@')).toMatchObject({ husb: '@I7@', wife: '@I8@' });
    expect(kids(t, '@F2@')).toEqual(['@I7@ birth']);
    expect(kids(t, '@F3@')).toEqual(['@I8@ birth']);
    expect(kids(t, '@F4@')).toEqual(['@I9@ birth']);
  });

  it('keeps the children in the family\'s order', () => {
    expect(kids(t, '@F1@')).toEqual(['@I3@ birth', '@I4@ birth']);
  });

  it('takes names, years and places from the enricher', () => {
    expect(person(t, '@I1@')).toEqual({
      id: '@I1@', xref: '@I1@', firstName: 'George', lastName: 'Hall', birthYear: 1820, deathYear: 1890,
      birthPlace: null, deathPlace: null, gender: 'Male', isLiving: false,
    });
    expect(t.details.families.get('@F1@')?.marriage).toEqual({ date: '1848', year: 1848, place: 'York, Yorkshire, England' });
    expect(t.details.families.get('@F4@')?.marriage).toEqual({ date: '12 JUN 1898', year: 1898, place: '' });
    expect(t.details.families.get('@F2@')?.marriage).toBeNull();
  });

  it('gives each person and family the line of its record', () => {
    expect(t.details.people.get('@I1@')?.line).toBe(6);
    expect(t.details.people.get('@I9@')?.line).toBe(74);
    expect(t.details.families.get('@F1@')?.line).toBe(82);
  });
});

describe('a person who is their own ancestor', () => {
  const t = build(ownAncestorJSON);

  it('is converted as written: the loop is the engine\'s to handle', () => {
    expect(union(t, '@F1@')).toMatchObject({ husb: '@I2@', wife: '@F1@:unknown-wife' });
    expect(kids(t, '@F1@')).toEqual(['@I1@ birth']);
    expect(union(t, '@F2@')).toMatchObject({ husb: '@I1@', wife: '@F2@:unknown-wife' });
    expect(kids(t, '@F2@')).toEqual(['@I2@ birth']);
    expect(union(t, '@F3@')).toMatchObject({ husb: '@I3@' });
    expect(kids(t, '@F3@')).toEqual(['@I3@ birth']); // their own parent
  });
});

describe('adoption: the child type comes from the enricher\'s parent–child edges', () => {
  const t = build(adoptionJSON);

  it('is the PEDI as written, in lower case; none is "birth"', () => {
    expect(kids(t, '@F1@')).toEqual([
      '@I3@ adopted', // PEDI adopted
      '@I4@ foster', //  PEDI foster
      '@I5@ birth', //   no PEDI
      '@I6@ adopted', // PEDI ADOPTED (GEDCOM 7 spelling), see below
      '@I7@ adopted', // mixed-parentage note: birth father, adoptive mother
      '@I9@ sealing', // PEDI sealing
      '@I10@ other', //  PEDI OTHER (GEDCOM 7): not one of the four, kept in lower case
    ]);
    expect(kids(t, '@F2@')).toEqual(['@I3@ birth']);
  });

  it('when the two parents\' edges differ (a mixed-parentage note), the one that isn\'t birth', () => {
    const of = t.details.families.get('@F1@')?.children.find(c => c.id === '@I7@');
    expect([of?.father?.pedigree, of?.mother?.pedigree]).toEqual(['birth', 'adopted']);
    expect(kids(t, '@F1@')).toContain('@I7@ adopted');
  });

  it('keeps every edge as the enricher gave it in the family details', () => {
    const children = t.details.families.get('@F1@')?.children ?? [];
    const of = (id: string) => children.find(c => c.id === id);
    expect(of('@I4@')).toEqual({
      id: '@I4@', birthOrder: 2,
      father: { relationship: 'foster', pedigree: 'foster' }, mother: { relationship: 'foster', pedigree: 'foster' },
    });
    expect(of('@I7@')?.father).toEqual({ relationship: 'biological', pedigree: 'birth' });
    expect(of('@I7@')?.mother).toEqual({ relationship: 'adopted', pedigree: 'adopted' });
    expect(of('@I5@')?.father).toEqual({ relationship: 'biological', pedigree: '' });
  });

  it('library v0.3.1: GEDCOM 7 "ADOPTED" gets relationship "biological"; its PEDI in lower case is still "adopted"', () => {
    // enricher.go compares PEDI in lower case only. The conversion reads the
    // pedigree, never the relationship, so the chart is right; the details
    // show what the enricher said.
    const of = t.details.families.get('@F1@')?.children.find(c => c.id === '@I6@');
    expect(of?.father).toEqual({ relationship: 'biological', pedigree: 'ADOPTED' });
    expect(kids(t, '@F1@')).toContain('@I6@ adopted');
  });

  it('a child in two families is a child of both', () => {
    expect(t.graph.unions.filter(u => u.children.some(c => c.id === '@I3@')).map(u => u.id)).toEqual(['@F1@', '@F2@']);
  });
});

describe('no partner: a placeholder per family, never one shared id', () => {
  const t = build(noPartnerJSON);

  it('fills each missing husband or wife with its own family\'s placeholder', () => {
    expect(union(t, '@F1@')).toMatchObject({ husb: '@F1@:unknown-husb', wife: '@I1@' });
    expect(union(t, '@F2@')).toMatchObject({ husb: '@I3@', wife: '@F2@:unknown-wife' });
    expect(union(t, '@F4@')).toMatchObject({ husb: '@F4@:unknown-husb', wife: '@F4@:unknown-wife' });
    expect(kids(t, '@F4@')).toEqual(['@I5@ birth']);
    expect(kids(t, '@F2@')).toEqual([]);
  });

  it('treats a partner pointer to a person who isn\'t in the file as unknown', () => {
    expect(union(t, '@F3@')).toMatchObject({ husb: '@F3@:unknown-husb', wife: '@F3@:unknown-wife' });
  });

  it('drops a child pointer to a person who isn\'t in the file (the enricher does)', () => {
    expect(kids(t, '@F1@')).toEqual(['@I2@ birth']);
  });

  it('adds one placeholder person per missing slot', () => {
    const placeholders = t.graph.people.filter(p => isPlaceholder(p.id));
    expect(placeholders.map(p => p.id)).toEqual([
      '@F1@:unknown-husb', '@F2@:unknown-wife', '@F3@:unknown-husb', '@F3@:unknown-wife', '@F4@:unknown-husb', '@F4@:unknown-wife',
    ]);
    expect(placeholders[0]).toEqual({
      id: '@F1@:unknown-husb', xref: null, firstName: 'Unknown', lastName: '', birthYear: null, deathYear: null,
      birthPlace: null, deathPlace: null, gender: null, isLiving: false, _unknownPlaceholder: true,
    });
    expect(t.details.people.has('@F1@:unknown-husb')).toBe(false);
    expect(placeholderId('@F9@', 'wife')).toBe('@F9@:unknown-wife');
    expect(isPlaceholder('@I1@')).toBe(false);
  });
});

describe('the living rule', () => {
  const t = build(livingJSON);
  const living = (id: string) => person(t, id).isLiving;

  it.each([
    ['@I1@', true, 'born 100 years ago (1926): within the last 100 years'],
    ['@I2@', false, 'born 101 years ago (1925)'],
    ['@I3@', false, 'a DEAT with no date'],
    ['@I4@', false, 'a death year that can\'t be read'],
    ['@I5@', false, 'a BURI'],
    ['@I6@', false, 'a CREM'],
    ['@I7@', true, 'no dates at all'],
    ['@I8@', false, 'no birth, but a christening in 1850'],
    ['@I9@', false, 'no dates of their own, but married in 1850'],
    ['@I10@', true, 'a birth date with no year the enricher can read, and nothing else'],
    ['@I11@', true, 'born in the future (2099)'],
    ['@I12@', false, 'no birth, christened in 2010: the rule as written says dead (see the ledger)'],
    ['@I13@', false, 'no dates of their own, married in 2015: the rule as written says dead (see the ledger)'],
    ['@I14@', false, 'BET 1920 AND 1930: the enricher\'s year is the first, 1920'],
  ])('%s is living: %s (%s)', (id, want) => {
    expect(living(id)).toBe(want);
  });

  it('moves with the year it is given', () => {
    expect(person(build(livingJSON, 2027), '@I1@').isLiving).toBe(false);
    expect(person(build(livingJSON, 2025), '@I2@').isLiving).toBe(true);
  });

  it('death year and place come from DEAT, as the enricher reads them', () => {
    expect(person(t, '@I4@')).toMatchObject({ birthYear: 2000, deathYear: null });
    expect(t.details.people.get('@I4@')?.death).toEqual({ date: 'UNKNOWN', year: null, place: '' });
    expect(t.details.people.get('@I3@')?.death).toBeNull(); // DEAT Y: no date or place
  });
});

describe('names come from the enricher, not re-parsed', () => {
  const t = build(namesJSON);

  it('given names and surname of the first NAME, from GIVN/SURN when they are there', () => {
    expect(person(t, '@I1@')).toMatchObject({ firstName: 'John', lastName: 'Smith', gender: 'Male' });
    expect(person(t, '@I3@')).toMatchObject({ firstName: 'Mary Ann', lastName: 'Jonas', gender: 'Female' });
    expect(t.details.people.get('@I3@')?.fullName).toBe('Mary Ann /Jones/');
  });

  it('other names, in file order, with their TYPE', () => {
    expect(t.details.people.get('@I3@')?.otherNames).toEqual([
      { type: 'married', given: 'Mary', surname: 'Brown' },
      { type: 'aka', given: 'Polly', surname: '' },
    ]);
    expect(t.details.people.get('@I1@')?.otherNames).toEqual([]);
  });

  it('library v0.3.1: name parts are shared by lower case, so they take the spelling first met in the file', () => {
    expect(person(t, '@I2@')).toMatchObject({ firstName: 'John', lastName: 'Smith' });
    expect(t.details.people.get('@I2@')?.fullName).toBe('JOHN /SMITH/'); // the validator's reading
  });

  it('library v0.3.1: "@@" is not unescaped', () => {
    expect(person(t, '@I7@')).toMatchObject({ firstName: 'Bob @@work', lastName: 'Smith', gender: 'Other' });
  });

  it('no NAME, no given name, no surname', () => {
    expect(person(t, '@I4@')).toMatchObject({ firstName: '', lastName: '', gender: 'Unknown' });
    expect(t.details.people.get('@I4@')?.fullName).toBe('');
    expect(person(t, '@I5@')).toMatchObject({ firstName: '', lastName: 'Nogiven', gender: null });
    expect(person(t, '@I6@')).toMatchObject({ firstName: 'Cher', lastName: '' });
  });
});

describe('duplicate xrefs (the library doesn\'t detect them)', () => {
  it('keeps the first record with an xref and names every record\'s line', () => {
    const t = build(dupXrefJSON);
    expect(t.graph.people.filter(p => !isPlaceholder(p.id))).toEqual([
      expect.objectContaining({ id: '@I1@', firstName: 'First Person', lastName: '', gender: 'Male' }),
    ]);
    expect(t.details.people.get('@I1@')).toMatchObject({ line: 5, fullName: 'First Person' });
    expect(t.problems.duplicatePeople).toEqual([{ id: '@I1@', lines: [5, 8, 11] }]);
    // The first @F1@ has HUSB @I1@ and no wife; the second's WIFE @I1@ is not used.
    expect(t.graph.unions).toEqual([{ id: '@F1@', husb: '@I1@', wife: '@F1@:unknown-wife', children: [] }]);
    expect(t.problems.duplicateFamilies).toEqual([{ id: '@F1@', lines: [14, 16] }]);
  });

  it('merges the children of families that share an xref: the enricher\'s edges name only the xref', () => {
    const t = build(dupFamiliesJSON);
    expect(kids(t, '@F1@')).toEqual(['@I3@ birth', '@I4@ birth']);
    expect(t.details.families.get('@F1@')?.marriage?.year).toBe(1900); // the first record's
    expect(t.problems).toEqual({ duplicatePeople: [], duplicateFamilies: [{ id: '@F1@', lines: [20, 26] }] });
  });

  it('a file without duplicates has no problems', () => {
    expect(build(cousinJSON).problems).toEqual({ duplicatePeople: [], duplicateFamilies: [] });
  });
});

/** The graph as text, one person, family or detail per line, so a change reads as a diff. */
function goldenText(t: TreeData): string {
  const lines: string[] = [];
  for (const p of t.graph.people) lines.push('P ' + JSON.stringify(p));
  for (const u of t.graph.unions) lines.push('U ' + JSON.stringify(u));
  for (const [id, d] of t.details.people) lines.push(`D ${id} ` + JSON.stringify(d));
  for (const [id, d] of t.details.families) lines.push(`F ${id} ` + JSON.stringify(d));
  lines.push('X ' + JSON.stringify(t.problems));
  return lines.join('\n') + '\n';
}

describe('royal92', () => {
  const t = buildGraph(royal92(), { thisYear: YEAR });

  it('matches the golden graph (UPDATE_GOLDEN=1 npx vitest run web/src/tree rewrites it)', () => {
    const text = goldenText(t);
    if (import.meta.env.UPDATE_GOLDEN === '1') writeFileSync(gz('royal92-graph.txt.gz'), gzipSync(text, { level: 9 }));
    const golden = new TextDecoder().decode(gunzipSync(readFileSync(gz('royal92-graph.txt.gz'))));
    expect(text === golden).toBe(true);
  });

  it('has every person and family of the file', () => {
    const real = t.graph.people.filter(p => !isPlaceholder(p.id));
    expect(real).toHaveLength(3010);
    expect(t.graph.unions).toHaveLength(1422);
    expect(t.problems).toEqual({ duplicatePeople: [], duplicateFamilies: [] });
  });

  it('reads Queen Victoria and her family as the enricher does', () => {
    expect(person(t, '@I1@')).toMatchObject({ firstName: 'Victoria', lastName: 'Hanover', gender: 'Female', isLiving: false });
    const fams = t.graph.unions.filter(u => u.wife === '@I1@');
    expect(fams).toHaveLength(1);
    expect(fams[0].children).toHaveLength(9);
  });
});

describe('readEnriched checks the answer\'s shape', () => {
  const good = (): Record<string, unknown> => structuredClone(cousinJSON) as unknown as Record<string, unknown>;

  it('accepts every fixture', () => {
    for (const json of Object.values(FIXTURES)) expect(readEnriched(json).isGedcom).toBe(true);
  });

  it('keeps the error of a failed answer', () => {
    const failed = { ...good(), isGedcom: false, error: 'boom' };
    expect(readEnriched(failed).error).toBe('boom');
  });

  it.each([
    ['not an object', () => 'nope'],
    ['no tables', () => ({ ...good(), tables: undefined })],
    ['a missing table', () => { const j = good(); delete (j.tables as Record<string, unknown>).ParentChild; return j; }],
    ['a renamed field', () => {
      const j = good();
      const rows = (j.tables as Record<string, Record<string, unknown>[]>).Individuals;
      rows[0] = { ...rows[0], full_name: undefined, fullName: 'x' };
      return j;
    }],
    ['lines that don\'t match the rows', () => ({ ...good(), lines: { individuals: [1], families: [] } })],
    ['parse findings without counts', () => ({ ...good(), parseFindings: {} })],
  ])('refuses %s', (_, make) => {
    expect(() => readEnriched(make())).toThrow(/expected shape/);
  });
});
