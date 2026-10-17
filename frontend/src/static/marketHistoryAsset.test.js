import { describe, expect, it } from 'vitest';
import { observation, payload, series } from '../../tools/fixtures/market-history.mjs';
import { MARKET_HISTORY_SNAPSHOT_VERSION, readMarketHistoryAsset, validateMarketHistoryAssetReference } from './marketHistoryAsset';

const options = { market: 'US', asOfDate: '2026-10-09' };
const sha256 = 'a'.repeat(64);
const reference = () => ({ path: `market-history/snapshots/${sha256}.json`, sha256, schema_version: MARKET_HISTORY_SNAPSHOT_VERSION, market: 'US', as_of_date: options.asOfDate });
const snapshot = () => ({ schema_version: MARKET_HISTORY_SNAPSHOT_VERSION, market: 'US', as_of_date: options.asOfDate,
  history: payload(series('new_highs', { observations: [observation(null), observation(0, '2026-10-08')] })),
  provenance: { producer: 'synthetic-test-only', sec: { retrieved_at: '2026-10-10T01:00:00.123456Z', publication_cutoff: '2026-08-31' } } });

describe('immutable market history asset identity', () => {
  it('retains original unknowns, zeroes and source timestamp precision without mutation', () => {
    const data = snapshot(), before = structuredClone(data), ref = reference();
    expect(validateMarketHistoryAssetReference(ref, options)).toBe(ref);
    expect(readMarketHistoryAsset(data, { ...options, reference: ref })).toEqual({ history: data.history, provenance: data.provenance });
    expect(data).toEqual(before);
    expect(data.history.series[0].observations.map(point => point.value)).toEqual([null, 0]);
    expect(data.provenance.sec.retrieved_at).toBe('2026-10-10T01:00:00.123456Z');
  });
  it.each([
    ['missing', undefined], ['null', null], ['array', []], ['array record', Object.assign([], reference())],
    ['wrong schema', { ...reference(), schema_version: 'old' }],
    ['uppercase hash', { ...reference(), sha256: sha256.toUpperCase() }],
    ['short hash', { ...reference(), sha256: 'a' }],
    ['wrong path hash', { ...reference(), path: `market-history/snapshots/${'b'.repeat(64)}.json` }],
    ['absolute path', { ...reference(), path: `/market-history/snapshots/${sha256}.json` }],
    ['traversal', { ...reference(), path: `market-history/../snapshots/${sha256}.json` }],
    ['external path', { ...reference(), path: `https://example.invalid/${sha256}.json` }],
    ['query', { ...reference(), path: `${reference().path}?v=1` }],
    ['wrong market', { ...reference(), market: 'HK' }],
    ['wrong analysis date', { ...reference(), as_of_date: '2026-10-08' }],
    ['inherited identity', Object.create(reference())],
  ])('rejects %s reference before transport', (_name, ref) => {
    expect(() => validateMarketHistoryAssetReference(ref, options)).toThrow();
  });
  it.each([{ market: 'HK' }, { asOfDate: '2026-02-30' }, { asOfDate: undefined }])('requires a matching valid selected context %j', override => {
    expect(() => validateMarketHistoryAssetReference(reference(), { ...options, ...override })).toThrow();
  });
  it.each([
    ['null', () => null], ['array record', value => Object.assign([], value)],
    ['inherited identity', value => Object.create(value)],
    ['wrong schema', value => ({ ...value, schema_version: 'old' })],
    ['wrong market', value => ({ ...value, market: 'HK' })],
    ['wrong date', value => ({ ...value, as_of_date: '2026-10-08' })],
    ['missing provenance', value => ({ ...value, provenance: undefined })],
    ['array provenance', value => ({ ...value, provenance: [] })],
    ['array history', value => ({ ...value, history: Object.assign([], value.history) })],
    ['wrong history version', value => ({ ...value, history: { ...value.history, version: 'old' } })],
    ['non-array series', value => ({ ...value, history: { ...value.history, series: {} } })],
    ['sparse series', value => ({ ...value, history: { ...value.history, series: Array(1) } })],
    ['array series record', value => ({ ...value, history: payload(Object.assign([], series())) })],
    ['mixed market series', value => ({ ...value, history: payload(series(), series('new_lows', { market: 'HK' })) })],
  ])('rejects %s snapshot without substituting another history', (_name, mutate) => {
    expect(() => readMarketHistoryAsset(mutate(snapshot()), { ...options, reference: reference() })).toThrow();
  });
});
