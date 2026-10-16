import { describe, expect, it } from 'vitest';
import { fill, fillLine } from './fill';
import type { Finding } from './types';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    code: 'X', severity: 'warning', group: 'dates', title: '', meaning: '', howToFix: '',
    line: 1, details: {}, xrefs: [], roles: {}, ...over,
  };
}

const names = { '@I1@': 'Mary Smith', '@I2@': 'John Smith', '@F1@': 'John Smith and Mary Smith' };

describe('fill', () => {
  it('fills a role with the person’s name', () => {
    const f = finding({ roles: { person: '@I1@' } });
    expect(fill('{person} died before they were born', f, names)).toBe('Mary Smith died before they were born');
  });

  it('fills a detail key', () => {
    const f = finding({ details: { age: '5' } });
    expect(fill('married at {age}', f, names)).toBe('married at 5');
  });

  it('says "someone" for a role with no xref', () => {
    expect(fill('Born to {mother} in 1850', finding(), names)).toBe('Born to someone in 1850');
  });

  it('capitalises "someone" at the start of a sentence', () => {
    const f = finding({ details: { event: 'MARR', date: '20 JUL' } });
    expect(fill('{person}’s {event} date reads "{date}".', f, names)).toBe('Someone’s marriage date reads "20 JUL".');
  });

  it('says "someone" for a role whose xref has no name', () => {
    const f = finding({ roles: { child: '@I99@' } });
    expect(fill('Check {child} first', f, names)).toBe('Check someone first');
  });

  it('drops a missing detail key and the extra space, leaving no braces', () => {
    const out = fill('The marriage in {marriage_year} is before the birth.', finding(), names);
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe('The marriage in is before the birth.');
  });

  it('drops a missing key at the start or end without stray spaces', () => {
    expect(fill('{nope} starts here', finding(), names)).toBe('starts here');
    expect(fill('ends here {nope}', finding(), names)).toBe('ends here');
  });

  it('fills two placeholders in one string', () => {
    const f = finding({ roles: { father: '@I2@', child: '@I1@' }, details: { age: '2' } });
    expect(fill('{father} was {age} when {child} was born', f, names)).toBe('John Smith was 2 when Mary Smith was born');
  });

  it('turns event tags into words', () => {
    const f = finding({ roles: { person: '@I1@' }, details: { event: 'BIRT', date: '1815/1816' } });
    expect(fill('{person}’s {event} date reads "{date}".', f, names)).toBe('Mary Smith’s birth date reads "1815/1816".');
  });

  it('keeps an unknown event tag as it is', () => {
    const f = finding({ details: { event: '_MILT' } });
    expect(fill('{event}', f, names)).toBe('_MILT');
  });
});

describe('fillLine', () => {
  it('groups thousands', () => {
    expect(fillLine(1204)).toBe('Line 1,204');
    expect(fillLine(7)).toBe('Line 7');
    expect(fillLine(1234567)).toBe('Line 1,234,567');
  });
});
