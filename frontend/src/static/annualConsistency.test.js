import { expect, it } from 'vitest';
import { reportedGrowth, reportedGrowthAtLeast } from './reportedGrowth.js';
import { assess, assessmentSummary, rankCandidates } from './researchEngine.js';
import { researchListRow, encodeResearchIndex, decodeResearchIndex } from './researchTransport.js';
import { mergeFinancialDetail } from './financialCurrent.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from './financialEvidencePresentation.js';
import { withFinancialProof } from './testFinancialFixture.js';
import { withAuditFixture } from './testAuditFixture.js';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual.js';
import { financialHistory } from './financialHistory.js';
import { filterStaticScanRows } from './scanClient.js';
import { buildActiveFilters } from '../features/scan/components/filterPanel/utils.js';

const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
const context = { date, now, generation: 'synthetic', method: 'oneil', symbol: 'TEST' };
const annualRule = (row, method = 'oneil') => assess(row, method, now).rules.find(rule => /3年/.test(rule.label));
function input(values, legacy) {
  const data = nativeAnnualFixture('USD', values);
  if (legacy) for (const key of ['schema_version', 'annual_currency', 'quarterly_currency', 'quarterly_retrieved_at', 'annual_source']) delete data[key];
  return withFinancialProof(withAuditFixture({ symbol: 'TEST', market: 'US', financial_history: data,
    eps_growth_yy: 30, sales_growth_yy: 30 }, date), now, date);
}
function surfaces(row) {
  const list = researchListRow(row);
  const decoded = decodeResearchIndex(encodeResearchIndex({ as_of_date: date, rows: [row] })).rows[0];
  return [row, list, decoded, mergeFinancialDetail(decoded, row, { now, asOfDate: date })];
}
function sameDecision(row, state, method = 'oneil') {
  const bound = { ...context, method };
  for (const candidate of surfaces(row)) {
    expect(annualRule(candidate, method).state).toBe(state);
    expect(assessmentSummary(candidate, method, now)).toEqual(rankCandidates([candidate], method, { now })[0].assessment);
    const view = financialEvidencePresentation({ ...bound, history: candidate.financial_history,
      evidence: buildFinancialEvidencePresentation(candidate, bound) }).rows.find(item => item.id === 'annual_eps_growth_3y');
    expect(view.state).toBe(state);
    if (annualRule(candidate, method).precisionNote) expect(view.calculationNote).toContain('25%未満');
  }
}

it.each([false, true])('preserves the exact 25%% boundary across list, detail and decision (legacy=%s)', legacy => {
  for (const [latest, state] of [[0.3499999999999999, 'fail'], [0.35, 'pass'], [0.35000000000000003, 'pass']]) {
    const row = input([0.28, latest, 0.45, 0.57], legacy);
    sameDecision(row, state);
    if (latest === 0.35) expect(annualRule(row).value).toBe(25);
  }
});
it.each([0, -0, -0.28, null])('does not certify growth from a nonpositive/missing baseline %s', baseline => {
  sameDecision(input([baseline, 0.35, 0.45, 0.57]), 'unknown');
  expect(reportedGrowth(baseline, 0.35)).toBeNull();
  expect(reportedGrowthAtLeast(baseline, 0.35, 25)).toBeNull();
});
it('keeps zero EPS as a decline and IBD completeness independent of growth', () => {
  const row = input([0.28, 0.35, 0.45, 0]);
  sameDecision(row, 'fail'); sameDecision(row, 'pass', 'ibd');
  expect(reportedGrowth(0.45, 0)).toBe(-100);
});
it('compares decimal scientific notation without a tolerance or an overflowing intermediate', () => {
  for (const [previous, latest] of [[2.8e-100, 3.5e-100], [2.8e100, 3.5e100], [Number.MIN_VALUE, 2 * Number.MIN_VALUE]]) {
    expect(reportedGrowthAtLeast(previous, latest, 25)).toBe(true);
    expect(reportedGrowth(previous, latest)).toBeGreaterThanOrEqual(25);
  }
  expect(reportedGrowth(Number.MIN_VALUE, 1)).toBeNull();
  expect(reportedGrowthAtLeast(1, 1.2499999999999998, 25)).toBe(false);
});

