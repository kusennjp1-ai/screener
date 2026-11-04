#!/usr/bin/env node
/**
 * Market-regime study: diagnostic research only. It changes no rule, threshold, verdict or published value.
 *
 * Owner question (2026-11-04): 市場環境については実際に過去のデータからどの指標がどういう状態にあるときに
 * 株価が下がりやすい、または上がりやすいか — from real history, in which states of which market-environment
 * indicators did the index tend to fall or rise afterwards?
 *
 * ============================================================================================================
 * PRE-REGISTERED PLAN  market-regime-study-v2
 * v1 was fixed before any real-data run; v2 revises it before any CI real-data run, for the methodological reasons
 * under DEVIATIONS FROM v1. Changing any item below needs a new STUDY_VERSION and is reported as a deviation; no
 * threshold, bucket edge, window or test is chosen after looking at results.
 * ============================================================================================================
 *
 * DATA
 *  H  Long history (market-long-history-v1, frontend/tools/collect-market-history.py), validated with the
 *     app's validateLongHistory and read through environmentPoint. Outcome series: H.sp500 (^GSPC closes of
 *     the same capture). It is a CURRENT-UNIVERSE RETROSPECTIVE (historical_membership_verified = false):
 *     names delisted before the capture are absent, so early breadth is expected to read healthier than it
 *     was (survivorship). Checked by the diagnostics below; no correction is applied. A moving-average or
 *     bifurcation state uses only the run of known closes ending at its session, never bridging an unknown one.
 *  I  ^GSPC and ^IXIC daily OHLCV: Yahoo chart API (CI only, 1 request/s, generic UA, since 1990-01-01) or a
 *     market-trend-source-v1 file. Each bar is checked like distributionDays (every OHLCV value positive,
 *     high/low consistent). With an independent calendar (--calendar, or the file's calendar_sessions) a
 *     missing session is an unknown bar and a bar off the calendar is excluded; without one the provider's
 *     dates are used and the report says so. Bars after the as-of date are dropped. An unknown bar is never
 *     filled: a DD / FTD / moving-average window that would contain it is unjudged.
 *  Plausibility (H.sp500 and I): a close more than 25% (IMPLAUSIBLE_MOVE) from the previous session's close is
 *  unknown, as collect-market-history.py treats a stock's extreme move; a single bad print therefore makes two
 *  sessions unknown. No daily close move of either index since 1990 has come near 25%. Flagged sessions are
 *  listed in the inputs table.
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
 *   combo.washout_uptrend   above50Percent in its causal Q1 AND ^GSPC close above its 200-day SMA, vs otherwise
 *   q.<field>, d21.<field>  causal quintiles of each continuous field and of its 21-session change
 *                    (value_t - value_{t-21}): above50Percent, above150Percent, above200Percent,
 *                    trendTemplatePercent, netHighsPercent = 100 (newHighs - newLows) / coverage, ratio_10day,
 *                    leaderPercent = 100 leaderCount / coverage, leaderHealthPercent, breakoutHoldPercent,
 *                    stageSpread = stage2Percent - stage4Percent.
 *                    Edges at session t: the 20/40/60/80th percentiles (linear interpolation) of every known
 *                    value strictly before t, judged once 252 values are known (EDGE_WARMUP); a value equal to
 *                    an edge falls in the lower bucket. No later value enters a bucket, so both halves are out of
 *                    sample. The edges drift with the history and are descriptive, not a trading rule.
 *
 * STATISTICS per (indicator, h)
 *  Evaluation sample: sessions where the indicator is judged and r_h and dd_h are known. Baseline: the same
 *  sample, unconditionally. Reported: n, episodes (in-bucket sessions more than h sessions apart start a new
 *  episode), mean, median, P(r_h > 0), P(dd_h <= -5%), P(dd_h <= -10%).
 *  Tests D, each for mean r_h (primary) and P(dd_h <= -5%) (secondary, the "falls" question): with three or more
 *  buckets, each bucket minus the baseline; with two, one contrast, the first bucket minus the second (both buckets
 *  against the baseline are the same comparison, so it is tested and counted once).
 *  Split-sample: the first half of the evaluation sample by session count, and the rest after an embargo (a
 *  second-half session must lie more than h sessions after the last first-half one, so no first-half outcome
 *  window reaches a second-half close); each half has its own baseline.
 *  Rotation placebo (calibration against the data's own dependence). Shift k rotates every indicator series of a
 *  panel (index:^GSPC, index:^IXIC, breadth) against the panel's fixed outcomes, state_t <- state_((t + k) mod n):
 *  both series keep their own autocorrelation and volatility clustering while the alignment is broken, and one k
 *  for all of a panel's indicators keeps the dependence between tests. Grid: min(399, available) integer shifts
 *  evenly spaced in [M + 1, n - 1], M = 280 + 63 = 343 (the longest lookback, the FTD window, plus the longest
 *  window). A shift in 1..M is left out: it would pair the outcome from close t with a state computed inside that
 *  outcome window (look-ahead). A shift k in [n - M, n - 1] pairs it with a state from n - k sessions before t
 *  (no shared input); by stationarity it relates to the actual alignment as the left-out shift n - k would, so it
 *  stands in for that shift too (weight 2). Sample, halves and D are recomputed per shift; a shift counts when its
 *  rotated full sample meets the sufficiency rule below (K' shifts, total weight W). Two-sided placebo
 *  p = min(1, 2 min(1 + W(D_k >= D), 1 + W(D_k <= D)) / (1 + W)); placebo band = weighted 5th / 95th percentiles.
 *  Sufficiency, in the full sample and in each half: the bucket has n >= 20 and >= 3 episodes, and the part has
 *  at least 10 L sessions (L = max(2h, 21), i.e. 10 blocks: h = 63 needs 1,260 sessions in each half).
 *  Label (per statistic): insufficient = a part fails sufficiency or K' < 99; robust = placebo p <= 0.05 and both
 *  halves' D have the full-sample sign; unstable = the halves' D have opposite signs; weak = otherwise. Report
 *  "weak" and "unstable" together as weak/unstable.
 *  Chance level: the whole labelling is rerun on every grid shift more than M from 0 on both sides, with the
 *  actual's geometry (that shift and its own look-ahead zone left out, its past side standing in for the zone, the
 *  actual series in the reference). The report gives the null median and 95th percentile of the number of robust
 *  labels, and of robust groups, next to the actual counts. Labels group when their indicators share an input
 *  series (one rule on ^GSPC, ^IXIC and the long-history S&P shares one; every window starts at the same close, so
 *  horizons overlap); the report also states the indicator-level test count (indicator x h x statistic). Robust
 *  labels are read as evidence only when their count exceeds the null 95th percentile; otherwise the report calls
 *  them consistent with chance.
 *
 * SURVIVORSHIP DIAGNOSTICS (H)
 *  1. eligibleUniverse / universe and coverage / universe by year.
 *  2. OLS of above50Percent on ^GSPC % vs its 50-day and 200-day SMA; mean residual by year and by half
 *     (positive early residuals are consistent with survivorship inflation, or a genuinely broader market).
 *  3. Per bucket, the share of its sessions in the first half (period concentration).
 *
 * DEVIATIONS FROM v1 (recorded 2026-11-04, before any CI real-data run; v1 and v2 numbers are not comparable)
 *  v1 ran once, locally, on the 2026-10-23 seed (old-schema 5-year long history, 280-session index source): 6
 *  labels passed its split rule and 91 of 586 full-sample CIs excluded 0. That output is kept as the review's
 *  archive. The changes below come from null simulations and method checks, not from any indicator's result.
 *  1. Inference. v1's circular block bootstrap (L = max(2h, 21), at least 4 blocks, percentiles 5 / 95)
 *     under-covers with persistent states and volatility clustering: on a GARCH(1,1) index (alpha 0.09, beta 0.90)
 *     with an independent indicator over 1,270 sessions, its full-sample 90% CIs excluded 0 in 12-29% of cases,
 *     and rotating the seed's breadth indicators against the real outcomes gave at least the seed's v1 "robust"
 *     count in a quarter of the shifts. v2 replaces the bootstrap CIs and their split rule by the rotation
 *     placebo, states the placebo chance level instead of "about 10% by chance", and raises the minimum span from
 *     4 to 10 blocks. The placebo design was settled on the same GARCH null only: leaving out M shifts on both
 *     sides of 0 (a first draft) let p <= 0.05 fire in 9-28% of judged tests on 1,270 sessions; with the past-side
 *     stand-ins it fired in 4.3-6.1% there (400 paths each of AR(1) quintiles and 20- and 60-session binary
 *     regimes) and in 3.1-4.6% on 9,200 sessions (60 paths), and the chance-level rerun labelled null shifts at
 *     least as often as the actual (5.2-6.0% robust against 4.0-5.3%).
 *  2. Look-ahead in the bucket edges. v1 fitted the q.* / d21.* quintile edges (and combo.washout_uptrend's Q1) on
 *     the whole sample, past and future, and its split check reused them: truncating the seed changed the past
 *     buckets of 9 series, and second-half buckets under first-half-only edges agreed with the full-sample ones on
 *     only 66-93% of sessions. v2 edges are causal (expanding window, values strictly before t, 252-value warm-up).
 *  3. Double counting. Both buckets of a two-bucket indicator were tested against the baseline, although the two
 *     differences are one contrast, (1 - c0/M)(m0 - m1) and -(c0/M)(m0 - m1): 128 of the seed's 912 tests, and none
 *     of its 72 CI pairs disagreed. v2 tests one contrast per two-state indicator, states the indicator-level test
 *     count and groups robust labels that share an input.
 *  4. Overlap between the halves. v1 split the sample with no gap, so the last h first-half outcomes used
 *     second-half closes (63 of the seed's 603 first-half sessions at h = 63). v2 embargoes h sessions.
 *  5. Implausible prints. v1 accepted any structurally valid bar, so one 10x print passed silently and moved the
 *     mean statistics. v2 makes a close more than 25% from the previous session's close unknown and lists it.
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

export const STUDY_VERSION = 'market-regime-study-v2';
export const WINDOWS = Object.freeze([5, 10, 21, 63]);
export const DRAWDOWN = Object.freeze({ primary: -0.05, deep: -0.10 });
export const QUANTILES = Object.freeze([0.2, 0.4, 0.6, 0.8]);
export const EDGE_WARMUP = 252;
export const CHANGE_SESSIONS = 21;
export const FTD_WINDOW_SESSIONS = 280;
export const FTD_RECENT_SESSIONS = 25;
export const DD_GRADES = Object.freeze([[0, 2], [3, 4], [5, 6], [7, Infinity]]);
export const IMPLAUSIBLE_MOVE = 0.25;
export const PLACEBO = Object.freeze({ shifts: 399, minShifts: 99, lookback: FTD_WINDOW_SESSIONS, alpha: 0.05, band: Object.freeze([0.05, 0.95]) });
export const MIN_SESSIONS = 20, MIN_EPISODES = 3, MIN_BLOCKS = 10;
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
    let bytes = null;
    try { bytes = await readLocation(join2(rootFromManifest, `market-trends/history-source-${shaRef}.json`)); }
    catch (error) { if (error?.code !== 'ENOENT' && !/HTTP 404/.test(String(error?.message))) throw error; }
    if (bytes === null) {
      // The hash-pinned series embeds the same capture; validate it as the browser reader does.
      const history = { ...series.long_history };
      delete history.source_sha256;
      validateLongHistory(history, entry.as_of_date, Infinity);
      if (sha256(JSON.stringify(history.universe.symbols)) !== history.universe.sha256) throw Error('Long-history universe hash mismatch');
      return { history, sha256: shaRef, origin: `${ref.path} long_history (raw source file absent)`, publicationDate: entry.as_of_date };
    }
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

/**
 * Sessions whose close is more than `limit` from the previous session's close (both known). Like the stock rule
 * in collect-market-history.py, the comparison uses the provider's previous close, so a single bad print flags
 * itself and the session after it.
 */
