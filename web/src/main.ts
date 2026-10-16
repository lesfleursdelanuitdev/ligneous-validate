import { doneText, renderReport, viewKind } from './render';
import type { FromWorker } from './types';

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
let broken = false;
let current: File | null = null;

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
    renderReport(report, msg.result, current?.name ?? '');
    // Task 4: when the file is GEDCOM, ask the worker to repair and fill the slots.
    if (msg.result.error) restart(); // a fresh runtime for the next file
  }
}

function start(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('message', onMessage);
  w.addEventListener('error', showBroken);
  return w;
}

function restart() {
  worker?.terminate();
  worker = start();
}

async function check(file: File) {
  if (broken) return;
  current = file;
  // A file chosen while another is being checked replaces it.
  if (busy) restart();
  busy = true;
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
