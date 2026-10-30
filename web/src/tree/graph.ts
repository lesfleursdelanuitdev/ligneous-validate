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
  /**
   * The same for FAMS: each person's partner families in their record's order (T37's order
   * of last resort, T49). Not in the engine's GraphInput: the viewer's and the renderer's.
   */
  famsOrder: Map<string, string[]>;
}

/** One of a person's parent families (T47), in their FAMC order, then the file's. */
export interface ParentFamily {
  familyId: string;
  /** The person's pedi in that family: birth, adopted, foster, sealing or as written. */
  type: string;
  /** "Birth parents", "Adoptive parents", "Foster parents"… */
  label: string;
  /** The parents' ids, husband first; unknown partners are left out. */
  parents: string[];
}

/** One of a person's partner families, in their FAMS order, then the file's. */
export interface PartnerFamily {
  familyId: string;
  /** The partner's id; absent when the partner is unknown. */
  partnerId?: string;
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
  /** Every family they are a child of (T47). */
  parentFamilies: ParentFamily[];
  /** Every family they are a partner in. */
  partnerFamilies: PartnerFamily[];
}

const PARENT_LABELS: Record<string, string> = {
  birth: 'Birth parents', adopted: 'Adoptive parents', foster: 'Foster parents', sealing: 'Sealing parents',
};

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
 * else their own earliest dated event, starts a walk across the family: a
 * breadth-first search from every dated person at once, through people and
 * families, so each person gets the estimate from the fewest relations away,
 * and the earliest year where estimates as near disagree. A relation is a
 * parent (the year minus 15), a child (plus 15), a partner or a sibling
 * (plus 0); each is two hops through the family: in from a partner +0 or
 * from a child −15, out to a partner +0 or to a child +15.
 *
 * In two passes (T48): first through birth links only (a child whose pedi
 * is birth), partners and siblings; then, nearest first, on to the people
 * that left out, through adoptive, foster and other links too. Adoptive
 * parents can be any age (a boy adopted by a couple born 30 years before
 * his mother), so they estimate only those nothing else reaches. Each
 * person and family is visited at most twice: O(people + families + links).
 */
function livingBases(people: LivingPerson[], partnersOf: number[][], childrenOf: number[][], birthLink: boolean[][]): LivingBasis[] {
  const n = people.length;
  const asPartner: number[][] = people.map(() => []);
  const asBirthChild: number[][] = people.map(() => []);
  const asOtherChild: number[][] = people.map(() => []);
  partnersOf.forEach((ps, f) => { for (const p of ps) asPartner[p].push(f); });
  childrenOf.forEach((cs, f) => cs.forEach((c, k) => (birthLink[f][k] ? asBirthChild : asOtherChild)[c].push(f)));
  // Nodes: people 0..n-1, then families n..n+families-1.
  const year = new Float64Array(n + partnersOf.length);
  const depth = new Int32Array(n + partnersOf.length).fill(-1);
  const visit = (node: number, every: boolean, reach: (to: number, y: number) => void) => {
    if (node < n) {
      for (const f of asPartner[node]) reach(n + f, year[node] + SAME_GENERATION_YEARS);
      for (const f of asBirthChild[node]) reach(n + f, year[node] - GENERATION_YEARS);
      if (every) for (const f of asOtherChild[node]) reach(n + f, year[node] - GENERATION_YEARS);
    } else {
      const f = node - n;
      for (const p of partnersOf[f]) reach(p, year[node]);
      childrenOf[f].forEach((c, k) => { if (every || birthLink[f][k]) reach(c, year[node] + GENERATION_YEARS); });
    }
  };
  // Pass 1: birth links, partners and siblings.
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
    for (const node of frontier) visit(node, false, reach);
    frontier = next;
  }
  // Pass 2: every link, to the nodes pass 1 left out, nearest first. Not
  // needed when every child's link is a birth link.
  if (birthLink.every(l => l.every(Boolean))) return basesOf(people, year, depth);
  const settled = new Uint8Array(depth.length);
  const byDepth: number[][] = [];
  depth.forEach((d, node) => { if (d >= 0) { settled[node] = 1; (byDepth[d] ??= []).push(node); } });
  for (let d = 0; d < byDepth.length; d++) {
    const reach = (node: number, y: number) => {
      if (depth[node] === -1) { depth[node] = d + 1; year[node] = y; (byDepth[d + 1] ??= []).push(node); }
      else if (!settled[node] && depth[node] === d + 1 && y < year[node]) year[node] = y;
    };
    for (const node of byDepth[d] ?? []) visit(node, true, reach);
  }
  return basesOf(people, year, depth);
}

