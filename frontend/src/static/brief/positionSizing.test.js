import { describe, expect, it } from 'vitest';
import { adrPercent, ADR_SESSIONS, clampPlanSetting, PLAN_BLOCKED, PLAN_DEFAULTS, planLevels, positionPlan, STOP_LIMIT_PERCENT, STOP_MAX_PERCENT,
  STOP_MIN_PERCENT, structuralStop, STRUCTURAL_STOP_BUFFER_PERCENT } from './positionSizing';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, ...over });
const UP = { label: '上昇トレンド（独自判定）', cap: 0.5 };
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
/** Certified-looking bars: each with a 2% range (high ÷ low − 1 = 0.02) unless `range` says otherwise. */
const bars = (count = 60, range = () => 0.02) => Array.from({ length: count }, (_, i) => ({ date: day(i), open: 100, high: 100 * (1 + range(i)), low: 100, close: 100, volume: 1000 }));
/** Technical evidence whose last measured leg has its low on bar `at` of `list`. */
const technical = (list, at, low) => {
  list[at] = { ...list[at], low };
  return { as_of_date: list.at(-1).date, vcp: { measurementsValid: true, legs: [{ low: 90, lowDate: list[at - 10].date }, { low, lowDate: list[at].date }] } };
};

describe('brief model', () => {
  it('sizes a position from the planned entry and keeps the stop under 10%', () => {
    const plan = positionPlan(view({ pivot: 100, price: 102 }), { stopPercent: 7, account: 50000, riskPercent: 1 });
    expect(plan.entry).toBe(102);
    expect(plan.stop).toBeCloseTo(94.86, 2);
    expect(plan.shares).toBe(Math.floor(500 / (102 - 94.86)));
    expect(plan.r2).toBeCloseTo(102 + 2 * 7.14, 2);
    expect(positionPlan(view(), { stopPercent: 25 }).stopPercent).toBeLessThan(STOP_MAX_PERCENT);
    expect(positionPlan(view({ pivot: null }))).toBeNull();
    expect(positionPlan(view({ state: 'wait', pivot: 100, price: 90 }), { stopPercent: 7 }).entry).toBe(100);
  });
});

describe('position plan: sizing (F1)', () => {
  it('a 1% stop with 2% risk is bound by the 25% single-stock cap, with the loss it leaves', () => {
    const plan = positionPlan(view({ price: 100 }), { stopPercent: 1, account: 50000, riskPercent: 2, capPercent: 25 });
    // The risk budget alone would buy $100,000 (200% of the account).
    expect(plan.weight).toBeLessThanOrEqual(25);
    expect(plan.binding).toBe('cap');
    expect(plan.shares).toBe(125);
    expect(plan.cost).toBe(12500);
    expect(plan.actualRisk).toBeCloseTo(125, 6);
    expect(plan.riskDollars).toBe(1000);
  });

  it('the risk budget sets the count when it is the tighter limit', () => {
    const plan = positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS });
    expect(plan.binding).toBe('risk');
    expect(plan.shares).toBe(Math.floor(625 / 7));
    expect(plan.defaults).toBe(true);
    expect(positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS, capPercent: 30 }).defaults).toBe(false);
  });

  it('no input combination buys more than the account (no margin), and never 0 shares', () => {
    const entries = [0.37, 1, 9.99, 45.5, 110.74, 999, 4321.5, 60000];
    for (const price of entries) for (const account of [0, 1, 999, 5000, 50000, 1e6]) for (const riskPercent of [0, 0.1, 1.25, 5, 50, 400])
      for (const stopPercent of [0, 1, 1.5, 3.53, 7, 9.5, 25]) for (const capPercent of [0, 1, 25, 100, 250]) {
        const plan = positionPlan(view({ price, pivot: price }), { account, riskPercent, stopPercent, capPercent });
        if (plan.shares === null) { expect(plan.cost).toBeNull(); expect(plan.weight).toBeNull(); continue; }
        expect(plan.shares).toBeGreaterThan(0);
        expect(Number.isInteger(plan.shares)).toBe(true);
        expect(plan.cost).toBeLessThanOrEqual(account);
        expect(plan.weight).toBeLessThanOrEqual(100);
        expect(plan.weight).toBeLessThanOrEqual(Math.min(100, capPercent) + 1e-9);
      }
  });

  it('a share count under one is unknown (—), not 0, and says which limit left it', () => {
    expect(positionPlan(view({ price: 5000, pivot: 5000 }), { account: 10000, riskPercent: 5, stopPercent: 1, capPercent: 25 })).toMatchObject({ shares: null, cost: null, weight: null, binding: 'cap' });
    expect(positionPlan(view({ price: 5000, pivot: 5000 }), { account: 10000, riskPercent: 1.25, stopPercent: 7, capPercent: 25 })).toMatchObject({ shares: null, binding: 'risk' });
    expect(positionPlan(view({ price: 100 }), { account: 0 })).toMatchObject({ shares: null, riskDollars: null, binding: null });
    expect(positionPlan(view({ price: 100 }), { capPercent: 0 })).toMatchObject({ shares: null, binding: 'cap' });
  });

  it('the market guide: the part of the maximum used, 試算のみ at 0% or when the market is unknown', () => {
    const settings = { ...PLAN_DEFAULTS };
    const up = positionPlan(view({ price: 100 }), settings, { market: UP });
    expect(up.trialOnly).toBe(false);
    expect(up.marketGuide).toEqual({ known: true, maxPercent: 50, usedPercent: up.weight, over: false });
    expect(positionPlan(view({ price: 100 }), { ...settings, stopPercent: 1, capPercent: 100, riskPercent: 5 }, { market: { cap: 0.25 } }).marketGuide).toMatchObject({ maxPercent: 25, over: true });
    // cap 0 with a known state: 試算のみ (the guide says 0%).
    const closed = positionPlan(view({ price: 100 }), settings, { market: { label: '長期トレンド警戒', cap: 0 } });
    expect(closed.trialOnly).toBe(true);
    expect(closed.marketGuide).toEqual({ known: true, maxPercent: 0, usedPercent: null, over: false });
    // Unknown is never read as 0%.
    for (const market of [null, { label: '市場未確認', cap: 0, state: 'unknown' }]) {
      const plan = positionPlan(view({ price: 100 }), settings, { market });
      expect(plan.trialOnly).toBe(true);
      expect(plan.marketGuide).toEqual({ known: false, maxPercent: null, usedPercent: null, over: false });
    }
  });

  it('clamps each input to its range: the stop from 1% to below 10%, the cap to at most 100%', () => {
    expect(clampPlanSetting('stopPercent', 0)).toBe(STOP_MIN_PERCENT);
    expect(clampPlanSetting('stopPercent', 25)).toBe(STOP_LIMIT_PERCENT);
    expect(clampPlanSetting('capPercent', 250)).toBe(100);
    expect(clampPlanSetting('capPercent', -5)).toBe(0);
    expect(clampPlanSetting('account', -5)).toBe(0);
    expect(positionPlan(view({ price: 100 }), { capPercent: 250 }).capPercent).toBe(100);
  });
});

