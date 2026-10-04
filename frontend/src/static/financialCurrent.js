import { instrumentApplicability, instrumentIdentityEvidence, corporateFinancialsAllowed, INSTRUMENT_IDENTITY_FIELDS } from './instrumentApplicability.js';
import contract from '../../contracts/static_financial_current_v1.json' with { type: 'json' };
import { validClock, validEvidenceDay, evidenceTimestamp } from './evidenceTime.js';
import { financialHistory } from './financialHistory.js';
import { bookFinancialCurrent } from './bookFinancialCurrent.js';

export const FINANCIAL_FIELDS = Object.freeze(contract.field_order);
export const FINANCIAL_CURRENT_VERSION = contract.schema;
export const FINANCIAL_DEPENDENT_FIELDS = Object.freeze([
  'composite_score', 'composite_reason', 'minervini_score', 'canslim_score', 'ipo_score', 'custom_score',
  'minervini_rating','minervini_passes','canslim_rating','canslim_passes','ipo_rating','ipo_passes','custom_rating','custom_passes',
  'rating', 'rating_explanation', 'code33', 'rating_basis_score', 'rating_basis_screener', 'fundamental_bonus', 'fundamental_bonus_detail',
  'screeners_passed', 'passed_screeners', 'passes_count', 'screeners_passed_count',
]);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const day = 86400000;
const quarantined = new Set(['eps_raw_score', ...FINANCIAL_FIELDS.slice(12)]);
const ownedProjections = new WeakMap();
const immutable = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(immutable); Object.freeze(value); } return value; };
const protectedFields = [...FINANCIAL_FIELDS, ...Object.keys(contract.aliases), ...FINANCIAL_DEPENDENT_FIELDS];
export const hasFinancialCurrentFields = row => object(row) && (Object.hasOwn(row, 'financial_current') || protectedFields.some(field => Object.hasOwn(row, field)));
const iso = value => validClock(value) ? new Date(value).toISOString() : null;
const sourceTimestamp = value => {
  const parts=typeof value==='string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return parts && validEvidenceDay(parts[1]) && Number(parts[2])<=23 && Number(parts[3])<=59 && Number(parts[4])<=59 && Number(parts[5]||0)<=23 && Number(parts[6]||0)<=59 ? Date.parse(value) : NaN;
};
export function currentFinancialHistory(data,symbol,date,now=Date.now(),identity) {
  if (!corporateFinancialsAllowed(identity || { ...data, symbol })) return financialHistory(null,symbol,date,now);
  const sourced=typeof data?.source==='string' && data.source.trim() && !/^(unknown|unavailable|n\/a|未確認|未取得)$/i.test(data.source.trim()) && Number.isFinite(sourceTimestamp(data.retrieved_at));
  return financialHistory(sourced ? data : null,symbol,date,now);
}
const minTime = times => times.length ? Math.min(...times) : null;

function envelopeReason(row, proof, now, date, market) {
  if (!validClock(now) || !validEvidenceDay(date) || date > iso(now).slice(0, 10)) return 'invalid_evaluation_context';
  if (typeof row.symbol !== 'string' || !row.symbol.trim() || typeof market !== 'string' || !market.trim()) return 'identity_mismatch';
  if (!object(proof)) return 'missing_evidence';
  if (proof.v !== contract.version || !validClock(proof.t) || typeof proof.r !== 'string' || proof.r.length !== FINANCIAL_FIELDS.length ||
      [...proof.r].some(code => !Object.hasOwn(contract.reason_codes, code)) || !object(proof.p) ||
      Object.keys(proof).some(key => !contract.summary_keys.includes(key)) ||
      Object.keys(proof.p).some(key => !/^(?:[0-9]|1[0-5])$/.test(key) || !contract.proof_reason_codes.includes(proof.r[Number(key)])) ||
      [...proof.r].some((code, index) => contract.proof_reason_codes.includes(code) !== Object.hasOwn(proof.p, String(index)))) return 'invalid_envelope';
  if ((row.as_of_date != null && row.as_of_date !== date) || (row.technical_audit?.as_of_date != null && row.technical_audit.as_of_date !== date) || proof.s !== row.symbol || proof.m !== market || row.market !== market || proof.a !== date || !validEvidenceDay(proof.a)) return 'identity_mismatch';
  if (now < proof.t) return 'invalid_evaluation_context';
  return null;
}

