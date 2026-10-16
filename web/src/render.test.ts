import { describe, expect, it } from 'vitest';
import {
  GROUPS, PAGE_SIZE, buildGroups, countBySeverity, doneText, lineLabel, lineWindow, noProblemsText,
  severityWord, summaryRows, viewKind, visibleSlice,
} from './render';
import type { Finding, Result, Severity } from './types';

let n = 0;
function f(group: Finding['group'], severity: Severity, line = ++n): Finding {
  return { code: 'C' + line, severity, group, title: 't', meaning: 'm', howToFix: 'h', line, details: {}, xrefs: [], roles: {} };
}

function result(over: Partial<Result> = {}): Result {
  return {
    encoding: { detected: 'UTF-8', declared: 'UTF-8', reason: 'header CHAR' },
    summary: {
      people: 2322, families: 800, sources: 12, notes: 0, media: 0, years: [1700, 1990],
      program: 'PAF', programVersion: '5.2', gedcomVersion: '5.5.1', lines: 40000,
    },
    findings: [], names: {}, text: '', isGedcom: true, ...over,
  };
}

const ALL = { error: true, warning: true, hint: true };

describe('group headings', () => {
  it('uses the fixed order and wording', () => {
    expect(GROUPS.map(g => g.heading)).toEqual([
      'File format and encoding', 'Header', 'Broken links', "Dates that don't add up", 'Names and sex',
    ]);
  });
});

describe('buildGroups', () => {
  it('orders groups format, header, links, dates, names and skips empty ones', () => {
    const groups = buildGroups([f('names', 'error'), f('dates', 'error'), f('format', 'hint'), f('links', 'warning')], ALL);
    expect(groups.map(g => g.id)).toEqual(['format', 'links', 'dates', 'names']);
    expect(groups[0].heading).toBe('File format and encoding');
  });

  it('puts findings with no group under format', () => {
    const groups = buildGroups([f('', 'error')], ALL);
    expect(groups.map(g => g.id)).toEqual(['format']);
  });

  it('puts errors first, then warnings, then hints, by line within each', () => {
    const items = [f('dates', 'hint', 1), f('dates', 'warning', 9), f('dates', 'error', 50), f('dates', 'warning', 3), f('dates', 'error', 2)];
    const [g] = buildGroups(items, ALL);
    expect(g.findings.map(x => [x.severity, x.line])).toEqual([
      ['error', 2], ['error', 50], ['warning', 3], ['warning', 9], ['hint', 1],
    ]);
  });

  it('leaves out severities that are switched off', () => {
    const groups = buildGroups([f('dates', 'hint'), f('dates', 'error'), f('header', 'hint')], { error: true, warning: true, hint: false });
    expect(groups.map(g => g.id)).toEqual(['dates']);
    expect(groups[0].findings.map(x => x.severity)).toEqual(['error']);
  });
});

describe('visibleSlice', () => {
  it('shows the first 50, then the rest 50 at a time', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(PAGE_SIZE).toBe(50);
    const first = visibleSlice(items, 0);
    expect(first.items).toEqual(items.slice(0, 50));
    expect(first.remaining).toBe(70);
    const second = visibleSlice(items, 50);
    expect(second.items).toEqual(items.slice(50, 100));
    expect(second.remaining).toBe(20);
    const third = visibleSlice(items, 100);
    expect(third.items).toEqual(items.slice(100));
    expect(third.remaining).toBe(0);
  });

  it('needs no Show more for 50 or fewer', () => {
    expect(visibleSlice(Array.from({ length: 50 }, (_, i) => i), 0).remaining).toBe(0);
  });
});

describe('countBySeverity', () => {
  it('counts each severity', () => {
    expect(countBySeverity([f('dates', 'error'), f('dates', 'hint'), f('names', 'hint')])).toEqual({ error: 1, warning: 0, hint: 2 });
  });
});

