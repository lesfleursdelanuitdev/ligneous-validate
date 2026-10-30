// A person's life events as a vertical timeline (spec T40): their own events
// in date order, with muted family context (their children's births, their
// partners' and parents' deaths), undated events last. Every value is the
// enricher's: the event, its date as written, the year it read, the place
// as written, the value. Nothing for a living person under Hide living people.
//
// timelineSource indexes the tables once (O(rows)); timelineFor then costs
// only that person's events and their family's. The worker keeps the source
// of the last file it read and answers for one person at a time.
//
// No value imports: Node runs this file as it is.

import type { TreeData } from './graph';
import type { Enriched, ParsedDate, Tables } from './tables';

export interface TimelineEvent {
  /** The GEDCOM tag: BIRT, CHR, RESI, OCCU, MARR, EVEN… */
  type: string;
  /** The enricher's label for an event (an EVEN's TYPE when it has one); for an attribute or a residence, the same catalogue's. */
  label: string;
  /** The date as written; "" when there is none. */
  date: string;
  /** The year the enricher read from it, for sorting; null when undated (or the year can't be read). */
  year: number | null;
  /** The place as written; "" when there is none. */
  place: string;
  /** The value as written: an occupation, an address, DEAT's "Y"; "" when there is none. */
  value: string;
  /** True for family context: a child's birth, a partner's or parent's death. */
  context: boolean;
  /** Whose event it is, or who shares it: the partner of a family event; the child, partner or parent of a context event. */
  relation?: 'partner' | 'child' | 'parent';
  /** That person's id (absent when the partner is unknown). */
  personId?: string;
  /** The family the event belongs to or comes through. */
  familyId?: string;
}

/**
 * Labels for attributes and residence: the enricher's own catalogue
 * (enricher/event_label.go standardEventCatalog), which Events already
 * carry as event_label, but Attributes and Residences don't.
 */
const LABELS: Record<string, string> = {
  CAST: 'Caste', DSCR: 'Description', EDUC: 'Education', FACT: 'Fact', IDNO: 'National ID',
  NATI: 'Nationality', NMR: 'Marriage Count', OCCU: 'Occupation', PROP: 'Property', RELI: 'Religion',
  RESI: 'Residence', SSN: 'Social Security Number', TITL: 'Title',
};

interface Item {
  event: TimelineEvent;
  /** Sort key: year, month, day (0 when unknown); undated last. */
  y: number;
  m: number;
  d: number;
}

