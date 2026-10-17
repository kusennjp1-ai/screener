import { describe, expect, it } from 'vitest';
import { oneilSourceDiagnostics } from './oneilSourceDiagnostics.js';
import { assess, rankCandidates, researchCsv, entryPlan } from './researchEngine.js';
import { entryReadiness } from './entryReadiness.js';
import { withFinancialProof } from './testFinancialFixture.js';
import { withAuditFixture } from './testAuditFixture.js';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual.js';

const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
const input = (values = [1, 1.2, 1.5, 2], sales = 20) => withFinancialProof(withAuditFixture({ symbol: 'TEST', market: 'US',
  financial_history: nativeAnnualFixture('CAD', values), sales_growth_yy: sales, eps_growth_yy: 30,
  current_price: 104, se_pivot_price: 100, rs_rating: 95, adv_usd: 50000000,
  market_above_50dma: true, market_above_200dma: true }, date), now, date);
const diagnose = (row, at = now) => oneilSourceDiagnostics(row, { date, now: at });
const stampAnnual = (row, timestamp) => { row.financial_history.annual_source.observed_at = row.financial_history.retrieved_at = timestamp; return row; };

describe('admitted history and unchanged strict app conditions', () => {
  it('shows source pass beside strict annual fail without changing the row or decisions', () => {
    const row = input(), original = structuredClone(row);
    const before = assess(row, 'oneil', now);
    expect(before.rules[2].state).toBe('fail');
    const result = diagnose(row);
    expect(result.annual).toMatchObject({ state: 'pass', cagr: { state: 'pass' }, eachYear: { state: 'pass' },
      source: 'Synthetic provider', observedAt: '2026-10-04T11:00:00.000Z', currency: 'CAD', period: '2022-12-31 ～ 2025-12-31' });
    expect(result.annual.cagr.value).toBeCloseTo(25.9921, 4);
    expect(result.annual.eachYear.comparisons[0]).toMatchObject({ from: '2022-12-31', to: '2023-12-31', previous: 1, latest: 1.2, growth: 20 });
    expect(row).toEqual(original); expect(assess(row, 'oneil', now)).toEqual(before);
  });
  it('keeps a down year and unchanged year from passing even when CAGR passes', () => {
    for (const values of [[1, 2, 1.5, 2.5], [1, 1, 1.5, 2.5]]) {
      expect(diagnose(input(values)).annual).toMatchObject({ state: 'fail', cagr: { state: 'pass' }, eachYear: { state: 'fail' } });
    }
  });
  it('uses the existing USD contract without upgrading it to native-source metadata', () => {
    const row = input();
    row.financial_history = { symbol: 'TEST', as_of_date: date, source: 'Synthetic existing USD history',
      status: 'available', currency: 'USD', basis: 'reported_diluted_eps', retrieved_at: '2026-10-04T11:00:00Z',
      annual: row.financial_history.annual, quarterly: [] };
    expect(diagnose(row).annual).toMatchObject({ state: 'pass', currency: 'USD' });
    expect(diagnose(row).annual.limitations).toContain('株式分割・ADR');
    row.financial_history.currency = 'EUR';
    expect(diagnose(row).annual.state).toBe('unknown');
  });
  it.each([
    ['missing unit', h => { delete h.annual_source.unit; }],
    ['unknown unit', h => { h.annual_source.unit = 'cents'; }],
    ['mixed currency', h => { h.annual_currency = 'USD'; }],
    ['unknown currency', h => { h.currency = h.annual_currency = h.annual_source.currency = 'XYZ'; }],
    ['subunit mismatch', h => { h.currency = h.annual_currency = h.annual_source.currency = 'GBp'; }],
    ['wrong metric', h => { h.annual_source.metric = 'annualBasicEPS'; }],
    ['wrong share basis', h => { h.annual_source.share_basis = 'adjusted_by_app'; }],
    ['missing receipt', h => { delete h.annual_source.receipt_sha256; }],
    ['missing capture', h => { h.annual_source.capture_id = ''; }],
    ['wrong basis', h => { h.basis = 'adjusted_eps'; }],
    ['wrong symbol', h => { h.symbol = 'OTHER'; }],
    ['wrong source symbol', h => { h.annual_source.symbol = 'OTHER'; }],
    ['wrong date', h => { h.as_of_date = '2026-10-01'; }],
    ['unknown source', h => { h.source = 'unknown'; }],
    ['unknown status', h => { h.status = 'unavailable'; }],
    ['per-cell unit claim', h => { h.annual[0].unit = 'CAD'; }],
    ['per-cell currency claim', h => { h.annual[0].currency = 'CAD'; }],
    ['wrong version', h => { h.schema_version = 'future'; }],
  ])('rejects %s using the existing metadata contract', (_name, mutate) => {
    const row = input(); mutate(row.financial_history);
    expect(diagnose(row).annual).toMatchObject({ state: 'unknown', cagr: { value: null } });
  });
  it.each([
    ['missing year', h => { h.annual.splice(1, 1); }],
    ['null EPS', h => { h.annual[1].eps = null; }],
    ['string EPS', h => { h.annual[1].eps = '1.2'; }],
    ['boolean EPS', h => { h.annual[1].eps = true; }],
    ['infinite EPS', h => { h.annual[1].eps = Infinity; }],
    ['missing EPS', h => { delete h.annual[1].eps; }],
    ['nonpositive first', h => { h.annual[0].eps = 0; }],
    ['negative middle', h => { h.annual[1].eps = -1; }],
    ['zero endpoint', h => { h.annual[3].eps = 0; }],
    ['duplicate date', h => { h.annual[1].end = h.annual[0].end; }],
    ['unordered date', h => { h.annual.reverse(); }],
    ['future period', h => { h.annual[3].end = '2027-12-31'; }],
    ['invalid calendar', h => { h.annual[1].end = '2023-02-30'; }],
    ['short period', h => { h.annual[1].end = '2023-06-30'; }],
    ['long period', h => { h.annual[1].end = '2024-06-30'; }],
    ['stale analysis period', h => { h.annual.forEach(p => { p.end = `${Number(p.end.slice(0, 4)) - 3}${p.end.slice(4)}`; }); }],
    ['sparse annual', h => { delete h.annual[1]; }],
    ['null annual record', h => { h.annual[1] = null; }],
    ['array annual record', h => { h.annual[1] = []; }],
    ['sparse unrelated quarter', h => { h.quarterly = [{ end: '2026-03-31' }, { end: '2026-04-30' }, { end: '2026-06-30' }]; delete h.quarterly[1]; }],
    ['inherited annual slot', h => { const p = Object.create(Array.prototype); p[1] = h.annual[1]; delete h.annual[1]; Object.setPrototypeOf(h.annual, p); }],
    ['inherited EPS', h => { const eps = h.annual[1].eps; delete h.annual[1].eps; Object.setPrototypeOf(h.annual[1], { eps }); }],
    ['inherited period', h => { const end = h.annual[1].end; delete h.annual[1].end; Object.setPrototypeOf(h.annual[1], { end }); }],
  ])('does not repair %s', (_name, mutate) => {
    const row = input(); mutate(row.financial_history);
    expect(() => diagnose(row)).not.toThrow();
    expect(diagnose(row).annual).toMatchObject({ state: 'unknown', cagr: { value: null } });
  });
  it('observes exact 72h source expiry and rejects a future observation', () => {
    const row = input(), deadline = Date.parse(row.financial_history.retrieved_at) + 72 * 3600000;
    expect(diagnose(row).nextCheckAt).toBe(deadline + 1);
    expect(diagnose(row, deadline).annual.state).toBe('pass');
    expect(diagnose(row, deadline + 1).annual).toMatchObject({ state: 'unknown', reason: 'stale_annual_source' });
    stampAnnual(row, '2026-10-04T12:00:00.001Z');
    expect(diagnose(row).annual).toMatchObject({ state: 'unknown', reason: 'future_annual_source' });
  });
  it('keeps the live annual reporting-period age bound even for freshly reobserved old data', () => {
    const row = input(), deadline = Date.parse('2025-12-31') + 551 * 86400000 - 1;
    stampAnnual(row, new Date(deadline - 3600000).toISOString());
    expect(diagnose(row, deadline - 1).nextCheckAt).toBe(deadline + 1);
    expect(diagnose(row, deadline).annual.state).toBe('pass');
    expect(diagnose(row, deadline + 1).annual).toMatchObject({ state: 'unknown', reason: 'stale_reporting_period' });
  });
  it('does not use legacy annual scalar or book evidence as missing-history rescue', () => {
    const row = input(); delete row.financial_history;
    row.eps_cagr_3y = 100; row.annual_eps_growth_3y = [100, 100, 100]; row.book_financials = { symbol: 'TEST', annualEps: [1, 2, 4, 8] };
    expect(diagnose(row).annual.state).toBe('unknown');
  });
});

