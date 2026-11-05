import { describe, expect, it } from 'vitest';
import { planLevels, positionPlan, STOP_MAX_PERCENT } from './positionSizing';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, ...over });

describe('brief model', () => {
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
});

// Step-0 seam F owns and the stock view shell hands to the chart (A).
describe('planLevels', () => {
  it('passes the plan\'s levels through and leaves every unknown level null', () => {
    expect(planLevels(null)).toEqual({ entry: null, stop: null, r2: null, r3: null, structuralLow: null });
    expect(planLevels(undefined)).toEqual({ entry: null, stop: null, r2: null, r3: null, structuralLow: null });
    const plan = positionPlan(view({ pivot: 100, price: 102 }), { stopPercent: 7, account: 50000, riskPercent: 1 });
    expect(planLevels(plan)).toEqual({ entry: plan.entry, stop: plan.stop, r2: plan.r2, r3: plan.r3, structuralLow: null });
    // The optional contract fields are not set yet.
    for (const key of ['reference', 'trialOnly', 'defaults', 'binding', 'structural', 'blocked']) expect(plan[key]).toBeUndefined();
  });
});
