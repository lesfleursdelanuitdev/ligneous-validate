// The repair checklist's view model: which kinds of fix the file could use,
// which are ticked, which can be ticked, and what a run did. Pure functions
// (unit-tested in checklist.test.ts); repaircard.ts draws them.

import { NOTE_55, countLabel, formatNumber, groupChanges, leftItems, lineText } from './render';
import type { LeftItem } from './render';
import { kindOfCode } from './codes';
import type { Counts, Fix, FixInfo, PlanOut, RepairOut, Result, Unit, Units } from './types';

export const FORMAT_KINDS: Fix[] = ['encoding', 'bom', 'line-endings', 'blank-lines', 'leading-space', 'long-lines', 'trailer'];
export const DATA_KINDS: Fix[] = ['broken-links', 'empty-families', 'submitter'];
const CATALOGUE: Fix[] = [...FORMAT_KINDS, ...DATA_KINDS];

export const FORMAT_LABELS: Record<string, string> = {
  encoding: 'Convert to UTF-8 (and say so in the header)',
  bom: 'Remove the byte order mark',
  'line-endings': 'Fix line endings',
  'blank-lines': 'Remove blank lines',
  'leading-space': 'Remove spaces before the level number',
  'long-lines': 'Split lines that are too long',
  trailer: 'Add the end-of-file marker',
};
export const DATA_LABELS: Record<string, string> = {
  'broken-links': "Remove links to records that don't exist",
  'empty-families': 'Remove families with nobody in them',
  submitter: 'Add you as the person who made this file',
};
export const LABELS = { ...FORMAT_LABELS, ...DATA_LABELS } as Record<Fix, string>;

/** The longest submitter name the library takes, in characters. */
export const MAX_NAME = 120;

// The library's reasons (repair/options.go).
const R_NEEDS_UTF8 = 'needs the conversion to UTF-8';
const R_FAMILY_DATA = 'this family has its own information (events, notes or sources)';
const R_NEEDS_NAME = 'needs a name';
const R_NEEDS_LINKS = 'needs broken-links too';
const R_SOME_FAMILIES = "some families need “Remove links to records that don't exist” too";
const R_READ_CHANGE = 'skipped: it would change how the file is read';
const R_NAME_LONG = 'the name is too long';

export { isDataCode } from './codes';

export interface Run {
  fixes: Fix[];
  /** The submitter name sent with the run (only matters when fixes has "submitter"). */
  name: string;
  /** Kinds that were ticked but not sent: the submitter without a name. */
  leftOut: Fix[];
}

export interface Checklist {
  available: FixInfo[];
  /** Plan's preview for the current ticks; null until Plan has answered. */
  units: Units | null;
  /** The visitor's own ticks; a kind that isn't here has its default (format on, data off). */
  user: Map<Fix, boolean>;
  name: string;
  /** Kinds ticked on the visitor's behalf, with the kind that did it (for the note). */
  alsoTicked: Map<Fix, Fix>;
  /** The run on screen, or null. */
  ran: Run | null;
}

export function newChecklist(available: FixInfo[], units: Units | null = null): Checklist {
  return { available: sortInfos(available), units, user: new Map(), name: '', alsoTicked: new Map(), ran: null };
}

/** Plan's answer for the current ticks; the visitor's ticks are kept. */
export function setPlan(c: Checklist, plan: PlanOut): void {
  c.available = sortInfos(plan.available);
  c.units = plan.units ?? null;
}

/** A run's own list of kinds (the same as Plan's); the visitor's ticks and the preview are kept. */
export function setAvailable(c: Checklist, available: FixInfo[]): void {
  c.available = sortInfos(available);
}

const sortInfos = (a: FixInfo[]): FixInfo[] =>
  [...a].sort((x, y) => CATALOGUE.indexOf(x.fix) - CATALOGUE.indexOf(y.fix));

const info = (c: Checklist, fix: Fix): FixInfo | undefined => c.available.find(a => a.fix === fix);

/** Not offered: the library lists it with no lines and a reason (a family with data of its own). */
const notOffered = (a: FixInfo): boolean => a.lines <= 0 && !a.required && !!a.reason && a.fix === 'empty-families';