describe('conservative sales diagnostics from current shared proofs only', () => {
  it.each([[24.99, 'fail', 'unknown'], [25, 'unknown', 'unknown'], [25.01, 'pass', 'pass'], [30, 'pass', 'pass'], [0, 'fail', 'unknown'], [-10, 'fail', 'unknown']])(
    'treats certified rounded %s as latest %s and OR %s', (value, branch, overall) => {
      const result = diagnose(input(undefined, value)).sales;
      expect(result).toMatchObject({ state: overall, latest: { state: branch, value }, acceleration: { state: 'unknown', reason: 'unadmitted_sales_comparisons' } });
      expect(result.latest.explanation).toContain(value === 25 ? '丸め前' : '丸め済み');
      expect(assess(input(undefined, value), 'oneil', now).rules[1].state).toBe(value >= 25 ? 'pass' : 'fail');
    });
  it.each([
    ['missing proof', r => { delete r.financial_current; }],
    ['scalar-only', r => { r.financial_current = null; r.sales_growth_yy = 99; }],
    ['scalar mismatch', r => { r.sales_growth_yy = 99; }],
    ['null scalar', r => { r.sales_growth_yy = null; }],
    ['string scalar', r => { r.sales_growth_yy = '30'; }],
    ['boolean scalar', r => { r.sales_growth_yy = true; }],
    ['wrong symbol proof', r => { r.financial_current.s = 'OTHER'; }],
    ['wrong market proof', r => { r.financial_current.m = 'JP'; }],
    ['wrong date proof', r => { r.financial_current.a = '2026-10-01'; }],
    ['wrong contract', r => { r.financial_current.p['3'][1] = '3'; }],
    ['wrong metric', r => { r.financial_current.p['3'][2] = 'Basic EPS'; }],
    ['duplicate periods', r => { r.financial_current.p['3'][3][1] = r.financial_current.p['3'][3][0]; }],
    ['sparse periods', r => { delete r.financial_current.p['3'][3][1]; }],
    ['short periods', r => { r.financial_current.p['3'][3][1] = '2026-06-29'; }],
    ['future observation', r => { r.financial_current.p['3'][4] = now + 1; }],
    ['expired source', r => { r.financial_current.p['3'][5] = now - 1; }],
    ['unsupported schema', r => { r.financial_current.v = 3; }],
    ['missing period metadata', r => { r.financial_current.p['3'][3] = []; }],
  ])('withholds %s without fallback', (_name, mutate) => {
    const row = input(undefined, 30); mutate(row);
    row.financial_source_evidence = { fields: { sales_growth_yy: { value: 99, source_inputs: { current: 199, previous: 100 } } } };
    expect(diagnose(row).sales).toMatchObject({ state: 'unknown', latest: { state: 'unknown', value: null }, acceleration: { state: 'unknown' } });
  });
  it('does not let exact-looking unauthorized fractions cross the rounded proof boundary', () => {
    for (const value of [24.999999999999996, 25.000000000000004]) expect(diagnose(input(undefined, value)).sales.latest).toMatchObject({ state: 'unknown', value: null, reason: 'unsupported_sales_diagnostic_basis' });
  });
  it('rejects clipped and comparison-only values even with a certified reference', () => {
    const clipped = input(undefined, 500); clipped.financial_current.p['3'][7] = 'c';
    expect(diagnose(clipped).sales.latest.state).toBe('unknown');
    const row = input(undefined, 30); row.financial_current.r = row.financial_current.r.slice(0, 3) + 'f' + row.financial_current.r.slice(4);
    row.financial_current.p['3'][6] = 'X';
    expect(diagnose(row).sales.latest).toMatchObject({ state: 'unknown', value: null, reason: 'nonpositive_comparison_base' });
  });
  it('cannot certify a 3-YoY history or book/source_inputs by adding raw data to a valid latest proof', () => {
    const row = input(undefined, 20);
    row.financial_history.quarterly = ['2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'].map((end, i) => ({ end, revenue: [100, 100, 100, 100, 105, 110, 120][i], eps: 1 }));
    row.financial_history.quarterly_retrieved_at = row.financial_history.retrieved_at;
    row.book_financials = { symbol: 'TEST', salesAcceleration: 'pass', quarterly: row.financial_history.quarterly };
    row.financial_source_evidence = { fields: { sales_growth_yy: { source_inputs: [5, 10, 20], current: true } } };
    expect(diagnose(row).sales).toMatchObject({ state: 'unknown', latest: { state: 'fail', value: 20 }, acceleration: { state: 'unknown', comparisons: [] } });
  });
  it('uses the current proof expiry boundary without renewing its clock', () => {
    const row = input(undefined, 30), deadline = row.financial_current.p['3'][5];
    expect(diagnose(row, deadline).sales.latest.state).toBe('pass');
    expect(diagnose(row, deadline + 1).sales.latest).toMatchObject({ state: 'unknown', reason: 'stale_source' });
  });
});

