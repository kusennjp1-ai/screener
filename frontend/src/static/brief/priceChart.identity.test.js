// @vitest-environment node
// (The browser fixture reads its session calendar with node:fs, which needs Node's URL: priceChart.test.js renders under
// jsdom, so this file draws into a jsdom document of its own.)
// Round 3 C1: the chart's speed-ups change no byte. Every chart is drawn twice, as the app draws it and with the test-only
// `reference` option (every shortcut bypassed), and the two must be identical: the markup (the per-render uid aside), the
// aria-label, the legend the card keeps and the corner it offers 「最新足」. The charts: every fixture stock and oracle chart
// (tests/static/brief-fixture.js) × the 4 periods × the plot sizes the app gives the chart at 320, 375, 390 and 1440, and
// crowded charts that send the averages' names through every retry. The models are built here from each fixture row and
// its bars (levels from the Setup Engine pivot, contractions measured on the bars): close to what the stock screen draws,
// not its exact plan (the browser probes check that).
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { charts, date, ORACLE_CHARTS, ORACLE_ROWS, rows } from '../../../tests/static/brief-fixture.js';
import { buildBookTechnicalEvidence } from '../bookTechnicalEvidence';
import { gapDays, rsLeadMarks } from './briefChartModel';
import { crossingFloor } from './breakoutHistory';
import { CHART_RANGES, chartCrossing, shortAveragesShown } from './chartReadout';

// How often the names were tried again, and how often the chart was laid out again for a level's name (`carry`): the
// placer the renderer makes is watched (it is the real one).
const seen = vi.hoisted(() => ({ placers: 0, restores: 0 }));
vi.mock('./chartLabels', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, labelPlacer: options => { seen.placers++; const placer = actual.labelPlacer(options); return { ...placer, restore: state => { seen.restores++; return placer.restore(state); } }; } };
});
const { renderPriceChart } = await import('./priceChart');

const { document } = new JSDOM('<!doctype html><html><body></body></html>').window;
// The chart's box at each width (the stock screen's, as the browser lays it out).
const SIZES = { 320: [262, 292], 375: [317, 340], 390: [332, 340], 1440: [926, 470] };
const container = (w, h) => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: w });
  Object.defineProperty(el, 'clientHeight', { value: h });
  document.body.appendChild(el);
  return el;
};
/** One chart as the app draws it (or with `reference`), and what the screen reads of it. */
function draw(model, period, [w, h], extra = {}) {
  const el = container(w, h);
  const before = { ...seen };
  const chart = renderPriceChart(el, model, { period, animate: false, ...extra });
  const out = {
    html: el.outerHTML.replace(/brief-chart-\d+/g, 'brief-chart-#'), aria: el.getAttribute('aria-label'), legend: chart?.legend ?? null,
    corners: chart ? [chart.freeCorner(72, 44), chart.freeCorner(120, 30)] : null,
    forcedNames: el.querySelectorAll('.bc-malabel[data-forced="1"]').length, retries: seen.restores - before.restores, layouts: seen.placers - before.placers,
  };
  el.remove();
  return out;
}

const finite = Number.isFinite;
/** A chart model from a fixture row and its bars: the Setup Engine pivot and a plan around it, the measured contractions. */
function modelOf(row, payload) {
  const bars = payload.bars, pivot = row.se_pivot_price;
  const vcp = buildBookTechnicalEvidence(row, payload, date).vcp, legs = vcp?.measurementsValid ? vcp.legs : [];
  const stop = pivot * 0.93, entry = pivot * 1.004, highs = bars.slice(-252).map(b => b.high).filter(finite);
  const last = legs.at(-1);
  return {
    symbol: row.symbol, bars, rsLine: payload.rs_line || [], rsReason: null, legs, legsValid: Boolean(vcp?.measurementsValid), pivot, upper: pivot * 1.05,
    stop, entry, r2: entry + 2 * (entry - stop), r3: entry + 3 * (entry - stop), structuralLow: last?.low ?? Math.min(...bars.slice(-10).map(b => b.low)),
    auditHigh: highs.length ? Math.max(...highs) : null, rsNewHigh: false, rsLead: rsLeadMarks(payload.rs_line || [], bars), gaps: gapDays(bars), earnings: null,
    crossing: chartCrossing(bars, pivot, { from: crossingFloor(bars, row) }), dryUpLeg: finite(last?.volumeEvidence?.intervalRatio) && last.volumeEvidence.intervalRatio < 1 ? last : null, sellMarks: [],
  };
}
const fileOf = row => row.chart_path.split('/').pop();
const STOCKS = [...rows.map(row => [row, charts[fileOf(row)]]), ...ORACLE_ROWS.filter(row => row.chart_path && ORACLE_CHARTS[fileOf(row)]).map(row => [row, ORACLE_CHARTS[fileOf(row)]])];

