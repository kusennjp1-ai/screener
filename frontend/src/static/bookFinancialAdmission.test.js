import { describe, expect, it } from 'vitest';
import { admitBookFinancials, SEC_UNAVAILABLE_REASONS } from './bookFinancialAdmission';
import { DERIVED_Q4 } from './bookFinancialEvidence';
import { secRecord, secUnavailable } from '../test/fixtures/secRecord';

const asOfDate = '2026-02-01', evaluatedAt = Date.parse('2026-02-01T12:00:00Z');
const context = (extra = {}) => ({ symbol: 'TEST', asOfDate, evaluatedAt, row: { symbol: 'TEST', market: 'US', quoteType: 'EQUITY' }, ...extra });
const admit = (value, extra) => admitBookFinancials(value, context(extra));

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
