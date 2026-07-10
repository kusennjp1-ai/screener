/**
 * Pure helpers for the RRG playback + money-flow readout.
 *
 * Flow score for one series at a frame = its movement vector between the
 * previous and current tail point, projected northeast: Δratio + Δmomentum.
 * Moving toward Leading (up-right) = capital flowing IN; toward Lagging
 * (down-left) = flowing OUT. This is the standard RRG rotation reading
 * (JdK): heading, not position, is what shows where money is going NOW.
 */

/** Quadrant of a single (x, y) tail point (both axes centered at 100). */
export const pointQuadrant = (x, y) => {
  if (x >= 100 && y >= 100) return 'Leading';
  if (x >= 100) return 'Weakening';
  if (y >= 100) return 'Improving';
  return 'Lagging';
};

/** Longest tail length among the shown series (= number of playable frames). */
export const maxFrames = (groups) =>
  (groups ?? []).reduce((m, g) => Math.max(m, (g.tail ?? []).length), 0);

/**
 * Slice one series to a playback frame: tail capped at `frame` (inclusive),
 * head = the point at `frame` (series with shorter tails clamp to their last
 * point so they don't vanish mid-playback). `frame == null` means live.
 */
export const groupAtFrame = (group, frame) => {
  const tail = group?.tail ?? [];
  if (frame == null || tail.length === 0) return group;
  const idx = Math.min(frame, tail.length - 1);
  const head = tail[idx];
  return {
    ...group,
    tail: tail.slice(0, idx + 1),
    current: { ...group.current, x: head.x, y: head.y, date: head.date },
    quadrant: pointQuadrant(head.x, head.y),
  };
};

/**
 * Rank where money is flowing at a frame. Returns the top-N inflow (largest
 * positive northeast movement) and outflow (most negative), each as
 * `{ name, score, quadrant }`. Series need >= 2 points up to the frame.
 */
export const computeFlows = (groups, frame, topN = 3) => {
  const scored = [];
  for (const g of groups ?? []) {
    const tail = g.tail ?? [];
    const last = frame == null ? tail.length - 1 : Math.min(frame, tail.length - 1);
    if (last < 1) continue;
    const a = tail[last - 1];
    const b = tail[last];
    if (!a || !b) continue;
    const score = (b.x - a.x) + (b.y - a.y);
    scored.push({
      name: g.industry_group,
      score,
      quadrant: pointQuadrant(b.x, b.y),
    });
  }
  scored.sort((p, q) => q.score - p.score);
  return {
    inflow: scored.slice(0, topN).filter((s) => s.score > 0),
    outflow: scored.slice(-topN).filter((s) => s.score < 0).reverse(),
  };
};
