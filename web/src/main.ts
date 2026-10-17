import { progressBar } from './bar';
import { reportCsv, reportText } from './export';
import { downloadName } from './names';
import { CHECK_STAGES, REPAIR_STAGES, stagePercent } from './progress';
import {
  FAILED, REPAIR_FAILED, countBySeverity, doneText, fillDownloads, fillRepairFailed, renderReport, repairPlan, sizeNote, viewKind,
} from './render';
import type { EditHooks, ReportSlots } from './render';
import { announce, markRan, newChecklist, planKey, selectedFixes, setAvailable, setPlan, setPlanFailed } from './checklist';
import type { Checklist, Run } from './checklist';
import { PLAN_FAILED, mountRepairCard } from './repaircard';
import type { RepairCard } from './repaircard';
import type { Fix, FixInfo, FromWorker, PlanOut, RepairOptions, RepairOut, Result } from './types';
import type { Editor } from './editor/editor';

const NO_WASM = "This browser couldn't start the checker. Try a current version of Firefox, Chrome, Safari or Edge.";
const LOAD_FAILED = "The checker didn't finish loading. Check your connection and try again.";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('file');
const choose = $<HTMLButtonElement>('choose');
const zone = $<HTMLElement>('drop');
const status = $<HTMLElement>('status');
const note = $<HTMLElement>('note');
const report = $<HTMLElement>('report');
const stop = $<HTMLButtonElement>('stop');
const retry = $<HTMLButtonElement>('retry');
const progressEl = $<HTMLElement>('progress');
const bar = progressBar(progressEl);
const reopen = $<HTMLButtonElement>('reopen');

const LOADING = 'Getting the checker ready…';
const MAKING_REPAIR = 'Making a repaired copy…';
const MB = 1024 * 1024;
/** Above this the repair waits for a click; the preview (Plan, a fraction of a check) always runs. */
const AUTO_LIMIT = 5 * MB;
/** Plan again this long after the last change of the ticks or the name. */
const REPLAN_MS = 150;

let worker: Worker | null = null;
let ready = false; // the current worker has loaded the checker
let busy = false; // a check is running
let repairing = false; // a repair has been asked for and not answered yet
let planning = false; // a plan has been asked for and not answered yet
let planSeq = 0; // the id of the latest plan asked for; older answers are dropped
let replanTimer: ReturnType<typeof setTimeout> | undefined;
let broken = false;
let current: File | null = null;
interface Shown {
  file: File;
  result: Result;
  slots: ReportSlots;
  /** The run on screen and its bytes. */
  repair: RepairOut | null;
  data: ArrayBuffer | null;
  checklist: Checklist | null;
  card: RepairCard | null;
  /** The run the visitor asked for, while it runs. */
  pending: Run | null;
  /** The repair made by itself failed: the slot says so, and later plans are dropped. */
  failed: boolean;
  /** The id of the plan whose answer is on screen. */
  planShown: number;
  /** The ticks the latest plan was asked for (planKey); null: the default ticks (no checklist yet). */
  planAsked: string | null;
  /** The last plan failed (a recovered error: the checker is still fine). */
  planError: boolean;
  /** An editor Check again: the plan and the repair work on what Download gives, as the check did. */
  saved: boolean;
  /** From a line of what was checked to the editor's line (identity for a chosen file). */
  mapLine: (line: number) => number;
}
let shown: Shown | null = null;
let loadPercent = 0; // how much of the current worker's checker has downloaded
let barRepair = false; // the bar is showing a repair the visitor asked for

