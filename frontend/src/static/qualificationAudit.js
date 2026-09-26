// Independent verification from published daily OHLCV, never from pass flags.
export const AUDIT_VERSION = 'ohlcv-v1';
const number = v => typeof v === 'number' && Number.isFinite(v);
const positive = v => number(v) && v > 0;
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function auditDailyBars(row, payload, date) {
  const errors = [];
  if (!validDate(date)) errors.push('分析基準日が不正');
  if (!payload) errors.push('日足データ未配信');
  else if (payload.symbol !== row.symbol || payload.as_of_date !== date) errors.push('銘柄または分析日が不一致');
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  if (bars.length < 252) errors.push('252営業日分の日足が不足');
  if (bars.some((b, i) => !validDate(b.date) || [0, 6].includes(new Date(b.date).getUTCDay()) || b.date > date || (i > 0 && b.date <= bars[i - 1].date) ||
    ![b.open, b.high, b.low, b.close].every(positive) || !number(b.volume) || b.volume < 0 ||
    b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close))) errors.push('日足の順序・重複・OHLCVに異常');
  if (bars.at(-1)?.date !== date) errors.push('最終日足が分析日と不一致');
  if (bars.some((b, i) => i > 0 && positive(b.close) && positive(bars[i - 1].close) &&
    (b.close / bars[i - 1].close >= 1.8 || b.close / bars[i - 1].close <= .55))) errors.push('大幅な価格断絶：分割・併合調整を要確認');
  if (!positive(row.current_price) || !positive(bars.at(-1)?.close) || Math.abs(row.current_price - bars.at(-1).close) > Math.max(.02, row.current_price * .0001)) errors.push('スキャン価格と日足終値が不一致');
  const result = { version: AUDIT_VERSION, symbol: row.symbol, as_of_date: date, bars: bars.length, errors, valid: !errors.length, values: {} };
  if (errors.length) return result;
  const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
  const sma = (n, lag = 0) => mean(bars.slice(bars.length - n - lag, bars.length - lag).map(b => b.close));
  const year = bars.slice(-252), last = bars.at(-1);
  const high = Math.max(...year.map(b => b.high)), low = Math.min(...year.map(b => b.low));
  const averageVolume = mean(bars.slice(-51, -1).map(b => b.volume));
  result.values = { close: last.close, sma50: sma(50), sma150: sma(150), sma200: sma(200), sma200_21ago: sma(200, 21),
    high, low, aboveLow: (last.close / low - 1) * 100, belowHigh: (1 - last.close / high) * 100,
    volumeRatio: averageVolume > 0 ? last.volume / averageVolume : null,
    change: (last.close / bars.at(-2).close - 1) * 100,
    momentum: bars.length >= 253 ? [63, 126, 189, 252].reduce((sum, days, i) => sum + (last.close / bars.at(-1 - days).close - 1) * (i === 0 ? .4 : .2), 0) : null };
  return result;
}

export const RS_METHOD = 'published-bars-weighted-percentile-v1';
export function rankVerifiedUniverse(rows) {
  const eligible = rows.filter(row => row.market === 'US' && row.currency === 'USD' && number(auditValues(row).momentum));
  const dates = new Set(eligible.map(row => row.technical_audit.as_of_date));
  const scores = eligible.map(row => auditValues(row).momentum).sort((a, b) => a - b);
  const ranks = new Map();
  // Midranks give identical returns identical ratings. At least 100 instruments
  // are required. This is a disclosed published-chart universe, not official IBD.
  if (dates.size === 1 && scores.length >= 100) {
    for (let i = 0; i < scores.length;) {
      let end = i + 1;
      while (end < scores.length && scores[end] === scores[i]) end++;
      ranks.set(scores[i], 1 + 98 * ((i + end - 1) / 2) / (scores.length - 1));
      i = end;
    }
  }
  return rows.map(row => ({ ...row, source_rs_rating: row.source_rs_rating ?? row.rs_rating,
    rs_rating: row.market === 'US' && row.currency === 'USD' ? ranks.get(auditValues(row).momentum) ?? null : null,
    rs_method: RS_METHOD, rs_universe_size: eligible.length, rs_as_of_date: dates.size === 1 ? [...dates][0] : null }));
}

export function auditValues(row) {
  const a = row.technical_audit;
  return a?.version === AUDIT_VERSION && a.symbol === row.symbol && validDate(a.as_of_date) && a.valid === true && a.errors?.length === 0 &&
    positive(row.current_price) && positive(a.values?.close) && Math.abs(row.current_price - a.values.close) <= Math.max(.02, row.current_price * .0001) ? a.values : {};
}

// Initial rows intentionally repeat the first chunk. Identical repeats are safe;
// contradictory copies are excluded, independent of load order.
export function mergeScanRows(payloads, date) {
  const rows = new Map(), conflicts = new Set();
  const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  for (const payload of payloads) {
    if (payload.as_of_date !== date) throw Error('Mixed or missing snapshot dates');
    for (const row of payload.rows || payload.initial_rows || []) {
      if (!row || typeof row.symbol !== 'string' || !row.symbol.trim()) continue;
      if (rows.has(row.symbol) && canonical(rows.get(row.symbol)) !== canonical(row)) conflicts.add(row.symbol);
      rows.set(row.symbol, row);
    }
  }
  return [...rows.values()].map(row => ({ ...row, technical_audit: conflicts.has(row.symbol)
    ? { errors: ['同一銘柄のデータが矛盾'], valid: false }
    : row.technical_audit?.as_of_date === date ? row.technical_audit : undefined }));
}
