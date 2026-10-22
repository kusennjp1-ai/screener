import { afterEach, describe, expect, it, vi } from 'vitest';
import { CandlestickSeries, LineSeries, createChart } from 'lightweight-charts';
import { VcpBoxPrimitive } from './vcpBoxPrimitive';

const date = n => new Date(Date.UTC(2024, 0, 1 + n)).toISOString().slice(0, 10);
const candles = Array.from({ length: 360 }, (_, i) => ({ time: date(i * 2), open: 100 + i % 20, high: 130 + i % 20, low: 80 + i % 20, close: 110 + i % 20 }));
const boxes = [
  { start: date(360), end: date(500), high: 150, low: 70, label: 'base' },
  { start: date(500), end: date(600), high: 148, low: 90, recoveryDate: date(700), recoveryHigh: 140, curve: true, label: 'C1' },
  { start: date(700), end: date(700), high: 150, low: 100, arrow: true, label: 'event' },
];
const series = { priceToCoordinate: price => price == null ? null : 350 - price * 2 };

// The pre-change full scan, kept independent of the new time-bound filter.
function originalCandles(rows, scale, priceSeries) {
  const spacing = scale.options?.().barSpacing;
  const candleWidth = Number.isFinite(spacing) && spacing > 0 ? Math.max(1, spacing) : 8;
  return rows.map(candle => {
    const x = scale.timeToCoordinate(candle.time ?? candle.date);
    if (x == null || x < -candleWidth / 2 || x > scale.width() + candleWidth / 2) return null;
    const high = priceSeries.priceToCoordinate(candle.high), low = priceSeries.priceToCoordinate(candle.low);
    return high == null || low == null ? null : { x: x - candleWidth / 2, y: Math.min(high, low), width: candleWidth, height: Math.max(1, Math.abs(low - high)) };
  }).filter(Boolean);
}

function commands(view, width, dpr) {
  const result = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 6 * dpr }) }, {
    get: (target, key) => target[key] ?? ((...args) => result.push([key, ...args])),
    set: (target, key, value) => { result.push(['set', key, value]); target[key] = value; return true; },
  });
  view.renderer().draw({ useBitmapCoordinateSpace: draw => draw({ context, horizontalPixelRatio: dpr, verticalPixelRatio: dpr, bitmapSize: { width: width * dpr, height: 400 * dpr } }) });
  return result;
}

function check(rows, scale, priceSeries = series, shapes = boxes) {
  const expected = originalCandles(rows, scale, priceSeries);
  const primitive = new VcpBoxPrimitive(shapes, rows);
  primitive.attached({ chart: { timeScale: () => scale }, series: priceSeries });
  const view = primitive.paneViews()[0];
  expect(view._candles).toEqual(expected);
  // Disable only the newly introduced bounds for the reference renderer.
  const originalScale = Object.create(scale);
  originalScale.coordinateToTime = undefined;
  const reference = new VcpBoxPrimitive(shapes, rows);
  reference.attached({ chart: { timeScale: () => originalScale }, series: priceSeries });
  expect(view._rects).toEqual(reference.paneViews()[0]._rects);
  for (const dpr of [1, 1.25, 2]) expect(commands(view, scale.width(), dpr)).toEqual(commands(reference.paneViews()[0], scale.width(), dpr));
  return primitive;
}