/** The rows the checklist shows: offered kinds, plus a not-offered one with its reason. */
function shown(c: Checklist): FixInfo[] {
  return c.available.filter(a => a.lines > 0 || a.required || notOffered(a));
}

const chosenRaw = (c: Checklist, fix: Fix): boolean => {
  const own = c.user.get(fix);
  if (own !== undefined) return own;
  return !DATA_KINDS.includes(fix);
};

/** Waits for encoding: a kind that only works with the conversion while encoding isn't ticked. */
function blocked(c: Checklist, a: FixInfo): boolean {
  if (a.fix === 'encoding' || a.reason !== R_NEEDS_UTF8) return false;
  const enc = info(c, 'encoding');
  return !(enc && (enc.required || chosenRaw(c, 'encoding')));
}

function enabled(c: Checklist, a: FixInfo): boolean {
  return !a.required && !notOffered(a) && !blocked(c, a);
}

function checked(c: Checklist, a: FixInfo): boolean {
  if (a.required) return true;
  if (!enabled(c, a)) return false;
  return chosenRaw(c, a.fix);
}

/**
 * The name as the library writes it (repair/data.go cleanName): zero-width
 * characters (U+200B-U+200D, U+FEFF) removed, every run of white space (Go's
 * unicode.IsSpace: tabs, line breaks, U+0085, U+00A0, U+2028, U+2029, ...)
 * made one space, other C0 and C1 controls removed, no space at either end.
 */
export function cleanName(s: string): string {
  return s
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f]/g, '')
    .replace(/[\s\u0085]+/g, ' ')
    .trim();
}

/** The library's limit: "1 NAME " plus the name in at most 255 bytes. */
const MAX_NAME_BYTES = 248;

/** Why the name can't be used, or null. */
function nameProblem(name: string): string | null {
  const n = cleanName(name);
  if (n === '') return R_NEEDS_NAME;
  if ([...n].length > MAX_NAME || new TextEncoder().encode(n).length > MAX_NAME_BYTES) return R_NAME_LONG;
  return null;
}

const hasName = (c: Checklist): boolean => nameProblem(c.name) === null;

/**
 * Ticks or unticks a kind. Returns the kinds ticked along with it (broken-links,
 * when empty-families needs it). A required or disabled kind doesn't change.
 */
export function setChosen(c: Checklist, fix: Fix, on: boolean): Fix[] {
  const a = info(c, fix);
  if (!a || a.required || notOffered(a)) return [];
  c.user.set(fix, on);
  if (!on) {
    for (const [k, by] of c.alsoTicked) if (by === fix) c.alsoTicked.delete(k);
    c.alsoTicked.delete(fix);
    return [];
  }
  // What it needs to do all it can (Plan's Needs) is ticked along with it.
  const also: Fix[] = [];
  for (const n of a.needs ?? []) {
    const need = info(c, n);
    if (!need || !enabled(c, need) || chosenRaw(c, n)) continue;
    c.user.set(n, true);
    c.alsoTicked.set(n, fix);
    also.push(n);
  }
  return also;
}

export function setName(c: Checklist, name: string): void {
  c.name = name.slice(0, MAX_NAME);
}

/** What "Repair selected" sends, in catalogue order. A submitter without a name isn't sent. */
export function selectedFixes(c: Checklist): Fix[] {
  return shown(c).filter(a => checked(c, a) && (a.fix !== 'submitter' || hasName(c))).map(a => a.fix);
}

/** Ticked kinds that "Repair selected" leaves out: the submitter without a name. */
export function selectedLeftOut(c: Checklist): Fix[] {
  const sub = info(c, 'submitter');
  return sub && shown(c).includes(sub) && checked(c, sub) && !hasName(c) ? ['submitter'] : [];
}

/**
 * "Repair everything": every kind that can run, with every box ticked to
 * match. The submitter needs a name; without one it is left out.
 */
export function everything(c: Checklist): { fixes: Fix[]; leftOut: Fix[] } {
  for (const a of shown(c)) if (!a.required && !notOffered(a)) c.user.set(a.fix, true);
  return { fixes: selectedFixes(c), leftOut: selectedLeftOut(c) };
}

