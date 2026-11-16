import { describe, expect, it } from 'vitest';
import { admitBookFinancials, admitBookFinancialsDetailed, DERIVATION_GAP_REASONS, INVALID_DETAIL_MESSAGE_MAX, q4ReferenceEntryValid, SEC_Q4_REFERENCE_MAX, SEC_Q4_REFERENCE_METHOD, SEC_Q4_REFERENCE_TAGS, SEC_REFUSAL_REASONS, SEC_UNAVAILABLE_REASONS } from './bookFinancialAdmission';
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

// Round 3 D3 (plan §5): the 独自計算・参考 fiscal-Q4 EPS is an optional, strict key. A record without it is admitted exactly as
// before; any malformed entry refuses the whole record with the existing reason 'keys' (no new refusal reason).
describe('round-3 D3: the optional q4EpsReference key', () => {
  // A 10-K filer: its fiscal Q4 EPS (each December quarter) is only in the annual report, so quarterly.eps has no point there.
  const tenK = () => { const record = secRecord(); record.quarterly.eps = record.quarterly.eps.filter(p => !p.end.endsWith('12-31')); return record; };
  const entry = (end, start, value = 1.36, extra = {}) => ({ end, start, value, method: SEC_Q4_REFERENCE_METHOD,
    numerator: { tag: 'NetIncomeLoss', components: ['k-1', 'q-1', 'q-2', 'q-3'] }, shares: { tag: 'WeightedAverageNumberOfDilutedSharesOutstanding', components: ['k-1', 'q-1', 'q-2', 'q-3'] }, ...extra });
  const entries = () => [entry('2024-12-31', '2024-10-01', 1.02), entry('2025-12-31', '2025-10-01', 1.36)];
  const withReference = (list = entries(), record = tenK()) => ({ ...record, q4EpsReference: list });
  const detailed = value => admitBookFinancialsDetailed(value, context());

  it('mirrors the producer: one method, the numerator and share tags, at most four entries; the refusal reasons are unchanged', () => {
    expect(SEC_Q4_REFERENCE_METHOD).toBe('q4-ni-over-q4-diluted-shares-v1');
    expect(SEC_Q4_REFERENCE_TAGS).toEqual({ numerator: ['NetIncomeLossAvailableToCommonStockholdersDiluted', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLoss'],
      shares: ['WeightedAverageNumberOfDilutedSharesOutstanding'] });
    expect(SEC_Q4_REFERENCE_MAX).toBe(4);
    expect(SEC_REFUSAL_REASONS).toEqual(['schema', 'symbol', 'as_of', 'retrieved_window', 'keys', 'cik_url', 'series:eps', 'series:revenue', 'series:netIncome', 'series:inventory', 'series:receivables', 'series:annualEps', 'not_corporate']);
  });

  it('admits a valid list as the identical record, and a record without the key exactly as before', () => {
    const listed = withReference();
    expect(detailed(listed)).toEqual({ value: listed, reason: null });
    expect(admit(listed)).toBe(listed);
    for (const tag of SEC_Q4_REFERENCE_TAGS.numerator) {
      const value = withReference([entry('2025-12-31', '2025-10-01', -0.25, { numerator: { tag, components: ['a', 'b', 'c', 'd'] } })]);
      expect(admit(value)).toBe(value);
    }
    // Four entries, one per fiscal year; a partial record may carry it too.
    const four = secRecord({ quarters: [['2022-10-01', '2022-12-31'], ['2023-10-01', '2023-12-31'], ['2024-10-01', '2024-12-31'], ['2025-10-01', '2025-12-31']], eps: [], revenue: [10, 11, 12, 13], netIncome: [1, 1, 1, 1] });
    four.status = 'partial';
    const full = { ...four, q4EpsReference: ['2022', '2023', '2024', '2025'].map(year => entry(`${year}-12-31`, `${year}-10-01`)) };
    expect(admit(full)).toBe(full);
    // The same record without the key: the identical admission as before D3.
    for (const record of [secRecord(), tenK()]) expect(detailed(record)).toEqual({ value: record, reason: null });
  });

  const bad = [
    ['an extra entry key', list => { list[0].note = 'x'; }],
    ['a missing entry key', list => { delete list[1].start; }],
    ['a missing numerator', list => { delete list[1].numerator; }],
    ['a __proto__ entry key', list => JSON.parse(JSON.stringify(list).replace('"end"', '"__proto__":{},"end"'))],
    ['another method', list => { list[1].method = 'q4-ni-over-q4-basic-shares-v1'; }],
    ['a numerator tag outside the list', list => { list[1].numerator.tag = 'ProfitLoss'; }],
    ['a share tag outside the list', list => { list[1].shares.tag = 'WeightedAverageNumberOfSharesOutstandingBasic'; }],
    ['an extra key in the shares', list => { list[1].shares.unit = 'shares'; }],
    ['three components', list => { list[1].numerator.components = ['a', 'b', 'c']; }],
    ['five components', list => { list[1].shares.components = ['a', 'b', 'c', 'd', 'e']; }],
    ['an empty component', list => { list[1].numerator.components[2] = ' '; }],
    ['a NaN value', list => { list[1].value = NaN; }],
    ['an infinite value', list => { list[1].value = Infinity; }],
    ['a value as text', list => { list[1].value = '1.36'; }],
    ['an end after the as-of date', list => { list.push(entry('2026-03-31', '2026-01-01')); }],
    ['a start after its end', list => { list[1].start = '2026-01-01'; }],
    ['a quarter longer than 105 days', list => { list[1].start = '2025-09-01'; }],
    ['a quarter shorter than 70 days', list => { list[1].start = '2025-11-01'; }],
    ['an invalid day', list => { list[1].end = '2025-12-32'; }],
    ['unordered ends', list => list.reverse()],
    ['a repeated end', list => { list[0] = entry('2025-12-31', '2025-10-01'); }],
    // Ordered and well formed, but 2025-09-30's EPS is reported: a reported EPS is never shadowed.
    ['an end that has a reported EPS point', list => { list[0] = entry('2025-09-30', '2025-07-01'); }],
    ['more than four entries', () => ['2021', '2022', '2023', '2024', '2025'].map(year => entry(`${year}-12-31`, `${year}-10-01`))],
    ['an empty list', () => []],
    ['an entry that is not an object', list => { list[0] = 1.02; }],
  ];
  for (const [name, mutate] of bad) it(`refuses ${name} as keys`, () => {
    const list = entries();
    const changed = mutate(list) || list;
    const record = withReference(changed);
    expect(detailed(record)).toEqual({ value: null, reason: 'keys' });
    expect(admit(record)).toBeNull();
  });

  it('refuses a list that is not an array, and the key on an unavailable record', () => {
    // (Spread, not withReference: its default would fill an undefined list.)
    for (const value of [null, {}, entry('2025-12-31', '2025-10-01'), 'q4', undefined]) expect(detailed({ ...tenK(), q4EpsReference: value })).toEqual({ value: null, reason: 'keys' });
    for (const reason of SEC_UNAVAILABLE_REASONS) expect(detailed(secUnavailable({ reason, q4EpsReference: entries() }))).toEqual({ value: null, reason: 'keys' });
  });

  it('keeps every existing reason first, and a derived EPS point in quarterly.eps is still refused as series:eps', () => {
    for (const record of [secRecord(), withReference()]) {
      Object.assign(record.quarterly.eps.at(-1), { derived: DERIVED_Q4, components: ['a', 'b', 'c', 'd'] });
      expect(detailed(record)).toEqual({ value: null, reason: 'series:eps' });
    }
    expect(detailed({ ...withReference(), symbol: 'OTHER' })).toEqual({ value: null, reason: 'symbol' });
    const broken = withReference([]); broken.quarterly.eps[0].form = '8-K';
    expect(detailed(broken)).toEqual({ value: null, reason: 'series:eps' });
    const unknown = withReference(); unknown.quarterly = { ...unknown.quarterly, extra: [] };
    expect(detailed(unknown)).toEqual({ value: null, reason: 'keys' });
  });

  it('q4ReferenceEntryValid: the one entry check the card reader shares', () => {
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-10-01'), '2026-02-01')).toBe(true);
    // Both ends count: 70 and 105 days are quarters, 69 and 106 are not.
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-10-23'), '2026-02-01')).toBe(true);
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-10-24'), '2026-02-01')).toBe(false);
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-09-18'), '2026-02-01')).toBe(true);
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-09-17'), '2026-02-01')).toBe(false);
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-10-01'), '2025-12-30')).toBe(false);
    expect(q4ReferenceEntryValid(entry('2025-12-31', '2025-10-01'), null)).toBe(false);
    expect(q4ReferenceEntryValid(null, '2026-02-01')).toBe(false);
  });
});
