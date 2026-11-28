// The publication's age from the market-trends exchange calendar (RW8): the same day, within the grace after a
// session's close, sessions missing after it, a weekend and a holiday, and an invalid or expired calendar.
import { describe, expect, it } from 'vitest';
import exchange from '../__fixtures__/nyse-sessions-2024-2026.json' with { type: 'json' };
import { closureNote, FRESHNESS_GRACE_HOURS, freshness, freshnessLine, missingDays } from './briefFreshness';

const HOUR = 3600000;
// A schedule as collect-market-trends.py writes it: the sessions from a week before the date to 45 days after,
// each closing at 16:00 New York (20:00Z in daylight time, 21:00Z in winter; the day after Thanksgiving 13:00).
const winter = day => (day >= '2025-11-03' && day < '2026-03-09') || day >= '2026-11-02';
const closeAt = day => day === '2025-11-28' ? `${day}T18:00:00Z` : winter(day) ? `${day}T21:00:00Z` : `${day}T20:00:00Z`;
const schedule = (date, extra = {}) => {
  const at = exchange.sessions.indexOf(date), sessions = exchange.sessions.slice(Math.max(0, at - 5), at + 31);
  return { refresh_schedule: { provider: 'pandas_market_calendars:NYSE', version: '5.4.0', generated_at: `${date}T22:00:00Z`, valid_until: `${sessions.at(-1)}T23:00:00Z`, sessions: sessions.map(day => ({ date: day, close_at: closeAt(day) })), ...extra } };
};
const DATE = '2026-10-02'; // a Friday
const trends = { data: schedule(DATE), loading: false };
const at = iso => Date.parse(iso);

