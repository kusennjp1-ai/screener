import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyScanFilterDefaults,
  buildDefaultScanFilters,
} from '../features/scan/defaultFilters';
import {
  filterStaticScanRows,
  paginateStaticScanRows,
  sortStaticScanRows,
} from './scanClient';

it('does not treat missing boolean evidence as a failed condition',()=>{
  const data=[{symbol:'UNKNOWN',se_setup_ready:null},{symbol:'FAIL',se_setup_ready:false},{symbol:'PASS',se_setup_ready:true}];
  expect(filterStaticScanRows(data,{seSetupReady:false}).map(r=>r.symbol)).toEqual(['FAIL']);
  expect(filterStaticScanRows(data,{seSetupReady:true}).map(r=>r.symbol)).toEqual(['PASS']);
});
it('keeps missing numeric values last in either direction',()=>{
  const data=[{symbol:'U',rs_rating:null},{symbol:'A',rs_rating:80},{symbol:'B',rs_rating:90}];
  expect(sortStaticScanRows(data,'rs_rating','desc').map(r=>r.symbol)).toEqual(['B','A','U']);
  expect(sortStaticScanRows(data,'rs_rating','asc').map(r=>r.symbol)).toEqual(['A','B','U']);
});

const rows = [
  {
    symbol: 'NVDA',
    company_name: 'NVIDIA Corporation',
    stage: 2,
    rating: 'Strong Buy',
    ibd_industry_group: 'Semiconductors',
    gics_sector: 'Technology',
    volume: 126_000_000,
    market_cap: 3_000_000_000_000,
    ipo_date: '1999-01-22',
    composite_score: 97.5,
    rs_rating: 95,
    current_price: 145.4,
    passes_template: true,
    ma_alignment: true,
    eps_growth_qq: 45,
    price_change_1d: 4.2,
  },
  {
    symbol: 'MSFT',
    company_name: 'Microsoft Corporation',
    stage: 2,
    rating: 'Buy',
    ibd_industry_group: 'Software',
    gics_sector: 'Technology',
    volume: 95_000_000,
    market_cap: 3_200_000_000_000,
    ipo_date: '1986-03-13',
    composite_score: 89.2,
    rs_rating: 90,
    current_price: 430.2,
    passes_template: true,
    ma_alignment: true,
    eps_growth_qq: 12,
    price_change_1d: 1.8,
  },
  {
    symbol: 'SNOW',
    company_name: 'Snowflake',
    stage: 1,
    rating: 'Watch',
    ibd_industry_group: 'Cloud Software',
    gics_sector: 'Technology',
    volume: 5_500_000,
    market_cap: 60_000_000_000,
    ipo_date: '2020-09-16',
    composite_score: 55.0,
    rs_rating: 67,
    current_price: 176.0,
    passes_template: false,
    ma_alignment: false,
    eps_growth_qq: -8,
    price_change_1d: -3.5,
  },
];

const now = Date.parse('2026-10-01T12:00:00Z');
const observedAt = Date.parse('2026-09-30T12:00:00Z');
const expiresAt = observedAt + 7 * 86400000;
const provenGrowthRow = (symbol, value) => ({
  symbol,
  market: 'US',
  as_of_date: '2026-10-01',
  eps_growth_qq: value,
  financial_current: {
    v: 1, t: now, s: symbol, m: 'US', a: '2026-10-01', r: '0222222222222222',
    p: { 0: [value, '0', 'Diluted EPS', ['2026-06-30', '2026-03-31'], observedAt, expiresAt] },
  },
});

