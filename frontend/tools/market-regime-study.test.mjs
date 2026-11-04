import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distributionDays } from '../src/static/distributionDays.js';
import { followThroughDay } from '../src/static/followThroughDay.js';
import { bifurcation, environmentPoint } from '../src/static/marketLongHistory.js';
import { environmentRules } from '../src/static/brief/briefModel.js';
import {
  alignIndex, breadthIndicators, markdownReport, breadthStates, causalQuintiles, chanceLevel, episodes, evaluateIndicator, fetchYahooIndex, forwardOutcomes, indexIndicators, indexStates, implausibleMoves, indicatorInputs, inputGroups, label, loadHistory, main,
  mulberry32, nullShiftIndices, parseYahooChart, placeboMargin, placeboP, placeboQuantile, placeboReference, placeboShifts, quintileBucket, quintileEdges, runStudy, shiftWeight,
  EDGE_WARMUP, FTD_WINDOW_SESSIONS, IMPLAUSIBLE_MOVE, LABELS, MIN_BLOCKS, PLACEBO, STATS, WINDOWS,
} from './market-regime-study.mjs';

// ---- synthetic series (no provider data) ----------------------------------------------------------------------
function weekdays(start, n) {
  const out = [], day = new Date(`${start}T00:00:00Z`);
  while (out.length < n) { if (day.getUTCDay() % 6) out.push(day.toISOString().slice(0, 10)); day.setUTCDate(day.getUTCDate() + 1); }
  return out;
}
function indexBars(dates, seed = 7, start = 1000) {
  const rng = mulberry32(seed);
  let close = start;
  return dates.map(date => {
    const open = close * (1 + (rng() - 0.5) * 0.004);
    close = close * (1 + (rng() - 0.5) * 0.035);
    const high = Math.max(open, close) * (1 + rng() * 0.006), low = Math.min(open, close) * (1 - rng() * 0.006);
    return { date, open, high, low, close, volume: Math.round(1e9 * (0.8 + rng() * 0.4)) };
  });
}
const symbols = Array.from({ length: 100 }, (_, i) => `S${i}`);
function longHistory({ n = 420, start = '2019-01-02', full = true, seed = 3 } = {}) {
  const dates = weekdays(start, n), rng = mulberry32(seed), asOf = dates.at(-1), retrieved = `${asOf}T22:00:00.000Z`;
  const sp = indexBars(dates, seed + 1, 2500);
  const ups = [], downs = [];
  const breadth = dates.map((date, i) => {
    const above50 = Math.floor(rng() * 101), up = Math.floor(rng() * 20), down = 1 + Math.floor(rng() * 20);
    ups.push(up); downs.push(down);
    const row = { date, coverage: 100, universe: 100, eligibleUniverse: 100, coveragePercent: 100, above50, above50Percent: 100 * above50 / 100,
      newHighs: Math.floor(rng() * 15), newLows: Math.floor(rng() * 15), leaderCount: Math.floor(rng() * 30), stocks_up_4pct: up, stocks_down_4pct: down,
      ratio_10day: i >= 9 ? ups.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) / downs.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) : null, reason: null };
    if (full) {
      const above200 = Math.floor(rng() * 101), tt = 20 + Math.floor(rng() * 30), s2 = Math.floor(rng() * 50), s4 = Math.floor(rng() * 50), s1 = Math.floor((100 - s2 - s4) / 2);
      const judged = 5 + Math.floor(rng() * 10), cohort = 10 + Math.floor(rng() * 20);
      Object.assign(row, { above150: above200, above150Percent: above200, above200, above200Percent: 100 * above200 / 100, trendTemplateCount: tt, trendTemplatePercent: tt,
        rs90TemplateCount: Math.floor(tt / 2), stage1: s1, stage2: s2, stage3: 100 - s1 - s2 - s4, stage4: s4, breakouts: 3, breakoutsJudged: judged, breakoutsHeld: Math.floor(rng() * (judged + 1)),
        leaderCohort: cohort, leaderCohortAbove50: Math.floor(rng() * (cohort + 1)) });
    }
    return row;
  });
  const url = symbol => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  return { schema_version: 'market-long-history-v1', market: 'US', as_of_date: asOf, retrieved_at: retrieved, price_policy: {},
    universe: { basis: 'current-published-universe-retrospective', symbols, sha256: createHash('sha256').update(JSON.stringify(symbols)).digest('hex'), historical_membership_verified: false, historical_fundamentals_verified: false },
    calendar: { provider: 'pandas_market_calendars:NYSE', sessions: dates }, breadth, sp500: sp.map(bar => ({ date: bar.date, close: bar.close })),
    sectorRotation: { lookback_sessions: 126, frames: [] }, classification: null, sectorBreadth: [],
    provenance: [...symbols, '^GSPC'].map(symbol => ({ symbol, url: url(symbol), sha256: 'a'.repeat(64), retrieved_at: retrieved })), errors: {} };
}
const strip = value => JSON.parse(JSON.stringify(value));

