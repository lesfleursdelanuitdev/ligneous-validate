// Browser runner: serves the benchmark from a local static server and drives
// headless Chromium through Playwright. Each (library, file) runs in a fresh
// Web Worker. Prints one JSON object per result on stdout.
//
// Usage: node browser/run.mjs --runs N --inputs DIR --libs a,b,c FILE...
//   FILE names are basenames inside --inputs.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, '..');
const site = path.join(bench, '..');
const require = createRequire(path.join(site, 'package.json'));
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const runs = Number(opt('--runs') ?? 10);
const inputs = opt('--inputs');
const libs = (opt('--libs') ?? 'ours-parse,read-gedcom,ours-check').split(',');
const files = argv;
// CHROMIUM, else the cached headless shell this server has, else whatever
// Playwright installed (npx playwright install chromium-headless-shell).
const cached = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const executablePath = process.env.CHROMIUM ?? (fs.existsSync(cached) ? cached : undefined);

// URL prefix -> directory. Nothing outside these is served.
const roots = {
  '/browser/': here,
  '/build/': path.join(bench, 'build'),
  '/inputs/': inputs,
};
const types = { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.ged': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = null;
  if (url === '/' || url === '/index.html') file = path.join(here, 'index.html');
  else for (const [prefix, dir] of Object.entries(roots)) {
    if (url.startsWith(prefix)) {
      const p = path.join(dir, url.slice(prefix.length));
      if (p.startsWith(dir + path.sep)) file = p;
    }
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath,
  // --expose-gc lets the worker call gc() between runs, as Node does.
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const version = browser.version();
console.error('chromium ' + version);
try {
  const page = await browser.newPage();
  page.on('console', m => console.error('page: ' + m.text()));
  await page.goto(base);
  for (const lib of libs) {
    for (const file of files) {
      console.error(`browser ${lib}: ${file}`);
      const r = await page.evaluate(([l, f, n]) => window.runOne(l, f, n), [lib, file, runs]);
      const task = lib === 'ours-check' ? 'check' : 'parse';
      const library = lib === 'read-gedcom' ? 'read-gedcom' : 'ligneous-gedcom-lib';
      const runtime = lib === 'read-gedcom' ? 'chromium-worker-js' : 'chromium-worker-wasm';
      console.log(JSON.stringify({ task, library, runtime, chromium: version, ...r }));
    }
  }
} finally {
  await browser.close();
  server.close();
}
