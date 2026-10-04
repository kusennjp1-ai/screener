import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withSyntheticFinancialProof } from '../test/fixtures/financialCurrent';
import { assess } from './researchEngine';
import { FINANCIAL_PRESENTATION_SCHEMA, financialEvidencePresentation } from './financialEvidencePresentation';

const now = Date.parse('2026-10-03T12:00:00Z');
const context = { symbol: 'TEST', date: '2026-10-02', generation: 'fixture-generation', method: 'oneil', now };
const history = () => ({ symbol: 'TEST', as_of_date: context.date, retrieved_at: '2026-10-03T11:00:00Z',
  status: 'available', basis: 'reported_diluted_eps', currency: 'USD', source: 'Reported EPS test source',
  annual: [2022, 2023, 2024, 2025].map((year, i) => ({ end: `${year}-12-31`, eps: 2 ** i })),
  quarterly: [{ end: '2025-06-30', eps: 1, revenue: 10 }, { end: '2026-06-30', eps: 3, revenue: 20 }] });
const metric = value => ({ value, unit: 'percent_points', availability: 'current', source: 'Bound fixture provider',
  observed_at: '2026-10-03T11:00:00Z', valid_until: '2026-10-10T11:00:00Z', basis: 'legacy_quarter_yoy_percent',
  period_end: '2026-06-30', comparable_period_end: '2025-06-30' });
function fixture(method = 'oneil', value = 30, data = history()) {
  // Conditions come from the existing engine, not a duplicate threshold table.
  const assessment = assess(withSyntheticFinancialProof({ eps_growth_yy: value, sales_growth_yy: value, eps_rating: 98, composite_rating: 99,
    symbol: 'TEST', technical_audit: { as_of_date: context.date }, financial_history: data }), method, now);
  const conditions = {
    eps_growth_yy: assessment.rules.find(r => /四半期 EPS/.test(r.label)),
    sales_growth_yy: assessment.rules.find(r => /売上高 前年/.test(r.label)),
    annual_eps_growth_3y: assessment.rules.find(r => /3年/.test(r.label)),
    eps_rating: assessment.rules.find(r => /^EPS 推計/.test(r.label)),
    composite_rating: assessment.rules.find(r => /^Composite 推計/.test(r.label)),
  };
  const evidence = { schema: FINANCIAL_PRESENTATION_SCHEMA, symbol: 'TEST', as_of_date: context.date,
    generation: context.generation, method, evaluated_at: new Date(now).toISOString(), valid_until: '2026-10-06T11:00:00Z',
    metrics: Object.fromEntries(['eps_growth_yy', 'sales_growth_yy', 'eps_rating', 'composite_rating', 'roe', 'profit_margin'].map(id => [id, { ...metric(value), unit: id.endsWith('_rating') ? 'rating_1_99' : 'percent_points', condition: conditions[id] }])),
    historical: [{ id: 'eps_growth_yy', ...metric(282.48), observed_at: '2026-06-13T12:00:00Z', reason: 'stale_source' }] };
  evidence.metrics.annual_eps_growth_3y = { condition: conditions.annual_eps_growth_3y };
  return { ...context, method, evidence, history: data };
}
const field = (input, id = 'eps_growth_yy') => financialEvidencePresentation(input).rows.find(row => row.id === id);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

it.each([[30, 'pass', '30%'], [0, 'fail', '0%'], [-10, 'fail', '-10%'], [25, 'pass', '25%'], [24.99, 'fail', '24.99%']])('retains the authoritative decision and exact sign for %s', (value, state, actual) => {
  expect(field(fixture('oneil', value))).toMatchObject({ state, actual, required: true, condition: 'C：四半期 EPS 前年同期比 ≥ 25%' });
});

it.each([
  ['source', null, 'missing_source'], ['observed_at', null, 'missing_observed_at'],
  ['period_end', null, 'missing_period'], ['comparable_period_end', null, 'missing_period'],
  ['period_end', '2026-10-04', 'missing_period'], ['comparable_period_end', '2026-06-30', 'missing_period'],
  ['basis', '', 'missing_basis'], ['valid_until', null, 'missing_expiry'],
  ['observed_at', '2026-09-01T11:00:00Z', 'stale_source'],
  ['observed_at', '2026-10-03T12:00:01Z', 'future_source'],
  ['value', null, 'missing_value'], ['value', '30', 'missing_value'],
  ['value', Infinity, 'missing_value'], ['availability', 'unknown', 'unverified_source_lineage'],
])('withholds a current pass when %s is %j', (key, value, reason) => {
  const input = fixture(); input.evidence.metrics.eps_growth_yy[key] = value;
  expect(field(input)).toMatchObject({ state: 'unknown', actual: '未確認', reason });
});

it('accepts the existing seven-day boundary and expires one millisecond later', () => {
  const input = fixture();
  input.evidence.valid_until = '2026-10-10T11:00:00Z';
  input.now = Date.parse(input.evidence.valid_until);
  expect(field(input).state).toBe('pass');
  input.now += 1;
  expect(field(input).state).toBe('unknown');
});

