import registry from '../../contracts/financial_instrument_applicability_v1.json' with { type: 'json' };

export const INSTRUMENT_APPLICABILITY_VERSION = registry.schema_version;
export const FINANCIAL_APPLICABLE_UNIVERSE_VERSION = 'us-corporate-financial-applicable-v1';
export const INSTRUMENT_IDENTITY_FIELDS = Object.freeze(['symbol', 'market', 'company_name', 'name', 'product_name', 'cusip', 'isin', 'cik', 'issuer_cik', 'quoteType', 'quote_type', 'financial_identity', 'instrument_identity']);
const text = value => typeof value === 'string' && value.trim() !== '';
const name = value => text(value) ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : null;
const identifier = (value, kind) => {
  if (!(text(value) || (kind === 'cik' && Number.isSafeInteger(value) && value >= 0))) return null;
  const normalized = String(value).trim().toUpperCase();
  return kind === 'cik' && /^\d{1,10}$/.test(normalized) ? normalized.padStart(10, '0') : normalized;
};
const identityContexts = row => [row, row.financial_identity, row.instrument_identity, ...(Array.isArray(row.instrument_identity?.observed_contexts) ? row.instrument_identity.observed_contexts : []), row.financial_source_evidence?.identity, row.financial_history, row.book_financials, row.financial_historical?.financial_history, row.financial_historical?.book_financials, row.financial_historical?.source_evidence?.identity, row.financial_historical?.detail_identity, row.institutional_evidence].filter(value => value && typeof value === 'object');
const observedFields = ['symbol', 'market', 'company_name', 'name', 'product_name', 'observed_name', 'cusip', 'isin', 'cik', 'issuer_cik', 'quoteType', 'quote_type', 'observed_identifiers'];
export function instrumentIdentityEvidence(row) {
  // Preserve conflicting observed identity through compact transport when full
  // historical reports are moved to detail. Registry identifiers are excluded.
  return [...new Map(identityContexts(row).map(value => {
    const evidence = Object.fromEntries(observedFields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
    return [JSON.stringify(evidence), evidence];
  })).values()].filter(value=>Object.keys(value).length);
}
const records = new Map(registry.records.map(record => [record.symbol, record]));

// A bounded reviewed registry, never an ETF/name heuristic. Supplied public
// status flags and registry identifiers are not observed identity evidence.
export function instrumentApplicability(row = {}) {
  if (!row || typeof row !== 'object') row = {};
  const record = records.get(row.symbol);
  const base = { version: INSTRUMENT_APPLICABILITY_VERSION, status: 'unverified', instrument_class: 'unknown', reason: 'instrument_type_unverified', identity_binding: 'unverified' };
  if (!record) return base;
  const contexts = identityContexts(row);
  const names = contexts.flatMap(value => [value.company_name, value.product_name, value.observed_name, value.name]).filter(text);
  const conflicts = [];
  if (row.market !== record.market || contexts.some(value => value.market != null && value.market !== record.market)) conflicts.push('market_conflict');
  if (contexts.some(value => value.symbol != null && value.symbol !== record.symbol)) conflicts.push('symbol_conflict');
  if (!names.length) conflicts.push('missing_product_name');
  else if (names.some(value => name(value) !== name(record.name))) conflicts.push('product_name_conflict');
  const matched = [];
  for (const kind of ['cusip', 'isin', 'cik']) {
    const expected = identifier(record[kind], kind);
    const values = contexts.flatMap(value => [value[kind], kind === 'cik' ? value.issuer_cik : null, value.observed_identifiers?.[kind]]).filter(value => value != null && value !== '');
    if (expected && values.some(value => identifier(value, kind) !== expected)) conflicts.push(`${kind}_conflict`);
    else if (expected && values.length) matched.push(kind);
  }
  const evidence = { source: record.source, verified_at: registry.verified_at, registry_name: record.name, identity_match_limit: record.identity_match_limit };
  if (conflicts.length) return { ...base, ...evidence, status: 'quarantined', reason: 'instrument_identity_conflict', identity_conflicts: conflicts };
  return { ...base, ...evidence, status: 'not_applicable', instrument_class: record.instrument_class, reason: 'verified_fund_not_corporate_growth',
    identity_binding: matched.length ? 'ticker_name_and_available_identifiers' : 'ticker_name_only', matched_identifiers: matched };
}

export const corporateFinancialsAllowed = row => instrumentApplicability(row).status === 'unverified';
export const instrumentApplicabilityLabel = value => value?.status === 'not_applicable' ? '株式手法の対象外（確認済みファンド）' : value?.status === 'quarantined' ? '銘柄の同一性が不一致・判定保留' : null;

export function applicabilityUniverse(rows) {
  const exclusions = [], quarantined = [];
  const liquid = rows.filter(row => (row.market === 'US' || !row.market) && Number.isFinite(row.current_price) && row.current_price >= 10 && Number.isFinite(row.adv_usd) && row.adv_usd >= 20000000);
  for (const row of liquid) {
    const applicability = instrumentApplicability(row);
    const entry = { market: row.market, symbol: row.symbol, reason: applicability.reason, source: applicability.source, identity_binding: applicability.identity_binding };
    if (applicability.status === 'not_applicable') exclusions.push(entry);
    if (applicability.status === 'quarantined') quarantined.push({ ...entry, identity_conflicts: applicability.identity_conflicts });
  }
  return { version: FINANCIAL_APPLICABLE_UNIVERSE_VERSION, applicability_version: INSTRUMENT_APPLICABILITY_VERSION,
    price_universe_version: 'us-published-equities-price10-adv20m-v1', published_price_rows_count: rows.length, price_liquidity_count: liquid.length, financial_applicable_count: liquid.length - exclusions.length - quarantined.length,
    verified_fund_exclusions: exclusions, identity_quarantines: quarantined,
    scope: 'Price/liquidity rows are retained. Financial-applicable count excludes reviewed funds and quarantines; remaining instrument types are unverified.' };
}
