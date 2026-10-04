import { createHash } from 'node:crypto';
import { auditDailyBars } from '../src/static/qualificationAudit.js';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../src/test/fixtures/financialCurrent.js';
import { createPriceTrace } from './export-price-traces.mjs';

// Explicit design fixtures, never market observations. Their price miniatures
// reproduce these same synthetic OHLCV bars through the production renderer.
export function eventFeedPreviewFixture() {
  const resources = new Map(), rows = [], days = [];
  for (let time = Date.parse(date); days.length < 280; time -= 86400000) {
    const day = new Date(time);
    if (![0, 6].includes(day.getUTCDay())) days.unshift(day.toISOString().slice(0, 10));
  }
  const descriptor = { root: `price-traces/${'d'.repeat(64)}`, as_of_date: date, bars: 63 };
  for (const [index, symbol] of ['DEMO', 'WATCH', 'CHECK'].entries()) {
    const bars = days.map((day, offset) => {
      const close = 60 + index * 25 + offset * .15 + Math.sin(offset / 7) * 1.1;
      return { date: day, open: close - .2, high: close + .7, low: close - .5, close, volume: 1200000 + Math.round(Math.cos(offset / 9) * 150000) };
    });
    const chart = { symbol, as_of_date: date, bars };
    const chartHash = createHash('sha256').update(JSON.stringify(chart)).digest('hex').slice(0, 16);
    const row = withSyntheticFinancialProof({ symbol, company_name: '検査用データ · 実在の銘柄ではありません', gics_sector: ['Technology', 'Healthcare', 'Industrials'][index],
      currency: 'USD', current_price: bars.at(-1).close, adv_usd: 5e7, rs_rating: 95 - index * 3, rs_as_of_date: date, rs_method: 'published-bars-weighted-percentile-v1', rs_universe_size: 1000,
      se_pivot_price: bars.at(-1).close / [1.02, .985, 1.075][index],
      eps_growth_yy: [30, 42, 10][index], sales_growth_yy: [40, 32, 8][index],
      chart_path: `verified-charts/${symbol}-${chartHash}.json`, price_trace_start: bars.at(-63).date,
      entry_evidence: { as_of_date: date, calendar: { latest_completed_session: date, evaluated_at: new Date(now - 3600000).toISOString(), valid_until: '2026-10-05T20:00:00Z' }, shape: { candidate: index !== 2, summary: '検査用に指定した形状状態' } },
    });
    row.technical_audit = auditDailyBars(row, chart, date);
    const trace = createPriceTrace(row, chart, date);
    if (!row.technical_audit.valid || !trace) throw Error(`Invalid synthetic chart fixture: ${symbol}`);
    resources.set(row.chart_path, { type: 'application/json', body: JSON.stringify({ ...chart, stock_data: row }) });
    resources.set(`${descriptor.root}/${symbol}.svg`, { type: 'image/svg+xml', body: trace.svg });
    rows.push(row);
  }
  resources.set('research-preview.json', { type: 'application/json', body: JSON.stringify({ as_of_date: date, price_traces: descriptor, rows }) });
  resources.set('manifest.json', { type: 'application/json', body: JSON.stringify({ generated_at: new Date(now).toISOString(), research_generation: 'synthetic-event-feed-preview-v1', as_of_date: date,
    default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: date, assets: { research: { path: 'research-preview.json' } }, pages: {} } } }) });
  return { resources, date, now, symbols: rows.map(row => row.symbol) };
}
