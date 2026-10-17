import { describe, expect, it } from 'vitest';
import {
  DATA_LABELS, LABELS, MAX_NAME, announce, cleanName, selectedLeftOut, checklistHeading, countText, estimateAvailable, everything, examples,
  familiesNeedLinks, isOutOfDate, linkOnlyFamilies, markRan, newChecklist, reasonText, resultView, rowView, rows, selectedFixes,
  setAvailable, setChosen, setName,
} from './checklist';
import { isDataCode, kindOfCode } from './codes';
import type { Finding, FixInfo, RepairOut, Result } from './types';

const fi = (fix: FixInfo['fix'], lines: number, over: Partial<FixInfo> = {}): FixInfo => ({
  fix, lines, required: false,
  kind: ['broken-links', 'empty-families', 'submitter'].includes(fix) ? 'data' : 'format', ...over,
});

let n = 0;
function finding(code: string, line: number, severity: Finding['severity'] = 'warning'): Finding {
  return { code, severity, group: 'format', title: 'T' + ++n, meaning: '', howToFix: '', line, details: {}, xrefs: [], roles: {} };
}

function result(over: Partial<Result> = {}): Result {
  return {
    encoding: { detected: 'UTF-8', declared: 'UTF-8', reason: '' },
    summary: {
      people: 2, families: 1, sources: 0, notes: 0, media: 0, years: null,
      program: '', programVersion: '', gedcomVersion: '5.5.1', lines: 30,
    },
    findings: [finding('X', 2)], names: {}, text: '', isGedcom: true, bom: false, bareCR: false, ...over,
  };
}

const SUGGESTED = [
  '0 HEAD', '1 SOUR TestSystem', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME Ann /Lee/', '1 SEX F', '1 FAMS @F1@', '1 FAMC @F9@', '2 PEDI birth',
  '0 @I2@ INDI', '1 NAME Bob /Lee/', '1 SEX M', '1 FAMS @F1@', '1 FAMS @F2@', '',
  '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 CHIL @I7@', '0 @F2@ FAM', '1 CHAN', '2 DATE 1 JAN 2020',
  '0 @F3@ FAM', '1 HUSB @I99@', '0 TRLR', '',
].join('\n');
const suggestedResult = () => result({
  text: SUGGESTED,
  findings: [
    finding('EMPTY_LINE', 18), finding('EMPTY_FAMILY', 23), finding('HEADER_MISSING_SUBM', 1),
    finding('ORPHANED_FAMC', 11, 'error'), finding('ORPHANED_CHIL', 22, 'error'), finding('ORPHANED_HUSB', 27, 'error'),
  ],
});
const SUGGESTED_AVAILABLE = [fi('blank-lines', 1), fi('broken-links', 4), fi('empty-families', 6), fi('submitter', 3)];

describe('labels', () => {
  it('has a plain-English label for every kind', () => {
    expect(LABELS).toEqual({
      encoding: 'Convert to UTF-8 (and say so in the header)',
      bom: 'Remove the byte order mark',
      'line-endings': 'Fix line endings',
      'blank-lines': 'Remove blank lines',
      'leading-space': 'Remove spaces before the level number',
      'long-lines': 'Split lines that are too long',
      trailer: 'Add the end-of-file marker',
      'broken-links': "Remove links to records that don't exist",
      'empty-families': 'Remove families with nobody in them',
      submitter: 'Add you as the person who made this file',
    });
    expect(Object.keys(DATA_LABELS)).toEqual(['broken-links', 'empty-families', 'submitter']);
  });
});

