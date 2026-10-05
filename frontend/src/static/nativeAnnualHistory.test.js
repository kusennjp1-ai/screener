import { describe, expect, it } from 'vitest';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual.js';
import { financialHistory, nativeAnnualHistoryContract } from './financialHistory.js';
import { currentFinancialHistory, financialNextExpiry, mergeFinancialDetail } from './financialCurrent.js';
import { assess, rankCandidates, researchCsv } from './researchEngine.js';
import { encodeResearchIndex, decodeResearchIndex, researchListRow } from './researchTransport.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from './financialEvidencePresentation.js';
import { withAuditFixture } from './testAuditFixture.js';
import { withFinancialProof } from './testFinancialFixture.js';
import { filterStaticScanRows } from './scanClient.js';
import { selectionSnapshot, compareSnapshots } from './candidateHistory.js';
import { prepareReadinessTimeline } from './entryReadiness.js';

const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
const row = history => withFinancialProof(withAuditFixture({ symbol: 'TEST', market: 'US', currency: 'USD', current_price: 100,
  adv_usd: 30000000, rs_rating: 95, eps_growth_yy: 30, sales_growth_yy: 30, financial_history: history }, date), now, date);
const annualRule = (value, method = 'oneil', clock = now) => assess(value, method, clock).rules.find(rule => rule.label.includes('3年'));

describe('explicit reported native annual contract', () => {
  it.each(['USD', 'CAD', 'EUR', 'GBP', 'CNY'])('uses the same dimensionless growth rules for %s', currency => {
    const history = nativeAnnualFixture(currency);
    expect(financialHistory(history, 'TEST', date, now)).toMatchObject({ annualComplete: true, annualGrowth: [100, 100, 100] });
    expect(annualRule(row(history))).toMatchObject({ state: 'pass', value: 100 });
    const scaled = nativeAnnualFixture(currency, [100, 200, 400, 800]);
    expect(financialHistory(scaled, 'TEST', date, now).annualGrowth).toEqual([100, 100, 100]);
  });
  it.each([
    ['legacy foreign without proof', h => { delete h.schema_version; }],
    ['unknown version', h => { h.schema_version = 'future'; }],
    ['missing currency', h => { h.currency = null; }],
    ['mixed currencies', h => { h.currency = ['GBP', 'USD']; }],
    ['GBp is not GBP', h => { h.currency = h.annual_currency = h.annual_source.currency = 'GBp'; }],
    ['unsupported currency', h => { h.currency = h.annual_currency = h.annual_source.currency = 'XYZ'; }],
    ['wrong issuer', h => { h.annual_source.symbol = 'OTHER'; }],
    ['wrong metric', h => { h.annual_source.metric = 'annualBasicEPS'; }],
    ['wrong basis', h => { h.basis = 'basic_eps'; }],
    ['different share basis', h => { h.annual_source.share_basis = 'adr_converted'; }],
    ['extra declared scale', h => { h.annual_source.unit_scale = 100; }],
    ['per-cell conflicting currency', h => { h.annual[0].currency = 'USD'; }],
    ['missing receipt', h => { h.annual_source.receipt_sha256 = null; }],
    ['unbound root clock', h => { h.retrieved_at = '2026-10-04T11:30:00Z'; }],
  ])('withholds %s', (_label, mutate) => {
    const history = nativeAnnualFixture(); mutate(history);
    expect(financialHistory(history, 'TEST', date, now)).toMatchObject({ valid: false, annualComplete: null, annualGrowth: null });
    expect(annualRule(row(history)).state).toBe('unknown');
    const list = researchListRow(row(history));
    const decoded = decodeResearchIndex(encodeResearchIndex({ as_of_date: date, rows: [row(history)] })).rows[0];
    for (const compact of [list, decoded]) expect(annualRule(compact).state).toBe('unknown');
  });
  it.each([
    ['missing cell', h => { h.annual[1].eps = null; }],
    ['missing year', h => { h.annual.splice(1, 1); }],
    ['wrong period', h => { h.annual[0].end = '2020-12-31'; }],
    ['future period', h => { h.annual[3].end = '2026-12-31'; }],
    ['wrong date', h => { h.as_of_date = '2026-10-01'; }],
  ])('retains unknowns for %s', (_label, mutate) => {
    const history = nativeAnnualFixture(); mutate(history);
    expect(annualRule(row(history)).state).toBe('unknown');
  });
  it('keeps nonpositive bases unknown but completeness known, and latest zero as −100%', () => {
    const history = nativeAnnualFixture('CAD', [-1, 2, 4, 8]);
    expect(annualRule(row(history))).toMatchObject({ state: 'unknown', value: null });
    expect(annualRule(row(history), 'ibd')).toMatchObject({ state: 'pass', value: true });
    expect(financialHistory(nativeAnnualFixture('CAD', [1, 2, 4, 0]), 'TEST', date, now).annualGrowth).toEqual([100, 100, -100]);
  });
  it('retains independent annual/quarterly source clocks and exact expiry boundaries', () => {
    const history = nativeAnnualFixture();
    history.quarterly = [{ end: '2025-06-30', eps: 1, revenue: 100 }, { end: '2026-06-30', eps: 2, revenue: 200 }];
    history.quarterly_retrieved_at = history.retrieved_at = '2026-10-04T10:00:00.000Z';
    const quarterEnd = Date.parse(history.quarterly_retrieved_at) + 72 * 3600000, annualEnd = quarterEnd + 3600000;
    expect(nativeAnnualHistoryContract(history, 'TEST')).toBe(true);
    expect(financialHistory(history, 'TEST', date, quarterEnd)).toMatchObject({ epsYoY: 100, annualGrowth: [100, 100, 100] });
    expect(financialHistory(history, 'TEST', date, quarterEnd + 1)).toMatchObject({ epsYoY: null, annualGrowth: [100, 100, 100] });
    expect(financialHistory(history, 'TEST', date, annualEnd + 1)).toMatchObject({ valid: false, annualGrowth: null });
    expect(financialHistory(history, 'TEST', date, Date.parse('2026-10-02T20:00:00Z')).valid).toBe(false);
    const input = row(history); delete input.financial_current;
    expect(financialNextExpiry([input], now)).toBe(quarterEnd + 1);
    expect(financialNextExpiry([input], quarterEnd + 1)).toBe(annualEnd + 1);
    const timeline = prepareReadinessTimeline([input]);
    expect(timeline(annualEnd + 1)).toBe(timeline(annualEnd) + 1);
  });
  it('keeps current applicability rejection ahead of native histories', () => {
    const input = row(nativeAnnualFixture());
    expect(currentFinancialHistory(input.financial_history, 'TEST', date, now, { ...input, symbol: 'BITU', company_name: 'Different issuer' }).annualGrowth).toBeNull();
  });
});

