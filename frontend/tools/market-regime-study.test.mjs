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
  alignIndex, blockBootstrap, breadthIndicators, breadthStates, episodes, evaluateIndicator, fetchYahooIndex, fnv1a, forwardOutcomes,
  indexIndicators, indexStates, interval, label, loadHistory, main, mulberry32, parseYahooChart, quintileBucket, quintileEdges, runStudy, FTD_WINDOW_SESSIONS, WINDOWS,
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
  it('a missing long-history input never becomes a pass: an older capture leaves the newer rules unjudged', () => {
    const states = breadthStates(longHistory({ n: 300, full: false }));
    for (const key of ['template', 'stage', 'leaders', 'breakout']) expect(states.rules[key].every(value => value === null)).toBe(true);
    expect(states.split.every(value => value === null)).toBe(true);
    const indicators = breadthIndicators(states);
    expect(indicators.find(i => i.key === 'rule.count').values.every(value => value === null)).toBe(true);
    expect(indicators.find(i => i.key === 'q.above200Percent').values.every(value => value === null)).toBe(true);
    expect(indicators.find(i => i.key === 'q.above50Percent').values.some(value => value !== null)).toBe(true);
    const study = runStudy({ history: longHistory({ n: 300, full: false }), replicates: 100 }), byKey = key => study.indicators.find(i => i.key === key);
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
  it('counts episodes by gaps longer than the window', () => {
    expect(episodes([1, 2, 3, 10, 11, 30], 5)).toBe(3);
    expect(episodes([1, 2, 3, 10, 11, 30], 7)).toBe(2);
    expect(episodes([], 5)).toBe(0);
  });
});

describe('bootstrap', () => {
  const y = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i / 7) + (i % 3) / 10);
  const group = Int32Array.from({ length: 400 }, (_, i) => (i % 50 < 20 ? 0 : 1));
  const run = key => blockBootstrap({ ys: [y], group, groups: 2, block: 21, replicates: 300, rng: mulberry32(fnv1a(key)) });
  it('is deterministic for a seed and key, and changes with the key', () => {
    expect(Array.from(run('20261104|x|5|full')[0][0])).toEqual(Array.from(run('20261104|x|5|full')[0][0]));
    expect(Array.from(run('20261104|x|5|full')[0][0])).not.toEqual(Array.from(run('20261104|x|5|h1')[0][0]));
    expect(fnv1a('20261104|x|5|full')).toBe(fnv1a('20261104|x|5|full'));
  });
  it('gives a zero difference for a constant outcome and for a bucket that is the whole sample', () => {
    const flat = blockBootstrap({ ys: [new Float64Array(200).fill(0.01)], group: new Int32Array(200), groups: 1, block: 21, replicates: 100, rng: mulberry32(1) });
    expect(Array.from(flat[0][0]).every(value => Math.abs(value) < 1e-12)).toBe(true);
    expect(interval(flat[0][0]).map(value => Math.abs(value) < 1e-12)).toEqual([true, true]);
  });
  it('drops replicates that miss a bucket and withholds a CI when too many do', () => {
    const rare = Int32Array.from({ length: 400 }, (_, i) => (i === 3 ? 0 : 1));
    const reps = blockBootstrap({ ys: [y], group: rare, groups: 2, block: 21, replicates: 200, rng: mulberry32(2) });
    expect(Array.from(reps[0][0]).some(Number.isNaN)).toBe(true);
    expect(interval(reps[0][0])).toBeNull();
  });
  it('evaluates an indicator identically on repeated runs', () => {
    const dates = weekdays('2018-01-02', 600), bars = indexBars(dates, 21), states = indexStates({ symbol: '^GSPC', dates, bars });
    const outcomes = Object.fromEntries(WINDOWS.map(h => [h, forwardOutcomes(states.closes, h)]));
    const indicator = indexIndicators(states).find(i => i.key === '^GSPC.ma50');
    const a = evaluateIndicator(indicator, outcomes, { replicates: 200, dates }), b = evaluateIndicator(indicator, outcomes, { replicates: 200, dates });
    expect(a).toEqual(b);
    expect(a[21].buckets[0].mean.ci).not.toBeNull();
    expect(a[21].buckets[0].n + a[21].buckets[1].n).toBe(a[21].n);
  });
});