export function implausibleMoves(closes, limit = IMPLAUSIBLE_MOVE) {
  const flagged = [];
  for (let t = 1; t < closes.length; t++) if (positive(closes[t]) && positive(closes[t - 1]) && Math.abs(closes[t] / closes[t - 1] - 1) > limit) flagged.push(t);
  return flagged;
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
  // Start of the run of known closes ending at each position: a window never bridges an unknown close.
  const runStart = [];
  sp.forEach((point, i) => runStart.push(positive(point.close) ? (i && runStart[i - 1] !== null ? runStart[i - 1] : i) : null));
  const ma = [], split = [], lows = [], rules = { template: [], stage: [], leaders: [], breakout: [] };
  rows.forEach((row, t) => {
    const i = position.get(row.date), current = i !== undefined && positive(sp[i].close);
    const prefix = current ? sp.slice(runStart[i], i + 1) : null;
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
/**
 * Causal quintile buckets: at each session the edges are the quintiles of every known value strictly before it,
 * once at least `warmup` are known. Returns the buckets and the edges at the first judged session and after the last.
 */
export function causalQuintiles(values, warmup = EDGE_WARMUP) {
  const sorted = [], buckets = new Array(values.length).fill(null), need = Math.max(warmup, 5);
  let first = null, firstIndex = null;
  values.forEach((value, t) => {
    if (!finite(value)) return;
    if (sorted.length >= need) {
      const edges = QUANTILES.map(p => quantileSorted(sorted, p));
      buckets[t] = quintileBucket(value, edges);
      if (!first) { first = edges; firstIndex = t; }
    }
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= value) lo = mid + 1; else hi = mid; }
    sorted.splice(lo, 0, value);
  });
  return { buckets, first, firstIndex, last: first ? QUANTILES.map(p => quantileSorted(sorted, p)) : null };
}
export const change = (values, lag = CHANGE_SESSIONS) => values.map((value, t) => t >= lag && finite(value) && finite(values[t - lag]) ? value - values[t - lag] : null);
export function episodes(indices, h) {
  let total = 0;
  indices.forEach((index, i) => { if (i === 0 || index - indices[i - 1] > h) total++; });
  return total;
}

// ---- rotation placebo -------------------------------------------------------------------------------------------
/** M: the longest indicator lookback (the FTD window) plus the longest outcome window. */
export const placeboMargin = () => PLACEBO.lookback + Math.max(...WINDOWS);
/**
 * The placebo grid: min(count, available) integer shifts evenly spaced in [M + 1, n - 1]. A shift k in 1..M is
 * left out: it pairs the outcome from close t with a state computed from sessions inside that outcome window
 * (look-ahead). None when the panel is too short.
 */
export function placeboShifts(n, count = PLACEBO.shifts) {
  const lo = placeboMargin() + 1, hi = n - 1;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(count) || count < 1 || hi < lo) return [];
  const available = hi - lo + 1;
  if (available <= count) return Array.from({ length: available }, (_, j) => lo + j);
  if (count === 1) return [lo];
  return Array.from({ length: count }, (_, j) => lo + Math.round(j * (hi - lo) / (count - 1)));
}
/**
 * Weight of a grid shift. A shift k in [n - M, n - 1] pairs the outcome with a state from n - k sessions before t;
 * by stationarity it relates to the actual alignment as the left-out shift n - k would, so it also stands in for
 * that shift (weight 2). Without it the actual alignment's own neighbourhood would be missing on one side and the
 * test would be anti-conservative for persistent states.
 */
