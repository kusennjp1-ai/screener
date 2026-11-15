// @vitest-environment node
// Round 3 R6 (the structural stop): a leg that ends on or after the pivot's breakout (pivotBreakout's breakoutDate, the first
// close above the pivot's cents after the pivot's bar) is price action after the breakout, never the stop's contraction. The
// shapes are built here, with their own bars; positionSizing.test.js is unchanged.
import { describe, expect, it } from 'vitest';
import { calendarAt, tradingDays } from '../testMarketCalendarFixture.js';
import { buildBookTechnicalEvidence, measureContractions, pivotBreakout } from '../bookTechnicalEvidence';
import { PLAN_DEFAULTS, POST_BREAKOUT_LEGS_REASON, positionPlan, previousBaseReason, structuralStop, STRUCTURAL_STOP_BUFFER_PERCENT } from './positionSizing';

const round = value => Math.round(value * 100) / 100;
const ABOVE_REASON = structuralStop({ technical: { vcp: { measurementsValid: true, legs: [{ low: 101, lowDate: '2026-01-01' }] } }, judged: [{ date: '2026-01-01', low: 101 }], entry: 102, pivot: 100 }).reason;
/** Today's reason for a measurement of other bars, from its producer (an as_of_date that is not the bars' last session). */
const MISMATCH_REASON = structuralStop({ technical: { as_of_date: '2020-01-01', vcp: { measurementsValid: true, legs: [{ low: 99, lowDate: '2026-01-01' }] } }, judged: [{ date: '2026-01-01', low: 99 }], entry: 102, pivot: 100 }).reason;
const unknown = reason => ({ state: 'unknown', low: null, lowDate: null, stop: null, percent: null, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason });

/**
 * HUM's shape (as in bookTechnicalEvidencePivot.test.js): a linear advance from 50 to 100, then each [length, close] turn.
 * Prices are whole cents: open = close, high 0.3% above and low 0.3% below. `marks[k]` is the advance's top (k = 0) and
 * each turn's end. The 96.29 handle high (marks[2]) is the pivot's bar; the closes cross it on marks[4], and the last three
 * bars dip to 93.60 (low 93.32), under the pivot, after the breakout.
 */
function hum() {
  const turns = [[25, 80], [20, 96], [8, 90], [6, 97], [3, 93.6]], count = 320;
  const advance = count - 1 - turns.reduce((sum, [length]) => sum + length, 0);
  const closes = [];
  for (let i = 0; i <= advance; i++) closes.push(50 + 50 * i / advance);
  const marks = [advance];
  for (const [length, to] of turns) {
    const from = closes.at(-1);
    for (let i = 1; i <= length; i++) closes.push(from + (to - from) * i / length);
    marks.push(closes.length - 1);
  }
  const dates = tradingDays('2025-01-01', count);
  const bars = closes.map((close, i) => ({ date: dates[i], open: round(close), close: round(close), high: round(close * 1.003), low: round(close * 0.997), volume: 1000 + (i % 7) * 50 }));
  const date = bars.at(-1).date, pb = marks[2];
  const row = { symbol: 'AAA', market: 'US', current_price: bars.at(-1).close, setup_recalculation: { status: 'calculated', as_of_date: date }, se_pattern_confidence: 60,
    se_pattern_primary: 'high_tight_flag', se_pivot_date: bars[pb].date, se_pivot_price: bars[pb].high };
  return { bars, marks, date, row, pivot: bars[pb].high, payload: { symbol: 'AAA', as_of_date: date, bars, session_calendar: calendarAt(date) } };
}
/** The reviewer's intervals on `s` (bar index pairs), measured as StockView would measure them: technical.vcp. */
const reviewed = (s, pairs) => ({ as_of_date: s.date, vcp: measureContractions(s.bars, { review: { source: 'test reviewer', reviewedAt: `${s.date}T00:00:00Z`,
  intervals: pairs.map(([a, b]) => ({ startDate: s.bars[a].date, endDate: s.bars[b].date })) } }) });

/** 60 calendar-day bars (high 102, low 100, close 100) and legs of [low's bar, low, end's bar or null] with each low on its bar. */
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const plain = () => Array.from({ length: 60 }, (_, i) => ({ date: day(i), open: 100, high: 102, low: 100, close: 100, volume: 1000 }));
const dated = (list, legs) => {
  for (const [at, low] of legs) list[at] = { ...list[at], low };
  return { as_of_date: list.at(-1).date, vcp: { measurementsValid: true, legs: legs.map(([at, low, end]) => ({ low, lowDate: list[at].date, ...(end === null ? {} : { endDate: list[end].date }) })) } };
};

