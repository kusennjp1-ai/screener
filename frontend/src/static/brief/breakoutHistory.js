// When the close crossed the canonical pivot, from certified daily bars: the crossing helpers the
// conclusion, the chart's breakout mark and the sell checks share. Every bar here is one the caller
// certified for the analysis date (StockView's `judged`); anything missing is null, never a guess.
// This module imports briefCandidate (the day's event) and nothing imports it back, so there is no cycle.
import { finite } from '../researchEngine';
import { signed } from '../positionGeometry';
import { BREAKOUT_VOLUME_RATIO, breakoutEvent, ratioShown } from './briefCandidate';
import { shortDate } from './briefShared';

/** How many sessions back the crossing is looked for (the current pivot only: it is re-detected daily). */
export const CROSSING_LOOKBACK_SESSIONS = 60;
/** The crossing day's volume is compared with the average of this many sessions before it (直前50日平均比). */
export const CROSSING_VOLUME_SESSIONS = 50;
/**
 * A stock still in the buy zone this many sessions after its crossing has not advanced: the conclusion
 * waits for the next pivot (独自判定, shown on screen; SELL_RULES.staleBreakoutSessions is this value).
 */
export const STALE_BREAKOUT_SESSIONS = 10;

const positive = value => finite(value) && value > 0;
const cents = value => Math.round(value * 100);

/** The crossing bar's volume over the average of the CROSSING_VOLUME_SESSIONS bars before it, or null (a 0 is a gap, never a quiet day). */
function crossingVolumeRatio(bars, index) {
  if (index < CROSSING_VOLUME_SESSIONS) return null;
  const day = bars[index]?.volume, prior = bars.slice(index - CROSSING_VOLUME_SESSIONS, index).map(bar => bar?.volume);
  if (!positive(day) || !prior.every(positive)) return null;
  return day / (prior.reduce((sum, volume) => sum + volume, 0) / CROSSING_VOLUME_SESSIONS);
}

const lookbackOf = options => (Number.isInteger(options?.lookback) && options.lookback > 0 ? options.lookback : CROSSING_LOOKBACK_SESSIONS);

/**
 * Every crossing of `pivot` from below in the certified `bars` within `lookback` sessions (0 to lookback
 * back), the latest first, each as lastPivotCrossing gives it. The walk stops at a missing close: a
 * crossing before it cannot be told, so it is never listed.
 */
export function pivotCrossings(bars, pivot, options = {}) {
  if (!Array.isArray(bars) || !positive(pivot)) return [];
  const lookback = lookbackOf(options), n = bars.length, out = [], close = i => (positive(bars[i]?.close) ? bars[i].close : null);
  for (let i = n - 1; i >= Math.max(1, n - 1 - lookback); i--) {
    const today = close(i), before = close(i - 1);
    if (today === null || before === null) break;
    if (cents(today) >= cents(pivot) && cents(before) < cents(pivot)) out.push({ index: i, date: bars[i].date, sessionsAgo: n - 1 - i, volumeRatio: crossingVolumeRatio(bars, i) });
  }
  return out;
}

/**
 * The last crossing of `pivot` from below in the certified `bars`, as `{ index, date, sessionsAgo,
 * volumeRatio }` (`index` is the crossing bar's index in `bars`), or null. The one helper the conclusion,
 * the chart's breakout mark (chart) and the sell checks read. `options` may be omitted or null; a
 * `lookback` that is not a positive integer falls back to the default.
 * - The crossing is the latest bar i, with 0 ≤ sessionsAgo ≤ `lookback`, whose close is at or above the
 *   pivot (the same cents count as at) while the close before it is under the pivot. The default
 *   `lookback` is CROSSING_LOOKBACK_SESSIONS (60).
 * - `sessionsAgo` can be 0: a crossing on the last bar (the analysis day) is returned. A caller that must
 *   not claim a breakout for it (a close at the pivot is breakoutEvent's 'touch') checks that itself.
 * - It is returned whatever the closes after it do: a later close back under the pivot does not hide it.
 *   VD2's failedBreakout is that case (a crossing followed by a last close under the pivot), so it needs
 *   no option of its own; a caller that needs the stock still above the pivot reads the last close.
 * - `volumeRatio` is the crossing bar's volume over the average volume of the 50 bars before it (the
 *   chart readout's 直前50日平均比), or null when fewer than 50 bars precede it or a volume in that window
 *   or on the crossing bar is missing. Never 0 for a missing value.
 * - Any close missing between the crossing and the last bar gives null, never a guess.
 */
export function lastPivotCrossing(bars, pivot, options = {}) {
  return pivotCrossings(bars, pivot, { lookback: lookbackOf(options) })[0] ?? null;
}

