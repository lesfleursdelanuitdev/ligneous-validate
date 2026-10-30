// Turns the enricher's tables (ligneous.enrich, see tables.ts) into the chart
// engine's input for the whole file: people and unions in the engine's own
// types, plus a separate details map for the viewer's side panel (spec Part 2,
// "The shared shape"). Every value is the enricher's: names, dates and places
// are read from its tables, never parsed again. The chart rules that the
// enricher has no part in live here: a placeholder partner per family, the
// child type (PEDI in lower case), and the living rule (T10). One pass over each table: O(rows).
//
// No value imports: Node runs this file as it is (scripts/enrich-times.mjs).

import type { DescendancyPerson, UnionChild, UnionRecord } from './engine';
import type { Enriched, ParentChildEdge, ParsedDate, Tables } from './tables';

/** A person as the conversion gives them: the engine's type, with every field it fills always set. */
export interface GraphPerson extends DescendancyPerson {
  /** The person's xref; null for a placeholder partner. */
  xref: string | null;
  birthYear: number | null;
  deathYear: number | null;
  birthPlace: string | null;
  deathPlace: string | null;
  gender: string | null;
  isLiving: boolean;
}

/** A family as the conversion gives it: id is always the family's xref. */
export interface GraphUnion extends UnionRecord {
  id: string;
}

/** The engine's GraphInput, for the whole file, with famcOrder always filled. */
export interface GraphInput {
  people: GraphPerson[];
  unions: GraphUnion[];
  /**
   * Each person's FAMC families in their own record's order, those in the file only, once
   * each; people with none are left out. The enricher's tables keep only each family's CHIL
   * order, so this comes from enrich's famc lists, read from the INDI records.
   */
  famcOrder: Map<string, string[]>;
}

/** A date and a place as written in the file. */
export interface DatePlace {
  /** The date as written ("" when there is none). */
  date: string;
  /** The year the enricher read from it, or null. */
  year: number | null;
  /** The place as written ("" when there is none). */
  place: string;
}

export interface OtherName {
  /** NAME's TYPE, lower case (the enricher's: "birth" when there is none). */
  type: string;
  given: string;
  surname: string;
}

/**
 * What the living rule (T10, T32) rested on: a death; their own birth year,
 * or their own earliest dated event; an estimate from relatives `steps`
 * relations away; or no date anywhere in their family.
 */
export type LivingBasis =
  | { by: 'death' }
  | { by: 'birth' | 'event'; year: number }
  | { by: 'relatives'; year: number; steps: number }
  | { by: 'none' };

export interface PersonDetails {
  /** The line of the INDI record, for "Open in the editor". */
  line: number;
  /** The first NAME as written, slashes kept: what the validator shows. */
  fullName: string;
  /** SEX as written ("" when there is none). */
  sex: string;
  birth: DatePlace | null;
  death: DatePlace | null;
  /** The person's other NAMEs, in file order. */
  otherNames: OtherName[];
  /** Why isLiving is what it is. */
  living: LivingBasis;
}

/** How a child is linked to one parent: the enricher's parent–child edge, as it is. */
export interface Relation {
  relationship: string;
  /** PEDI as written ("" when there is none). */
  pedigree: string;
}

export interface ChildLink {
  id: string;
  birthOrder: number;
  father: Relation | null;
  mother: Relation | null;
}

export interface FamilyDetails {
  line: number;
  marriage: DatePlace | null;
  children: ChildLink[];
}

/** An xref that more than one record has, and the line of each. Only the first record is used. */
export interface Duplicate {
  id: string;
  lines: number[];
}

export interface TreeData {
  graph: GraphInput;
  details: { people: Map<string, PersonDetails>; families: Map<string, FamilyDetails> };
  problems: { duplicatePeople: Duplicate[]; duplicateFamilies: Duplicate[] };
}

export interface GraphOptions {
  /** The current year, for the living rule. */
  thisYear: number;
}

/** The id of the placeholder for a family's missing husband or wife: one per family, never shared. */
export function placeholderId(familyId: string, role: 'husb' | 'wife'): string {
  return `${familyId}:unknown-${role}`;
}

const PLACEHOLDER = /:unknown-(husb|wife)$/;

export function isPlaceholder(id: string): boolean {
  return PLACEHOLDER.test(id);
}