export const shiftWeight = (k, n) => k >= n - placeboMargin() ? 2 : 1;
/** Grid indices whose shift lies more than M from 0 on both sides: the shifts the chance level reruns the labelling on. */
export const nullShiftIndices = (shifts, n) => shifts.flatMap((k, j) => k < n - placeboMargin() ? [j] : []);
const lowerBound = (sorted, x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
const upperBound = (sorted, x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= x) lo = mid + 1; else hi = mid; } return lo; };
/** A weighted reference distribution: ascending values and cumulative weights. */
export function placeboReference(values, weights = values.map(() => 1)) {
  const order = values.map((_, i) => i).filter(i => finite(values[i]) && weights[i] > 0).sort((a, b) => values[a] - values[b]);
  const v = Float64Array.from(order, i => values[i]), cw = new Float64Array(order.length + 1);
  order.forEach((i, r) => { cw[r + 1] = cw[r] + weights[i]; });
  return { values: v, cumulative: cw, total: cw[order.length], count: order.length };
}
/**
 * Two-sided rank p of x against a weighted reference: min(1, 2 min(1 + W(>= x), 1 + W(<= x)) / (1 + W)). With
 * selfWeight, x is itself in the reference with that weight and is left out (a placebo shift against the others).
 */
export function placeboP(x, reference, selfWeight = 0) {
  const total = reference.total - selfWeight;
  if (!finite(x) || !(total >= 1)) return null;
  const ge = reference.total - reference.cumulative[lowerBound(reference.values, x)] - selfWeight, le = reference.cumulative[upperBound(reference.values, x)] - selfWeight;
  return Math.min(1, 2 * Math.min(1 + ge, 1 + le) / (1 + total));
}
/** Weighted quantile: the smallest reference value whose cumulative weight reaches q of the total. */
export function placeboQuantile(reference, q) {
  if (!reference.count) return null;
  const target = q * reference.total;
  let lo = 0, hi = reference.count - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (reference.cumulative[mid + 1] >= target) hi = mid; else lo = mid + 1; }
  return reference.values[lo];
}

// ---- evaluation -------------------------------------------------------------------------------------------------
export const STATS = Object.freeze(['mean', 'dd5']);
export const LABELS = Object.freeze(['insufficient', 'weak', 'unstable', 'robust']);
const ROBUST = LABELS.indexOf('robust');

function summarize(rets, dds) {
  const n = rets.length;
  if (!n) return { n: 0, mean: null, median: null, pUp: null, pDd5: null, pDd10: null };
  const sorted = [...rets].sort((a, b) => a - b);
  return { n, mean: rets.reduce((a, b) => a + b, 0) / n, median: quantileSorted(sorted, 0.5), pUp: rets.filter(v => v > 0).length / n,
    pDd5: dds.filter(v => v <= DRAWDOWN.primary).length / n, pDd10: dds.filter(v => v <= DRAWDOWN.deep).length / n };
}
const roundStats = s => ({ n: s.n, meanReturn: round(s.mean), median: round(s.median), pUp: round(s.pUp, 4), pDd5: round(s.pDd5, 4), pDd10: round(s.pDd10, 4) });

const typedOutcomes = new WeakMap();
/** Outcome arrays for the inner loops: NaN / -1 mark an unknown return / drawdown. */
function typed(outcome) {
  let value = typedOutcomes.get(outcome);
  if (!value) {
    value = { r: Float64Array.from(outcome.ret, v => v === null ? NaN : v), d5: Int8Array.from(outcome.dd, (v, t) => v === null || outcome.ret[t] === null ? -1 : v <= DRAWDOWN.primary ? 1 : 0) };
    typedOutcomes.set(outcome, value);
  }
  return value;
}
/** The evaluation sample of the series rotated by shift (state_t <- state_((t + shift) mod n)), into scratch. */
function collect(states, shift, out, scratch) {
  const n = states.length, { d5 } = out, { t: ts, g: gs } = scratch;
  let size = 0;
  for (let t = 0, u = shift % n; t < n; t++, u = u + 1 === n ? 0 : u + 1) {
    const g = states[u];
    if (g < 0 || d5[t] < 0) continue;
    ts[size] = t; gs[size] = g; size++;
  }
  return size;
}
/** Per-bucket sums and episodes of the sample members [from, to). */
function accumulate(scratch, from, to, out, groups, h) {
  const { r, d5 } = out, { t: ts, g: gs } = scratch;
  const part = { size: Math.max(0, to - from), sumR: 0, sumD: 0, n: new Int32Array(groups), r: new Float64Array(groups), d: new Float64Array(groups), episodes: new Int32Array(groups) };
  const last = new Int32Array(groups).fill(-1);
  for (let i = from; i < to; i++) {
    const t = ts[i], g = gs[i];
    part.sumR += r[t]; part.sumD += d5[t]; part.n[g]++; part.r[g] += r[t]; part.d[g] += d5[t];
    if (last[g] < 0 || t - last[g] > h) part.episodes[g]++;
    last[g] = t;
  }
  return part;
}
/**
 * The full sample and its halves: the first half by session count, then the rest after an embargo (a second-half
 * session lies more than h sessions after the last first-half one, so no first-half outcome reaches its closes).
 */
function aggregate(states, shift, out, groups, h, scratch) {
  const size = collect(states, shift, out, scratch), half = size >> 1;
  let second = half;
  if (half > 0) { const limit = scratch.t[half - 1] + h; while (second < size && scratch.t[second] <= limit) second++; }
  return { size, half, second, parts: [accumulate(scratch, 0, size, out, groups, h), accumulate(scratch, 0, half, out, groups, h), accumulate(scratch, second, size, out, groups, h)] };
}
/** The tests of an indicator: one contrast (first minus second) for two buckets, else each bucket against the baseline. */
const testsFor = groups => groups === 2 ? [{ bucket: 0, versus: 1 }] : Array.from({ length: groups }, (_, bucket) => ({ bucket }));
function estimate(part, test, stat) {
  const sums = stat === 'mean' ? part.r : part.d, total = stat === 'mean' ? part.sumR : part.sumD, a = part.n[test.bucket];
  if (!a || !part.size) return NaN;
  if (test.versus !== undefined) { const b = part.n[test.versus]; return b ? sums[test.bucket] / a - sums[test.versus] / b : NaN; }
  return sums[test.bucket] / a - total / part.size;
}
const compared = test => test.versus === undefined ? [test.bucket] : [test.bucket, test.versus];
const sufficient = (part, test, h) => part.size >= MIN_BLOCKS * blockLength(h) && compared(test).every(g => part.n[g] >= MIN_SESSIONS && part.episodes[g] >= MIN_EPISODES);

