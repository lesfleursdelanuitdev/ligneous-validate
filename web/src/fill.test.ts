import { describe, expect, it } from 'vitest';
import { fill, fillLine, fillParts, pageText } from './fill';
import type { Finding } from './types';
import catalogText from './testdata/catalog.json?raw';

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

  it('ORPHANED_NOTE on a record that is neither a person nor a family: no person role, so the sentence opens with "Someone"', () => {
    // The Go side sets person to the person (or, for a family, to the family).
    // A broken "1 NOTE @N9@" on a SOUR record has neither, so roles is {target}.
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

describe('fillParts', () => {
  it('marks the names from the file, so the page can keep translators off them', () => {
    const f = finding({ roles: { father: '@I2@', child: '@I1@' }, details: { age: '2' } });
    expect(fillParts('{father} was {age} when {child} was born', f, names)).toEqual([
      { text: 'John Smith', name: true },
      { text: ' was 2 when ', name: false },
      { text: 'Mary Smith', name: true },
      { text: ' was born', name: false },
    ]);
  });
  it('marks a bare xref as a name, but not "someone"', () => {
    expect(fillParts('{person} points to {target}', finding({ roles: { target: '@N9@' } }), names)).toEqual([
      { text: 'Someone points to ', name: false },
      { text: '@N9@', name: true },
    ]);
  });
  it('joins to what fill() gives', () => {
    const f = finding({ roles: { person: '@I1@' }, details: { event: 'MARR', date: '20 JUL' } });
    const t = '{person}’s {event} date reads "{date}". {mother} too.';
    expect(fillParts(t, f, names).map(p => p.text).join('')).toBe(fill(t, f, names));
    expect(fill(t, f, names)).toBe('Mary Smith’s marriage date reads "20 JUL". Someone too.');
  });
});

describe('pageText', () => {
  it('says "on this page" where the catalog says the repaired file is "below"', () => {
    expect(pageText('Download the repaired file below, which is converted to UTF-8. Or, when you export from your program, pick "UTF-8" as the character set.'))
      .toBe('Download the repaired file on this page, which is converted to UTF-8. Or, when you export from your program, pick "UTF-8" as the character set.');
    expect(pageText('Download the repaired file below. Its header matches its contents.'))
      .toBe('Download the repaired file on this page. Its header matches its contents.');
    expect(pageText('Download the repaired file below, which says UTF-8 in its header.'))
      .toBe('Download the repaired file on this page, which says UTF-8 in its header.');
  });
  it('leaves every other text alone, including other uses of "below"', () => {
    const t = 'This line is nested two or more levels below the line above it. Programs may attach it to the wrong thing or drop it.';
    expect(pageText(t)).toBe(t);
  });
  it('covers every catalog text that sends the reader to the repaired file', () => {
    const catalog = JSON.parse(catalogText) as Record<string, string>[];
    for (const e of catalog) for (const k of ['Title', 'Meaning', 'HowToFix']) {
      expect(pageText(e[k]), `${e.Code} ${k}`).not.toMatch(/repaired file below/);
    }
  });
});
