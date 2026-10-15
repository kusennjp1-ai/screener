// Entirely synthetic source bytes/IDs for offline producer and storage tests.
// They are not SEC/OpenFIGI receipts and must never enter a published bundle.
export function institutionalSourceFixture() {
  return { asOfDate: '2026-10-09', symbols: ['AAA'], now: Date.parse('2026-10-11T12:00:00Z'),
    inputHashes: { seed_sha256: 'a'.repeat(64), mapping_sha256: 'b'.repeat(64) },
    seed: { publication_cutoff: '2026-08-31', periods: ['2026-03-31', '2026-06-30'],
      retrieved_at: '2026-09-28T13:52:04.064624+00:00', reports_selected: 100, incomplete_manager_periods: 2,
      archives: [{ file: 'synthetic_form13f.zip', sha256: 'c'.repeat(64) }],
      securities: { '000000001': { name: 'Synthetic AAA', class: 'COM', observations: [
        { period: '2026-03-31', manager_count: 10, filing_date_first: '2026-04-01', filing_date_last: '2026-05-15' },
        { period: '2026-06-30', manager_count: 12, filing_date_first: '2026-07-01', filing_date_last: '2026-08-15' },
      ] } } },
    mapping: { '000000001': { symbol: 'AAA', source: 'OpenFIGI', retrieved_at: '2026-09-28T14:05:00.123456+00:00' } } };
}
