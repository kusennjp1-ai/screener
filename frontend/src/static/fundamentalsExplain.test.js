// The seams C owns and other tracks call: the conclusion's Code 33 chip (D) and the published SEC
// coverage block that useStockData (E) hands to secStatus; and secStatus's wording for each coverage state.
import { describe, expect, it } from 'vitest';
import { code33ChipView, earningsCaution, earningsChipView, fundamentalsCoverageWarning, publishedFundamentalsCoverage, secRowChip, secStatus, secSummary } from './fundamentalsExplain.js';
import { bookFinancialCurrent } from './bookFinancialCurrent.js';
import { bookFinancialEvidence } from './bookFinancialEvidence.js';
import { code33Layered } from './code33Reference.js';
import { secPoint, secRecord, secUnavailable } from '../test/fixtures/secRecord.js';
import { CONTRACT_DATE, SEC_SUMMARY_INVALID, secSummaryShape, secSummaryUnknown } from '../test/fixtures/publishedContracts.js';

const DATE = '2026-11-03';
const block = (extra = {}) => ({ schema_version: 'fundamentals-coverage-v1', as_of_date: DATE, sec_fetch_ran: true, sec_as_of: DATE, file_schema: 2, universe: 993, requested: 600,
  eligible: 1200, truncated: 0, deadline_unreached: 0, ticker_map_ok: true, admitted: 580, with_quarters: 540, not_requested: 393, not_fetched: 0, refused: 20, refused_by_reason: { cik_url: 20 }, ...extra });
const row = (extra = {}) => ({ symbol: 'AAA', market: 'US', as_of_date: DATE, book_financials: null, ...extra });

describe('code33ChipView', () => {
  const financial = (code33, sec = { state: 'ok' }, report = null) => ({ code33, sec, report });

  it('says 達成 in the zone tone and a known 未達 in the ext tone', () => {
    expect(code33ChipView(financial({ state: 'pass', source: 'sec' }))).toEqual({ text: 'Code 33 達成', tone: 'zone' });
    expect(code33ChipView(financial({ state: 'fail', source: 'sec' }))).toEqual({ text: 'Code 33 未達', tone: 'ext' });
  });

  it('says 読み込み中 while the detail loads and names why anything else stays unknown, never a pass', () => {
    expect(code33ChipView(financial({ state: 'unknown', source: null }, { state: 'detail_loading' }))).toEqual({ text: 'Code 33 読み込み中', tone: '' });
    expect(code33ChipView(financial(null, { state: 'not_published', short: 'SEC 未配信' }))).toEqual({ text: 'Code 33 未確認・SEC未配信', tone: '' });
    // Nothing known about the SEC record (no financial view at all): no reason is claimed.
    expect(code33ChipView(null)).toEqual({ text: 'Code 33 未確認', tone: '' });
    expect(code33ChipView({ code33: { state: 'unknown', source: null } })).toEqual({ text: 'Code 33 未確認', tone: '' });
    expect(code33ChipView(financial(null, { state: 'refused', short: 'SEC 不採用' }))).toEqual({ text: 'Code 33 未確認・SEC不採用', tone: '' });
    expect(code33ChipView(financial(null, { state: 'not_requested', short: 'SEC 今回未取得' }))).toEqual({ text: 'Code 33 未確認・SEC今回未取得', tone: '' });
    expect(code33ChipView(financial(null, { state: 'stale', latestEnd: '2026-03-31' }))).toEqual({ text: 'Code 33 未確認・古い', tone: '' });
    // The reason comes from the SEC report itself: the fiscal-Q4 EPS, fewer than 8 quarters, a gap.
    const report = record => bookFinancialEvidence(record, 'TEST', '2026-02-01');
    const tenQ = secRecord(); tenQ.quarterly.eps = tenQ.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
    tenQ.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    const young = secRecord({ quarters: [['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']] });
    const gap = secRecord(); for (const key of ['eps', 'revenue', 'netIncome']) gap.quarterly[key].splice(6, 1);
    gap.quarterly.eps.unshift(secPoint('eps', ['2023-10-01', '2023-12-31'], 1)); gap.quarterly.revenue.unshift(secPoint('revenue', ['2023-10-01', '2023-12-31'], 100)); gap.quarterly.netIncome.unshift(secPoint('netIncome', ['2023-10-01', '2023-12-31'], 10));
    for (const [record, word] of [[tenQ, 'Q4 EPS'], [young, '8期未満'], [gap, '欠け']]) {
      const value = report(record);
      expect(code33ChipView({ report: value, sec: { state: 'ok' }, code33: code33Layered(value, null, '2026-02-01') })).toEqual({ text: `Code 33 未確認・${word}`, tone: '' });
    }
  });

  it('marks a Yahoo reference judgement as （参考）', () => {
    expect(code33ChipView(financial({ state: 'pass', source: 'yahoo' }))).toEqual({ text: 'Code 33 達成（参考）', tone: 'zone' });
    expect(code33ChipView(financial({ state: 'fail', source: 'yahoo' }))).toEqual({ text: 'Code 33 未達（参考）', tone: 'ext' });
  });
});

