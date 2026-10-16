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

  it('shows the bare xref for a role whose xref has no name', () => {
    const f = finding({ roles: { child: '@I99@' } });
    expect(fill('Check {child} first', f, names)).toBe('Check @I99@ first');
  });

  // Templates copied from the catalog (explain/catalog.go). The target of a
  // broken link is never in the file, so it has no name.
  it('ORPHANED_FAMC: names the person, shows the missing family as its xref', () => {
    const f = finding({ roles: { person: '@I1@', target: '@F9@' } });
    expect(fill("{person} is a child of a family that doesn't exist", f, names))
      .toBe("Mary Smith is a child of a family that doesn't exist");
    expect(fill("The file links {person} to family {target} as a child, but there's no such family in the file. The link is lost on import.", f, names))
      .toBe("The file links Mary Smith to family @F9@ as a child, but there's no such family in the file. The link is lost on import.");
  });

  it('ORPHANED_HUSB: names the family, shows the missing husband as its xref', () => {
    const f = finding({ roles: { family: '@F1@', target: '@I9@' } });
    expect(fill("Family {family} names {target} as husband, but there's no such person in the file.", f, names))
      .toBe("Family John Smith and Mary Smith names @I9@ as husband, but there's no such person in the file.");
  });

  it('ORPHANED_SOUR: shows the missing source as its xref', () => {
    const f = finding({ roles: { person: '@I2@', target: '@S9@' } });
    expect(fill("{person} cites source {target}, but there's no such source in the file. The citation is lost on import.", f, names))
      .toBe("John Smith cites source @S9@, but there's no such source in the file. The citation is lost on import.");
  });

  it('ORPHANED_NOTE on a family record (seen live): no person role, so the sentence opens with "Someone"', () => {
    // rolesFor sets person only when the record holding the pointer is a person;
    // a FAM with "1 NOTE @N9@" gives roles {family, target}.
    const f = finding({ roles: { target: '@N9@' } });
    expect(fill("{person} points to note {target}, but there's no such note in the file.", f, names))
      .toBe("Someone points to note @N9@, but there's no such note in the file.");
  });

  it('reads the marriage-type event tags as words', () => {
    const words = ['ANUL', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF'].map(event => fill('{event}', finding({ details: { event } }), names));
    expect(words).toEqual(['annulment', 'marriage banns', 'marriage contract', 'marriage licence', 'marriage settlement', 'divorce filing']);
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