describe('counts', () => {
  it('counts lines, singular and plural, with thousands', () => {
    expect(countText(fi('leading-space', 120_007), 'repair')).toBe('120,007 lines');
    expect(countText(fi('trailer', 1), 'repair')).toBe('1 line');
  });
  it('says whole file for a change with no line of its own', () => {
    expect(countText(fi('line-endings', 0), 'repair')).toBe('whole file');
  });
  it('says whole file for the conversion, whatever its line count', () => {
    expect(countText(fi('encoding', 120_007), 'repair')).toBe('whole file');
    expect(countText(fi('encoding', 1), 'findings')).toBe('whole file');
  });
  it('says what the data kinds remove or add', () => {
    expect(countText(fi('broken-links', 4), 'repair')).toBe('4 lines removed');
    expect(countText(fi('empty-families', 1), 'plan')).toBe('1 line removed');
    expect(countText(fi('submitter', 3), 'repair')).toBe('3 lines added');
  });
  it('says about for a count estimated from the findings', () => {
    expect(countText(fi('blank-lines', 3), 'findings')).toBe('about 3 lines');
    expect(countText(fi('broken-links', 2), 'findings')).toBe('2 found');
    expect(countText(fi('submitter', 3), 'findings')).toBe('3 lines added');
  });
});

describe('defaults', () => {
  it('ticks the format kinds and leaves the data kinds unticked', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', result());
    const view = rows(c);
    expect(view.format.map(r => [r.fix, r.checked, r.disabled])).toEqual([['blank-lines', true, false]]);
    expect(view.data.map(r => [r.fix, r.checked, r.disabled])).toEqual([
      ['broken-links', false, false], ['empty-families', false, false], ['submitter', false, false],
    ]);
    expect(selectedFixes(c)).toEqual(['blank-lines']);
  });
  it('lists the rows in catalogue order whatever order they come in', () => {
    const c = newChecklist([fi('trailer', 1), fi('encoding', 3), fi('submitter', 3), fi('bom', 1)], 'repair', result());
    expect(rows(c).format.map(r => r.fix)).toEqual(['encoding', 'bom', 'trailer']);
  });
  it('leaves out a kind with no lines unless it is required or not offered with a reason', () => {
    const c = newChecklist([fi('encoding', 0), fi('trailer', 1)], 'repair', result());
    expect(rows(c).format.map(r => r.fix)).toEqual(['trailer']);
  });
});

describe('required kinds', () => {
  const utf16 = [
    fi('encoding', 9, { required: true, reason: 'this file is UTF-16, so it has to be converted first' }),
    fi('blank-lines', 2, { reason: 'needs the conversion to UTF-8' }),
    fi('submitter', 3, { reason: 'needs the conversion to UTF-8' }),
  ];
  it('is ticked and disabled, with its reason', () => {
    const c = newChecklist(utf16, 'repair', result());
    const enc = rowView(c, utf16[0]);
    expect(enc).toMatchObject({ checked: true, disabled: true, reason: 'This file is UTF-16, so it has to be converted first.' });
    expect(setChosen(c, 'encoding', false)).toEqual([]);
    expect(rowView(c, utf16[0]).checked).toBe(true);
    expect(selectedFixes(c)).toEqual(['encoding', 'blank-lines']);
  });
  it('enables the kinds that need it, since it is always on', () => {
    const c = newChecklist(utf16, 'repair', result());
    expect(rowView(c, utf16[1])).toMatchObject({ checked: true, disabled: false, reason: null });
  });
});

describe('a kind that needs the conversion', () => {
  const ansel = [fi('encoding', 3), fi('blank-lines', 1), fi('long-lines', 1, { reason: 'needs the conversion to UTF-8' })];
  it('is enabled while encoding is ticked', () => {
    const c = newChecklist(ansel, 'repair', result());
    expect(rowView(c, ansel[2])).toMatchObject({ checked: true, disabled: false, reason: null });
  });
  it('is disabled and unticked, with its reason, when encoding is unticked, and comes back with it', () => {
    const c = newChecklist(ansel, 'repair', result());
    setChosen(c, 'encoding', false);
    expect(rowView(c, ansel[2])).toMatchObject({
      checked: false, disabled: true, reason: 'This needs “Convert to UTF-8 (and say so in the header)” too.',
    });
    expect(selectedFixes(c)).toEqual(['blank-lines']);
    setChosen(c, 'encoding', true);
    expect(rowView(c, ansel[2])).toMatchObject({ checked: true, disabled: false });
    expect(selectedFixes(c)).toEqual(['encoding', 'blank-lines', 'long-lines']);
  });
  it('remembers an untick made while it was enabled', () => {
    const c = newChecklist(ansel, 'repair', result());
    setChosen(c, 'long-lines', false);
    setChosen(c, 'encoding', false);
    setChosen(c, 'encoding', true);
    expect(rowView(c, ansel[2]).checked).toBe(false);
  });
});

