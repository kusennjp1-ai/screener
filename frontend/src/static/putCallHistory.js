import { historyEnvelope, finite, validDay } from './indicatorHistory.js';
export const PUT_CALL_VERSION = 'market-put-call-volume-v1';
// Adapter only: no provider is scraped or licensed implicitly by this module.
export function putCallHistory(input, asOf) {
  const envelope = { id: 'put-call', version: PUT_CALL_VERSION, asOf, unit: '倍（Put契約数 / Call契約数）',
    source: input?.source?.name || '配信元未接続', scope: input?.scope?.label || '市場全体・対象取引所と商品範囲は未確認',
    method: '日次の取引契約数。建玉（OI）とは別系列。Callが0または欠測なら未確認。' };
  const unavailable = reason => historyEnvelope({ ...envelope, reason });
  if (!input) return unavailable('再配信を許可された市場全体のPut/Call出来高データは未接続です。');
  if (input.version !== PUT_CALL_VERSION || input.metric !== 'volume' || input.license?.redistribution !== 'permitted' ||
    !input.source?.name || !input.source?.url || !Array.isArray(input.scope?.venues) || !input.scope.venues.length ||
    !Array.isArray(input.scope?.products) || !input.scope.products.length || !input.scope.label || !validDay(asOf) || !Array.isArray(input.observations))
    return unavailable('出典・再配信許可・出来高単位・取引所／商品範囲を確認できません。');
  const rows = input.observations.filter(row => row && validDay(row.date) && row.date <= asOf);
  const counts = new Map(); rows.forEach(row => counts.set(row.date, (counts.get(row.date) || 0) + 1));
  const series = [...new Set(rows.map(row => row.date))].sort().map(date => {
    const row = rows.find(item => item.date === date);
    const known = counts.get(date) === 1 && finite(row.put_contracts) && row.put_contracts >= 0 && finite(row.call_contracts) && row.call_contracts > 0;
    return { date, value: known ? row.put_contracts / row.call_contracts : null, known,
      puts: known ? row.put_contracts : null, calls: known ? row.call_contracts : null,
      coverage: known ? input.scope.venues.length : 0, expected: input.scope.venues.length };
  });
  return historyEnvelope({ ...envelope, series, reason: series.length ? null : '対象期間の出来高が未取得です。' });
}
