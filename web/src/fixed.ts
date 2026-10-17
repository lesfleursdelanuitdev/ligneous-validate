// Which findings a repaired copy no longer has. Decided from facts, never
// guessed: the repair checks its copy again (RepairOut.remaining, code by
// code, the same parse and validation as the page's check), and its changes
// say which lines of the original each kind of fix touched.

import { kindOfCode } from './codes';
import type { Finding, RepairOut, Result } from './types';

/**
 * The findings of `r` that the repaired copy no longer has. For each code:
 * - none left in the copy: every finding with that code is fixed;
 * - as many left as before (or more): none is;
 * - fewer: exactly that many are fixed, and they are marked only when the
 *   repair's changes for that code's kind of fix are on exactly that many of
 *   the findings' lines. Otherwise we can't tell which, and none is marked.
 * An answer without `remaining` (an older checker) falls back to `left`, the
 * codes still in the copy: a code that is gone is fixed, any other isn't.
 */
export function fixedFindings(r: Result, out: RepairOut): Set<Finding> {
  const fixed = new Set<Finding>();
  if (out.error) return fixed;
  const byCode = new Map<string, Finding[]>();
  for (const f of r.findings) {
    let list = byCode.get(f.code);
    if (!list) byCode.set(f.code, (list = []));
    list.push(f);
  }
  const left = new Set(out.left);
  for (const [code, list] of byCode) {
    if (!out.remaining) {
      if (!left.has(code)) for (const f of list) fixed.add(f);
      continue;
    }
    const after = out.remaining[code] ?? 0;
    if (after === 0) {
      for (const f of list) fixed.add(f);
      continue;
    }
    const gone = list.length - after;
    if (gone <= 0) continue;
    const kind = kindOfCode(code);
    if (!kind) continue;
    const touched = new Set(out.changes.filter(ch => ch.fix === kind && ch.line > 0).map(ch => ch.line));
    const hit = list.filter(f => f.line > 0 && touched.has(f.line));
    if (hit.length === gone) for (const f of hit) fixed.add(f);
  }
  return fixed;
}

/** The repaired copy the marks belong to: the one on screen, or the last one when the choices have changed since. */
export interface FixedMarks {
  fixed: Set<Finding>;
  /** The choices changed after the run: the marks are the last repaired copy's. */
  stale: boolean;
}

export const FIXED_BADGE = 'Fixed in your repaired copy';
export const FIXED_BADGE_STALE = 'Fixed in the last repaired copy';

/** "fixed in the repaired copy" or "fixed in the last repaired copy". */
export const fixedPhrase = (stale: boolean): string => (stale ? 'fixed in the last repaired copy' : 'fixed in the repaired copy');
