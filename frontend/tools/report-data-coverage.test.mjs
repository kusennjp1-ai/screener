// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeResearchIndex } from '../src/static/researchTransport.js';
import { secPoint, secRecord, secUnavailable } from '../src/test/fixtures/secRecord.js';
import { briefRows, compareSecCarryForward, environmentCoverage, finalEnvironmentRow, fundamentalsCoverage, fundamentalsCoverageBlock, formatSecAdmission, publishedCoverage, runPublished, secAdmissionState, validFundamentalsCoverageBlock } from './report-data-coverage.mjs';

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

describe('the publication SEC coverage block and the published report', () => {
  const date = '2026-02-01', now = Date.parse('2026-02-01T12:00:00Z');
  const record = symbol => secRecord({ symbol, asOfDate: date });
  // A small publication: the listed rows' details (with their admission), the SEC input and the manifest block.
  async function bundle({ listed = 5, withRecord = 5, file = 'current', refusals = {}, block = true, schema = 2 } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'published-report-'));
    const symbols = Array.from({ length: listed }, (_, i) => `S${i}`), results = {}, states = [];
    const refusedSymbols = Object.entries(refusals).flatMap(([reason, n]) => Array.from({ length: n }, () => reason));
    for (const [i, symbol] of symbols.entries()) {
      const has = i < withRecord, reason = !has ? refusedSymbols[i - withRecord] : undefined;
      if (file && (has || reason)) results[symbol] = { ...record(symbol), schema_version: schema };
      const state = has ? { state: 'admitted', reason: null } : reason ? { state: 'refused', reason } : file ? { state: 'not_requested', reason: null } : { state: 'not_fetched', reason: 'no_file' };
      states.push({ symbol, ...state, status: has ? 'available' : null });
      await write(join(root, `static-data/research-details/${symbol}.json`), { symbol, market: 'US', as_of_date: date, book_financials: has ? results[symbol] : null, sec_admission: state });
    }
    const input = file ? { schema_version: schema, as_of_date: file === 'stale' ? '2026-01-30' : date, results, coverage: { eligible: listed + 3, requested: Object.keys(results).length, truncated: 3, deadline: { unreached: 0 } } } : null;
    if (input) await writeFile(join(root, 'static-data/book-financials.json.gz'), gzipSync(JSON.stringify(input)));
    const rows = symbols.map(symbol => ({ symbol, market: 'US', as_of_date: date, research_detail_path: `research-details/${symbol}.json` }));
    await write(join(root, 'static-data/research.json'), encodeResearchIndex({ as_of_date: date, financial_evaluated_at: now, rows }));
    const US = { as_of_date: date, assets: { research: { path: 'research.json' } }, ...(block ? { fundamentals_coverage: fundamentalsCoverageBlock({ file: input, asOfDate: date, states }) } : {}) };
    await write(join(root, 'static-data/manifest.json'), { markets: { US } });
    await write(join(root, 'qualification-audit.json'), { as_of_date: date, results: symbols.map(symbol => ({ symbol, methods: { minervini: { qualified: true, failed: 0, unknown: 0 } } })) });
    return root;
  }
  const published = async (root, args = [], env = {}) => { const lines = []; const code = await runPublished(['--published', '--root', root, ...args], { env, log: line => lines.push(line), now }); return { code, lines, text: lines.join('\n') }; };

  it('builds the block from the SEC input and every row, with unknown counts null, never 0', () => {
    const states = [{ symbol: 'A', state: 'admitted', reason: null, status: 'available' }, { symbol: 'B', state: 'admitted', reason: null, status: 'unavailable' },
      { symbol: 'C', state: 'refused', reason: 'cik_url' }, { symbol: 'D', state: 'not_requested', reason: null }];
    const file = { schema_version: 2, as_of_date: date, results: { A: {}, B: {}, C: {} } };
    const block = fundamentalsCoverageBlock({ file, asOfDate: date, states });
    expect(block).toEqual({ schema_version: 'fundamentals-coverage-v1', as_of_date: date, sec_fetch_ran: true, sec_as_of: date, file_schema: 2, universe: 4, requested: 3,
      eligible: null, truncated: null, deadline_unreached: null, admitted: 2, with_quarters: 1, not_requested: 1, not_fetched: 0, refused: 1, refused_by_reason: { cik_url: 1 } });
    expect(validFundamentalsCoverageBlock(block)).toBe(true);
    // No same-day input: nothing about the fetch is counted as zero.
    const none = fundamentalsCoverageBlock({ file: null, asOfDate: date, states: [{ symbol: 'A', state: 'not_fetched', reason: 'no_file' }] });
    expect(none).toMatchObject({ sec_fetch_ran: false, sec_as_of: null, file_schema: null, requested: null, eligible: null, admitted: 0, not_fetched: 1 });
    const stale = fundamentalsCoverageBlock({ file: { ...file, as_of_date: '2026-01-30' }, asOfDate: date, states: [{ symbol: 'A', state: 'not_fetched', reason: 'other_date' }] });
    expect(stale).toMatchObject({ sec_fetch_ran: false, sec_as_of: '2026-01-30', file_schema: 2, requested: null });
    expect(validFundamentalsCoverageBlock(undefined)).toBe(true);
    for (const broken of [{ ...block, admitted: 3 }, { ...block, extra: 1 }, { ...block, requested: -1 }, { ...block, refused_by_reason: { cik_url: 2 } }, { ...block, sec_as_of: '2026-01-30' }, null, []])
      expect(validFundamentalsCoverageBlock(broken)).toBe(false);
    expect(secAdmissionState({ file, asOfDate: date, symbol: 'Z', published: false })).toEqual({ state: 'not_requested', reason: null });
    expect(secAdmissionState({ file, asOfDate: date, symbol: 'C', published: false, refusal: 'cik_url' })).toEqual({ state: 'refused', reason: 'cik_url' });
    expect(secAdmissionState({ file: null, asOfDate: date, symbol: 'A', published: false })).toEqual({ state: 'not_fetched', reason: 'no_file' });
    expect(formatSecAdmission(date, { stage: 'export', file, admitted: 2, refused: { cik_url: 1 }, universe: 4 })).toBe(`SEC admission ${date} (export): file_schema 2, records 3, admitted 2 of 4, refused {"cik_url":1}`);
    expect(formatSecAdmission(date, { file: null, admitted: 0 })).toBe(`SEC admission ${date}: file_schema none, records 0, admitted 0, refused {}`);
  });

  it('warns on each condition, writes the summary table with 未計測 and never fails a build', async () => {
    const cases = [
      [{}, []],
      [{ withRecord: 3 }, ['SEC records cover 3/5 brief-listed rows (60.0%, below 80%)']],
      [{ withRecord: 0, file: null }, ['No brief-listed row carries an SEC record (0/5)', 'The SEC input file is absent (expected schema 2)']],
      [{ withRecord: 4, refusals: { not_corporate: 1 } }, []],
      [{ withRecord: 3, refusals: { cik_url: 1, 'series:eps': 1 } }, ['SEC records cover 3/5', 'SEC records refused at admission: cik_url 1, series:eps 1']],
      [{ withRecord: 0, refusals: { schema: 5 }, schema: 1 }, ['No brief-listed row carries an SEC record (0/5)', 'The SEC input file has schema 1, expected 2', 'SEC records refused at admission: schema 5']],
    ];
    for (const [options, expected] of cases) {
      const root = await bundle(options), summary = join(root, 'summary.md');
      try {
        await writeFile(summary, '');
        const result = await published(root, ['--json', join(root, 'report.json')], { GITHUB_STEP_SUMMARY: summary });
        expect(result.code).toBe(0);
        const warnings = result.lines.filter(line => line.startsWith('::warning::'));
        for (const text of expected) expect(warnings.some(line => line.includes(text)), `${JSON.stringify(options)}: ${text}`).toBe(true);
        if (!expected.length) expect(warnings).toEqual([]);
        const table = await readFile(summary, 'utf8');
        expect(table).toContain(`### Published fundamentals coverage ${date}`);
        expect(table).toContain('| brief-listed rows | 5 |');
        const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'));
        expect(report.coverage.listed).toBe(5);
        expect(Object.keys(report.records)).toHaveLength(options.withRecord ?? 5);
        if (options.file === null) expect(table).toContain('| records in the input for this date | 未計測 (eligible 未計測, truncated 未計測, deadline unreached 未計測) |');
        else expect(table).toContain('(eligible 8, truncated 3, deadline unreached 0)');
      } finally { await rm(root, { recursive: true, force: true }); }
    }
    // An input for another day is said so, and the block is checked against the details.
    const stale = await bundle({ withRecord: 0, file: 'stale', block: false });
    try { expect((await published(stale)).text).toContain('::warning::The SEC input file is for 2026-01-30, not for this publication (2026-02-01)'); }
    finally { await rm(stale, { recursive: true, force: true }); }
    // A missing bundle or an unreadable one is a warning, not a failure.
    const empty = await mkdtemp(join(tmpdir(), 'published-report-empty-'));
    try { expect(await published(empty)).toMatchObject({ code: 0, lines: ['::warning::Published fundamentals coverage unavailable: No published static-data bundle'] }); }
    finally { await rm(empty, { recursive: true, force: true }); }
  });

  it('says when a UI-only republish drops SEC coverage, and refuses it only when required and not allowed', async () => {
    const before = await bundle({ withRecord: 5 }), after = await bundle({ withRecord: 3 });
    try {
      const previous = join(before, 'report.json');
      await published(before, ['--json', previous]);
      expect(compareSecCarryForward(JSON.parse(await readFile(previous, 'utf8')), JSON.parse(await readFile(previous, 'utf8')))).toMatchObject({ comparable: true, before: 5, kept: 5, dropped: false });
      const diagnostic = await published(after, ['--previous', previous]);
      expect(diagnostic.code).toBe(0);
      expect(diagnostic.text).toContain('::warning::SEC coverage dropped from 5 to 3 against the given previous report');
      const required = await published(after, ['--previous', previous, '--require-sec-carry-forward']);
      expect(required.code).toBe(1);
      expect(required.text).toContain('::error::SEC coverage dropped from 5 to 3 in a UI-only republish (lost 2: S3 S4; changed 0)');
      const allowed = await published(after, ['--previous', previous, '--require-sec-carry-forward', '--allow-sec-coverage-drop']);
      expect(allowed.code).toBe(0);
      expect(allowed.text).toContain('::warning::SEC coverage dropped from 5 to 3 in a UI-only republish');
      // Unchanged records pass; a previous report of another publication date is not comparable and fails closed when required.
      expect((await published(before, ['--previous', previous, '--require-sec-carry-forward'])).text).toContain('SEC records carried forward unchanged in a UI-only republish: 5/5');
      const other = JSON.parse(await readFile(previous, 'utf8')); other.as_of_date = '2026-01-30'; await writeFile(previous, JSON.stringify(other));
      expect(await published(before, ['--previous', previous, '--require-sec-carry-forward'])).toMatchObject({ code: 1 });
      await writeFile(previous, JSON.stringify({ unavailable: 'boom' }));
      expect((await published(before, ['--previous', previous, '--require-sec-carry-forward'])).text).toContain('cannot be verified: boom');
    } finally { await rm(before, { recursive: true, force: true }); await rm(after, { recursive: true, force: true }); }
  });
});
