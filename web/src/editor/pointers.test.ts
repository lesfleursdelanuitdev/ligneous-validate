import { describe, expect, it } from 'vitest';
import { pointerAt, recordLine } from './pointers';

describe('pointers', () => {
  it('finds the pointer under a column', () => {
    const line = '1 FAMC @F12@';
    expect(pointerAt(line, 7)).toBe('@F12@');
    expect(pointerAt(line, 10)).toBe('@F12@');
    expect(pointerAt(line, 12)).toBe('@F12@'); // just after the closing @
    expect(pointerAt(line, 3)).toBeNull(); // the tag
  });

  it('does not treat a record id, a lone @ or text as a pointer', () => {
    expect(pointerAt('0 @I1@ INDI', 3)).toBeNull();
    expect(pointerAt('1 NOTE @', 7)).toBeNull();
    expect(pointerAt('1 NOTE see @I1@', 12)).toBeNull();
  });
});

describe('the record a pointer points to', () => {
  const lines = ['0 HEAD', '1 SUBM @U1@', '0 @U1@ SUBM', '0 @I1@ INDI', '1 FAMS @F1@', '  0 @F1@ FAM', '1 HUSB @I1@', '0 TRLR'];

  it('gives the line of its level-0 record', () => {
    expect(recordLine(lines, '@I1@')).toBe(4);
    expect(recordLine(lines, '@U1@')).toBe(3);
  });

  it('finds a record line even with leading whitespace', () => {
    expect(recordLine(lines, '@F1@')).toBe(6);
  });

  it('gives 0 when there is no such record, ignoring pointers on other lines', () => {
    expect(recordLine(lines, '@I9@')).toBe(0);
    expect(recordLine(['1 HUSB @I1@'], '@I1@')).toBe(0);
  });

  it('matches the id exactly, not a prefix', () => {
    expect(recordLine(['0 @I10@ INDI', '0 @I1@ INDI'], '@I1@')).toBe(2);
  });
});