it.each(['symbol', 'as_of_date', 'generation', 'method'])('rejects mismatched %s and hides unrelated historical values', key => {
  const input = fixture(); input.evidence[key] = 'different';
  expect(field(input)).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'identity_mismatch' });
  expect(financialEvidencePresentation(input).historical).toEqual([]);
});

it('rejects an unknown schema, missing explicit clock and a future evaluation', () => {
  const unsupported = fixture(); unsupported.evidence.schema = 'future';
  expect(field(unsupported).reason).toBe('missing_evidence');
  expect(field({ ...fixture(), now: undefined }).reason).toBe('invalid_evaluation_time');
  const future = fixture(); future.evidence.evaluated_at = '2026-10-04T12:00:00Z';
  expect(field(future).reason).toBe('invalid_evaluation_time');
});

it('keeps a stale number only in historical reference, including after projection expiry', () => {
  const input = fixture(); input.now = Date.parse('2026-10-06T11:00:00.001Z');
  const result = financialEvidencePresentation(input);
  expect(result.rows[0]).toMatchObject({ actual: '未確認', state: 'unknown', source: 'Bound fixture provider' });
  expect(result.historical[0]).toMatchObject({ value: '282.48%', observedAt: '2026-06-13T12:00:00Z' });
  expect(result.historical[0]).not.toHaveProperty('state');
});

it('withholds missing or mismatched rule binding without recalculating its threshold', () => {
  const input = fixture(); delete input.evidence.metrics.eps_growth_yy.condition;
  expect(field(input)).toMatchObject({ state: 'unknown', reason: 'missing_condition' });
  input.evidence.metrics.eps_growth_yy.condition = { label: 'from engine', state: 'pass', value: 90 };
  expect(field(input)).toMatchObject({ state: 'unknown', reason: 'value_mismatch' });
});

it.each(['minervini', 'minervini2'])('keeps every financial metric a reference for %s', method => {
  const result = financialEvidencePresentation(fixture(method, -10));
  expect(result.requiredCount).toBe(0);
  expect(result.rows.every(r => r.required === false && r.state !== 'pass' && r.state !== 'fail')).toBe(true);
  expect(result.rows[0]).toMatchObject({ actual: '-10%', state: 'reference', condition: '選定の数値条件なし・参考' });
});

it('requires three financial conditions for O’Neil and five for IBD while keeping ROE/margin references', () => {
  expect(financialEvidencePresentation(fixture()).requiredCount).toBe(3);
  const result = financialEvidencePresentation(fixture('ibd'));
  expect(result.requiredCount).toBe(5);
  expect(result.rows.filter(r => ['roe', 'profit_margin'].includes(r.id)).every(r => !r.required && r.state === 'reference')).toBe(true);
  expect(field(fixture('ibd'), 'eps_rating').condition).toBe('EPS 推計 ≥ 80');
});

it.each(['eps_rating', 'composite_rating'])('does not let %s bypass first-release derivation quarantine', id => {
  const input = fixture('ibd'); input.evidence.metrics[id].verified = true;
  expect(field(input, id)).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'unverified_derivation_and_cohort' });
});