describe('position plan: gating (F2)', () => {
  it('blocks a new plan beyond the buy zone, on low volatility, an acquisition or an undetermined position', () => {
    for (const state of ['ext', 'low', 'acq', 'na']) {
      const plan = positionPlan(view({ state, pivot: 100, price: 115 }), PLAN_DEFAULTS, { market: UP });
      expect(plan).toEqual({ blocked: PLAN_BLOCKED[state] });
      expect(planLevels(plan)).toEqual({ entry: null, stop: null, r2: null, r3: null, structuralLow: null });
    }
    expect(PLAN_BLOCKED.ext).toBe('買いゾーン超過：新規の試算はしません（次の土台を待つ）');
  });

  it('in the zone the entry is the price; waiting, it is the pivot (ピボットで買う場合)', () => {
    expect(positionPlan(view({ state: 'zone', pivot: 100, price: 103 }))).toMatchObject({ entry: 103, basis: 'price' });
    expect(positionPlan(view({ state: 'wait', pivot: 100, price: 96 }))).toMatchObject({ entry: 100, basis: 'pivot' });
  });

  it('a failed trend-template rule makes the plan a reference only (参考); unknown rules do not', () => {
    expect(positionPlan(view(), PLAN_DEFAULTS, { template: { passed: 7, failed: 1, unknown: 0 } }).reference).toBe(true);
    expect(positionPlan(view(), PLAN_DEFAULTS, { template: { passed: 7, failed: 0, unknown: 1 } }).reference).toBe(false);
    expect(positionPlan(view(), PLAN_DEFAULTS, { template: null }).reference).toBe(false);
  });
});

