// Usage: node --expose-gc scripts/enrich-times.mjs [--runs N] [--tables] <file>...
// Times the tree viewer's read of each file in the wasm build under Node:
// ligneous.enrich() (with its stages), JSON.parse, the shape check and the
// conversion (web/src/tree/graph.ts), and gives the size of the JSON. One
// warm-up, then N timed runs (default 5), median (min-max), gc() between runs.
// --tables also prints each table's share of the JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildGraph } from '../web/src/tree/graph.ts';
import { readEnriched } from '../web/src/tree/tables.ts';

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

function once(bytes) {
  const marks = [];
  const t0 = performance.now();
  const json = globalThis.ligneous.enrich(bytes, s => marks.push([s, performance.now()]));
  const t1 = performance.now();
  const parsed = JSON.parse(json);
  const t2 = performance.now();
  const enriched = readEnriched(parsed);
  const tree = buildGraph(enriched, { thisYear });
  const t3 = performance.now();
  const stages = Object.fromEntries(marks.map(([s, t], i) => [s, (i + 1 < marks.length ? marks[i + 1][1] : t1) - t]));
  return { json, parsed, tree, enrich: t1 - t0, parse: t2 - t1, graph: t3 - t2, total: t3 - t0, stages };
}

for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(f));
  const warm = once(bytes);
  if (warm.parsed.error) { console.error(`${f}: ${warm.parsed.error}`); process.exit(1); }
  const jsonBytes = Buffer.byteLength(warm.json);
  const people = warm.tree.graph.people.filter(p => p.xref !== null).length;
  const placeholders = warm.tree.graph.people.length - people;
  const living = warm.tree.graph.people.filter(p => p.isLiving).length;
  const t = { enrich: [], parse: [], graph: [], total: [] };
  const stageT = {};
  for (let i = 0; i < runs; i++) {
    globalThis.gc?.();
    const r = once(bytes);
    for (const k of Object.keys(t)) t[k].push(r[k]);
    for (const [s, ms] of Object.entries(r.stages)) (stageT[s] ??= []).push(ms);
  }
  console.log(`${path.basename(f)}: ${mib(bytes.length)}, ${people} people, ${warm.tree.graph.unions.length} families, ${placeholders} placeholders, ${living} living`);
  console.log(`  JSON ${jsonBytes} bytes (${mib(jsonBytes)}); parse findings ${JSON.stringify(warm.parsed.parseFindings)}`);
  console.log(`  ms, median (min-max) of ${runs}: enrich() ${fmt(t.enrich)}, JSON.parse ${fmt(t.parse)}, check + graph ${fmt(t.graph)}, ready ${fmt(t.total)}`);
  console.log('  inside enrich(): ' + Object.entries(stageT).map(([s, xs]) => `${s} ${fmt(xs)}`).join(', '));
  if (tables) {
    const rows = Object.entries(warm.parsed.tables)
      .map(([name, rows]) => [name, rows.length, Buffer.byteLength(JSON.stringify(rows))])
      .sort((a, b) => b[2] - a[2]);
    for (const [name, n, size] of rows) console.log(`    ${name.padEnd(20)} ${String(n).padStart(8)} rows ${String(size).padStart(11)} bytes ${(100 * size / jsonBytes).toFixed(1).padStart(5)}%`);
  }
}
console.log(`wasm linear memory at the end: ${mib(instance.exports.mem.buffer.byteLength)}`);
process.exit(0);
