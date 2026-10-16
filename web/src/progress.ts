// Real progress for the bar above the dropzone: how far the checker download
// is, and which stage the Go checker has reached. Never a timer.

/** [stage, weight]: the share of the whole job each stage takes, summing to 100. */
export type StageTable = readonly (readonly [string, number])[];

// Weights from timing each stage of the wasm build in Node with library
// v0.2.1 (`node scripts/stage-times.mjs <file>`, 2026-10-16), as shares of
// the whole call. Set from the big files, where the bar matters:
//   indented2.ged  5.5 MB, 7.0 s: decode 0.0, parse 20.1, validate 28.8, summary 26.8, finish 24.3
//   big.ged       21.0 MB, 8.2 s: decode 0.1, parse 13.5, validate 39.6, summary 41.2, finish 5.5
// (their mean, with decode kept at 1 so every stage moves the bar). Small
// files differ a little: royal92 (0.5 MB) 4 / 23 / 37 / 28 / 8.
export const CHECK_STAGES: StageTable = [
  ['decode', 1],
  ['parse', 17],
  ['validate', 34],
  ['summary', 33],
  ['finish', 15],
];

// Repair, timed the same way; every size agrees:
//   indented2.ged: repair 51.5, parse 12.0, validate 33.6, finish 2.9
//   big.ged:       repair 55.2, parse 16.7, validate 27.5, finish 0.5
export const REPAIR_STAGES: StageTable = [
  ['repair', 53],
  ['parse', 14],
  ['validate', 30],
  ['finish', 3],
];

/**
 * The percentage at the start of `stage`: the sum of the weights before it.
 * 'done' is 100; a stage not in the table is -1 (the bar doesn't move).
 */
export function stagePercent(table: StageTable, stage: string): number {
  if (stage === 'done') return 100;
  let sum = 0;
  for (const [name, w] of table) {
    if (name === stage) return sum;
    sum += w;
  }
  return -1;
}

/**
 * The number of bytes the download will give. A gzip- or br-encoded response
 * is decompressed as it is read, but its Content-Length is the compressed
 * size, so the size known at build time is used instead (also when there is
 * no Content-Length).
 */
export function downloadTotal(headers: Pick<Headers, 'get'>, knownSize: number): number {
  const encoding = (headers.get('content-encoding') ?? '').trim().toLowerCase();
  const length = Number(headers.get('content-length') ?? '');
  if (encoding !== '' && encoding !== 'identity') return knownSize;
  return Number.isFinite(length) && length > 0 ? length : knownSize;
}

/** Whole percent of the download, at most 99 until the checker has started. */
export function downloadPercent(loaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(99, Math.floor((100 * loaded) / total)));
}

/** Reads the whole body, calling `onProgress(loaded, total)` after each chunk. */
export async function readWithProgress(
  res: Response, knownSize: number, onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress(bytes.length, bytes.length);
    return bytes;
  }
  const total = downloadTotal(res.headers, knownSize);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return bytes;
}
