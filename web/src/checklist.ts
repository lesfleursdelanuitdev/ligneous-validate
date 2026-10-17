// The repair checklist's view model: which kinds of fix the file could use,
// which are ticked, which can be ticked, and what a run did. Pure functions
// (unit-tested in checklist.test.ts); repaircard.ts draws them.

import {
  NOTE_55, formatNumber, groupChanges, leftItems, lineCount, lineText, countLabel,
} from './render';
import type { LeftItem } from './render';
import { CODES, kindOfCode } from './codes';
import type { Counts, Fix, FixInfo, RepairOut, Result } from './types';

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
const R_UTF16 = 'this file is UTF-16, so it has to be converted first';
const R_NEEDS_UTF8 = 'needs the conversion to UTF-8';
const R_FAMILY_DATA = 'this family has its own information (events, notes or sources)';
const R_NEEDS_NAME = 'needs a name';
const R_NEEDS_LINKS = 'needs broken-links too';
const R_NAME_LONG = 'the name is too long (at most 120 characters)';

export { isDataCode } from './codes';

/** Where the list of kinds came from: a repair, planRepair(), or an estimate from the findings. */
export type Source = 'repair' | 'plan' | 'findings';

export interface Run {
  fixes: Fix[];
  /** The submitter name sent with the run (only matters when fixes has "submitter"). */
  name: string;
  /** Kinds that were ticked but not sent: the submitter without a name. */
  leftOut: Fix[];
}

export interface Checklist {
  available: FixInfo[];
  source: Source;
  /** The visitor's own ticks; a kind that isn't here has its default (format on, data off). */
  user: Map<Fix, boolean>;
  name: string;
  /** Some empty families only go with broken-links: ticking empty-families ticks it too. */
  needsLinks: boolean;
  /** Kinds ticked on the visitor's behalf, with the kind that did it (for the note). */
  alsoTicked: Map<Fix, Fix>;
  /** The run on screen, or null. */
  ran: Run | null;
}

export function newChecklist(available: FixInfo[], source: Source, r: Result): Checklist {
  return {
    available: sortInfos(available), source, user: new Map(), name: '',
    needsLinks: familiesNeedLinks(r), alsoTicked: new Map(), ran: null,
  };
}

/** A new list of kinds (from planRepair or a run); the visitor's ticks are kept. */
export function setAvailable(c: Checklist, available: FixInfo[], source: Source): void {
  c.available = sortInfos(available);
  c.source = source;
}

const sortInfos = (a: FixInfo[]): FixInfo[] =>
  [...a].sort((x, y) => CATALOGUE.indexOf(x.fix) - CATALOGUE.indexOf(y.fix));

const info = (c: Checklist, fix: Fix): FixInfo | undefined => c.available.find(a => a.fix === fix);

/** Not offered: the library lists it with no lines and a reason (a family with data of its own). */
const notOffered = (a: FixInfo): boolean => a.lines <= 0 && !a.required && !!a.reason && a.fix === 'empty-families';

