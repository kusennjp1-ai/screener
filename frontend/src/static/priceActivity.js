// A row's recent price activity, as the research export publishes it (`price_activity`, tools/export-research.mjs).
// Moved out of the exporter with the same output (round 3, STEP 0 helper H2), so the exporter and the synthetic test
// oracles compute it with one function. It is an equivalent refactor, not a verbatim move: 60 and 5 became named
// constants, and the exporter's `audit.valid ? chart.bars.slice(-60) : []` became an argument that is null when the
// audit refused the bars. Identity is proven by re-export (docs/round3/step0.md, H2), key order included.
// Round 3 R2 (pinned prices after a gap) added two more ways a row is low activity, the since-gap range and ADR20, and
// the figures each used. `range60pct` and `lowRange` stay the first two keys with their meaning (lowRange true means
// 低変動・監視のみ), so every reader that keys on `lowRange` alone is unchanged. No imports: plain Node and the
// exporter run it.

/** The sessions the range is measured over (the last N certified daily bars). */
export const PRICE_ACTIVITY_SESSIONS = 60;
/** A range under this % over those sessions is low activity (`lowRange`: 低変動・監視のみ, the brief's own rule). */
export const LOW_RANGE_PERCENT = 5;
/**
 * ADR20's sessions: the mean daily range over the last N bars (独自設定). The same window and formula as the plan's ADR
 * (positionSizing.js ADR_SESSIONS / adrState: high ÷ low − 1), restated here because this module has no imports.
 */
export const ACTIVITY_ADR_SESSIONS = 20;
/** ADR20 under this % is low activity (独自設定, round 3 R2; chosen after seeing the charts, the owner confirms: OD6). */
export const LOW_ADR_PERCENT = 0.5;
/**
 * A one-day move of at least this % is a gap (独自設定, round 3 R2; OD6). The move is close to close, |close ÷ previous
 * close − 1|, so an open that gaps and a day that runs both count; the largest one in the last PRICE_ACTIVITY_SESSIONS
 * sessions is the one read.
 */
export const GAP_MOVE_PERCENT = 10;
/** The high/low range of the sessions after the gap under this % is pinned (独自設定, round 3 R2; OD6). */
export const SINCE_GAP_RANGE_PERCENT = 3;
/** … over at least this many sessions after the gap's bar (独自設定, round 3 R2; OD6). */
export const SINCE_GAP_MIN_SESSIONS = 15;

const positive = value => Number.isFinite(value) && value > 0;
const NONE = Object.freeze({ range60pct: null, lowRange: false, reason: null, adr20pct: null, gap: null });

/** ADR20 in %: the mean of (high ÷ low − 1) over the last ACTIVITY_ADR_SESSIONS bars, or null when one lacks a usable high or low. */
function adr20(bars) {
  const window = bars.slice(-ACTIVITY_ADR_SESSIONS);
  if (window.length < ACTIVITY_ADR_SESSIONS || !window.every(bar => positive(bar?.high) && positive(bar?.low) && bar.high >= bar.low)) return null;
  return window.reduce((sum, bar) => sum + (bar.high / bar.low - 1), 0) / ACTIVITY_ADR_SESSIONS * 100;
}

/**
 * The largest one-day close-to-close move into each of the last PRICE_ACTIVITY_SESSIONS bars, when it is a gap (at least
 * GAP_MOVE_PERCENT): `{ date, pct, sessions, rangePct }` with its signed move in %, the sessions after its bar and their
 * high/low range in % (null when no session follows or one lacks a usable high or low). Null without the previous close
 * of every one of those bars (fewer than 61 bars, or a missing or non-positive close), or when no move reaches a gap.
 */
function largestGap(bars) {
  const n = bars.length, first = n - PRICE_ACTIVITY_SESSIONS;
  if (first < 1) return null;
  let at = -1, pct = 0;
  for (let i = first; i < n; i++) {
    if (!positive(bars[i]?.close) || !positive(bars[i - 1]?.close)) return null;
    const move = (bars[i].close / bars[i - 1].close - 1) * 100;
    if (Math.abs(move) > Math.abs(pct)) { at = i; pct = move; }
  }
  if (at < 0 || !(Math.abs(pct) >= GAP_MOVE_PERCENT) || typeof bars[at].date !== 'string') return null;
  const after = bars.slice(at + 1);
  const rangePct = after.length && after.every(bar => positive(bar?.high) && positive(bar?.low) && bar.high >= bar.low)
    ? (Math.max(...after.map(bar => bar.high)) / Math.min(...after.map(bar => bar.low)) - 1) * 100 : null;
  return { date: bars[at].date, pct, sessions: after.length, rangePct };
}

