import { withFinancialProof, FINANCIAL_TEST_NOW } from './testFinancialFixture';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual';
import applicabilityRegistry from '../../contracts/financial_instrument_applicability_v1.json';
import { describe, expect, it } from 'vitest';
import { withAuditFixture } from './testAuditFixture';
import { assess, assessmentSummary, compareReference, entryPlan, quoteStatus, rankCandidates, researchCsv, snapshotFreshness, METHOD_STATUS_VERSION } from './researchEngine';

describe('research rules and financial data integrity', () => {
  it('requires three annual growth rates rather than substituting CAGR', () => {
    expect(assess({ eps_cagr_3y: 100 }, 'oneil').rules[2].state).toBe('unknown');
    expect(assess({ annual_eps_growth_3y: [50, -10, 100] }, 'oneil').rules[2].state).toBe('unknown');
    expect(assess({ annual_eps_growth_3y: [25, 30, 40] }, 'oneil').rules[2].state).toBe('unknown');
    expect(assess({ annual_eps_growth_3y: [25, 30] }, 'oneil').rules[2].state).toBe('unknown');
  });
  it('uses the audited preceding-session volume and change for the demand proxy', () => {
    const row=withAuditFixture({symbol:'TEST',current_price:100,price_change_1d:2,se_volume_vs_50d:3});
    for(const change of [-5,0]) {
      row.technical_audit.values.change=change;
      expect(assess(row,'oneil').rules[4].state).toBe('fail');
    }
    row.technical_audit.values.change=2;
    row.technical_audit.values.volumeRatio=1.2;
    expect(assess(row,'oneil').rules[4]).toMatchObject({value:1.2,state:'fail'});
    row.se_volume_vs_50d=.5;row.price_change_1d=-3;
    row.technical_audit.values.volumeRatio=1.4;
    expect(assess(row,'oneil').rules[4]).toMatchObject({value:1.4,state:'pass'});
    for(const invalid of [null,NaN,undefined,'2']) {
      row.technical_audit.values.change=invalid;
      expect(assess(row,'oneil').rules[4].state).toBe('unknown');
    }
    row.technical_audit.values.change=2;
    for(const invalid of [-1,NaN,Infinity,null,'1.6']) {
      row.technical_audit.values.volumeRatio=invalid;
      expect(assess(row,'oneil').rules[4].state).toBe('unknown');
    }
    expect(assess({price_change_1d:2,se_volume_vs_50d:3},'oneil').rules[4].state).toBe('unknown');
  });
  it('does not trust an earlier-rule cached score after the volume source correction',()=>{
    const row=withAuditFixture({symbol:'TEST',current_price:100,se_volume_vs_50d:3});
    row.technical_audit.values.volumeRatio=1.2;
    row.method_summary={version:'research-summary-v2',oneil:[8,0,0,8,0]};
    const {rules,...expected}=assess(row,'oneil');
    expect(rules).toHaveLength(expected.total);
    expect(assessmentSummary(row,'oneil')).toEqual(expected);
    expect(assessmentSummary(row,'oneil').qualified).toBe(false);
  });
  it('rejects coerced values and applies the top-20 industry threshold', () => {
    expect(assess({ eps_growth_yy: '30' }, 'oneil').rules[0].state).toBe('unknown');
    expect(assess({ ibd_group_rank: true }, 'ibd').rules[3].state).toBe('unknown');
    expect(assess({ ibd_group_rank: 20 }, 'ibd').rules[3].state).toBe('pass');
    expect(assess({ ibd_group_rank: 21 }, 'ibd').rules[3].state).toBe('fail');
  });
  it('measures analysis age in New York calendar days, independent of publication time', () => {
    const now = Date.parse('2026-09-24T02:00:00Z'); // Still September 23 in New York.
    expect(snapshotFreshness('2026-09-23', now)).toEqual({ state: 'recent', days: 0 });
    expect(snapshotFreshness('2026-09-19', now)).toEqual({ state: 'old', days: 4 });
    expect(snapshotFreshness('2026-09-24', now).state).toBe('future');
    expect(snapshotFreshness('2026-02-30', now).state).toBe('unknown');
    expect(snapshotFreshness(undefined, now).state).toBe('unknown');
    expect(snapshotFreshness('2026-09-18', Date.parse('2026-09-21T12:00:00Z')).state).toBe('recent');
  });
  it('exports dated, auditable CSV with unknown rules and literal spreadsheet text', () => {
    const ranked = rankCandidates([{ symbol: '=HYPERLINK("bad")', current_price: 100, vcp_pivot: 99 }], 'oneil');
    const csv = researchCsv(ranked, 'oneil', '2026-09-21');
    expect(csv).toContain('"as_of_date"');
    expect(csv).toContain('"2026-09-21"');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"false","0","8","8"');
    expect(csv).toContain('直近3年の各年 EPS 成長率');
    expect(csv).toContain('"99"');
  });
  it('does not accept legacy distances without independent daily verification', () => {
    for (const distance of [-10, 10, 0]) expect(assess({ week_52_high_distance: distance }, 'ibd').rules[4].state).toBe('unknown');
    for (const distance of [-26, 26]) expect(assess({ week_52_high_distance: distance }, 'minervini').rules[6].state).toBe('unknown');
  });
  it('excludes illiquid or missing-liquidity stocks when the liquidity gate is enabled', () => {
    const rows = [{ symbol: 'GOOD', current_price: 10, adv_usd: 20000000 }, { symbol: 'PENNY', current_price: 2, adv_usd: 50000000 }, { symbol: 'UNKNOWN', current_price: 50 }];
    expect(rankCandidates(rows, 'ibd', { liquidOnly: true }).map(r => r.row.symbol)).toEqual(['GOOD']);
  });
  it('does not use QoQ as the CAN SLIM C growth criterion', () => {
    const result = assess(withFinancialProof({ eps_growth_qq: 200, eps_growth_yy: -10 }), 'oneil', FINANCIAL_TEST_NOW);
    expect(result.rules[0].state).toBe('fail');
    expect(assess({ eps_growth_qq: 200 }, 'oneil').rules[0].state).toBe('unknown');
  });
  it('does not silently qualify missing fundamentals', () => {
    expect(assess({}, 'oneil').qualified).toBe(false);
    expect(assess({}, 'ibd').unknown).toBe(10);
  });
  it('keeps a known zero distinct from absent data', () => {
    expect(assess(withFinancialProof({ eps_growth_yy: 0 }), 'oneil', FINANCIAL_TEST_NOW).rules[0].state).toBe('fail');
    expect(assess({ rs_rating: NaN }, 'ibd').rules[1].state).toBe('unknown');
  });
  it('handles pivot boundary, extension, waiting and invalid prices', () => {
    expect(entryPlan({ current_price: 105, se_pivot_price: 100 }).state).toBe('買いゾーン内');
    expect(entryPlan({ current_price: 105.01, se_pivot_price: 100 }).state).toBe('買いゾーン超過');
    expect(entryPlan({ current_price: 99, se_pivot_price: 100 }).state).toBe('ピボット待ち');
    expect(entryPlan({ current_price: 99, se_pivot_price: 0 }).state).toBe('未判定');
  });
  it('never labels old, future, unknown-delay or malformed quotes realtime', () => {
    const now = Date.parse('2026-09-22T15:00:00Z');
    const quote = { price: 100, as_of: '2026-09-22T15:00:00Z', is_realtime: true, delay_seconds: 0 };
    expect(quoteStatus(quote, now)).toBe('リアルタイム');
    expect(quoteStatus(quote, now + 91000)).toBe('期限切れ');
    expect(quoteStatus(quote, now - 10000)).toBe('期限切れ');
    expect(quoteStatus({ ...quote, delay_seconds: undefined }, now)).toBe('遅延データ');
    expect(quoteStatus({ ...quote, price: -1 }, now)).toBe('未接続');
  });
  it('compares reference membership only for verified matching dates', () => {
    const reference = { verified: true, as_of_date: '2026-09-21', constituents: ['AAA', 'BBB'] };
    expect(compareReference([{ symbol: 'AAA' }], reference, '2026-09-22')).toBe(null);
    expect(compareReference([{ symbol: 'AAA' }], { ...reference, verified: false }, '2026-09-21')).toBe(null);
    expect(compareReference([{ symbol: 'AAA' }, { symbol: 'AAA' }], reference, '2026-09-21').recall).toBe(.5);
  });
  it('filters non-US rows and preserves deterministic sorting', () => {
    expect(rankCandidates([{ symbol: 'B', market: 'US' }, { symbol: 'A', market: 'US' }, { symbol: 'JP', market: 'JP' }], 'ibd').map(r => r.row.symbol)).toEqual(['A', 'B']);
  });
});


