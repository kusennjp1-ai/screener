import { readFile } from 'node:fs/promises';
import { AUDIT_VERSION } from '../src/static/qualificationAudit.js';
import { validEvidenceDay } from '../src/static/evidenceTime.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw Error(`Invalid research export order anchor: ${message}`); };

// The previous audit supplies identities only. Keep its large parsed tree local
// to this loader; no old price, financial, technical or method value escapes.
async function priorSymbols(path, asOfDate) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let anchor;
  try { anchor = JSON.parse(raw); }
  catch { fail('malformed JSON'); }
  if (!object(anchor) || anchor.version !== AUDIT_VERSION || !validEvidenceDay(anchor.as_of_date) ||
      !validEvidenceDay(asOfDate) || anchor.as_of_date > asOfDate || !Array.isArray(anchor.results) ||
      !Number.isSafeInteger(anchor.total) || anchor.total !== anchor.results.length) fail('invalid envelope');
  const symbols = new Set();
  for (const result of anchor.results) {
    if (!object(result) || typeof result.symbol !== 'string' || !result.symbol.trim() ||
        !object(result.audit) || result.audit.symbol !== result.symbol || result.audit.version !== anchor.version ||
        result.audit.as_of_date !== anchor.as_of_date) fail('invalid result identity');
    if (symbols.has(result.symbol)) fail(`duplicate symbol ${result.symbol}`);
    symbols.add(result.symbol);
  }
  return [...symbols];
}

export async function orderResearchExportRows(rows, auditPath, asOfDate) {
  const symbols = await priorSymbols(auditPath, asOfDate);
  // Preserve the first export's existing source order when there is no anchor.
  if (symbols === null) return rows;
  const remaining = new Map(rows.map(row => [row.symbol, row]));
  if (remaining.size !== rows.length) fail('duplicate current symbol');
  const ordered = [];
  for (const symbol of symbols) {
    if (!remaining.has(symbol)) continue;
    ordered.push(remaining.get(symbol));
    remaining.delete(symbol);
  }
  // Removed symbols are omitted; additions have a locale-independent order.
  for (const symbol of [...remaining.keys()].sort()) ordered.push(remaining.get(symbol));
  return ordered;
}
