import { ANNUAL_POINT_FIELDS, NATIVE_ANNUAL_SCHEMA, nativeAnnualHistoryContract } from './financialHistory.js';
// Versioned wire format. Decision inputs remain lossless; displayed numbers are
// formatted by the UI, never rounded before a threshold or order calculation.
import { encodeResearchFloat64, decodeResearchFloat64 } from './researchFloat64.js';
import { encodeResearchHex, decodeResearchHex } from './researchHex.js';
export const RESEARCH_TRANSPORT_VERSION = 'research-table-v2';
const legacyVersion = 'research-table-v1';
const sparseEncoding = 'present-values-and-missing-runs-v1';
const floatEncoding = 'sparse-float64-and-signed-zero-v1';
const binaryEncoding = 'sparse-binary-and-signed-zero-v1';
export const RESEARCH_METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];
const evaluationFields = ['financial_evaluated_at', 'financial_semantics', 'assessment_version', 'summary_storage', 'financial_generation', 'financial_knowledge_basis', 'financial_point_in_time', 'financial_source_publication_date', 'financial_policy_version', 'instrument_applicability_universe'];

const pick = (value, fields) => value && Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
// Annual eligibility depends on unsupported metadata being absent. Preserve
// those keys, plus a rejection-only marker: JSON may erase an undefined-valued
// key, but must never turn that rejected evidence into a comparable EPS series.
const annualPoint = point => point && Object.keys(point).some(key => !ANNUAL_POINT_FIELDS.includes(key))
  ? { ...point, invalid_transport_metadata: true } : pick(point, ['end', 'eps']);
export function researchListRow(row) {
  const out = { ...row };
  // Evidence envelopes and raw history belong to immutable on-demand detail.
  delete out.financial_current_state; delete out.financial_historical; delete out.financial_source_evidence;
  if (row.institutional_evidence) {
    // Preserve the validator's dates/unit, not just a precomputed pass flag.
    out.institutional_evidence = pick(row.institutional_evidence, ['symbol', 'status', 'unit', 'publication_cutoff']);
    out.institutional_evidence.observations = Array.isArray(row.institutional_evidence.observations)
      ? row.institutional_evidence.observations.map(item => pick(item, ['period', 'filing_date_first', 'filing_date_last', 'manager_count'])) : row.institutional_evidence.observations;
  }
  if (row.entry_evidence) out.entry_evidence = {
    as_of_date: row.entry_evidence.as_of_date,
    calendar: pick(row.entry_evidence.calendar, ['latest_completed_session', 'evaluated_at', 'valid_until']),
    earnings: pick(row.entry_evidence.earnings, ['date', 'checked_at']),
    shape: pick(row.entry_evidence.shape, ['candidate']),
    volumeRatio: row.entry_evidence.volumeRatio,
  };
  if (row.technical_audit) out.technical_audit = {
    ...pick(row.technical_audit, ['version', 'symbol', 'as_of_date', 'bars', 'errors', 'valid']),
    values: pick(row.technical_audit.values, ['close', 'sma50', 'sma150', 'sma200', 'sma200_21ago', 'aboveLow', 'belowHigh', 'volumeRatio', 'change', 'momentum']),
  };
  if (row.financial_history) out.financial_history = {
    ...pick(row.financial_history, ['symbol', 'market', 'as_of_date', 'status', 'basis', 'currency', 'retrieved_at', 'source', 'schema_version', 'annual_currency', 'quarterly_currency', 'quarterly_retrieved_at', 'annual_source']),
    // Do not strip contradictory per-cell currency/unit metadata into valid proof.
    annual: row.financial_history.schema_version === NATIVE_ANNUAL_SCHEMA && !nativeAnnualHistoryContract(row.financial_history, row.symbol) ? []
      : Array.isArray(row.financial_history.annual) ? row.financial_history.annual.map(annualPoint) : row.financial_history.annual,
  };
  return out;
}