/**
 * `{ range60pct, lowRange, reason, adr20pct, gap }` from a row's daily `bars` (the exporter passes its certified chart
 * bars, or null when the audit refused them).
 * - `range60pct`: the highest high over the lowest low of the last 60 bars, minus 1, in %, or null with fewer than 60 bars
 *   (or none), computed exactly as before round 3.
 * - `lowRange` (低変動・監視のみ) is true when one of three rules holds, each on known figures only (a missing or
 *   non-positive value makes its rule unknown, never true): (i) a 60-session range under LOW_RANGE_PERCENT; (ii) since a
 *   gap (`gap`) the range stayed under SINCE_GAP_RANGE_PERCENT over at least SINCE_GAP_MIN_SESSIONS sessions; (iii) ADR20
 *   under LOW_ADR_PERCENT.
 * - `reason`: the first rule that holds, in that order ('range60', 'since_gap', 'adr'), or null.
 * - `adr20pct` (ADR20 in %) and `gap` (largestGap's): the figures, published for a low-activity row only and null on every
 *   other row, so the research index (where price_activity is a list field) grows by about 2.6 kB gzip instead of about
 *   83 kB (rebuild approximation, docs/round3/verdict.md R2). On a low-activity row a null figure is unknown or no gap.
 * Fewer than 60 bars (or null) give no figure at all and lowRange false.
 */
export function priceActivity(bars) {
  const recent60 = Array.isArray(bars) ? bars.slice(-PRICE_ACTIVITY_SESSIONS) : [];
  const range60 = recent60.length === PRICE_ACTIVITY_SESSIONS ? (Math.max(...recent60.map(b=>b.high))/Math.min(...recent60.map(b=>b.low))-1)*100 : null;
  if (range60 === null) return { ...NONE };
  const narrow = recent60.every(bar => positive(bar?.high) && positive(bar?.low)) && range60 < LOW_RANGE_PERCENT;
  const adr20pct = adr20(bars), gap = largestGap(bars);
  const pinned = gap !== null && gap.sessions >= SINCE_GAP_MIN_SESSIONS && gap.rangePct !== null && gap.rangePct < SINCE_GAP_RANGE_PERCENT;
  const reason = narrow ? 'range60' : pinned ? 'since_gap' : adr20pct !== null && adr20pct < LOW_ADR_PERCENT ? 'adr' : null;
  const low = reason !== null;
  return { range60pct: range60, lowRange: low, reason, adr20pct: low ? adr20pct : null, gap: low ? gap : null };
}

/** M/D of an ISO day (Y/M/D when its year is not the reference's), or null. */
function monthDay(iso, reference) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return `${typeof reference === 'string' && /^\d{4}-/.test(reference) && reference.slice(0, 4) !== iso.slice(0, 4) ? `${y}/` : ''}${m}/${d}`;
}

/** A signed whole percent with U+2212 for a fall: 「+44%」, 「−30%」. */
const signedPercent = value => `${value < 0 ? '−' : '+'}${Math.abs(Math.round(value))}%`;

/** The words for a low-activity row whose reason this reader does not know (a later publication), never another rule's. */
export const LOW_ACTIVITY_UNKNOWN_REASON = '低変動（理由 未確認）';

/**
 * Why a row is low activity, in the brief's words, or null when it is not (`activity.lowRange` not true). One producer for
 * every screen (entryReadiness, the stock conclusion). `asOf` (the analysis date) sets whether a date shows its year.
 * - 'range60', or a lowRange without a `reason` (a publication before round 3, when it was the only rule): 「60日値幅5%未満」.
 * - 'since_gap': 「8/27の窓開け（+44%）後25営業日の値幅3%未満」 (the gap's date and move, the sessions after it, the constant).
 * - 'adr': 「20日平均値幅（ADR）0.5%未満」.
 * - any other reason, or a since-gap row without a readable gap: LOW_ACTIVITY_UNKNOWN_REASON.
 */
export function lowActivityReason(activity, asOf = null) {
  if (activity?.lowRange !== true) return null;
  const reason = activity.reason ?? 'range60';
  if (reason === 'range60') return `${PRICE_ACTIVITY_SESSIONS}日値幅${LOW_RANGE_PERCENT}%未満`;
  if (reason === 'adr') return `${ACTIVITY_ADR_SESSIONS}日平均値幅（ADR）${LOW_ADR_PERCENT}%未満`;
  const gap = activity.gap, day = monthDay(gap?.date, asOf);
  if (reason === 'since_gap' && day && Number.isFinite(gap.pct) && Number.isInteger(gap.sessions) && gap.sessions > 0) {
    return `${day}の窓開け（${signedPercent(gap.pct)}）後${gap.sessions}営業日の値幅${SINCE_GAP_RANGE_PERCENT}%未満`;
  }
  return LOW_ACTIVITY_UNKNOWN_REASON;
}
