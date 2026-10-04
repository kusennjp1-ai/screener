import { withFinancialProof, FINANCIAL_TEST_NOW as now } from './testFinancialFixture';
import { describe, expect, it } from 'vitest';
import { withAuditFixture } from './testAuditFixture';
import { assess, rankCandidates, researchCsv, RULE_SUMMARY_VERSION } from './researchEngine';
import { encodeAssessment } from './assessmentEncoding';
import { filterRanked } from './researchPresentation';
import { singleMissingCondition } from './missingCondition';

const date = '2026-09-29';
function sample(symbol, extra = {}) {
  return withFinancialProof(withAuditFixture({ symbol, market: 'US', currency: 'USD', company_name: symbol, current_price: 102, adv_usd: 25000000,
    rs_rating: 90, eps_rating: 90, composite_rating: 95, ibd_group_rank: 10, eps_growth_yy: 30, sales_growth_yy: 30,
    financial_history:{symbol,as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'yfinance',retrieved_at:new Date(now).toISOString(),annual:[1,1.3,1.69,2.197].map((eps,i)=>({eps,end:`${2022+i}-12-31`}))}, annual_eps_growth_3y: [30, 30, 30], price_change_1d: 2, se_volume_vs_50d: 1.6, market_above_50dma: true, market_above_200dma: true,
    institutional_evidence: { symbol, status: 'available', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-08-31',
      observations: [{ period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' }, { period: '2026-06-30', manager_count: 110, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' }] }, ...extra }, date),now,date);
}

describe('one-condition-away is a distinct watch view', () => {
  for (const method of ['minervini', 'minervini2', 'oneil']) it(`${method}: count exactly matches summary passed = total - 1, including a single unknown`, () => {
    const field = method.startsWith('minervini') ? 'rs_rating' : method === 'oneil' ? 'eps_growth_yy' : 'composite_rating';
    const failed = method.startsWith('minervini') ? 69 : method === 'oneil' ? 24 : 89;
    const rows = [sample('PASS'), sample('FAILED', { [field]: failed }), sample('UNKNOWN', { [field]: null }), sample('MULTIPLE', { [field]: null, sales_growth_yy: null })];
    rows[3].technical_audit = { errors: ['未取得'], valid: false };
    rows.forEach(row => { row.method_summary = { version: RULE_SUMMARY_VERSION, [method]: encodeAssessment(assess(row, method,now)) }; });
    const ranked = rankCandidates(rows, method,{now});
    const near = filterRanked(ranked, { nearOnly: true });
    expect(near.map(item => item.row.symbol).sort()).toEqual(['FAILED', 'UNKNOWN']);
    expect(near).toHaveLength(rows.filter(row => row.method_summary[method][0] === row.method_summary[method][3] - 1).length);
    expect(near.every(item => !item.assessment.qualified)).toBe(true);
    expect(filterRanked(ranked, { qualifiedOnly: true }).map(item => item.row.symbol)).toEqual(['PASS']);
    expect(filterRanked(ranked, { nearOnly: true, qualifiedOnly: true })).toEqual([]);
    expect(singleMissingCondition(assess(near.find(item => item.row.symbol === 'FAILED').row, method,now)).stateLabel).toBe('未達');
    expect(singleMissingCondition(assess(near.find(item => item.row.symbol === 'UNKNOWN').row, method,now)).stateLabel).toBe('未確認');
  });
  it('does not create IBD near-passes from unverified EPS and Composite ratings',()=>{expect(filterRanked(rankCandidates([sample('RAW')],'ibd',{now}),{nearOnly:true})).toEqual([]);});
  it('keeps global search, liquidity and watch filters when selecting near passes', () => {
    const rows = [sample('FAIL', { rs_rating: 69 }), sample('SMALL', { rs_rating: 69, adv_usd: 1000 })];
    const ranked = rankCandidates(rows, 'minervini',{now});
    expect(filterRanked(ranked, { nearOnly: true, liquidOnly: true })).toHaveLength(1);
    expect(filterRanked(ranked, { nearOnly: true, search: 'small', watchlist: ['SMALL'] }).map(item => item.row.symbol)).toEqual(['SMALL']);
  });
  it('exports the full missing rule and its state; passes and multiple-missing rows stay empty', () => {
    const rows = [sample('PASS'), sample('FAIL', { rs_rating: 69 }), sample('UNKNOWN', { institutional_evidence: null })];
    const minervini = researchCsv(rankCandidates(rows, 'minervini',{now}), 'minervini', date,now);
    expect(minervini.split('\r\n')[0]).toContain('"missing_condition"');
    expect(minervini).toContain('未達：RS 推計 ≥ 70');
    const oneil = researchCsv(rankCandidates(rows, 'oneil',{now}), 'oneil', date,now);
    expect(oneil).toContain('未確認：I：13F報告運用会社の保有社数が増加');
    expect(singleMissingCondition(assess(rows[0], 'oneil',now))).toBeNull();
    expect(singleMissingCondition({ passed: 7, total: 9, rules: [] })).toBeNull();
  });
});
