// Usage: node scripts/enrich-browser.mjs [--runs N] [--memory] <file>...
// Times the tree viewer's read of each file in headless Chromium, through the
// site's own built worker (web/dist: run `npm run build` first), on a blank
// page of the same origin with the site's CSP: from posting {type: 'enrich'}
// to the page holding the tree (the worker's enrich() call, JSON.parse, the
// tables read back, the conversion, the starting person, and the copy of the
// tree to the page). Each run uses a fresh worker, started before the timer.
// One warm-up, then N timed runs (default 5), median (min-max) in ms.
//
// It also gives the page's longest main-thread task during each run (Long
// Tasks API: every task over 50 ms; 0 means none was over 50 ms).
//
// --memory: instead, for each file, one read in a fresh browser, then the
// renderer process's peak resident memory (VmHWM in /proc; the page and its
// worker share the renderer), with the same for a page whose worker is ready
// but has read nothing. Linux only.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');
const args = process.argv.slice(2);
const take = name => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, name === '--memory' ? 1 : 2).at(-1); };
const runs = Number(take('--runs') ?? 5);
const memory = take('--memory') !== undefined;
const files = args.map(f => path.resolve(f));
if (files.length === 0) { console.error('usage: enrich-browser.mjs [--runs N] [--memory] <file>...'); process.exit(2); }

const dist = path.join(root, 'web/dist');
const worker = fs.readdirSync(path.join(dist, 'assets')).find(f => /^worker-.*\.js$/.test(f));
if (!worker) { console.error('no worker in web/dist/assets: run npm run build'); process.exit(1); }
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'))?.[1];
if (!csp) { console.error('no CSP in web/dist/index.html'); process.exit(1); }
const blank = `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>blank</title>`;
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
// Only the blank page, web/dist/assets, Go's loader and the files named are served.
const inputs = new Map(files.map((f, n) => [`/inputs/${n}.ged`, f]));
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(blank); return; }
  let file = url === '/wasm_exec.js' ? path.join(dist, 'wasm_exec.js') : inputs.get(url);
  if (!file && url.startsWith('/assets/')) {
    const p = path.join(dist, url);
    if (p.startsWith(path.join(dist, 'assets') + path.sep)) file = p;
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const cached = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const executablePath = process.env.CHROMIUM ?? (fs.existsSync(cached) ? cached : undefined);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const fmt = xs => `${Math.round(median(xs))} (${Math.round(Math.min(...xs))}-${Math.round(Math.max(...xs))})`;
const mib = kib => (kib / 1024).toFixed(0) + ' MiB';

/** In the page: one read of inputUrl by a fresh worker (or none, for the baseline). */
async function readOnce(page, inputUrl) {
  return page.evaluate(async ([workerUrl, url]) => {
    const w = new Worker(workerUrl, { type: 'module' });
    await new Promise((ok, fail) => w.addEventListener('message', e => {
      if (e.data.type === 'ready') ok();
      if (e.data.type === 'error') fail(new Error(e.data.message));
    }));
    if (url === null) return { ready: true };
    const bytes = await (await fetch(url)).arrayBuffer();
    const tasks = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) tasks.push(e); });
    observer.observe({ type: 'longtask' });
    const marks = [];
    // The tree comes in parts (web/src/tree/parts.ts); each is joined as it
    // arrives, as treeAssembler does, so the joining is in the timed tasks.
    const people = [];
    const unions = [];
    const details = new Map();
    const familyDetails = new Map();
    const famcOrder = new Map();
    const famsOrder = new Map();
    let parts = 0;
    const t0 = performance.now();
    const result = await new Promise(ok => {
      w.addEventListener('message', e => {
        const m = e.data;
        if (m.type === 'stage') marks.push([m.stage, performance.now()]);
        if (m.type === 'tree-part') {
          parts++;
          if (m.part.kind === 'people') for (const r of m.part.rows) people.push(r);
          if (m.part.kind === 'unions') for (const r of m.part.rows) unions.push(r);
          if (m.part.kind === 'personDetails') for (const [k, v] of m.part.rows) details.set(k, v);
          if (m.part.kind === 'familyDetails') for (const [k, v] of m.part.rows) familyDetails.set(k, v);
          if (m.part.kind === 'famcOrder') for (const [k, v] of m.part.rows) famcOrder.set(k, v);
          if (m.part.kind === 'famsOrder') for (const [k, v] of m.part.rows) famsOrder.set(k, v);
        }
        if (m.type === 'enriched') ok({ ...m.summary, graph: { people, unions } });
      });
      w.postMessage({ type: 'enrich', bytes }, [bytes]);
    });
    const t1 = performance.now();
    await new Promise(r => setTimeout(r, 200)); // let the observer hear of the last task
    observer.disconnect();
    w.terminate();
    const during = tasks.filter(e => e.startTime + e.duration >= t0 && e.startTime <= t1 + 200);
    const stages = Object.fromEntries(marks.map(([s, t], n) => [s, (n + 1 < marks.length ? marks[n + 1][1] : t1) - t]));
    return {
      ms: t1 - t0, stages, error: result.error ?? '', start: result.start,
      people: result.graph.people.length, unions: result.graph.unions.length,
      longest: Math.max(0, ...during.map(e => e.duration)), longTasks: during.length, stageMessages: marks.length,
      parts: `${parts} of ${result.parts}`,
    };
  }, [`/assets/${worker}`, inputUrl]);
}

