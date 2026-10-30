// Usage: node scripts/enrich-browser.mjs [--runs N] <file>...
// Times the tree viewer's read of each file in headless Chromium, through the
// site's own built worker (web/dist: run `npm run build` first): from posting
// {type: 'enrich'} to the page holding the tree (the worker's enrich() call,
// JSON.parse, the conversion, and the copy of the tree back to the page). Each
// run uses a fresh worker, started before the timer. One warm-up, then N timed
// runs (default 5), median (min-max) in milliseconds.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');
const args = process.argv.slice(2);
const i = args.indexOf('--runs');
const runs = i < 0 ? 5 : Number(args.splice(i, 2)[1]);
const files = args.map(f => path.resolve(f));
if (files.length === 0) { console.error('usage: enrich-browser.mjs [--runs N] <file>...'); process.exit(2); }

const dist = path.join(root, 'web/dist');
const worker = fs.readdirSync(path.join(dist, 'assets')).find(f => /^worker-.*\.js$/.test(f));
if (!worker) { console.error('no worker in web/dist/assets: run npm run build'); process.exit(1); }
const types = { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.css': 'text/css', '.woff2': 'font/woff2' };
// Only web/dist and the files named are served.
const inputs = new Map(files.map((f, n) => [`/inputs/${n}.ged`, f]));
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = inputs.get(url);
  if (!file) {
    const p = path.join(dist, url === '/' ? 'index.html' : url);
    if (p.startsWith(dist + path.sep)) file = p;
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const cached = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (fs.existsSync(cached) ? cached : undefined) });
console.log(`chromium ${browser.version()}, ${runs} timed runs after one warm-up`);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const fmt = xs => `${Math.round(median(xs))} (${Math.round(Math.min(...xs))}-${Math.round(Math.max(...xs))})`;
try {
  const page = await browser.newPage();
  await page.goto(base + '/');
  for (const [url, file] of inputs) {
    const all = [];
    for (let run = 0; run <= runs; run++) {
      all.push(await page.evaluate(async ([workerUrl, inputUrl]) => {
        const bytes = await (await fetch(inputUrl)).arrayBuffer();
        const w = new Worker(workerUrl, { type: 'module' });
        await new Promise((ok, fail) => w.addEventListener('message', e => {
          if (e.data.type === 'ready') ok();
          if (e.data.type === 'error') fail(new Error(e.data.message));
        }));
        const marks = [];
        const t0 = performance.now();
        const result = await new Promise(ok => {
          w.addEventListener('message', e => {
            if (e.data.type === 'stage') marks.push([e.data.stage, performance.now()]);
            if (e.data.type === 'enriched') ok(e.data.result);
          });
          w.postMessage({ type: 'enrich', bytes }, [bytes]);
        });
        const t1 = performance.now();
        w.terminate();
        const stages = Object.fromEntries(marks.map(([s, t], n) => [s, (n + 1 < marks.length ? marks[n + 1][1] : t1) - t]));
        return {
          ms: t1 - t0, stages, error: result.error ?? '',
          people: result.graph.people.length, unions: result.graph.unions.length, details: result.details.people.size,
        };
      }, [`/assets/${worker}`, url]));
    }
    const [warm, ...timed] = all;
    if (warm.error) { console.error(`${file}: ${warm.error}`); process.exit(1); }
    const stageNames = Object.keys(warm.stages);
    console.log(`${path.basename(file)}: ${warm.people} people incl. placeholders, ${warm.unions} families, ${warm.details} details`);
    console.log(`  ready in ${fmt(timed.map(r => r.ms))} ms; from each stage to the next: ` +
      stageNames.map(s => `${s} ${fmt(timed.map(r => r.stages[s]))}`).join(', '));
  }
} finally {
  await browser.close();
  server.close();
}
