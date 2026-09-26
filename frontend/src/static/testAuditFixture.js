// Synthetic evidence for UI/portfolio integration tests. Arithmetic is separately
// tested against actual OHLCV sequences in qualificationAudit.test.js.
export function withAuditFixture(row, date = '2026-09-23') {
  const p = row.current_price;
  return { eps_growth_yy: 30, sales_growth_yy: 30, annual_eps_growth_3y: [30, 30, 30], rs_method: 'published-bars-weighted-percentile-v1', rs_universe_size: 1000, rs_as_of_date: date, ...row,
    technical_audit: { version: 'ohlcv-v1', symbol: row.symbol, as_of_date: date, valid: true, errors: [], bars: 280,
      values: { close: p, sma50: p * .9, sma150: p * .8, sma200: p * .7, sma200_21ago: p * .6,
        aboveLow: 50, belowHigh: 3, high: p / .97, low: p / 1.5, change: 2, volumeRatio: 1.6 } } };
}
