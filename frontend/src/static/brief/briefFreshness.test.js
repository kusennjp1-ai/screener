// The publication's age from the market-trends exchange calendar (RW8): the same day, within the grace after a
// session's close, sessions missing after it, a weekend and a holiday, and an invalid or expired calendar.
import { describe, expect, it } from 'vitest';
import exchange from '../__fixtures__/nyse-sessions-2024-2026.json' with { type: 'json' };
import { FRESHNESS_GRACE_HOURS, freshness, freshnessLine, missingDays } from './briefFreshness';

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
      note: 'この公開は10/2引けの分析です。その後に取引を終えた10/5・10/6（2営業日）の値はまだ反映されていません（公開の遅れ）。' });
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
