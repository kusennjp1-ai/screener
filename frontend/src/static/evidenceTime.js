// One formatter per module, rather than one ICU allocation for every stock.
const newYorkDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Cache only primitive parsing results, never evidence, eligibility or a clock
// interval. Each caller still compares its exact current instant to deadlines.
// Publications repeat the same dates and timestamps across thousands of rows.
const days = new Map(), timestamps = new Map();
function remember(cache, key, value) {
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}
export const validClock = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8640000000000000;
export const evidenceTimestamp = value => {
  if (typeof value !== 'string') return NaN;
  // Keep the cache bounded in bytes as well as entries for malformed inputs.
  if (value.length > 64) return Date.parse(value);
  return timestamps.has(value) ? timestamps.get(value) : remember(timestamps, value, Date.parse(value));
};
export const validEvidenceDay = value => {
  if (typeof value !== 'string' || value.length !== 10) return false;
  if (days.has(value)) return days.get(value);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return remember(days, value, valid);
};
let lastClock, lastDay;
export const newYorkDate = now => {
  if (!validClock(now)) return null;
  // A render/worker evaluation supplies one instant to every row. An exact-key
  // cache avoids repeating ICU formatting without rounding across midnight,
  // DST, evidence expiration or a clock rollback.
  if (now === lastClock) return lastDay;
  const date = newYorkDayFormatter.format(now);
  lastClock = now;
  lastDay = validEvidenceDay(date) ? date : null;
  return lastDay;
};
