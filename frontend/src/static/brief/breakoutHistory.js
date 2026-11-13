// When the close crossed the canonical pivot, from certified daily bars: the crossing helpers the
// conclusion, the chart's breakout mark and the sell checks share. Every bar here is one the caller
// certified for the analysis date (StockView's `judged`); anything missing is null, never a guess.
// This module imports briefCandidate (the day's event) and nothing imports it back, so there is no cycle.
import { finite } from '../researchEngine';
import { signed } from '../positionGeometry';
import { AFTER_EVENT, BREAKOUT_VOLUME_RATIO, breakoutEvent, ratioShown, TOUCH_HELD_NOTE, UNDATED_EVENT } from './briefCandidate';
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
 * The crossing floor of `options.from` (round 3, STEP 0 seam H1b): the first bar index a crossing may be on, or null for
 * none. Only a non-negative integer is a floor; null, undefined and anything else take exactly the path without one.
 */
export const floorOf = options => (Number.isInteger(options?.from) && options.from >= 0 ? options.from : null);

/**
 * The first bar index of `bars` (the certified daily bars) a pivot crossing may be on for this `row`, or null for no
 * floor. Every crossing reader passes it as `from` (the failed-breakout check, the conclusion's crossing event, the
 * chart's arrow and the watch-row and Today sell checks), so the bound is applied in one place (round 3, STEP 0 seam
 * H1b). In STEP 0 it is null for every row: behaviour is unchanged. R1 owns the body (the bar after pivotBar's bar).
 */
export function crossingFloor(bars, row) {
  void bars; void row;
  return null;
}

/**
 * Every crossing of `pivot` from below in the certified `bars` within `lookback` sessions (0 to lookback
 * back), the latest first, each as lastPivotCrossing gives it. The walk stops at a missing close: a
 * crossing before it cannot be told, so it is never listed. With `from` (a bar index, floorOf), a crossing
 * bar before it is never listed either (the bar before the crossing may be the one at from − 1).
 */
