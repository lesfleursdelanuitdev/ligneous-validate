// The report. The first half is pure functions that turn a Result into what
// the page shows (unit-tested); the second half builds the DOM from them
// (covered by the e2e tests).

import { fillParts, genericTitle, pageText } from './fill';
import { smoothDetails } from './toggle';
import type { Finding, Group, RepairOut, Result, Severity } from './types';

// ---------------------------------------------------------------- view model

export const GROUPS: { id: Group; heading: string }[] = [
  { id: 'format', heading: 'File format and encoding' },
  { id: 'header', heading: 'Header' },
  { id: 'links', heading: 'Broken links' },
  { id: 'dates', heading: "Dates that don't add up" },
  { id: 'names', heading: 'Names and sex' },
];

export const SEVERITIES: Severity[] = ['error', 'warning', 'hint'];
export const PAGE_SIZE = 50;

export type SeverityFilter = Record<Severity, boolean>;

export interface ViewGroup {
  id: Group;
  heading: string;
  findings: Finding[];
}

const numbers = new Intl.NumberFormat('en-US');
export const formatNumber = (n: number): string => numbers.format(n);

const rank: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };

/** Non-empty groups in the fixed order; errors, then warnings, then hints, each by line. */
export function buildGroups(findings: Finding[], show: SeverityFilter): ViewGroup[] {
  const byGroup = new Map<Group, Finding[]>();
  for (const f of findings) {
    if (!show[f.severity]) continue;
    const g: Group = f.group === '' ? 'format' : f.group;
    let list = byGroup.get(g);
    if (!list) byGroup.set(g, (list = []));
    list.push(f);
  }
  const out: ViewGroup[] = [];
  for (const { id, heading } of GROUPS) {
    const list = byGroup.get(id);
    if (!list) continue;
    list.sort((a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line);
    out.push({ id, heading, findings: list });
  }
  return out;
}

/** The next page of items after the first `from`, and how many are left after it. */
export function visibleSlice<T>(items: T[], from: number): { items: T[]; remaining: number } {
  const page = items.slice(from, from + PAGE_SIZE);
  return { items: page, remaining: Math.max(0, items.length - from - page.length) };
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warning: 0, hint: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

export function noProblemsText(people: number): string {
  return `No problems found in ${formatNumber(people)} ${people === 1 ? 'person' : 'people'}.`;
}

export type ViewKind = 'failed' | 'not-gedcom' | 'clean' | 'report';

export function viewKind(r: Result): ViewKind {
  if (r.error) return 'failed';
  if (!r.isGedcom) return 'not-gedcom';
  return r.findings.length === 0 ? 'clean' : 'report';
}

export function lineLabel(line: number): string {
  return line > 0 ? 'Line ' + formatNumber(line) : 'Whole file';
}

const WORDS: Record<Severity, string> = { error: 'Error', warning: 'Warning', hint: 'Hint' };
export const severityWord = (s: Severity): string => WORDS[s];

export function countLabel(s: Severity, n: number): string {
  return `${formatNumber(n)} ${WORDS[s].toLowerCase()}${n === 1 ? '' : 's'}`;
}

// Line starts for the last text seen, so opening a finding in a 20 MB file
// doesn't split the whole file again.
let indexedText: string | null = null;
let starts: number[] = [];

function lineStarts(text: string): number[] {
  if (text === indexedText) return starts;
  const s = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      s.push(i + 1);
    } else if (c === 10) {
      s.push(i + 1);
    }
  }
  indexedText = text;
  starts = s;
  return s;
}

/** The number of lines in text (a trailing line end doesn't start another). */
export function lineCount(text: string): number {
  const s = lineStarts(text);
  return s[s.length - 1] === text.length && text.length > 0 ? s.length - 1 : s.length;
}

/** Line n (1-based) of text without its line end, or null when there is no such line. */
export function lineText(text: string, n: number): string | null {
  const s = lineStarts(text);
  if (n < 1 || n > lineCount(text)) return null;
  const end = n < s.length ? s[n] : text.length;
  return text.slice(s[n - 1], end).replace(/\r?\n$|\r$/, '');
}

