// Pointers (@I12@) in the editor: which one is under the pointer, and the
// line of the record it points to. Pure, unit-tested.

import { tokenizeLine } from './gedcom';

/** The pointer value at column `col` of `line` (its ends included), or null. */
export function pointerAt(line: string, col: number): string | null {
  for (const t of tokenizeLine(line)) {
    if (t.kind === 'pointer' && col >= t.from && col <= t.to) return line.slice(t.from, t.to);
  }
  return null;
}

/** The 1-based line of the level-0 record `xref` ("0 @I12@ INDI"), or 0 when there is none. */
export function recordLine(lines: Iterable<string>, xref: string): number {
  let n = 0;
  const want = xref + ' ';
  for (const line of lines) {
    n++;
    let i = 0;
    while (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9) i++;
    if (line.charCodeAt(i) !== 48 /* 0 */) continue;
    i++;
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) continue;
    while (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9) i++;
    if (line.startsWith(want, i) || (line.startsWith(xref, i) && i + xref.length === line.length) ||
      line.startsWith(xref + '\t', i)) return n;
  }
  return 0;
}
