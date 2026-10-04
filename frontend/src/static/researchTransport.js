// Versioned wire format. Decision inputs remain lossless; displayed numbers are
// formatted by the UI, never rounded before a threshold or order calculation.
export const RESEARCH_TRANSPORT_VERSION = 'research-table-v1';
export const RESEARCH_METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];

const pick = (value, fields) => value && Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
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
    ...pick(row.financial_history, ['symbol', 'as_of_date', 'status', 'basis', 'currency', 'retrieved_at', 'source']),
    annual: Array.isArray(row.financial_history.annual) ? row.financial_history.annual.map(item => pick(item, ['end', 'eps'])) : row.financial_history.annual,
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

// Column dictionaries remove repeated metadata without rounding decision
// inputs. High-cardinality columns stay direct to avoid a second ID array.
export function encodeResearchIndex(index, orders) {
  const rows = index.rows.map(researchListRow);
  // Expand only compact proof tuples into transport columns. Repeated source,
  // cadence, periods and clocks then share dictionaries; exact values can copy
  // the canonical scalar column. Decode restores the original proof contract.
  let financialProofEncoding;
  for (const row of rows) if (row.financial_current?.p && typeof row.financial_current.p === 'object' && !Array.isArray(row.financial_current.p)) {
    const proof = row.financial_current;
    if (Object.values(proof.p).every(tuple=>Array.isArray(tuple) && tuple.length===6)) {
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
      const value = row.get(field), key = JSON.stringify(value);
      let id = lookup.get(key);
      if (id === undefined) { id = pool.length; pool.push(value); lookup.set(key, id); }
      return id;
    });
    const direct = refs.map(id => id === -1 ? null : pool[id]);
    // Direct columns are used only when there are no absent values.
    return !refs.includes(-1) && pool.length > rows.length / 4 ? { values: direct } : { pool, refs };
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
        if (values[column][row] !== derived) patch.push(values[column][row] === undefined ? [row] : [row, values[column][row]]);
        if (patch.length > rows.length * .4) break;
      }
      if (patch.length > rows.length * .4) continue;
      const candidate = { copy: previous, ...(factor === -1 ? { factor } : {}), patch };
      const length = JSON.stringify(candidate).length;
      if (length < size) { columns[column] = candidate; size = length; }
    }
  }
  return { schema: RESEARCH_TRANSPORT_VERSION, as_of_date: index.as_of_date, count: rows.length, fields: fields.map(JSON.parse), columns, paths, orders, ...(financialProofEncoding ? {financial_proof_encoding:financialProofEncoding} : {}) };
}

export function decodeResearchIndex(value) {
  if (!value?.schema) return value;
  if (value.schema !== RESEARCH_TRANSPORT_VERSION || !Array.isArray(value.fields) || !Array.isArray(value.columns) || value.fields.length !== value.columns.length || !Number.isInteger(value.count) || value.count < 0) throw Error('Unsupported research data format');
  const rows = Array.from({ length: value.count }, () => ({}));
  const decoded = [];
  value.fields.forEach((path, column) => {
    if (!Array.isArray(path) || !path.length || path.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw Error('Invalid research field');
    const source = value.columns[column];
    let cells;
    if (Object.hasOwn(source, 'copy')) {
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
    decoded.push(cells);
    rows.forEach((row, i) => {
      if (cells[i] === undefined) return;
      let target = row;
      for (const key of path.slice(0, -1)) target = target[key] ||= {};
      target[path.at(-1)] = cells[i];
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
    for (const [field,tuple] of Object.entries(row.financial_current.p)) {
      if (Array.isArray(tuple)) continue;
      if (!tuple || Object.keys(tuple).length!==6 || ['0','1','2','3','4','5'].some(key=>!Object.hasOwn(tuple,key))) {row.financial_current.invalid_transport_proof=true;continue;}
      row.financial_current.p[field]=['0','1','2','3','4','5'].map(key=>tuple[key]);
    }
  }
  return { as_of_date: value.as_of_date, rows, orders: value.orders };
}
