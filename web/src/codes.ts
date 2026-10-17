// The one table of which finding codes each kind of repair fixes. Used by
// the checklist (examples, the estimate, the split of what is left) and by
// repairPlan (whether a repair is worth making).

import type { Fix } from './types';

export const CODES: Partial<Record<Fix, string[]>> = {
  encoding: ['ENCODING_NOT_UTF8', 'ENCODING_MISLABELED', 'ENCODING_UNDECLARED', 'ENCODING_BAD_BYTES', 'ENCODING_STRAY_BYTES'],
  'blank-lines': ['EMPTY_LINE'],
  'leading-space': ['LEADING_WHITESPACE'],
  'long-lines': ['LINE_TOO_LONG', 'LINE_EXCEEDS_MAX_PHYSICAL_LENGTH'],
  trailer: ['MISSING_TRAILER'],
  'broken-links': [
    'ORPHANED_FAMC', 'ORPHANED_FAMS', 'ORPHANED_HUSB', 'ORPHANED_WIFE', 'ORPHANED_CHIL', 'ORPHANED_SOUR',
    'ORPHANED_NOTE', 'ORPHANED_XREF_OTHER', 'ORPHANED_ASSOCIATE_XREF',
  ],
  'empty-families': ['EMPTY_FAMILY'],
  submitter: ['HEADER_MISSING_SUBM'],
};

const DATA: Fix[] = ['broken-links', 'empty-families', 'submitter'];

const byCode = new Map<string, Fix>();
for (const [fix, codes] of Object.entries(CODES) as [Fix, string[]][]) for (const c of codes) byCode.set(c, fix);

/** The kind of repair that fixes a finding code, or null. */
export const kindOfCode = (code: string): Fix | null => byCode.get(code) ?? null;

/** Whether a finding code is one a data kind (a suggested fix) can fix. */
export function isDataCode(code: string): boolean {
  const k = kindOfCode(code);
  return k !== null && DATA.includes(k);
}
