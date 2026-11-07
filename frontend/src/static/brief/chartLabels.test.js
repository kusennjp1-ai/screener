import { describe, expect, it } from 'vitest';
import { BOX_GAP, LABEL_GAP, labelPlacer, placedAttrs, segmentCrosses, spots } from './chartLabels';

// One candle box per 10px column from x = 100 to 190, 40px to 80px down (the "candles" of these tests).
const candles = Array.from({ length: 10 }, (_, i) => ({ x0: 100 + i * 10, x1: 106 + i * 10, y0: 40, y1: 80 }));
const solid = box => candles.filter(c => box.x0 < c.x1 && box.x1 > c.x0 && box.y0 < c.y1 && box.y1 > c.y0).length;
const along = (x0, x1, ys, cost) => spots({ x0, x1, ys, cost });

describe('chart label placer', () => {
  it('lists spots x-major from the left (each x trying the centres in order), or by cost, and describes them', () => {
    const s = along(4, 9, [20, 40]);
    expect(s.list.map(([x, yc]) => [x, yc])).toEqual([[4, 20], [4, 40], [6, 20], [6, 40], [8, 20], [8, 40], [9, 20], [9, 40]]);
    expect(s.search).toBe('4.0 9.0 2|20.0 40.0');
    const near = along(0, 8, [10], x => Math.abs(x - 6));
    expect(near.list.map(([x]) => x)).toEqual([6, 4, 8, 2, 0]);
    expect(spots({ x0: 0, x1: 4, ys: [3, 30], inside: yc => yc > 5 }).search).toBe('0.0 4.0 2|30.0');
    expect(spots({ x0: 10, x1: 4, ys: [3] }).list).toEqual([]);
  });

  it('takes the first spot clear of candles and of every reserved box, keeping a gap beside boxes', () => {
    const placer = labelPlacer({ solid });
    placer.take({ x0: 0, x1: 30, y0: 50, y1: 64 });
    // Row 57 is blocked by the reserved box up to x = 30 + BOX_GAP and by the candles from x = 100.
    const at = placer.place(40, along(4, 200, [57]));
    expect(at).toMatchObject({ x: 34, yc: 57, forced: false });
    expect(at.x).toBeGreaterThanOrEqual(30 + BOX_GAP);
    // The next label cannot overlap the first, and keeps LABEL_GAP beside it.
    expect(placer.place(40, along(34, 34, [57]), { forced: false })).toBeNull();
    expect(placer.place(20, along(34, 99, [57]), { forced: false }).x).toBe(Math.ceil((34 + 40 + LABEL_GAP) / 2) * 2);
  });

  it('prefers a spot no line crosses, within `slack` of the first candle-free one', () => {
    const soft = box => box.x0 < 50;
    const free = labelPlacer({ solid, soft }).place(20, along(4, 90, [20]));
    expect(free).toMatchObject({ x: 50, forced: false });
    const tight = labelPlacer({ solid, soft }).place(20, along(4, 90, [20], x => x), { slack: 10 });
    expect(tight).toMatchObject({ x: 4, forced: false });
  });

  it('goes over candles only when no candle-free spot is left: over the fewest, marked forced', () => {
    const placer = labelPlacer({ solid });
    // Inside the candle columns only: every spot is over candles.
    const at = placer.place(18, along(100, 112, [60]));
    expect(at).toMatchObject({ forced: true });
    expect(solid(at.box)).toBe(Math.min(...along(100, 112, [60]).list.map(([x]) => solid({ x0: x, x1: x + 18, y0: 53, y1: 67 }))));
    expect(placer.place(18, along(100, 112, [60]), { forced: false })).toBeNull();
    // perCandle trades distance for candles: the nearer spot over more candles wins when a candle costs little.
    const two = { list: [[0, 60, 0], [10, 60, 5]] }, counts = box => (box.x0 < 5 ? 3 : 1);
    expect(labelPlacer({ solid: counts }).place(18, two).x).toBe(10);
    expect(labelPlacer({ solid: counts }).place(18, two, { perCandle: 1 }).x).toBe(0);
  });

  it('moves the labels in the way to their own candle-free spots rather than forcing a later label over candles', () => {
    const placer = labelPlacer({ solid });
    // The first label could sit at x = 4 or x = 40; it takes x = 4.
    const first = placer.put(30, along(4, 40, [20]));
    expect(first.at.x).toBe(4);
    // The second's only candle-free spot is x = 4 (its other spot is over candles): the first moves out of its way.
    const second = placer.put(30, { list: [[100, 60, 0], [4, 20, 1]] });
    expect(second.at).toMatchObject({ x: 4, yc: 20, forced: false });
    expect(first.at.x).toBeGreaterThanOrEqual(4 + 30 + LABEL_GAP);
    expect(first.at.forced).toBe(false);
  });

  it('settles a forced label on a spot a later move freed, and drops a label on request', () => {
    const placer = labelPlacer({ solid });
    const blocker = placer.put(30, { list: [[4, 20, 0]] });
    const forced = placer.put(30, { list: [[4, 20, 0], [100, 60, 1]] });
    expect(forced.at.forced).toBe(true);
    placer.drop(blocker);
    expect(blocker.at).toBeNull();
    placer.settle();
    expect(forced.at).toMatchObject({ x: 4, yc: 20, forced: false });
  });

  it('crosses a box with a segment only where their x-ranges meet', () => {
    const box = { x0: 10, x1: 20, y0: 10, y1: 20 };
    expect(segmentCrosses([0, 0], [30, 30], box)).toBe(true);
    expect(segmentCrosses([0, 0], [8, 30], box)).toBe(false);
    expect(segmentCrosses([0, 25], [30, 25], box)).toBe(false);
    expect(segmentCrosses([15, 0], [15, 30], box)).toBe(true);
  });

  it('writes the reserved box, and the search only for a forced label', () => {
    expect(placedAttrs({ box: { x0: 1, x1: 2, y0: 3, y1: 4 }, forced: false }, '0 1 2|3')).toBe('data-box="1.0 2.0 3.0 4.0"');
    expect(placedAttrs({ box: { x0: 1, x1: 2, y0: 3, y1: 4 }, forced: true }, '0 1 2|3')).toBe('data-box="1.0 2.0 3.0 4.0" data-forced="1" data-search="0 1 2|3"');
  });
});
