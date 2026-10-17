import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { lineBreakOf, mapLine, navOrder, problemCount, stepTo, textChange, toDiagnosticSeverity, toEditorLines, windowed, editorLineMap } from './markers';
import type { Finding } from '../types';

const f = (line: number, severity: Finding['severity'] = 'warning', code = 'X'): Finding => ({
  code, severity, group: 'format', title: code, meaning: '', howToFix: '', line, details: {}, xrefs: [], roles: {},
});

describe('findings to markers', () => {
  it('maps severities to lint severities', () => {
    expect(toDiagnosticSeverity('error')).toBe('error');
    expect(toDiagnosticSeverity('warning')).toBe('warning');
    expect(toDiagnosticSeverity('hint')).toBe('hint');
  });

  it('orders findings with a line by line, then severity, leaving out whole-file ones', () => {
    const list = [f(9, 'hint'), f(0, 'error'), f(3, 'warning'), f(9, 'error'), f(1)];
    expect(navOrder(list)).toEqual([4, 2, 3, 0]);
    expect(problemCount(list)).toBe(4);
  });

  it('maps a checked line to the current text through edits', () => {
    const checked = Text.of(['0 HEAD', '1 CHAR UTF-8', '0 @I1@ INDI', '1 NAME A', '0 TRLR']);
    // No edits: the line itself.
    const none = ChangeSet.empty(checked.length);
    expect(mapLine(checked, none, 3)).toEqual({ from: checked.line(3).from, to: checked.line(3).to });
    // Two lines inserted above line 3: it moves down by their length.
    const ins = ChangeSet.of({ from: checked.line(2).from, insert: 'X\nY\n' }, checked.length);
    expect(mapLine(checked, ins, 3)).toEqual({ from: checked.line(3).from + 4, to: checked.line(3).to + 4 });
    // Typing at the start of the line keeps the marker on that line.
    const typed = ChangeSet.of({ from: checked.line(4).from, insert: 'zz' }, checked.length);
    expect(mapLine(checked, typed, 4)).toEqual({ from: checked.line(4).from + 2, to: checked.line(4).to + 2 });
    // The whole line deleted: no marker.
    const del = ChangeSet.of({ from: checked.line(3).from - 1, to: checked.line(3).to }, checked.length);
    expect(mapLine(checked, del, 3)).toBeNull();
    // The whole line deleted from its start (Home, Shift+Down, Delete): no marker either.
    const fromStart = ChangeSet.of({ from: checked.line(3).from, to: checked.line(4).from }, checked.length);
    expect(mapLine(checked, fromStart, 3)).toBeNull();
    expect(mapLine(checked, fromStart, 4)).toEqual({ from: checked.line(3).from, to: checked.line(3).from + 8 });
    // Only its text deleted: still a line (now empty) with its marker.
    const emptied = ChangeSet.of({ from: checked.line(3).from, to: checked.line(3).to }, checked.length);
    expect(mapLine(checked, emptied, 3)).toEqual({ from: checked.line(3).from, to: checked.line(3).from });
    // A line that doesn't exist (the text got shorter before the check): no marker.
    expect(mapLine(checked, none, 99)).toBeNull();
    expect(mapLine(checked, none, 0)).toBeNull();
  });

  it('keeps every finding when there are no more than the cap', () => {
    const list = [f(5), f(1), f(3)];
    expect(windowed(list, navOrder(list), 1, 1, 10)).toEqual([1, 2, 0]);
  });

  it('keeps the findings nearest the visible lines when there are more than the cap', () => {
    const list = Array.from({ length: 100 }, (_, i) => f(i + 1));
    const order = navOrder(list);
    // Lines 50-52 visible, cap 6: those three, then the nearest above and below.
    const got = windowed(list, order, 50, 52, 6).map(i => list[i].line).sort((a, b) => a - b);
    // The visible three, then 49 and 53, then one of 48 and 54 (equally near).
    expect(got).toHaveLength(6);
    for (const l of [49, 50, 51, 52, 53]) expect(got).toContain(l);
    expect(got.includes(48) !== got.includes(54)).toBe(true);
  });

  it('caps a single crowded line too', () => {
    const list = Array.from({ length: 20 }, () => f(7));
    expect(windowed(list, navOrder(list), 7, 7, 5)).toHaveLength(5);
  });
});

describe('next and previous problem', () => {
  // Line starts of the findings, in order; null is a deleted line.
  const pos = [10, 20, 20, null, 40];

  it('steps from the current finding when the cursor is still on it', () => {
    expect(stepTo(pos, 20, 1, 1)).toBe(2);
    expect(stepTo(pos, 20, 2, 1)).toBe(4); // skips the deleted one
    expect(stepTo(pos, 20, 2, -1)).toBe(1);
  });

  it('steps from the cursor when it has moved', () => {
    expect(stepTo(pos, 15, 0, 1)).toBe(1);
    expect(stepTo(pos, 30, -1, -1)).toBe(2);
    expect(stepTo(pos, 0, -1, 1)).toBe(0);
  });

  it('wraps around at the ends', () => {
    expect(stepTo(pos, 40, 4, 1)).toBe(0);
    expect(stepTo(pos, 10, 0, -1)).toBe(4);
    expect(stepTo(pos, 50, -1, 1)).toBe(0);
  });

  it('gives -1 when nothing is left', () => {
    expect(stepTo([], 0, -1, 1)).toBe(-1);
    expect(stepTo([null, null], 0, -1, 1)).toBe(-1);
  });
});

