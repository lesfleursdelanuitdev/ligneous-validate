// The two report downloads: a plain-text report to read or print, and a CSV
// to open in a spreadsheet.

import { fill } from './fill';
import { SEVERITIES, buildGroups, countBySeverity, countLabel, lineLabel, severityWord, summaryRows } from './render';
import type { Finding, Result, Role } from './types';

const ALL = { error: true, warning: true, hint: true };
const ROLE_ORDER: Role[] = ['person', 'child', 'father', 'mother', 'family', 'target'];

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The report as plain text; `now` is only for tests. */
export function reportText(file: string, r: Result, now: Date = new Date()): string {
  const out: string[] = [
    `Check report for ${file}`,
    `Checked on ${isoDate(now)} at ligneous.org (your file was not uploaded)`,
    '',
  ];
  for (const [label, value] of summaryRows(r, file)) {
    if (label !== 'File') out.push(`${label}: ${value}`);
  }
  out.push('');
  if (r.findings.length === 0) {
    out.push('No problems found.');
    return out.join('\n') + '\n';
  }
  const c = countBySeverity(r.findings);
  out.push(`Found ${SEVERITIES.map(s => countLabel(s, c[s])).join(', ')}.`);
  for (const g of buildGroups(r.findings, ALL)) {
    out.push('', g.heading.toUpperCase(), '');
    g.findings.forEach((f, i) => {
      if (i > 0) out.push('');
      out.push(`[${severityWord(f.severity)}] ${lineLabel(f.line)}: ${fill(f.title, f, r.names)}`);
      if (f.meaning) out.push(`  ${fill(f.meaning, f, r.names)}`);
      if (f.howToFix) out.push(`  How to fix it: ${fill(f.howToFix, f, r.names)}`);
    });
  }
  return out.join('\n') + '\n';
}

const quote = (v: string | number): string => '"' + String(v).replace(/"/g, '""') + '"';

function people(f: Finding, names: Record<string, string>): string {
  const seen: string[] = [];
  for (const role of ROLE_ORDER) {
    const xref = f.roles[role];
    if (!xref) continue;
    const name = names[xref] || xref;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen.join('; ');
}

/** The findings as CSV: RFC 4180 quoting, CRLF line ends, a BOM for Excel. */
export function reportCsv(r: Result): string {
  const rows: string[][] = [['severity', 'code', 'line', 'title', 'people', 'meaning']];
  for (const g of buildGroups(r.findings, ALL)) {
    for (const f of g.findings) {
      rows.push([f.severity, f.code, String(f.line), fill(f.title, f, r.names), people(f, r.names), fill(f.meaning, f, r.names)]);
    }
  }
  return '﻿' + rows.map(row => row.map(quote).join(',') + '\r\n').join('');
}