// The editor (src/editor/), loaded the first time it opens.
let ed: Editor | null = null;
let edLoading: Promise<Editor | null> | null = null;
let editorCheck = false; // the running check is the editor's Check again
let beforeEditorCheck: Shown | null = null; // the report it replaces, kept if it is stopped
let editName = ''; // the file the editor's session is for
let editsSinceCheck = false; // the editor has edits since the last check (the copy doesn't have them)
let saveWait: ((m: { data: ArrayBuffer; error?: string } | null) => void) | null = null;
const EDITOR_FAILED = "The editor didn't load. Check your connection and try again.";
const NO_EDITOR = "This browser can't run the editor. Try a current version of Firefox, Chrome, Safari or Edge.";
// The editor's styles need constructable, adopted style sheets: without them
// CodeMirror falls back to a <style> element, which the CSP blocks (Safari
// before 16.4, Firefox before 101). Those browsers get no editor buttons.
const canEdit = typeof ShadowRoot === 'function' && 'adoptedStyleSheets' in ShadowRoot.prototype &&
  typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype;

/** Saves text or bytes under `name` through a temporary link; nothing is sent anywhere. */
function save(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function say(text: string, extra = '', tone: '' | 'problem' | 'good' = '') {
  status.textContent = text;
  // While a check runs, the bar above the dropzone shows the step, so the
  // status line is only heard (it is still the live region that announces it).
  status.className = tone || (busy ? 'quiet' : '');
  note.textContent = extra;
  note.hidden = extra === '';
}

/** Stop shows, on the progress bar's row, while a check or an asked-for repair runs. */
function controls() {
  stop.hidden = !(busy || (repairing && barRepair));
}

function showNoWasm() {
  broken = true;
  busy = false;
  bar.hide();
  report.replaceChildren();
  say(NO_WASM, '', 'problem');
  controls();
}

/** The checker didn't load (network, instantiate, or the start timeout); it can be retried. */
function showLoadFailed() {
  editorDone(null, LOAD_FAILED);
  broken = true;
  busy = false;
  repairing = false;
  bar.hide();
  report.replaceChildren();
  say(LOAD_FAILED, '', 'problem');
  retry.hidden = false;
  controls();
}

/** The checker crashed or ran out of memory while checking. */
function showFailed() {
  editorDone(null, FAILED);
  busy = false;
  shown = null;
  bar.hide();
  report.replaceChildren();
  showReopen();
  say(FAILED, '', 'problem');
  restart();
  controls();
}

function onResult(result: Result) {
  busy = false;
  if (result.error) bar.hide(); else bar.done();
  const kind = viewKind(result);
  say(doneText(result), '', kind === 'failed' || kind === 'not-gedcom' ? 'problem' : kind === 'clean' ? 'good' : '');
  const file = current!;
  // A Check again report is shown in the editor's line numbers; the checklist's lines are moved the same way.
  const fromEditor = editorCheck && !!ed;
  const mapLine = fromEditor ? ed!.lineMapper(result) : (line: number) => line;
  if (fromEditor) result = ed!.prepare(result);
  const slots = renderReport(report, result, file.name, canEdit ? editHooks : undefined);
  if (!canEdit) report.querySelector('.toolbar')?.after(Object.assign(document.createElement('p'), { className: 'no-editor', textContent: NO_EDITOR }));
  const view: Shown = {
    file, result, slots, repair: null, data: null, checklist: null, card: null, pending: null, failed: false, planShown: 0,
    planAsked: null, planError: false, saved: fromEditor, mapLine,
  };
  shown = view;
  editorDone(result, doneText(result));
  showReopen();
  if (kind === 'report') {
    fillDownloads(slots.downloads,
      () => save(reportText(file.name, result, new Date(), view.repair), 'text/plain;charset=utf-8', downloadName(file.name, 'report-txt')),
      () => save(reportCsv(result), 'text/csv;charset=utf-8', downloadName(file.name, 'report-csv')));
  }
  if (result.error) {
    restart(); // a fresh runtime for the next file
    return;
  }
  const plan = repairPlan(result, file.size);
  if (plan === 'skip') return;
  // The checklist comes from Plan, for every size. The repair runs by itself
  // only up to 5 MB; above that it waits for a click.
  void askPlan(view);
  if (plan === 'auto') void askRepair(file, false);
}

/**
 * Puts up the checklist for the file on screen (once), or gives it a new list
 * of kinds: from a plan (with its units, made for the ticks `key`), or from a
 * run (units null: the preview stays).
 */
function showCard(view: Shown, available: FixInfo[], units: PlanOut['units'] | null, key: string | null = null) {
  if (view.checklist) {
    if (units !== null) setPlan(view.checklist, { available, units }, key ?? undefined);
    else setAvailable(view.checklist, available);
    view.card?.update();
    return;
  }
  const c = newChecklist(available, units ?? null);
  if (units === null && view.planError) setPlanFailed(c);
  view.checklist = c;
  view.card = mountRepairCard(view.slots.repair, {
    result: view.result, checklist: c, big: view.file.size > AUTO_LIMIT,
    onRun: run => runAsked(view, run),
    onChange: () => schedulePlan(view),
    onDownload: () => {
      if (view.data) save(view.data, 'application/octet-stream', downloadName(view.file.name, 'repaired'));
    },
  });
  view.card.setEditsNote(editsSinceCheck);
}

/** Plans again when the preview on screen isn't the answer to the latest plan (lost to a restart, say). */
function catchUpPlan(view: Shown | null) {
  if (view && view === shown && view.checklist && view.planShown !== planSeq) schedulePlan(view);
}

/** Lines of what was checked, in the editor's numbers (an editor Check again). */
function mapUnits(units: PlanOut['units'], map: (line: number) => number): PlanOut['units'] {
  if (!units) return units;
  const out: NonNullable<PlanOut['units']> = {};
  for (const [fix, list] of Object.entries(units) as [Fix, NonNullable<PlanOut['units']>[Fix]][]) {
    out[fix] = list?.map(u => (u.line > 0 ? { ...u, line: map(u.line) } : u));
  }
  return out;
}

/** Plans again for the current ticks, once they have stopped changing for a moment. */
function schedulePlan(view: Shown) {
  clearTimeout(replanTimer);
  replanTimer = setTimeout(() => { if (shown === view) void askPlan(view); }, REPLAN_MS);
}

/** "Repair everything" or "Repair selected": a run with the bar and Stop; big files get a fresh worker. */
function runAsked(view: Shown, run: Run) {
  if (shown !== view || busy || repairing) return;
  view.pending = run;
  view.card?.setBusy(true);
  barRepair = true;
  bar.show(MAKING_REPAIR, 0);
  const options: RepairOptions = { fixes: run.fixes };
  if (run.fixes.includes('submitter')) options.submitterName = run.name;
  void askRepair(view.file, view.file.size > AUTO_LIMIT, options);
  controls();
}

/** A run asked for has ended without a result: the checklist stays and can be run again. */
function runEnded(view: Shown) {
  view.pending = null;
  view.card?.setBusy(false);
}

/** The asked-for repair has ended: the bar fills and fades, or goes at once on a failure. */
function repairBarEnd(ok: boolean) {
  if (!barRepair) return;
  barRepair = false;
  if (ok) bar.done(); else bar.hide();
}

function onRepaired(data: ArrayBuffer, info: RepairOut) {
  repairing = false;
  repairBarEnd(!info.error);
  // A failed repair (e.g. out of memory on a huge file) can leave the checker's runtime
  // dead, so the next file would fail too. Start a fresh one.
  if (info.error) restart();
  // Only for the file on screen: a late answer for an earlier file is dropped.
  if (!shown || shown.file !== current) return;
  const view = shown;
  if (info.error) {
    if (view.card && view.pending) {
      view.card.showFailed();
      say(REPAIR_FAILED, '', 'problem');
      runEnded(view);
      catchUpPlan(view);
    } else {
      // The repair made by itself failed: one line, in place of the checklist.
      view.failed = true;
      view.card = null;
      view.checklist = null;
      fillRepairFailed(view.slots.repair);
    }
    return;
  }
  if (view.saved) info = { ...info, changes: info.changes.map(ch => (ch.line > 0 ? { ...ch, line: view.mapLine(ch.line) } : ch)) };
  // An older checker (or a test's fake) may leave out the list of kinds.
  const available = info.available ?? view.checklist?.available ?? [];
  if (!view.checklist && available.length === 0 && info.changes.length === 0) return; // nothing to fix
  showCard(view, available, null);
  // The run made by itself changed nothing (only suggested fixes are on offer):
  // no copy to download, just the checklist.
  if (!view.pending && info.changes.length === 0) return;
  view.repair = info;
  view.data = data;
  const c = view.checklist!;
  const run: Run = view.pending ?? { fixes: selectedFixes(c), name: '', leftOut: [] };
  markRan(c, run, info);
  view.card!.showResult(info);
  if (view.pending) say(announce(info, run.leftOut));
  runEnded(view);
  // A fresh worker for a big file dropped any plan still on its way: ask again.
  if (view.planShown !== planSeq) schedulePlan(view);
}

function onPlanned(info: PlanOut, id: number) {
  if (id !== planSeq) return; // an answer for older ticks
  planning = false;
  if (!shown || shown.file !== current || shown.failed) return;
  const view = shown;
  if (info.error) {
    // A recovered error (errJSON): the checker is fine, and a repair it is
    // running goes on. Only a real worker error restarts it. The card says
    // the preview failed; its buttons stay.
    view.planError = true;
    if (view.checklist) {
      setPlanFailed(view.checklist);
      view.card?.update();
    } else if (view.file.size > AUTO_LIMIT) {
      // No repair comes by itself to give the list of kinds.
      fillRepairFailed(view.slots.repair, PLAN_FAILED);
    }
    return;
  }
  view.planShown = id;
  view.planError = false;
  if (!view.checklist && info.available.length === 0) return; // nothing to fix
  const units = view.saved ? mapUnits(info.units ?? {}, view.mapLine) : info.units ?? {};
  showCard(view, info.available, units, view.planAsked);
}

function onMessage(e: MessageEvent<FromWorker>) {
  const msg = e.data;
  if (msg.type === 'status') {
    if (busy) {
      say(msg.text, note.textContent ?? '');
      bar.show(msg.text, msg.text === LOADING ? loadPercent : 0);
    }
  } else if (msg.type === 'download') {
    loadPercent = Math.max(loadPercent, msg.percent);
    if (busy && !ready) bar.show(LOADING, loadPercent);
  } else if (msg.type === 'stage') {
    const p = stagePercent(msg.job === 'check' ? CHECK_STAGES : REPAIR_STAGES, msg.stage);
    if (msg.job === 'check' && busy && p >= 0) bar.set(p);
    else if (msg.job === 'repair' && barRepair && p >= 0) bar.set(p);
  } else if (msg.type === 'ready') {
    ready = true;
  } else if (msg.type === 'error') {
    showLoadFailed();
  } else if (msg.type === 'result') {
    onResult(msg.result);
  } else if (msg.type === 'repaired') {
    onRepaired(msg.data, msg.info);
  } else if (msg.type === 'planned') {
    onPlanned(msg.info, msg.id);
  } else if (msg.type === 'saved') {
    saveWait?.(msg);
  }
  controls();
}

/** A worker that died: before it was ready the checker didn't load; after, it crashed. */
function onWorkerError() {
  if (!ready) {
    showLoadFailed();
  } else if (busy) {
    showFailed();
  } else if (repairing) {
    repairing = false;
    repairBarEnd(false);
    restart();
    if (shown && shown.file === current) {
      if (shown.card) { shown.card.showFailed(); runEnded(shown); } else fillRepairFailed(shown.slots.repair);
      catchUpPlan(shown);
    }
    controls();
  } else {
    restart();
    catchUpPlan(shown);
  }
}

function start(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // Anything from a worker that has been replaced is stale and ignored.
  w.addEventListener('message', ev => { if (w === worker) onMessage(ev); });
  w.addEventListener('error', () => { if (w === worker) onWorkerError(); });
  return w;
}

function restart() {
  saveWait?.(null); // a save on the old worker won't come back
  // A repair the visitor asked for dies with the worker: say so (Stop clears `repairing` first).
  if (repairing && shown?.pending && shown.card) {
    shown.card.showFailed();
    repairBarEnd(false);
    runEnded(shown);
  }
  worker?.terminate();
  repairing = false;
  planning = false;
  ready = false;
  loadPercent = 0;
  worker = start();
}

/**
 * Asks for a repaired copy, giving the counts the page already has, with the
 * fixes chosen (none given: every format kind). `fresh` starts a new worker first.
 */
async function askRepair(file: File, fresh: boolean, options?: RepairOptions) {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    if (shown && shown.file === file) {
      if (shown.card) { shown.card.showFailed(); runEnded(shown); } else fillRepairFailed(shown.slots.repair);
    }
    repairBarEnd(false);
    controls();
    return;
  }
  if (current !== file || !shown) { repairBarEnd(false); return; }
  if (fresh) restart();
  const c = countBySeverity(shown.result.findings);
  repairing = true;
  const before = { errors: c.error, warnings: c.warning, hints: c.hint };
  const save = shown.saved;
  worker?.postMessage(options ? { type: 'repair', bytes, before, options, save } : { type: 'repair', bytes, before, save }, [bytes]);
  controls();
}

