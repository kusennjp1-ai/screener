// The seams C owns and other tracks call: the conclusion's Code 33 chip (D) and the published SEC
// coverage block that useStockData (E) hands to secStatus; and secStatus's wording for each coverage state.
import { describe, expect, it } from 'vitest';
import { buildSecSummary, chipQuarter, code33ChipView, code33Explain, COVERAGE_WARNINGS, earningsCaution, earningsChipView, EARNINGS_CHIP_NOTE, EARNINGS_CHIP_PERCENT, fundamentalsCoverageWarning, fundamentalTiles, meetsEarningsChipPercent, publishedFundamentalsCoverage, quarterReason, secRowChip, secStatus, secSummary, secSummaryCurrent, wholePercent } from './fundamentalsExplain.js';
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

  it('says 達成 in the zone tone and a known 未達 plainly in the neutral tone (Code 33 is a bonus, never a gate)', () => {
    expect(code33ChipView(financial({ state: 'pass', source: 'sec' }))).toEqual({ text: 'Code 33 達成', tone: 'zone' });
    expect(code33ChipView(financial({ state: 'fail', source: 'sec' }))).toEqual({ text: 'Code 33 未達', tone: '' });
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

  it('marks a Yahoo reference judgement as （参考） and never colours it: Yahoo alone is never a pass', () => {
    expect(code33ChipView(financial({ state: 'pass', source: 'yahoo' }))).toEqual({ text: 'Code 33 達成（参考）', tone: '' });
    expect(code33ChipView(financial({ state: 'fail', source: 'yahoo' }))).toEqual({ text: 'Code 33 未達（参考）', tone: '' });
    expect(code33Explain(null, { state: 'no_quarterly' }, { state: 'pass', source: 'yahoo', label: '参考：Yahoo四半期値' })).toMatchObject({ kind: 'yahoo', text: expect.stringContaining('参考判定です') });
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
    expect([...new Set(results.map(result => result.state))].sort()).toEqual(['detail_error', 'detail_loading', 'invalid', 'invalid_payload', 'no_cik', 'no_companyfacts', 'no_quarterly', 'no_quarterly_values',
      'not_applicable', 'not_published', 'not_requested', 'ok', 'refused', 'stale', 'transient']);
    for (const result of results) for (const text of [result.short, result.long]) expect(text).not.toMatch(/今後|反映されます|次回|再取得/);
  });
});

// The review probe of a turnaround: EPS 1.00 a quarter in 2023, a loss of −0.20 in 2024 and a profit again in 2025
// (+0.30 to +0.50), with sales +40% in 2025. The 2024 quarters have a rate (−120%); the 2025 ones have none (loss base).
const TWELVE = [2023, 2024, 2025].flatMap(year => [['01-01', '03-31'], ['04-01', '06-30'], ['07-01', '09-30'], ['10-01', '12-31']].map(([a, b]) => [`${year}-${a}`, `${year}-${b}`]));
const turnaroundRecord = (symbol = 'TEST') => secRecord({ symbol, quarters: TWELVE, eps: [1, 1, 1, 1, -0.2, -0.2, -0.2, -0.2, 0.3, 0.35, 0.4, 0.5],
  revenue: [100, 100, 100, 100, 100, 100, 100, 100, 140, 140, 140, 140], netIncome: [10, 10, 10, 10, -2, -2, -2, -2, 3, 3.5, 4, 5] });

