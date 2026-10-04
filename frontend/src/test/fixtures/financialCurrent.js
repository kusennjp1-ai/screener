// Synthetic compact-contract fixtures only. These are not vendor observations.
export const financialFixtureDate = '2026-10-02';
export const financialFixtureNow = Date.parse('2026-10-03T12:00:00Z');
export function withSyntheticFinancialProof(row = {}, { date = financialFixtureDate, now = financialFixtureNow } = {}) {
  const symbol = row.symbol || 'TEST';
  const values = { eps_growth_yy: 30, sales_growth_yy: 40, ...row };
  const reasons = [...'222222222222bbbb'];
  const p = {};
  for (const [index, field, metric] of [[1, 'eps_growth_yy', 'Diluted EPS'], [3, 'sales_growth_yy', 'Total Revenue']]) {
    reasons[index] = '0';
    // Synthetic input assumes a positive EPS/revenue baseline explicitly.
    const comparison = index === 1 ? values[field] > 0 ? 'g' : values[field] < 0 ? 'd' : 'u' : values[field] > 0 ? 'G' : values[field] < 0 ? 'D' : 'U';
    p[index] = [values[field], '1', metric, ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'], now - 3600000, now - 3600000 + 7 * 86400000, comparison, 'r'];
  }
  return { ...values, symbol, market: 'US', as_of_date: date,
    technical_audit: { as_of_date: date, ...row.technical_audit },
    financial_current: { v: 2, t: now, s: symbol, m: 'US', a: date, r: reasons.join(''), p } };
}
