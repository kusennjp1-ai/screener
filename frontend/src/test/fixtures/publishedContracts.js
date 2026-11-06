// The published fields round 2 adds (plan §2.3), one valid example of each shape and the ways each may
// be absent or malformed, for the tests of the tracks that produce and read them. Synthetic values only,
// never a production observation. Every field is absent from older publications, and a consumer reads
// that absence as 未収録: never 0, never false and never a guess.
// Frozen after step 0, like tests/static/brief-fixture.js: it changes only in step 0 or at integration (I4),
// because several tracks import it (data produces most fields, market produces indices[i].closes).
//
//   rs_line_high       research-index row (tools/export-research.mjs, data); read through publishedRsLineHigh (briefChartModel.js)
//   sec_summary        research-index row (tools/export-research.mjs, data); read through secSummary (fundamentalsExplain.js)
//   se_pattern_primary research-index row, through listFields (tools/export-research.mjs, data)
//   market_context     manifest.markets.US (tools/export-research.mjs, data)
//   indices[i].closes  market-trends asset (tools/export-market-trends.mjs, market)
//   invalid_detail, derivation_gaps   SEC record (tools/sec-financials.py, data)

export const CONTRACT_DATE = '2026-10-02';

/**
 * `rs_line_high`: present only when the row's technical_audit.as_of_date is the analysis date and its chart
 * is certified. `value` is rsLineNewHigh's (briefChartModel.js) on the chart's rs_line, `leading` the last
 * bar's RS-lead rule; either is null when the history is too short or the dates do not match.
 */
export const rsLineHigh = Object.freeze({ value: true, leading: false, as_of_date: CONTRACT_DATE });
export const rsLineHighUnknown = Object.freeze({ value: null, leading: null, as_of_date: CONTRACT_DATE });
/** Malformed values a reader must refuse (publishedRsLineHigh returns null), each with what is wrong. */
export const RS_LINE_HIGH_INVALID = Object.freeze([
  ['not an object', true],
  ['an array', []],
  ['no analysis date', { value: true, leading: false }],
  ['a value that is not true, false or null', { ...rsLineHigh, value: 'true' }],
  ['a missing value (null is the unknown value)', { leading: false, as_of_date: CONTRACT_DATE }],
  ['a leading flag of 0', { ...rsLineHigh, leading: 0 }],
]);

/** `sec_summary` (SecSummary in fundamentalsExplain.js), from the admitted SEC record only. */
export const secSummaryShape = Object.freeze({
  sec_state: 'ok',
  eps_yoy: Object.freeze({ value: 40, end: '2026-06-30' }),
  sales_yoy: Object.freeze({ value: 100, end: '2026-06-30' }),
  code33: Object.freeze({ state: 'unknown', kind: 'q4_eps' }),
  as_of_date: CONTRACT_DATE,
});
/** The same summary with every value unknown: each stays null (a reader shows 未確認, never 0). */
export const secSummaryUnknown = Object.freeze({ sec_state: 'stale', eps_yoy: null, sales_yoy: null, code33: null, as_of_date: CONTRACT_DATE });
/** Malformed summaries a reader must refuse (secSummary returns null), each with what is wrong. */
export const SEC_SUMMARY_INVALID = Object.freeze([
  ['not an object', 'ok'],
  ['an array', []],
  ['no SEC state', { ...secSummaryShape, sec_state: '' }],
  ['no analysis date', { ...secSummaryShape, as_of_date: null }],
  ['an EPS value that is not a number', { ...secSummaryShape, eps_yoy: { value: '40', end: '2026-06-30' } }],
  ['an EPS value without its period', { ...secSummaryShape, eps_yoy: { value: 40 } }],
  ['a sales value of NaN', { ...secSummaryShape, sales_yoy: { value: Number.NaN, end: '2026-06-30' } }],
  ['a missing EPS field (null is the unknown value)', Object.fromEntries(Object.entries(secSummaryShape).filter(([key]) => key !== 'eps_yoy'))],
  ['an unknown Code 33 state', { ...secSummaryShape, code33: { state: 'eligible', kind: null } }],
]);

/** `se_pattern_primary`: the Setup Engine's primary pattern id as published, or null. */
export const sePatternPrimary = 'vcp';

/**
 * `manifest.markets.US.market_context`: from the canonical rows, only when every US row that carries these
 * fields agrees (otherwise the block is null). A missing field is null.
 */
export const marketContext = Object.freeze({
  as_of_date: CONTRACT_DATE,
  regime: 'confirmed_uptrend',
  distribution_days: 3,
  ftd_date: '2026-09-18',
  ftd_days_since: 10,
  exposure_pct: 50,
  guard: null,
  method: 'backend-market-regime-v1',
  source: 'scan-rows',
});
export const marketContextUnknown = Object.freeze({ ...marketContext, distribution_days: null, ftd_date: null, ftd_days_since: null, exposure_pct: null });

/** `market-trends` `indices[i].closes`: at most 300 points, from the same validated bars as that index's distribution count. */
export const INDEX_CLOSES_MAX = 300;
export const indexCloses = Object.freeze([
  Object.freeze({ date: '2026-09-30', close: 18120.5 }),
  Object.freeze({ date: '2026-10-01', close: 18010.25 }),
  Object.freeze({ date: CONTRACT_DATE, close: 18234.56 }),
]);

/**
 * SEC record additions. `invalid_detail` sits on a record whose reason is `invalid_payload`: the exception
 * class, a message of at most 200 characters with no headers or secrets, and the CIKs requested and received.
 */
export const INVALID_DETAIL_MESSAGE_MAX = 200;
export const secInvalidDetail = Object.freeze({ class: 'ValueError', message: 'companyfacts cik does not match the requested cik', requested_cik: 1000001, received_cik: 1000002 });
/** `derivation_gaps`: each fiscal year whose Q4 could not be derived, with why. */
export const DERIVATION_GAP_REASONS = Object.freeze(['tag_mismatch', 'broken_chain', 'no_annual']);
export const secDerivationGaps = Object.freeze([Object.freeze({ fiscal_year: 2025, metric: 'revenue', reason: 'tag_mismatch' })]);
