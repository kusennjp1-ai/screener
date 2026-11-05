import { describe, expect, it } from 'vitest';
import { footprint, gapDays, RS_LEAD_FROM_HIGH_PERCENT, rsLeadMarks, rsLineNewHigh } from './briefChartModel';

describe('brief model', () => {
  it('writes the VCP footprint only from valid, measured legs', () => {
    const legs = [{ startDate: '2026-06-01', endDate: '2026-07-01', depthPct: 24.4 }, { startDate: '2026-07-10', endDate: '2026-08-10', depthPct: 12 }, { startDate: '2026-08-20', endDate: '2026-09-20', depthPct: 4.6 }];
    const print = footprint({ vcp: { legs, measurementsValid: true, depthsContract: true } }, [{ date: '2026-10-02' }]);
    expect(print.text).toBe('VCP 18週 24/5 3T');
    expect(print.contracting).toBe(true);
    expect(footprint({ vcp: { legs, measurementsValid: true, depthsContract: false } }, [{ date: '2026-10-02' }]).text).toBe('収縮 18週 24/5 3T（縮小途切れ）');
    expect(footprint({ vcp: { legs, measurementsValid: true } }, [{ date: '2026-10-02' }]).text).toBe('収縮 18週 24/5 3T（縮小は未確認）');
    expect(footprint({ vcp: { legs, measurementsValid: false } }, [])).toBeNull();
    expect(footprint({ vcp: { legs: legs.slice(0, 1), measurementsValid: true } }, [])).toBeNull();
  });

  it('calls legs[0] 最初の押し, and 最大の押し only when it really is the deepest; the base runs from the base high', () => {
    const legs = [{ startDate: '2026-06-23', endDate: '2026-07-31', depthPct: 13.1 }, { startDate: '2026-09-17', endDate: '2026-10-01', depthPct: 4.2 }];
    const deepest = footprint({ vcp: { legs, measurementsValid: true, depthsContract: true, base: { startDate: '2026-06-23' } } }, [{ date: '2026-10-02' }]);
    expect(deepest).toMatchObject({ weeks: 14, firstLabel: '最大の押し', firstIsDeepest: true, text: 'VCP 14週 13/4 2T' });
    const widening = [legs[0], { ...legs[1], depthPct: 18 }];
    expect(footprint({ vcp: { legs: widening, measurementsValid: true, depthsContract: false } }, [{ date: '2026-10-02' }]).firstLabel).toBe('最初の押し');
    expect(footprint({ vcp: { legs, measurementsValid: true, depthsContract: true, droppedLegs: 2 } }, [{ date: '2026-10-02' }]).firstLabel).toBe('直近6回の最初の押し');
  });
});

describe('RS line leadership marks', () => {
  const day = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  it('marks only bars from the 253rd point where the RS line leads a price at least 2% below its high', () => {
    // The price peaks at bar 100 and stays 5% lower; the RS line rises steadily, so every bar from 252 on is at an RS high.
    const bars = Array.from({ length: 300 }, (_, i) => ({ date: day(i), close: i === 100 ? 105 : 100, high: i === 100 ? 106 : 100.5 }));
    const line = bars.map((b, i) => ({ time: b.date, value: 1 + i / 1000 }));
    const marks = rsLeadMarks(line, bars);
    expect(marks.eligible).toBe(48);
    // Bar 100's high leaves the 252-bar window after bar 351, so the price is 2% or more below its high until then.
    expect(marks.dates).toEqual(bars.slice(252).map(b => b.date));
    expect(marks.threshold).toBeCloseTo(1 + 298 / 1000);
    expect(rsLeadMarks(line.slice(-200), bars)).toMatchObject({ dates: [], eligible: 0, threshold: null });
    expect(rsLeadMarks(line, null)).toBeNull();
    // Near its own high (within 2%) the RS line's high is not a lead.
    const atHigh = bars.map(b => ({ ...b, close: 100, high: 100.5 }));
    expect(rsLeadMarks(line, atHigh).dates).toEqual([]);
  });
});

describe('opening gaps', () => {
  it('marks opens at least 2% of the prior close beyond the prior high or low, skipping gaps in the data', () => {
    const bars = [{ date: 'a', open: 100, high: 101, low: 99, close: 100 }, { date: 'b', open: 103.1, high: 104, low: 103, close: 103.5 },
      { date: 'c', open: 101.5, high: 102, low: 100, close: 100.5 }, { date: 'd', open: null, high: 101, low: 100, close: 100.5 }, { date: 'e', open: 97.5, high: 98, low: 97, close: 97.5 }];
    expect(gapDays(bars)).toEqual([{ date: 'b', direction: 'up' }, { date: 'e', direction: 'down' }]);
    expect(gapDays(null)).toEqual([]);
  });
});

describe('RS line new high', () => {
  const bars = Array.from({ length: 260 }, (_, i) => ({ date: `d${i}` }));
  it('needs 252 aligned sessions and compares with the prior 251', () => {
    const line = bars.map((b, i) => ({ time: b.date, value: 100 + Math.sin(i / 9) }));
    expect(rsLineNewHigh(line, bars)).toBe(false);
    line[259].value = 102;
    expect(rsLineNewHigh(line, bars)).toBe(true);
    expect(rsLineNewHigh(line.slice(-100), bars)).toBeNull();
  });
});

describe('stage from daily bars', () => {
  const series = fn => Array.from({ length: 300 }, (_, i) => ({ close: fn(i) }));
  it('follows the scanner rules for advancing, declining, flat and topping series', async () => {
    const { stageFromBars } = await import('./briefChartModel');
    expect(stageFromBars(series(i => 50 * 1.004 ** i))).toBe(2);
    expect(stageFromBars(series(i => 200 * 0.996 ** i))).toBe(4);
    expect(stageFromBars(series(i => 100 + Math.sin(i / 5)))).toBe(1);
    expect(stageFromBars(series(i => (i < 200 ? 50 * 1.004 ** i : 50 * 1.004 ** 200 * (1 - (i - 200) * 0.0005))))).toBe(3);
    expect(stageFromBars(series(() => 50).slice(0, 100))).toBeNull();
  });
});

describe('up/down volume', () => {
  it('divides up-day volume by down-day volume and stays unknown on gaps', async () => {
    const { upDownVolume } = await import('./briefChartModel');
    const bars = Array.from({ length: 51 }, (_, i) => ({ close: 100 + (i % 2 ? 1 : 0), volume: i % 2 ? 300 : 100 }));
    expect(upDownVolume(bars).ratio).toBeCloseTo(300 * 25 / (100 * 25));
    expect(upDownVolume(bars.slice(1))).toBeNull();
    const gap = bars.map((b, i) => (i === 30 ? { ...b, volume: null } : b));
    expect(upDownVolume(gap)).toBeNull();
  });
});

// Step-0 seam A owns and the conclusion's RS-line chip (D) reads.
describe('RS line lead threshold', () => {
  it('is the 2% below the price high the conclusion uses today', () => {
    expect(RS_LEAD_FROM_HIGH_PERCENT).toBe(2);
  });
});
