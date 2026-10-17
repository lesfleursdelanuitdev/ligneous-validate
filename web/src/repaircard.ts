// The repair card: the checklist of fixes, the two run buttons and, after a
// run, what it changed and the download. The view model is checklist.ts;
// this file only draws it (covered by the e2e tests).

import {
  LABELS, MAX_NAME, checklistHeading, everything, examples, isOutOfDate, isPlanPending, rows, resultView, selectedFixes,
  selectedLeftOut, setChosen, setName,
} from './checklist';
import type { Checklist, Run, RowView } from './checklist';
import { KEEP_ORIGINAL, OFFER_NOTE, REPAIR_FAILED, el, formatNumber, withCode } from './render';
import type { Fix, RepairOut, Result } from './types';

export const FORMAT_LEGEND = 'Format fixes';
export const DATA_LEGEND = 'Suggested fixes — these change your family data';
export const DATA_WARNING = 'These remove or add records. Look at what they change before you download.';
export const STALE = 'out of date — repair again';
export const DOWNLOAD = 'Download repaired file';
export const DOWNLOAD_STALE = 'Download the last repaired copy';
export const TICK_ONE = 'Tick at least one fix first.';
export const STALE_SAY = 'Your choices changed. Repair again to update the copy.';
export const LEFT_FIXABLE = 'Tick a fix above to fix these here:';
export const LEFT_OTHER = 'These need fixing in your family tree program:';
const SUBMITTER_LINES = 'Type your name to see the 3 lines this adds: a link in the header, and a short record with your name.';
const NOTHING_NOW = 'Nothing would change with the fixes ticked now.';
const WORKING = 'Working out the lines…';
export const PLAN_FAILED = "We couldn't preview these fixes.";
export const EDITS_NOTE = "Your edits since the last Check again aren't in this copy. Open the editor and choose Check again first.";

export interface CardOptions {
  result: Result;
  checklist: Checklist;
  /** Over 5 MB: say that a repair takes a while. */
  big: boolean;
  onRun(run: Run): void;
  /** The ticks or the name changed: plan again. */
  onChange(): void;
  onDownload(): void;
}

export interface RepairCard {
  /** Brings the card in line with a new plan or list of kinds, keeping focus and open panels. */
  update(): void;
  /** Shows a finished run (checklist.ran says what it was). */
  showResult(out: RepairOut): void;
  /** A run that failed: one line where the result goes; the checklist stays. */
  showFailed(): void;
  setBusy(busy: boolean): void;
  /** There are editor edits since the last Check again: the copy doesn't have them. */
  setEditsNote(on: boolean): void;
}

const rowId = (fix: Fix) => `fix-${fix}`;