function comparisonValid(value, id, comparison, calculation, sales, reason) {
  if (!Object.hasOwn(contract.comparison_codes, comparison) || !Object.hasOwn(contract.calculation_codes, calculation)) return false;
  const supported = sales ? ['G', 'D', 'U', 'X'] : ['g', 'd', 'u', 'n', 'z', 'l', 'w', 's', 't', 'b'];
  if (!supported.includes(comparison)) return false;
  const withheld = ['l', 'w', 's', 't', 'b', 'X'].includes(comparison);
  if ((reason === 'f') !== withheld) return false;
  if (id === '3' ? !['a', 'k'].includes(calculation) || !['g', 'd', 'u'].includes(comparison) : !['r', 'c'].includes(calculation)) return false;
  if (['0', '1'].includes(id) && calculation !== 'r') return false;
  if (['c', 'k'].includes(calculation) && ![-100, 500].includes(value)) return false;
  if (['g', 'l', 'G'].includes(comparison) && value < 0) return false;
  if (['d', 'w', 'D'].includes(comparison) && value > 0) return false;
  if (comparison === 'd' && value < -100) return false;
  if (['u', 's', 'U'].includes(comparison) && value !== 0) return false;
  if (comparison === 'n' && value > -100) return false;
  if (comparison === 'z' && value !== -100) return false;
  if (comparison === 't' && value < 100) return false;
  if (comparison === 'b' && value !== 100) return false;
  if (comparison === 'l' && value > 100) return false;
  return true;
}

function validateField(row, field, index, proof, now, date) {
  const entry = proof.p[String(index)];
  if (!contract.proof_reason_codes.includes(proof.r[index])) return { reason: contract.reason_codes[proof.r[index]] };
  if (!Array.isArray(entry) || entry.length !== contract.proof_tuple.length) return { reason: 'invalid_envelope' };
  const [value, id, metric, periods, observed, expiry, comparison, calculation] = entry;
  const rule = typeof id === 'string' && /^[0-3]$/.test(id) ? contract.contracts[id] : null;
  if (!rule?.fields.includes(field) || !contract.metrics[field.startsWith('sales') ? 'sales' : 'eps'].includes(metric)) return { reason: 'unsupported_contract' };
  // v2 reason f certifies a reference, never an ordinary-growth scalar. After
  // projection/serialization the latter is explicitly null; the exact reference
  // remains bound by the source tuple. An absent or conflicting scalar still
  // fails. No public availability flag, state object or history is consulted.
  const scalar = proof.r[index] === 'f' && row[field] === null ? value : row[field];
  if (!finite(value) || !finite(scalar)) return { reason: 'missing_or_invalid_value' };
  if (scalar !== value) return { reason: 'value_mismatch' };
  if (!comparisonValid(value, id, comparison, calculation, field.startsWith('sales'), proof.r[index])) return { reason: 'invalid_source_inputs' };
  for (const [alias, canonical] of Object.entries(contract.aliases)) if (canonical === field && Object.hasOwn(row, alias) && row[alias] != null && row[alias] !== value) return { reason: 'alias_conflict' };
  if (!validClock(observed) || !validClock(expiry) || expiry < observed || expiry > observed + contract.source_max_age_ms || expiry < proof.t) return { reason: 'invalid_envelope' };
  if (observed > now || observed > proof.t) return { reason: 'future_source_timestamp' };
  if (!Array.isArray(periods) || periods.length < rule.period_count[0] || periods.length > rule.period_count[1] ||
      periods.some((period, position) => !validEvidenceDay(period) || period > date || period > iso(now).slice(0, 10) || (position && period >= periods[position - 1]))) return { reason: 'invalid_reporting_period' };
  const gaps = periods.slice(1).map((period, position) => (Date.parse(periods[position]) - Date.parse(period)) / day);
  const [gapMin, gapMax] = rule.quarter_gap_days || contract.year_gap_days;
  if (gaps.some(gap => gap < gapMin || gap > gapMax) || (rule.comparison === 'quarter_year_over_year' &&
      ((Date.parse(periods[0]) - Date.parse(periods.at(-1))) / day < contract.year_gap_days[0] ||
       (Date.parse(periods[0]) - Date.parse(periods.at(-1))) / day > contract.year_gap_days[1]))) return { reason: 'invalid_reporting_period' };
  const periodExpiry = Date.parse(periods[0]) + ((rule.cadence === 'annual' ? contract.annual_max_age_days : contract.quarter_max_age_days) + 1) * day - 1;
  if (expiry > periodExpiry) return { reason: 'invalid_envelope' };
  if (now > periodExpiry) return { reason: 'stale_reporting_period' };
  if (now > expiry) return { reason: 'stale_source' };
  const withheld = proof.r[index] === 'f';
  return { value: withheld ? null : value, availability: withheld ? 'unknown' : 'current', reason: withheld ? contract.reason_codes.f : null,
    reference_value: value, reference_availability: 'current', source_validated: true, ordinary_growth_eligible: !withheld,
    comparison: contract.comparison_codes[comparison], calculation: contract.calculation_codes[calculation],
    clipped: ['c', 'k'].includes(calculation), source: rule.source, producer: rule.producer, metric, basis: rule.basis,
    unit: rule.unit, observed_at: iso(observed), valid_until: iso(expiry), period_end: periods[0], comparable_period_end: periods.at(-1), periods_used: [...periods], expiry };
}

