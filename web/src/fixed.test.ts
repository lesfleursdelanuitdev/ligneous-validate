import { describe, expect, it } from 'vitest';
import { fixedFindings, fixedPhrase } from './fixed';
import type { Change, Finding, RepairOut, Result } from './types';

let n = 0;
const finding = (code: string, line: number): Finding =>
  ({ code, severity: 'warning', group: 'format', title: 'T' + ++n, meaning: '', howToFix: '', line, details: {}, xrefs: [], roles: {} });
const result = (findings: Finding[]): Result => ({
  encoding: { detected: 'UTF-8', declared: 'UTF-8', reason: '' },
  summary: { people: 1, families: 0, sources: 0, notes: 0, media: 0, years: null, program: '', programVersion: '', gedcomVersion: '5.5.1', lines: 9 },
  findings, names: {}, text: '', isGedcom: true,
});
const zero = { errors: 0, warnings: 0, hints: 0 };
const out = (over: Partial<RepairOut>): RepairOut => ({ changes: [], left: [], before: zero, after: zero, ...over });
const change = (fix: Change['fix'], line: number): Change => ({ fix, line, what: 'x' });

describe('fixedFindings', () => {
  it('marks every finding of a code the repaired copy no longer has, and none of a code it still has as often', () => {
    const blank = [finding('EMPTY_LINE', 3), finding('EMPTY_LINE', 7)];
    const date = finding('DATE_X', 5);
    const r = result([...blank, date]);
    const got = fixedFindings(r, out({ remaining: { DATE_X: 1 }, changes: [change('blank-lines', 3), change('blank-lines', 7)] }));
    expect([...got]).toEqual(blank);
  });
  it('marks a partial fix only where the changes for its kind are, when they account for exactly the ones gone', () => {
    const long = [finding('LINE_TOO_LONG', 4), finding('LINE_TOO_LONG', 9), finding('LINE_TOO_LONG', 12)];
    const r = result(long);
    // One is left as it is (it would change how the file is read): lines 4 and 12 were split.
    const got = fixedFindings(r, out({ remaining: { LINE_TOO_LONG: 1 }, changes: [change('long-lines', 4), change('long-lines', 12), change('blank-lines', 9)] }));
    expect([...got]).toEqual([long[0], long[2]]);
  });
  it("marks nothing when it can't tell which of them were fixed", () => {
    const long = [finding('LINE_TOO_LONG', 4), finding('LINE_TOO_LONG', 9)];
    // One fewer, but changes on both lines (or on none): which one is left is unknown.
    expect(fixedFindings(result(long), out({ remaining: { LINE_TOO_LONG: 1 }, changes: [change('long-lines', 4), change('long-lines', 9)] })).size).toBe(0);
    expect(fixedFindings(result(long), out({ remaining: { LINE_TOO_LONG: 1 }, changes: [] })).size).toBe(0);
  });
  it('marks nothing for a code with as many or more in the copy, or with no kind of fix', () => {
    const r = result([finding('ORPHANED_FAMC', 4), finding('NOT_A_FIX', 6)]);
    expect(fixedFindings(r, out({ remaining: { ORPHANED_FAMC: 2, NOT_A_FIX: 0 }, changes: [change('broken-links', 4)] })))
      .toEqual(new Set([r.findings[1]]));
  });
  it('counts whole-file findings (line 0) by code only', () => {
    const enc = finding('ENCODING_NOT_UTF8', 0);
    expect(fixedFindings(result([enc]), out({ remaining: {}, changes: [change('encoding', 0)] }))).toEqual(new Set([enc]));
  });
  it('falls back to the codes left when an older checker sends no counts', () => {
    const a = finding('EMPTY_LINE', 2), b = finding('DATE_X', 3);
    expect(fixedFindings(result([a, b]), out({ left: ['DATE_X'] }))).toEqual(new Set([a]));
  });
  it('marks nothing for a failed repair', () => {
    expect(fixedFindings(result([finding('EMPTY_LINE', 2)]), out({ remaining: {}, error: 'boom' })).size).toBe(0);
  });
  it('says which copy', () => {
    expect(fixedPhrase(false)).toBe('fixed in the repaired copy');
    expect(fixedPhrase(true)).toBe('fixed in the last repaired copy');
  });
});
