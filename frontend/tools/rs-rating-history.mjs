import { RS_METHOD, auditValues } from '../src/static/qualificationAudit.js';
import { validEvidenceDay } from '../src/static/evidenceTime.js';

export const RS_HISTORY_VERSION = 'published-universe-rs-history-v1';
// Retrospective calculation over the CURRENT verified publication universe.
// This is deliberately not an archive of ranks available to a trader that day.
export function buildRsRatingHistories({ rows, charts, sessions, asOfDate }) {
  if (!Array.isArray(sessions) || sessions.at(-1) !== asOfDate || sessions.some((day, i) => !validEvidenceDay(day) || (i && day <= sessions[i - 1]))) return new Map();
  const eligible = rows.filter(row => row.market === 'US' && row.currency === 'USD' && row.technical_audit?.as_of_date === asOfDate && row.rs_as_of_date === asOfDate && row.rs_method === RS_METHOD && Number.isFinite(auditValues(row).momentum));
  const members = new Set(eligible.map(row => row.symbol));
  if (members.size !== eligible.length || members.size < 100) return new Map();
  const chartMap = new Map(charts.map(chart => [chart.symbol, chart]));
  const series = new Map(), first = Math.max(252, sessions.length - 252);
  for (const row of eligible) {
    const chart = chartMap.get(row.symbol), bars = chart?.bars;
    if (!Array.isArray(bars) || chart.as_of_date !== asOfDate || bars.at(-1)?.date !== asOfDate) continue;
    const byDay = new Map(bars.map(bar => [bar.date, bar.close]));
    if (byDay.size !== bars.length || bars.some((bar, i) => !Number.isFinite(bar.close) || bar.close <= 0 || (i && bar.date <= bars[i - 1].date))) continue;
    const closes = sessions.map(day => byDay.get(day)), missing = [0];
    for (const close of closes) missing.push(missing.at(-1) + (Number.isFinite(close) && close > 0 ? 0 : 1));
    series.set(row.symbol, { closes, missing, points: [] });
  }
  if (series.size !== eligible.length) return new Map();
  for (let day = first; day < sessions.length; day++) {
    const scores = [];
    for (const [symbol, data] of series) {
      if (data.missing[day + 1] !== data.missing[day - 252]) continue;
      const close = data.closes[day];
      const momentum = [63, 126, 189, 252].reduce((sum, lag, i) => sum + (close / data.closes[day - lag] - 1) * (i === 0 ? .4 : .2), 0);
      scores.push({ symbol, momentum });
    }
    if (scores.length < 100) continue;
    scores.sort((a, b) => a.momentum - b.momentum || a.symbol.localeCompare(b.symbol));
    for (let i = 0; i < scores.length;) {
      let end = i + 1;
      while (end < scores.length && scores[end].momentum === scores[i].momentum) end++;
      const value = 1 + 98 * ((i + end - 1) / 2) / (scores.length - 1);
      for (let index = i; index < end; index++) series.get(scores[index].symbol).points.push({ time: sessions[day], value, universe_size: scores.length });
      i = end;
    }
  }
  const result = new Map();
  for (const row of eligible) {
    const points = series.get(row.symbol)?.points || [], latest = points.at(-1);
    // A disagreement with the current audited rank is a producer failure,
    // never a second competing 'current RS' in the interface.
    if (!latest || latest.time !== asOfDate || latest.value !== row.rs_rating) continue;
    result.set(row.symbol, { schema_version: RS_HISTORY_VERSION, symbol: row.symbol, as_of_date: asOfDate,
      method: RS_METHOD, basis: 'current_verified_publication_universe_recalculated',
      source: 'verified_daily_ohlcv', current_universe_size: members.size,
      sessions: sessions.filter(day => day >= points[0].time), points });
  }
  return result;
}
