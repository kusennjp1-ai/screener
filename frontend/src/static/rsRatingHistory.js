import { RS_METHOD } from './qualificationAudit';
import { validEvidenceDay } from './evidenceTime';

// Array#some skips holes. Every declared observation/calendar slot must be
// present; a malformed payload is unavailable, not a partially trusted graph.
const denseEvery = (values, predicate) => {
  for (let index = 0; index < values.length; index++) {
    if (!Object.hasOwn(values, index) || !predicate(values[index], index)) return false;
  }
  return true;
};

export function validatedRsRatingHistory(history, symbol, date, current) {
  if (history?.schema_version !== 'published-universe-rs-history-v1' || history.symbol !== symbol || history.as_of_date !== date || history.method !== RS_METHOD || history.basis !== 'current_verified_publication_universe_recalculated' || history.source !== 'verified_daily_ohlcv' || !Number.isInteger(history.current_universe_size) || history.current_universe_size < 100) return null;
  const { sessions, points } = history;
  if (!Array.isArray(sessions) || !sessions.length || sessions.at(-1) !== date || !denseEvery(sessions, (day, i) => validEvidenceDay(day) && day <= date && (!i || day > sessions[i - 1]))) return null;
  const dates = new Set(sessions);
  if (!Array.isArray(points) || !points.length || points.at(-1)?.time !== date || points.at(-1)?.value !== current || !denseEvery(points, (point, i) => point !== null && typeof point === 'object' && !Array.isArray(point) && dates.has(point.time) && Number.isFinite(point.value) && point.value >= 1 && point.value <= 99 && Number.isInteger(point.universe_size) && point.universe_size >= 100 && point.universe_size <= history.current_universe_size && (!i || point.time > points[i - 1].time))) return null;
  return history;
}