describe('forward outcomes', () => {
  it('measures the return and the worst close from close t, and never turns an unknown close into 0', () => {
    const { ret, dd } = forwardOutcomes([100, 110, 99, 121], 2);
    expect(ret[0]).toBeCloseTo(-0.01, 12); expect(dd[0]).toBeCloseTo(-0.01, 12);
    expect(ret[1]).toBeCloseTo(0.1, 12); expect(dd[1]).toBeCloseTo(-0.1, 12);
    expect([ret[2], ret[3], dd[2], dd[3]]).toEqual([null, null, null, null]);
    const gap = forwardOutcomes([100, 101, null, 103, 104], 2);
    expect(gap.ret.slice(0, 3)).toEqual([null, null, null]);
    expect(gap.ret[3]).toBeNull();
    expect(gap.dd.slice(0, 2)).toEqual([null, null]);
  });
  it('depends only on closes t..t+h', () => {
    const closes = indexBars(weekdays('2020-01-01', 120)).map(bar => bar.close), changed = [...closes];
    for (let i = 80; i < changed.length; i++) changed[i] *= 1.37;
    for (const h of WINDOWS) {
      const a = forwardOutcomes(closes, h), b = forwardOutcomes(changed, h);
      for (let t = 0; t + h < 80; t++) { expect(b.ret[t]).toBe(a.ret[t]); expect(b.dd[t]).toBe(a.dd[t]); }
      expect(b.ret[80 - h]).not.toBe(a.ret[80 - h]);
    }
  });
});

describe('no look-ahead in any indicator state', () => {
  it('index states at or before t are identical when every later bar is truncated or replaced', () => {
    const dates = weekdays('2018-01-02', 520), bars = indexBars(dates, 11), cut = 400;
    const full = indexStates({ symbol: '^GSPC', dates, bars });
    const truncated = indexStates({ symbol: '^GSPC', dates: dates.slice(0, cut + 1), bars: bars.slice(0, cut + 1) });
    const replaced = indexStates({ symbol: '^GSPC', dates, bars: [...bars.slice(0, cut + 1), ...indexBars(dates.slice(cut + 1), 99, bars[cut].close * 0.7)] });
    for (const key of ['dd', 'ftd', 'ma']) {
      expect(strip(truncated[key])).toEqual(strip(full[key].slice(0, cut + 1)));
      expect(strip(replaced[key].slice(0, cut + 1))).toEqual(strip(full[key].slice(0, cut + 1)));
    }
    expect(full.ftd.filter(Boolean).length).toBe(520 - FTD_WINDOW_SESSIONS + 1);
  });
  it('breadth states at or before t are identical when every later row and close is truncated or replaced', () => {
    const history = longHistory({ n: 400 }), cut = 330;
    const full = breadthStates(history);
    const truncated = breadthStates({ ...history, breadth: history.breadth.slice(0, cut + 1), sp500: history.sp500.slice(0, cut + 1) });
    const other = longHistory({ n: 400, seed: 41 });
    const replaced = breadthStates({ ...history, breadth: [...history.breadth.slice(0, cut + 1), ...other.breadth.slice(cut + 1)], sp500: [...history.sp500.slice(0, cut + 1), ...other.sp500.slice(cut + 1)] });
    for (const view of [truncated, replaced]) {
      for (const key of ['ma', 'split', 'lows']) expect(strip(view[key].slice(0, cut + 1))).toEqual(strip(full[key].slice(0, cut + 1)));
      for (const key of Object.keys(full.rules)) expect(view.rules[key].slice(0, cut + 1)).toEqual(full.rules[key].slice(0, cut + 1));
      for (const key of Object.keys(full.fields)) expect(view.fields[key].slice(0, cut + 1)).toEqual(full.fields[key].slice(0, cut + 1));
    }
    expect(full.split.slice(260).some(value => value !== null)).toBe(true);
  });
  it('every breadth indicator series, causal quintiles and combos included, is unchanged at or before t when later data is truncated or replaced', () => {
    const history = longHistory({ n: 400 }), other = longHistory({ n: 400, seed: 41 }), cut = 330;
    const values = h => breadthIndicators(breadthStates(h)).map(i => [i.key, i.values]);
    const full = values(history);
    const views = [values({ ...history, breadth: history.breadth.slice(0, cut + 1), sp500: history.sp500.slice(0, cut + 1) }),
      values({ ...history, breadth: [...history.breadth.slice(0, cut + 1), ...other.breadth.slice(cut + 1)], sp500: [...history.sp500.slice(0, cut + 1), ...other.sp500.slice(cut + 1)] })];
    for (const view of views) view.forEach(([key, series], i) => { expect(key).toBe(full[i][0]); expect(series.slice(0, cut + 1)).toEqual(full[i][1].slice(0, cut + 1)); });
    for (const key of ['q.above50Percent', 'd21.netHighsPercent', 'combo.washout_uptrend']) expect(full.find(([k]) => k === key)[1].slice(0, cut + 1).some(value => value !== null)).toBe(true);
  });
});