describe('empty families', () => {
  it('ticks broken-links too when some families need it, with a note', () => {
    const r = suggestedResult();
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', r);
    expect(c.needsLinks).toBe(true);
    const fam = SUGGESTED_AVAILABLE[2];
    expect(rowView(c, fam).reason).toBe(
      "Some of these families only have nobody in them once the broken links are gone, so this needs “Remove links to records that don't exist” too.");
    expect(setChosen(c, 'empty-families', true)).toEqual(['broken-links']);
    expect(rowView(c, fam).note).toBe("Also ticked “Remove links to records that don't exist”, which this needs.");
    expect(selectedFixes(c)).toEqual(['blank-lines', 'broken-links', 'empty-families']);
  });
  it('ticks nothing else when every family is empty already', () => {
    const r = suggestedResult();
    r.findings = r.findings.filter(f => f.code !== 'ORPHANED_HUSB');
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', r);
    expect(c.needsLinks).toBe(false);
    expect(setChosen(c, 'empty-families', true)).toEqual([]);
    expect(rowView(c, SUGGESTED_AVAILABLE[2]).reason).toBeNull();
    expect(selectedFixes(c)).toEqual(['blank-lines', 'empty-families']);
  });
  it('learns it from a run that skipped empty-families for that reason', () => {
    const r = suggestedResult();
    r.findings = r.findings.filter(f => f.code !== 'ORPHANED_HUSB');
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', r);
    markRan(c, { fixes: ['empty-families'], name: '', leftOut: [] },
      out({ skipped: [fi('empty-families', 6, { reason: 'needs broken-links too' })] }));
    expect(c.needsLinks).toBe(true);
  });
  it('is not offered when a memberless family has data of its own', () => {
    const info = fi('empty-families', 0, { reason: 'this family has its own information (events, notes or sources)' });
    const c = newChecklist([info], 'repair', result());
    expect(rows(c).data.map(x => x.fix)).toEqual(['empty-families']);
    expect(rowView(c, info)).toMatchObject({
      checked: false, disabled: true,
      reason: 'The family with nobody in it has its own information (events, notes or sources), so it stays.',
    });
    expect(everything(c).fixes).toEqual([]);
  });
  it('finds the families that need broken-links in the text', () => {
    expect(familiesNeedLinks(suggestedResult())).toBe(true);
    expect(linkOnlyFamilies(suggestedResult())).toEqual([26]);
    const r = suggestedResult();
    r.text = r.text.replace('1 HUSB @I99@', '1 HUSB @I99@\n1 MARR');
    expect(familiesNeedLinks(r)).toBe(false); // F3 has its own event: it stays
  });
});

