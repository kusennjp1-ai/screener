import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { measureCandidateReturn, PERFORMANCE_HORIZONS } from '../src/static/candidatePerformance.js';

export const PERFORMANCE_ARCHIVE_VERSION = 'published-close-returns-v1';
const DIRECTORY = 'candidate-performance-history';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const asNewYorkDate = stamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(stamp);
const observationKey = (symbol, horizon) => `${symbol}:${horizon}`;
const sameResult = (a, b) => a?.status === b?.status && a?.end_date === b?.end_date && a?.observed_sessions === b?.observed_sessions &&
  ['return_pct', 'spy_return_pct', 'max_drawdown_pct'].every(key => Number.isFinite(a?.[key]) && Number.isFinite(b?.[key]) && Math.abs(a[key] - b[key]) < 1e-10);

export function cohortIdentity(snapshot) {
  const ref = snapshot?.published_ref;
  if (!validDate(snapshot?.as_of) || !hashValid(ref?.sha256) || ref.as_of !== snapshot.as_of || !/^candidate-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?$/.test(ref.path)) return null;
  return { as_of: snapshot.as_of, path: ref.path, sha256: ref.sha256, rule_version: snapshot.rule_version ?? null,
    universe_version: snapshot.universe_version ?? null, source_research_sha256: snapshot.source_research_sha256 ?? null };
}

export function completedBenchmark(prices, asOf, now) {
  const close = Date.parse(prices?.completed_session_close), fetched = Date.parse(prices?.retrieved_at);
  return prices?.as_of_date === asOf && prices?.calendar === 'NYSE' && prices?.calendar_provider === 'pandas_market_calendars:NYSE' &&
    prices?.adjustment === 'split-adjusted-close-no-dividend' && Array.isArray(prices?.sessions) &&
    Number.isFinite(close) && Number.isFinite(fetched) && close <= fetched && fetched <= now &&
    asNewYorkDate(close) === asOf && asOf <= asNewYorkDate(now);
}

// Keep the original input interval so restored results can be independently
// recomputed even after delisting, missing feeds, or later history revisions.
export function freezeObservation({ snapshot, symbol, horizon, result, stock, prices, sessions, asOf, now }) {
  const cohort = cohortIdentity(snapshot);
  if (!cohort || result.status !== 'complete' || !completedBenchmark(prices, asOf, now) || !hashValid(stock?.source?.sha256)) return null;
  const dates = sessions.filter(date => date >= snapshot.as_of && date <= result.end_date);
  if (dates.length !== horizon + 1) return null;
  const stockMap = new Map(stock.bars.map(bar => [bar.date, bar.close])), spyMap = new Map((prices.series?.SPY || []).map(bar => [bar.date, bar.close]));
  const observation = { symbol, horizon, as_of: asOf, observed_at: new Date(now).toISOString(), result,
    dates, stock_closes: dates.map(date => stockMap.get(date)), spy_closes: dates.map(date => spyMap.get(date)),
    sources: { stock: { ...stock.source, symbol, as_of_date: asOf },
      benchmark: { path: 'sector-prices.json', sha256: digest(JSON.stringify(prices)), hash_basis: 'JSON.stringify(parsed source)', source: prices.source || null,
        retrieved_at: prices.retrieved_at, completed_session_close: prices.completed_session_close },
      calendar: { name: 'NYSE', provider: prices.calendar_provider, adjustment: prices.adjustment } } };
  validateObservation(observation, cohort, now);
  return observation;
}

export function validateObservation(observation, cohort, now = Date.now()) {
  const { dates, stock_closes: stock, spy_closes: spy, sources, result } = observation || {};
  const observedAt = Date.parse(observation?.observed_at), fetched = Date.parse(sources?.benchmark?.retrieved_at), closedAt = Date.parse(sources?.benchmark?.completed_session_close);
  if (!validDate(cohort?.as_of) || !hashValid(cohort?.sha256) || typeof observation?.symbol !== 'string' || !observation.symbol || !PERFORMANCE_HORIZONS.includes(observation.horizon) ||
    !validDate(observation.as_of) || !Number.isFinite(observedAt) || observedAt > now || !Number.isFinite(fetched) || !Number.isFinite(closedAt) ||
    fetched < closedAt || fetched > observedAt || asNewYorkDate(closedAt) !== observation.as_of ||
    !Array.isArray(dates) || dates.length !== observation.horizon + 1 || dates[0] !== cohort.as_of || dates.at(-1) > observation.as_of ||
    dates.some((date, i) => !validDate(date) || [0, 6].includes(new Date(date).getUTCDay()) || (i && date <= dates[i - 1])) ||
    !Array.isArray(stock) || !Array.isArray(spy) || stock.length !== dates.length || spy.length !== dates.length ||
    ![...stock, ...spy].every(value => Number.isFinite(value) && value > 0) || sources?.calendar?.name !== 'NYSE' ||
    sources.calendar.provider !== 'pandas_market_calendars:NYSE' || sources.calendar.adjustment !== 'split-adjusted-close-no-dividend' ||
    sources?.stock?.symbol !== observation.symbol || sources.stock.as_of_date !== observation.as_of || !hashValid(sources.stock.sha256) || !hashValid(sources?.benchmark?.sha256)) throw Error('Invalid frozen performance observation');
  const rebuilt = measureCandidateReturn({ startDate: cohort.as_of, asOf: dates.at(-1), sessions: dates, horizon: observation.horizon,
    stock: { verified: true, bars: dates.map((date, i) => ({ date, close: stock[i] })) },
    benchmark: { verified: true, bars: dates.map((date, i) => ({ date, close: spy[i] })) } });
  if (!sameResult(result, rebuilt)) throw Error('Frozen performance result does not match its original inputs');
  return observation;
}

