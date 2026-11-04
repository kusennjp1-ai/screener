#!/usr/bin/env node
/**
 * Market-regime study: diagnostic research only. It changes no rule, threshold, verdict or published value.
 *
 * Owner question (2026-11-04): 市場環境については実際に過去のデータからどの指標がどういう状態にあるときに
 * 株価が下がりやすい、または上がりやすいか — from real history, in which states of which market-environment
 * indicators did the index tend to fall or rise afterwards?
 *
 * ============================================================================================================
 * PRE-REGISTERED PLAN  market-regime-study-v1
 * Fixed before any real-data run. Changing any item below needs a new STUDY_VERSION and is reported as a
 * deviation; no threshold, bucket edge, window or test is chosen after looking at results.
 * ============================================================================================================
 *
 * DATA
 *  H  Long history (market-long-history-v1, frontend/tools/collect-market-history.py), validated with the
 *     app's validateLongHistory and read through environmentPoint. Outcome series: H.sp500 (^GSPC closes of
 *     the same capture). It is a CURRENT-UNIVERSE RETROSPECTIVE (historical_membership_verified = false):
 *     names delisted before the capture are absent, so early breadth is expected to read healthier than it
 *     was (survivorship). Quantified by the diagnostics below; no correction is applied.
 *  I  ^GSPC and ^IXIC daily OHLCV: Yahoo chart API (CI only, 1 request/s, generic UA, since 1990-01-01) or a
 *     market-trend-source-v1 file. Each bar is checked like distributionDays (every OHLCV value positive,
 *     high/low consistent). With an independent calendar (--calendar, or the file's calendar_sessions) a
 *     missing session is an unknown bar and a bar off the calendar is excluded; without one the provider's
 *     dates are used and the report says so. Bars after the as-of date are dropped. An unknown bar is never
 *     filled: a DD / FTD / moving-average window that would contain it is unjudged.
 *
 * OUTCOMES (strictly causal: the indicator uses data up to close t; the outcome starts from close t)
 *  r_h(t)  = C(t+h) / C(t) - 1 for h in {5, 10, 21, 63} sessions of the outcome series.
 *  dd_h(t) = min over k = 1..h of C(t+k) / C(t) - 1 (worst close in the window against the entry close).
 *  Unknown when any close in t..t+h is unknown. Never 0.
 *
 * INDICATORS (state at close t; an unknown input leaves the session unjudged and excluded, never 0 or pass)
 *  Index panel (I, per index; outcome = that index):
 *   dd.binary        distributionDays.js active count >= DISTRIBUTION_WARN (5) vs <= 4
 *   dd.graded        0-2 / 3-4 / 5-6 / 7+
 *   ftd.state        followThroughDay.js on the trailing 280 sessions (the brief's window: collect-market-trends.py
 *                    keeps sessions[-280:]): no_correction, no_correction_pending (peakAtWindowStart, the
 *                    brief's 判定保留), correction, rally_attempt, attempt_expired, confirmed, ftd_failed
 *   ma50, ma200      close above vs at-or-below the 50- / 200-day SMA (marketTabModel indexSummary)
 *   ma.quadrant      the four cells of ma50 x ma200
 *   high.near        within SPLIT_RULE.nearHighPercent (5%) of the 252-session closing high vs not
 *   combo.dd_ma50    the four cells of dd.binary x ma50 (the distribution warning below the 50-day line)
 *   combo.ftd_recent confirmed with the FTD at most 25 sessions ago vs every other judged state
 *  Breadth panel (H; outcome = H.sp500):
 *   spx.ma50, spx.ma200, spx.ma.quadrant, spx.high.near   the same on H.sp500 (same-period comparator)
 *   rule.split       marketLongHistory bifurcation(): within 5% of the 1y high AND above200Percent < 50
 *   rule.lows        newLows > newHighs (the market tab's 新高値・新安値 check)
 *   rule.template, rule.stage, rule.leaders, rule.breakout   briefModel environmentRules (ENV_RULES)
 *   rule.count       fired checks of the market tab's warning summary (dist S&P, dist NAS, FTD failed S&P,
 *                    FTD failed NAS, split, lows, template, stage, leaders, breakout): 0 / 1 / 2 / 3+; judged
 *                    only on sessions where all ten are judged
 *   combo.lows_below200     rule.lows fired AND ^GSPC close at or below its 200-day SMA, vs otherwise
 *   combo.washout_uptrend   above50Percent in its Q1 AND ^GSPC close above its 200-day SMA, vs otherwise
 *   q.<field>, d21.<field>  fixed quintiles of each continuous field and of its 21-session change
 *                    (value_t - value_{t-21}): above50Percent, above150Percent, above200Percent,
 *                    trendTemplatePercent, netHighsPercent = 100 (newHighs - newLows) / coverage, ratio_10day,
 *                    leaderPercent = 100 leaderCount / coverage, leaderHealthPercent, breakoutHoldPercent,
 *                    stageSpread = stage2Percent - stage4Percent.
 *                    Edges: the 20/40/60/80th percentiles (linear interpolation) over every session where the
 *                    value is known (at least 5 values); a value equal to an edge falls in the lower bucket.
 *                    The edges are in-sample and descriptive, not a trading rule.
 *
 * STATISTICS per (indicator bucket, h)
 *  Evaluation sample: sessions where the indicator is judged and r_h and dd_h are known. Baseline: the same
 *  sample, unconditionally. Reported: n, episodes (in-bucket sessions more than h sessions apart start a new
 *  episode), mean, median, P(r_h > 0), P(dd_h <= -5%), P(dd_h <= -10%).
 *  Differences vs baseline: mean r_h (primary) and P(dd_h <= -5%) (secondary, the "falls" question).
 *  90% CI: circular moving-block bootstrap of the time-ordered sample, block L = max(2h, 21), 2000
 *  replicates, mulberry32 seeded by FNV-1a("20261104|<indicator>|<h>|<sample>"), percentiles 5 / 95. A
 *  replicate that misses the bucket is dropped; the CI is withheld when more than 10% are dropped or when the
 *  sample spans fewer than 4 blocks.
 *  Split-sample: first vs second half of the evaluation sample (by session count), each with its own baseline
 *  and bootstrap; the bucket edges stay fixed.
 *  Label (per statistic): insufficient = n < 20 or episodes < 3 or no CI in the full sample or either half;
 *  robust = both halves' CIs exclude 0 with the same sign; unstable = the halves' estimates have opposite
 *  signs; weak = otherwise. Report "weak" and "unstable" together as weak/unstable.
 *  Multiple comparisons: the report states the number of tests (bucket x h x statistic). At 90% about 10% of
 *  full-sample CIs exclude 0 by chance. Only "robust" is read as evidence, and it is not adjusted either.
 *
 * SURVIVORSHIP DIAGNOSTICS (H)
 *  1. eligibleUniverse / universe and coverage / universe by year.
 *  2. OLS of above50Percent on ^GSPC % vs its 50-day and 200-day SMA; mean residual by year and by half
 *     (positive early residuals are consistent with survivorship inflation, or a genuinely broader market).
 *  3. Per bucket, the share of its sessions in the first half (period concentration).
 *
 * Proprietary RS inside the trend-template counts is this app's own RS, not IBD RS.
 */
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { distributionDays, DISTRIBUTION_METHOD } from '../src/static/distributionDays.js';
import { followThroughDay, FOLLOW_THROUGH_METHOD } from '../src/static/followThroughDay.js';
import { bifurcation, environmentPoint, validateLongHistory, SPLIT_RULE } from '../src/static/marketLongHistory.js';
import { verifyLongHistorySource } from './export-market-trends.mjs';

// briefModel.js and marketTabModel.js use extensionless relative imports that Vite resolves. Plain Node gets
// a resolve hook that retries such a specifier with '.js', so the study runs the app's own rule code.
const RESOLVE_HOOK = "export async function resolve(specifier,context,next){try{return await next(specifier,context);}catch(error){if(error&&error.code==='ERR_MODULE_NOT_FOUND'&&/^\\.\\.?\\//.test(specifier)&&!/\\.(?:[cm]?js|json)$/.test(specifier))return next(specifier+'.js',context);throw error;}}";
if (!process.env.VITEST) register(`data:text/javascript,${encodeURIComponent(RESOLVE_HOOK)}`);
const { environmentRules, ENV_RULES } = await import('../src/static/brief/briefModel.js');
const { DISTRIBUTION_WARN, indexSummary } = await import('../src/static/brief/marketTabModel.js');

