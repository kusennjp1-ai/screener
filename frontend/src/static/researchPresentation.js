import { corporateFinancialsAllowed } from './instrumentApplicability.js';
import { sectorKey } from './sectorDefinitions.js';
import { evidenceTimestamp, newYorkDate, validEvidenceDay } from './evidenceTime.js';
// Shared presentation contracts: a price level is not evidence of a valid base.
export function canonicalPivot(row) {
  const raw = row?.se_pivot_price ?? row?.vcp_pivot;
  if (!Number.isFinite(raw) || raw <= 0) return { price: null, reason: row?.setup_recalculation?.status === 'calculated' ? '再計算済み・現在有効なピボットなし' : row?.setup_recalculation?.status === 'unavailable' ? '日足の不足・不整合で再計算不可。旧水準は無効' : row?.price_quality?.status === 'replaced' ? '日足修復済み・セットアップの再計算待ち' : 'ピボット未取得' };
  const distance = row.current_price / raw - 1;
  if (Number.isFinite(distance) && Math.abs(distance) > .25) return { price: null, reason: '現在値から25%超離れた旧水準・ベースの再形成待ち' };
  return { price: raw, reason: row.se_pivot_price != null ? 'Setup Engine（日次）' : 'VCP（日次）' };
}

export function filterRanked(ranked, { search = '', qualifiedOnly = false, nearOnly = false, watchlist = null, liquidOnly = false, coverage = 'all', sector = '', annualEpsOnly = false, annualEpsStates = null } = {}) {
  const query = search.trim().toUpperCase();
  return ranked.filter(({row:r, assessment:a}) =>
    (!annualEpsOnly || annualEpsStates?.get(r) === 'pass') &&
    (!sector || sectorKey(r.gics_sector)===sector) &&
    (!liquidOnly || (Number.isFinite(r.current_price) && Number.isFinite(r.adv_usd) && r.current_price >= 10 && r.adv_usd >= 20000000)) &&
    (!qualifiedOnly || (corporateFinancialsAllowed(r) && a.qualified)) && (!watchlist || watchlist.includes(r.symbol)) &&
    (!nearOnly || (corporateFinancialsAllowed(r) && a.total > 0 && a.passed === a.total - 1 && !a.qualified)) &&
    (!query || `${r.symbol} ${r.company_name || ''}`.toUpperCase().includes(query)) &&
    (coverage === 'all' || (coverage === 'verified') === (r.technical_audit?.valid === true)));
}

export function sessionCurrent(rows, date, now) {
  return prepareSessionCurrent(rows, date)(now);
}

// A publication repeats the same exchange calendar on many stock rows. Parse
// each distinct interval once when that immutable publication/date changes;
// clock ticks and method changes only need the original inclusive/exclusive
// time comparison, without parsing thousands of identical ISO timestamps.
export function prepareSessionCurrent(rows, date) {
  return sessionCurrentFromIntervals(prepareSessionIntervals(rows, date), date);
}

// Plain arrays cross the research Worker boundary without rebuilding the
// publication-wide calendar index during the first synchronous React render.
export function prepareSessionIntervals(rows, date) {
  if (!validEvidenceDay(date)) return [];
  const intervals = new Map(), timestamps = new Map();
  const stamp = value => {
    if (!timestamps.has(value)) timestamps.set(value, evidenceTimestamp(value));
    return timestamps.get(value);
  };
  for (const row of rows) {
    const evidence = row.entry_evidence, calendar = evidence?.calendar;
    if (!calendar || evidence.as_of_date !== date || calendar.latest_completed_session !== date) continue;
    const from = stamp(calendar.evaluated_at), until = stamp(calendar.valid_until);
    if (Number.isFinite(from) && Number.isFinite(until)) intervals.set(`${from}/${until}`, [from, until]);
  }
  return [...intervals.values()];
}

export function sessionCurrentFromIntervals(ranges, date) {
  if (!validEvidenceDay(date)) return () => false;
  return now => {
    const today = newYorkDate(now);
    return Boolean(today && date <= today && ranges.some(([from, until]) => now >= from && now < until));
  };
}

export function formatPublished(value) {
  if (!value) return '未確認';
  // Exporter emits UTC timestamps, including older naive ISO strings.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? `${date.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'})} JST` : '未確認';
}

// Coverage is measured after the ordinary filters, before this optional AND.
export function annualEpsCoverage(ranked, states) {
  const counts = { total: ranked.length, pass: 0, fail: 0, unknown: 0, not_applicable: 0 };
  for (const { row } of ranked) counts[states?.get(row) || 'unknown']++;
  return counts;
}
