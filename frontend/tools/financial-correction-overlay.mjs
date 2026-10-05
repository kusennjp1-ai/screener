import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import nativeContract from '../contracts/native_annual_history_v1.json' with { type: 'json' };
import { nativeAnnualHistoryContract, financialHistory } from '../src/static/financialHistory.js';
import currentContract from '../contracts/static_financial_current_v1.json' with { type: 'json' };
import { FINANCIAL_FIELDS, FINANCIAL_DEPENDENT_FIELDS, currentFinancialHistory, projectFinancialRow, projectFinancialPayload, hasFinancialCurrentFields } from '../src/static/financialCurrent.js';
import { decodeResearchIndex, RESEARCH_METHODS } from '../src/static/researchTransport.js';
import { assess, rankCandidates, compareReference } from '../src/static/researchEngine.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';
import { applicabilityUniverse, instrumentApplicability, instrumentIdentityEvidence, corporateFinancialsAllowed } from '../src/static/instrumentApplicability.js';
import { summarizeWorkbench, validateWorkbenchSummary, validateWorkbenchDetails } from '../src/static/workbenchSummary.js';
import { sectorStrength } from '../src/static/sectorStrength.js';
import { selectionSnapshot } from '../src/static/candidateHistory.js';
import { filterStaticScanRows, sortStaticScanRows } from '../src/static/scanClient.js';
import { scanListRow } from './scan-list-payload.mjs';
import { validatePublishedSummaries, validateResearchListSummaries, validateResearchParity } from './research-quality.mjs';
import { verifyWorkbenchComparison } from './workbench-comparison.mjs';
import { observedFinancialCarryScope } from './financial-generation-carry.mjs';

export const FINANCIAL_CORRECTION_SCHEMA = 'financial-statement-projection-v1';
export const CORRECTION_FIELDS = Object.freeze([...FINANCIAL_FIELDS, 'eps_growth_quarterly', 'eps_growth_annual', 'recent_quarter_date', 'previous_quarter_date', 'growth_comparable_period_date', 'growth_reporting_cadence', 'growth_metric_basis', 'growth_reference_gap_days']);
export const CORRECTION_DEPENDENT_FIELDS = Object.freeze([...FINANCIAL_DEPENDENT_FIELDS, 'code33_qualified', 'code33_pass', 'code33_flag', 'eps_acceleration', 'eps_yoy_acceleration']);
export const CORRECTION_METADATA_FIELDS = Object.freeze(['financial_generation', 'financial_evaluated_at', 'financial_knowledge_basis', 'financial_point_in_time', 'financial_source_publication_date', 'financial_policy_version']);
const basis = 'current_observation_at_source_capture';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(canonical(value)));
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b, message) => { if (!isDeepStrictEqual(a, b)) throw Error(`Financial correction ${message}`); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clock = value => typeof value === 'number' ? value : Date.parse(value);
const fail = message => { throw Error(`Financial correction ${message}`); };
const exactKeys = (value, keys, label) => { if (!object(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(`invalid ${label} keys`); };
const publicationIdentity = value => typeof value === 'string' && /^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(value);
// Capture legacy inputs once, before introducing correction-owned fields.
// Reuse existing snapshots so null/absent slots and original evidence stay exact.
const historicalSnapshot = row => row.financial_historical || {
  values: Object.fromEntries([...FINANCIAL_FIELDS, ...Object.keys(currentContract.aliases), ...FINANCIAL_DEPENDENT_FIELDS].filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])),
  source_evidence: row.financial_source_evidence || null, current_proof: row.financial_current || null,
  financial_history: row.financial_history || null, book_financials: row.book_financials || null,
  legacy_scanners: Object.fromEntries(['screener_results', 'screener_details', 'screeners'].filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])),
};
// Only financial-correction-v1 fields written by this projector may cross the
// alias boundary. All nonfinancial properties retain their original ownership.
const financialOutputFields = [...CORRECTION_FIELDS, ...CORRECTION_DEPENDENT_FIELDS, ...CORRECTION_METADATA_FIELDS,
  'financial_source_evidence', 'financial_current', 'financial_history', 'book_financials', 'bookFinancialCurrent',
  'financial_source_diagnostics', 'financial_history_source_diagnostics', 'financial_identity', 'instrument_applicability',
  'financial_current_state', 'financial_historical', 'method_summary', 'passes_template', 'eps_line'];
function financialAlias(original, projected) {
  const result = { ...original };
  for (const field of financialOutputFields) {
    if (Object.hasOwn(projected, field)) result[field] = projected[field];
    else delete result[field];
  }
  for (const key of ['screener_results', 'screener_details', 'screeners']) if (object(original[key])) result[key] = Object.fromEntries(Object.entries(original[key]).map(([name, value]) =>
    /^(minervini|canslim|ipo|custom)$/i.test(name) ? [name, projected[key][name]] : [name, value]));
  for (const key of ['stock_data', 'fundamentals']) if (object(original[key])) result[key] = financialAlias(original[key], projected[key]);
  return result;
}

