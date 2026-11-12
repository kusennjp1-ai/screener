import { describe, expect, it } from 'vitest';
import { BOX_GAP, KIN_GAP, LABEL_GAP, labelPlacer, PHRASE_GAP, placedAttrs, segmentCrosses, spotList, spots } from './chartLabels';

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
    expect(placer.place(8, along(34, 99, [57]), { forced: false }).x).toBe(Math.ceil((34 + 40 + LABEL_GAP) / 2) * 2);
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
    // The first label could sit anywhere from x = 4 to x = 60; it takes x = 4.
    const first = placer.put(30, along(4, 60, [20]));
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

  it('keeps two labels on a row a phrase\'s gap apart, and the plan\'s two green names three glyphs', () => {
    const placer = labelPlacer({ solid });
    placer.place(40, along(4, 4, [20]), { kin: 'plan' });
    // Same row: another plan name keeps KIN_GAP.plan; any other label LABEL_GAP (a phrase's gap and the estimate's slack).
    expect(placer.place(30, along(44, 200, [22]), { kin: 'plan', forced: false }).x).toBe(44 + KIN_GAP.plan);
    const plain = labelPlacer({ solid });
    plain.place(40, along(4, 4, [20]));
    expect(plain.place(20, along(40, 99, [20]), { forced: false }).x).toBe(44 + LABEL_GAP);
    // Another row (boxes 14px tall do not meet): no gap.
    expect(placer.place(30, along(4, 200, [34]), { kin: 'plan', forced: false }).x).toBe(4);
    expect(PHRASE_GAP).toBeGreaterThanOrEqual(14);
    expect(LABEL_GAP).toBeGreaterThan(PHRASE_GAP);
    expect(KIN_GAP.plan).toBeGreaterThanOrEqual(36);
  });

  it('reserves a label\'s leader with it: a spot whose leader meets a label or another leader is not taken, and no later label sits on it', () => {
    // A name 20px wide whose line ends at x = 98, `end` down: its leader runs from its right end to the axis on its row,
    // then along the axis to the line's end (as an average's name moved left).
    const leaderTo = end => (x, yc) => [{ x0: x + 22, x1: 98, y0: yc - 2, y1: yc + 2, leader: 'h' }, { x0: 97, x1: 99, y0: Math.min(yc, end) - 1, y1: Math.max(yc, end) + 1, leader: 'v' }];
    const placer = labelPlacer({ solid });
    // Another label sits at x = 88–96 on row 20: the leader from row 20 would run through it, so the name takes row 40.
    placer.take({ x0: 88, x1: 96, y0: 13, y1: 27, label: true });
    const named = placer.place(20, along(50, 50, [20, 40]), { leader: leaderTo(50) });
    expect(named).toMatchObject({ x: 50, yc: 40, forced: false });
    expect(named.extra).toHaveLength(2);
    // A later label clear of the name's box but on its leader is kept off it; beside the leader it is free.
    expect(placer.place(8, along(86, 86, [40]), { forced: false })).toBeNull();
    expect(placer.place(8, along(86, 86, [55]), { forced: false })).toMatchObject({ x: 86, yc: 55 });
    // A second name whose leader would run along the first one's (or cross it) is kept off it too.
    const pair = labelPlacer({ solid });
    pair.place(20, along(50, 50, [30]), { leader: leaderTo(50) });
    expect(pair.place(20, along(10, 10, [40, 75]), { forced: false, leader: leaderTo(60) })).toMatchObject({ yc: 75 });
    // The leader moves with its label when a later label moves it, and goes when its label is dropped.
    const moving = labelPlacer({ solid });
    const name = moving.put(20, along(20, 80, [30]), { leader: leaderTo(50) });
    expect(name.at.x).toBe(20);
    const blocker = moving.put(30, { list: [[100, 60, 0], [10, 30, 1]] });
    expect(blocker.at).toMatchObject({ x: 10, yc: 30, forced: false });
    expect(name.at.x).toBeGreaterThanOrEqual(10 + 30 + LABEL_GAP);
    expect(moving.boxes.filter(b => b.leader === 'h').map(b => b.x0)).toEqual([name.at.x + 22]);
    moving.drop(name);
    expect(moving.boxes.filter(b => b.leader)).toEqual([]);
  });

  it('skips a spot where the label\'s leader may not run (its leader null), in place() and when repairing', () => {
    // No leader may run on row 20 (as along a level line): the name takes row 40 though row 20 comes first and is clear.
    const leader = (x, yc) => (yc === 20 ? null : [{ x0: x + 22, x1: 98, y0: yc - 2, y1: yc + 2, leader: 'h' }]);
    expect(labelPlacer({ solid }).place(20, along(50, 50, [20, 40]), { leader })).toMatchObject({ yc: 40 });
    expect(labelPlacer({ solid }).place(20, along(50, 50, [20]), { leader })).toBeNull();
    // A label in the way of the one spot left is not moved for a spot whose leader may not run.
    const placer = labelPlacer({ solid });
    const first = placer.put(20, along(50, 70, [20]));
    const name = placer.put(20, { list: [[100, 60, 0], [50, 20, 1]] }, { leader });
    expect(first.at).toMatchObject({ x: 50, yc: 20 });
    expect(name.at).toMatchObject({ x: 100, forced: true });
  });

  it('brings back a snapshot: every box, and every label a later try moved, where it was', () => {
    const placer = labelPlacer({ solid });
    const first = placer.put(30, along(4, 60, [20]));
    placer.take({ x0: 0, x1: 2, y0: 0, y1: 2 });
    const state = placer.snapshot(), boxes = placer.boxes.slice();
    // A try moves the first label out of its way, then is undone.
    const later = placer.put(30, { list: [[100, 60, 0], [4, 20, 1]] });
    expect(later.at).toMatchObject({ x: 4, forced: false });
    expect(first.at.x).toBeGreaterThan(4);
    placer.restore(state);
    expect(first.at.x).toBe(4);
    expect(placer.boxes).toEqual(boxes);
    // The same try from the same state ends the same way.
    expect(placer.put(30, { list: [[100, 60, 0], [4, 20, 1]] }).at).toMatchObject({ x: 4, forced: false });
    expect(placer.hits({ x0: 4, x1: 34, y0: 13, y1: 27 })).toBe(true);
  });

  it('with `fewest`, takes the candle-free spot the fewest lines cross when every one is crossed', () => {
    const crossings = box => (box.x0 < 30 ? 2 : box.x0 < 60 ? 1 : 3);
    expect(labelPlacer({ solid, soft: crossings }).place(20, along(4, 70, [20]), { hard: 60 })).toMatchObject({ x: 4 });
    expect(labelPlacer({ solid, soft: crossings }).place(20, along(4, 70, [20]), { hard: 60, fewest: true })).toMatchObject({ x: 30 });
    // Only within `hard` of the first candle-free spot.
    expect(labelPlacer({ solid, soft: crossings }).place(20, along(4, 70, [20], x => x), { hard: 10, fewest: true })).toMatchObject({ x: 4 });
  });

  it('with `hard`, takes a spot a level line strikes through only when no other candle-free spot is within that much more', () => {
    // A level line at y = 20 strikes every spot centred 15–25.
    const strike = box => Math.abs((box.y0 + box.y1) / 2 - 20) <= 5;
    const ys = [20, 24, 28, 32];
    const cost = (x, yc) => x + 2 * Math.abs(yc - 20);
    expect(labelPlacer({ solid, strike }).place(20, along(4, 4, ys, cost), { slack: 24, hard: 60 })).toMatchObject({ yc: 28 });
    // Without `hard` the line is ignored; with a short reach the struck spot stays.
    expect(labelPlacer({ solid, strike }).place(20, along(4, 4, ys, cost), { slack: 24 })).toMatchObject({ yc: 20 });
    expect(labelPlacer({ solid, strike }).place(20, along(4, 4, ys, cost), { slack: 0, hard: 10 })).toMatchObject({ yc: 20 });
    // A line no label avoids (soft) is still only a preference within `slack`.
    const soft = box => box.y0 < 30;
    expect(labelPlacer({ solid, soft, strike }).place(20, along(4, 4, ys, cost), { slack: 4, hard: 60 })).toMatchObject({ yc: 28 });
  });

  it('works out a spot\'s candles and lines once per list, however often the label is placed again', () => {
    let calls = 0;
    const counting = box => { calls++; return solid(box); };
    const placer = labelPlacer({ solid: counting });
    const s = along(100, 140, [60]);
    const first = placer.place(18, s);
    expect(first.forced).toBe(true);
    const once = calls;
    placer.release(first.box);
    placer.place(18, s);
    placer.place(18, s, { forced: false });
    expect(calls).toBe(once);
    // Another label size is another box: worked out again.
    placer.place(10, s);
    expect(calls).toBeGreaterThan(once);
  });

  it('orders costs below zero and ties by the list order, after the spots given first', () => {
    const s = spots({ x0: 0, x1: 6, ys: [0], cost: x => (x === 4 ? -1 : x === 6 ? 0.5 : 0) });
    expect(s.list.map(([x]) => x)).toEqual([4, 0, 2, 6]);
    const corners = spots({ x0: 0, x1: 6, ys: [0], first: [[9, 9, -1]], cost: x => x });
    expect(corners.list).toEqual([[9, 9, -1], [0, 0, 0], [2, 0, 2], [4, 0, 4], [6, 0, 6]]);
    expect(corners.search).toBe('0.0 6.0 2|0.0');
    // A hand-made list keeps its order; a plain { list } is taken as one.
    expect(spotList([[5, 1], [3, 2, 7]]).list).toEqual([[5, 1, 0], [3, 2, 7]]);
    expect(labelPlacer({ solid }).place(10, { list: [[100, 60, 0], [4, 20, 1]] })).toMatchObject({ x: 4, forced: false });
  });

  it('orders the spots near the target first and the rest only when asked, in the same order as a full sort', () => {
    const cost = (x, yc) => Math.abs(x - 41) + 2 * Math.abs(yc - 23.5);
    const ys = Array.from({ length: 40 }, (_, i) => i * 2);
    const full = spots({ x0: 0, x1: 120, ys, cost });
    const near = spots({ x0: 0, x1: 120, ys, cost, near: { cost: 20, x: [21, 61], y: [13.5, 33.5] } });
    expect(near.n).toBe(full.n);
    // Only the near window is ordered until a label goes past it.
    near.fill(3);
    expect(near.ready).toBeLessThan(near.n);
    expect([near.x[0], near.y[0], near.cost[0]]).toEqual([full.list[0][0], full.list[0][1], full.list[0][2]]);
    expect(near.list).toEqual(full.list);
    expect(near.ready).toBe(near.n);
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
