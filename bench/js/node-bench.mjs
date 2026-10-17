// Node runner. One library per process, so memory numbers don't mix.
//
// Usage: node --expose-gc js/node-bench.mjs --lib LIB --runs N [--wasm F --exec F] FILE...
//   LIB = ours-parse   bench wasm, ligneousBench.parse(u8)       (parse only)
//         ours-check   site wasm, ligneous.check(u8)             (full check)
//         read-gedcom  readGedcom(arrayBuffer)                   (parse only)
// Prints one JSON object per file on stdout.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { summarize } from './stats.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const lib = opt('--lib');
const runs = Number(opt('--runs') ?? 10);
const wasmPath = opt('--wasm');
const execPath = opt('--exec');
const files = argv;
const gc = globalThis.gc ?? (() => {});
const MB = 1 << 20;
const r2 = v => Math.round(v * 100) / 100;

let wasmMemory = null;
async function startGo(globalName) {
  require(path.resolve(execPath)); // defines globalThis.Go
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), go.importObject);
  go.run(instance);
  for (let i = 0; i < 500 && !globalThis[globalName + 'Ready']; i++) await new Promise(r => setTimeout(r, 10));
  if (!globalThis[globalName + 'Ready']) throw new Error(globalName + ' never became ready');
  wasmMemory = instance.exports.mem;
  return globalThis[globalName];
}

// run(u8) is the timed call. For the parse runners it returns the counts,
// so counting is inside the timed region for every library. For the check,
// it returns the result as a JSON string (as on the site), and info() reads
// the counts from it after the timer, as the native run reads them from the
// result struct.
let run, info, memRun, library, task, beforeRun = () => gc();
if (lib === 'ours-parse') {
  const api = await startGo('ligneousBench');
  library = 'ligneous-gedcom-lib'; task = 'parse';
  beforeRun = () => { api.gc(); gc(); };
  run = u8 => api.parse(u8);
  info = v => v;
} else if (lib === 'ours-check') {
  const api = await startGo('ligneous');
  library = 'ligneous-gedcom-lib'; task = 'check';
  // The timed call returns the result as a JSON string, as on the site.
  // The site's JSON.parse of that string is not timed here (nor natively).
  run = u8 => api.check(u8);
  info = s => {
    const res = JSON.parse(s);
    if (res.error) return { individuals: 0, families: 0, error: res.error };
    return { individuals: res.summary.people, families: res.summary.families, findings: res.findings.length, error: '' };
  };
} else if (lib === 'read-gedcom') {
  const { readGedcom } = require('read-gedcom');
  library = 'read-gedcom'; task = 'parse';
  // readGedcom takes an ArrayBuffer. The copy out of the file's bytes is
  // inside the timed call, as our wasm copies its input on every call, and
  // so is counting the records, as for every parse.
  run = u8 => {
    const g = readGedcom(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    return { individuals: g.getIndividualRecord().length, families: g.getFamilyRecord().length, error: '' };
  };
  info = v => v;
  // The memory run keeps the tree, so the heap it holds can be measured.
  memRun = u8 => readGedcom(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
} else {
  console.error('unknown --lib ' + lib);
  process.exit(2);
}

for (const file of files) {
  const u8 = new Uint8Array(fs.readFileSync(file));
  const out = { task, library, runtime: 'node-' + (lib === 'read-gedcom' ? 'js' : 'wasm'), file: path.basename(file), bytes: u8.length, individuals: 0, families: 0, error: '' };
  console.error(`node ${lib}: ${out.file}`);
  const times = [];
  let last;
  try {
    beforeRun();
    last = info(run(u8)); // warm-up
    if (!last.error) {
      for (let i = 0; i < runs; i++) {
        beforeRun();
        const t0 = performance.now();
        const v = run(u8);
        times.push(performance.now() - t0);
        last = info(v);
        if (last.error) break;
      }
    }
  } catch (e) {
    last = { individuals: 0, families: 0, error: String(e && e.message || e) };
  }
  Object.assign(out, { individuals: last.individuals, families: last.families, error: last.error || undefined });
  if (last.findings !== undefined) out.findings = last.findings;
  Object.assign(out, summarize(times));
  // Memory: one more untimed run, then read process.memoryUsage().
  if (!last.error) {
    last = null;
    beforeRun();
    const m0 = process.memoryUsage();
    const res = (memRun ?? run)(u8);
    const m1 = process.memoryUsage();
    out.memory = {
      rssMiB: r2(m1.rss / MB),
      heapUsedDeltaMiB: r2((m1.heapUsed - m0.heapUsed) / MB),
      wasmLinearMemoryMiB: wasmMemory ? r2(wasmMemory.buffer.byteLength / MB) : undefined,
      note: lib === 'read-gedcom'
        ? 'heapUsedDelta = JS heap still held by the returned tree after the call; rss = process total'
        : 'wasmLinearMemory = Go heap size after the run (it never shrinks, so it is the peak so far); rss = process total',
    };
    void res;
  } else {
    out.memory = null;
  }
  console.log(JSON.stringify(out));
}
process.exit(0);
