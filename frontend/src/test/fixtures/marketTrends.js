// Market-trends payloads in the shape the exporter emits (tools/export-market-trends.mjs) for the
// 地合い card and the market tab's view model: indices carry points, latest (null when the index series
// ends before the analysis date), lastObserved and followThrough; long_history carries breadth rows.

/** Long-history fields an older schema (market-long-history-v1 before the environment fields) never had. */
export const ENVIRONMENT = ['trendTemplateCount', 'trendTemplatePercent', 'rs90TemplateCount', 'above150', 'above150Percent', 'above200', 'above200Percent', 'stage1', 'stage2', 'stage3', 'stage4', 'breakouts', 'breakoutsJudged', 'breakoutsHeld', 'leaderCohort', 'leaderCohortAbove50'];

/** n consecutive calendar days ending on `end` (the view model only needs ordered ISO dates). */
export const days = (end, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${end}T00:00:00Z`) - (n - 1 - i) * 86400000).toISOString().slice(0, 10));

export const point = (date, over = {}) => ({ date, coverage: 200, eligibleUniverse: 200, universe: 200, above50: 86, above50Percent: 43, newHighs: 40, newLows: 12, leaderCount: 20,
  trendTemplateCount: 30, rs90TemplateCount: 8, above200: 90, above200Percent: 45, stage1: 50, stage2: 70, stage3: 40, stage4: 40, breakoutsJudged: 8, breakoutsHeld: 6,
  leaderCohort: 30, leaderCohortAbove50: 21, ...over });

/** Breadth rows ending on `end`; `at(i, n)` overrides fields of row i. */
export const breadth = (end, at = () => ({}), n = 30) => days(end, n).map((date, i) => point(date, at(i, n)));

/** The same rows as an older long-history schema wrote them. */
export const oldSchema = rows => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !ENVIRONMENT.includes(key))));

export const confirmed = asOf => ({ available: true, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', asOf, state: 'confirmed', peak: { date: '2026-07-01', close: 6000 }, low: { date: '2026-08-01', low: 5400 }, declinePct: 9.1,
  attempt: { startDate: '2026-08-04', day: 4 }, ftd: { date: '2026-08-07', attemptDay: 4, gainPct: 1.43, volumeRatio: 1.2, sessionsSince: 40, distributionSince: 2 }, failedDate: null, events: [] });
export const attempt = asOf => ({ available: true, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', asOf, state: 'rally_attempt', peak: { date: '2026-09-10', close: 21000 }, low: { date: '2026-09-29', low: 19500 }, declinePct: 7.2,
  attempt: { startDate: '2026-09-30', day: 3 }, ftd: null, failedDate: null, events: [] });
export const failed = asOf => ({ ...confirmed(asOf), state: 'ftd_failed', failedDate: asOf });

/** One index series whose newest point is `asOf` with `value` active distribution days. */
export const index = (symbol, asOf, value, date, followThrough, legacy) => {
  const points = [{ date: asOf, value, distribution: false, reason: null }];
  const historical = asOf < date;
  return { symbol, available: !historical, points, events: [], latest: historical ? null : points.at(-1), ...(historical ? { historical: true, reason: `${date}は未取得。${asOf}までの過去記録を表示しています。` } : {}),
    ...(legacy ? {} : { lastObserved: { date: asOf, value }, followThrough }) };
};

/** S&P 500 closes ending on `end`, rising by `step` a session from `start`. */
export const closes = (end, n = 260, start = 5000, step = 2) => days(end, n).map((date, i) => ({ date, close: start + i * step }));

/** A ready market-trends asset as useMarketTrends returns it. */
export const trends = ({ asOf = '2026-10-02', date = asOf, rows = breadth(asOf), follow = [confirmed(asOf), attempt(asOf)], legacy = false, history = true, sp500 = [] } = {}) => ({ loading: false, error: false,
  data: { as_of_date: date, indices: [index('^GSPC', asOf, 3, date, follow[0], legacy), index('^IXIC', asOf, 4, date, follow[1], legacy)], ...(history ? { long_history: { as_of_date: asOf, breadth: rows, sp500 } } : {}) } });

export const UP = { label: '上昇トレンド（独自判定）', cap: 0.5 };