export function correctionMetadata(projection) {
  return projection ? { financial_generation: projection.financial_generation, financial_evaluated_at: clock(projection.financial_evaluated_at), financial_knowledge_basis: basis, financial_point_in_time: false, financial_source_publication_date: null, financial_policy_version: projection.policy.id } : {};
}

export function validateCorrectionProjection(projection, { evaluatedAt, targetIdentity, targetBaseSha256 } = {}) {
  exactKeys(projection, ['schema_version', 'financial_generation', 'financial_evaluated_at', 'knowledge_basis', 'point_in_time', 'source_publication_date', 'bindings', 'policy', 'receipt_inventory', 'receipt_inventory_sha256', 'symbols', ...(projection?.policy?.id === nativeContract.policy_id ? ['derivation'] : [])], 'projection');
  if (projection.schema_version !== FINANCIAL_CORRECTION_SCHEMA || projection.knowledge_basis !== basis || projection.point_in_time !== false || projection.source_publication_date !== null || !hash(projection.financial_generation)) fail('invalid generation or knowledge metadata');
  const instant = clock(projection.financial_evaluated_at);
  if (!Number.isSafeInteger(instant) || instant < 0 || (evaluatedAt !== undefined && instant !== clock(evaluatedAt))) fail('evaluation instant mismatch');
  exactKeys(projection.bindings, ['archive_manifest_sha256', 'acquisition_base_sha256', 'cohort_sha256', 'target_publication_identity', 'target_base_sha256'], 'bindings');
  if (!publicationIdentity(projection.bindings.target_publication_identity) || Object.entries(projection.bindings).some(([key, value]) => key !== 'target_publication_identity' && !hash(value))) fail('invalid bindings');
  if (targetIdentity !== undefined && projection.bindings.target_publication_identity !== targetIdentity) fail('target publication mismatch');
  if (targetBaseSha256 !== undefined && projection.bindings.target_base_sha256 !== targetBaseSha256) fail('target base mismatch');
  exactKeys(projection.policy, ['id', 'contract_sha256', 'projector_sha256'], 'policy');
  if (![nativeContract.source_policy_id, nativeContract.policy_id].includes(projection.policy.id) || !hash(projection.policy.contract_sha256) || !hash(projection.policy.projector_sha256)) fail('unsupported policy');
  const native = projection.policy.id === nativeContract.policy_id;
  if (native) {
    const derivation = projection.derivation;
    exactKeys(derivation, ['schema_version', 'source_projection_sha256', 'source_policy', 'source_receipt_inventory_sha256'], 'native derivation');
    exactKeys(derivation.source_policy, ['id', 'contract_sha256', 'projector_sha256'], 'native source policy');
    if (derivation.schema_version !== 'native-annual-destination-derivation-v1' || !hash(derivation.source_projection_sha256) || derivation.source_receipt_inventory_sha256 !== projection.receipt_inventory_sha256 || derivation.source_policy.id !== nativeContract.source_policy_id || !hash(derivation.source_policy.contract_sha256) || !hash(derivation.source_policy.projector_sha256)) fail('invalid native derivation binding');
  }
  if (!object(projection.symbols) || !Object.keys(projection.symbols).length || !Array.isArray(projection.receipt_inventory)) fail('missing full cohort');
  const receipts = [];
  for (const symbol of Object.keys(projection.symbols).sort()) {
    const item = projection.symbols[symbol];
    if (!symbol || ['__proto__', 'constructor', 'prototype'].includes(symbol)) fail('invalid symbol');
    exactKeys(item, ['market', 'as_of_date', 'financial_values', 'financial_source_evidence', 'financial_current', 'financial_history', 'source_diagnostics', 'history_source_diagnostics', 'source_receipts', ...['instrument_applicability','financial_identity'].filter(key=>Object.hasOwn(item,key))], `symbol ${symbol}`);
    if (item.market !== 'US' || !/^\d{4}-\d{2}-\d{2}$/.test(item.as_of_date) || Date.parse(item.as_of_date) > instant) fail(`invalid identity ${symbol}`);
    exactKeys(item.financial_values, CORRECTION_FIELDS, `ownership ${symbol}`);
    if (!object(item.financial_source_evidence) || !object(item.financial_current) || !object(item.financial_history) || !Array.isArray(item.source_receipts)) fail(`incomplete sources ${symbol}`);
    const proof = item.financial_current;
    exactKeys(proof,currentContract.summary_keys,`proof ${symbol}`);
    if (proof.v!==currentContract.version || typeof proof.r!=='string' || proof.r.length!==FINANCIAL_FIELDS.length || [...proof.r].some(code=>!Object.hasOwn(currentContract.reason_codes,code)) || !object(proof.p)) fail(`invalid proof envelope ${symbol}`);
    if (proof.t !== instant || proof.s !== symbol || proof.m !== item.market || proof.a !== item.as_of_date) fail(`proof identity mismatch ${symbol}`);
    const projected = projectFinancialRow({symbol, market: item.market, as_of_date: item.as_of_date, ...item.financial_values, financial_current: proof}, {now: instant});
    for (const [index, field] of FINANCIAL_FIELDS.entries()) {
      if (['invalid_envelope','invalid_evaluation_context','identity_mismatch'].includes(projected.financial_current_state.fields[field].reason)) fail(`invalid proof envelope ${symbol}`);
      if (['0', 'f'].includes(proof.r?.[index]) && !projected.financial_current_state.fields[field].source_validated) fail(`invalid current proof ${symbol}/${field}`);
    }
    for (const [alias, field] of [['eps_growth_quarterly', 'eps_growth_qq'], ['eps_growth_annual', 'eps_growth_yy']]) equal(item.financial_values[alias], item.financial_values[field], `alias mismatch ${symbol}/${alias}`);
    const attributes = new Set();
    for (const receipt of item.source_receipts) {
      exactKeys(receipt, ['attribute', 'receipt_sha256', 'capture_id', 'raw_payload_sha256', 'observed_at'], `receipt ${symbol}`);
      if (!['quarterly_income_stmt', 'income_stmt'].includes(receipt.attribute) || attributes.has(receipt.attribute) || !hash(receipt.receipt_sha256) || !hash(receipt.raw_payload_sha256) || typeof receipt.capture_id !== 'string' || !receipt.capture_id || !Number.isFinite(Date.parse(receipt.observed_at)) || Date.parse(receipt.observed_at) > instant) fail(`invalid receipt ${symbol}`);
      attributes.add(receipt.attribute); receipts.push({symbol, ...receipt});
    }
    for (const tuple of Object.values(proof.p || {})) {
      const receipt = item.source_receipts.find(value => value.attribute === (tuple[1] === '3' ? 'income_stmt' : 'quarterly_income_stmt'));
      if (!receipt || Date.parse(receipt.observed_at) !== tuple[4]) fail(`proof capture clock mismatch ${symbol}`);
    }
    const history = item.financial_history;
    if (history.schema_version !== undefined) {
      if (!native || !nativeAnnualHistoryContract(history, symbol) || !financialHistory(history, symbol, item.as_of_date, instant).annualComplete) fail(`invalid native annual history ${symbol}`);
      const source = history.annual_source;
      const receipt = item.source_receipts.find(value => value.attribute === 'income_stmt');
      if (!receipt || Object.entries(receipt).some(([key, value]) => source[key] !== value)) fail(`native annual receipt mismatch ${symbol}`);
      if (history.quarterly_retrieved_at !== null && !item.source_receipts.some(value => value.attribute === 'quarterly_income_stmt' && Date.parse(value.observed_at) === Date.parse(history.quarterly_retrieved_at))) fail(`native quarterly clock mismatch ${symbol}`);
      if (history.quarterly?.length && history.quarterly_retrieved_at === null) fail(`native quarterly clock missing ${symbol}`);
    }
    if(item.financial_history.status==='available') {
      const historyClock=Date.parse(item.financial_history.retrieved_at);
      if(!Number.isFinite(historyClock) || !item.source_receipts.some(receipt=>Date.parse(receipt.observed_at)===historyClock)) fail(`history capture clock mismatch ${symbol}`);
      for(const [series,attribute] of [['annual','income_stmt'],['quarterly','quarterly_income_stmt']]) if(item.financial_history[series]?.length && !attributes.has(attribute)) fail(`missing history receipt ${symbol}/${series}`);
    }
    if (item.instrument_applicability !== undefined) {
      if (!object(item.instrument_applicability)) fail(`invalid applicability ${symbol}`);
      if (!['unverified','not_applicable','quarantined'].includes(item.instrument_applicability.status)) fail(`unsupported applicability ${symbol}`);
      if (['not_applicable','quarantined'].includes(item.instrument_applicability.status) && (Object.values(item.financial_values).some(value=>value!==null) || Object.keys(proof.p).length || item.financial_history.annual?.length || item.financial_history.quarterly?.length)) fail(`not-applicable instrument has financial claims ${symbol}`);
    }
    if (item.financial_identity !== undefined && (!object(item.financial_identity) || item.financial_identity.symbol !== symbol || item.financial_identity.market !== item.market || item.financial_identity.identifiers_bound_to_price !== false || item.financial_identity.identifiers_bound_to_financial_receipts !== false)) fail(`invalid instrument identity ${symbol}`);
  }
  equal(projection.receipt_inventory, receipts, 'receipt inventory mismatch');
  if (digest(receipts) !== projection.receipt_inventory_sha256) fail('receipt inventory hash mismatch');
  return projection;
}

