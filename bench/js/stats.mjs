// Shared by the Node and browser runners: summary statistics for a list of
// run times in milliseconds.
export function summarize(times) {
  const s = [...times].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { runs: 0, timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 };
  const r2 = v => Math.round(v * 100) / 100;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { runs: n, timesMs: times.map(r2), medianMs: r2(median), minMs: r2(s[0]), maxMs: r2(s[n - 1]) };
}
