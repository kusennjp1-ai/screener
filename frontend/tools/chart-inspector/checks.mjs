// Pure consistency rules for a rendered trade-plan row (C94).
// Kept free of any Playwright/Node-only imports so it can be unit-tested and
// reused by the CDP inspector (inspect.mjs).

export const round2 = (x) => Math.round(x * 100) / 100;

// Apply the correctness rules to one parsed buy row. Returns a list of
// human-readable violations (empty == the row is internally correct).
//   - the stop on the ladder must equal the stop in the footer line
//   - 2R == pivot + 2·(pivot − stop),  3R == pivot + 3·(pivot − stop)
//   - the displayed risk% must equal (pivot − stop) / pivot · 100
// Rows without a plan (WAIT / no-signal) carry no pivot/stop and are skipped.
export function checkRow(row, tolerance = 0.02) {
  const v = [];
  const { symbol, pivot, stop, t2, t3, riskPct, footerStop } = row;
  if (pivot == null || stop == null) return v;
  if (footerStop != null && Math.abs(footerStop - stop) > tolerance) {
    v.push(`${symbol}: stop ladder ${stop} != footer stop ${footerStop}`);
  }
  const r = pivot - stop;
  if (r <= 0) v.push(`${symbol}: non-positive risk (pivot ${pivot} <= stop ${stop})`);
  if (t2 != null && Math.abs(t2 - round2(pivot + 2 * r)) > tolerance) {
    v.push(`${symbol}: 2R ${t2} != pivot+2R ${round2(pivot + 2 * r)}`);
  }
  if (t3 != null && Math.abs(t3 - round2(pivot + 3 * r)) > tolerance) {
    v.push(`${symbol}: 3R ${t3} != pivot+3R ${round2(pivot + 3 * r)}`);
  }
  if (riskPct != null && Math.abs(riskPct - (r / pivot) * 100) > 0.15) {
    v.push(`${symbol}: risk ${riskPct}% != (pivot-stop)/pivot ${round2((r / pivot) * 100)}%`);
  }
  return v;
}
