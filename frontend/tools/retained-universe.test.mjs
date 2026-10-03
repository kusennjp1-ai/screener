import { describe, expect, it } from 'vitest';
import { assessRetainedUniverse, isEligibleForPublication } from '../../.github/scripts/retained-universe.mjs';

const date = '2026-10-02';
const row = (symbol, overrides = {}) => ({
  symbol, current_price: 20, adv_usd: 30_000_000,
  technical_audit: { symbol, as_of_date: date, valid: true, errors: [], values: { close: 20 } },
  ...overrides,
});
const pricedRow = (symbol, price, liquidity = 30_000_000) => row(symbol, {
  current_price: price, adv_usd: liquidity,
  technical_audit: { symbol, as_of_date: date, valid: true, errors: [], values: { close: price } },
});
const chart = (symbol, price = 20, observationDate = date) => ({
  symbol, as_of_date: date,
  bars: [{ date: observationDate, open: price, high: price, low: price, close: price, volume: 1_000_000 }],
});
const liquidChart = (symbol, price = 20, observedAdv = 19_000_000) => {
  const bars = [], day = new Date(date);
  while (bars.length < 50) {
    if (![0, 6].includes(day.getUTCDay())) bars.unshift({
      date: day.toISOString().slice(0, 10), open: price, high: price, low: price, close: price, volume: observedAdv / price,
    });
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return { symbol, as_of_date: date, bars };
};
const assess = overrides => assessRetainedUniverse({ previousSymbols: [], rows: [], asOfDate: date, ...overrides });

describe('retained publication universe', () => {
  it('keeps mass null-price losses in the existing verification denominator', () => {
    const ordinarySymbols = Array.from({ length: 1891 }, (_, i) => `S${i}`);
    const previousSymbols = [...ordinarySymbols, 'SBSW'];
    const rows = ordinarySymbols.map((symbol, i) => i < 874 ? row(symbol, i < 848 ? {} : {
      technical_audit: { symbol, as_of_date: date, valid: false, errors: ['Missing history'], values: {} },
    }) : row(symbol, { current_price: null }));
    rows.push(pricedRow('SBSW', 9.96));
    const result = assess({ previousSymbols, rows, charts: { SBSW: chart('SBSW', 9.96) } });
    expect(result).toMatchObject({ total: 1891, verified: 848, passed: false, exits: { total: 1 }, missing: { total: 1043 }, exitedSymbols: ['SBSW'] });
    expect(result.ratio).toBe(848 / 1891);
    expect(result.missing.reasons.missing_or_invalid_current_price).toBe(1017);
    expect(result.missing.reasons.missing_chart).toBeUndefined();
    expect(result.missing.examples.missing_or_invalid_current_price).toHaveLength(10);
    expect(result.requiredSymbols).toEqual([...ordinarySymbols].sort());
  });

  it('removes only fully observed price/liquidity exits and unions eligible entrants', () => {
    const rows = [row('KEEP'), pricedRow('PRICE', 9.96), pricedRow('LIQUIDITY', 20, 19_999_999),
      pricedRow('BOTH', 9, 1_000_000), row('NEW'), pricedRow('NEVER_ELIGIBLE', 5)];
    // Repaired charts can coexist with stale source metadata.
    Object.assign(rows[1], { data_status: 'insufficient_history', history_bars: 0 });
    const charts = new Map(rows.map(item => [item.symbol, chart(item.symbol, item.current_price)]));
    charts.set('LIQUIDITY', liquidChart('LIQUIDITY'));
    charts.set('BOTH', liquidChart('BOTH', 9, 1_000_000));
    const result = assess({ previousSymbols: ['KEEP', 'PRICE', 'LIQUIDITY', 'BOTH'], rows, charts });
    expect(result).toMatchObject({
      requiredSymbols: ['KEEP', 'NEW'], enteredSymbols: ['NEW'], exitedSymbols: ['BOTH', 'LIQUIDITY', 'PRICE'],
      total: 2, verified: 2, ratio: 1, passed: true,
      exits: { total: 3, reasons: { price_below_minimum: 2, liquidity_below_minimum: 2 } }, missing: { total: 0 },
    });
  });

  it.each([20_000_000, 30_000_000])('retains stale low reported ADV when the observed last-50 ADV is %d', observedAdv => {
    const result = assess({ previousSymbols: ['OLD'], rows: [pricedRow('OLD', 20, 1_000_000)],
      charts: { OLD: liquidChart('OLD', 20, observedAdv) } });
    expect(result).toMatchObject({ requiredSymbols: ['OLD'], total: 1, verified: 0, passed: false, exits: { total: 0 },
      missing: { reasons: { observed_liquidity_not_below_minimum: 1 } } });
  });

  it.each([
    ['49 observations', payload => payload.bars.shift(), 'insufficient_liquidity_history'],
    ['missing volume', payload => delete payload.bars[0].volume, 'invalid_liquidity_observations'],
    ['null volume', payload => { payload.bars[0].volume = null; }, 'invalid_liquidity_observations'],
    ['negative volume', payload => { payload.bars[0].volume = -1; }, 'invalid_liquidity_observations'],
    ['missing price', payload => delete payload.bars[0].close, 'invalid_liquidity_observations'],
    ['invalid date', payload => { payload.bars[0].date = '2026-02-30'; }, 'invalid_liquidity_observations'],
    ['duplicate date', payload => { payload.bars[0].date = payload.bars[1].date; }, 'invalid_liquidity_observations'],
    ['stale latest bar', payload => { payload.bars.at(-1).date = '2026-10-01'; }, 'stale_or_missing_latest_bar'],
  ])('retains a liquidity-only exit with %s', (_label, damage, reason) => {
    const payload = liquidChart('OLD');
    damage(payload);
    const result = assess({ previousSymbols: ['OLD'], rows: [pricedRow('OLD', 20, 1_000_000)], charts: { OLD: payload } });
    expect(result).toMatchObject({ requiredSymbols: ['OLD'], total: 1, verified: 0, passed: false, exits: { total: 0 } });
    expect(result.missing.reasons[reason]).toBe(1);
  });

  it('uses exactly the last 50 observations to prove a legitimate liquidity exit', () => {
    const payload = liquidChart('OLD', 10);
    payload.bars.unshift({ date: '2026-07-01', close: 10, volume: 1_000_000_000 });
    const result = assess({ previousSymbols: ['OLD', 'KEEP'], rows: [pricedRow('OLD', 10, 19_000_000), row('KEEP')], charts: { OLD: payload } });
    expect(result).toMatchObject({ requiredSymbols: ['KEEP'], total: 1, verified: 1, passed: true,
      exitedSymbols: ['OLD'], exits: { total: 1, reasons: { liquidity_below_minimum: 1 } } });
  });

  it('keeps a verified price exit independent of unproven reported low liquidity', () => {
    const result = assess({ previousSymbols: ['OLD', 'KEEP'], rows: [pricedRow('OLD', 9, 1_000_000), row('KEEP')],
      charts: { OLD: chart('OLD', 9) } });
    expect(result).toMatchObject({ requiredSymbols: ['KEEP'], total: 1, verified: 1, passed: true,
      exitedSymbols: ['OLD'], exits: { total: 1, reasons: { price_below_minimum: 1 } } });
    expect(result.exits.reasons.liquidity_below_minimum).toBeUndefined();
  });

  it('retains a reported 9.99 price when the actual audited close is 10.00', () => {
    const item = pricedRow('OLD', 9.99);
    item.technical_audit.values.close = 10;
    const result = assess({ previousSymbols: ['OLD'], rows: [item], charts: { OLD: chart('OLD', 10) } });
    expect(result).toMatchObject({ requiredSymbols: ['OLD'], total: 1, verified: 0, passed: false, exitedSymbols: [],
      missing: { reasons: { observed_price_not_below_minimum: 1 } } });
    expect(result.missing.reasons.audit_price_mismatch).toBeUndefined();
    expect(result.missing.reasons.chart_price_mismatch).toBeUndefined();
  });

  it('permits a price exit when the actual close is 9.99', () => {
    const result = assess({ previousSymbols: ['OLD', 'KEEP'], rows: [pricedRow('OLD', 9.99), row('KEEP')],
      charts: { OLD: chart('OLD', 9.99) } });
    expect(result).toMatchObject({ requiredSymbols: ['KEEP'], total: 1, verified: 1, passed: true, exitedSymbols: ['OLD'],
      exits: { reasons: { price_below_minimum: 1 } } });
  });

  it('permits an independently proven liquidity exit when the observed 10.00 close prevents a price exit', () => {
    const item = pricedRow('OLD', 9.99, 19_000_000);
    item.technical_audit.values.close = 10;
    const result = assess({ previousSymbols: ['OLD', 'KEEP'], rows: [item, row('KEEP')],
      charts: { OLD: liquidChart('OLD', 10, 19_000_000) } });
    expect(result).toMatchObject({ requiredSymbols: ['KEEP'], total: 1, verified: 1, passed: true, exitedSymbols: ['OLD'],
      exits: { reasons: { liquidity_below_minimum: 1 } }, missing: { total: 0 } });
    expect(result.exits.reasons.price_below_minimum).toBeUndefined();
  });

  it.each([
    ['absent chart', undefined, 'missing_chart'],
    ['missing bars', { symbol: 'OLD', as_of_date: date }, 'missing_bars'],
    ['empty bars', { ...chart('OLD', 9), bars: [] }, 'missing_bars'],
    ['stale final bar despite current export date', chart('OLD', 9, '2026-10-01'), 'stale_or_missing_latest_bar'],
    ['missing final bar date', { ...chart('OLD', 9), bars: [{ close: 9 }] }, 'stale_or_missing_latest_bar'],
    ['wrong symbol', chart('OTHER', 9), 'chart_symbol_mismatch'],
    ['wrong chart date', { ...chart('OLD', 9), as_of_date: '2026-10-01' }, 'stale_chart'],
    ['wrong final price', chart('OLD', 20), 'chart_price_mismatch'],
  ])('retains a below-limit previous name with %s', (_label, payload, reason) => {
    const result = assess({ previousSymbols: ['OLD'], rows: [pricedRow('OLD', 9)], charts: { OLD: payload } });
    expect(result).toMatchObject({ requiredSymbols: ['OLD'], total: 1, verified: 0, passed: false, exits: { total: 0 } });
    expect(result.missing.reasons[reason]).toBe(1);
  });

  it('retains absent names and unknown fields without inferring delistings', () => {
    const rows = [pricedRow('NO_LIQUIDITY', 9, null), row('NO_PRICE', { current_price: null }),
      row('EMPTY_PRICE', { current_price: '' }), row('BAD_LIQUIDITY', { adv_usd: '30000000' }),
      row('BAD_PRICE', { current_price: Infinity }), row('ZERO_PRICE', { current_price: 0 }),
      row('NEGATIVE_LIQUIDITY', { adv_usd: -1 })];
    const previousSymbols = ['ABSENT', ...rows.map(item => item.symbol)];
    const result = assess({ previousSymbols, rows, charts: { NO_LIQUIDITY: chart('NO_LIQUIDITY', 9) } });
    expect(result).toMatchObject({ total: 8, verified: 0, passed: false, exits: { total: 0 }, missing: { total: 8 } });
    expect(result.missing.reasons.missing_row).toBe(1);
    expect(result.requiredSymbols).toEqual([...previousSymbols].sort());
  });

  it.each([
    ['missing audit', { technical_audit: undefined }, 'missing_technical_audit'],
    ['failed audit', { technical_audit: { ...row('A').technical_audit, valid: false } }, 'invalid_technical_audit'],
    ['stale audit', { technical_audit: { ...row('A').technical_audit, as_of_date: '2026-10-01' } }, 'stale_technical_audit'],
    ['wrong audit identity', { technical_audit: { ...row('A').technical_audit, symbol: 'B' } }, 'audit_symbol_mismatch'],
    ['inconsistent valid flag', { technical_audit: { ...row('A').technical_audit, errors: ['Missing history'] } }, 'invalid_technical_audit'],
    ['wrong audited price', { technical_audit: { ...row('A').technical_audit, values: { close: 10 } } }, 'audit_price_mismatch'],
    ['stale row date', { as_of_date: '2026-10-01' }, 'stale_row'],
  ])('does not verify an eligible row with %s', (_label, overrides, reason) => {
    const result = assess({ rows: [row('A', overrides)] });
    expect(result).toMatchObject({ requiredSymbols: ['A'], enteredSymbols: ['A'], total: 1, verified: 0, passed: false });
    expect(result.missing.reasons[reason]).toBe(1);
  });

  it('does not remove a fully observed below-limit row with a failed audit', () => {
    const item = pricedRow('OLD', 9);
    item.technical_audit.valid = false;
    const result = assess({ previousSymbols: ['OLD'], rows: [item], charts: { OLD: chart('OLD', 9) } });
    expect(result).toMatchObject({ requiredSymbols: ['OLD'], total: 1, verified: 0, exitedSymbols: [], passed: false });
  });

  it('keeps exactly the existing 90% requirement, including ordinary gaps', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`S${i}`));
    const previousSymbols = rows.map(item => item.symbol);
    rows[0].technical_audit.valid = false;
    expect(assess({ rows, previousSymbols })).toMatchObject({ total: 10, verified: 9, ratio: 0.9, passed: true });
    rows[1].technical_audit.valid = false;
    expect(assess({ rows, previousSymbols })).toMatchObject({ total: 10, verified: 8, ratio: 0.8, passed: false });
  });

  it('keeps unresolved previous symbols across an otherwise approved publication', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`S${i}`));
    const first = assess({ previousSymbols: ['MISSING', ...rows.map(item => item.symbol)], rows });
    expect(first).toMatchObject({ total: 10, verified: 9, passed: true });
    const next = assess({ previousSymbols: first.requiredSymbols, rows });
    expect(next.requiredSymbols).toContain('MISSING');
    expect(next.total).toBe(10);
  });

  it('uses inclusive current thresholds without coercing missing values', () => {
    expect(isEligibleForPublication(pricedRow('A', 10, 20_000_000))).toBe(true);
    for (const item of [pricedRow('A', 9.999), pricedRow('A', 10, 19_999_999),
      pricedRow('A', null), pricedRow('A', 10, null), pricedRow('A', '10'), pricedRow('A', Infinity)]) {
      expect(isEligibleForPublication(item)).toBe(false);
    }
  });

  it('fails closed for an empty denominator even when all exits are legitimate', () => {
    expect(assess()).toMatchObject({ total: 0, verified: 0, ratio: null, passed: false, errors: ['empty_required_universe'] });
    expect(assess({ previousSymbols: ['OLD'], rows: [pricedRow('OLD', 9)], charts: { OLD: chart('OLD', 9) } }))
      .toMatchObject({ total: 0, ratio: null, passed: false, exitedSymbols: ['OLD'] });
  });

  it.each([
    { previousSymbols: null }, { previousSymbols: ['A', ''] }, { previousSymbols: [' A'] },
    { rows: null }, { rows: [row('A'), { symbol: 1 }] }, { asOfDate: undefined },
    { asOfDate: '2026-02-30' }, { charts: [] },
  ])('fails closed for invalid input %j', overrides => {
    const result = assess({ previousSymbols: ['A'], rows: [row('A')], ...overrides });
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('deduplicates previous symbols and identical rows without changing the denominator', () => {
    const item = row('A');
    const reordered = Object.fromEntries(Object.entries(item).reverse());
    expect(assess({ previousSymbols: ['A', 'A'], rows: [item, reordered, row('B'), row('B')] }))
      .toMatchObject({ previousSymbols: ['A'], requiredSymbols: ['A', 'B'], enteredSymbols: ['B'], total: 2, verified: 2, passed: true });
    expect(assess({ previousSymbols: new Set(['A']), rows: [item] }).passed).toBe(true);
  });

  it('retains conflicting duplicate symbols and fails closed regardless of row order', () => {
    const copies = [pricedRow('A', 9), row('A')];
    for (const rows of [copies, [...copies].reverse()]) {
      const result = assess({ previousSymbols: ['A'], rows, charts: { A: chart('A', 9) } });
      expect(result).toMatchObject({ requiredSymbols: ['A'], total: 1, verified: 0, passed: false,
        exits: { total: 0 }, errors: ['conflicting_duplicate_rows'] });
    }
  });

  it('does not mutate its inputs', () => {
    const input = { previousSymbols: ['OLD', 'A'], rows: [row('A'), pricedRow('OLD', 9)], asOfDate: date, charts: { OLD: chart('OLD', 9) } };
    const before = structuredClone(input);
    assessRetainedUniverse(input);
    expect(input).toEqual(before);
  });
});
