// When to warn a phone before it opens a file (spec T24). The viewer page
// decides what counts as a phone and what the warning says; this only says
// whether the file is "very large".
//
// Reading a file takes memory in the page's renderer in proportion to the
// file (measured in headless Chromium, the renderer's peak resident memory,
// scripts/enrich-browser.mjs --memory; numbers in docs/enrich-progress.md):
// 133 MiB with nothing read; up to 267 MiB for every file under 2 MiB; 511
// MiB for a 4 MiB file; at worst (royal92, and a dense file of 70,000 people
// in 5.25 MiB) about 117 MiB more for each MiB of file. The budget assumed
// for a phone is about 512 MiB, which a 3 MiB file at that worst rate (about
// 484 MiB) stays under. A phone was not tested. Decided at 3 MiB (T33).
// Since the timeline tables (T40): 282 MiB at 2 MiB, 545 MiB at 4 MiB, and
// royal92's rate about 162 MiB per MiB, which puts a 3 MiB file of its
// density near 620 MiB (docs/enrich-progress.md, round 4).

/** From this size up, a file is very large for a phone. */
export const PHONE_LARGE_BYTES = 3 * 2 ** 20;

/** Whether a phone should be warned before opening a file of this many bytes. */
export function isVeryLargeForPhones(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= PHONE_LARGE_BYTES;
}