/** Peak resident memory (KiB) of each renderer process under the browser that has `tag` in its command line. */
function rendererPeaks(tag) {
  const procs = [];
  for (const pid of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
    try {
      // Chromium rewrites its process titles as one string, so this is matched as text.
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
      const ppid = Number(/^PPid:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]);
      const hwm = Number(/^VmHWM:\s+(\d+) kB/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
      procs.push({ pid: Number(pid), ppid, cmd, hwm });
    } catch { /* the process ended while being read */ }
  }
  const top = procs.find(p => p.cmd.includes(tag) && !p.cmd.includes(' --type='));
  if (!top) throw new Error('browser process not found');
  const under = new Set([top.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) if (!under.has(p.pid) && under.has(p.ppid)) { under.add(p.pid); grew = true; }
  }
  return procs.filter(p => under.has(p.pid) && p.cmd.includes('--type=renderer')).map(p => p.hwm);
}

async function fresh(run) {
  const tag = `--enrich-measure-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const browser = await chromium.launch({ executablePath, args: [tag] });
  try {
    const page = await browser.newPage();
    await page.goto(base + '/');
    return { version: browser.version(), ...(await run(page)), peaks: rendererPeaks(tag) };
  } finally {
    await browser.close();
  }
}

try {
  if (memory) {
    const idle = await fresh(page => readOnce(page, null));
    console.log(`chromium ${idle.version}; renderer peak RSS (VmHWM), one read per fresh browser`);
    console.log(`  a worker ready, nothing read: ${mib(Math.max(...idle.peaks))}`);
    for (const [url, file] of inputs) {
      const r = await fresh(page => readOnce(page, url));
      if (r.error) { console.error(`${file}: ${r.error}`); process.exit(1); }
      const size = fs.statSync(file).size / 2 ** 20;
      console.log(`  ${path.basename(file)} (${size.toFixed(2)} MiB, ${r.people} people incl. placeholders): ${mib(Math.max(...r.peaks))} (ready in ${Math.round(r.ms)} ms)`);
    }
  } else {
    const browser = await chromium.launch({ executablePath });
    console.log(`chromium ${browser.version()}, ${runs} timed runs after one warm-up`);
    try {
      const page = await browser.newPage();
      await page.goto(base + '/');
      for (const [url, file] of inputs) {
        const all = [];
        for (let run = 0; run <= runs; run++) all.push(await readOnce(page, url));
        const [warm, ...timed] = all;
        if (warm.error) { console.error(`${file}: ${warm.error}`); process.exit(1); }
        console.log(`${path.basename(file)}: ${warm.people} people incl. placeholders, ${warm.unions} families, ${warm.parts} parts, start ${JSON.stringify(warm.start)}`);
        console.log(`  ready in ${fmt(timed.map(r => r.ms))} ms; from each stage to the next: ` +
          Object.keys(warm.stages).map(s => `${s} ${fmt(timed.map(r => r.stages[s]))}`).join(', '));
        console.log(`  longest main-thread task ${fmt(timed.map(r => r.longest))} ms; tasks over 50 ms per run: ${fmt(timed.map(r => r.longTasks))}; ` +
          `stage messages received during the read: ${warm.stageMessages}`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