export interface WindowLine {
  n: number;
  text: string;
  mark: boolean;
}

/** Lines line-3 … line+3 of the file, with `line` marked. Empty for line 0. */
export function lineWindow(text: string, line: number, radius = 3): WindowLine[] {
  const s = lineStarts(text);
  // A trailing line end leaves an empty last "line" that isn't in the file.
  const total = s[s.length - 1] === text.length && text.length > 0 ? s.length - 1 : s.length;
  if (line < 1 || line > total) return [];
  const out: WindowLine[] = [];
  for (let n = Math.max(1, line - radius); n <= Math.min(total, line + radius); n++) {
    const end = n < s.length ? s[n] : text.length;
    out.push({ n, text: text.slice(s[n - 1], end).replace(/\r?\n$|\r$/, ''), mark: n === line });
  }
  return out;
}

export const NOT_GEDCOM =
  'This doesn\'t look like a GEDCOM file. GEDCOM files usually end in .ged and start with "0 HEAD".';

export const FAILED =
  'The checker ran into a problem with this file and had to stop. Your file has not been changed. ' +
  'If it is very large, try exporting a smaller part of your tree.';

/** What the status line says when a file has been checked. */
export function doneText(r: Result): string {
  const kind = viewKind(r);
  if (kind === 'failed') return FAILED;
  if (kind === 'not-gedcom') return NOT_GEDCOM;
  if (kind === 'clean') return noProblemsText(r.summary.people);
  const c = countBySeverity(r.findings);
  return `Checked: ${SEVERITIES.map(s => countLabel(s, c[s])).join(', ')}.`;
}

/** The summary card: [label, value] in display order. */
export function summaryRows(r: Result, fileName: string): [string, string][] {
  const s = r.summary;
  const program = [s.program, s.programVersion].filter(Boolean).join(' ');
  const enc = r.encoding.detected || r.encoding.declared || 'Unknown';
  return [
    ['File', fileName],
    ['People', formatNumber(s.people)],
    ['Families', formatNumber(s.families)],
    ['Sources', formatNumber(s.sources)],
    ['Years', s.years ? `${s.years[0]}–${s.years[1]}` : 'No dates'],
    ['Made with', program || 'Not stated'],
    ['GEDCOM version', s.gedcomVersion || 'Not stated'],
    ['Encoding', enc === 'UTF-8' ? enc : `${enc} (we can convert this)`],
  ];
}

export const NOTE_55 =
  "Your file is GEDCOM 5.5, which doesn't officially list UTF-8. Almost every program reads it anyway.";

export const REPAIR_FAILED = "We couldn't make a repaired copy of this file.";
export const KEEP_ORIGINAL = 'Keep your original file. This is a new copy.';
export const OFFER_NOTE = 'This may take a minute or so.';

const MB = 1024 * 1024;

/** The note under the status line while a big file is checked; '' under 10 MB. */
export function sizeNote(bytes: number): string {
  if (bytes < 10 * MB) return '';
  return 'This is a large file, so checking may take a minute or so. You can use other tabs meanwhile.';
}

/** Findings a suggested fix (a data kind of repair) can fix; see checklist.ts. */
const DATA_CODE = /^(ORPHANED_(FAMC|FAMS|HUSB|WIFE|CHIL|SOUR|NOTE|XREF_OTHER|ASSOCIATE_XREF)|EMPTY_FAMILY|HEADER_MISSING_SUBM)$/;

/**
 * Whether to make a repaired copy straight away ('auto'), only on request
 * ('offer', above 5 MB, where it is slow and memory-hungry), or not at all
 * ('skip': nothing the repair could fix, format or suggested).
 */