// This copy is the only current scalar view. Proofs are backend-validated source
// summaries, never a browser reconstruction of Python's JSON/hash conventions.
// Re-projecting a withheld scalar cannot restore it from a raw alias or proof.
export function projectFinancialRow(input, { now = Date.now(), asOfDate, market } = {}) {
  if (!object(input)) return input;
  const row = { ...input };
  const date = asOfDate ?? row.as_of_date ?? row.technical_audit?.as_of_date;
  const contextMarket = market ?? row.market;
  // Missing row context may be supplied by its verified containing asset, never
  // by the proof's own claim. Explicit conflicting values remain invalid.
  if (!Object.hasOwn(row,'as_of_date') && validEvidenceDay(date)) row.as_of_date=date;
  if (!Object.hasOwn(row,'market') && market!==undefined) row.market=market;
  const applicability = instrumentApplicability(row);
  const blocked = applicability.status !== 'unverified';
  const cached = ownedProjections.get(input);
  if (cached && cached.identity === JSON.stringify(INSTRUMENT_IDENTITY_FIELDS.map(field=>input[field])) && cached.applicability === JSON.stringify(applicability) && !Object.hasOwn(input, 'method_summary') && cached.now === now && cached.date === date && cached.market === contextMarket && cached.rowMarket === input.market && cached.symbol === input.symbol && cached.rowDate === input.as_of_date && cached.auditDate === input.technical_audit?.as_of_date && input.financial_current === cached.proof && input.financial_current_state === cached.state && protectedFields.every(field => input[field] === cached.values[field]) && ['screener_results','screener_details','screeners'].every(key=>input[key]===cached.nested[key])) return input;
  const proof = row.financial_current;
  const invalid = blocked ? applicability.reason : envelopeReason(row, proof, now, date, contextMarket);
  delete row.financial_applicability;
  row.instrument_applicability = immutable(applicability);
  if (blocked) row.instrument_identity = immutable({ ...row.instrument_identity, observed_contexts: instrumentIdentityEvidence(row) });
  delete row.method_summary;
  const fields = {}, expiries = [], rejectedReferences = [];
  for (const [index, field] of FINANCIAL_FIELDS.entries()) {
    const state = blocked ? { reason: applicability.reason, availability: applicability.status === 'not_applicable' ? 'not_applicable' : 'unknown' } : quarantined.has(field) ? { reason: 'unverified_derivation_and_cohort' } : invalid ? { reason: invalid } : validateField(row, field, index, proof, now, date);
    fields[field] = { value: null, availability: 'unknown', ...state };
    if (proof?.r?.[index] === 'f' && !state.source_validated) rejectedReferences.push([index, state.reason]);
    row[field] = fields[field].value;
    if (state.expiry !== undefined) expiries.push(state.expiry);
  }
  for (const [alias, canonical] of Object.entries(contract.aliases)) row[alias] = row[canonical];
  for (const field of FINANCIAL_DEPENDENT_FIELDS) if (Object.hasOwn(row, field)) row[field] = null;
  // Nested legacy scanner outputs contain financially dependent pass/score
  // claims. Keep technical scanners, but never rerun a legacy missing=>0 scorer.
  for (const key of ['screener_results', 'screener_details', 'screeners']) if (object(row[key])) row[key] = Object.fromEntries(Object.entries(row[key]).map(([name, result]) =>
    /^(minervini|canslim|ipo|custom)$/i.test(name) ? [name, { score: null, passes: null, rating: null, status: blocked ? applicability.status : 'unknown', reason: blocked ? applicability.reason : 'unverified_financial_dependencies' }] : [name, result]));
  row.financial_historical = input.financial_historical || { values: Object.fromEntries(protectedFields.filter(field => Object.hasOwn(input, field)).map(field => [field, input[field]])), source_evidence: input.financial_source_evidence || null, current_proof: input.financial_current || null, financial_history: input.financial_history || null, book_financials: input.book_financials || null, legacy_scanners:Object.fromEntries(['screener_results','screener_details','screeners'].filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]])) };
  if (blocked) {
    row.financial_historical = { ...row.financial_historical, current_proof: row.financial_historical.current_proof || input.financial_current || null, financial_history: row.financial_historical.financial_history || input.financial_history || null, book_financials: row.financial_historical.book_financials || input.book_financials || null };
    row.financial_history = null; row.book_financials = null; row.passes_template = null;
  }
  row.financial_current_state = immutable({ version: FINANCIAL_CURRENT_VERSION, evaluated_at: now, next_expiry_at: minTime(expiries), fields, dependent_reason: blocked ? applicability.reason : 'unverified_financial_dependencies' });
  // Only objects minted here may reuse this same-instant projection. Freeze
  // our own proof copy and projected state so mutation cannot forge a cache hit.
  if (object(proof)) { try {
    const retained = structuredClone(proof);
    // Rejected comparison-only proof must not be recertified from the null
    // produced above. Valid references retain their explicit null roundtrip.
    if (typeof retained.r === 'string' && object(retained.p)) for (const [index, reason] of rejectedReferences) {
      const code = Object.entries(contract.reason_codes).find(([key, value]) => value === reason && !contract.proof_reason_codes.includes(key))?.[0] || '3';
      retained.r = retained.r.slice(0, index) + code + retained.r.slice(index + 1);
      delete retained.p[String(index)];
    }
    row.financial_current=immutable(retained);
  } catch { row.financial_current=undefined; } }
  if (blocked) row.financial_current = null;
  for (const key of ['screener_results','screener_details','screeners']) if (object(row[key])) { for (const [name,value] of Object.entries(row[key])) if (/^(minervini|canslim|ipo|custom)$/i.test(name)) immutable(value); Object.freeze(row[key]); }
  ownedProjections.set(row,{identity:JSON.stringify(INSTRUMENT_IDENTITY_FIELDS.map(field=>row[field])),applicability:JSON.stringify(instrumentApplicability(row)),now,date,market:contextMarket,rowMarket:row.market,symbol:row.symbol,rowDate:row.as_of_date,auditDate:row.technical_audit?.as_of_date,proof:row.financial_current,state:row.financial_current_state,values:Object.fromEntries(protectedFields.map(field=>[field,row[field]])),nested:Object.fromEntries(['screener_results','screener_details','screeners'].map(key=>[key,row[key]]))});
  return row;
}

