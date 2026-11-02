// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { environmentCoverage, fundamentalsCoverage } from './report-data-coverage.mjs';

describe('data coverage report', () => {
  it('counts same-day SEC evidence and history, and never treats stale or missing inputs as known', () => {
    const daily = { as_of_date: '2026-10-02', candidates: { minervini: [{ symbol: 'AAA' }, { symbol: 'BBB' }], minervini2: [{ symbol: 'AAA' }, { symbol: 'CCC' }] } };
    const sec = { as_of_date: '2026-10-01', results: { AAA: { status: 'available' } } };
    const report = fundamentalsCoverage({ daily, sec, history: null, now: Date.parse('2026-10-03T00:00:00Z') });
    expect(report.candidates).toBe(3);
    expect(report.sec.same_day).toBe(false);
    expect(report.sec.missing).toBe(3);
    expect(report.code33).toEqual({ sec: 0, yahoo: 0, unknown: 3 });
    expect(report.unknown_symbols).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('reports how many recent sessions carry each environment field', () => {
    const breadth = [{ date: 'd1', trendTemplateCount: 3, stage2: null }, { date: 'd2', trendTemplateCount: null, stage2: 4 }];
    const report = environmentCoverage({ as_of_date: 'd2', breadth });
    expect(report.last).toBe('d2');
    expect(report.present.trendTemplateCount).toBe('1/2');
    expect(report.present.stage2).toBe('1/2');
    expect(report.present.leaderCohort).toBe('0/2');
  });
});
