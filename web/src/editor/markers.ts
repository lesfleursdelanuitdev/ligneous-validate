// From the report's findings to the editor's lint markers, and Next / Previous
// problem. Pure (unit-tested): the editor keeps the text as it was checked
// and the edits made since, and maps each finding's line through them.

import { MapMode } from '@codemirror/state';
import type { ChangeDesc, Text } from '@codemirror/state';
import type { Finding, Severity } from '../types';

/** The most markers shown at once: with more findings, those nearest the visible lines. */
export const MARKER_CAP = 5000;

export const toDiagnosticSeverity = (s: Severity): 'error' | 'warning' | 'hint' => s;

const rank: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };

/** Indices of the findings that have a line, by line, then error, warning, hint. */
export function navOrder(findings: Finding[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < findings.length; i++) if (findings[i].line > 0) idx.push(i);
  return idx.sort((a, b) => findings[a].line - findings[b].line || rank[findings[a].severity] - rank[findings[b].severity] || a - b);
}

/** The findings that can be stepped through (the ones with a line). */
export const problemCount = (findings: Finding[]): number => findings.reduce((n, f) => n + (f.line > 0 ? 1 : 0), 0);

/**
 * Where line `line` of the checked text is now, after `changes`; null when
 * the line is gone (deleted, or past the end).
 */
export function mapLine(checked: Text, changes: ChangeDesc, line: number): { from: number; to: number } | null {
  if (line < 1 || line > checked.lines) return null;
  const l = checked.line(line);
  const from = changes.mapPos(l.from, 1, MapMode.TrackDel);
  if (from === null) return null;
  const to = Math.max(from, changes.mapPos(l.to, -1));
  return { from, to };
}

/**
 * The findings to mark (indices into `findings`): every one when there are
 * no more than `cap`; otherwise the `cap` nearest to lines first..last of
 * the checked text. `order` is navOrder(findings).
 */
export function windowed(findings: Finding[], order: number[], first: number, last: number, cap: number): number[] {
  if (order.length <= cap) return order.slice();
  // The first finding on or after `first`, then grow outwards from the window.
  let lo = 0, hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (findings[order[mid]].line < first) lo = mid + 1; else hi = mid;
  }
  const out: number[] = [];
  let r = lo;
  while (r < order.length && findings[order[r]].line <= last && out.length < cap) out.push(order[r++]);
  let l = lo - 1;
  while (out.length < cap && (l >= 0 || r < order.length)) {
    const dl = l >= 0 ? first - findings[order[l]].line : Infinity;
    const dr = r < order.length ? findings[order[r]].line - last : Infinity;
    if (dl <= dr) out.push(order[l--]); else out.push(order[r++]);
  }
  return out;
}

/**
 * Next (dir 1) or previous (-1) problem. `pos` holds each finding's line
 * start now, in navigation order (null: its line is gone). When the cursor's
 * line start is still that of `current`, it steps from there (so findings on
 * one line are visited one by one); otherwise from the cursor. It wraps
 * around; -1 when there is nothing to go to.
 */
export function stepTo(pos: (number | null)[], cursorLineStart: number, current: number, dir: 1 | -1): number {
  const n = pos.length;
  if (!pos.some(p => p !== null)) return -1;
  if (current >= 0 && current < n && pos[current] === cursorLineStart) {
    for (let k = 1; k <= n; k++) {
      const j = ((current + dir * k) % n + n) % n;
      if (pos[j] !== null) return j;
    }
    return -1;
  }
  if (dir === 1) {
    for (let j = 0; j < n; j++) if (pos[j] !== null && pos[j]! > cursorLineStart) return j;
    for (let j = 0; j < n; j++) if (pos[j] !== null) return j;
  } else {
    for (let j = n - 1; j >= 0; j--) if (pos[j] !== null && pos[j]! < cursorLineStart) return j;
    for (let j = n - 1; j >= 0; j--) if (pos[j] !== null) return j;
  }
  return -1;
}

/** The line break the file uses (its first one), so a saved file keeps it. */
export function lineBreakOf(text: string): string {
  const i = text.search(/\r\n|\r|\n/);
  if (i < 0) return '\n';
  return text.startsWith('\r\n', i) ? '\r\n' : text[i];
}
