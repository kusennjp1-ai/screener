// The price chart's label placer (imported by priceChart.js only, so it ships in the chart's lazy chunk). One rule for
// every label: in priority order, each takes the first of its candidate spots that overlaps no box already taken
// (labels, tags, marks, leaders) and no candle, preferring one that no line (an average, a level) crosses, and (when
// asked) one no level line strikes through; only when no candle-free spot is left does it go over candles (the spot
// with the fewest, with its halo), and it is marked forced. A label with a leader takes a spot only where the leader is
// clear too, and holds the leader with its box.

/**
 * Horizontal clearance kept beside a reserved box (a 12px label's box is 14px tall, so 2px stays above and below its
 * glyphs). Two labels sharing a row keep PHRASE_GAP between their glyphs, so they never read as one phrase
 * (「ピボット 2R 130.47」, 「T1 買いゾーン」, 「150 10」): at 6px or 9px they still do at 12px text, at 14px they read
 * apart (rendered with the chart's fonts). Their boxes keep LABEL_GAP, 2px more on each side for the estimated widths.
 */
export const BOX_GAP = 3, PHRASE_GAP = 14, LABEL_GAP = PHRASE_GAP + 2;
/** The plan's green names (ピボット, 買いゾーン) on one row keep three glyphs apart: two green words read as one. */
export const KIN_GAP = { plan: 36 };
/** Two leaders meet when they share more than this much of their length (each box reaches past its line by up to 2px). */
export const LEADER_SLACK = 2;
/** The default x step of a search (data-search names the step; the test that checks a forced label re-runs the same spots). */
export const SEARCH_STEP = 2;
// The height of the placer's bands of reserved boxes.
const BAND = 16;

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
 * @param {object} p `solid(box)` counts the candles (or volume bars) a box overlaps; `soft(box)` counts the lines that
 *   cross it (or says whether one does); `strike(box)` whether a level line runs through its glyphs (a label that asks
 *   for it, with `hard`).
 * @returns the placer: `take(box)` reserves a box (a tag, a mark, a caption), `release(box)` frees one, `hits(box)` says
 *   whether it overlaps a reserved box, `place(w, spots, options)` reserves and returns the first spot by the rule, and
 *   `put(w, spots, options)` places a label a later one may move (see repair), `drop(label)` takes it back out,
 *   `settle()` gives a forced label the candle-free spot a later move freed, and `snapshot()`/`restore(state)` keep
 *   and bring back the whole state.
 */
