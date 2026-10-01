import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeObservation, preservedObservation, readPerformanceArchive, retainObservation, validateObservation, writePerformanceArchive } from './candidate-performance-archive.mjs';
import { candidatePerformance, measureCandidateReturn } from '../src/static/candidatePerformance.js';
import { exportCandidatePerformance } from './export-candidate-performance.mjs';

const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const dates = ['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-28'];
const asOf = dates.at(-1), now = Date.parse('2026-09-28T22:00:00Z');
const record = { symbol: 'CASE', market: 'US', liquid: true, methods: { minervini: { state: 'pass' } } };
const snapshot = { as_of: dates[0], rule_version: 'rules-1', universe_version: 'universe-1', source_research_sha256: 'b'.repeat(64), records: [record],
  published_ref: { as_of: dates[0], path: `candidate-history/${dates[0]}-${'a'.repeat(16)}.json.gz`, sha256: 'a'.repeat(64) } };
const stock = { verified: true, bars: dates.map((date, i) => ({ date, close: 100 + i })), source: { path: 'verified-charts/CASE.json', sha256: 'c'.repeat(64) } };
const prices = { as_of_date: asOf, calendar: 'NYSE', calendar_provider: 'pandas_market_calendars:NYSE', adjustment: 'split-adjusted-close-no-dividend',
  source: 'synthetic test fixture', retrieved_at: '2026-09-28T21:00:00Z', completed_session_close: '2026-09-28T20:00:00Z', sessions: dates,
  series: { SPY: dates.map((date, i) => ({ date, close: 200 + i })) } };
const benchmark = { verified: true, bars: prices.series.SPY };
const measure = horizon => measureCandidateReturn({ startDate: dates[0], asOf, sessions: dates, stock, benchmark, horizon });
const frozen = extra => freezeObservation({ snapshot, symbol: 'CASE', horizon: 5, result: measure(5), stock, prices, sessions: dates, asOf, now, ...extra });
const temp = async () => { const path = await mkdtemp(join(tmpdir(), 'candidate-performance-')); directories.push(path); return path; };