export async function loadFinancialCorrection({ env = process.env, rows, asOfDate } = {}) {
  const keys = ['FINANCIAL_CORRECTION_PROJECTION', 'FINANCIAL_CORRECTION_SHA256', 'FINANCIAL_CORRECTION_TARGET_IDENTITY', 'FINANCIAL_CORRECTION_TARGET_BASE_SHA256'];
  if (!keys.some(key => env[key] !== undefined)) return null;
  if (keys.some(key => !env[key]) || !env.FINANCIAL_EVALUATED_AT) fail('incomplete opt-in bindings');
  const path = env.FINANCIAL_CORRECTION_PROJECTION;
  if (!isAbsolute(path) || !hash(env.FINANCIAL_CORRECTION_SHA256) || !hash(env.FINANCIAL_CORRECTION_TARGET_BASE_SHA256)) fail('requires absolute path and exact digests');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024) fail('invalid projection file');
  const raw = await readFile(path);
  if (sha(raw) !== env.FINANCIAL_CORRECTION_SHA256) fail('projection hash mismatch');
  const projection = validateCorrectionProjection(JSON.parse(raw), {evaluatedAt: env.FINANCIAL_EVALUATED_AT, targetIdentity: env.FINANCIAL_CORRECTION_TARGET_IDENTITY, targetBaseSha256: env.FINANCIAL_CORRECTION_TARGET_BASE_SHA256});
  const bySymbol = new Map(rows.map(row => [row.symbol, row]));
  if (bySymbol.size !== rows.length) fail('duplicate target symbols');
  for (const [symbol, item] of Object.entries(projection.symbols)) {
    const row = bySymbol.get(symbol);
    if (!row || row.market !== item.market || (row.as_of_date ?? asOfDate) !== item.as_of_date || item.as_of_date !== asOfDate) fail(`target row mismatch ${symbol}`);
  }
  return projection;
}

