// The GEDCOM editor (docs/editor-spec.md). Loaded with import() the first
// time it opens, so the page itself stays small. It is a full-screen modal
// <dialog>; CodeMirror sits in a shadow root inside it, because there its
// styles go into an adopted (constructable) style sheet, which the page's
// CSP (style-src 'self') allows. On the document it would add a <style>
// element, which the CSP blocks.
//
// The editor keeps the text as it was last checked plus the edits made
// since, and maps each finding's line through them (markers.ts).

import { ChangeSet, Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import {
  Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap,
  lineNumbers,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { closeSearchPanel, openSearchPanel, search, searchKeymap, searchPanelOpen } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { fill } from '../fill';
import { filled, formatNumber, icon, severityWord } from '../render';
import type { Finding, Result } from '../types';
import { gedcomHighlighter, gedcomLanguage, tokenizeLine, valueStart } from './gedcom';
import { MARKER_CAP, lineBreakOf, mapLine, navOrder, stepTo, toDiagnosticSeverity, toEditorLines, windowed, editorLineMap } from './markers';
import { recordLine } from './pointers';
import { editorTheme } from './theme';
import './editor.css';

export const CLOSE_PROMPT = 'Close the editor? Your edits stay here until you download them or check another file.';
export const SAVE_NOTE = 'Your edited file is saved as UTF-8, and its header says so. Line endings are made consistent.';
export const STALE_NOTE = 'Markers may be out of date. Check again to update them.';
const SAVE_FAILED = "We couldn't save the edited file. Check it again to see what's wrong.";
const noRecord = (x: string) => `There's no record ${x} in this file.`;

/** What the page does for the editor (main.ts). */
export interface EditorHost {
  /** Check the edited text: the same worker pipeline as a chosen file. The progress bar goes in `barSlot`. */
  checkAgain(text: string, barSlot: HTMLElement): void;
  /** Save the text as the edited file; resolves false when it couldn't be made. */
  download(text: string): Promise<boolean>;
  /** The editor closed. `line` and `code` say which card to go back to (line in the last check). */
  closed(opener: HTMLElement | null, line: number, code: string | undefined): void;
  /** Whether there are edits since the last check (Check again, or the file as chosen); called when it changes. */
  edits?(since: boolean): void;
}

export interface Editor {
  /** Opens at `line` of the last-checked text (0: line 1). `result` starts a session (null: reopen it). A new file means reset() first. */
  open(fileName: string, result: Result | null, line: number, opener: HTMLElement, code?: string): void;
  /** Drops the session (another file was chosen). */
  reset(): void;
  /** A Check again result in the editor's line numbers (call before showing it; others pass through). */
  prepare(result: Result): Result;
  /** prepare()'s move from a line of the checked text to the editor's, for anything else in those lines (call before prepare). */
  lineMapper(result: Result): (line: number) => number;
  /** A Check again has ended: its (prepared) result, or null when it failed or was stopped, with the status text. */
  checkDone(result: Result | null, text: string): void;
  readonly isOpen: boolean;
  /** There are edits that haven't been downloaded. */
  readonly dirty: boolean;
  /** An editor session exists (closed or open). */
  readonly active: boolean;
}

// ---------------------------------------------------------------- DOM helpers

type Kid = Node | string | null | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

const ICONS = {
  prev: 'M8.75 3.5 5.25 7l3.5 3.5',
  next: 'M5.25 3.5 8.75 7l-3.5 3.5',
  close: 'M3.5 3.5l7 7M10.5 3.5l-7 7',
  find: 'M6 10.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5ZM9.1 9.1l3.15 3.15',
  check: 'M2.75 7.25 5.5 10l5.75-6',
  save: 'M7 1.5v7.5M3.75 5.75 7 9l3.25-3.25M2 12.25h10',
};

/** A button with an icon and a label; `short` hides the label on narrow screens (it stays the name). */
function button(id: string, label: string, ico: keyof typeof ICONS, cls = 'more', short = false): HTMLButtonElement {
  return el('button', { type: 'button', id, class: `${cls} ed-btn` }, icon('0 0 14 14', ICONS[ico]),
    el('span', { class: short ? 'lbl short' : 'lbl' }, label));
}

// ---------------------------------------------------------------- CodeMirror pieces

const flashEffect = StateEffect.define<number | null>();
const flashLine = Decoration.line({ class: 'gx-flash' });
/** The briefly highlighted line, set by flashEffect(position) and cleared by flashEffect(null). */
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) deco = e.value === null ? Decoration.none : Decoration.set([flashLine.range(tr.state.doc.lineAt(e.value).from)]);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

/** Where a check's markers come from: the checked text, and the edits made since. */
interface Basis {
  findings: Finding[];
  names: Record<string, string>;
  order: number[];
  checked: Text;
  since: ChangeSet;
}

interface Session {
  name: string;
  view: EditorView;
  basis: Basis;
  /** The text sent to a running Check again, and the edits made since it was sent. */
  pending: { doc: Text; since: ChangeSet } | null;
  /** Edits since the file was opened or last downloaded. */
  dirty: boolean;
  saved: boolean;
  stale: boolean;
  lineBreak: string;
  /** The index (in basis.order) of the finding stepped to, or -1. */
  current: number;
  /** Cached positions of each finding in basis.order, for Next / Previous. */
  positions: (number | null)[] | null;
  /** The marked window, in checked lines, when not every finding is marked. */
  window: { first: number; last: number } | null;
  /** Where the editor was opened from, as a position in the text. */
  openerPos: number;
  opener: HTMLElement | null;
  openerCode?: string;
}

export function createEditor(hostApi: EditorHost): Editor {
  // ------------------------------------------------------------ the dialog
  const name = el('span', { id: 'ed-name', translate: 'no' });
  const edited = el('span', { id: 'ed-edited', class: 'ed-edited', hidden: '' }, ' · edited');
  const prev = button('ed-prev', 'Previous problem', 'prev', 'more', true);
  const next = button('ed-next', 'Next problem', 'next', 'more', true);
  const count = el('span', { id: 'ed-count', class: 'ed-count' });
  const checkBtn = button('ed-check', 'Check again', 'check');
  const saveBtn = button('ed-save', 'Download edited file', 'save', 'primary');
  const closeBtn = button('ed-close', 'Close', 'close', 'more', true);
  const barSlot = el('div', { class: 'ed-barslot' });
  const stale = el('span', { id: 'ed-stale', hidden: '' }, STALE_NOTE);
  const saveNote = el('span', { id: 'ed-savenote' }, SAVE_NOTE);
  const notes = el('p', { class: 'ed-notes' }, stale, saveNote);
  const hostEl = el('div', { class: 'ed-host' });
  const posText = el('span', { id: 'ed-pos', class: 'ed-pos' });
  const findBtn = button('ed-find', 'Find and replace', 'find');
  const wrapBox = el('input', { type: 'checkbox', id: 'ed-wrapbox' });
  const wrapLabel = el('label', { class: 'ed-wrap', for: 'ed-wrapbox' }, wrapBox, el('span', { class: 'box', 'aria-hidden': 'true' }), 'Wrap lines');
  // Seen as well as heard: "There's no record …", "Checked: …", the finding stepped to.
  const live = el('p', { id: 'ed-live', class: 'ed-msg', role: 'status', 'aria-live': 'polite' });
  const dialog = el('dialog', { id: 'editor', class: 'editor', 'aria-modal': 'true', 'aria-labelledby': 'ed-name' },
    el('div', { class: 'ed-bar' },
      el('div', { class: 'ed-row' },
        el('h2', { class: 'ed-file' }, name, edited),
        el('div', { class: 'ed-nav' }, prev, count, next),
        el('div', { class: 'ed-actions' }, checkBtn, saveBtn, closeBtn)),
      barSlot, notes),
    hostEl,
    el('div', { class: 'ed-status' }, posText, live, el('span', { class: 'ed-tools' }, findBtn, wrapLabel)));
  document.body.append(dialog);
  const shadow = hostEl.attachShadow({ mode: 'open' });
  // The lint gutter's tooltip closes on a window mousemove whose target isn't
  // inside it. Seen from the window, a target in the shadow root is the host,
  // so moving onto the tooltip (to click Go to record) would close it. Those
  // moves stop here, before they reach that listener.
  window.addEventListener('mousemove', e => {
    if (e.composedPath().some(n => n instanceof Element && n.classList.contains('cm-tooltip-lint'))) e.stopPropagation();
  }, true);

  const wrapping = new Compartment();
  const labels = new Compartment();
  const staleAttr = new Compartment();

  let s: Session | null = null;
  let checking = false;
  let saving = false;
  let markTimer = 0;

  const say = (text: string) => {
    // Cleared first, so the same text twice is announced twice.
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  };

  // ------------------------------------------------------------ markers

  /** The diagnostic for finding `i`, at its line now; null when the line has gone. */
  const diagnostic = (b: Basis, doc: Text, i: number): Diagnostic | null => {
    const f = b.findings[i];
    const at = mapLine(b.checked, b.since, f.line);
    if (!at) return null;
    const line = doc.lineAt(at.from);
    const ptr = tokenizeLine(line.text).find(t => t.kind === 'pointer');
    const target = ptr ? line.text.slice(ptr.from, ptr.to) : null;
    return {
      from: line.from,
      to: line.to,
      severity: toDiagnosticSeverity(f.severity),
      message: fill(f.title, f, b.names),
      renderMessage: () => {
        const box = el('span', { class: 'gx-msg' },
          el('span', { class: `gx-sev ${f.severity}` }, severityWord(f.severity)),
          el('span', { class: 'gx-title' }, filled(f.title, f, b.names)),
          f.meaning ? el('span', { class: 'gx-meaning' }, filled(f.meaning, f, b.names)) : null);
        if (s?.stale) box.append(el('span', { class: 'gx-stalenote' }, 'This may be out of date until you check again.'));
        return box;
      },
      actions: target ? [{ name: 'Go to record', apply: () => goToRecord(target) }] : [],
    };
  };

  /** The checked lines on screen now. */
  const visibleChecked = (view: EditorView, b: Basis): { first: number; last: number } => {
    const back = b.since.invert(b.checked);
    const { from, to } = view.viewport;
    const clamp = (p: number) => Math.max(0, Math.min(b.checked.length, back.mapPos(Math.min(p, view.state.doc.length))));
    return { first: b.checked.lineAt(clamp(from)).number, last: b.checked.lineAt(clamp(to)).number };
  };

  /** Sets the lint markers: all findings, or the MARKER_CAP nearest the view. */
  const refreshMarkers = () => {
    if (!s) return;
    const { view, basis: b } = s;
    let first = 1, last = b.checked.lines;
    if (b.order.length > MARKER_CAP) ({ first, last } = visibleChecked(view, b));
    const picked = windowed(b.findings, b.order, first, last, MARKER_CAP);
    const diags: Diagnostic[] = [];
    let lo = Infinity, hi = 0;
    let markRuns = Number(dialog.dataset.markRuns ?? 0);
    dialog.dataset.markRuns = String(++markRuns);
    for (const i of picked) {
      const d = diagnostic(b, view.state.doc, i);
      if (!d) continue;
      diags.push(d);
      lo = Math.min(lo, b.findings[i].line);
      hi = Math.max(hi, b.findings[i].line);
    }
    // The range asked for and the range marked, together; past the first or last
    // finding nothing more can be marked, so that end is open.
    const firstAll = b.findings[b.order[0]]?.line ?? 1, lastAll = b.findings[b.order[b.order.length - 1]]?.line ?? 1;
    s.window = b.order.length > MARKER_CAP ? {
      first: lo <= firstAll ? 1 : Math.min(first, lo),
      last: hi >= lastAll ? Infinity : Math.max(last, hi),
    } : null;
    view.dispatch(setDiagnostics(view.state, diags));
    dialog.dataset.markers = String(diags.length);
  };

  /** With more findings than markers, scrolling past the marked ones marks the ones in view. */
  const markersOnScroll = ViewPlugin.fromClass(class {
    update(u: ViewUpdate) {
      if (!s || !s.window || !(u.viewportChanged || u.docChanged)) return;
      const v = visibleChecked(u.view, s.basis);
      if (v.first >= s.window.first && v.last <= s.window.last) return;
      clearTimeout(markTimer);
      markTimer = window.setTimeout(refreshMarkers, 120);
    }
  });

  // ------------------------------------------------------------ the toolbar's state

  const showCount = () => {
    if (!s) return;
    const n = s.basis.order.length;
    count.textContent = s.current >= 0 ? `${formatNumber(s.current + 1)} of ${formatNumber(n)}`
      : n === 0 ? 'No problems' : `${formatNumber(n)} ${n === 1 ? 'problem' : 'problems'}`;
    prev.disabled = next.disabled = n === 0;
  };

  let editsSent = false;
  /** Tells the page whether there are edits since the last check, when that changes. */
  const reportEdits = (since: boolean) => {
    if (since === editsSent) return;
    editsSent = since;
    hostApi.edits?.(since);
  };

  const showFlags = () => {
    reportEdits(!!s?.stale);
    if (!s) return;
    edited.hidden = !s.dirty;
    stale.hidden = !s.stale;
    saveNote.hidden = s.saved;
    notes.hidden = stale.hidden && saveNote.hidden;
    checkBtn.disabled = checking;
    saveBtn.disabled = checking || saving;
  };

  const showPos = (state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    posText.textContent = `Line ${formatNumber(line.number)}, column ${formatNumber(head - line.from + 1)}`;
  };

  // ------------------------------------------------------------ moving around

  let flashTimer = 0;
  /** Puts the cursor at the start of the value of the line at `pos`, in the middle of the view, briefly highlighted. */
  const goTo = (pos: number) => {
    if (!s) return;
    const { view } = s;
    const line = view.state.doc.lineAt(pos);
    view.dispatch({
      selection: { anchor: line.from + valueStart(line.text) },
      effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), flashEffect.of(line.from)],
    });
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => s?.view.dispatch({ effects: flashEffect.of(null) }), 1600);
  };

  function goToRecord(xref: string) {
    if (!s) return;
    const doc = s.view.state.doc;
    const n = recordLine(lines(doc), xref);
    if (n === 0) { say(noRecord(xref)); return; }
    goTo(doc.line(n).from);
    say(`Line ${formatNumber(n)}: ${xref}`);
  }

  const positions = (): (number | null)[] => {
    if (!s) return [];
    if (!s.positions) {
      const b = s.basis;
      s.positions = b.order.map(i => mapLine(b.checked, b.since, b.findings[i].line)?.from ?? null);
    }
    return s.positions;
  };

  const step = (dir: 1 | -1) => {
    if (!s) return;
    const head = s.view.state.selection.main.head;
    const k = stepTo(positions(), s.view.state.doc.lineAt(head).from, s.current, dir);
    if (k < 0) return;
    s.current = k;
    const f = s.basis.findings[s.basis.order[k]];
    goTo(positions()[k]!);
    showCount();
    say(`Line ${formatNumber(s.view.state.doc.lineAt(positions()[k]!).number)}: ${fill(f.title, f, s.basis.names)}`);
  };

  // ------------------------------------------------------------ the view

  const onUpdate = EditorView.updateListener.of(u => {
    if (!s) return;
    if (u.docChanged) {
      s.basis.since = s.basis.since.compose(u.changes);
      if (s.pending) s.pending.since = s.pending.since.compose(u.changes);
      s.openerPos = u.changes.mapPos(s.openerPos);
      s.positions = null;
      const wasStale = s.stale;
      s.dirty = true;
      s.stale = true;
      // Not from inside the update: the next microtask.
      if (!wasStale) {
        const view = u.view;
        queueMicrotask(() => view.dispatch({ effects: staleAttr.reconfigure(EditorView.editorAttributes.of({ class: 'gx-stale' })) }));
      }
      showFlags();
    }
    if (u.docChanged || u.selectionSet) showPos(u.state);
  });

  const ctrlClick = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from;
      const t = tokenizeLine(line.text).find(x => x.kind === 'pointer' && col >= x.from && col <= x.to);
      if (!t) return false;
      e.preventDefault();
      goToRecord(line.text.slice(t.from, t.to));
      return true;
    },
    // A file dropped on the editor is not pasted into it (the page checks dropped files only when the editor is closed).
    drop(e) {
      if (e.dataTransfer?.files.length) { e.preventDefault(); return true; }
      return false;
    },
  });

  /** Taps on a phone: a tap on a marker shows its tooltip, as hovering does. (The gutter is outside the content, so a plain listener.) */
  const tapMarkers = (view: EditorView) => view.dom.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    const cell = (e.target as Element | null)?.closest?.('.cm-gutter-lint .cm-gutterElement');
    const m = cell?.querySelector('.cm-lint-marker');
    if (m) m.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  const makeView = (text: string, fileName: string): EditorView => {
    const state = EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
        highlightActiveLine(), gedcomLanguage, syntaxHighlighting(gedcomHighlighter),
        search({ top: true }), lintGutter({ hoverTime: 250 }), flashField, markersOnScroll, onUpdate, ctrlClick,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...lintKeymap]),
        wrapping.of([]), staleAttr.of([]),
        labels.of(EditorView.contentAttributes.of({
          'aria-label': `GEDCOM text of ${fileName}`, translate: 'no', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off',
          // Grammarly and similar extensions otherwise lay highlights over long
          // lines, wider than the screen.
          'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false',
        })),
        editorTheme,
      ],
    });
    const view = new EditorView({ state, parent: shadow });
    tapMarkers(view);
    return view;
  };

  const newBasis = (r: Result, checked: Text, since?: ChangeSet): Basis =>
    ({ findings: r.findings, names: r.names, order: navOrder(r.findings), checked, since: since ?? ChangeSet.empty(checked.length) });

  // ------------------------------------------------------------ open and close

  let returnTo: HTMLElement | null = null;

  // ------------------------------------------------------------ the page behind

  // While the editor is open the page behind is pinned where it was (editor.css,
  // html.ed-lock), so neither a swipe nor CodeMirror keeping the cursor in view
  // scrolls it; closing puts it back. The dialog follows the visual viewport, so
  // an on-screen keyboard shrinks it instead of pushing its top or bottom off
  // the screen. Custom properties set through the CSSOM, which the CSP allows.
  let locked: { x: number; y: number } | null = null;
  const root = document.documentElement;
  const vv = window.visualViewport;
  const fitViewport = () => {
    // Only for the keyboard: under pinch zoom the dialog stays the page's size.
    if (vv && Math.abs(vv.scale - 1) < 0.01 && Math.round(vv.height) < window.innerHeight) {
      dialog.style.setProperty('--ed-vv-height', `${vv.height}px`);
      dialog.style.setProperty('--ed-vv-top', `${vv.offsetTop}px`);
    } else {
      dialog.style.removeProperty('--ed-vv-height');
      dialog.style.removeProperty('--ed-vv-top');
    }
  };
  const lockPage = () => {
    if (locked) return;
    locked = { x: window.scrollX, y: window.scrollY };
    root.style.setProperty('--ed-lock-top', `${-locked.y}px`);
    root.classList.add('ed-lock');
    vv?.addEventListener('resize', fitViewport);
    vv?.addEventListener('scroll', fitViewport);
    fitViewport();
  };
  const unlockPage = () => {
    if (!locked) return;
    vv?.removeEventListener('resize', fitViewport);
    vv?.removeEventListener('scroll', fitViewport);
    dialog.style.removeProperty('--ed-vv-height');
    dialog.style.removeProperty('--ed-vv-top');
    root.classList.remove('ed-lock');
    root.style.removeProperty('--ed-lock-top');
    window.scrollTo(locked.x, locked.y);
    locked = null;
  };

  const open = (fileName: string, result: Result | null, line: number, opener: HTMLElement, code?: string) => {
    if (!s) {
      if (!result) return;
      const view = makeView(result.text, fileName);
      s = {
        name: fileName, view, basis: newBasis(result, view.state.doc), pending: null, dirty: false, saved: false, stale: false,
        lineBreak: lineBreakOf(result.text), current: -1, positions: null, window: null, openerPos: 0, opener: null,
      };
      name.textContent = fileName;
      refreshMarkers();
    }
    returnTo = opener;
    s.opener = opener;
    s.openerCode = code;
    showCount();
    showFlags();
    if (!dialog.open) {
      lockPage();
      dialog.showModal();
    }
    s.view.requestMeasure();
    let gone = 0;
    if (line > 0) {
      const at = mapLine(s.basis.checked, s.basis.since, line);
      const b = s.basis;
      // A line deleted since: the nearest line that is still there.
      const pos = at ? at.from : b.since.mapPos(b.checked.line(Math.min(line, b.checked.lines)).from, 1);
      if (!at) gone = s.view.state.doc.lineAt(pos).number;
      s.openerPos = pos;
      // The finding opened from, so Next and Previous go on from it.
      const k = s.basis.order.findIndex(i => s!.basis.findings[i].line === line && (!code || s!.basis.findings[i].code === code));
      s.current = k;
      showCount();
      goTo(pos);
    } else {
      // Line 1 the first time; where the cursor was when reopened.
      s.openerPos = s.view.state.selection.main.head;
    }
    showPos(s.view.state);
    s.view.focus();
    if (gone) say(`That line no longer exists; showing line ${formatNumber(gone)}.`);
  };

  /** The line of the last-checked text for a position now. */
  const checkedLine = (pos: number): number => {
    if (!s) return 0;
    const b = s.basis;
    const p = b.since.invert(b.checked).mapPos(Math.min(pos, s.view.state.doc.length));
    return b.checked.lineAt(Math.min(p, b.checked.length)).number;
  };

  const close = (ask: boolean): boolean => {
    if (!s || !dialog.open) return false;
    if (ask && s.dirty && !window.confirm(CLOSE_PROMPT)) return false;
    dialog.close(); // the close event does the rest
    return true;
  };
  // However the dialog closes (Close, Esc, or the browser), focus goes back and the bar moves home.
  dialog.addEventListener('close', () => {
    unlockPage();
    if (!s) return;
    if (searchPanelOpen(s.view.state)) closeSearchPanel(s.view);
    hostApi.closed(returnTo, checkedLine(s.openerPos), s.openerCode);
  });

  closeBtn.addEventListener('click', () => close(true));
  // Esc closes, after CodeMirror has had it (the search panel closes first).
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      trapTab(e);
    }
  });
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(true); });

  /** Tab from the last control goes to the first, Shift+Tab from the first to the last. */
  function trapTab(e: KeyboardEvent) {
    const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
      .filter(x => x.offsetParent !== null || x === wrapBox);
    if (!items.length) return;
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const first = items[0], last = items[items.length - 1];
    if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  }

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  findBtn.addEventListener('click', () => { if (s) openSearchPanel(s.view); });
  wrapBox.addEventListener('change', () => {
    s?.view.dispatch({ effects: wrapping.reconfigure(wrapBox.checked ? EditorView.lineWrapping : []) });
  });

  const text = () => s!.view.state.doc.sliceString(0, s!.view.state.doc.length, s!.lineBreak);

  checkBtn.addEventListener('click', () => {
    if (!s || checking) return;
    checking = true;
    s.pending = { doc: s.view.state.doc, since: ChangeSet.empty(s.view.state.doc.length) };
    showFlags();
    say('Checking…');
    hostApi.checkAgain(text(), barSlot);
  });

  saveBtn.addEventListener('click', async () => {
    if (!s || saving) return;
    const session = s;
    saving = true;
    showFlags();
    const ok = await hostApi.download(text());
    saving = false;
    if (s !== session) return;
    if (ok) {
      s.dirty = false;
      s.saved = true;
    } else {
      say(SAVE_FAILED);
    }
    showFlags();
  });

  // ------------------------------------------------------------ the editor's API

  return {
    open,
    reset() {
      if (dialog.open) dialog.close();
      clearTimeout(markTimer);
      s?.view.destroy();
      s = null;
      checking = saving = false;
      wrapBox.checked = false;
      delete dialog.dataset.markers;
      delete dialog.dataset.markRuns;
      reportEdits(false);
    },
    checkDone(result, statusText) {
      checking = false;
      if (s && s.pending) {
        if (result && result.isGedcom && !result.error) {
          // prepare() put the findings in the lines of the text sent; the edits made while it ran are "since".
          s.basis = newBasis(result, s.pending.doc, s.pending.since);
          s.stale = !s.pending.since.empty;
          s.current = -1;
          s.positions = null;
          if (!s.stale) s.view.dispatch({ effects: staleAttr.reconfigure([]) });
          refreshMarkers();
          showCount();
        } else if (result) {
          // Not GEDCOM any more, or the checker failed on it: no markers.
          s.basis = newBasis({ ...result, findings: [] }, s.pending.doc, s.pending.since);
          s.positions = null;
          s.current = -1;
          refreshMarkers();
          showCount();
        }
        s.pending = null;
      }
      showFlags();
      say(statusText);
      if (!result && dialog.open) checkBtn.focus();
    },
    lineMapper(result) {
      if (!s || !s.pending || !result.isGedcom || result.error) return line => line;
      return editorLineMap(s.view.state.toText(result.text).toString(), s.pending.doc.toString()) ?? (line => line);
    },
    prepare(result) {
      if (!s || !s.pending || !result.isGedcom || result.error) return result;
      // Checked was the text as Download gives it (its CHAR line set or inserted):
      // the report shows the editor's lines, as the markers do.
      const sent = s.pending.doc;
      return {
        ...result,
        findings: toEditorLines(result.findings, s.view.state.toText(result.text).toString(), sent.toString()),
        text: sent.sliceString(0, sent.length, s.lineBreak),
      };
    },
    get isOpen() { return dialog.open; },
    get dirty() { return !!s?.dirty; },
    get active() { return s !== null; },
  };
}

/** The lines of a CodeMirror text, as an iterable of strings. */
function* lines(doc: Text): Iterable<string> {
  const it = doc.iterLines();
  for (let r = it.next(); !r.done; r = it.next()) yield r.value;
}