export async function readPerformanceArchive(root, now = Date.now()) {
  let index;
  try { index = JSON.parse(await readFile(resolve(root, DIRECTORY, 'index.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  if (index.schema_version !== 1 || !Array.isArray(index.cohorts)) throw Error('Invalid performance archive index');
  const cohorts = new Map();
  for (const ref of index.cohorts) {
    if (!new RegExp(`^${DIRECTORY}/\\d{4}-\\d{2}-\\d{2}-[a-f0-9]{16}-[a-f0-9]{16}\\.json\\.gz$`).test(ref.path) || !hashValid(ref.sha256) || !hashValid(ref.cohort_sha256) || cohorts.has(ref.cohort_sha256)) throw Error('Invalid or duplicate performance archive reference');
    const bytes = await readFile(resolve(root, ref.path));
    if (digest(bytes) !== ref.sha256) throw Error('Performance archive integrity failure');
    const value = JSON.parse(gunzipSync(bytes).toString('utf8'));
    if (value.schema_version !== 1 || value.calculator_version !== PERFORMANCE_ARCHIVE_VERSION || value.cohort?.sha256 !== ref.cohort_sha256 || value.cohort?.as_of !== ref.as_of || !Array.isArray(value.observations) || !value.observations.length) throw Error('Performance archive identity failure');
    const observations = new Map();
    for (const observation of value.observations) {
      validateObservation(observation, value.cohort, now);
      const key = observationKey(observation.symbol, observation.horizon);
      if (observations.has(key)) throw Error('Duplicate frozen performance observation');
      observations.set(key, observation);
    }
    cohorts.set(value.cohort.sha256, { cohort: value.cohort, observations });
  }
  return cohorts;
}

export function preservedObservation(archive, snapshot, symbol, horizon, asOf) {
  const cohort = cohortIdentity(snapshot), saved = cohort && archive.get(cohort.sha256);
  if (!saved || JSON.stringify(saved.cohort) !== JSON.stringify(cohort)) return null;
  const observation = saved.observations.get(observationKey(symbol, horizon));
  return observation?.as_of <= asOf && observation.result.end_date <= asOf ? observation : null;
}

export function retainObservation(archive, snapshot, observation) {
  const cohort = cohortIdentity(snapshot);
  if (!cohort || !observation) return;
  const saved = archive.get(cohort.sha256) || { cohort, observations: new Map() };
  if (JSON.stringify(saved.cohort) !== JSON.stringify(cohort)) throw Error('Frozen cohort metadata mismatch');
  const key = observationKey(observation.symbol, observation.horizon);
  if (!saved.observations.has(key)) saved.observations.set(key, observation);
  archive.set(cohort.sha256, saved);
}

export async function writePerformanceArchive(root, archive) {
  await mkdir(resolve(root, DIRECTORY), { recursive: true });
  const refs = [];
  for (const { cohort, observations } of [...archive.values()].sort((a, b) => a.cohort.as_of.localeCompare(b.cohort.as_of) || a.cohort.sha256.localeCompare(b.cohort.sha256))) {
    if (!observations.size) continue;
    const raw = JSON.stringify({ schema_version: 1, calculator_version: PERFORMANCE_ARCHIVE_VERSION, cohort,
      observations: [...observations.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.horizon - b.horizon) });
    const compressed = gzipSync(raw), sha256 = digest(compressed);
    const path = `${DIRECTORY}/${cohort.as_of}-${cohort.sha256.slice(0, 16)}-${sha256.slice(0, 16)}.json.gz`;
    await writeFile(resolve(root, path), compressed);
    refs.push({ as_of: cohort.as_of, cohort_sha256: cohort.sha256, path, sha256, observations: observations.size });
  }
  await writeFile(resolve(root, DIRECTORY, 'index.json'), JSON.stringify({ schema_version: 1, cohorts: refs }));
  return refs;
}