describe('context, quarantine, and unchanged selection', () => {
  it.each([null, undefined, [], 'TEST'])('withholds malformed row %j', row => {
    expect(diagnose(row)).toMatchObject({ annual: { state: 'unknown' }, sales: { state: 'unknown' } });
  });
  it.each([
    ['row date', r => { r.as_of_date = '2026-10-01'; }],
    ['audit date', r => { r.technical_audit.as_of_date = '2026-10-01'; }],
    ['missing market', r => { delete r.market; }],
    ['observed-scope identity', r => { r.financial_identity = { observed_scope: { symbol: 'OTHER' } }; }],
  ])('withholds %s', (_name, mutate) => {
    const row = input(); mutate(row);
    expect(diagnose(row)).toMatchObject({ annual: { state: 'unknown', reason: 'invalid_diagnostic_context' }, sales: { state: 'unknown' } });
  });
  it('keeps invalid/future evaluation contexts unknown', () => {
    for (const timestamp of [NaN, Infinity, '2026-10-04', Date.parse('2026-10-01')]) expect(diagnose(input(), timestamp).annual.state).toBe('unknown');
  });
  it('respects the shared instrument quarantine and never revives preserved history', () => {
    const row = input(undefined, 30); row.symbol = 'BITU'; row.company_name = 'Different issuer';
    row.financial_history.symbol = row.financial_history.annual_source.symbol = row.financial_current.s = 'BITU';
    row.financial_historical = { financial_history: structuredClone(row.financial_history) };
    expect(diagnose(row)).toMatchObject({ annual: { state: 'unknown', reason: 'instrument_identity_conflict' }, sales: { latest: { state: 'unknown', reason: 'instrument_identity_conflict' } } });
  });
  it('leaves every assessment, ordering, CSV byte and entry decision unchanged after diagnosis', () => {
    const rows = [input(), input([1, 2, 1.5, 2.5], 30), input([1, 1.25, 1.5625, 1.953125], 25)];
    rows.forEach((row, i) => { row.symbol = row.financial_current.s = row.financial_history.symbol = row.financial_history.annual_source.symbol = `S${i}`; });
    const sample = () => Object.fromEntries(['minervini', 'minervini2', 'oneil', 'ibd'].map(method => [method, {
      assessments: rows.map(row => assess(row, method, now)), rankings: rankCandidates(rows, method, { now }),
      csv: researchCsv(rankCandidates(rows, method, { now }), method, date, now),
      plans: rows.map(row => entryPlan(row, null, method)), readiness: rows.map(row => entryReadiness(row, date, 'US', now, method)),
    }]));
    const unchanged = structuredClone(rows), before = sample();
    rows.forEach(row => diagnose(row));
    expect(rows).toEqual(unchanged); expect(sample()).toEqual(before);
  });
});
