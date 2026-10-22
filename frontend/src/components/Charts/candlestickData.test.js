import { describe, expect, it } from 'vitest';
import { calculateEMA, transformToCandlestickData } from './candlestickData';

// Same dated 260-bar shape used by the existing chart-reuse regression tests.
const bars = Array.from({ length: 260 }, (_, index) => ({
  date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
  open: 100 + index / 10, high: 103 + index / 10, low: 98 + index / 10,
  close: 100 + index / 10, volume: index % 7 ? 1000 + index : 0,
}));

describe('optional unplotted EMA histories', () => {
  it.each(['daily', 'weekly'])('preserves every plotted value and input in %s views', timeframe => {
    const input = structuredClone(bars), before = JSON.stringify(input);
    const ordinary = transformToCandlestickData(input, timeframe);
    const research = transformToCandlestickData(input, timeframe, { includeEMA: false });
    const { ema10, ema20, ema50, ...plotted } = ordinary;
    expect(research).toEqual({ ...plotted, ema10: [], ema20: [], ema50: [] });
    expect(ema10.length).toBeGreaterThan(0);
    expect(ema20.length).toBeGreaterThan(0);
    if (timeframe === 'daily') expect(ema50.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
    expect(transformToCandlestickData(input, timeframe, { includeEMA: true })).toEqual(ordinary);
  });
  it('retains the original ordinary-chart EMA arithmetic', () => {
    const result = transformToCandlestickData(bars);
    expect(result.ema10).toEqual(calculateEMA(bars, 10));
    expect(result.ema20).toEqual(calculateEMA(bars, 20));
    expect(result.ema50).toEqual(calculateEMA(bars, 50));
  });
  it.each([null, [], bars.slice(0, 9)])('keeps missing and short history behavior for %s', input => {
    expect(transformToCandlestickData(input, 'daily', { includeEMA: false })).toEqual(transformToCandlestickData(input));
  });
});