export function overlayFinancialCorrection(row, projection, inheritedScope = {}) {
  const item = projection?.symbols?.[row?.symbol];
  if (!item) return row;
  if ((row.market !== undefined && row.market !== item.market) || (row.as_of_date !== undefined && row.as_of_date !== item.as_of_date)) fail(`row identity mismatch ${row.symbol}`);
  const out = {...row, ...structuredClone(item.financial_values), ...correctionMetadata(projection),
    market: item.market, as_of_date: item.as_of_date, financial_source_evidence: structuredClone(item.financial_source_evidence),
    financial_current: structuredClone(item.financial_current), financial_history: structuredClone(item.financial_history), book_financials: null,
    financial_historical: historicalSnapshot(row),
    financial_source_diagnostics: structuredClone(item.source_diagnostics), financial_history_source_diagnostics: structuredClone(item.history_source_diagnostics)};
  const observedContexts = !corporateFinancialsAllowed(row) ? instrumentIdentityEvidence(row) : null;
  const priorScope = row.financial_identity?.observed_scope;
  const observedScope = object(priorScope) ? structuredClone(priorScope) : Object.fromEntries(['symbol', 'market', 'as_of_date'].filter(key => Object.hasOwn(row, key) || Object.hasOwn(inheritedScope, key)).map(key => [key, Object.hasOwn(row, key) ? row[key] : inheritedScope[key]]));
  const priorScopes = [...(Array.isArray(row.financial_identity?.prior_observed_scopes) ? row.financial_identity.prior_observed_scopes : [])];
  // Only an admitted daily carry may advance the containing price date. Keep
  // the old observed scope and every original source/proof clock separately.
  // Chart aliases may inherit market/date from their observed containing chart.
  // Pass that same context to carry admission without materializing new price
  // identity fields on the alias. Explicit row values still take precedence.
  const carriedScope = observedFinancialCarryScope(projection, { ...inheritedScope, ...row }, observedScope);
  if (carriedScope) {
    priorScopes.push(structuredClone(observedScope));
    observedScope.as_of_date = carriedScope.as_of_date;
  }
  for (const field of ['instrument_applicability','financial_identity']) { if(Object.hasOwn(item,field)) out[field]=structuredClone(item[field]); else delete out[field]; }
  if (observedContexts || object(row.financial_identity?.observed_scope) || ['symbol', 'market', 'as_of_date'].some(key => !Object.hasOwn(row, key) && Object.hasOwn(inheritedScope, key))) out.financial_identity = { ...out.financial_identity,
    observed_scope: observedScope,
    ...(priorScopes.length ? { prior_observed_scopes: priorScopes } : {}),
    ...(observedContexts ? { observed_contexts: observedContexts } : {}) };
  for (const key of ['market', 'as_of_date']) if (!Object.hasOwn(row, key) && !Object.hasOwn(inheritedScope, key)) out[key] = undefined;
  delete out.financial_current_state; delete out.bookFinancialCurrent; delete out.method_summary;
  for (const field of CORRECTION_DEPENDENT_FIELDS) if (Object.hasOwn(out, field)) out[field] = null;
  return out;
}