// Crowded charts (as priceChart.test.js builds them): every bar spanning the plot (names forced), a flat finish under four
// tall bars (names moved with a leader), and two lines ending at one point under eight tall bars (one shared leader).
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const base = Array.from({ length: 300 }, (_, i) => { const c = 50 + i * 0.2 + Math.sin(i / 6); return { date: day(i), open: c - 0.3, high: c + 1, low: c - 1, close: c, volume: 1000 + (i % 7) * 100 }; });
const synthetic = {
  symbol: 'TEST', bars: base, rsLine: base.map((b, i) => ({ time: b.date, value: 100 + i * 0.1 })), pivot: 108, upper: 113.4, stop: 100.4, entry: 108, rsNewHigh: true,
  legs: [{ startDate: day(220), endDate: day(245), high: 108, low: 95, depthPct: 12 }, { startDate: day(250), endDate: day(275), high: 108, low: 102, depthPct: 5.6 }], legsValid: true,
};
const flat = from => base.map((b, i) => (i > from ? { ...b, open: 90, high: 91.5, low: 88.5, close: 90 } : b));
const CROWDED = {
  wall: { ...synthetic, bars: base.map(b => ({ ...b, open: 90, close: 91, high: 125, low: 60 })), pivot: 100, upper: 110, stop: 93, legs: [] },
  tall: { ...synthetic, bars: flat(200).map((b, i) => (i >= base.length - 4 ? { ...b, high: 112, low: 70 } : b)), pivot: 92, upper: 96.6, stop: 85, legs: [] },
  capped: { ...synthetic, bars: flat(140).map((b, i) => (i >= base.length - 8 ? { ...b, high: 112, low: 89.6 } : b)), pivot: 92, upper: 96.6, stop: 85, legs: [] },
  levels: { ...synthetic, structuralLow: 104, auditHigh: 111, r2: 123.2, r3: 130.8, entry: 108.6 },
};

const tally = { charts: 0, retried: 0, replayed: 0, forcedNames: 0, carried: 0 };
const views = model => Object.entries(SIZES).flatMap(([width, size]) => Object.values(CHART_RANGES).map(([period, interval]) => ({
  width, size, period, model: { ...model, interval, short: shortAveragesShown(interval, period, Number(width) >= 1024) } })));
function same(label, list) {
  for (const { width, period, size, model } of list) {
    const fast = draw(model, period, size), plain = draw(model, period, size, { reference: true });
    const where = `${label} ${width} ${period}`;
    expect({ where, html: fast.html }).toEqual({ where, html: plain.html });
    expect({ where, aria: fast.aria, legend: fast.legend, corners: fast.corners }).toEqual({ where, aria: plain.aria, legend: plain.legend, corners: plain.corners });
    // The reference path tried the names as often, and laid the chart out as often.
    expect({ where, retries: fast.retries, layouts: fast.layouts }).toEqual({ where, retries: plain.retries, layouts: plain.layouts });
    tally.charts++;
    if (fast.retries) tally.retried++;
    // Three tries and the best of them again (none of the three left every name placed clear of the candles).
    if (fast.retries === 4) tally.replayed++;
    if (fast.forcedNames) tally.forcedNames++;
    if (fast.layouts > 1) tally.carried++;
  }
  return list.length;
}

describe('the price chart draws the same with and without its speed-ups (C1)', () => {
  for (const [row, payload] of STOCKS) {
    it(`${row.symbol}: every period at 320, 375, 390 and 1440`, () => { expect(same(row.symbol, views(modelOf(row, payload)))).toBe(16); }, 120000);
  }
  for (const [name, model] of Object.entries(CROWDED)) {
    it(`a crowded chart (${name}): every period at 320, 375, 390 and 1440`, () => { expect(same(name, views(model))).toBe(16); }, 120000);
  }
  // Last (the tests run in order): the matrix reached every path a shortcut is on, names tried again, all three tries
  // then the best again, names over candles, and a second layout for a level's name.
  it('reached the retries, the replay, forced names and a second layout', () => {
    expect(tally.charts).toBe((STOCKS.length + Object.keys(CROWDED).length) * 16);
    expect(tally).toEqual({ ...tally, retried: expect.any(Number), replayed: expect.any(Number), forcedNames: expect.any(Number), carried: expect.any(Number) });
    for (const key of ['retried', 'replayed', 'forcedNames', 'carried']) expect({ key, n: tally[key] > 0 }).toEqual({ key, n: true });
  });
});