const leaves = (value, path = [], result = []) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (!entries.length) result.push([path, {}]);
    else entries.forEach(([key, child]) => leaves(child, [...path, key], result));
  } else result.push([path, value]);
  return result;
};

const missingRuns = refs => {
  const missing = [];
  for (let row = 0; row < refs.length; row++) if (refs[row] === -1) {
    const start = row;
    while (row + 1 < refs.length && refs[row + 1] === -1) row++;
    missing.push([start, row + 1]);
  }
  return missing;
};
const cellKey = value => {
  const text = JSON.stringify(value), signs = negativeZeroPaths(value);
  return signs.length ? `${text}|negative-zero:${JSON.stringify(signs)}` : text;
};
const binaryColumn = (column, encode, prefix) => {
  const key = ['present', 'pool', 'values'].find(key => Array.isArray(column[key]));
  if (!key) return null;
  const vector = encode(column[key]);
  if (!vector) return null;
  const { [key]: values, ...rest } = column;
  void values;
  return { ...rest, [`${prefix}_${key}`]: vector };
};
const negativeZeroPaths = (value, path = [], result = []) => {
  if (Object.is(value, -0)) result.push(path);
  else if (Array.isArray(value)) value.forEach((child, index) => negativeZeroPaths(child, [...path, index], result));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) negativeZeroPaths(child, [...path, key], result);
  return result;
};
const restoreNegativeZero = (value, path) => {
  if (!path.length) { if (value !== 0) throw Error('Invalid signed-zero value'); return -0; }
  const [key, ...rest] = path;
  if (!value || typeof value !== 'object' || (Array.isArray(value) ? !Number.isSafeInteger(key) || key < 0 || key >= value.length
    : typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) || !Object.hasOwn(value, key)) throw Error('Invalid signed-zero path');
  // Dictionary cells can be shared between rows. Clone the changed path so a
  // sign correction cannot modify another row's equal-looking zero.
  const copy = Array.isArray(value) ? [...value] : { ...value };
  copy[key] = restoreNegativeZero(value[key], rest);
  return copy;
};