export function overlayFinancialChart(chart, projection, symbol = chart?.symbol ?? chart?.stock_data?.symbol) {
  if (!projection?.symbols?.[symbol]) return chart;
  const item = projection.symbols[symbol];
  if ((chart.symbol !== undefined && chart.symbol !== symbol) || (chart.as_of_date !== undefined && chart.as_of_date !== item.as_of_date)) fail(`chart identity mismatch ${symbol}`);
  let result = {...chart, ...correctionMetadata(projection)};
  const inheritedScope = { symbol };
  for (const key of ['market', 'as_of_date']) {
    if (Object.hasOwn(chart, key)) inheritedScope[key] = chart[key];
    else if (chart.stock_data?.symbol === symbol && Object.hasOwn(chart.stock_data, key)) inheritedScope[key] = chart.stock_data[key];
  }
  // Match payload projection ownership, including reviewed-fund wrappers that
  // have no financial fields yet. Supply observed identity before materializing
  // those roots, keeping ordinary stock wrappers free of financial row fields.
  if (CORRECTION_FIELDS.some(key => Object.hasOwn(chart, key)) || hasFinancialCurrentFields(chart) || (typeof chart.symbol === 'string' && !corporateFinancialsAllowed(chart))) result = overlayFinancialCorrection({...result, symbol}, projection, inheritedScope);
  for (const key of ['stock_data', 'fundamentals']) if (object(chart[key])) {
    if (chart[key].symbol !== undefined && chart[key].symbol !== symbol) fail(`chart ${key} identity mismatch ${symbol}`);
    result[key] = overlayFinancialCorrection({...chart[key], symbol}, projection, inheritedScope);
  }
  // The predecessor retains the unaudited chart series. Current views cannot
  // plot that old series as if it belonged to the selected statement receipts.
  if (Object.hasOwn(result, 'eps_line')) result.eps_line = [];
  return financialAlias(chart, projectFinancialPayload(result, {now: clock(projection.financial_evaluated_at), asOfDate: inheritedScope.as_of_date, market: inheritedScope.market}));
}

const immutableDirectories = new Set(['candidate-history', 'candidate-performance-history', 'financial-corrections', 'financial-lineage']);
async function jsonFiles(root, relative = '') {
  const result = [];
  for (const entry of await readdir(resolve(root, relative), {withFileTypes: true})) {
    if (entry.isSymbolicLink()) fail('symlink in data bundle');
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !immutableDirectories.has(entry.name)) result.push(...await jsonFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(path);
  }
  return result.sort();
}
const chartSymbol = value => Array.isArray(value?.bars) ? value.symbol ?? value.stock_data?.symbol : null;
export async function rewriteCorrectionChartAliases(root, projection) {
  if (!projection) return;
  for (const path of await jsonFiles(root)) {
    const original = JSON.parse(await readFile(resolve(root, path), 'utf8'));
    const symbol = chartSymbol(original);
    if (projection.symbols[symbol]) await writeFile(resolve(root, path), JSON.stringify(overlayFinancialChart(original, projection, symbol)));
  }
}

export async function writeCorrectionHistory(root, projection, previous) {
  if (!projection) return;
  const results = {...previous?.results};
  for (const [symbol, item] of Object.entries(projection.symbols)) results[symbol] = structuredClone(item.financial_history);
  const dates = [...new Set(Object.values(projection.symbols).map(item => item.as_of_date))];
  if (dates.length !== 1) fail('mixed history dates');
  const payload = {...previous, ...correctionMetadata(projection), as_of_date: dates[0], results};
  // Recompute acquisition-derived coverage if that legacy summary existed.
  if (Object.hasOwn(payload, 'coverage')) delete payload.coverage;
  await writeFile(resolve(root, 'financial-history.json'), JSON.stringify(payload));
}

// Called from the separately approved consumer checkout by the controller.
// Every success is computed from the candidate bytes, never supplied by a caller.
export async function verifyCorrectionCompatibility({root, projection, evaluatedAt} = {}) {
  validateCorrectionProjection(projection);
  return verifyFinancialProjectionCompatibility({root, projection, evaluatedAt});
}

