import { describe, expect, it } from 'vitest';
import { PHONE_LARGE_BYTES, isVeryLargeForPhones } from './size';

const MiB = 2 ** 20;

describe('a file "very large" for phones (T24)', () => {
  it('starts at 2 MiB (T33 amended; docs/enrich-progress.md says how it was chosen)', () => {
    expect(PHONE_LARGE_BYTES).toBe(2 * MiB);
    expect(isVeryLargeForPhones(2 * MiB - 1)).toBe(false);
    expect(isVeryLargeForPhones(2 * MiB)).toBe(true);
  });

  it.each([
    [0, false],
    [499_788, false], // royal92.ged
    [1_102_000, false], // pres2020.ged
    [2_079_272, false], // people5000.ged, 1.98 MiB: 282 MiB at its peak in Chromium (T40)
    [3 * MiB, true], // royal92's density: about 620 MiB
    [4_238_183, true], // people10000.ged: 545 MiB
    [5_507_917, true], // indented2.ged: 766 MiB
    [29_642_841, true], // people70000.ged: 1.7 GiB
  ])('%d bytes: %s', (bytes, want) => {
    expect(isVeryLargeForPhones(bytes)).toBe(want);
  });

  it('never warns about a size that isn\'t one', () => {
    for (const bad of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) expect(isVeryLargeForPhones(bad)).toBe(false);
  });
});
