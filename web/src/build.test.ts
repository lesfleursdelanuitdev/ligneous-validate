import { describe, expect, it } from 'vitest';
import { wasmSize } from '../wasm-size';

describe('the build-time checker size', () => {
  it('refuses a missing checker', () => {
    expect(() => wasmSize(new URL('./testdata/no-such.wasm', import.meta.url))).toThrow(/missing/);
  });
  it('refuses an empty checker', () => {
    expect(() => wasmSize(new URL('./testdata/empty.wasm', import.meta.url))).toThrow(/empty/);
  });
  it('gives the size of a real file', () => {
    expect(wasmSize(new URL('./testdata/catalog.json', import.meta.url))).toBeGreaterThan(0);
  });
});
