// A small GEDCOM tokeniser for the editor's highlighting. tokenizeLine() is
// pure (unit-tested); gedcomLanguage wraps it as a CodeMirror StreamLanguage
// and gedcomHighlighter gives each kind a stable class (gx-*), coloured by
// the editor's theme.

import { StreamLanguage } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';
import { Tag, tagHighlighter } from '@lezer/highlight';

export type TokenKind = 'space' | 'level' | 'xref' | 'tag' | 'custom' | 'unknown' | 'pointer' | 'value' | 'invalid';

export interface Token {
  kind: TokenKind;
  from: number;
  to: number;
  /** A part of a CONC or CONT line. */
  cont?: true;
}

// GEDCOM 5.5.1 tags, plus those GEDCOM 7.0 added.
const STANDARD = new Set((
  'ABBR ADDR ADR1 ADR2 ADR3 ADOP AFN AGE AGNC ALIA ANCE ANCI ANUL ASSO AUTH BAPL BAPM BARM BASM BIRT BLES BLOB ' +
  'BURI CALN CAST CAUS CENS CHAN CHAR CHIL CHR CHRA CITY CONC CONF CONL CONT COPR CORP CREM CTRY DATA DATE DEAT ' +
  'DESC DESI DEST DIV DIVF DSCR EDUC EMAIL EMIG ENDL ENGA EVEN FACT FAM FAMC FAMF FAMS FAX FCOM FILE FONE FORM ' +
  'GEDC GIVN GRAD HEAD HUSB IDNO IMMI INDI LANG LATI LONG MAP MARB MARC MARL MARR MARS MEDI NAME NATI NATU NCHI ' +
  'NICK NMR NOTE NPFX NSFX OBJE OCCU ORDI ORDN PAGE PEDI PHON PLAC POST PROB PROP PUBL QUAY REFN RELA RELI REPO ' +
  'RESI RESN RETI RFN RIN ROLE ROMN SEX SLGC SLGS SOUR SPFX SSN STAE STAT SUBM SUBN SURN TEMP TEXT TIME TITL ' +
  'TRLR TYPE VERS WIFE WILL WWW ' +
  'CREA CROP EXID HEIGHT INIL LEFT MIME NO PHRASE SCHMA SDATE SNOTE TAG TOP TRAN UID WIDTH'
).split(' '));

const XREF = /^@[^@#\s][^@\s]*@$/;
const POINTER = /^@[^@#\s][^@]*@$/;

const isSpace = (c: number) => c === 32 || c === 9;

/** The parts of one line, in order; the spaces between parts are not tokens. */
export function tokenizeLine(line: string): Token[] {
  const out: Token[] = [];
  const n = line.length;
  let i = 0;
  while (i < n && isSpace(line.charCodeAt(i))) i++;
  if (i > 0) out.push({ kind: 'space', from: 0, to: i });
  if (i === n) return out;

  // The level: digits, then a space or the end.
  const start = i;
  while (i < n && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) i++;
  if (i === start || (i < n && !isSpace(line.charCodeAt(i)))) {
    out.push({ kind: 'invalid', from: start, to: n });
    return out;
  }
  out.push({ kind: 'level', from: start, to: i });

  const word = (): [number, number] => {
    while (i < n && isSpace(line.charCodeAt(i))) i++;
    const s = i;
    while (i < n && !isSpace(line.charCodeAt(i))) i++;
    return [s, i];
  };

  let [ws, we] = word();
  if (ws === we) return out;
  if (line.charCodeAt(ws) === 64 /* @ */) {
    out.push({ kind: XREF.test(line.slice(ws, we)) ? 'xref' : 'invalid', from: ws, to: we });
    [ws, we] = word();
    if (ws === we) return out;
  }

  const tag = line.slice(ws, we);
  const cont = tag === 'CONC' || tag === 'CONT';
  const kind: TokenKind = STANDARD.has(tag) ? 'tag'
    : /^_[A-Za-z0-9_]+$/.test(tag) ? 'custom'
      : /^[A-Za-z0-9_]+$/.test(tag) ? 'unknown' : 'invalid';
  out.push(cont ? { kind, from: ws, to: we, cont } : { kind, from: ws, to: we });

  // One delimiter, then the value is the rest of the line.
  if (we >= n) return out;
  const vs = we + 1;
  if (vs >= n) return out;
  const value = line.slice(vs);
  const t: Token = { kind: POINTER.test(value) ? 'pointer' : 'value', from: vs, to: n };
  if (cont) t.cont = true;
  out.push(t);
  return out;
}

/** Where the cursor goes on a line: the start of its value, else the line end; 0 for a line that doesn't parse. */
export function valueStart(line: string): number {
  const t = tokenizeLine(line);
  if (t.some(x => x.kind === 'invalid' && x.from === (t[0].kind === 'space' ? t[0].to : 0))) return 0;
  const v = t.find(x => x.kind === 'value' || x.kind === 'pointer');
  return v ? v.from : line.length;
}

// ---------------------------------------------------------------- CodeMirror

const tags = {
  gxSpace: Tag.define(), gxLevel: Tag.define(), gxXref: Tag.define(), gxTag: Tag.define(), gxCustom: Tag.define(),
  gxUnknown: Tag.define(), gxPointer: Tag.define(), gxValue: Tag.define(), gxCont: Tag.define(), gxInvalid: Tag.define(),
};

const NAME: Record<TokenKind, string> = {
  space: 'gxSpace', level: 'gxLevel', xref: 'gxXref', tag: 'gxTag', custom: 'gxCustom', unknown: 'gxUnknown',
  pointer: 'gxPointer', value: 'gxValue', invalid: 'gxInvalid',
};

interface LineState { toks: Token[]; at: number }

export const gedcomLanguage = StreamLanguage.define<LineState>({
  name: 'gedcom',
  startState: () => ({ toks: [], at: 0 }),
  copyState: s => ({ toks: s.toks, at: s.at }),
  token(stream: StringStream, state: LineState): string | null {
    if (stream.sol()) {
      state.toks = tokenizeLine(stream.string);
      state.at = 0;
    }
    while (state.at < state.toks.length && state.toks[state.at].to <= stream.pos) state.at++;
    const t = state.toks[state.at];
    if (!t) { stream.skipToEnd(); return null; }
    if (stream.pos < t.from) { stream.pos = t.from; return null; }
    stream.pos = t.to;
    state.at++;
    return t.cont ? `${NAME[t.kind]} gxCont` : NAME[t.kind];
  },
  tokenTable: tags,
});

export const gedcomHighlighter = tagHighlighter([
  { tag: tags.gxSpace, class: 'gx-space' },
  { tag: tags.gxLevel, class: 'gx-level' },
  { tag: tags.gxXref, class: 'gx-xref' },
  { tag: tags.gxTag, class: 'gx-tag' },
  { tag: tags.gxCustom, class: 'gx-custom' },
  { tag: tags.gxUnknown, class: 'gx-unknown' },
  { tag: tags.gxPointer, class: 'gx-pointer' },
  { tag: tags.gxValue, class: 'gx-value' },
  { tag: tags.gxCont, class: 'gx-cont' },
  { tag: tags.gxInvalid, class: 'gx-invalid' },
]);
