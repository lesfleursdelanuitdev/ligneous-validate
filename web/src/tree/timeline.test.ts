import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { readEnriched } from './tables';
import { timelineFor, timelineSource } from './timeline';
import type { TimelineEvent } from './timeline';
import timelineJSON from '../testdata/tree/timeline.json';
import famAdopJSON from '../testdata/tree/families-adop-event.json';
import famBirthFirstJSON from '../testdata/tree/families-birth-first.json';

const enriched = readEnriched(timelineJSON);
const tree = buildGraph(enriched, { thisYear: 2026 });
const source = timelineSource(enriched, tree);
const show = { hideLiving: false };
/** One line per event: what a vertical timeline shows, and what it links to. */
const lines = (events: TimelineEvent[]) => events.map(e =>
  [e.year ?? '-', e.context ? `(${e.relation} ${e.personId})` : '', e.label, e.date, e.place, e.value,
    e.personId && !e.context ? `with ${e.personId}` : ''].filter(Boolean).join(' | '));

describe('the life-events timeline (T40)', () => {
  it('a long life: own events in date order, with residence, occupation and family context', () => {
    expect(lines(timelineFor('@I1@', source, show))).toEqual([
      '1850 | Birth | 3 MAR 1850 | York, Yorkshire, England',
      '1850 | Christening | 10 MAR 1850 | York, Yorkshire, England',
      '1870 | (parent @I7@) | Death | 1870',
      '1871 | Residence | 1871 | Leeds, Yorkshire, England | 4 Mill Lane',
      '1871 | Occupation | 1871 | Weaver',
      '1872 | Marriage | 1872 | Leeds, Yorkshire, England | with @I2@',
      '1875 | (child @I4@) | Birth | 1875 | Leeds, Yorkshire, England',
      '1878 | Divorce | 1878 | with @I2@',
      '1880 | (partner @I2@) | Death | 1880',
      '1881 | Residence | 1881 | Bradford, Yorkshire, England',
      '1882 | Marriage | 1882 | Bradford, Yorkshire, England | with @I3@',
      '1883 | Residence | 1883 | Bradford, Yorkshire, England | with @I3@',
      '1885 | (child @I5@) | Birth | 1885',
      '1890 | Occupation | ABT 1890 | Mill manager',
      '1895 | Letter to the editor | 1895',
      '1930 | Death | 12 DEC 1930 | Bradford, Yorkshire, England',
      '1930 | Burial | 16 DEC 1930',
      // Undated, last: their own first, in file order, then the family's.
      '- | Education | Grammar school',
      '- | (parent @I8@) | Death | Y',
    ]);
  });

  it('gives each event its type, its family and whether it is context', () => {
    const [birth, , fatherDeath] = timelineFor('@I1@', source, show);
    expect(birth).toEqual({
      type: 'BIRT', label: 'Birth', date: '3 MAR 1850', year: 1850, place: 'York, Yorkshire, England', value: '', context: false,
    });
    expect(fatherDeath).toEqual({
      type: 'DEAT', label: 'Death', date: '1870', year: 1870, place: '', value: '', context: true,
      relation: 'parent', personId: '@I7@', familyId: '@F0@',
    });
    const marriage = timelineFor('@I1@', source, show).find(e => e.type === 'MARR' && e.personId === '@I3@');
    expect(marriage).toMatchObject({ context: false, relation: 'partner', familyId: '@F2@' });
  });

  it('a person with two partners: each family\'s events, with the right partner, in date order', () => {
    const fam = timelineFor('@I1@', source, show).filter(e => !e.context && e.familyId);
    expect(fam.map(e => `${e.type} ${e.year} ${e.personId}`)).toEqual([
      'MARR 1872 @I2@', 'DIV 1878 @I2@', 'MARR 1882 @I3@', 'RESI 1883 @I3@',
    ]);
    // A partner sees the shared family events from their side.
    expect(lines(timelineFor('@I2@', source, show))).toEqual([
      '1852 | Birth | 1852',
      '1872 | Marriage | 1872 | Leeds, Yorkshire, England | with @I1@',
      '1875 | (child @I4@) | Birth | 1875 | Leeds, Yorkshire, England',
      '1878 | Divorce | 1878 | with @I1@',
      '1880 | Death | 1880',
      '1930 | (partner @I1@) | Death | 12 DEC 1930 | Bradford, Yorkshire, England',
    ]);
  });

  it('undated events come last, in file order', () => {
    const events = timelineFor('@I1@', source, show);
    const undated = events.findIndex(e => e.year === null);
    expect(events.slice(undated).every(e => e.year === null)).toBe(true);
    expect(events.slice(0, undated).every(e => e.year !== null)).toBe(true);
  });

  it('a living person: nothing under Hide living people, everything otherwise', () => {
    expect(tree.graph.people.find(p => p.id === '@I9@')?.isLiving).toBe(true);
    expect(timelineFor('@I9@', source, { hideLiving: true })).toEqual([]);
    expect(lines(timelineFor('@I9@', source, show))).toEqual([
      '1990 | Birth | 1990',
      '2010 | (parent @I12@) | Death | 2010',
      '2012 | Occupation | 2012 | Nurse',
      '2015 | Marriage | 2015 | with @I10@',
    ]);
  });

  it('under Hide living people, a dead person\'s context leaves out living relatives', () => {
    expect(lines(timelineFor('@I12@', source, show))).toEqual([
      '1930 | Birth | 1930',
      '1990 | (child @I9@) | Birth | 1990',
      '2010 | Death | 2010',
    ]);
    expect(lines(timelineFor('@I12@', source, { hideLiving: true }))).toEqual([
      '1930 | Birth | 1930',
      '2010 | Death | 2010',
    ]);
  });

  it('nobody, or a placeholder partner: no events', () => {
    expect(timelineFor('@I404@', source, show)).toEqual([]);
    expect(timelineFor('@F4@:unknown-husb', source, show)).toEqual([]);
  });
});

describe('adoption in the timeline (T47, T48)', () => {
  const sourceOf = (json: unknown) => {
    const e = readEnriched(json);
    return timelineSource(e, buildGraph(e, { thisYear: 2026 }));
  };

  it('an ADOP event says who adopted: the adoptive family\'s parents', () => {
    const adop = timelineFor('@Tobias@', sourceOf(famAdopJSON), show).find(e => e.type === 'ADOP');
    expect(adop).toEqual({
      type: 'ADOP', label: 'Adoption', date: '1953', year: 1953, place: '', value: '', context: false,
      relation: 'parent', personIds: ['@Arthur@', '@Maud@'], familyId: '@FA@',
    });
    expect(timelineFor('@Lena@', sourceOf(famAdopJSON), show).find(e => e.type === 'ADOP')?.personIds).toEqual(['@Simon@', '@Vera@']);
  });

  it('only PEDI says adopted: an undated context line, last', () => {
    const events = timelineFor('@Tobias@', sourceOf(famBirthFirstJSON), show);
    expect(events.at(-1)).toEqual({
      type: 'ADOP', label: 'Adoption', date: '', year: null, place: '', value: '', context: true,
      relation: 'parent', personIds: ['@Arthur@', '@Maud@'], familyId: '@FA@',
    });
    expect(events.filter(e => e.type === 'ADOP')).toHaveLength(1);
  });

  it('a birth family is never an adoption', () => {
    expect(timelineFor('@Cora@', sourceOf(famBirthFirstJSON), show).some(e => e.type === 'ADOP')).toBe(false);
  });
});
