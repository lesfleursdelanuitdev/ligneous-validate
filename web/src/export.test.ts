import { describe, expect, it } from 'vitest';
import { reportCsv, reportText } from './export';
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
Checked on 2026-10-16 at ligneous.org (your file was not uploaded)

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
  How to fix it: Remove the \`FAMC\` line.

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
