// @vitest-environment node
// Round 3 R6: the automatic contractions are measured only on the bars before the pivot's breakout bar (the first close
// above the Setup Engine pivot's cents after the pivot's own bar). The shapes are built here, with their own bars.
import { describe, expect, it } from 'vitest';
import { calendarAt, tradingDays } from './testMarketCalendarFixture.js';
import { BOOK_TECHNICAL_VERSION, buildBookTechnicalEvidence, measureContractions, pivotBreakout } from './bookTechnicalEvidence';
import { pivotBar } from './brief/pivotBar';
import { breakoutBar, crossingFloor, lastPivotCrossing } from './brief/breakoutHistory';

const round = value => Math.round(value * 100) / 100;
const cents = value => Math.round(value * 100);
const DAY = 86400000;
/** The Friday that labels a weekly pattern's week (W-FRI) for a bar dated Monday to Friday. */
const friday = date => new Date(Date.parse(date) + (5 - new Date(Date.parse(date)).getUTCDay()) * DAY).toISOString().slice(0, 10);

/**
 * A stock through turning points: a linear advance from 50 to 100, then each [length, close] turn reached linearly.
 * Every price is in whole cents: open = close, high 0.3% above and low 0.3% below the unrounded close. `marks[k]` is the
 * bar index of the advance's top (k = 0) and of each turn's end (k ≥ 1).
 */
function stock(turns, { count = 320 } = {}) {
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
  const date = bars.at(-1).date;
  const payload = { symbol: 'TEST', as_of_date: date, bars, session_calendar: calendarAt(date) };
  return { bars, marks, date, payload, row: extra => ({ symbol: 'TEST', market: 'US', current_price: bars.at(-1).close, ...extra }) };
}

/** A daily pivot (high_tight_flag) on bar `index`: the bar's own date and high. */
const dailyPivot = (bars, index) => ({ se_pattern_primary: 'high_tight_flag', se_pivot_date: bars[index].date, se_pivot_price: bars[index].high });
/** A weekly pivot (cup_with_handle) on bar `index`: its week's Friday label and the bar's high. */
const weeklyPivot = (bars, index) => ({ se_pattern_primary: 'cup_with_handle', se_pivot_date: friday(bars[index].date), se_pivot_price: bars[index].high });
const withoutDate = ({ se_pivot_date: _date, ...rest }) => { void _date; return rest; };
const measure = (s, extra) => measureContractions(s.bars, { row: s.row(extra), date: s.date });
const index = (bars, date) => bars.findIndex(bar => bar.date === date);

// HUM's shape (the cup's left lip above the handle pivot): the 100.30 base high, a 20% first contraction, a recovery to the
// 96.29 handle high (the pivot's bar), a 7% handle pullback, closes above the pivot while the highs stay under the base
// high, then a 4% dip after the breakout.
const hum = () => stock([[25, 80], [20, 96], [8, 90], [6, 97], [3, 93.6]]);
// LIND's shape: a base, the pivot's bar, the breakout, a rally to a new high above the base high, a 20% drop, a rally and a
// shallower drop: before R6 the whole measured base was the one after the breakout.
const lind = () => stock([[20, 80], [15, 97], [6, 92], [8, 115], [12, 92], [10, 112], [6, 104]]);
// Three contractions (25/12/6) up to the pivot's bar, a breakout on the next bar and a 5% dip after it.
const three = () => stock([[25, 75.6], [20, 99], [15, 87.5], [12, 98], [8, 92.4], [6, 97.5], [4, 100], [5, 96]]);
// CFBK's shape: the breakout, closes back under the pivot (a failed-breakout drop), then a re-cross.
const cfbk = () => stock([[20, 82], [18, 96], [6, 91], [5, 97.5], [5, 90], [6, 99], [3, 98]]);

