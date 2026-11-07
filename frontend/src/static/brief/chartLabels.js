// The price chart's label placer (imported by priceChart.js only, so it ships in the chart's lazy chunk). One rule for
// every label: in priority order, each takes the first of its candidate spots that overlaps no box already taken
// (labels, tags, marks) and no candle, preferring one that no line (an average, a level) crosses, and (when asked) one
// no level line strikes through; only when no candle-free spot is left does it go over candles (the spot with the
// fewest, with its halo), and it is marked forced.

/**
 * Horizontal clearance kept beside a reserved box (a 12px label's box is 14px tall, so 2px stays above and below its
 * glyphs); two labels keep LABEL_GAP, so two names side by side never read as one (「T1 買いゾーン」).
 */
export const BOX_GAP = 3, LABEL_GAP = 6;
/**
 * Two labels of one kin that would read as one phrase on one row keep further apart: the plan's green names (ピボット,
 * 買いゾーン) three glyphs, two figures (a contraction's depth, an average's name: 「−4% 150」) more than a glyph.
 */
export const KIN_GAP = { plan: 36, figure: 13 };
/** The default x step of a search (data-search names the step; the test that checks a forced label re-runs the same spots). */
export const SEARCH_STEP = 2;

const range = (a, b, step) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 10) / 10); if (out.at(-1) !== b && b > a) out.push(b); return out; };
// Costs order as one number each (on a 1/64px grid, the grid index breaking ties: equal costs keep their order).
const SLOTS = 2 ** 22;

/**
 * A candidate set: `n` spots in the order they are tried, their left edges `x`, centres `y` and costs `cost` (typed
 * arrays: thousands of spots cost no allocation each), `search` for data-search, and `list` ([x, yc, cost] each) to
 * read. Only the first `ready` are in order yet: `fill(k)` orders them up to k (see spots), so a label that takes
 * one of its first spots never orders the thousands behind it.
 */
class Candidates {
  constructor(n, search) { Object.assign(this, { n, x: new Float64Array(n), y: new Float64Array(n), cost: new Float64Array(n), search, ready: n }); }
  fill() {}
  get list() { this.fill(this.n - 1); return Array.from(this.x, (v, k) => [v, this.y[k], this.cost[k]]); }
}
const candidates = (n, search) => new Candidates(n, search);
/** A candidate set from [x, yc, cost] spots, in the order given (a hand-made list, or a test's). */
export function spotList(list, search = '') {
  const s = candidates(list.length, search);
  list.forEach(([x, yc, cost = 0], k) => { s.x[k] = x; s.y[k] = yc; s.cost[k] = cost; });
  return s;
}
// place() also takes a plain { list } (worked into a candidate set once).
const asSpots = s => (s instanceof Candidates ? s : (s.spots ??= spotList(s.list, s.search)));

// A min-heap of keys (cost and grid index as one number).
function heapOf(keys) {
  let size = keys.length;
  const down = i => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < size && keys[l] < keys[m]) m = l;
      if (r < size && keys[r] < keys[m]) m = r;
      if (m === i) return;
      const t = keys[i]; keys[i] = keys[m]; keys[m] = t;
      i = m;
    }
  };
  for (let i = (size >> 1) - 1; i >= 0; i--) down(i);
  return { get size() { return size; }, pop() { const top = keys[0]; keys[0] = keys[--size]; down(0); return top; } };
}

/**
 * Candidate spots for a label: every left edge from `x0` to `x1` (`step` apart, `x1` included) at each centre in `ys`
 * (only those `inside` accepts), ordered by `cost(x, yc)` (stable: equal costs keep the x-major order, each x trying
 * `ys` in the order given), after the spots in `first` ([x, yc, cost] each, tried first in that order). `search`
 * describes the grid for data-search: "x0 x1 step|y y …". With `near` ({ cost, x: [lo, hi], y: [lo, hi] }, the box
 * holding every spot that costs `cost` or less), the spots in it that cost that much or less are ordered first and
 * the rest of the grid only when a label goes past them: the order is the same, the work much less.
 */
