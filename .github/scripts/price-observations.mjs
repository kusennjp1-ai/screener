import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Exporter market/symbol identities are uppercase. Reject aliases rather than
// allowing a case-only rename to disguise a known instrument as missing/new.
const identity = value => typeof value === 'string' && value.length > 0 && value.toUpperCase() === value
  && !/[\s\u0000-\u001f\u007f]/u.test(value);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const ordered = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const seriesKey = (market, type, symbol) => JSON.stringify([market, type, symbol]);

function checkIdentity(value, label) {
  if (!identity(value)) throw Error(`Invalid price observation ${label}`);
  return value;
}

function checkMarket(payload, market) {
  if (!record(payload) || (payload.market != null && payload.market !== market)) {
    throw Error(`Price observation market mismatch: ${market}`);
  }
}

function readInside(root, path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9._%/-]+$/.test(path) || isAbsolute(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error('Unsafe price observation path');
  }
  // Exporter paths URL-escape symbols such as ^VIX. Keep them literal on disk,
  // but do not admit encoded separators, traversal, or another decoding layer.
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { throw Error('Unsafe price observation path'); }
  if (decoded.includes('%') || /[\\\u0000-\u001f\u007f]/u.test(decoded)
    || decoded.split('/').length !== path.split('/').length
    || decoded.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error('Unsafe price observation path');
  }
  const filename = resolve(root, path);
  const inside = relative(root, filename);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw Error('Price observation path escapes data root');
  }
  // Check each existing component before reading, including dangling links.
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw Error('Price observation paths must not contain symlinks');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  const payload = JSON.parse(readFileSync(filename, 'utf8'));
  if (!record(payload)) throw Error('Invalid price observation payload');
  return payload;
}

function latestObservedDate(rows, { positiveClose = false } = {}) {
  if (rows == null) return null;
  if (!Array.isArray(rows)) throw Error('Invalid price observation history');
  let latest = null;
  const seen = new Set();
  for (const row of rows) {
    if (!record(row) || !validDay(row.date)) throw Error('Invalid price observation date');
    if (seen.has(row.date)) throw Error('Duplicate price observation date');
    seen.add(row.date);
    // A timestamp without an observed price is not a price observation. Price
    // Stock closes must be positive; home instruments may have signed values.
    // Eligibility and complete OHLCV verification belong to the existing gate.
    if (typeof row.close !== 'number' || !Number.isFinite(row.close) || (positiveClose && row.close <= 0)) continue;
    if (latest == null || row.date > latest) latest = row.date;
  }
  return latest;
}

/** Extract actual daily observations; export and scan-target dates are ignored. */
export function extractPriceObservations({ dataRoot, manifest }) {
  if (!record(manifest?.markets) || !Object.keys(manifest.markets).length) {
    throw Error('Invalid price observation markets');
  }
  const root = realpathSync(dataRoot);
  const observations = {};
  const seen = new Set();
  const reserve = (market, type, symbol) => {
    checkIdentity(symbol, 'symbol');
    const key = seriesKey(market, type, symbol);
    if (seen.has(key)) throw Error(`Duplicate price observation identity: ${key}`);
    seen.add(key);
    return key;
  };
  for (const [market, entry] of Object.entries(manifest.markets)) {
    checkIdentity(market, 'market');
    checkMarket(entry, market);
    if (entry.assets?.charts != null) {
      const index = readInside(root, entry.assets.charts.path);
      if (index != null) {
        checkMarket(index, market);
        if (!Array.isArray(index.symbols)) throw Error('Invalid price observation chart index');
        for (const item of index.symbols) {
          const key = reserve(market, 'chart', item?.symbol);
          const chart = readInside(root, item.path);
          if (chart == null) continue;
          checkMarket(chart, market);
          if (chart.symbol !== item.symbol) throw Error(`Price observation symbol mismatch: ${key}`);
          const date = latestObservedDate(chart.bars, { positiveClose: true });
          if (date != null) observations[key] = date;
        }
      }
    }
    if (entry.pages?.home != null) {
      const home = readInside(root, entry.pages.home.path);
      if (home != null) {
        checkMarket(home, market);
        if (home.key_markets != null && !Array.isArray(home.key_markets)) throw Error('Invalid price observation key markets');
        for (const item of home.key_markets || []) {
          const key = reserve(market, 'home', item?.symbol);
          const date = latestObservedDate(item.history);
          // latest_date is only display metadata. History is the evidence even
          // when that metadata or the scan target claims a later date.
          if (date != null) observations[key] = date;
        }
      }
    }
  }
  return ordered(observations);
}

function checkedDates(dates) {
  if (!record(dates)) throw Error('Invalid price observation map');
  for (const [key, date] of Object.entries(dates)) {
    let tuple;
    try { tuple = JSON.parse(key); } catch { throw Error('Invalid price observation identity'); }
    if (!Array.isArray(tuple) || tuple.length !== 3 || !identity(tuple[0]) || !['chart', 'home'].includes(tuple[1])
      || !identity(tuple[2]) || JSON.stringify(tuple) !== key) throw Error('Invalid price observation identity');
    if (!validDay(date)) throw Error('Invalid price observation date');
  }
  return ordered(dates);
}

/** Keep dates through absences so an old returning instrument still regresses. */
export function comparePriceObservations(observed, knownDates = {}) {
  const current = checkedDates(observed), previous = checkedDates(knownDates);
  const merged = { ...previous }, regressions = [], missing = [];
  let advances = false;
  for (const [key, date] of Object.entries(previous)) {
    if (!Object.hasOwn(current, key)) missing.push(key);
    else if (current[key] < date) regressions.push({ key, previous: date, observed: current[key] });
    else if (current[key] > date) advances = true;
  }
  for (const [key, date] of Object.entries(current)) {
    if (!Object.hasOwn(merged, key) || date > merged[key]) merged[key] = date;
  }
  return { advances: advances && regressions.length === 0, regressions, missing, knownDates: ordered(merged) };
}

export function priceObservationDigest(observations) {
  return createHash('sha256').update(JSON.stringify(checkedDates(observations))).digest('hex');
}

/**
 * An observation must exist by capture. UTC+14 is the furthest civil timezone,
 * so its calendar date is a conservative bound for every market and crypto
 * series. Callers use GitHub's immutable artifact creation/deployment time,
 * never scan dates or source-provided generation timestamps, as that bound.
 */
export function assertPriceObservationBounds(observations, capturedAt) {
  const timestamp = typeof capturedAt === 'number' ? capturedAt : Date.parse(capturedAt);
  if (!Number.isFinite(timestamp)) throw Error('Invalid price observation capture bound');
  const limit = new Date(timestamp + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const [key, date] of Object.entries(checkedDates(observations))) {
    if (date > limit) throw Error(`Price observation exceeds capture date: ${key} ${date} > ${limit}`);
  }
}
