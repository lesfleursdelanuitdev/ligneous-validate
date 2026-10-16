import type { Finding, Role } from './types';

const ROLES = new Set<string>(['person', 'child', 'father', 'mother', 'family', 'target']);

// GEDCOM event tags read as words in "{person}'s {event} date".
const EVENTS: Record<string, string> = {
  BIRT: 'birth', DEAT: 'death', CHR: 'christening', BAPM: 'baptism', BURI: 'burial',
  CREM: 'cremation', MARR: 'marriage', DIV: 'divorce', ENGA: 'engagement', ADOP: 'adoption',
  RESI: 'residence', CENS: 'census', EMIG: 'emigration', IMMI: 'immigration', NATU: 'naturalisation',
  PROB: 'probate', WILL: 'will', GRAD: 'graduation', RETI: 'retirement', EVEN: 'event',
};

const numbers = new Intl.NumberFormat('en-US');

function value(key: string, f: Finding, names: Record<string, string>): string {
  if (ROLES.has(key)) {
    const xref = f.roles[key as Role] ?? f.details[key];
    return (xref !== undefined ? names[xref] : undefined) || 'someone';
  }
  const v = f.details[key] ?? '';
  return key === 'event' ? EVENTS[v] ?? v : v;
}

/**
 * Fills {role} placeholders with names and {key} placeholders with the
 * finding's details. A detail that is missing disappears together with one
 * of the spaces around it, so no "{…}" and no double space is left.
 */
export function fill(template: string, f: Finding, names: Record<string, string>): string {
  const out = template.replace(/( ?)\{(\w+)\}( ?)/g, (_m, pre: string, key: string, post: string) => {
    const v = value(key, f, names);
    if (v !== '') return pre + v + post;
    return pre && post ? ' ' : '';
  });
  // "someone" may open a sentence.
  return out.replace(/(^|[.!?] )someone/g, (_m, lead: string) => lead + 'Someone');
}

/** "Line 1,204". */
export function fillLine(n: number): string {
  return 'Line ' + numbers.format(n);
}
