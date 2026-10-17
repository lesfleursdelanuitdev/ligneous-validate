// Merges the runners' JSON lines into results/<stamp>.json and writes the
// Markdown tables to results/<stamp>.md.
//
// Usage: node report.mjs --work DIR --out DIR --stamp STAMP
//   DIR/*.jsonl  runner output;  DIR/env.json  environment;
//   DIR/inputs/  the input files (expected counts are taken from them).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const work = opt('--work');
const outDir = opt('--out');
const stamp = opt('--stamp');
const inputs = path.join(work, 'inputs');

const FILES = ['minimal551.ged', 'royal92.ged', 'pres2020.ged', 'indented2.ged', 'synth20.ged', 'synth50.ged'];

// Expected counts: level-0 INDI and FAM records, counted line by line from the
// raw bytes (all inputs are ASCII-compatible), independent of every library.
function countRecords(file) {
  const b = fs.readFileSync(file);
  let ind = 0, fam = 0;
  const text = b.toString('latin1');
  const re = /^[ \t]*0[ \t]+@[^@\r\n]+@[ \t]+(INDI|FAM)[ \t]*\r?$/gm;
  for (const m of text.matchAll(re)) m[1] === 'INDI' ? ind++ : fam++;
  return { individuals: ind, families: fam, bytes: b.length };
}
const expected = {};
for (const f of FILES) if (fs.existsSync(path.join(inputs, f))) expected[f] = countRecords(path.join(inputs, f));
const gen = JSON.parse(fs.readFileSync(path.join(inputs, 'expected.json'), 'utf8'));
for (const [f, c] of Object.entries(gen)) {
  if (expected[f].individuals !== c.individuals || expected[f].families !== c.families) {
    throw new Error(`line count of ${f} disagrees with the generator: ${JSON.stringify(expected[f])} vs ${JSON.stringify(c)}`);
  }
}

const results = [];
for (const f of fs.readdirSync(work).filter(f => f.endsWith('.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(work, f), 'utf8').split('\n')) {
    if (line.trim()) results.push(JSON.parse(line));
  }
}
for (const r of results) {
  const e = expected[r.file];
  r.expected = e ? { individuals: e.individuals, families: e.families } : null;
  if (r.skipped) r.status = 'did not finish';
  else if (r.error) r.status = 'invalid: error';
  else if (!e || r.individuals !== e.individuals || r.families !== e.families) r.status = 'invalid: wrong counts';
  else r.status = 'valid';
}
const env = JSON.parse(fs.readFileSync(path.join(work, 'env.json'), 'utf8'));
const chromium = results.find(r => r.chromium)?.chromium;
if (chromium) env.chromium = chromium;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, stamp + '.json'), JSON.stringify({ env, expected, results }, null, 2) + '\n');

// ---- Markdown ----
const find = (task, library, runtime, file, variant) =>
  results.find(r => r.task === task && r.library === library && r.runtime === runtime && r.file === file && (!variant || r.variant === variant));
const fmt = ms => ms >= 100 ? Math.round(ms).toLocaleString('en-US') : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2);
const cell = r => {
  if (!r) return 'not run';
  if (r.status === 'did not finish') return 'did not finish';
  if (r.status !== 'valid') return `**${r.status.toUpperCase()}**`;
  return `${fmt(r.medianMs)} (${fmt(r.minMs)}–${fmt(r.maxMs)})`;
};
const size = f => {
  const b = expected[f]?.bytes ?? 0;
  return b < 1 << 20 ? `${(b / 1024).toFixed(1)} KiB` : `${(b / (1 << 20)).toFixed(1)} MiB`;
};
const lines = [];
const p = s => lines.push(s);
p(`# GEDCOM benchmark results, ${stamp}`);
p('');
p(`Host: ${env.nproc} CPUs (${env.cpu}), load average ${env.loadStart} at start and ${env.loadEnd} at end. ` +
  `Library ${env.libraries['ligneous-gedcom-lib']}. Go ${env.go}, Node ${env.node}, Chromium ${env.chromium ?? 'n/a'}. Date ${env.date}. ` +
  `Shared server: the numbers are indicative.`);
p('');
p(`Times are milliseconds: median (min–max) of ${env.runs} timed runs after one warm-up. ` +
  `INVALID means the library failed or found the wrong number of people or families (see the correctness table).`);