describe('static scan decision projection', () => {
  it('keeps valid zero and negative growth while excluding missing and unsupported raw values', () => {
    const sourceRows = [provenGrowthRow('ZERO', 0), provenGrowthRow('NEGATIVE', -5), { symbol: 'MISSING' }, { symbol: 'RAW', eps_growth_qq: -2 }];
    const filtered = filterStaticScanRows(sourceRows, { epsGrowth: { max: 0 } }, { now });

    expect(filtered.map((row) => row.symbol)).toEqual(['ZERO', 'NEGATIVE']);
    expect(filtered.map((row) => row.eps_growth_qq)).toEqual([0, -5]);
    expect(filtered.every((row) => row.financial_current_state.evaluated_at === now)).toBe(true);
    expect(sourceRows[3].eps_growth_qq).toBe(-2);
  });

  it('sorts projected signed growth numerically and keeps unknowns last in either direction', () => {
    const sourceRows = [{ symbol: 'RAW', eps_growth_qq: 100 }, provenGrowthRow('ZERO', 0), provenGrowthRow('NEGATIVE', -5), { symbol: 'MISSING' }];
    const ascending = sortStaticScanRows(sourceRows, 'eps_growth_qq', 'asc', { now });
    const descending = sortStaticScanRows(sourceRows, 'eps_growth_qq', 'desc', { now });

    expect(ascending.map((row) => row.symbol)).toEqual(['NEGATIVE', 'ZERO', 'MISSING', 'RAW']);
    expect(descending.map((row) => row.symbol)).toEqual(['ZERO', 'NEGATIVE', 'MISSING', 'RAW']);
    expect(descending.every((row) => row.financial_current_state.evaluated_at === now)).toBe(true);
  });

  it('expires filtering and sorting at the same explicit clock without reviving a raw value', () => {
    const raw = provenGrowthRow('PROVEN', 0);
    const filters = { epsGrowth: { min: 0, max: 0 } };
    expect(filterStaticScanRows([raw], filters, { now: expiresAt })).toHaveLength(1);
    expect(filterStaticScanRows([raw], filters, { now: expiresAt + 1 })).toEqual([]);
    const expired = sortStaticScanRows([raw], 'eps_growth_qq', 'desc', { now: expiresAt + 1 });
    expect(expired[0].eps_growth_qq).toBeNull();
    expect(filterStaticScanRows(expired, filters, { now })).toEqual([]);
    expect(sortStaticScanRows(expired, 'eps_growth_qq', 'asc', { now })[0].eps_growth_qq).toBeNull();
    expect(raw.eps_growth_qq).toBe(0);
  });

  it.each([true, false, '0', '-5', NaN, Infinity, null, undefined])('rejects nonnumeric range evidence without coercion: %s', (value) => {
    const row = { symbol: 'INVALID', current_price: value, volume: value, market_cap: value, market_cap_usd: value };
    for (const filters of [{ price: { min: -10 } }, { minVolume: -10 }, { minMarketCap: -10 }, { marketCapUsd: { min: -10 } }]) {
      expect(filterStaticScanRows([row], filters, { now })).toEqual([]);
    }
    const sorted = sortStaticScanRows([row, { symbol: 'VALID', current_price: 0 }], 'current_price', 'desc', { now });
    expect(sorted.map((entry) => entry.symbol)).toEqual(['VALID', 'INVALID']);
  });

  it('uses the provided clock for IPO presets as well as financial projection', () => {
    const sourceRows = [{ symbol: 'WITHIN', ipo_date: '2026-07-01' }, { symbol: 'BEFORE', ipo_date: '2026-01-01' }];
    expect(filterStaticScanRows(sourceRows, { ipoAfter: '6m' }, { now }).map((row) => row.symbol)).toEqual(['WITHIN']);
  });
});

