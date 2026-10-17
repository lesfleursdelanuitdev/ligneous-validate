import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { gedcomHighlighter, gedcomLanguage, tokenizeLine, valueStart } from './gedcom';
import type { Token } from './gedcom';

/** The tokens of one line as [kind, text] pairs, with `+cont` on CONC/CONT parts. */
const toks = (line: string) => tokenizeLine(line).map((t: Token) => [t.kind + (t.cont ? '+cont' : ''), line.slice(t.from, t.to)]);

describe('the GEDCOM tokeniser', () => {
  it('splits a record line into level, xref and tag', () => {
    expect(toks('0 @I12@ INDI')).toEqual([['level', '0'], ['xref', '@I12@'], ['tag', 'INDI']]);
  });

  it('gives a value and a pointer value', () => {
    expect(toks('1 NAME Jane /Smith/')).toEqual([['level', '1'], ['tag', 'NAME'], ['value', 'Jane /Smith/']]);
    expect(toks('1 FAMC @F3@')).toEqual([['level', '1'], ['tag', 'FAMC'], ['pointer', '@F3@']]);
  });

  it('tells standard, custom and unknown tags apart', () => {
    expect(toks('1 _MILT yes')[1]).toEqual(['custom', '_MILT']);
    expect(toks('1 FOOB x')[1]).toEqual(['unknown', 'FOOB']);
    expect(toks('2 VERS 5.5.1')[1]).toEqual(['tag', 'VERS']);
    // GEDCOM 7 tags are standard too.
    expect(toks('1 EXID 123')[1]).toEqual(['tag', 'EXID']);
    expect(toks('1 SNOTE @N1@')[1]).toEqual(['tag', 'SNOTE']);
  });

  it('marks CONC and CONT lines as continuations', () => {
    expect(toks('2 CONT more text')).toEqual([['level', '2'], ['tag+cont', 'CONT'], ['value+cont', 'more text']]);
    expect(toks('2 CONC joined')).toEqual([['level', '2'], ['tag+cont', 'CONC'], ['value+cont', 'joined']]);
  });

  it('marks leading whitespace, spaces and tabs, as a problem', () => {
    expect(toks('  1 SEX M')).toEqual([['space', '  '], ['level', '1'], ['tag', 'SEX'], ['value', 'M']]);
    expect(toks('\t\t2 DATE 1900')[0]).toEqual(['space', '\t\t']);
  });

  it('accepts a tab between the parts, and keeps tabs inside a value', () => {
    expect(toks('1\tNAME\tAnn\tLee')).toEqual([['level', '1'], ['tag', 'NAME'], ['value', 'Ann\tLee']]);
  });

  it('marks a line with no level as invalid', () => {
    expect(toks('NAME Jane')).toEqual([['invalid', 'NAME Jane']]);
    expect(toks('  hello')).toEqual([['space', '  '], ['invalid', 'hello']]);
    expect(toks('1NAME Jane')).toEqual([['invalid', '1NAME Jane']]);
  });

  it('treats a lone @ as plain text, never a pointer or an xref', () => {
    expect(toks('1 NOTE @')).toEqual([['level', '1'], ['tag', 'NOTE'], ['value', '@']]);
    expect(toks('0 @ INDI')).toEqual([['level', '0'], ['invalid', '@'], ['tag', 'INDI']]);
    expect(toks('1 NOTE @@ is an at sign')[2]).toEqual(['value', '@@ is an at sign']);
    expect(toks('1 @')).toEqual([['level', '1'], ['invalid', '@']]);
  });

  it('does not take a date escape or text around a pointer for a pointer', () => {
    expect(toks('2 DATE @#DJULIAN@ 1700')[2]).toEqual(['value', '@#DJULIAN@ 1700']);
    expect(toks('1 NOTE see @I1@ too')[2]).toEqual(['value', 'see @I1@ too']);
  });

  it('copes with empty, level-only and odd tags', () => {
    expect(toks('')).toEqual([]);
    expect(toks('   ')).toEqual([['space', '   ']]);
    expect(toks('3')).toEqual([['level', '3']]);
    expect(toks('1 NA*ME x')[1]).toEqual(['invalid', 'NA*ME']);
  });

  it('finds where the value starts, or the line end when there is none', () => {
    expect(valueStart('1 NAME Jane /Smith/')).toBe(7);
    expect(valueStart('0 @I1@ INDI')).toBe(11);
    expect(valueStart('  1 SEX M')).toBe(8);
    expect(valueStart('garbage')).toBe(0);
  });
});

describe('the GEDCOM highlighting in an editor state', () => {
  it('gives each part its class', () => {
    const doc = '0 @I1@ INDI\n1 _UID abc\n1 FAMS @F1@\n  2 CONT x\n1 ZZZZ y\nbad line';
    const state = EditorState.create({ doc, extensions: [gedcomLanguage] });
    const tree = ensureSyntaxTree(state, doc.length, 5000)!;
    const out: string[] = [];
    highlightTree(tree, gedcomHighlighter, (from, to, cls) => out.push(`${doc.slice(from, to)}=${cls}`));
    expect(out).toEqual(expect.arrayContaining([
      '0=gx-level', '@I1@=gx-xref', 'INDI=gx-tag', '_UID=gx-custom', 'abc=gx-value', '@F1@=gx-pointer',
      '  =gx-space', 'ZZZZ=gx-unknown', 'bad line=gx-invalid',
    ]));
    expect(out.find(s => s.startsWith('CONT='))!.split('=')[1].split(' ').sort()).toEqual(['gx-cont', 'gx-tag']);
    expect(out.find(s => s.startsWith('x='))!.split('=')[1].split(' ').sort()).toEqual(['gx-cont', 'gx-value']);
  });
});
