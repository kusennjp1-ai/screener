// Synthetic values only. Never copy this fixture into a publication bundle.
import { MARKET_HISTORY_VERSION, MARKET_HISTORY_METRICS } from '../../src/static/marketIndicatorHistory.js';

export const options = { market: 'US', asOfDate: '2026-10-09', now: Date.parse('2026-10-11T12:00:00Z') };
export function observation(value = 0, date = options.asOfDate) {
  return { date, value, collected_at: '2026-10-10T01:00:00Z' };
}
export function series(metric = 'new_highs', overrides = {}) {
  const { label: _label, ...spec } = MARKET_HISTORY_METRICS[metric];
  return { metric, market: 'US', population: 'synthetic-universe-v1', method: 'synthetic-method-v1', source: 'synthetic-only',
    instrument: spec.instrument || (spec.scope === 'security' ? 'SYNTH' : 'US'), approximate: true, ...spec,
    observations: [observation()], ...overrides };
}
export function payload(...input) { return { version: MARKET_HISTORY_VERSION, series: input }; }
export function allMetricsFixture() {
  return payload(...Object.keys(MARKET_HISTORY_METRICS).map(metric => series(metric, metric === 'institutional_holders'
    ? { observations: [observation(100, '2026-03-31'), observation(110, '2026-06-30')] }
    : {})));
}
export function priceFixture(count = 100) {
  const dates = [];
  for (let t = Date.parse('2025-01-02'); dates.length < 280; t += 86400000) {
    const date = new Date(t);
    if (![0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
  }
  const charts = Array.from({ length: count }, (_, j) => ({ symbol: `S${String(j).padStart(3, '0')}`,
    bars: dates.map((date, i) => { const close = 100 + i * (.1 + j / 500); return { date, open: close, close, high: close + 1, low: close - 1, volume: 1000 }; }) }));
  return { charts, asOfDate: dates.at(-1), expectedUniverseSize: count + 10, lookbackSessions: 5,
    benchmark: { symbol: 'SPY', bars: structuredClone(charts[0].bars) } };
}