describe('static scan client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "today" to 2024-01-15 UTC so IPO boundary tests are deterministic.
    vi.setSystemTime(new Date(Date.UTC(2024, 0, 15)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves price and technical filters while projecting the returned rows', () => {
    const filters = buildDefaultScanFilters();
    filters.symbolSearch = 'nv';
    filters.stage = 2;
    filters.ibdIndustries = { values: ['Semiconductors'], mode: 'include' };
    filters.minVolume = 20_000_000;
    filters.price = { min: 100, max: 200 };
    filters.rsRating = { min: 90, max: null };
    filters.maAlignment = true;
    filters.passesTemplate = true;

    const filtered = filterStaticScanRows(rows, filters);

    expect(filtered.map((row) => row.symbol)).toEqual(['NVDA']);
    expect(filtered[0]).toMatchObject({ current_price: 145.4, rs_rating: 95, eps_growth_qq: null });
    expect(rows[0].eps_growth_qq).toBe(45);
  });

  it('does not treat unsupported Code33 true, false, or missing values as verified conditions', () => {
    const code33Rows = [
      { ...rows[0], symbol: 'ACCEL', code33: true },
      { ...rows[1], symbol: 'NO_ACCEL', code33: false },
      { ...rows[2], symbol: 'MISSING' },
    ];
    const filters = buildDefaultScanFilters();
    filters.code33 = true;

    const filtered = filterStaticScanRows(code33Rows, filters);

    expect(filtered).toEqual([]);
    filters.code33 = false;
    expect(filterStaticScanRows(code33Rows, filters)).toEqual([]);
    const projected = filterStaticScanRows(code33Rows, {});
    expect(projected.every((row) => row.code33 == null)).toBe(true);
    expect(projected[1].financial_historical.values.code33).toBe(false);
  });

  it('applies the static default dollar-volume filter contract', () => {
    const filters = applyScanFilterDefaults({ minVolume: 100_000_000 });

    const filtered = filterStaticScanRows(rows, filters);

    expect(filtered.map((row) => row.symbol)).toEqual(['NVDA']);
  });

  it('supports market-cap, categorical, date, price range, and technical boolean filters together', () => {
    const filters = buildDefaultScanFilters();
    filters.minMarketCap = 100_000_000_000;
    filters.ibdIndustries = { values: ['Semiconductors', 'Software'], mode: 'include' };
    filters.gicsSectors = { values: ['Technology'], mode: 'include' };
    filters.ipoAfter = '1990-01-01';
    filters.perfDay = { min: 0, max: null };
    filters.passesTemplate = true;
    filters.maAlignment = true;

    const filtered = filterStaticScanRows(rows, filters);

    expect(filtered.map((row) => row.symbol)).toEqual(['NVDA']);
  });

  it('supports exclude-mode categorical filters', () => {
    const filters = buildDefaultScanFilters();
    filters.ibdIndustries = { values: ['Semiconductors'], mode: 'exclude' };

    const filtered = filterStaticScanRows(rows, filters);

    expect(filtered.map((row) => row.symbol)).toEqual(['MSFT', 'SNOW']);
  });

  it('filters by IBD group rank range', () => {
    const testRows = [
      { ...rows[0], symbol: 'LEADER', ibd_group_rank: 40 },
      { ...rows[1], symbol: 'LAGGING_GROUP', ibd_group_rank: 41 },
      { ...rows[2], symbol: 'UNKNOWN_GROUP', ibd_group_rank: null },
    ];
    const filters = buildDefaultScanFilters();
    filters.ibdGroupRank = { min: null, max: 40 };

    const filtered = filterStaticScanRows(testRows, filters);

    expect(filtered.map((row) => row.symbol)).toEqual(['LEADER']);
  });

  it('resolves IPO date presets to a cutoff (not raw string comparison)', () => {
    // Frozen clock: 2024-01-15 UTC. Derived cutoffs:
    //   1y  → 2023-01-15   5y → 2019-01-15   6m → 2023-07-15
    const testRows = [
      { ...rows[0], symbol: 'OLD', ipo_date: '1999-01-22' },
      { ...rows[0], symbol: 'NEW', ipo_date: '2023-07-15' },
    ];

    const filtersOneY = buildDefaultScanFilters();
    filtersOneY.ipoAfter = '1y';
    expect(filterStaticScanRows(testRows, filtersOneY).map((r) => r.symbol)).toEqual(['NEW']);

    const filtersFiveY = buildDefaultScanFilters();
    filtersFiveY.ipoAfter = '5y';
    expect(filterStaticScanRows(testRows, filtersFiveY).map((r) => r.symbol)).toEqual(['NEW']);

    const filtersSixM = buildDefaultScanFilters();
    filtersSixM.ipoAfter = '6m';
    expect(filterStaticScanRows(testRows, filtersSixM).map((r) => r.symbol)).not.toContain('OLD');
  });

  it('rejects unsupported EPS Rating but preserves Market Cap and RS 12M ranges', () => {
    const testRows = [
      { symbol: 'A', eps_rating: 85, market_cap: 5_000_000_000, market_cap_usd: 500_000_000, rs_rating_12m: 90 },
      { symbol: 'B', eps_rating: 45, market_cap: 500_000_000, market_cap_usd: 2_000_000_000, rs_rating_12m: 55 },
      { symbol: 'C', eps_rating: null, market_cap: null, rs_rating_12m: null },
    ];

    const f1 = buildDefaultScanFilters();
    f1.epsRating = { min: 70, max: null };
    expect(filterStaticScanRows(testRows, f1)).toEqual([]);

    const f2 = buildDefaultScanFilters();
    f2.minMarketCap = 1_000_000_000;
    expect(filterStaticScanRows(testRows, f2).map((r) => r.symbol)).toEqual(['A']);

    const fUsd = buildDefaultScanFilters();
    fUsd.marketCapUsd = { min: 1_000_000_000, max: null };
    expect(filterStaticScanRows(testRows, fUsd).map((r) => r.symbol)).toEqual(['B']);

    const f3 = buildDefaultScanFilters();
    f3.rs12m = { min: 80, max: null };
    expect(filterStaticScanRows(testRows, f3).map((r) => r.symbol)).toEqual(['A']);
  });

  it('sorts and paginates price-only rows in-browser without any backend assistance', () => {
    const sortedByStrength = sortStaticScanRows(rows, 'rs_rating', 'desc');
    const sortedByPrice = sortStaticScanRows(rows, 'current_price', 'asc');
    const pageTwo = paginateStaticScanRows(sortedByStrength, 2, 1);

    expect(sortedByStrength.map((row) => row.symbol)).toEqual(['NVDA', 'MSFT', 'SNOW']);
    expect(sortedByPrice.map((row) => row.symbol)).toEqual(['NVDA', 'SNOW', 'MSFT']);
    expect(pageTwo.map((row) => row.symbol)).toEqual(['MSFT']);
  });

  it('does not filter or rank by unverified financial ratings or composite scores', () => {
    expect(filterStaticScanRows(rows, { ratings: ['Strong Buy'] })).toEqual([]);
    expect(filterStaticScanRows(rows, { compositeScore: { min: 0 } })).toEqual([]);
    for (const sortBy of ['rating', 'composite_score']) {
      for (const direction of ['asc', 'desc']) {
        const sorted = sortStaticScanRows(rows, sortBy, direction);
        expect(sorted.map((row) => row.symbol)).toEqual(['MSFT', 'NVDA', 'SNOW']);
        expect(sorted.every((row) => row[sortBy] == null)).toBe(true);
      }
    }
  });

  it('keeps searched listing-only IPO rows visible despite the default min-volume filter', () => {
    const filters = applyScanFilterDefaults({ minVolume: 100_000_000 });
    filters.symbolSearch = '0100';

    const filtered = filterStaticScanRows([
      {
        symbol: '0100.HK',
        company_name: 'MINIMAX-W',
        scan_mode: 'listing_only',
        data_status: 'insufficient_history',
        is_scannable: false,
        volume: null,
      },
    ], filters);

    expect(filtered.map((row) => row.symbol)).toEqual(['0100.HK']);
  });

  it('preserves scan-mode grouping without using unverified composite scores', () => {
    const sorted = sortStaticScanRows([
      { symbol: 'IPO95', scan_mode: 'ipo_weighted', composite_score: 95 },
      { symbol: 'FULL80', scan_mode: 'full', composite_score: 80 },
      { symbol: 'NEW1', scan_mode: 'listing_only', composite_score: null },
      { symbol: 'FULL70', scan_mode: 'full', composite_score: 70 },
    ], 'composite_score', 'desc');

    expect(sorted.map((row) => row.symbol)).toEqual(['FULL70', 'FULL80', 'IPO95', 'NEW1']);
    expect(sorted.every((row) => row.composite_score == null)).toBe(true);
  });

  it('uses symbol order for unknown preset composite scores without scan-mode grouping', () => {
    const sorted = sortStaticScanRows([
      { symbol: 'IPO95', scan_mode: 'ipo_weighted', composite_score: 95 },
      { symbol: 'FULL80', scan_mode: 'full', composite_score: 80 },
      { symbol: 'FULL70', scan_mode: 'full', composite_score: 70 },
    ], 'composite_score', 'desc', { prioritizeCompositeScanMode: false });

    expect(sorted.map((row) => row.symbol)).toEqual(['FULL70', 'FULL80', 'IPO95']);
  });

  it('does not revive raw composite values when sorting a bucket with explicit unknowns', () => {
    const sorted = sortStaticScanRows([
      { symbol: 'FULLNULL', scan_mode: 'full', composite_score: null },
      { symbol: 'FULL80', scan_mode: 'full', composite_score: 80 },
      { symbol: 'FULL70', scan_mode: 'full', composite_score: 70 },
      { symbol: 'IPO95', scan_mode: 'ipo_weighted', composite_score: 95 },
    ], 'composite_score', 'desc');

    expect(sorted.map((row) => row.symbol)).toEqual(['FULL70', 'FULL80', 'FULLNULL', 'IPO95']);
    expect(sorted.every((row) => row.composite_score == null)).toBe(true);
  });

  it('does not force scan-mode grouping for ascending unknown composite scores', () => {
    const sorted = sortStaticScanRows([
      { symbol: 'IPO95', scan_mode: 'ipo_weighted', composite_score: 95 },
      { symbol: 'FULL80', scan_mode: 'full', composite_score: 80 },
      { symbol: 'NEW1', scan_mode: 'listing_only', composite_score: null },
      { symbol: 'FULL70', scan_mode: 'full', composite_score: 70 },
    ], 'composite_score', 'asc');

    expect(sorted.map((row) => row.symbol)).toEqual(['FULL70', 'FULL80', 'IPO95', 'NEW1']);
  });

  it('uses symbol tiebreaks for unknown ascending composite scores', () => {
    const sorted = sortStaticScanRows([
      { symbol: 'ZFULL', scan_mode: 'full', composite_score: 80 },
      { symbol: 'AIPO', scan_mode: 'ipo_weighted', composite_score: 80 },
    ], 'composite_score', 'asc');

    expect(sorted.map((row) => row.symbol)).toEqual(['AIPO', 'ZFULL']);
  });
});
