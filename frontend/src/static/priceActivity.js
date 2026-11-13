// A row's recent price activity, as the research export publishes it (`price_activity`, tools/export-research.mjs).
// Moved verbatim out of the exporter (round 3, STEP 0 helper H2) so the exporter and the synthetic test oracles
// compute it with one function; the output is unchanged, key order included. No imports: plain Node runs it.

/** The sessions the range is measured over (the last N certified daily bars). */
export const PRICE_ACTIVITY_SESSIONS = 60;
/** A range under this % over those sessions is low activity (`lowRange`: 低変動・監視のみ, the brief's own rule). */
export const LOW_RANGE_PERCENT = 5;

/**
 * `{ range60pct, lowRange }` from a row's daily `bars` (the exporter passes its certified chart bars, or null when the
 * audit refused them). `range60pct` is the highest high over the lowest low of the last 60 bars, minus 1, in %, or
 * null with fewer than 60 bars (or none); `lowRange` is true only for a known range under 5%, never for a missing one.
 */
export function priceActivity(bars) {
  const recent60 = Array.isArray(bars) ? bars.slice(-PRICE_ACTIVITY_SESSIONS) : [];
  const range60 = recent60.length === PRICE_ACTIVITY_SESSIONS ? (Math.max(...recent60.map(b=>b.high))/Math.min(...recent60.map(b=>b.low))-1)*100 : null;
  return {range60pct:range60,lowRange:range60 != null && range60 < LOW_RANGE_PERCENT};
}
