import { projectFinancialRow } from './financialCurrent.js';
import { FINANCIAL_PUBLICATION_EXCEPTION } from './financialPublicationExceptionPolicy.js';
import { INSTRUMENT_IDENTITY_FIELDS } from './instrumentApplicability.js';
import { validClock } from './evidenceTime.js';

const fields = ['eps_growth_yy', 'sales_growth_yy', 'eps_growth_annual'];
const metadata = ['symbol', 'market', 'as_of_date', 'financial_generation', 'financial_evaluated_at',
  'financial_knowledge_basis', 'financial_point_in_time', 'financial_source_publication_date', 'financial_policy_version'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const empty = value => value === null || value === undefined;
const keys = (value, names) => object(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|');
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a), bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every(key => Object.hasOwn(b, key) && same(a[key], b[key])) &&
    (!Array.isArray(a) || a.length === b.length);
};
const slot = (value, name) => !Object.hasOwn(value, name) ? { present: false }
  : value[name] === undefined ? { present: true, unsupported: true } : { present: true, value: structuredClone(value[name]) };
const slots = row => Object.fromEntries(fields.map(name => [name, slot(row, name)]));
const binding = row => ({ ...Object.fromEntries(metadata.map(name => [name, slot(row, name)])),
  proof: slot(row, 'financial_current'), scope: slot(row.financial_identity || {}, 'observed_scope'),
  identity: Object.fromEntries(INSTRUMENT_IDENTITY_FIELDS.map(name => [name, slot(row, name)])) });

function matchesProjectedProof(current, original, projected, audit, date, now) {
  if (same(current, original) || same(current, slot(projected, 'financial_current'))) return true;
  if (!keys(current, ['present', 'value']) || !current.present || !keys(original, ['present', 'value']) || !original.present ||
      !object(current.value) || !object(original.value) || typeof original.value.r !== 'string' ||
      typeof current.value.r !== 'string' || current.value.r.length !== original.value.r.length ||
      !object(current.value.p) || !object(original.value.p)) return false;
  const expected = structuredClone(original.value);
  for (let index = 0; index < expected.r.length; index++) {
    const code = current.value.r[index];
    if (code === expected.r[index]) continue;
    if (expected.r[index] !== 'f' || Object.hasOwn(current.value.p, index)) return false;
    let output = projected.financial_current;
    if (code !== output?.r?.[index] || Object.hasOwn(output?.p || {}, index)) {
      // A previously withheld reference keeps its first rejection code. Source
      // expiry can precede reporting-period expiry, so a legitimate earlier 7
      // must remain valid even when a new projection would now produce a.
      const firstExpiry = Math.max(audit.financial_evaluated_at, original.value.p[index]?.[5] + 1);
      if (code !== '7' || !validClock(firstExpiry) || firstExpiry > now) return false;
      output = projectFinancialRow(audit, { now: firstExpiry, asOfDate: date }).financial_current;
      if (output?.r?.[index] !== code || Object.hasOwn(output?.p || {}, index)) return false;
    }
    expected.r = expected.r.slice(0, index) + code + expected.r.slice(index + 1);
    delete expected.p[index];
  }
  return same(current.value, expected);
}

// Mint only from authenticated correction inputs, before destructive current
// projection. This is a decision input, never a source of displayed values or
// freshness. The publication verifier independently regenerates it from source.
export function captureFinancialPublicationInput(row) {
  if (row?.market !== 'US' || !FINANCIAL_PUBLICATION_EXCEPTION.symbols.includes(row.symbol)) return undefined;
  return { version: 1, binding: binding(row), slots: slots(row) };
}

// Recheck the original current slots at the live clock. Historical predecessor
// values cannot distinguish a valid expired input from a malformed current one.
// Never use this audit copy to overwrite the live row or its financial history.
export function financialPublicationInput(row, { date, now }) {
  const input = row.financial_publication_input;
  if (!keys(input, ['version', 'binding', 'slots']) || input.version !== 1 || !object(input.binding)) return null;
  const { proof, ...originalBinding } = input.binding;
  const { proof: currentProof, ...currentBinding } = binding(row);
  if (!same(originalBinding, currentBinding) || !keys(input.slots, fields) ||
      !/^[a-f0-9]{64}$/.test(row.financial_generation) || !validClock(row.financial_evaluated_at) ||
      row.financial_evaluated_at > now || !validClock(now)) return null;
  const audit = { ...row };
  if (keys(proof, ['present']) && proof.present === false) delete audit.financial_current;
  else if (keys(proof, ['present', 'value']) && proof.present === true) audit.financial_current = structuredClone(proof.value);
  else return null;
  for (const name of fields) {
    const value = input.slots[name];
    if (keys(value, ['present']) && value.present === false) delete audit[name];
    else if (keys(value, ['present', 'value']) && value.present === true && (value.value === null || finite(value.value))) audit[name] = value.value;
    else return null;
  }
  if (!empty(audit.eps_growth_annual) && audit.eps_growth_annual !== audit.eps_growth_yy) return null;
  const projected = projectFinancialRow(audit, { now, asOfDate: date });
  // Comparison-only proof can legitimately be rewritten by the existing
  // projector when it expires. Admit only that exact result, never an arbitrary
  // reason-code edit or tuple deletion. The live proof remains untouched.
  if (!matchesProjectedProof(currentProof, proof, projected, audit, date, now)) return null;
  // A null source with an ordinary-growth proof is a contradiction, not an
  // unavailable observation. Source validation also rejects this at export.
  for (const [name, index] of [['eps_growth_yy', 1], ['sales_growth_yy', 3]]) {
    if (audit.financial_current?.r?.[index] === '0' && empty(audit[name])) return null;
  }
  const currentSlots = slots(row), projectedSlots = slots(projected);
  for (const group of [['eps_growth_yy', 'eps_growth_annual'], ['sales_growth_yy']]) {
    if (!group.every(name => same(currentSlots[name], input.slots[name])) &&
        !group.every(name => same(currentSlots[name], projectedSlots[name]))) return null;
  }
  return { input: audit, current: projected };
}
