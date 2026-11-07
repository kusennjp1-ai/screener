// The price chart's label placer (imported by priceChart.js only, so it ships in the chart's lazy chunk). One rule for
// every label: in priority order, each takes the first of its candidate spots that overlaps no box already taken
// (labels, tags, marks) and no candle, preferring one that no line (an average, a level) crosses; only when no
// candle-free spot is left does it go over candles (the spot with the fewest, with its halo), and it is marked forced.

/**
 * Horizontal clearance kept beside a reserved box (a 12px label's box is 14px tall, so 2px stays above and below its
 * glyphs); two labels keep LABEL_GAP, so two names side by side never read as one (「T1 買いゾーン」).
 */
export const BOX_GAP = 3, LABEL_GAP = 6;
/** The default x step of a search (data-search names the step; the test that checks a forced label re-runs the same spots). */
export const SEARCH_STEP = 2;

const range = (a, b, step) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 10) / 10); if (out.at(-1) !== b && b > a) out.push(b); return out; };

/**
 * Candidate spots for a label: every left edge from `x0` to `x1` (`step` apart, `x1` included) at each centre in `ys`
 * (only those `inside` accepts), ordered by `cost(x, yc)` (stable: equal costs keep the x-major order, each x trying
 * `ys` in the order given). `search` describes them for data-search: "x0 x1 step|y y …".
 */
export function spots({ x0, x1, ys, step = SEARCH_STEP, inside = () => true, cost = null }) {
  const valid = ys.filter(inside);
  if (!(x1 >= x0) || !valid.length) return { list: [], search: '' };
  const list = [];
  for (const x of range(x0, x1, step)) for (const yc of valid) list.push([x, yc, cost ? cost(x, yc) : 0]);
  if (cost) list.sort((a, b) => a[2] - b[2]);
  return { list, search: `${x0.toFixed(1)} ${x1.toFixed(1)} ${step}|${valid.map(yc => yc.toFixed(1)).join(' ')}` };
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
 * @param {object} p `solid(box)` counts the candles (or volume bars) a box overlaps; `soft(box)` says whether a line crosses it.
 * @returns the placer: `take(box)` reserves a box (a tag, a mark, a caption), `release(box)` frees one, `hits(box)` says
 *   whether it overlaps a reserved box, `place(w, spots, options)` reserves and returns the first spot by the rule, and
 *   `put(w, spots, options)` places a label a later one may move (see repair), `drop(label)` takes it back out and
 *   `settle()` gives a forced label the candle-free spot a later move freed.
 */
export function labelPlacer({ solid = () => 0, soft = () => false } = {}) {
  const boxes = [];
  const clash = (a, b) => { const gap = a.label && b.label ? LABEL_GAP : BOX_GAP; return a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.y0 < b.y1 && a.y1 > b.y0; };
  const hits = box => boxes.some(b => clash(box, b));
  const take = box => { boxes.push(box); return box; };
  const release = box => { const i = boxes.indexOf(box); if (i >= 0) boxes.splice(i, 1); };
  /**
   * The spot for a label `w` wide (half its height `half` around the centre): the first candle-free spot no line
   * crosses, accepting up to `slack` more cost than the first candle-free spot to find one; else that first
   * candle-free spot; else (`forced`) the spot over the fewest candles (or, with `perCandle`, the lowest cost counting
   * each candle as that much more), then the lowest cost; never over a reserved box. Returns { x, yc, box, forced }
   * (the box reserved) or null.
   */
  const place = (w, { list }, { forced = true, slack = Infinity, half = 7, perCandle = Infinity } = {}) => {
    let free = null, best = null, worst = Infinity;
    for (const [x, yc, cost] of list) {
      if (free && cost > free.cost + slack) break;
      const box = { x0: x, x1: x + w, y0: yc - half, y1: yc + half, label: true };
      if (hits(box)) continue;
      const count = solid(box);
      if (count === 0) {
        if (!soft(box)) return { x, yc, box: take(box), forced: false };
        if (!free) free = { x, yc, box, cost };
      } else if (forced) {
        const score = Number.isFinite(perCandle) ? count * perCandle + cost : count;
        if (score < worst) { best = { x, yc, box }; worst = score; }
      }
    }
    if (free) return { x: free.x, yc: free.yc, box: take(free.box), forced: false };
    return best ? { ...best, box: take(best.box), forced: true } : null;
  };
  // The labels placed with put(): the ones a later label may move.
  const labels = [];
  /**
   * A label that would go over candles (or nowhere) first tries to free one of its candle-free spots: the one or two
   * labels in the way move to candle-free spots of their own (their first by their own rule), or nothing moves.
   */
  const repair = label => {
    const { w, spots: { list }, options } = label, half = options.half ?? 7;
    if (label.at) release(label.at.box);
    let tries = 0;
    for (const [x, yc] of list) {
      if (tries >= 80) break;
      const box = { x0: x, x1: x + w, y0: yc - half, y1: yc + half, label: true };
      if (solid(box)) continue;
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
  /** place(), keeping the label movable: returns { at } (at is null when it found no spot), read once every label is placed. */
  const put = (w, spots, options = {}) => {
    const label = { w, spots, options, at: place(w, spots, options) };
    if ((!label.at || label.at.forced) && options.forced !== false) repair(label);
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
