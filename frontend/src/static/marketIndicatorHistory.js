// Display-only contract. No collection, signal thresholds or admission decisions.
export const MARKET_HISTORY_VERSION = 'market-indicator-history-v1';
export const MARKET_HISTORY_GROUPS = [
  { label: '市場全体のプットコールレシオ', metrics: ['put_call_ratio'], note: '市場全体の対象範囲と方法が明記された値だけを表示します。機関限定値は代用しません。' },
  { label: '新高値・新安値数', metrics: ['new_highs', 'new_lows'], note: '現在の銘柄集合を過去に適用した値は近似です。下の書籍の市場観測とは別の履歴です。' },
  { label: '指数別の売り抜け日', metrics: ['distribution_sp500', 'distribution_nasdaq'], note: 'S&P500 と Nasdaq を分けます。ETF を指数の代用にせず、IBD 式との一致はこの表示では認定しません。' },
  { label: '機関保有者数', metrics: ['institutional_holders'], note: '13F 報告運用会社数は四半期の保有者数です。実際の購入者数・日次の買い集め件数ではありません。' },
  { label: 'ベースカウント', metrics: ['base_count'], note: '手動確認の記録です。自動のベース認定は行いません。' },
  { label: 'エントリー突破・接近銘柄数', metrics: ['entry_breakouts', 'entry_approaches'], note: '突破と接近は別系列です。固定窓の上放れ代理をエントリー突破件数へ変換しません。' },
];
export const MARKET_HISTORY_METRICS = {
  put_call_ratio: { label: 'プットコールレシオ', unit: 'ratio', frequency: 'daily', scope: 'market_wide' },
  new_highs: { label: '新高値', unit: 'stocks', frequency: 'daily', scope: 'universe' },
  new_lows: { label: '新安値', unit: 'stocks', frequency: 'daily', scope: 'universe' },
  distribution_sp500: { label: 'S&P500 売り抜け日', unit: 'sessions', frequency: 'daily', scope: 'index', instrument: '^GSPC' },
  distribution_nasdaq: { label: 'Nasdaq Composite 売り抜け日', unit: 'sessions', frequency: 'daily', scope: 'index', instrument: '^IXIC' },
  institutional_holders: { label: '13F 報告運用会社数', unit: 'reporting_managers', frequency: 'quarterly', scope: 'security' },
  base_count: { label: 'ベース番号', unit: 'bases', frequency: 'manual', scope: 'security' },
  entry_breakouts: { label: 'エントリー突破', unit: 'stocks', frequency: 'daily', scope: 'universe' },
  entry_approaches: { label: 'エントリー接近', unit: 'stocks', frequency: 'daily', scope: 'universe' },
};
const IDENTITY = ['metric', 'market', 'population', 'method', 'source', 'unit', 'frequency', 'scope', 'instrument', 'approximate'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
export const validHistoryDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const validTimestamp = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s.replace(/Z$/, s.includes('.') ? 'Z' : '.000Z');
const quarterEnd = s => validHistoryDate(s) && /-(03-31|06-30|09-30|12-31)$/.test(s);
const quarterNumber = s => Number(s.slice(0, 4)) * 4 + Number(s.slice(5, 7)) / 3;
const validValue = (value, metric) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && (metric === 'put_call_ratio' || Number.isSafeInteger(value));
const observationsMatch = input => {
  if (!Array.isArray(input.observations)) return false;
  // Array.some skips holes. Validate every own slot before accepting any point
  // in this input series; inherited entries and array-shaped records are not evidence.
  for (let index = 0; index < input.observations.length; index++) {
    if (!Object.hasOwn(input.observations, index)) return false;
    const observation = input.observations[index];
    if (!record(observation) || IDENTITY.some(key => Object.hasOwn(observation, key) && observation[key] !== input[key])) return false;
  }
  return true;
};

/** A series has one market, population, method and source. Never join unlike histories. */
export function marketIndicatorHistory(payload, { market, asOfDate, now = Date.now() } = {}) {
  const result = { series: [], issues: [] };
  if (payload == null) return result;
  if (!record(payload) || payload.version !== MARKET_HISTORY_VERSION || !Array.isArray(payload.series) || !nonempty(market) || !validHistoryDate(asOfDate) || !Number.isFinite(now)) {
    result.issues.push('履歴の形式または分析基準日を確認できません。');
    return result;
  }
  const grouped = new Map();
  for (let index = 0; index < payload.series.length; index++) {
    const input = Object.hasOwn(payload.series, index) ? payload.series[index] : null;
    const spec = MARKET_HISTORY_METRICS[input?.metric];
    if (!record(input) || !spec || !IDENTITY.filter(k => k !== 'approximate').every(k => nonempty(input[k])) ||
      typeof input.approximate !== 'boolean' || !['unit', 'frequency', 'scope'].every(k => input[k] === spec[k]) ||
      (spec.instrument && input.instrument !== spec.instrument) || !observationsMatch(input)) {
      result.issues.push('市場・母集団・方法・頻度・単位が不明または混在する系列を除外しました。');
      continue;
    }
    if (input.market !== market) {
      result.issues.push('選択市場と異なる履歴を除外しました。');
      continue;
    }
    const identity = Object.fromEntries(IDENTITY.map(k => [k, input[k]]));
    const key = JSON.stringify(IDENTITY.map(k => input[k]));
    if (!grouped.has(key)) grouped.set(key, { ...identity, key, label: spec.label, points: new Map() });
    const group = grouped.get(key);
    for (const observation of input.observations) {
      if (!validHistoryDate(observation.date) || (input.frequency === 'quarterly' && !quarterEnd(observation.date))) {
        result.issues.push('対象日を確認できない観測を除外しました。');
        continue;
      }
      if (observation.date > asOfDate) {
        result.issues.push('分析基準日より後の観測を除外しました。');
        continue;
      }
      const collected = validTimestamp(observation.collected_at) && Date.parse(observation.collected_at) <= now && observation.collected_at.slice(0, 10) >= observation.date;
      const value = collected && validValue(observation.value, input.metric) ? observation.value : null;
      const point = { date: observation.date, value, collected_at: collected ? observation.collected_at : null,
        reason: value === null ? '値または取得日時が未確認' : null };
      const existing = group.points.get(point.date);
      if (!existing) group.points.set(point.date, point);
      else if (existing.value !== point.value || existing.collected_at !== point.collected_at || existing.reason !== point.reason) {
        // Even two different retrievals with the same value are ambiguous revisions.
        group.points.set(point.date, { date: point.date, value: null, collected_at: null, reason: '同一対象日の重複が矛盾' });
      }
    }
  }
  result.series = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)).map(group => {
    const points = [...group.points.values()].sort((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1) ?? null, previous = points.at(-2);
    // A quarterly delta needs adjacent reporting periods, not adjacent rows.
    const adjacent = group.frequency !== 'quarterly' || (previous && quarterNumber(latest.date) - quarterNumber(previous.date) === 1);
    const delta = group.frequency === 'quarterly' && adjacent && latest?.value != null && previous?.value != null ? latest.value - previous.value : null;
    return { ...group, points, latest, delta, historical: Boolean(latest && latest.date < asOfDate) };
  });
  result.issues = [...new Set(result.issues)];
  return result;
}
