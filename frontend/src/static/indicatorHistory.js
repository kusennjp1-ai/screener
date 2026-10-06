// Shared public history envelope. Unknown observations remain null, never zero.
export const INDICATOR_HISTORY_VERSION = 'indicator-history-v1';
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const positive = value => finite(value) && value > 0;
export const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function historyEnvelope({ id, asOf, unit, source, scope, method, series = [], reason = null, basis = 'observed', version = INDICATOR_HISTORY_VERSION }) {
  return { id, version, as_of_date: asOf, unit, source, scope, method, basis, series,
    status: series.some(row => row.known === true) ? 'available' : 'unavailable', reason,
    latest: series.at(-1) || null };
}
export function highLowHistory(evidence, asOf) {
  const valid = evidence?.version === 'book-market-v1' && evidence.as_of_date === asOf && Array.isArray(evidence.series);
  return historyEnvelope({ id: 'new-high-low', asOf, unit: '銘柄', source: '公開チャート日足', basis: 'retrospective_estimate',
    scope: evidence?.universe?.definition || '現在の公開チャート集合（当時の全上場銘柄集合ではない）',
    method: evidence?.methods?.newHighLow || '当日高値／安値が直前251本を厳密に更新（合計252本）',
    reason: valid ? null : '分析日の一致する252本以上の日足が未取得',
    series: valid ? evidence.series.map(row => ({ date: row.date, high: row.newHighs, low: row.newLows, coverage: row.coverage,
      expected: row.expectedUniverseSize, known: finite(row.newHighs) && finite(row.newLows) })) : [] });
}
