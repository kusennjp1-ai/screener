import { describe, expect, it, vi } from 'vitest';
import { projectFinancialRow } from './financialCurrent.js';

const day = 86400000;
const rowAt = (date = '2026-10-01', periods = ['2026-06-30', '2026-03-31']) => {
  const now = Date.parse(`${date}T12:00:00Z`);
  return { now, row: { symbol: 'TEST', market: 'US', as_of_date: date, eps_growth_qq: 0,
    financial_current: { v: 2, t: now, s: 'TEST', m: 'US', a: date, r: '0222222222222222',
      p: { 0: [0, '0', 'Diluted EPS', periods, now - 1, now + 1, 'u', 'r'] } } } };
};
const field = row => row.financial_current_state.fields.eps_growth_qq;

describe('financial calendar parse reuse', () => {
  it.each([
    ['1970-01-02', ['1970-01-01', '1969-10-01']],
    ['0000-04-01', ['0000-03-31', '0000-01-01']],
    ['2024-03-01', ['2024-02-29', '2023-11-30']],
  ])('preserves zero epochs, early years and leap days: %s', (date, periods) => {
    const { row, now } = rowAt(date, periods);
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(field(projectFinancialRow(row, { now }))).toMatchObject({ availability: 'current', value: 0, periods_used: periods });
    }
  });

  it.each([null, 0, {}, [], new Date('2026-06-30'), Object('2026-06-30'), '2026-02-30', '2026-13-01', '2026-6-30', '2026-06-30\n', 'x'.repeat(10000)].map((period, index) => [index, period]))('keeps malformed period case %i invalid after reuse', (_index, period) => {
    const { row, now } = rowAt();
    row.financial_current.p[0][3][0] = period;
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(field(projectFinancialRow(row, { now })).reason).toBe('invalid_reporting_period');
    }
  });

  it('does not coerce or retain decisions about a mutable period array', () => {
    const { row, now } = rowAt();
    const periods = row.financial_current.p[0][3];
    expect(field(projectFinancialRow(row, { now })).availability).toBe('current');
    periods[0] = { toString() { throw Error('Must not coerce a period'); } };
    expect(field(projectFinancialRow(row, { now })).reason).toBe('invalid_reporting_period');
    periods[0] = '2026-06-30';
    expect(field(projectFinancialRow(row, { now })).availability).toBe('current');
    periods.reverse();
    expect(field(projectFinancialRow(row, { now })).reason).toBe('invalid_reporting_period');
  });

  it.each([NaN, Infinity, -Infinity, 8640000000000000, 8640000000000001, -8640000000000000, -8640000000000001])('keeps invalid and TimeClip-edge evaluation contexts invalid: %s', now => {
    expect(field(projectFinancialRow(rowAt().row, { now })).reason).toBe('invalid_evaluation_context');
  });

  it('rechecks exact clocks and inclusive deadlines after warming the date cache', () => {
    const { row, now } = rowAt();
    projectFinancialRow(row, { now });
    for (const clock of [now + 1, now + 0.5, now, now - 1, now + 2, now]) {
      const result = projectFinancialRow(row, { now: clock });
      expect(result.financial_current_state.evaluated_at).toBe(clock);
      expect(field(result).reason).toBe(clock < now ? 'invalid_evaluation_context' : clock > now + 1 ? 'stale_source' : null);
    }
    const periodExpiry = Date.parse('2026-06-30') + 191 * day - 1;
    row.financial_current.t = periodExpiry;
    row.financial_current.p[0][4] = periodExpiry - 1;
    row.financial_current.p[0][5] = periodExpiry;
    expect(field(projectFinancialRow(row, { now: periodExpiry })).availability).toBe('current');
    expect(field(projectFinancialRow(row, { now: periodExpiry + 1 })).reason).toBe('stale_reporting_period');
  });

  it('bounds retained date strings while preserving answers after eviction', async () => {
    vi.resetModules();
    const { projectFinancialRow: freshProject } = await import('./financialCurrent.js');
    const { row, now } = rowAt();
    const parse = vi.spyOn(Date, 'parse');
    try {
      expect(field(freshProject(row, { now })).availability).toBe('current');
      parse.mockClear();
      expect(field(freshProject(row, { now })).availability).toBe('current');
      expect(parse.mock.calls).toHaveLength(0);
      for (let i = 0; i < 300; i++) {
        const input = rowAt().row;
        input.financial_current.p[0][3][0] = `invalid${String(i).padStart(3, '0')}`;
        expect(field(freshProject(input, { now })).reason).toBe('invalid_reporting_period');
      }
      parse.mockClear();
      expect(field(freshProject(row, { now })).availability).toBe('current');
      expect(parse.mock.calls.some(([value]) => value === '2026-06-30')).toBe(true);
    } finally { parse.mockRestore(); }
  });
});
