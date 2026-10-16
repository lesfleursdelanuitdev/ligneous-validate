// The report. The first half is pure functions that turn a Result into what
// the page shows (unit-tested); the second half builds the DOM from them
// (covered by the e2e tests).

import { fill, fillLine } from './fill';
import type { Finding, Group, Result, Severity } from './types';

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

export type ViewKind = 'not-gedcom' | 'clean' | 'report';

export function viewKind(r: Result): ViewKind {
  if (r.error || !r.isGedcom) return 'not-gedcom';
  return r.findings.length === 0 ? 'clean' : 'report';
}

export function lineLabel(line: number): string {
  return line > 0 ? fillLine(line) : 'Whole file';
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

/** What the status line says when a file has been checked. */
export function doneText(r: Result): string {
  const kind = viewKind(r);
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

// ---------------------------------------------------------------- DOM

type Kids = (Node | string | null | undefined | false)[];

function el<K extends keyof HTMLElementTagNameMap>(
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

/** Text with `code` spans, as the catalog writes GEDCOM examples. */
function withCode(text: string): Node {
  const frag = document.createDocumentFragment();
  text.split('`').forEach((part, i) => {
    if (part) frag.append(i % 2 ? el('code', { translate: 'no' }, part) : part);
  });
  return frag;
}

function summaryCard(r: Result, fileName: string): HTMLElement {
  const dl = el('dl');
  for (const [k, v] of summaryRows(r, fileName)) {
    dl.append(el('div', { class: 'row' }, el('dt', {}, k), el('dd', k === 'File' ? { translate: 'no' } : {}, v)));
  }
  return el('section', { class: 'card', 'aria-labelledby': 'about-file' },
    el('h2', { id: 'about-file' }, 'About this file'), dl);
}

function lineViewer(r: Result, line: number): HTMLElement | null {
  const rows = lineWindow(r.text, line);
  if (rows.length === 0) return null;
  const first = rows[0].n;
  const last = rows[rows.length - 1].n;
  const pre = el('pre', {
    class: 'lines',
    tabindex: '0',
    translate: 'no',
    'aria-label': `Lines ${formatNumber(first)} to ${formatNumber(last)} of your file`,
  });
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
    el('span', { class: 'title' }, fill(f.title, f, r.names)),
    f.meaning ? el('span', { class: 'meaning' }, fill(f.meaning, f, r.names)) : null);
  details.append(summary);
  // The lines and the fix are built when the finding is first opened, so
  // thousands of findings stay cheap.
  details.addEventListener('toggle', () => {
    if (!details.open || details.childElementCount > 1) return;
    const body = el('div', { class: 'body' });
    if (f.line > 0) {
      const viewer = lineViewer(r, f.line);
      if (viewer) body.append(viewer);
    }
    if (f.howToFix) {
      body.append(el('h3', {}, 'How to fix it'), el('p', {}, withCode(fill(f.howToFix, f, r.names))));
    }
    details.append(body);
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
    fs.append(el('label', { class: `chip ${s}` }, input, el('span', { class: `sev ${s}` }, countLabel(s, counts[s]))));
  }
  return fs;
}

export interface ReportSlots {
  /** Where Task 4 puts "We can fix N format problems automatically". */
  repair: HTMLElement;
  /** Where Task 4 puts the report downloads. */
  downloads: HTMLElement;
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

  if (kind === 'not-gedcom') {
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
  root.replaceChildren(card, filterControls(counts, show, drawGroups), repair, downloads, groups);
  return { repair, downloads };
}
