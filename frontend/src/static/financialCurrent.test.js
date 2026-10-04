import { describe, expect, it } from 'vitest';
import fixtures from '../../../contracts/static_financial_current_fixtures_v1.json';
import contract from '../../contracts/static_financial_current_v1.json';
import {
  FINANCIAL_DEPENDENT_FIELDS,
  FINANCIAL_FIELDS,
  financialNextExpiry,
  hasFinancialCurrentFields,
  mergeFinancialDetail,
  projectFinancialPayload,
  projectFinancialRow,
} from './financialCurrent';

const now = Date.parse('2026-10-01T12:00:00Z');
const observedAt = Date.parse('2026-09-30T12:00:00Z');
const expiresAt = observedAt + contract.source_max_age_ms;
const provenRow = (value = 0) => ({
  symbol: 'TEST', market: 'US', as_of_date: '2026-10-01', eps_growth_qq: value,
  financial_current: {
    v: 2, t: now, s: 'TEST', m: 'US', a: '2026-10-01', r: '0222222222222222',
    p: { 0: [value, '0', 'Diluted EPS', ['2026-06-30', '2026-03-31'], observedAt, expiresAt, value > 0 ? 'g' : value < 0 ? 'd' : 'u', 'r'] },
  },
});
const project = (row, options = {}) => projectFinancialRow(row, { now, ...options });
const state = (row, field = 'eps_growth_qq') => row.financial_current_state.fields[field];
const freezeDeep = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
};
const fixtureClock = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : NaN;
};

describe('financial current shared producer/browser contract', () => {
  it('uses the canonical field order', () => {
    expect(FINANCIAL_FIELDS).toEqual(fixtures.field_order);
    expect(FINANCIAL_FIELDS).toEqual(contract.field_order);
  });

  it.each(fixtures.cases)('$id', ({ now: clock, as_of_date: asOfDate, row, expected }) => {
    // Python owns source/digest validation. The browser consumes the exact
    // exported summary, including authoritative reasons for unavailable data.
    const input = structuredClone({ ...row, financial_current: expected.compact });
    const before = structuredClone(input);
    freezeDeep(input);
    const result = projectFinancialRow(input, { now: fixtureClock(clock), asOfDate });
    expect(Object.fromEntries(FINANCIAL_FIELDS.map((field) => [field, result[field]]))).toEqual(expected.values);
    expect(Object.fromEntries(FINANCIAL_FIELDS.map((field) => [field, state(result, field).reason ?? 'available']))).toEqual(expected.reasons);
    expect(result.financial_current_state.next_expiry_at).toBe(expected.next_expiry_at);
    expect(input).toEqual(before);
    const nextTransition = expected.next_expiry_at === null ? null : expected.next_expiry_at + 1;
    expect(financialNextExpiry([{ ...input, as_of_date: asOfDate }], fixtureClock(clock))).toBe(nextTransition);
  });
});