/** Pre-registered label of one statistic from the full sample, the halves and the placebo. */
export function label({ full, h1, h2, p, shifts }) {
  if (![full, h1, h2].every(part => part?.sufficient && finite(part.est)) || !(shifts >= PLACEBO.minShifts) || !finite(p)) return 'insufficient';
  const sign = Math.sign(full.est);
  if (p <= PLACEBO.alpha && sign !== 0 && Math.sign(h1.est) === sign && Math.sign(h2.est) === sign) return 'robust';
  if (Math.sign(h1.est) * Math.sign(h2.est) < 0) return 'unstable';
  return 'weak';
}

/**
 * Descriptive statistics, tests and rotation placebo of one indicator on the panel's outcomes. Returns the
 * report's windows and, per test, the label code it gets under each placebo shift (for the chance level).
 */
export function evaluateIndicator(indicator, outcomes, { dates = null, shifts = placeboShifts(indicator.values.length) } = {}) {
  const groups = indicator.buckets.length, n = indicator.values.length, K = shifts.length;
  const states = Int8Array.from(indicator.values, v => Number.isInteger(v) && v >= 0 && v < groups ? v : -1);
  const scratch = { t: new Int32Array(n), g: new Int8Array(n) }, tests = testsFor(groups), windows = {}, nulls = [];
  const margin = placeboMargin(), nullIndex = nullShiftIndices(shifts, n);
  const day = index => index === undefined || index === null ? null : dates?.[index] ?? null;
  for (const h of WINDOWS) {
    const outcome = outcomes[h], out = typed(outcome);
    const actual = aggregate(states, 0, out, groups, h, scratch);
    const sample = Array.from(scratch.t.subarray(0, actual.size)), bucketOf = Array.from(scratch.g.subarray(0, actual.size));
    const store = tests.map(() => ({ ok: new Uint8Array(K), halves: new Uint8Array(K), mean: [0, 1, 2].map(() => new Float64Array(K)), dd5: [0, 1, 2].map(() => new Float64Array(K)) }));
    shifts.forEach((k, j) => {
      const { parts } = aggregate(states, k, out, groups, h, scratch);
      tests.forEach((test, i) => {
        const s = store[i];
        s.ok[j] = sufficient(parts[0], test, h) ? 1 : 0;
        s.halves[j] = sufficient(parts[1], test, h) && sufficient(parts[2], test, h) ? 1 : 0;
        for (const stat of STATS) for (let p = 0; p < 3; p++) s[stat][p][j] = estimate(parts[p], test, stat);
      });
    });
    const results = tests.map((test, i) => Object.fromEntries(STATS.map(stat => {
      const s = store[i], view = actual.parts.map(part => ({ sufficient: sufficient(part, test, h), est: estimate(part, test, stat) }));
      const D = s[stat][0], weights = shifts.map((k, j) => s.ok[j] && finite(D[j]) ? shiftWeight(k, n) : 0);
      const reference = placeboReference(Array.from(D), weights), counted = reference.count;
      const p = counted >= PLACEBO.minShifts ? placeboP(view[0].est, reference) : null;
      // The same labelling under each null shift j with the actual's geometry: j itself and its own look-ahead
      // zone (j, j + M] are left out, the shifts in [j - M, j) stand in for that zone, and the actual joins the
      // reference.
      const actualKnown = view[0].sufficient && finite(view[0].est);
      const pool = placeboReference([...D, actualKnown ? view[0].est : NaN], [...weights, 1]), codes = new Uint8Array(nullIndex.length);
      nullIndex.forEach((j, c) => {
        if (!weights[j]) return;
        const x = D[j];
        let ge = pool.total - pool.cumulative[lowerBound(pool.values, x)], le = pool.cumulative[upperBound(pool.values, x)], total = pool.total, distinct = pool.count;
        const adjust = (i, dw, dn) => { if (!weights[i]) return; total += dw; distinct += dn; if (D[i] >= x) ge += dw; if (D[i] <= x) le += dw; };
        adjust(j, -weights[j], -1);
        for (let i = j + 1; i < K && shifts[i] - shifts[j] <= margin; i++) adjust(i, -weights[i], -1);
        for (let i = j - 1; i >= 0 && shifts[j] - shifts[i] <= margin; i--) adjust(i, 1, 0);
        const pj = total >= 1 ? Math.min(1, 2 * Math.min(1 + ge, 1 + le) / (1 + total)) : null;
        codes[c] = LABELS.indexOf(label({ full: { sufficient: true, est: x }, h1: { sufficient: s.halves[j] === 1, est: s[stat][1][j] }, h2: { sufficient: s.halves[j] === 1, est: s[stat][2][j] }, p: pj, shifts: distinct }));
      });
      nulls.push({ h, bucket: test.bucket, stat, codes });
      return [stat, { est: round(view[0].est), band: counted ? [round(placeboQuantile(reference, PLACEBO.band[0])), round(placeboQuantile(reference, PLACEBO.band[1]))] : null,
        p: round(p, 4), shifts: counted, h1: { est: round(view[1].est) }, h2: { est: round(view[2].est) }, label: label({ full: view[0], h1: view[1], h2: view[2], p, shifts: counted }) }];
    })));
    const { ret, dd } = outcome, ranges = [[0, actual.size], [0, actual.half], [actual.second, actual.size]];
    const members = ranges.map(([from, to]) => Array.from({ length: groups }, (_, g) => sample.slice(from, to).filter((_, i) => bucketOf[from + i] === g)));
    const baselines = ranges.map(([from, to]) => { const part = sample.slice(from, to); return roundStats(summarize(part.map(t => ret[t]), part.map(t => dd[t]))); });
    windows[h] = {
      n: actual.size, start: day(sample[0]), end: day(sample.at(-1)), split: day(sample[actual.second]), embargoed: actual.second - actual.half, block: blockLength(h), partMinimum: MIN_BLOCKS * blockLength(h),
      baseline: baselines[0], h1Baseline: baselines[1], h2Baseline: baselines[2],
      buckets: indicator.buckets.map((bucket, g) => {
        const ts = members[0][g], stats = summarize(ts.map(t => ret[t]), ts.map(t => dd[t])), i = tests.findIndex(test => test.bucket === g);
        // meanReturn is the bucket's own forward-return mean; mean / dd5 carry the tests (D vs the baseline, or for
        // two buckets the contrast, on the first bucket; the second is its complement).
        return { key: bucket.key, label: bucket.label, role: groups === 2 ? (g === 0 ? 'contrast' : 'complement') : 'vs-baseline', ...roundStats(stats), episodes: actual.parts[0].episodes[g], h1n: members[1][g].length, h2n: members[2][g].length,
          firstHalfShare: ts.length ? round(members[1][g].length / ts.length, 4) : null, mean: i >= 0 ? results[i].mean : null, dd5: i >= 0 ? results[i].dd5 : null };
      }),
    };
  }
  return { windows, nulls };
}