describe('submitter', () => {
  const sub = fi('submitter', 3);
  it('is not applied without a name, and says so', () => {
    const c = newChecklist([sub], 'repair', result());
    setChosen(c, 'submitter', true);
    expect(rowView(c, sub)).toMatchObject({ checked: true, nameField: true, note: 'Type your name to include this.' });
    expect(selectedFixes(c)).toEqual([]);
    setName(c, '   ');
    expect(selectedFixes(c)).toEqual([]);
    setName(c, ' Jo  March ');
    expect(rowView(c, sub)).toMatchObject({ note: null });
    expect(selectedFixes(c)).toEqual(['submitter']);
  });
  it('shows the name field only when ticked', () => {
    const c = newChecklist([sub], 'repair', result());
    expect(rowView(c, sub).nameField).toBe(false);
  });
  it('allows at most 120 characters', () => {
    expect(MAX_NAME).toBe(120);
  });
  it('cleans the name as the library does', () => {
    expect(cleanName('  Jo\t\tMarch  ')).toBe('Jo March');
    expect(cleanName('Jo\u200bMa\ufeffrch')).toBe('JoMarch'); // zero-width characters go
    expect(cleanName('Jo\u0001\u007f\u0090 March')).toBe('Jo March'); // C0, DEL and C1 controls go
    expect(cleanName('Jo\u00a0\u2028\u2029\u0085March')).toBe('Jo March'); // Go's unicode.IsSpace: one space
    expect(cleanName('Jo\r\nMarch')).toBe('Jo March');
  });
  it('is not applied with a name over 248 bytes in UTF-8, and says so', () => {
    const c = newChecklist([sub], 'repair', result());
    setChosen(c, 'submitter', true);
    setName(c, 'é'.repeat(100)); // 100 characters, 200 bytes
    expect(selectedFixes(c)).toEqual(['submitter']);
    setName(c, '日'.repeat(83)); // 83 characters, 249 bytes
    expect(selectedFixes(c)).toEqual([]);
    expect(selectedLeftOut(c)).toEqual(['submitter']);
    expect(rowView(c, sub).note).toBe('The name is too long (at most 120 characters).');
  });
});

describe('Repair everything', () => {
  it('runs every format kind and every data kind that can run, and leaves the submitter out without a name', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', suggestedResult());
    expect(everything(c)).toEqual({ fixes: ['blank-lines', 'broken-links', 'empty-families'], leftOut: ['submitter'] });
    // The ticks follow, so the result isn't out of date at once.
    expect(rows(c).data.every(r => r.checked)).toBe(true);
    setName(c, 'Jo');
    expect(everything(c)).toEqual({ fixes: ['blank-lines', 'broken-links', 'empty-families', 'submitter'], leftOut: [] });
  });
  it('includes a kind that needs the conversion, since encoding is in it too', () => {
    const c = newChecklist([fi('encoding', 3), fi('long-lines', 1, { reason: 'needs the conversion to UTF-8' })], 'repair', result());
    setChosen(c, 'encoding', false);
    expect(everything(c).fixes).toEqual(['encoding', 'long-lines']);
  });
});

function out(over: Partial<RepairOut> = {}): RepairOut {
  return {
    changes: [], left: [], before: { errors: 3, warnings: 1, hints: 0 }, after: { errors: 0, warnings: 1, hints: 0 },
    available: [], applied: [], skipped: [], ...over,
  };
}

describe('out of date', () => {
  it('is not out of date before a run or right after one', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', suggestedResult());
    expect(isOutOfDate(c)).toBe(false);
    markRan(c, { fixes: selectedFixes(c), name: '', leftOut: [] }, out({ available: SUGGESTED_AVAILABLE }));
    expect(isOutOfDate(c)).toBe(false);
  });
  it('is out of date once the ticks change, and back when they are put back', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE, 'repair', suggestedResult());
    markRan(c, { fixes: selectedFixes(c), name: '', leftOut: [] }, out({ available: SUGGESTED_AVAILABLE }));
    setChosen(c, 'broken-links', true);
    expect(isOutOfDate(c)).toBe(true);
    setChosen(c, 'broken-links', false);
    expect(isOutOfDate(c)).toBe(false);
  });
  it('is not out of date right after a run whose kinds differ from the estimate (review 2b)', () => {
    // A big file: the checklist is estimated from the findings, then the run's own list replaces it.
    const r = result({ encoding: { detected: 'ANSEL', declared: 'ANSEL', reason: '' }, findings: [finding('EMPTY_LINE', 4)] });
    const c = newChecklist(estimateAvailable(r), 'findings', r);
    const run = { fixes: selectedFixes(c), name: '', leftOut: [] };
    expect(run.fixes).toEqual(['encoding', 'blank-lines']);
    const done = out({ available: [fi('blank-lines', 1)], applied: [fi('blank-lines', 1)] });
    setAvailable(c, done.available!, 'repair');
    markRan(c, run, done);
    expect(c.ran!.fixes).toEqual(['blank-lines']);
    expect(isOutOfDate(c)).toBe(false);
  });
  it('is out of date when the name in an applied submitter changes, not for a name that was not used', () => {
    const c = newChecklist([fi('submitter', 3)], 'repair', result());
    markRan(c, { fixes: [], name: '', leftOut: [] }, out({ available: [fi('submitter', 3)] }));
    setName(c, 'Jo');
    expect(isOutOfDate(c)).toBe(false); // the submitter isn't ticked
    setChosen(c, 'submitter', true);
    expect(isOutOfDate(c)).toBe(true);
    markRan(c, { fixes: ['submitter'], name: 'Jo', leftOut: [] }, out({ available: [fi('submitter', 3)] }));
    setName(c, 'Jo M');
    expect(isOutOfDate(c)).toBe(true);
  });
});