describe('financial current compact proof tampering', () => {
  it.each([0, -5, 125.5])('preserves supported finite growth and matching aliases: %s', (value) => {
    const input = { ...provenRow(value), eps_growth_quarterly: value };
    const result = project(input);
    expect(result.eps_growth_qq).toBe(value);
    expect(result.eps_growth_quarterly).toBe(value);
    expect(state(result)).toMatchObject({ value, availability: 'current', reason: null, unit: 'percent_points', basis: 'quarterly_qoq/v1' });
  });

  it.each([null, undefined, true, false, '0', '-5', NaN, Infinity, [], {}])('never coerces a scalar or proof value into a financial number: %s', (value) => {
    const scalar = provenRow();
    scalar.eps_growth_qq = value;
    const proof = provenRow();
    proof.financial_current.p[0][0] = value;
    for (const row of [scalar, proof]) {
      expect(project(row).eps_growth_qq).toBeNull();
      expect(state(project(row)).availability).toBe('unknown');
    }
  });

  it.each([
    ['missing proof', (row) => { delete row.financial_current; }, 'missing_evidence'],
    ['old version', (row) => { row.financial_current.v = 0; }, 'invalid_envelope'],
    ['unknown summary key', (row) => { row.financial_current.unit = 'ratio'; }, 'invalid_envelope'],
    ['short reason vector', (row) => { row.financial_current.r = '0'; }, 'invalid_envelope'],
    ['unknown reason code', (row) => { row.financial_current.r = 'z222222222222222'; }, 'invalid_envelope'],
    ['missing available proof', (row) => { delete row.financial_current.p[0]; }, 'invalid_envelope'],
    ['extra unavailable proof', (row) => { row.financial_current.p[1] = row.financial_current.p[0]; }, 'invalid_envelope'],
    ['extra tuple field', (row) => { row.financial_current.p[0].push('percent_points'); }, 'invalid_envelope'],
    ['numeric contract ID', (row) => { row.financial_current.p[0][1] = 0; }, 'unsupported_contract'],
    ['unknown contract/unit', (row) => { row.financial_current.p[0][1] = 'ratio/v1'; }, 'unsupported_contract'],
    ['wrong derivation contract', (row) => { row.financial_current.p[0][1] = '1'; }, 'unsupported_contract'],
    ['wrong source metric', (row) => { row.financial_current.p[0][2] = 'Total Revenue'; }, 'unsupported_contract'],
    ['mismatched scalar', (row) => { row.eps_growth_qq = 45; }, 'value_mismatch'],
    ['alias conflict with zero', (row) => { row.eps_growth_quarterly = 45; }, 'alias_conflict'],
    ['future source', (row) => { row.financial_current.p[0][4] = now + 1; }, 'future_source_timestamp'],
    ['excess source TTL', (row) => { row.financial_current.p[0][5] = expiresAt + 1; }, 'invalid_envelope'],
    ['impossible period', (row) => { row.financial_current.p[0][3][0] = '2026-02-30'; }, 'invalid_reporting_period'],
    ['future reporting period', (row) => { row.financial_current.p[0][3] = ['2026-12-31', '2026-09-30']; }, 'invalid_reporting_period'],
    ['reversed periods', (row) => { row.financial_current.p[0][3].reverse(); }, 'invalid_reporting_period'],
    ['duplicate periods', (row) => { row.financial_current.p[0][3][1] = '2026-06-30'; }, 'invalid_reporting_period'],
    ['gapped periods', (row) => { row.financial_current.p[0][3][1] = '2025-12-31'; }, 'invalid_reporting_period'],
    ['cross symbol', (row) => { row.symbol = 'OTHER'; }, 'identity_mismatch'],
    ['cross market', (row) => { row.market = 'HK'; }, 'identity_mismatch'],
    ['cross snapshot', (row) => { row.as_of_date = '2026-09-30'; }, 'identity_mismatch'],
  ])('withholds %s', (_label, mutate, reason) => {
    const input = provenRow();
    mutate(input);
    const result = project(input);
    expect(result.eps_growth_qq).toBeNull();
    expect(state(result)).toMatchObject({ availability: 'unknown', reason });
  });

  it.each([null, '2026-10-01', true, {}, NaN, Infinity])('rejects an invalid evaluation clock: %s', (clock) => {
    expect(state(project(provenRow(), { now: clock }))).toMatchObject({ value: null, reason: 'invalid_evaluation_context' });
  });

  it('does not accept a matching proof for a future as-of date', () => {
    const input = provenRow();
    input.as_of_date = '2026-10-02';
    input.financial_current.a = input.as_of_date;
    expect(state(project(input))).toMatchObject({ value: null, reason: 'invalid_evaluation_context' });
  });

  it('does not allow an explicit context to hide a mismatched row as-of date', () => {
    const input = provenRow();
    input.as_of_date = '2026-09-30';
    expect(project(input, { asOfDate: '2026-10-01' }).eps_growth_qq).toBeNull();
  });

  it.each([null, '', true, 42, {}, []])('rejects malformed matching identity fields: %s', (identity) => {
    const symbolInput = provenRow();
    symbolInput.symbol = identity;
    symbolInput.financial_current.s = identity;
    const marketInput = provenRow();
    marketInput.market = identity;
    marketInput.financial_current.m = identity;
    expect(project(symbolInput).eps_growth_qq).toBeNull();
    expect(project(marketInput).eps_growth_qq).toBeNull();
  });
});