p('');
p('## Parse only (bytes in, in-memory tree out)');
p('');
const parseCols = [
  ['ligneous-gedcom-lib', 'go-native', 'ours, Go'],
  ['gedcom-go', 'go-native', 'gedcom-go, Go'],
  ['ligneous-gedcom-lib', 'node-wasm', 'ours, Node wasm'],
  ['read-gedcom', 'node-js', 'read-gedcom, Node'],
  ['ligneous-gedcom-lib', 'chromium-worker-wasm', 'ours, Chromium wasm'],
  ['read-gedcom', 'chromium-worker-js', 'read-gedcom, Chromium'],
];
p('| File | Size | ' + parseCols.map(c => c[2]).join(' | ') + ' |');
p('|---|---:|' + parseCols.map(() => '---:').join('|') + '|');
for (const f of FILES) p(`| ${f} | ${size(f)} | ` + parseCols.map(([l, rt]) => cell(find('parse', l, rt, f))).join(' | ') + ' |');
p('');
p('## Full check (the site\'s check.Check: decode, parse, validate with DateConsistency, enrich, findings, JSON)');
p('');
p('| File | Size | Go native | Node wasm | Chromium worker wasm | Node / Go | Chromium / Go |');
p('|---|---:|---:|---:|---:|---:|---:|');
const ratio = (a, b) => (a && b && a.status === 'valid' && b.status === 'valid') ? (a.medianMs / b.medianMs).toFixed(1) + '×' : 'n/a';
for (const f of FILES) {
  const g = find('check', 'ligneous-gedcom-lib', 'go-native', f);
  const n = find('check', 'ligneous-gedcom-lib', 'node-wasm', f);
  const c = find('check', 'ligneous-gedcom-lib', 'chromium-worker-wasm', f);
  p(`| ${f} | ${size(f)} | ${cell(g)} | ${cell(n)} | ${cell(c)} | ${ratio(n, g)} | ${ratio(c, g)} |`);
}
p('');
p('## Validation of an already-parsed tree, Go native (indicative only: the two libraries check different things)');
p('');
p('| File | ours: ValidateWithOptions (DateConsistency) | findings | gedcom-go: ValidateAll | findings | gedcom-go: ValidateAll minus duplicates | findings |');
p('|---|---:|---:|---:|---:|---:|---:|');
for (const f of FILES) {
  const o = find('validate', 'ligneous-gedcom-lib', 'go-native', f);
  const a = find('validate', 'gedcom-go', 'go-native', f, 'ValidateAll');
  const d = find('validate', 'gedcom-go', 'go-native', f, 'ValidateAll minus duplicates');
  const fc = r => r && r.status === 'valid' ? r.findings ?? 0 : '–';
  const ac = a && a.note ? cell(a) + ' †' : cell(a);
  p(`| ${f} | ${cell(o)} | ${fc(o)} | ${ac} | ${fc(a)} | ${cell(d)} | ${fc(d)} |`);
}
const notes = results.filter(r => r.note);
if (notes.length) { p(''); for (const r of notes) p(`† ${r.file}: ${r.note}.`); }
const dnf = results.filter(r => r.status === 'did not finish');
if (dnf.length) { p(''); for (const r of dnf) p(`Did not finish: ${r.library} ${r.variant ?? ''} on ${r.file}: ${r.error}.`); }
p('');
p('## Correctness');
p('');
p('Expected counts come from counting level-0 `INDI` and `FAM` lines in each file.');
p('');
p('| Task | Library | Runtime | File | Individuals (expected) | Families (expected) | Status | Error |');
p('|---|---|---|---|---:|---:|---|---|');
for (const r of results) {
  const e = r.expected ?? {};
  p(`| ${r.task}${r.variant ? ' (' + r.variant + ')' : ''} | ${r.library} | ${r.runtime} | ${r.file} | ${r.individuals} (${e.individuals}) | ${r.families} (${e.families}) | ${r.status} | ${(r.error ?? '').replace(/\|/g, '\\|').slice(0, 160)} |`);
}
p('');
p('## Memory');
p('');
p('Go: TotalAlloc (all bytes allocated) and peak HeapInuse above the baseline, from one extra untimed run. ' +
  'Node wasm and Chromium wasm: the Go heap\'s linear memory after the runs (it never shrinks, so it is the peak). ' +
  'Sizes and memory are in MiB (2^20 bytes). Node JS: JS heap still held after the call. Chromium JS: n/a (performance.memory is not exposed in a worker).');
p('');
p('| Task | Library | Runtime | File | Memory |');
p('|---|---|---|---|---|');
for (const r of results) {
  const m = r.memory;
  let s = 'n/a';
  if (m && m.totalAllocMiB !== undefined) s = `TotalAlloc ${m.totalAllocMiB} MiB, peak HeapInuse ${m.peakHeapInuseMiB} MiB`;
  else if (m && m.wasmLinearMemoryMiB !== undefined) s = `wasm memory ${m.wasmLinearMemoryMiB} MiB` + (m.rssMiB ? `, process RSS ${m.rssMiB} MiB` : '');
  else if (m && m.heapUsedDeltaMiB !== undefined) s = `JS heap held ${m.heapUsedDeltaMiB} MiB, process RSS ${m.rssMiB} MiB`;
  if (r.status !== 'valid') continue;
  p(`| ${r.task}${r.variant ? ' (' + r.variant + ')' : ''} | ${r.library} | ${r.runtime} | ${r.file} | ${s} |`);
}
fs.writeFileSync(path.join(outDir, stamp + '.md'), lines.join('\n') + '\n');
console.log(path.join(outDir, stamp + '.md'));
