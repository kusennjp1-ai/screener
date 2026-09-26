import { describe, expect, it } from 'vitest';
import { buildBookTechnicalEvidence } from './bookTechnicalEvidence';

function fixture(count = 320) {
  const bars = [];
  for (let t = Date.parse('2025-01-01'); bars.length < count; t += 86400000) {
    const date = new Date(t);
    if ([0, 6].includes(date.getUTCDay())) continue;
    const close = 100 + bars.length / 10;
    bars.push({ date: date.toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1000 });
  }
  const date = bars.at(-1).date;
  return { row: { symbol: 'TEST', current_price: bars.at(-1).close }, payload: { symbol: 'TEST', as_of_date: date, bars }, date,
    benchmark: { symbol: 'SPY', as_of_date: date, bars: bars.map(b => ({ date: b.date, close: 100 })) } };
}
const run = (f, options = {}) => buildBookTechnicalEvidence(f.row, f.payload, f.date, { benchmark: f.benchmark, ...options });

describe('book technical evidence', () => {
  it('measures every rolling SMA200 step and keeps 4/5 months preferred', () => {
    const f = fixture(), r = run(f).sma200;
    expect(r.oneMonth.state).toBe('sustained-up');
    expect(r.oneMonth.upSteps).toBe(21);
    expect(r.oneMonth.points).toHaveLength(22);
    expect(r.preferredFourMonths.upSteps).toBe(84);
    expect(r.preferredFiveMonths.upSteps).toBe(105);
    expect(r.preferredNotRequired).toBe(true);
    expect(r.oneMonth.end.value).toBeCloseTo((112 + 131.9) / 2);
  });
  it('does not turn a positive endpoint into a sustained rise when an intervening step falls', () => {
    const f = fixture();
    Object.assign(f.payload.bars.at(-1), { open: 110, high: 111, low: 109, close: 110 });
    f.row.current_price = 110;
    const trend = run(f).sma200.oneMonth;
    expect(trend.changePct).toBeGreaterThan(0);
    expect(trend.downSteps).toBe(1);
    expect(trend.state).toBe('mixed');
  });
  it('does not invent preferred long SMA histories from 252 bars', () => {
    const r = run(fixture(252)).sma200;
    expect(r.oneMonth.state).toBe('sustained-up');
    expect(r.preferredFourMonths.state).toBe('unknown');
    expect(r.preferredFiveMonths.state).toBe('unknown');
  });
  it('independently divides date-aligned stock/SPY prices instead of trusting rs_line', () => {
    const f = fixture(); f.payload.rs_line = [{ time: f.date, value: 99999 }];
    const rs = run(f).rs;
    expect(rs.independentRecalculation).toBe(true);
    expect(rs.sixWeeks.end.value).toBeCloseTo(1.319);
    expect(rs.sixWeeks.start.value).toBeCloseTo(1.289);
    expect(rs.thirteenWeeks.points).toHaveLength(66);
    expect(rs.sixWeeks.state).toBe('sustained-up');
    f.benchmark.bars.forEach((b, i) => { b.close = 100 + i; });
    expect(run(f).rs.sixWeeks.state).toBe('sustained-down');
  });
  it('accepts the 21-bar published overlap without claiming 30/65-session evidence', () => {
    const f = fixture(); f.benchmark.bars = f.benchmark.bars.slice(-21);
    const rs = run(f).rs;
    expect(rs.independentRecalculation).toBe(true);
    expect(rs.points).toHaveLength(21);
    expect(rs.sixWeeks.state).toBe('unknown');
    expect(rs.thirteenWeeks.state).toBe('unknown');
  });
  for (const [name, mutate] of [
    ['missing date', f => f.benchmark.bars.splice(-10, 1)],
    ['wrong symbol', f => { f.benchmark.symbol = 'QQQ'; }],
    ['stale snapshot', f => { f.benchmark.as_of_date = '2000-01-01'; }],
    ['zero price', f => { f.benchmark.bars.at(-1).close = 0; }],
    ['duplicate date', f => { f.benchmark.bars[10].date = f.benchmark.bars[9].date; }],
  ]) it(`rejects independent RS with ${name}`, () => {
    const f = fixture(); mutate(f); const rs = run(f).rs;
    expect(rs.independentRecalculation).toBe(false);
    expect(rs.errors.length).toBeGreaterThan(0);
    expect(rs.sixWeeks.state).toBe('unknown');
  });
  it('measures reviewer-specified OHLC extrema, positive duration and actual volume without certifying VCP', () => {
    const f = fixture(), bars = f.payload.bars;
    [[290, [147, 140, 130, 125, 120], 2000], [300, [148, 147, 145, 140, 135], 1000]].forEach(([start, lows, volume]) => {
      lows.forEach((low, i) => Object.assign(bars[start + i], { open: low + 1, close: low + 2, high: i ? Math.min(150, low + 4) : 150, low, volume }));
    });
    const review = { source: 'reviewer chart annotation', reviewedAt: '2026-09-26T05:00:00Z', intervals: [
      { startDate: bars[290].date, endDate: bars[294].date }, { startDate: bars[300].date, endDate: bars[304].date },
    ] };
    const vcp = run(f, { review }).vcp;
    expect(vcp.legs.map(l => l.depthPct)).toEqual([20, 10]);
    expect(vcp.legs.map(l => l.sessions)).toEqual([4, 4]);
    expect(vcp.legs.map(l => l.averageVolume)).toEqual([2000, 1000]);
    expect(vcp.depthsContract).toBe(true);
    expect(vcp.volumeContracts).toBe(true);
    expect(vcp.finalContractionVolume.preceding50Mean).toBe(1100);
    expect(vcp.finalContractionVolume.lastRatio).toBeCloseTo(1000 / 1100);
    expect(vcp.finalContractionVolume.lastTwoRatio).toBeCloseTo(1000 / 1100);
    expect(vcp.finalContractionVolume.baselineEnd).toBe(bars[299].date);
    expect(vcp.finalContractionVolume.lastDate).toBe(bars[304].date);
    expect(vcp.certification).toBe(false);
    expect(vcp.reviewer.source).toBe(review.source);
    const bad = structuredClone(review); bad.intervals[1].startDate = bars[293].date;
    expect(run(f, { review: bad }).vcp.errors.length).toBeGreaterThan(0);
    expect(run(f, { review: { ...review, source: '' } }).vcp.legs).toHaveLength(0);
  });
  it('compares final one/two contraction bars against only the 50 sessions before the selected contraction', () => {
    const f = fixture(), bars = f.payload.bars;
    const review = { source: 'reviewed intervals', reviewedAt: '2026-09-26T05:00:00Z', intervals: [
      { startDate: bars[270].date, endDate: bars[274].date }, { startDate: bars[300].date, endDate: bars[304].date },
    ] };
    bars[303].volume = 400; bars[304].volume = 200;
    // Later volume must not leak into the reviewed historical interval.
    bars.slice(305).forEach(b => { b.volume = 9000000; });
    const v = run(f, { review }).vcp.finalContractionVolume;
    expect(v.preceding50Mean).toBe(1000);
    expect(v.lastRatio).toBe(.2);
    expect(v.lastTwoRatio).toBe(.3);
    expect(v.intervalRatio).toBe(.72);
    review.intervals = [{ startDate: bars[5].date, endDate: bars[9].date }, { startDate: bars[15].date, endDate: bars[19].date }];
    const missing = run(f, { review }).vcp.finalContractionVolume;
    expect(missing.baselineSessions).toBe(15);
    expect(missing.lastRatio).toBeNull();
  });
  it('does not fabricate algorithm legs on a smooth uptrend', () => {
    const vcp = run(fixture()).vcp;
    expect(vcp.legs).toHaveLength(0);
    expect(vcp.depthsContract).toBeNull();
    expect(vcp.certification).toBe(false);
  });
  it('automatically measures high-low legs in chronological order instead of using close-only depths', () => {
    const f = fixture(), bars = f.payload.bars;
    [[280, [147, 140, 128, 120, 110]], [295, [148, 140, 138, 136, 135, 130]]].forEach(([start, lows]) => {
      lows.forEach((low, i) => Object.assign(bars[start + i], { open: low + 1, close: low + 2, high: i ? Math.min(150, low + 4) : 150, low }));
    });
    const vcp = run(f).vcp;
    expect(vcp.legs).toHaveLength(2);
    expect(vcp.legs[0].startDate).toBe(bars[280].date);
    expect(vcp.legs[0].low).toBe(110);
    expect(vcp.legs[0].depthPct).toBeCloseTo((150 - 110) / 150 * 100);
    expect(vcp.legs[0].sessions).toBe(4);
    expect(vcp.legs[1].startDate).toBe(bars[295].date);
    expect(vcp.depthsContract).toBe(true);
    expect(vcp.certification).toBe(false);
  });
  it('fails closed for corrupt source OHLCV before calculating any technical evidence', () => {
    const f = fixture(); f.payload.bars.at(-1).high = 1;
    const r = run(f);
    expect(r.valid).toBe(false);
    expect(r.sma200).toBeNull();
    expect(r.rs).toBeNull();
    expect(r.vcp).toBeNull();
  });
});
