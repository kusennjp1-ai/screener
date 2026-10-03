// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  assertPriceObservationBounds, comparePriceObservations, extractPriceObservations, priceObservationDigest,
} from '../../.github/scripts/price-observations.mjs';

const key = (symbol, type = 'chart', market = 'US') => JSON.stringify([market, type, symbol]);
const bar = (date, close = 100) => ({ date, open: close, high: close, low: close, close, volume: 1000 });
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'price-observations-'));
  roots.push(dataRoot);
  const write = (path, value) => {
    mkdirSync(dirname(join(dataRoot, path)), { recursive: true });
    writeFileSync(join(dataRoot, path), JSON.stringify(value));
  };
  const manifest = {
    as_of_date: '2026-10-01', generated_at: '2026-10-02T23:00:00Z',
    markets: { US: { market: 'US', as_of_date: '2026-10-01',
      freshness: { scan_as_of_date: '2026-10-01', prices_generated_at: '2026-10-02T23:00:00Z' },
      assets: { charts: { path: 'markets/us/charts/index.json' } },
      pages: { home: { path: 'markets/us/home.json' } },
    } },
  };
  const chart = (symbol, bars, extras = {}) => ({ symbol, bars,
    as_of_date: '2026-10-01', generated_at: '2026-10-02T23:00:00Z', ...extras });
  const writeCharts = entries => {
    write('markets/us/charts/index.json', { symbols: entries.map(([symbol, bars, extras]) => {
      const path = `markets/us/charts/${encodeURIComponent(symbol)}.json`;
      write(path, chart(symbol, bars, extras));
      return { symbol, path };
    }) });
  };
  const writeHome = entries => write('markets/us/home.json', { market: 'US',
    as_of_date: '2026-10-01', generated_at: '2026-10-02T23:00:00Z', key_markets: entries });
  writeCharts([['SPY', [bar('2026-10-01')]]]);
  writeHome([{ symbol: 'BITSTAMP:BTCUSD', latest_date: '2026-10-01', history: [bar('2026-10-01')] }]);
  return { dataRoot, manifest, write, writeCharts, writeHome,
    extract: () => extractPriceObservations({ dataRoot, manifest }) };
}