describe('financial projection ownership and expiry', () => {
  it('preserves immutable raw history and technical evidence while quarantining dependent scores', () => {
    const history = { annual: [{ end: '2025-12-31', eps: -1 }], quarterly: [{ end: '2026-06-30', eps: 0 }] };
    const technical = { score: 95, passes: true };
    const input = {
      ...provenRow(), financial_history: history, current_price: 123, rs_rating: 90, passes_template: true,
      ...Object.fromEntries(FINANCIAL_DEPENDENT_FIELDS.map((field) => [field, field === 'rating' ? 'Strong Buy' : 99])),
      code33: false,
    };
    for (const key of ['screener_results', 'screener_details', 'screeners']) input[key] = { minervini: { score: 95, passes: true }, canslim: { score: 95 }, IPO: { passes: true }, custom: { rating: 'Buy' }, setup_engine: technical };
    const before = structuredClone(input);
    freezeDeep(input);

    const result = project(input);
    expect(result).toMatchObject({ eps_growth_qq: 0, current_price: 123, rs_rating: 90, passes_template: true, code33: null });
    for (const field of FINANCIAL_DEPENDENT_FIELDS) expect(result[field]).toBeNull();
    for (const key of ['screener_results', 'screener_details', 'screeners']) {
      for (const name of ['minervini', 'canslim', 'IPO', 'custom']) expect(result[key][name]).toMatchObject({ score: null, passes: null, rating: null, status: 'unknown' });
      expect(result[key].setup_engine).toBe(technical);
    }
    expect(result.financial_history).toBe(history);
    expect(result.financial_historical.values.eps_growth_qq).toBe(0);
    expect(result.financial_historical.values.composite_score).toBe(99);
    expect(result.financial_historical.values.code33).toBe(false);
    expect(input).toEqual(before);
  });

  it('expires at one millisecond past the deadline and cannot revive values from retained proof/history', () => {
    const input = provenRow(-5);
    const current = project(input, { now: expiresAt });
    expect(current.eps_growth_qq).toBe(-5);
    expect(current.financial_current_state.next_expiry_at).toBe(expiresAt);
    expect(financialNextExpiry([input], expiresAt)).toBe(expiresAt + 1);
    const expired = project(current, { now: expiresAt + 1 });
    expect(state(expired)).toMatchObject({ value: null, reason: 'stale_source' });
    expect(financialNextExpiry([expired], expiresAt + 1)).toBeNull();
    expect(project(expired).eps_growth_qq).toBeNull();
    expect(expired.financial_historical).toBe(current.financial_historical);
    expect(expired.financial_historical.values.eps_growth_qq).toBe(-5);
    expect(input.eps_growth_qq).toBe(-5);
  });

  it('does not freeze or mutate the caller-owned proof while protecting its own projection', () => {
    const input = provenRow();
    const result = project(input);
    expect(Object.isFrozen(result.financial_current)).toBe(true);
    expect(Object.isFrozen(result.financial_current_state)).toBe(true);
    expect(Object.isFrozen(input.financial_current)).toBe(false);
    expect(Object.isFrozen(input.financial_current.p[0][3])).toBe(false);
    input.financial_current.p[0][3][0] = '2026-09-30';
    expect(result.financial_current.p[0][3][0]).toBe('2026-06-30');
  });

  it.each([
    ['scalar', (row) => { row.eps_growth_qq = 42; }],
    ['alias', (row) => { row.eps_growth_quarterly = 42; }],
    ['symbol', (row) => { row.symbol = 'OTHER'; }],
    ['market', (row) => { row.market = 'HK'; }],
    ['row snapshot', (row) => { row.as_of_date = '2026-09-30'; }],
    ['technical snapshot', (row) => { row.technical_audit = { as_of_date: '2026-09-30' }; }],
  ])('invalidates same-clock projection reuse after changing the %s', (_label, mutate) => {
    const projected = project(provenRow());
    mutate(projected);
    expect(project(projected, { asOfDate: '2026-10-01', market: 'US' }).eps_growth_qq).toBeNull();
  });

  it.each([
    ['proof replacement', row => { row.financial_current = { ...row.financial_current, m: 'HK' }; }],
    ['source contract', row => { const proof = structuredClone(row.financial_current); proof.p[0][1] = 'unknown'; row.financial_current = proof; }],
    ['state replacement', row => { row.financial_current_state = { ...row.financial_current_state }; }],
    ['identity evidence', row => { row.financial_identity = { symbol: 'OTHER' }; }],
    ['observed instrument identity', row => { row.instrument_identity = { observed_contexts: [{ company_name: 'Changed issuer' }] }; }],
    ['nested scanner replacement', row => { row.screeners = { canslim: { score: 100, passes: true } }; }],
  ])('retains the owned-row invalidation boundary for %s', (_label, mutate) => {
    const projected = project(provenRow(25));
    expect(project(projected)).toBe(projected);
    mutate(projected);
    const result = project(projected);
    expect(result).not.toBe(projected);
    expect(result).toEqual(project(structuredClone(projected)));
  });

  it('revalidates on forward and backward clock changes within the source lifetime', () => {
    const projected = project(provenRow(25));
    for (const clock of [now + 1, now - 1]) {
      const result = project(projected, { now: clock });
      expect(result).not.toBe(projected);
      expect(result).toEqual(project(structuredClone(projected), { now: clock }));
      expect(result.financial_current_state.evaluated_at).toBe(clock);
    }
  });

  it('preserves supplied context and same-clock reuse with deeply immutable input', () => {
    const input = provenRow(25);
    delete input.market;
    delete input.as_of_date;
    const projected = project(freezeDeep(input), { market: 'US', asOfDate: '2026-10-01' });
    expect(projected.eps_growth_qq).toBe(25);
    expect(project(freezeDeep(projected), { market: 'US', asOfDate: '2026-10-01' })).toBe(projected);
    expect(project(projected, { market: 'HK', asOfDate: '2026-10-01' }).eps_growth_qq).toBeNull();
  });

  it('does not trust public projection state on an unowned raw row', () => {
    const input = provenRow(42);
    delete input.financial_current;
    input.financial_current_state = project(provenRow()).financial_current_state;
    expect(project(input).eps_growth_qq).toBeNull();
  });

  it('schedules the earliest financial history or compact proof transition', () => {
    const input = provenRow();
    input.financial_history = {
      symbol: 'TEST', as_of_date: input.as_of_date, retrieved_at: new Date(observedAt).toISOString(),
      status: 'available', basis: 'reported_diluted_eps', currency: 'USD', source:'yfinance',
      annual: [{ end: '2025-12-31', eps: 2 }], quarterly: [],
    };
    const historyTransition = observedAt + 72 * 3600000 + 1;
    expect(financialNextExpiry([input], now)).toBe(historyTransition);
    expect(financialNextExpiry([input], historyTransition)).toBe(expiresAt + 1);
  });

  it('projects nested current payload paths while preserving historical records and bars', () => {
    const row = provenRow();
    const history = { eps_growth_qq: 88 };
    const payload = { as_of_date: '2026-10-01', market: 'US', bars: [{ close: 100 }], financial_history: history, saved_models: [history] };
    for (const key of ['rows', 'initial_rows', 'results', 'members', 'stocks', 'top_stocks', 'top_symbols']) payload[key] = [row];
    for (const key of ['payload', 'stock_data', 'fundamentals']) payload[key] = row;
    const result = projectFinancialPayload(freezeDeep(payload), { now: expiresAt + 1 });
    for (const key of ['rows', 'initial_rows', 'results', 'members', 'stocks', 'top_stocks', 'top_symbols']) expect(result[key][0].eps_growth_qq).toBeNull();
    for (const key of ['payload', 'stock_data', 'fundamentals']) expect(result[key].eps_growth_qq).toBeNull();
    expect(result.financial_history).toBe(history);
    expect(result.saved_models).toBe(payload.saved_models);
    expect(result.bars).toBe(payload.bars);
    expect(row.eps_growth_qq).toBe(0);
  });

  it('recognizes only protected current fields and safely preserves nonobject inputs', () => {
    expect(hasFinancialCurrentFields({ eps_growth_qq: 0 })).toBe(true);
    expect(hasFinancialCurrentFields({ financial_current: {} })).toBe(true);
    expect(hasFinancialCurrentFields({ financial_history: { eps_growth_qq: 10 }, current_price: 123 })).toBe(false);
    for (const value of [null, undefined, 0, false, 'TEST']) {
      expect(hasFinancialCurrentFields(value)).toBe(false);
      expect(projectFinancialRow(value, { now })).toBe(value);
    }
  });
});