function basesOf(people: LivingPerson[], year: Float64Array, depth: Int32Array): LivingBasis[] {
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

  // The living rule (spec T10, amended by T32 and T48). Dead with a DEAT,
  // BURI or CREM event (a death whose year can't be read is still a death).
  // Otherwise their birth year, else their earliest dated event, else the
  // estimate from the nearest dated relatives (livingBases). Dead when that
  // year is over 100 years ago; with no date anywhere in the family, living.
  const index = new Map<string, number>();
  const livingPeople: LivingPerson[] = [];
  for (const [xref, { row: p }] of people.first) {
    index.set(xref, livingPeople.length);
    let event: number | null = null;
    let died = false;
    for (const ev of eventsOf.get(`INDI ${xref}`) ?? []) {
      const y = yearOf(ev.date_index);
      if (y !== null && (event === null || y < event)) event = y;
      if (DEATH_EVENTS.has(ev.event_type)) died = true;
    }
    livingPeople.push({ died, birth: yearOf(p.birth_date_index), event });
  }
  const partnersOf: number[][] = [];
  const kidsOf: number[][] = [];
  const birthLinks: boolean[][] = [];
  for (const u of unions) {
    const partners: number[] = [];
    for (const x of u.husb === u.wife ? [u.husb] : [u.husb, u.wife]) {
      const i = index.get(x);
      if (i !== undefined) partners.push(i);
    }
    for (const ev of eventsOf.get(`FAM ${u.id}`) ?? []) {
      const y = yearOf(ev.date_index);
      if (y === null) continue;
      for (const p of partners) {
        const own = livingPeople[p].event;
        if (own === null || y < own) livingPeople[p].event = y;
      }
    }
    partnersOf.push(partners);
    const kids: number[] = [];
    const birth: boolean[] = [];
    for (const c of u.children) {
      const i = index.get(c.id);
      if (i === undefined) continue;
      kids.push(i);
      birth.push(c.pedi === 'birth');
    }
    kidsOf.push(kids);
    birthLinks.push(birth);
  }
  const bases = livingBases(livingPeople, partnersOf, kidsOf, birthLinks);
  const living = (b: LivingBasis): boolean =>
    b.by === 'none' || (b.by !== 'death' && opts.thisYear - b.year <= LIVING_YEARS);

  const famcOrder = new Map<string, string[]>();
  const famsOrder = new Map<string, string[]>();
  const firstRow = new Map<string, number>();
  t.Individuals.forEach((p, i) => { if (!firstRow.has(p.xref)) firstRow.set(p.xref, i); });
  // Families in the file, once each, in the list's order.
  const known = (list: string[]): string[] =>
    list.length < 2 ? list.filter(f => families.first.has(f)) : [...new Set(list)].filter(f => families.first.has(f));
  for (const [xref, i] of firstRow) {
    const famc = known(e.famc[i]);
    if (famc.length > 0) famcOrder.set(xref, famc);
    const fams = known(e.fams[i]);
    if (fams.length > 0) famsOrder.set(xref, fams);
  }

  // Each person's parent and partner families: in their record's FAMC or
  // FAMS order, then the rest in the file's order (as the engine orders them).
  const real = (id: string) => people.first.has(id);
  // Union indexes per person, in the file's order.
  const childIn = new Map<string, number[]>();
  const partnerIn = new Map<string, number[]>();
  const add = (m: Map<string, number[]>, k: string, i: number) => { const l = m.get(k); if (l) l.push(i); else m.set(k, [i]); };
  unions.forEach((u, i) => {
    for (const c of u.children) add(childIn, c.id, i);
    add(partnerIn, u.husb, i);
    if (u.wife !== u.husb) add(partnerIn, u.wife, i);
  });
  const ordered = (list: number[], order: string[] | undefined): number[] => {
    if (list.length < 2 || !order) return list;
    const rank = (i: number) => { const at = order.indexOf(unions[i].id); return at >= 0 ? at : order.length + i; };
    return [...list].sort((a, b) => rank(a) - rank(b));
  };
  const parentFamiliesOf = (xref: string): ParentFamily[] => {
    const list = childIn.get(xref);
    if (!list) return [];
    return ordered(list, famcOrder.get(xref)).map(i => {
      const u = unions[i];
      let pedi = 'birth';
      for (const c of u.children) if (c.id === xref) { pedi = c.pedi; break; }
      const parents: string[] = [];
      if (real(u.husb)) parents.push(u.husb);
      if (u.wife !== u.husb && real(u.wife)) parents.push(u.wife);
      return { familyId: u.id, type: pedi, label: PARENT_LABELS[pedi] ?? 'Parents', parents };
    });
  };
  const partnerFamiliesOf = (xref: string): PartnerFamily[] => {
    const list = partnerIn.get(xref);
    if (!list) return [];
    return ordered(list, famsOrder.get(xref)).map(i => {
      const u = unions[i];
      const other = u.husb === xref ? u.wife : u.husb;
      return real(other) ? { familyId: u.id, partnerId: other } : { familyId: u.id };
    });
  };

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
      parentFamilies: parentFamiliesOf(xref),
      partnerFamilies: partnerFamiliesOf(xref),
    });
  }

  return {
    graph: { people: graphPeople.concat(placeholders), unions, famcOrder, famsOrder },
    details: { people: personDetails, families: familyDetails },
    problems: { duplicatePeople: people.duplicates, duplicateFamilies: families.duplicates },
  };
}