describe('a new list of kinds', () => {
  it('keeps what the visitor ticked and the defaults for the rest', () => {
    const c = newChecklist([fi('blank-lines', 1), fi('broken-links', 2, { lines: 2 })], 'findings', result());
    setChosen(c, 'blank-lines', false);
    setChosen(c, 'broken-links', true);
    setAvailable(c, [fi('blank-lines', 1), fi('trailer', 1), fi('broken-links', 3)], 'plan');
    expect(c.source).toBe('plan');
    expect(selectedFixes(c)).toEqual(['trailer', 'broken-links']);
  });
});

describe('heading', () => {
  it('counts the kinds of format problem', () => {
    expect(checklistHeading(newChecklist([fi('encoding', 1)], 'repair', result()), result())).toBe('We can fix 1 kind of format problem');
    expect(checklistHeading(newChecklist([fi('encoding', 1), fi('trailer', 1), fi('submitter', 3)], 'repair', result()), result()))
      .toBe('We can fix 2 kinds of format problem');
  });
  it('keeps the optional tidy-up for a clean file, or one with only hints', () => {
    const c = newChecklist([fi('bom', 1)], 'repair', result());
    expect(checklistHeading(c, result({ findings: [] }))).toBe('Optional tidy-up');
    expect(checklistHeading(c, result({ findings: [finding('X', 1, 'hint')] }))).toBe('Optional tidy-up');
  });
  it('says so when only data kinds are offered', () => {
    expect(checklistHeading(newChecklist([fi('submitter', 3)], 'repair', result()), result())).toBe('No format problems to fix');
  });
});

describe('reasons', () => {
  it('turns the library reasons into sentences', () => {
    expect(reasonText('long-lines', 'skipped: it would change how the file is read')).toBe('Skipped: it would change how the file is read.');
    expect(reasonText('submitter', 'needs a name')).toBe('Type your name to include this.');
    expect(reasonText('submitter', 'the name is too long (at most 120 characters)')).toBe('The name is too long (at most 120 characters).');
    expect(reasonText('trailer', 'something new')).toBe('Something new.');
  });
});