describe('the app\'s own rules, as the brief computes them', () => {
  it('a distribution count over the whole run equals the brief\'s 280-session computation, and FTD is the 280-session state', () => {
    const dates = weekdays('2018-01-02', 700), bars = indexBars(dates, 5), states = indexStates({ symbol: '^IXIC', dates, bars });
    for (const t of [279, 300, 450, 699]) {
      const window = bars.slice(t - 279, t + 1);
      const app = distributionDays({ symbol: '^IXIC', bars: window, sessions: window.map(bar => bar.date), asOfDate: bars[t].date });
      expect(states.dd[t]).toBe(app.latest.value);
      const ftd = followThroughDay({ symbol: '^IXIC', bars: window, asOfDate: bars[t].date });
      expect(states.ftd[t].state).toBe(ftd.state === 'no_correction' && ftd.peakAtWindowStart ? 'no_correction_pending' : ftd.state);
    }
    expect(states.dd.slice(0, 25).every(value => value === null)).toBe(true);
  });
  it('the newest breadth states equal the market tab rules on the whole history', () => {
    const history = longHistory({ n: 400 }), states = breadthStates(history), rows = history.breadth.map(environmentPoint);
    expect(states.split.at(-1)).toBe(bifurcation(history).warning);
    for (const rule of environmentRules(rows)) expect(states.rules[rule.key].at(-1)).toBe(rule.judged ? rule.fired : null);
  });
  it('an invalid bar leaves its windows unjudged instead of 0 and splits the run', () => {
    const dates = weekdays('2018-01-02', 400), bars = indexBars(dates, 9);
    bars[100] = { ...bars[100], volume: 0 };
    const states = indexStates({ symbol: '^GSPC', dates, bars });
    expect(states.dd.slice(100, 126).every(value => value === null)).toBe(true);
    expect(states.dd[126]).not.toBeNull();
    expect(states.ftd.slice(0, 101 + FTD_WINDOW_SESSIONS - 1).every(value => value === null)).toBe(true);
    expect(states.ftd[100 + FTD_WINDOW_SESSIONS]).not.toBeNull();
    // Its close is still a known close, so the moving average continues.
    expect(states.ma[150]).not.toBeNull();
    const aligned = alignIndex({ symbol: '^GSPC', bars: bars.filter((_, i) => i !== 200), calendar: dates });
    expect(aligned.missing).toEqual([dates[200]]);
    expect(aligned.bars[200]).toBeNull();
    const gap = indexStates(aligned);
    expect(gap.closes[200]).toBeNull();
    expect(gap.ma.slice(200, 259).every(value => value === null)).toBe(true);
    expect(forwardOutcomes(gap.closes, 5).ret.slice(195, 201).every(value => value === null)).toBe(true);
  });
  it('marks a close more than 25% from the previous close unknown, both sides of a bad print, and lists it', () => {
    expect(IMPLAUSIBLE_MOVE).toBe(0.25);
    expect(implausibleMoves([100, 101, 1010, 102, null, 200, 201, 251.25, 188.4375])).toEqual([2, 3]);
    expect(implausibleMoves([100, 125, 93.75])).toEqual([]);
    const dates = weekdays('2014-01-02', 700), clean = indexBars(dates, 23), bad = clean.map(bar => ({ ...bar }));
    for (const key of ['open', 'high', 'low', 'close']) bad[400][key] *= 10;
    const run = bars => runStudy({ indices: { indices: [{ symbol: '^GSPC', bars }] }, calendar: dates, shifts: 120 });
    const flagged = run(bad), absent = run(clean.filter((_, i) => i !== 400 && i !== 401));
    expect(flagged.inputs.indices[0]).toMatchObject({ implausibleMoves: 2, implausibleSample: [dates[400], dates[401]], invalidBars: 0 });
    expect(flagged.notes.some(note => note.includes(`${dates[400]}, ${dates[401]}`) && /never filled/.test(note))).toBe(true);
    // The flagged sessions are unknown exactly as if the provider had omitted them.
    expect(strip(flagged.indicators)).toEqual(strip(absent.indicators));
    expect(markdownReport(flagged)).toContain('implausible moves 2');
  });
  it('a long-history state never bridges an unknown close', () => {
    const history = longHistory({ n: 420 }), gap = strip(history);
    gap.sp500[150].close = null;
    const full = breadthStates(history), states = breadthStates(gap);
    expect(states.ma.slice(150, 210).every(value => value === null)).toBe(true);
    expect(states.ma[210]).toMatchObject({ vs200: null });
    expect(states.ma[210].vsMa).not.toBeNull();
    // bifurcation needs 252 known closes: the run that starts after the gap reaches them at 150 + 252.
    expect(states.split.slice(150, 150 + 252).every(value => value === null)).toBe(true);
    expect(states.split[150 + 252]).not.toBeNull();
    expect(strip(states.ma.slice(0, 150))).toEqual(strip(full.ma.slice(0, 150)));
    const spike = strip(history);
    spike.sp500[300].close *= 10;
    const study = runStudy({ history: spike, shifts: 120 });
    expect(study.inputs.history).toMatchObject({ implausibleMoves: 2, implausibleSample: [history.sp500[300].date, history.sp500[301].date] });
    expect(study.notes.some(note => /^Long history sp500: 2 session/.test(note))).toBe(true);
  });
  it('a missing long-history input never becomes a pass: an older capture leaves the newer rules unjudged', () => {
    const states = breadthStates(longHistory({ n: 300, full: false }));
    for (const key of ['template', 'stage', 'leaders', 'breakout']) expect(states.rules[key].every(value => value === null)).toBe(true);
    expect(states.split.every(value => value === null)).toBe(true);
    const indicators = breadthIndicators(states);
    expect(indicators.find(i => i.key === 'rule.count').values.every(value => value === null)).toBe(true);
    expect(indicators.find(i => i.key === 'q.above200Percent').values.every(value => value === null)).toBe(true);
    expect(indicators.find(i => i.key === 'q.above50Percent').values.some(value => value !== null)).toBe(true);
    const study = runStudy({ history: longHistory({ n: 300, full: false }) }), byKey = key => study.indicators.find(i => i.key === key);
    expect(byKey('rule.split')).toMatchObject({ available: false, windows: null, reason: 'needs above200Percent, absent from this capture (older schema)' });
    expect(byKey('rule.count').reason).toMatch(/trendTemplateCount.*; needs the distribution count and FTD state of both indices/);
    expect(byKey('q.stageSpread').reason).toBe('needs stage2Percent, stage4Percent, absent from this capture (older schema)');
    expect(study.notes.some(note => /never 0/.test(note))).toBe(true);
  });
});