describe('noProblemsText', () => {
  it('says how many people were checked, with grouping', () => {
    expect(noProblemsText(2322)).toBe('No problems found in 2,322 people.');
  });
  it('says "person" for one', () => {
    expect(noProblemsText(1)).toBe('No problems found in 1 person.');
  });
});

describe('viewKind', () => {
  it('is not-gedcom when isGedcom is false, even with findings', () => {
    expect(viewKind(result({ isGedcom: false, findings: [f('format', 'error')] }))).toBe('not-gedcom');
  });
  it('is not-gedcom when the checker failed', () => {
    expect(viewKind(result({ error: 'boom' }))).toBe('not-gedcom');
  });
  it('is clean with no findings', () => {
    expect(viewKind(result())).toBe('clean');
  });
  it('is report with findings', () => {
    expect(viewKind(result({ findings: [f('dates', 'hint')] }))).toBe('report');
  });
});

describe('lineLabel', () => {
  it('says Whole file for line 0', () => {
    expect(lineLabel(0)).toBe('Whole file');
    expect(lineLabel(1204)).toBe('Line 1,204');
  });
});

describe('lineWindow', () => {
  const text = Array.from({ length: 20 }, (_, i) => `${i === 0 ? 0 : 1} L${i + 1}`).join('\r\n');
  it('shows three lines either side and marks the line', () => {
    const w = lineWindow(text, 10);
    expect(w.map(l => l.n)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(w.filter(l => l.mark).map(l => l.n)).toEqual([10]);
    expect(w[3].text).toBe('1 L10');
  });
  it('stops at the start and end of the file', () => {
    expect(lineWindow(text, 1).map(l => l.n)).toEqual([1, 2, 3, 4]);
    expect(lineWindow(text, 20).map(l => l.n)).toEqual([17, 18, 19, 20]);
  });
  it('is empty for line 0 or a line past the end', () => {
    expect(lineWindow(text, 0)).toEqual([]);
    expect(lineWindow(text, 99)).toEqual([]);
  });
  it('splits on CR-only line ends', () => {
    expect(lineWindow('a\rb\rc', 2).map(l => l.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('severityWord', () => {
  it('names each severity', () => {
    expect(['error', 'warning', 'hint'].map(s => severityWord(s as Severity))).toEqual(['Error', 'Warning', 'Hint']);
  });
});

describe('summaryRows', () => {
  it('lists the file facts in order', () => {
    expect(summaryRows(result(), 'tree.ged')).toEqual([
      ['File', 'tree.ged'],
      ['People', '2,322'],
      ['Families', '800'],
      ['Sources', '12'],
      ['Years', '1700–1990'],
      ['Made with', 'PAF 5.2'],
      ['GEDCOM version', '5.5.1'],
      ['Encoding', 'UTF-8'],
    ]);
  });
  it('offers to convert an encoding that is not UTF-8, and copes with missing facts', () => {
    const rows = summaryRows(result({
      encoding: { detected: 'ANSEL', declared: 'ANSEL', reason: '' },
      summary: { ...result().summary, years: null, program: '', programVersion: '', gedcomVersion: '' },
    }), 'royal92.ged');
    const get = (k: string) => rows.find(r => r[0] === k)?.[1];
    expect(get('Encoding')).toBe('ANSEL (we can convert this)');
    expect(get('Years')).toBe('No dates');
    expect(get('Made with')).toBe('Not stated');
    expect(get('GEDCOM version')).toBe('Not stated');
  });
});

describe('doneText', () => {
  it('gives the not-GEDCOM message', () => {
    expect(doneText(result({ isGedcom: false }))).toBe(
      'This doesn\'t look like a GEDCOM file. GEDCOM files usually end in .ged and start with "0 HEAD".');
  });
  it('gives the no-problems line', () => {
    expect(doneText(result())).toBe('No problems found in 2,322 people.');
  });
  it('gives the counts, leaving out none', () => {
    expect(doneText(result({ findings: [f('dates', 'error'), f('dates', 'warning'), f('dates', 'warning')] })))
      .toBe('Checked: 1 error, 2 warnings, 0 hints.');
  });
});