describe('versioned CSV selection outcome', () => {
  const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
  const currentRow = ({ symbol = 'TEST', sales = 30, annual = [1, 2, 4, 8] } = {}) => {
    const history = nativeAnnualFixture('CAD', annual);
    history.symbol = symbol;
    history.annual_source.symbol = symbol;
    return withFinancialProof(withAuditFixture({ symbol, current_price: 100, se_pivot_price: 99, rs_rating: 95,
      eps_growth_yy: 30, sales_growth_yy: sales, financial_history: history,
      market_above_50dma: true, market_above_200dma: true,
      institutional_evidence: { symbol, status: 'available', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-08-31', observations: [
        { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
        { period: '2026-06-30', manager_count: 110, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
      ] },
    }, date), now, date);
  };
  // All cells are quoted by researchCsv; preserve escaped quotes in evidence.
  const records = csv => {
    const [header, ...lines] = csv.split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')));
    return { header, rows: lines.map(values => Object.fromEntries(header.map((name, index) => [name, values[index]]))) };
  };

  it.each([
    ['known failure and unknown', { sales: -4, annual: [1, 2, 4, null] }, 'fail', 6, 1, 1],
    ['unknown only', { annual: [1, 2, 4, null] }, 'unknown', 7, 0, 1],
    ['all pass', {}, 'pass', 8, 0, 0],
    ['known failure only', { sales: -4 }, 'fail', 7, 1, 0],
  ])('exports %s without changing the assessment or inputs', (_label, options, state, passed, failed, unknown) => {
    const input = currentRow(options), original = structuredClone(input);
    const assessment = assess(input, 'oneil', now);
    expect(assessment).toMatchObject({ passed, failed, unknown, total: 8, qualified: passed === 8 });
    const ranked = rankCandidates([input], 'oneil', { now });
    const before = structuredClone(ranked);
    const { header, rows: [record] } = records(researchCsv(ranked, 'oneil', date, now));
    expect(header).toEqual(['as_of_date', 'symbol', 'method', 'qualified', 'passed', 'total', 'unknown', 'rs_estimate', 'daily_price', 'pivot', 'failed_rules', 'unknown_rules', 'missing_condition', 'financial_evaluated_at', 'financial_semantics', 'method_status', 'applicability_reason', 'applicability_version', 'annual_eps_reporting_currency', 'annual_eps_rule_state', 'annual_eps_rule_evidence', 'failed_count', 'unknown_count', 'method_status_version']);
    expect(record).toMatchObject({ method_status: state, qualified: String(passed === 8), passed: String(passed), total: '8',
      failed_count: String(failed), unknown_count: String(unknown), unknown: String(unknown),
      method_status_version: 'research-method-status-v2-logical-and', rs_estimate: '95', daily_price: '100', pivot: '99' });
    expect(record.method_status_version).toBe(METHOD_STATUS_VERSION);
    expect(record.failed_rules).toBe(assessment.rules.filter(rule => rule.state === 'fail').map(rule => rule.label).join(' / '));
    expect(record.unknown_rules).toBe(assessment.rules.filter(rule => rule.state === 'unknown').map(rule => rule.label).join(' / '));
    expect(record.annual_eps_rule_evidence).toBe(assessment.rules[2].evidence);
    expect(assess(input, 'oneil', now)).toEqual(assessment);
    expect(ranked).toEqual(before);
    expect(input).toEqual(original);
  });

  it('retains unresolved annual pairs inside a proven failed rule without inventing an aggregate value', () => {
    const input = currentRow({ annual: [8, 4, 2, null] });
    const assessment = assess(input, 'oneil', now);
    expect(assessment).toMatchObject({ passed: 7, failed: 1, unknown: 0, qualified: false });
    expect(assessment.rules[2]).toMatchObject({ state: 'fail', value: null });
    const { rows: [record] } = records(researchCsv(rankCandidates([input], 'oneil', { now }), 'oneil', date, now));
    expect(record).toMatchObject({ method_status: 'fail', failed_count: '1', unknown_count: '0', annual_eps_rule_state: 'fail' });
    expect(record.annual_eps_rule_evidence).toContain('2025-12-31: EPS欠損');
    expect(record.annual_eps_rule_evidence).toContain('−50.00%（未達）');
    expect(input.financial_history.annual.map(point => point.eps)).toEqual([8, 4, 2, null]);
  });

  it('keeps ranking and qualification unchanged when exporting mixed outcomes', () => {
    const rows = [currentRow({ symbol: 'FAIL', sales: -4, annual: [1, 2, 4, null] }),
      currentRow({ symbol: 'UNKNOWN', annual: [1, 2, 4, null] }), currentRow({ symbol: 'PASS' })];
    const ranked = rankCandidates(rows, 'oneil', { now });
    expect(ranked.map(item => item.row.symbol)).toEqual(['PASS', 'UNKNOWN', 'FAIL']);
    expect(ranked.map(item => item.assessment.qualified)).toEqual([true, false, false]);
    const before = structuredClone(ranked);
    expect(records(researchCsv(ranked, 'oneil', date, now)).rows.map(record => record.method_status)).toEqual(['pass', 'unknown', 'fail']);
    expect(ranked).toEqual(before);
    expect(rankCandidates(rows, 'oneil', { now })).toEqual(before);
    expect(rankCandidates(rows, 'oneil', { now, qualifiedOnly: true }).map(item => item.row.symbol)).toEqual(['PASS']);
  });

  it.each(['not_applicable', 'quarantined'])('preserves %s over aggregate rule counts', status => {
    const identity = applicabilityRegistry.records[0];
    const input = withAuditFixture({ symbol: identity.symbol, company_name: status === 'not_applicable' ? identity.name : 'Different issuer',
      market: identity.market, current_price: 100, rs_rating: 10 }, date);
    const assessment = assess(input, 'minervini', now);
    expect(assessment).toMatchObject({ method_status: status, failed: 1, unknown: 0, qualified: false });
    const { rows: [record] } = records(researchCsv(rankCandidates([input], 'minervini', { now }), 'minervini', date, now));
    expect(record).toMatchObject({ method_status: status, qualified: 'false', failed_count: '1', unknown_count: '0',
      applicability_reason: assessment.applicability_reason, method_status_version: METHOD_STATUS_VERSION });
  });
});