describe('bucket edges', () => {
  it('uses fixed type-7 quintiles and puts a value equal to an edge in the lower bucket', () => {
    const edges = quintileEdges([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, null, NaN]);
    [2.8, 4.6, 6.4, 8.2].forEach((value, i) => expect(edges[i]).toBeCloseTo(value, 12));
    // Exactly an edge (as computed) falls in the lower bucket; just above it, the next.
    expect([1, edges[0], edges[0] + 1e-9, edges[1], edges[2], edges[2] + 1e-9, edges[3], edges[3] + 1e-9, 10].map(value => quintileBucket(value, edges))).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
    expect([null, undefined, NaN].map(value => quintileBucket(value, edges))).toEqual([null, null, null]);
    expect(quintileEdges([1, 2, 3, 4])).toBeNull();
    expect(quintileBucket(3, null)).toBeNull();
  });
  it('bins causally: edges from the known values strictly before t, judged after the warm-up', () => {
    const warm = Array.from({ length: EDGE_WARMUP }, (_, i) => i + 1), edge = quintileEdges([...warm, 300, 0])[0];
    const values = [Number.NaN, ...warm, null, 300, 0, edge, 100];
    const { buckets, first, firstIndex, last } = causalQuintiles(values);
    expect(buckets.slice(0, EDGE_WARMUP + 2).every(value => value === null)).toBe(true);
    expect(firstIndex).toBe(EDGE_WARMUP + 2);
    // Edges at the first judged session come from the warm-up values alone, so 300 is above them all; a value
    // exactly on an edge of its earlier values falls in the lower bucket.
    expect(first).toEqual(quintileEdges(warm));
    expect(buckets.slice(EDGE_WARMUP + 2)).toEqual([4, 0, 0, quintileBucket(100, quintileEdges([...warm, 300, 0, edge]))]);
    expect(last).toEqual(quintileEdges(values));
    expect(causalQuintiles([1, 2, 3])).toMatchObject({ first: null, last: null, buckets: [null, null, null] });
  });
  it('counts episodes by gaps longer than the window', () => {
    expect(episodes([1, 2, 3, 10, 11, 30], 5)).toBe(3);
    expect(episodes([1, 2, 3, 10, 11, 30], 7)).toBe(2);
    expect(episodes([], 5)).toBe(0);
  });
});

