// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeResearchIndex } from '../src/static/researchTransport.js';
import { secPoint, secRecord, secUnavailable } from '../src/test/fixtures/secRecord.js';
import { briefRows, environmentCoverage, fundamentalsCoverage, publishedCoverage } from './report-data-coverage.mjs';

const write = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); };

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

  it('counts what the published details carry for every brief-listable row', async () => {
    const date = '2026-02-01', now = Date.parse('2026-02-01T12:00:00Z');
    const root = await mkdtemp(join(tmpdir(), 'published-coverage-'));
    try {
      const filer = secRecord({ symbol: 'Q4EPS' });
      filer.quarterly.eps = filer.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
      filer.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
      const falling = secRecord({ symbol: 'FALL', netIncome: [12, 11, 10, 9, 13.2, 14.3, 16, 18] });
      const details = { PASS: secRecord({ symbol: 'PASS' }), Q4EPS: filer, FALL: falling, YOUNG: secRecord({ symbol: 'YOUNG', quarters: [['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']] }),
        FPI: secUnavailable({ symbol: 'FPI', reason: 'no_quarterly', forms: ['20-F'] }), NONE: null };
      const rows = Object.keys(details).map(symbol => ({ symbol, market: 'US', as_of_date: date, research_detail_path: `research-details/${symbol}.json` }));
      for (const row of rows) await write(join(root, 'static-data', row.research_detail_path), { ...row, book_financials: details[row.symbol] });
      await write(join(root, 'static-data/research.json'), encodeResearchIndex({ as_of_date: date, rows: [...rows, { symbol: 'NOTLISTED', market: 'US', as_of_date: date }] }));
      await write(join(root, 'static-data/manifest.json'), { markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' } } } } });
      const audit = row => ({ symbol: row, methods: { minervini: { qualified: true, failed: 0, unknown: 0 } } });
      await write(join(root, 'qualification-audit.json'), { as_of_date: date, results: [...Object.keys(details).map(audit), { symbol: 'NOTLISTED', methods: { minervini: { qualified: false, failed: 3, unknown: 0 } } }] });
      const report = await publishedCoverage({ root, now });
      expect(report).toMatchObject({ as_of_date: date, listed: 6, sec_record: 5, tiles: { eps: 3, sales: 3, margin: 4 }, code33: { pass: 1, fail: 1, unknown: 4 },
        code33_unknown_reason: { q4_eps: 1, few_quarters: 1, gap: 0, stale: 0, no_sec: 2, other: 0 }, listed_without_sec: ['NONE'] });
      expect(report.sec_state).toMatchObject({ ok: 4, no_quarterly: 1, not_published: 1 });
    } finally { await rm(root, { recursive: true, force: true }); }
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
