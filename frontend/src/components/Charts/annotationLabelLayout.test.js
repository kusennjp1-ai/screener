import { expect, it } from 'vitest';
import { placeAnnotationLabels } from './annotationLabelLayout';

const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
it('places crowded right-edge captions above candle highs without overlap at mobile and desktop widths', () => {
  for (const width of [300, 1050]) {
    const candles = Array.from({ length: 63 }, (_, i) => ({ x: i * width / 63, y: 60 + i % 9, width: 4, height: 100 }));
    const shapes = Array.from({ length: 6 }, (_, i) => ({ x1: width - 100, x2: width - 20 - i * 5, y1: 120, y2: 180, curve: true, label: `C${i + 1} −${(6 - i).toFixed(1)}%` }));
    const labels = placeAnnotationLabels(shapes, candles, width, 240, text => text.length * 6);
    expect(labels.length).toBeGreaterThan(0);
    for (const [i, label] of labels.entries()) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width).toBeLessThanOrEqual(width);
      expect(label.y).toBeGreaterThanOrEqual(0);
      const localHighs = candles.filter(candle => candle.x + candle.width >= label.x && candle.x <= label.x + label.width);
      expect(label.y + label.height).toBeLessThan(Math.min(...localHighs.map(candle => candle.y)));
      expect(candles.some(candle => overlaps(label, candle))).toBe(false);
      expect(labels.slice(i + 1).some(other => overlaps(label, other))).toBe(false);
    }
  }
});
it('omits captions with no safe space and offscreen contraction anchors instead of covering candles', () => {
  const shapes = [{ x1: 10, x2: 70, y1: 10, y2: 100, label: '過去の上抜け' }, { x1: -300, x2: -10, y1: 100, y2: 150, curve: true, label: 'C1' }];
  expect(placeAnnotationLabels(shapes, [{ x: 0, y: 4, width: 300, height: 200 }], 300, 240, text => text.length * 6)).toEqual([]);
});