export const STUDY_VERSION = 'market-regime-study-v1';
export const WINDOWS = Object.freeze([5, 10, 21, 63]);
export const DRAWDOWN = Object.freeze({ primary: -0.05, deep: -0.10 });
export const QUANTILES = Object.freeze([0.2, 0.4, 0.6, 0.8]);
export const CHANGE_SESSIONS = 21;
export const FTD_WINDOW_SESSIONS = 280;
export const FTD_RECENT_SESSIONS = 25;
export const DD_GRADES = Object.freeze([[0, 2], [3, 4], [5, 6], [7, Infinity]]);
export const BOOTSTRAP = Object.freeze({ replicates: 2000, seed: 20261104, lower: 0.05, upper: 0.95, minBlocks: 4, maxDropped: 0.1 });
export const MIN_SESSIONS = 20, MIN_EPISODES = 3;
export const blockLength = h => Math.max(2 * h, 21);
export const YAHOO = Object.freeze({ start: '1990-01-01', symbols: Object.freeze(['^GSPC', '^IXIC']), spacingMs: 1000 });
export const FTD_BUCKETS = Object.freeze([
  ['no_correction', '不要 (no 6% correction)'], ['no_correction_pending', '判定保留 (window opens on the peak)'],
  ['correction', '調整中 (correction)'], ['rally_attempt', '反発中 (rally attempt)'],
  ['attempt_expired', '15日以内のFTDなし (attempt expired)'], ['confirmed', '確認 (FTD confirmed)'], ['ftd_failed', 'FTD失敗 (failed)']]);
const count = value => Number.isSafeInteger(value) && value >= 0;
const share = (row, key) => count(row?.[key]) && count(row?.coverage) && row.coverage > 0 ? 100 * row[key] / row.coverage : null;
export const BREADTH_FIELDS = Object.freeze([
  ['above50Percent', '50日線より上 (% above 50-day)', row => num(row.above50Percent)],
  ['above150Percent', '150日線より上 (% above 150-day)', row => num(row.above150Percent)],
  ['above200Percent', '200日線より上 (% above 200-day)', row => num(row.above200Percent)],
  ['trendTemplatePercent', 'TT達成率 (% meeting the trend template)', row => num(row.trendTemplatePercent)],
  ['netHighsPercent', '新高値−新安値 (net new highs, % of coverage)', row => count(row.newHighs) && count(row.newLows) && count(row.coverage) && row.coverage > 0 ? 100 * (row.newHighs - row.newLows) / row.coverage : null],
  ['ratio_10day', '10日騰落比 (10-session 4% up/down ratio)', row => num(row.ratio_10day)],
  ['leaderPercent', '先導株数 (price-template leaders, % of coverage)', row => share(row, 'leaderCount')],
  ['leaderHealthPercent', 'リーダーの健全度 (% of the cohort above its 50-day)', row => num(row.leaderHealthPercent)],
  ['breakoutHoldPercent', 'ブレイクアウト成功率 (breakout hold %)', row => num(row.breakoutHoldPercent)],
  ['stageSpread', 'ステージ2−ステージ4 (stage 2 % minus stage 4 %)', row => num(row.stage2Percent) !== null && num(row.stage4Percent) !== null ? row.stage2Percent - row.stage4Percent : null]]);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = value => finite(value) ? value : null;
const positive = value => finite(value) && value > 0;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const round = (value, digits = 6) => finite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

// ---- deterministic randomness and quantiles ----------------------------------------------------------------
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Linear-interpolation quantile (Hyndman-Fan type 7) of an ascending array. */
export function quantileSorted(sorted, p) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p, low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// ---- inputs --------------------------------------------------------------------------------------------------
/** A bar the app's distributionDays / followThroughDay would accept. */
export function validBar(bar) {
  return Boolean(bar) && isDay(bar.date) && ['open', 'high', 'low', 'close', 'volume'].every(key => positive(bar[key]))
    && !(bar.high < Math.max(bar.open, bar.close, bar.low)) && !(bar.low > Math.min(bar.open, bar.close));
}

const NEW_YORK = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Yahoo chart JSON -> dated bars (New York session dates). Identity and ordering fail closed; values are kept as given. */
export function parseYahooChart(raw, symbol, asOfDate) {
  const value = JSON.parse(raw)?.chart?.result?.[0];
  if (value?.meta?.symbol !== symbol || value.meta.instrumentType !== 'INDEX') throw Error(`${symbol}: provider index identity mismatch`);
  const quote = value.indicators?.quote?.[0], stamps = value.timestamp || [];
  if (!quote || !Array.isArray(stamps)) throw Error(`${symbol}: provider response has no quote series`);
  const bars = [];
  for (let i = 0; i < stamps.length; i++) {
    if (!Number.isSafeInteger(stamps[i])) throw Error(`${symbol}: invalid provider timestamp`);
    const date = NEW_YORK.format(new Date(stamps[i] * 1000));
    if (asOfDate && date > asOfDate) continue;
    if (bars.length && date <= bars.at(-1).date) throw Error(`${symbol}: duplicate or unordered provider session ${date}`);
    bars.push({ date, open: quote.open?.[i] ?? null, high: quote.high?.[i] ?? null, low: quote.low?.[i] ?? null, close: quote.close?.[i] ?? null, volume: quote.volume?.[i] ?? null });
  }
  return bars;
}

const wait = ms => new Promise(done => setTimeout(done, ms));
/** One daily-chart request in the style of collect-market-trends.py (generic UA, retries on 429/5xx). */
export async function fetchYahooIndex(symbol, { start = YAHOO.start, asOfDate, fetchImpl = fetch, sleep = wait } = {}) {
  if (!isDay(start) || !isDay(asOfDate)) throw Error('Yahoo request needs a start and an as-of date');
  const period1 = Date.parse(`${start}T00:00:00Z`) / 1000, period2 = Date.parse(`${asOfDate}T00:00:00Z`) / 1000 + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  for (let attempt = 0; ; attempt++) {
    let response;
    try { response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(40000) : undefined }); }
    catch (error) { if (attempt >= 2) throw error; await sleep(3000 * (attempt + 1)); continue; }
    if (!response.ok) {
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) { await sleep(8000 * (attempt + 1)); continue; }
      throw Error(`${symbol}: Yahoo HTTP ${response.status}`);
    }
    const raw = Buffer.from(await response.arrayBuffer());
    return { symbol, source: 'Yahoo Finance index OHLCV', volume_basis: 'Provider index volume; not independently reconciled to IBD exchange turnover',
      provenance: { url, sha256: sha256(raw), retrieved_at: new Date().toISOString() }, bars: parseYahooChart(raw.toString('utf8'), symbol, asOfDate) };
  }
}

export async function fetchYahooIndices({ asOfDate, start = YAHOO.start, fetchImpl = fetch, sleep = wait } = {}) {
  const indices = [];
  for (const [i, symbol] of YAHOO.symbols.entries()) {
    if (i) await sleep(YAHOO.spacingMs);
    indices.push(await fetchYahooIndex(symbol, { start, asOfDate, fetchImpl, sleep }));
  }
  return { schema_version: 'market-regime-indices-v1', as_of_date: asOfDate, start, indices };
}