export function repairPlan(r: Result, size: number): 'skip' | 'auto' | 'offer' {
  const kind = viewKind(r);
  if (kind === 'failed' || kind === 'not-gedcom') return 'skip';
  const format = r.findings.some(f => f.group === 'format' || f.group === '' || DATA_CODE.test(f.code));
  const plain = r.encoding.detected === 'UTF-8' || r.encoding.detected === 'ASCII';
  if (!format && plain && !r.bom && !r.bareCR) return 'skip';
  return size > 5 * MB ? 'offer' : 'auto';
}

export interface LeftItem {
  title: string;
  count: number;
  /** The title is a group heading, standing in for titles that need details. */
  heading?: true;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The repair's changes grouped by what was done, in order of first line:
 * "Removed a blank line: 2 lines (7, 9)", up to five example lines, or just
 * the text for a change to the whole file.
 */
export function groupChanges(changes: RepairOut['changes']): string[] {
  const groups = new Map<string, { file: boolean; n: number; lines: number[] }>();
  for (const c of changes) {
    const key = (c.line > 0 ? 'L' : 'F') + c.what;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { file: c.line <= 0, n: 0, lines: [] }));
    g.n++;
    if (g.lines.length < 5) g.lines.push(c.line);
  }
  const out: string[] = [];
  for (const [key, g] of groups) {
    const what = capital(key.slice(1));
    if (g.file) { out.push(what); continue; }
    const more = g.n > g.lines.length ? ', …' : '';
    out.push(`${what}: ${formatNumber(g.n)} ${g.n === 1 ? 'line' : 'lines'} (${g.lines.map(formatNumber).join(', ')}${more})`);
  }
  return out;
}

/**
 * The problems left after the repair, one line per kind, with no names or
 * details from the file: the title with its roles in generic words, or the
 * group heading when a detail is part of the sentence. Lines that read the
 * same are added up.
 */
export function leftItems(codes: string[], r: Result): LeftItem[] {
  const order = new Map(codes.map((c, i) => [c, i])); // the library sorts the codes
  const byText = new Map<string, { item: LeftItem; at: number }>();
  for (const f of r.findings) {
    const at = order.get(f.code);
    if (at === undefined) continue;
    const generic = genericTitle(f.title);
    const item: LeftItem = generic === null
      ? { title: GROUPS.find(g => g.id === (f.group || 'format'))!.heading, count: 0, heading: true }
      : { title: generic, count: 0 };
    const key = (item.heading ? 'H' : 'T') + item.title;
    let e = byText.get(key);
    if (!e) byText.set(key, (e = { item, at }));
    e.item.count++;
    e.at = Math.min(e.at, at);
  }
  return [...byText.values()].sort((x, y) => x.at - y.at).map(e => e.item);
}

// ---------------------------------------------------------------- DOM

