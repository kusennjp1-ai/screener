import { validEvidenceDay } from './evidenceTime';

// Validate on query selection as well as network reads, so a cached payload
// cannot be relabelled as another symbol or publication date.
export function requireChartIdentity(payload, symbol, date) {
  if (!validEvidenceDay(date) || !symbol || payload?.symbol!==symbol || payload?.as_of_date!==date) throw Error('Chart symbol or snapshot date mismatch');
  if (!Array.isArray(payload.bars) || (payload.bars.length && payload.bars.at(-1)?.date!==date)) throw Error('Chart final session mismatch');
  if (payload.bars.some((bar,index) => !validEvidenceDay(bar?.date) || (index > 0 && bar.date <= payload.bars[index-1].date))) {
    throw Error('Chart session dates invalid, duplicated or out of order');
  }
  return payload;
}