export function labelPlacer({ solid = () => 0, soft = () => false, strike = () => false } = {}) {
  const boxes = [];
  const clash = (a, b) => {
    let gap;
    if (a.leader && b.leader) {
      // Two leaders meet where one runs along the other or ends across it, not where both leave one line end apart. A
      // line's end ('end') meets the leader of another line that runs past it, not its own leader nor one that leaves
      // from the same point.
      if (a.key !== undefined && a.key === b.key) return false;
      const [end, other] = a.leader === 'end' ? [a, b] : [b, a];
      if (end.leader === 'end' && other.from !== undefined && Math.abs(other.from - (end.y0 + end.y1) / 2) <= 3) return false;
      // Two vertical parts leaving one point (ends within 3px) meet only when they go the same way.
      if (a.leader === 'v' && b.leader === 'v' && Math.abs(a.from - b.from) <= 3) return a.up === b.up && a.x0 < b.x1 && a.x1 > b.x0;
      return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 - LEADER_SLACK && a.y1 > b.y0 + LEADER_SLACK;
    }
    if (a.leader || b.leader) {
      // A leader's vertical part (and a line's end) runs in the axis gutter beside the tags' leaders and the last
      // price's dot: only a label or another leader meets it. A leader keeps BOX_GAP from a label.
      if ((a.leader !== 'h' && a.leader && !b.label) || (b.leader !== 'h' && b.leader && !a.label)) return false;
      gap = a.label || b.label ? BOX_GAP : 0;
    } else gap = a.label && b.label ? (a.kin && a.kin === b.kin ? KIN_GAP[a.kin] ?? LABEL_GAP : LABEL_GAP) : BOX_GAP;
    return a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.y0 < b.y1 && a.y1 > b.y0;
  };
  // The reserved boxes by band of height (BAND px): two boxes meet only where their heights overlap, so a box is checked
  // against those in its bands only (thousands of spots are tried against tens of boxes).
  const bands = new Map(), bandsOf = box => { const out = []; for (let k = Math.floor(box.y0 / BAND); k <= Math.floor(box.y1 / BAND); k++) out.push(k); return out; };
  const hits = box => {
    for (let k = Math.floor(box.y0 / BAND), last = Math.floor(box.y1 / BAND); k <= last; k++) {
      const list = bands.get(k);
      if (list) for (const b of list) if (clash(box, b)) return true;
    }
    return false;
  };
  const take = box => { boxes.push(box); for (const k of bandsOf(box)) { if (!bands.has(k)) bands.set(k, []); bands.get(k).push(box); } return box; };
  const release = box => {
    const i = boxes.indexOf(box);
    if (i < 0) return;
    boxes.splice(i, 1);
    for (const k of bandsOf(box)) { const list = bands.get(k), j = list.indexOf(box); if (j >= 0) list.splice(j, 1); }
  };
  // A placed label holds its box and its leader's segments (`extra`): taken and freed together.
  const takeAt = at => { take(at.box); at.extra?.forEach(take); return at; };
  // The boxes of a label placed with put() know it (`of`), so the labels in a spot's way are found from the bands.
  const own = label => { if (label.at) for (const box of held(label.at)) box.of = label; return label; };
  const releaseAt = at => { release(at.box); at.extra?.forEach(release); };
  const held = at => (at.extra?.length ? [at.box, ...at.extra] : [at.box]);
  // What never changes for a spot (the candles under it, a line across it, a level through its glyphs) is worked out
  // once per list and label size: a label placed again (repair, settle) only checks the reserved boxes.
  const memo = (s, w, half) => {
    if (s.memo?.w !== w || s.memo.half !== half) s.memo = { w, half, solid: new Int16Array(s.n).fill(-1), soft: new Int8Array(s.n).fill(-1), strike: new Int8Array(s.n).fill(-1) };
    const m = s.memo, box = k => ({ x0: s.x[k], x1: s.x[k] + w, y0: s.y[k] - half, y1: s.y[k] + half });
    return {
      solid: k => { if (m.solid[k] < 0) m.solid[k] = Math.min(32767, solid(box(k))); return m.solid[k]; },
      soft: k => { if (m.soft[k] < 0) m.soft[k] = Math.min(127, Number(soft(box(k)))); return m.soft[k]; },
      strike: k => { if (m.strike[k] < 0) m.strike[k] = strike(box(k)) ? 1 : 0; return m.strike[k] === 1; },
    };
  };
  /**
   * The spot for a label `w` wide (half its height `half` around the centre): the first candle-free spot no line
   * crosses, accepting up to `slack` more cost than the first candle-free spot to find one; with `hard`, a spot a level
   * line strikes through is taken only when no other candle-free spot is within `hard` more cost; else that first
   * candle-free spot; else (`forced`) the spot over the fewest candles (or, with `perCandle`, the lowest cost counting
   * each candle as that much more), then the lowest cost; never over a reserved box (`kin`: see KIN_GAP). With `fewest`,
   * the candle-free spot (no level line through it) within `hard` of the first that the fewest lines cross wins over the
   * first one when every such spot is crossed. A label with a `leader` (`(x, yc)` → the segments joining it there to its
   * line, each a box with `leader` 'v' or 'h', its line's `key` and the height `from` which it leaves; null where no
   * leader may run, so no spot there) takes a spot only where every segment is clear of the reserved boxes too (a
   * line's end held as a box with `leader` 'end' included), and reserves them with its box, so no later label sits on
   * them. Returns { x, yc, box, extra, forced } (the box and the segments in `extra` reserved) or null.
   */
  const place = (w, spotsIn, { forced = true, slack = Infinity, half = 7, perCandle = Infinity, kin = null, hard = 0, leader = null, fewest = false } = {}) => {
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
      const extra = leader ? leader(x, yc) : [];
      if (!extra || extra.some(hits)) continue;
      if (count === 0) {
        const struck = hard > 0 && known.strike(k), crossed = known.soft(k);
        if (!struck && !crossed && (!first || cost <= first.cost + slack)) return takeAt({ x, yc, box, extra, forced: false });
        if (!first) first = { x, yc, box, extra, cost };
        if (!struck && (!plain || (fewest && crossed < plain.crossed)) && cost <= first.cost + hard) plain = { x, yc, box, extra, crossed };
      } else {
        const score = Number.isFinite(perCandle) ? count * perCandle + cost : count;
        if (score < worst) { best = { x, yc, box, extra }; worst = score; }
      }
    }
    const free = plain ?? first;
    if (free) return takeAt({ x: free.x, yc: free.yc, box: free.box, extra: free.extra, forced: false });
    return best ? takeAt({ ...best, forced: true }) : null;
  };
  // The labels placed with put(): the ones a later label may move.
  const labels = [];
  /**
   * A label that would go over candles (or nowhere), or (with `hard`) under a level line through its glyphs, first tries
   * to free one of its candle-free spots (with `hard`, one no level line strikes): the one or two labels in the way move
   * to candle-free spots of their own (their first by their own rule), or nothing moves. A label that found no spot at
   * all may move them over candles (their own rule's forced spot): a forced label reads, a missing one does not.
   */
  const repair = label => {
    const { w, options } = label, s = asSpots(label.spots), half = options.half ?? 7, known = memo(s, w, half), hard = options.hard > 0;
    const dropped = !label.at;
    if (label.at) releaseAt(label.at);
    // A label in the way that found no other spot twice is not asked again (each ask may try thousands of spots).
    const stuck = new Map();
    let tries = 0;
    for (let k = 0; k < s.n && tries < 80; k++) {
      s.fill(k);
      if (known.solid(k) || (hard && known.strike(k))) continue;
      const x = s.x[k], yc = s.y[k], box = { x0: x, x1: x + w, y0: yc - half, y1: yc + half, label: true, kin: options.kin ?? null };
      const extra = options.leader ? options.leader(x, yc) : [];
      if (!extra) continue;
      const at = { x, yc, box, extra, forced: false }, mine = held(at);
      tries++;
      // The labels in its way; a box no movable label holds (a tag, a mark, a caption) keeps the spot taken.
      const blockers = new Set();
      let fixed = false;
      for (const one of mine) for (let b = Math.floor(one.y0 / BAND); b <= Math.floor(one.y1 / BAND) && !fixed; b++) for (const theirs of bands.get(b) ?? []) {
        if (!clash(one, theirs)) continue;
        if (theirs.of?.at && labels.includes(theirs.of)) blockers.add(theirs.of); else { fixed = true; break; }
      }
      if (fixed || !blockers.size || blockers.size > 2 || [...blockers].some(other => stuck.get(other) >= 2)) continue;
      blockers.forEach(other => releaseAt(other.at));
      if (!mine.some(hits)) {
        takeAt(at);
        const moved = [];
        for (const other of blockers) {
          const spot = place(other.w, other.spots, { ...other.options, forced: dropped && other.options.forced !== false });
          if (!spot) { stuck.set(other, (stuck.get(other) ?? 0) + 1); break; }
          moved.push(spot);
        }
        if (moved.length === blockers.size) {
          [...blockers].forEach((other, i) => { other.at = moved[i]; own(other); });
          label.at = at;
          own(label);
          return;
        }
        moved.forEach(releaseAt);
        releaseAt(at);
      }
      blockers.forEach(other => takeAt(other.at));
    }
    if (label.at) takeAt(label.at);
  };
  /**
   * place(), keeping the label movable: returns { at } (at is null when it found no spot), read once every label is
   * placed. A label that went over candles (or nowhere), or under a level line with `hard`, tries repair() (`repair`, by
   * default unless `forced` is false).
   */
  const put = (w, spots, options = {}) => {
    const label = own({ w, spots, options, at: place(w, spots, options) });
    const struck = options.hard > 0 && label.at && !label.at.forced && strike(label.at.box);
    if ((!label.at || label.at.forced || struck) && (options.repair ?? options.forced !== false)) repair(label);
    if (label.at) labels.push(own(label));
    return label;
  };
  /** Take a put() label back out (its box is freed). */
  const drop = label => { if (label.at) { releaseAt(label.at); labels.splice(labels.indexOf(label), 1); label.at = null; } };
  /** Once every label is placed: a forced label whose candle-free spot a later move freed takes it. */
  const settle = () => {
    for (let pass = 0, moved = true; moved && pass < 3; pass++) {
      moved = false;
      for (const label of labels.filter(one => one.at.forced)) {
        releaseAt(label.at);
        const at = place(label.w, label.spots, { ...label.options, forced: false });
        if (at) { label.at = at; own(label); moved = true; } else takeAt(label.at);
      }
    }
  };
  /**
   * The placer's state (every reserved box, and where each movable label is), and back to it: a caller trying labels
   * more than one way starts each try from the same state (a try's moves of other labels undone with its own).
   */
  const snapshot = () => ({ boxes: boxes.slice(), labels: labels.map(label => [label, label.at]) });
  const restore = state => {
    boxes.length = 0;
    bands.clear();
    state.boxes.forEach(take);
    labels.length = 0;
    for (const [label, at] of state.labels) { label.at = at; labels.push(own(label)); }
  };
  return { take, release, hits, place, put, drop, settle, snapshot, restore, boxes };
}

/** The data attributes of a placed label: its reserved box, and for a forced one the search the test re-runs. */
export const placedAttrs = (at, search) => `data-box="${[at.box.x0, at.box.x1, at.box.y0, at.box.y1].map(v => v.toFixed(1)).join(' ')}"${at.forced ? ` data-forced="1" data-search="${search}"` : ''}`;
