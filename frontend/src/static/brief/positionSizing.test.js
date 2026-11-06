import { describe, expect, it } from 'vitest';
import { adrPercent, adrState, ADR_SESSIONS, clampPlanSetting, PLAN_BLOCKED, PLAN_DEFAULTS, planLevels, positionPlan, readPlanSettings, RISK_MAX_PERCENT,
  STOP_LIMIT_PERCENT, STOP_MAX_PERCENT, STOP_MIN_PERCENT, STOP_WARN_PERCENT, structuralStop, STRUCTURAL_STOP_BUFFER_PERCENT, STRUCTURAL_SYMBOLS_MAX, templateReference,
  withStructuralSymbol } from './positionSizing';
import { buyGate, PLAN_BLOCKED as GATE_BLOCKED, templateReference as gateTemplateReference } from './buyGate';

const DATE = '2026-03-01';
/** A selected candidate in the buy zone whose Setup Engine base is current for DATE (confidence 60, over the floor). */
const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', position: 'zone', asOf: DATE, qualified: true, distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101,
  row: { symbol: 'AAA', setup_recalculation: { status: 'calculated', as_of_date: DATE }, se_pattern_confidence: 60 }, ...over });
const UP = { label: '上昇トレンド（独自判定）', cap: 0.5 };
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
/** Certified-looking bars: each with a 2% range (high ÷ low − 1 = 0.02) unless `range` says otherwise. */
const bars = (count = 60, range = () => 0.02) => Array.from({ length: count }, (_, i) => ({ date: day(i), open: 100, high: 100 * (1 + range(i)), low: 100, close: 100, volume: 1000 }));
/** Technical evidence whose last measured leg has its low on bar `at` of `list` (an earlier leg's 90 is not on its bar). */
const technical = (list, at, low) => {
  list[at] = { ...list[at], low };
  return { as_of_date: list.at(-1).date, vcp: { measurementsValid: true, legs: [{ low: 90, lowDate: list[at - 10].date }, { low, lowDate: list[at].date }] } };
};
/** Technical evidence with one leg per [bar index, low], each low on its bar. */
const legsAt = (list, legs) => {
  for (const [at, low] of legs) list[at] = { ...list[at], low };
  return { as_of_date: list.at(-1).date, vcp: { measurementsValid: true, legs: legs.map(([at, low]) => ({ low, lowDate: list[at].date })) } };
};
/** A trend template whose eight rules and daily-bar integrity rule all pass. */
const PASS = { passed: 8, failed: 0, unknown: 0, integrity: { state: 'pass' } };

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
        expect([null, 'risk', 'cap']).toContain(plan.binding);
        if (plan.shares === null) { expect(plan.cost).toBeNull(); expect(plan.weight).toBeNull(); continue; }
        expect(plan.shares).toBeGreaterThan(0);
        expect(Number.isInteger(plan.shares)).toBe(true);
        expect(plan.cost).toBeLessThanOrEqual(account);
        expect(plan.weight).toBeLessThanOrEqual(100);
        expect(plan.weight).toBeLessThanOrEqual(Math.min(100, capPercent) + 1e-9);
      }
  });

  it('a 100% cap with a 1% stop and 5% risk is bound by the cap (the account bounds the count through it)', () => {
    const plan = positionPlan(view({ price: 100 }), { account: 50000, riskPercent: 5, stopPercent: 1, capPercent: 100 });
    expect(plan).toMatchObject({ binding: 'cap', shares: 500, cost: 50000, weight: 100 });
    expect(plan.actualRisk).toBeCloseTo(500, 6);
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
    expect(up.marketGuide).toEqual({ known: true, maxPercent: 50, usedPercent: up.weight, over: false, share: up.weight / 50 * 100, fits: Math.floor(50 / up.weight) });
    expect(positionPlan(view({ price: 100 }), { ...settings, stopPercent: 1, capPercent: 100, riskPercent: 5 }, { market: { cap: 0.25 } }).marketGuide).toMatchObject({ maxPercent: 25, over: true });
    // cap 0 with a known state: 試算のみ (the guide says 0%).
    const closed = positionPlan(view({ price: 100 }), settings, { market: { label: '長期トレンド警戒', cap: 0 } });
    expect(closed.trialOnly).toBe(true);
    expect(closed.marketGuide).toEqual({ known: true, maxPercent: 0, usedPercent: null, over: false, share: null, fits: null });
    // Unknown is never read as 0%.
    for (const market of [null, { label: '市場未確認', cap: 0, state: 'unknown' }]) {
      const plan = positionPlan(view({ price: 100 }), settings, { market });
      expect(plan.trialOnly).toBe(true);
      expect(plan.marketGuide).toEqual({ known: false, maxPercent: null, usedPercent: null, over: false, share: null, fits: null });
    }
  });

  it('the exposure share: the position as a part of the guide, and how many of the same size fit in it (holdings not counted)', () => {
    // 88 shares at 101: $8,888, 17.8% of the account, 35.5% of a 50% guide; two of the same size fit.
    const up = positionPlan(view({ price: 101 }), PLAN_DEFAULTS, { market: UP });
    expect(up.marketGuide.share).toBeCloseTo(8888 / 50000 * 100 / 50 * 100, 9);
    expect(up.marketGuide.fits).toBe(2);
    // Over the guide: more than 100% of it, and none of the same size fits.
    const over = positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS, stopPercent: 1, capPercent: 100, riskPercent: 5 }, { market: { cap: 0.25 } });
    expect([over.marketGuide.share, over.marketGuide.fits]).toEqual([400, 0]);
    // Exactly the guide: one fits (never 0 by rounding).
    const exact = positionPlan(view({ price: 100 }), { account: 10000, riskPercent: 5, stopPercent: 1, capPercent: 25 }, { market: { cap: 0.25 } });
    expect([exact.weight, exact.marketGuide.share, exact.marketGuide.fits]).toEqual([25, 100, 1]);
    // No share count: unknown, never 0.
    expect(positionPlan(view({ price: 100 }), { account: 0 }, { market: UP }).marketGuide).toMatchObject({ usedPercent: null, share: null, fits: null });
  });

  it('clamps each input to its range: the stop from 1% to below 10%, the risk to at most 5%, the cap to at most 100%', () => {
    expect(clampPlanSetting('riskPercent', 50)).toBe(RISK_MAX_PERCENT);
    expect(clampPlanSetting('riskPercent', -1)).toBe(0);
    expect(RISK_MAX_PERCENT).toBe(5);
    // A stale stored 400% risk is read as 5%: the budget is 5% of the account.
    expect(positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS, riskPercent: 400 }).riskDollars).toBe(2500);
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

  it('a template that is not passed makes the plan a reference only (参考): TT未達 for a failed rule, TT未確認 otherwise', () => {
    const reason = template => { const plan = positionPlan(view(), PLAN_DEFAULTS, { template, market: UP }); return [plan.reference, plan.referenceReason]; };
    expect(reason({ ...PASS, passed: 7, failed: 1 })).toEqual([true, 'TT未達']);
    // A failed rule settles it even when another rule is unknown.
    expect(reason({ passed: 6, failed: 1, unknown: 1, integrity: { state: 'unknown' } })).toEqual([true, 'TT未達']);
    // An unknown rule, no template, or the daily-bar integrity rule not passed: unverified, never passed.
    expect(reason({ ...PASS, passed: 7, unknown: 1 })).toEqual([true, 'TT未確認']);
    expect(reason(null)).toEqual([true, 'TT未確認']);
    expect(reason({ ...PASS, integrity: { state: 'fail' } })).toEqual([true, 'TT未確認']);
    expect(reason({ ...PASS, integrity: { state: 'unknown' } })).toEqual([true, 'TT未確認']);
    expect(reason({ passed: 8, failed: 0, unknown: 0 })).toEqual([true, 'TT未確認']);
    expect(reason(PASS)).toEqual([false, null]);
    expect(templateReference(PASS)).toBeNull();
    // A selected stock the template does not select (an exclusion) is no candidate either.
    expect([positionPlan(view({ qualified: false }), PLAN_DEFAULTS, { template: PASS, market: UP })].map(p => [p.reference, p.referenceReason])).toEqual([[true, '選定対象外']]);
    // A broken setup (崩れ) or near earnings (決算前) also leaves the plan a reference; the template's reason leads.
    const more = (template, context) => { const plan = positionPlan(view(), PLAN_DEFAULTS, { template, market: UP, ...context }); return [plan.reference, plan.referenceReason]; };
    expect(more(PASS, { broken: true })).toEqual([true, '崩れ']);
    expect(more(PASS, { earningsSoon: true })).toEqual([true, '決算前']);
    expect(more(PASS, { broken: true, earningsSoon: true })).toEqual([true, '崩れ']);
    expect(more({ ...PASS, passed: 7, failed: 1 }, { broken: true })).toEqual([true, 'TT未達']);
  });

  it('reads the market (参考（地合い）), the base and the zone\'s day as the conclusion does, in its order (buyGate\'s reason)', () => {
    const reason = (context, over) => { const plan = positionPlan(view(over), PLAN_DEFAULTS, { template: PASS, market: UP, ...context }); return [plan.reference, plan.referenceReason]; };
    // A known market with a guide of 0%: 試算のみ in the tile, and 参考（地合い） in the heading. Unknown, or none yet: 地合い未確認.
    expect(reason({ market: { label: '50日線割れ', cap: 0 } })).toEqual([true, '地合い']);
    expect(positionPlan(view(), PLAN_DEFAULTS, { template: PASS, market: { label: '50日線割れ', cap: 0 } }).trialOnly).toBe(true);
    expect(reason({ market: { label: '市場未確認', cap: 0, state: 'unknown' } })).toEqual([true, '地合い未確認']);
    expect(reason({ market: null })).toEqual([true, '地合い未確認']);
    // Waiting below the pivot too (any position that gets a plan).
    expect(reason({ market: { label: '50日線割れ', cap: 0 } }, { state: 'wait', position: 'base', price: 90, distance: -10 })).toEqual([true, '地合い']);
    // The Setup Engine base: below the floor, missing, or not of the analysis date.
    const base = over => ({ row: { symbol: 'AAA', setup_recalculation: { status: 'calculated', as_of_date: DATE }, se_pattern_confidence: 60, ...over } });
    expect(reason({}, base({ se_pattern_confidence: 31 }))).toEqual([true, '土台未確認']);
    expect(reason({}, base({ se_pattern_confidence: null }))).toEqual([true, '土台未確認']);
    expect(reason({}, base({ setup_recalculation: { status: 'calculated', as_of_date: '2026-02-27' } }))).toEqual([true, '土台未確認']);
    // The order: the template, a broken setup, the base, the market, earnings.
    expect(reason({ broken: true, market: null }, base({ se_pattern_confidence: 31 }))).toEqual([true, '崩れ']);
    expect(reason({ market: null, earningsSoon: true }, base({ se_pattern_confidence: 31 }))).toEqual([true, '土台未確認']);
    expect(reason({ market: { cap: 0 }, earningsSoon: true })).toEqual([true, '地合い']);
    // The plan reads the same gate the conclusion reads: given one, it is used as is.
    const gate = buyGate({ view: view(), template: PASS, market: { cap: 0 } });
    expect(positionPlan(view(), PLAN_DEFAULTS, { template: PASS, market: UP, gate }).referenceReason).toBe('地合い');
    // The blocked reasons and the template rule live in the gate, under their old import path too.
    expect([PLAN_BLOCKED, templateReference]).toEqual([GATE_BLOCKED, gateTemplateReference]);
  });
});

