import { describe, it, expect } from 'vitest';
import { buildBookAnnotations } from './bookAnnotations';
function fixture(points = [[0, 50], [60, 100], [70, 80], [80, 98], [88, 88], [96, 96], [104, 91], [110, 95]]) {
  const dates = []; const d = new Date('2025-01-01');
  while (dates.length < 111) { if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return dates.map((date, i) => { let k = 1; while (points[k][0] < i) k++;
    const [a, x] = points[k - 1], [b, y] = points[k]; const close = x + (y - x) * (i - a) / (b - a);
    return { date, open: close, close, high: close + .2, low: close - .2, volume: 10000 - i * 40 }; });
}
describe('automatic book chart aids', () => {
  it('measures chronological shrinking pullbacks and labels only candidates', () => {
    const bars = fixture(), result = buildBookAnnotations(bars);
    expect(result.candidate).toBe(true); expect(result.legs).toHaveLength(3);
    expect(result.boxes[0].start).toBe(bars[60].date);
    expect(result.legs.map(x => x.depthPct)).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(result.legs[0].depthPct).toBeCloseTo((100.2 - 79.8) / 100.2 * 100);
    expect(result.pivot).toBeCloseTo(96.2); expect(result.summary).toContain('成立・買い判断は別確認');
  });
  it('does not label widening pullbacks as VCP', () => {
    const result = buildBookAnnotations(fixture([[0,50],[60,100],[70,92],[80,98],[88,86],[96,96],[104,80],[110,94]]));
    expect(result.candidate).toBe(false); expect(result.pivot).toBeNull(); expect(result.boxes).toHaveLength(1);
  });
  it('rejects too few bars, unsorted dates, missing volume and corrupt OHLC', () => {
    const bars = fixture();
    expect(buildBookAnnotations(bars.slice(-10)).boxes).toEqual([]);
    for (const patch of [{ date: bars[1].date }, { volume: null }, { low: 999 }, { close: NaN }]) {
      const invalid = bars.map(b => ({ ...b })); Object.assign(invalid[10], patch);
      expect(buildBookAnnotations(invalid).boxes).toEqual([]);
    }
  });
  it('requires future bars to confirm a local low and never calls a breakdown VCP', () => {
    const bars = fixture(); bars[110] = { ...bars[110], open: 85, close: 85, high: 86, low: 84 };
    expect(buildBookAnnotations(bars).candidate).toBe(false);
  });
  it('does not draw an invented base on a monotonic rise', () => {
    expect(buildBookAnnotations(fixture([[0,50],[110,100]])).boxes).toEqual([]);
  });
});