export function spots({ x0, x1, ys, step = SEARCH_STEP, inside = () => true, cost = null, first = [], near = null }) {
  const valid = ys.filter(inside), xs = x1 >= x0 && valid.length ? range(x0, x1, step) : [], ny = valid.length, grid = xs.length * ny, m = first.length;
  const s = candidates(m + grid, xs.length ? `${x0.toFixed(1)} ${x1.toFixed(1)} ${step}|${valid.map(yc => yc.toFixed(1)).join(' ')}` : '');
  first.forEach(([fx, fy, fc = 0], k) => { s.x[k] = fx; s.y[k] = fy; s.cost[k] = fc; });
  if (!cost || grid < 2 || grid >= SLOTS) {
    xs.forEach((x, ix) => valid.forEach((yc, iy) => { const k = m + ix * ny + iy; s.x[k] = x; s.y[k] = yc; s.cost[k] = cost ? cost(x, yc) : 0; }));
    return s;
  }
  // The grid's costs (worked out once each) and the spots already handed to a heap.
  const costs = new Float64Array(grid).fill(NaN), queued = new Uint8Array(grid);
  const costAt = g => (Number.isNaN(costs[g]) ? (costs[g] = cost(xs[Math.floor(g / ny)], valid[g % ny])) : costs[g]);
  const indices = (values, lo = -Infinity, hi = Infinity) => values.flatMap((v, i) => (v >= lo - 1e-9 && v <= hi + 1e-9 ? [i] : []));
  const batch = (ixs, iys, limit) => {
    const keys = [];
    for (const ix of ixs) for (const iy of iys) {
      const g = ix * ny + iy;
      if (!queued[g] && costAt(g) <= limit) { queued[g] = 1; keys.push(Math.round(costs[g] * 64) * SLOTS + g); }
    }
    return heapOf(Float64Array.from(keys));
  };
  const all = [indices(xs), indices(valid)];
  let heap = near ? batch(indices(xs, ...near.x), indices(valid, ...near.y), near.cost) : batch(...all, Infinity), rest = Boolean(near);
  s.ready = m;
  s.fill = k => {
    while (s.ready <= k) {
      if (!heap.size) { if (!rest) return; heap = batch(...all, Infinity); rest = false; continue; }
      const top = heap.pop(), g = top - Math.floor(top / SLOTS) * SLOTS;
      s.x[s.ready] = xs[Math.floor(g / ny)]; s.y[s.ready] = valid[g % ny]; s.cost[s.ready] = costs[g];
      s.ready++;
    }
  };
  return s;
}

/**
 * A segment from (xa, ya) to (xb, yb) (xa ≤ xb) crosses the box: over their common x-range the segment's y-range meets the box's.
 */
export function segmentCrosses([xa, ya], [xb, yb], box) {
  const l = Math.max(xa, box.x0), r = Math.min(xb, box.x1);
  if (l > r) return false;
  const at = xx => (xb === xa ? ya : ya + (yb - ya) * (xx - xa) / (xb - xa));
  const y0 = Math.min(at(l), at(r), xb === xa ? yb : Infinity), y1 = Math.max(at(l), at(r), xb === xa ? yb : -Infinity);
  return y0 < box.y1 && y1 > box.y0;
}

/**
 * @param {object} p `solid(box)` counts the candles (or volume bars) a box overlaps; `soft(box)` says whether a line
 *   crosses it; `strike(box)` whether a level line runs through its glyphs (a label that asks for it, with `hard`).
 * @returns the placer: `take(box)` reserves a box (a tag, a mark, a caption), `release(box)` frees one, `hits(box)` says
 *   whether it overlaps a reserved box, `place(w, spots, options)` reserves and returns the first spot by the rule, and
 *   `put(w, spots, options)` places a label a later one may move (see repair), `drop(label)` takes it back out and
 *   `settle()` gives a forced label the candle-free spot a later move freed.
 */