describe('publishedFundamentalsCoverage', () => {
  it('reads the manifest entry block for this publication date only, and nothing else', () => {
    expect(publishedFundamentalsCoverage(null)).toBeNull();
    expect(publishedFundamentalsCoverage(null, { bundle: null })).toBeNull();
    expect(publishedFundamentalsCoverage({ as_of_date: DATE })).toBeNull();
    const entry = { as_of_date: DATE, fundamentals_coverage: block() };
    expect(publishedFundamentalsCoverage(entry, { bundle: { date: DATE } })).toBe(entry.fundamentals_coverage);
    // A block of another date (or a bundle of another date) is never read as today's.
    expect(publishedFundamentalsCoverage({ as_of_date: '2026-11-04', fundamentals_coverage: block() })).toBeNull();
    expect(publishedFundamentalsCoverage(entry, { bundle: { date: '2026-11-04' } })).toBeNull();
    // Malformed blocks and the old shape read as none.
    for (const broken of [{ listed: 993, sec_record: 0 }, block({ schema_version: 'x' }), block({ admitted: -1 }), block({ requested: 'many' }), block({ sec_fetch_ran: 'yes' }), block({ ticker_map_ok: 'no' })])
      expect(publishedFundamentalsCoverage({ as_of_date: DATE, fundamentals_coverage: broken })).toBeNull();
    // A block without the ticker-map field claims nothing about the map, and stays readable.
    const { ticker_map_ok: omitted, ...older } = block(); void omitted;
    expect(publishedFundamentalsCoverage({ as_of_date: DATE, fundamentals_coverage: older })).toBe(older);
  });
});

