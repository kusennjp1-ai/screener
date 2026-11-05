// Admission of a same-day SEC companyfacts record (tools/sec-financials.py) into a
// published row. Every rule is structural and point-in-time: the record must belong
// to this symbol and publication date, every fact must have been filed on or before
// that date in a named 10-K/10-Q filing, and the source URL must be bound to the CIK.
// Anything else is not repaired or partly kept: the whole record is refused (null).
// Missing facts stay missing; this never creates, fills or reclassifies a value.
import { corporateFinancialsAllowed } from './instrumentApplicability.js';
import { DERIVED_Q4 } from './bookFinancialEvidence.js';

export const SEC_RECORD_SCHEMA = 2;
export const SEC_UNAVAILABLE_REASONS = Object.freeze(['no_cik', 'no_companyfacts', 'no_quarterly', 'transient', 'invalid_payload']);
export const SEC_FORMS = Object.freeze(['10-K', '10-Q', '10-K/A', '10-Q/A']);
// Mirrors TAGS in tools/sec-financials.py (test_sec_financials.py compares them).
export const SEC_FIELD_TAGS = Object.freeze({"eps": [["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], "USD/shares"], "revenue": [["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"], "USD"], "netIncome": [["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"], "USD"], "inventory": [["InventoryNet"], "USD"], "receivables": [["AccountsReceivableNetCurrent", "AccountsNotesAndOtherReceivablesNetCurrent"], "USD"]});
const QUARTERLY_FIELDS = Object.keys(SEC_FIELD_TAGS);
const INSTANT_FIELDS = new Set(['inventory', 'receivables']);
const DERIVABLE_FIELDS = new Set(['revenue', 'netIncome']);
const RECORD_KEYS = ['schema_version', 'symbol', 'cik', 'as_of_date', 'retrieved_at', 'source', 'status', 'quarterly', 'annualEps', 'limitations'];
const UNAVAILABLE_KEYS = new Set(['schema_version', 'symbol', 'as_of_date', 'status', 'reason', 'error', 'retrieved_at', 'forms']);
const POINT_REQUIRED = ['end', 'filed', 'value', 'tag', 'unit', 'accession', 'form', 'derived'];
const POINT_OPTIONAL = new Set(['start', 'components']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_POINTS = 24;

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.keys(value).some(key => FORBIDDEN_KEYS.has(key));
const sameKeys = (value, keys) => { const own = Object.keys(value); return own.length === keys.length && keys.every(key => Object.hasOwn(value, key)); };
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value, max = 64) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const number = value => typeof value === 'number' && Number.isFinite(value);

function admitPoint(point, field, asOfDate, annual) {
  if (!plain(point) || !POINT_REQUIRED.every(key => Object.hasOwn(point, key)) || Object.keys(point).some(key => !POINT_REQUIRED.includes(key) && !POINT_OPTIONAL.has(key))) return false;
  const { end, start, filed, value, tag, unit, accession, form, derived, components } = point;
  if (!day(end) || !day(filed) || filed > asOfDate || end > filed || !number(value) || !text(accession) || !SEC_FORMS.includes(form)) return false;
  const [tags, expectedUnit] = SEC_FIELD_TAGS[field];
  if (!tags.includes(tag) || unit !== expectedUnit) return false;
  // Flow facts are durations; balance-sheet facts are instants without a start.
  if (INSTANT_FIELDS.has(field) && !annual) { if (start !== undefined && start !== null) return false; }
  else if (!day(start) || start > end) return false;
  if (derived === false) return components === undefined;
  return !annual && derived === DERIVED_Q4 && DERIVABLE_FIELDS.has(field) && Array.isArray(components) && components.length === 4 && components.every(item => text(item));
}

function admitSeries(points, field, asOfDate, annual = false) {
  return Array.isArray(points) && points.length <= MAX_POINTS &&
    points.every((point, index) => admitPoint(point, field, asOfDate, annual) && (!index || point.end > points[index - 1].end));
}

// Why a record was refused, one reason per existing check (no new rule): the record's structure or a
// value of its envelope (`keys`), its schema version, its symbol, its publication date, its retrieval
// clock against that date and the evaluation instant, the companyfacts URL bound to its CIK, one
// quarterly or annual series (`series:<field>`, annual EPS is `series:annualEps`), or an instrument
// that never carries company financials (`not_corporate`).
export const SEC_REFUSAL_REASONS = Object.freeze(['schema', 'symbol', 'as_of', 'retrieved_window', 'keys', 'cik_url', ...QUARTERLY_FIELDS.map(field => `series:${field}`), 'series:annualEps', 'not_corporate']);
// The reasons a published row's sec_admission may name: every admission reason, and `projection` for a record
// that admission accepted but a later publication step removed from the row (never returned by admission).
export const SEC_PUBLICATION_REFUSAL_REASONS = Object.freeze([...SEC_REFUSAL_REASONS, 'projection']);
const refuse = reason => ({ value: null, reason });

/**
 * The admission of one same-day SEC companyfacts record with the reason it was refused:
 * { value, reason }, where value is the same record (reason null) or null (reason one of
 * SEC_REFUSAL_REASONS). The checks and their order are exactly those of admitBookFinancials;
 * the reason only names which one refused the record.
 */
export function admitBookFinancialsDetailed(value, { symbol, asOfDate, evaluatedAt, row } = {}) {
  if (!plain(value)) return refuse('keys');
  if (typeof symbol !== 'string' || !symbol || value.symbol !== symbol) return refuse('symbol');
  if (!day(asOfDate) || value.as_of_date !== asOfDate) return refuse('as_of');
  if (!Number.isFinite(evaluatedAt)) return refuse('retrieved_window');
  if (!corporateFinancialsAllowed(row && typeof row === 'object' ? row : { symbol })) return refuse('not_corporate');
  if (value.schema_version !== SEC_RECORD_SCHEMA) return refuse('schema');
  if (!instant(value.retrieved_at)) return refuse('retrieved_window');
  const retrieved = Date.parse(value.retrieved_at);
  if (retrieved < Date.parse(`${asOfDate}T00:00:00Z`) || retrieved > evaluatedAt) return refuse('retrieved_window');
  if (value.status === 'unavailable') {
    if (Object.keys(value).some(key => !UNAVAILABLE_KEYS.has(key)) || !SEC_UNAVAILABLE_REASONS.includes(value.reason)) return refuse('keys');
    if (Object.hasOwn(value, 'error') && !text(value.error, 200)) return refuse('keys');
    if (Object.hasOwn(value, 'forms') && !(Array.isArray(value.forms) && value.forms.length <= 5 && value.forms.every(form => typeof form === 'string' && /^[0-9A-Z-]{2,8}(\/A)?$/.test(form)))) return refuse('keys');
    return { value, reason: null };
  }
  if (!['available', 'partial'].includes(value.status) || !sameKeys(value, RECORD_KEYS)) return refuse('keys');
  if (!Number.isSafeInteger(value.cik) || value.cik <= 0 || value.source !== `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(value.cik).padStart(10, '0')}.json`) return refuse('cik_url');
  if (!plain(value.quarterly) || !sameKeys(value.quarterly, QUARTERLY_FIELDS)) return refuse('keys');
  const series = QUARTERLY_FIELDS.find(field => !admitSeries(value.quarterly[field], field, asOfDate));
  if (series) return refuse(`series:${series}`);
  if (!admitSeries(value.annualEps, 'eps', asOfDate, true)) return refuse('series:annualEps');
  if (!Array.isArray(value.limitations) || value.limitations.length > 10 || !value.limitations.every(item => text(item, 200))) return refuse('keys');
  return { value, reason: null };
}

/**
 * Returns the same record when it is an exact, same-day SEC companyfacts record for
 * this symbol and publication, else null. `evaluatedAt` is the publication's
 * evaluation instant (ms); the record cannot have been retrieved after it or before
 * the publication date began. Funds and quarantined instruments never carry one.
 */
export function admitBookFinancials(value, context = {}) {
  return admitBookFinancialsDetailed(value, context).value;
}