// The round-2 seams other tracks call (plan §2.2): secSummary validates the published field; buildSecSummary
// writes it; the row chip, the conclusion chip, the caution line and Today's coverage warning read it (DT7).
describe('the round-2 seams', () => {
  it('secSummary returns the documented sec_summary as published, and null when it is absent or malformed', () => {
    expect(secSummary({ symbol: 'AAA', sec_summary: secSummaryShape })).toBe(secSummaryShape);
    // Unknown values stay null: the summary is valid and nothing is filled in.
    expect(secSummary({ symbol: 'AAA', sec_summary: secSummaryUnknown })).toBe(secSummaryUnknown);
    expect(secSummary({ symbol: 'AAA', sec_summary: { ...secSummaryShape, code33: { state: 'pass', kind: null } } })).not.toBeNull();
    // An older publication has no field: null (未収録), never an empty summary.
    for (const value of [null, undefined, {}, { symbol: 'AAA' }, { symbol: 'AAA', sec_summary: null }]) expect(secSummary(value)).toBeNull();
    expect(SEC_SUMMARY_INVALID.filter(([, value]) => secSummary({ symbol: 'AAA', sec_summary: value }) !== null).map(([why]) => why)).toEqual([]);
  });

  const date = '2026-02-01', now = Date.parse('2026-02-01T12:00:00Z');
  const published = (record, extra = {}) => row({ as_of_date: date, book_financials: record, ...extra });
  it('buildSecSummary writes the card\'s numbers from the admitted record only, and validates as published', () => {
    const value = buildSecSummary(published(secRecord({ symbol: 'AAA' })), { date, now });
    expect(value).toEqual({ sec_state: 'ok', eps_yoy: { value: expect.closeTo(80, 6), end: '2025-12-31' }, sales_yoy: { value: expect.closeTo(100, 6), end: '2025-12-31' }, code33: { state: 'pass', kind: null }, as_of_date: date });
    expect(secSummary({ sec_summary: value })).toBe(value);
    // The EPS rate is the tile's: the newest quarter with a value, with its own period (a fiscal-Q4 EPS only in the 10-K falls back).
    const tenQ = secRecord({ symbol: 'AAA' }); tenQ.quarterly.eps = tenQ.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
    tenQ.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    const q4 = buildSecSummary(published(tenQ), { date, now });
    const report = bookFinancialEvidence(tenQ, 'AAA', date);
    expect(q4.eps_yoy).toEqual({ value: expect.closeTo(40, 6), end: '2025-09-30' });
    expect(fundamentalTiles(report)[0].value).toBe('+40%');
    expect(q4.code33).toEqual({ state: 'unknown', kind: 'q4_eps' });
    // Only the newest quarter (or that fiscal-Q4 exception): an EPS rate two quarters back is not written as the latest.
    const older = secRecord({ symbol: 'AAA' }); older.quarterly.eps = older.quarterly.eps.filter(p => p.end < '2025-09-30');
    expect(buildSecSummary(published(older), { date, now })).toMatchObject({ eps_yoy: null, sales_yoy: { value: expect.closeTo(100, 6), end: '2025-12-31' } });
    // A turnaround (a loss a year earlier, a profit now) is a fact, never a rate: eps_yoy stays null, never the year-old fall.
    expect(buildSecSummary(published(turnaroundRecord('AAA')), { date, now })).toMatchObject({ eps_yoy: null, sales_yoy: { value: expect.closeTo(40, 6), end: '2025-12-31' } });
    // No record, a stale record or an unavailable one: nothing is summarised as a value, and the state says why.
    expect(buildSecSummary(published(null), { date, now })).toBeNull();
    const stale = secRecord({ symbol: 'AAA', asOfDate: '2026-09-01' });
    expect(buildSecSummary(published(stale, { as_of_date: '2026-09-01' }), { date: '2026-09-01', now: Date.parse('2026-09-01T12:00:00Z') })).toEqual({ sec_state: 'stale', eps_yoy: null, sales_yoy: null, code33: null, as_of_date: '2026-09-01' });
    expect(buildSecSummary(published(secUnavailable({ symbol: 'AAA', asOfDate: date, reason: 'invalid_payload' })), { date, now })).toMatchObject({ sec_state: 'invalid_payload', eps_yoy: null, code33: null });
    // A Yahoo history never enters the SEC summary.
    const history = { symbol: 'AAA', as_of_date: date, status: 'available', quarterly: [{ end: '2025-12-31', eps: 9 }] };
    expect(buildSecSummary(published(null, { financial_history: history }), { date, now })).toBeNull();
  });

  it('secRowChip: the facts with each period, green only when both reach the 独自設定 level, 未確認 with its reason, nothing for an older publication', () => {
    expect(EARNINGS_CHIP_PERCENT).toBe(25);
    const chip = summary => secRowChip({ symbol: 'AAA', market: 'US', as_of_date: CONTRACT_DATE, sec_summary: summary });
    const both = (eps, sales, epsEnd = '2026-06-30', salesEnd = '2026-06-30') => ({ ...secSummaryShape, eps_yoy: eps === null ? null : { value: eps, end: epsEnd }, sales_yoy: sales === null ? null : { value: sales, end: salesEnd } });
    expect(chip(both(40, 100))).toEqual({ text: 'EPS +40%・売上 +100%（26-06期）', tone: 'zone', title: expect.stringContaining('独自設定'), notable: true });
    expect(chip(both(40, 100, '2026-03-31'))).toMatchObject({ text: 'EPS 26-03 +40%・売上 26-06 +100%', tone: 'zone' });
    expect(chip(both(-35, 100, '2026-03-31'))).toMatchObject({ text: 'EPS 26-03 −35%・売上 26-06 +100%', tone: '', notable: true });
    expect(chip(both(25, 25))).toMatchObject({ tone: 'zone', notable: true });
    // The colour follows the printed whole percent: +25% is green wherever it reads +25%, and ±0% is not a fall.
    expect(chip(both(24.6, 100))).toMatchObject({ text: 'EPS +25%・売上 +100%（26-06期）', tone: 'zone', notable: true });
    expect(chip(both(24.4, 100))).toMatchObject({ text: 'EPS +24%・売上 +100%（26-06期）', tone: '', notable: false });
    expect(chip(both(-0.3, 10))).toMatchObject({ text: 'EPS ±0%・売上 +10%（26-06期）', tone: '', notable: false });
    // One quarter apart (the fiscal-Q4 exception, as on ZZNV) stays green; two quarters or more apart is grey and not notable,
    // and a year-old EPS rate beside today's sales never makes the chip green (the export writes none; a summary that did is still not).
    expect(chip(both(100, 40, '2025-12-31'))).toMatchObject({ text: 'EPS 25-12 +100%・売上 26-06 +40%', tone: '', notable: false });
    expect(chip(both(100, 40, '2025-06-30'))).toMatchObject({ tone: '', notable: false });
    // A falling EPS is notable, in the neutral tone, with U+2212.
    expect(chip(both(-35, 10))).toEqual({ text: 'EPS −35%・売上 +10%（26-06期）', tone: '', title: expect.any(String), notable: true });
    expect(chip(both(-35, null))).toMatchObject({ text: 'EPS −35%（26-06期）・売上 未確認', notable: true });
    expect(chip(both(30, null))).toMatchObject({ text: 'EPS +30%（26-06期）・売上 未確認', tone: '', notable: false });
    // Nothing known: 業績 未確認 in grey with the reason in the title, never 0%.
    expect(chip(secSummaryUnknown)).toEqual({ text: '業績 未確認', tone: '', title: expect.stringContaining('180日'), notable: false });
    expect(chip(both(null, null))).toMatchObject({ text: '業績 未確認', title: expect.stringContaining('どちらも確認できません') });
    expect(chip(null)).toMatchObject({ text: '業績 未確認', title: 'この公開にはこの銘柄の SEC 記録がありません。' });
    // A summary outside the documented shape is refused by the quality gate before it can publish: no chip, never a guess.
    expect(chip({ ...secSummaryShape, eps_yoy: { value: '40', end: '2026-06-30' } })).toBeNull();
    expect(secRowChip({ symbol: 'AAA', sec_summary: { sec_state: 'ok' } })).toBeNull();
    // With the screen's clock, a summary whose latest quarter is past the 180-day rule is 古い (as the stock view says); without it, as exported.
    const late = Date.parse('2026-12-28T00:00:00Z'), inTime = Date.parse('2026-12-27T23:59:00Z');
    expect(secRowChip({ symbol: 'AAA', market: 'US', as_of_date: CONTRACT_DATE, sec_summary: both(40, 100) }, { now: late })).toEqual({ text: '業績 未確認', tone: '', title: '古い：直近の四半期（2026-06期）から180日を超えているため判定に使いません。', notable: false });
    expect(secRowChip({ symbol: 'AAA', market: 'US', as_of_date: CONTRACT_DATE, sec_summary: both(40, 100) }, { now: inTime })).toMatchObject({ tone: 'zone' });
    expect(chip({ ...secSummaryShape, as_of_date: '2026-10-01' })).toMatchObject({ text: '業績 未確認', title: 'SEC の業績要約が別の日付のものです。' });
    // The analysis date the rows pass dates a row without its own as_of_date (research index rows carry none).
    expect(secRowChip({ symbol: 'AAA', market: 'US', sec_summary: { ...secSummaryShape, as_of_date: '2026-10-01' } }, { date: CONTRACT_DATE })).toMatchObject({ text: '業績 未確認', title: 'SEC の業績要約が別の日付のものです。' });
    // secSummaryCurrent is the chip's predicate: the summary when the chip reads it as current, else null.
    const row = summary => ({ symbol: 'AAA', market: 'US', sec_summary: summary });
    expect(secSummaryCurrent(row(both(40, 100)), { date: CONTRACT_DATE, now: inTime })).toEqual(both(40, 100));
    expect(secSummaryCurrent(row(both(40, 100)), { date: CONTRACT_DATE })).toEqual(both(40, 100));
    for (const [value, options] of [[both(40, 100), { date: CONTRACT_DATE, now: late }], [{ ...both(40, 100), as_of_date: '2026-10-01' }, { date: CONTRACT_DATE }], [null, { date: CONTRACT_DATE }], [{ sec_state: 'ok' }, {}]]) {
      expect(secSummaryCurrent(row(value), options)).toBeNull();
    }
    expect(secSummaryCurrent({ symbol: 'AAA' })).toBeNull();
    expect(secSummaryCurrent({ symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF', quoteType: 'ETF', sec_summary: both(40, 100) }, { date: CONTRACT_DATE })).toBeNull();
    // Each point is judged on its own quarter: in the fiscal-Q4 exception the EPS quarter (25-09) is one older than sales (25-12),
    // so 202 days after it the EPS point is null (未確認) while the sales point is still current, and the chip is not green.
    const q4 = row(both(40, 30, '2025-09-30', '2025-12-31')), april = Date.parse('2026-04-20T00:00:00Z');
    expect(secSummaryCurrent(q4, { date: CONTRACT_DATE, now: april })).toEqual({ ...both(40, 30, '2025-09-30', '2025-12-31'), eps_yoy: null });
    expect(secRowChip(q4.sec_summary && { ...q4, as_of_date: CONTRACT_DATE }, { now: april })).toEqual({ text: 'EPS 未確認・売上 +30%（25-12期）', tone: '', title: expect.any(String), notable: false });
    // Within both quarters' 180 days, both points read as current.
    expect(secSummaryCurrent(q4, { date: CONTRACT_DATE, now: Date.parse('2026-03-01T00:00:00Z') })).toEqual(both(40, 30, '2025-09-30', '2025-12-31'));
    // The one 25% comparison the chip and the rows' EPS filter share: as printed (24.6 reads +25%).
    expect([24.4, 24.5, 24.6, 25, null, undefined, NaN].map(meetsEarningsChipPercent)).toEqual([false, true, true, true, false, false, false]);
    // An older publication has no field: no chip (未収録), never 未確認 claimed for this day.
    expect(secRowChip({ symbol: 'AAA', as_of_date: CONTRACT_DATE })).toBeNull();
    expect(secRowChip(null)).toBeNull();
    // A fund is out of scope, not unknown.
    expect(secRowChip({ symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF', quoteType: 'ETF', sec_summary: null })).toMatchObject({ text: '業績 対象外', tone: '' });
    for (const value of [both(40, 100), both(-35, 10), both(-0.3, 10), secSummaryUnknown, null]) expect(chip(value).text).not.toMatch(/[^\d]-\d|(^|[^\d.±])0%|あと0/);
    // The 独自設定 rule in words for a screen's notes (a phone never shows the title).
    expect(EARNINGS_CHIP_NOTE).toBe('業績チップ：EPS・売上の前年同期比がともに25%以上で緑（独自設定）。');
  });

  it('earningsChipView: the stock\'s own SEC facts with each period, or 業績 未確認 with the reason in the Code 33 chip\'s words', () => {
    const report = bookFinancialEvidence(secRecord(), 'TEST', date);
    expect(earningsChipView({ report, sec: { state: 'ok' }, code33: { state: 'pass' } })).toEqual({ text: 'EPS +80%・売上 +100%（25-12期）', tone: 'zone', title: expect.stringContaining('独自設定') });
    // The fiscal-Q4 exception: the Q4 EPS is only in the 10-K, so the EPS rate is the quarter before, named by its period.
    const tenQ = secRecord(); tenQ.quarterly.eps = tenQ.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
    tenQ.annualEps = [secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    expect(earningsChipView({ report: bookFinancialEvidence(tenQ, 'TEST', date), sec: { state: 'ok' } })).toMatchObject({ text: 'EPS 25-09 +40%・売上 25-12 +100%', tone: 'zone' });
    // Without that 10-K the missing Q4 EPS is not the exception: the September rate is not today's, so EPS is 未確認 and grey.
    tenQ.annualEps = [];
    expect(earningsChipView({ report: bookFinancialEvidence(tenQ, 'TEST', date), sec: { state: 'ok' } })).toMatchObject({ text: 'EPS 未確認・売上 +100%（25-12期）', tone: '' });
    // A year-old +100% EPS beside today's +40% sales is never green: EPS reported through 2024-12 only.
    const yearOld = secRecord({ eps: [1, 1, 1, 1, 2, 2, 2, 2], revenue: [100, 100, 100, 100, 140, 140, 140, 140] });
    yearOld.quarterly.eps = yearOld.quarterly.eps.filter(p => p.end < '2025-01-01');
    yearOld.quarterly.eps.push(...[['2023-01-01', '2023-03-31'], ['2023-04-01', '2023-06-30'], ['2023-07-01', '2023-09-30'], ['2023-10-01', '2023-12-31']].map(period => secPoint('eps', period, 0.5)));
    yearOld.quarterly.eps.sort((a, b) => a.end < b.end ? -1 : 1);
    const stale = bookFinancialEvidence(yearOld, 'TEST', date);
    expect(stale.rows.find(row => row.end === '2024-12-31').epsYoY).toBeCloseTo(100, 6);
    expect(earningsChipView({ report: stale, sec: { state: 'ok' } })).toMatchObject({ text: 'EPS 未確認・売上 +40%（25-12期）', tone: '' });
    // The review probe: a turnaround is said as 黒字転換 for the newest quarter, never a year-old fall.
    const turned = earningsChipView({ report: bookFinancialEvidence(turnaroundRecord(), 'TEST', date), sec: { state: 'ok' } });
    expect(turned).toMatchObject({ text: 'EPS 黒字転換・売上 +40%（25-12期）', tone: '' });
    expect(turned.title).toContain('25-12期に黒字転換（前年同期 −0.20 → 0.50）');
    expect(turned.text).not.toMatch(/120|24-12/);
    // A bank (no revenue concept): 売上 対象外, as its card says, never 未確認.
    const bank = secRecord(); bank.quarterly.revenue = [];
    expect(earningsChipView({ report: bookFinancialEvidence(bank, 'TEST', date), sec: { state: 'ok' } }).text).toBe('EPS +80%（25-12期）・売上 対象外');
    // A valid report without either year-ago base: the newest quarter's reason in the tile's words.
    const four = secRecord({ quarters: [['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']], eps: [1, 1.1, 1.2, 1.3], revenue: [100, 110, 120, 130], netIncome: [10, 11, 12, 13] });
    expect(earningsChipView({ report: bookFinancialEvidence(four, 'TEST', date), sec: { state: 'ok' } })).toMatchObject({ text: '業績 未確認・前年同期なし', title: '2025-12期：EPS 前年同期の値なし・売上 前年同期の値なし' });
    expect(earningsChipView({ report: null, sec: { state: 'stale', short: '古い', long: '…' } })).toMatchObject({ text: '業績 未確認・古い', tone: '' });
    expect(earningsChipView({ report: null, sec: { state: 'not_published', short: 'SEC 未配信' } }).text).toBe('業績 未確認・SEC未配信');
    expect(earningsChipView({ report: null, sec: { state: 'invalid_payload', short: 'SEC 検証不可' } }).text).toBe('業績 未確認・SEC検証不可');
    expect(earningsChipView({ report: null, sec: { state: 'detail_loading' } }).text).toBe('業績 読み込み中');
    expect(earningsChipView({ report: null, sec: { state: 'not_applicable' } }).text).toBe('業績 対象外');
    // A Yahoo history alone never makes the chip.
    expect(earningsChipView({ report: null, sec: { state: 'no_quarterly', short: '四半期報告なし' }, history: { valid: true, epsYoY: 50, salesYoY: 50 } }).text).toBe('業績 未確認・四半期報告なし');
    expect(earningsChipView(null)).toBeNull();
  });

  it('earningsCaution: one line only for a falling latest EPS or a loss quarter, from SEC only', () => {
    const date2 = '2026-02-01';
    const withEps = eps => bookFinancialEvidence(secRecord({ eps }), 'TEST', date2);
    expect(earningsCaution({ report: withEps([1, 1, 1, 1, 1.1, 1.2, 1.4, 0.65]) })).toEqual({ text: '業績：直近EPS −35%（25-12期・SEC）' });
    expect(earningsCaution({ report: withEps([1, 1, 1, 1, 1.1, 1.2, 1.4, -0.5]) })).toEqual({ text: '業績：25-12期は赤字（EPS −0.50・SEC）' });
    expect(earningsCaution({ report: withEps([1, 1, 1, 1, 1.1, 1.2, 1.4, 1.8]) })).toBeNull();
    // A fall that prints ±0% is not a fall.
    expect(earningsCaution({ report: withEps([1, 1, 1, 1, 1.1, 1.2, 1.4, 0.997]) })).toBeNull();
    // The review probe: the newest quarter is a turnaround, so the 2024 −120% is not 直近 and no caution is shown.
    expect(earningsCaution({ report: bookFinancialEvidence(turnaroundRecord(), 'TEST', date2) })).toBeNull();
    // A fall or a loss two quarters back is not the latest: no caution (the newest quarter's EPS is unreported).
    const older = secRecord({ eps: [1, 1, 1, 1, 1.1, -0.5, 0.65, 1.8] }); older.quarterly.eps = older.quarterly.eps.filter(p => p.end < '2025-09-30');
    expect(earningsCaution({ report: bookFinancialEvidence(older, 'TEST', date2) })).toBeNull();
    // The fiscal-Q4 exception: Q4 EPS only in the 10-K, so the September quarter's fall is the latest known.
    const q4 = secRecord({ eps: [1, 1, 1, 1, 1.1, 1.2, 0.65, 1.8] }); q4.quarterly.eps = q4.quarterly.eps.filter(p => p.end !== '2025-12-31');
    q4.annualEps = [secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    expect(earningsCaution({ report: bookFinancialEvidence(q4, 'TEST', date2) })).toEqual({ text: '業績：直近EPS −35%（25-09期・SEC）' });
    expect(earningsCaution({ report: null, history: { valid: true, epsYoY: -50 } })).toBeNull();
    expect(earningsCaution(null)).toBeNull();
  });

  it('chipQuarter reads the newest quarter only, one quarter back for a fiscal Q4 whose value is only in the 10-K; wholePercent is the printed number', () => {
    const row = (end, extra) => ({ end, fiscalQ4: false, epsYoY: null, epsYoYReason: 'not_reported', salesYoY: null, salesYoYReason: 'not_reported', ...extra });
    const sept = row('2025-09-30', { epsYoY: 40, epsYoYReason: null }), june = row('2025-06-30', { epsYoY: 30, epsYoYReason: null });
    expect(chipQuarter([june, sept, row('2025-12-31', { epsYoY: 10, epsYoYReason: null })], 'epsYoY')).toMatchObject({ value: 10, end: '2025-12-31', index: 2 });
    expect(chipQuarter([june, sept, row('2025-12-31', { fiscalQ4: true })], 'epsYoY')).toMatchObject({ value: 40, end: '2025-09-30', index: 1 });
    expect(chipQuarter([june, sept, row('2025-12-31')], 'epsYoY')).toBeNull();
    expect(chipQuarter([june, row('2025-12-31', { fiscalQ4: true })], 'epsYoY')).toBeNull();
    expect(chipQuarter([june, sept, row('2025-12-31', { fiscalQ4: true, epsYoYReason: 'nonpositive_base' })], 'epsYoY')).toBeNull();
    expect(chipQuarter([], 'epsYoY')).toBeNull();
    expect([24.5, 24.4, -0.3, -0.5, -35.5, 0, Number.NaN, null].map(wholePercent)).toEqual([25, 24, 0, -1, -36, 0, null, null]);
    expect(Object.is(wholePercent(-0.3), 0)).toBe(true);
  });

  it('fundamentalsCoverageWarning: one line only when the block has warnings, no same-day fetch ran or its input is for another day', () => {
    const warn = (extra, day = DATE) => fundamentalsCoverageWarning(block(extra), { date: day });
    const text = '業績データ：この公開のSEC記録は540/1200銘柄 — 業績の判定は未確認が多くなります', short = '業績データ欠け：SEC記録は540/1200銘柄';
    // A block without problems (or an older one without the warnings list) says nothing.
    expect(warn({ warnings: [] })).toBeNull();
    expect(warn({})).toBeNull();
    for (const code of COVERAGE_WARNINGS) expect(warn({ warnings: [code] })).toEqual({ text, short });
    expect(warn({ warnings: ['no_quarters'], with_quarters: 0 })).toEqual({ text: '業績データ：この公開のSEC記録は0/1200銘柄 — 業績の判定は未確認が多くなります', short: '業績データ欠け：SEC記録は0/1200銘柄' });
    // No same-day SEC input: said as that, with the input's own day, never as a count over the whole universe.
    const otherDay = { text: '業績データ：この公開には当日分のSEC記録がありません（入力は11/2分） — 業績の判定は未確認になります', short: '業績データ：当日分のSEC記録なし（11/2分）' };
    expect(warn({ sec_as_of: '2026-11-02' })).toEqual(otherDay);
    expect(warn({ sec_fetch_ran: false, sec_as_of: '2026-11-02', eligible: null, requested: null, admitted: 0, with_quarters: 0, refused: 0, refused_by_reason: {} })).toEqual(otherDay);
    const none = warn({ sec_fetch_ran: false, sec_as_of: null, eligible: null, requested: null, admitted: 0, with_quarters: 0, refused: 0, refused_by_reason: {} });
    expect(none).toEqual({ text: '業績データ：この公開には当日分のSEC記録がありません — 業績の判定は未確認になります', short: '業績データ：当日分のSEC記録なし' });
    expect(`${none.text}${otherDay.text}`).not.toMatch(/993|\d+\/\d+銘柄/);
    expect(fundamentalsCoverageWarning(null, { date: DATE })).toBeNull();
    expect(warn({ warnings: ['refused'] }).text).not.toMatch(/通常|いつも|普段/);
    // The block it reads comes through publishedFundamentalsCoverage, which accepts the list only with known codes.
    expect(publishedFundamentalsCoverage({ as_of_date: DATE, fundamentals_coverage: block({ warnings: ['refused'] }) })).not.toBeNull();
    expect(publishedFundamentalsCoverage({ as_of_date: DATE, fundamentals_coverage: block({ warnings: ['late'] }) })).toBeNull();
  });
});

describe('round-2 reasons: the cause of an unusable record, a fiscal Q4 without a quarterly value, a revenue concept out of scope', () => {
  const date = '2026-11-04', now = Date.parse('2026-11-04T12:00:00Z');
  const judged = (record, extra = {}) => { const value = row({ as_of_date: date, book_financials: record, ...extra }); return secStatus(value, record ? bookFinancialCurrent(record, 'AAA', date, now, value) : null, {}); };

  it('an invalid_payload record is a fetch-side processing error, with the CIK mismatch when recorded', () => {
    const detail = { class: 'PayloadMismatch', message: 'companyfacts cik does not match the requested cik', requested_cik: 6, received_cik: 999 };
    expect(judged(secUnavailable({ symbol: 'AAA', asOfDate: date, reason: 'invalid_payload', invalid_detail: detail }))).toMatchObject({ state: 'invalid_payload', short: 'SEC 検証不可',
      long: 'SEC の記録を読み取れませんでした（取得側の処理エラーで、業績の良し悪しではありません）。返された記録の CIK 番号が要求と違いました。' });
    expect(judged(secUnavailable({ symbol: 'AAA', asOfDate: date, reason: 'invalid_payload' })).long).toBe('SEC の記録を読み取れませんでした（取得側の処理エラーで、業績の良し悪しではありません）。');
    expect(judged(secUnavailable({ symbol: 'AAA', asOfDate: date, reason: 'invalid_payload', invalid_detail: { ...detail, class: 'KeyError', received_cik: 6 } })).long).not.toContain('CIK');
  });

  it('提出日や期間 only when the date check failed; a refused series is named', () => {
    const series = secRecord({ symbol: 'AAA', asOfDate: date, quarters: [['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30']] });
    for (const point of series.quarterly.eps) point.start = '2025-01-01';
    const named = judged(series);
    expect(named.state).toBe('ok');
    const eps = secRecord({ symbol: 'AAA', asOfDate: date, quarters: [['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30']] }); eps.quarterly.revenue = []; eps.quarterly.netIncome = [];
    for (const point of eps.quarterly.eps) point.start = '2025-07-01';
    expect(judged(eps)).toMatchObject({ state: 'invalid', long: 'EPSの系列（期間・順序）を確かめられないため使いません。' });
    const otherDay = secRecord({ symbol: 'AAA', asOfDate: '2026-11-03' });
    expect(judged(otherDay).long).toContain('提出日や期間を検証できない');
    for (const state of [named, judged(eps)]) expect(state.long).not.toContain('提出日や期間');
  });

  it('a recent 10-K whose fiscal Q4 has no quarterly value is not 古い, and 古い stays for a truly old filing', () => {
    // audit2 earnings card-q4_row_missing: a June fiscal year, the latest quarter 2026-03, the FY 2026-06 10-K filed in August.
    const quarters = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
      ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30']];
    const record = secRecord({ symbol: 'AAA', asOfDate: date, quarters });
    for (const key of ['eps', 'revenue', 'netIncome']) record.quarterly[key] = record.quarterly[key].filter(p => !p.end.endsWith('06-30'));
    record.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4, { form: '10-K', filed: '2025-08-20', accession: 'k-25' }), secPoint('eps', ['2025-07-01', '2026-06-30'], 5, { form: '10-K', filed: '2026-08-20', accession: 'k-26' })];
    const status = judged(record);
    expect(status).toMatchObject({ state: 'q4_annual_only', short: 'Q4 年次のみ', long: '第4四半期（26-06期）は年次報告のみで四半期の値がありません。', fiscalQ4: '2026-06-30' });
    expect(code33ChipView({ sec: status, report: null, code33: { state: 'unknown', source: null } }).text).toBe('Code 33 未確認・Q4年次のみ');
    // Without that 10-K the filing really is old: 古い.
    record.annualEps = record.annualEps.slice(0, 1);
    expect(judged(record).state).toBe('stale');
  });

  it('a missing fiscal-Q4 row inside the window is said as that, never 欠け; EPS growth is stated as known facts', () => {
    const quarters = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
      ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30']];
    const record = secRecord({ symbol: 'AAA', asOfDate: date, quarters, eps: [1, 1, 1, 1, 1, 1.1, 1.2, 1.4, 1.8], revenue: [100, 100, 100, 100, 100, 110, 130, 160, 200], netIncome: [10, 10, 10, 10, 10, 11, 14, 19, 26] });
    for (const key of ['eps', 'revenue', 'netIncome']) record.quarterly[key] = record.quarterly[key].filter(p => p.end !== '2026-06-30');
    record.annualEps = [secPoint('eps', ['2025-07-01', '2026-06-30'], 5, { form: '10-K', filed: '2026-08-20', accession: 'k-26' })];
    const report = bookFinancialEvidence(record, 'AAA', date);
    const explain = code33Explain(report, { state: 'ok' }, code33Layered(report, null, date));
    expect(explain).toMatchObject({ state: 'unknown', kind: 'q4_row', text: '第4四半期（26-06期）は年次報告のみで四半期の値がありません。' });
    expect(code33ChipView({ report, sec: { state: 'ok' }, code33: code33Layered(report, null, date) }).text).toBe('Code 33 未確認・Q4年次のみ');
    // The 10-Q filer: +10, +20, +40 known, the fiscal Q4 EPS only in the 10-K, said as facts and never estimated.
    const tenQ = secRecord(); tenQ.quarterly.eps = tenQ.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
    tenQ.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    tenQ.quarterly.eps.splice(-3, 3, ...[['2025-01-01', '2025-03-31', 1.1], ['2025-04-01', '2025-06-30', 1.2], ['2025-07-01', '2025-09-30', 1.4]].map(([s, e, v]) => secPoint('eps', [s, e], v)));
    const q4 = bookFinancialEvidence(tenQ, 'TEST', '2026-02-01');
    const text = code33Explain(q4, { state: 'ok' }, code33Layered(q4, null, '2026-02-01'), { interim: true });
    expect(text).toMatchObject({ state: 'unknown', kind: 'q4_eps', text: '売上の加速と純利益率の上昇は達成。EPS の加速は未確認：EPS前年比 +10→+20→+40（Q4は10-Kのみで未確認）。' });
    // Without the card's option the shared wording stays; the known rates never count as a pass.
    expect(code33Explain(q4, { state: 'ok' }, code33Layered(q4, null, '2026-02-01')).text).toContain('EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です');
    // A fiscal Q4 inside the window reads Q4未確認 among the known rates.
    const middle = secRecord(); middle.quarterly.eps = middle.quarterly.eps.filter(p => p.end !== '2025-06-30');
    middle.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4, { form: '10-K', filed: '2025-08-20', accession: 'k-25' })];
    const mid = bookFinancialEvidence(middle, 'TEST', '2026-02-01');
    expect(code33Explain(mid, { state: 'ok' }, code33Layered(mid, null, '2026-02-01'), { interim: true })).toMatchObject({ kind: 'q4_eps',
      text: expect.stringContaining('EPS前年比 +10→Q4未確認→+40→+80（Q4は10-Kのみで未確認）') });
  });

  it('a record without a revenue concept says the sales concept is out of scope, never 未報告', () => {
    const bank = secRecord(); bank.quarterly.revenue = [];
    const report = bookFinancialEvidence(bank, 'TEST', '2026-02-01');
    const [, sales, margin] = fundamentalTiles(report);
    // Each tile keeps one short line; the full sentence is its title and the reasons' (quarterReason).
    expect(sales).toMatchObject({ value: null, short: '対象外', note: '銀行・保険など', title: '売上の科目が対象外（銀行・保険などの収益科目）' });
    expect(margin).toMatchObject({ value: null, short: '対象外', note: '売上の科目なし', title: '売上の科目が対象外（銀行・保険などの収益科目）' });
    expect(quarterReason(report.rows.at(-1), 'sales')).toBe('売上の科目が対象外（銀行・保険などの収益科目）');
    for (const tile of [sales, margin]) expect(`${tile.short}${tile.note}`).not.toContain('未報告');
  });
});