/** Born over this many years ago is dead: 1925 in 2026, not 1926. */
const LIVING_YEARS = 100;
/** The years between a parent's birth and a child's, for the estimate (T10). */
const GENERATION_YEARS = 15;
/**
 * The years between partners' births, and between siblings' (T32): 0, the
 * same generation. Most partners and siblings are born within about 10 years
 * of each other, under the 15-year generation step, so an estimate passed
 * through one is about as good as one through a parent or child; a margin
 * would only move the 100-year line for everyone estimated this way.
 */
const SAME_GENERATION_YEARS = 0;

interface LivingPerson {
  died: boolean;
  /** Their own birth year, else null. */
  birth: number | null;
  /** Their earliest dated event, their own or a family's they are a partner in, else null. */
  event: number | null;
}

/**
 * The living rule's basis for each person (T10, T32). Their own birth year,
 * else their own earliest dated event, starts a walk across the family: one
 * breadth-first search from every dated person at once, through people and
 * families, so each person gets the estimate from the fewest relations away,
 * and the earliest year where estimates as near disagree. A relation is a
 * parent (the year minus 15), a child (plus 15), a partner or a sibling
 * (plus 0); each is two hops through the family: in from a partner +0 or
 * from a child −15, out to a partner +0 or to a child +15. Each person and
 * family is visited once: O(people + families + links).
 */
function livingBases(people: LivingPerson[], partnersOf: number[][], childrenOf: number[][]): LivingBasis[] {
  const n = people.length;
  const asPartner: number[][] = people.map(() => []);
  const asChild: number[][] = people.map(() => []);
  partnersOf.forEach((ps, f) => { for (const p of ps) asPartner[p].push(f); });
  childrenOf.forEach((cs, f) => { for (const c of cs) asChild[c].push(f); });
  // Nodes: people 0..n-1, then families n..n+families-1.
  const year = new Float64Array(n + partnersOf.length);
  const depth = new Int32Array(n + partnersOf.length).fill(-1);
  let frontier: number[] = [];
  people.forEach((p, i) => {
    const own = p.birth ?? p.event;
    if (own !== null) { year[i] = own; depth[i] = 0; frontier.push(i); }
  });
  for (let d = 0; frontier.length > 0; d++) {
    const next: number[] = [];
    const reach = (node: number, y: number) => {
      if (depth[node] === -1) { depth[node] = d + 1; year[node] = y; next.push(node); }
      else if (depth[node] === d + 1 && y < year[node]) year[node] = y;
    };
    for (const node of frontier) {
      if (node < n) {
        for (const f of asPartner[node]) reach(n + f, year[node] + SAME_GENERATION_YEARS);
        for (const f of asChild[node]) reach(n + f, year[node] - GENERATION_YEARS);
      } else {
        for (const p of partnersOf[node - n]) reach(p, year[node]);
        for (const c of childrenOf[node - n]) reach(c, year[node] + GENERATION_YEARS);
      }
    }
    frontier = next;
  }
  return people.map((p, i): LivingBasis => {
    if (p.died) return { by: 'death' };
    if (depth[i] === 0) return { by: p.birth !== null ? 'birth' : 'event', year: year[i] };
    if (depth[i] > 0) return { by: 'relatives', year: year[i], steps: depth[i] / 2 };
    return { by: 'none' };
  });
}
const DEATH_EVENTS = new Set(['DEAT', 'BURI', 'CREM']);

/** Display gender, as the Gonsalves site maps it (lib/individual-mapper.ts formatGender). */
function genderOf(sex: string | undefined, gender: string | undefined): string | null {
  if (sex) return ({ M: 'Male', F: 'Female', U: 'Unknown', X: 'Other' } as Record<string, string>)[sex] ?? sex;
  return gender || null;
}

/** One edge's PEDI as the engine takes it: lower case, as written; none is "birth". */
const pediOfEdge = (edge: ParentChildEdge): string => (edge.pedigree ?? '').trim().toLowerCase() || 'birth';

/**
 * The engine's child type (UnionChild.pedi): the GEDCOM PEDI in lower case,
 * as written (birth, adopted, foster, sealing; anything else is kept, in
 * lower case), and "birth" when there is none. The pedigree is read, never
 * the relationship type, which the enricher derives from it. When the two
 * parents' edges differ (a mixed-parentage note: one birth parent, one
 * adoptive), the first that isn't "birth".
 */
function pediOf(edges: ParentChildEdge[]): string {
  return edges.map(pediOfEdge).find(p => p !== 'birth') ?? 'birth';
}

