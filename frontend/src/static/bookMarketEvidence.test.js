import { describe, expect, it } from 'vitest';
import { buildBookMarketEvidence } from './bookMarketEvidence';

function fixture(count = 100) {
  const dates = [];
  for (let t = Date.parse('2025-01-02'); dates.length < 280; t += 86400000) {
    const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
  }
  const charts = Array.from({ length: count }, (_, j) => ({ symbol: `S${String(j).padStart(3, '0')}`, as_of_date: dates.at(-1),
    bars: dates.map((date, i) => { const close = 100 + i * (.1 + j / 500); return { date, open: close, close, high: close + 1, low: close - 1, volume: 1000 }; }) }));
  const benchmark = { symbol: 'SPY', bars: dates.map((date, i) => ({ date, open: 100 + i / 10, close: 100 + i / 10, high: 101 + i / 10, low: 99 + i / 10, volume: 1000 + i })) };
  return { charts, benchmark, asOfDate: dates.at(-1), expectedUniverseSize: count + 10, lookbackSessions: 5 };
}
describe('historical market evidence without hindsight membership', () => {
  it('computes dates from their own price prefixes and never reads present screening flags', () => {
    const f = fixture(), original = buildBookMarketEvidence(f);
    f.charts.forEach(c => { c.passes_template = false; c.rs_rating = 1; c.se_setup_ready = true; });
    expect(buildBookMarketEvidence(f)).toEqual(original);
    const earlyDate = f.charts[0].bars.at(-5).date;
    const early = buildBookMarketEvidence({ ...f, asOfDate: earlyDate });
    f.charts.at(-1).bars.at(-1).close = 1;
    expect(buildBookMarketEvidence({ ...f, asOfDate: earlyDate })).toEqual(early);
  });
  it('keeps the original cohort when a former leader deteriorates and the index rises', () => {
    const f = fixture();
    const last = f.charts.at(-1).bars.at(-1), close = last.close * .75;
    Object.assign(last, { close, open: close, high: close + 1, low: close - 1 });
    const d = buildBookMarketEvidence(f);
    expect(d.cohortMembers).toContain('S099');
    expect(d.latest.cohort.below50).toBeGreaterThan(0);
    expect(d.latest.cohort.lostLeaderStatus).toBeGreaterThan(0);
    expect(d.latest.cohort.indexReturnPct).toBeGreaterThan(0);
    expect(d.latest.cohort.selectedAt).toBe(d.series[0].date);
  });
  it('tracks a missing cohort member rather than treating it as healthy or removing history', () => {
    const f = fixture(); f.charts.at(-1).bars.pop();
    const d = buildBookMarketEvidence(f);
    expect(d.cohortMembers).toContain('S099');
    expect(d.latest.cohort.missing).toBe(1);
    expect(d.latest.cohort.lostLeaderStatus).toBeNull(); // Rank universe is now below 100.
    expect(d.latest.coverage).toBe(99);
  });
  it('requires a strict new extreme and at least 252 bars; missing ranks are not zero leaders', () => {
    const f = fixture(1), bars = f.charts[0].bars;
    bars.at(-1).high = bars.at(-2).high;
    bars.at(-1).open = bars.at(-1).close = bars.at(-2).close;
    const d = buildBookMarketEvidence(f);
    expect(d.latest.newHighs).toBe(0);
    expect(d.latest.leaderCount).toBeNull();
    expect(d.latest.setupProxyCount).toBeNull();
    expect(d.latest.leadersPositiveWhileIndexNegative).toBeNull();
    bars.at(-1).high += .01;
    expect(buildBookMarketEvidence(f).latest.newHighs).toBe(1);
    expect(buildBookMarketEvidence({ ...f, asOfDate: bars[250].date }).series).toEqual([]);
  });
  it('does not relabel a stock missing a known benchmark session as daily evidence', () => {
    const f = fixture(); f.charts.at(-1).bars.splice(-2, 1);
    const d = buildBookMarketEvidence(f);
    expect(d.cohortMembers).toContain('S099');
    expect(d.latest.coverage).toBe(99);
    expect(d.latest.cohort.missing).toBe(1);
    expect(d.latest.leadersPositiveWhileIndexNegative).toBeNull();
    expect(d.series[0].coverage).toBe(100);
  });
  it('sums rising and falling volume separately and checks same-day index volume direction', () => {
    const f = fixture(2), down = f.charts[1].bars.at(-1);
    Object.assign(down, { open: 120, close: 120, low: 119, high: 121, volume: 2000 });
    const d = buildBookMarketEvidence(f);
    expect(d.latest.upVolume).toBe(1000); expect(d.latest.downVolume).toBe(2000);
    expect(d.latest.downDollarVolume).toBe(240000);
    expect(d.latest.benchmark.upOnHigherVolume).toBe(true);
    f.benchmark.bars.pop();
    expect(buildBookMarketEvidence(f).latest.benchmark).toBeNull();
  });
  it('records dates and evidence for range-proxy breakouts but never certifies a VCP', () => {
    const f = fixture(), bars = f.charts.at(-1).bars;
    bars.slice(-6, -1).forEach(b => { b.volume = 500; });
    const pivot = Math.max(...bars.slice(-21, -1).map(b => b.high)), close = pivot * 1.01;
    Object.assign(bars.at(-1), { open: close, close, high: close + 1, low: close - 1, volume: 2000 });
    const d = buildBookMarketEvidence(f), event = d.breakoutEvents.find(e => e.symbol === 'S099');
    expect(event).toMatchObject({ date: f.asOfDate, certifiedSetup: false, pivotProxy: pivot });
    expect(event.volumeRatio).toBeGreaterThan(1.4);
    expect(d.latest.breakoutProxyCount).toBeGreaterThan(0);
  });
  it('excludes duplicate symbols and bad OHLCV without borrowing stale observations', () => {
    const f = fixture(2); f.charts.push(structuredClone(f.charts[0]));
    f.charts[1].bars.at(-1).volume = -1;
    const d = buildBookMarketEvidence(f);
    expect(d.universe.duplicateSymbolsExcluded).toEqual(['S000']);
    expect(d.latest.date).not.toBe(f.asOfDate);
    expect(d.currentSnapshotComplete).toBe(false);
    expect(d.universe.survivorshipBias).toBe(true);
  });
  it('rejects invalid dates and fabricated universe sizes', () => {
    expect(() => buildBookMarketEvidence({ ...fixture(1), asOfDate: '2026-02-30' })).toThrow();
    expect(() => buildBookMarketEvidence({ ...fixture(1), expectedUniverseSize: 0 })).toThrow();
    expect(() => buildBookMarketEvidence({ ...fixture(1), lookbackSessions: 0 })).toThrow();
  });
});