// Column dictionaries remove repeated metadata without rounding decision
// inputs. High-cardinality columns stay direct to avoid a second ID array.
export function encodeResearchIndex(index, orders, { columnBytes } = {}) {
  const rows = index.rows.map(researchListRow);
  // Expand only compact proof tuples into transport columns. Repeated source,
  // cadence, periods and clocks then share dictionaries; exact values can copy
  // the canonical scalar column. Decode restores the original proof contract.
  let financialProofEncoding;
  for (const row of rows) if (row.financial_current?.p && typeof row.financial_current.p === 'object' && !Array.isArray(row.financial_current.p)) {
    const proof = row.financial_current;
    const tupleLength = proof.v === 2 ? 8 : proof.v === 1 ? 6 : null;
    if (tupleLength && Object.values(proof.p).every(tuple=>Array.isArray(tuple) && tuple.length===tupleLength)) {
      row.financial_current={...proof,p:Object.fromEntries(Object.entries(proof.p).map(([field,tuple])=>[field,Object.fromEntries(tuple.map((value,index)=>[String(index),value]))]))};
      financialProofEncoding='tuple-columns-v1';
    } else row.financial_current={...proof,invalid_transport_proof:true};
  }
  const paths = {};
  for (const [field, directory] of [['chart_path', 'verified-charts'], ['research_detail_path', 'research-details']]) {
    if (!rows.every(row => row[field] == null || (typeof row[field] === 'string' && /-[a-f0-9]{16}\.json$/.test(row[field]) && row[field] === `${directory}/${encodeURIComponent(row.symbol)}-${row[field].slice(-21, -5)}.json`))) continue;
    paths[field] = directory;
    rows.forEach(row => { if (row[field] != null) row[field] = row[field].slice(-21, -5); });
  }
  const flattened = rows.map(row => new Map(leaves(row).filter(([, v]) => v !== undefined).map(([path, value]) => [JSON.stringify(path), value])));
  const fields = [...new Set(flattened.flatMap(row => [...row.keys()]))];
  const columns = fields.map(field => {
    // -1 denotes absent, which is distinct from explicit null and false.
    const pool = [], lookup = new Map();
    const refs = flattened.map(row => {
      if (!row.has(field)) return -1;
      const value = row.get(field), key = cellKey(value);
      let id = lookup.get(key);
      if (id === undefined) { id = pool.length; pool.push(value); lookup.set(key, id); }
      return id;
    });
    const direct = refs.map(id => id === -1 ? null : pool[id]);
    if (!refs.includes(-1)) return pool.length > rows.length / 4 ? { values: direct } : { pool, refs };
    const present = refs.filter(id => id !== -1);
    // Sparse high-cardinality columns otherwise repeat almost one dictionary
    // index per value. Retain the exact values and explicit absent-row runs.
    if (pool.length > present.length / 4) {
      const sparse = { present: present.map(id => pool[id]), missing: missingRuns(refs) };
      if (JSON.stringify(sparse).length < JSON.stringify({ pool, refs }).length) return sparse;
    }
    return { pool, refs };
  });
  // A few canonical inputs appear in multiple surfaces (close, symbol, volume
  // ratio, pivot). Reuse their exact column, with lossless sparse exceptions.
  const values = fields.map(field => flattened.map(row => row.get(field)));
  for (let column = 1; column < columns.length; column++) {
    let size = JSON.stringify(columns[column]).length;
    for (let previous = 0; previous < column; previous++) for (const factor of [1, -1]) {
      const patch = [];
      for (let row = 0; row < rows.length; row++) {
        const original = values[previous][row];
        const derived = factor === -1 && typeof original === 'number' ? -original : original;
        if (!Object.is(values[column][row], derived)) patch.push(values[column][row] === undefined ? [row] : [row, values[column][row]]);
        if (patch.length > rows.length * .4) break;
      }
      if (patch.length > rows.length * .4) continue;
      const candidate = { copy: previous, ...(factor === -1 ? { factor } : {}), patch };
      const length = JSON.stringify(candidate).length;
      if (length < size) { columns[column] = candidate; size = length; }
    }
  }
  // Publication budgets measure compressed bytes. The Node exporter can price
  // the existing representations with gzip without adding a browser dependency
  // or changing any scalar, presence bit, proof, or column-reference target.
  if (columnBytes) for (let column = 0; column < columns.length; column++) {
    const cells = values[column], pool = [], lookup = new Map();
    const refs = cells.map(value => {
      if (value === undefined) return -1;
      const key = cellKey(value);
      if (!lookup.has(key)) { lookup.set(key, pool.length); pool.push(value); }
      return lookup.get(key);
    });
    const forms = [columns[column], { pool, refs }, refs.includes(-1)
      ? { present: cells.filter(value => value !== undefined), missing: missingRuns(refs) }
      : { values: cells }];
    const alternatives = forms.flatMap(form => [form, binaryColumn(form, encodeResearchFloat64, 'f64'), binaryColumn(form, encodeResearchHex, 'hex')].filter(Boolean));
    let size = columnBytes(columns[column]);
    for (const candidate of alternatives) {
      const candidateSize = columnBytes(candidate);
      if (candidateSize < size) { columns[column] = candidate; size = candidateSize; }
    }
  }
  // Ordinary JSON erases -0, including inside mixed-type and array cells.
  // Preserve those sign bits explicitly; no value is rounded or inferred.
  const negativeZeros = [];
  values.forEach((cells, column) => cells.forEach((value, row) => negativeZeroPaths(value).forEach(path => negativeZeros.push([row, column, path]))));
  return { schema: RESEARCH_TRANSPORT_VERSION, column_encoding: binaryEncoding, as_of_date: index.as_of_date, ...pick(index, evaluationFields), count: rows.length, fields: fields.map(JSON.parse), columns, paths, orders,
    ...(negativeZeros.length ? { negative_zeros: negativeZeros } : {}), ...(financialProofEncoding ? {financial_proof_encoding:financialProofEncoding} : {}) };
}