const relationOf = (e: ParentChildEdge | undefined): Relation | null =>
  e ? { relationship: e.relationship_type, pedigree: e.pedigree ?? '' } : null;

/** Rows grouped by a key, each group in table order. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** The first row of each xref, and the lines of every xref used more than once. */
function firstOfEach<T extends { xref: string }>(rows: readonly T[], lines: readonly number[]): {
  first: Map<string, { row: T; line: number }>; duplicates: Duplicate[];
} {
  const first = new Map<string, { row: T; line: number }>();
  const all = new Map<string, number[]>();
  rows.forEach((row, i) => {
    if (!first.has(row.xref)) first.set(row.xref, { row, line: lines[i] });
    const l = all.get(row.xref);
    if (l) l.push(lines[i]);
    else all.set(row.xref, [lines[i]]);
  });
  const duplicates = [...all].filter(([, l]) => l.length > 1).map(([id, l]) => ({ id, lines: l }));
  return { first, duplicates };
}

/** The given names and surname of each name form, by form index. */
function nameParts(t: Tables): { given: string[]; surname: string[] } {
  const n = t.NameForms.length;
  const join = (links: { name_form_index: number; position: number; value: string }[]) => {
    const parts: { position: number; value: string }[][] = Array.from({ length: n }, () => []);
    for (const l of links) parts[l.name_form_index]?.push(l);
    return parts.map(p => p.sort((a, b) => a.position - b.position).map(x => x.value).join(' '));
  };
  return {
    given: join(t.NameFormGivenNames.map(l => ({ ...l, value: t.GivenNames[l.given_name_index]?.value ?? '' }))),
    surname: join(t.NameFormSurnames.map(l => ({ ...l, value: t.Surnames[l.surname_index]?.value ?? '' }))),
  };
}

/**
 * Each person's name forms, primary first. Records that share an xref each
 * start with a primary form; only the first record's forms are kept.
 */
function formsByPerson(t: Tables): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const done = new Set<string>();
  t.NameForms.forEach((f, i) => {
    const x = f.individual_xref;
    if (done.has(x)) return;
    const list = out.get(x);
    if (f.is_primary && list) { done.add(x); return; } // a second record's forms
    if (list) list.push(i);
    else out.set(x, [i]);
  });
  return out;
}