// Shared output checks. Each public typed entry point validates its own input
// first; this function does not admit a carry artifact as a strict correction.
export async function verifyFinancialProjectionCompatibility({root, projection, evaluatedAt} = {}) {
  const builtAt = clock(projection.financial_evaluated_at), checkedAt = clock(evaluatedAt ?? Date.now());
  if (!Number.isSafeInteger(checkedAt) || checkedAt < builtAt) fail('invalid recheck clock');
  const dataRoot = resolve(root);
  const read = async relative => {
    const path = resolve(dataRoot, relative);
    if (!path.startsWith(dataRoot + sep)) fail('invalid asset path');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const manifest = await read('manifest.json'), entry = manifest.markets?.US || manifest;
  const metadata = correctionMetadata(projection);
  const checkMetadata = (value, name) => { for (const [key, expected] of Object.entries(metadata)) equal(value?.[key], expected, `${name} metadata mismatch: ${key}`); };
  checkMetadata(manifest, 'manifest'); checkMetadata(entry.assets.research, 'research reference');
  const wire = await read(entry.assets.research.path);
  const researchRaw=await readFile(resolve(dataRoot,entry.assets.research.path));
  const researchHash=sha(researchRaw);
  if(manifest.research_generation!==researchHash) fail('research content generation mismatch');
  const index = decodeResearchIndex(wire);
  checkMetadata(index, 'research index');
  const canonicalRows = [], bySymbol = new Map(), counts = {cohort: Object.keys(projection.symbols).length, universe: index.rows.length, details: 0, scan_rows: 0, charts: 0};
  const checkNestedScanners=(row,expected,name)=>{
    for(const key of ['screener_results','screener_details','screeners']) if(object(row[key])) for(const [scanner,value] of Object.entries(row[key])) if(/^(minervini|canslim|ipo|custom)$/i.test(scanner)) equal(value,expected[key]?.[scanner],`${name}/${row.symbol}/${key}/${scanner} retained unverified scanner output`);
  };
  const checkRow = (row, name, full = false, compareCanonical = false) => {
    const canonicalRow=bySymbol.get(row?.symbol);
    if(compareCanonical && canonicalRow) for(const [key,value] of Object.entries(scanListRow(canonicalRow))) if(Object.hasOwn(row,key)) equal(row[key],value,`${name}/${row.symbol}/${key} differs from canonical row`);
    const item = projection.symbols[row?.symbol];
    if(!item) {
      const safe=projectFinancialRow(row,{now:builtAt,asOfDate:index.as_of_date});
      for(const field of FINANCIAL_FIELDS) equal(row[field],safe[field],`${name}/${row.symbol}/${field} is not policy safe`);
      checkNestedScanners(row,safe,name);
      equal(row.financial_current,safe.financial_current,`${name}/${row.symbol}/proof was not preserved`);
      if(full || Object.hasOwn(row,'financial_current_state')) equal(row.financial_current_state,safe.financial_current_state,`${name}/${row.symbol}/state mismatch`);
      return;
    }
    const expected = projectFinancialRow(overlayFinancialCorrection({...row, symbol: row.symbol, market: item.market, as_of_date: item.as_of_date}, projection), {now: builtAt});
    checkNestedScanners(row,expected,name);
    checkMetadata(row, `${name}/${row.symbol}`);
    if(item.instrument_applicability) equal(row.instrument_applicability,instrumentApplicability(row),`${name}/${row.symbol}/instrument applicability mismatch`);
    for (const field of [...FINANCIAL_FIELDS, 'eps_growth_quarterly', 'eps_growth_annual', 'financial_current', 'instrument_applicability', 'financial_identity']) equal(row[field], expected[field], `${name}/${row.symbol}/${field} mismatch`);
    if(full || Object.hasOwn(row,'financial_current_state')) equal(row.financial_current_state,expected.financial_current_state,`${name}/${row.symbol}/state mismatch`);
    for (const field of CORRECTION_DEPENDENT_FIELDS) if (Object.hasOwn(row, field) && row[field] !== null) fail(`${name}/${row.symbol}/${field} retained unverified value`);
    if (full) {
      for (const field of CORRECTION_FIELDS.slice(FINANCIAL_FIELDS.length + 2)) equal(row[field], expected[field], `${name}/${row.symbol}/${field} mismatch`);
      for (const field of ['financial_source_evidence', 'financial_history', 'book_financials', 'financial_source_diagnostics', 'financial_history_source_diagnostics','instrument_applicability','financial_identity']) equal(row[field], expected[field], `${name}/${row.symbol}/${field} mismatch`);
    }
    if(currentFinancialHistory(row.financial_history,row.symbol,item.as_of_date,builtAt).valid && !currentFinancialHistory(row.financial_history,row.symbol,item.as_of_date,checkedAt).valid) fail(`current history expired or invalid ${row.symbol}`);
    const current = projectFinancialRow(row, {now: checkedAt});
    for (const field of FINANCIAL_FIELDS) if (expected.financial_current_state.fields[field].source_validated && !current.financial_current_state.fields[field].source_validated) fail(`current proof expired or invalid ${row.symbol}/${field}`);
  };
  for (const row of index.rows) {
    if (bySymbol.has(row.symbol)) fail('duplicate research symbol');
    checkRow(row, 'research');
    const detail = await read(row.research_detail_path);
    if (detail.symbol !== row.symbol || detail.as_of_date !== index.as_of_date) fail('detail identity mismatch');
    checkRow(detail, 'detail', true);
    if(row.chart_path) {
      const chart=await read(row.chart_path);
      if(chartSymbol(chart)!==row.symbol || chart.as_of_date!==index.as_of_date) fail(`linked chart identity mismatch ${row.symbol}`);
      if(projection.symbols[row.symbol]) {checkMetadata(chart,'linked chart'); if(!object(chart.stock_data)) fail(`missing chart stock data ${row.symbol}`); checkRow(chart.stock_data,'linked chart');}
    }
    canonicalRows.push(detail); bySymbol.set(row.symbol, detail); counts.details++;
  }
  for (const symbol of Object.keys(projection.symbols)) if (!bySymbol.has(symbol)) fail(`missing cohort symbol ${symbol}`);
  validateResearchListSummaries(wire, index.rows, builtAt); validatePublishedSummaries(canonicalRows, builtAt);
  for (const now of new Set([builtAt, checkedAt])) validateResearchParity(wire, canonicalRows, now);
  const chartIndex=await read(entry.assets.charts.path);checkMetadata(chartIndex,'chart index');
  for(const item of chartIndex.symbols || []) if(projection.symbols[item.symbol]) {const chart=await read(item.path);if(chartSymbol(chart)!==item.symbol) fail(`chart index identity mismatch ${item.symbol}`);}
  const history = await read('financial-history.json'); checkMetadata(history, 'history');
  for (const [symbol, item] of Object.entries(projection.symbols)) equal(history.results?.[symbol], item.financial_history, `history mismatch ${symbol}`);
  equal(index.instrument_applicability_universe,applicabilityUniverse(canonicalRows),'applicability universe mismatch');
  const scan = await read(entry.pages.scan.path), list = await read(entry.pages.scan.list_path);
  const inspectAliases = (value, name) => {
    for (const key of ['rows', 'initial_rows', 'preview_rows', 'results', 'stocks', 'members']) if (Array.isArray(value[key])) for (const row of value[key]) {
      if (!bySymbol.has(row.symbol)) fail(`unexpected scan symbol ${row.symbol}`);
      checkRow(row, `${name}/${key}`,false,true); counts.scan_rows++;
    }
  };
  const allList = [];
  for (const [name, value] of [['scan', scan], ['list', list]]) {
    checkMetadata(value, name); inspectAliases(value, name);
    const gathered=[];
    for (const ref of value.chunks || []) { const chunk = await read(ref.path); checkMetadata(chunk, ref.path); inspectAliases(chunk, ref.path); gathered.push(...chunk.rows); if (name === 'list') allList.push(...chunk.rows); }
    if(!value.chunks?.length) gathered.push(...(value.rows || value.initial_rows || []));
    equal(gathered.map(row=>row.symbol).sort(),[...bySymbol.keys()].sort(),`${name} full universe mismatch`);
  }
  equal(allList.map(row => row.symbol).sort(), [...bySymbol.keys()].sort(), 'scan list universe mismatch');
  for (const value of [scan,list]) for (const screen of value.preset_screens || []) {
    const count = filterStaticScanRows(allList, screen.filters || {}, {now: builtAt}).length;
    if (screen.match_count !== (screen.limit ? Math.min(count, screen.limit) : count)) fail('preset count mismatch');
  }
  const filtered = sortStaticScanRows(filterStaticScanRows(allList, scan.default_filters || {}, {now: builtAt}), 'se_setup_score', 'desc', {now: builtAt});
  equal(scan.initial_rows?.map(row=>row.symbol),filtered.slice(0,50).map(row=>row.symbol),'scan initial membership mismatch');
  equal(list.initial_rows,[],'compact scan initial rows mismatch');
  for (const value of [scan, list]) {
    if (value.default_filtered_rows_total !== filtered.length) fail('scan filter count mismatch');
    equal(value.preview_rows?.map(row => row.symbol), filtered.slice(0, 10).map(row => row.symbol), 'scan preview mismatch');
  }
  for (const path of await jsonFiles(root)) {
    const value = await read(path), symbol = chartSymbol(value);
    if (!projection.symbols[symbol]) continue;
    checkMetadata(value, path); counts.charts++;
    if(CORRECTION_FIELDS.some(key=>Object.hasOwn(value,key))) checkRow(value,path);
    for (const key of ['stock_data', 'fundamentals']) if (object(value[key])) checkRow({...value[key], symbol: value[key].symbol ?? symbol}, `${path}/${key}`);
    if (Object.hasOwn(value, 'eps_line') && (!Array.isArray(value.eps_line) || value.eps_line.length)) fail(`stale EPS chart ${path}`);
  }
  const readPublic = async name => JSON.parse(await readFile(resolve(dataRoot, '..', name), 'utf8'));
  const audit = await readPublic('qualification-audit.json'), daily = await readPublic('research-daily.json'), portfolio = await readPublic('portfolio-model.json');
  for (const [name, value] of [['audit', audit], ['daily', daily], ['portfolio', portfolio]]) checkMetadata(value, name);
  equal(audit.results, JSON.parse(JSON.stringify(canonicalRows.map(row => ({symbol: row.symbol, audit: row.technical_audit, methods: Object.fromEntries(['minervini', 'minervini2', 'ibd'].map(method => [method, assess(row, method, builtAt)]))})))), 'qualification audit mismatch');
  const candidates = Object.fromEntries(['oneil', 'minervini', 'minervini2', 'ibd'].map(method => [method, rankCandidates(canonicalRows, method, {liquidOnly: true, now: builtAt}).filter(item => item.assessment.qualified).slice(0, 50).map(({row, assessment}) => ({symbol: row.symbol, rs_estimate: row.rs_rating, passed: assessment.passed, total: assessment.total}))]));
  equal(daily.candidates, candidates, 'daily candidates mismatch');
  equal(daily.ibd_comparison,compareReference(candidates.ibd,await readPublic('ibd-reference.json'),index.as_of_date),'IBD reference comparison mismatch');
  const plan = buildPortfolioPlan(canonicalRows, index.as_of_date, 100000, builtAt);
  for (const [key, value] of Object.entries(plan)) equal(portfolio[key], JSON.parse(JSON.stringify(value)), `portfolio ${key} mismatch`);
  const workbenchRef=entry.assets.workbench, summaryRef=entry.assets.workbench_summary;
  const workbench = await read(workbenchRef.path), summary = await read(summaryRef.path);
  if(sha(await readFile(resolve(dataRoot,workbenchRef.path)))!==workbenchRef.sha256 || sha(await readFile(resolve(dataRoot,summaryRef.path)))!==summaryRef.sha256) fail('workbench content hash mismatch');
  checkMetadata(workbench, 'workbench'); checkMetadata(summary, 'workbench summary');
  validateWorkbenchSummary(summary,summaryRef,workbenchRef,index.as_of_date,entry.assets.research.path,true);
  validateWorkbenchDetails(workbench,summary);
  await verifyWorkbenchComparison({root:dataRoot,workbench,canonicalRows});
  equal(summary,summarizeWorkbench(workbench,workbenchRef),'workbench summary mismatch');
  if(workbench.source_research_sha256!==researchHash || workbench.snapshot_id!==workbenchRef.snapshot_id) fail('workbench research or snapshot identity mismatch');
  let prices=null;try {prices=await read('sector-prices.json');} catch(error) {if(error.code!=='ENOENT') throw error;}
  equal(workbench.sectors,sectorStrength(canonicalRows,prices,index.as_of_date,builtAt),'workbench sectors mismatch');
  const snapshotPath = resolve(dataRoot, workbench.current_snapshot.path);
  if (!snapshotPath.startsWith(dataRoot + sep)) fail('invalid snapshot path');
  const snapshotRaw = await readFile(snapshotPath);
  if (sha(snapshotRaw) !== workbench.current_snapshot.sha256) fail('current snapshot hash mismatch');
  const snapshotContent=workbench.current_snapshot.path.endsWith('.gz') ? gunzipSync(snapshotRaw) : snapshotRaw;
  const snapshot=JSON.parse(snapshotContent.toString('utf8'));
  if(sha(snapshotContent)!==workbench.snapshot_id || snapshot.as_of!==index.as_of_date || workbench.current_snapshot.as_of!==index.as_of_date || snapshot.source_research_sha256!==researchHash || snapshot.rule_version!==workbench.rule_version || snapshot.universe_version!==workbench.universe_version) fail('current snapshot identity mismatch');
  checkMetadata(snapshot, 'current snapshot');
  equal(snapshot.records, selectionSnapshot(canonicalRows, {}, builtAt).records, 'current snapshot assessments mismatch');
  return {schema_version: 'financial-correction-compatibility-v1', financial_generation: projection.financial_generation, financial_evaluated_at: builtAt, financial_knowledge_basis: basis, cohort_symbols: Object.keys(projection.symbols).sort(), counts, assessment_sha256: digest(canonicalRows.map(row => [row.symbol, Object.fromEntries(RESEARCH_METHODS.map(method => [method, assess(row, method, builtAt)]))]))};
}