describe('pivotBreakout: the first close above the pivot after its bar (R6, 独自判定)', () => {
  it('cuts at the first close above the pivot\'s cents after the pivot bar, with the exact dates', () => {
    const s = hum(), pb = s.marks[2], cut = pivotBreakout(s.bars, s.row(dailyPivot(s.bars, pb)));
    const first = s.bars.findIndex((bar, i) => i > pb && cents(bar.close) > cents(s.bars[pb].high));
    expect(first).toBe(s.marks[4]);
    expect(cut).toEqual({ state: 'cut', pivotDate: s.bars[pb].date, breakoutDate: s.bars[first].date, index: first, measuredThrough: s.bars[first - 1].date });
  });

  it('agrees with the crossing seam: pivotBar\'s index is crossingFloor, and a single crossing\'s breakout is the cut', () => {
    for (const [s, at] of [[hum(), 2], [lind(), 2], [three(), 6], [cfbk(), 2]]) {
      for (const pivot of [dailyPivot(s.bars, s.marks[at]), weeklyPivot(s.bars, s.marks[at])]) {
        const row = s.row(pivot);
        expect(pivotBar(s.bars, row).index).toBe(s.marks[at]);
        expect(pivotBar(s.bars, row).index).toBe(crossingFloor(s.bars, row));
      }
    }
    // HUM's closes cross the pivot once after its bar (within the 60-session lookback): that crossing's breakout is the cut.
    const s = hum(), row = s.row(dailyPivot(s.bars, s.marks[2])), from = crossingFloor(s.bars, row), P = row.se_pivot_price;
    const crossing = lastPivotCrossing(s.bars, P, { from });
    expect(crossing.sessionsAgo).toBeLessThanOrEqual(60);
    expect(breakoutBar(s.bars, P, crossing, { from }).date).toBe(pivotBreakout(s.bars, row).breakoutDate);
  });

  it('reads a close at the pivot\'s cents as a touch, and a pivot with float noise in cents', () => {
    const bar = (date, high, close) => ({ date, open: close, high, low: Math.min(close, high) - 0.5, close, volume: 1000 });
    const bars = [bar('2026-03-02', 89.5, 89), bar('2026-03-03', 89.88, 89.5), bar('2026-03-04', 89.95, 89.88), bar('2026-03-05', 89.9, 89.6), bar('2026-03-06', 90.1, 89.89)];
    const row = { se_pattern_primary: 'high_tight_flag', se_pivot_date: '2026-03-03', se_pivot_price: 89.88000000000001 };
    expect(pivotBar(bars, row)).toEqual({ index: 1, date: '2026-03-03' });
    expect(pivotBreakout(bars, row)).toEqual({ state: 'cut', pivotDate: '2026-03-03', breakoutDate: '2026-03-06', index: 4, measuredThrough: '2026-03-05' });
    // Still only touching: no breakout yet.
    expect(pivotBreakout(bars.slice(0, 4), row)).toEqual({ state: 'none', pivotDate: '2026-03-03', breakoutDate: null, index: null, measuredThrough: null });
    // A close above the pivot on or before the pivot's bar is not its breakout.
    const early = [bar('2026-03-02', 90.5, 90.2), ...bars.slice(1, 4)];
    expect(pivotBreakout(early, row).state).toBe('none');
  });

  it('is unknown without the pivot\'s bar', () => {
    const s = hum(), pb = s.marks[2], unknown = { state: 'unknown', pivotDate: null, breakoutDate: null, index: null, measuredThrough: null };
    expect(pivotBreakout(s.bars, s.row(withoutDate(dailyPivot(s.bars, pb))))).toEqual(unknown);
    // A vcp primary publishes no pivot date (vcp_wrapper.py: pivot_date is always None).
    expect(pivotBreakout(s.bars, s.row({ ...withoutDate(dailyPivot(s.bars, pb)), se_pattern_primary: 'vcp' }))).toEqual(unknown);
    expect(pivotBreakout(s.bars, s.row({ ...dailyPivot(s.bars, pb), se_pivot_price: s.bars[pb].high + 0.01 }))).toEqual(unknown);
    expect(pivotBreakout(s.bars, null)).toEqual(unknown);
    expect(pivotBreakout([], s.row(dailyPivot(s.bars, pb)))).toEqual(unknown);
  });
});

