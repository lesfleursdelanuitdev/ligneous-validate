import { describe, expect, it } from 'vitest';
import { downloadName } from './names';

describe('downloadName', () => {
  it('replaces a .GED extension (any case) with -repaired.ged', () => {
    expect(downloadName('Family Tree.GED', 'repaired')).toBe('Family Tree-repaired.ged');
    expect(downloadName('tree.ged', 'repaired')).toBe('tree-repaired.ged');
  });

  it('names the reports after the file', () => {
    expect(downloadName('Family Tree.GED', 'report-txt')).toBe('Family Tree-report.txt');
    expect(downloadName('Family Tree.GED', 'report-csv')).toBe('Family Tree-report.csv');
  });

  it('adds .ged to a name with no extension', () => {
    expect(downloadName('Family Tree', 'repaired')).toBe('Family Tree-repaired.ged');
    expect(downloadName('Family Tree', 'report-txt')).toBe('Family Tree-report.txt');
  });

  it('replaces another extension', () => {
    expect(downloadName('export.txt', 'repaired')).toBe('export-repaired.ged');
  });

  it('keeps dots that are not an extension', () => {
    expect(downloadName('J. Smith', 'repaired')).toBe('J. Smith-repaired.ged');
    expect(downloadName('smith.v2.ged', 'repaired')).toBe('smith.v2-repaired.ged');
  });

  it('strips path separators', () => {
    const out = downloadName('../../etc/a\\b.ged', 'repaired');
    expect(out).not.toMatch(/[\/\\]/);
    expect(out).toBe('etcab-repaired.ged');
  });

  it('strips control characters', () => {
    expect(downloadName('tr\u0000ee\n\u001f\u007f.ged', 'repaired')).toBe('tree-repaired.ged');
  });

  it('falls back to a name when nothing is left', () => {
    expect(downloadName('', 'repaired')).toBe('family-tree-repaired.ged');
    expect(downloadName('/\\', 'report-csv')).toBe('family-tree-report.csv');
    expect(downloadName('.ged', 'repaired')).toBe('family-tree-repaired.ged');
  });
});