describe('estimate from the findings', () => {
  it('maps the findings to kinds', () => {
    const r = result({
      bom: true, bareCR: true,
      findings: [
        finding('EMPTY_LINE', 5), finding('EMPTY_LINE', 9), finding('LEADING_WHITESPACE', 3), finding('LINE_TOO_LONG', 12),
        finding('MISSING_TRAILER', 0), finding('ORPHANED_FAMC', 20), finding('EMPTY_FAMILY', 30), finding('HEADER_MISSING_SUBM', 1),
        finding('DEATH_BEFORE_BIRTH', 40),
      ],
    });
    expect(estimateAvailable(r).map(a => [a.fix, a.lines, a.kind])).toEqual([
      ['bom', 1, 'format'], ['line-endings', 0, 'format'], ['blank-lines', 2, 'format'], ['leading-space', 1, 'format'],
      ['long-lines', 1, 'format'], ['trailer', 1, 'format'],
      ['broken-links', 1, 'data'], ['empty-families', 1, 'data'], ['submitter', 3, 'data'],
    ]);
  });
  it('makes encoding required for UTF-16, and the rest need the conversion', () => {
    const r = result({ encoding: { detected: 'UTF-16LE', declared: '', reason: '' }, bom: true, findings: [finding('EMPTY_LINE', 4)] });
    const a = estimateAvailable(r);
    expect(a[0]).toMatchObject({ fix: 'encoding', required: true, reason: 'this file is UTF-16, so it has to be converted first' });
    expect(a.find(x => x.fix === 'bom')).toBeUndefined(); // the conversion removes it
    expect(a.find(x => x.fix === 'blank-lines')!.reason).toBe('needs the conversion to UTF-8');
  });
  it('says long lines need the conversion in a legacy encoding', () => {
    const r = result({ encoding: { detected: 'ANSEL', declared: 'ANSEL', reason: '' }, findings: [finding('LINE_TOO_LONG', 7)] });
    const a = estimateAvailable(r);
    expect(a.map(x => x.fix)).toEqual(['encoding', 'long-lines']);
    expect(a[1].reason).toBe('needs the conversion to UTF-8');
  });
});

describe('Show lines', () => {
  it('uses the findings before a run, with the lines from the file', () => {
    const r = suggestedResult();
    expect(examples('blank-lines', r, null)).toEqual({ items: [{ line: 18, text: '', nested: [] }], more: 0 });
  });
  it('lists each broken link with the lines nested under it', () => {
    const r = suggestedResult();
    expect(examples('broken-links', r, null).items).toEqual([
      { line: 11, text: '1 FAMC @F9@', nested: [{ line: 12, text: '2 PEDI birth' }] },
      { line: 22, text: '1 CHIL @I7@', nested: [] },
      { line: 27, text: '1 HUSB @I99@', nested: [] },
    ]);
  });
  it('uses the changes of a run that had that kind, with what it removed', () => {
    const r = suggestedResult();
    const info = out({
      changes: [
        { line: 11, what: "removed a link to family @F9@, which doesn't exist (and 1 line under it)", fix: 'broken-links', removed: ['2 PEDI birth'] },
        { line: 18, what: 'removed a blank line', fix: 'blank-lines' },
      ],
    });
    expect(examples('broken-links', r, info).items).toEqual([
      { line: 11, text: '1 FAMC @F9@', nested: [{ line: 12, text: '2 PEDI birth' }] },
    ]);
    // A kind the run didn't have still comes from the findings, with the families
    // that only go once their broken links are gone.
    expect(examples('empty-families', r, info).items).toEqual([
      { line: 23, text: '0 @F2@ FAM', nested: [{ line: 24, text: '1 CHAN' }, { line: 25, text: '2 DATE 1 JAN 2020' }] },
      { line: 26, text: '0 @F3@ FAM', nested: [{ line: 27, text: '1 HUSB @I99@' }] },
    ]);
  });
  it('gives at most five format examples and says how many more', () => {
    const r = result({ text: 'a\n'.repeat(20), findings: Array.from({ length: 8 }, (_, i) => finding('EMPTY_LINE', i + 1)) });
    const e = examples('blank-lines', r, null);
    expect(e.items.map(i => i.line)).toEqual([1, 2, 3, 4, 5]);
    expect(e.more).toBe(3);
  });
  it('shows a whole-file change as its text', () => {
    const info = out({ changes: [{ line: 0, what: 'changed line endings to CRLF', fix: 'line-endings' }] });
    expect(examples('line-endings', result(), info).items).toEqual([{ line: 0, text: 'Changed line endings to CRLF', nested: [] }]);
  });
});