const distribution = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { median: quantileSorted(sorted, 0.5), p95: round(quantileSorted(sorted, 0.95), 2), max: sorted.at(-1), mean: round(values.reduce((a, b) => a + b, 0) / values.length, 2) };
};
/**
 * Null distribution of the number of robust labels: per panel over its shifts, and in total over the shifts that
 * every panel with a placebo has (the j-th shift of each).
 */
export function chanceLevel(panels, actual, actualGroups = null) {
  const perPanel = panels.map(panel => {
    const index = nullShiftIndices(panel.shifts, panel.sessions), K = index.length, robust = Array.from({ length: K }, () => []);
    for (const test of panel.nulls) for (let j = 0; j < K; j++) if (test.codes[j] === ROBUST) robust[j].push(test.inputs ?? [test.key ?? 'test']);
    return { panel: panel.name, sessions: panel.sessions, grid: panel.shifts.length, shifts: K, first: panel.shifts[index[0]] ?? null, last: panel.shifts[index.at(-1)] ?? null, robust, actual: panel.actual };
  });
  const active = perPanel.filter(panel => panel.shifts > 0);
  const K = active.length ? Math.min(...active.map(panel => panel.shifts)) : 0;
  const labels = j => active.flatMap(panel => panel.robust[j]);
  const total = Array.from({ length: K }, (_, j) => labels(j).length), groups = Array.from({ length: K }, (_, j) => groupCount(labels(j)));
  const summary = distribution(total);
  return { available: K > 0, shifts: K, margin: placeboMargin(), actual, actualGroups, robust: summary, groups: distribution(groups),
    shareAtLeastActual: K ? round(total.filter(v => v >= actual).length / K, 4) : null, clears: summary ? actual > summary.p95 : null,
    panels: perPanel.map(({ robust, ...panel }) => ({ ...panel, robust: distribution(robust.map(list => list.length)) })) };
}

// ---- indicators -------------------------------------------------------------------------------------------------
const make = (panel, key, label, rule, bucketLabels, values, outcome) => ({ panel, key, label, rule, outcome, inputs: indicatorInputs(key), buckets: bucketLabels.map(text => ({ key: text, label: text })), values });
// Input series of each indicator, for grouping labels: one rule on ^GSPC, ^IXIC and the long-history S&P shares one input.
const INDICATOR_INPUTS = { 'dd.binary': ['index:distribution'], 'dd.graded': ['index:distribution'], 'ftd.state': ['index:ftd'], 'combo.ftd_recent': ['index:ftd'],
  ma50: ['index:ma50'], ma200: ['index:ma200'], 'ma.quadrant': ['index:ma50', 'index:ma200'], 'high.near': ['index:high'], 'combo.dd_ma50': ['index:distribution', 'index:ma50'],
  'rule.split': ['index:high', 'breadth:above200'], 'rule.lows': ['breadth:newHighsLows'], 'rule.template': ['breadth:trendTemplate'], 'rule.stage': ['breadth:stages'],
  'rule.leaders': ['breadth:leaderHealth'], 'rule.breakout': ['breadth:breakoutHold'],
  'rule.count': ['index:distribution', 'index:ftd', 'index:high', 'breadth:above200', 'breadth:newHighsLows', 'breadth:trendTemplate', 'breadth:stages', 'breadth:leaderHealth', 'breadth:breakoutHold'],
  'combo.lows_below200': ['breadth:newHighsLows', 'index:ma200'], 'combo.washout_uptrend': ['breadth:above50', 'index:ma200'] };
const FIELD_INPUTS = { above50Percent: 'breadth:above50', above150Percent: 'breadth:above150', above200Percent: 'breadth:above200', trendTemplatePercent: 'breadth:trendTemplate',
  netHighsPercent: 'breadth:newHighsLows', ratio_10day: 'breadth:upDown4pct', leaderPercent: 'breadth:leaderCount', leaderHealthPercent: 'breadth:leaderHealth',
  breakoutHoldPercent: 'breadth:breakoutHold', stageSpread: 'breadth:stages' };
export function indicatorInputs(key) {
  const field = /^(?:q|d21)\.(.+)$/.exec(key);
  if (field) return [FIELD_INPUTS[field[1]] ?? key];
  return INDICATOR_INPUTS[key.replace(/^(?:\^GSPC|\^IXIC|spx)\./, '')] ?? [key];
}
/** Group of each item (a list of inputs): items sharing an input, directly or through others, form one group. */
export function inputGroups(items) {
  const parent = new Map(), find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const inputs of items) for (const input of inputs) if (!parent.has(input)) parent.set(input, input);
  for (const inputs of items) for (const input of inputs.slice(1)) { const a = find(inputs[0]), b = find(input); if (a !== b) parent.set(a, b); }
  const number = new Map();
  return items.map(inputs => { const root = find(inputs[0]); if (!number.has(root)) number.set(root, number.size + 1); return number.get(root); });
}
const groupCount = items => new Set(inputGroups(items)).size;
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
  let a50 = null;
  for (const [key, text] of BREADTH_FIELDS) {
    for (const [prefix, values, suffix] of [['q', fields[key], ''], ['d21', change(fields[key]), ` ${CHANGE_SESSIONS}-session change`]]) {
      const causal = causalQuintiles(values), known = values.filter(finite).length;
      if (prefix === 'q' && key === 'above50Percent') a50 = causal.buckets;
      const rule = causal.first ? `causal quintiles (edges from every known value strictly before the session, judged after ${EDGE_WARMUP}); edges at the first judged session ${dates[causal.firstIndex]} ${fmtEdges(causal.first)}, after the last session ${fmtEdges(causal.last)}`
        : `causal quintiles (judged after ${EDGE_WARMUP} known values)`;
      const indicator = needs(make(panel, `${prefix}.${key}`, `${text}${suffix}`, rule, QUINTILE_LABELS, causal.buckets, outcome), BREADTH_INPUTS[key],
        known && !causal.first ? `${known} known values, fewer than the ${EDGE_WARMUP} earlier values a causal quintile needs` : null);
      indicator.edges = causal.first ? { firstJudged: dates[causal.firstIndex], first: causal.first.map(e => round(e)), last: causal.last.map(e => round(e)) } : null;
      fieldIndicators.push(indicator);
    }
  }
  list.push(make(panel, 'combo.washout_uptrend', '50日線より上の割合がQ1 and S&P 500 above its 200-day', 'q.above50Percent causal bucket Q1 and indexSummary vs200 > 0', ['両方 (both)', 'それ以外 (otherwise)'],
    fields.above50Percent.map((value, t) => { const q = a50?.[t] ?? null, a = above(ma[t]?.vs200 ?? null); return q === null || a === null ? null : bin(q === 0 && a); }), outcome));
  return [...list, ...fieldIndicators];
}
const BREADTH_INPUTS = { above50Percent: ['above50Percent'], above150Percent: ['above150Percent'], above200Percent: ['above200Percent'], trendTemplatePercent: ['trendTemplatePercent'],
  netHighsPercent: ['newHighs', 'newLows'], ratio_10day: ['ratio_10day'], leaderPercent: ['leaderCount'], leaderHealthPercent: ['leaderHealthPercent'], breakoutHoldPercent: ['breakoutHoldPercent'], stageSpread: ['stage2Percent', 'stage4Percent'] };
