import { expect, it, vi } from 'vitest';
import { evidenceTimestamp, newYorkDate, validClock, validEvidenceDay } from './evidenceTime';
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

it('keeps primitive caches equivalent across eviction, invalid dates and input types', () => {
  const dayOracle = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const inputs = [null, undefined, {}, [], 0, NaN, '2026-02-30', '2024-02-29', '2026-02-29', 'not a date', ' '.repeat(100), '2026-10-16T03:59:59.999Z'];
  for (let day = 0; day < 600; day++) inputs.push(new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString().slice(0, 10));
  for (const value of [...inputs, ...inputs.slice().reverse(), ...inputs]) {
    expect(validEvidenceDay(value)).toBe(dayOracle(value));
    expect(evidenceTimestamp(value)).toBe(typeof value === 'string' ? Date.parse(value) : NaN);
  }
});
it('preserves Date time-clip validation including fractional and boundary clocks', () => {
  for (const value of [undefined, null, '', '0', [], {}, NaN, Infinity, -Infinity, 0, -0, .9, -.9, 8640000000000000, -8640000000000000, 8640000000000001, -8640000000000001]) {
    expect(validClock(value)).toBe(typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()));
  }
});
it('does not round or reuse the day across midnight, DST or clock rollback', () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  const clocks = ['2026-10-16T03:59:59.999Z', '2026-10-16T04:00:00.000Z', '2026-03-08T06:59:59.999Z', '2026-03-08T07:00:00.000Z', '2026-11-01T05:59:59.999Z', '2026-11-01T06:00:00.000Z'].map(Date.parse);
  for (const now of [...clocks, ...clocks.slice().reverse()]) {
    expect(newYorkDate(now)).toBe(formatter.format(now));
    expect(newYorkDate(now)).toBe(formatter.format(now));
    expect(newYorkDate(NaN)).toBeNull();
    expect(newYorkDate(now)).toBe(formatter.format(now));
  }
});

it('reuses primitive parsing and ICU formatting for repeated exact inputs', () => {
  const parse = vi.spyOn(Date, 'parse');
  const format = vi.spyOn(Intl.DateTimeFormat.prototype, 'format', 'get');
  try {
    for (let repeat = 0; repeat < 100; repeat++) {
      expect(evidenceTimestamp('1987-01-17T12:34:56.789Z')).toBe(537885296789);
      expect(validEvidenceDay('1987-01-17')).toBe(true);
      expect(newYorkDate(537885296789)).toBe('1987-01-17');
    }
    expect(parse).toHaveBeenCalledTimes(2);
    expect(format).toHaveBeenCalledTimes(1);
  } finally {
    parse.mockRestore(); format.mockRestore();
  }
});