it('keeps list/detail/chart payload decisions, filters, CSV and presentation consistent', () => {
  const input = row(nativeAnnualFixture());
  const list = researchListRow(input);
  const decoded = decodeResearchIndex(encodeResearchIndex({ as_of_date: date, rows: [input] })).rows[0];
  const detail = mergeFinancialDetail(decoded, input, { now, asOfDate: date });
  expect(decoded.financial_history).toEqual(list.financial_history);
  for (const candidate of [input, list, decoded, detail]) {
    expect(annualRule(candidate)).toEqual(annualRule(input));
    expect(filterStaticScanRows([candidate], { market: 'US', currency: 'USD' }, now).map(value => value.symbol)).toEqual(['TEST']);
    const csv = researchCsv(rankCandidates([candidate], 'oneil', { now }), 'oneil', date, now);
    expect(csv).toContain('報告希薄化EPS・CAD');
    expect(csv).toContain('株式分割・ADR');
    const evidence = buildFinancialEvidencePresentation(candidate, { method: 'oneil', date, generation: 'current', now });
    const output = financialEvidencePresentation({ evidence, history: candidate.financial_history, symbol: 'TEST', date, generation: 'current', method: 'oneil', now });
    expect(output.rows.find(value => value.id === 'annual_eps_growth_3y')).toMatchObject({ state: 'pass', actual: '100% → 100% → 100%', unit: 'percent_points（CAD報告希薄化EPSから算出した年次成長率）' });
  }
  const previous = selectionSnapshot([input], { as_of: '2026-10-01', rule_version: 'old' }, now);
  const current = selectionSnapshot([input], { as_of: date, rule_version: 'new' }, now);
  expect(compareSnapshots(current, previous).oneil.items[0]).toMatchObject({ state: 'incomparable', changes: [] });
});
