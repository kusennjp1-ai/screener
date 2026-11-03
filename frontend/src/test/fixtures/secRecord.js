// Synthetic schema-2 SEC companyfacts record in the exact shape tools/sec-financials.py
// writes. Never a production SEC observation.
const QUARTERS = [['2024-01-01', '2024-03-31'], ['2024-04-01', '2024-06-30'], ['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'],
  ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']];
const filedAfter = (end, days) => new Date(Date.parse(end) + days * 86400000).toISOString().slice(0, 10);

export function secPoint(field, [start, end], value, extra = {}) {
  const tag = { eps: 'EarningsPerShareDiluted', revenue: 'Revenues', netIncome: 'NetIncomeLoss', inventory: 'InventoryNet', receivables: 'AccountsReceivableNetCurrent' }[field];
  const fourth = end.endsWith('12-31');
  return { end, start: ['inventory', 'receivables'].includes(field) ? null : start, filed: filedAfter(end, 30), value, tag,
    unit: field === 'eps' ? 'USD/shares' : 'USD', accession: `0000000001-${end.slice(2, 4)}-${end.slice(5, 7)}${end.slice(8)}00`, form: fourth ? '10-K' : '10-Q', derived: false, ...extra };
}

export function secRecord({ symbol = 'TEST', asOfDate = '2026-02-01', retrievedAt = `${asOfDate}T10:00:00.000Z`, cik = 1, quarters = QUARTERS,
  eps = [1, 1, 1, 1, 1.1, 1.2, 1.4, 1.8], revenue = [100, 100, 100, 100, 110, 130, 160, 200], netIncome = [10, 10, 10, 10, 11, 14.3, 19.2, 26] } = {}) {
  const series = (field, values) => quarters.map((period, i) => values[i] == null ? null : secPoint(field, period, values[i])).filter(Boolean);
  return {
    schema_version: 2, symbol, cik, as_of_date: asOfDate, retrieved_at: retrievedAt,
    source: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`,
    status: 'available',
    quarterly: { eps: series('eps', eps), revenue: series('revenue', revenue), netIncome: series('netIncome', netIncome), inventory: [], receivables: [] },
    annualEps: [],
    limitations: ['US GAAP標準タグ・USDの報告値。調整後EPSと同一ではない'],
  };
}

export function secUnavailable({ symbol = 'TEST', asOfDate = '2026-02-01', retrievedAt = `${asOfDate}T10:00:00.000Z`, reason = 'no_quarterly', ...extra } = {}) {
  return { schema_version: 2, symbol, as_of_date: asOfDate, status: 'unavailable', reason, error: 'SEC四半期報告なし', retrieved_at: retrievedAt, ...extra };
}
