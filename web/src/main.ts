import { reportCsv, reportText } from './export';
import { downloadName } from './names';
import { doneText, fillDownloads, fillRepair, renderReport, viewKind } from './render';
import type { ReportSlots } from './render';
import type { FromWorker, Result } from './types';

const BIG = 50 * 1024 * 1024;
const NO_WASM = "This browser couldn't start the checker. Try a current version of Firefox, Chrome, Safari or Edge.";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('file');
const choose = $<HTMLButtonElement>('choose');
const zone = $<HTMLElement>('drop');
const status = $<HTMLElement>('status');
const note = $<HTMLElement>('note');
const report = $<HTMLElement>('report');

let worker: Worker | null = null;
let busy = false;
let repairing = false; // a repair has been asked for and not answered yet
let broken = false;
let current: File | null = null;
let shown: { file: File; result: Result; slots: ReportSlots } | null = null;

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
  status.className = tone;
  note.textContent = extra;
  note.hidden = extra === '';
}

function showBroken() {
  broken = true;
  busy = false;
  report.replaceChildren();
  say(NO_WASM, '', 'problem');
}

function onMessage(e: MessageEvent<FromWorker>) {
  const msg = e.data;
  if (msg.type === 'status') {
    say(msg.text, note.textContent ?? '');
  } else if (msg.type === 'error') {
    showBroken();
  } else if (msg.type === 'result') {
    busy = false;
    const kind = viewKind(msg.result);
    say(doneText(msg.result), '', kind === 'not-gedcom' ? 'problem' : kind === 'clean' ? 'good' : '');
    const file = current!;
    const slots = renderReport(report, msg.result, file.name);
    shown = { file, result: msg.result, slots };
    if (kind === 'report') {
      fillDownloads(slots.downloads,
        () => save(reportText(file.name, msg.result), 'text/plain;charset=utf-8', downloadName(file.name, 'report-txt')),
        () => save(reportCsv(msg.result), 'text/csv;charset=utf-8', downloadName(file.name, 'report-csv')));
    }
    if (msg.result.error) restart(); // a fresh runtime for the next file
    else if (kind !== 'not-gedcom') void askRepair(file);
  } else if (msg.type === 'repaired') {
    // A failed repair (e.g. out of memory on a huge file) can leave the checker's runtime
    // dead, so the next file would be reported as "not GEDCOM". Start a fresh one.
    repairing = false;
    if (msg.info.error) {
      if (busy && current) void check(current); // restarts, then checks the file again
      else restart();
      return;
    }
    // Only for the file on screen: a late answer for an earlier file is dropped.
    if (!shown || shown.file !== current) return;
    const { file, result, slots } = shown;
    fillRepair(slots.repair, msg.info, result, () =>
      save(msg.data, 'text/plain;charset=utf-8', downloadName(file.name, 'repaired')));
  }
}

function start(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // Anything from a worker that has been replaced is stale and ignored.
  w.addEventListener('message', ev => { if (w === worker) onMessage(ev); });
  w.addEventListener('error', () => { if (w === worker) showBroken(); });
  return w;
}

function restart() {
  worker?.terminate();
  repairing = false;
  worker = start();
}

async function askRepair(file: File) {
  try {
    const bytes = await file.arrayBuffer();
    if (current === file) {
      repairing = true;
      worker?.postMessage({ type: 'repair', bytes }, [bytes]);
    }
  } catch {
    // The report is already showing; the repair part just doesn't appear.
  }
}

async function check(file: File) {
  if (broken) return;
  current = file;
  // A file chosen while another is being checked, or while a repair is still running, gets a
  // fresh runtime: the old one is busy, or may have died.
  if (busy || repairing) restart();
  busy = true;
  shown = null;
  report.replaceChildren();
  say('Reading your file…', file.size > BIG ? 'This is a big file. Checking may take a minute.' : '');
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    busy = false;
    say("We couldn't read that file. Try choosing it again.");
    return;
  }
  if (current !== file) return;
  worker!.postMessage({ type: 'check', bytes }, [bytes]);
}

if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') {
  showBroken();
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
