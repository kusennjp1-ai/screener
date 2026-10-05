// Exact exported records observed 2026-10-03; preserve the inconsistent legacy
// inputs to ensure the presentation never recreates a combined trading plan.
// Source: https://kusennjp1-ai.github.io/screener/static-data/charts-index-99f3a6d6afbdac0c.json
export const dailyObservationIndex = {
  as_of_date: '2026-10-01',
  symbols: [
    { buy: { account_risk_pct: 1.25, active: true, barrels_passed: 3, buy_risk_state: 'low', distance_to_pivot_pct: -28.46, last_close: 66.23, near_pivot: false, position_size_pct: 15.6, signal_as_of: '2026-10-01T00:00:00', stop_basis: 'max_loss_cap', stop_loss: 43.59, stop_pct: 8, target_price_2r: 78.76, target_price_3r: 85.32, trigger_price: 65.63, vcp_detected: false, vcp_source: null }, path: 'verified-charts/CDNA-0bea778fade63248.json', rank: 19, rs_rating: 98.67, sell: { action: 'hold', last_close: 66.23, r_multiple: 0.09, stop: 59.07, stop_basis: 'initial', stop_pct: 8, target_2r: 78.76, target_3r: 85.32 }, symbol: 'CDNA' },
    { buy: { account_risk_pct: 1.25, active: true, barrels_passed: 2, buy_risk_state: 'low', distance_to_pivot_pct: 6.58, last_close: 415.79, near_pivot: false, position_size_pct: 15.6, signal_as_of: '2026-10-01T00:00:00', stop_basis: 'max_loss_cap', stop_loss: 407.69, stop_pct: 8, target_price_2r: 456.03, target_price_3r: 482.26, trigger_price: 403.56, vcp_detected: false, vcp_source: null }, path: 'verified-charts/TER-80dcc34f5d150bdc.json', rank: 24, rs_rating: 93.42, sell: { action: 'hold', last_close: 415.79, r_multiple: 0.47, stop: 377.33, stop_basis: 'initial', stop_pct: 8, target_2r: 456.03, target_3r: 482.26 }, symbol: 'TER' },
  ],
};