const fmtEdge = value => Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
const fmtEdges = edges => edges.map(fmtEdge).join(' / ');
const QUINTILE_LABELS = ['Q1 下位20% (bottom fifth of earlier sessions)', 'Q2', 'Q3', 'Q4', 'Q5 上位20% (top fifth of earlier sessions)'];

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
export function runStudy({ history = null, historyMeta = {}, indices = null, calendar = null, asOfDate = null, shifts: shiftCount = PLACEBO.shifts, label: runLabel = null }) {
  const results = [], inputs = { history: null, indices: [] }, notes = [], panels = [];
  const indexByDate = {};
  // One shift set per panel, shared by all of its indicators (the tests' dependence is kept under the placebo).
  const panelFor = (name, sessions) => { const panel = { name, sessions, shifts: placeboShifts(sessions, shiftCount), nulls: [] }; panels.push(panel); return panel; };
  for (const item of indices?.indices || []) {
    const ownCalendar = calendar || item.calendar_sessions || null;
    const raw = alignIndex({ symbol: item.symbol, bars: item.bars, calendar: ownCalendar, asOfDate });
    const flagged = implausibleMoves(raw.bars.map(bar => bar?.close ?? null)), unknown = new Set(flagged);
    const aligned = { ...raw, bars: raw.bars.map((bar, t) => unknown.has(t) ? null : bar) };
    const states = indexStates(aligned), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(states.closes, h)]));
    const valid = aligned.bars.filter(validBar).length, flaggedDates = flagged.map(t => aligned.dates[t]);
    inputs.indices.push({ symbol: item.symbol, source: item.source ?? null, provenance: item.provenance ?? null, calendarBasis: aligned.calendarBasis,
      first: aligned.dates[0] ?? null, last: aligned.dates.at(-1) ?? null, lastBar: aligned.bars.filter(Boolean).at(-1)?.date ?? null, sessions: aligned.dates.length,
      validBars: valid, invalidBars: aligned.bars.filter(bar => bar && !validBar(bar)).length, missingSessions: aligned.missing.length, offCalendarBars: aligned.extra.length,
      validRuns: runs(aligned.bars.map(validBar)).length, missingSample: aligned.missing.slice(0, 10), offCalendarSample: aligned.extra.slice(0, 10),
      implausibleMoves: flagged.length, implausibleSample: flaggedDates.slice(0, 10) });
    if (flagged.length) notes.push(`${item.symbol}: ${flagged.length} session(s) with a close more than ${100 * IMPLAUSIBLE_MOVE}% from the previous close are unknown, never filled: ${flaggedDates.slice(0, 10).join(', ')}${flagged.length > 10 ? ', …' : ''}.`);
    if (aligned.calendarBasis === 'provider') notes.push(`${item.symbol}: no independent calendar; the provider's dates are the sessions (a session the provider omits cannot be detected).`);
    indexByDate[item.symbol] = new Map(aligned.dates.map((day, t) => [day, { dd: states.dd[t], ftd: states.ftd[t] }]));
    const panel = panelFor(`index:${item.symbol}`, aligned.dates.length);
    for (const indicator of indexIndicators(states)) results.push(finish(indicator, outcomes, aligned.dates, panel));
  }
  let diagnostics = null;
  if (history) {
    const sp = history.sp500 || [], flagged = implausibleMoves(sp.map(point => point.close)), unknown = new Set(flagged);
    if (flagged.length) {
      history = { ...history, sp500: sp.map((point, i) => unknown.has(i) ? { ...point, close: null } : point) };
      notes.push(`Long history sp500: ${flagged.length} session(s) with a close more than ${100 * IMPLAUSIBLE_MOVE}% from the previous close are unknown, never filled: ${flagged.slice(0, 10).map(i => sp[i].date).join(', ')}${flagged.length > 10 ? ', …' : ''}.`);
    }
    const states = breadthStates(history), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(states.closes, h)]));
    const present = BREADTH_FIELDS.filter(([key]) => states.fields[key].some(finite)).map(([key]) => key);
    inputs.history = { as_of_date: history.as_of_date, retrieved_at: history.retrieved_at, sha256: historyMeta.sha256 ?? null, origin: historyMeta.origin ?? null,
      first: states.dates[0] ?? null, last: states.dates.at(-1) ?? null, sessions: states.dates.length, sp500Closes: states.closes.filter(positive).length,
      universe: history.universe.symbols.length, basis: history.universe.basis, historicalMembershipVerified: history.universe.historical_membership_verified,
      fieldsPresent: present, fieldsAbsent: BREADTH_FIELDS.map(([key]) => key).filter(key => !present.includes(key)), implausibleMoves: flagged.length, implausibleSample: flagged.slice(0, 10).map(i => sp[i].date) };
    if (inputs.history.fieldsAbsent.length) notes.push(`Long history lacks ${inputs.history.fieldsAbsent.join(', ')} (older schema): those indicators and every rule that needs them are unjudged, never 0.`);
    const gspc = indexByDate['^GSPC'];
    if (gspc) {
      const closeByDate = new Map((indices.indices.find(item => item.symbol === '^GSPC')?.bars || []).map(bar => [bar.date, bar.close]));
      let compared = 0, worst = 0;
      states.dates.forEach((day, t) => { const a = states.closes[t], b = closeByDate.get(day); if (positive(a) && positive(b)) { compared++; worst = Math.max(worst, Math.abs(a / b - 1)); } });
      inputs.history.sp500VsIndexSource = { compared, maxRelativeDifference: round(worst, 8) };
    }
    const panel = panelFor('breadth', states.dates.length);
    for (const indicator of breadthIndicators(states, indexByDate)) results.push(finish(indicator, outcomes, states.dates, panel));
    diagnostics = survivorship(history, states);
  }
  const tested = results.filter(r => r.available);
  const tally = Object.fromEntries(LABELS.map(name => [name, 0]));
  let tests = 0;
  for (const r of tested) for (const h of WINDOWS) for (const bucket of r.windows[h].buckets) for (const stat of STATS) if (bucket[stat]) { tests++; tally[bucket[stat].label]++; }
  const robustLabels = robustList(results), groups = inputGroups(robustLabels.map(item => item.inputs));
  robustLabels.forEach((item, i) => { item.group = groups[i]; });
  const chance = chanceLevel(panels.map(panel => ({ ...panel, actual: panelRobust(results, panel.name) })), tally.robust, new Set(groups).size);
  return { schema_version: STUDY_VERSION, label: runLabel, generated_at: new Date().toISOString(), as_of_date: asOfDate,
    method: { windows: WINDOWS, drawdownLevels: [DRAWDOWN.primary, DRAWDOWN.deep], quintiles: QUANTILES, changeSessions: CHANGE_SESSIONS, ftdWindowSessions: FTD_WINDOW_SESSIONS,
      placebo: { ...PLACEBO, shifts: shiftCount, margin: placeboMargin(), rotation: 'state_t <- state_((t + k) mod n), one k per panel' }, minSessions: MIN_SESSIONS, minEpisodes: MIN_EPISODES, minBlocks: MIN_BLOCKS, block: 'max(2h, 21)',
      appRules: { DISTRIBUTION_WARN, DISTRIBUTION_METHOD, FOLLOW_THROUGH_METHOD, SPLIT_RULE, ENV_RULES } },
    inputs, notes, survivorship: diagnostics,
    tests: { indicators: results.length, available: tested.length, buckets: tested.reduce((a, r) => a + r.buckets.length, 0),
      contrasts: tested.reduce((a, r) => a + (r.buckets.length === 2 ? 1 : r.buckets.length), 0), tests, indicatorLevel: tested.length * WINDOWS.length * STATS.length,
      labels: tally, robustGroups: new Set(groups).size, robust: robustLabels, chance },
    indicators: results };
}

