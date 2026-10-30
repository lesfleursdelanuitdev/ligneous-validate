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
import famcJSON from '../testdata/tree/famc.json';
import famAdopJSON from '../testdata/tree/families-adop-event.json';
import famBirthFirstJSON from '../testdata/tree/families-birth-first.json';
import famAdoptiveFirstJSON from '../testdata/tree/families-adoptive-first.json';
import repeatedJSON from '../testdata/tree/repeated.json';
import livingJSON from '../testdata/tree/living.json';
import livingFamilyJSON from '../testdata/tree/living-family.json';
import namesJSON from '../testdata/tree/names.json';
import noPartnerJSON from '../testdata/tree/no-partner.json';
import ownAncestorJSON from '../testdata/tree/own-ancestor.json';

const YEAR = 2026;
const gz = (name: string) => new URL(`../testdata/tree/${name}`, import.meta.url);
const royal92 = (): Enriched =>
  readEnriched(JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(gz('royal92.json.gz'))))));

const FIXTURES: Record<string, unknown> = {
  adoption: adoptionJSON, cousin: cousinJSON, dupFamilies: dupFamiliesJSON, dupXref: dupXrefJSON, famc: famcJSON,
  famAdop: famAdopJSON, famBirthFirst: famBirthFirstJSON, famAdoptiveFirst: famAdoptiveFirstJSON, repeated: repeatedJSON,
  living: livingJSON, livingFamily: livingFamilyJSON, names: namesJSON, noPartner: noPartnerJSON, ownAncestor: ownAncestorJSON,
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
      for (const [, d] of t.details.people) expect(['death', 'birth', 'event', 'relatives', 'none']).toContain(d.living.by);
      const unionIds = new Set(t.graph.unions.map(u => u.id));
      for (const [id, fams] of [...t.graph.famcOrder, ...t.graph.famsOrder]) {
        expect(ids.has(id) && !isPlaceholder(id)).toBe(true);
        expect(fams.length).toBeGreaterThan(0);
        expect(fams.every(f => unionIds.has(f))).toBe(true);
        expect(new Set(fams).size).toBe(fams.length);
      }
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

describe('famcOrder: each person\'s parent families in their own record\'s order (T20)', () => {
  const t = build(famcJSON);
  const order = (id: string) => t.graph.famcOrder.get(id);

  it('an adopted child whose adoptive FAMC is listed first', () => {
    expect(order('@I1@')).toEqual(['@F1@', '@F2@']);
    // The engine takes the first birth family in this order: F2, not F1.
    expect(kids(t, '@F1@')).toContain('@I1@ adopted');
    expect(kids(t, '@F2@')).toContain('@I1@ birth');
  });

  it('two birth families: the record\'s order, not the FAM records\' order', () => {
    expect(order('@I2@')).toEqual(['@F3@', '@F2@']);
    expect(t.graph.unions.filter(u => u.children.some(c => c.id === '@I2@')).map(u => u.id)).toEqual(['@F2@', '@F3@']);
  });

  it('a FAMC pointing to a family that isn\'t in the file is left out', () => {
    expect(order('@I3@')).toEqual(['@F1@']);
    expect(t.graph.famcOrder.has('@I4@')).toBe(false); // its only FAMC is missing
  });

  it('a family listed twice counts once; no FAMC, no entry', () => {
    expect(order('@I5@')).toEqual(['@F1@']);
    expect(t.graph.famcOrder.has('@I6@')).toBe(false); // a child of F2 by its CHIL only
    expect([...t.graph.famcOrder.keys()]).toEqual(['@I1@', '@I2@', '@I3@', '@I5@']);
  });

  it('records that share an xref: the first record\'s list', () => {
    const d = build(dupXrefJSON);
    expect(d.graph.famcOrder.size).toBe(0);
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

describe('the living rule (T10, T32)', () => {
  const t = build(livingJSON);
  const living = (id: string) => person(t, id).isLiving;

  it.each([
    // A death, burial or cremation: dead, whatever the dates.
    ['@I3@', false, 'a DEAT with no date'],
    ['@I4@', false, 'a death year that can\'t be read'],
    ['@I5@', false, 'a BURI, born 1990'],
    ['@I6@', false, 'a CREM, born 1990'],
    // The birth year: dead when over 100 years ago.
    ['@I1@', true, 'born 1926, 100 years ago: not over'],
    ['@I2@', false, 'born 1925, 101 years ago'],
    ['@I11@', true, 'born in the future (2099)'],
    ['@I14@', false, 'BET 1920 AND 1930: the enricher\'s year is the first, 1920'],
    // (1) No birth year: the earliest dated event of their own or of their families.
    ['@I15@', true, 'christened 1926'],
    ['@I16@', false, 'christened 1925'],
    ['@I8@', false, 'christened 1850'],
    ['@I12@', true, 'christened 2010 (dead under the old rule)'],
    ['@I9@', false, 'married 1850'],
    ['@I13@', true, 'married 2015 (dead under the old rule)'],
    ['@I30@', false, 'christened 1990 but a dated event in 1900: the earliest counts'],
    // (2) Then the relatives one step away: a child's birth minus 15 years, a parent's plus 15.
    ['@I17@', true, 'a child born 1941: 1926'],
    ['@I19@', false, 'a child born 1940: 1925'],
    ['@I31@', false, 'children born 1960 and 1930: 1915, the earlier'],
    ['@I21@', true, 'a parent born 1911: 1926'],
    ['@I23@', false, 'a parent born 1910: 1925'],
    // T32: where estimates as near disagree, the earliest (living under T10's order).
    ['@I34@', false, 'parents born 1800 and 1950: 1815'],
    ['@I27@', false, 'a child born 1960 (1945) and a parent born 1800 (1815): 1815'],
    // Their own event beats any relative.
    ['@I25@', true, 'christened 2000, a child born 1900: their own event'],
    // T32: a parent's own dated event counts (living under T10).
    ['@I37@', false, 'a parent with only a death, in 1900: 1915'],
    // No dates anywhere in the family: living.
    ['@I7@', true, 'no dates at all'],
    ['@I10@', true, 'a birth date with no year the enricher can read, and nothing else'],
  ])('%s is living: %s (%s)', (id, want) => {
    expect(living(id)).toBe(want);
  });

  it('every person of the fixture is in the table above, or a parent or child in it', () => {
    expect(t.graph.people.filter(p => !isPlaceholder(p.id))).toHaveLength(38);
  });

  it('moves with the year it is given', () => {
    expect(person(build(livingJSON, 2027), '@I1@').isLiving).toBe(false);
    expect(person(build(livingJSON, 2027), '@I17@').isLiving).toBe(false);
    expect(person(build(livingJSON, 2025), '@I2@').isLiving).toBe(true);
    expect(person(build(livingJSON, 2025), '@I23@').isLiving).toBe(true);
  });

  it('death year and place come from DEAT, as the enricher reads them', () => {
    expect(person(t, '@I4@')).toMatchObject({ birthYear: 2000, deathYear: null });
    expect(t.details.people.get('@I4@')?.death).toEqual({ date: 'UNKNOWN', year: null, place: '' });
    expect(t.details.people.get('@I3@')?.death).toBeNull(); // DEAT Y: no date or place
  });

  it('an estimate is never shown as a birth year', () => {
    expect(person(t, '@I12@')).toMatchObject({ birthYear: null, isLiving: true });
    expect(t.details.people.get('@I12@')?.birth).toBeNull();
  });

  it('the details say what each answer rests on', () => {
    const basis = (id: string) => t.details.people.get(id)?.living;
    expect(basis('@I3@')).toEqual({ by: 'death' });
    expect(basis('@I1@')).toEqual({ by: 'birth', year: 1926 });
    expect(basis('@I12@')).toEqual({ by: 'event', year: 2010 });
    expect(basis('@I13@')).toEqual({ by: 'event', year: 2015 });
    expect(basis('@I17@')).toEqual({ by: 'relatives', year: 1926, steps: 1 });
    expect(basis('@I7@')).toEqual({ by: 'none' });
  });
});

describe('T32: estimates pass across the family', () => {
  const t = build(livingFamilyJSON);
  const at = (id: string) => [person(t, id).isLiving, t.details.people.get(id)?.living];

  it('an undated queen takes her king\'s birth year (a partner: the same generation)', () => {
    expect(at('@Q1@')).toEqual([false, { by: 'relatives', year: 1900, steps: 1 }]);
    expect(at('@Q2@')).toEqual([true, { by: 'relatives', year: 1960, steps: 1 }]);
  });

  it('an undated sibling takes the sibling\'s birth year', () => {
    expect(at('@S2@')).toEqual([false, { by: 'relatives', year: 1910, steps: 1 }]);
    expect(at('@S4@')).toEqual([true, { by: 'relatives', year: 1990, steps: 1 }]);
  });

  it('three undated generations under one dated ancestor: 15 years a generation', () => {
    expect(at('@B@')).toEqual([false, { by: 'relatives', year: 1896, steps: 1 }]);
    expect(at('@C@')).toEqual([false, { by: 'relatives', year: 1911, steps: 2 }]);
    expect(at('@D@')).toEqual([true, { by: 'relatives', year: 1926, steps: 3 }]); // 100 years: not over
  });

  it('an undated partner of an undated child of a dated parent, through the chain', () => {
    expect(at('@H@')).toEqual([false, { by: 'relatives', year: 1915, steps: 1 }]);
    expect(at('@W@')).toEqual([false, { by: 'relatives', year: 1915, steps: 2 }]);
  });

  it('the fewest steps win: a partner born 1990 before a grandparent born 1800', () => {
    expect(at('@X@')).toEqual([true, { by: 'relatives', year: 1990, steps: 1 }]);
    expect(at('@Z@')).toEqual([false, { by: 'relatives', year: 1815, steps: 1 }]);
  });

  it('as many steps, different answers: the earliest, so dead if any says so', () => {
    expect(at('@X2@')).toEqual([false, { by: 'relatives', year: 1815, steps: 1 }]);
  });

  it('an isolated undated person is living', () => {
    expect(at('@L@')).toEqual([true, { by: 'none' }]);
  });

  it('estimates pass through an adoptive family only to people no birth family, partner or sibling reaches', () => {
    expect(at('@A2@')).toEqual([false, { by: 'relatives', year: 1895, steps: 1 }]);
  });

  it('a cycle ends: a person who is their own grandparent', () => {
    // C2 is C1's parent (1900 - 15) and C1's child (1900 + 15): the earlier.
    expect(at('@C2@')).toEqual([false, { by: 'relatives', year: 1885, steps: 1 }]);
    expect(person(build(ownAncestorJSON), '@I1@').isLiving).toBe(true); // no dates in that loop at all
  });

  it('a death is still dead outright, whatever the relatives say', () => {
    expect(at('@DD@')).toEqual([false, { by: 'death' }]);
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
  for (const [id, f] of t.graph.famcOrder) lines.push(`O ${id} ` + JSON.stringify(f));
  for (const [id, f] of t.graph.famsOrder) lines.push(`S ${id} ` + JSON.stringify(f));
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

describe('readEnriched reads the compact answer back into the enricher\'s records', () => {
  type Table = { columns: string[]; rows: unknown[][] };
  const good = () => structuredClone(cousinJSON) as unknown as { tables: Record<string, Table>; [k: string]: unknown };

  it('accepts every fixture', () => {
    for (const json of Object.values(FIXTURES)) expect(readEnriched(json).isGedcom).toBe(true);
  });

  it('gives each row as a record, a null being a field left out', () => {
    const t = readEnriched(namesJSON).tables;
    expect(t.Individuals[0]).toEqual({
      xref: '@I1@', full_name: 'John /Smith/', full_name_lower: 'john /smith/', sex: 'M',
      birth_date_index: -1, birth_place_index: -1, death_date_index: -1, death_place_index: -1, primary_surname_lower: 'smith',
    });
    expect('sex' in t.Individuals[4]).toBe(false); // @I5@ has no SEX
    expect(t.NameForms[3]).toEqual({ individual_xref: '@I3@', name_type: 'married', is_primary: false, sort_order: 1 });
  });

  it('keeps the header\'s home pointers and the error of a failed answer', () => {
    expect(readEnriched(cousinJSON).home).toEqual({ home: '', root: '', submitter: '' });
    expect(readEnriched({ ...good(), isGedcom: false, error: 'boom' }).error).toBe('boom');
  });

  it.each([
    ['not an object', () => 'nope'],
    ['no tables', () => ({ ...good(), tables: undefined })],
    ['a missing table', () => { const j = good(); delete j.tables.ParentChild; return j; }],
    ['a table as a plain list (the old answer)', () => { const j = good(); (j.tables as Record<string, unknown>).Families = []; return j; }],
    ['a renamed field', () => { const j = good(); j.tables.Individuals.columns[1] = 'fullName'; return j; }],
    ['a value of the wrong type', () => { const j = good(); j.tables.Individuals.rows[0][0] = 7; return j; }],
    ['a row with a value missing', () => { const j = good(); j.tables.Dates.rows[3].pop(); return j; }],
    ['a __proto__ column', () => { const j = good(); j.tables.Places.columns[0] = '__proto__'; return j; }],
    ['lines that don\'t match the rows', () => ({ ...good(), lines: { individuals: [1], families: [] } })],
    ['parse findings without counts', () => ({ ...good(), parseFindings: {} })],
    ['no home pointers', () => ({ ...good(), home: undefined })],
    ['no FAMC lists', () => ({ ...good(), famc: undefined })],
    ['FAMC lists that don\'t match the rows', () => ({ ...good(), famc: [] })],
    ['a FAMC that isn\'t a string', () => { const j = good(); (j.famc as unknown[][])[2] = [7]; return j; }],
  ])('refuses %s', (_, make) => {
    expect(() => readEnriched(make())).toThrow(/expected shape/);
  });
});

describe('real family shapes, invented names (T48, T49)', () => {
  const variants = { adopEvent: famAdopJSON, birthFirst: famBirthFirstJSON, adoptiveFirst: famAdoptiveFirstJSON };

  for (const [name, json] of Object.entries(variants)) {
    describe(name, () => {
      const t = build(json);
      const pediOf = (child: string) => t.graph.unions.filter(u => u.children.some(c => c.id === child))
        .map(u => `${u.id} ${u.children.find(c => c.id === child)?.pedi}`);

      it('(b) the adopted boy is in both families, adopted in one and born in the other', () => {
        expect(pediOf('@Tobias@')).toEqual(['@FB0@ birth', '@FA@ adopted']);
      });

      it('(c) the adopted niece likewise; her sister only in their birth family', () => {
        expect(pediOf('@Lena@')).toEqual(['@FSW@ adopted', '@FL0@ birth']);
        expect(pediOf('@Cora@')).toEqual(['@FL0@ birth']);
        expect(union(t, '@FTC@')).toMatchObject({ husb: '@Tobias@', wife: '@Cora@' });
      });

      it('famcOrder follows each INDI record', () => {
        const adoptiveFirst = name === 'adoptiveFirst';
        expect(t.graph.famcOrder.get('@Tobias@')).toEqual(adoptiveFirst ? ['@FA@', '@FB0@'] : ['@FB0@', '@FA@']);
        expect(t.graph.famcOrder.get('@Lena@')).toEqual(adoptiveFirst ? ['@FSW@', '@FL0@'] : ['@FL0@', '@FSW@']);
      });

      it('the details list every parent family, in that order, by type, with the parents', () => {
        const families = t.details.people.get('@Tobias@')?.parentFamilies;
        const birth = { familyId: '@FB0@', type: 'birth', label: 'Birth parents', parents: ['@Leon@', '@Rose@'] };
        const adoptive = { familyId: '@FA@', type: 'adopted', label: 'Adoptive parents', parents: ['@Arthur@', '@Maud@'] };
        expect(families).toEqual(name === 'adoptiveFirst' ? [adoptive, birth] : [birth, adoptive]);
        expect(t.details.people.get('@Cora@')?.parentFamilies).toEqual([
          { familyId: '@FL0@', type: 'birth', label: 'Birth parents', parents: ['@Paul@', '@Greta@'] },
        ]);
        expect(t.details.people.get('@Rose@')?.parentFamilies).toEqual([]);
      });

      if (name !== 'adopEvent') {
        it('the living rule: the boy and the sisters through their birth families, not the older adoptive ones', () => {
          // Birth mother born 1930 (+15), adoptive father 1900 (+15 would be 1915, dead).
          expect(t.details.people.get('@Tobias@')?.living).toEqual({ by: 'relatives', year: 1945, steps: 1 });
          expect(person(t, '@Tobias@').isLiving).toBe(true);
          // Birth father born 1930; the adoptive parents (1925, 1928) don't lower it.
          expect(t.details.people.get('@Lena@')?.living).toEqual({ by: 'relatives', year: 1945, steps: 1 });
          expect(t.details.people.get('@Cora@')?.living).toEqual({ by: 'relatives', year: 1945, steps: 1 });
        });
      }
    });
  }

  it('(a) a man marries his sister-in-law\'s niece: one union, each person once', () => {
    const t = build(famBirthFirstJSON);
    expect(union(t, '@FHN@')).toMatchObject({ husb: '@Hugh@', wife: '@Nora@' });
    expect(union(t, '@FRE@')).toMatchObject({ husb: '@Ralph@', wife: '@Edith@' }); // Hugh's brother and Edith
    expect(kids(t, '@FP0@')).toEqual(['@Clara@ birth', '@Edith@ birth']); // Edith and Clara are sisters
    expect(kids(t, '@FCW@')).toEqual(['@Nora@ birth']); // Nora is Clara's daughter
    expect(t.graph.people.filter(p => p.id === '@Hugh@' || p.id === '@Nora@')).toHaveLength(2);
  });

  describe('(d) a man has a son with his own daughter, recorded as a second family (T49)', () => {
    const t = build(repeatedJSON);

    it('gives him two unions and her two roles', () => {
      expect(t.graph.unions.filter(u => u.husb === '@M@').map(u => `${u.id} ${u.wife}`)).toEqual(['@FMW@ @W@', '@FMD@ @D@']);
      expect(kids(t, '@FMW@')).toEqual(['@C1@ birth', '@D@ birth', '@C3@ birth']);
      expect(union(t, '@FMD@')).toMatchObject({ husb: '@M@', wife: '@D@' });
      expect(kids(t, '@FMD@')).toEqual(['@S@ birth']);
    });

    it('the details: the son\'s parents are M and D; D\'s partner is M; M\'s partners in his FAMS order', () => {
      expect(t.details.people.get('@S@')?.parentFamilies).toEqual([
        { familyId: '@FMD@', type: 'birth', label: 'Birth parents', parents: ['@M@', '@D@'] },
      ]);
      expect(t.details.people.get('@D@')?.parentFamilies).toEqual([
        { familyId: '@FMW@', type: 'birth', label: 'Birth parents', parents: ['@M@', '@W@'] },
      ]);
      expect(t.details.people.get('@D@')?.partnerFamilies).toEqual([{ familyId: '@FMD@', partnerId: '@M@' }]);
      expect(t.details.people.get('@M@')?.partnerFamilies).toEqual([
        { familyId: '@FMD@', partnerId: '@D@' }, { familyId: '@FMW@', partnerId: '@W@' },
      ]);
    });

    it('famcOrder and famsOrder follow the INDI records', () => {
      expect(t.graph.famcOrder.get('@D@')).toEqual(['@FMW@']);
      expect(t.graph.famcOrder.get('@S@')).toEqual(['@FMD@']);
      expect(t.graph.famsOrder.get('@M@')).toEqual(['@FMD@', '@FMW@']); // not the FAM records' order
      expect(t.graph.famsOrder.get('@D@')).toEqual(['@FMD@']);
      expect(t.graph.famsOrder.has('@S@')).toBe(false);
    });

    it('the living rule ends, and the repeated links give the earliest estimate', () => {
      // D: her father as a parent (1865) or as a partner (1850): the earlier. S: his father (1865).
      expect(t.details.people.get('@D@')?.living).toEqual({ by: 'relatives', year: 1850, steps: 1 });
      expect(t.details.people.get('@S@')?.living).toEqual({ by: 'relatives', year: 1865, steps: 1 });
      expect(person(t, '@D@').isLiving || person(t, '@S@').isLiving).toBe(false);
    });
  });
});