it.each([
  ['root annual currency', data => { data.annual_currency = 'JPY'; }],
  ['root reporting currency', data => { data.currency = 'CAD'; }],
  ['cell currency', data => { data.annual[0].currency = 'JPY'; }],
  ['cell share unit', data => { data.annual[1].unit = 'per_ADR'; }],
  ['cell source', data => { data.annual[2].source = 'Other'; }],
  ['unsupported annual source', data => { data.annual_source = { currency: 'USD' }; }],
])('keeps legacy %s conflicts unknown across every surface', (_label, mutate) => {
  for (const values of [[1, 2, 4, 8], [8, 4, 2, null], [8, 4, 2, 1]]) {
    const row = input(values, true); mutate(row.financial_history);
    const before = structuredClone(row);
    sameDecision(row, 'unknown'); sameDecision(row, 'unknown', 'ibd');
    for (const candidate of surfaces(row)) {
      expect(candidate.financial_history.annual).toEqual(row.financial_history.annual);
      expect(annualRule(candidate).evidence).toContain('通貨・出典・単位の整合性');
      expect(financialHistory(candidate.financial_history, 'TEST', date, now)).toMatchObject({
        annualComplete: null, annualGrowth: null, annualComparisons: [], annualReason: 'inconsistent_annual_metadata' });
    }
    expect(row).toEqual(before);
  }
});
it('retains invalid native cell metadata, while coherent native currencies remain usable', () => {
  for (const currency of ['USD', 'CAD', 'EUR', 'GBP', 'CNY']) {
    const row = input([0.28, 0.35, 0.45, 0.57]);
    row.financial_history = nativeAnnualFixture(currency, [0.28, 0.35, 0.45, 0.57]);
    sameDecision(row, 'pass');
    row.financial_history.annual[0].currency = currency === 'USD' ? 'CAD' : 'USD';
    sameDecision(row, 'unknown'); sameDecision(row, 'unknown', 'ibd');
    for (const candidate of surfaces(row)) expect(candidate.financial_history.annual).toEqual(row.financial_history.annual);
  }
});
it('keeps independent comparable USD quarterly history when only annual metadata is inconsistent', () => {
  const row = input([1, 2, 4, 8], true);
  row.financial_history.annual_currency = 'JPY';
  row.financial_history.quarterly = [{ end: '2025-06-30', eps: 1, revenue: 100 }, { end: '2026-06-30', eps: 2, revenue: 200 }];
  const report = financialHistory(row.financial_history, 'TEST', date, now);
  expect(report).toMatchObject({ valid: true, annualGrowth: null, epsYoY: 100, salesYoY: 100 });
  sameDecision(row, 'unknown');
});
it('keeps the explicitly labelled QoQ filters separate from YoY selection conditions', () => {
  const row = withFinancialProof({ ...input([1, 2, 4, 8]), eps_growth_qq: 40, sales_growth_qq: 35,
    eps_growth_yy: -10, sales_growth_yy: -5 }, now, date);
  const filters = { epsGrowth: { min: 25 }, salesGrowth: { min: 25 } };
  expect(buildActiveFilters(filters)).toEqual([
    { key: 'epsGrowth', label: 'EPS 前四半期比: ≥25%' }, { key: 'salesGrowth', label: '売上 前四半期比: ≥25%' },
  ]);
  expect(filterStaticScanRows([row], filters, { now })).toHaveLength(1);
  for (const candidate of surfaces(row)) {
    const rules = assess(candidate, 'oneil', now).rules;
    expect(rules.find(item => /四半期 EPS/.test(item.label))).toMatchObject({ value: -10, state: 'fail' });
    expect(rules.find(item => /売上高/.test(item.label))).toMatchObject({ value: -5, state: 'fail' });
  }
});