describe('contractions end before the pivot\'s breakout (R6)', () => {
  it('HUM: drops the dip after the breakout and keeps the leg that holds the handle (daily and weekly pivots)', () => {
    const s = hum(), pb = s.marks[2];
    for (const pivot of [dailyPivot(s.bars, pb), weeklyPivot(s.bars, pb)]) {
      // The bug, reproduced: without the pivot's date a leg ends on or after the breakout, and the depths read as contracting.
      const breakoutDate = pivotBreakout(s.bars, s.row(pivot)).breakoutDate;
      const before = measure(s, withoutDate(pivot));
      expect(before.pivotCut.state).toBe('unknown');
      expect(before.legs.some(leg => leg.endDate >= breakoutDate)).toBe(true);
      expect(before.depthsContract).toBe(true);
      const after = measure(s, pivot);
      expect(after.pivotCut).toEqual({ state: 'cut', pivotDate: s.bars[pb].date, breakoutDate: s.bars[s.marks[4]].date, measuredThrough: s.bars[s.marks[4] - 1].date });
      expect(after.legs.length).toBeGreaterThan(0);
      expect(after.legs.every(leg => leg.endDate < breakoutDate)).toBe(true);
      // The handle's leg starts on the pivot's bar and ends after it, before the breakout: it is kept.
      const handle = after.legs.find(leg => leg.endDate > s.bars[pb].date && leg.endDate < breakoutDate);
      expect(handle).toMatchObject({ startDate: s.bars[pb].date, endDate: s.bars[s.marks[3]].date, high: s.bars[pb].high });
      expect(after.legs.map(leg => Math.round(leg.depthPct))).toEqual([20, 7]);
      expect(after.measurementsValid).toBe(true);
      // The base keeps its meaning: its high was never exceeded.
      expect(after.base).toEqual(before.base);
      expect(after.base.brokeOut).toBe(false);
    }
  });

  it('LIND: the base is the one before the breakout, not the base after it', () => {
    const s = lind(), pivot = dailyPivot(s.bars, s.marks[2]);
    const before = measure(s, withoutDate(pivot)), breakoutDate = pivotBreakout(s.bars, s.row(pivot)).breakoutDate;
    expect(before.base.startDate > breakoutDate).toBe(true);
    expect(before.depthsContract).toBe(true);
    const after = measure(s, pivot);
    expect(after.base.startDate < breakoutDate).toBe(true);
    expect(after.base).toMatchObject({ startDate: s.bars[s.marks[0]].date, high: s.bars[s.marks[0]].high, source: 'algorithm' });
    expect(after.legs.length).toBeGreaterThan(0);
    expect(after.legs.every(leg => leg.endDate < breakoutDate)).toBe(true);
    // base.brokeOut / breakoutDate keep their definition (the first high above the base high after its start): the rally's.
    const above = s.bars.findIndex((bar, i) => i > s.marks[0] && bar.high > s.bars[s.marks[0]].high);
    expect(after.base).toMatchObject({ brokeOut: true, breakoutDate: s.bars[above].date, endDate: s.bars[above - 1].date });
    expect(after.base.breakoutDate > breakoutDate).toBe(true);
  });

  it('re-measures: the legs are exactly those of the bars before the breakout bar', () => {
    for (const [name, s, at, count] of [['hum', hum(), 2, 2], ['lind', lind(), 2, 2], ['three', three(), 6, 3]]) {
      const pivot = dailyPivot(s.bars, s.marks[at]), c = pivotBreakout(s.bars, s.row(pivot)).index;
      const full = measure(s, pivot), sliced = measureContractions(s.bars.slice(0, c), { row: s.row(withoutDate(pivot)), date: null });
      expect({ name, state: sliced.pivotCut.state, count: full.legs.length }).toEqual({ name, state: 'unknown', count });
      expect({ name, legs: full.legs }).toEqual({ name, legs: sliced.legs });
    }
    // The three-contraction base keeps 25/12/6 and loses only the dip after the breakout.
    const s = three(), pivot = dailyPivot(s.bars, s.marks[6]);
    expect(measure(s, withoutDate(pivot)).legs.map(leg => Math.round(leg.depthPct))).toEqual([25, 12, 6, 5]);
    expect(measure(s, pivot).legs.map(leg => Math.round(leg.depthPct))).toEqual([25, 12, 6]);
  });

  it('CFBK: the cut is the first close above, the failed-breakout drop is not a leg, and a later re-cross does not move it', () => {
    const s = cfbk(), row = s.row(dailyPivot(s.bars, s.marks[2])), P = row.se_pivot_price;
    const cut = pivotBreakout(s.bars, row);
    expect(cut.index).toBe(s.bars.findIndex((bar, i) => i > s.marks[2] && cents(bar.close) > cents(P)));
    // The closes went back under the pivot after it.
    expect(s.bars.slice(cut.index).some(bar => cents(bar.close) < cents(P))).toBe(true);
    // Intended: the crossing readers (latest crossing, from the pivot's bar) date the re-cross, later than the cut.
    const from = crossingFloor(s.bars, row);
    expect(lastPivotCrossing(s.bars, P, { from }).date > cut.breakoutDate).toBe(true);
    const failedDrop = leg => leg.startDate >= cut.breakoutDate;
    expect(measure(s, withoutDate(row)).legs.some(failedDrop)).toBe(true);
    const after = measure(s, row);
    expect(after.legs.some(failedDrop)).toBe(false);
    expect(after.legs.every(leg => leg.endDate < cut.breakoutDate)).toBe(true);
    expect(after.legs).toHaveLength(2);
  });

  it('state none (the pivot\'s bar, no close above yet): legs and base are exactly the uncut ones, a leg after the pivot bar included', () => {
    // HUM's shape up to the handle's recovery, still under the pivot.
    const s = stock([[25, 80], [20, 96], [8, 90], [4, 95]]), pivot = dailyPivot(s.bars, s.marks[2]);
    const cut = measure(s, pivot), uncut = measure(s, withoutDate(pivot));
    expect(cut.pivotCut).toEqual({ state: 'none', pivotDate: s.bars[s.marks[2]].date, breakoutDate: null, measuredThrough: null });
    expect(cut.legs).toEqual(uncut.legs);
    expect(cut.base).toEqual(uncut.base);
    expect(cut.legs.some(leg => leg.endDate > s.bars[s.marks[2]].date)).toBe(true);
  });

  it('state unknown: no pivot date, a vcp primary, or no bar whose high is the pivot measure exactly as without the pivot fields', () => {
    const s = hum(), pivot = dailyPivot(s.bars, s.marks[2]);
    const plain = measure(s, {});
    for (const extra of [withoutDate(pivot), { ...withoutDate(pivot), se_pattern_primary: 'vcp' }, { ...pivot, se_pivot_price: round(pivot.se_pivot_price + 0.01) }]) {
      const result = measure(s, extra);
      expect(result.pivotCut.state).toBe('unknown');
      expect(result.legs).toEqual(plain.legs);
      expect(result.base).toEqual(plain.base);
    }
  });

  it('one kept leg is one leg, no kept leg is no contraction claim; neither is ever 0', () => {
    // One leg: the 20% contraction, the recovery to the pivot's bar, the breakout on the next bar, a 5% dip after it.
    const one = stock([[25, 80], [20, 96], [4, 99], [3, 95]]), onePivot = dailyPivot(one.bars, one.marks[2]);
    expect(measure(one, withoutDate(onePivot))).toMatchObject({ measurementsValid: true, depthsContract: true });
    const kept = buildBookTechnicalEvidence(one.row(onePivot), one.payload, one.date);
    expect(kept.valid).toBe(true);
    const v = kept.vcp;
    expect(v.pivotCut).toMatchObject({ state: 'cut', pivotDate: one.bars[one.marks[2]].date, breakoutDate: one.bars[one.marks[2] + 1].date });
    expect(v.legs).toHaveLength(1);
    expect(v.legs[0].depthPct).toBeGreaterThan(0);
    expect(v).toMatchObject({ enoughLegs: false, measurementsValid: false, depthsContract: null, volumeContracts: null });
    expect(v.lastMeasuredDate).toBe(v.legs[0].endDate);
    expect(v.finalContractionVolume).toBe(v.legs[0].volumeEvidence);
    // None: a smooth advance to the pivot's bar (no confirmed swing high before it), the breakout on the next bar, then a
    // base after the breakout that the uncut measurement took for this one.
    const none = stock([[3, 104], [12, 115], [12, 95], [10, 112], [6, 105]]), nonePivot = dailyPivot(none.bars, none.marks[0]);
    expect(measure(none, withoutDate(nonePivot))).toMatchObject({ measurementsValid: true, depthsContract: true });
    const empty = buildBookTechnicalEvidence(none.row(nonePivot), none.payload, none.date);
    expect(empty.valid).toBe(true);
    expect(empty.vcp.pivotCut).toMatchObject({ state: 'cut', breakoutDate: none.bars[none.marks[0] + 1].date });
    expect(empty.vcp).toMatchObject({ legs: [], base: null, enoughLegs: false, measurementsValid: false, depthsContract: null, volumeContracts: null,
      lastMeasuredDate: null, finalContractionVolume: null });
  });

  it('confines a current Setup Engine base to the bars before the breakout', () => {
    const s = lind(), pivot = weeklyPivot(s.bars, s.marks[2]), c = pivotBreakout(s.bars, s.row(pivot)).index;
    const candidate = { pattern: 'cup_with_handle', timeframe: 'weekly', start_date: s.bars[s.marks[0] - 10].date, end_date: s.bars.at(-2).date };
    const engine = { ...pivot, se_candidates: [candidate], setup_recalculation: { status: 'calculated', as_of_date: s.date } };
    // Without the pivot's date the candidate's highest high is the rally after the breakout.
    const uncut = measure(s, withoutDate(engine));
    expect(uncut.base.source).toBe('setup-engine');
    expect(index(s.bars, uncut.base.startDate)).toBeGreaterThanOrEqual(c);
    const cut = measure(s, engine);
    expect(cut.base).toMatchObject({ source: 'setup-engine', pattern: 'cup_with_handle', startDate: s.bars[s.marks[0]].date });
    expect(index(s.bars, cut.base.startDate)).toBeLessThan(c - 1);
    expect(cut.legs.every(leg => index(s.bars, leg.endDate) < c)).toBe(true);
    // A candidate that starts at the breakout or later has no bar before the cut: the zigzag's anchor is used.
    const late = measure(s, { ...engine, se_candidates: [{ ...candidate, start_date: s.bars[c].date }] });
    expect(late.base.source).toBe('algorithm');
    expect(index(s.bars, late.base.startDate)).toBeLessThan(c);
    // The candidate's highest bar just before the cut has no bar after it under the cut: also the zigzag's anchor.
    const edge = measure(s, { ...engine, se_candidates: [{ ...candidate, start_date: s.bars[c - 1].date }] });
    expect(edge.base.source).toBe('algorithm');
  });

  it('leaves the reviewer\'s intervals as they are and reports the cut beside them', () => {
    const s = hum(), pivot = dailyPivot(s.bars, s.marks[2]), b = s.bars;
    const review = { source: 'reviewer chart annotation', reviewedAt: '2026-04-20T05:00:00Z', intervals: [
      { startDate: b[s.marks[0]].date, endDate: b[s.marks[1]].date }, { startDate: b[s.marks[4]].date, endDate: b[s.marks[5]].date }] };
    const reviewed = measureContractions(b, { row: s.row(pivot), date: s.date, review });
    expect(reviewed.source).toBe('reviewer-intervals');
    expect(reviewed.legs.map(leg => leg.endDate)).toEqual([b[s.marks[1]].date, b[s.marks[5]].date]);
    expect(reviewed.pivotCut).toMatchObject({ state: 'cut', breakoutDate: b[s.marks[4]].date });
    expect(measureContractions(b, { row: s.row(pivot), date: s.date, review: { ...review, intervals: [] } }).pivotCut.state).toBe('cut');
  });

  it('says so in the limitations and publishes the v3 method', () => {
    const s = hum(), evidence = buildBookTechnicalEvidence(s.row(dailyPivot(s.bars, s.marks[2])), s.payload, s.date);
    expect(BOOK_TECHNICAL_VERSION).toBe('book-technical-evidence-v3');
    expect(evidence.version).toBe('book-technical-evidence-v3');
    expect(evidence.vcp.limitations).toContain('自動測定では、ピボットの日足の後に終値が初めてピボットを上回った日（上抜け）からの値動きを収縮に数えない（独自判定）');
  });
});