describe('the structural stop never takes a leg that ends on or after the pivot\'s breakout (round 3 R6)', () => {
  it('HUM: the stop comes from the contraction before the breakout, never the dip after it (reviewer\'s intervals)', () => {
    const s = hum(), cut = pivotBreakout(s.bars, s.row);
    expect(cut).toMatchObject({ state: 'cut', index: s.marks[4] });
    // T1 the handle (the pivot's bar to its low), T2 the dip after the breakout: both lows under the pivot.
    const technical = reviewed(s, [[s.marks[2], s.marks[3]], [s.marks[4], s.marks[5]]]);
    const [t1, t2] = technical.vcp.legs;
    expect(technical.vcp).toMatchObject({ source: 'reviewer-intervals', measurementsValid: true });
    expect(t1.endDate < cut.breakoutDate && t2.endDate >= cut.breakoutDate).toBe(true);
    expect(Math.max(t1.low, t2.low)).toBeLessThan(s.pivot);
    const args = { technical, judged: s.bars, entry: s.pivot, pivot: s.pivot, pivotDate: cut.pivotDate };
    const guarded = structuralStop({ ...args, breakoutDate: cut.breakoutDate });
    expect(guarded).toMatchObject({ state: 'ok', low: t1.low, lowDate: t1.lowDate, reason: null });
    expect(guarded.stop).toBeCloseTo(t1.low * (1 - STRUCTURAL_STOP_BUFFER_PERCENT / 100), 9);
    // Without the breakout's date the same input takes T2 (the behaviour before R6, unchanged on the null path).
    expect(structuralStop(args)).toMatchObject({ state: 'ok', low: t2.low, lowDate: t2.lowDate });
    expect(structuralStop({ ...args, breakoutDate: null })).toEqual(structuralStop(args));
  });

  it('every leg ends on or after the breakout: unknown with the reason, no low, no stop, no percent', () => {
    const s = hum(), technical = reviewed(s, [[s.marks[2], s.marks[3]], [s.marks[4], s.marks[5]]]);
    const args = { technical, judged: s.bars, entry: s.pivot, pivot: s.pivot };
    // The breakout dated on T1's last bar: T1 ends on it and T2 after it.
    expect(structuralStop({ ...args, breakoutDate: technical.vcp.legs[0].endDate })).toEqual(unknown(POST_BREAKOUT_LEGS_REASON));
    // Legs all above the pivot and all excluded: the same reason. Kept legs all above the pivot keep today's reason.
    const list = plain(), above = dated(list, [[40, 101, 42], [50, 100.5, 52]]);
    expect(structuralStop({ technical: above, judged: list, entry: 103, pivot: 100, breakoutDate: list[30].date })).toEqual(unknown(POST_BREAKOUT_LEGS_REASON));
    expect(structuralStop({ technical: above, judged: list, entry: 103, pivot: 100, breakoutDate: list[45].date })).toEqual(unknown(ABOVE_REASON));
    expect(structuralStop({ technical: above, judged: list, entry: 103, pivot: 100 })).toEqual(unknown(ABOVE_REASON));
    // A kept leg above the pivot and an excluded one under it: today's reason, never the excluded leg's low.
    const mixed = plain(), legs = dated(mixed, [[40, 101, 42], [50, 95, 52]]);
    expect(structuralStop({ technical: legs, judged: mixed, entry: 103, pivot: 100, breakoutDate: mixed[45].date })).toEqual(unknown(ABOVE_REASON));
    expect(POST_BREAKOUT_LEGS_REASON).not.toBe(ABOVE_REASON);
  });

  it('a leg that ends on the breakout date is excluded; one that ends the session before is kept (endDate, else lowDate)', () => {
    const list = plain();
    // L2's low is on bar 48 and its end on bar 50: only its end dates it against the breakout.
    const technical = dated(list, [[40, 92, 42], [48, 95, 50]]);
    const at = cut => structuralStop({ technical, judged: list, entry: 100, pivot: 100, breakoutDate: list[cut].date });
    expect(at(50)).toMatchObject({ state: 'ok', low: 92, lowDate: list[40].date });
    expect(at(51)).toMatchObject({ state: 'ok', low: 95, lowDate: list[48].date });
    expect(at(49)).toMatchObject({ low: 92 });
    // Without an endDate (or with one that is not an ISO day) the lowDate is the leg's end.
    const bare = plain(), lowOnly = dated(bare, [[40, 92, 42], [50, 95, null]]);
    const onLow = cut => structuralStop({ technical: lowOnly, judged: bare, entry: 100, pivot: 100, breakoutDate: bare[cut].date });
    expect(onLow(50)).toMatchObject({ state: 'ok', low: 92 });
    expect(onLow(51)).toMatchObject({ state: 'ok', low: 95 });
    const odd = { ...lowOnly, vcp: { ...lowOnly.vcp, legs: lowOnly.vcp.legs.map((leg, i) => (i === 1 ? { ...leg, endDate: '2026-2-20' } : leg)) } };
    expect(structuralStop({ technical: odd, judged: bare, entry: 100, pivot: 100, breakoutDate: bare[50].date })).toMatchObject({ low: 92 });
    // A kept leg is checked against the bars like the leg chosen today.
    const moved = list.map(bar => ({ ...bar }));
    moved[40].low = 93;
    expect(structuralStop({ technical, judged: moved, entry: 100, pivot: 100, breakoutDate: list[50].date })).toEqual(unknown(MISMATCH_REASON));
  });

  it('without a valid breakoutDate (null, undefined, malformed) the result is the one without the parameter', () => {
    const fixture = (low, entry, pivot) => { const list = plain(); return { technical: dated(list, [[40, 90, null], [50, low, null]]), judged: list, entry, pivot }; };
    const cases = { ok: fixture(96, 100, 100), tooDeep: fixture(88, 100, 100), above: fixture(100.3, 100, 101), abovePivot: fixture(103, 106, 89) };
    for (const [state, args] of Object.entries(cases)) {
      const today = structuralStop(args);
      expect(today.state).toBe(state === 'abovePivot' ? 'unknown' : state);
      for (const breakoutDate of [null, undefined, 'bad', '2026-3-1', 20260301, new Date('2026-02-01')]) expect(structuralStop({ ...args, breakoutDate })).toEqual(today);
    }
  });

  it('R2(b) wins: a previous base reads 前の土台 whether the cut excludes some legs, all of them, or leaves only legs above the pivot', () => {
    const list = plain();
    list[55] = { ...list[55], high: 100 };
    const technical = dated(list, [[40, 95, 41], [50, 92, 51]]);
    technical.vcp.base = { startDate: list[30].date, brokeOut: true, breakoutDate: list[52].date };
    const args = { technical, judged: list, entry: 100, pivot: 100, pivotDate: list[55].date };
    const reason = previousBaseReason(list[52].date, list.at(-1).date);
    expect(structuralStop(args)).toEqual(unknown(reason));
    for (const cut of [45, 30]) expect(structuralStop({ ...args, breakoutDate: list[cut].date })).toEqual(unknown(reason));
    const high = plain(), aboveKept = dated(high, [[40, 103, 41], [50, 92, 51]]);
    aboveKept.vcp.base = technical.vcp.base;
    expect(structuralStop({ ...args, technical: aboveKept, judged: high, breakoutDate: high[45].date })).toEqual(unknown(reason));
    // The measurement-date check keeps its place too.
    const other = { ...technical, as_of_date: '2020-01-01' };
    expect(structuralStop({ ...args, technical: other, breakoutDate: list[30].date })).toEqual(unknown(MISMATCH_REASON));
  });

  it('positionPlan passes pivotBreakout\'s breakoutDate; on the v3 automatic legs the guard changes nothing', () => {
    const s = hum(), cut = pivotBreakout(s.bars, s.row);
    // A close above the pivot, then a dip under it.
    expect(s.bars.slice(cut.index).some(bar => bar.low < s.pivot)).toBe(true);
    const subject = { symbol: 'AAA', state: 'wait', position: 'wait', asOf: s.date, qualified: true, distance: -2.8, volumeRatio: 1, rs: 80, passed: 9, pivot: s.pivot, price: s.bars.at(-1).close, row: s.row };
    // The v3 evidence with a hand-added leg after the breakout (its low under the pivot, on its bar).
    const evidence = buildBookTechnicalEvidence(s.row, s.payload, s.date);
    const last = s.bars.at(-1), post = { startDate: s.bars[s.marks[4]].date, endDate: last.date, lowDate: last.date, low: last.low };
    const handed = { ...evidence, vcp: { ...evidence.vcp, legs: [...evidence.vcp.legs, post] } };
    const plan = positionPlan(subject, PLAN_DEFAULTS, { technical: handed, judged: s.bars });
    const args = { technical: handed, judged: s.bars, entry: s.pivot, pivot: s.pivot, pivotDate: cut.pivotDate };
    expect(plan.structural).toEqual(structuralStop({ ...args, breakoutDate: pivotBreakout(s.bars, s.row).breakoutDate }));
    expect(plan.structural.state).toBe('ok');
    expect(plan.structural.low).not.toBe(post.low);
    expect(structuralStop(args).low).toBe(post.low);
    // P1's own evidence: valid, every leg before the cut, a usable stop, the same with and without the guard.
    expect(evidence.vcp.measurementsValid).toBe(true);
    expect(evidence.vcp.legs.every(leg => leg.endDate < cut.breakoutDate)).toBe(true);
    const own = positionPlan(subject, PLAN_DEFAULTS, { technical: evidence, judged: s.bars });
    expect(own.structural).toMatchObject({ state: 'ok', low: evidence.vcp.legs.at(-1).low });
    expect(own.structural).toEqual(structuralStop({ technical: evidence, judged: s.bars, entry: s.pivot, pivot: s.pivot, pivotDate: cut.pivotDate }));
    expect(own.structural).toEqual(plan.structural);
  });
});
