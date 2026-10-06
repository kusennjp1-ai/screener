import { historyEnvelope, positive, finite, validDay } from './indicatorHistory.js';
export const BASE_COUNT_VERSION = 'confirmed-base-sequence-estimate-v1';
const barValid = bar => bar && validDay(bar.date) && ![0, 6].includes(new Date(bar.date).getUTCDay()) && [bar.open, bar.high, bar.low, bar.close].every(positive) && finite(bar.volume) && bar.volume >= 0 && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close);
export const BASE_METHOD = 'アプリ独自の確定形状推計。20本以上の先行上昇20%以上、25〜126本・深さ8〜40%の押し目、終値が起点高値の95%へ回復して確認。重複区間を数えず、前ベース安値割れで1へリセット、前買い水準から20%以上の上昇で次段階、それ未満は同段階のベース・オン・ベース。';
// Each emitted base is immutable and known only at confirmedAt. We do not run
// today's final pattern backwards or count overlapping detector windows.
export function detectConfirmedBases(chart, asOf, sessions = []) {
  if (!Array.isArray(sessions) || !sessions.length || sessions.some((date, i) => !validDay(date) || (i > 0 && date <= sessions[i - 1]))) return {bases:[],usableThrough:null,observedFrom:null,observedSessions:0};
  const bars = [], calendar = new Map(sessions.map((date, i) => [date, i]));
  for (const bar of chart?.bars || []) {
    if (bar?.date > asOf) break;
    const previous = bars.at(-1), index = calendar.get(bar?.date), priorIndex = calendar.get(previous?.date);
    if (!barValid(bar) || (previous && (bar.date <= previous.date || bar.close / previous.close >= 1.8 || bar.close / previous.close <= .55)) ||
      (sessions.length && (index == null || (previous && index !== priorIndex + 1)))) break;
    bars.push(bar);
  }
  const bases = []; let anchor = null, floor = null, nextStart = 20;
  for (let i = 20; i < bars.length; i++) {
    const bar = bars[i];
    if (i < nextStart) continue;
    if (anchor === null) {
      const lead = bars.slice(i - 20, i);
      if (bar.high >= Math.max(...lead.map(item => item.high)) && bar.high >= Math.min(...lead.map(item => item.low)) * 1.2) { anchor = i; floor = bar.low; }
      continue;
    }
    // A higher high before a material pullback is the same advancing leg.
    const depth = (bars[anchor].high - floor) / bars[anchor].high;
    if (bar.high > bars[anchor].high && depth < .08) { anchor = i; floor = bar.low; continue; }
    floor = Math.min(floor, bar.low);
    const pivot = bars[anchor].high, currentDepth = (pivot - floor) / pivot;
    const length = i - anchor + 1;
    if (currentDepth > .4 || length > 126 || bar.close > pivot * 1.05) { anchor = null; floor = null; continue; }
    if (length >= 25 && currentDepth >= .08 && bar.close >= pivot * .95 && bar.close <= pivot * 1.05) {
      bases.push({ id: `${chart.symbol}:${bars[anchor].date}:${bar.date}`, start: bars[anchor].date, end: bar.date, confirmedAt: bar.date,
        pivot, low: floor, depthPct: currentDepth * 100, sessions: length, boundaryVerified: true, source: BASE_COUNT_VERSION });
      nextStart = i + 1; anchor = null; floor = null;
    }
  }
  return { bases, usableThrough: bars.at(-1)?.date || null, observedFrom: bars[0]?.date || null, observedSessions: bars.length };
}
// Public contract also accepts externally verified boundaries, but never guesses
// missing lows, dates, prior links or confirmation dates from a stage/VCP label.
export function countConfirmedBases({ symbol, asOf, bases = [], source = BASE_COUNT_VERSION, observedFrom = null, usableThrough = asOf } = {}) {
  const envelope = { id: 'base-count', version: BASE_COUNT_VERSION, asOf, unit: '段階（観測範囲内）', source,
    scope: `${symbol || '銘柄未確認'} / ${observedFrom || '開始日未確認'}〜${usableThrough || '未確認'}`, method: BASE_METHOD, basis: 'retrospective_estimate' };
  const records = []; let invalid = false;
  for (const base of bases) {
    if (base?.confirmedAt > asOf) continue;
    const previous = records.at(-1);
    if (!base?.id || !base.boundaryVerified || !validDay(base.start) || !validDay(base.end) || !validDay(base.confirmedAt) ||
      base.start > base.end || base.end > base.confirmedAt || !positive(base.pivot) || !positive(base.low) || base.low >= base.pivot ||
      records.some(row => row.id === base.id) || (previous && (base.start <= previous.end || base.confirmedAt <= previous.confirmedAt))) { invalid = true; break; }
    const reset = previous && base.low < previous.low;
    const advancePct = previous ? (base.pivot / previous.pivot - 1) * 100 : null;
    const baseOnBase = Boolean(previous && !reset && advancePct < 20 - 1e-9);
    const count = !previous || reset ? 1 : baseOnBase ? previous.count : previous.count + 1;
    records.push({ ...base, date: base.confirmedAt, known: true, value: count, count, priorBaseId: previous?.id || null, advancePct,
      resetReason: reset ? 'undercut_prior_base_low' : previous ? null : 'first_observed_base', baseOnBase,
      originKnown: reset || previous?.originKnown || false, coverage: records.length + 1 });
  }
  return { ...historyEnvelope({ ...envelope, series: records, reason: invalid ? '境界履歴が不整合のため、それ以降の段階は未確認です。' : records.length ? null : '確認できるベース履歴が不足しています。' }),
    symbol, count: !invalid && usableThrough === asOf ? records.at(-1)?.count ?? null : null,
    originKnown: records.at(-1)?.originKnown || false, complete: !invalid && usableThrough === asOf,
    limitation: 'MarketSurgeの認定値ではありません。最初の観測より前のベースは不明です。Stage 2やVCP収縮回数とは異なり、選定・購入条件には加算しません。' };
}
export function baseCountHistory(chart, symbol, asOf, sessions = []) {
  if (chart?.symbol !== symbol || !validDay(asOf)) return countConfirmedBases({ symbol, asOf, usableThrough: null });
  const detected = detectConfirmedBases(chart, asOf, sessions);
  return countConfirmedBases({ symbol, asOf, ...detected });
}

// Same dated estimate in every summary surface. Unknown and old estimates are
// never promoted to the current list, chart, detail header or CSV.
export function currentBaseCount(row, asOf = row?.as_of_date) {
  const summary = row?.base_count_summary;
  return summary?.version === BASE_COUNT_VERSION && summary.as_of_date === asOf && summary.complete === true && Number.isInteger(summary.count) && summary.count > 0 ? summary.count : null;
}
