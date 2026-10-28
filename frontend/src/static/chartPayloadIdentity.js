import { validEvidenceDay } from './evidenceTime';

// This permits viewing authenticated historical bars only. It does not make
// their prices, RS or setup evidence current for the analysis session.
export function retainedChartHistory(payload, date) {
  const history = payload?.retained_price_history;
  if (!history || history.status !== 'stale_reference_only' || !validEvidenceDay(date) || payload.as_of_date !== date ||
    history.target_as_of_date !== date || !validEvidenceDay(history.observation_date) || !validEvidenceDay(history.original_as_of_date) ||
    !(history.observation_date <= history.original_as_of_date && history.original_as_of_date <= date && history.observation_date < date) ||
    !Array.isArray(payload.bars) || payload.bars.at(-1)?.date !== history.observation_date ||
    !/^[a-f0-9]{64}$/.test(history.snapshot_sha256 || '') ||
    history.snapshot_path !== `producer-price-history/${history.snapshot_sha256}.json` ||
    !Number.isFinite(Date.parse(history.original_generated_at))) return null;
  return history;
}

export const retainedChartLabel = history => `参考履歴 ${history.observation_date}まで · 分析日 ${history.target_as_of_date}の価格未確認`;

// Validate on query selection as well as network reads, so a cached payload
// cannot be relabelled as another symbol or publication date.
export function requireChartIdentity(payload, symbol, date) {
  if (!validEvidenceDay(date) || !symbol || payload?.symbol!==symbol || payload?.as_of_date!==date) throw Error('Chart symbol or snapshot date mismatch');
  const retained = retainedChartHistory(payload, date);
  if (payload.retained_price_history && !retained) throw Error('Chart retained history provenance mismatch');
  if (!Array.isArray(payload.bars) || (payload.bars.length && payload.bars.at(-1)?.date!==date && !retained)) throw Error('Chart final session mismatch');
  if (payload.bars.some((bar,index) => !validEvidenceDay(bar?.date) || (index > 0 && bar.date <= payload.bars[index-1].date))) {
    throw Error('Chart session dates invalid, duplicated or out of order');
  }
  return payload;
}