// ---- GARCH(1,1) null: an index with volatility clustering and an indicator independent of it ------------------
function gauss(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function garchCloses(rng, n, { alpha = 0.09, beta = 0.9, vol = 0.011, drift = 0.0003 } = {}) {
  const omega = (1 - alpha - beta) * vol * vol, out = [];
  let s2 = vol * vol, e = 0, close = 1000;
  for (let i = 0; i < n; i++) { s2 = omega + alpha * e * e + beta * s2; e = Math.sqrt(s2) * gauss(rng); close *= Math.exp(drift + e); out.push(close); }
  return out;
}
const regimes = (rng, n, duration) => { let state = rng() < 0.5 ? 0 : 1; return Array.from({ length: n }, () => { if (rng() < 1 / duration) state = 1 - state; return state; }); };
const nullIndicator = (values, groups) => ({ key: 'null', buckets: Array.from({ length: groups }, (_, k) => ({ key: `b${k}`, label: `b${k}` })), values });

describe('rotation placebo', () => {
  it('spaces the grid over [M + 1, n - 1], leaving out the look-ahead shifts 1..M, and doubles the past-side stand-ins', () => {
    const M = placeboMargin();
    expect(M).toBe(FTD_WINDOW_SESSIONS + Math.max(...WINDOWS));
    const grid = placeboShifts(1270);
    expect(grid).toHaveLength(PLACEBO.shifts);
    expect([grid[0], grid.at(-1)]).toEqual([M + 1, 1269]);
    expect(grid.every((k, j) => Number.isSafeInteger(k) && (j === 0 || k > grid[j - 1]))).toBe(true);
    expect(placeboShifts(700)).toEqual(Array.from({ length: 700 - M - 1 }, (_, j) => M + 1 + j));
    expect(placeboShifts(M + 1)).toEqual([]);
    expect(placeboShifts(280)).toEqual([]);
    expect([shiftWeight(1270 - M - 1, 1270), shiftWeight(1270 - M, 1270), shiftWeight(1269, 1270)]).toEqual([1, 2, 2]);
    // The chance level reruns the labelling on shifts more than M from 0 on both sides.
    const index = nullShiftIndices(grid, 1270);
    expect(index.every(j => grid[j] > M && grid[j] < 1270 - M)).toBe(true);
    expect(index.length).toBe(grid.filter(k => k < 1270 - M).length);
  });
  it('gives a two-sided rank p and a weighted band, leaving a shift itself out of its own reference', () => {
    const unit = placeboReference([4, 1, 3, 2]);
    expect(placeboP(5, unit)).toBeCloseTo(2 / 5, 12);
    expect(placeboP(0, unit)).toBeCloseTo(2 / 5, 12);
    expect(placeboP(2.5, unit)).toBe(1);
    expect(placeboP(4, unit, 1)).toBeCloseTo(2 / 4, 12);
    expect(placeboP(Number.NaN, unit)).toBeNull();
    const weighted = placeboReference([1, 2, 3, Number.NaN], [1, 1, 2, 5]);
    expect(weighted).toMatchObject({ count: 3, total: 4 });
    expect(placeboP(3.5, weighted)).toBeCloseTo(2 / 5, 12);
    expect(placeboP(0.5, weighted)).toBeCloseTo(2 / 5, 12);
    expect([placeboQuantile(weighted, 0.05), placeboQuantile(weighted, 0.5), placeboQuantile(weighted, 0.95)]).toEqual([1, 2, 3]);
  });
  it('is deterministic and labels a real effect robust while the null shifts rarely are', () => {
    const n = 1500, closes = garchCloses(mulberry32(17), n), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(closes, h)]));
    // A state that knows the next 5 sessions (an effect by construction), persistent in 30-session stretches.
    const values = closes.map((close, t) => t + 30 < n ? (closes[t - (t % 30) + 30] > closes[t - (t % 30)] ? 0 : 1) : null);
    const indicator = nullIndicator(values, 2), a = evaluateIndicator(indicator, outcomes, {}), b = evaluateIndicator(indicator, outcomes, {});
    expect(strip(a.windows)).toEqual(strip(b.windows));
    const stat = a.windows[21].buckets[0].mean;
    expect(stat).toMatchObject({ label: 'robust' });
    expect(stat.est).toBeGreaterThan(stat.band[1]);
    expect(stat.shifts).toBe(placeboShifts(n).length);
    const codes = a.nulls.find(t => t.h === 21 && t.stat === 'mean' && t.bucket === 0).codes;
    expect(codes.length).toBe(nullShiftIndices(placeboShifts(n), n).length);
    expect(codes.filter(code => code === LABELS.indexOf('robust')).length / codes.length).toBeLessThan(0.1);
  });
  it('keeps the robust label near its nominal 5% on a GARCH(1,1) null with persistent independent states', () => {
    let judged = 0, small = 0, robust = 0;
    for (let path = 0; path < 40; path++) {
      const closes = garchCloses(mulberry32(1000 + path), 1270), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(closes, h)]));
      const rng = mulberry32(9000 + path);
      let x = 0;
      const ar = Array.from({ length: 1270 }, () => (x = 0.985 * x + gauss(rng)));
      const edges = quintileEdges(ar);
      for (const indicator of [nullIndicator(ar.map(v => quintileBucket(v, edges)), 5), nullIndicator(regimes(mulberry32(5000 + path), 1270, 60), 2)]) {
        const { windows } = evaluateIndicator(indicator, outcomes, {});
        for (const h of WINDOWS) for (const bucket of windows[h].buckets) for (const stat of STATS) {
          const value = bucket[stat];
          if (!value || value.label === 'insufficient') continue;
          judged++; if (value.p <= PLACEBO.alpha) small++; if (value.label === 'robust') robust++;
        }
      }
    }
    expect(judged).toBeGreaterThan(500);
    expect(small / judged).toBeGreaterThan(0.02);
    expect(small / judged).toBeLessThan(0.08);
    expect(robust / judged).toBeLessThan(0.07);
  }, 120000);
  it('summarizes the null count of robust labels per panel and over the shared shifts', () => {
    const panel = (name, sessions, robustAt) => {
      const shifts = placeboShifts(sessions), K = nullShiftIndices(shifts, sessions).length;
      return { name, sessions, shifts, actual: 1, nulls: [{ codes: Uint8Array.from({ length: K }, (_, j) => (robustAt(j) ? LABELS.indexOf('robust') : 0)) }] };
    };
    const result = chanceLevel([panel('index:^GSPC', 9000, j => j % 10 === 0), panel('breadth', 1270, () => false), panel('index:^IXIC', 280, () => true)], 3);
    expect(result.available).toBe(true);
    expect(result.shifts).toBe(nullShiftIndices(placeboShifts(1270), 1270).length);
    expect(result.robust.max).toBe(1);
    expect(result.clears).toBe(true);
    expect(result.panels.find(p => p.panel === 'index:^IXIC')).toMatchObject({ shifts: 0, robust: null });
    expect(result.groups.max).toBe(1);
    expect(chanceLevel([panel('index:^IXIC', 280, () => true)], 0)).toMatchObject({ available: false, clears: null });
  });
});