describe('financial detail merge boundaries', () => {
  const options = { now, generation: 'new', detailGeneration: 'new', expectedDetailPath: 'detail/new.json', detailPath: 'detail/new.json' };

  it('retains list financial ownership while merging matched technical detail', () => {
    const summary = { ...provenRow(0), current_price: 123, price_quality: { summary: true } };
    const detail = { ...provenRow(99), current_price: 999, eps_rating: 95, price_quality: { detail: true }, new_technical: 'available' };
    const result = mergeFinancialDetail(freezeDeep(summary), freezeDeep(detail), options);
    expect(result).toMatchObject({ eps_growth_qq: 0, current_price: 123, eps_rating: null, new_technical: 'available', price_quality: { summary: true, detail: true } });
    expect(result.financial_current).toEqual(summary.financial_current);
  });

  it.each([
    ['symbol', { symbol: 'OTHER' }, {}],
    ['date', { as_of_date: '2026-09-30' }, {}],
    ['market', { market: 'HK' }, {}],
    ['generation', {}, { detailGeneration: 'old' }],
    ['path', {}, { detailPath: 'detail/old.json' }],
  ])('ignores a detail with mismatched %s', (_label, detailChanges, optionChanges) => {
    const summary = provenRow();
    const detail = { ...provenRow(99), new_technical: 'wrong detail', ...detailChanges };
    const result = mergeFinancialDetail(summary, detail, { ...options, ...optionChanges });
    expect(result.eps_growth_qq).toBe(0);
    expect(result.new_technical).toBeUndefined();
  });

  it('never fills missing list proof or a missing scalar from financially richer detail', () => {
    const missingProof = provenRow();
    delete missingProof.financial_current;
    const missingScalar = provenRow();
    delete missingScalar.eps_growth_qq;
    for (const summary of [missingProof, missingScalar, project(provenRow(), { now: expiresAt + 1 })]) {
      const result = mergeFinancialDetail(summary, provenRow(), options);
      expect(result.eps_growth_qq).toBeNull();
      expect(result.eps_growth_quarterly).toBeNull();
    }
    expect(mergeFinancialDetail(null, provenRow(), options)).toBeNull();
  });

  it('ignores detail metadata from a different proof generation even for the same snapshot and path', () => {
    const summary = provenRow();
    const detail = { ...provenRow(), new_technical: 'older generation' };
    detail.financial_current.t -= 1;
    const result = mergeFinancialDetail(summary, detail, options);
    expect(result.eps_growth_qq).toBe(0);
    expect(result.new_technical).toBeUndefined();
  });
});


