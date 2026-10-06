import { historyEnvelope, positive, validDay } from './indicatorHistory.js';
export const DISTRIBUTION_VERSION = 'ordinary-distribution-estimate-v1';
export const DISTRIBUTION_INDICES = {
  sp500: { label: 'S&P 500', priceSymbol: '^GSPC', volumeUniverse: 'NYSE' },
  nasdaq: { label: 'Nasdaq総合', priceSymbol: '^IXIC', volumeUniverse: 'NASDAQ' },
};
// An explicit exchange-session calendar is required. Row adjacency is not proof
// that two prices belong to consecutive exchange sessions.
export function distributionHistory(input, index, asOf) {
  const definition = DISTRIBUTION_INDICES[index];
  if (!definition) throw Error('Unsupported distribution index');
  const envelope = { id: `distribution-${index}`, version: DISTRIBUTION_VERSION, asOf, unit: '日', basis: 'estimate',
    source: input?.source?.name || '指数・取引所出来高未接続', scope: `${definition.label}終値 × ${definition.volumeUniverse}出来高`,
    method: '通常の分配日推計：前取引日比−0.2%以下かつ出来高増加。25取引日経過または後日終値が分配日終値から5%以上上昇で失効。停滞日は含めず、IBD公式値ではありません。' };
  const unavailable = reason => historyEnvelope({ ...envelope, reason });
  if (!input || input.price_symbol !== definition.priceSymbol || input.volume_universe !== definition.volumeUniverse || !input.source?.name ||
    !input.source?.price_url || !input.source?.volume_url || !input.calendar_source || !Array.isArray(input.sessions) || !Array.isArray(input.observations) || !validDay(asOf))
    return unavailable('指数終値・指定取引所の出来高・実際の取引日カレンダーが必要です。');
  if (input.sessions.some((date, i) => !validDay(date) || (i > 0 && date <= input.sessions[i - 1]))) return unavailable('取引日カレンダーが不正です。');
  const sessions = input.sessions.filter(date => date <= asOf), counts = new Map(), byDate = new Map();
  for (const row of input.observations) { if (!row || !validDay(row.date)) continue; counts.set(row.date, (counts.get(row.date) || 0) + 1); byDate.set(row.date, row); }
  const events = [], uncertain = [], series = [];
  for (let i = 0; i < sessions.length; i++) {
    const date = sessions[i], row = byDate.get(date), prior = byDate.get(sessions[i - 1]);
    const priceKnown = counts.get(date) === 1 && positive(row?.close);
    const comparisonKnown = i > 0 && priceKnown && counts.get(sessions[i - 1]) === 1 && positive(prior?.close) && positive(row?.volume) && positive(prior?.volume);
    // Once retired, events never return, even after prices fall again.
    for (const event of [...events, ...uncertain]) if (!event.retiredAt) {
      if (i - event.index >= 25) { event.retiredAt = date; event.retiredBy = '25_sessions'; }
      else if (priceKnown && positive(event.close) && date > event.date && row.close >= event.close * 1.05) { event.retiredAt = date; event.retiredBy = 'close_up_5pct'; }
    }
    const dailyChangePct = comparisonKnown ? (row.close / prior.close - 1) * 100 : null;
    const distribution = comparisonKnown ? row.close <= prior.close * .998 + 1e-10 && row.volume > prior.volume : null;
    if (distribution === true) events.push({ date, index: i, close: row.close, retiredAt: null });
    if (!comparisonKnown) uncertain.push({ date, index: i, close: priceKnown ? row.close : null, retiredAt: null });
    const unknownDays = uncertain.filter(event => !event.retiredAt).length;
    const active = events.filter(event => !event.retiredAt).length;
    series.push({ date, known: priceKnown && i >= 25 && unknownDays === 0, value: priceKnown && i >= 25 && unknownDays === 0 ? active : null,
      observedActive: active, distribution, dailyChangePct, unknownDays,
      coverage: Math.min(25, i + 1) - unknownDays, expected: 25 });
  }
  return { ...historyEnvelope({ ...envelope, series, reason: series.length ? null : '対象期間の観測がありません。' }), events: events.map(({ index: _index, ...event }) => event),
    source_details: input.source, calendar_source: input.calendar_source };
}