/**
 * Asks for the preview (Plan) for the current ticks: what each kind would
 * change if chosen with them. Before there is a checklist, the default ticks
 * (every format kind).
 */
async function askPlan(view: Shown) {
  const id = ++planSeq;
  let bytes: ArrayBuffer;
  try {
    bytes = await view.file.arrayBuffer();
  } catch {
    return;
  }
  if (id !== planSeq || shown !== view || current !== view.file || busy) return;
  const c = view.checklist;
  const options: RepairOptions | undefined = c ? { fixes: selectedFixes(c), submitterName: c.name } : undefined;
  view.planAsked = c ? planKey(c) : null;
  planning = true;
  const save = view.saved;
  worker?.postMessage(options ? { type: 'plan', bytes, options, id, save } : { type: 'plan', bytes, id, save }, [bytes]);
}

async function check(file: File, fromEditor = false) {
  if (broken) { if (fromEditor) editorDone(null, LOAD_FAILED); return; }
  current = file;
  // A file chosen while another is being checked, or while a repair is still running, gets a
  // fresh runtime: the old one is busy, or may have died.
  if (busy || repairing || planning) restart();
  busy = true;
  barRepair = false;
  editorCheck = fromEditor;
  // The editor's Check again keeps the report until the new one is there.
  if (fromEditor) {
    beforeEditorCheck = shown;
  } else {
    shown = null;
    report.replaceChildren();
  }
  say('Reading your file…', sizeNote(file.size));
  bar.show('Reading your file…', 0);
  controls();
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    busy = false;
    bar.hide();
    say("We couldn't read that file. Try choosing it again.");
    editorDone(null, "We couldn't read that file. Try choosing it again.");
    controls();
    return;
  }
  if (current !== file) return;
  worker!.postMessage({ type: 'check', bytes, save: fromEditor }, [bytes]);
}

