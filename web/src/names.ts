export type DownloadKind = 'repaired' | 'report-txt' | 'report-csv';

const SUFFIX: Record<DownloadKind, string> = {
  repaired: '-repaired.ged',
  'report-txt': '-report.txt',
  'report-csv': '-report.csv',
};

/**
 * The name to save a download under, built from the visitor's file name:
 * "Family Tree.GED" -> "Family Tree-repaired.ged". Path separators and
 * control characters are removed, and so are leading
 * dots (which would hide the file); a short extension is dropped.
 */
export function downloadName(original: string, kind: DownloadKind): string {
  let base = original.replace(/[\/\\\u0000-\u001f\u007f]/g, '').trim();
  base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/^[.\s]+/, '').trim();
  if (base === '') base = 'family-tree';
  return base + SUFFIX[kind];
}
