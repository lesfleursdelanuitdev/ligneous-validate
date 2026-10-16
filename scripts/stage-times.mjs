// Usage: node scripts/stage-times.mjs <file>...
// Times each stage the checker reports (check and repair) in the wasm build,
// as shares of the whole call. The weights in web/src/progress.ts come from this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2);
if (files.length === 0) { console.error('usage: stage-times.mjs <file>...'); process.exit(2); }
createRequire(import.meta.url)(path.join(root, 'web/public/wasm_exec.js'));
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, 'web/src/wasm/ligneous.wasm')), go.importObject);
go.run(instance);
for (let i = 0; i < 200 && !globalThis.ligneousReady; i++) await new Promise(r => setTimeout(r, 10));

function timed(run) {
  const marks = [];
  const t0 = performance.now();
  run(s => marks.push([s, performance.now()]));
  const end = performance.now();
  const total = end - t0;
  const rows = marks.map(([s, t], i) => [s, (i + 1 < marks.length ? marks[i + 1][1] : end) - t]);
  return `${Math.round(total)} ms: ` + rows.map(([s, ms]) => `${s} ${(100 * ms / total).toFixed(1)}%`).join(', ');
}
for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(f));
  console.log(`${path.basename(f)} ${(bytes.length / 1e6).toFixed(1)} MB`);
  console.log('  check  ' + timed(p => JSON.parse(globalThis.ligneous.check(bytes, p))));
  console.log('  repair ' + timed(p => globalThis.ligneous.repair(bytes, { errors: 0, warnings: 0, hints: 0 }, p)));
}
process.exit(0);