export interface TimelineSource {
  readonly items: (owner: string) => Item[];
  readonly births: (person: string) => Item[];
  readonly deaths: (person: string) => Item[];
  readonly asPartner: ReadonlyMap<string, TreeData['graph']['unions']>;
  readonly asChild: ReadonlyMap<string, TreeData['graph']['unions']>;
  readonly living: ReadonlyMap<string, boolean>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Indexes the tables for timelineFor: once per file, O(rows). */
export function timelineSource(e: Enriched, tree: TreeData): TimelineSource {
  const t: Tables = e.tables;
  const dateOf = (i: number): ParsedDate | undefined => (i >= 0 ? t.Dates[i] : undefined);
  const placeOf = (i: number): string => (i >= 0 ? t.Places[i]?.original ?? '' : '');
  const item = (type: string, label: string, dateIndex: number, placeIndex: number, value: string, order: number): Item & { order: number } => {
    const d = dateOf(dateIndex);
    const year = d?.year || null;
    return {
      event: { type, label, date: d?.original ?? '', year, place: placeOf(placeIndex), value, context: false },
      y: year ?? Infinity, m: d?.month ?? 0, d: d?.day ?? 0, order,
    };
  };
  // Each owner's items (events, attributes, residences) in its record's order.
  const byOwner = new Map<string, (Item & { order: number })[]>();
  const eventItem = (i: number) => {
    const ev = t.Events[i];
    return ev && item(ev.event_type, ev.event_label || ev.event_type, ev.date_index, ev.place_index, ev.value ?? '', ev.sort_order);
  };
  for (const l of t.IndividualEvents) { const it = eventItem(l.event_index); if (it) push(byOwner, `INDI ${l.individual_xref}`, it); }
  for (const l of t.FamilyEvents) { const it = eventItem(l.event_index); if (it) push(byOwner, `FAM ${l.family_xref}`, it); }
  for (const a of t.Attributes) {
    push(byOwner, `${a.owner_type} ${a.owner_xref}`,
      item(a.attribute_type, LABELS[a.attribute_type] ?? a.attribute_type, a.date_index, a.place_index, a.value ?? '', a.sort_order));
  }
  for (const r of t.Residences) {
    push(byOwner, `${r.owner_type} ${r.owner_xref}`, item('RESI', LABELS.RESI, r.date_index, r.place_index, r.address ?? '', r.sort_order));
  }
  for (const list of byOwner.values()) list.sort((a, b) => a.order - b.order);
  const items = (owner: string): Item[] => byOwner.get(owner) ?? [];
  const ofType = (person: string, type: string) => items(`INDI ${person}`).filter(i => i.event.type === type);

  const asPartner = new Map<string, TreeData['graph']['unions']>();
  const asChild = new Map<string, TreeData['graph']['unions']>();
  for (const u of tree.graph.unions) {
    for (const p of new Set([u.husb, u.wife])) push(asPartner, p, u);
    for (const c of u.children) push(asChild, c.id, u);
  }
  const living = new Map(tree.graph.people.filter(p => p._unknownPlaceholder !== true).map(p => [p.id, p.isLiving]));
  return {
    items, asPartner, asChild, living,
    births: person => ofType(person, 'BIRT'),
    deaths: person => ofType(person, 'DEAT'),
  };
}

/**
 * One person's timeline: their own events, attributes and residences; the
 * events of each family they are a partner in, with the partner; then the
 * context. In date order (year, month, day), each owner's events in their
 * record's order on a tie, undated events last. Under hideLiving, nothing
 * for a living person, and no context about a living relative.
 */
export function timelineFor(personId: string, source: TimelineSource, opts: { hideLiving: boolean }): TimelineEvent[] {
  const isLiving = source.living.get(personId);
  if (isLiving === undefined || (opts.hideLiving && isLiving)) return [];
  const out: Item[] = [...source.items(`INDI ${personId}`)];
  const known = (id: string) => source.living.has(id);
  const hidden = (id: string) => opts.hideLiving && source.living.get(id) === true;
  const add = (from: Item[], extra: Partial<TimelineEvent>) => {
    for (const i of from) out.push({ ...i, event: { ...i.event, ...extra } });
  };
  const partnerUnions = source.asPartner.get(personId) ?? [];
  for (const u of partnerUnions) {
    const other = u.husb === personId ? u.wife : u.husb;
    add(source.items(`FAM ${u.id}`), { relation: 'partner', ...(known(other) ? { personId: other } : {}), familyId: u.id });
  }
  // Context, each relative once.
  const seen = new Set<string>([personId]);
  const context = (id: string, relation: 'partner' | 'child' | 'parent', familyId: string, from: (p: string) => Item[]) => {
    if (seen.has(`${relation} ${id}`) || !known(id) || hidden(id) || id === personId) return;
    seen.add(`${relation} ${id}`);
    add(from(id), { context: true, relation, personId: id, familyId });
  };
  for (const u of partnerUnions) {
    for (const c of u.children) context(c.id, 'child', u.id, source.births);
    context(u.husb === personId ? u.wife : u.husb, 'partner', u.id, source.deaths);
  }
  for (const u of source.asChild.get(personId) ?? []) {
    context(u.husb, 'parent', u.id, source.deaths);
    context(u.wife, 'parent', u.id, source.deaths);
  }
  // A stable sort: ties keep the order above (own, family, context).
  out.sort((a, b) => (a.y === b.y ? 0 : a.y < b.y ? -1 : 1) || a.m - b.m || a.d - b.d);
  return out.map(i => i.event);
}