async function readLocation(location) {
  if (/^https:\/\//.test(location)) {
    const response = await fetch(location);
    if (!response.ok) throw Error(`${location}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(location);
}
const join2 = (base, path) => /^https:\/\//.test(base) ? new URL(path, base.endsWith('/') ? base : `${base}/`).href : join(base, path);

/**
 * The long history from a static-data root (directory or URL, via manifest.json -> market_trends series ->
 * content-addressed history source), a market-trends series, or a raw market-long-history-v1 capture.
 * Every route is hash-checked and validated with the app's own validator.
 */
export async function loadHistory(location) {
  const isDirectory = !/^https:\/\//.test(location) && (await stat(location)).isDirectory();
  const rootFromManifest = isDirectory ? location : /manifest\.json$/.test(location) ? location.replace(/manifest\.json$/, '') : null;
  if (rootFromManifest !== null) {
    const manifest = JSON.parse(await readLocation(join2(rootFromManifest, 'manifest.json')));
    const entry = manifest.markets?.US || manifest, ref = entry.assets?.market_trends;
    if (!/^[a-f0-9]{64}$/.test(ref?.sha256 || '') || ref.path !== `market-trends/series-${ref.sha256}.json`) throw Error('Manifest has no content-addressed market_trends series');
    const seriesBytes = await readLocation(join2(rootFromManifest, ref.path));
    if (sha256(seriesBytes) !== ref.sha256) throw Error('market_trends series content address mismatch');
    const series = JSON.parse(seriesBytes);
    const shaRef = series.long_history?.source_sha256;
    if (!/^[a-f0-9]{64}$/.test(shaRef || '')) throw Error('The published series carries no long history');
    const bytes = await readLocation(join2(rootFromManifest, `market-trends/history-source-${shaRef}.json`));
    if (sha256(bytes) !== shaRef) throw Error('Long-history source content address mismatch');
    return { history: verifyLongHistorySource(bytes, entry.as_of_date), sha256: shaRef, origin: `${ref.path} -> market-trends/history-source-${shaRef}.json`, publicationDate: entry.as_of_date };
  }
  const bytes = await readLocation(location), value = JSON.parse(bytes);
  if (value?.schema_version === 'market-trends-v1') {
    if (!value.long_history) throw Error('The market-trends series carries no long history');
    const { source_sha256: sourceSha, ...history } = value.long_history;
    validateLongHistory(history, value.as_of_date, Infinity);
    return { history, sha256: sourceSha ?? null, origin: 'market-trends series long_history', publicationDate: value.as_of_date };
  }
  return { history: verifyLongHistorySource(bytes, value?.as_of_date), sha256: sha256(bytes), origin: 'market-long-history-v1 capture', publicationDate: null };
}

/** market-trend-source-v1 (the brief's 280-session source) or a saved market-regime-indices-v1 file. */
export async function loadIndices(location) {
  const bytes = await readLocation(location), value = JSON.parse(bytes);
  if (!['market-trend-source-v1', 'market-regime-indices-v1'].includes(value?.schema_version) || !Array.isArray(value.indices)) throw Error('Unsupported index source');
  return { ...value, sha256: sha256(bytes), indices: value.indices.map(item => ({ ...item, calendar_sessions: item.calendar_sessions || (value.schema_version === 'market-trend-source-v1' ? value.calendar?.sessions : undefined) })) };
}

export function checkCalendar(sessions) {
  if (!Array.isArray(sessions) || !sessions.length || sessions.some((day, i) => !isDay(day) || (i && day <= sessions[i - 1]))) throw Error('Calendar sessions must be strictly increasing ISO dates');
  return sessions;
}

/**
 * Bars placed on the calendar: a missing session becomes null (unknown), a bar off the calendar is excluded.
 * Without a calendar the provider's dates stand and calendarBasis says so.
 */
export function alignIndex({ symbol, bars, calendar = null, asOfDate = null }) {
  const input = (bars || []).filter(bar => bar && isDay(bar.date) && (!asOfDate || bar.date <= asOfDate));
  input.forEach((bar, i) => { if (i && bar.date <= input[i - 1].date) throw Error(`${symbol}: provider dates are not strictly increasing`); });
  if (!calendar || !input.length) return { symbol, dates: input.map(bar => bar.date), bars: input, calendarBasis: calendar ? 'independent' : 'provider', missing: [], extra: [] };
  const last = asOfDate || input.at(-1).date;
  const sessions = checkCalendar(calendar).filter(day => day >= input[0].date && day <= last);
  const byDate = new Map(input.map(bar => [bar.date, bar])), onCalendar = new Set(sessions);
  return { symbol, dates: sessions, bars: sessions.map(day => byDate.get(day) ?? null), calendarBasis: 'independent',
    missing: sessions.filter(day => !byDate.has(day)), extra: input.filter(bar => !onCalendar.has(bar.date)).map(bar => bar.date) };
}

/** Maximal runs of true as [start, end] index pairs. */
export function runs(flags) {
  const out = [];
  for (let i = 0; i < flags.length; i++) if (flags[i] && (i === 0 || !flags[i - 1])) { let j = i; while (j + 1 < flags.length && flags[j + 1]) j++; out.push([i, j]); }
  return out;
}

// ---- outcomes ------------------------------------------------------------------------------------------------
/** Forward return and worst close over the next h sessions, from close t. Unknown closes give null, never 0. */
export function forwardOutcomes(closes, h) {
  const n = closes.length, ret = new Array(n).fill(null), dd = new Array(n).fill(null);
  for (let t = 0; t + h < n; t++) {
    const base = closes[t];
    if (!positive(base)) continue;
    let worst = Infinity, known = true;
    for (let k = 1; k <= h; k++) { const close = closes[t + k]; if (!positive(close)) { known = false; break; } worst = Math.min(worst, close / base - 1); }
    if (known) { ret[t] = closes[t + h] / base - 1; dd[t] = worst; }
  }
  return { ret, dd };
}

// ---- per-session states ----------------------------------------------------------------------------------------
const maState = summary => summary ? { vsMa: num(summary.vsMa), vs200: num(summary.vs200), fromHigh: summary.fullYear ? num(summary.fromHigh) : null } : null;

/**
 * The index panel's states at each session, using the app's own implementations on data up to that session:
 * distributionDays over each fully valid run (a count needs only its last 26 sessions, so it equals the
 * brief's 280-session computation), followThroughDay over the trailing 280 sessions, indexSummary over the
 * trailing run of known closes.
 */
export function indexStates({ symbol, dates, bars }) {
  const n = bars.length, valid = bars.map(validBar), closes = bars.map(bar => positive(bar?.close) ? bar.close : null);
  const dd = new Array(n).fill(null), ftd = new Array(n).fill(null), ma = new Array(n).fill(null);
  for (const [start, end] of runs(valid)) {
    const segment = bars.slice(start, end + 1);
    if (segment.length >= 26) {
      const result = distributionDays({ symbol, bars: segment, sessions: segment.map(bar => bar.date), asOfDate: segment.at(-1).date });
      if (result.available) result.points.forEach((point, i) => { if (count(point.value)) dd[start + i] = point.value; });
    }
    for (let i = start + FTD_WINDOW_SESSIONS - 1; i <= end; i++) {
      const result = followThroughDay({ symbol, bars: bars.slice(i - FTD_WINDOW_SESSIONS + 1, i + 1), asOfDate: bars[i].date });
      if (result.available) ftd[i] = { state: result.state === 'no_correction' && result.peakAtWindowStart === true ? 'no_correction_pending' : result.state, sessionsSince: result.ftd?.sessionsSince ?? null };
    }
  }
  let run = 0;
  for (let i = 0; i < n; i++) {
    run = closes[i] === null ? 0 : run + 1;
    if (run >= 60) ma[i] = maState(indexSummary(bars.slice(i - Math.min(run, 252) + 1, i + 1).map(bar => ({ date: bar.date, close: bar.close }))));
  }
  return { symbol, dates: dates ?? bars.map(bar => bar?.date ?? null), closes, dd, ftd, ma };
}

/** The breadth panel's states at each session: the app's rules evaluated on the history as of that session. */
export function breadthStates(history) {
  const rows = history.breadth.map(environmentPoint), sp = history.sp500 || [];
  const position = new Map(sp.map((point, i) => [point.date, i]));
  const dates = rows.map(row => row.date);
  const closes = dates.map(day => { const i = position.get(day); return i !== undefined && positive(sp[i].close) ? sp[i].close : null; });
  const ma = [], split = [], lows = [], rules = { template: [], stage: [], leaders: [], breakout: [] };
  rows.forEach((row, t) => {
    const i = position.get(row.date), current = i !== undefined && positive(sp[i].close);
    const prefix = current ? sp.slice(0, i + 1) : null;
    // A summary dated before this session (its close unknown) would be stale: unjudged instead.
    const summary = current ? indexSummary(prefix) : null;
    ma.push(summary && summary.date === row.date ? maState(summary) : null);
    const bif = current ? bifurcation({ sp500: prefix, breadth: [row] }) : null;
    split.push(bif ? bif.warning : null);
    lows.push(count(row.newHighs) && count(row.newLows) ? row.newLows > row.newHighs : null);
    for (const rule of environmentRules(rows.slice(Math.max(0, t - ENV_RULES.templateSessions), t + 1))) rules[rule.key]?.push(rule.judged ? rule.fired : null);
  });
  const fields = Object.fromEntries(BREADTH_FIELDS.map(([key, , read]) => [key, rows.map(read)]));
  return { dates, rows, closes, ma, split, lows, rules, fields };
}

// ---- buckets ---------------------------------------------------------------------------------------------------
export function quintileEdges(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  return sorted.length >= 5 ? QUANTILES.map(p => quantileSorted(sorted, p)) : null;
}
/** Bucket index 0..4; a value equal to an edge belongs to the lower bucket. */
export function quintileBucket(value, edges) {
  if (!finite(value) || !edges) return null;
  for (let k = 0; k < edges.length; k++) if (value <= edges[k]) return k;
  return edges.length;
}
export const change = (values, lag = CHANGE_SESSIONS) => values.map((value, t) => t >= lag && finite(value) && finite(values[t - lag]) ? value - values[t - lag] : null);
export function episodes(indices, h) {
  let total = 0;
  indices.forEach((index, i) => { if (i === 0 || index - indices[i - 1] > h) total++; });
  return total;
}

// ---- bootstrap ------------------------------------------------------------------------------------------------
/**
 * Circular moving-block bootstrap of (bucket mean - sample mean) for every bucket and every statistic in ys.
 * One resample (the same block starts) serves all buckets and statistics. Returns [stat][bucket] Float64Array
 * replicates; NaN marks a replicate without the bucket.
 */
export function blockBootstrap({ ys, group, groups, block, replicates, rng }) {
  const M = group.length, S = ys.length;
  const cnt = Array.from({ length: groups }, () => new Float64Array(M + 1));
  const tot = ys.map(() => new Float64Array(M + 1));
  const sum = ys.map(() => Array.from({ length: groups }, () => new Float64Array(M + 1)));
  for (let i = 0; i < M; i++) {
    const g = group[i];
    for (let k = 0; k < groups; k++) cnt[k][i + 1] = cnt[k][i] + (k === g ? 1 : 0);
    for (let s = 0; s < S; s++) {
      tot[s][i + 1] = tot[s][i] + ys[s][i];
      for (let k = 0; k < groups; k++) sum[s][k][i + 1] = sum[s][k][i] + (k === g ? ys[s][i] : 0);
    }
  }
  const span = (prefix, start, length) => start + length <= M ? prefix[start + length] - prefix[start] : prefix[M] - prefix[start] + prefix[start + length - M];
  const out = ys.map(() => Array.from({ length: groups }, () => new Float64Array(replicates)));
  const blocks = Math.ceil(M / block), starts = new Int32Array(blocks), lengths = new Int32Array(blocks), base = new Float64Array(S);
  for (let r = 0; r < replicates; r++) {
    let remaining = M;
    for (let b = 0; b < blocks; b++) { starts[b] = Math.floor(rng() * M); lengths[b] = Math.min(block, remaining); remaining -= lengths[b]; }
    for (let s = 0; s < S; s++) { let total = 0; for (let b = 0; b < blocks; b++) total += span(tot[s], starts[b], lengths[b]); base[s] = total / M; }
    for (let k = 0; k < groups; k++) {
      let c = 0;
      for (let b = 0; b < blocks; b++) c += span(cnt[k], starts[b], lengths[b]);
      for (let s = 0; s < S; s++) {
        if (c < 0.5) { out[s][k][r] = NaN; continue; }
        let total = 0;
        for (let b = 0; b < blocks; b++) total += span(sum[s][k], starts[b], lengths[b]);
        out[s][k][r] = total / c - base[s];
      }
    }
  }
  return out;
}
export function interval(replicates) {
  const values = Array.from(replicates).filter(finite).sort((a, b) => a - b);
  if (!values.length || values.length < (1 - BOOTSTRAP.maxDropped) * replicates.length) return null;
  return [quantileSorted(values, BOOTSTRAP.lower), quantileSorted(values, BOOTSTRAP.upper)];
}

// ---- evaluation -------------------------------------------------------------------------------------------------
function summarize(rets, dds) {
  const n = rets.length;
  if (!n) return { n: 0, mean: null, median: null, pUp: null, pDd5: null, pDd10: null };
  const sorted = [...rets].sort((a, b) => a - b);
  return { n, mean: rets.reduce((a, b) => a + b, 0) / n, median: quantileSorted(sorted, 0.5), pUp: rets.filter(v => v > 0).length / n,
    pDd5: dds.filter(v => v <= DRAWDOWN.primary).length / n, pDd10: dds.filter(v => v <= DRAWDOWN.deep).length / n };
}

function describe(part, values, outcome, h, groups, { key, replicates }) {
  const { ret, dd } = outcome, members = Array.from({ length: groups }, () => []);
  for (const t of part) members[values[t]].push(t);
  const baseline = summarize(part.map(t => ret[t]), part.map(t => dd[t]));
  const L = blockLength(h);
  let ci = null;
  if (part.length >= BOOTSTRAP.minBlocks * L) {
    const reps = blockBootstrap({ ys: [Float64Array.from(part, t => ret[t]), Float64Array.from(part, t => dd[t] <= DRAWDOWN.primary ? 1 : 0)],
      group: Int32Array.from(part, t => values[t]), groups, block: L, replicates, rng: mulberry32(fnv1a(key)) });
    ci = reps.map(stat => stat.map(interval));
  }
  return { n: part.length, start: part[0] ?? null, end: part.at(-1) ?? null, baseline,
    buckets: members.map((ts, g) => {
      const stats = summarize(ts.map(t => ret[t]), ts.map(t => dd[t]));
      return { ...stats, episodes: episodes(ts, h), diff: { mean: stats.n ? stats.mean - baseline.mean : null, dd5: stats.n ? stats.pDd5 - baseline.pDd5 : null }, ci: { mean: ci?.[0][g] ?? null, dd5: ci?.[1][g] ?? null } };
    }) };
}

const excludes = ci => !ci ? 0 : ci[0] > 0 ? 1 : ci[1] < 0 ? -1 : 0;
/** Pre-registered label of one statistic of one bucket from its full-sample and half-sample results. */
export function label({ full, h1, h2 }) {
  for (const part of [full, h1, h2]) if (!part || part.n < MIN_SESSIONS || part.episodes < MIN_EPISODES || !part.ci) return 'insufficient';
  const first = excludes(h1.ci);
  if (first !== 0 && first === excludes(h2.ci)) return 'robust';
  if (Math.sign(h1.est) * Math.sign(h2.est) < 0) return 'unstable';
  return 'weak';
}

export function evaluateIndicator(indicator, outcomes, { seed = BOOTSTRAP.seed, replicates = BOOTSTRAP.replicates, dates }) {
  const groups = indicator.buckets.length, windows = {};
  for (const h of WINDOWS) {
    const outcome = outcomes[h], sample = [];
    for (let t = 0; t < indicator.values.length; t++) if (indicator.values[t] !== null && outcome.ret[t] !== null && outcome.dd[t] !== null) sample.push(t);
    const half = Math.floor(sample.length / 2);
    const parts = Object.fromEntries(Object.entries({ full: sample, h1: sample.slice(0, half), h2: sample.slice(half) })
      .map(([name, part]) => [name, describe(part, indicator.values, outcome, h, groups, { key: `${seed}|${indicator.key}|${h}|${name}`, replicates })]));
    const stat = (g, which) => {
      const view = name => ({ n: parts[name].buckets[g].n, episodes: parts[name].buckets[g].episodes, est: parts[name].buckets[g].diff[which], ci: parts[name].buckets[g].ci[which] });
      const full = view('full'), h1 = view('h1'), h2 = view('h2');
      return { est: round(full.est), ci: full.ci?.map(v => round(v)) ?? null, h1: { est: round(h1.est), ci: h1.ci?.map(v => round(v)) ?? null }, h2: { est: round(h2.est), ci: h2.ci?.map(v => round(v)) ?? null }, label: label({ full, h1, h2 }) };
    };
    const day = index => index === null ? null : dates[index];
    windows[h] = {
      n: sample.length, start: day(parts.full.start), end: day(parts.full.end), split: day(parts.h2.start), block: blockLength(h),
      baseline: roundStats(parts.full.baseline), h1Baseline: roundStats(parts.h1.baseline), h2Baseline: roundStats(parts.h2.baseline),
      buckets: indicator.buckets.map((bucket, g) => { const b = parts.full.buckets[g];
        // meanReturn is the bucket's own forward-return mean; mean / dd5 carry the differences vs baseline.
        return { key: bucket.key, label: bucket.label, ...roundStats(b), episodes: b.episodes, h1n: parts.h1.buckets[g].n, h2n: parts.h2.buckets[g].n,
          firstHalfShare: b.n ? round(parts.h1.buckets[g].n / b.n, 4) : null, mean: stat(g, 'mean'), dd5: stat(g, 'dd5') }; }),
    };
  }
  return windows;
}
const roundStats = s => ({ n: s.n, meanReturn: round(s.mean), median: round(s.median), pUp: round(s.pUp, 4), pDd5: round(s.pDd5, 4), pDd10: round(s.pDd10, 4) });

// ---- indicators -------------------------------------------------------------------------------------------------
const make = (panel, key, label, rule, bucketLabels, values, outcome) => ({ panel, key, label, rule, outcome, buckets: bucketLabels.map(text => ({ key: text, label: text })), values });
const bin = flag => flag === null || flag === undefined ? null : flag ? 0 : 1;
const above = value => value === null || value === undefined ? null : value > 0;
const quad = state => state && state.vsMa !== null && state.vs200 !== null ? (state.vs200 > 0 ? (state.vsMa > 0 ? 0 : 1) : (state.vsMa > 0 ? 2 : 3)) : null;
const nearHigh = state => state && state.fromHigh !== null ? state.fromHigh >= -SPLIT_RULE.nearHighPercent : null;
const MA_QUADRANT = ['50日線・200日線の上 (above both)', '200日線の上・50日線の下 (above 200, below 50)', '200日線の下・50日線の上 (below 200, above 50)', '50日線・200日線の下 (below both)'];

function maIndicators(panel, prefix, name, ma, outcome) {
  return [
    make(panel, `${prefix}.ma50`, `${name} vs 50-day SMA (50日線)`, 'indexSummary vsMa > 0', ['50日線の上 (above)', '50日線以下 (at/below)'], ma.map(s => bin(above(s?.vsMa ?? null))), outcome),
    make(panel, `${prefix}.ma200`, `${name} vs 200-day SMA (200日線)`, 'indexSummary vs200 > 0', ['200日線の上 (above)', '200日線以下 (at/below)'], ma.map(s => bin(above(s?.vs200 ?? null))), outcome),
    make(panel, `${prefix}.ma.quadrant`, `${name} 50/200-day position`, 'indexSummary vsMa, vs200', MA_QUADRANT, ma.map(quad), outcome),
    make(panel, `${prefix}.high.near`, `${name} within ${SPLIT_RULE.nearHighPercent}% of the 252-session closing high`, 'indexSummary fromHigh >= -SPLIT_RULE.nearHighPercent (full year required)', [`1年高値から${SPLIT_RULE.nearHighPercent}%以内 (near high)`, `${SPLIT_RULE.nearHighPercent}%超の下 (further below)`], ma.map(s => bin(nearHigh(s))), outcome),
  ];
}

export function indexIndicators(states) {
  const { symbol, dd, ftd, ma } = states, panel = `index:${symbol}`, name = symbol === '^GSPC' ? 'S&P 500' : 'Nasdaq Composite', ja = symbol === '^GSPC' ? 'S&P' : 'NAS', outcome = `${symbol} (index OHLCV)`;
  const ddWarn = dd.map(value => value === null ? null : value >= DISTRIBUTION_WARN);
  const grade = value => value === null ? null : DD_GRADES.findIndex(([low, high]) => value >= low && value <= high);
  const states7 = FTD_BUCKETS.map(([state]) => state);
  return [
    make(panel, `${symbol}.dd.binary`, `${ja}の分配日 ≥ ${DISTRIBUTION_WARN} (distribution days)`, `${DISTRIBUTION_METHOD}; market tab warning at >= DISTRIBUTION_WARN`, [`${DISTRIBUTION_WARN}日以上 (warning)`, `${DISTRIBUTION_WARN - 1}日以下`], ddWarn.map(bin), outcome),
    make(panel, `${symbol}.dd.graded`, `${ja}の分配日 graded`, DISTRIBUTION_METHOD, DD_GRADES.map(([low, high]) => high === Infinity ? `${low}+` : `${low}-${high}`), dd.map(grade), outcome),
    make(panel, `${symbol}.ftd.state`, `${ja}のFTD state`, `${FOLLOW_THROUGH_METHOD} on the trailing ${FTD_WINDOW_SESSIONS} sessions`, FTD_BUCKETS.map(([, text]) => text), ftd.map(value => value ? states7.indexOf(value.state) : null).map(i => i === -1 ? null : i), outcome),
    ...maIndicators(panel, symbol, name, ma, outcome),
    make(panel, `${symbol}.combo.dd_ma50`, `${ja}: distribution days x 50-day line`, `dd >= ${DISTRIBUTION_WARN} crossed with close vs 50-day SMA`, [`分配日${DISTRIBUTION_WARN}+・50日線以下`, `分配日${DISTRIBUTION_WARN}+・50日線の上`, `分配日${DISTRIBUTION_WARN - 1}以下・50日線以下`, `分配日${DISTRIBUTION_WARN - 1}以下・50日線の上`],
      ddWarn.map((warn, t) => { const a = above(ma[t]?.vsMa ?? null); return warn === null || a === null ? null : (warn ? 0 : 2) + (a ? 1 : 0); }), outcome),
    make(panel, `${symbol}.combo.ftd_recent`, `${ja}: FTD confirmed within ${FTD_RECENT_SESSIONS} sessions`, `state confirmed and ftd.sessionsSince <= ${FTD_RECENT_SESSIONS}`, [`FTD確認から${FTD_RECENT_SESSIONS}日以内`, 'それ以外 (any other judged state)'],
      ftd.map(value => value ? bin(value.state === 'confirmed' && Number.isSafeInteger(value.sessionsSince) && value.sessionsSince <= FTD_RECENT_SESSIONS) : null), outcome),
  ];
}

export function breadthIndicators(states, indexByDate = {}) {
  const panel = 'breadth', outcome = '^GSPC (long-history sp500 closes)', { ma, split, lows, rules, fields, dates } = states;
  // Why a rule is never judged: name the capture's absent inputs instead of a generic reason.
  const absent = keys => keys.filter(key => !states.rows.some(row => finite(row[key])));
  const needs = (indicator, keys, extra = null) => { const missing = absent(keys); if (missing.length || extra) indicator.unavailableReason = [missing.length ? `needs ${missing.join(', ')}, absent from this capture (older schema)` : null, extra].filter(Boolean).join('; '); return indicator; };
  const list = [
    ...maIndicators(panel, 'spx', 'S&P 500 (long history)', ma, outcome),
    needs(make(panel, 'rule.split', '指数と個別株の乖離 (bifurcation)', `bifurcation(): index within ${SPLIT_RULE.nearHighPercent}% of its 252-session closing high and above200Percent < ${SPLIT_RULE.above200Below}`, ['注意サイン (warning)', 'なし'], split.map(bin), outcome), ['above200Percent']),
    make(panel, 'rule.lows', '新安値 > 新高値 (new lows outnumber new highs)', 'newLows > newHighs', ['注意サイン (warning)', 'なし'], lows.map(bin), outcome),
    needs(make(panel, 'rule.template', 'TT達成数の急減 (trend-template drop)', `environmentRules template: ${ENV_RULES.templateSessions}-session drop >= ${ENV_RULES.templateDropPercent}% from a base >= ${ENV_RULES.templateMinBase}`, ['注意サイン (warning)', 'なし'], rules.template.map(bin), outcome), ['trendTemplateCount']),
    needs(make(panel, 'rule.stage', 'ステージ構成 (stage 4 % > stage 2 %)', 'environmentRules stage', ['注意サイン (warning)', 'なし'], rules.stage.map(bin), outcome), ['stage2Percent', 'stage4Percent']),
    needs(make(panel, 'rule.leaders', 'リーダーの健全度 (leader health)', `environmentRules leaders: < ${ENV_RULES.leaderHealthBelow}%`, ['注意サイン (warning)', 'なし'], rules.leaders.map(bin), outcome), ['leaderHealthPercent']),
    needs(make(panel, 'rule.breakout', 'ブレイクアウト成功率 (breakout hold rate)', `environmentRules breakout: < ${ENV_RULES.breakoutHoldBelow}%`, ['注意サイン (warning)', 'なし'], rules.breakout.map(bin), outcome), ['breakoutHoldPercent']),
  ];
  const checks = dates.map((day, t) => {
    const at = symbol => indexByDate[symbol]?.get(day);
    const parts = [...['^GSPC', '^IXIC'].map(symbol => { const v = at(symbol)?.dd; return v === null || v === undefined ? null : v >= DISTRIBUTION_WARN; }),
      ...['^GSPC', '^IXIC'].map(symbol => { const v = at(symbol)?.ftd; return v ? v.state === 'ftd_failed' : null; }),
      split[t], lows[t], rules.template[t], rules.stage[t], rules.leaders[t], rules.breakout[t]];
    return parts.some(value => value === null || value === undefined) ? null : Math.min(3, parts.filter(Boolean).length);
  });
  list.push(needs(make(panel, 'rule.count', '注意サインの数 (fired warning-summary checks)', 'dist S&P, dist NAS, FTD failed S&P, FTD failed NAS, split, lows, template, stage, leaders, breakout; all ten judged', ['0', '1', '2', '3+'], checks, outcome),
    ['above200Percent', 'trendTemplateCount', 'stage2Percent', 'stage4Percent', 'leaderHealthPercent', 'breakoutHoldPercent'],
    ['^GSPC', '^IXIC'].every(symbol => [...(indexByDate[symbol]?.values() || [])].some(value => value.ftd)) ? null : 'needs the distribution count and FTD state of both indices on the same session (a 280-session index window)'));
  list.push(make(panel, 'combo.lows_below200', '新安値 > 新高値 and S&P 500 at/below its 200-day', 'rule.lows fired and indexSummary vs200 <= 0', ['両方 (both)', 'それ以外 (otherwise)'],
    lows.map((fired, t) => { const a = above(ma[t]?.vs200 ?? null); return fired === null || a === null ? null : bin(fired && !a); }), outcome));
  const fieldIndicators = [];
  let a50Edges = null;
  for (const [key, text] of BREADTH_FIELDS) {
    for (const [prefix, values, suffix] of [['q', fields[key], ''], ['d21', change(fields[key]), ` ${CHANGE_SESSIONS}-session change`]]) {
      const edges = quintileEdges(values);
      if (prefix === 'q' && key === 'above50Percent') a50Edges = edges;
      const indicator = needs(make(panel, `${prefix}.${key}`, `${text}${suffix}`, edges ? `fixed in-sample quintiles; edges ${edges.map(e => round(e, 3)).join(' / ')}` : 'fewer than 5 known values',
        edges ? ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((q, k) => `${q} ${k === 0 ? `≤ ${fmtEdge(edges[0])}` : k === 4 ? `> ${fmtEdge(edges[3])}` : `${fmtEdge(edges[k - 1])}–${fmtEdge(edges[k])}`}`) : ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
        values.map(value => quintileBucket(value, edges)), outcome), BREADTH_INPUTS[key]);
      indicator.edges = edges?.map(e => round(e)) ?? null;
      fieldIndicators.push(indicator);
    }
  }
  list.push(make(panel, 'combo.washout_uptrend', '50日線より上の割合がQ1 and S&P 500 above its 200-day', 'q.above50Percent bucket Q1 and indexSummary vs200 > 0', ['両方 (both)', 'それ以外 (otherwise)'],
    fields.above50Percent.map((value, t) => { const q = quintileBucket(value, a50Edges), a = above(ma[t]?.vs200 ?? null); return q === null || a === null ? null : bin(q === 0 && a); }), outcome));
  return [...list, ...fieldIndicators];
}
const BREADTH_INPUTS = { above50Percent: ['above50Percent'], above150Percent: ['above150Percent'], above200Percent: ['above200Percent'], trendTemplatePercent: ['trendTemplatePercent'],
  netHighsPercent: ['newHighs', 'newLows'], ratio_10day: ['ratio_10day'], leaderPercent: ['leaderCount'], leaderHealthPercent: ['leaderHealthPercent'], breakoutHoldPercent: ['breakoutHoldPercent'], stageSpread: ['stage2Percent', 'stage4Percent'] };
const fmtEdge = value => Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);

// ---- diagnostics ------------------------------------------------------------------------------------------------
function solve3(a, b) {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return m.map((row, i) => row[3] / row[i]);
}

export function survivorship(history, states) {
  const years = new Map(), rows = history.breadth;
  const sample = [];
  rows.forEach((row, t) => {
    const year = row.date.slice(0, 4), entry = years.get(year) || { sessions: 0, eligible: 0, covered: 0 };
    entry.sessions++; entry.eligible += row.eligibleUniverse / row.universe; entry.covered += row.coverage / row.universe; years.set(year, entry);
    const y = num(row.above50Percent), s = states.ma[t];
    if (y !== null && s && s.vsMa !== null && s.vs200 !== null) sample.push({ t, year, y, x1: s.vsMa, x2: s.vs200 });
  });
  let fit = null;
  if (sample.length >= 30) {
    const xtx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], xty = [0, 0, 0];
    for (const p of sample) { const x = [1, p.x1, p.x2]; for (let i = 0; i < 3; i++) { xty[i] += x[i] * p.y; for (let j = 0; j < 3; j++) xtx[i][j] += x[i] * x[j]; } }
    const beta = solve3(xtx, xty);
    if (beta) {
      const residual = p => p.y - (beta[0] + beta[1] * p.x1 + beta[2] * p.x2);
      const mean = list => list.length ? list.reduce((a, p) => a + residual(p), 0) / list.length : null;
      const ybar = sample.reduce((a, p) => a + p.y, 0) / sample.length;
      const ssTot = sample.reduce((a, p) => a + (p.y - ybar) ** 2, 0), ssRes = sample.reduce((a, p) => a + residual(p) ** 2, 0);
      const half = Math.floor(sample.length / 2);
      fit = { n: sample.length, intercept: round(beta[0], 4), vs50: round(beta[1], 4), vs200: round(beta[2], 4), r2: round(1 - ssRes / ssTot, 4),
        firstHalf: { from: rows[sample[0].t].date, to: rows[sample[half - 1].t].date, meanResidual: round(mean(sample.slice(0, half)), 3) },
        secondHalf: { from: rows[sample[half].t].date, to: rows[sample.at(-1).t].date, meanResidual: round(mean(sample.slice(half)), 3) },
        byYear: [...years.keys()].map(year => ({ year, meanResidual: round(mean(sample.filter(p => p.year === year)), 3) })) };
    }
  }
  return { basis: history.universe?.basis ?? null, historicalMembershipVerified: history.universe?.historical_membership_verified ?? null,
    universe: history.universe?.symbols?.length ?? null,
    byYear: [...years.entries()].map(([year, v]) => ({ year, sessions: v.sessions, eligibleShare: round(v.eligible / v.sessions, 4), coverageShare: round(v.covered / v.sessions, 4) })),
    above50Residual: fit };
}

// ---- the study --------------------------------------------------------------------------------------------------
export function runStudy({ history = null, historyMeta = {}, indices = null, calendar = null, asOfDate = null, seed = BOOTSTRAP.seed, replicates = BOOTSTRAP.replicates, label: runLabel = null }) {
  const results = [], inputs = { history: null, indices: [] }, notes = [];
  const indexByDate = {};
  for (const item of indices?.indices || []) {
    const ownCalendar = calendar || item.calendar_sessions || null;
    const aligned = alignIndex({ symbol: item.symbol, bars: item.bars, calendar: ownCalendar, asOfDate });
    const states = indexStates(aligned), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(states.closes, h)]));
    const valid = aligned.bars.filter(validBar).length;
    inputs.indices.push({ symbol: item.symbol, source: item.source ?? null, provenance: item.provenance ?? null, calendarBasis: aligned.calendarBasis,
      first: aligned.dates[0] ?? null, last: aligned.dates.at(-1) ?? null, lastBar: aligned.bars.filter(Boolean).at(-1)?.date ?? null, sessions: aligned.dates.length,
      validBars: valid, invalidBars: aligned.bars.filter(bar => bar && !validBar(bar)).length, missingSessions: aligned.missing.length, offCalendarBars: aligned.extra.length,
      validRuns: runs(aligned.bars.map(validBar)).length, missingSample: aligned.missing.slice(0, 10), offCalendarSample: aligned.extra.slice(0, 10) });
    if (aligned.calendarBasis === 'provider') notes.push(`${item.symbol}: no independent calendar; the provider's dates are the sessions (a session the provider omits cannot be detected).`);
    indexByDate[item.symbol] = new Map(aligned.dates.map((day, t) => [day, { dd: states.dd[t], ftd: states.ftd[t] }]));
    for (const indicator of indexIndicators(states)) results.push(finish(indicator, outcomes, aligned.dates, { seed, replicates }));
  }
  let diagnostics = null;
  if (history) {
    const states = breadthStates(history), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(states.closes, h)]));
    const present = BREADTH_FIELDS.filter(([key]) => states.fields[key].some(finite)).map(([key]) => key);
    inputs.history = { as_of_date: history.as_of_date, retrieved_at: history.retrieved_at, sha256: historyMeta.sha256 ?? null, origin: historyMeta.origin ?? null,
      first: states.dates[0] ?? null, last: states.dates.at(-1) ?? null, sessions: states.dates.length, sp500Closes: states.closes.filter(positive).length,
      universe: history.universe.symbols.length, basis: history.universe.basis, historicalMembershipVerified: history.universe.historical_membership_verified,
      fieldsPresent: present, fieldsAbsent: BREADTH_FIELDS.map(([key]) => key).filter(key => !present.includes(key)) };
    if (inputs.history.fieldsAbsent.length) notes.push(`Long history lacks ${inputs.history.fieldsAbsent.join(', ')} (older schema): those indicators and every rule that needs them are unjudged, never 0.`);
    const gspc = indexByDate['^GSPC'];
    if (gspc) {
      const closeByDate = new Map((indices.indices.find(item => item.symbol === '^GSPC')?.bars || []).map(bar => [bar.date, bar.close]));
      let compared = 0, worst = 0;
      states.dates.forEach((day, t) => { const a = states.closes[t], b = closeByDate.get(day); if (positive(a) && positive(b)) { compared++; worst = Math.max(worst, Math.abs(a / b - 1)); } });
      inputs.history.sp500VsIndexSource = { compared, maxRelativeDifference: round(worst, 8) };
    }
    for (const indicator of breadthIndicators(states, indexByDate)) results.push(finish(indicator, outcomes, states.dates, { seed, replicates }));
    diagnostics = survivorship(history, states);
  }
  const tested = results.filter(r => r.available);
  const tally = { robust: 0, weak: 0, unstable: 0, insufficient: 0 };
  let tests = 0;
  for (const r of tested) for (const h of WINDOWS) for (const bucket of r.windows[h].buckets) for (const stat of ['mean', 'dd5']) { tests++; tally[bucket[stat].label]++; }
  let excludesFull = 0, withCi = 0;
  for (const r of tested) for (const h of WINDOWS) for (const bucket of r.windows[h].buckets) for (const stat of ['mean', 'dd5']) if (bucket[stat].ci) { withCi++; if (excludes(bucket[stat].ci) !== 0) excludesFull++; }
  return { schema_version: STUDY_VERSION, label: runLabel, generated_at: new Date().toISOString(), as_of_date: asOfDate,
    method: { windows: WINDOWS, drawdownLevels: [DRAWDOWN.primary, DRAWDOWN.deep], quintiles: QUANTILES, changeSessions: CHANGE_SESSIONS, ftdWindowSessions: FTD_WINDOW_SESSIONS,
      bootstrap: { ...BOOTSTRAP, seed, replicates, block: 'max(2h, 21)' }, minSessions: MIN_SESSIONS, minEpisodes: MIN_EPISODES,
      appRules: { DISTRIBUTION_WARN, DISTRIBUTION_METHOD, FOLLOW_THROUGH_METHOD, SPLIT_RULE, ENV_RULES } },
    inputs, notes, survivorship: diagnostics,
    tests: { indicators: results.length, available: tested.length, buckets: tested.reduce((a, r) => a + r.buckets.length, 0), tests, fullSampleCi: withCi, fullSampleCiExcludesZero: excludesFull, labels: tally },
    indicators: results };
}