describe('line breaks', () => {
  it('saves with the line break the file uses', () => {
    expect(lineBreakOf('0 HEAD\r\n1 CHAR UTF-8\r\n')).toBe('\r\n');
    expect(lineBreakOf('0 HEAD\r1 CHAR UTF-8\r')).toBe('\r');
    expect(lineBreakOf('0 HEAD\n')).toBe('\n');
    expect(lineBreakOf('0 HEAD')).toBe('\n');
  });
});

describe('the change from the checked text to the editor text', () => {
  const apply = (a: string, c: { from: number; to: number; insert: string }) => a.slice(0, c.from) + c.insert + a.slice(c.to);
  const lineStart = (t: string, i: number) => i === 0 || t[i - 1] === '\n';
  const lineEnd = (t: string, i: number) => i === t.length || t[i] === '\n';
  /** Where checked line `n` is in the sent text (line number), or null. */
  const lineIn = (checked: string, sent: string, n: number) => {
    const t = Text.of(checked.split('\n'));
    const c = textChange(checked, sent);
    const changes = c ? ChangeSet.of(c, t.length) : ChangeSet.empty(t.length);
    const at = mapLine(t, changes, n);
    return at ? changes.apply(t).lineAt(at.from).number : null;
  };

  it('is empty when they are the same', () => {
    expect(textChange('0 HEAD\n0 TRLR\n', '0 HEAD\n0 TRLR\n')).toBeNull();
  });

  it('replaces the whole CHAR line, which still maps to itself', () => {
    const checked = '0 HEAD\n1 CHAR UTF-8\n1 SUBM @U1@\n';
    const sent = '0 HEAD\n1 CHAR ANSEL\n1 SUBM @U1@\n';
    const c = textChange(checked, sent)!;
    expect(apply(checked, c)).toBe(sent);
    expect(lineStart(checked, c.from) && lineEnd(checked, c.to)).toBe(true);
    expect(lineIn(checked, sent, 2)).toBe(2);
    expect(lineIn(checked, sent, 3)).toBe(3);
  });

  it('removes a whole inserted CHAR line, even when the next line starts the same ("1 …")', () => {
    // The characters "CHAR UTF-8\n1 " differ; the change must still cover whole lines.
    const checked = '0 HEAD\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 NOTE long\n1 SUBM @U1@\n';
    const sent = '0 HEAD\n2 FORM LINEAGE-LINKED\n1 NOTE long\n1 SUBM @U1@\n';
    const c = textChange(checked, sent)!;
    expect(apply(checked, c)).toBe(sent);
    expect(lineIn(checked, sent, 4)).toBe(3); // 1 NOTE long
    expect(lineIn(checked, sent, 5)).toBe(4);
    expect(lineIn(checked, sent, 2)).toBe(2);
    expect(lineIn(checked, sent, 3)).toBeNull(); // the inserted CHAR line itself
  });

  it('handles an inserted first line and an extra line in the editor text', () => {
    expect(apply('1 CHAR UTF-8\n0 HEAD\n', textChange('1 CHAR UTF-8\n0 HEAD\n', '0 HEAD\n')!)).toBe('0 HEAD\n');
    expect(apply('0 HEAD\n0 TRLR', textChange('0 HEAD\n0 TRLR', '0 HEAD\n1 X\n0 TRLR')!)).toBe('0 HEAD\n1 X\n0 TRLR');
    expect(lineIn('0 HEAD\n0 TRLR', '0 HEAD\n1 X\n0 TRLR', 2)).toBe(3);
  });
});

describe('a Check again report in the editor\'s line numbers', () => {
  const g = (line: number, code = 'C'): Finding => ({ ...f(line), code });
  it('moves findings after an inserted CHAR line up one, and a finding on that line to the whole file', () => {
    const checked = '0 HEAD\n1 GEDC\n1 CHAR UTF-8\n1 NOTE long\n  1 SEX F\n';
    const sent = '0 HEAD\n1 GEDC\n1 NOTE long\n  1 SEX F\n';
    const out = toEditorLines([g(4, 'LONG'), g(5, 'SPACE'), g(3, 'ONCHAR'), g(0, 'FILE'), g(1, 'HEAD')], checked, sent);
    expect(out.map(x => [x.code, x.line])).toEqual([['LONG', 3], ['SPACE', 4], ['ONCHAR', 0], ['FILE', 0], ['HEAD', 1]]);
  });
  it('leaves lines alone when the texts are the same', () => {
    expect(toEditorLines([g(2)], 'a\nb\n', 'a\nb\n')[0].line).toBe(2);
  });
  it('maps any checked line the same way, for the checklist\'s plan and repair', () => {
    const map = editorLineMap('0 HEAD\n1 GEDC\n1 CHAR UTF-8\n1 NOTE long\n0 TRLR\n', '0 HEAD\n1 GEDC\n1 NOTE long\n0 TRLR\n')!;
    expect([1, 2, 3, 4, 5, 0].map(map)).toEqual([1, 2, 0, 3, 4, 0]);
    expect(editorLineMap('a\nb\n', 'a\nb\n')).toBeNull();
  });
});
