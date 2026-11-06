// How far the publication's analysis date is behind the exchange (round 2, RW8): the NYSE sessions that have
// closed since the analysis date, from the market-trends asset's independent exchange calendar
// (refresh_schedule, validated as marketUpdateState does). A late publication is said on every screen's bar;
// without a valid calendar the age is 未確認, never 最新. Nothing here changes a judgement or a value.
import { validEvidenceDay } from '../evidenceTime';
import { shortDate } from './briefShared';

/**
 * Hours after a session's close in which its publication is still expected (独自設定, plan §9-21): the p90
 * of the last 10 scheduled publications' latency from the close (I0: 27.63 h, rounded up). Within it the bar
 * is unchanged; after it, a missing session is said.
 */
export const FRESHNESS_GRACE_HOURS = 28;
const HOUR = 3600000;

/** The schedule's sessions when it is the exchange calendar the app trusts and still valid at `now`, else null. */
function validSessions(schedule, now) {
  const sessions = schedule?.sessions, until = Date.parse(schedule?.valid_until);
  const valid = Number.isFinite(now) && schedule?.provider === 'pandas_market_calendars:NYSE' &&
    Number.isFinite(until) && now < until && Array.isArray(sessions) && sessions.length > 0 &&
    sessions.every((row, i) => validEvidenceDay(row?.date) && Number.isFinite(Date.parse(row.close_at)) &&
      Date.parse(row.close_at) < until && (!i || (row.date > sessions[i - 1].date && Date.parse(row.close_at) > Date.parse(sessions[i - 1].close_at))));
  return valid ? sessions : null;
}

/**
 * The publication's age at `now`: `{ state, missing, next }`.
 * - state 'loading': the market-trends asset is still loading (nothing is said yet).
 * - state 'unknown': no valid calendar (none published, invalid, expired, or not covering the analysis date).
 * - state 'current': no session has closed since the analysis date.
 * - state 'pending': sessions have closed, the first of them within FRESHNESS_GRACE_HOURS (no change).
 * - state 'stale': the first session after the analysis date closed more than FRESHNESS_GRACE_HOURS ago.
 * `missing` lists the dates of the sessions closed after the analysis date (empty unless pending or stale);
 * `next` is the next instant (ms) at which the answer can change, or null.
 * `trends` is the market-trends query (brief.trends: { data, loading }) or the asset itself.
 */
export function freshness({ trends, date, now } = {}) {
  const loading = Boolean(trends?.loading || trends?.isLoading) && !trends?.data;
  if (loading) return { state: 'loading', missing: [], next: null };
  const asset = trends && Object.hasOwn(trends, 'data') ? trends.data : trends;
  const sessions = validEvidenceDay(date) ? validSessions(asset?.refresh_schedule, now) : null;
  if (!sessions || !sessions.some(row => row.date === date)) return { state: 'unknown', missing: [], next: null };
  const after = sessions.filter(row => row.date > date), closed = after.filter(row => Date.parse(row.close_at) <= now);
  const upcoming = after.find(row => Date.parse(row.close_at) > now);
  const deadline = closed.length ? Date.parse(closed[0].close_at) + FRESHNESS_GRACE_HOURS * HOUR : null;
  const missing = closed.map(row => row.date);
  const nextClose = upcoming ? Date.parse(upcoming.close_at) : null;
  if (!closed.length) return { state: 'current', missing, next: nextClose };
  if (now < deadline) return { state: 'pending', missing, next: Math.min(deadline, nextClose ?? Infinity) };
  return { state: 'stale', missing, next: nextClose };
}

/** The missing sessions as the bar names them: 「10/5」, 「10/5・10/6」, 「10/5〜10/8」. */
export function missingDays(missing, reference) {
  if (!missing?.length) return '';
  const day = iso => shortDate(iso, reference);
  return missing.length <= 2 ? missing.map(day).join('・') : `${day(missing[0])}〜${day(missing.at(-1))}`;
}

/**
 * What the bar's date line adds for this age: `{ tone, age, detail, note }` or null (current, pending or
 * loading: the line is unchanged). Stale: tone 'warn', `age` 「2営業日前」 (replacing 「米国株」), `detail`
 * 「（10/5・10/6 未反映）」 where it fits, and `note`, the full sentence for Today's notes. Unknown: 「鮮度未確認」.
 */
export function freshnessLine(value, date) {
  if (value?.state === 'unknown') return { tone: 'unknown', age: '鮮度未確認', detail: '', note: `この公開（${shortDate(date, date)}引け）より後の取引日を、取引所カレンダーで確認できません（鮮度未確認）。` };
  if (value?.state !== 'stale') return null;
  const days = missingDays(value.missing, date);
  return { tone: 'warn', age: `${value.missing.length}営業日前`, detail: `（${days} 未反映）`,
    note: `この公開は${shortDate(date, date)}引けの分析です。その後に取引を終えた${days}（${value.missing.length}営業日）の値はまだ反映されていません（公開の遅れ）。` };
}
