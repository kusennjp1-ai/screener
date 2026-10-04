import { AUDIT_VERSION } from './qualificationAudit.js';

// A display window of observed daily closes, never a screening requirement.
export const PRICE_TRACE_BARS = 63;
export const PRICE_TRACE_WIDTH = 360;
export const PRICE_TRACE_HEIGHT = 64;
export const traceDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const safeSymbol = value => typeof value === 'string' && /^[A-Z0-9][A-Z0-9.^_-]{0,31}$/.test(value);

export function validatePriceTraceDescriptor(value, date) {
  if (value === undefined) return undefined; // Older publications remain readable.
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'as_of_date,bars,root' ||
      typeof value.root !== 'string' || !/^price-traces\/[a-f0-9]{64}$/.test(value.root) || value.bars !== PRICE_TRACE_BARS ||
      !traceDate(value.as_of_date) || value.as_of_date !== date) throw Error('Invalid price trace descriptor');
  return { root: value.root, as_of_date: value.as_of_date, bars: value.bars };
}

export function verifiedTraceIdentity(row, date) {
  const audit = row?.technical_audit;
  return Boolean(traceDate(date) && safeSymbol(row?.symbol) && row.as_of_date === date &&
    audit?.version === AUDIT_VERSION && audit.symbol === row.symbol && audit.as_of_date === date &&
    audit.valid === true && Array.isArray(audit.errors) && audit.errors.length === 0 &&
    Number.isSafeInteger(audit.bars) && audit.bars >= 252 && positive(row.current_price) && audit.values?.close === row.current_price);
}

export function priceTraceForRow(row, descriptor, date) {
  const base = { status: 'unavailable', asOfDate: date, endDate: date, bars: PRICE_TRACE_BARS, caption: '価格推移未配信' };
  if (!descriptor) return { ...base, reason: 'not_published' };
  validatePriceTraceDescriptor(descriptor, date);
  if (!verifiedTraceIdentity(row, date)) return { ...base, reason: 'unverified_price' };
  if (typeof row.chart_path !== 'string' || !/^[a-f0-9]{16}$/.test(row.chart_path.slice(-21, -5)) ||
      row.chart_path !== `verified-charts/${encodeURIComponent(row.symbol)}-${row.chart_path.slice(-21, -5)}.json`) return { ...base, reason: 'unverified_chart' };
  if (!traceDate(row.price_trace_start) || row.price_trace_start >= date) return { ...base, reason: 'unavailable_history' };
  return { ...base, status: 'available', startDate: row.price_trace_start,
    src: `${descriptor.root}/${encodeURIComponent(row.symbol)}.svg`,
    caption: `終値 · 直近${PRICE_TRACE_BARS}日足 · ${row.price_trace_start}〜${date}` };
}