/**
 * The conclusion's event for the analysis day: breakoutEvent(view) (rows'), with an `'after'` event (the
 * stock was already above the pivot the day before) dated from the certified `bars` by lastPivotCrossing
 * (60 sessions, the current pivot): `crossed` is that crossing, or null. Every other event is
 * breakoutEvent's, unchanged. Only a dated crossing on BREAKOUT_VOLUME_RATIO or more stays green, as on the
 * crossing day itself (breakoutEvent's 'cross').
 * - Dated within `staleSessions` (STALE_BREAKOUT_SESSIONS by default) on the volume: 「9/22に上抜け・2営業日前」,
 *   green. On lighter volume (kind 'afterLight': 「9/22に上抜け・出来高不足」) or with it unknown ('afterUnconfirmed':
 *   「…・出来高 未確認」): tone 'wait', as breakoutEvent says it on the crossing day.
 * - Dated beyond it, or every close of the window at or above the pivot (above it for more than 60 sessions):
 *   kind 'stale', tone 'wait', 「上抜けから12営業日・停滞（次のピボット待ち）」, or 「…・押し戻し（…）」 when a close
 *   since the crossing went above the buy zone (a pullback to the pivot, not a stall).
 * - Without certified bars (or bars that end on another day), a close missing in the window, or bars too few
 *   to tell: kind 'undated', tone 'wait', 「買いゾーン内（上抜け日 未確認）」: never green.
 */
export function crossingEvent(view, bars = null, { staleSessions = STALE_BREAKOUT_SESSIONS } = {}) {
  const event = breakoutEvent(view);
  if (event?.kind !== 'after') return event;
  const usable = Array.isArray(bars) && bars.length > 1 && bars.at(-1)?.date === view.asOf;
  const crossing = usable ? lastPivotCrossing(bars, view.pivot) : null;
  // The day before was above the pivot, so a crossing on the analysis day itself contradicts it: undated.
  const crossed = crossing && crossing.sessionsAgo >= 1 ? crossing : null;
  // No crossing and every close of the whole window at or above the pivot: above it for more than 60 sessions.
  const span = CROSSING_LOOKBACK_SESSIONS + 2, above = usable && !crossing && bars.length >= span
    && bars.slice(-span).every(bar => positive(bar?.close) && cents(bar.close) >= cents(view.pivot));
  if (!crossed && !above) return { ...event, kind: 'undated', tone: 'wait', title: '買いゾーン内（上抜け日 未確認）', note: '上抜けの日を検証済みの日足で確認できないため、買いの裏付けはありません。', crossed: null };
  const day = crossed ? shortDate(crossed.date, view.asOf) : null, n = crossed?.sessionsAgo;
  if (above || (Number.isInteger(staleSessions) && staleSessions > 0 && n > staleSessions)) {
    const peak = Math.max(...bars.slice(crossed ? crossed.index : -span).map(bar => bar.close));
    const back = finite(view.upper) && cents(peak) > cents(view.upper);
    const since = above ? `${CROSSING_LOOKBACK_SESSIONS}営業日超` : `${n}営業日`, lead = above ? `${CROSSING_LOOKBACK_SESSIONS}営業日を超えてピボットの上にあり、` : `${day}に上抜け、`;
    return { ...event, kind: 'stale', tone: 'wait', title: `上抜けから${since}・${back ? '押し戻し' : '停滞'}（次のピボット待ち）`,
      note: `新規の買いは見送り。${lead}${back ? `ピボット比 ${signed((peak / view.pivot - 1) * 100)}まで伸びた後に買いゾーンへ戻りました（${above ? '' : `${staleSessions}営業日超・`}独自判定）。`
        : `${above ? '' : `${staleSessions}営業日を超えて`}伸びないため停滞（独自判定）。`}`, crossed };
  }
  const ratio = crossed.volumeRatio;
  // The crossing day's own forms (breakoutEvent's on that day), dated: each one line on a 375px phone.
  if (ratio === null) return { ...event, kind: 'afterUnconfirmed', tone: 'wait', title: `${day}に上抜け・出来高 未確認`, note: '上抜けの日の出来高を確認できないため、上抜けの裏付けはありません。', crossed };
  if (ratio < BREAKOUT_VOLUME_RATIO) return { ...event, kind: 'afterLight', tone: 'wait', title: `${day}に上抜け・出来高不足`, note: `上抜けの日の出来高${ratioShown(ratio)}は基準の${BREAKOUT_VOLUME_RATIO}×に届きません。`, crossed };
  return { ...event, title: `${day}に上抜け・${n}営業日前`, crossed };
}