function finish(indicator, outcomes, dates, options) {
  const judged = indicator.values.filter(value => value !== null).length;
  const base = { panel: indicator.panel, key: indicator.key, label: indicator.label, rule: indicator.rule, outcome: indicator.outcome, edges: indicator.edges ?? null,
    buckets: indicator.buckets, judged, available: judged > 0 };
  if (!judged) return { ...base, reason: indicator.unavailableReason || 'no judged session (the input is too short for the rule)', windows: null };
  return { ...base, firstJudged: dates[indicator.values.findIndex(value => value !== null)], lastJudged: dates[indicator.values.findLastIndex(value => value !== null)],
    windows: evaluateIndicator(indicator, outcomes, { ...options, dates }) };
}

// ---- markdown ----------------------------------------------------------------------------------------------------
const pct = (value, digits = 2) => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(100 * value).toFixed(digits)}%` : '—';
const pp = (value, digits = 2) => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(100 * value).toFixed(digits)}` : '—';
const prob = value => finite(value) ? `${(100 * value).toFixed(0)}%` : '—';
const ciText = (stat, digits = 2) => stat.est === null ? '—' : `${pp(stat.est, digits)} [${stat.ci ? `${pp(stat.ci[0], digits)}, ${pp(stat.ci[1], digits)}` : 'n/a'}]`;
const TAG = { robust: '**robust**', weak: 'weak', unstable: 'unstable', insufficient: 'insufficient' };
const signedTerm = value => `${value < 0 ? '−' : '+'} ${Math.abs(value)}`;
const cell = text => String(text).replace(/\|/g, '\\|');

