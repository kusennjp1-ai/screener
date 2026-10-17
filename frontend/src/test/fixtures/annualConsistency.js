import { withAuditFixture } from '../../static/testAuditFixture.js';
import { withFinancialProof } from '../../static/testFinancialFixture.js';
import { nativeAnnualFixture } from './nativeAnnual.js';

export const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
export const cases = [
  { symbol: 'BELOW', values: [0.28, 0.3499999999999999, 0.45, 0.57], expected: 'fail' },
  { symbol: 'EXACT', values: [0.28, 0.35, 0.45, 0.57], expected: 'pass' },
  { symbol: 'ABOVE', values: [0.28, 0.35000000000000003, 0.45, 0.57], expected: 'pass' },
  { symbol: 'ZERO', values: [0, 0.35, 0.45, 0.57], expected: 'unknown' },
  { symbol: 'NEGATIVE', values: [-0.28, 0.35, 0.45, 0.57], expected: 'unknown' },
  { symbol: 'CURRENCY', values: [1, 2, 4, 8], annualCurrency: 'JPY', expected: 'unknown' },
  { symbol: 'CELL', values: [8, 4, 2, null], cellCurrency: 'JPY', expected: 'unknown' },
  { symbol: 'NATIVE', values: [0.28, 0.35, 0.45, 0.57], nativeCurrency: 'CAD', expected: 'pass' },
  { symbol: 'CADENCE', values: [0.28, 0.35, 0.45, 0.57], expected: 'pass', epsYoY: -10, salesYoY: -5 },
];
export const rows = cases.map(item => {
  const history = nativeAnnualFixture(item.nativeCurrency || 'USD', item.values);
  history.symbol = history.annual_source.symbol = item.symbol;
  if (!item.nativeCurrency) for (const key of ['schema_version', 'annual_currency', 'quarterly_currency', 'quarterly_retrieved_at', 'annual_source']) delete history[key];
  if (item.annualCurrency) history.annual_currency = item.annualCurrency;
  if (item.cellCurrency) history.annual[0].currency = item.cellCurrency;
  return withFinancialProof(withAuditFixture({ symbol: item.symbol, company_name: `Synthetic ${item.symbol}`, market: 'US', currency: 'USD',
    current_price: 102, se_pivot_price: 100, adv_usd: 5e7, volume: 2e8, rs_rating: 95,
    eps_growth_qq: 40, sales_growth_qq: 35, eps_growth_yy: item.epsYoY ?? 30, sales_growth_yy: item.salesYoY ?? 30,
    financial_history: history, market_above_50dma: true, market_above_200dma: true,
    chart_path: `${item.symbol}.json`, research_detail_path: `detail-${item.symbol}.json` }, date), now, date);
});
