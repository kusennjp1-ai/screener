export const BOOK_MARKET_VERSION = 'book-market-v1';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const positive = n => finite(n) && n > 0;
const dateValid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const change = (a, b) => positive(b) ? (a / b - 1) * 100 : null;
const max = xs => Math.max(...xs), min = xs => Math.min(...xs);
const validBar = b => b && dateValid(b.date) && ![0, 6].includes(new Date(b.date).getUTCDay()) &&
  [b.open, b.high, b.low, b.close].every(positive) && finite(b.volume) && b.volume >= 0 &&
  b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close);

// Validity is prefix-local: a later bad print must not rewrite an earlier day.
function indexChart(chart, asOfDate, calendar = null) {
  if (!chart || typeof chart.symbol !== 'string' || !chart.symbol.trim() || !Array.isArray(chart.bars)) return null;
  const index = new Map();
  const bars = [];
  for (const b of chart.bars) {
    if (!validBar(b) || (bars.length && b.date <= bars.at(-1).date)) break;
    if (b.date > asOfDate) break;
    const calendarIndex = calendar?.index.get(b.date);
    // A missing known market session invalidates subsequent rolling windows.
    // Retain the earlier valid prefix instead of relabeling multi-day returns.
    if (calendar?.bars.length && b.date >= calendar.bars[0].date && b.date <= calendar.bars.at(-1).date && calendarIndex == null) break;
    if (bars.length && calendarIndex > 0 && calendar.bars[calendarIndex - 1].date > bars.at(-1).date) break;
    if (bars.length && (b.close / bars.at(-1).close >= 1.8 || b.close / bars.at(-1).close <= .55)) break;
    index.set(b.date, bars.length); bars.push(b);
  }
  return { symbol: chart.symbol, bars, index };
}

function dailyStock(chart, date) {
  const i = chart.index.get(date);
  if (i == null || i < 251) return null;
  const b = chart.bars, last = b[i], prior = b[i - 1];
  const slice = (n, lag = 0) => b.slice(i + 1 - n - lag, i + 1 - lag);
  const sma = (n, lag = 0) => mean(slice(n, lag).map(x => x.close));
  const sma50 = sma(50), sma150 = sma(150), sma200 = sma(200), sma200Ago = sma(200, 21);
  const year = slice(252), priorYear = slice(251, 1);
  const aboveLow = change(last.close, min(year.map(x => x.low)));
  const belowHigh = (1 - last.close / max(year.map(x => x.high))) * 100;
  const priceTemplate = last.close > sma150 && last.close > sma200 && sma150 > sma200 && sma200 > sma200Ago &&
    sma50 > sma150 && sma50 > sma200 && last.close > sma50 && aboveLow >= 25 && belowHigh <= 25;
  const momentum = i >= 252 ? [63, 126, 189, 252].reduce((sum, lag, k) => sum + (last.close / b[i - lag].close - 1) * (k === 0 ? .4 : .2), 0) : null;
  const pre20 = slice(20, 1), pre5 = slice(5, 1), pre50 = slice(50, 1);
  const pivotProxy = max(pre20.map(x => x.high));
  const baseDepthProxy = (pivotProxy - min(pre20.map(x => x.low))) / pivotProxy * 100;
  const rightVolume = mean(pre5.map(x => x.volume));
  const baseline = mean(slice(50, 6).map(x => x.volume));
  const setupProxy = baseDepthProxy <= 10 && baseline > 0 && rightVolume < baseline && prior.close >= pivotProxy * .97;
  const averageVolume = mean(pre50.map(x => x.volume));
  const volumeRatio = averageVolume > 0 ? last.volume / averageVolume : null;
  return { symbol: chart.symbol, close: last.close, previousClose: prior.close, volume: last.volume,
    dollarVolume: last.close * last.volume, priceTemplate, momentum, below50: last.close < sma50,
    return20: change(last.close, b[i - 20].close),
    newHigh: last.high > max(priorYear.map(x => x.high)), newLow: last.low < min(priorYear.map(x => x.low)),
    setupProxy, pivotProxy, baseDepthProxy, volumeRatio,
    breakoutProxy: setupProxy && last.close > pivotProxy && last.close <= pivotProxy * 1.03 && volumeRatio !== null && volumeRatio >= 1.4 };
}