export function markdownReport(study) {
  const lines = [], add = (...rows) => lines.push(...rows);
  add(`# Market-regime study${study.label ? ` — ${study.label}` : ''}`, '',
    `${STUDY_VERSION} (pre-registered in frontend/tools/market-regime-study.mjs) · as of ${study.as_of_date ?? 'n/a'} · seed ${study.method.bootstrap.seed} · ${study.method.bootstrap.replicates} circular block-bootstrap replicates (block max(2h,21)) · 90% CI`, '',
    'Diagnostic research only: nothing here changes a rule, threshold, verdict or published value. Returns are forward index returns from the close of the session the state was observed (strictly causal). Δ columns are differences from the unconditional baseline of the same sample, in percentage points.', '');
  add('## Inputs', '', '| input | basis | first | last | sessions | notes |', '|---|---|---|---|---|---|');
  const h = study.inputs.history;
  if (h) add(`| long history (as of ${h.as_of_date}) | ${h.basis}; historical membership verified: ${h.historicalMembershipVerified} | ${h.first} | ${h.last} | ${h.sessions} | universe ${h.universe}; sha256 ${String(h.sha256).slice(0, 12)}; ${h.fieldsAbsent.length ? `absent: ${h.fieldsAbsent.join(', ')}` : 'all study fields present'}${h.sp500VsIndexSource ? `; sp500 vs index source max diff ${(100 * h.sp500VsIndexSource.maxRelativeDifference).toFixed(4)}% over ${h.sp500VsIndexSource.compared}` : ''} |`);
  for (const i of study.inputs.indices) add(`| ${i.symbol} OHLCV | ${i.source ?? 'n/a'}; calendar ${i.calendarBasis} | ${i.first} | ${i.last} | ${i.sessions} | valid bars ${i.validBars}, invalid ${i.invalidBars}, missing sessions ${i.missingSessions}, off-calendar ${i.offCalendarBars}, valid runs ${i.validRuns}; last bar ${i.lastBar} |`);
  add('');
  for (const note of study.notes) add(`- ${note}`);
  if (h) add('- The long history is a CURRENT-UNIVERSE RETROSPECTIVE: stocks delisted before the capture are missing, so early breadth tends to read healthier than it was. Read breadth effects with the survivorship section and the split-sample labels.');
  add('', '## Tests and labels', '',
    `${study.tests.available} of ${study.tests.indicators} indicators had judged sessions; ${study.tests.buckets} buckets × ${WINDOWS.length} windows × 2 statistics = **${study.tests.tests} tests**. ${study.tests.fullSampleCi} have a full-sample 90% CI; ${study.tests.fullSampleCiExcludesZero} of them exclude 0 (about ${Math.round(study.tests.fullSampleCi * 0.1)} expected by chance alone).`,
    `Labels: robust ${study.tests.labels.robust} · weak ${study.tests.labels.weak} · unstable ${study.tests.labels.unstable} · insufficient ${study.tests.labels.insufficient}. "robust" = both halves' CIs exclude 0 with the same sign; it is not adjusted for the number of tests.`, '');
  add('## Robust effects (both halves agree)', '', '| indicator | bucket | h | n | episodes | mean | baseline | Δmean [90% CI] | P(DD≤−5%) | ΔP(DD≤−5%) [90% CI] | which |', '|---|---|---|---|---|---|---|---|---|---|---|');
  let robust = 0;
  for (const r of study.indicators) if (r.available) for (const w of WINDOWS) for (const b of r.windows[w].buckets) {
    const which = ['mean', 'dd5'].filter(stat => b[stat].label === 'robust');
    if (!which.length) continue;
    robust++;
    add(`| ${cell(r.label)} \`${r.key}\` | ${cell(b.label)} | ${w} | ${b.n} | ${b.episodes} | ${pct(b.meanReturn)} | ${pct(r.windows[w].baseline.meanReturn)} | ${ciText(b.mean)} | ${prob(b.pDd5)} | ${ciText(b.dd5, 1)} | ${which.join(', ')} |`);
  }
  if (!robust) add('| none | | | | | | | | | | |');
  const s = study.survivorship;
  if (s) {
    add('', '## Survivorship diagnostics (long history)', '', '| year | sessions | eligible / universe | coverage / universe | mean above50% residual |', '|---|---|---|---|---|');
    for (const y of s.byYear) add(`| ${y.year} | ${y.sessions} | ${prob(y.eligibleShare)} | ${prob(y.coverageShare)} | ${s.above50Residual?.byYear.find(r => r.year === y.year)?.meanResidual ?? '—'} |`);
    if (s.above50Residual) add('', `OLS above50Percent = ${s.above50Residual.intercept} ${signedTerm(s.above50Residual.vs50)}·(^GSPC % vs 50-day) ${signedTerm(s.above50Residual.vs200)}·(% vs 200-day), R² ${s.above50Residual.r2}, n ${s.above50Residual.n}. Mean residual first half (${s.above50Residual.firstHalf.from}–${s.above50Residual.firstHalf.to}) ${s.above50Residual.firstHalf.meanResidual} pt, second half (${s.above50Residual.secondHalf.from}–${s.above50Residual.secondHalf.to}) ${s.above50Residual.secondHalf.meanResidual} pt. A positive early residual is consistent with survivorship inflation (or a genuinely broader market then); this cannot separate the two.`);
  }
  add('', '## All indicators', '');
  for (const r of study.indicators) {
    add(`### ${r.label} — \`${r.key}\``, '', `${r.rule}. Outcome: ${r.outcome}.${r.available ? ` Judged ${r.judged} sessions (${r.firstJudged} to ${r.lastJudged}).` : ''}`, '');
    if (!r.available) { add(`Unavailable: ${r.reason}.`, ''); continue; }
    add('| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [90% CI] | label | ΔP(DD≤−5%) [90% CI] | label |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const w of WINDOWS) {
      const win = r.windows[w], base = win.baseline;
      if (!win.n) { add(`| (no session with a complete ${w}-session forward window) | ${w} | 0 | | | | | | | | | | | |`); continue; }
      add(`| baseline | ${w} | ${win.n} | | split ${win.split ?? '—'} | ${pct(base.meanReturn)} | ${pct(base.median)} | ${prob(base.pUp)} | ${prob(base.pDd5)} | ${prob(base.pDd10)} | | | | |`);
      for (const b of win.buckets) add(`| ${cell(b.label)} | ${w} | ${b.n} | ${b.episodes} | ${prob(b.firstHalfShare)} | ${pct(b.meanReturn)} | ${pct(b.median)} | ${prob(b.pUp)} | ${prob(b.pDd5)} | ${prob(b.pDd10)} | ${ciText(b.mean)} | ${TAG[b.mean.label]} | ${ciText(b.dd5, 1)} | ${TAG[b.dd5.label]} |`);
    }
    add('');
  }
  return `${lines.join('\n')}\n`;
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    history: { type: 'string' }, indices: { type: 'string' }, yahoo: { type: 'boolean' }, calendar: { type: 'string' }, 'save-indices': { type: 'string' },
    'as-of': { type: 'string' }, out: { type: 'string' }, markdown: { type: 'string' }, seed: { type: 'string' }, replicates: { type: 'string' }, label: { type: 'string' } } });
  if (!values.history && !values.indices && !values.yahoo) throw Error('Usage: market-regime-study.mjs --history <static-data dir|manifest|series|capture|url> [--indices <file> | --yahoo] [--calendar <file>] [--save-indices <file>] [--as-of YYYY-MM-DD] --out <json> --markdown <md>');
  if (values.yahoo && values.indices) throw Error('Choose --indices or --yahoo');
  const loaded = values.history ? await loadHistory(values.history) : null;
  const asOfDate = values['as-of'] || loaded?.publicationDate || loaded?.history.as_of_date || null;
  if (asOfDate !== null && !isDay(asOfDate)) throw Error('Invalid --as-of');
  let indices = null;
  if (values.yahoo) {
    if (!asOfDate) throw Error('--yahoo needs --as-of or a history');
    indices = await fetchYahooIndices({ asOfDate });
    if (values['save-indices']) { await mkdir(dirname(resolve(values['save-indices'])), { recursive: true }); await writeFile(values['save-indices'], `${JSON.stringify(indices)}\n`); }
  } else if (values.indices) indices = await loadIndices(values.indices);
  let calendar = null;
  if (values.calendar) { const value = JSON.parse(await readFile(values.calendar)); calendar = checkCalendar(Array.isArray(value) ? value : value.sessions); }
  const seed = values.seed === undefined ? BOOTSTRAP.seed : Number(values.seed), replicates = values.replicates === undefined ? BOOTSTRAP.replicates : Number(values.replicates);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(replicates) || replicates < 100) throw Error('Invalid --seed or --replicates');
  const study = runStudy({ history: loaded?.history ?? null, historyMeta: loaded ?? {}, indices, calendar, asOfDate, seed, replicates, label: values.label ?? null });
  const markdown = markdownReport(study);
  for (const [path, body] of [[values.out, `${JSON.stringify(study)}\n`], [values.markdown, markdown]]) if (path) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, body); }
  console.log(JSON.stringify({ schema_version: STUDY_VERSION, as_of_date: asOfDate, indicators: study.tests.indicators, available: study.tests.available, tests: study.tests.tests, labels: study.tests.labels }));
  return study;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