export type Kids = (Node | string | null | undefined | false)[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...kids: Kids
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

/** Catalog text split on backticks, which mark GEDCOM examples. */
export function codeParts(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  text.split('`').forEach((part, i) => {
    if (part) out.push({ text: part, code: i % 2 === 1 });
  });
  return out;
}

/** Text with `code` spans, as the catalog writes GEDCOM examples. */
export function withCode(text: string): Node {
  const frag = document.createDocumentFragment();
  for (const p of codeParts(text)) frag.append(p.code ? el('code', { translate: 'no' }, p.text) : p.text);
  return frag;
}

/**
 * A catalog text filled for one finding: names from the file go in
 * translate="no" spans, so a browser's translation doesn't send them off or
 * change them; the rest gets its `code` spans.
 */
function filled(template: string, f: Finding, names: Record<string, string>): Node {
  const frag = document.createDocumentFragment();
  for (const p of fillParts(pageText(template), f, names)) {
    frag.append(p.name ? el('span', { translate: 'no' }, p.text) : withCode(p.text));
  }
  return frag;
}

function summaryCard(r: Result, fileName: string): HTMLElement {
  // The strip: the file name and the counts on the first row; years and
  // program, then version and encoding, as two groups that wrap on their own.
  const rows = summaryRows(r, fileName);
  const pair = ([k, v]: [string, string], cls: string) =>
    el('div', { class: cls }, el('dt', {}, k), el('dd', k === 'File' ? { translate: 'no' } : {}, v));
  const top = el('dl', { class: 'top' }, pair(rows[0], 'name'));
  for (const row of rows.slice(1, 4)) top.append(pair(row, 'stat'));
  const inner = el('div', { class: 'facts-in' });
  for (const group of [rows.slice(4, 6), rows.slice(6, 8)]) {
    const dl = el('dl', {});
    for (const row of group) dl.append(pair(row, 'fact'));
    inner.append(dl);
  }
  const facts = el('div', { class: 'facts' }, inner);
  return el('section', { class: 'card file', 'aria-labelledby': 'about-file' },
    el('h2', { id: 'about-file' }, 'About this file'), top, facts);
}

/** The line viewer's attributes: a focusable (it scrolls sideways), named region. */
export function lineViewerAttrs(first: number, last: number): Record<string, string> {
  return {
    class: 'lines',
    role: 'region',
    tabindex: '0',
    translate: 'no',
    'aria-label': `Lines ${formatNumber(first)} to ${formatNumber(last)} of your file`,
  };
}

function lineViewer(r: Result, line: number): HTMLElement | null {
  const rows = lineWindow(r.text, line);
  if (rows.length === 0) return null;
  const first = rows[0].n;
  const last = rows[rows.length - 1].n;
  const pre = el('pre', lineViewerAttrs(first, last));
  const width = formatNumber(last).length;
  for (const row of rows) {
    const num = el('span', { class: 'ln', 'aria-hidden': 'true' }, formatNumber(row.n).padStart(width, ' '));
    const body = row.mark ? el('mark', {}, row.text || ' ') : document.createTextNode(row.text);
    pre.append(el('span', { class: row.mark ? 'row hit' : 'row' }, num, body));
  }
  return pre;
}

function findingItem(f: Finding, r: Result): HTMLElement {
  const details = el('details', { class: `finding ${f.severity}` });
  const summary = el('summary', {},
    el('span', { class: 'meta' },
      el('span', { class: `sev ${f.severity}` }, severityWord(f.severity)),
      el('span', { class: 'at' }, lineLabel(f.line))),
    el('span', { class: 'title' }, filled(f.title, f, r.names)),
    f.meaning ? el('span', { class: 'meaning' }, filled(f.meaning, f, r.names)) : null);
  details.append(summary);
  // The lines and the fix are built when the finding is first opened, so
  // thousands of findings stay cheap. It opens and closes smoothly.
  smoothDetails(details as HTMLDetailsElement, () => {
    const body = el('div', { class: 'body' });
    if (f.line > 0) {
      const viewer = lineViewer(r, f.line);
      if (viewer) body.append(viewer);
    }
    if (f.howToFix) {
      body.append(el('h3', {}, 'How to fix it'), el('p', {}, filled(f.howToFix, f, r.names)));
    }
    return body;
  });
  return el('li', {}, details);
}

function groupSection(g: ViewGroup, r: Result): HTMLElement {
  const hid = `group-${g.id}`;
  const list = el('ol', { class: 'findings' });
  const section = el('section', { class: 'group', 'aria-labelledby': hid },
    el('h2', { id: hid }, g.heading, ' ', el('span', { class: 'n' }, `(${formatNumber(g.findings.length)})`)),
    list);

  let shown = 0;
  const more = el('button', { type: 'button', class: 'more' }, 'Show more');
  const note = el('p', { class: 'shown' });
  const footer = el('div', { class: 'more-row' }, note, more);

  const addPage = (): HTMLElement | null => {
    const { items, remaining } = visibleSlice(g.findings, shown);
    const frag = document.createDocumentFragment();
    let firstNew: HTMLElement | null = null;
    for (const f of items) {
      const li = findingItem(f, r);
      firstNew ??= li;
      frag.append(li);
    }
    list.append(frag);
    shown += items.length;
    note.textContent = `Showing ${formatNumber(shown)} of ${formatNumber(g.findings.length)}`;
    if (remaining === 0) footer.remove();
    return firstNew;
  };

  addPage();
  if (shown < g.findings.length) {
    more.addEventListener('click', () => {
      const first = addPage();
      first?.querySelector('summary')?.focus();
    });
    section.append(footer);
  }
  return section;
}

function filterControls(counts: Record<Severity, number>, show: SeverityFilter, onChange: () => void): HTMLElement {
  const fs = el('fieldset', { class: 'filter' }, el('legend', {}, 'Show'));
  for (const s of SEVERITIES) {
    const input = el('input', { type: 'checkbox', name: 'severity', value: s });
    input.checked = show[s];
    input.addEventListener('change', () => {
      show[s] = input.checked;
      onChange();
    });
    fs.append(el('label', { class: `chip ${s}` }, input, el('span', { class: 'box', 'aria-hidden': 'true' }),
      el('span', { class: `sev ${s}` }, countLabel(s, counts[s]))));
  }
  return fs;
}

export interface ReportSlots {
  /** Filled by the repair card (repaircard.ts). */
  repair: HTMLElement;
  /** Filled by fillDownloads(). */
  downloads: HTMLElement;
}

/** The repair slot after a repair that failed: one line. */
export function fillRepairFailed(slot: HTMLElement): void {
  slot.removeAttribute('aria-labelledby');
  slot.replaceChildren(el('p', { class: 'repair-failed' }, REPAIR_FAILED));
  slot.hidden = false;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The 14×14 download arrow on the report buttons; decoration only. */
export function downloadIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 14 14', width: '14', height: '14', 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(k, v);
  }
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M7 1.5v7.5M3.75 5.75 7 9l3.25-3.25M2 12.25h10');
  svg.append(path);
  return svg;
}

