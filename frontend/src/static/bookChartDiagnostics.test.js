import { describe, expect, it } from 'vitest';
import { diagnoseBookChart } from './bookChartDiagnostics';

function fixture() {
  const bars = [];
  for (let t = Date.parse('2025-05-01'); bars.length < 280; t += 86400000) {
    const date = new Date(t);
    if ([0, 6].includes(date.getUTCDay())) continue;
    bars.push({ date: date.toISOString().slice(0, 10), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  const date = bars.at(-1).date, row = { symbol: 'TEST', current_price: 100 };
  return { row, date, payload: { symbol: 'TEST', as_of_date: date, bars,
    rs_line: bars.map((b, i) => ({ time: b.date, value: 1 + i / 1000 })) } };
}
const run = f => diagnoseBookChart(f.row, f.payload, f.date);

describe('book chart evidence without automatic certification', () => {
  it('uses 30/65 session endpoint comparisons with provenance, not an official rating', () => {
    const f = fixture(), result = run(f);
    expect(result.valid).toBe(true);
    expect(result.rsLine.sixWeeks.changePct).toBeCloseTo((1.279 / 1.249 - 1) * 100);
    expect(result.rsLine.thirteenWeeks.start.date).toBe(f.payload.bars.at(-66).date);
    expect(result.rsLine.sixWeeks.state).toBe('up');
    expect(result.rsLine.independentBenchmarkRecalculation).toBe(false);
    f.payload.rs_line.forEach(p => { p.value = 1; });
    expect(run(f).rsLine.sixWeeks.state).toBe('flat');
  });
  for (const [name, mutation] of [
    ['missing point', f => f.payload.rs_line.splice(-10, 1)],
    ['duplicate point', f => f.payload.rs_line[10] = f.payload.rs_line[9]],
    ['wrong final date', f => { f.payload.rs_line.at(-1).time = '2000-01-01'; }],
    ['nonfinite value', f => { f.payload.rs_line.at(-2).value = Infinity; }],
    ['missing series', f => { delete f.payload.rs_line; }],
  ]) it(`does not accept RS with ${name}`, () => {
    const f = fixture(); mutation(f);
    const result = run(f);
    expect(result.rsLine.sixWeeks.state).toBe('unknown');
    expect(result.rsLine.errors.length).toBeGreaterThan(0);
    expect(result.valid).toBe(true); // RS defects do not invalidate otherwise valid prices.
  });
  it('accepts a trailing aligned RS series but requires 66 points for 65 sessions', () => {
    const f = fixture(); f.payload.rs_line = f.payload.rs_line.slice(-65);
    expect(run(f).rsLine.sixWeeks.state).toBe('up');
    expect(run(f).rsLine.thirteenWeeks.state).toBe('unknown');
  });
  it('requires three successive lower lows, the 20DMA break and proxy heavy volume together', () => {
    const f = fixture();
    f.payload.bars.slice(-3).forEach((b, i) => Object.assign(b, { low: 98 - i, close: 99 - i, open: 99 - i, high: 100 - i }));
    f.row.current_price = 97;
    f.payload.bars.at(-1).volume = 1400;
    const w = run(f).priceWarnings;
    expect(w.combinedWarning).toBe(true);
    expect(w.below50).toBe(true);
    expect(w.automaticSell).toBe(false);
    f.payload.bars.at(-1).volume = 1399;
    expect(run(f).priceWarnings.combinedWarning).toBe(false);
    f.payload.bars.at(-1).volume = 1400;
    f.payload.bars.at(-3).low = 99;
    expect(run(f).priceWarnings.combinedWarning).toBe(false);
  });
  it('uses disjoint volume windows and does not turn lower volume into VCP certification', () => {
    const f = fixture(); f.payload.bars.slice(-5).forEach(b => { b.volume = 500; });
    const d = run(f).rightEdgeVolume;
    expect(d.ratio).toBe(.5);
    expect(d.baselineMean).toBe(1000);
    expect(d.actualVcpConfirmed).toBe(false);
    f.payload.bars.slice(-55, -5).forEach(b => { b.volume = 0; });
    expect(run(f).rightEdgeVolume.ratio).toBeNull();
  });
  it('screens a preceding 40-session doubling and a 25% base without certifying the pattern', () => {
    const f = fixture(), n = f.payload.bars.length;
    for (let i = n - 56; i < n - 15; i++) {
      const close = 100 + (i - (n - 56)) * 2.5;
      Object.assign(f.payload.bars[i], { close, open: close, low: close, high: close });
    }
    f.payload.bars.slice(-15).forEach(b => Object.assign(b, { open: 180, close: 180, high: 200, low: 150 }));
    f.row.current_price = 180;
    const p = run(f).powerPlay;
    expect(p.windows[0].risePct).toBe(100);
    expect(p.windows[0].depthPct).toBe(25);
    expect(p.windows[0].mechanicalMatch).toBe(true);
    expect(p.certification).toBe(false);
    expect(p.fundamentalsRequiredByThisPattern).toBe(false);
    f.payload.bars.slice(-15).forEach(b => Object.assign(b, { open: 160, close: 160, high: 180, low: 135 }));
    f.row.current_price = 160;
    expect(run(f).powerPlay.windows[0].depthPct).toBe(32.5);
    expect(run(f).powerPlay.windows[0].mechanicalMatch).toBe(false);
    f.payload.bars.slice(-15).forEach(b => Object.assign(b, { open: 180, close: 180, high: 200, low: 150 }));
    f.row.current_price = 180;
    f.payload.bars.at(-1).low = 149.9;
    expect(run(f).powerPlay.windows[0].mechanicalMatch).toBe(false);
  });
  it('fails closed for invalid OHLCV, wrong symbol/date, absent input and price mismatch', () => {
    for (const mutate of [f => { f.payload.symbol = 'OTHER'; }, f => { f.payload.as_of_date = '2000-01-01'; },
      f => { f.payload.bars.at(-1).high = 1; }, f => { f.row.current_price = 200; }, f => { f.payload.bars[3] = null; }]) {
      const f = fixture(); mutate(f); const r = run(f);
      expect(r.valid).toBe(false); expect(r.powerPlay).toBeNull(); expect(r.rsLine).toBeNull();
    }
    expect(diagnoseBookChart(null, null, null).valid).toBe(false);
  });
});
