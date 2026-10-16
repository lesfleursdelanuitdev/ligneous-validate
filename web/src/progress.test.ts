import { describe, expect, it } from 'vitest';
import { CHECK_STAGES, REPAIR_STAGES, downloadPercent, downloadTotal, readWithProgress, stagePercent } from './progress';

describe('stage percentages', () => {
  for (const [name, table] of [['check', CHECK_STAGES], ['repair', REPAIR_STAGES]] as const) {
    it(`${name}: cumulative, monotonic, ends at 100`, () => {
      const total = table.reduce((sum, [, w]) => sum + w, 0);
      expect(total).toBe(100);
      let prev = -1;
      let sum = 0;
      for (const [stage, w] of table) {
        expect(w).toBeGreaterThan(0);
        const p = stagePercent(table, stage);
        expect(p).toBe(sum); // a stage starts where the ones before it end
        expect(p).toBeGreaterThan(prev);
        prev = p;
        sum += w;
      }
      expect(stagePercent(table, 'done')).toBe(100);
      expect(prev).toBeLessThan(100);
    });
  }

  it('check stages are in the order Go reports them', () => {
    expect(CHECK_STAGES.map(([s]) => s)).toEqual(['decode', 'parse', 'validate', 'summary', 'finish']);
    expect(REPAIR_STAGES.map(([s]) => s)).toEqual(['repair', 'parse', 'validate', 'finish']);
  });

  it('an unknown stage never moves the bar', () => {
    expect(stagePercent(CHECK_STAGES, 'nonsense')).toBe(-1);
  });
});

describe('download progress', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it('uses Content-Length when the response is not encoded', () => {
    expect(downloadTotal(headers({ 'content-length': '1234' }), 999)).toBe(1234);
  });

  it('uses the known size when the response is gzip-encoded (Content-Length is the compressed size)', () => {
    expect(downloadTotal(headers({ 'content-length': '1200', 'content-encoding': 'gzip' }), 4_800_000)).toBe(4_800_000);
    expect(downloadTotal(headers({ 'content-length': '1200', 'content-encoding': 'br' }), 4_800_000)).toBe(4_800_000);
  });

  it('uses the known size when there is no Content-Length', () => {
    expect(downloadTotal(headers({}), 777)).toBe(777);
  });

  it('identity encoding counts as not encoded', () => {
    expect(downloadTotal(headers({ 'content-length': '50', 'content-encoding': 'identity' }), 777)).toBe(50);
  });

  it('percent is whole, clamped to 0..99 until the bytes are in, and 0 when the size is unknown', () => {
    expect(downloadPercent(0, 100)).toBe(0);
    expect(downloadPercent(50, 100)).toBe(50);
    expect(downloadPercent(100, 100)).toBe(99);
    expect(downloadPercent(500, 100)).toBe(99);
    expect(downloadPercent(5, 0)).toBe(0);
  });

  it('reads a gzip-encoded response against the known size, in order, and returns every byte', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6, 7, 8, 9, 10])];
    const body = new ReadableStream<Uint8Array>({
      start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
    });
    const res = new Response(body, { headers: { 'content-length': '4', 'content-encoding': 'gzip' } });
    const seen: [number, number][] = [];
    const bytes = await readWithProgress(res, 10, (loaded, total) => seen.push([loaded, total]));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(seen).toEqual([[3, 10], [5, 10], [10, 10]]);
  });

  it('reads a response with no body stream (some caches) in one go', async () => {
    const res = { headers: new Headers({ 'content-length': '3' }), body: null, arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer } as unknown as Response;
    const seen: [number, number][] = [];
    const bytes = await readWithProgress(res, 0, (l, t) => seen.push([l, t]));
    expect([...bytes]).toEqual([7, 8, 9]);
    expect(seen).toEqual([[3, 3]]);
  });
});
