// Validate on query selection as well as network reads, so a cached payload
// cannot be relabelled as another symbol or publication date.
export function requireChartIdentity(payload, symbol, date) {
  const validDate=typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date;
  if (!validDate || !symbol || payload?.symbol!==symbol || payload?.as_of_date!==date) throw Error('Chart symbol or snapshot date mismatch');
  if (!Array.isArray(payload.bars) || (payload.bars.length && payload.bars.at(-1).date!==date)) throw Error('Chart final session mismatch');
  return payload;
}