describe('position plan: structural stop (F3)', () => {
  it('the last measured leg gives a stop just under its low and its depth from the entry', () => {
    const list = bars(), evidence = technical(list, 50, 96);
    const s = structuralStop({ technical: evidence, judged: list, entry: 100, pivot: 100 });
    expect(s).toMatchObject({ state: 'ok', low: 96, lowDate: list[50].date, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason: null });
    expect(s.stop).toBeCloseTo(96 * (1 - 0.005), 9);
    expect(s.percent).toBeCloseTo((100 - 96 * 0.995) / 100 * 100, 9);
    const plan = positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { technical: evidence, judged: list });
    expect(plan.structural).toEqual(s);
    expect(planLevels(plan).structuralLow).toBe(96);
    // Choosing it for this stock puts the plan's stop exactly there.
    const applied = positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS, structuralSymbols: ['AAA'] }, { technical: evidence, judged: list });
    expect(applied).toMatchObject({ stopSource: 'structural', defaults: false });
    expect(applied.stop).toBeCloseTo(s.stop, 9);
    expect(applied.stopPercent).toBeCloseTo(s.percent, 9);
  });

  it('a structural stop chosen for one stock never sets another stock\'s stop', () => {
    const list = bars(), evidence = technical(list, 50, 96), context = { technical: evidence, judged: list };
    const settings = { ...PLAN_DEFAULTS, structuralSymbols: withStructuralSymbol([], 'AAA', true) };
    expect(positionPlan(view({ price: 100 }), settings, context).stopSource).toBe('structural');
    const other = positionPlan(view({ symbol: 'BBB', price: 100 }), settings, context);
    expect(other).toMatchObject({ stopSource: 'setting', stopPercent: 7, defaults: true });
    expect(other.stop).toBeCloseTo(93, 9);
    // Chosen for this stock, but no longer usable (bars not certified): the stop setting, and the card says why.
    const unusable = positionPlan(view({ price: 100 }), settings, { technical: evidence, judged: null });
    expect(unusable).toMatchObject({ stopSource: 'setting', stopPercent: 7 });
    expect(unusable.structural.state).toBe('unknown');
  });

  it('keeps the stored settings in range and the structural choices per stock, at most the 50 most recent', () => {
    expect(readPlanSettings(null)).toEqual({ ...PLAN_DEFAULTS, structuralSymbols: [] });
    expect(readPlanSettings({ account: 'x', riskPercent: 400, stopPercent: 0.2, capPercent: Infinity, structuralSymbols: 'AAA' }))
      .toEqual({ account: PLAN_DEFAULTS.account, riskPercent: RISK_MAX_PERCENT, stopPercent: STOP_MIN_PERCENT, capPercent: PLAN_DEFAULTS.capPercent, structuralSymbols: [] });
    expect(readPlanSettings({ structuralSymbols: ['AAA', 7, '', null, 'BBB', 'AAA'] }).structuralSymbols).toEqual(['BBB', 'AAA']);
    const many = Array.from({ length: 60 }, (_, i) => `S${i}`);
    const kept = readPlanSettings({ structuralSymbols: many }).structuralSymbols;
    expect(kept).toHaveLength(STRUCTURAL_SYMBOLS_MAX);
    expect(kept.at(-1)).toBe('S59');
    expect(withStructuralSymbol(['AAA', 'BBB'], 'AAA', false)).toEqual(['BBB']);
    expect(withStructuralSymbol(['AAA', 'BBB'], 'AAA', true)).toEqual(['BBB', 'AAA']);
  });

  it('without measured legs or certified bars the contraction low is unknown, never a fixed percentage', () => {
    const list = bars(), evidence = technical(list, 50, 96);
    expect(structuralStop({ technical: evidence, judged: null, entry: 100, pivot: 100 })).toMatchObject({ state: 'unknown', stop: null, percent: null, reason: '日足が分析日で未検証' });
    expect(structuralStop({ technical: { vcp: { measurementsValid: false, legs: evidence.vcp.legs } }, judged: list, entry: 100, pivot: 100 })).toMatchObject({ state: 'unknown', reason: '収縮を測定できません' });
    expect(structuralStop({ technical: { vcp: { measurementsValid: true, legs: [] } }, judged: list, entry: 100, pivot: 100 }).state).toBe('unknown');
    expect(structuralStop({ technical: null, judged: list, entry: 100, pivot: 100 }).state).toBe('unknown');
    expect(structuralStop({ technical: evidence, judged: list, entry: 100, pivot: null })).toMatchObject({ state: 'unknown', reason: 'ピボットが未確認' });
    // A measurement of other bars (another last session, or a low that is not on the bar it names).
    expect(structuralStop({ technical: { ...evidence, as_of_date: '2020-01-01' }, judged: list, entry: 100, pivot: 100 })).toMatchObject({ state: 'unknown', reason: '収縮の測定日が日足と不一致' });
    const moved = list.map(bar => ({ ...bar }));
    moved[50].low = 95;
    expect(structuralStop({ technical: evidence, judged: moved, entry: 100, pivot: 100 })).toMatchObject({ state: 'unknown', reason: '収縮の測定日が日足と不一致' });
    // The plan keeps its own stop and says the low is unknown.
    const plan = positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { technical: evidence, judged: null });
    expect(plan.stopPercent).toBe(7);
    expect(plan.structural.state).toBe('unknown');
    expect(planLevels(plan).structuralLow).toBeNull();
  });

  it('the base\'s last contraction is the last leg under the pivot; a leg above it is a pullback after the breakout', () => {
    // The last leg (low 103, above the 102 pivot) is a pullback after the breakout: the leg before it is used.
    const list = bars(), evidence = legsAt(list, [[30, 92], [40, 97], [50, 103]]);
    expect(structuralStop({ technical: evidence, judged: list, entry: 105, pivot: 102 })).toMatchObject({ state: 'ok', low: 97, lowDate: list[40].date });
    // Every leg above the pivot: unknown, with the reason.
    const high = bars(), above = legsAt(high, [[40, 103], [50, 104]]);
    expect(structuralStop({ technical: above, judged: high, entry: 106, pivot: 102 })).toMatchObject({ state: 'unknown', stop: null, reason: '最後の収縮がピボットより上（上抜け後の押し）' });
  });

  it('flags a stop inside the last contraction and a structural stop deeper than 8% (独自設定), never moving the stop', () => {
    expect(STOP_WARN_PERCENT).toBe(8);
    const at = low => { const list = bars(), evidence = technical(list, 50, low); return positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { technical: evidence, judged: list, market: UP, template: PASS }); };
    // The 7% stop (93.00) above a 92.00 low: inside the contraction. The structural stop is 8.46% deep.
    const inside = at(92);
    expect(inside).toMatchObject({ stopInsideBase: true, structuralDeep: true, stopSource: 'setting', stopPercent: 7 });
    expect(inside.stop).toBeCloseTo(93, 9);
    // A 96.00 low: the 7% stop is below it, and the structural stop (4.48%) is not deep.
    expect(at(96)).toMatchObject({ stopInsideBase: false, structuralDeep: false });
    // 8% exactly is not deeper than 8%; just over it is.
    const exact = 100 - 8, low8 = exact / (1 - STRUCTURAL_STOP_BUFFER_PERCENT / 100);
    expect(at(low8).structural.percent).toBeCloseTo(8, 9);
    expect(at(low8).structuralDeep).toBe(false);
    expect(at(low8 - 0.01).structuralDeep).toBe(true);
    // The structural stop chosen: the stop is under the low, never inside it.
    const list = bars(), evidence = technical(list, 50, 92);
    expect(positionPlan(view({ price: 100 }), { ...PLAN_DEFAULTS, structuralSymbols: ['AAA'] }, { technical: evidence, judged: list }).stopInsideBase).toBe(false);
    // Unknown when the low is unknown (no certified bars) or at the entry: null, never false.
    expect(positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { technical: evidence, judged: null })).toMatchObject({ stopInsideBase: null, structuralDeep: null });
    const probe = bars();
    expect(positionPlan(view({ price: 100, pivot: 101 }), PLAN_DEFAULTS, { technical: technical(probe, 50, 100.3), judged: probe })).toMatchObject({ stopInsideBase: null, structuralDeep: null });
  });

  it('too deep at 10% or more (見送り候補); over the 9.5% input limit; under 1% or at the low is not used', () => {
    const deep = bars();
    expect(structuralStop({ technical: technical(deep, 50, 88), judged: deep, entry: 100, pivot: 100 })).toMatchObject({ state: 'tooDeep', low: 88 });
    const ten = bars();
    // A stop just past 10% under the entry breaks the rule of a loss under 10%.
    expect(structuralStop({ technical: technical(ten, 50, 90.4), judged: ten, entry: 100, pivot: 100 }).state).toBe('tooDeep');
    const edge = bars();
    // 9.95% is under 10% but wider than the 9.5% the inputs allow, so it cannot be applied exactly.
    expect(structuralStop({ technical: technical(edge, 50, 90.5), judged: edge, entry: 100, pivot: 100 })).toMatchObject({ state: 'overLimit', low: 90.5 });
    expect(STOP_LIMIT_PERCENT).toBe(9.5);
    const tight = bars();
    expect(structuralStop({ technical: technical(tight, 50, 99.8), judged: tight, entry: 100, pivot: 100 }).state).toBe('tooShallow');
    // The entry at or under the contraction's low (the price has undercut it): no stop below it, whatever the buffer.
    const probe = bars();
    expect(structuralStop({ technical: technical(probe, 50, 100.3), judged: probe, entry: 100, pivot: 101 })).toMatchObject({ state: 'above', low: 100.3, lowDate: probe[50].date, stop: null, percent: null });
    const above = bars();
    expect(structuralStop({ technical: technical(above, 50, 101), judged: above, entry: 100, pivot: 102 }).state).toBe('above');
  });
});