/** Records the run now on screen, and what it taught us. */
export function markRan(c: Checklist, run: Run, out: RepairOut): void {
  // Only the kinds the run could use: a kind the estimate had but the file
  // doesn't need would otherwise mark a fresh result out of date.
  const could = out.available ? new Set(out.available.map(a => a.fix)) : null;
  const fixes = could ? run.fixes.filter(f => could.has(f)) : [...run.fixes];
  c.ran = { fixes, name: run.name, leftOut: [...run.leftOut] };
}

/** The ticks no longer match the run on screen. */
export function isOutOfDate(c: Checklist): boolean {
  if (!c.ran) return false;
  const now = selectedFixes(c);
  if (now.join() !== c.ran.fixes.join()) return true;
  return now.includes('submitter') && cleanName(c.name) !== cleanName(c.ran.name);
}

// ---------------------------------------------------------------- rows

export interface RowView {
  fix: Fix;
  kind: 'format' | 'data';
  label: string;
  count: string;
  checked: boolean;
  disabled: boolean;
  /** Why it is required, waits for another kind, or stays; tied to the row with aria-describedby. */
  reason: string | null;
  /** A note under the row: what else was ticked, or that a name is needed. */
  note: string | null;
  /** The submitter's name field shows. */
  nameField: boolean;
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** The lines a unit removes (a data kind's line and those under it) or adds (the submitter). */
function unitLines(fix: Fix, u: { lines?: string[]; removed?: string[]; what: string }): number {
  const lines = u.lines ?? u.removed ?? [];
  if (fix === 'submitter') return lines.length || (u.what.startsWith('added a submitter') ? 2 : 1);
  return 1 + lines.length;
}

const ADDS = (fix: Fix) => fix === 'submitter';

/** A row's count: Plan's units for a data kind when there are some, else Available's lines. */
export function countText(a: FixInfo, units: Unit[] | null | undefined): string {
  if (a.kind === 'data') {
    const n = units && units.length ? units.reduce((t, u) => t + unitLines(a.fix, u), 0) : a.lines;
    if (n <= 0) return '';
    return ADDS(a.fix) ? plural(n, 'line added', 'lines added') : plural(n, 'line removed', 'lines removed');
  }
  if (a.fix === 'encoding' || a.lines <= 0) return 'whole file';
  return plural(a.lines, 'line', 'lines');
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

/** A library reason as a sentence for the page. */
export function reasonText(fix: Fix, reason: string): string {
  switch (reason) {
    case R_NEEDS_UTF8: return `This needs “${LABELS.encoding}” too.`;
    case R_FAMILY_DATA: return 'The family with nobody in it has its own information (events, notes or sources), so it stays.';
    case R_NEEDS_NAME: return 'Type your name to include this.';
    case R_NEEDS_LINKS:
      return `These families only have nobody in them once the broken links are gone, so this needs “${LABELS['broken-links']}” too.`;
    case R_SOME_FAMILIES:
      return `Some families only have nobody in them once the broken links are gone; they need “${LABELS['broken-links']}” too.`;
    case R_READ_CHANGE: return 'Left as it is where changing it could change how your file is read.';
    case R_NAME_LONG: return 'The name is too long.';
    default: return reason ? sentence(reason) : '';
  }
}

/** Why a kind wants another (Needs) that isn't ticked. */
function needsText(a: FixInfo, missing: Fix): string {
  if (a.fix === 'empty-families' && missing === 'broken-links') {
    return `Some of these families only have nobody in them once the broken links are gone, so this needs “${LABELS['broken-links']}” too.`;
  }
  return `To do all it can, this needs “${LABELS[missing]}” too.`;
}

export function rowView(c: Checklist, a: FixInfo): RowView {
  const on = checked(c, a);
  let reason: string | null = null;
  if (a.required && a.reason) reason = reasonText(a.fix, a.reason);
  else if (notOffered(a) || blocked(c, a)) reason = reasonText(a.fix, a.reason!);
  else {
    const missing = (a.needs ?? []).find(n => info(c, n) && !checked(c, info(c, n)!));
    if (missing) reason = needsText(a, missing);
  }
  let note: string | null = null;
  const also = [...c.alsoTicked].find(([k, by]) => by === a.fix && chosenRaw(c, k));
  if (a.fix === 'submitter' && on && !hasName(c)) note = reasonText('submitter', nameProblem(c.name)!);
  else if (also && on) note = `Also ticked “${LABELS[also[0]]}”, which this needs.`;
  return {
    fix: a.fix, kind: a.kind, label: LABELS[a.fix] ?? a.fix, count: countText(a, c.units?.[a.fix]),
    checked: on, disabled: !enabled(c, a), reason, note, nameField: a.fix === 'submitter' && on,
  };
}

export function rows(c: Checklist): { format: RowView[]; data: RowView[] } {
  const all = shown(c).map(a => rowView(c, a));
  return { format: all.filter(r => r.kind === 'format'), data: all.filter(r => r.kind === 'data') };
}

export function checklistHeading(c: Checklist, r: Result): string {
  if (r.findings.every(f => f.severity === 'hint')) return 'Optional tidy-up';
  const n = shown(c).filter(a => a.kind === 'format').length;
  if (n === 0) return 'No format problems to fix';
  return `We can fix ${formatNumber(n)} ${n === 1 ? 'kind' : 'kinds'} of format problem`;
}

// ---------------------------------------------------------------- Show lines

export interface ExampleRow {
  text: string;
  /** A line the fix adds (the submitter, the trailer, CHAR, the pieces of a split). */
  added: boolean;
  /** Nested under the unit's first line (a removed link's or family's own lines). */
  nested: boolean;
}

export interface Example {
  /** 0: the whole file. */
  line: number;
  /** Where it is: "Line N", "Whole file", or where added lines go. */
  at: string;
  what: string;
  rows: ExampleRow[];
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Where a unit is. Added lines have no line of their own (their Line is the
 * line they go next to), so they say where they go: the submitter's link in
 * the header; its record and the trailer at the end. A CHAR line that is
 * there is changed in place; a missing one is added in the header.
 */
function whereOf(fix: Fix, u: Unit, own: string | null): string {
  if (u.line <= 0) return 'Whole file';
  if (fix === 'submitter') return u.what.startsWith('added a submitter record') ? 'Added at the end' : 'Added in the header';
  if (fix === 'trailer') return 'Added at the end';
  if (fix === 'encoding' && (u.lines ?? []).length && !/^\s*1\s+CHAR\b/i.test(own ?? '')) return 'Added in the header';
  return `Line ${formatNumber(u.line)}`;
}

const REMOVES: Fix[] = ['broken-links', 'empty-families'];

/**
 * The Show lines of a kind, from Plan's units for the current ticks: each
 * unit under its line number with what it does and its lines (up to 5 for a
 * format kind, 20 for a data kind), and how many more. Null before Plan has
 * answered.
 */
export function examples(fix: Fix, c: Checklist, r: Result): { items: Example[]; more: number } | null {
  const units = c.units?.[fix];
  if (!units) return null;
  const cap = DATA_KINDS.includes(fix) ? 20 : 5;
  const items = units.slice(0, cap).map((u): Example => {
    const own = u.line > 0 ? lineText(r.text, u.line) : null;
    const lines = u.lines ?? [];
    let rows: ExampleRow[];
    if (REMOVES.includes(fix)) {
      rows = [
        ...(own !== null ? [{ text: own, added: false, nested: false }] : []),
        ...lines.map(text => ({ text, added: false, nested: true })),
      ];
    } else if (fix === 'blank-lines') {
      rows = [{ text: '', added: false, nested: false }];
    } else if (lines.length) {
      rows = lines.map(text => ({ text, added: true, nested: false }));
    } else {
      rows = own !== null ? [{ text: own, added: false, nested: false }] : [];
    }
    return { line: u.line, at: whereOf(fix, u, own), what: capital(u.what), rows };
  });
  return { items, more: units.length - items.length };
}

// ---------------------------------------------------------------- after a run

export interface ResultGroup {
  fix: Fix | null;
  label: string | null;
  count: string | null;
  changes: string[];
}

export interface ResultView {
  groups: ResultGroup[];
  notApplied: { fix: Fix; label: string; reason: string }[];
  /** Problems left that a fix on this checklist can fix (tick it and repair again). */
  leftFixable: LeftItem[];
  before: string;
  after: string;
  note: string | null;
  left: LeftItem[];
}

const countsText = (c: Counts): string =>
  `${countLabel('error', c.errors)}, ${countLabel('warning', c.warnings)}, ${countLabel('hint', c.hints)}`;

export function resultView(out: RepairOut, r: Result, leftOut: Fix[]): ResultView {
  const byFix = new Map<Fix | '', RepairOut['changes']>();
  for (const ch of out.changes) {
    const k = ch.fix ?? '';
    let list = byFix.get(k);
    if (!list) byFix.set(k, (list = []));
    list.push(ch);
  }
  const groups: ResultGroup[] = [];
  for (const fix of [...CATALOGUE, ''] as (Fix | '')[]) {
    const list = byFix.get(fix);
    if (!list) continue;
    const applied = fix ? out.applied?.find(a => a.fix === fix) : undefined;
    groups.push({
      fix: fix || null,
      label: fix ? LABELS[fix] : null,
      count: applied ? plural(applied.lines, 'line', 'lines') : null,
      // A data kind's changes one by one (each a unit, with the lines it really
      // removed or added); a format kind's grouped by what was done.
      changes: fix && DATA_KINDS.includes(fix)
        ? list.map(ch => {
          const n = unitLines(fix, ch);
          const what = ADDS(fix) ? plural(n, 'line added', 'lines added') : plural(n, 'line removed', 'lines removed');
          return `${capital(ch.what)}: ${ch.line > 0 ? `line ${formatNumber(ch.line)}, ` : ''}${what}`;
        })
        : groupChanges(list),
    });
  }
  // A kind can be skipped in part (some families need broken-links): that part says how many lines.
  const partly = (f: Fix) => !!out.applied?.some(a => a.fix === f);
  const notApplied = (out.skipped ?? []).map(s => ({
    fix: s.fix,
    label: (LABELS[s.fix] ?? s.fix) + (partly(s.fix) && s.lines > 0 ? ` (${plural(s.lines, 'line', 'lines')})` : ''),
    reason: reasonText(s.fix, s.reason ?? ''),
  }));
  for (const fix of leftOut) {
    if (!notApplied.some(x => x.fix === fix)) {
      notApplied.push({ fix, label: LABELS[fix], reason: reasonText(fix, R_NEEDS_NAME) });
    }
  }
  // What is left splits by whether a kind offered on the checklist fixes it.
  const offered = new Set((out.available ?? []).filter(a => !notOffered(a) && (a.lines > 0 || a.required)).map(a => a.fix));
  const fixable = out.left.filter(code => { const k = kindOfCode(code); return k !== null && offered.has(k); });
  const rest = out.left.filter(code => !fixable.includes(code));
  return {
    groups, notApplied,
    before: countsText(out.before), after: countsText(out.after),
    note: r.summary.gedcomVersion === '5.5' ? NOTE_55 : null,
    leftFixable: leftItems(fixable, r),
    left: leftItems(rest, r),
  };
}

/** What the live region says when a run asked for has finished. */
export function announce(out: RepairOut, leftOut: Fix[]): string {
  const applied = new Set((out.applied ?? []).map(a => a.fix));
  const skipped = new Set((out.skipped ?? []).map(s => s.fix));
  for (const f of leftOut) skipped.add(f);
  const part = [...skipped].filter(f => applied.has(f)).length;
  const not = skipped.size - part;
  if (applied.size === 0 && not === 0) return 'Repaired: nothing needed changing.';
  const bits = [`${formatNumber(applied.size)} ${applied.size === 1 ? 'kind' : 'kinds'} of fix applied`];
  if (part) bits.push(`${formatNumber(part)} only in part`);
  if (not) bits.push(`${formatNumber(not)} not applied`);
  return `Repaired: ${bits.join(', ')}.`;
}
