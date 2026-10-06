import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { entrySnapshot, entryHistoryFromSeries, summarizeEntrySnapshot, ENTRY_METHODS, ENTRY_HISTORY_VERSION } from '../src/static/entryHistory.js';
import { highLowHistory, INDICATOR_HISTORY_VERSION } from '../src/static/indicatorHistory.js';
import { putCallHistory } from '../src/static/putCallHistory.js';
import { distributionHistory } from '../src/static/distributionHistory.js';
import { modelMarket } from '../src/static/portfolioPlan.js';
import { workbenchRuleFingerprint } from './workbench-comparison.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const pathValid = value => /^indicator-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json\.gz$/.test(value || '');
const optionalJson = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function readObservation(root, ref) {
  if (!pathValid(ref?.path) || ref.version !== ENTRY_HISTORY_VERSION || !/^[a-f0-9]{64}$/.test(ref.sha256 || '') || !ref.path.endsWith(`-${ref.sha256.slice(0,16)}.json.gz`)) throw Error('Invalid entry history path');
  const raw = await readFile(resolve(root, ref.path));
  if (hash(raw) !== ref.sha256) throw Error('Entry observation integrity failure');
  const value = JSON.parse(gunzipSync(raw));
  if (value.version !== ENTRY_HISTORY_VERSION || value.as_of !== ref.as_of) throw Error('Entry observation identity mismatch');
  return value;
}
export async function exportIndicatorHistory({ root, rows, entry, manifest, benchmark, bookEvidence, priceHistoryBasis = {}, now }) {
  const extra = await Promise.all(['entryHistory.js', 'entryReadiness.js', 'researchPresentation.js', 'portfolioPlan.js', 'bookSourceContext.js'].map(file => readFile(new URL(`../src/static/${file}`, import.meta.url), 'utf8')));
  const ruleVersion = hash([await workbenchRuleFingerprint(), ...extra].join('\n'));
  const asOf = entry.as_of_date, dates = (benchmark?.bars || []).map(bar => bar.date).filter(date => date <= asOf);
  const previousSession = dates.at(-1) === asOf ? dates.at(-2) : null;
  const snapshot = entrySnapshot(rows, { asOf, previousSession, generatedAt: manifest.generated_at, ruleVersion, market: modelMarket(rows), priceHistoryBasis, now });
  await mkdir(resolve(root, 'indicator-history'), { recursive: true });
  const catalog = await optionalJson(resolve(root, 'indicator-history/index.json')) || { version: ENTRY_HISTORY_VERSION, snapshots: [] };
  if (catalog.version !== ENTRY_HISTORY_VERSION || !Array.isArray(catalog.snapshots) || new Set(catalog.snapshots.map(ref => ref.as_of)).size !== catalog.snapshots.length) throw Error('Invalid entry history catalog');
  let currentRef = catalog.snapshots.find(ref => ref.as_of === asOf);
  if (currentRef) {
    // A later financial observation cannot change the historical source
    // pointer or add an unowned same-session snapshot during correction.
    await readObservation(root, currentRef);
  } else {
    const raw = gzipSync(JSON.stringify(snapshot)), digest = hash(raw), path = `indicator-history/${asOf}-${digest.slice(0, 16)}.json.gz`;
    await writeFile(resolve(root, path), raw);
    currentRef = { version: ENTRY_HISTORY_VERSION, path, sha256: digest, as_of: asOf };
  }
  // Retain only adjacent raw observations, not 126 full-universe snapshots.
  // The browser receives compact dated aggregates; source observations remain
  // independently retrievable through their immutable references.
  const entrySeries = Object.fromEntries(ENTRY_METHODS.map(method => [method, Object.fromEntries([1,3,5].map(approach => [approach, []]))]));
  let previous = null;
  const consume = observation => {
    for (const method of ENTRY_METHODS) for (const approach of [1,3,5]) {
      const {events,...counts} = summarizeEntrySnapshot(observation, previous, method, approach);
      void events; entrySeries[method][approach].push(counts);
    }
    previous = observation;
  };
  for (const ref of catalog.snapshots.filter(ref => ref.as_of <= asOf).sort((a, b) => a.as_of.localeCompare(b.as_of))) consume(await readObservation(root, ref));
  // Same-date builds leave the first recorded observation as the history source.
  // The current research UI continues to recompute its live decisions separately.
  if (previous?.as_of !== asOf) consume(snapshot);
  const input = await optionalJson(resolve(root, 'market-indicator-inputs.json'));
  entry.assets.indicator_history = currentRef;
  return { version: INDICATOR_HISTORY_VERSION, as_of_date: asOf,
    highLow: highLowHistory(bookEvidence, asOf), putCall: putCallHistory(input?.putCall, asOf),
    distribution: Object.fromEntries(['sp500', 'nasdaq'].map(index => [index, distributionHistory(input?.distribution?.[index], index, asOf)])),
    entry: Object.fromEntries(ENTRY_METHODS.map(method => [method, Object.fromEntries([1, 3, 5].map(approach => [approach, entryHistoryFromSeries(entrySeries[method][approach], asOf, method, approach)]))])) };
}
export async function recordIndicatorObservation(root, ref) {
  if (!ref) return; // Old bundles remain readable, without fabricated history.
  await readObservation(root, ref);
  const catalogPath = resolve(root, 'indicator-history/index.json');
  const catalog = await optionalJson(catalogPath) || { version: ENTRY_HISTORY_VERSION, snapshots: [] };
  if (catalog.version !== ENTRY_HISTORY_VERSION || !Array.isArray(catalog.snapshots) || new Set(catalog.snapshots.map(item => item.as_of)).size !== catalog.snapshots.length) throw Error('Invalid entry history catalog');
  const existing = catalog.snapshots.find(item => item.as_of === ref.as_of);
  if (existing) { await readObservation(root, existing); return; }
  catalog.snapshots.push(ref);
  catalog.snapshots = catalog.snapshots.sort((a, b) => a.as_of.localeCompare(b.as_of)).slice(-126);
  await writeFile(catalogPath, JSON.stringify(catalog));
}

export function entryPriceHistoryBasis(chart, asOf) {
  if (chart?.as_of_date !== asOf || chart.bars?.at(-1)?.date !== asOf || chart.bars.length < 251) return null;
  const fingerprint = bars => hash(JSON.stringify(bars.map(bar => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume])));
  return { version: 'overlapping-250-session-ohlcv-v1', latest: fingerprint(chart.bars.slice(-250)), prior: fingerprint(chart.bars.slice(-251, -1)) };
}