describe('actual per-instrument price observations', () => {
  it('permits real price progress while the scan date stays unchanged', () => {
    const data = fixture(), before = data.extract();
    data.writeCharts([['SPY', [bar('2026-10-01'), bar('2026-10-02')]]]);
    expect(data.manifest.markets.US.as_of_date).toBe('2026-10-01');
    const after = data.extract();
    expect(after[key('SPY')]).toBe('2026-10-02');
    expect(comparePriceObservations(after, before)).toMatchObject({ advances: true, regressions: [], missing: [] });
  });

  it('does not advance because only export, target, or display metadata changes', () => {
    const data = fixture(), before = data.extract();
    data.manifest.generated_at = '2026-10-04T23:00:00Z';
    data.manifest.markets.US.freshness.prices_generated_at = '2026-10-04T23:00:00Z';
    data.writeCharts([['SPY', [bar('2026-10-01')], { as_of_date: '2026-10-04', generated_at: '2026-10-04T23:00:00Z' }]]);
    data.writeHome([{ symbol: 'BITSTAMP:BTCUSD', latest_date: '2026-10-04', history: [bar('2026-10-01')] }]);
    expect(data.extract()).toEqual(before);
    expect(comparePriceObservations(data.extract(), before).advances).toBe(false);
  });

  it('takes the latest actual history date even when entries are not sorted', () => {
    const data = fixture();
    data.writeCharts([['SPY', [bar('2026-10-02'), bar('2026-10-01')]]]);
    data.writeHome([{ symbol: 'BITSTAMP:BTCUSD', latest_date: '2026-10-01', history: [bar('2026-10-03'), bar('2026-10-02')] }]);
    expect(data.extract()).toEqual({ [key('SPY')]: '2026-10-02', [key('BITSTAMP:BTCUSD', 'home')]: '2026-10-03' });
  });

  it('keeps chart, home, and market identities separate for the same symbol', () => {
    const data = fixture();
    data.writeHome([{ symbol: 'SPY', history: [bar('2026-10-02')] }]);
    data.manifest.markets.CA = { market: 'CA', pages: { home: { path: 'markets/ca/home.json' } } };
    data.write('markets/ca/home.json', { market: 'CA', key_markets: [{ symbol: 'SPY', history: [bar('2026-09-30')] }] });
    expect(data.extract()).toEqual({ [key('SPY')]: '2026-10-01', [key('SPY', 'home')]: '2026-10-02',
      [key('SPY', 'home', 'CA')]: '2026-09-30' });
  });

  it('omits missing, empty, and priceless series instead of inventing target-date observations', () => {
    const data = fixture();
    data.writeCharts([['EMPTY', []], ['ABSENT', undefined], ['PRICELESS', [bar('2026-10-02', null)]]]);
    data.writeHome([{ symbol: 'EMPTY', latest_date: '2026-10-03', history: [] }, { symbol: 'ABSENT', latest_date: '2026-10-03' }]);
    expect(data.extract()).toEqual({});
    data.write('markets/us/charts/index.json', { symbols: [{ symbol: 'MISSING', path: 'markets/us/charts/missing.json' }] });
    expect(data.extract()).toEqual({});
    rmSync(join(data.dataRoot, 'markets/us/charts/index.json'));
    expect(data.extract()).toEqual({});
  });

  it('supports exporter-encoded symbol filenames and exact display identities', () => {
    const data = fixture();
    data.writeCharts([['^VIX', [bar('2026-10-01')]]]);
    expect(data.extract()[key('^VIX')]).toBe('2026-10-01');
    expect(data.extract()[key('BITSTAMP:BTCUSD', 'home')]).toBe('2026-10-01');
  });

  it.each([0, -1])('does not let chart close %s establish a fresh stock observation', close => {
    const data = fixture(), previous = data.extract();
    data.writeCharts([['SPY', [bar('2026-10-01'), bar('2026-10-02', close)]], ['INVALID', [bar('2026-10-02', close)]]]);
    const observed = data.extract();
    expect(observed[key('SPY')]).toBe('2026-10-01');
    expect(Object.hasOwn(observed, key('INVALID'))).toBe(false);
    expect(comparePriceObservations(observed, previous).advances).toBe(false);
  });

  it.each([0, -1])('preserves finite home values of %s without stock-only price rules', close => {
    const data = fixture();
    data.writeHome([{ symbol: 'RATE', history: [bar('2026-10-01')] }]);
    const previous = data.extract();
    data.writeHome([{ symbol: 'RATE', history: [bar('2026-10-01'), bar('2026-10-02', close)] }]);
    const observed = data.extract();
    expect(observed[key('RATE', 'home')]).toBe('2026-10-02');
    expect(comparePriceObservations(observed, previous).advances).toBe(true);
  });

  it.each([null, [], {}, { markets: [] }, { markets: {} }].map(manifest => ({ manifest })))('rejects malformed manifests $manifest', ({ manifest }) => {
    const { dataRoot } = fixture();
    expect(() => extractPriceObservations({ dataRoot, manifest })).toThrow(/markets/);
  });

  it.each(['../outside.json', '/outside.json', 'markets/../../outside.json', 'markets//us/home.json',
    './markets/us/home.json', 'markets\\us\\home.json', 'markets/us/home.json?next=1',
    '%2e%2e/outside.json', 'markets%2fus/home.json', '%252e%252e/outside.json', 'bad%XX.json'])('rejects unsafe references %s', path => {
    const data = fixture();
    data.manifest.markets.US.assets.charts.path = path;
    expect(() => data.extract()).toThrow(/path/);
    data.manifest.markets.US.assets.charts.path = 'markets/us/charts/index.json';
    data.write('markets/us/charts/index.json', { symbols: [{ symbol: 'SPY', path }] });
    expect(() => data.extract()).toThrow(/path/);
    data.writeCharts([]);
    data.manifest.markets.US.pages.home.path = path;
    expect(() => data.extract()).toThrow(/path/);
  });

  it('rejects a file symlink and an intermediate directory symlink escaping the root', () => {
    const data = fixture(), outside = fixture();
    symlinkSync(join(outside.dataRoot, 'markets/us/home.json'), join(data.dataRoot, 'linked.json'));
    data.manifest.markets.US.pages.home.path = 'linked.json';
    expect(() => data.extract()).toThrow(/symlink/);
    symlinkSync(outside.dataRoot, join(data.dataRoot, 'outside'));
    data.manifest.markets.US.pages.home.path = 'outside/markets/us/home.json';
    expect(() => data.extract()).toThrow(/symlink/);
  });

  it('rejects duplicate chart identities even when their history is empty', () => {
    const data = fixture();
    data.writeCharts([['SPY', []], ['SPY', []]]);
    expect(() => data.extract()).toThrow(/Duplicate.*identity/);
  });

  it('rejects duplicate home identities, symbol mismatches, and market mismatches', () => {
    const data = fixture();
    data.writeHome([{ symbol: 'SPY', history: [] }, { symbol: 'SPY', history: [] }]);
    expect(() => data.extract()).toThrow(/Duplicate.*identity/);
    data.writeHome([]);
    data.writeCharts([['SPY', [bar('2026-10-01')], { symbol: 'QQQ' }]]);
    expect(() => data.extract()).toThrow(/symbol mismatch/);
    data.writeCharts([['SPY', [bar('2026-10-01')], { market: 'CA' }]]);
    expect(() => data.extract()).toThrow(/market mismatch/);
  });

  it.each(['', ' SPY', 'SPY ', 'SPY\nOTHER', 'spy', null, 10])('rejects malformed symbols %j', symbol => {
    const data = fixture();
    data.writeHome([{ symbol, history: [] }]);
    expect(() => data.extract()).toThrow(/symbol/);
  });

  it('rejects a case-only market alias that could hide prior known observations', () => {
    const data = fixture();
    data.manifest.markets.us = { ...data.manifest.markets.US, market: 'us' };
    delete data.manifest.markets.US;
    expect(() => data.extract()).toThrow(/market/);
  });

  it.each([[bar('2026-02-30')], [bar('not-a-day')], [bar('2026-10-01T00:00:00Z')], [null],
    [bar('2026-10-01'), bar('2026-10-01', 99)]].map(bars => ({ bars })))('rejects malformed or duplicate daily dates $bars', ({ bars }) => {
    const data = fixture();
    data.writeCharts([['SPY', bars]]);
    expect(() => data.extract()).toThrow(/date/);
  });

  it('rejects malformed references, payloads, and history containers', () => {
    const data = fixture();
    data.write('markets/us/charts/index.json', { symbols: {} });
    expect(() => data.extract()).toThrow(/index/);
    data.writeCharts([['SPY', {}]]);
    expect(() => data.extract()).toThrow(/history/);
    data.writeCharts([]);
    data.write('markets/us/home.json', { key_markets: {} });
    expect(() => data.extract()).toThrow(/key markets/);
    writeFileSync(join(data.dataRoot, 'markets/us/home.json'), '{');
    expect(() => data.extract()).toThrow();
  });
});