export function pivotCrossings(bars, pivot, options = {}) {
  if (!Array.isArray(bars) || !positive(pivot)) return [];
  const lookback = lookbackOf(options), floor = floorOf(options), n = bars.length, out = [], close = i => (positive(bars[i]?.close) ? bars[i].close : null);
  const lowest = floor === null ? Math.max(1, n - 1 - lookback) : Math.max(1, n - 1 - lookback, floor);
  for (let i = n - 1; i >= lowest; i--) {
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
 * `lookback` that is not a positive integer falls back to the default. `from` (crossingFloor's) is the first
 * bar index the crossing may be on; without one (null, undefined) nothing changes.
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
  return pivotCrossings(bars, pivot, { lookback: lookbackOf(options), from: options?.from })[0] ?? null;
}

/**
 * The breakout of a crossing (pivotCrossings' or lastPivotCrossing's): the crossing bar itself when it closed above the
 * pivot's cents, else (a close at the pivot's cents is a touch, breakoutEvent's 「ピボット到達」, never a breakout) the
 * first later bar that closed above them before any close back under the pivot, as `{ index, date, sessionsAgo,
 * volumeRatio }` (that bar's own volume ratio, as lastPivotCrossing gives it). Null without a crossing, or when the
 * touch was never followed by a close above the pivot (it fell back, or still sits on it). A missing close ends the walk.
 * With `options.from` (crossingFloor's), a crossing before that bar index has no breakout (null).
 */
export function breakoutBar(bars, pivot, crossing, options = {}) {
  if (!Array.isArray(bars) || !positive(pivot) || !Number.isInteger(crossing?.index)) return null;
  const floor = floorOf(options);
  if (floor !== null && crossing.index < floor) return null;
  const n = bars.length;
  for (let i = crossing.index; i < n; i++) {
    const close = bars[i]?.close;
    if (!positive(close) || cents(close) < cents(pivot)) return null;
    if (cents(close) > cents(pivot)) return i === crossing.index ? crossing : { index: i, date: bars[i].date, sessionsAgo: n - 1 - i, volumeRatio: crossingVolumeRatio(bars, i) };
  }
  return null;
}

/**
 * The conclusion's event for the analysis day: breakoutEvent(view) (rows'), with the events the rows cannot date read from
 * the certified `bars` by lastPivotCrossing (60 sessions, the current pivot) and breakoutBar: an `'after'` event (the stock
 * was already above the pivot's cents the day before), and the rows' `'undated'` and `'touchHeld'` (the day before closed
 * at the pivot's cents, which is a touch only when the closes before it were under the pivot). `crossed` is the dated
 * breakout, or null. Every other event (a close under the pivot's cents the day before) is breakoutEvent's, unchanged,
 * so the analysis day's own breakout is said the same way on every screen. Only a dated breakout on
 * BREAKOUT_VOLUME_RATIO or more stays green, as on the breakout day itself (breakoutEvent's 'cross').
 * - The bars show a close above the pivot before the analysis day (breakoutBar one or more sessions back: the stock was
 *   already above it, also when it has since come back onto the pivot's cents), dated within `staleSessions`
 *   (STALE_BREAKOUT_SESSIONS by default) on the volume: 「9/22に上抜け・2営業日前」, green (kind 'after'). On lighter
 *   volume (kind 'afterLight': 「9/22に上抜け・出来高不足」) or with it unknown ('afterUnconfirmed': 「…・出来高 未確認」):
 *   tone 'wait', as breakoutEvent says it on the breakout day. Never the analysis day's breakout, never 「ピボット到達」.
 * - Dated beyond it, or every close of the window at or above the pivot (above it for more than 60 sessions):
 *   kind 'stale', tone 'wait', 「上抜けから12営業日・停滞（次のピボット待ち）」, or 「…・押し戻し（…）」 when a close
 *   since the crossing went above the buy zone (a pullback to the pivot, not a stall).
 * - A run at the pivot's cents that began from below (a touch: the crossing closed at the cents and no close since went
 *   above them): the analysis day's first close above them is that day's breakout (breakoutEvent with `touched`, on the
 *   day's verified volume, as the rows say a close above after one under the pivot); still on them, kind 'afterTouch',
 *   tone 'wait', 「ピボット到達から4営業日」 with the touch's date in the note (「9/28にピボットに届いた後、…」, TOUCH_HELD_NOTE:
 *   the touch's own day is green, rows' 'touch', and the note says the green is that day's only).
 * - Without certified bars (or bars that end on another day), a close missing in the window, or bars too few to tell:
 *   kind 'undated', tone 'wait', 「買いゾーン内（上抜け日 未確認）」 (UNDATED_EVENT), never green; a 'touchHeld' keeps the
 *   rows' words (tone 'wait') with a note that claims nothing the bars did not show.
 * `from` (crossingFloor's) is the first bar index a crossing may be on (lastPivotCrossing, breakoutBar); null is none.
 */
export function crossingEvent(view, bars = null, { staleSessions = STALE_BREAKOUT_SESSIONS, from = null } = {}) {
  const event = breakoutEvent(view);
  if (event?.kind !== 'after' && event?.kind !== 'undated' && event?.kind !== 'touchHeld') return event;
  const usable = Array.isArray(bars) && bars.length > 1 && bars.at(-1)?.date === view.asOf;
  const crossing = usable ? lastPivotCrossing(bars, view.pivot, { from }) : null;
  // A crossing that closed at the pivot's cents is a touch (rows' 「ピボット到達」, no arrow on the chart): the breakout is
  // dated from the first close above the pivot after it, with that bar's volume (breakoutBar).
  const broke = crossing ? breakoutBar(bars, view.pivot, crossing, { from }) : null;
  // A close above the pivot before the analysis day: the stock was already above it, whatever the day before closed at.
  const crossed = broke && broke.sessionsAgo >= 1 ? broke : null;
  if (event.kind !== 'after' && !crossed && crossing) {
    // A run at the pivot's cents from below, then the analysis day's first close above them: that day's breakout.
    if (broke) return breakoutEvent(view, { touched: true });
    // Still on the cents since the touch. As short as 「上抜けから12営業日」 (one line on a 320px phone); the touch's date is the line under it.
    return { ...event, kind: 'afterTouch', tone: 'wait', title: `ピボット到達から${crossing.sessionsAgo}営業日`,
      note: `${shortDate(crossing.date, view.asOf)}にピボットに届いた後、${TOUCH_HELD_NOTE}`, crossed: null };
  }
  // No crossing and every close of the whole window at or above the pivot: above it for more than 60 sessions.
  const span = CROSSING_LOOKBACK_SESSIONS + 2, above = usable && !crossing && bars.length >= span
    && bars.slice(-span).every(bar => positive(bar?.close) && cents(bar.close) >= cents(view.pivot));
  // Two closes at the pivot's cents that the bars cannot date: the rows' words, never green.
  if (!crossed && !above && event.kind === 'touchHeld') return { ...event, crossed: null };
  // Undated: no bars to tell, or (an after event) a breakout the bars date on the analysis day itself, which contradicts
  // the close above the pivot's cents the day before (the analysis day's own breakout is breakoutEvent's, never this branch's).
  if (!crossed && !above) return { ...UNDATED_EVENT, crossed: null };
  const day = crossed ? shortDate(crossed.date, view.asOf) : null, n = crossed?.sessionsAgo;
  if (above || (Number.isInteger(staleSessions) && staleSessions > 0 && n > staleSessions)) {
    const peak = Math.max(...bars.slice(crossed ? crossed.index : -span).map(bar => bar.close));
    const back = finite(view.upper) && cents(peak) > cents(view.upper);
    const since = above ? `${CROSSING_LOOKBACK_SESSIONS}営業日超` : `${n}営業日`, lead = above ? `${CROSSING_LOOKBACK_SESSIONS}営業日を超えてピボットの上にあり、` : `${day}に上抜け、`;
    // `units`: the note's parts a phone line never splits (the run's height and the rule with its label).
    const height = `ピボット比 ${signed((peak / view.pivot - 1) * 100)}`, rule = `（${above ? '' : `${staleSessions}営業日超・`}独自判定）`;
    return { ...AFTER_EVENT, kind: 'stale', tone: 'wait', title: `上抜けから${since}・${back ? '押し戻し' : '停滞'}（次のピボット待ち）`,
      note: `新規の買いは見送り。${lead}${back ? `${height}まで伸びた後に買いゾーンへ戻りました${rule}。` : `${above ? '' : `${staleSessions}営業日を超えて`}伸びないため停滞（独自判定）。`}`,
      units: back ? [height, rule] : [], crossed };
  }
  const ratio = crossed.volumeRatio;
  // The crossing day's own forms (breakoutEvent's on that day), dated: each one line on a 375px phone.
  if (ratio === null) return { ...AFTER_EVENT, kind: 'afterUnconfirmed', tone: 'wait', title: `${day}に上抜け・出来高 未確認`, note: '上抜けの日の出来高を確認できないため、上抜けの裏付けはありません。', crossed };
  if (ratio < BREAKOUT_VOLUME_RATIO) return { ...AFTER_EVENT, kind: 'afterLight', tone: 'wait', title: `${day}に上抜け・出来高不足`, note: `上抜けの日の出来高${ratioShown(ratio)}は基準の${BREAKOUT_VOLUME_RATIO}×に届きません。`, crossed };
  return { ...AFTER_EVENT, title: `${day}に上抜け・${n}営業日前`, crossed };
}
