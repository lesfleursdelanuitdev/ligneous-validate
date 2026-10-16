// The two report downloads: a plain-text report to read or print, and a CSV
// to open in a spreadsheet.

import { fill, pageText } from './fill';
import { SEVERITIES, buildGroups, countBySeverity, countLabel, groupChanges, lineLabel, severityWord, summaryRows } from './render';
import type { Finding, RepairOut, Result, Role } from './types';

const ALL = { error: true, warning: true, hint: true };
const ROLE_ORDER: Role[] = ['person', 'child', 'father', 'mother', 'family', 'target'];

/** The catalog marks GEDCOM examples with backticks; plain text has no use for them. */
const plain = (s: string): string => s.replace(/`/g, '');
const say = (template: string, f: Finding, names: Record<string, string>): string => plain(fill(pageText(template), f, names));

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The report as plain text, with the repaired copy's changes when there is one; `now` is only for tests. */
export function reportText(file: string, r: Result, now: Date = new Date(), repair: RepairOut | null = null): string {
  const out: string[] = [
    `Check report for ${file}`,
    `Checked on ${isoDate(now)} at validate.ligneous.org`,
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
      out.push(`[${severityWord(f.severity)}] ${lineLabel(f.line)}: ${say(f.title, f, r.names)}`);
      if (f.meaning) out.push(`  ${say(f.meaning, f, r.names)}`);
      if (f.howToFix) out.push(`  How to fix it: ${say(f.howToFix, f, r.names)}`);
    });
  }
  if (repair && !repair.error && repair.changes.length) {
    out.push('', 'REPAIRED COPY', '');
    for (const c of groupChanges(repair.changes)) out.push(plain(c));
  }
  return out.join('\n') + '\n';
}

/**
 * One CSV field. A field that starts with = + - @ tab or CR would be run as a
 * formula by Excel and LibreOffice (names come from the visitor's file), so
 * it gets a leading apostrophe. Then RFC 4180 quoting.
 */
export function csvField(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return '"' + safe.replace(/"/g, '""') + '"';
}

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
      rows.push([f.severity, f.code, String(f.line), say(f.title, f, r.names), people(f, r.names), say(f.meaning, f, r.names)]);
    }
  }
  return '﻿' + rows.map(row => row.map(csvField).join(',') + '\r\n').join('');
}