describe('persistent price chronology', () => {
  const spy = key('SPY'), btc = key('BITSTAMP:BTCUSD', 'home');

  it('does not let advancing BTC hide regressing SPY', () => {
    const previous = { [spy]: '2026-10-02', [btc]: '2026-10-02' };
    const result = comparePriceObservations({ [spy]: '2026-10-01', [btc]: '2026-10-03' }, previous);
    expect(result).toEqual({ advances: false,
      regressions: [{ key: spy, previous: '2026-10-02', observed: '2026-10-01' }], missing: [],
      knownDates: { [spy]: '2026-10-02', [btc]: '2026-10-03' } });
    expect(previous).toEqual({ [spy]: '2026-10-02', [btc]: '2026-10-02' });
  });

  it('retains missing dates without imposing a new zero-loss coverage requirement', () => {
    const previous = { [spy]: '2026-10-02', [btc]: '2026-10-02' };
    const absent = comparePriceObservations({ [btc]: '2026-10-03' }, previous);
    expect(absent).toEqual({ advances: true, regressions: [], missing: [spy],
      knownDates: { [spy]: '2026-10-02', [btc]: '2026-10-03' } });
    const returned = comparePriceObservations({ [spy]: '2026-10-01', [btc]: '2026-10-04' }, absent.knownDates);
    expect(returned.advances).toBe(false);
    expect(returned.regressions).toEqual([{ key: spy, previous: '2026-10-02', observed: '2026-10-01' }]);
  });

  it('does not count missing or brand-new instruments as progress', () => {
    const previous = { [spy]: '2026-10-02' };
    expect(comparePriceObservations({}, previous)).toEqual({ advances: false, regressions: [], missing: [spy], knownDates: previous });
    expect(comparePriceObservations({ [btc]: '2026-10-03' }, previous)).toMatchObject({ advances: false, missing: [spy] });
    expect(comparePriceObservations({ ...previous, [btc]: '2026-10-03' }, previous).advances).toBe(false);
    expect(comparePriceObservations({ [btc]: '2026-10-03' }, {}).advances).toBe(false);
  });

  it('does not confuse home with chart or symbols with delimiter characters', () => {
    const previous = { [spy]: '2026-10-02', [key('A:B')]: '2026-10-02' };
    const result = comparePriceObservations({ [key('SPY', 'home')]: '2026-10-03', [key('B', 'chart', 'US:A')]: '2026-10-03' }, previous);
    expect(result.advances).toBe(false);
    expect(result.missing).toEqual([key('A:B'), spy]);
    expect(Object.keys(result.knownDates)).toHaveLength(4);
  });

  it('hashes canonical identities and dates independently of insertion order', () => {
    const a = { [spy]: '2026-10-02', [btc]: '2026-10-03' }, b = { [btc]: '2026-10-03', [spy]: '2026-10-02' };
    expect(priceObservationDigest(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(priceObservationDigest(a)).toBe(priceObservationDigest(b));
    expect(priceObservationDigest({ ...a, [spy]: '2026-10-01' })).not.toBe(priceObservationDigest(a));
    expect(priceObservationDigest({})).not.toBe(priceObservationDigest(a));
  });

  it.each([null, [], { [spy]: '2026-02-30' }, { [spy]: 1790899200000 }, { 'US:chart:SPY': '2026-10-02' },
    { '["US", "chart", "SPY"]': '2026-10-02' }, { '["US","other","SPY"]': '2026-10-02' },
    { '["US","chart","spy"]': '2026-10-02' },
    { '["US","chart",""]': '2026-10-02' }].map(value => ({ value })))('rejects malformed or ambiguous ledger maps $value', ({ value }) => {
    expect(() => comparePriceObservations(value, {})).toThrow();
    expect(() => comparePriceObservations({}, value)).toThrow();
    expect(() => priceObservationDigest(value)).toThrow();
  });
});

describe('immutable capture date bounds', () => {
  const spy = key('SPY', 'home'), btc = key('BTC-USD', 'home');
  it('rejects a valid ISO date that could not yet have been observed', () => {
    expect(() => assertPriceObservationBounds({ [spy]: '9999-01-01' }, '2026-10-03T00:05:00Z')).toThrow('exceeds capture date');
  });
  it('permits crypto UTC dates while New York is still on the prior calendar day', () => {
    expect(() => assertPriceObservationBounds({ [spy]: '2026-10-02', [btc]: '2026-10-03' }, '2026-10-03T00:05:00Z')).not.toThrow();
  });
  it('permits the furthest UTC+14 civil date without permitting the following day', () => {
    expect(() => assertPriceObservationBounds({ [spy]: '2026-10-04' }, '2026-10-03T10:00:00Z')).not.toThrow();
    expect(() => assertPriceObservationBounds({ [spy]: '2026-10-04' }, '2026-10-03T09:59:59Z')).toThrow('exceeds capture date');
    expect(() => assertPriceObservationBounds({ [spy]: '2026-10-05' }, '2026-10-03T23:59:59Z')).toThrow('exceeds capture date');
  });
  it('uses an instant consistently across source timezone offsets and year boundaries', () => {
    expect(() => assertPriceObservationBounds({ [btc]: '2027-01-01' }, '2026-12-31T05:00:00-05:00')).not.toThrow();
    expect(() => assertPriceObservationBounds({ [btc]: '2027-01-02' }, Date.parse('2026-12-31T10:00:00Z'))).toThrow('exceeds capture date');
  });
  it.each([undefined, null, '', 'not-a-timestamp', NaN, Infinity])('fails closed on absent or invalid capture bounds %s', capturedAt => {
    expect(() => assertPriceObservationBounds({ [spy]: '2026-10-02' }, capturedAt)).toThrow('Invalid price observation capture bound');
  });
});
