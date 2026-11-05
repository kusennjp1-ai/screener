// The seams C owns and other tracks call: the conclusion's Code 33 chip (D) and the published SEC
// coverage block that useStockData (E) hands to secStatus; and secStatus's wording for each coverage state.
import { describe, expect, it } from 'vitest';
import { code33ChipView, publishedFundamentalsCoverage, secStatus } from './fundamentalsExplain.js';
import { bookFinancialCurrent } from './bookFinancialCurrent.js';
import { bookFinancialEvidence } from './bookFinancialEvidence.js';
import { code33Layered } from './code33Reference.js';
import { secPoint, secRecord } from '../test/fixtures/secRecord.js';

const DATE = '2026-11-03';
const block = (extra = {}) => ({ schema_version: 'fundamentals-coverage-v1', as_of_date: DATE, sec_fetch_ran: true, sec_as_of: DATE, file_schema: 2, universe: 993, requested: 600,
  eligible: 1200, truncated: 0, deadline_unreached: 0, admitted: 580, with_quarters: 540, not_requested: 393, not_fetched: 0, refused: 20, refused_by_reason: { cik_url: 20 }, ...extra });
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
    expect(code33ChipView(null)).toEqual({ text: 'Code 33 未確認・SEC未配信', tone: '' });
    expect(code33ChipView(financial(null, { state: 'refused', short: 'SEC 不採用' }))).toEqual({ text: 'Code 33 未確認・SEC不採用', tone: '' });
    expect(code33ChipView(financial(null, { state: 'not_requested', short: 'SEC 取得対象外' }))).toEqual({ text: 'Code 33 未確認・SEC取得対象外', tone: '' });
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
    for (const broken of [{ listed: 993, sec_record: 0 }, block({ schema_version: 'x' }), block({ admitted: -1 }), block({ requested: 'many' }), block({ sec_fetch_ran: 'yes' })])
      expect(publishedFundamentalsCoverage({ as_of_date: DATE, fundamentals_coverage: broken })).toBeNull();
  });
});

describe('secStatus with the publication coverage', () => {
  const texts = [];
  const status = (value, coverage, detail = 'loaded') => { const result = secStatus(value, null, { detail, coverage }); texts.push(result.long, result.short); return result; };

  it('tells a delivery failure of the whole publication apart from the stock, with the date and counts', () => {
    const notRun = status(row(), block({ sec_fetch_ran: false, sec_as_of: null, file_schema: null, requested: null, admitted: 0, with_quarters: 0, refused: 0, refused_by_reason: {}, not_requested: 0, not_fetched: 993 }));
    expect(notRun).toMatchObject({ state: 'not_published', short: 'SEC 未配信', delivery: true,
      long: 'この公開（11/3分）では SEC 四半期データを反映していません（0/993銘柄・配信側の問題で、業績の良し悪しではありません）。' });
    const oldSchema = status(row({ sec_admission: { state: 'refused', reason: 'schema' } }), block({ file_schema: 1, admitted: 0, with_quarters: 0, refused: 50, refused_by_reason: { schema: 50 }, not_requested: 943 }));
    expect(oldSchema.state).toBe('not_published');
    expect(oldSchema.long).toContain('配信側の問題で、業績の良し悪しではありません');
  });

  it('says the stock was outside this fetch, with the fetched count, and claims 対象 only for a requested stock', () => {
    const outside = status(row({ sec_admission: { state: 'not_requested', reason: null } }), block());
    expect(outside).toMatchObject({ state: 'not_requested', short: 'SEC 取得対象外', long: '今回の SEC 取得の対象外です（取得 600/993銘柄）。' });
    expect(outside.long).not.toContain('対象です');
    const unknownCount = status(row({ sec_admission: { state: 'not_requested', reason: null } }), block({ requested: null }));
    expect(unknownCount.long).toBe('今回の SEC 取得の対象外です。');
    // The detail's own state is real without a block; only the counts need it.
    expect(status(row({ sec_admission: { state: 'not_requested', reason: null } }), null)).toMatchObject({ state: 'not_requested', long: '今回の SEC 取得の対象外です。' });
  });

  it('says a requested record was refused at verification and why', () => {
    const refused = status(row({ sec_admission: { state: 'refused', reason: 'cik_url' } }), block());
    expect(refused).toMatchObject({ state: 'refused', short: 'SEC 不採用', reason: 'cik_url', long: '取得対象でしたが、SEC の記録を検証できず不採用にしました（出典URLとCIK番号が一致しないため）。' });
    expect(status(row({ sec_admission: { state: 'refused', reason: 'series:eps' } }), block()).long).toContain('EPSの系列（提出日・期間・様式）を確かめられないため');
    expect(status(row({ sec_admission: { state: 'refused', reason: 'series:annualEps' } }), block()).long).toContain('年間EPSの系列（提出日・期間・様式）を確かめられないため');
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

  it('never promises a later reflection', () => {
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toMatch(/今後|反映されます|次回/);
    expect(secStatus(row({ book_financials: { schema_version: 2, symbol: 'AAA', as_of_date: DATE, status: 'unavailable', reason: 'transient', retrieved_at: `${DATE}T10:00:00Z` } }), null).long).not.toMatch(/今後|次回|反映されます/);
  });
});
