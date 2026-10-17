import { describe, expect, it } from 'vitest';
import {
  DATA_LABELS, LABELS, MAX_NAME, announce, cleanName, selectedLeftOut, checklistHeading, countText, everything, examples,
  isOutOfDate, markRan, newChecklist, reasonText, resultView, rowView, rows, selectedFixes,
  setAvailable, setChosen, setName, setPlan,
} from './checklist';
import { isDataCode, kindOfCode } from './codes';
import planSuggested from './testdata/plan-suggested.json';
import planLinks from './testdata/plan-suggested-links.json';
import planNamed from './testdata/plan-suggested-named.json';
import planBlankInFam from './testdata/plan-blank-in-fam-links.json';
import planAnsel from './testdata/plan-ansel-long.json';
import planUtf16 from './testdata/plan-utf16.json';
import type { Finding, FixInfo, PlanOut, RepairOut, Result } from './types';

const PLAN = planSuggested as unknown as Required<PlanOut>;
const PLAN_LINKS = planLinks as unknown as Required<PlanOut>;
const PLAN_NAMED = planNamed as unknown as Required<PlanOut>;
const PLAN_BLANK_IN_FAM = planBlankInFam as unknown as Required<PlanOut>;
const PLAN_ANSEL = planAnsel as unknown as Required<PlanOut>;
const PLAN_UTF16 = planUtf16 as unknown as Required<PlanOut>;

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
    expect(countText(fi('leading-space', 120_007), null)).toBe('120,007 lines');
    expect(countText(fi('trailer', 1), null)).toBe('1 line');
  });
  it('says whole file for a change with no line of its own', () => {
    expect(countText(fi('line-endings', 0), null)).toBe('whole file');
  });
  it('says whole file for the conversion, whatever its line count', () => {
    expect(countText(fi('encoding', 120_007), null)).toBe('whole file');
    expect(countText(fi('encoding', 1), [])).toBe('whole file');
  });
  it('says what the data kinds remove or add, from the units when there are some', () => {
    expect(countText(fi('broken-links', 4), null)).toBe('4 lines removed');
    expect(countText(fi('submitter', 3), null)).toBe('3 lines added');
    const links = PLAN_LINKS.units;
    // Each unit is its line and the lines under it: 2 + 1 + 1.
    expect(countText(fi('broken-links', 4), links['broken-links'])).toBe('4 lines removed');
    // With broken-links chosen too, empty-families also takes F3: 1 + 3 + 2.
    expect(countText(fi('empty-families', 6), links['empty-families'])).toBe('6 lines removed');
    // Alone, only F2 and its link go: 1 + 3.
    expect(countText(fi('empty-families', 6), PLAN.units['empty-families'])).toBe('4 lines removed');
    expect(countText(fi('submitter', 3), PLAN_NAMED.units.submitter)).toBe('3 lines added');
  });
});

describe('defaults', () => {
  it('ticks the format kinds and leaves the data kinds unticked', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE);
    const view = rows(c);
    expect(view.format.map(r => [r.fix, r.checked, r.disabled])).toEqual([['blank-lines', true, false]]);
    expect(view.data.map(r => [r.fix, r.checked, r.disabled])).toEqual([
      ['broken-links', false, false], ['empty-families', false, false], ['submitter', false, false],
    ]);
    expect(selectedFixes(c)).toEqual(['blank-lines']);
  });
  it('lists the rows in catalogue order whatever order they come in', () => {
    const c = newChecklist([fi('trailer', 1), fi('encoding', 3), fi('submitter', 3), fi('bom', 1)]);
    expect(rows(c).format.map(r => r.fix)).toEqual(['encoding', 'bom', 'trailer']);
  });
  it('leaves out a kind with no lines unless it is required or not offered with a reason', () => {
    const c = newChecklist([fi('encoding', 0), fi('trailer', 1)]);
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
    const c = newChecklist(utf16);
    const enc = rowView(c, utf16[0]);
    expect(enc).toMatchObject({ checked: true, disabled: true, reason: 'This file is UTF-16, so it has to be converted first.' });
    expect(setChosen(c, 'encoding', false)).toEqual([]);
    expect(rowView(c, utf16[0]).checked).toBe(true);
    expect(selectedFixes(c)).toEqual(['encoding', 'blank-lines']);
  });
  it('enables the kinds that need it, since it is always on', () => {
    const c = newChecklist(utf16);
    expect(rowView(c, utf16[1])).toMatchObject({ checked: true, disabled: false, reason: null });
  });
});

