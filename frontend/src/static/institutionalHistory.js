import { historyEnvelope, validDay } from './indicatorHistory.js';
export function institutionalHolderHistory(data, symbol, asOf) {
  const envelope = { id: 'institutional-holders', asOf, unit: '13F報告運用会社（CIK）', source: data?.source || 'SEC 13F',
    scope: `${symbol} / ${data?.cusip || '証券識別子未確認'} / ${data?.share_class || '株式クラス未記録'}`,
    method: '四半期末の報告保有会社数。公表集計期限までの提出・訂正をCIK単位で重複除去。売買フロー・ファンド数ではなく、日次へ補間しません。' };
  if (data?.symbol !== symbol || data.unit !== '13f_reporting_manager_cik' || !validDay(asOf) || !validDay(data.publication_cutoff) || data.publication_cutoff > asOf)
    return historyEnvelope({ ...envelope, reason: '銘柄・集計期限の一致する保有報告が未取得です。' });
  const raw = data.history || data.observations;
  const observations = Array.isArray(raw) ? raw.filter(row => row && typeof row === 'object') : [];
  const seen = new Set(), duplicate = new Set();
  for (const item of observations) { if (seen.has(item.period)) duplicate.add(item.period); seen.add(item.period); }
  const rows = observations.filter(item => validDay(item.period) && item.period <= asOf).sort((a, b) => a.period.localeCompare(b.period));
  const series = rows.map((row, index) => {
    const cutoff = row.publication_cutoff || data.publication_cutoff;
    const known = !duplicate.has(row.period) && validDay(cutoff) && cutoff <= asOf && validDay(row.filing_date_first) && validDay(row.filing_date_last) &&
      row.filing_date_first >= row.period && row.filing_date_last >= row.filing_date_first && row.filing_date_last <= cutoff && Number.isInteger(row.manager_count) && row.manager_count > 0;
    const previous = rows[index - 1], spacing = previous ? (Date.parse(row.period) - Date.parse(previous.period)) / 86400000 : null;
    return { date: row.period, value: known ? row.manager_count : null, known, cutoff, filingFirst: row.filing_date_first, filingLast: row.filing_date_last,
      comparablePrior: Boolean(known && previous && spacing >= 89 && spacing <= 92), coverage: known ? 1 : 0, expected: 1 };
  });
  for (let i = 0; i < series.length; i++) series[i].delta = series[i].comparablePrior && series[i - 1]?.known ? series[i].value - series[i - 1].value : null;
  return {...historyEnvelope({ ...envelope, series, reason: series.length ? null : '四半期観測が未取得です。' }),symbol,cusip:data.cusip || null,publication_cutoff:data.publication_cutoff};
}
