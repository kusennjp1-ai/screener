// Synthetic contract cases only; never a retained financial-data input.
export const holderSymbol = 'SYNTH';
export const holderAsOf = '2026-10-09';
export const holderEvidence = () => ({
  symbol: holderSymbol, status: 'available', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-08-31',
  observations: [
    { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
    { period: '2026-06-30', manager_count: 110, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
  ],
});
const changed = update => { const data = holderEvidence(); update(data); return data; };
const plusDays = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
// Filing dates below are synthetic controls, never an inferred publication date.
export function holderPeriodPair(previous, current) {
  const asOf = plusDays(current, 45);
  return { asOf, data: { ...holderEvidence(), publication_cutoff: asOf,
    observations: [previous, current].map((period, index) => ({ period, manager_count: 100 + index * 10,
      filing_date_first: plusDays(period, 1), filing_date_last: plusDays(period, 30) })),
  } };
}
export const validHolderQuarterPairs = [
  ['2025-12-31', '2026-03-31'], ['2026-03-31', '2026-06-30'],
  ['2026-06-30', '2026-09-30'], ['2026-09-30', '2026-12-31'],
  ['2023-12-31', '2024-03-31'],
];
export const invalidHolderCases = () => [
  ...[['2026-03-30', '2026-06-29'], ['2026-03-31', '2026-06-29'], ['2026-03-30', '2026-06-30'],
    ['2026-04-01', '2026-07-01'], ['2026-02-28', '2026-05-31'], ['2024-02-29', '2024-05-31'],
    ['2025-12-30', '2026-03-30']].map(([previous, current]) => ({ name: `non-quarter-end pair ${previous}/${current}`, ...holderPeriodPair(previous, current) })),
  ...[null, undefined, '', false, 0, NaN, Infinity, [], 'available'].map((data, index) => ({ name: `invalid envelope ${index}`, data })),
  { name: 'array masquerading as envelope', data: Object.assign([], holderEvidence()) },
  ...[null, undefined, {}, '', [], [holderEvidence().observations[0]], [...holderEvidence().observations, holderEvidence().observations[1]]].map((observations, index) => ({ name: `invalid observations container ${index}`, data: { ...holderEvidence(), observations } })),
  ...[0, 1].flatMap(index => [null, undefined, '', false, 0, '100', [], {}].map((value, kind) => ({
    name: `invalid observation ${index}/${kind}`, data: changed(data => { data.observations[index] = value; }),
  }))),
  ...[0, 1].map(index => ({ name: `array masquerading as observation ${index}`, data: changed(data => { data.observations[index] = Object.assign([], data.observations[index]); }) })),
  ...[0, 1].map(index => ({ name: `missing own slot ${index}`, data: changed(data => { delete data.observations[index]; }) })),
  { name: 'both slots absent', data: { ...holderEvidence(), observations: Array(2) } },
  { name: 'inherited missing slot cannot restore evidence', data: changed(data => {
    const previous = data.observations[0]; delete data.observations[0];
    Object.setPrototypeOf(data.observations, Object.assign(Object.create(Array.prototype), { 0: previous }));
  }) },
  ...[0, 1].flatMap(index => [null, undefined, '', '0', '100', false, NaN, Infinity, -Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1].map((value, kind) => ({
    name: `invalid count ${index}/${kind}`, data: changed(data => { data.observations[index].manager_count = value; }),
  }))),
  ...['period', 'filing_date_first', 'filing_date_last'].flatMap(field => [null, undefined, 20260630, '', '2026-02-30', '2026-6-30', '2026-06-30T00:00:00Z'].map((value, kind) => ({
    name: `invalid ${field}/${kind}`, data: changed(data => { data.observations[1][field] = value; }),
  }))),
  { name: 'filing precedes reported period', data: changed(data => { data.observations[1].filing_date_first = '2026-06-29'; }) },
  { name: 'reversed filing range', data: changed(data => { data.observations[1].filing_date_last = '2026-07-09'; }) },
  { name: 'filing beyond publication cutoff', data: changed(data => { data.observations[1].filing_date_last = '2026-09-01'; }) },
  { name: 'duplicate period same count', data: changed(data => { data.observations[1] = { ...data.observations[0] }; }) },
  { name: 'duplicate period conflicting count', data: changed(data => { data.observations[1] = { ...data.observations[0], manager_count: 110 }; }) },
  { name: 'reversed periods', data: changed(data => { data.observations.reverse(); }) },
  { name: 'missing intervening quarter', data: changed(data => { data.observations[0].period = '2025-12-31'; }) },
  { name: 'wrong unit', data: { ...holderEvidence(), unit: 'shares' } },
  { name: 'wrong security', data: { ...holderEvidence(), symbol: 'OTHER' } },
  { name: 'missing symbol on both sides', data: { ...holderEvidence(), symbol: undefined }, symbol: undefined },
  { name: 'blank symbol on both sides', data: { ...holderEvidence(), symbol: '' }, symbol: '' },
  { name: 'whitespace symbol on both sides', data: { ...holderEvidence(), symbol: ' ' }, symbol: ' ' },
  { name: 'numeric symbol on both sides', data: { ...holderEvidence(), symbol: 123 }, symbol: 123 },
  { name: 'unavailable status', data: { ...holderEvidence(), status: 'unavailable' } },
  ...[null, '', '2026-02-30', '2026-10-10'].map(value => ({ name: `invalid cutoff ${value}`, data: { ...holderEvidence(), publication_cutoff: value } })),
  ...[null, '', '2026-02-30', '2027-02-01', '2026-06-29'].map(value => ({ name: `invalid or stale analysis ${value}`, data: holderEvidence(), asOf: value })),
];

export const holderArguments = entry => [entry.data,
  Object.hasOwn(entry, 'symbol') ? entry.symbol : holderSymbol,
  Object.hasOwn(entry, 'asOf') ? entry.asOf : holderAsOf];