describe('position plan: ADR (F4)', () => {
  it('is the mean of high ÷ low − 1 over the last 20 certified bars', () => {
    expect(adrPercent(bars(30))).toBeCloseTo(2, 9);
    // Only the last 20 count.
    expect(adrPercent(bars(30, i => (i < 10 ? 0.5 : 0.03)))).toBeCloseTo(3, 9);
    expect(adrPercent(bars(ADR_SESSIONS, i => (i % 2 ? 0.01 : 0.03)))).toBeCloseTo(2, 9);
  });

  it('says why it is unknown: bars not certified, fewer than 20 bars, or a missing high or low', () => {
    expect(adrState(null)).toEqual({ value: null, reason: '日足が分析日で未検証' });
    expect(adrState(bars(ADR_SESSIONS - 1))).toEqual({ value: null, reason: '日足20本未満' });
    const gap = bars(30); gap[25] = { ...gap[25], low: Number.NaN };
    expect(adrState(gap)).toEqual({ value: null, reason: '直近20本の高値・安値に欠落' });
    expect(adrState(bars(30))).toMatchObject({ reason: null });
    expect(positionPlan(view({ price: 100 }), PLAN_DEFAULTS, { judged: null })).toMatchObject({ adrPercent: null, adrReason: '日足が分析日で未検証' });
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
    for (const key of ['reference', 'referenceReason', 'trialOnly', 'defaults', 'binding', 'structural', 'stopSource', 'adrReason', 'stopInsideBase', 'structuralDeep']) expect(plan[key]).toBeDefined();
    expect(plan.blocked).toBeUndefined();
  });
});