describe('after a run', () => {
  const info = out({
    changes: [
      { line: 0, what: 'converted from ANSEL to UTF-8', fix: 'encoding' },
      { line: 4, what: 'set the character set to UTF-8', fix: 'encoding' },
      { line: 10, what: 'removed a blank line', fix: 'blank-lines' },
      { line: 12, what: 'removed a blank line', fix: 'blank-lines' },
    ],
    applied: [fi('encoding', 3), fi('blank-lines', 2)],
    skipped: [fi('long-lines', 1, { reason: 'needs the conversion to UTF-8' })],
  });
  it('groups the changes by kind with the applied counts', () => {
    const v = resultView(info, result(), []);
    expect(v.groups).toEqual([
      { fix: 'encoding', label: 'Convert to UTF-8 (and say so in the header)', count: '3 lines',
        changes: ['Converted from ANSEL to UTF-8', 'Set the character set to UTF-8: 1 line (4)'] },
      { fix: 'blank-lines', label: 'Remove blank lines', count: '2 lines', changes: ['Removed a blank line: 2 lines (10, 12)'] },
    ]);
    expect(v.before).toBe('3 errors, 1 warning, 0 hints');
    expect(v.after).toBe('0 errors, 1 warning, 0 hints');
  });
  it('splits what is left into what a fix on the checklist can fix and the rest', () => {
    const orphan = { ...finding('ORPHANED_FAMC', 5, 'error'), group: 'links' as const, title: 'Broken family link' };
    const subm = { ...finding('HEADER_MISSING_SUBM', 1), group: 'header' as const, title: 'No submitter' };
    const date = { ...finding('DATE_ORDER', 7), group: 'dates' as const, title: 'Dates in the wrong order' };
    const v = resultView(out({ left: ['DATE_ORDER', 'HEADER_MISSING_SUBM', 'ORPHANED_FAMC'], available: [fi('broken-links', 1)] }),
      result({ findings: [orphan, subm, date] }), []);
    expect(v.leftFixable).toEqual([{ title: 'Broken family link', count: 1 }]);
    // The submitter isn't on this checklist (not available), so it stays with the rest.
    expect(v.left).toEqual([{ title: 'Dates in the wrong order', count: 1 }, { title: 'No submitter', count: 1 }]);
  });
  it('lists what was not applied, with reasons, and a submitter left out for want of a name', () => {
    const v = resultView(info, result(), ['submitter']);
    expect(v.notApplied).toEqual([
      { fix: 'long-lines', label: 'Split lines that are too long', reason: 'This needs “Convert to UTF-8 (and say so in the header)” too.' },
      { fix: 'submitter', label: 'Add you as the person who made this file', reason: 'Type your name to include this.' },
    ]);
  });
  it('puts changes with no kind (an older checker) in one group with no label', () => {
    const v = resultView(out({ changes: [{ line: 0, what: 'changed line endings to CRLF' }], applied: undefined }), result(), []);
    expect(v.groups).toEqual([{ fix: null, label: null, count: null, changes: ['Changed line endings to CRLF'] }]);
  });
  it('announces how many kinds were applied and not applied', () => {
    expect(announce(info, [])).toBe('Repaired: 2 kinds of fix applied, 1 not applied.');
    expect(announce(info, ['submitter'])).toBe('Repaired: 2 kinds of fix applied, 2 not applied.');
    expect(announce(out({ applied: [fi('trailer', 1)] }), [])).toBe('Repaired: 1 kind of fix applied.');
    expect(announce(out(), [])).toBe('Repaired: nothing needed changing.');
  });
});

