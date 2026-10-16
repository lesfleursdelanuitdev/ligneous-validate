import { progressBar } from './bar';
import { reportCsv, reportText } from './export';
import { downloadName } from './names';
import { CHECK_STAGES, REPAIR_STAGES, stagePercent } from './progress';
import {
  FAILED, countBySeverity, doneText, fillDownloads, fillRepair, fillRepairBusy, fillRepairFailed, fillRepairOffer, renderReport,
  repairPlan, sizeNote, viewKind,
} from './render';
import type { ReportSlots } from './render';
import type { FromWorker, RepairOut, Result } from './types';

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
const bar = progressBar($<HTMLElement>('progress'));

const LOADING = 'Getting the checker ready…';
const MAKING_REPAIR = 'Making a repaired copy…';

let worker: Worker | null = null;
let ready = false; // the current worker has loaded the checker
let busy = false; // a check is running
let repairing = false; // a repair has been asked for and not answered yet
let broken = false;
let current: File | null = null;
let shown: { file: File; result: Result; slots: ReportSlots; repair: RepairOut | null } | null = null;
let loadPercent = 0; // how much of the current worker's checker has downloaded
let barRepair = false; // the bar is showing a repair the visitor asked for

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
  busy = false;
  shown = null;
  bar.hide();
  report.replaceChildren();
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
  const slots = renderReport(report, result, file.name);
  const view = { file, result, slots, repair: null as RepairOut | null };
  shown = view;
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
  if (plan === 'auto') void askRepair(file, false);
  else if (plan === 'offer') offerRepair();
}

function offerRepair() {
  if (!shown) return;
  const { file, slots } = shown;
  fillRepairOffer(slots.repair, () => {
    fillRepairBusy(slots.repair);
    barRepair = true;
    bar.show(MAKING_REPAIR, 0);
    void askRepair(file, true);
  });
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
    fillRepairFailed(view.slots.repair);
    return;
  }
  view.repair = info;
  fillRepair(view.slots.repair, info, view.result, () =>
    save(data, 'application/octet-stream', downloadName(view.file.name, 'repaired')));
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
    if (shown && shown.file === current) fillRepairFailed(shown.slots.repair);
    controls();
  } else {
    restart();
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
  worker?.terminate();
  repairing = false;
  ready = false;
  loadPercent = 0;
  worker = start();
}

/** Asks for a repaired copy, giving the counts the page already has. `fresh` starts a new worker first. */
async function askRepair(file: File, fresh: boolean) {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    if (shown && shown.file === file) fillRepairFailed(shown.slots.repair);
    repairBarEnd(false);
    return;
  }
  if (current !== file || !shown) { repairBarEnd(false); return; }
  if (fresh) restart();
  const c = countBySeverity(shown.result.findings);
  repairing = true;
  worker?.postMessage({ type: 'repair', bytes, before: { errors: c.error, warnings: c.warning, hints: c.hint } }, [bytes]);
  controls();
}

async function check(file: File) {
  if (broken) return;
  current = file;
  // A file chosen while another is being checked, or while a repair is still running, gets a
  // fresh runtime: the old one is busy, or may have died.
  if (busy || repairing) restart();
  busy = true;
  barRepair = false;
  shown = null;
  report.replaceChildren();
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
    controls();
    return;
  }
  if (current !== file) return;
  worker!.postMessage({ type: 'check', bytes }, [bytes]);
}

stop.addEventListener('click', () => {
  bar.hide();
  barRepair = false;
  if (busy) {
    // Back to the start state.
    busy = false;
    current = null;
    shown = null;
    restart();
    report.replaceChildren();
    say('Stopped.');
  } else if (repairing) {
    // The report stays; the repaired copy can be asked for again.
    restart();
    say('Stopped.');
    offerRepair();
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
  if (file) void check(file);
  input.value = ''; // so choosing the same file again still checks it
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
  if (file) void check(file);
});
