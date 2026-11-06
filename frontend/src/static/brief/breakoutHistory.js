// When the close crossed the canonical pivot, from certified daily bars: the crossing helpers the
// conclusion, the chart's breakout mark and the sell checks share. Every bar here is one the caller
// certified for the analysis date (StockView's `judged`); anything missing is null, never a guess.
// This module imports briefCandidate (the day's event) and nothing imports it back, so there is no cycle.
import { finite } from '../researchEngine';
import { breakoutEvent } from './briefCandidate';
import { shortDate } from './briefShared';

const positive = value => finite(value) && value > 0;

/**
 * The session the close last crossed the pivot from below, when it was 1 to `sessions` sessions before
 * the last bar and every close since is at or above the pivot; null otherwise (or with any close missing).
 */
export function pivotCrossing(bars, pivot, sessions = 3) {
  if (!Array.isArray(bars) || !positive(pivot)) return null;
  const n = bars.length, close = i => (positive(bars[i]?.close) ? bars[i].close : null);
  for (let i = n - 1; i >= n - 1 - sessions && i >= 1; i--) {
    const today = close(i), before = close(i - 1);
    if (today === null || before === null || today < pivot) return null;
    if (before < pivot) return i === n - 1 ? null : { date: bars[i].date, sessionsAgo: n - 1 - i };
  }
  return null;
}

/**
 * The last crossing of `pivot` from below in the certified `bars`, as `{ index, date, sessionsAgo,
 * volumeRatio }` (`index` is the crossing bar's index in `bars`), or null. The one helper the conclusion,
 * the chart's breakout mark (chart) and the sell checks read. `options` may be omitted or null; a
 * `lookback` that is not a positive integer falls back to the default.
 *
 * Step 0 (this body): the crossing pivotCrossing finds within `lookback` sessions (3 by default) with its
 * bar index, so a crossing on the last bar, or one followed by a close back under the pivot, is null;
 * `volumeRatio` is not measured yet and is always null, never 0.
 *
 * Round-2 target (verdict's VD1 and VD2 write this body; chart's CH7 builds against it):
 * - The crossing is the latest bar i, with 0 ≤ sessionsAgo ≤ `lookback`, whose close is at or above the
 *   pivot (the same cents count as at) while the close before it is under the pivot. The default
 *   `lookback` is 60 sessions.
 * - `sessionsAgo` can be 0: a crossing on the last bar (the analysis day) is returned. A caller that must
 *   not claim a breakout for it (a close at the pivot is breakoutEvent's 'touch') checks that itself.
 * - It is returned whatever the closes after it do: a later close back under the pivot does not hide it.
 *   VD2's failedBreakout is that case (a crossing followed by a last close under the pivot), so it needs
 *   no option of its own; a caller that needs the stock still above the pivot reads the last close.
 * - `volumeRatio` is the crossing bar's volume over the average volume of the 50 bars before it (the
 *   chart readout's 直前50日平均比), or null when fewer than 50 bars precede it or a volume in that window
 *   or on the crossing bar is missing. Never 0 for a missing value.
 * - Any close missing between the crossing and the last bar gives null, never a guess.
 * Until verdict merges, a caller's unit tests mock this module (`vi.mock('./breakoutHistory')`), and its
 * browser cases use a crossing 1 to 3 sessions back with every close since at or above the pivot, which
 * both bodies return alike.
 */
export function lastPivotCrossing(bars, pivot, options = {}) {
  const lookback = Number.isInteger(options?.lookback) && options.lookback > 0 ? options.lookback : 3;
  const crossed = pivotCrossing(bars, pivot, lookback);
  return crossed ? { index: bars.length - 1 - crossed.sessionsAgo, date: crossed.date, sessionsAgo: crossed.sessionsAgo, volumeRatio: null } : null;
}

/**
 * The conclusion's event for the analysis day: breakoutEvent(view) (rows'), with an `'after'` event
 * (the stock was already above the pivot the day before) dated from `bars` when they are given: bars
 * certified for the analysis date date a crossing 1 to 3 sessions back (「買いゾーン内（9/22に上抜け・2営業日前）」).
 * `crossed` is that crossing (pivotCrossing's), or null; every other event is breakoutEvent's, unchanged.
 */
export function crossingEvent(view, bars = null) {
  const event = breakoutEvent(view);
  if (event?.kind !== 'after') return event;
  const crossed = pivotCrossing(bars, view.pivot);
  return { ...event, title: crossed ? `買いゾーン内（${shortDate(crossed.date, bars.at(-1)?.date)}に上抜け・${crossed.sessionsAgo}営業日前）` : event.title, crossed };
}
