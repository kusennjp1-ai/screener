import { describe, expect, it } from 'vitest';
import { buildPortfolioPlan } from './portfolioPlan';

export const fixture = (symbol = 'LEAD', extra = {}) => ({ symbol, market: 'US', currency: 'USD', gics_sector: 'Technology',
  market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true,
  passes_template: true, rs_rating: 95, week_52_low_distance: 50, week_52_high_distance: 3,
  composite_rating: 95, eps_rating: 90, ibd_group_rank: 10, adv_usd: 50000000,
  current_price: 101, se_pivot_price: 100, se_pattern_confidence: 80, ...extra });
const now = Date.parse('2026-09-24T14:00:00Z');
const scenarios = ['通常', '圧力', '弱気', '市場不明', '過熱', '欠損', '非USD', '重複', '古い日付', '集中'];
// 100 deterministic monitoring cases; not 100 independently running AI agents.
describe('100 virtual portfolio monitoring scenarios', () => {
  for (let profile = 0; profile < 10; profile++) for (let scenario = 0; scenario < 10; scenario++) {
    it(`P${String(profile * 10 + scenario + 1).padStart(3, '0')} / ${scenarios[scenario]} / price-scale-${profile + 1}`, () => {
      const price = 20 * (profile + 1);
      let rows = Array.from({ length: 10 }, (_, i) => fixture(`S${i}`, { current_price: price, se_pivot_price: price, gics_sector: scenario === 9 ? 'Same' : `Sector${i}` }));
      if (scenario === 1) rows = rows.map(r => ({ ...r, market_regime: 'uptrend_under_pressure' }));
      if (scenario === 2) rows = rows.map(r => ({ ...r, market_above_200dma: false }));
      if (scenario === 3) rows = rows.map(r => ({ ...r, market_regime: null }));
      if (scenario === 4) rows = rows.map(r => ({ ...r, current_price: price * 1.2 }));
      if (scenario === 5) rows = rows.map(r => ({ ...r, se_pivot_price: null }));
      if (scenario === 6) rows = rows.map(r => ({ ...r, currency: 'JPY' }));
      if (scenario === 7) rows = [...rows, ...rows.map(r => ({ ...r, current_price: price * 2 }))];
      const plan = buildPortfolioPlan(rows, scenario === 8 ? '2020-01-01' : '2026-09-23', 100000, now);
      expect(plan.executionExposure).toBe(0);
      expect(plan.executionCash).toBe(100000);
      expect(plan.invested + plan.cash).toBeCloseTo(100000, 2);
      expect(plan.exposure).toBeLessThanOrEqual(plan.market.cap + 1e-9);
      expect(plan.risk).toBeLessThanOrEqual(2000.01);
      expect(plan.positions.length).toBeLessThanOrEqual(5);
      for (const p of plan.positions) {
        expect(Number.isInteger(p.shares)).toBe(true);
        expect(p.loss).toBeLessThanOrEqual(500.01);
        expect(p.cost).toBeLessThanOrEqual(10000.01);
        expect(p.stop).toBeLessThan(p.buy);
        expect(p.target).toBeGreaterThan(p.buy);
      }
      if ([2,3,4,5,6,7].includes(scenario)) expect(plan.positions).toHaveLength(0);
      if (scenario === 0) expect(plan.positions.length).toBeGreaterThan(0);
      if (scenario === 1) expect(plan.exposure).toBeLessThanOrEqual(.25);
      if (scenario === 8) expect(plan.blockers[0]).toContain('分析基準日');
      if (scenario === 9) expect(plan.invested).toBeLessThanOrEqual(20000);
    });
  }
});

it('rejects invalid capital and keeps conflict duplicates order independent', () => {
  expect(() => buildPortfolioPlan([], '2026-09-23', NaN)).toThrow();
  const a = fixture(), b = fixture('LEAD', { current_price: 110 });
  expect(buildPortfolioPlan([a,b], '2026-09-23').positions).toEqual(buildPortfolioPlan([b,a], '2026-09-23').positions);
});
it('does not let unscanned rows erase known market context, but blocks conflicts', () => {
  const unknown = fixture('UNKNOWN', { market_regime: null, market_above_50dma: null, market_above_200dma: null, passes_template: false });
  expect(buildPortfolioPlan([fixture(), unknown], '2026-09-23').market.cap).toBe(.5);
  expect(buildPortfolioPlan([fixture(), fixture('OTHER', { market_regime: 'uptrend_under_pressure' })], '2026-09-23').market.cap).toBe(0);
});