describe('one test per comparison', () => {
  it('tests a two-state indicator once, as the first state minus the second', () => {
    const n = 1500, closes = garchCloses(mulberry32(8), n), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(closes, h)]));
    const values = regimes(mulberry32(9), n, 20), { windows, nulls } = evaluateIndicator(nullIndicator(values, 2), outcomes, {});
    for (const h of WINDOWS) {
      const [first, second] = windows[h].buckets;
      expect(first.mean.est).toBeCloseTo(first.meanReturn - second.meanReturn, 5);
      expect(first.dd5.est).toBeCloseTo(first.pDd5 - second.pDd5, 3);
      expect([second.mean, second.dd5]).toEqual([null, null]);
    }
    expect(nulls.map(t => [t.h, t.bucket, t.stat])).toEqual(WINDOWS.flatMap(h => STATS.map(stat => [h, 0, stat])));
    const three = evaluateIndicator(nullIndicator(values.map((v, t) => (t % 3 ? v : 2)), 3), outcomes, {});
    expect(three.windows[21].buckets.map(b => b.role)).toEqual(['vs-baseline', 'vs-baseline', 'vs-baseline']);
    expect(three.windows[21].buckets[2].mean.est).toBeCloseTo(three.windows[21].buckets[2].meanReturn - three.windows[21].baseline.meanReturn, 5);
  });
  it('embargoes h sessions between the halves, so no first-half outcome window reaches a second-half close', () => {
    const n = 1500, closes = garchCloses(mulberry32(12), n), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(closes, h)]));
    const dates = weekdays('2015-01-02', n), { windows } = evaluateIndicator(nullIndicator(regimes(mulberry32(13), n, 20), 2), outcomes, { dates });
    for (const h of WINDOWS) {
      const win = windows[h], h1 = win.buckets.reduce((a, b) => a + b.h1n, 0), h2 = win.buckets.reduce((a, b) => a + b.h2n, 0);
      // A contiguous sample: the first half ends at session h1 - 1, the second starts h sessions after the plain midpoint.
      expect(win.embargoed).toBe(h);
      expect([h1, h1 + h + h2]).toEqual([Math.floor(win.n / 2), win.n]);
      expect(win.split).toBe(dates[h1 + h]);
      expect(dates.indexOf(win.split) - (h1 - 1)).toBeGreaterThan(h);
    }
  });
  it('groups labels whose indicators share an input, across indices and the long history', () => {
    expect(indicatorInputs('^GSPC.ma50')).toEqual(indicatorInputs('spx.ma50'));
    expect(indicatorInputs('^IXIC.ma.quadrant')).toEqual(['index:ma50', 'index:ma200']);
    expect(indicatorInputs('q.netHighsPercent')).toEqual(indicatorInputs('rule.lows'));
    expect(indicatorInputs('d21.above50Percent')).toEqual(['breadth:above50']);
    expect(inputGroups([indicatorInputs('^GSPC.ma50'), indicatorInputs('^IXIC.ma200'), indicatorInputs('spx.ma.quadrant'), indicatorInputs('q.ratio_10day'), indicatorInputs('combo.washout_uptrend'), indicatorInputs('q.above50Percent')]))
      .toEqual([1, 1, 1, 2, 1, 1]);
    expect(inputGroups([indicatorInputs('^GSPC.dd.binary'), indicatorInputs('q.ratio_10day')])).toEqual([1, 2]);
    for (const indicator of [...indexIndicators(indexStates({ symbol: '^GSPC', dates: weekdays('2019-01-02', 300), bars: indexBars(weekdays('2019-01-02', 300)) })), ...breadthIndicators(breadthStates(longHistory({ n: 300 })))])
      expect(indicator.inputs.every(input => /^(?:index|breadth):/.test(input))).toBe(true);
  });
});