stop.addEventListener('click', () => {
  bar.hide();
  barRepair = false;
  if (busy && editorCheck) {
    // The editor's Check again: the editor and the report it had stay.
    busy = false;
    restart();
    shown = beforeEditorCheck;
    current = shown?.file ?? null;
    say('Stopped.');
    editorDone(null, 'Stopped.');
    controls();
    return;
  }
  if (busy) {
    // Back to the start state.
    busy = false;
    current = null;
    shown = null;
    restart();
    report.replaceChildren();
    say('Stopped.');
  } else if (repairing) {
    // The report and the checklist stay; the repaired copy can be asked for again.
    repairing = false;
    restart();
    say('Stopped.');
    if (shown) runEnded(shown);
    // A plan sent while it ran died with the worker: plan the ticks on screen again.
    catchUpPlan(shown);
  }
  controls();
  choose.focus();
});

retry.addEventListener('click', () => {
  broken = false;
  retry.hidden = true;
  say('');
  restart();
  choose.focus();
});

if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') {
  showNoWasm();
} else {
  worker = start();
}

choose.addEventListener('click', () => input.click());
input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) chooseFile(file);
  input.value = ''; // so choosing the same file again still checks it
});

/** A new file from the visitor: unsaved edits are lost, so it asks first. */
function chooseFile(file: File) {
  if (ed?.isOpen) return; // a file dropped on the open editor
  if (ed?.dirty && !window.confirm(`Check another file? Your edits to ${editName} will be lost.`)) return;
  ed?.reset();
  editsSinceCheck = false;
  reopen.hidden = true;
  void check(file);
}