export function buildGraph(e: Enriched, opts: GraphOptions): TreeData {
  const t = e.tables;
  const date = (i: number): ParsedDate | undefined => (i >= 0 ? t.Dates[i] : undefined);
  const yearOf = (i: number): number | null => date(i)?.year || null;
  const placeOf = (i: number): string | null => (i >= 0 ? t.Places[i]?.original ?? null : null);
  const datePlace = (d: number, p: number): DatePlace | null =>
    d < 0 && p < 0 ? null : { date: date(d)?.original ?? '', year: yearOf(d), place: placeOf(p) ?? '' };

  const people = firstOfEach(t.Individuals, e.lines.individuals);
  const families = firstOfEach(t.Families, e.lines.families);
  const eventsOf = groupBy(t.Events, ev => `${ev.owner_type} ${ev.owner_xref}`);
  const parts = nameParts(t);
  const forms = formsByPerson(t);
  const childrenOf = groupBy(t.FamilyChildren, c => c.family_xref);
  const edgesOf = groupBy(t.ParentChild, pc => `${pc.family_xref} ${pc.child_xref}`);

  // The living rule (spec T10, amended by T32). Dead with a DEAT, BURI or
  // CREM event (a death whose year can't be read is still a death).
  // Otherwise their birth year, else their earliest dated event, else the
  // estimate from the nearest dated relatives (livingBases). Dead when that
  // year is over 100 years ago; with no date anywhere in the family, living.
  const index = new Map<string, number>();
  const livingPeople: LivingPerson[] = [];
  for (const [xref, { row: p }] of people.first) {
    index.set(xref, livingPeople.length);
    let event: number | null = null;
    for (const ev of eventsOf.get(`INDI ${xref}`) ?? []) {
      const y = yearOf(ev.date_index);
      if (y !== null && (event === null || y < event)) event = y;
    }
    livingPeople.push({
      died: (eventsOf.get(`INDI ${xref}`) ?? []).some(ev => DEATH_EVENTS.has(ev.event_type)),
      birth: yearOf(p.birth_date_index),
      event,
    });
  }
  const partnersOf: number[][] = [];
  const kidsOf: number[][] = [];
  for (const [famXref, { row: f }] of families.first) {
    const partners = [...new Set([f.husband_xref, f.wife_xref])].flatMap(x => (x === undefined ? [] : index.get(x) ?? []));
    for (const ev of eventsOf.get(`FAM ${famXref}`) ?? []) {
      const y = yearOf(ev.date_index);
      if (y === null) continue;
      for (const p of partners) {
        const own = livingPeople[p].event;
        if (own === null || y < own) livingPeople[p].event = y;
      }
    }
    partnersOf.push(partners);
    kidsOf.push([...new Set((childrenOf.get(famXref) ?? []).map(c => c.child_xref))].flatMap(x => index.get(x) ?? []));
  }
  const bases = livingBases(livingPeople, partnersOf, kidsOf);
  const living = (b: LivingBasis): boolean =>
    b.by === 'none' || (b.by !== 'death' && opts.thisYear - b.year <= LIVING_YEARS);

  const famcOrder = new Map<string, string[]>();
  const firstRow = new Map<string, number>();
  t.Individuals.forEach((p, i) => { if (!firstRow.has(p.xref)) firstRow.set(p.xref, i); });
  for (const [xref, i] of firstRow) {
    const fams = [...new Set(e.famc[i])].filter(f => families.first.has(f));
    if (fams.length > 0) famcOrder.set(xref, fams);
  }

  const graphPeople: GraphPerson[] = [];
  const personDetails = new Map<string, PersonDetails>();
  for (const [xref, { row: p, line }] of people.first) {
    const basis = bases[index.get(xref) ?? -1];
    const [primary, ...others] = forms.get(xref) ?? [];
    const birthYear = yearOf(p.birth_date_index);
    graphPeople.push({
      id: xref,
      xref,
      firstName: primary === undefined ? '' : parts.given[primary],
      lastName: primary === undefined ? '' : parts.surname[primary],
      birthYear,
      deathYear: yearOf(p.death_date_index),
      birthPlace: placeOf(p.birth_place_index),
      deathPlace: placeOf(p.death_place_index),
      gender: genderOf(p.sex, p.gender),
      isLiving: living(basis),
    });
    personDetails.set(xref, {
      line,
      fullName: p.full_name,
      sex: p.sex ?? '',
      birth: datePlace(p.birth_date_index, p.birth_place_index),
      death: datePlace(p.death_date_index, p.death_place_index),
      otherNames: others.map(i => ({ type: t.NameForms[i].name_type, given: parts.given[i], surname: parts.surname[i] })),
      living: basis,
    });
  }

  const placeholders: GraphPerson[] = [];
  const partner = (famXref: string, xref: string | undefined, role: 'husb' | 'wife'): string => {
    if (xref && people.first.has(xref)) return xref;
    const id = placeholderId(famXref, role);
    placeholders.push({
      id, xref: null, firstName: 'Unknown', lastName: '', birthYear: null, deathYear: null,
      birthPlace: null, deathPlace: null, gender: null, isLiving: false, _unknownPlaceholder: true,
    });
    return id;
  };

  const unions: GraphUnion[] = [];
  const familyDetails = new Map<string, FamilyDetails>();
  for (const [xref, { row: f, line }] of families.first) {
    const husb = partner(xref, f.husband_xref, 'husb');
    const wife = partner(xref, f.wife_xref, 'wife');
    const children: UnionChild[] = [];
    const links: ChildLink[] = [];
    const seen = new Set<string>();
    // Families sharing an xref: their edges can't be told apart, so their
    // children all join the first family (once each).
    for (const c of childrenOf.get(xref) ?? []) {
      if (seen.has(c.child_xref)) continue;
      seen.add(c.child_xref);
      const edges = edgesOf.get(`${xref} ${c.child_xref}`) ?? [];
      children.push({ id: c.child_xref, pedi: pediOf(edges) });
      links.push({
        id: c.child_xref,
        birthOrder: c.birth_order,
        father: relationOf(edges.find(pc => pc.parent_type === 'father')),
        mother: relationOf(edges.find(pc => pc.parent_type === 'mother')),
      });
    }
    unions.push({ id: xref, husb, wife, children });
    familyDetails.set(xref, { line, marriage: datePlace(f.marriage_date_index, f.marriage_place_index), children: links });
  }

  return {
    graph: { people: graphPeople.concat(placeholders), unions, famcOrder },
    details: { people: personDetails, families: familyDetails },
    problems: { duplicatePeople: people.duplicates, duplicateFamilies: families.duplicates },
  };
}