describe('pre-registered labels', () => {
  const part = (est, sufficient = true) => ({ sufficient, est });
  it('marks robust only when the placebo p is small and both halves have the full-sample sign', () => {
    const ok = { p: 0.01, shifts: 399 };
    expect(label({ full: part(0.01), h1: part(0.012), h2: part(0.004), ...ok })).toBe('robust');
    expect(label({ full: part(-0.01), h1: part(-0.012), h2: part(-0.004), ...ok })).toBe('robust');
    expect(label({ full: part(0.01), h1: part(0.012), h2: part(0.004), p: 0.06, shifts: 399 })).toBe('weak');
    expect(label({ full: part(0.01), h1: part(0.012), h2: part(0), ...ok })).toBe('weak');
    expect(label({ full: part(0.001), h1: part(0.01), h2: part(-0.01), ...ok })).toBe('unstable');
    expect(label({ full: part(0.01), h1: part(0.012, false), h2: part(0.004), ...ok })).toBe('insufficient');
    expect(label({ full: part(0.01), h1: part(0.012), h2: part(0.004), p: 0.01, shifts: PLACEBO.minShifts - 1 })).toBe('insufficient');
    expect(label({ full: part(0.01), h1: part(0.012), h2: part(0.004), p: null, shifts: 399 })).toBe('insufficient');
  });
  it('needs 10 blocks of max(2h, 21) sessions in each half, so h = 63 is insufficient on a 5-year panel', () => {
    expect(MIN_BLOCKS).toBe(10);
    const n = 1270, closes = garchCloses(mulberry32(3), n), outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(closes, h)]));
    const { windows } = evaluateIndicator(nullIndicator(regimes(mulberry32(4), n, 20), 2), outcomes, {});
    expect(windows[63].partMinimum).toBe(1260);
    expect(STATS.every(stat => windows[63].buckets[0][stat].label === 'insufficient')).toBe(true);
    expect(STATS.some(stat => windows[21].buckets[0][stat].label !== 'insufficient')).toBe(true);
  });
});