describe('the publication\'s age', () => {
  it('is current on the same day and over the weekend, before the next session closes', () => {
    expect(freshness({ trends, date: DATE, now: at('2026-10-02T21:30:00Z') })).toEqual({ state: 'current', missing: [], next: at('2026-10-05T20:00:00Z') });
    expect(freshness({ trends, date: DATE, now: at('2026-10-04T15:00:00Z') }).state).toBe('current');
    expect(freshness({ trends, date: DATE, now: at('2026-10-05T19:59:00Z') }).state).toBe('current');
  });

  it('is pending within the grace after a session closed, with no change on screen', () => {
    expect(FRESHNESS_GRACE_HOURS).toBe(28);
    const value = freshness({ trends, date: DATE, now: at('2026-10-06T10:00:00Z') });
    // Read again at the next close (10/6), before the grace ends.
    expect(value).toEqual({ state: 'pending', missing: ['2026-10-05'], next: at('2026-10-06T20:00:00Z') });
    expect(freshness({ trends, date: DATE, now: at('2026-10-06T20:30:00Z') }).next).toBe(at('2026-10-05T20:00:00Z') + 28 * HOUR);
    expect(freshnessLine(value, DATE)).toBeNull();
    expect(freshness({ trends, date: DATE, now: at('2026-10-05T20:00:00Z') + 28 * HOUR - 1 }).state).toBe('pending');
  });

  it('is stale once the first session after the date is past the grace, naming every session closed since', () => {
    const one = freshness({ trends, date: DATE, now: at('2026-10-05T20:00:00Z') + 28 * HOUR });
    expect(one).toEqual({ state: 'stale', missing: ['2026-10-05', '2026-10-06'], next: at('2026-10-07T20:00:00Z') });
    // Two sessions later (10/7 09:00Z): 10/5 and 10/6 have closed.
    const two = freshness({ trends, date: DATE, now: at('2026-10-07T09:00:00Z') });
    expect(two.missing).toEqual(['2026-10-05', '2026-10-06']);
    expect(freshnessLine(two, DATE)).toEqual({ tone: 'warn', age: '2営業日前', detail: '（10/5・10/6 未反映）',
      note: 'この公開は10/2引けの分析です。その後に取引を終えた10/5・10/6（2営業日）の値はまだ反映されていません（公開の遅れ：取引終了から28時間を過ぎても次の公開がないときに表示・独自設定）。' });
    // The grace in the note is the constant (独自設定, rule 13), never a second number.
    expect(freshnessLine(two, DATE).note).toContain(`取引終了から${FRESHNESS_GRACE_HOURS}時間`);
    const four = freshness({ trends, date: DATE, now: at('2026-10-09T09:00:00Z') });
    expect([four.missing.length, freshnessLine(four, DATE).detail]).toEqual([4, '（10/5〜10/8 未反映）']);
    expect(missingDays([], DATE)).toBe('');
  });

  it('counts exchange sessions only: a holiday and a half day', () => {
    // The Wednesday before Thanksgiving 2025: the holiday (11/27) is no session; the half day (11/28) closes at 13:00
    // New York, and the weekend after it adds none.
    const value = { data: schedule('2025-11-26'), loading: false };
    expect(freshness({ trends: value, date: '2025-11-26', now: at('2025-11-28T12:00:00Z') }).state).toBe('current');
    expect(freshness({ trends: value, date: '2025-11-26', now: at('2025-11-28T19:00:00Z') })).toMatchObject({ state: 'pending', missing: ['2025-11-28'] });
    expect(freshness({ trends: value, date: '2025-11-26', now: at('2025-11-29T22:00:00Z') })).toMatchObject({ state: 'stale', missing: ['2025-11-28'] });
    expect(freshnessLine(freshness({ trends: value, date: '2025-11-26', now: at('2025-11-30T22:00:00Z') }), '2025-11-26')).toMatchObject({ age: '1営業日前', detail: '（11/28 未反映）' });
  });

  it('is unknown without a valid calendar, never current: absent, another provider, expired, out of order, or not covering the date', () => {
    const now = at('2026-10-03T16:35:00Z');
    const bad = [
      { data: {} }, { data: null }, null, undefined, { error: true, loading: false },
      { data: schedule(DATE, { provider: 'weekday-guess' }) },
      { data: schedule(DATE, { valid_until: '2026-10-03T00:00:00Z' }) },
      { data: schedule(DATE, { sessions: [{ date: '2026-10-05', close_at: '2026-10-05T20:00:00Z' }, { date: '2026-10-02', close_at: '2026-10-02T20:00:00Z' }] }) },
      { data: schedule(DATE, { sessions: [{ date: '2026-10-05', close_at: 'later' }] }) },
      { data: schedule(DATE, { sessions: [{ date: '2026-10-05', close_at: '2026-10-05T20:00:00Z' }, { date: '2026-10-06', close_at: '2026-10-06T20:00:00Z' }] }) },
    ];
    expect(bad.map(value => freshness({ trends: value, date: DATE, now }).state)).toEqual(bad.map(() => 'unknown'));
    expect(freshness({ trends, date: null, now }).state).toBe('unknown');
    expect(freshness({ trends, date: DATE, now: NaN }).state).toBe('unknown');
    expect(freshnessLine({ state: 'unknown' }, DATE)).toMatchObject({ tone: 'unknown', age: '鮮度未確認', detail: '' });
    // Never 最新 in any wording.
    for (const state of ['unknown', 'stale']) expect(JSON.stringify(freshnessLine({ state, missing: ['2026-10-05'] }, DATE))).not.toContain('最新');
  });

  it('says nothing while the market data loads, and reads the asset itself as well as the query', () => {
    expect(freshness({ trends: { loading: true }, date: DATE, now: at('2026-10-07T09:00:00Z') }).state).toBe('loading');
    expect(freshness({ trends: schedule(DATE), date: DATE, now: at('2026-10-07T09:00:00Z') }).state).toBe('stale');
  });
});

