// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeResearchIndex } from '../src/static/researchTransport.js';
import { secPoint, secRecord, secUnavailable } from '../src/test/fixtures/secRecord.js';
import { briefRows, compareSecCarryForward, coverageWarnings, EPS_UNKNOWN_CAUSES, epsUnknownCauses, secEvidenceLine, SETUP_CONFIDENCE_FLOOR, environmentCoverage, finalEnvironmentRow, fundamentalsCoverage, fundamentalsCoverageBlock, formatSecAdmission, fundamentalsSummaryTable, invokedAsCommand, publishedCoverage, publishedFundamentalsReport, runPublished, secAdmissionState, secRefusalReason, validFundamentalsCoverageBlock } from './report-data-coverage.mjs';

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
      expect(report).toMatchObject({ as_of_date: date, listed: 6, sec_record: 5, with_quarters_listed: 4, tiles: { eps: 3, sales: 3, margin: 4 }, code33: { pass: 1, fail: 1, unknown: 4 },
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
  async function bundle({ listed = 5, withRecord = 5, file = 'current', refusals = {}, block = true, schema = 2, make = record, errors = undefined, unreached = 0 } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'published-report-'));
    const symbols = Array.from({ length: listed }, (_, i) => `S${i}`), results = {}, states = [];
    const refusedSymbols = Object.entries(refusals).flatMap(([reason, n]) => Array.from({ length: n }, () => reason));
    for (const [i, symbol] of symbols.entries()) {
      const has = i < withRecord, reason = !has ? refusedSymbols[i - withRecord] : undefined;
      if (file && (has || reason)) results[symbol] = { ...make(symbol), schema_version: schema };
      const state = has ? { state: 'admitted', reason: null } : reason ? { state: 'refused', reason } : file ? { state: 'not_requested', reason: null } : { state: 'not_fetched', reason: 'no_file' };
      states.push({ symbol, ...state, status: has ? results[symbol].status : null });
      // A current setup readiness on the first row, so these SEC cases do not also warn that readiness is unknown everywhere.
      const ready = i === 0 ? { se_setup_ready: true, setup_recalculation: { status: 'calculated', as_of_date: date } } : {};
      await write(join(root, `static-data/research-details/${symbol}.json`), { symbol, market: 'US', as_of_date: date, book_financials: has ? results[symbol] : null, sec_admission: state, ...ready });
    }
    const input = file ? { schema_version: schema, as_of_date: file === 'stale' ? '2026-01-30' : date, results, ...(errors ? { errors } : {}), coverage: { eligible: listed + 3, requested: Object.keys(results).length, truncated: 3, deadline: { unreached } } } : null;
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
      eligible: null, truncated: null, deadline_unreached: null, ticker_map_ok: null, admitted: 2, with_quarters: 1, not_requested: 1, not_fetched: 0, refused: 1, refused_by_reason: { cik_url: 1 }, warnings: ['refused'] });
    expect(validFundamentalsCoverageBlock(block)).toBe(true);
    // An older block without the warnings list stays valid; a list of unknown codes or repeats does not.
    expect(validFundamentalsCoverageBlock((({ warnings, ...rest }) => { void warnings; return rest; })(block))).toBe(true);
    for (const warnings of [['late'], ['refused', 'refused'], 'refused', null]) expect(validFundamentalsCoverageBlock({ ...block, warnings })).toBe(false);
    // The ticker map is known only from a file that lists its errors.
    expect(fundamentalsCoverageBlock({ file: { ...file, errors: [] }, asOfDate: date, states }).ticker_map_ok).toBe(true);
    expect(fundamentalsCoverageBlock({ file: { ...file, errors: ['SEC ticker map unavailable: URLError'] }, asOfDate: date, states }).ticker_map_ok).toBe(false);
    expect(fundamentalsCoverageBlock({ file: { ...file, as_of_date: '2026-01-30', errors: [] }, asOfDate: date, states: [] }).ticker_map_ok).toBeNull();
    // No same-day input: nothing about the fetch is counted as zero.
    const none = fundamentalsCoverageBlock({ file: null, asOfDate: date, states: [{ symbol: 'A', state: 'not_fetched', reason: 'no_file' }] });
    expect(none).toMatchObject({ sec_fetch_ran: false, sec_as_of: null, file_schema: null, requested: null, eligible: null, admitted: 0, not_fetched: 1 });
    const stale = fundamentalsCoverageBlock({ file: { ...file, as_of_date: '2026-01-30' }, asOfDate: date, states: [{ symbol: 'A', state: 'not_fetched', reason: 'other_date' }] });
    expect(stale).toMatchObject({ sec_fetch_ran: false, sec_as_of: '2026-01-30', file_schema: 2, requested: null });
    expect(validFundamentalsCoverageBlock(undefined)).toBe(true);
    // Each warning from the block's own counts, only for a same-day fetch; funds refused as not corporate are no warning.
    const clean = { ...block, refused: 0, refused_by_reason: {}, eligible: 3, truncated: 0, deadline_unreached: 0, ticker_map_ok: true };
    expect(coverageWarnings(clean)).toEqual([]);
    expect(coverageWarnings({ ...clean, refused: 2, refused_by_reason: { not_corporate: 2 } })).toEqual([]);
    expect(coverageWarnings({ ...clean, truncated: 5, deadline_unreached: 2, ticker_map_ok: false, file_schema: 1, refused: 1, refused_by_reason: { 'series:eps': 1 }, with_quarters: 0 }))
      .toEqual(['truncated', 'deadline_unreached', 'ticker_map_unavailable', 'file_schema', 'refused', 'no_quarters']);
    expect(coverageWarnings({ ...none })).toEqual([]);
    expect(none.warnings).toEqual([]);
    for (const broken of [{ ...block, admitted: 3 }, { ...block, extra: 1 }, { ...block, requested: -1 }, { ...block, refused_by_reason: { cik_url: 2 } }, { ...block, sec_as_of: '2026-01-30' }, null, [],
      { ...block, ticker_map_ok: 'yes' }, { ...none, ticker_map_ok: true }, (({ ticker_map_ok, ...rest }) => { void ticker_map_ok; return rest; })(block)])
      expect(validFundamentalsCoverageBlock(broken)).toBe(false);
    expect(secAdmissionState({ file, asOfDate: date, symbol: 'Z', published: false })).toEqual({ state: 'not_requested', reason: null });
    expect(secAdmissionState({ file, asOfDate: date, symbol: 'C', published: false, refusal: 'cik_url' })).toEqual({ state: 'refused', reason: 'cik_url' });
    expect(secAdmissionState({ file: null, asOfDate: date, symbol: 'A', published: false })).toEqual({ state: 'not_fetched', reason: 'no_file' });
    // A record admission accepted that the published row lost is never labelled as a wrong key set.
    expect(secAdmissionState({ file, asOfDate: date, symbol: 'C', published: false })).toEqual({ state: 'refused', reason: 'projection' });
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
        if (options.file === null) expect(table).toContain('| records in the input for this date | 未計測 (eligible 未計測, truncated 未計測, deadline unreached 未計測; ticker map 未計測) |');
        else expect(table).toContain('(eligible 8, truncated 3, deadline unreached 0; ticker map 未計測)');
        expect(table).toContain(`| with an SEC record / with SEC quarters | ${options.withRecord ?? 5} (`);
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

  it('warns when the admitted records carry no quarters: an SEC outage, the deadline, a missing ticker map', async () => {
    // Every requested listed row carries a transient record: sec_record is 5/5, the schema is 2 and nothing is refused.
    const outage = await bundle({ make: symbol => secUnavailable({ symbol, asOfDate: date, reason: 'transient', error: 'SEC deadline reached' }), unreached: 5 });
    try {
      const result = await published(outage, ['--json', join(outage, 'report.json')]);
      expect(result.code).toBe(0);
      const warnings = result.lines.filter(line => line.startsWith('::warning::'));
      expect(warnings).toEqual(['::warning::SEC quarters (available or partial records) cover 0/5 brief-listed rows (0.0%, below 80%)',
        '::warning::The SEC input holds 5 records for this date, but no published row carries SEC quarters (0/5)',
        '::warning::The SEC fetch ran out of its time budget: 5 symbols were not reached (transient, unknown)']);
      const report = JSON.parse(await readFile(join(outage, 'report.json'), 'utf8'));
      expect(report.coverage).toMatchObject({ listed: 5, sec_record: 5, sec_record_ratio: 1, with_quarters_listed: 0, with_quarters_ratio: 0 });
      expect(report.fundamentals_coverage).toMatchObject({ requested: 5, admitted: 5, with_quarters: 0, deadline_unreached: 5 });
    } finally { await rm(outage, { recursive: true, force: true }); }
    // No ticker map: every symbol is an admitted no_cik record, which is a delivery failure.
    const noMap = await bundle({ make: symbol => secUnavailable({ symbol, asOfDate: date, reason: 'no_cik', error: 'SEC識別子未取得' }), errors: ['SEC ticker map unavailable: URLError'] });
    try {
      const summary = join(noMap, 'summary.md'); await writeFile(summary, '');
      const result = await published(noMap, ['--json', join(noMap, 'report.json')], { GITHUB_STEP_SUMMARY: summary });
      expect(result.text).toContain('::warning::The SEC ticker map was unavailable');
      expect(JSON.parse(await readFile(join(noMap, 'report.json'), 'utf8')).fundamentals_coverage.ticker_map_ok).toBe(false);
      expect(await readFile(summary, 'utf8')).toContain('ticker map unavailable) |');
    } finally { await rm(noMap, { recursive: true, force: true }); }
  });

  it('names an observed reason when a record both admissions accepted is missing from the published row', () => {
    expect(secRefusalReason({ exported: { value: null, reason: 'cik_url' } })).toBe('cik_url');
    expect(secRefusalReason({ exported: { value: {}, reason: null }, overlay: { value: null, reason: 'retrieved_window' } })).toBe('retrieved_window');
    // Both accepted it: the final row's instrument says why (the projection nulls a non-corporate row's record), else a later step.
    expect(secRefusalReason({ exported: { value: {}, reason: null }, overlay: { value: {}, reason: null }, corporate: false })).toBe('not_corporate');
    expect(secRefusalReason({ exported: { value: {}, reason: null }, overlay: null, corporate: true })).toBe('projection');
  });

  it('runs as a command from a symlinked path with spaces, and titles the table it was asked to', async () => {
    const root = await mkdtemp(join(tmpdir(), 'report command '));
    try {
      const link = join(root, 'linked tools', 'report.mjs');
      await mkdir(dirname(link), { recursive: true });
      await symlink(fileURLToPath(new URL('./report-data-coverage.mjs', import.meta.url)), link);
      const json = join(root, 'out.json');
      const output = execFileSync(process.execPath, [link, '--published', '--root', join(root, 'empty'), '--json', json], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
      expect(output).toContain('::warning::Published fundamentals coverage unavailable: No published static-data bundle');
      expect(JSON.parse(await readFile(json, 'utf8'))).toEqual({ unavailable: 'No published static-data bundle' });
      expect(invokedAsCommand('file:///nowhere/report.mjs', ['node', link])).toBe(false);
      expect(invokedAsCommand(new URL('./report-data-coverage.mjs', import.meta.url).href, ['node', link])).toBe(true);
      expect(invokedAsCommand('file:///x.mjs', ['node'])).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
    const live = await bundle(), summary = join(live, 'summary.md');
    try {
      await writeFile(summary, '');
      await published(live, ['--label', 'live, before republish'], { GITHUB_STEP_SUMMARY: summary });
      expect(await readFile(summary, 'utf8')).toContain(`### Published fundamentals coverage ${date} (live, before republish)`);
    } finally { await rm(live, { recursive: true, force: true }); }
  });

  it('says when a UI-only republish drops SEC coverage, and refuses it only when required and not allowed', async () => {
    const before = await bundle({ withRecord: 5 }), after = await bundle({ withRecord: 3 });
    try {
      const previous = join(before, 'report.json');
      await published(before, ['--json', previous]);
      expect(compareSecCarryForward(JSON.parse(await readFile(previous, 'utf8')), JSON.parse(await readFile(previous, 'utf8')))).toMatchObject({ comparable: true, before: 5, kept: 5, dropped: false });
      const diagnostic = await published(after, ['--previous', previous]);
      expect(diagnostic.code).toBe(0);
      expect(diagnostic.text).toContain('::warning::SEC coverage dropped from 5 to 3 against the given previous report (lost 2: S3 S4; changed 0)');
      // The round-1 default for a UI-only republish: the drop is a warning, said as one, and the build goes on.
      const warned = await published(after, ['--previous', previous, '--ui-only-republish']);
      expect(warned.code).toBe(0);
      expect(warned.text).toContain('::warning::SEC coverage dropped from 5 to 3 in a UI-only republish (lost 2: S3 S4; changed 0)');
      // A previous report that cannot be read or compared is 未計測, a warning, never a pass and never a failure.
      const unreadable = await published(after, ['--previous', join(before, 'absent.json'), '--ui-only-republish']);
      expect(unreadable.code).toBe(0);
      expect(unreadable.text).toMatch(/::warning::SEC records of the replaced publication: 未計測 \(not compared: ENOENT/);
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

describe('round-2 measurements in the published report (plan DT4, DT9): diagnostic only, 未計測 when missing', () => {
  const date = '2026-02-01', now = Date.parse('2026-02-01T12:00:00Z');
  const tenQ = symbol => { const value = secRecord({ symbol }); value.quarterly.eps = value.quarterly.eps.filter(p => !p.end.endsWith('12-31')); value.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)]; return value; };

  it('names every cause behind an unknown EPS acceleration, independently of Code 33', async () => {
    const { bookFinancialEvidence } = await import('../src/static/bookFinancialEvidence.js');
    const causes = record => epsUnknownCauses(bookFinancialEvidence(record, record.symbol, date));
    expect(EPS_UNKNOWN_CAUSES).toEqual(['under_8_quarters', 'gap', 'latest_row_fiscal_q4_without_eps', 'fiscal_q4_untagged', 'prior_year_loss_or_zero', 'period_mismatch']);
    expect(causes(secRecord({ symbol: 'PASS' }))).toBeNull();
    expect(causes(tenQ('Q4'))).toEqual({ primary: 'latest_row_fiscal_q4_without_eps', all: ['latest_row_fiscal_q4_without_eps'] });
    expect(causes(secRecord({ symbol: 'YOUNG', quarters: [['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']] }))).toMatchObject({ primary: 'under_8_quarters' });
    const loss = secRecord({ symbol: 'LOSS' }); loss.quarterly.eps[0].value = -0.1;
    expect(causes(loss)).toMatchObject({ primary: 'prior_year_loss_or_zero' });
    const gap = secRecord({ symbol: 'GAP' }); for (const key of ['eps', 'revenue', 'netIncome']) gap.quarterly[key].splice(6, 1);
    gap.quarterly.eps.unshift(secPoint('eps', ['2023-10-01', '2023-12-31'], 1)); gap.quarterly.revenue.unshift(secPoint('revenue', ['2023-10-01', '2023-12-31'], 100)); gap.quarterly.netIncome.unshift(secPoint('netIncome', ['2023-10-01', '2023-12-31'], 10));
    expect(causes(gap)).toMatchObject({ primary: 'gap' });
    // A missing fiscal-Q4 row inside the window is an untagged fiscal Q4, never a gap.
    const quarters = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
      ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30']];
    const missing = secRecord({ symbol: 'MISS', asOfDate: '2026-11-04', quarters, eps: [1, 1, 1, 1, 1, 1.1, 1.2, 1.4, 1.8], revenue: [100, 100, 100, 100, 100, 110, 130, 160, 200], netIncome: [10, 10, 10, 10, 10, 11, 14, 19, 26] });
    for (const key of ['eps', 'revenue', 'netIncome']) missing.quarterly[key] = missing.quarterly[key].filter(p => p.end !== '2026-06-30');
    missing.annualEps = [secPoint('eps', ['2025-07-01', '2026-06-30'], 5, { form: '10-K', filed: '2026-08-20', accession: 'k-26' })];
    expect(epsUnknownCauses(bookFinancialEvidence(missing, 'MISS', '2026-11-04'))).toEqual({ primary: 'fiscal_q4_untagged', all: ['fiscal_q4_untagged'] });
  });

  it('counts readiness and its failed checks, the confidence floor, EPS unknowns, invalid payloads, gaps, Yahoo references, chart depth, the TT population, market fields, group rank and the list summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'published-round2-'));
    try {
      const bank = secRecord({ symbol: 'BANK' }); bank.quarterly.revenue = []; bank.derivation_gaps = [{ fiscal_year: 2025, metric: 'netIncome', reason: 'broken_chain' }];
      const yahoo = { symbol: 'YAHOO', as_of_date: date, status: 'available', basis: 'reported_diluted_eps', currency: 'USD', retrieved_at: '2026-02-01T08:00:00Z', annual: [],
        quarterly: [['2024-09-30', 1, 100, 10], ['2024-12-31', 1, 100, 10], ['2025-03-31', 1.1, 110, 12], ['2025-06-30', 1.2, 120, 13], ['2025-09-30', 1.3, 130, 15]].map(([end, eps, revenue, netIncome]) => ({ end, eps, revenue, netIncome })) };
      const cases = {
        PASS: { book_financials: secRecord({ symbol: 'PASS' }), se_setup_ready: true, setup_recalculation: { status: 'calculated', as_of_date: date }, se_pattern_confidence: 70, ibd_group_rank: 5, market_distribution_days: 3, market_ftd_date: '2025-12-01', se_pattern_primary: 'vcp' },
        Q4: { book_financials: tenQ('Q4'), se_setup_ready: false, setup_recalculation: { status: 'calculated', as_of_date: date, reason: 'not_implemented / outside_early_zone' }, se_pattern_confidence: 40 },
        BANK: { book_financials: bank, se_setup_ready: false, setup_recalculation: { status: 'calculated', as_of_date: date, reason: `not_implemented / ${'primary_pattern_below_confidence_floor'}` } },
        BAD: { book_financials: secUnavailable({ symbol: 'BAD', reason: 'invalid_payload', invalid_detail: { class: 'PayloadMismatch', message: 'm', requested_cik: 1, received_cik: 2 } }) },
        YAHOO: { book_financials: null, financial_history: yahoo },
      };
      const symbols = Object.keys(cases);
      const rowsOut = symbols.map((symbol, i) => ({ symbol, market: 'US', as_of_date: date, research_detail_path: `research-details/${symbol}.json`,
        technical_audit: { valid: i < 3, as_of_date: date, bars: [252, 300, 504][i] ?? 10 }, ...(cases[symbol].se_pattern_primary ? { se_pattern_primary: cases[symbol].se_pattern_primary } : {}),
        rs_line_high: i < 3 ? { value: i === 0 ? true : i === 1 ? false : null, leading: i === 0, as_of_date: date } : null,
        sec_summary: symbol === 'PASS' ? { sec_state: 'ok', eps_yoy: { value: 80, end: '2025-12-31' }, sales_yoy: { value: 100, end: '2025-12-31' }, code33: { state: 'pass', kind: null }, as_of_date: date } : null }));
      for (const [i, row] of rowsOut.entries()) await write(join(root, `static-data/${row.research_detail_path}`), { ...row, ...cases[symbols[i]] });
      await write(join(root, 'static-data/research.json'), encodeResearchIndex({ as_of_date: date, financial_evaluated_at: now, rows: rowsOut }));
      await write(join(root, 'static-data/market-trends/series.json'), { long_history: { breadth: [{ date: '2026-01-30', trendTemplateCount: 9 }, { date, trendTemplateCount: 3 }] } });
      await write(join(root, 'static-data/manifest.json'), { markets: { US: { as_of_date: date, market_context: null, assets: { research: { path: 'research.json' }, market_trends: { path: 'market-trends/series.json' } } } } });
      await write(join(root, 'qualification-audit.json'), { as_of_date: date, results: symbols.map(symbol => ({ symbol, methods: { minervini: { qualified: true, failed: 0, unknown: 0 } } })) });
      const report = await publishedCoverage({ root, now });
      expect(report.round2).toMatchObject({
        setup_readiness: { pass: 1, fail: 2, unknown: 2, top_failed_checks: [['not_implemented', 2], ['outside_early_zone', 1], ['primary_pattern_below_confidence_floor', 1]] },
        setup_confidence: { floor: SETUP_CONFIDENCE_FLOOR, below_floor: 1, missing: 3, floor_check_named: 1 },
        eps_unknown: { with_current_report: 1, primary: { latest_row_fiscal_q4_without_eps: 1 }, fiscal_q4_share: 1 },
        invalid_payload: { count: 1, by_cause: { cik_mismatch: 1 }, symbols: ['BAD'] },
        gaps: { derivation_gaps: { 'netIncome:broken_chain': 1 }, empty_revenue: 1 },
        without_sec: { rows: 2, yahoo_tile: 1, latest_period_age_days: { p50: 124, max: 124 }, older_than_190_days: 0 },
        chart_depth: { charts: 3, bars: { p10: 252, p50: 300, p90: 504 }, weeks: { p10: 50, p50: 60, p90: 100 } },
        tt_population: { long_history_tt: 3, listed_qualified: 5 },
        market_fields: { rows_with_distribution_days: 1, rows_with_ftd_date: 1, market_context: 'null' },
        group_rank: { filled: 1, listed: 5, as_of_fields: [] },
        list_summaries: { rs_line_high: { rows: 5, certified: 3, value_true: 1, value_unknown: 1, leading_true: 1 }, sec_summary: { rows: 5, admitted: 1, eps_yoy: 1, sales_yoy: 1 }, se_pattern_primary: 1 },
      });
      expect(report.round2.chart_depth.window).toMatchObject({ producer: null, period: expect.stringMatching(/^\d+(y|mo)$/) });
      // Code 33 counts SEC results only: the Yahoo-only 未達 (a falling Yahoo margin) is unknown there and a reference apart.
      expect(report).toMatchObject({ code33: { pass: 1, fail: 0, unknown: 4 }, code33_reference: { pass: 0, fail: 1 }, code33_unknown_reason: { yahoo: 1, q4_eps: 1 } });
      // The warnings: readiness measured and passing nowhere is not this case (one passes); the listed population exceeds the long history's.
      const lines = []; await runPublished(['--published', '--root', root], { env: {}, log: line => lines.push(line), now });
      expect(lines.some(line => line.startsWith('::warning::The brief lists 5 trend-template qualified rows, more than the long history\'s 3'))).toBe(true);
      expect(lines.some(line => line.includes('Setup readiness passes on 0'))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps the round-1 coverage when a round-2 measurement throws on a row shape the fixtures lack, and says so', async () => {
    const root = await mkdtemp(join(tmpdir(), 'published-round2-throws-'));
    try {
      // A derivation gap that is not an object: the round-2 gap count cannot read it.
      const odd = { ...secRecord({ symbol: 'ODD' }), derivation_gaps: [null] };
      const cases = { ODD: { book_financials: odd }, FINE: { book_financials: secRecord({ symbol: 'FINE' }), se_setup_ready: true, setup_recalculation: { status: 'calculated', as_of_date: date } } };
      const rowsOut = Object.keys(cases).map(symbol => ({ symbol, market: 'US', as_of_date: date, research_detail_path: `research-details/${symbol}.json` }));
      for (const row of rowsOut) await write(join(root, `static-data/${row.research_detail_path}`), { ...row, ...cases[row.symbol] });
      await write(join(root, 'static-data/research.json'), encodeResearchIndex({ as_of_date: date, financial_evaluated_at: now, rows: rowsOut }));
      await write(join(root, 'static-data/manifest.json'), { markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' } } } } });
      await write(join(root, 'qualification-audit.json'), { as_of_date: date, results: rowsOut.map(({ symbol }) => ({ symbol, methods: { minervini: { qualified: true, failed: 0, unknown: 0 } } })) });
      const report = await publishedCoverage({ root, now });
      // Round 1 counted both rows (the SEC record of each, the readiness of FINE).
      expect(report).toMatchObject({ listed: 2, sec_record: 2, setup_ready: { pass: 1 } });
      expect(report.round2).toEqual({ unavailable: expect.stringMatching(/null/) });
      const lines = []; const code = await runPublished(['--published', '--root', root], { env: {}, log: line => lines.push(line), now });
      expect(code).toBe(0);
      expect(lines.some(line => line.startsWith('::warning::Round-2 coverage measurements unavailable: '))).toBe(true);
      const table = fundamentalsSummaryTable(await publishedFundamentalsReport({ root, now }));
      expect(table).toContain('| brief-listed rows | 2 |');
      expect(table).toMatch(/\| round-2 measurements \| 未計測 \(/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('tallies why a setup was not recalculated and warns when the Setup Engine returned no complete report for more than 1% of the listed rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'published-round2-unavailable-'));
    try {
      const cases = {
        OK: { se_setup_ready: true, setup_recalculation: { status: 'calculated', as_of_date: date } },
        ERR: { setup_recalculation: { status: 'unavailable', as_of_date: date, reason: 'Setup Engine did not return a complete report' } },
        SPY: { setup_recalculation: { status: 'unavailable', as_of_date: date, reason: 'SPY benchmark unavailable; benchmark-dependent setup and RS remain unknown' } },
      };
      const rowsOut = Object.keys(cases).map(symbol => ({ symbol, market: 'US', as_of_date: date, research_detail_path: `research-details/${symbol}.json` }));
      for (const row of rowsOut) await write(join(root, `static-data/${row.research_detail_path}`), { ...row, book_financials: null, ...cases[row.symbol] });
      await write(join(root, 'static-data/research.json'), encodeResearchIndex({ as_of_date: date, financial_evaluated_at: now, rows: rowsOut }));
      await write(join(root, 'static-data/manifest.json'), { markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' } } } } });
      await write(join(root, 'qualification-audit.json'), { as_of_date: date, results: rowsOut.map(({ symbol }) => ({ symbol, methods: { minervini: { qualified: true, failed: 0, unknown: 0 } } })) });
      const report = await publishedCoverage({ root, now });
      expect(report.round2.setup_readiness).toMatchObject({ pass: 1, unknown: 2, incomplete_report: 1,
        not_calculated: [['unavailable: SPY benchmark unavailable; benchmark-dependent setup and RS remain unknown', 1], ['unavailable: Setup Engine did not return a complete report', 1]] });
      const lines = []; await runPublished(['--published', '--root', root], { env: {}, log: line => lines.push(line), now });
      expect(lines.some(line => line.startsWith('::warning::Setup Engine returned no complete report for 1 of 3 brief-listed rows (above 1%'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reads an older publication without the new fields as 未計測, and prints the SEC evidence line of the file on request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'published-older-'));
    try {
      const rowsOut = [{ symbol: 'OLD', market: 'US', as_of_date: date, research_detail_path: 'research-details/OLD.json' }];
      await write(join(root, 'static-data/research-details/OLD.json'), { ...rowsOut[0], book_financials: null, se_setup_ready: false, setup_recalculation: { status: 'calculated', as_of_date: date, reason: 'not_implemented' } });
      await write(join(root, 'static-data/research.json'), encodeResearchIndex({ as_of_date: date, financial_evaluated_at: now, rows: rowsOut }));
      await write(join(root, 'static-data/manifest.json'), { markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' } } } } });
      await write(join(root, 'qualification-audit.json'), { as_of_date: date, results: [{ symbol: 'OLD', methods: { minervini: { qualified: true, failed: 0, unknown: 0 } } }] });
      const file = { schema_version: 2, as_of_date: date, coverage: { eligible: 1, requested: 1 }, results: { OLD: secUnavailable({ symbol: 'OLD', reason: 'invalid_payload' }) } };
      await writeFile(join(root, 'static-data/book-financials.json.gz'), gzipSync(JSON.stringify(file)));
      const report = await publishedCoverage({ root, now });
      expect(report.round2).toMatchObject({ tt_population: { long_history_tt: null }, market_fields: { market_context: 'absent' }, list_summaries: { rs_line_high: null, sec_summary: null, se_pattern_primary: null },
        chart_depth: { charts: 0, bars: null, weeks: null }, eps_unknown: { fiscal_q4_share: null } });
      const lines = []; const code = await runPublished(['--published', '--root', root, '--sec-evidence'], { env: {}, log: line => lines.push(line), now });
      expect(code).toBe(0);
      expect(lines).toContain(secEvidenceLine(file));
      expect(secEvidenceLine(file)).toBe(`SEC evidence ${date} (published file): {"eligible":1,"requested":1,"records":1,"invalid_payload_by_cause":{"unrecorded":1},"derivation_gaps":{}}; first invalid_payload symbols OLD`);
      // Measured but all failing readiness is a warning; the table says 未計測 for what is missing.
      expect(lines.some(line => line.startsWith('::warning::Setup readiness passes on 0 of 1 brief-listed rows (fail 1, unknown 0; top failed checks: not_implemented 1)'))).toBe(true);
      // Readiness unknown on every listed row is a data failure too, worded apart.
      await write(join(root, 'static-data/research-details/OLD.json'), { ...rowsOut[0], book_financials: null });
      const unknown = []; await runPublished(['--published', '--root', root], { env: {}, log: line => unknown.push(line), now });
      expect(unknown).toContain('::warning::Setup readiness unknown on all 1 brief-listed rows (未計測)');
      expect(unknown.some(line => line.includes('Setup readiness passes on 0'))).toBe(false);
      expect(secEvidenceLine(null)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