describe('provider input', () => {
  const chart = (symbol, stamps, extra = {}) => JSON.stringify({ chart: { result: [{ meta: { symbol, instrumentType: 'INDEX', ...extra }, timestamp: stamps,
    indicators: { quote: [{ open: stamps.map(() => 10), high: stamps.map(() => 11), low: stamps.map(() => 9), close: stamps.map(() => 10.5), volume: stamps.map(() => 5) }] } }] } });
  const at = iso => Date.parse(iso) / 1000;
  it('dates bars by the New York session and drops bars after the as-of date', () => {
    const bars = parseYahooChart(chart('^GSPC', [at('2026-11-02T14:30:00Z'), at('2026-11-03T14:30:00Z'), at('2026-11-04T14:30:00Z')]), '^GSPC', '2026-11-03');
    expect(bars.map(bar => bar.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(() => parseYahooChart(chart('^IXIC', [at('2026-11-02T14:30:00Z')]), '^GSPC', '2026-11-03')).toThrow(/identity/);
    expect(() => parseYahooChart(chart('^GSPC', [at('2026-11-02T14:30:00Z')], { instrumentType: 'EQUITY' }), '^GSPC', '2026-11-03')).toThrow(/identity/);
    expect(() => parseYahooChart(chart('^GSPC', [at('2026-11-02T14:30:00Z'), at('2026-11-02T15:30:00Z')]), '^GSPC', '2026-11-03')).toThrow(/duplicate/);
  });
  it('retries a rate-limited request with a generic user agent and records the response hash', async () => {
    const raw = chart('^GSPC', [at('2026-11-02T14:30:00Z')]), calls = [];
    const fetchImpl = async (url, options) => { calls.push({ url, ua: options.headers['User-Agent'] }); return calls.length === 1 ? { ok: false, status: 429 } : { ok: true, status: 200, arrayBuffer: async () => Buffer.from(raw) }; };
    const result = await fetchYahooIndex('^GSPC', { asOfDate: '2026-11-03', fetchImpl, sleep: async () => {} });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${at('1990-01-01T00:00:00Z')}&period2=${at('2026-11-04T00:00:00Z')}&interval=1d`);
    expect(calls[0].ua).toBe('Mozilla/5.0');
    expect(result.provenance.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    await expect(fetchYahooIndex('^GSPC', { asOfDate: '2026-11-03', fetchImpl: async () => ({ ok: false, status: 404 }), sleep: async () => {} })).rejects.toThrow(/HTTP 404/);
  });
});

describe('published long history', () => {
  it('reads a static-data root through the content-addressed series and history source, and fails closed on a changed byte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'market-regime-root-'));
    try {
      const history = longHistory({ n: 120 }), raw = JSON.stringify(history), rawSha = createHash('sha256').update(raw).digest('hex');
      const series = JSON.stringify({ schema_version: 'market-trends-v1', market: 'US', as_of_date: history.as_of_date, long_history: { ...history, source_sha256: rawSha } });
      const seriesSha = createHash('sha256').update(series).digest('hex');
      mkdirSync(join(root, 'market-trends'));
      writeFileSync(join(root, 'market-trends', `history-source-${rawSha}.json`), raw);
      writeFileSync(join(root, 'market-trends', `series-${seriesSha}.json`), series);
      writeFileSync(join(root, 'manifest.json'), JSON.stringify({ markets: { US: { as_of_date: history.as_of_date, assets: { market_trends: { path: `market-trends/series-${seriesSha}.json`, sha256: seriesSha } } } } }));
      const loaded = await loadHistory(root);
      expect(loaded).toMatchObject({ sha256: rawSha, publicationDate: history.as_of_date, origin: `market-trends/series-${seriesSha}.json -> market-trends/history-source-${rawSha}.json` });
      expect(loaded.history).toEqual(history);
      rmSync(join(root, 'market-trends', `history-source-${rawSha}.json`));
      const embedded = await loadHistory(root);
      expect(embedded.origin).toMatch(/raw source file absent/);
      expect(embedded.history).toEqual(history);
      writeFileSync(join(root, 'market-trends', `history-source-${rawSha}.json`), `${raw} `);
      await expect(loadHistory(root)).rejects.toThrow(/content address mismatch/);
      writeFileSync(join(root, 'market-trends', `series-${seriesSha}.json`), `${series} `);
      await expect(loadHistory(root)).rejects.toThrow(/series content address mismatch/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('study and CLI on synthetic inputs', () => {
  it('runs end to end, states its test count, and never reports a fabricated bucket', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'market-regime-study-'));
    try {
      const history = longHistory({ n: 420 }), dates = history.calendar.sessions;
      const indices = { schema_version: 'market-regime-indices-v1', as_of_date: dates.at(-1), indices: ['^GSPC', '^IXIC'].map((symbol, i) => ({ symbol, source: 'synthetic', bars: indexBars(dates, 30 + i) })) };
      writeFileSync(join(directory, 'history.json'), JSON.stringify(history));
      writeFileSync(join(directory, 'indices.json'), JSON.stringify(indices));
      const study = await main(['--history', join(directory, 'history.json'), '--indices', join(directory, 'indices.json'), '--out', join(directory, 'out.json'), '--markdown', join(directory, 'out.md'), '--shifts', '120', '--label', 'synthetic']);
      const saved = JSON.parse(readFileSync(join(directory, 'out.json'), 'utf8')), markdown = readFileSync(join(directory, 'out.md'), 'utf8');
      expect(saved.schema_version).toBe('market-regime-study-v2');
      const available = saved.indicators.filter(i => i.available);
      expect(saved.tests.tests).toBe(available.reduce((a, i) => a + (i.buckets.length === 2 ? 1 : i.buckets.length), 0) * WINDOWS.length * 2);
      expect(saved.tests.indicatorLevel).toBe(available.length * WINDOWS.length * 2);
      // 420 sessions leave fewer than PLACEBO.minShifts shifts: the chance level is unavailable and every test insufficient.
      expect(saved.tests.chance).toMatchObject({ available: false, shifts: 0 });
      expect(saved.tests.labels.insufficient).toBe(saved.tests.tests);
      expect(markdown).toContain('Chance level: unavailable');
      expect(Object.values(saved.tests.labels).reduce((a, b) => a + b, 0)).toBe(saved.tests.tests);
      expect(saved.inputs.indices.map(i => i.calendarBasis)).toEqual(['provider', 'provider']);
      expect(saved.notes.some(note => /no independent calendar/.test(note))).toBe(true);
      for (const indicator of saved.indicators.filter(i => i.available)) for (const h of WINDOWS) {
        const window = indicator.windows[h];
        expect(window.buckets.reduce((a, b) => a + b.n, 0)).toBe(window.n);
        for (const bucket of window.buckets) if (!bucket.n && bucket.mean) expect([bucket.meanReturn, bucket.mean.est, bucket.dd5.est, bucket.mean.p, bucket.mean.label]).toEqual([null, null, null, null, 'insufficient']);
        // A two-state indicator carries one contrast on its first state; the second is its complement, untested.
        if (indicator.buckets.length === 2) expect(window.buckets.map(b => [b.role, b.mean === null, b.dd5 === null])).toEqual([['contrast', false, false], ['complement', true, true]]);
        else expect(window.buckets.every(b => b.role === 'vs-baseline' && b.mean && b.dd5)).toBe(true);
      }
      expect(saved.indicators.find(i => i.key === 'rule.count').available).toBe(true);
      expect(saved.survivorship.byYear.map(y => y.year)).toEqual(['2019', '2020']);
      for (const heading of ['## Inputs', '## Tests and chance level', '## Labels passing the split rule', '## Survivorship diagnostics', '## All indicators', '`^IXIC.ftd.state`', '`d21.stageSpread`']) expect(markdown).toContain(heading);
      expect(markdown).not.toMatch(/expected by chance alone|90% CI|bootstrap/);
      expect(strip(runStudy({ history, indices, shifts: 120 }).indicators.map(i => i.key))).toEqual(saved.indicators.map(i => i.key));
      await expect(main(['--history', join(directory, 'history.json'), '--shifts', '20'])).rejects.toThrow(/--shifts/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
