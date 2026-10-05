// Ordinary price builds may reuse only an immutable, explicitly owned financial
// source generation. This is a separate destination contract, never a relaxed
// same-price correction. No provider, FX, receipt replay, or new source clock.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import currentContract from '../contracts/static_financial_current_v1.json' with { type: 'json' };
import { FINANCIAL_FIELDS, currentFinancialHistory } from '../src/static/financialCurrent.js';
import { instrumentIdentityEvidence } from '../src/static/instrumentApplicability.js';
import { CORRECTION_FIELDS, validateCorrectionProjection, verifyFinancialProjectionCompatibility } from './financial-correction-overlay.mjs';

export const FINANCIAL_GENERATION_CARRY_SCHEMA = 'financial-generation-carry-v1';
export const FINANCIAL_GENERATION_CARRY_ENV = Object.freeze([
  'FINANCIAL_GENERATION_CARRY_PROJECTION', 'FINANCIAL_GENERATION_CARRY_SHA256',
  'FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE', 'FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY',
  'FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
// Stream canonical JSON: a full owned source archive can be tens of megabytes.
// Building a second recursively cloned object and giant JSON string here would
// multiply memory without adding any audit strength.
function digest(value) {
  const output = createHash('sha256');
  const visit = value => {
    if (Array.isArray(value)) {
      output.update('['); value.forEach((entry, index) => { if (index) output.update(','); visit(entry); }); output.update(']');
    } else if (object(value)) {
      output.update('{'); Object.keys(value).sort().forEach((key, index) => { if (index) output.update(','); output.update(JSON.stringify(key)); output.update(':'); visit(value[key]); }); output.update('}');
    } else output.update(JSON.stringify(value));
  };
  visit(value); return output.digest('hex');
}
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const publicationIdentity = value => typeof value === 'string' && /^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(value);
const clock = value => typeof value === 'number' ? value : Date.parse(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const fail = message => { throw Error(`Financial carry ${message}`); };
const equal = (actual, expected, label) => { if (!isDeepStrictEqual(actual, expected)) fail(`${label} mismatch`); };
const MAX_BYTES = 256 * 1024 * 1024;
const validatedCarryScopes = new WeakMap();
// This capability exists only after bound source/target validation. A serialized
// schema label cannot authorize a containing-date change in the overlay.
export function observedFinancialCarryScope(carry, row, priorScope) {
  const binding = validatedCarryScopes.get(carry)?.get(row.symbol), scope = binding?.scope;
  if (!scope || row.market !== scope.market || row.as_of_date !== scope.as_of_date || priorScope.symbol !== scope.symbol || priorScope.market !== scope.market || !binding.priorDates.has(priorScope.as_of_date)) return null;
  return { ...scope };
}

function boundJson(input, expected, label) {
  if (!(typeof input === 'string' || Buffer.isBuffer(input)) || !sha256(expected)) fail(`${label} requires exact JSON bytes and SHA256`);
  const raw = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (Buffer.byteLength(raw) > MAX_BYTES || hash(raw) !== expected) fail(`${label} hash mismatch`);
  const value = JSON.parse(raw);
  if (!object(value)) fail(`invalid ${label}`);
  return { raw, value };
}
function baseRows(base, now, label) {
  if (!day(base.as_of_date) || Date.parse(base.as_of_date) > now || base.market !== 'US' || !Array.isArray(base.rows) || !base.rows.length || Object.hasOwn(base, 'results')) fail(`invalid ${label} base`);
  const rows = new Map();
  for (const row of base.rows) {
    if (!object(row) || typeof row.symbol !== 'string' || !row.symbol || ['__proto__', 'constructor', 'prototype'].includes(row.symbol) || rows.has(row.symbol) || row.market !== 'US' || (row.as_of_date ?? base.as_of_date) !== base.as_of_date) fail(`invalid ${label} row identity`);
    rows.set(row.symbol, row);
  }
  return rows;
}
const text = value => typeof value === 'string' && value.trim().length > 0;
const normalizeName = value => text(value) ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : null;
const identifier = (value, kind) => {
  if (!text(value) && !(kind === 'cik' && Number.isSafeInteger(value) && value >= 0)) return null;
  const normalized = String(value).trim().toUpperCase();
  return kind === 'cik' && /^\d{1,10}$/.test(normalized) ? normalized.padStart(10, '0') : normalized;
};
// Preserve malformed supplied identifiers for conflict detection, but never let
// matching placeholders or impossible check digits establish issuer continuity.
function validIdentifier(value, kind) {
  if (kind === 'cik') return /^[0-9]{10}$/.test(value) && /[1-9]/.test(value);
  if (kind === 'cusip') {
    if (!/^[0-9A-Z*@#]{8}[0-9]$/.test(value) || /^0{9}$/.test(value)) return false;
    const sum = [...value.slice(0, 8)].reduce((total, character, index) => {
      const code = /[0-9]/.test(character) ? Number(character) : /[A-Z]/.test(character) ? character.charCodeAt(0) - 55 : { '*': 36, '@': 37, '#': 38 }[character];
      const digit = code * (index % 2 ? 2 : 1);
      return total + Math.floor(digit / 10) + digit % 10;
    }, 0);
    return (10 - sum % 10) % 10 === Number(value[8]);
  }
  if (!/^[A-Z]{2}[0-9A-Z]{9}[0-9]$/.test(value)) return false;
  const expanded = [...value].map(character => /[0-9]/.test(character) ? character : String(character.charCodeAt(0) - 55)).join('');
  const sum = [...expanded].reverse().reduce((total, character, index) => {
    const digit = Number(character) * (index % 2 ? 2 : 1);
    return total + Math.floor(digit / 10) + digit % 10;
  }, 0);
  return sum % 10 === 0;
}
const positiveName = (value, symbol) => value !== symbol.normalize('NFKC').toLowerCase() && !/^(?:unknown|unavailable|n\/?a|none|null|not available|not applicable|missing|undefined|[-?. 0-9]+)$/.test(value);
function identity(row, additionalContexts = []) {
  const contexts = [...instrumentIdentityEvidence(row), ...additionalContexts];
  const names = [...new Set(contexts.flatMap(value => [value.company_name, value.name, value.product_name, value.observed_name]).map(normalizeName).filter(Boolean))].sort();
  const identifiers = Object.fromEntries(['cik', 'cusip', 'isin'].map(kind => [kind, [...new Set(contexts.flatMap(value => [value[kind], kind === 'cik' ? value.issuer_cik : null, value.observed_identifiers?.[kind]]).map(value => identifier(value, kind)).filter(Boolean))].sort()]));
  const conflict = contexts.some(value => value.symbol != null && value.symbol !== row.symbol || value.market != null && value.market !== row.market) || names.length > 1 || Object.values(identifiers).some(values => values.length > 1);
  const types = [...new Set(contexts.flatMap(value => [value.quoteType, value.quote_type]).filter(text).map(value => value.trim().toUpperCase()))].sort();
  return { names, identifiers, types, conflict: conflict || types.length > 1 };
}
function ownership(sourceRow, item, targetRow) {
  if (!item || !sourceRow) return 'unowned_symbol';
  if (item.market !== targetRow.market || sourceRow.market !== targetRow.market) return 'identity_mismatch';
  const previous = identity(sourceRow, instrumentIdentityEvidence({ ...item, symbol: targetRow.symbol }));
  const current = identity(targetRow);
  if (previous.conflict || current.conflict) return 'identity_mismatch';
  let matched = false;
  for (const [oldValues, newValues] of [[previous.names, current.names], [previous.types, current.types], ...Object.keys(previous.identifiers).map(kind => [previous.identifiers[kind], current.identifiers[kind]])]) {
    if (!oldValues.length || !newValues.length) continue;
    if (!isDeepStrictEqual(oldValues, newValues)) return 'identity_mismatch';
  }
  if (previous.names.length && current.names.length && previous.names.every(value => positiveName(value, targetRow.symbol))) matched = true;
  if (Object.keys(previous.identifiers).some(kind => previous.identifiers[kind].length && current.identifiers[kind].length && previous.identifiers[kind].every(value => validIdentifier(value, kind)))) matched = true;
  return matched ? 'retained' : 'unverified_issuer_identity';
}
function unknownSymbol(row, date, now, reason) {
  return {
    market: row.market, as_of_date: date,
    financial_values: Object.fromEntries(CORRECTION_FIELDS.map(field => [field, null])),
    financial_source_evidence: null,
    financial_current: { v: currentContract.version, t: now, s: row.symbol, m: row.market, a: date, r: (reason === 'identity_mismatch' ? '4' : '2').repeat(FINANCIAL_FIELDS.length), p: {} },
    financial_history: { symbol: row.symbol, as_of_date: date, status: 'unavailable', basis: 'current-observation', source: null, retrieved_at: null, currency: null, annual: [], quarterly: [] },
    source_diagnostics: { carry_status: reason, fields: Object.fromEntries(FINANCIAL_FIELDS.map(field => [field, reason])) },
    history_source_diagnostics: { carry_status: reason, reasons: { annual: reason, quarterly: reason }, original_receipts: [] },
    source_receipts: [],
  };
}

// Raw bytes bind the audit artifact exactly, including its original whitespace.
// The controller verifies the certified lineage; this helper binds that lineage
// to its immutable projection/base and the whole new destination universe.
export function createFinancialGenerationCarry({ sourceProjection, sourceProjectionSha256, sourceBase, sourceBaseSha256, sourceLineage, previousPublicationIdentity, targetBase, targetBaseSha256, evaluatedAt } = {}) {
  const now = clock(evaluatedAt);
  if (!Number.isSafeInteger(now) || now < 0 || !sha256(sourceLineage) || !publicationIdentity(previousPublicationIdentity)) fail('invalid evaluation or lineage binding');
  const source = boundJson(sourceProjection, sourceProjectionSha256, 'source projection');
  validateCorrectionProjection(source.value);
  const originalTime = clock(source.value.financial_evaluated_at);
  if (now < originalTime) fail('evaluation precedes original source projection');
  const original = boundJson(sourceBase, sourceBaseSha256, 'source base');
  if (source.value.bindings.target_base_sha256 !== sourceBaseSha256) fail('source projection/base binding mismatch');
  const target = boundJson(targetBase, targetBaseSha256, 'target base');
  const originalRows = baseRows(original.value, originalTime, 'source'), targetRows = baseRows(target.value, now, 'target');
  if (target.value.as_of_date < original.value.as_of_date) fail('target price date precedes source destination');
  for (const [symbol, item] of Object.entries(source.value.symbols)) {
    if (!originalRows.has(symbol) || originalRows.get(symbol).market !== item.market || item.as_of_date !== original.value.as_of_date) fail(`unbound source symbol ${symbol}`);
  }
  const symbols = {}, ownershipBySymbol = {};
  for (const symbol of [...targetRows.keys()].sort()) {
    const row = targetRows.get(symbol), item = source.value.symbols[symbol];
    const status = ownership(originalRows.get(symbol), item, row);
    ownershipBySymbol[symbol] = status;
    if (status !== 'retained') symbols[symbol] = unknownSymbol(row, target.value.as_of_date, now, status);
    else {
      // Inputs are private JSON parses, so reuse their untouched large evidence
      // trees and allocate only the destination objects that actually change.
      const retained = {...item, financial_current:{...item.financial_current}, financial_history:{...item.financial_history}};
      // Only destination dates change. Keep the original proof evaluation and
      // all proof tuples, receipt clocks, history cells, currency and evidence.
      retained.as_of_date = target.value.as_of_date;
      retained.financial_current.a = target.value.as_of_date;
      retained.financial_history.as_of_date = target.value.as_of_date;
      symbols[symbol] = retained;
    }
  }
  const carry = {
    schema_version: FINANCIAL_GENERATION_CARRY_SCHEMA,
    financial_evaluated_at: new Date(now).toISOString(),
    knowledge_basis: source.value.knowledge_basis, point_in_time: false, source_publication_date: null,
    bindings: { source_projection_sha256: sourceProjectionSha256, source_base_sha256: sourceBaseSha256, source_lineage_sha256: sourceLineage, previous_publication_identity: previousPublicationIdentity, target_base_sha256: targetBaseSha256 },
    source_projection_json: source.raw, source_base_json: original.raw, target_base_json: target.raw,
    source_financial_generation: source.value.financial_generation,
    policy: { id: FINANCIAL_GENERATION_CARRY_SCHEMA, source_policy: structuredClone(source.value.policy) },
    receipt_inventory: structuredClone(source.value.receipt_inventory), receipt_inventory_sha256: source.value.receipt_inventory_sha256,
    ownership: ownershipBySymbol, symbols,
  };
  const result = { ...carry, financial_generation: digest(carry) };
  validatedCarryScopes.set(result, new Map([...targetRows].filter(([symbol]) => ownershipBySymbol[symbol] === 'retained').map(([symbol, row]) => {
    const priorDates = new Set(original.value.as_of_date < target.value.as_of_date ? [original.value.as_of_date] : []);
    const observed = row.financial_identity?.observed_scope;
    if (observed?.symbol === symbol && observed.market === row.market && day(observed.as_of_date) && observed.as_of_date >= original.value.as_of_date && observed.as_of_date < target.value.as_of_date) priorDates.add(observed.as_of_date);
    return [symbol, {scope:Object.freeze({symbol, market:row.market, as_of_date:target.value.as_of_date}), priorDates}];
  })));
  return result;
}

export function validateFinancialGenerationCarry(carry, { evaluatedAt, sourceLineage, previousPublicationIdentity, targetBaseSha256 } = {}) {
  if (carry?.schema_version !== FINANCIAL_GENERATION_CARRY_SCHEMA || !object(carry.bindings)) fail('unsupported carry contract');
  const expected = createFinancialGenerationCarry({
    sourceProjection: carry.source_projection_json, sourceProjectionSha256: carry.bindings.source_projection_sha256,
    sourceBase: carry.source_base_json, sourceBaseSha256: carry.bindings.source_base_sha256,
    targetBase: carry.target_base_json, targetBaseSha256: carry.bindings.target_base_sha256,
    sourceLineage: carry.bindings.source_lineage_sha256, previousPublicationIdentity: carry.bindings.previous_publication_identity, evaluatedAt: carry.financial_evaluated_at,
  });
  equal(carry, expected, 'immutable derivation');
  for (const [value, expectedValue, label] of [[clock(carry.financial_evaluated_at), evaluatedAt === undefined ? undefined : clock(evaluatedAt), 'evaluation instant'], [carry.bindings.source_lineage_sha256, sourceLineage, 'source lineage'], [carry.bindings.previous_publication_identity, previousPublicationIdentity, 'previous publication'], [carry.bindings.target_base_sha256, targetBaseSha256, 'target base']]) if (expectedValue !== undefined) equal(value, expectedValue, label);
  validatedCarryScopes.set(carry, validatedCarryScopes.get(expected));
  return carry;
}

export async function readFinancialGenerationCarry({ env = process.env } = {}) {
  if (!FINANCIAL_GENERATION_CARRY_ENV.some(key => env[key] !== undefined)) return null;
  if (Object.keys(env).some(key => key.startsWith('FINANCIAL_CORRECTION_') && env[key] !== undefined)) fail('correction and carry modes are mutually exclusive');
  if (FINANCIAL_GENERATION_CARRY_ENV.some(key => !env[key]) || !env.FINANCIAL_EVALUATED_AT || !isAbsolute(env.FINANCIAL_GENERATION_CARRY_PROJECTION) || !sha256(env.FINANCIAL_GENERATION_CARRY_SHA256)) fail('incomplete opt-in bindings');
  const stat = await lstat(env.FINANCIAL_GENERATION_CARRY_PROJECTION);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) fail('invalid carry projection file');
  const raw = await readFile(env.FINANCIAL_GENERATION_CARRY_PROJECTION);
  if (hash(raw) !== env.FINANCIAL_GENERATION_CARRY_SHA256) fail('projection hash mismatch');
  const carry = validateFinancialGenerationCarry(JSON.parse(raw), { evaluatedAt: env.FINANCIAL_EVALUATED_AT, sourceLineage: env.FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE, previousPublicationIdentity: env.FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY, targetBaseSha256: env.FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256 });
  return carry;
}

export async function loadFinancialGenerationCarry({ env = process.env, rows, asOfDate } = {}) {
  const carry = await readFinancialGenerationCarry({env});
  if (!carry) return null;
  const target = JSON.parse(carry.target_base_json), targetRows = baseRows(target, clock(carry.financial_evaluated_at), 'target');
  if (target.as_of_date !== asOfDate || !Array.isArray(rows) || new Set(rows.map(row => row.symbol)).size !== rows.length) fail('target universe mismatch');
  equal(rows.map(row => row.symbol).sort(), [...targetRows.keys()].sort(), 'target universe');
  for (const row of rows) {
    const expected = targetRows.get(row.symbol);
    if (row.market !== expected.market || (row.as_of_date ?? asOfDate) !== asOfDate) fail(`target row mismatch ${row.symbol}`);
    // The full target bytes are bound above; these exporter input fields stop a
    // different price universe or issuer being substituted before the overlay.
    for (const key of ['current_price', 'adv_usd']) equal(row[key], expected[key], `target ${row.symbol}/${key}`);
    equal(identity(row), identity(expected), `target issuer ${row.symbol}`);
  }
  return carry;
}

export async function verifyCarryCompatibility({ root, carry, evaluatedAt } = {}) {
  validateFinancialGenerationCarry(carry);
  const builtAt = clock(carry.financial_evaluated_at), checkedAt = clock(evaluatedAt ?? Date.now());
  const report = await verifyFinancialProjectionCompatibility({ root, projection: carry, evaluatedAt: checkedAt });
  // Native annual and quarterly receipt clocks are independent. The shared
  // verifier's any-history-valid check is insufficient when only one expires.
  for (const [symbol, item] of Object.entries(carry.symbols)) {
    const before = currentFinancialHistory(item.financial_history, symbol, item.as_of_date, builtAt);
    const after = currentFinancialHistory(item.financial_history, symbol, item.as_of_date, checkedAt);
    if (before.annual.length > after.annual.length || before.quarterly.length > after.quarterly.length || before.annualComplete && !after.annualComplete || before.epsYoY !== null && after.epsYoY === null || before.salesYoY !== null && after.salesYoY === null) fail(`current history expired or invalid ${symbol}`);
  }
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if ((manifest.markets?.US || manifest).as_of_date !== JSON.parse(carry.target_base_json).as_of_date) fail('published target date mismatch');
  return { ...report, schema_version: 'financial-generation-carry-compatibility-v1', source_lineage_sha256: carry.bindings.source_lineage_sha256, source_financial_generation: carry.source_financial_generation, ownership: structuredClone(carry.ownership) };
}
