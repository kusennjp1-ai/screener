import { expect, it } from 'vitest';
import { evidenceTimestamp, newYorkDate } from './evidenceTime';
import { snapshotFreshness, quoteStatus } from './researchEngine';
import { prepareSessionCurrent, sessionCurrent } from './researchPresentation';
import { buildPortfolioPlan } from './portfolioPlan';

it.each([null, {}, [], { toString: 42 }, 42])('rejects non-string evidence timestamps: %j', value => {
  expect(evidenceTimestamp(value)).toBeNaN();
  expect(snapshotFreshness(value).state).toBe('unknown');
  expect(quoteStatus({ price: 100, as_of: value })).toBe('期限切れ');
});
it.each([
  ['2026-09-26T03:59:59Z', '2026-09-25'],
  ['2026-09-26T04:00:00Z', '2026-09-26'],
  ['2026-01-10T04:59:59Z', '2026-01-09'],
  ['2026-01-10T05:00:00Z', '2026-01-10'],
])('uses the New York calendar across summer and winter midnight: %s', (clock, date) => {
  expect(newYorkDate(Date.parse(clock))).toBe(date);
});
it.each([null, {}, NaN, Infinity, '2026-09-26', 8640000000000000])('does not invent freshness for an unsupported clock: %j', now => {
  expect(newYorkDate(now)).toBeNull();
  expect(snapshotFreshness('2026-09-25', now)).toEqual({ state: 'unknown', days: null });
});
it('uses the same future-session guard for the warning and portfolio as daily readiness', () => {
  const now = Date.parse('2026-09-26T02:00:00Z'), date = '2026-09-26';
  const rows = [{ entry_evidence: { as_of_date: date, calendar: { latest_completed_session: date,
    evaluated_at: '2026-09-26T01:00:00Z', valid_until: '2026-09-28T20:00:00Z' } } }];
  expect(sessionCurrent(rows, date, now)).toBe(false);
  expect(prepareSessionCurrent(rows, date)(now)).toBe(false);
  expect(buildPortfolioPlan(rows, date, 100000, now).blockers).toContain('分析基準日を最新の取引日と照合してください');
  expect(sessionCurrent(rows, date, Date.parse('2026-09-26T04:00:00Z'))).toBe(true);
});
it('ignores malformed calendar observations while retaining verified long closures', () => {
  const date = '2026-09-25', now = Date.parse('2026-10-02T12:00:00Z');
  const row = { entry_evidence: { as_of_date: date, calendar: { latest_completed_session: date,
    evaluated_at: '2026-09-25T21:00:00Z', valid_until: '2026-10-05T20:00:00Z' } } };
  const malformed = { entry_evidence: { as_of_date: date, calendar: { latest_completed_session: date,
    evaluated_at: { toString: 42 }, valid_until: ['2026-10-05'] } } };
  expect(prepareSessionCurrent([malformed], date)(now)).toBe(false);
  expect(sessionCurrent([malformed, row], date, now)).toBe(true);
  expect(prepareSessionCurrent([row], { toString: 42 })(now)).toBe(false);
});
