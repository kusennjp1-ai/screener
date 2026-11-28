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

// The regular NYSE close on the New York wall clock (16:00), in minutes: a session the calendar closes earlier is a
// short session. Compared on the wall clock, never in UTC against another session (a daylight-time change moves the
// UTC close by an hour without shortening the session).
const REGULAR_CLOSE_MINUTES = 16 * 60;
let newYork, tokyo;
const parts = (format, ms) => Object.fromEntries(format.formatToParts(ms).map(part => [part.type, part.value]));
function newYorkMinutes(ms) {
  newYork ||= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const { hour, minute } = parts(newYork, ms);
  return Number(hour) * 60 + Number(minute);
}
/** An instant as Japan's wall clock names it: 「11/28 03:00」. */
function tokyoClock(ms) {
  tokyo ||= new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const { month, day, hour, minute } = parts(tokyo, ms);
  return `${month}/${day} ${hour}:${minute}`;
}
const WEEKDAY = '日月火水木金土';
const weekday = iso => new Date(`${iso}T12:00:00Z`).getUTCDay();
const dayName = iso => `${shortDate(iso, iso)}（${WEEKDAY[weekday(iso)]}）`;

/**
 * What the exchange calendar says about the gap before the next session (latency plan F9), from the same valid
 * refresh_schedule as freshness and only while the publication is current (a late, pending, unknown or loading age
 * keeps its own line, so this never hides it): `{ closed, next, early, closeAt, age, detail, text }` or null.
 * - `closed`: the weekdays (Mon-Fri) strictly between the analysis date and the next listed session, the days the
 *   calendar lists no session for (休場). A weekend is never one, and nothing is guessed without a valid calendar.
 * - `early`: the next session closes before 16:00 New York (短縮取引), its close (`closeAt`) as the calendar gives it.
 * `age` replaces the bar's 「米国株」 (「11/26休場」, 「12/24短縮取引」); `detail` follows it where it fits; `text` is the
 * whole sentence. The calendar carries no holiday names, so none is said. Nothing here changes a judgement or a value.
 */
export function closureNote({ trends, date, now } = {}) {
  if (freshness({ trends, date, now }).state !== 'current') return null;
  const asset = trends && Object.hasOwn(trends, 'data') ? trends.data : trends;
  const sessions = validSessions(asset?.refresh_schedule, now), at = sessions?.findIndex(row => row.date === date) ?? -1;
  const next = at >= 0 ? sessions[at + 1] : null;
  if (!next) return null;
  const closed = [];
  for (let day = Date.parse(`${date}T12:00:00Z`) + 86400000, end = Date.parse(`${next.date}T12:00:00Z`); day < end; day += 86400000) {
    const iso = new Date(day).toISOString().slice(0, 10);
    if (weekday(iso) % 6) closed.push(iso);
  }
  const closeAt = Date.parse(next.close_at), early = newYorkMinutes(closeAt) < REGULAR_CLOSE_MINUTES;
  if (!closed.length && !early) return null;
  const days = missingDays(closed, date), named = closed.length <= 2 ? closed.map(dayName).join('・') : `${dayName(closed[0])}〜${dayName(closed.at(-1))}`;
  const clock = tokyoClock(closeAt), nextDay = shortDate(next.date, date);
  const holiday = closed.length ? `${named}は米国市場の休場日です（取引所カレンダー）。` : '';
  const session = early ? `次の取引日 ${dayName(next.date)}は短縮取引で、引けは日本時間 ${clock} の予定です。` : `次の取引日は${dayName(next.date)}です。`;
  return { closed, next: next.date, early, closeAt,
    age: closed.length ? `${days}休場` : `${nextDay}短縮取引`,
    detail: closed.length ? (early ? `（${nextDay} 短縮取引・引け 日本時間 ${clock}）` : `（次の取引日 ${dayName(next.date)}）`) : `（引け 日本時間 ${clock}）`,
    text: `${holiday}${session}` };
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
 * 「（10/5・10/6 未反映）」 where it fits, and `note`, the full sentence for Today's notes, with the grace it waits
 * (FRESHNESS_GRACE_HOURS, 独自設定). Unknown: 「鮮度未確認」.
 */
export function freshnessLine(value, date) {
  if (value?.state === 'unknown') return { tone: 'unknown', age: '鮮度未確認', detail: '', note: `この公開（${shortDate(date, date)}引け）より後の取引日を、取引所カレンダーで確認できません（鮮度未確認）。` };
  if (value?.state !== 'stale') return null;
  const days = missingDays(value.missing, date);
  return { tone: 'warn', age: `${value.missing.length}営業日前`, detail: `（${days} 未反映）`,
    note: `この公開は${shortDate(date, date)}引けの分析です。その後に取引を終えた${days}（${value.missing.length}営業日）の値はまだ反映されていません（公開の遅れ：取引終了から${FRESHNESS_GRACE_HOURS}時間を過ぎても次の公開がないときに表示・独自設定）。` };
}