describe('secStatus with the publication coverage', () => {
  const status = (value, coverage, detail = 'loaded') => secStatus(value, null, { detail, coverage });

  it('tells a delivery failure of the whole publication apart from the stock, with the date and the published-row counts', () => {
    const notRun = status(row(), block({ sec_fetch_ran: false, sec_as_of: null, file_schema: null, requested: null, ticker_map_ok: null, admitted: 0, with_quarters: 0, refused: 0, refused_by_reason: {}, not_requested: 0, not_fetched: 993 }));
    expect(notRun).toMatchObject({ state: 'not_published', short: 'SEC 未配信', delivery: true,
      long: 'この公開（11/3分）では SEC 四半期データを反映していません（反映は公開993銘柄中0銘柄・配信側の問題で、業績の良し悪しではありません）。' });
    const oldSchema = status(row({ sec_admission: { state: 'refused', reason: 'schema' } }), block({ file_schema: 1, admitted: 0, with_quarters: 0, refused: 50, refused_by_reason: { schema: 50 }, not_requested: 943 }));
    expect(oldSchema.state).toBe('not_published');
    expect(oldSchema.long).toContain('配信側の問題で、業績の良し悪しではありません');
  });

  it('reads a missing SEC ticker map as a delivery failure, never as this stock having no CIK', () => {
    const noCik = row({ book_financials: secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_cik' }) });
    const failed = block({ ticker_map_ok: false, admitted: 600, with_quarters: 0, refused: 0, refused_by_reason: {}, not_requested: 393 });
    expect(status(noCik, failed)).toMatchObject({ state: 'not_published', delivery: true, long: 'この公開（11/3分）では SEC 四半期データを反映していません（反映は公開993銘柄中0銘柄・配信側の問題で、業績の良し悪しではありません）。' });
    expect(status(row(), failed)).toMatchObject({ state: 'not_published', delivery: true });
    // With the map, or without a block, no_cik is the stock's own fact.
    expect(status(noCik, block())).toMatchObject({ state: 'no_cik', short: 'SEC 対象外' });
    expect(status(noCik, null)).toMatchObject({ state: 'no_cik' });
  });

  it('says the stock was outside this fetch, with the published rows it included, and claims 対象 only for a requested stock', () => {
    const outside = status(row({ sec_admission: { state: 'not_requested', reason: null } }), block());
    expect(outside).toMatchObject({ state: 'not_requested', short: 'SEC 今回未取得', long: '今回の SEC 取得には含まれていません（取得は公開993銘柄中600銘柄）。' });
    expect(outside.long).not.toContain('対象');
    // The count is of published rows (admitted + refused), not of the input's records.
    expect(status(row({ sec_admission: { state: 'not_requested', reason: null } }), block({ requested: 1500 })).long).toBe('今回の SEC 取得には含まれていません（取得は公開993銘柄中600銘柄）。');
    // The detail's own state is real without a block; only the counts need it.
    expect(status(row({ sec_admission: { state: 'not_requested', reason: null } }), null)).toMatchObject({ state: 'not_requested', long: '今回の SEC 取得には含まれていません。' });
  });

  it('says a requested record was refused at verification and why', () => {
    const refused = status(row({ sec_admission: { state: 'refused', reason: 'cik_url' } }), block());
    expect(refused).toMatchObject({ state: 'refused', short: 'SEC 不採用', reason: 'cik_url', long: '取得対象でしたが、SEC の記録を検証できず不採用にしました（出典URLとCIK番号が一致しないため）。' });
    expect(status(row({ sec_admission: { state: 'refused', reason: 'series:eps' } }), block()).long).toContain('EPSの系列（提出日・期間・様式）を確かめられないため');
    expect(status(row({ sec_admission: { state: 'refused', reason: 'series:annualEps' } }), block()).long).toContain('年間EPSの系列（提出日・期間・様式）を確かめられないため');
    expect(status(row({ sec_admission: { state: 'refused', reason: 'projection' } }), block()).long).toContain('（公開時の整合確認で外れたため）');
    expect(status(row({ sec_admission: { state: 'refused', reason: null } }), block()).long).toContain('理由は記録されていません');
  });

  it('without a coverage block keeps today\'s wording minus the claim about who is fetched, and guesses no count', () => {
    const plain = status(row(), null);
    expect(plain).toMatchObject({ state: 'not_published', short: 'SEC 未配信', long: 'この銘柄の当日分の SEC 四半期データは配信されていません。' });
    expect(plain.long).not.toMatch(/対象|\d/);
    // The detail's own state still reads as such; loading and error stay what they were.
    expect(status(row(), block(), 'loading').state).toBe('detail_loading');
    expect(status(row(), block({ sec_fetch_ran: false }), 'error').state).toBe('detail_error');
  });

  it('keeps every record that arrived judged on its own, whatever the coverage says', () => {
    const record = secRecord({ symbol: 'AAA', asOfDate: '2026-02-01' }), value = row({ as_of_date: '2026-02-01', book_financials: record });
    const now = Date.parse('2026-02-01T12:00:00Z');
    expect(secStatus(value, bookFinancialCurrent(record, 'AAA', '2026-02-01', now, value), { detail: 'loaded', coverage: block({ sec_fetch_ran: false }) }).state).toBe('ok');
  });

  it('never promises a later reflection, in any state or coverage case', () => {
    // Every state secStatus can give, each with no block and with every kind of block.
    const date = '2026-02-01', now = Date.parse('2026-02-01T12:00:00Z');
    const judged = (record, detail = 'loaded', coverage = null, extra = {}) => {
      const value = row({ as_of_date: date, book_financials: record, ...extra });
      return secStatus(value, record ? bookFinancialCurrent(record, 'AAA', date, now, value) : null, { detail, coverage });
    };
    const stale = secRecord({ symbol: 'AAA', asOfDate: '2026-09-01' }), broken = secRecord({ symbol: 'AAA', asOfDate: date }); broken.quarterly.eps = [{ end: 'x' }]; broken.quarterly.revenue = [];
    const annualOnly = secRecord({ symbol: 'AAA', asOfDate: date }); annualOnly.status = 'partial'; annualOnly.quarterly.eps = []; annualOnly.quarterly.revenue = [];
    const coverages = [null, block(), block({ as_of_date: date, sec_as_of: date }), block({ sec_fetch_ran: false, sec_as_of: null, file_schema: null }), block({ file_schema: 1 }), block({ ticker_map_ok: false })];
    const results = [];
    for (const coverage of coverages) {
      results.push(judged(secRecord({ symbol: 'AAA', asOfDate: date }), 'loaded', coverage), judged(null, 'loaded', coverage), judged(null, 'loading', coverage), judged(null, 'error', coverage),
        judged(null, 'loaded', coverage, { sec_admission: { state: 'not_requested', reason: null } }),
        ...['schema', 'cik_url', 'series:eps', 'not_corporate', 'projection', null].map(reason => judged(null, 'loaded', coverage, { sec_admission: { state: 'refused', reason } })),
        ...['no_cik', 'no_companyfacts', 'no_quarterly', 'transient', 'invalid_payload'].map(reason => judged(secUnavailable({ symbol: 'AAA', asOfDate: date, reason, forms: reason === 'no_quarterly' ? ['20-F'] : undefined }), 'loaded', coverage)),
        judged(broken, 'loaded', coverage), judged(annualOnly, 'loaded', coverage),
        secStatus(row({ as_of_date: '2026-09-01', book_financials: stale }), bookFinancialCurrent(stale, 'AAA', '2026-09-01', Date.parse('2026-09-01T12:00:00Z'), row({ as_of_date: '2026-09-01', book_financials: stale })), { coverage }),
        secStatus({ symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF' }, null, { coverage }));
    }
    expect([...new Set(results.map(result => result.state))].sort()).toEqual(['detail_error', 'detail_loading', 'invalid', 'no_cik', 'no_companyfacts', 'no_quarterly', 'no_quarterly_values',
      'not_applicable', 'not_published', 'not_requested', 'ok', 'refused', 'stale', 'transient']);
    for (const result of results) for (const text of [result.short, result.long]) expect(text).not.toMatch(/今後|反映されます|次回|再取得/);
  });
});

// The round-2 seams other tracks call (plan §2.2), as step 0 leaves them: secSummary validates the published
// field, and the four views are null, so no screen shows anything new until the data track writes them.
describe('the round-2 seams at step 0', () => {
  it('secSummary returns the documented sec_summary as published, and null when it is absent or malformed', () => {
    expect(secSummary({ symbol: 'AAA', sec_summary: secSummaryShape })).toBe(secSummaryShape);
    // Unknown values stay null: the summary is valid and nothing is filled in.
    expect(secSummary({ symbol: 'AAA', sec_summary: secSummaryUnknown })).toBe(secSummaryUnknown);
    expect(secSummary({ symbol: 'AAA', sec_summary: { ...secSummaryShape, code33: { state: 'pass', kind: null } } })).not.toBeNull();
    // An older publication has no field: null (未収録), never an empty summary.
    for (const value of [null, undefined, {}, { symbol: 'AAA' }, { symbol: 'AAA', sec_summary: null }]) expect(secSummary(value)).toBeNull();
    expect(SEC_SUMMARY_INVALID.filter(([, value]) => secSummary({ symbol: 'AAA', sec_summary: value }) !== null).map(([why]) => why)).toEqual([]);
  });

  it('the row chip, the conclusion chip, the caution line and Today\'s coverage warning are null', () => {
    const report = bookFinancialEvidence(secRecord(), 'AAA', '2026-02-01');
    const financial = { report, sec: { state: 'ok' }, code33: { state: 'fail' } };
    expect(secRowChip({ symbol: 'AAA', sec_summary: secSummaryShape })).toBeNull();
    expect(secRowChip(null)).toBeNull();
    expect(earningsChipView(financial)).toBeNull();
    expect(earningsChipView(null)).toBeNull();
    expect(earningsCaution(financial)).toBeNull();
    expect(earningsCaution(null)).toBeNull();
    expect(fundamentalsCoverageWarning(block({ sec_fetch_ran: false, warnings: ['sec_fetch_skipped'] }), { date: CONTRACT_DATE })).toBeNull();
    expect(fundamentalsCoverageWarning(null, { date: DATE })).toBeNull();
  });
});
