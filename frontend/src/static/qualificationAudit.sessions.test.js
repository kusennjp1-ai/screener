import { describe, it, expect } from 'vitest';
import calendarFixture from './__fixtures__/nyse-sessions-2024-2026.json';
import { auditDailyBars, auditValues, rankVerifiedUniverse, AUDIT_VERSION, RS_METHOD } from './qualificationAudit.js';
import { assess, researchCsv } from './researchEngine.js';

const date = calendarFixture.as_of_date;
function fixture(dates = calendarFixture.sessions.slice(-502), symbol = 'TEST', slope = .12) {
  const bars = dates.map((date, i) => {
    const close = 50 + i * slope;
    return { date, open: close, close, high: close + .1, low: close - .1, volume: 1000000 };
  });
  const row = { symbol, market: 'US', currency: 'USD', current_price: bars.at(-1)?.close, rs_rating: 99,
    rs_method: RS_METHOD, rs_universe_size: 100, rs_as_of_date: date };
  return { row, payload: { symbol, as_of_date: date, bars, session_calendar: structuredClone(calendarFixture) } };
}
function audit(f) { f.row.technical_audit = auditDailyBars(f.row, f.payload, date); return f.row.technical_audit; }
function expectUnknown(f) {
  const result = audit(f);
  expect(result.valid).toBe(false);
  expect(result.status).toBe('unknown');
  expect(result.values).toEqual({});
  const assessment = assess(f.row);
  expect(assessment.qualified).toBe(false);
  expect(assessment.failed).toBe(0);
  expect(assessment.unknown).toBe(9);
  expect(rankVerifiedUniverse([f.row])[0].rs_rating).toBeNull();
}

describe('independent exchange-session qualification guard', () => {
  it('accepts actual holiday gaps, special closure and complete date-aligned bars', () => {
    expect(calendarFixture.sessions).not.toContain('2025-01-09'); // Carter national day of mourning
    expect(calendarFixture.sessions).not.toContain('2025-12-25');
    expect(calendarFixture.sessions).toContain('2025-11-28'); // shortened session is still a session
    const f = fixture();
    expect(audit(f).valid).toBe(true);
    expect(assess(f.row).qualified).toBe(true);
  });
  it('rejects one missing middle session even with more than 252 observations', () => {
    const f = fixture(); f.payload.bars.splice(260, 1);
    expectUnknown(f);
    expect(f.row.technical_audit.errors.join(' ')).toContain('欠損');
  });
  it('rejects the 253 alternate-weekday / 704-day false positive and CSV pass', () => {
    const weekdays = [];
    for (let t = Date.parse('2024-11-11'); weekdays.length < 505; t += 86400000) {
      if (![0, 6].includes(new Date(t).getUTCDay())) weekdays.push(new Date(t).toISOString().slice(0, 10));
    }
    const f = fixture(weekdays.filter((_, i) => i % 2 === 0));
    expect(f.payload.bars).toHaveLength(253);
    expectUnknown(f);
    const csv = researchCsv([{ row: f.row }], 'minervini', date);
    expect(csv).toContain('"false"');
    expect(csv).toContain('"unknown"');
    expect(csv).not.toContain('"pass"');
  });
  it('rejects alternate actual sessions as well, without relying on holiday extras', () => {
    const f = fixture(calendarFixture.sessions.filter((_, i) => i % 2 === (calendarFixture.sessions.length - 1) % 2));
    expectUnknown(f);
    expect(f.row.technical_audit.status).toBe('unknown');
  });
  it.each([
    ['absent', p => delete p.session_calendar],
    ['wrong market', p => p.session_calendar.market = 'JP'],
    ['wrong exchange', p => p.session_calendar.exchange = 'XTKS'],
    ['price-derived', p => p.session_calendar.provider = 'SPY dates'],
    ['unknown version', p => p.session_calendar.provider_version = null],
    ['stale date', p => p.session_calendar.as_of_date = '2026-10-15'],
    ['uncovered start', p => p.session_calendar.range_start = '2026-01-01'],
    ['duplicate session', p => p.session_calendar.sessions.splice(50, 0, p.session_calendar.sessions[50])],
    ['misordered session', p => p.session_calendar.sessions.reverse()],
  ])('keeps %s calendar evidence unknown', (_label, mutate) => {
    const f = fixture(); mutate(f.payload); expectUnknown(f);
    expect(f.row.technical_audit.status).toBe('unknown');
  });
  it('does not call pre-IPO sessions missing, but short IPO history stays unqualified', () => {
    const f = fixture(calendarFixture.sessions.slice(-100));
    expectUnknown(f);
    expect(f.row.technical_audit.errors.join(' ')).toContain('新規上場');
    expect(f.row.technical_audit.errors.join(' ')).not.toContain('欠損');
    expect(f.payload.bars).toHaveLength(100);
  });
  it('accepts a younger listing once its complete 52-week and SMA history exists', () => {
    const f = fixture(calendarFixture.sessions.slice(-280));
    expect(audit(f).valid).toBe(true);
  });
  it('bounds extremes by 52 calendar weeks, excluding older lows in the last 252 bars', () => {
    const f = fixture();
    const from = '2025-10-17';
    const old = f.payload.bars.find(b => b.date === '2025-10-16');
    expect(f.payload.bars.slice(-252)).toContain(old);
    old.low = 1;
    const result = audit(f);
    expect(result.valid).toBe(true);
    expect(result.window_52w.from).toBe(from);
    expect(result.values.low).toBe(Math.min(...f.payload.bars.filter(b => b.date >= from).map(b => b.low)));
    expect(result.values.low).not.toBe(1);
    expect(result.window_52w.observations).not.toBe(252);
  });
  it('includes the exact 52-week boundary date and its intraday high and low', () => {
    const f = fixture(), boundary = f.payload.bars.find(b => b.date === '2025-10-17');
    boundary.low = 7; boundary.high = 700;
    const result = audit(f);
    expect(result.valid).toBe(true);
    expect(result.values.low).toBe(7); expect(result.values.high).toBe(700);
  });
  it.each([
    ['date shifted', f => f.payload.bars[200].date = '2025-07-05'],
    ['last date', f => f.payload.bars.pop()],
    ['price', f => f.row.current_price += 1],
    ['malformed OHLCV', f => f.payload.bars[200] = null],
  ])('rejects %s without manufacturing alignment', (_label, mutate) => {
    const f = fixture(); mutate(f);
    expect(() => audit(f)).not.toThrow();
    expect(f.row.technical_audit.valid).toBe(false);
    expect(assess(f.row).qualified).toBe(false);
  });
  it('excludes each incomplete or legacy observation from RS population and ratings', () => {
    const rows = Array.from({ length: 100 }, (_, i) => { const f = fixture(undefined, `S${i}`, .1 + i * .001); audit(f); return f.row; });
    expect(rankVerifiedUniverse(rows).at(-1).rs_rating).toBe(99);
    rows[0].technical_audit = { ...rows[0].technical_audit, version: 'ohlcv-v1' };
    expect(auditValues(rows[0])).toEqual({});
    const ranked = rankVerifiedUniverse(rows);
    expect(ranked.every(r => r.rs_universe_size === 99 && r.rs_rating === null)).toBe(true);
    expect(AUDIT_VERSION).not.toBe('ohlcv-v1');
  });
  it('keeps missing prices unknown', () => {
    const f = fixture(); f.payload.bars = [];
    expectUnknown(f);
    expect(f.row.technical_audit.status).toBe('unknown');
  });
});
