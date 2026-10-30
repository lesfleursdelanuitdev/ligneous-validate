// Usage: node --expose-gc scripts/enrich-times.mjs [--runs N] [--tables] <file>...
// Times the tree viewer's read of each file in the wasm build under Node:
// ligneous.enrich() (with its stages), JSON.parse, reading the compact tables
// back (web/src/tree/tables.ts), the conversion (graph.ts) and the starting
// person (start.ts), and gives the size of the JSON. One warm-up, then N
// timed runs (default 5), median (min-max), gc() between runs. --tables also
// prints each table's share of the JSON.
//
// The Go heap (wasm linear memory) never shrinks, so the size printed after a
// file is the largest any run has needed so far. For one read's own peak, as
// the page has it (it starts a fresh worker for each file), give one file and
// --runs 0: that read alone, timed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildGraph } from '../web/src/tree/graph.ts';
import { suggestStart } from '../web/src/tree/start.ts';
import { readEnriched } from '../web/src/tree/tables.ts';
import { timelineFor, timelineSource } from '../web/src/tree/timeline.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return undefined; return args.splice(i, name === '--tables' ? 1 : 2)[1] ?? true; };
const runs = Number(flag('--runs') ?? 5);
const tables = flag('--tables') !== undefined;
const files = args;
if (files.length === 0) { console.error('usage: enrich-times.mjs [--runs N] [--tables] <file>...'); process.exit(2); }

createRequire(import.meta.url)(path.join(root, 'web/public/wasm_exec.js'));
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, 'web/src/wasm/ligneous.wasm')), go.importObject);
go.run(instance);
for (let i = 0; i < 200 && !globalThis.ligneousReady; i++) await new Promise(r => setTimeout(r, 10));
if (!globalThis.ligneousReady) { console.error('ligneous never became ready'); process.exit(1); }

const thisYear = new Date().getFullYear();
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const fmt = xs => `${Math.round(median(xs))} (${Math.round(Math.min(...xs))}-${Math.round(Math.max(...xs))})`;
const mib = n => (n / 2 ** 20).toFixed(2) + ' MiB';
const goHeap = () => instance.exports.mem.buffer.byteLength;

function once(bytes) {
  const marks = [];
  const t0 = performance.now();
  const json = globalThis.ligneous.enrich(bytes, s => marks.push([s, performance.now()]));
  const t1 = performance.now();
  const parsed = JSON.parse(json);
  const t2 = performance.now();
  const enriched = readEnriched(parsed);
  const t3 = performance.now();
  const tree = buildGraph(enriched, { thisYear });
  const t4 = performance.now();
  const start = suggestStart(tree.graph, enriched.home);
  const t5 = performance.now();
  // After the tree is posted, the worker indexes the timelines (not in "ready").
  const source = timelineSource(enriched, tree);
  const t6 = performance.now();
  const ids = tree.graph.people.filter(p => p.xref !== null).map(p => p.id);
  let events = 0;
  for (let i = 0; i < 1000 && ids.length > 0; i++) events += timelineFor(ids[(i * 7919) % ids.length], source, { hideLiving: false }).length;
  const t7 = performance.now();
  const stages = Object.fromEntries(marks.map(([s, t], i) => [s, (i + 1 < marks.length ? marks[i + 1][1] : t1) - t]));
  return { json, parsed, tree, start, enrich: t1 - t0, parse: t2 - t1, read: t3 - t2, graph: t4 - t3, start_: t5 - t4, total: t5 - t0,
    index: t6 - t5, per1000: t7 - t6, events, stages };
}

for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(f));
  const warm = once(bytes);
  if (warm.parsed.error) { console.error(`${f}: ${warm.parsed.error}`); process.exit(1); }
  const jsonBytes = Buffer.byteLength(warm.json);
  const people = warm.tree.graph.people.filter(p => p.xref !== null).length;
  const placeholders = warm.tree.graph.people.length - people;
  const living = warm.tree.graph.people.filter(p => p.xref !== null && p.isLiving).length;
  const t = { enrich: [], parse: [], read: [], graph: [], start_: [], total: [], index: [], per1000: [] };
  const stageT = {};
  for (let i = 0; i < Math.max(runs, 1); i++) {
    globalThis.gc?.();
    const r = i === 0 && runs === 0 ? warm : once(bytes);
    for (const k of Object.keys(t)) t[k].push(r[k]);
    for (const [s, ms] of Object.entries(r.stages)) (stageT[s] ??= []).push(ms);
  }
  console.log(`${path.basename(f)}: ${mib(bytes.length)}, ${people} people (${living} living), ${warm.tree.graph.unions.length} families, ${placeholders} placeholders; start ${JSON.stringify(warm.start)}`);
  console.log(`  JSON ${jsonBytes} bytes (${mib(jsonBytes)}); parse findings ${JSON.stringify(warm.parsed.parseFindings)}`);
  console.log(`  ms, median (min-max) of ${runs || 'the one read'}: enrich() ${fmt(t.enrich)}, JSON.parse ${fmt(t.parse)}, tables read back ${fmt(t.read)}, ` +
    `graph ${fmt(t.graph)}, start ${fmt(t.start_)}, ready ${fmt(t.total)}`);
  console.log('  inside enrich(): ' + Object.entries(stageT).map(([s, xs]) => `${s} ${fmt(xs)}`).join(', '));
  console.log(`  after ready: timeline index ${fmt(t.index)} ms; 1,000 timelines ${fmt(t.per1000)} ms (${warm.events} events)`);
  console.log(`  Go heap (wasm linear memory) so far: ${mib(goHeap())}`);
  if (tables) {
    const rows = Object.entries(warm.parsed.tables)
      .map(([name, table]) => [name, table.rows.length, Buffer.byteLength(JSON.stringify(table))])
      .sort((a, b) => b[2] - a[2]);
    for (const [name, n, size] of rows) console.log(`    ${name.padEnd(20)} ${String(n).padStart(8)} rows ${String(size).padStart(11)} bytes ${(100 * size / jsonBytes).toFixed(1).padStart(5)}%`);
  }
}
process.exit(0);