/** Fills the downloads slot with the two report buttons. */
export function fillDownloads(slot: HTMLElement, onText: () => void, onCsv: () => void): void {
  const mk = (label: string, fn: () => void) => {
    const b = el('button', { type: 'button', class: 'more download' }, downloadIcon(), label);
    b.addEventListener('click', fn);
    return b;
  };
  slot.replaceChildren(
    el('p', { class: 'dl-label' }, 'Save this report:'),
    mk('Download report (text)', onText),
    mk('Download report (spreadsheet)', onCsv));
  slot.hidden = false;
}

/**
 * Builds the whole report for one file into `root`, replacing whatever was
 * there. The status line carries doneText(); a file that isn't GEDCOM gets
 * no report at all. Returns the empty (hidden) slots for the repair and
 * download parts.
 */
export function renderReport(root: HTMLElement, r: Result, fileName: string): ReportSlots {
  const repair = el('div', { class: 'slot', id: 'repair', hidden: '' });
  const downloads = el('div', { class: 'slot', id: 'downloads', hidden: '' });
  const kind = viewKind(r);

  if (kind === 'not-gedcom' || kind === 'failed') {
    root.replaceChildren();
    return { repair, downloads };
  }

  const card = summaryCard(r, fileName);
  if (kind === 'clean') {
    root.replaceChildren(card, repair, downloads);
    return { repair, downloads };
  }

  const counts = countBySeverity(r.findings);
  const show: SeverityFilter = { error: true, warning: true, hint: true };
  const groups = el('div', { class: 'groups' });
  const drawGroups = () => {
    const vg = buildGroups(r.findings, show);
    groups.replaceChildren(...(vg.length
      ? vg.map(g => groupSection(g, r))
      : [el('p', { class: 'empty' }, 'Nothing to show. Tick Errors, Warnings or Hints above.')]));
  };
  drawGroups();
  // The toolbar (filters and the report downloads), then the repair card, then the findings.
  const toolbar = el('div', { class: 'toolbar' }, filterControls(counts, show, drawGroups), downloads);
  root.replaceChildren(card, toolbar, repair, groups);
  return { repair, downloads };
}