it('restores exact completed results with original price/SPY inputs after the symbol disappears', async () => {
  const archive = new Map(), observation = frozen(), root = await temp();
  retainObservation(archive, snapshot, observation);
  const refs = await writePerformanceArchive(root, archive);
  expect(refs).toHaveLength(1);
  const restored = await readPerformanceArchive(root, now + 1000);
  const saved = preservedObservation(restored, snapshot, 'CASE', 5, '2026-09-29');
  expect(saved).toEqual(observation);
  expect(saved.sources.stock.sha256).toBe(stock.source.sha256);
  expect(saved.sources.calendar.adjustment).toBe('split-adjusted-close-no-dividend');
  const result = candidatePerformance({ snapshots: [snapshot], asOf: '2026-09-29', sessions: [], stocks: new Map(), benchmark: null,
    observationFor: ({ snapshot, record, horizon, measure }) => preservedObservation(restored, snapshot, record.symbol, horizon, '2026-09-29')?.result || measure() });
  expect(result.summary.minervini[5]).toMatchObject({ n: 1, cohort_count: 1, median_return_pct: 5.000000000000004, unavailable: 0 });
  expect(result.summary.minervini[20].n).toBe(0);
});
it('never overwrites the first completed inputs with later adjusted or revised prices', () => {
  const archive = new Map(), first = frozen();
  retainObservation(archive, snapshot, first);
  const later = { ...first, stock_closes: [100, 102, 104, 106, 108, 110] };
  retainObservation(archive, snapshot, later);
  expect(preservedObservation(archive, snapshot, 'CASE', 5, asOf)).toEqual(first);
});
it('does not mix a different cohort, rule definition, horizon, or future observation', () => {
  const archive = new Map(); retainObservation(archive, snapshot, frozen());
  expect(preservedObservation(archive, { ...snapshot, published_ref: { ...snapshot.published_ref, sha256: 'd'.repeat(64) } }, 'CASE', 5, asOf)).toBeNull();
  expect(preservedObservation(archive, { ...snapshot, rule_version: 'different-rules' }, 'CASE', 5, asOf)).toBeNull();
  expect(preservedObservation(archive, snapshot, 'CASE', 20, asOf)).toBeNull();
  expect(preservedObservation(archive, snapshot, 'CASE', 5, dates[4])).toBeNull();
});
it('does not freeze immature, missing-calendar, future-retrieved, or pre-close observations', () => {
  expect(frozen({ horizon: 20, result: measure(20) })).toBeNull();
  for (const extra of [{ sessions: undefined }, { completed_session_close: undefined }, { calendar_provider: undefined }, { adjustment: 'unadjusted' }, { retrieved_at: '2026-09-29T21:00:00Z' }, { completed_session_close: '2026-09-28T21:30:00Z' }]) {
    expect(frozen({ prices: { ...prices, ...extra } })).toBeNull();
  }
  expect(frozen({ snapshot: { ...snapshot, published_ref: null } })).toBeNull();
});
it('fails closed when original prices, arithmetic, duplicate dates, or future timestamps are corrupted', () => {
  const observation = frozen(), cohort = { as_of: dates[0], sha256: 'a'.repeat(64) };
  for (const change of [{ result: { ...observation.result, return_pct: 999 } }, { stock_closes: [100, 101, null, 103, 104, 105] }, { dates: [dates[0], dates[1], dates[1], ...dates.slice(3)] }, { observed_at: '2026-09-29T22:00:00Z' }]) {
    expect(() => validateObservation({ ...observation, ...change }, cohort, now)).toThrow();
  }
});
it('checks the compressed archive hash before reading saved results', async () => {
  const root = await temp(), archive = new Map(); retainObservation(archive, snapshot, frozen());
  const [ref] = await writePerformanceArchive(root, archive);
  await writeFile(join(root, ref.path), Buffer.from('corrupt archive'));
  await expect(readPerformanceArchive(root, now)).rejects.toThrow('integrity');
});
it('exports then reuses mature observations without current chart or benchmark data', async () => {
  const root = await temp(), day = new Date(`${asOf}T00:00:00Z`), history = [];
  while (history.length < 260) { if (![0, 6].includes(day.getUTCDay())) history.unshift(day.toISOString().slice(0, 10)); day.setUTCDate(day.getUTCDate() - 1); }
  const bars = history.map((date, i) => ({ date, open: 100 + i / 10, high: 101 + i / 10, low: 99 + i / 10, close: 100 + i / 10, volume: 1000000 }));
  await writeFile(join(root, 'CASE.json'), JSON.stringify({ symbol: 'CASE', as_of_date: asOf, bars }));
  const row = { symbol: 'CASE', current_price: bars.at(-1).close, chart_path: 'CASE.json', technical_audit: { valid: true } };
  const entry = { as_of_date: asOf, assets: {} }, manifest = { generated_at: new Date(now).toISOString() };
  const preClose = await exportCandidatePerformance({ root, snapshots: [snapshot], rows: [row], prices, entry, manifest, now: Date.parse('2026-09-28T19:00:00Z') });
  expect(preClose.summary.minervini[5]).toMatchObject({ n: 0, pending: 1, median_return_pct: null, median_spy_return_pct: null, observed_sessions_max: 4 });
  expect(preClose.observation_archive.completed_observations).toBe(0);
  for (const invalid of [{ completed_session_close: undefined }, { retrieved_at: '2026-09-29T20:00:00Z' }, { calendar_provider: undefined }]) {
    const unverified = await exportCandidatePerformance({ root, snapshots: [snapshot], rows: [row], prices: { ...prices, ...invalid }, entry, manifest, now });
    expect(unverified.summary.minervini[5]).toMatchObject({ n: 0, unavailable: 1, median_return_pct: null, median_spy_return_pct: null, median_max_drawdown_pct: null });
    expect(unverified.summary.minervini[20]).toMatchObject({ n: 0, pending: 1, median_return_pct: null });
    expect(unverified.observation_archive.completed_observations).toBe(0);
  }
  const first = await exportCandidatePerformance({ root, snapshots: [snapshot], rows: [row], prices, entry, manifest, now });
  expect(first.summary.minervini[5].n).toBe(1); expect(first.observation_archive.newly_frozen).toBe(1);
  const indexBefore = await readFile(join(root, 'candidate-performance-history/index.json'), 'utf8');
  const second = await exportCandidatePerformance({ root, snapshots: [snapshot], rows: [], prices: null, entry: { as_of_date: '2026-09-29', assets: {} }, manifest, now: now + 86400000 });
  expect(second.summary.minervini[5]).toEqual(first.summary.minervini[5]);
  expect(second.observation_archive.newly_frozen).toBe(0); expect(second.observation_archive.reused).toBe(1);
  expect(await readFile(join(root, 'candidate-performance-history/index.json'), 'utf8')).toBe(indexBefore);
  const other = await exportCandidatePerformance({ root, snapshots: [{ ...snapshot, published_ref: { ...snapshot.published_ref, sha256: 'd'.repeat(64) } }], rows: [], prices: null, entry: { as_of_date: '2026-09-29', assets: {} }, manifest, now: now + 86400000 });
  expect(other.summary.minervini[5].n).toBe(0);
});