// ---------------------------------------------------------------- the editor

/** Tells the editor its Check again has ended (null: failed or stopped). */
function editorDone(result: Result | null, text: string) {
  if (!editorCheck) return;
  editorCheck = false;
  beforeEditorCheck = null;
  ed?.checkDone(result, text);
}

/** "Open the editor" by the status line, when the report has none (no findings left, say). */
function showReopen() {
  reopen.hidden = !(ed?.active && !report.querySelector('.open-editor'));
}

function loadEditor(): Promise<Editor | null> {
  edLoading ??= import('./editor/editor').then(m => (ed = m.createEditor({
    checkAgain(text, slot) {
      // The bar shows in the editor's toolbar while it checks (moved back when the editor closes).
      slot.append(progressEl);
      const name = shown?.file.name ?? editName;
      void check(new File([new TextEncoder().encode(text)], name, { type: 'text/plain' }), true);
    },
    download(text) {
      return new Promise<boolean>(resolve => {
        if (!worker || broken) { resolve(false); return; }
        saveWait?.(null);
        saveWait = m => {
          saveWait = null;
          if (!m || m.error) { resolve(false); return; }
          save(m.data, 'application/octet-stream', downloadName(editName, 'edited'));
          resolve(true);
        };
        const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
        worker.postMessage({ type: 'save', bytes }, [bytes]);
      });
    },
    edits(since) {
      // The repaired copy is made from the last checked text: say so while there are edits since.
      editsSinceCheck = since;
      shown?.card?.setEditsNote(since);
    },
    closed(opener, line, code) {
      zone.before(progressEl);
      showReopen();
      // Back to the card it was opened from, which Check again may have rebuilt.
      const target = (opener?.isConnected ? opener : null) ??
        report.querySelector<HTMLElement>(`.edit-line[data-line="${line}"][data-code="${CSS.escape(code ?? '')}"]`) ??
        report.querySelector<HTMLElement>(`.edit-line[data-line="${line}"]`) ??
        report.querySelector<HTMLElement>('.open-editor') ?? (reopen.hidden ? choose : reopen);
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    },
  })), () => { edLoading = null; return null; });
  return edLoading;
}

async function openEditor(line: number, opener: HTMLElement, code?: string) {
  const view = shown;
  // With no report (Check again found no GEDCOM, or failed), only an existing session can open.
  if (!view && !ed?.active) return;
  const editor = await loadEditor();
  if (!editor) { say(EDITOR_FAILED, '', 'problem'); return; }
  if (!editor.active) {
    if (!view || shown !== view) return; // another file came meanwhile
    editName = view.file.name;
    editor.open(editName, view.result, line, opener, code);
  } else {
    editor.open(editName, null, line, opener, code);
  }
}

const editHooks: EditHooks = { open: (line, opener, code) => void openEditor(line, opener, code) };
reopen.addEventListener('click', () => void openEditor(0, reopen));

// Closing or reloading the tab with unsaved edits: the browser asks.
window.addEventListener('beforeunload', e => {
  if (ed?.dirty) { e.preventDefault(); e.returnValue = 'unsaved'; }
});

// Dropping anywhere on the page works; the zone shows where.
let depth = 0;
window.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  depth++;
  zone.classList.add('over');
});
window.addEventListener('dragleave', () => {
  if (--depth <= 0) { depth = 0; zone.classList.remove('over'); }
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  depth = 0;
  zone.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) chooseFile(file);
});