export function mountRepairCard(slot: HTMLElement, o: CardOptions): RepairCard {
  const c = o.checklist;
  const r = o.result;
  let shownOut: RepairOut | null = null;
  let busy = false;
  let wasStale = false;
  let editsNote = false;
  /** Show lines panels that are open; kept across a redraw. */
  const open = new Set<Fix>();
  /** Redraws an open panel in place (a new plan). */
  const drawers = new Map<Fix, () => void>();
  // Said politely when the result goes out of date (the stale mark itself is only seen).
  const live = el('p', { class: 'sr-only', id: 'repair-live', role: 'status', 'aria-live': 'polite' });

  const heading = el('h2', { id: 'repair-h' });
  const planFailed = el('p', { class: 'plan-failed', hidden: '' }, PLAN_FAILED);
  const edits = el('p', { class: 'edits-note', hidden: '' }, EDITS_NOTE);
  const lists = el('div', { class: 'fix-groups' });
  const all = el('button', { type: 'button', class: 'more run', id: 'repair-all' }, 'Repair everything');
  const selected = el('button', { type: 'submit', class: 'more run', id: 'repair-selected' });
  const runNote = el('p', { class: 'run-note', id: 'run-note' });
  const offer = o.big ? el('p', { class: 'offer' }, OFFER_NOTE) : null;
  const form = el('form', { class: 'checklist', novalidate: '', 'aria-labelledby': 'repair-h' },
    lists, el('div', { class: 'run-row' }, all, selected, offer), runNote);
  const resultBox = el('div', { class: 'result', id: 'repair-result', hidden: '' });
  slot.replaceChildren(heading, edits, planFailed, form, resultBox, live);
  slot.setAttribute('aria-labelledby', 'repair-h');
  slot.hidden = false;

  const run = (fixes: Fix[], leftOut: Fix[]) => {
    if (busy) return;
    if (fixes.length === 0) {
      runNote.textContent = leftOut.length ? `${LABELS.submitter}: type your name to include this.` : TICK_ONE;
      return;
    }
    runNote.textContent = leftOut.includes('submitter')
      ? `Left out “${LABELS.submitter}”: type your name to include it.`
      : '';
    o.onRun({ fixes, name: c.name, leftOut });
  };
  all.addEventListener('click', () => {
    const e = everything(c);
    refresh();
    o.onChange();
    run(e.fixes, e.leftOut);
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    run(selectedFixes(c), selectedLeftOut(c));
  });

  /** One checklist row: checkbox and label, count, reason, note, name field, Show lines. */
  function rowItem(v: RowView): HTMLElement {
    const id = rowId(v.fix);
    const box = el('input', { type: 'checkbox', id, name: 'fix', value: v.fix });
    // The count sits next to the label but isn't part of the checkbox's name; it is its description.
    const count = el('span', { class: 'fix-count', id: `${id}-count`, 'aria-hidden': 'true' });
    const label = el('label', { class: 'fix-label', for: id }, box, el('span', { class: 'fix-text' }, v.label, ' ', count));
    const reason = el('p', { class: 'fix-reason', id: `${id}-reason` });
    const note = el('p', { class: 'fix-note', id: `${id}-note`, 'aria-live': 'polite' });
    box.addEventListener('change', () => {
      setChosen(c, v.fix, box.checked);
      refresh();
      o.onChange();
    });
    const li = el('li', { class: 'fix', 'data-fix': v.fix }, label, reason, note);
    if (v.fix === 'submitter') {
      const input = el('input', {
        type: 'text', id: 'submitter-name', name: 'submitterName', maxlength: String(MAX_NAME),
        autocomplete: 'name', spellcheck: 'false', 'aria-describedby': `${id}-note`,
      });
      input.value = c.name;
      input.addEventListener('input', () => { setName(c, input.value); refresh(); o.onChange(); });
      li.append(el('div', { class: 'fix-name', id: `${id}-name` }, el('label', { for: 'submitter-name' }, 'Your name'), input));
    }
    li.append(showLines(v.fix));
    return li;
  }

  /**
   * The Show lines disclosure (a button with aria-expanded, so a finding's
   * summary stays the page's only <summary>); its lines are drawn each time
   * it opens, from the latest run.
   */
  function showLines(fix: Fix): HTMLElement {
    const bodyId = `${rowId(fix)}-lines`;
    const body = el('div', { class: 'fix-lines-body', id: bodyId, hidden: '' });
    const toggle = el('button', {
      type: 'button', class: 'show-lines', id: `${rowId(fix)}-show`, 'aria-expanded': 'false', 'aria-controls': bodyId,
    }, 'Show lines');
    const set = (on: boolean) => {
      toggle.setAttribute('aria-expanded', String(on));
      toggle.textContent = on ? 'Hide lines' : 'Show lines';
      body.hidden = !on;
      if (on) { open.add(fix); draw(); } else open.delete(fix);
    };
    toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
    // Reopened after a redraw (new list of kinds, or a run), drawn from the latest run.
    queueMicrotask(() => { if (open.has(fix)) set(true); });
    const draw = () => drawLines(fix, body);
    drawers.set(fix, () => { if (open.has(fix)) draw(); });
    return el('div', { class: 'fix-lines' }, toggle, body);
  }

  /** Show lines: Plan's units for the current ticks, each under its line number with its lines. */
  function drawLines(fix: Fix, body: HTMLElement) {
    body.replaceChildren();
    if (c.planFailed) {
      body.append(el('p', {}, PLAN_FAILED));
      return;
    }
    // Until the plan for the ticks on screen comes, the lines shown would be another combination's.
    const ex = isPlanPending(c) ? null : examples(fix, c, r);
    if (ex === null) {
      body.append(el('p', {}, WORKING));
      return;
    }
    if (ex.items.length === 0) {
      body.append(el('p', {}, fix === 'submitter' ? SUBMITTER_LINES : NOTHING_NOW));
      return;
    }
    const list = el('ol', { class: 'ex', translate: 'no' });
    for (const item of ex.items) {
      // It scrolls sideways, so it can be reached and scrolled from the keyboard.
      const rowsEl = el('div', {
        class: 'ex-rows', tabindex: '0', role: 'region',
        'aria-label': `Lines for ${LABELS[fix]}, ${item.at.charAt(0).toLowerCase()}${item.at.slice(1)}`,
      });
      for (const row of item.rows) {
        rowsEl.append(el('span', { class: `ex-line${row.nested ? ' nested' : ''}${row.added ? ' added' : ''}${row.removed ? ' removed' : ''}` },
          el('span', { class: 'ex-mark', 'aria-hidden': 'true' }, row.added ? '+' : row.removed ? '−' : ''),
          row.added ? el('span', { class: 'sr-only' }, 'Added: ') : row.removed ? el('span', { class: 'sr-only' }, 'Removed: ') : null,
          el('code', {}, row.text === '' ? '(blank)' : row.text)));
      }
      list.append(el('li', {},
        el('p', { class: 'ex-head' }, el('span', { class: 'ex-at' }, item.at),
          ' ', el('span', { class: 'ex-what', translate: 'yes' }, withCode(item.what))),
        item.rows.length ? rowsEl : null));
    }
    body.append(list);
    if (ex.more > 0) body.append(el('p', { class: 'ex-more' }, `and ${formatNumber(ex.more)} more`));
  }

  /** Builds both groups from the current list of kinds. */
  function build() {
    const v = rows(c);
    heading.textContent = checklistHeading(c, r);
    lists.replaceChildren();
    drawers.clear();
    if (v.format.length) {
      const ul = el('ul', { class: 'fix-list' });
      for (const row of v.format) ul.append(rowItem(row));
      lists.append(el('fieldset', { class: 'fixes', id: 'fixes-format' }, el('legend', {}, FORMAT_LEGEND), ul));
    }
    if (v.data.length) {
      const ul = el('ul', { class: 'fix-list' });
      for (const row of v.data) ul.append(rowItem(row));
      lists.append(el('fieldset', { class: 'fixes suggested', id: 'fixes-data', 'aria-describedby': 'suggested-warn' },
        el('legend', {}, DATA_LEGEND), el('p', { class: 'warn', id: 'suggested-warn' }, DATA_WARNING), ul));
    }
    refresh();
  }

  /** Brings every row, the buttons and the result's out-of-date mark in line with the model. */
  function refresh() {
    const v = rows(c);
    for (const row of [...v.format, ...v.data]) {
      const li = lists.querySelector<HTMLElement>(`li[data-fix="${row.fix}"]`);
      if (!li) continue;
      const id = rowId(row.fix);
      const box = li.querySelector<HTMLInputElement>(`#${id}`)!;
      box.checked = row.checked;
      box.disabled = row.disabled;
      li.classList.toggle('is-disabled', row.disabled);
      li.querySelector(`#${id}-count`)!.textContent = row.count;
      const reason = li.querySelector<HTMLElement>(`#${id}-reason`)!;
      reason.textContent = row.reason ?? '';
      reason.hidden = row.reason === null;
      const note = li.querySelector<HTMLElement>(`#${id}-note`)!;
      note.textContent = row.note ?? '';
      note.hidden = row.note === null;
      const described = [row.count && `${id}-count`, row.reason && `${id}-reason`, row.note && `${id}-note`].filter(Boolean).join(' ');
      if (described) box.setAttribute('aria-describedby', described); else box.removeAttribute('aria-describedby');
      const name = li.querySelector<HTMLElement>(`#${id}-name`);
      if (name) name.hidden = !row.nameField;
    }
    const n = selectedFixes(c).length;
    selected.textContent = `Repair selected (${formatNumber(n)})`;
    // A plan on its way: counts dimmed, open panels say so, and the runs wait for it.
    const pending = isPlanPending(c);
    lists.classList.toggle('is-pending', pending);
    lists.setAttribute('aria-busy', String(pending));
    for (const btn of [all, selected]) btn.disabled = busy || pending;
    planFailed.hidden = !c.planFailed;
    edits.hidden = !editsNote;
    for (const d of drawers.values()) d();
    // The main action is the run until there is a copy to download.
    selected.classList.toggle('primary', !shownOut);
    selected.classList.toggle('more', !!shownOut);
    const stale = isOutOfDate(c);
    const mark = resultBox.querySelector<HTMLElement>('.stale');
    if (mark) mark.hidden = !stale;
    const dl = resultBox.querySelector<HTMLButtonElement>('#download-repaired');
    if (dl) dl.textContent = stale || editsNote ? DOWNLOAD_STALE : DOWNLOAD;
    resultBox.classList.toggle('is-stale', stale);
    if (stale && !wasStale && dl) live.textContent = STALE_SAY;
    if (!stale) live.textContent = '';
    wasStale = stale;
  }

  /** A new plan: rows in place when the same kinds are listed (no rebuild under the visitor's hands). */
  function update() {
    const want = [...rows(c).format, ...rows(c).data].map(x => x.fix).join();
    const have = [...lists.querySelectorAll<HTMLElement>('li.fix')].map(li => li.dataset.fix).join();
    if (want !== have) { redraw(); return; }
    heading.textContent = checklistHeading(c, r);
    refresh();
  }

  function redraw() {
    const focused = document.activeElement?.id;
    build();
    if (focused) document.getElementById(focused)?.focus();
  }

  function showResult(out: RepairOut) {
    shownOut = out;
    const v = resultView(out, r, c.ran?.leftOut ?? []);
    const kids: (Node | null)[] = [
      el('h3', { id: 'result-h' }, 'Your repaired copy', ' ', el('span', { class: 'stale', hidden: '' }, STALE)),
    ];
    for (const g of v.groups) {
      if (g.label) kids.push(el('h4', {}, g.label, g.count ? el('span', { class: 'applied' }, ` · ${g.count}`) : null));
      // Appended one by one: a list can be long, and spreading it into a call overflows the stack.
      const ul = el('ul', { class: 'changes' });
      const shown = g.fix && ['broken-links', 'empty-families'].includes(g.fix) ? g.changes.slice(0, 50) : g.changes;
      for (const ch of shown) ul.append(el('li', {}, withCode(ch)));
      if (shown.length < g.changes.length) {
        ul.append(el('li', { class: 'ex-more' }, `and ${formatNumber(g.changes.length - shown.length)} more (all of them are in the text report)`));
      }
      kids.push(ul);
    }
    if (v.groups.length === 0) kids.push(el('p', { class: 'nothing' }, 'Nothing needed changing for the fixes you chose.'));
    if (v.notApplied.length) {
      const ul = el('ul', { class: 'not-applied' });
      for (const x of v.notApplied) ul.append(el('li', {}, el('span', { class: 'na-label' }, x.label), ` — ${x.reason}`));
      kids.push(el('h4', {}, 'Not applied:'), ul);
    }
    const dl = el('button', { type: 'button', class: 'primary', id: 'download-repaired' }, DOWNLOAD);
    dl.addEventListener('click', o.onDownload);
    kids.push(
      el('p', { class: 'counts' }, `Before: ${v.before}. After: ${v.after}.`),
      el('div', { class: 'repair-row' }, dl, el('p', { class: 'keep' }, KEEP_ORIGINAL)),
      v.note ? el('p', { class: 'note55' }, v.note) : null,
    );
    const leftList = (items: typeof v.left, cls: string) => {
      const ul = el('ul', { class: cls });
      for (const l of items) {
        ul.append(l.heading
          ? el('li', {}, `${l.title}: ${formatNumber(l.count)}`)
          : el('li', {}, withCode(l.title), ` (${formatNumber(l.count)})`));
      }
      return ul;
    };
    if (v.leftFixable.length) kids.push(el('h3', {}, LEFT_FIXABLE), leftList(v.leftFixable, 'left fixable'));
    if (v.left.length) kids.push(el('h3', {}, LEFT_OTHER), leftList(v.left, 'left'));
    resultBox.replaceChildren();
    for (const k of kids) if (k) resultBox.append(k);
    resultBox.hidden = false;
    // The list of kinds may have changed (a plan replaced by the run's own).
    redraw();
  }

  function showFailed() {
    shownOut = null;
    resultBox.replaceChildren(el('p', { class: 'repair-failed' }, REPAIR_FAILED));
    resultBox.hidden = false;
    refresh();
  }

  /** The control that had focus when a run started: disabling the buttons drops it, so it comes back after. */
  let focusBeforeRun: string | null = null;

  function setBusy(b: boolean) {
    if (b) {
      const a = document.activeElement;
      focusBeforeRun = a && slot.contains(a) && a.id ? a.id : null;
    }
    busy = b;
    for (const btn of [all, selected]) {
      if (b) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    }
    refresh();
    if (b) runNote.textContent = runNote.textContent || 'Making a repaired copy…';
    else if (runNote.textContent === 'Making a repaired copy…') runNote.textContent = '';
    if (!b && focusBeforeRun) {
      const a = document.activeElement;
      if (!a || a === document.body) document.getElementById(focusBeforeRun)?.focus();
      focusBeforeRun = null;
    }
  }

  build();
  function setEditsNote(on: boolean) {
    editsNote = on;
    refresh();
  }

  return { update, showResult, showFailed, setBusy, setEditsNote };
}