it('distinguishes IBD complete annual history from O’Neil growth, including negative and zero bases', () => {
  for (const firstEps of [-1, 0]) {
    const data = history(); data.annual[0].eps = firstEps;
    expect(field(fixture('ibd', 30, data), 'annual_eps_growth_3y')).toMatchObject({ state: 'pass', actual: '連続4期の年次EPSあり（成長率は比較不可）', condition: '直近3年の EPS 成長履歴が揃う' });
    expect(field(fixture('oneil', 30, data), 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', reason: 'incomparable_annual_growth' });
  }
});

it('preserves an annual growth failure while IBD only requires history completeness', () => {
  const data = history(); data.annual[3].eps = 4;
  expect(field(fixture('oneil', 30, data), 'annual_eps_growth_3y')).toMatchObject({ state: 'fail', actual: '100% → 100% → 0%' });
  expect(field(fixture('ibd', 30, data), 'annual_eps_growth_3y').state).toBe('pass');
});

it('keeps reported quarterly EPS separate from legacy growth scalars', () => {
  const input = fixture(); input.evidence.metrics.eps_growth_yy = null; input.evidence.metrics.sales_growth_yy = null;
  expect(field(input).state).toBe('unknown');
  expect(field(input, 'sales_growth_yy').state).toBe('unknown');
  expect(field(input, 'annual_eps_growth_3y').state).toBe('pass');
});

it('requires source and freshness for annual history and refuses a raw annual scalar substitute', () => {
  const missing = fixture(); delete missing.history.source;
  expect(field(missing, 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', reason: 'missing_source' });
  const stale = fixture(); stale.history.retrieved_at = '2026-09-29T12:00:00Z';
  expect(field(stale, 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', reason: 'invalid_history' });
  const absent = fixture(); absent.history = undefined; absent.evidence.metrics.annual_eps_growth_3y.value = [100, 100, 100];
  expect(field(absent, 'annual_eps_growth_3y').state).toBe('unknown');
});

it('does not mutate any supplied current or historical input', () => {
  const input = fixture(), before = structuredClone(input);
  financialEvidencePresentation(input);
  expect(input).toEqual(before);
});

it.each(['eps_growth_yy', 'sales_growth_yy', 'roe', 'profit_margin'])('requires explicit percent_points for %s without interpreting fractions', id => {
  for (const unit of [undefined, '', 'unknown', 'fraction', '%', 'ratio', 'rating_1_99']) {
    const input = fixture(); input.evidence.metrics[id] = { ...input.evidence.metrics[id], value: 0.3, unit };
    expect(field(input, id)).toMatchObject({ state: 'unknown', actual: '未確認', reason: unit ? 'unit_mismatch' : 'missing_unit' });
  }
  const percent = fixture('minervini'); percent.evidence.metrics[id].value = 0.3;
  expect(field(percent, id)).toMatchObject({ state: 'reference', actual: '0.3%', unit: 'percent_points' });
});

it.each(['eps_rating', 'composite_rating'])('requires explicit rating units for %s and still quarantines valid units', id => {
  const input = fixture('ibd'); input.evidence.metrics[id].unit = 'percent_points';
  expect(field(input, id)).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'unit_mismatch' });
  input.evidence.metrics[id].unit = 'rating_1_99';
  expect(field(input, id).reason).toBe('unverified_derivation_and_cohort');
});

it('does not append percent signs or infer units for historical raw values', () => {
  const input = fixture();
  input.evidence.historical = [undefined, 'unknown', 'fraction', '%', 'percent_points'].map(unit => ({ id: 'roe', value: 0.3, unit }));
  const result = financialEvidencePresentation(input).historical;
  expect(result.slice(0, 4).every(row => row.value === '0.3（単位未確認・原値）')).toBe(true);
  expect(result[4].value).toBe('0.3%');
  input.evidence.historical = [{ id: 'profit_margin', value: 0.0003 }];
  expect(financialEvidencePresentation(input).historical[0].value).toBe('0.0003（単位未確認・原値）');
});

it.each(['unknown', ' UNKNOWN ', '未確認'])('rejects placeholder source %j for current scalar and annual evidence', source => {
  const input = fixture(); input.evidence.metrics.eps_growth_yy.source = source; input.history.source = source;
  expect(field(input)).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'missing_source' });
  expect(field(input, 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'missing_source' });
});

it.each([
  '2026-02-30T11:00:00Z', '2026-02-29T11:00:00Z', '2026-09-31T11:00:00Z',
  '2026-10-03T24:00:00Z', '2026-10-03T11:60:00Z', '2026-10-03T11:00:60Z',
  '2026-10-03T11:00:00+24:00', '2026-10-03T11:00:00+00:60',
])('rejects invalid source, evaluation, and expiry timestamps: %s', invalid => {
  const source = fixture(); source.evidence.metrics.eps_growth_yy.observed_at = invalid;
  expect(field(source)).toMatchObject({ state: 'unknown', reason: 'missing_observed_at' });
  const evaluated = fixture(); evaluated.evidence.evaluated_at = invalid;
  expect(field(evaluated)).toMatchObject({ state: 'unknown', reason: 'invalid_evaluation_time' });
  const expiry = fixture(); expiry.evidence.valid_until = invalid;
  expect(field(expiry)).toMatchObject({ state: 'unknown', reason: 'missing_expiry' });
  const scalarExpiry = fixture(); scalarExpiry.evidence.metrics.eps_growth_yy.valid_until = invalid;
  expect(field(scalarExpiry)).toMatchObject({ state: 'unknown', reason: 'missing_expiry' });
});

it('validates offset timestamps by their local calendar and preserves their actual instant', () => {
  const input = fixture();
  input.evidence.evaluated_at = '2026-10-03T21:00:00+09:00';
  input.evidence.valid_until = '2026-10-10T07:00:00-04:00';
  input.evidence.metrics.eps_growth_yy.observed_at = '2026-10-03T20:00:00.000000+09:00';
  input.evidence.metrics.eps_growth_yy.valid_until = '2026-10-10T07:00:00-04:00';
  expect(field(input)).toMatchObject({ state: 'pass', actual: '30%' });
  input.now = Date.parse('2026-10-10T11:00:00Z');
  expect(field(input).state).toBe('pass');
  input.now += 1;
  expect(field(input).state).toBe('unknown');
});

it('accepts a real leap-day timestamp without normalizing it into another day', () => {
  const input = fixture(); input.evidence.metrics.eps_growth_yy.observed_at = '2024-02-29T11:00:00+09:00';
  expect(field(input).reason).toBe('stale_source');
});

it('rejects a normalized invalid annual acquisition date and keeps the history 72-hour offset boundary', () => {
  const invalid = fixture(); invalid.history.retrieved_at = '2026-09-31T11:00:00Z';
  expect(field(invalid, 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', reason: 'missing_observed_at' });
  const input = fixture(); input.history.retrieved_at = '2026-10-03T20:00:00+09:00';
  input.now = Date.parse('2026-10-06T11:00:00Z');
  expect(field(input, 'annual_eps_growth_3y').state).toBe('pass');
  input.now += 1;
  expect(field(input, 'annual_eps_growth_3y').state).toBe('unknown');
});
