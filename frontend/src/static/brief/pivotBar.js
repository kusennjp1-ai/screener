// The Setup Engine pivot's own daily bar (round 3, STEP 0 helper H1; frozen: changes only in STEP 0 or at integration).
// R1 (crossings count from the pivot's bar on: the floor is the pivot bar's own index, see crossingFloor) and C4 (the pivot's date on the stock screen) both read it, so the
// two never disagree about which bar formed the pivot. It never guesses: no match is null.

/**
 * Every `se_pattern_primary` the backend can publish, with the timeframe its detector reads. The set is the default
 * detector set (backend/app/analysis/patterns/detectors/__init__.py:18-31, `default_pattern_detectors`); the primary is
 * the selected candidate's `pattern` (aggregator.py:184), which each detector sets to its own `name`. Each line names
 * where the detector builds that candidate with its timeframe. `double_bottom` is a stub outside the default set and
 * emits no candidate; no primary at all is published as null (frontend/tools/recalculate-setups.py, clear_setup).
 * The row's own `se_timeframe` cannot stand in for this: the scanner always reports "daily" (setup_engine_screener.py:174).
 * backend/tests/unit/test_pivot_timeframes.py parses this constant (JSON once the line comments are removed) and pins
 * every entry and line reference to the detectors, so the two sides cannot drift.
 */
export const PIVOT_TIMEFRAMES = Object.freeze({
  "cup_with_handle": "weekly", // backend/app/analysis/patterns/cup_handle.py:209
  "three_weeks_tight": "weekly", // backend/app/analysis/patterns/three_weeks_tight.py:133
  "high_tight_flag": "daily", // backend/app/analysis/patterns/high_tight_flag.py:176
  "first_pullback": "daily", // backend/app/analysis/patterns/first_pullback.py:161
  "vcp": "daily", // backend/app/analysis/patterns/vcp_wrapper.py:89
  "nr7_inside_day": "daily" // backend/app/analysis/patterns/nr7_inside_day.py:214
});

const DAY_MS = 86400000;
const cents = value => Math.round(value * 100);
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString().slice(0, 10) === value;

/**
 * The bar that formed the row's Setup Engine pivot, as `{ index, date }` (`index` into `bars`), or null.
 * - Weekly patterns (PIVOT_TIMEFRAMES 'weekly'): `se_pivot_date` labels the pivot's week (the backend resamples daily
 *   bars to weeks ending Friday, W-FRI, and dates a week by that Friday, which need not be a session). The pivot's bar is
 *   the latest bar dated within the 7 calendar days ending on that label whose high equals `se_pivot_price` in cents.
 * - Daily patterns: the bar dated `se_pivot_date` itself, when its high equals `se_pivot_price` in cents.
 * - Otherwise null: no bars, no or a malformed `se_pivot_date`, no positive `se_pivot_price`, a pattern this table does
 *   not name (or none), or no bar that matches. A weekly label is never read as the bar itself.
 * `bars` are daily bars in date order (the caller's certified bars); prices compare in whole cents, so float noise in a
 * published pivot (89.88000000000001) matches a high of 89.88.
 */
export function pivotBar(bars, row) {
  if (!Array.isArray(bars) || !bars.length || !row || typeof row !== 'object') return null;
  const pattern = row.se_pattern_primary, date = row.se_pivot_date, pivot = row.se_pivot_price;
  const timeframe = typeof pattern === 'string' && Object.hasOwn(PIVOT_TIMEFRAMES, pattern) ? PIVOT_TIMEFRAMES[pattern] : null;
  if (!timeframe || !isoDay(date) || !(Number.isFinite(pivot) && pivot > 0)) return null;
  const from = timeframe === 'weekly' ? new Date(Date.parse(date) - 6 * DAY_MS).toISOString().slice(0, 10) : date;
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i], day = bar?.date;
    if (typeof day !== 'string' || day > date) continue;
    if (day < from) break;
    if (Number.isFinite(bar.high) && cents(bar.high) === cents(pivot)) return { index: i, date: day };
  }
  return null;
}