describe('a kind that needs the conversion', () => {
  const ansel = [fi('encoding', 3), fi('blank-lines', 1), fi('long-lines', 1, { reason: 'needs the conversion to UTF-8' })];
  it('is enabled while encoding is ticked', () => {
    const c = newChecklist(ansel);
    expect(rowView(c, ansel[2])).toMatchObject({ checked: true, disabled: false, reason: null });
  });
  it('is disabled and unticked, with its reason, when encoding is unticked, and comes back with it', () => {
    const c = newChecklist(ansel);
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
    const c = newChecklist(ansel);
    setChosen(c, 'long-lines', false);
    setChosen(c, 'encoding', false);
    setChosen(c, 'encoding', true);
    expect(rowView(c, ansel[2]).checked).toBe(false);
  });
});

describe('empty families', () => {
  it('ticks what Needs names, with a note', () => {
    const c = newChecklist(PLAN.available, PLAN.units);
    const fam = PLAN.available.find(a => a.fix === 'empty-families')!;
    expect(fam.needs).toEqual(['broken-links']);
    expect(rowView(c, fam).reason).toBe(
      "Some of these families only have nobody in them once the broken links are gone, so this needs “Remove links to records that don't exist” too.");
    expect(setChosen(c, 'empty-families', true)).toEqual(['broken-links']);
    expect(rowView(c, fam).note).toBe("Also ticked “Remove links to records that don't exist”, which this needs.");
    expect(rowView(c, fam).reason).toBeNull(); // met
    expect(selectedFixes(c)).toEqual(['blank-lines', 'broken-links', 'empty-families']);
  });
  it('ticks nothing else when Needs is empty', () => {
    const c = newChecklist([fi('blank-lines', 1), fi('broken-links', 4), fi('empty-families', 4)]);
    expect(setChosen(c, 'empty-families', true)).toEqual([]);
    expect(rowView(c, c.available[2]).reason).toBeNull();
    expect(selectedFixes(c)).toEqual(['blank-lines', 'empty-families']);
  });
  it('is not offered when a memberless family has data of its own', () => {
    const info = fi('empty-families', 0, { reason: 'this family has its own information (events, notes or sources)' });
    const c = newChecklist([info]);
    expect(rows(c).data.map(x => x.fix)).toEqual(['empty-families']);
    expect(rowView(c, info)).toMatchObject({
      checked: false, disabled: true,
      reason: 'The family with nobody in it has its own information (events, notes or sources), so it stays.',
    });
    expect(everything(c).fixes).toEqual([]);
  });
});

describe('submitter', () => {
  const sub = fi('submitter', 3);
  it('is not applied without a name, and says so', () => {
    const c = newChecklist([sub]);
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
    const c = newChecklist([sub]);
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
    const c = newChecklist([sub]);
    setChosen(c, 'submitter', true);
    setName(c, 'é'.repeat(100)); // 100 characters, 200 bytes
    expect(selectedFixes(c)).toEqual(['submitter']);
    setName(c, '日'.repeat(83)); // 83 characters, 249 bytes
    expect(selectedFixes(c)).toEqual([]);
    expect(selectedLeftOut(c)).toEqual(['submitter']);
    expect(rowView(c, sub).note).toBe('The name is too long.');
  });
});

