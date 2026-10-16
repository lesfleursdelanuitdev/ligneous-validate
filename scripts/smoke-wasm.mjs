// Usage: node scripts/smoke-wasm.mjs <file>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const args = process.argv.slice(2);
const doRepair = args.includes('--repair');
const file = args.find(a => a !== '--repair');
if (!file) { console.error('usage: smoke-wasm.mjs <file>'); process.exit(2); }

const wasmPath = path.join(root, 'web/src/wasm/ligneous.wasm');
const execPath = path.join(root, 'web/public/wasm_exec.js');
if (!fs.existsSync(wasmPath) || !fs.existsSync(execPath)) {
  console.error('missing ' + wasmPath + ' or wasm_exec.js; run scripts/build-wasm.sh');
  process.exit(1);
}
createRequire(import.meta.url)(execPath); // defines globalThis.Go
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), go.importObject);
go.run(instance); // runs until exit; main blocks forever
for (let i = 0; i < 100 && !globalThis.ligneousReady; i++) await new Promise(r => setTimeout(r, 10));
if (!globalThis.ligneousReady) { console.error('ligneous never became ready'); process.exit(1); }

const bytes = new Uint8Array(fs.readFileSync(file));
const t0 = performance.now();
const res = JSON.parse(globalThis.ligneous.check(bytes));
const ms = Math.round(performance.now() - t0);
if (res.error) { console.error('error: ' + res.error); process.exit(1); }
console.log('file', path.basename(file));
console.log('isGedcom', res.isGedcom);
console.log('people', res.summary?.people ?? 0);
console.log('findings', (res.findings || []).length);
console.log('time', ms + ' ms');

if (doRepair) {
  const r = globalThis.ligneous.repair(bytes);
  const out = JSON.parse(r.json);
  if (out.error) { console.error('repair error: ' + out.error); process.exit(1); }
  console.log('repair changes', out.changes.length, 'data bytes', r.data.length);
  console.log('before', JSON.stringify(out.before));
  console.log('after', JSON.stringify(out.after));
}
