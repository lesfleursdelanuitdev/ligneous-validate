// Loads the checker (Go compiled to WebAssembly) and runs it off the main
// thread, so the page never freezes. Loading starts as soon as the worker is
// created.

import type { Counts, FromWorker, RepairOut, Result, ToWorker } from './types';

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface Api {
  check(bytes: Uint8Array): string;
  repair(bytes: Uint8Array, before?: Counts): { data: Uint8Array; json: string };
}

interface WorkerScope {
  Go: new () => GoRuntime;
  ligneous?: Api;
  ligneousReady?: boolean;
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<ToWorker>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const wasmUrl = new URL('./wasm/ligneous.wasm', import.meta.url);
// wasm_exec.js is Go's plain-script loader, served as-is from public/. This
// is a module worker, where importScripts() throws, so it is imported. The
// full URL keeps the Vite dev server from adding "?import" to it, which
// makes it refuse to serve a public file.
const execUrl = new URL('/wasm_exec.js', self.location.origin).href;

const post = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

async function instantiate(go: GoRuntime): Promise<WebAssembly.Instance> {
  try {
    return (await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject)).instance;
  } catch {
    // e.g. a server that doesn't send application/wasm
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, go.importObject)).instance;
  }
}

async function load(): Promise<Api> {
  await import(/* @vite-ignore */ execUrl);
  const go = new scope.Go();
  const instance = await instantiate(go);
  void go.run(instance); // never settles: main() blocks forever
  // Up to 15 s for main() to start, on a slow phone.
  for (let i = 0; i < 1500 && !scope.ligneousReady; i++) await new Promise(r => setTimeout(r, 10));
  if (!scope.ligneousReady || !scope.ligneous) throw new Error('checker did not start');
  return scope.ligneous;
}

let loaded = false;
const ready = load();
ready.then(
  () => { loaded = true; post({ type: 'ready' }); },
  (e: unknown) => post({ type: 'error', message: String(e) }));

function failed(message: string): Result {
  return {
    encoding: { detected: '', declared: '', reason: '' },
    summary: {
      people: 0, families: 0, sources: 0, notes: 0, media: 0, years: null,
      program: '', programVersion: '', gedcomVersion: '', lines: 0,
    },
    findings: [], names: {}, text: '', isGedcom: false, error: message,
  };
}

scope.addEventListener('message', async e => {
  const msg = e.data;
  if (!loaded && msg.type === 'check') post({ type: 'status', text: 'Getting the checker ready…' });
  let api: Api;
  try {
    api = await ready;
  } catch {
    return; // the error was posted when loading failed
  }
  const bytes = new Uint8Array(msg.bytes);
  if (msg.type === 'check') {
    post({ type: 'status', text: 'Checking…' });
    let result: Result;
    try {
      const parsed = JSON.parse(api.check(bytes)) as Result | { error: string };
      result = 'findings' in parsed ? parsed : failed(parsed.error);
    } catch (err) {
      result = failed(String(err));
    }
    post({ type: 'result', result });
  } else if (msg.type === 'repair') {
    try {
      const out = api.repair(bytes, msg.before);
      const info = JSON.parse(out.json) as RepairOut;
      const data = out.data.slice().buffer; // its own buffer, sized exactly
      post({ type: 'repaired', data, info }, [data]);
    } catch (err) {
      post({ type: 'repaired', data: new ArrayBuffer(0), info: { changes: [], left: [], before: { errors: 0, warnings: 0, hints: 0 }, after: { errors: 0, warnings: 0, hints: 0 }, error: String(err) } });
    }
  }
});