/** Every robust label in report order, with its indicator's inputs. */
const robustList = results => results.filter(r => r.available).flatMap(r => WINDOWS.flatMap(h => r.windows[h].buckets.flatMap((bucket, g) => STATS.filter(stat => bucket[stat]?.label === 'robust')
  .map(stat => ({ key: r.key, bucket: g, h, stat, inputs: r.inputs })))));
const panelRobust = (results, name) => results.filter(r => r.available && r.panel === name).reduce((a, r) => a + WINDOWS.reduce((b, h) => b + r.windows[h].buckets.reduce((c, bucket) => c + STATS.filter(stat => bucket[stat]?.label === 'robust').length, 0), 0), 0);

function finish(indicator, outcomes, dates, panel) {
  const judged = indicator.values.filter(value => value !== null).length;
  const base = { panel: indicator.panel, key: indicator.key, label: indicator.label, rule: indicator.rule, outcome: indicator.outcome, inputs: indicator.inputs, edges: indicator.edges ?? null,
    buckets: indicator.buckets, judged, available: judged > 0 };
  if (!judged) return { ...base, reason: indicator.unavailableReason || 'no judged session (the input is too short for the rule)', windows: null };
  const { windows, nulls } = evaluateIndicator(indicator, outcomes, { dates, shifts: panel.shifts });
  for (const test of nulls) panel.nulls.push({ ...test, key: indicator.key, inputs: indicator.inputs });
  return { ...base, firstJudged: dates[indicator.values.findIndex(value => value !== null)], lastJudged: dates[indicator.values.findLastIndex(value => value !== null)], windows };
}

// ---- markdown ----------------------------------------------------------------------------------------------------
const pct = (value, digits = 2) => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(100 * value).toFixed(digits)}%` : '—';
const pp = (value, digits = 2) => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(100 * value).toFixed(digits)}` : '—';
const prob = value => finite(value) ? `${(100 * value).toFixed(0)}%` : '—';
const statText = (stat, digits = 2) => !stat || stat.est === null ? '—' : `${pp(stat.est, digits)} [${stat.band ? `${pp(stat.band[0], digits)}, ${pp(stat.band[1], digits)}` : 'n/a'}] p ${stat.p === null ? 'n/a' : stat.p.toFixed(3)}`;
const num2 = value => finite(value) ? String(round(value, 1)) : '—';
const TAG = { robust: '**robust**', weak: 'weak', unstable: 'unstable', insufficient: 'insufficient' };
const signedTerm = value => `${value < 0 ? '−' : '+'} ${Math.abs(value)}`;
const cell = text => String(text).replace(/\|/g, '\\|');