describe('Repair everything', () => {
  it('runs every format kind and every data kind that can run, and leaves the submitter out without a name', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE);
    expect(everything(c)).toEqual({ fixes: ['blank-lines', 'broken-links', 'empty-families'], leftOut: ['submitter'] });
    // The ticks follow, so the result isn't out of date at once.
    expect(rows(c).data.every(r => r.checked)).toBe(true);
    setName(c, 'Jo');
    expect(everything(c)).toEqual({ fixes: ['blank-lines', 'broken-links', 'empty-families', 'submitter'], leftOut: [] });
  });
  it('includes a kind that needs the conversion, since encoding is in it too', () => {
    const c = newChecklist([fi('encoding', 3), fi('long-lines', 1, { reason: 'needs the conversion to UTF-8' })]);
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
    const c = newChecklist(SUGGESTED_AVAILABLE);
    expect(isOutOfDate(c)).toBe(false);
    markRan(c, { fixes: selectedFixes(c), name: '', leftOut: [] }, out({ available: SUGGESTED_AVAILABLE }));
    expect(isOutOfDate(c)).toBe(false);
  });
  it('is out of date once the ticks change, and back when they are put back', () => {
    const c = newChecklist(SUGGESTED_AVAILABLE);
    markRan(c, { fixes: selectedFixes(c), name: '', leftOut: [] }, out({ available: SUGGESTED_AVAILABLE }));
    setChosen(c, 'broken-links', true);
    expect(isOutOfDate(c)).toBe(true);
    setChosen(c, 'broken-links', false);
    expect(isOutOfDate(c)).toBe(false);
  });
  it('is not out of date right after a run whose kinds differ from the list on screen (review 2b)', () => {
    // The run's own list can lack a kind the checklist had (an older plan): only kinds it could use count.
    const c = newChecklist([fi('encoding', 3), fi('blank-lines', 1)]);
    const run = { fixes: selectedFixes(c), name: '', leftOut: [] };
    expect(run.fixes).toEqual(['encoding', 'blank-lines']);
    const done = out({ available: [fi('blank-lines', 1)], applied: [fi('blank-lines', 1)] });
    setAvailable(c, done.available!);
    markRan(c, run, done);
    expect(c.ran!.fixes).toEqual(['blank-lines']);
    expect(isOutOfDate(c)).toBe(false);
  });
  it('is out of date when the name in an applied submitter changes, not for a name that was not used', () => {
    const c = newChecklist([fi('submitter', 3)]);
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
    const c = newChecklist([fi('blank-lines', 1), fi('broken-links', 2, { lines: 2 })]);
    setChosen(c, 'blank-lines', false);
    setChosen(c, 'broken-links', true);
    setPlan(c, { available: [fi('blank-lines', 1), fi('trailer', 1), fi('broken-links', 3)], units: { trailer: [] } });
    expect(c.units).toEqual({ trailer: [] });
    expect(selectedFixes(c)).toEqual(['trailer', 'broken-links']);
  });
});

describe('heading', () => {
  it('counts the kinds of format problem', () => {
    expect(checklistHeading(newChecklist([fi('encoding', 1)]), result())).toBe('We can fix 1 kind of format problem');
    expect(checklistHeading(newChecklist([fi('encoding', 1), fi('trailer', 1), fi('submitter', 3)]), result()))
      .toBe('We can fix 2 kinds of format problem');
  });
  it('keeps the optional tidy-up for a clean file, or one with only hints', () => {
    const c = newChecklist([fi('bom', 1)]);
    expect(checklistHeading(c, result({ findings: [] }))).toBe('Optional tidy-up');
    expect(checklistHeading(c, result({ findings: [finding('X', 1, 'hint')] }))).toBe('Optional tidy-up');
  });
  it('says so when only data kinds are offered', () => {
    expect(checklistHeading(newChecklist([fi('submitter', 3)]), result())).toBe('No format problems to fix');
  });
});

describe('reasons', () => {
  it('turns the library reasons into sentences', () => {
    expect(reasonText('long-lines', 'skipped: it would change how the file is read'))
      .toBe('Left as it is where changing it could change how your file is read.');
    expect(reasonText('empty-families', "some families need “Remove links to records that don't exist” too"))
      .toBe("Some families only have nobody in them once the broken links are gone; they need “Remove links to records that don't exist” too.");
    expect(reasonText('empty-families', 'needs broken-links too'))
      .toBe("These families only have nobody in them once the broken links are gone, so this needs “Remove links to records that don't exist” too.");
    expect(reasonText('submitter', 'the name is too long')).toBe('The name is too long.');
    expect(reasonText('submitter', 'needs a name')).toBe('Type your name to include this.');
    expect(reasonText('trailer', 'something new')).toBe('Something new.');
  });
});

