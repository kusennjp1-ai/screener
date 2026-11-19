import { describe, expect, it } from 'vitest';
import { marketLines, modelMarket } from './portfolioPlan';

// Rows with only the market fields modelMarket and marketLines read (they read nothing else).
const row = (extra = {}) => ({ market: 'US', currency: 'USD', market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true, ...extra });
const LINE_VALUES = [true, false, null];
const REGIMES = ['confirmed_uptrend', 'uptrend_under_pressure', 'correction', 'downtrend', 'unrecognised_regime', null];

describe('marketLines: the two lines under modelMarket\'s own filters', () => {
  it('reads each line of the observed rows: false when any of them is below, true when none is', () => {
    expect(marketLines([row()])).toEqual({ above50: true, above200: true });
    expect(marketLines([row(), row({ market_above_50dma: false })])).toEqual({ above50: false, above200: true });
    expect(marketLines([row({ market_above_200dma: false })])).toEqual({ above50: true, above200: false });
    expect(marketLines([row({ market_above_50dma: false, market_above_200dma: false })])).toEqual({ above50: false, above200: false });
  });

  it('gives both lines null when no row passes the filters, never a guessed line', () => {
    expect(marketLines([])).toEqual({ above50: null, above200: null });
    // A line missing on every row: no row is observed, so the other line is not read either (modelMarket's filter).
    expect(marketLines([row({ market_above_50dma: null })])).toEqual({ above50: null, above200: null });
    expect(marketLines([row({ market_above_200dma: null })])).toEqual({ above50: null, above200: null });
    // No regime on any row: nothing is observed.
    expect(marketLines([row({ market_regime: null })])).toEqual({ above50: null, above200: null });
    // Another market or currency is never read.
    expect(marketLines([row({ market: 'HK' }), row({ currency: 'JPY' })])).toEqual({ above50: null, above200: null });
  });

  it('does not let unscanned rows erase or invent a line', () => {
    const unscanned = row({ market_regime: null, market_above_50dma: null, market_above_200dma: null });
    expect(marketLines([row(), unscanned])).toEqual({ above50: true, above200: true });
    // A row below its 50-day line without a regime is not observed by modelMarket, so it is not read here either.
    expect(marketLines([row(), row({ market_regime: null, market_above_50dma: false })])).toEqual({ above50: true, above200: true });
  });

  it('agrees with modelMarket on every uniform combination of the two lines and the regime', () => {
    for (const above50 of LINE_VALUES) for (const above200 of LINE_VALUES) for (const regime of [...REGIMES, 'conflicting']) {
      const rows = regime === 'conflicting'
        ? [row({ market_above_50dma: above50, market_above_200dma: above200 }), row({ market_regime: 'uptrend_under_pressure', market_above_50dma: above50, market_above_200dma: above200 })]
        : [row({ market_regime: regime, market_above_50dma: above50, market_above_200dma: above200 })];
      const lines = marketLines(rows), market = modelMarket(rows);
      const observed = regime !== null && typeof above50 === 'boolean' && typeof above200 === 'boolean';
      expect(lines).toEqual(observed ? { above50, above200 } : { above50: null, above200: null });
      // modelMarket's below200 / below50 are the same reading of the same rows.
      if (market.state !== 'unknown') {
        expect(/^長期トレンド警戒/.test(market.label)).toBe(lines.above200 === false);
        expect(/^50日線割れ/.test(market.label)).toBe(lines.above200 === true && lines.above50 === false);
      } else {
        expect(lines.above50 === null || regime === 'conflicting').toBe(true);
      }
    }
  });
});
