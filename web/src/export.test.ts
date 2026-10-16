import { describe, expect, it } from 'vitest';
import { csvField, reportCsv, reportText } from './export';
import type { Finding, Result } from './types';

function finding(over: Partial<Finding>): Finding {
  return {
    code: 'X', severity: 'error', group: 'links', title: 't', meaning: '', howToFix: '',
    line: 1, details: {}, xrefs: [], roles: {}, ...over,
  };
}

function result(findings: Finding[], over: Partial<Result> = {}): Result {
  return {
    encoding: { detected: 'UTF-8', declared: 'UTF-8', reason: 'header CHAR' },
    summary: {
      people: 2322, families: 800, sources: 12, notes: 0, media: 0, years: [1700, 1990],
      program: 'PAF', programVersion: '5.2', gedcomVersion: '5.5.1', lines: 40000,
    },
    findings, names: { '@I1@': 'Mary Smith' }, text: '', isGedcom: true, ...over,
  };
}

const two = result([
  finding({
    code: 'DATE_ORDER', severity: 'warning', group: 'dates', line: 30,
    title: '{person} died before they were born',
    meaning: 'The death date of {person} is earlier than the birth date.',
    howToFix: 'Check both dates.', roles: { person: '@I1@' },
  }),
  finding({
    code: 'ORPHANED_FAMC', severity: 'error', group: 'links', line: 1204,
    title: "{person} is a child of a family that doesn't exist",
    meaning: 'The link to {target} is lost on import.',
    howToFix: 'Remove the `FAMC` line.', roles: { person: '@I1@', target: '@F9@' },
  }),
]);

describe('reportText', () => {
  it('writes the header, then findings grouped as on the page', () => {
    const now = new Date('2026-10-16T09:30:00Z');
    expect(reportText('Family Tree.ged', two, now)).toBe(
`Check report for Family Tree.ged
Checked on 2026-10-16 at validate.ligneous.org

People: 2,322
Families: 800
Sources: 12
Years: 1700–1990
Made with: PAF 5.2
GEDCOM version: 5.5.1
Encoding: UTF-8

Found 1 error, 1 warning, 0 hints.

BROKEN LINKS

[Error] Line 1,204: Mary Smith is a child of a family that doesn't exist
  The link to @F9@ is lost on import.
  How to fix it: Remove the FAMC line.

DATES THAT DON'T ADD UP

[Warning] Line 30: Mary Smith died before they were born
  The death date of Mary Smith is earlier than the birth date.
  How to fix it: Check both dates.
`);
  });

  it('says "Whole file" for a finding with no line, and omits empty meaning and fix', () => {
    const r = result([finding({ line: 0, group: 'format', title: 'No trailer', severity: 'hint' })]);
    const text = reportText('a.ged', r, new Date('2026-01-02T00:00:00Z'));
    expect(text).toContain('[Hint] Whole file: No trailer\n');
    expect(text).not.toContain('How to fix it');
  });

  it('says so when there is nothing to report', () => {
    expect(reportText('a.ged', result([]), new Date('2026-01-02T00:00:00Z'))).toContain('No problems found.');
  });
});

describe('reportCsv', () => {
  it('starts with a BOM, uses CRLF, and quotes every field', () => {
    const csv = reportCsv(two);
    expect(csv.startsWith('﻿"severity","code","line","title","people","meaning"\r\n')).toBe(true);
    const rows = csv.slice(1).split('\r\n');
    expect(rows[1]).toBe(
      `"error","ORPHANED_FAMC","1204","Mary Smith is a child of a family that doesn't exist","Mary Smith; @F9@","The link to @F9@ is lost on import."`);
    expect(rows[2].startsWith('"warning","DATE_ORDER","30"')).toBe(true);
    expect(rows[3]).toBe('');
    expect(csv).not.toMatch(/[^\r]\n(?!")/);
  });

  it('doubles quotes and keeps commas and newlines inside the quotes', () => {
    const r = result([finding({ title: 'He said "hi", twice', meaning: 'line one\nline two' })]);
    const row = reportCsv(r).slice(1).split('\r\n')[1];
    expect(row).toContain('"He said ""hi"", twice"');
    expect(row).toContain('"line one\nline two"');
  });

  it('gives only the header row for no findings', () => {
    expect(reportCsv(result([]))).toBe('﻿"severity","code","line","title","people","meaning"\r\n');
  });
});

describe('backticks in catalog text', () => {
  const r = result([finding({ title: 'End `0 TRLR` missing', meaning: 'Add `0 TRLR`.', howToFix: 'Type `0 TRLR`.' })]);
  it('are stripped from the text report', () => {
    const t = reportText('a.ged', r, new Date('2026-01-02T00:00:00Z'));
    expect(t).not.toContain('`');
    expect(t).toContain('End 0 TRLR missing');
    expect(t).toContain('How to fix it: Type 0 TRLR.');
  });
  it('are stripped from the CSV', () => {
    expect(reportCsv(r)).not.toContain('`');
    expect(reportCsv(r)).toContain('"End 0 TRLR missing"');
  });
});

describe('CSV formula injection', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])('prefixes an apostrophe to a field starting with %j', ch => {
    expect(csvField(ch + 'x')).toBe(`"'${ch}x"`);
  });
  it('leaves ordinary fields alone', () => {
    expect(csvField('Mary')).toBe('"Mary"');
    expect(csvField('a=b')).toBe('"a=b"');
    expect(csvField('')).toBe('""');
  });
  it('protects person names in title, people and meaning', () => {
    const evil = '=HYPERLINK("http://x","y")';
    const r = result(
      [
        finding({ title: '{person} is odd', meaning: '{person}', roles: { person: '@I1@' } }),
        finding({ title: '{person}', meaning: 'm', roles: { person: '@I2@' } }),
      ],
      { names: { '@I1@': evil, '@I2@': '+cmd' } });
    const rows = reportCsv(r).slice(1).split('\r\n');
    const all = rows.join('\n');
    expect(all).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(all).toContain(`"'+cmd"`);
    expect(all).not.toMatch(/(^|,)"[=+@-]/m);
    // the title starts with the name, so it is protected too
    expect(rows[2]).toContain(`,"'+cmd",`);
  });
  it('does not change the text report', () => {
    const r = result([finding({ title: '{person}', roles: { person: '@I2@' } })], { names: { '@I2@': '+cmd' } });
    expect(reportText('a.ged', r, new Date('2026-01-02T00:00:00Z'))).toContain('Line 1: +cmd');
  });
});

describe('reportText with a repaired copy', () => {
  it('lists the changes grouped, as on the page', () => {
    const now = new Date('2026-10-16T09:30:00Z');
    const changes = [{ line: 0, what: 'changed line endings to CRLF' },
      ...Array.from({ length: 7 }, (_, i) => ({ line: i + 2, what: 'removed spaces before the level number' }))];
    const text = reportText('t.ged', two, now, { changes, left: [], before: { errors: 1, warnings: 1, hints: 0 }, after: { errors: 1, warnings: 0, hints: 0 } });
    expect(text).toContain(`REPAIRED COPY

Changed line endings to CRLF
Removed spaces before the level number: 7 lines (2, 3, 4, 5, 6, …)
`);
  });
  it('says "on this page" for the repaired file', () => {
    const r = result([finding({ code: 'ENCODING_UNDECLARED', group: 'format', howToFix: 'Download the repaired file below, which says UTF-8 in its header.' })]);
    expect(reportText('t.ged', r)).toContain('How to fix it: Download the repaired file on this page, which says UTF-8 in its header.');
  });
});