function rankDay(rows) {
  const values = rows.filter(r => finite(r.momentum)).map(r => r.momentum).sort((a, b) => a - b);
  const ranks = new Map();
  if (values.length >= 100) for (let i = 0; i < values.length;) {
    let end = i + 1;
    while (end < values.length && values[end] === values[i]) end++;
    ranks.set(values[i], 1 + 98 * ((i + end - 1) / 2) / (values.length - 1));
    i = end;
  }
  return { count: values.length, rows: rows.map(r => ({ ...r, rs: ranks.get(r.momentum) ?? null,
    leader: r.priceTemplate && (ranks.get(r.momentum) ?? 0) >= 70 })) };
}

function benchmarkAt(chart, date) {
  const i = chart?.index.get(date);
  if (i == null || i < 1) return null;
  const b = chart.bars, last = b[i], prior = b[i - 1];
  const dailyChangePct = change(last.close, prior.close);
  const knownVolume = last.volume > 0 && prior.volume > 0;
  return { symbol: chart.symbol, date, close: last.close, dailyChangePct, volume: last.volume,
    previousVolume: prior.volume, volumeRatio: prior.volume > 0 ? last.volume / prior.volume : null,
    upOnHigherVolume: knownVolume ? dailyChangePct > 0 && last.volume > prior.volume : null,
    downOnLowerVolume: knownVolume ? dailyChangePct < 0 && last.volume < prior.volume : null,
    downOnHigherVolume: knownVolume ? dailyChangePct < 0 && last.volume > prior.volume : null,
    return20: i >= 20 ? change(last.close, b[i - 20].close) : null };
}