export function decodeResearchIndex(value) {
  if (!value?.schema) return value;
  if (![legacyVersion, RESEARCH_TRANSPORT_VERSION].includes(value.schema) || !Array.isArray(value.fields) || !Array.isArray(value.columns) || value.fields.length !== value.columns.length || !Number.isSafeInteger(value.count) || value.count < 0) throw Error('Unsupported research data format');
  const sparseEnabled = value.schema === RESEARCH_TRANSPORT_VERSION && [sparseEncoding, floatEncoding, binaryEncoding].includes(value.column_encoding);
  const floatEnabled = [floatEncoding, binaryEncoding].includes(value.column_encoding);
  if (value.schema === RESEARCH_TRANSPORT_VERSION ? !sparseEnabled : value.column_encoding !== undefined) throw Error('Unsupported research column encoding');
  const rows = Array.from({ length: value.count }, () => ({}));
  const branches = new WeakSet();
  const decoded = [];
  const seenFields = new Set();
  const negativeZeros = new Map();
  if (value.negative_zeros !== undefined) {
    if (!floatEnabled || !Array.isArray(value.negative_zeros)) throw Error('Invalid signed-zero encoding');
    const seen = new Set();
    for (const entry of value.negative_zeros) {
      if (!Array.isArray(entry) || entry.length !== 3 || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || entry[0] >= value.count ||
          !Number.isSafeInteger(entry[1]) || entry[1] < 0 || entry[1] >= value.fields.length || !Array.isArray(entry[2]) || seen.has(JSON.stringify(entry))) throw Error('Invalid signed-zero entry');
      seen.add(JSON.stringify(entry));
      if (!negativeZeros.has(entry[1])) negativeZeros.set(entry[1], []);
      negativeZeros.get(entry[1]).push([entry[0], entry[2]]);
    }
  }
  value.fields.forEach((path, column) => {
    if (!Array.isArray(path) || !path.length || path.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw Error('Invalid research field');
    const field = JSON.stringify(path);
    if (seenFields.has(field)) throw Error('Duplicate research field');
    seenFields.add(field);
    let source = value.columns[column];
    const binaryKeys = ['f64', 'hex'].flatMap(prefix => ['present', 'pool', 'values'].filter(key => Object.hasOwn(source, `${prefix}_${key}`)).map(key => ({ prefix, key })));
    if (binaryKeys.length) {
      const { prefix, key } = binaryKeys[0], binaryKey = `${prefix}_${key}`;
      const expected = [binaryKey, ...(key === 'present' ? ['missing'] : key === 'pool' ? ['refs'] : [])];
      if (!(prefix === 'hex' ? value.column_encoding === binaryEncoding : floatEnabled) || binaryKeys.length !== 1 || Object.keys(source).length !== expected.length || expected.some(key => !Object.hasOwn(source, key))) throw Error('Invalid binary research column');
      const { [binaryKey]: vector, ...rest } = source;
      source = { ...rest, [key]: (prefix === 'hex' ? decodeResearchHex : decodeResearchFloat64)(vector, value.count) };
    }
    let cells;
    if (source && (Object.hasOwn(source, 'present') || Object.hasOwn(source, 'missing'))) {
      if (!sparseEnabled || Object.keys(source).length !== 2 || !Array.isArray(source.present) || !Array.isArray(source.missing)) throw Error('Invalid sparse research column');
      let end = -1, absent = 0;
      for (const run of source.missing) {
        if (!Array.isArray(run) || run.length !== 2 || !run.every(Number.isSafeInteger) || run[0] < 0 || run[0] <= end || run[1] <= run[0] || run[1] > value.count) throw Error('Invalid sparse research interval');
        absent += run[1] - run[0]; end = run[1];
      }
      if (source.present.length + absent !== value.count) throw Error('Incomplete sparse research column');
      cells = Array(value.count).fill(undefined);
      let row = 0, item = 0;
      for (const [start, finish] of [...source.missing, [value.count, value.count]]) {
        while (row < start) cells[row++] = source.present[item++];
        row = finish;
      }
    } else if (Object.hasOwn(source, 'copy')) {
      if (!Number.isInteger(source.copy) || source.copy < 0 || source.copy >= column || (source.factor !== undefined && source.factor !== -1) || !Array.isArray(source.patch)) throw Error('Invalid research column reference');
      cells = decoded[source.copy].map(item => source.factor === -1 && typeof item === 'number' ? -item : item);
      for (const [row, item] of source.patch) {
        if (!Number.isInteger(row) || row < 0 || row >= value.count) throw Error('Invalid research patch');
        cells[row] = item;
      }
    } else {
      if ((source.values || source.refs)?.length !== value.count) throw Error('Incomplete research column');
      cells = source.values || source.refs.map(id => {
        if (id === -1) return undefined;
        if (!Number.isInteger(id) || id < 0 || id >= source.pool?.length) throw Error('Invalid research cell');
        return source.pool[id];
      });
    }
    // Restore signs before dependent copy/factor columns consume this vector.
    for (const [row, path] of negativeZeros.get(column) || []) cells[row] = restoreNegativeZero(cells[row], path);
    decoded.push(cells);
    rows.forEach((row, i) => {
      if (cells[i] === undefined) return;
      let target = row;
      for (const key of path.slice(0, -1)) {
        if (!Object.hasOwn(target, key)) {
          target[key] = {};
          branches.add(target[key]);
        } else if (!branches.has(target[key])) throw Error('Conflicting research fields');
        target = target[key];
      }
      // Only decoder-created branches may be traversed. A cell is atomic,
      // including arrays and empty objects. Prefixes can occur on different
      // rows, but cannot merge with or overwrite a cell in the same row.
      const key = path.at(-1);
      if (Object.hasOwn(target, key)) throw Error('Conflicting research fields');
      target[key] = cells[i];
    });
  });
  for (const [field, directory] of Object.entries(value.paths || {})) {
    if (!((field === 'chart_path' && directory === 'verified-charts') || (field === 'research_detail_path' && directory === 'research-details'))) throw Error('Invalid research asset type');
    rows.forEach(row => {
      if (row[field] == null) return;
      if (!/^[a-f0-9]{16}$/.test(row[field]) || typeof row.symbol !== 'string') throw Error('Invalid research asset hash');
      row[field] = `${directory}/${encodeURIComponent(row.symbol)}-${row[field]}.json`;
    });
  }
  if (value.financial_proof_encoding !== undefined && value.financial_proof_encoding !== 'tuple-columns-v1') throw Error('Unsupported financial proof encoding');
  if (value.financial_proof_encoding) for (const row of rows) if (row.financial_current?.p) {
    const length = row.financial_current.v === 2 ? 8 : row.financial_current.v === 1 ? 6 : null;
    const keys = length ? Array.from({ length }, (_, index) => String(index)) : [];
    for (const [field,tuple] of Object.entries(row.financial_current.p)) {
      if (Array.isArray(tuple)) continue;
      if (!length || !tuple || Object.keys(tuple).length!==length || keys.some(key=>!Object.hasOwn(tuple,key))) {row.financial_current.invalid_transport_proof=true;continue;}
      row.financial_current.p[field]=keys.map(key=>tuple[key]);
    }
  }
  return { as_of_date: value.as_of_date, ...pick(value, evaluationFields), rows, orders: value.orders };
}