describe('EPS comparison semantics', () => {
  const comparisonRow = (value, comparison, reason = 'f') => {
    const row = provenRow(value);
    row.financial_current.r = reason + row.financial_current.r.slice(1);
    row.financial_current.p[0][6] = comparison;
    return row;
  };
  it.each([
    [50, 'l', 'loss_narrowing'], [150, 't', 'turnaround'], [-100, 'w', 'loss_widening'],
    [0, 's', 'loss_unchanged'], [100, 'b', 'break_even'],
  ])('keeps source-valid %s reference separate from %s ordinary-growth eligibility', (value, code, comparison) => {
    const input = comparisonRow(value, code);
    const result = project(input);
    expect(result.eps_growth_qq).toBeNull();
    expect(result.eps_growth_quarterly).toBeNull();
    expect(state(result)).toMatchObject({ value: null, availability: 'unknown', reason: 'nonpositive_comparison_base', reference_value: value, comparison, source_validated: true, ordinary_growth_eligible: false });
    expect(result.financial_historical.values.eps_growth_qq).toBe(value);
    expect(input.eps_growth_qq).toBe(value);
    expect(state(project(result, { now: now + 1 }))).toMatchObject({ comparison, reference_value: value });
    const detail = { ...input, new_technical: true };
    expect(state(mergeFinancialDetail(result, detail, { now }))).toMatchObject({ comparison, reference_value: value, value: null });
    expect(state(project(result, { now: expiresAt + 1 }))).toMatchObject({ reason: 'stale_source', value: null });
  });
  it.each([[-150, 'n', 'new_loss'], [-100, 'z', 'profit_to_zero'], [50, 'g', 'profitable_growth'], [-50, 'd', 'profitable_decline'], [0, 'u', 'profitable_unchanged']])('retains a positive-base %s value and exact %s classification', (value, code, comparison) => {
    expect(state(project(comparisonRow(value, code, '0')))).toMatchObject({ value, comparison, availability: 'current', ordinary_growth_eligible: true });
  });
  it.each([
    ['negative-base promoted to available', 50, 'l', '0'],
    ['profitable growth with negative percentage', -50, 'g', '0'],
    ['new loss with growth percentage', 50, 'n', '0'],
    ['growth fabricated for a zero baseline', 50, '0', 'f'],
    ['EPS mislabeled as revenue', 50, 'G', '0'],
    ['profitable decline beyond zero earnings', -150, 'd', '0'],
    ['unchanged with growth percentage', 50, 'u', '0'],
  ])('rejects %s', (_label, value, comparison, reason) => {
    expect(state(project(comparisonRow(value, comparison, reason)))).toMatchObject({ value: null, reason: 'invalid_source_inputs' });
  });
  it('retains only a validated reference across copies and rejects missing/conflicting scalars or old proof', () => {
    const result = project(comparisonRow(50, 'l'));
    expect(state(project({ ...result }, { now: now + 1 }))).toMatchObject({ value: null, comparison: 'loss_narrowing', reference_value: 50 });
    const missing = { ...result }; delete missing.eps_growth_qq;
    expect(state(project(missing))).toMatchObject({ reason: 'missing_or_invalid_value' });
    expect(state(project({ ...result, eps_growth_qq: 99 }))).toMatchObject({ reason: 'value_mismatch' });
    const unproven = { ...result }; delete unproven.financial_current;
    expect(state(project(unproven))).toMatchObject({ value: null, reason: 'missing_evidence' });
    expect(state(project(unproven))).not.toHaveProperty('reference_value');
    const old = comparisonRow(50, 'l');
    old.financial_current.v = 1;
    old.financial_current.r = '0' + old.financial_current.r.slice(1);
    old.financial_current.p[0] = old.financial_current.p[0].slice(0, 6);
    expect(state(project(old))).toMatchObject({ value: null, reason: 'invalid_envelope' });
  });
  it('does not invent comparison metadata from an unsupported percentage-only value', () => {
    const input = { symbol: 'TEST', market: 'US', as_of_date: '2026-10-01', eps_growth_qq: 50 };
    const result = project(input);
    expect(state(result)).not.toHaveProperty('comparison');
    expect(state(result)).not.toHaveProperty('source_validated');
    expect(result.financial_historical.values.eps_growth_qq).toBe(50);
  });
});