export function financialNextExpiry(rows, now = Date.now()) {
  const times = [];
  for (const row of rows || []) {
    const projected = projectFinancialRow(row, { now });
    if (projected.financial_current_state.next_expiry_at !== null) times.push(projected.financial_current_state.next_expiry_at + 1);
    if (currentFinancialHistory(row.financial_history, row.symbol, row.technical_audit?.as_of_date || row.as_of_date, now, row).valid) {
      const end = evidenceTimestamp(row.financial_history.retrieved_at) + 72 * 3600000 + 1;
      if (validClock(end) && end > now) times.push(end);
    }
    const book=bookFinancialCurrent(row.book_financials,row.symbol,row.technical_audit?.as_of_date || row.as_of_date,now,row);
    if (book.current && validClock(book.validUntil)) times.push(book.validUntil+1);
  }
  return minTime(times);
}

// Payload callers select current static assets. Historical snapshots and saved
// model records must not be sent through this function.
export function projectFinancialPayload(payload, options = {}) {
  if (Array.isArray(payload)) return payload.map(value => projectFinancialPayload(value, options));
  if (!object(payload)) return payload;
  const context = { ...options, asOfDate: options.asOfDate ?? payload.as_of_date, symbol:payload.symbol ?? options.symbol, market: options.market ?? payload.market ?? (payload.symbol && payload.stock_data?.symbol===payload.symbol ? payload.stock_data.market : undefined) };
  const rowInput=hasFinancialCurrentFields(payload) && !Object.hasOwn(payload,'symbol') && context.symbol ? {...payload,symbol:context.symbol} : payload;
  let out = (hasFinancialCurrentFields(payload) || (typeof payload.symbol === 'string' && !corporateFinancialsAllowed(payload))) ? projectFinancialRow(rowInput, context) : { ...payload };
  for (const key of ['rows', 'initial_rows', 'preview_rows', 'results', 'members', 'stocks', 'top_stocks', 'top_symbols', 'payload', 'stock_data', 'fundamentals', 'groups', 'industries', 'sectors', 'rankings', 'group_details']) {
    if (Object.hasOwn(payload, key) && (Array.isArray(payload[key]) || object(payload[key]))) out[key] = key === 'group_details' ? Object.fromEntries(Object.entries(payload[key]).map(([name,value])=>[name,projectFinancialPayload(value,context)])) : projectFinancialPayload(payload[key], { ...context, market: payload[key]?.market ?? context.market });
  }
  // Legacy representative selection used an unsupported composite-score tie
  // breaker. It cannot be advertised as a current financially qualified pick.
  if (Object.hasOwn(out,'top_symbol')) { out.top_symbol=null; out.top_symbol_name=null; out.top_rs_rating=null; out.representative_status='unverified_financial_dependencies'; }
  if (Array.isArray(out.stocks)) out.stocks=[...out.stocks].sort((a,b)=>(finite(b.rs_rating)?b.rs_rating:-Infinity)-(finite(a.rs_rating)?a.rs_rating:-Infinity) || String(a.symbol).localeCompare(String(b.symbol)));
  return out;
}