function syntheticScale({ width = 300, spacing = 10, right = 250, times = candles.map(c => c.time) } = {}) {
  const key = time => typeof time === 'object' && time ? `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}` : time;
  const indexes = new Map(times.map((time, i) => [key(time), i]));
  return {
    width: () => width, options: () => ({ barSpacing: spacing }),
    timeToCoordinate: vi.fn(time => indexes.has(key(time)) ? width - (right - indexes.get(key(time)) + .5) * spacing - 1 : null),
    coordinateToTime: vi.fn(x => times[Math.ceil(Math.round((right - (width - 1 - x) / spacing) * 1e6) / 1e6)] ?? null),
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('annotation candle time bounds', () => {
  it('preserves full-scan coordinates and drawing commands across pan/zoom/resize and unordered rows', () => {
    expect.hasAssertions();
    const shuffled = candles.filter((_, i) => i % 2).concat(candles.filter((_, i) => !(i % 2)));
    for (const width of [64, 390, 1440]) for (const spacing of [.1, .5, 1, 7.75, 40, 120]) for (const right of [-10, .5, 180, 250.25, 359, 400]) {
      check(shuffled, syntheticScale({ width, spacing, right }));
    }
  });

  it('keeps inclusive half-bar boundaries and rejects only the next outside centers', () => {
    // Binary-exact inputs: index220 is -16 and index229 is width+16.
    const scale = syntheticScale({ width: 256, spacing: 32, right: 227.96875 });
    const expected = originalCandles(candles, scale, series);
    const primitive = check(candles, scale);
    expect(expected.some(c => c.x === -32)).toBe(true);
    expect(expected.some(c => c.x === 256)).toBe(true);
    expect(primitive.paneViews()[0]._candles).toHaveLength(10);
  });

  it('reduces expensive conversions without dropping missing times or missing price results', () => {
    const rows = candles.map((c, i) => i === 245 ? { ...c, high: null } : c).concat({ time: date(501), high: 140, low: 80 });
    const scale = syntheticScale();
    const expected = originalCandles(rows, scale, series);
    scale.timeToCoordinate.mockClear();
    const primitive = new VcpBoxPrimitive(boxes, rows);
    primitive.attached({ chart: { timeScale: () => scale }, series });
    expect(primitive.paneViews()[0]._candles).toEqual(expected);
    expect(scale.timeToCoordinate.mock.calls.length).toBeLessThan(60);
    expect(scale.coordinateToTime).toHaveBeenCalledTimes(2);
  });

  it('passes unsupported or invalid dates through the original conversion, including date fallback', () => {
    const rows = ['2024-02-29', '2024-02-30', '2023-02-29', '1900-02-29', '2000-02-29', '0099-01-01', '2024-2-01', 'no-date', 1700000000, null,
      { year: 2024, month: 2, day: 29 }, { year: 2024, month: 2, day: 30 }, { year: 2024, month: 13, day: 1 }].map(time => ({ time, date: '2024-02-29', high: 100, low: 80 }));
    const scale = { width: () => 300, options: () => ({ barSpacing: 10 }), coordinateToTime: x => x < 0 ? '2024-02-01' : { year: 2024, month: 3, day: 1 }, timeToCoordinate: vi.fn(time => time === '2000-02-29' ? -100 : 100) };
    const primitive = check(rows, scale, series, [{ start: '2024-02-01', end: '2024-03-01', high: 110, low: 70 }]);
    scale.timeToCoordinate.mockClear(); primitive.updateAllViews();
    // A valid 2000 leap day is safely culled; all invalid/unsupported values
    // must still reach the original API, even when that API returns null/throws.
    for (const time of ['2024-02-30', '2023-02-29', '1900-02-29', '0099-01-01', '2024-2-01', 'no-date', 1700000000]) expect(scale.timeToCoordinate).toHaveBeenCalledWith(time);
    scale.timeToCoordinate.mockImplementation(time => { if (time === 'no-date') throw Error('invalid date'); return 100; });
    expect(() => primitive.updateAllViews()).toThrow('invalid date');
  });

  it('keeps the original handling of invalid strings inside the bounds without coercing object dates', () => {
    const objectDay = { year: 2024, month: 2, day: 29, [Symbol.toPrimitive]: () => { throw Error('unexpected date coercion'); } };
    const rows = ['2024-02-29', '2024-02-30', '2024-02-1x', objectDay].map(time => ({ time, high: 100, low: 80 }));
    const scale = {
      width: () => 300, options: () => ({ barSpacing: 10 }),
      coordinateToTime: x => x < 0 ? '2024-02-01' : '2024-03-01',
      timeToCoordinate: vi.fn(time => time === '2024-02-30' ? null : 100),
    };
    const primitive = check(rows, scale, series, [{ start: '2024-02-01', end: '2024-03-01', high: 110, low: 70 }]);
    for (const { time } of rows) expect(scale.timeToCoordinate).toHaveBeenCalledWith(time);
    scale.timeToCoordinate.mockImplementation(time => { if (time === '2024-02-1x') throw Error('invalid date'); return 100; });
    expect(() => primitive.updateAllViews()).toThrow('invalid date');
  });

  it.each([[null, null], [null, '2025-07-01'], ['2025-01-01', null], ['2025-07-01', '2025-01-01'], [123, 456], ['bad', 'bad']])('handles incomplete or invalid bounds %s / %s', (from, to) => {
    expect.hasAssertions();
    const scale = syntheticScale();
    // Use conservative boundaries around the actual visible dates.
    scale.coordinateToTime = vi.fn(x => x < 0 ? from : to);
    check(candles, scale);
  });

  it('does not use calendar bounds for timestamp axes or invalid dimensions/spacing', () => {
    const rows = candles.map((c, i) => ({ ...c, time: 1700000000 + i * 60 }));
    check(rows, syntheticScale({ times: rows.map(c => c.time) }));
    for (const spacing of [undefined, NaN, 0, -1]) {
      const scale = syntheticScale();
      scale.options = () => ({ barSpacing: spacing });
      check(candles, scale);
      expect(scale.coordinateToTime).not.toHaveBeenCalled();
    }
    for (const width of [0, NaN, Infinity, -1]) {
      const scale = syntheticScale(); scale.width = () => width;
      check(candles, scale);
      expect(scale.coordinateToTime).not.toHaveBeenCalled();
    }
    const scale = syntheticScale(); delete scale.coordinateToTime;
    check(candles, scale);
  });

  it('preserves mixed BusinessDay/string times, date fallback, duplicates and input order', () => {
    expect.hasAssertions();
    const rows = candles.map((c, i) => i % 3 === 0 ? { ...c, time: { year: Number(c.time.slice(0, 4)), month: Number(c.time.slice(5, 7)), day: Number(c.time.slice(8, 10)) } } : i % 3 === 1 ? { ...c, time: undefined, date: c.time } : c);
    rows.push(rows[240], rows[241]);
    check(rows.reverse(), syntheticScale());
  });

  it('refreshes bounds and candle values on every update and handles detach/reattach', () => {
    const rows = candles.map(c => ({ ...c }));
    rows[207].time = { year: 2025, month: 2, day: 18 };
    let scale = syntheticScale();
    let price = value => 350 - value * 2;
    const priceSeries = { priceToCoordinate: value => price(value) };
    const primitive = new VcpBoxPrimitive(boxes, rows);
    const chart = { timeScale: () => scale };
    primitive.attached({ chart, series: priceSeries });
    for (const spacing of [40, 1, 7]) {
      scale = syntheticScale({ spacing, right: 210 });
      rows[205].high += 5; rows[206].time = date(413); rows[207].time.day++;
      price = spacing === 1 ? value => Math.log(value) * 40 : value => 350 - value * spacing;
      primitive.updateAllViews();
      expect(primitive.paneViews()[0]._candles).toEqual(originalCandles(rows, scale, priceSeries));
    }
    primitive.setBoxes([]); expect(primitive.paneViews()[0]._candles).toEqual([]);
    primitive.setBoxes(boxes);
    primitive.detached(); primitive.updateAllViews(); expect(primitive.paneViews()[0]._candles).toEqual([]);
    primitive.attached({ chart, series: priceSeries }); expect(primitive.paneViews()[0]._candles).toEqual(originalCandles(rows, scale, priceSeries));
  });

  it('keeps equivalence when the bounded string-parse cache fills', () => {
    const rows = Array.from({ length: 4200 }, (_, i) => ({ time: date(i), high: 140, low: 80 }));
    const scale = syntheticScale({ times: rows.map(c => c.time), right: 4150 });
    const primitive = check(rows, scale);
    primitive.updateAllViews();
    expect(primitive.paneViews()[0]._candles).toEqual(originalCandles(rows, scale, series));
    expect(primitive.paneViews()[0]._calendarDays.size).toBe(4096);
  });

  it('matches installed chart models at distinct widths/zoom/scroll and after other-series time changes', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // Initial options are applied synchronously. Later range/option changes are
    // queued until painting; do not pretend suppressed rAF applied those changes.
    const ranges = new Set();
    for (const width of [390, 800]) for (const spacing of [.1, 1, 7.75, 40]) for (const rightOffset of [-100, 0, .25, 5]) {
      const container = document.createElement('div'); document.body.appendChild(container);
      const chart = createChart(container, { width, height: 440, rightPriceScale: { visible: false }, timeScale: { barSpacing: spacing, rightOffset, minBarSpacing: .1 } });
      try {
        const priceSeries = chart.addSeries(CandlestickSeries); priceSeries.setData(candles);
        const extra = chart.addSeries(LineSeries); const scale = chart.timeScale();
        expect(scale.width()).toBe(width);
        expect(scale.options().barSpacing).toBe(spacing);
        ranges.add(JSON.stringify(scale.getVisibleLogicalRange()));
        const primitive = check(candles, scale, priceSeries);
        expect(primitive.paneViews()[0]._candles.length).toBeGreaterThan(0);
        extra.setData(Array.from({ length: 720 }, (_, i) => ({ time: date(i), value: 100 })));
        primitive.updateAllViews();
        expect(primitive.paneViews()[0]._candles).toEqual(originalCandles(candles, scale, priceSeries));
        chart.removeSeries(extra); primitive.updateAllViews();
        expect(primitive.paneViews()[0]._candles).toEqual(originalCandles(candles, scale, priceSeries));
        priceSeries.setData(candles.map(c => ({ time: c.time })));
        primitive.updateAllViews();
        expect(primitive.paneViews()[0]._candles).toEqual(originalCandles(candles, scale, priceSeries));
        expect(primitive.paneViews()[0]._candles).toEqual([]);
        priceSeries.setData([]); primitive.updateAllViews();
        expect(primitive.paneViews()[0]._candles).toEqual([]);
      } finally { chart.remove(); container.remove(); }
    }
    expect(ranges.size).toBeGreaterThan(16);
  });
});