/** The rows the checklist shows: offered kinds, plus a not-offered one with its reason. */
function shown(c: Checklist): FixInfo[] {
  return c.available.filter(a => a.lines > 0 || a.required || notOffered(a) || (a.fix === 'line-endings' && c.source === 'findings'));
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
  if (fix === 'empty-families' && c.needsLinks && info(c, 'broken-links') && !chosenRaw(c, 'broken-links')) {
    c.user.set('broken-links', true);
    c.alsoTicked.set('broken-links', 'empty-families');
    return ['broken-links'];
  }
  return [];
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
  if (out.skipped?.some(s => s.fix === 'empty-families' && s.reason === R_NEEDS_LINKS)) c.needsLinks = true;
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

export function countText(a: FixInfo, source: Source): string {
  if (a.fix === 'submitter') return plural(a.lines, 'line added', 'lines added');
  if (a.fix === 'encoding' || a.lines <= 0) return a.kind === 'data' ? '' : 'whole file';
  if (source === 'findings') {
    return a.kind === 'data' ? `${formatNumber(a.lines)} found` : `about ${plural(a.lines, 'line', 'lines')}`;
  }
  return a.kind === 'data' ? plural(a.lines, 'line removed', 'lines removed') : plural(a.lines, 'line', 'lines');
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

/** A library reason as a sentence for the page. */
export function reasonText(fix: Fix, reason: string): string {
  switch (reason) {
    case R_NEEDS_UTF8: return `This needs “${LABELS.encoding}” too.`;
    case R_FAMILY_DATA: return 'The family with nobody in it has its own information (events, notes or sources), so it stays.';
    case R_NEEDS_NAME: return 'Type your name to include this.';
    case R_NEEDS_LINKS: return linksReason();
    default: return reason ? sentence(reason) : '';
  }
}

const linksReason = () =>
  `Some of these families only have nobody in them once the broken links are gone, so this needs “${LABELS['broken-links']}” too.`;

export function rowView(c: Checklist, a: FixInfo): RowView {
  const on = checked(c, a);
  let reason: string | null = null;
  if (a.required && a.reason) reason = reasonText(a.fix, a.reason);
  else if (notOffered(a) || blocked(c, a)) reason = reasonText(a.fix, a.reason!);
  else if (a.fix === 'empty-families' && c.needsLinks && info(c, 'broken-links')) reason = linksReason();
  let note: string | null = null;
  const also = [...c.alsoTicked].find(([k, by]) => by === a.fix && chosenRaw(c, k));
  if (a.fix === 'submitter' && on && !hasName(c)) note = reasonText('submitter', nameProblem(c.name)!);
  else if (also && on) note = `Also ticked “${LABELS[also[0]]}”, which this needs.`;
  return {
    fix: a.fix, kind: a.kind, label: LABELS[a.fix] ?? a.fix, count: countText(a, c.source),
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

// ---------------------------------------------------------------- the estimate

const plainEncoding = (enc: string) => enc === 'UTF-8' || enc === 'ASCII' || enc === '';

/** The kinds of fix the findings point to, when there is no repair or plan (big files). */
export function estimateAvailable(r: Result): FixInfo[] {
  const count = new Map<string, number>();
  for (const f of r.findings) count.set(f.code, (count.get(f.code) ?? 0) + 1);
  const found = (fix: Fix) => (CODES[fix] ?? []).reduce((n, code) => n + (count.get(code) ?? 0), 0);
  const enc = r.encoding.detected || r.encoding.declared;
  const utf16 = enc.startsWith('UTF-16');
  const out: FixInfo[] = [];
  const add = (fix: Fix, lines: number, over: Partial<FixInfo> = {}) => {
    const kind = DATA_KINDS.includes(fix) ? 'data' : 'format';
    out.push({ fix, kind, lines, required: false, ...(utf16 && fix !== 'encoding' ? { reason: R_NEEDS_UTF8 } : {}), ...over });
  };
  if (utf16) add('encoding', Math.max(1, r.summary.lines), { required: true, reason: R_UTF16 });
  else if (!plainEncoding(enc) || found('encoding') > 0) {
    add('encoding', r.findings.filter(f => CODES.encoding!.includes(f.code) && f.line > 0).length || 1);
  }
  if (r.bom && !utf16) add('bom', 1);
  if (r.bareCR) add('line-endings', 0);
  for (const fix of ['blank-lines', 'leading-space'] as Fix[]) if (found(fix)) add(fix, found(fix));
  if (found('long-lines')) add('long-lines', found('long-lines'), !plainEncoding(enc) || utf16 ? { reason: R_NEEDS_UTF8 } : {});
  if (found('trailer')) add('trailer', 1);
  for (const fix of ['broken-links', 'empty-families'] as Fix[]) if (found(fix)) add(fix, found(fix));
  if (found('submitter')) add('submitter', 3);
  return out;
}

// ---------------------------------------------------------------- empty families and broken links

const levelOf = (s: string): number => {
  const m = /^\s*(\d+)\s/.exec(s);
  return m ? Number(m[1]) : -1;
};
const tagOf = (s: string): string => {
  const parts = s.trim().split(/\s+/);
  return (parts[1]?.startsWith('@') ? parts[2] : parts[1]) ?? '';
};

/**
 * The families that only have nobody in them once their broken links are gone
 * (so empty-families needs broken-links): no member and nothing but CHAN,
 * RIN, _UID and REFN, apart from the broken links. Mirrors the library's
 * "needs broken-links too" from the findings and the text. Their first lines.
 */
export function linkOnlyFamilies(r: Result): number[] {
  const broken = new Set(r.findings.filter(f => CODES['broken-links']!.includes(f.code) && f.line > 0).map(f => f.line));
  const empty = new Set(r.findings.filter(f => f.code === 'EMPTY_FAMILY').map(f => f.line));
  const out: number[] = [];
  if (broken.size === 0 || !r.text) return out;
  const total = lineCount(r.text);
  const seen = new Set<number>();
  for (const line of broken) {
    let top = line;
    while (top > 1 && levelOf(lineText(r.text, top) ?? '') > 0) top--;
    if (seen.has(top) || empty.has(top)) continue;
    seen.add(top);
    const head = lineText(r.text, top) ?? '';
    if (levelOf(head) !== 0 || tagOf(head) !== 'FAM') continue;
    let members = false;
    let own = false;
    let anyBroken = false;
    for (let i = top + 1; i <= total; i++) {
      const t = lineText(r.text, i) ?? '';
      const lv = levelOf(t);
      if (lv <= 0) break;
      if (lv !== 1) continue;
      if (broken.has(i)) { anyBroken = true; continue; }
      const tag = tagOf(t);
      if (tag === 'HUSB' || tag === 'WIFE' || tag === 'CHIL') members = true;
      else if (!['CHAN', 'RIN', '_UID', 'REFN'].includes(tag)) own = true;
    }
    if (anyBroken && !members && !own) out.push(top);
  }
  return out.sort((x, y) => x - y);
}

export const familiesNeedLinks = (r: Result): boolean => linkOnlyFamilies(r).length > 0;

// ---------------------------------------------------------------- Show lines

export interface ExampleLine { line: number; text: string }
export interface Example extends ExampleLine { nested: ExampleLine[] }

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The lines nested under `line` (deeper levels), from the file's text. */
function nestedFromText(text: string, line: number): ExampleLine[] {
  const total = lineCount(text);
  const lv = levelOf(lineText(text, line) ?? '');
  const out: ExampleLine[] = [];
  if (lv < 0) return out;
  for (let i = line + 1; i <= total; i++) {
    const t = lineText(text, i) ?? '';
    if (levelOf(t) <= lv) break;
    out.push({ line: i, text: t });
  }
  return out;
}

/**
 * Up to 5 example lines for a format kind (20 for a data kind), and how many
 * more there are: from the changes of the run on screen when it had this
 * kind, or else from the findings that kind fixes. A data kind's lines come
 * with the lines nested under them.
 */
export function examples(fix: Fix, r: Result, out: RepairOut | null): { items: Example[]; more: number } {
  const cap = DATA_KINDS.includes(fix) ? 20 : 5;
  const data = DATA_KINDS.includes(fix);
  const fileLine = (n: number) => lineText(r.text, n);
  const changes = out?.changes.filter(ch => ch.fix === fix) ?? [];
  if (changes.length) {
    const items = changes.slice(0, cap).map((ch): Example => {
      const text = ch.line > 0 ? fileLine(ch.line) : null;
      if (text === null || fix === 'submitter') return { line: ch.line > 0 && text !== null ? ch.line : 0, text: capital(ch.what), nested: [] };
      return { line: ch.line, text, nested: (ch.removed ?? []).map((t, i) => ({ line: ch.line + i + 1, text: t })) };
    });
    return { items, more: changes.length - items.length };
  }
  const codes = CODES[fix] ?? [];
  const found = r.findings.filter(f => codes.includes(f.code) && f.line > 0).map(f => f.line);
  // Families that go once their broken links are gone have no finding of their own.
  if (fix === 'empty-families') found.push(...linkOnlyFamilies(r));
  const lines = [...new Set(found)].sort((a, b) => a - b);
  const items = lines.slice(0, cap).flatMap((n): Example[] => {
    const text = fileLine(n);
    if (text === null) return [];
    return [{ line: n, text, nested: data ? nestedFromText(r.text, n) : [] }];
  });
  return { items, more: lines.length - items.length };
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
      changes: groupChanges(list),
    });
  }
  const notApplied = (out.skipped ?? []).map(s => ({ fix: s.fix, label: LABELS[s.fix] ?? s.fix, reason: reasonText(s.fix, s.reason ?? '') }));
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
  const applied = out.applied?.length ?? 0;
  const not = (out.skipped?.length ?? 0) + leftOut.filter(f => !out.skipped?.some(s => s.fix === f)).length;
  if (applied === 0 && not === 0) return 'Repaired: nothing needed changing.';
  const a = `${formatNumber(applied)} ${applied === 1 ? 'kind' : 'kinds'} of fix applied`;
  return not ? `Repaired: ${a}, ${formatNumber(not)} not applied.` : `Repaired: ${a}.`;
}
