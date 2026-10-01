export const PERFORMANCE_HORIZONS = [5, 20, 60];
export const HISTORY_RETENTION_SESSIONS = 126;
const methods = ['minervini', 'minervini2', 'oneil', 'ibd'];
const positive = value => Number.isFinite(value) && value > 0;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const median = values => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const validSeries = bars => Array.isArray(bars) && bars.length > 0 && bars.every((bar, index) => positive(bar.close) && validDate(bar.date) && (!index || bar.date > bars[index - 1].date));

export function measureCandidateReturn({ startDate, asOf, sessions, stock, benchmark, horizon }) {
  const empty = (status, reason, observed = null) => ({ status, reason, observed_sessions: observed, return_pct: null, spy_return_pct: null, max_drawdown_pct: null, end_date: null });
  if (!Array.isArray(sessions) || !sessions.includes(startDate) || !sessions.includes(asOf) || sessions.some((date, index) => !validDate(date) || (index && date <= sessions[index - 1]))) return empty('unavailable', 'NYSE営業日の範囲・順序を確認できません');
  const expected = sessions.filter(date => date >= startDate && date <= asOf).slice(0, horizon + 1);
  const elapsed = expected.length - 1;
  if (!stock?.verified || !validSeries(stock.bars)) return empty('unavailable', '対象銘柄の検証済み終値系列が不足', 0);
  const prices = new Map(stock.bars.map(bar => [bar.date, bar.close]));
  let observed = 0;
  if (prices.has(startDate)) for (const date of expected.slice(1)) { if (!prices.has(date)) break; observed++; }
  if (elapsed < horizon) return empty('pending', `${horizon}営業日の観測待ち`, observed);
  if (!prices.has(startDate) || observed < horizon) return empty('unavailable', '途中の終値が欠損。営業日を詰めて代用しません', observed);
  if (!benchmark?.verified || !validSeries(benchmark.bars)) return empty('unavailable', '同期間のSPYを確認できません', observed);
  const spy = new Map(benchmark.bars.map(bar => [bar.date, bar.close]));
  if (expected.some(date => !spy.has(date))) return empty('unavailable', '同期間のSPYに欠損があります', observed);
  let peak = prices.get(startDate), drawdown = 0;
  for (const date of expected) { const price = prices.get(date); peak = Math.max(peak, price); drawdown = Math.min(drawdown, (price / peak - 1) * 100); }
  const end = expected.at(-1);
  return { status: 'complete', reason: null, observed_sessions: horizon, end_date: end,
    return_pct: (prices.get(end) / prices.get(startDate) - 1) * 100,
    spy_return_pct: (spy.get(end) / spy.get(startDate) - 1) * 100,
    max_drawdown_pct: drawdown };
}

function summarize(results, cohortCount) {
  const complete = results.filter(result => result.status === 'complete');
  const observed = results.map(result => result.observed_sessions).filter(Number.isFinite);
  return { n: complete.length, cohort_count: cohortCount,
    pending: results.filter(result => result.status === 'pending').length,
    unavailable: results.filter(result => result.status === 'unavailable').length,
    observed_sessions_min: observed.length ? Math.min(...observed) : null,
    observed_sessions_max: observed.length ? Math.max(...observed) : null,
    median_return_pct: median(complete.map(result => result.return_pct)),
    median_spy_return_pct: median(complete.map(result => result.spy_return_pct)),
    median_max_drawdown_pct: median(complete.map(result => result.max_drawdown_pct)),
    win_rate: complete.length ? complete.filter(result => result.return_pct > 0).length / complete.length : null,
    sample_insufficient: complete.length < 20 };
}

// Cohorts come only from the restored publication catalog. Current passes must
// never be used to reconstruct who would have qualified on an earlier date.
export function candidatePerformance({ snapshots, asOf, sessions, stocks, benchmark }) {
  const accumulators = Object.fromEntries(methods.map(method => [method, Object.fromEntries(PERFORMANCE_HORIZONS.map(horizon => [horizon, []]))]));
  const cohorts = snapshots.filter(snapshot => snapshot.as_of <= asOf).map(snapshot => ({
    as_of: snapshot.as_of, rule_version: snapshot.rule_version, universe_version: snapshot.universe_version,
    methods: Object.fromEntries(methods.map(method => {
      const records = snapshot.records.filter(record => record.market === 'US' && record.liquid === true && record.methods?.[method]?.state === 'pass');
      return [method, Object.fromEntries(PERFORMANCE_HORIZONS.map(horizon => {
        const results = records.map(record => measureCandidateReturn({ startDate: snapshot.as_of, asOf, sessions, stock: stocks.get(record.symbol), benchmark, horizon }));
        accumulators[method][horizon].push(...results);
        return [horizon, summarize(results, records.length)];
      }))];
    })),
  }));
  return { schema_version: 1, as_of: asOf, calendar: 'NYSE', price_basis: 'verified-published-close',
    definition: '公開時に保存した通過銘柄の終値からの騰落率。売買実績ではありません。選定銘柄は固定し、価格は現在の検証済み日足で再計測。最大下落率は期間内終値の高値から安値への最大下落。配当込み総合リターン・費用は含みません。',
    cohorts, summary: Object.fromEntries(methods.map(method => [method, Object.fromEntries(PERFORMANCE_HORIZONS.map(horizon => {
      const results = accumulators[method][horizon]; return [horizon, summarize(results, results.length)];
    }))])) };
}