it('retains clipping metadata and rejects an unapproved heuristic calculation', () => {
  const fixture=fixtures.cases.find(item=>item.id==='clipped-growth');
  const input={...fixture.row,financial_current:structuredClone(fixture.expected.compact)};
  const row=projectFinancialRow(input,{now:fixtureClock(fixture.now),asOfDate:fixture.as_of_date});
  expect(row.financial_current_state.fields.eps_q1_yoy).toMatchObject({value:500,comparison:'profitable_growth',clipped:true,calculation:'clipped_percent_change'});
  input.financial_current.p[6][7]='heuristic';
  expect(projectFinancialRow(input,{now:fixtureClock(fixture.now),asOfDate:fixture.as_of_date}).financial_current_state.fields.eps_q1_yoy).toMatchObject({value:null,reason:'invalid_source_inputs'});
});


it('does not revive rejected comparison references from the null written by a previous projection', () => {
  const row = provenRow(50), field = 'eps_growth_qq';
  row.financial_current.r = 'f' + row.financial_current.r.slice(1);
  row.financial_current.p[0][6] = 'l';
  row[field] = 999999;
  const first = projectFinancialRow(row, {now});
  expect(first.financial_current_state.fields[field].reason).toBe('value_mismatch');
  for (const input of [first, JSON.parse(JSON.stringify(first))]) {
    const again = projectFinancialRow(input, {now:now+1});
    expect(again.financial_current_state.fields[field].source_validated).not.toBe(true);
    expect(again.financial_current_state.fields[field].reference_value).toBeUndefined();
    expect(again[field]).toBeNull();
  }
});