export function markdownReport(study) {
  const lines = [], add = (...rows) => lines.push(...rows);
  add(`# Market-regime study${study.label ? ` — ${study.label}` : ''}`, '',
    `${STUDY_VERSION} (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of ${study.as_of_date ?? 'n/a'} · rotation placebo: up to ${study.method.placebo.shifts} shifts per panel, margin ${study.method.placebo.margin} sessions · robust = placebo p ≤ ${PLACEBO.alpha} and both halves agree in sign`, '',
    'Diagnostic research only: nothing here changes a rule, threshold, verdict or published value. Returns are forward index returns from the close of the session the state was observed (strictly causal). Δ columns are in percentage points: a bucket minus the unconditional baseline of the same sample (three or more buckets), or for a two-state indicator one contrast, the first state minus the second. [band] is the 90% range of Δ when the indicator series is rotated against the outcomes (what chance alone produced on this data); p is the two-sided rotation-placebo p.', '');
  add('## Inputs', '', '| input | basis | first | last | sessions | notes |', '|---|---|---|---|---|---|');
  const h = study.inputs.history;
  if (h) add(`| long history (as of ${h.as_of_date}) | ${h.basis}; historical membership verified: ${h.historicalMembershipVerified} | ${h.first} | ${h.last} | ${h.sessions} | universe ${h.universe}; sha256 ${String(h.sha256).slice(0, 12)}; ${h.fieldsAbsent.length ? `absent: ${h.fieldsAbsent.join(', ')}` : 'all study fields present'}${h.sp500VsIndexSource ? `; sp500 vs index source max diff ${(100 * h.sp500VsIndexSource.maxRelativeDifference).toFixed(4)}% over ${h.sp500VsIndexSource.compared}` : ''}; implausible moves ${h.implausibleMoves} |`);
  for (const i of study.inputs.indices) add(`| ${i.symbol} OHLCV | ${i.source ?? 'n/a'}; calendar ${i.calendarBasis} | ${i.first} | ${i.last} | ${i.sessions} | valid bars ${i.validBars}, invalid ${i.invalidBars}, missing sessions ${i.missingSessions}, off-calendar ${i.offCalendarBars}, valid runs ${i.validRuns}, implausible moves ${i.implausibleMoves}; last bar ${i.lastBar} |`);
  add('');
  for (const note of study.notes) add(`- ${note}`);
  if (h) add('- The long history is a CURRENT-UNIVERSE RETROSPECTIVE: stocks delisted before the capture are missing, so early breadth tends to read healthier than it was. Read breadth effects with the survivorship section and the split-sample labels.');
  const t = study.tests, chance = t.chance;
  add('', '## Tests and chance level', '',
    `${t.available} of ${t.indicators} indicators had judged sessions; ${t.contrasts} contrasts (a two-state indicator is one) × ${WINDOWS.length} windows × 2 statistics = **${t.tests} tests**, from ${t.indicatorLevel} indicator-level tests (indicator × window × statistic). The windows overlap: each starts at the same close.`,
    `Labels: robust ${t.labels.robust} (in ${t.robustGroups} input group${t.robustGroups === 1 ? '' : 's'}) · weak ${t.labels.weak} · unstable ${t.labels.unstable} · insufficient ${t.labels.insufficient}. robust = rotation-placebo p ≤ ${PLACEBO.alpha} and both halves' Δ have the full-sample sign. Labels share a group when their indicators share an input series; the same rule on ^GSPC, ^IXIC and the long-history S&P is one input.`, '');
  if (!chance.available) add(`Chance level: unavailable. Every panel is shorter than 2 × ${chance.margin} sessions plus ${PLACEBO.minShifts} shifts, so every test is insufficient.`, '');
  else {
    add(`Chance level (rotation placebo: the whole labelling rerun on each of ${chance.shifts} shifts, one shift for every indicator of a panel so the tests' dependence is kept): robust labels median ${num2(chance.robust.median)}, 95th percentile ${num2(chance.robust.p95)}, max ${chance.robust.max}; ${prob(chance.shareAtLeastActual)} of shifts reached the actual ${chance.actual}. Robust groups: actual ${chance.actualGroups}, placebo median ${num2(chance.groups.median)}, 95th percentile ${num2(chance.groups.p95)}.`,
      ...chance.panels.map(panel => `- ${panel.panel}: ${panel.sessions} sessions, ${panel.shifts ? `${panel.shifts} shifts (${panel.first}–${panel.last}); robust labels actual ${panel.actual}, placebo median ${num2(panel.robust.median)}, 95th percentile ${num2(panel.robust.p95)}` : 'too short for the placebo (every test insufficient)'}.`), '',
      chance.clears ? `**${chance.actual} robust labels exceed the placebo 95th percentile (${num2(chance.robust.p95)}).** Read them with the split and survivorship caveats.`
        : `**${chance.actual} robust labels do not exceed the placebo 95th percentile (${num2(chance.robust.p95)}): as a set they are consistent with chance and are not reported as effects.**`, '');
  }
  const chanceTitle = chance.available ? `chance level median ${num2(chance.robust.median)}, 95th percentile ${num2(chance.robust.p95)} (placebo)` : 'chance level unavailable';
  add(`## Labels passing the split rule (placebo p ≤ ${PLACEBO.alpha}, halves agree) — ${chanceTitle}`, '',
    '| group | indicator | state | h | n | episodes | mean | reference | Δmean [placebo band] p | P(DD≤−5%) | ΔP(DD≤−5%) [placebo band] p | which |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  const byKey = new Map(study.indicators.map(r => [r.key, r])), rows = new Map();
  for (const item of t.robust) {
    const id = `${item.key}|${item.h}|${item.bucket}`;
    if (!rows.has(id)) rows.set(id, { ...item, which: [] });
    rows.get(id).which.push(item.stat);
  }
  const ordered = [...rows.values()].sort((a, b) => a.group - b.group);
  for (const row of ordered) {
    const r = byKey.get(row.key), win = r.windows[row.h], b = win.buckets[row.bucket], other = b.role === 'contrast' ? win.buckets[row.bucket + 1] : null;
    const pair = (a, c) => other ? `${a} / ${c}` : a;
    add(`| ${row.group} | ${cell(r.label)} \`${r.key}\` | ${cell(other ? `${b.label} vs ${other.label}` : b.label)} | ${row.h} | ${pair(b.n, other?.n)} | ${pair(b.episodes, other?.episodes)} | ${pct(b.meanReturn)} | ${other ? pct(other.meanReturn) : `baseline ${pct(win.baseline.meanReturn)}`} | ${statText(b.mean)} | ${pair(prob(b.pDd5), other ? prob(other.pDd5) : '')} | ${statText(b.dd5, 1)} | ${row.which.join(', ')} |`);
  }
  if (!ordered.length) add('| | none | | | | | | | | | | |');
  const s = study.survivorship;
  if (s) {
    add('', '## Survivorship diagnostics (long history)', '', '| year | sessions | eligible / universe | coverage / universe | mean above50% residual |', '|---|---|---|---|---|');
    for (const y of s.byYear) add(`| ${y.year} | ${y.sessions} | ${prob(y.eligibleShare)} | ${prob(y.coverageShare)} | ${s.above50Residual?.byYear.find(r => r.year === y.year)?.meanResidual ?? '—'} |`);
    if (s.above50Residual) add('', `OLS above50Percent = ${s.above50Residual.intercept} ${signedTerm(s.above50Residual.vs50)}·(^GSPC % vs 50-day) ${signedTerm(s.above50Residual.vs200)}·(% vs 200-day), R² ${s.above50Residual.r2}, n ${s.above50Residual.n}. Mean residual first half (${s.above50Residual.firstHalf.from}–${s.above50Residual.firstHalf.to}) ${s.above50Residual.firstHalf.meanResidual} pt, second half (${s.above50Residual.secondHalf.from}–${s.above50Residual.secondHalf.to}) ${s.above50Residual.secondHalf.meanResidual} pt. A positive early residual is consistent with survivorship inflation (or a genuinely broader market then); this cannot separate the two.`);
  }
  add('', '## All indicators', '');
  for (const r of study.indicators) {
    add(`### ${r.label} — \`${r.key}\``, '', `${r.rule}. Outcome: ${r.outcome}.${r.available ? ` Judged ${r.judged} sessions (${r.firstJudged} to ${r.lastJudged}).` : ''}${r.buckets.length === 2 ? ' Two states: one contrast, the first minus the second.' : ''}`, '');
    if (!r.available) { add(`Unavailable: ${r.reason}.`, ''); continue; }
    add('| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const w of WINDOWS) {
      const win = r.windows[w], base = win.baseline;
      if (!win.n) { add(`| (no session with a complete ${w}-session forward window) | ${w} | 0 | | | | | | | | | | | |`); continue; }
      add(`| baseline | ${w} | ${win.n} | | split ${win.split ?? '—'}, embargo ${win.embargoed} | ${pct(base.meanReturn)} | ${pct(base.median)} | ${prob(base.pUp)} | ${prob(base.pDd5)} | ${prob(base.pDd10)} | | | | |`);
      for (const b of win.buckets) {
        const tail = b.role === 'complement' ? '(the contrast above) | | | ' : `${statText(b.mean)} | ${TAG[b.mean.label]} | ${statText(b.dd5, 1)} | ${TAG[b.dd5.label]} `;
        add(`| ${cell(b.label)} | ${w} | ${b.n} | ${b.episodes} | ${prob(b.firstHalfShare)} | ${pct(b.meanReturn)} | ${pct(b.median)} | ${prob(b.pUp)} | ${prob(b.pDd5)} | ${prob(b.pDd10)} | ${tail}|`);
      }
    }
    add('');
  }
  return `${lines.join('\n')}\n`;
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    history: { type: 'string' }, indices: { type: 'string' }, yahoo: { type: 'boolean' }, calendar: { type: 'string' }, 'save-indices': { type: 'string' },
    'as-of': { type: 'string' }, out: { type: 'string' }, markdown: { type: 'string' }, shifts: { type: 'string' }, label: { type: 'string' } } });
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
  const shifts = values.shifts === undefined ? PLACEBO.shifts : Number(values.shifts);
  // Fewer shifts than PLACEBO.minShifts would leave every test insufficient.
  if (!Number.isSafeInteger(shifts) || shifts < PLACEBO.minShifts) throw Error(`Invalid --shifts (an integer >= ${PLACEBO.minShifts})`);
  const study = runStudy({ history: loaded?.history ?? null, historyMeta: loaded ?? {}, indices, calendar, asOfDate, shifts, label: values.label ?? null });
  const markdown = markdownReport(study);
  for (const [path, body] of [[values.out, `${JSON.stringify(study)}\n`], [values.markdown, markdown]]) if (path) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, body); }
  console.log(JSON.stringify({ schema_version: STUDY_VERSION, as_of_date: asOfDate, indicators: study.tests.indicators, available: study.tests.available, tests: study.tests.tests, labels: study.tests.labels,
    chance: study.tests.chance.available ? { shifts: study.tests.chance.shifts, median: study.tests.chance.robust.median, p95: study.tests.chance.robust.p95, clears: study.tests.chance.clears } : null }));
  return study;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