export function labelPlacer({ solid = () => 0, soft = () => false, strike = () => false } = {}) {
  const boxes = [];
  const clash = (a, b) => {
    const gap = a.label && b.label ? (a.kin && a.kin === b.kin ? KIN_GAP[a.kin] ?? LABEL_GAP : LABEL_GAP) : BOX_GAP;
    return a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.y0 < b.y1 && a.y1 > b.y0;
  };
  const hits = box => boxes.some(b => clash(box, b));
  const take = box => { boxes.push(box); return box; };
  const release = box => { const i = boxes.indexOf(box); if (i >= 0) boxes.splice(i, 1); };
  // What never changes for a spot (the candles under it, a line across it, a level through its glyphs) is worked out
  // once per list and label size: a label placed again (repair, settle) only checks the reserved boxes.
  const memo = (s, w, half) => {
    if (s.memo?.w !== w || s.memo.half !== half) s.memo = { w, half, solid: new Int16Array(s.n).fill(-1), soft: new Int8Array(s.n).fill(-1), strike: new Int8Array(s.n).fill(-1) };
    const m = s.memo, box = k => ({ x0: s.x[k], x1: s.x[k] + w, y0: s.y[k] - half, y1: s.y[k] + half });
    return {
      solid: k => { if (m.solid[k] < 0) m.solid[k] = Math.min(32767, solid(box(k))); return m.solid[k]; },
      soft: k => { if (m.soft[k] < 0) m.soft[k] = soft(box(k)) ? 1 : 0; return m.soft[k] === 1; },
      strike: k => { if (m.strike[k] < 0) m.strike[k] = strike(box(k)) ? 1 : 0; return m.strike[k] === 1; },
    };
  };
  /**
   * The spot for a label `w` wide (half its height `half` around the centre): the first candle-free spot no line
   * crosses, accepting up to `slack` more cost than the first candle-free spot to find one; with `hard`, a spot a level
   * line strikes through is taken only when no other candle-free spot is within `hard` more cost; else that first
   * candle-free spot; else (`forced`) the spot over the fewest candles (or, with `perCandle`, the lowest cost counting
   * each candle as that much more), then the lowest cost; never over a reserved box (`kin`: see KIN_GAP). Returns
   * { x, yc, box, forced } (the box reserved) or null.
   */
  const place = (w, spotsIn, { forced = true, slack = Infinity, half = 7, perCandle = Infinity, kin = null, hard = 0 } = {}) => {
    const s = asSpots(spotsIn), known = memo(s, w, half), reach = Math.max(slack, hard);
    let first = null, plain = null, best = null, worst = Infinity;
    for (let k = 0; k < s.n; k++) {
      s.fill(k);
      const x = s.x[k], yc = s.y[k], cost = s.cost[k];
      if (first && cost > first.cost + reach) break;
      const count = known.solid(k);
      // Over candles: only a forced label's fallback, and none once a candle-free spot is found.
      if (count > 0 && (!forced || first)) continue;
      const box = { x0: x, x1: x + w, y0: yc - half, y1: yc + half, label: true, kin };
      if (hits(box)) continue;
      if (count === 0) {
        const struck = hard > 0 && known.strike(k);
        if (!struck && !known.soft(k) && (!first || cost <= first.cost + slack)) return { x, yc, box: take(box), forced: false };
        if (!first) first = { x, yc, box, cost };
        if (!struck && !plain && cost <= first.cost + hard) plain = { x, yc, box };
      } else {
        const score = Number.isFinite(perCandle) ? count * perCandle + cost : count;
        if (score < worst) { best = { x, yc, box }; worst = score; }
      }
    }
    const free = plain ?? first;
    if (free) return { x: free.x, yc: free.yc, box: take(free.box), forced: false };
    return best ? { ...best, box: take(best.box), forced: true } : null;
  };
  // The labels placed with put(): the ones a later label may move.
  const labels = [];
  /**
   * A label that would go over candles (or nowhere), or (with `hard`) under a level line through its glyphs, first tries
   * to free one of its candle-free spots (with `hard`, one no level line strikes): the one or two labels in the way move
   * to candle-free spots of their own (their first by their own rule), or nothing moves.
   */
  const repair = label => {
    const { w, options } = label, s = asSpots(label.spots), half = options.half ?? 7, known = memo(s, w, half), hard = options.hard > 0;
    if (label.at) release(label.at.box);
    let tries = 0;
    for (let k = 0; k < s.n && tries < 80; k++) {
      s.fill(k);
      if (known.solid(k) || (hard && known.strike(k))) continue;
      const x = s.x[k], yc = s.y[k], box = { x0: x, x1: x + w, y0: yc - half, y1: yc + half, label: true, kin: options.kin ?? null };
      tries++;
      const blockers = labels.filter(other => clash(other.at.box, box));
      if (!blockers.length || blockers.length > 2) continue;
      blockers.forEach(other => release(other.at.box));
      if (!hits(box)) {
        take(box);
        const moved = [];
        for (const other of blockers) { const at = place(other.w, other.spots, { ...other.options, forced: false }); if (!at) break; moved.push(at); }
        if (moved.length === blockers.length) {
          blockers.forEach((other, i) => { other.at = moved[i]; });
          label.at = { x, yc, box, forced: false };
          return;
        }
        moved.forEach(at => release(at.box));
        release(box);
      }
      blockers.forEach(other => take(other.at.box));
    }
    if (label.at) take(label.at.box);
  };
  /**
   * place(), keeping the label movable: returns { at } (at is null when it found no spot), read once every label is
   * placed. A label that went over candles (or nowhere), or under a level line with `hard`, tries repair() (`repair`, by
   * default unless `forced` is false).
   */
  const put = (w, spots, options = {}) => {
    const label = { w, spots, options, at: place(w, spots, options) };
    const struck = options.hard > 0 && label.at && !label.at.forced && strike(label.at.box);
    if ((!label.at || label.at.forced || struck) && (options.repair ?? options.forced !== false)) repair(label);
    if (label.at) labels.push(label);
    return label;
  };
  /** Take a put() label back out (its box is freed). */
  const drop = label => { if (label.at) { release(label.at.box); labels.splice(labels.indexOf(label), 1); label.at = null; } };
  /** Once every label is placed: a forced label whose candle-free spot a later move freed takes it. */
  const settle = () => {
    for (let pass = 0, moved = true; moved && pass < 3; pass++) {
      moved = false;
      for (const label of labels.filter(one => one.at.forced)) {
        release(label.at.box);
        const at = place(label.w, label.spots, { ...label.options, forced: false });
        if (at) { label.at = at; moved = true; } else take(label.at.box);
      }
    }
  };
  return { take, release, hits, place, put, drop, settle, boxes };
}

/** The data attributes of a placed label: its reserved box, and for a forced one the search the test re-runs. */
export const placedAttrs = (at, search) => `data-box="${[at.box.x0, at.box.x1, at.box.y0, at.box.y1].map(v => v.toFixed(1)).join(' ')}"${at.forced ? ` data-forced="1" data-search="${search}"` : ''}`;
