import { describe, expect, it } from 'vitest';
import { briefOrder, footprint, positionPlan, watchEvent, LIST_FILTERS, STOP_MAX_PERCENT } from './briefModel';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, ...over });

describe('brief model', () => {
  it('orders the buy zone first, then within 5% below the pivot, then further below, then extended', () => {
    const items = [view({ symbol: 'EXT', state: 'ext', distance: 7 }), view({ symbol: 'FAR', state: 'wait', distance: -9 }), view({ symbol: 'NEAR', state: 'wait', distance: -2 }), view({ symbol: 'ZONE' })];
    expect(items.sort(briefOrder).map(v => v.symbol)).toEqual(['ZONE', 'NEAR', 'FAR', 'EXT']);
    expect(LIST_FILTERS.near.test(view({ state: 'wait', distance: -4.9 }))).toBe(true);
    expect(LIST_FILTERS.near.test(view({ state: 'wait', distance: null }))).toBe(false);
  });

  it('describes watch changes and needs 1.4x volume to call a breakout', () => {
    expect(watchEvent(view({ volumeRatio: 1.4 })).kind).toBe('breakout');
    expect(watchEvent(view({ volumeRatio: 1.39 })).kind).toBe('zone');
    expect(watchEvent(view({ volumeRatio: null })).kind).toBe('zone');
    expect(watchEvent(view({ state: 'wait', distance: -3.25 })).title).toBe('ピボットまで あと3.3%');
    expect(watchEvent(view({ state: 'ext', distance: 8 })).tone).toBe('ext');
  });

  it('sizes a position from the planned entry and keeps the stop under 10%', () => {
    const plan = positionPlan(view({ pivot: 100, price: 102 }), { stopPercent: 7, account: 50000, riskPercent: 1 });
    expect(plan.entry).toBe(102);
    expect(plan.stop).toBeCloseTo(94.86, 2);
    expect(plan.shares).toBe(Math.floor(500 / (102 - 94.86)));
    expect(plan.r2).toBeCloseTo(102 + 2 * 7.14, 2);
    expect(positionPlan(view(), { stopPercent: 25 }).stopPercent).toBeLessThan(STOP_MAX_PERCENT);
    expect(positionPlan(view({ pivot: null }))).toBeNull();
    expect(positionPlan(view({ pivot: 100, price: 90 }), { stopPercent: 7 }).entry).toBe(100);
  });

  it('writes the VCP footprint only from valid, measured legs', () => {
    const legs = [{ startDate: '2026-06-01', endDate: '2026-07-01', depthPct: 24.4 }, { startDate: '2026-07-10', endDate: '2026-08-10', depthPct: 12 }, { startDate: '2026-08-20', endDate: '2026-09-20', depthPct: 4.6 }];
    const print = footprint({ vcp: { legs, measurementsValid: true, depthsContract: true } }, [{ date: '2026-10-02' }]);
    expect(print.text).toBe('VCP 18週 24/5 3T');
    expect(print.contracting).toBe(true);
    expect(footprint({ vcp: { legs, measurementsValid: false } }, [])).toBeNull();
    expect(footprint({ vcp: { legs: legs.slice(0, 1), measurementsValid: true } }, [])).toBeNull();
  });
});