export function mergeFinancialDetail(summary, detail, { now = Date.now(), asOfDate, generation, detailGeneration = generation, expectedDetailPath, detailPath = expectedDetailPath } = {}) {
  if (!summary) return null;
  const date = asOfDate ?? summary.as_of_date ?? summary.technical_audit?.as_of_date;
  const match = detail && detail.symbol === summary.symbol && detail.as_of_date === date && (!detail.market || detail.market === summary.market) &&
    detailGeneration === generation && (!detail.financial_current || !summary.financial_current || detail.financial_current.t === summary.financial_current.t) && (!expectedDetailPath || detailPath === expectedDetailPath);
  if (!match) return projectFinancialRow(summary, { now, asOfDate: date });
  const merged = { ...detail, ...summary, price_quality: { ...detail.price_quality, ...summary.price_quality }, setup_recalculation: { ...detail.setup_recalculation, ...summary.setup_recalculation } };
  // List proof owns the current generation. Missing list proof/fields cannot be
  // certified by an older, late detail response.
  merged.financial_current = summary.financial_current;
  for (const field of protectedFields) {
    if (Object.hasOwn(summary,field)) merged[field]=summary[field];
    else if (Object.hasOwn(contract.aliases,field)) delete merged[field];
    else merged[field]=null;
  }
  merged.financial_historical = detail.financial_historical || summary.financial_historical;
  if (!corporateFinancialsAllowed(summary)) merged.financial_historical = { ...merged.financial_historical, detail_identity: Object.fromEntries(INSTRUMENT_IDENTITY_FIELDS.filter(key=>Object.hasOwn(detail,key)).map(key=>[key,detail[key]])) };
  return projectFinancialRow(merged, { now, asOfDate: date });
}
