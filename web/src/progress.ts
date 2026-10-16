// Real progress for the bar above the dropzone: how far the checker download
// is, and which stage the Go checker has reached. Never a timer.

/** [stage, weight]: the share of the whole job each stage takes, summing to 100. */
export type StageTable = readonly (readonly [string, number])[];

// Weights from timing each stage of the wasm build in Node
// (`node scripts/stage-times.mjs check/testdata/royal92.ged`, 0.5 MB, 2026-10-16):
// decode 3.5%, parse 15.5%, validate 22.6%, summary 51.2%, finish 6.6%.
// Bigger files spend even more in summary (2.3 MB: 79%, 5.5 MB: 92%), which
// the library speed-up should bring back down; these round royal92's figures.
export const CHECK_STAGES: StageTable = [
  ['decode', 2],
  ['parse', 18],
  ['validate', 25],
  ['summary', 50],
  ['finish', 5],
];

// Repair timed the same way: royal92 repair 57%, parse 16%, validate 26%,
// finish 1%; 2.3 MB 48/11/38/3; 5.5 MB 50/12/34/3.
export const REPAIR_STAGES: StageTable = [
  ['repair', 50],
  ['parse', 14],
  ['validate', 33],
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
