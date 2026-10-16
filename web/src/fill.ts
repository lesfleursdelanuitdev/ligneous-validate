import type { Finding, Role } from './types';

const ROLES = new Set<string>(['person', 'child', 'father', 'mother', 'family', 'target']);

// GEDCOM event tags read as words in "{person}'s {event} date".
const EVENTS: Record<string, string> = {
  BIRT: 'birth', DEAT: 'death', CHR: 'christening', BAPM: 'baptism', BURI: 'burial',
  CREM: 'cremation', MARR: 'marriage', DIV: 'divorce', ENGA: 'engagement', ADOP: 'adoption',
  RESI: 'residence', CENS: 'census', EMIG: 'emigration', IMMI: 'immigration', NATU: 'naturalisation',
  PROB: 'probate', WILL: 'will', GRAD: 'graduation', RETI: 'retirement', EVEN: 'event',
  ANUL: 'annulment', MARB: 'marriage banns', MARC: 'marriage contract', MARL: 'marriage licence',
  MARS: 'marriage settlement', DIVF: 'divorce filing',
};

const numbers = new Intl.NumberFormat('en-US');

function value(key: string, f: Finding, names: Record<string, string>): string {
  if (ROLES.has(key)) {
    // No name (e.g. the missing target of a broken link): the bare xref.
    // "someone" only when the finding has no xref for the role at all.
    const xref = f.roles[key as Role] || f.details[key];
    return xref ? names[xref] || xref : 'someone';
  }
  const v = f.details[key] ?? '';
  return key === 'event' ? EVENTS[v] ?? v : v;
}

/** A piece of filled text; `name` marks a value taken from the file (a name or an xref). */
export interface FillPart {
  text: string;
  name: boolean;
}

/**
 * Fills {role} placeholders with names (or the bare xref when it has no
 * name) and {key} placeholders with the finding's details. A detail that is
 * missing disappears together with one of the spaces around it, so no "{…}"
 * and no double space is left. Names come back as their own parts, so the
 * page can mark them translate="no".
 */
export function fillParts(template: string, f: Finding, names: Record<string, string>): FillPart[] {
  const parts: FillPart[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = parts[parts.length - 1];
    if (last && !last.name) last.text += t;
    else parts.push({ text: t, name: false });
  };
  const re = /( ?)\{(\w+)\}( ?)/g;
  let at = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    const [whole, pre, key, post] = m;
    text(template.slice(at, m.index));
    at = m.index + whole.length;
    const isName = ROLES.has(key) && !!(f.roles[key as Role] || f.details[key]);
    const v = value(key, f, names);
    if (v === '') {
      text(pre && post ? ' ' : '');
    } else if (isName) {
      text(pre);
      parts.push({ text: v, name: true });
      text(post);
    } else {
      text(pre + v + post);
    }
  }
  text(template.slice(at));
  // "someone" may open a sentence: "{person} points to note …" when the
  // record holding the pointer isn't a person.
  parts.forEach((p, i) => {
    if (!p.name) p.text = p.text.replace(i === 0 ? /(^|[.!?] )someone/g : /([.!?] )someone/g, (_m, lead: string) => lead + 'Someone');
  });
  return parts;
}

/** fillParts() as one plain string, for the text and CSV reports. */
export function fill(template: string, f: Finding, names: Record<string, string>): string {
  return fillParts(template, f, names).map(p => p.text).join('');
}

// The page shows the repaired file's button on the same page, not "below" it.
// Exact catalog strings only; the library's wording stays as it is.
const ON_THIS_PAGE: Record<string, string> = {
  'Download the repaired file below, which is converted to UTF-8. Or, when you export from your program, pick "UTF-8" as the character set.':
    'Download the repaired file on this page, which is converted to UTF-8. Or, when you export from your program, pick "UTF-8" as the character set.',
  'Download the repaired file below. Its header matches its contents.':
    'Download the repaired file on this page. Its header matches its contents.',
  'Download the repaired file below, which says UTF-8 in its header.':
    'Download the repaired file on this page, which says UTF-8 in its header.',
};

/** Catalog text as the page words it. */
export function pageText(s: string): string {
  return ON_THIS_PAGE[s] ?? s;
}

// Generic words for roles, for a line that counts many findings of one code.
const GENERIC: Record<Role, string> = {
  person: 'someone', child: 'a child', father: 'a father', mother: 'a mother', family: 'a family', target: 'a record',
};

/**
 * A title with its roles in generic words ("someone", "a child") and no
 * details, or null when a detail is part of the sentence ("{person} married
 * at {age}"), which can't be dropped without leaving it broken. A detail in
 * brackets at the end is dropped with its brackets.
 */
export function genericTitle(title: string): string | null {
  let t = title.replace(/ \(\{\w+\}\)/g, '');
  t = t.replace(/\{(\w+)\}/g, (m, key: string) => (ROLES.has(key) ? GENERIC[key as Role] : m));
  if (/\{\w+\}/.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Line 1,204". */
export function fillLine(n: number): string {
  return 'Line ' + numbers.format(n);
}
