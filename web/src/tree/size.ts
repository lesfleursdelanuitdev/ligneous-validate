// When to warn a phone before it opens a file (spec T24). The viewer page
// decides what counts as a phone and what the warning says; this only says
// whether the file is "very large".
//
// Reading a file takes memory in the page's renderer in proportion to the
// file (measured in headless Chromium, the renderer's peak resident memory,
// scripts/enrich-browser.mjs --memory; numbers in docs/enrich-progress.md).
// With the timeline tables (T40): 133 MiB with nothing read; 211 MiB for
// royal92 (0.48 MiB), 214 MiB for pres2020 (1.05 MiB), 282 MiB for a 1.98 MiB
// file, 545 MiB for 4.04 MiB, 766 MiB for a dense 5.25 MiB file. The worst
// rate, royal92's, is about 162 MiB more for each MiB of file. The budget
// assumed for a phone tab is about 512 MiB: at that worst rate a 2 MiB file
// needs about 457 MiB, a 3 MiB file about 620 MiB. So 2 MiB (T33, amended;
// it was 3 MiB before T40's tables). A phone was not tested.

/** From this size up, a file is very large for a phone. */
export const PHONE_LARGE_BYTES = 2 * 2 ** 20;

/** Whether a phone should be warned before opening a file of this many bytes. */
export function isVeryLargeForPhones(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= PHONE_LARGE_BYTES;
}
