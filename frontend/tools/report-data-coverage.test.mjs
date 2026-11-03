// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { briefRows, environmentCoverage, finalEnvironmentRow, fundamentalsCoverage } from './report-data-coverage.mjs';

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

  it('adds the brief rows from a same-day audit and ignores a stale one', () => {
    const row = (symbol, minervini) => ({ symbol, methods: { minervini } });
    const audit = { as_of_date: '2026-10-30', results: [row('NEAR', { qualified: false, failed: 1, unknown: 0 }), row('QUAL', { qualified: true, failed: 0, unknown: 0 }),
      row('OPEN', { qualified: false, failed: 1, unknown: 2 }), row('FAR', { qualified: false, failed: 3, unknown: 0 })] };
    expect(briefRows(audit, '2026-10-30')).toEqual(['QUAL', 'NEAR']);
    expect(briefRows(audit, '2026-10-31')).toEqual([]);
    const coverage = fundamentalsCoverage({ daily: { as_of_date: '2026-10-30', candidates: { minervini: [{ symbol: 'QUAL' }] } }, sec: null, history: null, audit });
    expect(coverage.candidates).toBe(2);
    expect(coverage.code33.unknown).toBe(2);
  });

  it('reports how many recent sessions carry each environment field', () => {
    const breadth = [{ date: 'd1', trendTemplateCount: 3, stage2: null }, { date: 'd2', trendTemplateCount: null, stage2: 4 }];
    const report = environmentCoverage({ as_of_date: 'd2', breadth });
    expect(report.last).toBe('d2');
    expect(report.present.trendTemplateCount).toBe('1/2');
    expect(report.present.stage2).toBe('1/2');
    expect(report.present.leaderCohort).toBe('0/2');
  });

  it('prints the final row values, keeping absent keys, nulls and small samples distinct from zero', () => {
    const current = { date: 'd2', coverage: 4536, above50Percent: 43.1, above200: 1948, above200Percent: 42.9, trendTemplateCount: 619, rs90TemplateCount: 249,
      stage1: 1000, stage2: 1200, stage3: 900, stage4: 1436, breakoutsJudged: 4, breakoutsHeld: 0, leaderCohort: 600, leaderCohortAbove50: 450 };
    const report = finalEnvironmentRow({ breadth: [{ date: 'd1' }, current] });
    expect(report.date).toBe('d2');
    expect(report.values).toEqual({ breakoutsJudged: 4, breakoutsHeld: 0, leaderCohort: 600, leaderCohortAbove50: 450, trendTemplateCount: 619, rs90TemplateCount: 249, above50Percent: 43.1, above200Percent: 42.9 });
    expect(report.missing_environment_keys).toEqual([]);
    // Four judged breakouts are below the screens' minimum sample: the rate stays unknown, not 0%.
    expect(report.derived.breakoutHoldPercent).toBeNull();
    expect(report.derived.leaderHealthPercent).toBe(75);
    const legacy = finalEnvironmentRow({ breadth: [{ date: 'd2', coverage: 4428, above50: 1758, above50Percent: 39.7, newHighs: 141, newLows: 217, leaderCount: 632 }] });
    expect(legacy.values).toEqual({ breakoutsJudged: 'absent', breakoutsHeld: 'absent', leaderCohort: 'absent', leaderCohortAbove50: 'absent', trendTemplateCount: 'absent', rs90TemplateCount: 'absent', above50Percent: 39.7, above200Percent: 'absent' });
    expect(legacy.missing_environment_keys).toEqual(['trendTemplateCount', 'rs90TemplateCount', 'above200', 'above200Percent', 'stage1', 'stage2', 'stage3', 'stage4']);
    expect(legacy.derived).toEqual({ breakoutHoldPercent: null, leaderHealthPercent: null });
    const insufficient = finalEnvironmentRow({ breadth: [{ ...current, breakoutsJudged: null, breakoutsHeld: null, leaderCohort: null, leaderCohortAbove50: null }] });
    expect(insufficient.values.breakoutsJudged).toBeNull();
    expect(insufficient.derived).toEqual({ breakoutHoldPercent: null, leaderHealthPercent: null });
    expect(finalEnvironmentRow(null)).toEqual({ date: null, values: null, missing_environment_keys: null, derived: null });
    expect(finalEnvironmentRow({ breadth: [] }).values).toBeNull();
  });
});