// Ported from render.test.ts (repairView), which this replaces.
describe('the result view (from repairView)', () => {
  const info = (changes: RepairOut['changes'], left: string[] = []) => out({ changes, left });
  it('lists the changes grouped by what was done, with line counts', () => {
    const v = resultView(info([{ line: 0, what: 'added a trailer' }, { line: 1204, what: 'fixed a thing' }]), result(), []);
    expect(v.groups.flatMap(g => g.changes)).toEqual(['Added a trailer', 'Fixed a thing: 1 line (1,204)']);
  });
  it('gives the counts before and after', () => {
    const v = resultView(info([{ line: 0, what: 'a' }]), result(), []);
    expect(v.before).toBe('3 errors, 1 warning, 0 hints');
    expect(v.after).toBe('0 errors, 1 warning, 0 hints');
  });
  it('shows the GEDCOM 5.5 note only for exactly 5.5', () => {
    const one = info([{ line: 0, what: 'a' }]);
    const r55 = result({ summary: { ...result().summary, gedcomVersion: '5.5' } });
    expect(resultView(one, r55, []).note).toBe("Your file is GEDCOM 5.5, which doesn't officially list UTF-8. Almost every program reads it anyway.");
    expect(resultView(one, result(), []).note).toBeNull();
  });
  it('maps the codes left to titles with their counts in the current result', () => {
    const a = { ...finding('ORPHANED_FAMC', 5, 'error'), group: 'links' as const, title: 'Broken family link' };
    const b = { ...finding('ORPHANED_FAMC', 9, 'error'), group: 'links' as const, title: 'Broken family link' };
    const c = { ...finding('DATE_ORDER', 7), group: 'dates' as const, title: 'Dates in the wrong order' };
    const v = resultView(info([{ line: 0, what: 'a' }], ['DATE_ORDER', 'ORPHANED_FAMC', 'GONE']), result({ findings: [a, b, c] }), []);
    expect(v.left).toEqual([
      { title: 'Dates in the wrong order', count: 1 },
      { title: 'Broken family link', count: 2 },
    ]);
  });
  it('keeps catalog backticks so the page can draw <code>', () => {
    const x = { ...finding('X', 2), title: 'Missing `0 TRLR`' };
    const v = resultView(info([{ line: 3, what: 'added `0 TRLR`' }], ['X']), result({ findings: [x] }), []);
    expect(v.groups[0].changes).toEqual(['Added `0 TRLR`: 1 line (3)']);
    expect(v.left[0].title).toBe('Missing `0 TRLR`');
  });
});

describe('the heading (from repairView)', () => {
  const one = (fixes: FixInfo[]) => newChecklist(fixes, 'repair', result());
  it('uses the singular for one kind and the plural for more, with thousands', () => {
    const withWarning = result({ findings: [finding('X', 1, 'warning')] });
    expect(checklistHeading(one([fi('trailer', 1)]), withWarning)).toBe('We can fix 1 kind of format problem');
    expect(checklistHeading(one([fi('trailer', 1), fi('bom', 1)]), withWarning)).toBe('We can fix 2 kinds of format problem');
  });
  it('calls it an optional tidy-up for a file with no findings, or only hints', () => {
    expect(checklistHeading(one([fi('bom', 1)]), result({ findings: [] }))).toBe('Optional tidy-up');
    expect(checklistHeading(one([fi('bom', 1)]), result({ findings: [finding('A', 1, 'hint'), finding('B', 2, 'hint')] }))).toBe('Optional tidy-up');
  });
  it('keeps "We can fix" when there is a warning or an error', () => {
    expect(checklistHeading(one([fi('bom', 1)]), result({ findings: [finding('A', 1, 'hint'), finding('B', 2, 'warning')] })))
      .toBe('We can fix 1 kind of format problem');
  });
  it('has no rows when nothing can be fixed', () => {
    const c = one([]);
    expect(rows(c)).toEqual({ format: [], data: [] });
  });
});

describe('the code table', () => {
  it('maps finding codes to the kind that fixes them', () => {
    expect(kindOfCode('EMPTY_LINE')).toBe('blank-lines');
    expect(kindOfCode('ORPHANED_HUSB')).toBe('broken-links');
    expect(kindOfCode('HEADER_MISSING_SUBM')).toBe('submitter');
    expect(kindOfCode('ENCODING_NOT_UTF8')).toBe('encoding');
    expect(kindOfCode('DEATH_BEFORE_BIRTH')).toBeNull();
    expect(isDataCode('EMPTY_FAMILY')).toBe(true);
    expect(isDataCode('EMPTY_LINE')).toBe(false);
  });
});