describe('position plan: structural stop (F3)', () => {
  it('the last measured leg gives a stop just under its low and its depth from the entry', () => {
    const list = bars(), evidence = technical(list, 50, 96);
    const s = structuralStop({ technical: evidence, judged: list, entry: 100 });
    expect(s).toMatchObject({ state: 'ok', low: 96, lowDate: list[50].date, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason: null });
    expect(s.stop).toBeCloseTo(96 * (1 - 0.005), 9);
    expect(s.percent).toBeCloseTo((100 - 96 * 0.995) / 100 * 100, 9);
    const plan = positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { technical: evidence, judged: list });
    expect(plan.structural).toEqual(s);
    expect(planLevels(plan).structuralLow).toBe(96);
    // Applying it puts the plan's stop exactly there.
    const applied = positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS, stopPercent: s.percent }, { technical: evidence, judged: list });
    expect(applied.stop).toBeCloseTo(s.stop, 9);
  });

  it('without measured legs or certified bars the contraction low is unknown, never a fixed percentage', () => {
    const list = bars(), evidence = technical(list, 50, 96);
    expect(structuralStop({ technical: evidence, judged: null, entry: 100 })).toMatchObject({ state: 'unknown', stop: null, percent: null, reason: '日足が分析日で未検証' });
    expect(structuralStop({ technical: { vcp: { measurementsValid: false, legs: evidence.vcp.legs } }, judged: list, entry: 100 })).toMatchObject({ state: 'unknown', reason: '収縮を測定できません' });
    expect(structuralStop({ technical: { vcp: { measurementsValid: true, legs: [] } }, judged: list, entry: 100 }).state).toBe('unknown');
    expect(structuralStop({ technical: null, judged: list, entry: 100 }).state).toBe('unknown');
    // A measurement of other bars (another last session, or a low that is not on the bar it names).
    expect(structuralStop({ technical: { ...evidence, as_of_date: '2020-01-01' }, judged: list, entry: 100 })).toMatchObject({ state: 'unknown', reason: '収縮の測定日が日足と不一致' });
    const moved = list.map(bar => ({ ...bar }));
    moved[50].low = 95;
    expect(structuralStop({ technical: evidence, judged: moved, entry: 100 })).toMatchObject({ state: 'unknown', reason: '収縮の測定日が日足と不一致' });
    // The plan keeps its own stop and says the low is unknown.
    const plan = positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { technical: evidence, judged: null });
    expect(plan.stopPercent).toBe(7);
    expect(plan.structural.state).toBe('unknown');
    expect(planLevels(plan).structuralLow).toBeNull();
  });

  it('a stop deeper than the plan allows is too deep (見送り候補); one under 1% or above the entry is not used', () => {
    const deep = bars();
    expect(structuralStop({ technical: technical(deep, 50, 88), judged: deep, entry: 100 })).toMatchObject({ state: 'tooDeep', low: 88 });
    const edge = bars();
    // 9.95% is under 10% but wider than the 9.5% the inputs allow, so it cannot be applied exactly.
    expect(structuralStop({ technical: technical(edge, 50, 90.5), judged: edge, entry: 100 }).state).toBe('tooDeep');
    const tight = bars();
    expect(structuralStop({ technical: technical(tight, 50, 99.8), judged: tight, entry: 100 }).state).toBe('tooShallow');
    const above = bars();
    expect(structuralStop({ technical: technical(above, 50, 101), judged: above, entry: 100 }).state).toBe('above');
  });
});

describe('position plan: ADR (F4)', () => {
  it('is the mean of high ÷ low − 1 over the last 20 certified bars', () => {
    expect(adrPercent(bars(30))).toBeCloseTo(2, 9);
    // Only the last 20 count.
    expect(adrPercent(bars(30, i => (i < 10 ? 0.5 : 0.03)))).toBeCloseTo(3, 9);
    expect(adrPercent(bars(ADR_SESSIONS, i => (i % 2 ? 0.01 : 0.03)))).toBeCloseTo(2, 9);
  });

  it('is unknown (null) with fewer than 20 bars, a missing or non-finite value, or bars that are not certified', () => {
    expect(adrPercent(bars(ADR_SESSIONS - 1))).toBeNull();
    expect(adrPercent(null)).toBeNull();
    const gap = bars(30); gap[25] = { ...gap[25], high: null };
    expect(adrPercent(gap)).toBeNull();
    const zero = bars(30); zero[29] = { ...zero[29], low: 0 };
    expect(adrPercent(zero)).toBeNull();
    expect(positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { judged: null }).adrPercent).toBeNull();
    expect(positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { judged: bars(30) }).adrPercent).toBeCloseTo(2, 9);
  });
});

// Seam F owns and the stock view shell hands to the chart (A).
describe('planLevels', () => {
  it('passes the plan\'s levels through and leaves every unknown level null', () => {
    expect(planLevels(null)).toEqual({ entry: null, stop: null, r2: null, r3: null, structuralLow: null });
    expect(planLevels(undefined)).toEqual({ entry: null, stop: null, r2: null, r3: null, structuralLow: null });
    const plan = positionPlan(view({ pivot: 100, price: 102 }), { stopPercent: 7, account: 50000, riskPercent: 1 });
    expect(planLevels(plan)).toEqual({ entry: plan.entry, stop: plan.stop, r2: plan.r2, r3: plan.r3, structuralLow: null });
  });

  it('a plan carries the contract fields the conclusion and the chart read', () => {
    const plan = positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { market: UP });
    for (const key of ['reference', 'trialOnly', 'defaults', 'binding', 'structural']) expect(plan[key]).toBeDefined();
    expect(plan.blocked).toBeUndefined();
  });
});