describe('pre-registered labels', () => {
  const part = (est, ci, n = 50, ep = 5) => ({ n, episodes: ep, est, ci });
  it('marks robust only when both halves exclude 0 with the same sign', () => {
    expect(label({ full: part(0.01, [0.004, 0.02]), h1: part(0.01, [0.002, 0.02]), h2: part(0.012, [0.001, 0.02]) })).toBe('robust');
    expect(label({ full: part(-0.01, [-0.02, -0.004]), h1: part(-0.01, [-0.02, -0.002]), h2: part(-0.012, [-0.02, -0.001]) })).toBe('robust');
    expect(label({ full: part(0.01, [0.004, 0.02]), h1: part(0.01, [0.002, 0.02]), h2: part(0.004, [-0.001, 0.01]) })).toBe('weak');
    expect(label({ full: part(0.001, [-0.004, 0.006]), h1: part(0.01, [0.002, 0.02]), h2: part(-0.01, [-0.02, -0.001]) })).toBe('unstable');
    expect(label({ full: part(0.01, [0.004, 0.02]), h1: part(0.01, [0.002, 0.02], 19), h2: part(0.012, [0.001, 0.02]) })).toBe('insufficient');
    expect(label({ full: part(0.01, [0.004, 0.02]), h1: part(0.01, [0.002, 0.02], 50, 2), h2: part(0.012, [0.001, 0.02]) })).toBe('insufficient');
    expect(label({ full: part(0.01, null), h1: part(0.01, [0.002, 0.02]), h2: part(0.012, [0.001, 0.02]) })).toBe('insufficient');
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
      const study = await main(['--history', join(directory, 'history.json'), '--indices', join(directory, 'indices.json'), '--out', join(directory, 'out.json'), '--markdown', join(directory, 'out.md'), '--replicates', '200', '--label', 'synthetic']);
      const saved = JSON.parse(readFileSync(join(directory, 'out.json'), 'utf8')), markdown = readFileSync(join(directory, 'out.md'), 'utf8');
      expect(saved.schema_version).toBe('market-regime-study-v1');
      expect(saved.tests.tests).toBe(saved.indicators.filter(i => i.available).reduce((a, i) => a + i.buckets.length, 0) * WINDOWS.length * 2);
      expect(Object.values(saved.tests.labels).reduce((a, b) => a + b, 0)).toBe(saved.tests.tests);
      expect(saved.inputs.indices.map(i => i.calendarBasis)).toEqual(['provider', 'provider']);
      expect(saved.notes.some(note => /no independent calendar/.test(note))).toBe(true);
      for (const indicator of saved.indicators.filter(i => i.available)) for (const h of WINDOWS) {
        const window = indicator.windows[h];
        expect(window.buckets.reduce((a, b) => a + b.n, 0)).toBe(window.n);
        for (const bucket of window.buckets) if (!bucket.n) expect([bucket.meanReturn, bucket.mean.est, bucket.dd5.est, bucket.mean.label]).toEqual([null, null, null, 'insufficient']);
      }
      expect(saved.indicators.find(i => i.key === 'rule.count').available).toBe(true);
      expect(saved.survivorship.byYear.map(y => y.year)).toEqual(['2019', '2020']);
      for (const heading of ['## Inputs', '## Tests and labels', '## Robust effects', '## Survivorship diagnostics', '## All indicators', '`^IXIC.ftd.state`', '`d21.stageSpread`']) expect(markdown).toContain(heading);
      expect(strip(runStudy({ history, indices, replicates: 100 }).indicators.map(i => i.key))).toEqual(saved.indicators.map(i => i.key));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