// The holiday and short-session line (latency plan F9), read from the same calendar: a weekday the calendar lists no
// session for before the next session, or a next session that closes before 16:00 New York. Thanksgiving 2026 (11/26)
// and the short day after it (11/27, 13:00 New York = 18:00Z), Christmas Eve 2026 (12/24, 13:00) and Good Friday 2026.
describe('the holiday and short-session line', () => {
  // The session list fixture ends on 2026-10-16; the NYSE sessions after it to mid-January 2027 are every weekday but
  // Thanksgiving (11/26) and Christmas (12/25) 2026 and New Year's Day 2027 (the exchange's published 2026-2027 holidays).
  const later = [];
  for (let day = Date.parse('2026-10-19T12:00:00Z'); day <= Date.parse('2027-01-15T12:00:00Z'); day += 86400000) {
    const iso = new Date(day).toISOString().slice(0, 10);
    if (new Date(day).getUTCDay() % 6 && !['2026-11-26', '2026-12-25', '2027-01-01'].includes(iso)) later.push(iso);
  }
  const all = [...exchange.sessions, ...later];
  const SHORT = ['2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24'];
  const close = day => SHORT.includes(day) ? `${day}T18:00:00Z` : winter(day) ? `${day}T21:00:00Z` : `${day}T20:00:00Z`;
  const calendar = (date, edit = sessions => sessions) => {
    const index = all.indexOf(date), days = all.slice(Math.max(0, index - 5), index + 31);
    return { data: { refresh_schedule: { provider: 'pandas_market_calendars:NYSE', valid_until: `${days.at(-1)}T23:00:00Z`, sessions: edit(days.map(day => ({ date: day, close_at: close(day) }))) } }, loading: false };
  };

  it('says the Thanksgiving closure and the short day after it, from the analysis date until that session closes', () => {
    const trends = calendar('2026-11-25'), note = now => closureNote({ trends, date: '2026-11-25', now: at(now) });
    // F9's window: the holiday's would-be close (11-26 21:00Z = 11-27 06:00 Japan) to the short session's close (11-27 18:00Z).
    for (const now of ['2026-11-26T21:00:00Z', '2026-11-27T03:00:00Z', '2026-11-27T17:59:00Z']) expect(note(now)).toEqual({
      closed: ['2026-11-26'], next: '2026-11-27', early: true, closeAt: at('2026-11-27T18:00:00Z'),
      age: '11/26休場', detail: '（11/27 短縮取引・引け 日本時間 11/28 03:00）',
      text: '11/26（木）は米国市場の休場日です（取引所カレンダー）。次の取引日 11/27（金）は短縮取引で、引けは日本時間 11/28 03:00 の予定です。' });
    // And from the analysis date's own publication, before the holiday (a superset of F9's window: the closure is a fact
    // of the calendar all along).
    expect(note('2026-11-26T07:34:00Z')?.age).toBe('11/26休場');
    // Once the next session has closed the age is pending (then late): the line is the age's, not the holiday's.
    expect(note('2026-11-27T18:00:00Z')).toBeNull();
    expect(freshness({ trends, date: '2026-11-25', now: at('2026-11-27T18:00:00Z') }).state).toBe('pending');
  });

  it('says a short next session on its own, with its close in Japan time', () => {
    const value = closureNote({ trends: calendar('2026-12-23'), date: '2026-12-23', now: at('2026-12-24T03:00:00Z') });
    expect(value).toMatchObject({ closed: [], next: '2026-12-24', early: true, age: '12/24短縮取引', detail: '（引け 日本時間 12/25 03:00）',
      text: '次の取引日 12/24（木）は短縮取引で、引けは日本時間 12/25 03:00 の予定です。' });
    // After the short day: Christmas (a Friday) is closed and the weekend is not a holiday; the next session is 12/28.
    expect(closureNote({ trends: calendar('2026-12-24'), date: '2026-12-24', now: at('2026-12-26T03:00:00Z') })).toMatchObject({
      closed: ['2026-12-25'], next: '2026-12-28', early: false, age: '12/25休場', detail: '（次の取引日 12/28（月））',
      text: '12/25（金）は米国市場の休場日です（取引所カレンダー）。次の取引日は12/28（月）です。' });
  });

  it('across a year: the bar\'s date carries the year as the late detail\'s does, the sentence names the weekday', () => {
    // New Year's Day 2027 (a Friday) after the 12/31 analysis; the next session Monday 1/4.
    expect(closureNote({ trends: calendar('2026-12-31'), date: '2026-12-31', now: at('2027-01-01T12:00:00Z') })).toMatchObject({
      closed: ['2027-01-01'], next: '2027-01-04', early: false, age: '2027/1/1休場', detail: '（次の取引日 1/4（月））',
      text: '1/1（金）は米国市場の休場日です（取引所カレンダー）。次の取引日は1/4（月）です。' });
  });

  it('names only the weekdays: a Friday holiday before a weekend, and two closed weekdays', () => {
    // Thanksgiving 2025 on the session list itself: 11/27 is not in it, and 11/28 closes at 13:00 New York.
    expect(closureNote({ trends: calendar('2025-11-26'), date: '2025-11-26', now: at('2025-11-27T22:00:00Z') })).toMatchObject({
      closed: ['2025-11-27'], next: '2025-11-28', early: true, age: '11/27休場', detail: '（11/28 短縮取引・引け 日本時間 11/29 03:00）' });
    // Good Friday 2026 (4/3): Thursday's analysis, the next session Monday 4/6.
    expect(closureNote({ trends: calendar('2026-04-02'), date: '2026-04-02', now: at('2026-04-04T12:00:00Z') })).toMatchObject({ closed: ['2026-04-03'], age: '4/3休場' });
    // Two weekdays the calendar lists no session for (a closure the fixture's dates do not have, as an edited calendar).
    const two = calendar(DATE, sessions => sessions.filter(row => !['2026-10-05', '2026-10-06'].includes(row.date)));
    expect(closureNote({ trends: two, date: DATE, now: at('2026-10-03T16:35:00Z') })).toMatchObject({ closed: ['2026-10-05', '2026-10-06'], next: '2026-10-07', age: '10/5・10/6休場',
      text: '10/5（月）・10/6（火）は米国市場の休場日です（取引所カレンダー）。次の取引日は10/7（水）です。' });
  });

  it('says nothing over an ordinary weekend, on a daylight-time Monday, or on an ordinary day', () => {
    for (const now of ['2026-10-02T21:30:00Z', '2026-10-03T16:35:00Z', '2026-10-04T15:00:00Z', '2026-10-05T19:59:00Z']) expect(closureNote({ trends: calendar(DATE), date: DATE, now: at(now) })).toBeNull();
    // The Mondays after the clock changes close at 16:00 New York though an hour apart in UTC from the Friday before.
    expect(closureNote({ trends: calendar('2026-03-06'), date: '2026-03-06', now: at('2026-03-07T12:00:00Z') })).toBeNull();
    expect(closureNote({ trends: calendar('2026-10-30'), date: '2026-10-30', now: at('2026-10-31T12:00:00Z') })).toBeNull();
    expect(closureNote({ trends: calendar('2026-10-06'), date: '2026-10-06', now: at('2026-10-07T03:00:00Z') })).toBeNull();
  });

  it('says nothing without a valid calendar, when the analysis date is not in it, or while the age is late, pending or loading', () => {
    const now = at('2026-11-27T03:00:00Z');
    const bad = [
      { data: {} }, null, undefined, { loading: true },
      { data: { refresh_schedule: { ...calendar('2026-11-25').data.refresh_schedule, provider: 'weekday-guess' } } },
      { data: { refresh_schedule: { ...calendar('2026-11-25').data.refresh_schedule, valid_until: '2026-11-27T00:00:00Z' } } },
      calendar('2026-11-25', sessions => sessions.filter(row => row.date !== '2026-11-25')),
    ];
    expect(bad.map(trends => closureNote({ trends, date: '2026-11-25', now }))).toEqual(bad.map(() => null));
    expect(closureNote({ trends: calendar('2026-11-25'), date: null, now })).toBeNull();
    expect(closureNote({ trends: calendar('2026-11-25'), date: '2026-11-25', now: NaN })).toBeNull();
    // Late: the publication of 11/24 two sessions on (11/25 and 11/27 closed) keeps 「n営業日前」, never the holiday.
    const late = { trends: calendar('2026-11-24'), date: '2026-11-24', now: at('2026-11-28T09:00:00Z') };
    expect(freshnessLine(freshness(late), '2026-11-24')).toMatchObject({ tone: 'warn', age: '2営業日前' });
    expect(closureNote(late)).toBeNull();
    // Never 最新 or a weekday guess in any wording.
    const said = closureNote({ trends: calendar('2026-11-25'), date: '2026-11-25', now });
    expect(JSON.stringify(said)).not.toMatch(/最新|祝日|感謝祭/);
  });
});