it('drops a packed summary added to an owned current projection', () => {
  const row = projectFinancialRow({symbol:'SUMMARY',market:'US',as_of_date:'2026-10-02'}, {now:Date.parse('2026-10-03T00:00:00Z')});
  row.method_summary = {version:'forged',oneil:[8,8]};
  expect(projectFinancialRow(row,{now:row.financial_current_state.evaluated_at}).method_summary).toBeUndefined();
});

it.each([
  ['BITU', 'ProShares Ultra Bitcoin ETF'],
  ['SBIT', 'ProShares UltraShort Bitcoin ETF'],
  ['ETHE', 'Grayscale Ethereum Staking ETF'],
])('keeps %s historical nulls, absent slots and original values exact through browser re-projection', (symbol, company_name) => {
  for (const conflicted of [false, true]) for (const snapshot of [
    {},
    { values: { eps_growth_yy: 17 }, current_proof: null, financial_history: null, book_financials: null },
    { values: { eps_growth_yy: 17 }, source_evidence: { legacy: 'source' }, current_proof: { legacy: 'proof' }, financial_history: { symbol, legacy: 'history' }, book_financials: { legacy: 'book' }, legacy_scanners: { canslim: { score: 17 } } },
  ]) {
    const current = { ...provenRow(), symbol, company_name: conflicted ? 'Another issuer' : company_name,
      financial_history: { symbol, current: 'history' }, book_financials: { current: 'book' } };
    const input = { ...current, financial_historical: structuredClone(snapshot) }, before = JSON.stringify(input);
    freezeDeep(input);
    const first = project(input);
    expect(first.instrument_applicability.status).toBe(conflicted ? 'quarantined' : 'not_applicable');
    expect(first.financial_historical).toEqual(snapshot);
    expect(project(JSON.parse(JSON.stringify(first)), { now: now + 1000 }).financial_historical).toEqual(snapshot);
    const payload = projectFinancialPayload({ symbol, market: 'US', as_of_date: input.as_of_date, stock_data: JSON.parse(JSON.stringify(first)) }, { now });
    expect(payload.stock_data.financial_historical).toEqual(snapshot);
    expect(JSON.stringify(input)).toBe(before);
    // With no saved snapshot, the original evidence is captured once.
    const original = project(current);
    expect(original.financial_historical.current_proof).toEqual(current.financial_current);
    expect(original.financial_historical.financial_history).toEqual(current.financial_history);
    expect(original.financial_historical.book_financials).toEqual(current.book_financials);
  }
});
