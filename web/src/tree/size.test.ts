import { describe, expect, it } from 'vitest';
import { PHONE_LARGE_BYTES, isVeryLargeForPhones } from './size';

const MiB = 2 ** 20;

describe('a file "very large" for phones (T24)', () => {
  it('starts at 3 MiB (docs/enrich-progress.md says how it was chosen)', () => {
    expect(PHONE_LARGE_BYTES).toBe(3 * MiB);
    expect(isVeryLargeForPhones(3 * MiB - 1)).toBe(false);
    expect(isVeryLargeForPhones(3 * MiB)).toBe(true);
  });

  it.each([
    [0, false],
    [499_788, false], // royal92.ged
    [1_102_000, false], // pres2020.ged
    [2_079_272, false], // people5000.ged: 267 MiB at its peak in Chromium
    [4_238_183, true], // people10000.ged: 511 MiB
    [5_507_917, true], // indented2.ged: 738 MiB
    [29_642_841, true], // people70000.ged: 1.6 GiB
  ])('%d bytes: %s', (bytes, want) => {
    expect(isVeryLargeForPhones(bytes)).toBe(want);
  });

  it('never warns about a size that isn\'t one', () => {
    for (const bad of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) expect(isVeryLargeForPhones(bad)).toBe(false);
  });
});
