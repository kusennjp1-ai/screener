import { encodeResearchFloat64, decodeResearchFloat64 } from './researchFloat64.js';
import { encodeResearchHex, decodeResearchHex } from './researchHex.js';

// A bounded, lossless column layout for dense arrays of plain scalar records.
// Invalid/more complex proof shapes stay atomic in the older representation.
const MAX_ARRAY = 256, MAX_RECORDS = 100000, MAX_FIELDS = 64, MAX_CELLS = 1000000;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dense = value => Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const key = value => Object.is(value, -0) ? '-0' : JSON.stringify(value);
const exact = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const fail = () => { throw Error('Invalid record-array research column'); };

function encodeCells(cells, bytes) {
  const pool = [], ids = new Map();
  const refs = cells.map(value => {
    if (value === undefined) return -1;
    const id = key(value);
    if (!ids.has(id)) { ids.set(id, pool.length); pool.push(value); }
    return ids.get(id);
  });
  const forms = [{ pool, refs }, ...(!refs.includes(-1) ? [{ values: cells }] : [])];
  for (const form of [...forms]) for (const [prefix, encode] of [['f64', encodeResearchFloat64], ['hex', encodeResearchHex]]) {
    const field = Object.hasOwn(form, 'pool') ? 'pool' : 'values', vector = encode(form[field]);
    if (vector) forms.push({ [`${prefix}_${field}`]: vector, ...(field === 'pool' ? { refs } : {}) });
  }
  return forms.reduce((best, form) => bytes(form) < bytes(best) ? form : best);
}

export function encodeResearchRecordArrays(values, bytes) {
  if (!Array.isArray(values) || values.length > MAX_RECORDS || !dense(values) || typeof bytes !== 'function') return null;
  const records = [], lengths = [], fields = [], seen = new Set();
  for (const value of values) {
    if (value === null) { lengths.push(-1); continue; }
    if (!Array.isArray(value) || value.length > MAX_ARRAY || !dense(value)) return null;
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) return null;
      const row = value[i];
      if (!object(row) || Object.getPrototypeOf(row) !== Object.prototype || Reflect.ownKeys(row).length !== Object.keys(row).length) return null;
      for (const [name, item] of Object.entries(row)) {
        if (forbidden.has(name) || !scalar(item)) return null;
        if (!seen.has(name)) { seen.add(name); fields.push(name); }
      }
      records.push(row);
    }
    lengths.push(value.length);
    if (records.length > MAX_RECORDS || fields.length > MAX_FIELDS || records.length * fields.length > MAX_CELLS) return null;
  }
  if (!values.some(Array.isArray)) return null;
  return { count: values.length, lengths, fields, columns: fields.map(field => encodeCells(records.map(row => Object.hasOwn(row, field) ? row[field] : undefined), bytes)) };
}

function decodeCells(input, count) {
  if (!object(input)) fail();
  let source = input;
  const binary = ['f64', 'hex'].flatMap(prefix => ['pool', 'values'].filter(field => Object.hasOwn(input, `${prefix}_${field}`)).map(field => ({ prefix, field })));
  if (binary.length) {
    const { prefix, field } = binary[0], name = `${prefix}_${field}`;
    if (binary.length !== 1 || !exact(input, [name, ...(field === 'pool' ? ['refs'] : [])])) fail();
    const vector = (prefix === 'f64' ? decodeResearchFloat64 : decodeResearchHex)(input[name], count);
    source = { [field]: vector, ...(field === 'pool' ? { refs: input.refs } : {}) };
  }
  if (exact(source, ['values'])) {
    if (!Array.isArray(source.values) || source.values.length !== count || !dense(source.values) || !source.values.every(scalar)) fail();
    return source.values;
  }
  if (!exact(source, ['pool', 'refs']) || !Array.isArray(source.pool) || source.pool.length > count || !dense(source.pool) || !source.pool.every(scalar) || !Array.isArray(source.refs) || source.refs.length !== count || !dense(source.refs)) fail();
  return source.refs.map(id => {
    if (!Number.isSafeInteger(id) || id < -1 || id >= source.pool.length) fail();
    return id === -1 ? undefined : source.pool[id];
  });
}

export function decodeResearchRecordArrays(value, maximumCount) {
  if (!exact(value, ['count', 'lengths', 'fields', 'columns']) || !Number.isSafeInteger(maximumCount) || maximumCount < 0 || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > maximumCount || value.count > MAX_RECORDS ||
      !Array.isArray(value.lengths) || value.lengths.length !== value.count || !Array.isArray(value.fields) || value.fields.length > MAX_FIELDS || !Array.isArray(value.columns) || value.columns.length !== value.fields.length || !dense(value.lengths) || !dense(value.fields) || !dense(value.columns)) fail();
  let count = 0;
  for (let i = 0; i < value.lengths.length; i++) {
    const length = value.lengths[i];
    if (!Object.hasOwn(value.lengths, i) || !Number.isSafeInteger(length) || length < -1 || length > MAX_ARRAY) fail();
    count += Math.max(0, length);
    if (count > MAX_RECORDS || count * value.fields.length > MAX_CELLS) fail();
  }
  if (new Set(value.fields).size !== value.fields.length || value.fields.some(field => typeof field !== 'string' || forbidden.has(field))) fail();
  const columns = value.columns.map(column => decodeCells(column, count));
  let offset = 0;
  return value.lengths.map(length => {
    if (length === -1) return null;
    return Array.from({ length }, () => {
      const row = {};
      value.fields.forEach((field, column) => { if (columns[column][offset] !== undefined) row[field] = columns[column][offset]; });
      offset++;
      return row;
    });
  });
}
