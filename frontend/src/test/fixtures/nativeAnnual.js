export const nativeAnnualFixture = (currency = 'CAD', values = [1, 2, 4, 8]) => ({
  schema_version: 'provider-reported-native-annual-eps-v1', symbol: 'TEST', as_of_date: '2026-10-02',
  retrieved_at: '2026-10-04T11:00:00.000Z', source: 'Synthetic provider', status: 'available', basis: 'reported_diluted_eps',
  currency, annual_currency: currency, quarterly_currency: 'USD', quarterly_retrieved_at: null,
  annual_source: { symbol: 'TEST', metric: 'annualDilutedEPS', currency, unit: 'reporting_currency_per_provider_share',
    share_basis: 'provider_reported_split_adr_unverified', attribute: 'income_stmt', receipt_sha256: 'a'.repeat(64),
    raw_payload_sha256: 'b'.repeat(64), capture_id: 'original-annual-capture', observed_at: '2026-10-04T11:00:00.000Z' },
  annual: values.map((eps, i) => ({ end: `${2022 + i}-12-31`, eps })), quarterly: [],
});
