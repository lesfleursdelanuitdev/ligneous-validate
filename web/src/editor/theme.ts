// The editor's CodeMirror theme. It lives in the shadow root's adopted style
// sheet; the colours are the page's tokens (custom properties inherit into
// the shadow root) plus the editor's own (--gx-*, in editor.css), each AA as
// text on the editor's background in light and dark.

import { EditorView } from '@codemirror/view';

const focus = { outline: '2px solid var(--accent)', outlineOffset: '2px', borderRadius: '4px' };
const control = {
  font: 'inherit', fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: '500', lineHeight: '1.3',
  color: 'var(--accent)', background: 'var(--card)', backgroundImage: 'none',
  border: '1px solid var(--dash)', borderRadius: '6px', padding: '6px 12px', minHeight: '36px', cursor: 'pointer',
};
const badge = {
  alignSelf: 'flex-start', padding: '2px 8px', borderRadius: '4px', fontFamily: 'var(--sans)',
  fontSize: '11px', fontWeight: '600', lineHeight: '1.35', letterSpacing: '0.5px', textTransform: 'uppercase',
};

export const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--gx-bg)', fontSize: '14px' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', overscrollBehavior: 'contain' },
  '.cm-content': { padding: '8px 0 40vh', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { backgroundColor: 'var(--tint)', color: 'var(--faint-strong)', borderRight: '1px solid var(--border-soft)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '4ch', fontVariantNumeric: 'tabular-nums' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--gx-active)', color: 'var(--text)' },
  '.cm-activeLine': { backgroundColor: 'var(--gx-active)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--gx-sel)' },
  '.cm-specialChar': { color: 'var(--error)' },
  '.cm-line.gx-flash': { backgroundColor: 'var(--hit)', boxShadow: 'inset 3px 0 0 var(--amber)' },

  // The GEDCOM parts (gedcom.ts).
  '.gx-level': { color: 'var(--gx-level)' },
  '.gx-xref': { color: 'var(--gx-xref)', fontWeight: '600' },
  '.gx-tag': { color: 'var(--gx-tag)', fontWeight: '500' },
  '.gx-custom': { color: 'var(--gx-custom)' },
  '.gx-unknown': { color: 'var(--gx-unknown)', textDecoration: 'underline dotted', textUnderlineOffset: '3px' },
  '.gx-pointer': { color: 'var(--gx-pointer)', textDecoration: 'underline', textDecorationThickness: '1px', textUnderlineOffset: '3px' },
  '.gx-value': { color: 'var(--text)' },
  '.gx-cont': { color: 'var(--gx-cont)', fontWeight: '400' },
  '.gx-invalid': { color: 'var(--error)', textDecoration: 'underline wavy', textDecorationThickness: '1px', textUnderlineOffset: '3px' },
  '.gx-space': { backgroundColor: 'var(--gx-space)', borderRadius: '2px' },

  // Lint markers: a filled circle for errors, a triangle for warnings, a ring for hints.
  '.cm-gutter-lint': { width: '22px' },
  '.cm-gutter-lint .cm-gutterElement': { padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-lint-marker': { content: 'normal', width: '10px', height: '10px', cursor: 'pointer', boxSizing: 'border-box' },
  '.cm-lint-marker-error': { backgroundColor: 'var(--error)', borderRadius: '50%' },
  '.cm-lint-marker-warning': { width: '12px', height: '11px', backgroundColor: 'var(--amber)', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' },
  '.cm-lint-marker-hint, .cm-lint-marker-info': { border: '2px solid var(--accent)', borderRadius: '50%' },
  '&.gx-stale .cm-lint-marker': { opacity: '0.45' },
  '.cm-lintRange': { backgroundImage: 'none', paddingBottom: '0' },
  '.cm-lintRange-error': { textDecoration: 'underline wavy var(--error)', textDecorationThickness: '1px', textUnderlineOffset: '4px', textDecorationSkipInk: 'none' },
  '.cm-lintRange-warning': { textDecoration: 'underline dotted var(--amber)', textDecorationThickness: '1.5px', textUnderlineOffset: '4px', textDecorationSkipInk: 'none' },
  '.cm-lintPoint:after': { borderBottomColor: 'var(--amber)' },

  // Tooltips: the finding as on its card.
  '.cm-tooltip': {
    backgroundColor: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px',
    boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.14)', fontFamily: 'var(--sans)',
  },
  '.cm-tooltip-lint': { maxWidth: 'min(420px, calc(100vw - 32px))', padding: '4px 0' },
  '.cm-tooltip-lint ul': { margin: '0', padding: '0' },
  '.cm-diagnostic': { padding: '10px 14px', marginLeft: '0', borderLeft: '3px solid var(--accent)', whiteSpace: 'normal' },
  '.cm-diagnostic + .cm-diagnostic': { borderTop: '1px solid var(--border-soft)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--amber)' },
  '.cm-diagnosticText': { display: 'block' },
  '.gx-msg': { display: 'flex', flexDirection: 'column', gap: '4px' },
  '.gx-sev': badge,
  '.gx-sev.error': { background: 'var(--error-tint)', color: 'var(--error)' },
  '.gx-sev.warning': { background: 'var(--amber-tint)', color: 'var(--amber)' },
  '.gx-sev.hint': { background: 'var(--hint-tint)', color: 'var(--accent)' },
  '.gx-title': { fontSize: '14px', fontWeight: '500', lineHeight: '1.45', overflowWrap: 'anywhere' },
  '.gx-meaning': { fontSize: '13px', fontWeight: '300', lineHeight: '1.55', color: 'var(--muted)', overflowWrap: 'anywhere' },
  '.gx-msg code': { fontFamily: 'var(--mono)', fontSize: '0.9em', background: 'var(--tint)', padding: '0.05em 0.3em', borderRadius: '4px' },
  '.gx-stalenote': { fontSize: '12px', fontStyle: 'italic', color: 'var(--light)' },
  '.cm-diagnosticAction': { ...control, marginTop: '8px', marginLeft: '0' },
  '.cm-diagnosticAction:focus-visible': focus,

  // CodeMirror's search panel, in the page's look.
  '.cm-panels': { backgroundColor: 'var(--tint)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-search': {
    position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px',
    padding: '8px 52px 8px 12px', fontFamily: 'var(--sans)', fontSize: '13px',
  },
  '.cm-search br': { flexBasis: '100%', content: '""', height: '0' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', minHeight: '36px', fontSize: '13px', color: 'var(--muted)' },
  '.cm-textfield': {
    fontFamily: 'var(--mono)', fontSize: '14px', color: 'var(--text)', background: 'var(--card)',
    border: '1px solid var(--dash)', borderRadius: '6px', padding: '6px 8px', minHeight: '36px', margin: '0',
  },
  '.cm-button': { ...control, margin: '0' },
  '.cm-button:active': { backgroundImage: 'none' },
  '.cm-search [name=close]': {
    position: 'absolute', top: '6px', right: '8px', width: '36px', height: '36px', padding: '0',
    fontSize: '22px', lineHeight: '1', color: 'var(--muted)', background: 'none', border: '0', borderRadius: '6px', cursor: 'pointer',
  },
  '.cm-button:focus-visible, .cm-textfield:focus-visible, .cm-search [name=close]:focus-visible, .cm-search input[type=checkbox]:focus-visible': focus,
  '.cm-searchMatch': { backgroundColor: 'var(--hit)', outline: '1px solid var(--amber)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--gx-sel)' },

  // Touch screens: bigger text and targets.
  '@media (pointer: coarse)': {
    '.cm-scroller': { fontSize: '15px' },
    '.cm-textfield': { fontSize: '16px', minHeight: '44px' },
    '.cm-button, .cm-diagnosticAction': { minHeight: '44px' },
    '.cm-search label': { minHeight: '44px' },
    '.cm-search [name=close]': { width: '44px', height: '44px', top: '8px' },
    '.cm-gutter-lint': { width: '28px' },
  },
});
