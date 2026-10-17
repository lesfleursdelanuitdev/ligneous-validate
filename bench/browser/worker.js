// Benchmark worker: one library, one file, then it reports and is thrown away.
// Message in: {lib, file, runs}. Message out: one result object.
//   lib = ours-parse   bench wasm, ligneousBench.parse(u8)
//         ours-check   site wasm, ligneous.check(u8), as in the site's worker
//         read-gedcom  readGedcom(arrayBuffer), bundled by Vite
// Timing uses performance.now() inside the worker, around the library call only.

function summarize(times) {
  const s = [...times].sort((a, b) => a - b);
  const n = s.length;
  const r2 = v => Math.round(v * 100) / 100;
  if (n === 0) return { runs: 0, timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 };
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { runs: n, timesMs: times.map(r2), medianMs: r2(median), minMs: r2(s[0]), maxMs: r2(s[n - 1]) };
}

async function startGo(wasmUrl, name) {
  importScripts('/wasm_exec.js');
  const go = new self.Go();
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
  for (let i = 0; i < 1500 && !self[name + 'Ready']; i++) await new Promise(r => setTimeout(r, 10));
  if (!self[name + 'Ready']) throw new Error(name + ' never became ready');
  return { api: self[name], mem: instance.exports.mem };
}

self.onmessage = async e => {
  const { lib, file, runs } = e.data;
  const MB = 1 << 20;
  const r2 = v => Math.round(v * 100) / 100;
  const jsGc = typeof self.gc === 'function' ? () => self.gc() : () => {};
  const out = { file, individuals: 0, families: 0, gcBetweenRuns: typeof self.gc === 'function' };
  try {
    let run, info, beforeRun = jsGc, mem = null;
    if (lib === 'ours-parse') {
      const g = await startGo('/build/ligneous-bench.wasm', 'ligneousBench');
      mem = g.mem;
      beforeRun = () => { g.api.gc(); jsGc(); };
      run = u8 => g.api.parse(u8);
      info = v => v;
    } else if (lib === 'ours-check') {
      const g = await startGo('/site/ligneous.wasm', 'ligneous');
      mem = g.mem;
      run = u8 => g.api.check(u8);
      info = s => {
        const res = JSON.parse(s);
        if (res.error) return { individuals: 0, families: 0, error: res.error };
        return { individuals: res.summary.people, families: res.summary.families, findings: res.findings.length, error: '' };
      };
    } else if (lib === 'read-gedcom') {
      importScripts('/build/read-gedcom.bundle.js');
      let ab = null;
      run = u8 => readGedcomBundle.readGedcom(ab ??= u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
      info = g => ({ individuals: g.getIndividualRecord().length, families: g.getFamilyRecord().length, error: '' });
    } else {
      throw new Error('unknown lib ' + lib);
    }
    const u8 = new Uint8Array(await (await fetch('/inputs/' + file)).arrayBuffer());
    out.bytes = u8.length;
    beforeRun();
    let last = info(run(u8)); // warm-up
    const times = [];
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
    Object.assign(out, { individuals: last.individuals, families: last.families, error: last.error || undefined });
    if (last.findings !== undefined) out.findings = last.findings;
    Object.assign(out, summarize(times));
    const pm = self.performance && self.performance.memory;
    out.memory = {
      wasmLinearMemoryMB: mem ? r2(mem.buffer.byteLength / MB) : undefined,
      jsHeapUsedMB: pm ? r2(pm.usedJSHeapSize / MB) : undefined,
      note: pm ? 'performance.memory exposed in the worker' : 'performance.memory not exposed in a worker; JS heap n/a',
    };
  } catch (err) {
    out.error = String(err && err.message || err);
  }
  self.postMessage(out);
};
