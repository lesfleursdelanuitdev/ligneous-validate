import { describe, expect, it } from 'vitest';
import catalogText from './testdata/catalog.json?raw';
import {
  FAILED, GROUPS, KEEP_ORIGINAL, OFFER_NOTE, PAGE_SIZE, REPAIR_FAILED, buildGroups, countBySeverity, doneText, groupChanges, leftItems,
  lineLabel, lineViewerAttrs, lineWindow, noProblemsText, codeParts, repairPlan, severityWord, sizeNote,
  summaryRows, viewKind, visibleSlice,
} from './render';
import { resultView } from './checklist';
import type { Finding, Group, Result, Severity } from './types';

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
  it('is failed when the checker failed, whatever isGedcom says', () => {
    expect(viewKind(result({ error: 'boom' }))).toBe('failed');
    expect(viewKind(result({ error: 'boom', isGedcom: false }))).toBe('failed');
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
  it('gives the checker-failed message, not the not-GEDCOM one', () => {
    expect(doneText(result({ error: 'out of memory', isGedcom: false }))).toBe(
      'The checker ran into a problem with this file and had to stop. Your file has not been changed. ' +
      'If it is very large, try exporting a smaller part of your tree.');
    expect(FAILED).toBe(doneText(result({ error: 'x' })));
  });
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

describe('lineViewerAttrs', () => {
  it('is a focusable, named region so its label is announced', () => {
    expect(lineViewerAttrs(1201, 1207)).toEqual({
      class: 'lines',
      role: 'region',
      tabindex: '0',
      translate: 'no',
      'aria-label': 'Lines 1,201 to 1,207 of your file',
    });
  });
});

describe('codeParts', () => {
  it('splits catalog text on backticks into plain and code parts', () => {
    expect(codeParts('End with `0 TRLR`, always.')).toEqual([
      { text: 'End with ', code: false }, { text: '0 TRLR', code: true }, { text: ', always.', code: false },
    ]);
  });
  it('gives one plain part when there are no backticks', () => {
    expect(codeParts('plain')).toEqual([{ text: 'plain', code: false }]);
    expect(codeParts('')).toEqual([]);
  });
});

describe('groupChanges', () => {
  it('groups by what, with a count and up to five example lines', () => {
    const changes = [
      { line: 0, what: 'changed line endings to CRLF' },
      ...Array.from({ length: 120_007 }, (_, i) => ({ line: i + 2, what: 'removed spaces before the level number' })),
      { line: 7, what: 'removed a blank line' },
      { line: 9, what: 'removed a blank line' },
    ];
    expect(groupChanges(changes)).toEqual([
      'Changed line endings to CRLF',
      'Removed spaces before the level number: 120,007 lines (2, 3, 4, 5, 6, …)',
      'Removed a blank line: 2 lines (7, 9)',
    ]);
  });
  it('shows exactly five examples without "…" for five lines', () => {
    const changes = [3, 4, 5, 6, 1_204].map(line => ({ line, what: 'x' }));
    expect(groupChanges(changes)).toEqual(['X: 5 lines (3, 4, 5, 6, 1,204)']);
  });
  it('copes with 280,000 changes quickly', () => {
    const changes = Array.from({ length: 280_000 }, (_, i) => ({ line: i + 1, what: i % 2 ? 'a' : 'b' }));
    const t = performance.now();
    expect(groupChanges(changes)).toEqual(['B: 140,000 lines (1, 3, 5, 7, 9, …)', 'A: 140,000 lines (2, 4, 6, 8, 10, …)']);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('repair strings', () => {
  it('has the strings the slot shows', () => {
    expect(REPAIR_FAILED).toBe("We couldn't make a repaired copy of this file.");
    expect(KEEP_ORIGINAL).toBe('Keep your original file. This is a new copy.');
  });
});

describe('sizeNote', () => {
  const MB = 1024 * 1024;
  it('says nothing under 10 MB', () => {
    expect(sizeNote(2 * MB)).toBe('');
    expect(sizeNote(10 * MB - 1)).toBe('');
  });
  it('says a minute or so from 10 MB', () => {
    const t = 'This is a large file, so checking may take a minute or so. You can use other tabs meanwhile.';
    expect(sizeNote(10 * MB)).toBe(t);
    expect(sizeNote(200 * MB)).toBe(t);
  });
  it('the repair offer says a minute or so', () => {
    expect(OFFER_NOTE).toBe('This may take a minute or so.');
  });
});

describe('repairPlan', () => {
  const MB = 1024 * 1024;
  const clean = (over: Partial<Result> = {}) => result({ bom: false, bareCR: false, ...over });
  it('skips a file with no format findings that is UTF-8 or ASCII with no BOM and no bare CR', () => {
    expect(repairPlan(clean({ findings: [f('dates', 'error')] }), 1000)).toBe('skip');
    expect(repairPlan(clean({ encoding: { detected: 'ASCII', declared: 'ASCII', reason: '' } }), 1000)).toBe('skip');
    expect(repairPlan(clean(), 50 * MB)).toBe('skip');
  });
  it('repairs a small file that has something to fix', () => {
    expect(repairPlan(clean({ findings: [f('format', 'warning')] }), 1000)).toBe('auto');
    expect(repairPlan(clean({ findings: [f('', 'warning')] }), 1000)).toBe('auto');
    expect(repairPlan(clean({ bom: true }), 1000)).toBe('auto');
    expect(repairPlan(clean({ bareCR: true }), 1000)).toBe('auto');
    expect(repairPlan(clean({ encoding: { detected: 'ANSEL', declared: 'ANSEL', reason: '' } }), 1000)).toBe('auto');
    expect(repairPlan(clean({ findings: [f('format', 'warning')] }), 5 * MB)).toBe('auto');
  });
  it('repairs a small file whose findings a suggested fix can fix', () => {
    expect(repairPlan(clean({ findings: [{ ...f('header', 'warning'), code: 'HEADER_MISSING_SUBM' }] }), 1000)).toBe('auto');
    expect(repairPlan(clean({ findings: [{ ...f('links', 'error'), code: 'ORPHANED_FAMC' }] }), 1000)).toBe('auto');
    expect(repairPlan(clean({ findings: [{ ...f('links', 'warning'), code: 'EMPTY_FAMILY' }] }), 1000)).toBe('auto');
    expect(repairPlan(clean({ findings: [{ ...f('links', 'error'), code: 'ORPHANED_FAMC' }] }), 6 * MB)).toBe('offer');
  });
  it('only offers the repair above 5 MB', () => {
    expect(repairPlan(clean({ findings: [f('format', 'warning')] }), 5 * MB + 1)).toBe('offer');
  });
  it('never repairs a file that is not GEDCOM or that the checker failed on', () => {
    expect(repairPlan(clean({ isGedcom: false, bom: true }), 10)).toBe('skip');
    expect(repairPlan(clean({ error: 'x', bom: true }), 10)).toBe('skip');
  });
});

// Every title in the library's catalog (web/src/testdata/catalog.json, kept in
// step by check/catalog_fixture_test.go).
interface Entry { Code: string; Group: Group; Title: string }
const catalog = JSON.parse(catalogText) as Entry[];

describe('leftItems: what the repair leaves, without anyone\'s name', () => {
  const hit = (e: Entry, roles: Finding['roles'] = { person: '@I1@', child: '@I2@', father: '@I3@', mother: '@I4@', family: '@F1@', target: '@X9@' }): Finding =>
    ({ code: e.Code, severity: 'warning', group: e.Group, title: e.Title, meaning: '', howToFix: '', line: 3,
       details: { age: '13', count: '2', encoding: 'ANSEL', declared: 'ANSI', tag: '_X', pointer_tag: 'NOTE' }, xrefs: [], roles });
  const names = { '@I1@': 'Mary Smith', '@I2@': 'Kid Smith', '@I3@': 'John Smith', '@I4@': 'Ann Lee', '@F1@': 'John Smith & Ann Lee' };

  it('reads well for every catalog title', () => {
    expect(catalog.length).toBeGreaterThan(40);
    for (const e of catalog) {
      const items = leftItems([e.Code], result({ findings: [hit(e), hit(e)], names }));
      expect(items).toHaveLength(1);
      const text = items[0].title;
      // No braces, no names, no details, no dangling words, a capital first letter.
      expect(text, e.Code).not.toMatch(/[{}]/);
      expect(text, e.Code).not.toMatch(/Smith|Lee|@I|@F|@X|ANSEL|ANSI|\b13\b/);
      expect(text, e.Code).not.toMatch(/ (at|to|was|of|from|in|it's)$/);
      expect(text, e.Code).not.toMatch(/ ,|\( ?\)|  /);
      expect(text[0], e.Code).toBe(text[0].toUpperCase());
      expect(items[0].count).toBe(2);
    }
  });

  it('uses generic words for roles', () => {
    const by = (code: string) => catalog.find(e => e.Code === code)!;
    const one = (code: string) => leftItems([code], result({ findings: [hit(by(code))], names }))[0];
    expect(one('DEATH_BEFORE_BIRTH')).toEqual({ title: 'Someone died before they were born', count: 1 });
    expect(one('CHILD_BORN_BEFORE_FATHER')).toEqual({ title: 'A child was born before their father', count: 1 });
    expect(one('ENCODING_NOT_UTF8')).toEqual({ title: 'This file uses an older character encoding', count: 1 });
  });

  it('falls back to the group heading when a detail is part of the sentence, and adds those up', () => {
    const by = (code: string) => catalog.find(e => e.Code === code)!;
    const r = result({ findings: [hit(by('MARRIED_BELOW_MINIMUM_AGE')), hit(by('AGE_AT_DEATH_EXCEEDS_120')), hit(by('AGE_AT_DEATH_EXCEEDS_120'))], names });
    expect(leftItems(['AGE_AT_DEATH_EXCEEDS_120', 'MARRIED_BELOW_MINIMUM_AGE'], r))
      .toEqual([{ title: "Dates that don't add up", count: 3, heading: true }]);
  });

  it('adds up codes that read the same', () => {
    const r = result({ findings: [hit(catalog.find(e => e.Code === 'LINE_TOO_LONG')!), hit(catalog.find(e => e.Code === 'LINE_EXCEEDS_MAX_PHYSICAL_LENGTH')!)] });
    expect(leftItems(['LINE_EXCEEDS_MAX_PHYSICAL_LENGTH', 'LINE_TOO_LONG'], r))
      .toEqual([{ title: 'A line is longer than GEDCOM allows', count: 2 }]);
  });

  it('is what the result view lists', () => {
    const e = catalog.find(x => x.Code === 'DEATH_BEFORE_BIRTH')!;
    const info = { changes: [{ line: 1, what: 'a' }], left: [e.Code], before: { errors: 0, warnings: 1, hints: 0 }, after: { errors: 0, warnings: 1, hints: 0 } };
    expect(resultView(info, result({ findings: [hit(e)], names }), []).left)
      .toEqual([{ title: 'Someone died before they were born', count: 1 }]);
  });
});