describe('Show lines', () => {
  it('lists each unit with its line, what it does and its lines, from Plan', () => {
    const c = newChecklist(PLAN.available, PLAN.units);
    const r = suggestedResult();
    expect(examples('broken-links', c, r)).toEqual({
      items: [
        { line: 11, at: 'Line 11', what: "Removed a link to family @F9@, which doesn't exist (and 1 line under it)",
          rows: [{ text: '1 FAMC @F9@', added: false, nested: false }, { text: '2 PEDI birth', added: false, nested: true }] },
        { line: 22, at: 'Line 22', what: "Removed a link to person @I7@, which doesn't exist", rows: [{ text: '1 CHIL @I7@', added: false, nested: false }] },
        { line: 27, at: 'Line 27', what: "Removed a link to person @I99@, which doesn't exist", rows: [{ text: '1 HUSB @I99@', added: false, nested: false }] },
      ],
      more: 0,
    });
    expect(examples('blank-lines', c, r)!.items).toEqual([{ line: 18, at: 'Line 18', what: 'Removed a blank line', rows: [{ text: '', added: false, nested: false }] }]);
  });
  it('follows the combination: with broken-links chosen, empty-families also lists F3', () => {
    const c = newChecklist(PLAN_LINKS.available, PLAN_LINKS.units);
    expect(examples('empty-families', c, suggestedResult())!.items.map(i => i.line)).toEqual([17, 23, 26]);
  });
  it('keeps a family with a wife after a blank line (the reviewer\'s case)', () => {
    const c = newChecklist(PLAN_BLANK_IN_FAM.available, PLAN_BLANK_IN_FAM.units);
    expect(examples('empty-families', c, result())!.items.map(i => i.what))
      .toEqual(['Removed a link to the removed family @F2@', 'Removed an empty family @F2@', 'Removed an empty family @F3@']);
  });
  it('labels added lines by where they go, not "Line 1"', () => {
    const c = newChecklist(PLAN_NAMED.available, PLAN_NAMED.units);
    expect(examples('submitter', c, suggestedResult())!.items.map(i => i.at))
      .toEqual(['Added in the header', 'Added at the end']);
    // The trailer goes at the end; a missing CHAR line is added in the header; a CHAR line that is there is changed in place.
    const text = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ANSEL\n0 TRLR\n';
    const t = newChecklist([fi('trailer', 1), fi('encoding', 1)], {
      trailer: [{ line: 6, what: 'added the end-of-file marker (0 TRLR)', lines: ['0 TRLR'] }],
      encoding: [{ line: 4, what: 'set the character set to UTF-8', lines: ['1 CHAR UTF-8'] }],
    });
    expect(examples('trailer', t, result({ text }))!.items[0].at).toBe('Added at the end');
    expect(examples('encoding', t, result({ text }))!.items[0].at).toBe('Line 4');
    const noChar = newChecklist([fi('encoding', 1)], { encoding: [{ line: 1, what: 'set the character set to UTF-8', lines: ['1 CHAR UTF-8'] }] });
    expect(examples('encoding', noChar, result({ text: '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 TRLR\n' }))!.items[0].at).toBe('Added in the header');
    // Removed lines keep their line number; a whole-file change says so.
    expect(examples('broken-links', newChecklist(PLAN.available, PLAN.units), suggestedResult())!.items[0].at).toBe('Line 11');
    const whole = newChecklist([fi('line-endings', 3)], { 'line-endings': [{ line: 0, what: 'changed line endings to CRLF' }] });
    expect(examples('line-endings', whole, result())!.items[0].at).toBe('Whole file');
  });
  it('shows added lines as added', () => {
    const c = newChecklist(PLAN_NAMED.available, PLAN_NAMED.units);
    const rowsOf = examples('submitter', c, suggestedResult())!.items.flatMap(i => i.rows);
    expect(rowsOf).toEqual([
      { text: '1 SUBM @SUBM1@', added: true, nested: false },
      { text: '0 @SUBM1@ SUBM', added: true, nested: false },
      { text: '1 NAME Jo March', added: true, nested: false },
    ]);
  });
  it('gives at most five format examples and says how many more', () => {
    const units = Array.from({ length: 8 }, (_, i) => ({ line: i + 1, what: 'removed a blank line', lines: [''] }));
    const c = newChecklist([fi('blank-lines', 8)], { 'blank-lines': units });
    const e = examples('blank-lines', c, result())!;
    expect(e.items.map(i => i.line)).toEqual([1, 2, 3, 4, 5]);
    expect(e.more).toBe(3);
  });
  it('has nothing to show before Plan has answered', () => {
    expect(examples('blank-lines', newChecklist([fi('blank-lines', 1)]), result())).toBeNull();
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
  it('lists the data kinds by unit, counting the lines that really went or came', () => {
    const v = resultView(out({
      changes: [
        { line: 1, what: 'added you as the person who made this file (Jo)', fix: 'submitter' },
        { line: 11, what: "removed a link to family @F9@, which doesn't exist (and 1 line under it)", fix: 'broken-links', removed: ['2 PEDI birth'] },
        { line: 23, what: 'removed an empty family @F2@', fix: 'empty-families', removed: ['1 CHAN', '2 DATE 1 JAN 2020'] },
        { line: 29, what: 'added a submitter record for Jo', fix: 'submitter' },
      ],
      applied: [fi('broken-links', 2), fi('empty-families', 3), fi('submitter', 3)],
    }), result(), []);
    expect(v.groups).toEqual([
      { fix: 'broken-links', label: "Remove links to records that don't exist", count: '2 lines',
        changes: ["Removed a link to family @F9@, which doesn't exist (and 1 line under it): line 11, 2 lines removed"] },
      { fix: 'empty-families', label: 'Remove families with nobody in them', count: '3 lines',
        changes: ['Removed an empty family @F2@: line 23, 3 lines removed'] },
      { fix: 'submitter', label: 'Add you as the person who made this file', count: '3 lines',
        changes: ['Added you as the person who made this file (Jo): line 1, 1 line added', 'Added a submitter record for Jo: line 29, 2 lines added'] },
    ]);
  });
  it('shows a partial skip with its line count, next to what was applied', () => {
    const v = resultView(out({
      applied: [fi('empty-families', 4)],
      skipped: [fi('empty-families', 2, { reason: "some families need “Remove links to records that don't exist” too" })],
    }), result(), []);
    expect(v.notApplied).toEqual([{
      fix: 'empty-families', label: 'Remove families with nobody in them (2 lines)',
      reason: "Some families only have nobody in them once the broken links are gone; they need “Remove links to records that don't exist” too.",
    }]);
    expect(announce(out({
      applied: [fi('empty-families', 4), fi('blank-lines', 1)],
      skipped: [fi('empty-families', 2, { reason: 'x' }), fi('long-lines', 1, { reason: 'y' })],
    }), [])).toBe('Repaired: 2 kinds of fix applied, 1 only in part, 1 not applied.');
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
  const one = (fixes: FixInfo[]) => newChecklist(fixes);
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

describe('from real Plan answers', () => {
  it('UTF-16: encoding is required and ticked, its reason shown', () => {
    const c = newChecklist(PLAN_UTF16.available, PLAN_UTF16.units);
    expect(rows(c).format[0]).toMatchObject({
      fix: 'encoding', checked: true, disabled: true, count: 'whole file',
      reason: 'This file is UTF-16, so it has to be converted first.',
    });
  });
  it('ANSEL: long lines wait for the conversion, and its Show lines has the split pieces', () => {
    const c = newChecklist(PLAN_ANSEL.available, PLAN_ANSEL.units);
    const long = PLAN_ANSEL.available.find(a => a.fix === 'long-lines')!;
    expect(rowView(c, long)).toMatchObject({ checked: true, disabled: false });
    setChosen(c, 'encoding', false);
    expect(rowView(c, long)).toMatchObject({ checked: false, disabled: true, reason: 'This needs “Convert to UTF-8 (and say so in the header)” too.' });
    const ex = examples('long-lines', c, result())!;
    expect(ex.items).toHaveLength(1);
    expect(ex.items[0].rows.length).toBeGreaterThan(1);
    expect(ex.items[0].rows.every(r => r.added)).toBe(true);
    expect(ex.items[0].rows[1].text).toMatch(/^2 CONC /);
  });
});
