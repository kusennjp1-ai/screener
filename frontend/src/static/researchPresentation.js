// Shared presentation contracts: a price level is not evidence of a valid base.
export function canonicalPivot(row) {
  const raw = row?.se_pivot_price ?? row?.vcp_pivot;
  if (!Number.isFinite(raw) || raw <= 0) return { price: null, reason: 'ピボット未取得' };
  const distance = row.current_price / raw - 1;
  if (Number.isFinite(distance) && Math.abs(distance) > .25) return { price: null, reason: '現在値から25%超離れた旧水準・ベースの再形成待ち' };
  return { price: raw, reason: row.se_pivot_price != null ? 'Setup Engine（日次）' : 'VCP（日次）' };
}

export function filterRanked(ranked, { search = '', qualifiedOnly = false, watchlist = null, liquidOnly = false, coverage = 'all' } = {}) {
  const query = search.trim().toUpperCase();
  return ranked.filter(({row:r, assessment:a}) =>
    (!liquidOnly || (Number.isFinite(r.current_price) && Number.isFinite(r.adv_usd) && r.current_price >= 10 && r.adv_usd >= 20000000)) &&
    (!qualifiedOnly || a.qualified) && (!watchlist || watchlist.includes(r.symbol)) &&
    `${r.symbol} ${r.company_name || ''}`.toUpperCase().includes(query) &&
    (coverage === 'all' || (coverage === 'verified') === (r.technical_audit?.valid === true)));
}

export function sessionCurrent(rows, date, now) {
  return rows.some(r => r.entry_evidence?.as_of_date === date &&
    r.entry_evidence?.calendar?.latest_completed_session === date &&
    now >= Date.parse(r.entry_evidence.calendar.evaluated_at) && now < Date.parse(r.entry_evidence.calendar.valid_until));
}

export function formatPublished(value) {
  if (!value) return '未確認';
  // Exporter emits UTC timestamps, including older naive ISO strings.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? `${date.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'})} JST` : '未確認';
}
