import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { lineBreakOf, mapLine, navOrder, problemCount, stepTo, toDiagnosticSeverity, windowed } from './markers';
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
