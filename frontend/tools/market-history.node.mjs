// Dependency-free regression suite: node --test tools/market-history.node.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketIndicatorHistory, MARKET_HISTORY_GROUPS } from '../src/static/marketIndicatorHistory.js';
import { buildBookMarketEvidence, breakoutHistoryStatus } from '../src/static/bookMarketEvidence.js';
import { institutionalGrowth } from '../src/static/institutionalEvidence.js';
import { options, observation, series, payload, allMetricsFixture, priceFixture } from './fixtures/market-history.mjs';

const inspect = input => marketIndicatorHistory(input, options);
const latest = input => inspect(payload(input)).series[0].latest;

test('covers six requested groups, with each index and entry state separate', () => {
  assert.equal(MARKET_HISTORY_GROUPS.length, 6);
  assert.equal(inspect(allMetricsFixture()).series.length, 9);
});
test('missing payload, unsupported version and bad analysis dates never produce values', () => {
  assert.deepEqual(inspect(null), { series: [], issues: [] });
  assert.equal(inspect({ ...payload(series()), version: 'unknown' }).series.length, 0);
  assert.equal(marketIndicatorHistory(payload(series()), { ...options, asOfDate: '2026-02-30' }).series.length, 0);
});
for (const value of [null, undefined, '', '0', false, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`count ${String(value)} (${typeof value}) stays unknown`, () => {
    assert.equal(latest(series('new_highs', { observations: [{ ...observation(), value }] })).value, null);
  });
}
test('observed zero survives and ratio accepts decimals', () => {
  assert.equal(latest(series()).value, 0);
  assert.equal(latest(series('put_call_ratio', { observations: [observation(0.72)] })).value, 0.72);
});
test('institution-only put/call and ETF index substitutions are rejected', () => {
  for (const input of [series('put_call_ratio', { scope: 'institutions' }), series('distribution_sp500', { instrument: 'SPY' }), series('distribution_nasdaq', { instrument: 'QQQ' })]) {
    assert.equal(inspect(payload(input)).series.length, 0);
  }
});
test('empty or missing provenance cannot legitimize a value', () => {
  for (const key of ['market', 'population', 'method', 'source', 'unit', 'frequency', 'scope', 'instrument', 'approximate']) {
    assert.equal(inspect(payload(series('new_highs', { [key]: null }))).series.length, 0);
  }
});
test('known old value stays on its original date, latest missing does not fall back', () => {
  const old = observation(7, '2026-10-08');
  const data = inspect(payload(series('new_highs', { observations: [old] }))).series[0];
  assert.equal(data.historical, true);
  assert.equal(data.latest.date, '2026-10-08');
  const withMissing = inspect(payload(series('new_highs', { observations: [old, observation(null)] }))).series[0];
  assert.equal(withMissing.latest.value, null);
  assert.equal(withMissing.points.length, 2);
});
test('target dates and collection dates are independent, not historical publication proof', () => {
  const row = latest(series('new_highs', { observations: [observation(7, '2026-01-02')] }));
  assert.equal(row.date, '2026-01-02');
  assert.equal(row.collected_at, '2026-10-10T01:00:00Z');
});
test('missing, future, impossible and pre-observation retrieval timestamps invalidate the value', () => {
  for (const collected_at of [null, '', '2026-10-10', '2026-02-30T01:00:00Z', '2026-10-11T13:00:00Z', '2026-10-08T01:00:00Z']) {
    assert.equal(latest(series('new_highs', { observations: [{ ...observation(7), collected_at }] })).value, null);
  }
});
test('future and invalid observation dates are not silently coerced', () => {
  const result = inspect(payload(series('new_highs', { observations: [observation(1, '2026-10-12'), observation(2, '2026-02-30')] })));
  assert.equal(result.series[0].latest, null);
  assert.equal(result.issues.length, 2);
});
test('exact duplicate rows collapse, conflicts remain unknown regardless of order', () => {
  const zero = observation(0), one = observation(1);
  assert.equal(inspect(payload(series('new_highs', { observations: [zero, zero] }))).series[0].points.length, 1);
  for (const observations of [[zero, one], [one, zero], [zero, one, zero]]) {
    const row = latest(series('new_highs', { observations }));
    assert.equal(row.value, null);
    assert.equal(row.reason, '同一対象日の重複が矛盾');
  }
  const fragmented = inspect(payload(series(), series('new_highs', { observations: [one] })));
  assert.equal(fragmented.series.length, 1);
  assert.equal(fragmented.series[0].latest.value, null);
});
test('different retrievals of a date require reconciliation even if values match', () => {
  const row = latest(series('new_highs', { observations: [observation(0), { ...observation(0), collected_at: '2026-10-10T02:00:00Z' }] }));
  assert.equal(row.value, null);
});
test('market mismatch is excluded, population/method/source differences stay separate', () => {
  assert.equal(inspect(payload(series('new_highs', { market: 'HK' }))).series.length, 0);
  for (const key of ['population', 'method', 'source', 'instrument', 'approximate']) {
    const mixed = payload(series(), series('new_highs', { [key]: key === 'approximate' ? false : 'different' }));
    const result = inspect(mixed);
    assert.equal(result.series.length, 2);
    assert.notEqual(result.series[0].key, result.series[1].key);
  }
});
test('row-level identity overrides cannot pollute a declared series', () => {
  for (const key of ['metric', 'market', 'population', 'method', 'source', 'unit', 'frequency', 'scope', 'instrument', 'approximate']) {
    assert.equal(inspect(payload(series('new_highs', { observations: [{ ...observation(88), [key]: 'different' }] }))).series.length, 0);
  }
});
test('quarterly counts yield only adjacent-quarter differences, including real zero and declines', () => {
  const counts = observations => inspect(payload(series('institutional_holders', { observations }))).series[0];
  const previous = observation(10, '2026-03-31');
  assert.equal(counts([previous, observation(10, '2026-06-30')]).delta, 0);
  assert.equal(counts([previous, observation(0, '2026-06-30')]).delta, -10);
  assert.equal(counts([previous, observation(null, '2026-06-30')]).delta, null);
  assert.equal(counts([previous, observation(12, '2026-09-30')]).delta, null);
  assert.equal(counts([observation(0, '2026-09-30')]).delta, null);
  assert.equal(counts([observation(1, '2026-06-29')]).latest, null);
  assert.equal(inspect(payload(series('institutional_holders', { frequency: 'daily' }))).series.length, 0);
});
test('series order is deterministic and inputs are not mutated', () => {
  const original = allMetricsFixture(), copy = structuredClone(original);
  const result = inspect(original);
  assert.deepEqual(original, copy);
  assert.deepEqual(inspect({ ...original, series: [...original.series].reverse() }), result);
});
test('manual base records remain manual and do not become automatic certifications', () => {
  const result = inspect(payload(series('base_count', { observations: [observation(2, '2026-10-01')] }))).series[0];
  assert.equal(result.frequency, 'manual');
  assert.equal(result.historical, true);
  assert.equal(inspect(payload(series('base_count', { frequency: 'daily' }))).series.length, 0);
});
test('known benchmark sessions retain all-missing stock dates as unknown, not zero or stale', () => {
  const fixture = priceFixture(2);
  fixture.charts.forEach(chart => chart.bars.pop());
  const data = buildBookMarketEvidence(fixture);
  assert.equal(data.latest.date, fixture.asOfDate);
  assert.equal(data.latest.coverage, 0);
  for (const key of ['newHighs', 'newLows', 'advancing', 'declining', 'unchanged', 'upVolume', 'downVolume', 'upDollarVolume', 'downDollarVolume', 'breakoutProxyCount']) assert.equal(data.latest[key], null, key);
  assert.equal(data.currentSnapshotComplete, false);
});
test('a short benchmark overlay is enough to retain later missing stock sessions', () => {
  const fixture = priceFixture(1);
  fixture.benchmark.bars = fixture.benchmark.bars.slice(-20);
  fixture.charts[0].bars.pop();
  const data = buildBookMarketEvidence(fixture);
  assert.equal(data.latest.date, fixture.asOfDate);
  assert.equal(data.latest.coverage, 0);
  assert.equal(data.latest.breakoutProxyCount, null);
  assert.equal(data.currentSnapshotComplete, false);
});
test('duplicate OHLCV dates exclude that date and later prefix, without rewriting earlier history', () => {
  const fixture = priceFixture(1), bars = fixture.charts[0].bars;
  const priorDate = bars.at(-2).date;
  const before = buildBookMarketEvidence({ ...fixture, asOfDate: priorDate });
  bars.push({ ...bars.at(-1) });
  const data = buildBookMarketEvidence(fixture);
  assert.equal(data.latest.coverage, 0);
  assert.equal(data.latest.newHighs, null);
  assert.deepEqual(buildBookMarketEvidence({ ...fixture, asOfDate: priorDate }), before);
});
test('without benchmark, bad final prints remain explicitly old', () => {
  const fixture = priceFixture(1);
  fixture.benchmark = null;
  fixture.charts[0].bars.at(-1).volume = -1;
  const data = buildBookMarketEvidence(fixture);
  assert.notEqual(data.latest.date, fixture.asOfDate);
  assert.equal(data.currentSnapshotComplete, false);
});
test('complete loss of a fixed cohort is unknown, not zero below its moving average', () => {
  const fixture = priceFixture(100);
  fixture.charts.forEach(chart => chart.bars.pop());
  const data = buildBookMarketEvidence(fixture);
  assert.ok(data.latest.cohort.size > 0);
  assert.equal(data.latest.cohort.observed, 0);
  assert.equal(data.latest.cohort.below50, null);
  assert.equal(data.latest.cohort.missing, data.latest.cohort.size);
});
test('missing the fixed cohort alone stays unknown even with sufficient remaining RS coverage', () => {
  const fixture = priceFixture(150);
  const members = new Set(buildBookMarketEvidence(fixture).cohortMembers);
  assert.equal(members.size, 45);
  fixture.charts.filter(chart => members.has(chart.symbol)).forEach(chart => chart.bars.pop());
  const data = buildBookMarketEvidence(fixture);
  assert.equal(data.latest.rsUniverseSize, 105);
  assert.equal(data.latest.cohort.observed, 0);
  for (const key of ['below50', 'lostLeaderStatus', 'observedBelow50', 'observedLostLeaderStatus']) assert.equal(data.latest.cohort[key], null, key);
});
test('partial cohort zeros describe the observed subset only; complete cohort zeros remain valid', () => {
  const fixture = priceFixture(150);
  const complete = buildBookMarketEvidence(fixture).latest.cohort;
  assert.equal(complete.missing, 0);
  assert.equal(complete.below50, 0);
  fixture.charts.at(-1).bars.pop();
  const partial = buildBookMarketEvidence(fixture).latest.cohort;
  assert.equal(partial.observed, 44);
  assert.equal(partial.missing, 1);
  assert.equal(partial.below50, null);
  assert.equal(partial.lostLeaderStatus, null);
  assert.equal(partial.observedBelow50, 0);
  assert.equal(typeof partial.observedLostLeaderStatus, 'number');
});
test('empty breakout events are unknown, partial, or measured zero according to coverage', () => {
  const row = (count, date = '2026-10-09') => ({ date, breakoutProxyCount: count });
  for (const data of [null, {}, { series: [], breakoutEvents: [] }, { series: [row(null)], breakoutEvents: [] }]) assert.equal(breakoutHistoryStatus(data), 'unknown');
  assert.equal(breakoutHistoryStatus({ series: [row(0, '2026-10-08'), row(null)], breakoutEvents: [] }), 'partial');
  assert.equal(breakoutHistoryStatus({ series: [row(0)], breakoutEvents: [] }), 'none');
  assert.equal(breakoutHistoryStatus({ series: [row(1)], breakoutEvents: [{ date: '2026-10-09', symbol: 'SYNTH' }] }), 'events');
});
test('breakout events must match the history dates and daily counts, not just be nonempty', () => {
  const row = (count, date = '2026-10-09') => ({ date, breakoutProxyCount: count });
  const event = { date: '2026-10-09', symbol: 'SYNTH' };
  for (const data of [
    { series: [row(0)], breakoutEvents: [{ ...event, date: '2025-01-02' }] },
    { series: [row(0)], breakoutEvents: [event] },
    { series: [row(1)], breakoutEvents: [] },
    { series: [row(2)], breakoutEvents: [event, event] },
    { series: [row(0, '2026-10-08'), row(1)], breakoutEvents: [{ ...event, date: '2026-10-08' }] },
    { series: [row(1)], breakoutEvents: [{ ...event, symbol: '' }] },
    { series: [row(0), row(0)], breakoutEvents: [] },
  ]) assert.equal(breakoutHistoryStatus(data), 'inconsistent');
});
test('existing 13F comparator remains unchanged: missing stays unknown, unchanged count delta is zero', () => {
  const evidence = { symbol: 'SYNTH', status: 'available', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-08-31', observations: [
    { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
    { period: '2026-06-30', manager_count: 100, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
  ] };
  assert.equal(institutionalGrowth(null, 'SYNTH', options.asOfDate).delta, null);
  assert.equal(institutionalGrowth(evidence, 'SYNTH', options.asOfDate).delta, 0);
  assert.equal(institutionalGrowth(evidence, 'SYNTH', '2027-02-01').delta, null);
  evidence.observations[1].manager_count = 0;
  assert.equal(institutionalGrowth(evidence, 'SYNTH', options.asOfDate).delta, null);
});
