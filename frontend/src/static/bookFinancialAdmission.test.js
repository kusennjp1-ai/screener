import { describe, expect, it } from 'vitest';
import { admitBookFinancials, admitBookFinancialsDetailed, DERIVATION_GAP_REASONS, INVALID_DETAIL_MESSAGE_MAX, SEC_REFUSAL_REASONS, SEC_UNAVAILABLE_REASONS } from './bookFinancialAdmission';
import { DERIVED_Q4 } from './bookFinancialEvidence';
import { secRecord, secUnavailable } from '../test/fixtures/secRecord';
import { DERIVATION_GAP_REASONS as CONTRACT_GAP_REASONS, INVALID_DETAIL_MESSAGE_MAX as CONTRACT_MESSAGE_MAX, secDerivationGaps, secInvalidDetail } from '../test/fixtures/publishedContracts';

const asOfDate = '2026-02-01', evaluatedAt = Date.parse('2026-02-01T12:00:00Z');
const context = (extra = {}) => ({ symbol: 'TEST', asOfDate, evaluatedAt, row: { symbol: 'TEST', market: 'US', quoteType: 'EQUITY' }, ...extra });
const admit = (value, extra) => admitBookFinancials(value, context(extra));

const mutations = [
  ['another symbol', r => { r.symbol = 'OTHER'; }],
  ['another date', r => { r.as_of_date = '2026-01-31'; }],
  ['a filing after the as-of date', r => { r.quarterly.eps.at(-1).filed = '2026-02-02'; }],
  ['a period ending after its filing', r => { r.quarterly.revenue.at(-1).end = '2026-03-01'; r.quarterly.revenue.at(-1).filed = '2026-01-15'; }],
  ['a missing accession', r => { r.quarterly.eps[0].accession = ''; }],
  ['an absent accession', r => { delete r.quarterly.netIncome[0].accession; }],
  ['an unknown form', r => { r.quarterly.eps[0].form = '8-K'; }],
  ['a foreign form', r => { r.quarterly.eps[0].form = '20-F'; }],
  ['a tag of another field', r => { r.quarterly.eps[0].tag = 'Revenues'; }],
  ['a foreign unit', r => { r.quarterly.eps[0].unit = 'EUR/shares'; }],
  ['a source URL of another CIK', r => { r.source = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000002.json'; }],
  ['a CIK that is not a positive integer', r => { r.cik = '1'; }],
  ['a derived EPS', r => { Object.assign(r.quarterly.eps.at(-1), { derived: DERIVED_Q4, components: ['a', 'b', 'c', 'd'] }); }],
  ['a derived Q4 without four components', r => { Object.assign(r.quarterly.revenue.at(-1), { derived: DERIVED_Q4, components: ['a', 'b', 'c'] }); }],
  ['an unnamed derivation', r => { r.quarterly.revenue.at(-1).derived = true; }],
  ['an extra record key', r => { r.extra = 1; }],
  ['an extra point key', r => { r.quarterly.eps[0].note = 'x'; }],
  ['a __proto__ key', r => JSON.parse(JSON.stringify(r).replace('"schema_version"', '"__proto__":{},"schema_version"'))],
  ['a __proto__ point key', r => JSON.parse(JSON.stringify(r).replace('"end"', '"__proto__":{},"end"'))],
  ['a NaN value', r => { r.quarterly.eps[0].value = NaN; }],
  ['a boolean value', r => { r.quarterly.eps[0].value = true; }],
  ['retrieval after the evaluation', r => { r.retrieved_at = '2026-02-01T12:00:01.000Z'; }],
  ['retrieval before the as-of date', r => { r.retrieved_at = '2026-01-31T23:59:59.000Z'; }],
  ['schema version 1', r => { r.schema_version = 1; }],
  ['unordered periods', r => { r.quarterly.eps.reverse(); }],
  ['a duplicated period', r => { r.quarterly.eps[1] = { ...r.quarterly.eps[0] }; }],
  ['a missing quarterly field', r => { delete r.quarterly.receivables; }],
  ['a missing flow start', r => { r.quarterly.revenue[0].start = null; }],
  ['an unknown status', r => { r.status = 'stale'; }],
];

describe('same-day SEC record admission', () => {
  it('admits a valid same-day record as the identical object', () => {
    const record = secRecord();
    expect(admit(record)).toBe(record);
    const derived = secRecord();
    Object.assign(derived.quarterly.revenue.at(-1), { derived: DERIVED_Q4, components: ['a', 'b', 'c', 'd'] });
    expect(admit(derived)).toBe(derived);
    const balance = secRecord();
    balance.quarterly.inventory = [{ end: '2025-12-31', start: null, filed: '2026-01-30', value: 5, tag: 'InventoryNet', unit: 'USD', accession: 'x-1', form: '10-K', derived: false }];
    expect(admit(balance)).toBe(balance);
  });

  for (const [name, mutate] of mutations) it(`rejects ${name}`, () => {
    const record = secRecord();
    const changed = mutate(record) || record;
    expect(admit(changed)).toBeNull();
  });

  it('rejects funds, a missing clock and records for another publication', () => {
    expect(admit(secRecord(), { row: { symbol: 'TEST', market: 'US' } })).not.toBeNull();
    expect(admit(secRecord({ symbol: 'BITU' }), { symbol: 'BITU', row: { symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF' } })).toBeNull();
    expect(admit(secRecord({ symbol: 'BITU' }), { symbol: 'BITU', row: { symbol: 'BITU', market: 'US', company_name: 'Another issuer' } })).toBeNull();
    expect(admit(secRecord(), { evaluatedAt: NaN })).toBeNull();
    expect(admit(secRecord(), { asOfDate: '2026-02-02' })).toBeNull();
    expect(admit(null)).toBeNull();
    expect(admit([secRecord()])).toBeNull();
  });

  it('admits unavailable records only with a listed reason and no data', () => {
    for (const reason of SEC_UNAVAILABLE_REASONS) { const record = secUnavailable({ reason }); expect(admit(record)).toBe(record); }
    const foreign = secUnavailable({ forms: ['20-F', '6-K', '20-F/A'] });
    expect(admit(foreign)).toBe(foreign);
    expect(admit(secUnavailable({ reason: 'unknown' }))).toBeNull();
    expect(admit(secUnavailable({ quarterly: secRecord().quarterly }))).toBeNull();
    expect(admit(secUnavailable({ cik: 1 }))).toBeNull();
    expect(admit(secUnavailable({ forms: ['20-F', 'bad form'] }))).toBeNull();
    expect(admit(secUnavailable({ forms: ['A', 'B', 'C', 'D', 'E', 'F'].map(x => `${x}0-K`) }))).toBeNull();
    const legacy = secUnavailable(); delete legacy.retrieved_at; delete legacy.schema_version;
    expect(admit(legacy)).toBeNull();
  });
});

// Every existing case above, through the detailed admission: the wrapper's value is the same, and the
// refusal names the one existing check that refused the record. No reason is a new rejection rule.
describe('the reason a same-day SEC record was refused', () => {
  const detailed = (value, extra) => admitBookFinancialsDetailed(value, context(extra));
  const reasons = {
    'another symbol': 'symbol', 'another date': 'as_of', 'a filing after the as-of date': 'series:eps', 'a period ending after its filing': 'series:revenue',
    'a missing accession': 'series:eps', 'an absent accession': 'series:netIncome', 'an unknown form': 'series:eps', 'a foreign form': 'series:eps',
    'a tag of another field': 'series:eps', 'a foreign unit': 'series:eps', 'a source URL of another CIK': 'cik_url', 'a CIK that is not a positive integer': 'cik_url',
    'a derived EPS': 'series:eps', 'a derived Q4 without four components': 'series:revenue', 'an unnamed derivation': 'series:revenue',
    'an extra record key': 'keys', 'an extra point key': 'series:eps', 'a __proto__ key': 'keys', 'a __proto__ point key': 'series:eps',
    'a NaN value': 'series:eps', 'a boolean value': 'series:eps', 'retrieval after the evaluation': 'retrieved_window', 'retrieval before the as-of date': 'retrieved_window',
    'schema version 1': 'schema', 'unordered periods': 'series:eps', 'a duplicated period': 'series:eps', 'a missing quarterly field': 'keys',
    'a missing flow start': 'series:revenue', 'an unknown status': 'keys',
  };
  for (const [name, mutate] of mutations) it(`names why it refuses ${name}`, () => {
    const record = secRecord();
    const changed = mutate(record) || record;
    const result = detailed(changed);
    expect(result).toEqual({ value: null, reason: reasons[name] });
    expect(result.value).toBe(admit(changed));
    expect(SEC_REFUSAL_REASONS).toContain(result.reason);
  });

  it('returns the identical record with no reason wherever the wrapper admits it', () => {
    for (const record of [secRecord(), ...SEC_UNAVAILABLE_REASONS.map(reason => secUnavailable({ reason })), secUnavailable({ forms: ['20-F', '6-K', '20-F/A'] })]) {
      const result = detailed(record);
      expect(result).toEqual({ value: record, reason: null });
      expect(result.value).toBe(record);
      expect(result.value).toBe(admit(record));
    }
  });

  it('names funds, a missing clock, another publication and non-records', () => {
    expect(detailed(secRecord({ symbol: 'BITU' }), { symbol: 'BITU', row: { symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF' } })).toEqual({ value: null, reason: 'not_corporate' });
    expect(detailed(secRecord(), { evaluatedAt: NaN })).toEqual({ value: null, reason: 'retrieved_window' });
    expect(detailed(secRecord(), { asOfDate: '2026-02-02' })).toEqual({ value: null, reason: 'as_of' });
    expect(detailed(secRecord(), { symbol: '' })).toEqual({ value: null, reason: 'symbol' });
    expect(detailed(null)).toEqual({ value: null, reason: 'keys' });
    expect(detailed([secRecord()])).toEqual({ value: null, reason: 'keys' });
    const record = secRecord(); delete record.retrieved_at;
    expect(detailed(record)).toEqual({ value: null, reason: 'retrieved_window' });
    const annual = secRecord(); annual.annualEps = [{ ...annual.quarterly.eps[0], form: '8-K' }];
    expect(detailed(annual)).toEqual({ value: null, reason: 'series:annualEps' });
    const limits = secRecord(); limits.limitations = [''];
    expect(detailed(limits)).toEqual({ value: null, reason: 'keys' });
    // A schema-1 file (as the 11-03 publication carried) is refused as schema, never silently.
    const legacy = secUnavailable(); delete legacy.retrieved_at; delete legacy.schema_version;
    expect(detailed(legacy)).toEqual({ value: null, reason: 'schema' });
    for (const [record, reason] of [[secUnavailable({ reason: 'unknown' }), 'keys'], [secUnavailable({ quarterly: secRecord().quarterly }), 'keys'], [secUnavailable({ forms: ['20-F', 'bad form'] }), 'keys']]) {
      expect(detailed(record)).toEqual({ value: null, reason });
      expect(admit(record)).toBeNull();
    }
  });
});

describe('the round-2 record additions (plan §2.3): optional, and admitted only in their documented shape', () => {
  const gaps = [{ fiscal_year: 2024, metric: 'revenue', reason: 'tag_mismatch' }, { fiscal_year: 2025, metric: 'netIncome', reason: 'broken_chain' }, { fiscal_year: 2025, metric: 'revenue', reason: 'no_annual' }];
  it('admits a record with or without derivation_gaps, and refuses a malformed list as keys', () => {
    const record = secRecord();
    expect(admit(record)).toBe(record);
    const listed = { ...secRecord(), derivation_gaps: gaps };
    expect(admit(listed)).toBe(listed);
    expect(admit({ ...secRecord(), derivation_gaps: [] })).not.toBeNull();
    for (const bad of [null, {}, [{ ...gaps[0], reason: 'gap' }], [{ ...gaps[0], metric: 'eps' }], [{ ...gaps[0], fiscal_year: '2024' }], [{ ...gaps[0], extra: 1 }], [gaps[0], gaps[0]],
      Array.from({ length: 25 }, (_, i) => ({ fiscal_year: 2000 + i, metric: 'revenue', reason: 'no_annual' }))]) {
      expect(admitBookFinancialsDetailed({ ...secRecord(), derivation_gaps: bad }, context())).toEqual({ value: null, reason: 'keys' });
    }
  });

  const detail = { class: 'PayloadMismatch', message: 'companyfacts cik does not match the requested cik', requested_cik: 6, received_cik: 999 };
  it('admits the published contract examples, with the contract reasons and message limit', () => {
    expect(DERIVATION_GAP_REASONS).toEqual(CONTRACT_GAP_REASONS);
    expect(INVALID_DETAIL_MESSAGE_MAX).toBe(CONTRACT_MESSAGE_MAX);
    expect(admit({ ...secRecord(), derivation_gaps: structuredClone(secDerivationGaps) })).not.toBeNull();
    expect(admit(secUnavailable({ reason: 'invalid_payload', invalid_detail: { ...secInvalidDetail } }))).not.toBeNull();
  });

  it('admits invalid_detail only on an invalid_payload record, in its shape', () => {
    const value = secUnavailable({ reason: 'invalid_payload', invalid_detail: detail });
    expect(admit(value)).toBe(value);
    expect(admit(secUnavailable({ reason: 'invalid_payload', invalid_detail: { ...detail, received_cik: null } }))).not.toBeNull();
    expect(admit(secUnavailable({ reason: 'invalid_payload' }))).not.toBeNull();
    for (const bad of [{ reason: 'transient', invalid_detail: detail }, { reason: 'invalid_payload', invalid_detail: { ...detail, message: 'x'.repeat(201) } },
      { reason: 'invalid_payload', invalid_detail: { ...detail, message: '' } }, { reason: 'invalid_payload', invalid_detail: { ...detail, class: 'bad class' } },
      { reason: 'invalid_payload', invalid_detail: { ...detail, requested_cik: 0 } }, { reason: 'invalid_payload', invalid_detail: { ...detail, received_cik: '999' } },
      { reason: 'invalid_payload', invalid_detail: { ...detail, headers: {} } }]) {
      expect(admitBookFinancialsDetailed(secUnavailable(bad), context())).toEqual({ value: null, reason: 'keys' });
    }
  });
});