/** Only historical OHLCV is consumed. Never pass today's screening flags as history. */
export function buildBookMarketEvidence({ charts = [], asOfDate, benchmark = null, expectedUniverseSize = charts.length, lookbackSessions = 60 } = {}) {
  if (!dateValid(asOfDate) || !Array.isArray(charts) || !Number.isInteger(lookbackSessions) || lookbackSessions < 1 || lookbackSessions > 252 ||
    !Number.isInteger(expectedUniverseSize) || expectedUniverseSize < charts.length) throw Error('Invalid market evidence inputs');
  const duplicates = new Set(), seen = new Set();
  for (const c of charts) { if (seen.has(c?.symbol)) duplicates.add(c?.symbol); seen.add(c?.symbol); }
  const bm = indexChart(benchmark, asOfDate);
  const indexed = charts.filter(c => !duplicates.has(c?.symbol)).map(c => indexChart(c, asOfDate, bm)).filter(Boolean);
  const dates = [...new Set(indexed.flatMap(c => c.bars.slice(251).map(b => b.date)))].sort().slice(-lookbackSessions);
  const events = [], series = [];
  let cohort = null;
  for (const date of dates) {
    const ranked = rankDay(indexed.map(c => dailyStock(c, date)).filter(Boolean));
    const rows = ranked.rows, leaders = rows.filter(r => r.leader), index = benchmarkAt(bm, date);
    if (cohort === null && ranked.count >= 100) cohort = { date, members: leaders.map(r => ({ symbol: r.symbol, close: r.close })), indexClose: index?.close ?? null };
    const activeCohort = cohort ? cohort.members.map(m => ({ original: m, current: rows.find(r => r.symbol === m.symbol) })).filter(m => m.current) : [];
    const up = rows.filter(r => r.close > r.previousClose), down = rows.filter(r => r.close < r.previousClose);
    const sum = (list, key) => list.reduce((total, r) => total + r[key], 0);
    const breaks = leaders.filter(r => r.breakoutProxy);
    for (const r of breaks) events.push({ date, symbol: r.symbol, close: r.close, pivotProxy: r.pivotProxy, rs: r.rs,
      volumeRatio: r.volumeRatio, baseDepthProxy: r.baseDepthProxy, source: '20-session-range-proxy', certifiedSetup: false });
    series.push({ date, coverage: rows.length, expectedUniverseSize, coveragePct: expectedUniverseSize ? rows.length / expectedUniverseSize * 100 : null,
      rsUniverseSize: ranked.count, leaderCount: ranked.count >= 100 ? leaders.length : null,
      newHighs: rows.length ? rows.filter(r => r.newHigh).length : null, newLows: rows.length ? rows.filter(r => r.newLow).length : null,
      advancing: up.length, declining: down.length, unchanged: rows.length - up.length - down.length,
      upVolume: sum(up, 'volume'), downVolume: sum(down, 'volume'), upDollarVolume: sum(up, 'dollarVolume'), downDollarVolume: sum(down, 'dollarVolume'),
      setupProxyCount: ranked.count >= 100 ? leaders.filter(r => r.setupProxy).length : null,
      breakoutProxyCount: ranked.count >= 100 ? breaks.length : null,
      benchmark: index,
      leadersPositiveWhileIndexNegative: ranked.count >= 100 && finite(index?.return20) ? leaders.filter(r => r.return20 > 0 && index.return20 < 0).length : null,
      cohort: cohort ? { selectedAt: cohort.date, size: cohort.members.length, observed: activeCohort.length,
        below50: activeCohort.filter(m => m.current.below50).length,
        lostLeaderStatus: ranked.count >= 100 ? activeCohort.filter(m => !m.current.leader).length : null,
        meanReturnPct: activeCohort.length ? mean(activeCohort.map(m => change(m.current.close, m.original.close))) : null,
        indexReturnPct: index && positive(cohort.indexClose) ? change(index.close, cohort.indexClose) : null,
        // Missing members stay missing, never silently counted as healthy.
        missing: cohort.members.length - activeCohort.length } : null });
  }
  return { version: BOOK_MARKET_VERSION, as_of_date: asOfDate, series, latest: series.at(-1) ?? null, breakoutEvents: events,
    currentSnapshotComplete: series.at(-1)?.date === asOfDate,
    cohortMembers: cohort?.members.map(m => m.symbol) ?? [],
    sources: [{ book: '株式トレード 基本と原則', recordingSeconds: [405.5, 426.5, 429.5] }],
    universe: { requested: expectedUniverseSize, suppliedCharts: charts.length, usableCharts: indexed.length, duplicateSymbolsExcluded: [...duplicates],
      definition: '現在公開されているチャート集合を過去へ計算。過去の全上場銘柄集合ではない', survivorshipBias: true, historicalMembershipVerified: false },
    methods: { newHighLow: '当日高値／安値が直前251本を厳密に更新（合計252本）',
      leaders: '各日のOHLCだけで基本と原則の25%安値トレンド近似とRS70以上を再計算。RSは当日100銘柄以上の共通公開集合内の独自順位',
      cohort: '表示開始日以降、RS母集団が100以上になった最初の日の先導候補を固定追跡。今日の候補を過去に投影しない',
      setups: '前20本の値幅10%以内・前5本出来高減少・前日ピボット3%以内の固定窓代理。ブレイクは終値越え＋3%以内＋出来高1.4倍',
      volume: '個別株の上昇／下落日の株数出来高と終値×出来高を別集計。指数は前日比の価格と出来高を直接比較' },
    unknowns: ['過去時点の全上場銘柄・廃止銘柄・当時の業績と決算日', '実際のVCP収縮・ベース境界・買えるセットアップの成立',
      '分割・併合・配当調整の提供元検証。大幅断絶後のデータは除外', '書籍の市場環境判断を完全再現したものではなく自動売買に使用しない'] };
}
