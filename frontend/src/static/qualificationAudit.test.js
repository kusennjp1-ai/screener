import { describe, expect, it } from 'vitest';
import { auditDailyBars, auditValues, mergeScanRows, rankVerifiedUniverse, RS_METHOD } from './qualificationAudit';
import { assess, entryChecks } from './researchEngine';

export function historyFixture() {
  const bars = [];
  for (let d = Date.parse('2025-06-02'), i = 0; bars.length < 280; d += 86400000) {
    if ([0, 6].includes(new Date(d).getUTCDay())) continue;
    const close = 50 + i++ * .25;
    bars.push({ date: new Date(d).toISOString().slice(0, 10), open: close, close, high: close + 1, low: close - 1, volume: 1000000 });
  }
  const date = bars.at(-1).date;
  const row = { symbol: 'TEST', market: 'US', currency: 'USD', rs_method: RS_METHOD, rs_universe_size: 1000, rs_as_of_date: date, current_price: bars.at(-1).close, rs_rating: 90, composite_rating: 95, eps_rating: 90,
    ibd_group_rank: 10, eps_growth_yy: 30, sales_growth_yy: 30, annual_eps_growth_3y: [30, 30, 30], passes_template: true };
  return { row, payload: { symbol: row.symbol, as_of_date: date, bars }, date };
}

describe('independent OHLCV verification and adversarial loop', () => {
  it('ranks one common universe with ties, rejecting small or mixed-date universes', () => {
    const { row, payload, date } = historyFixture(), audit = auditDailyBars(row, payload, date);
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...row, symbol: `S${i}`, technical_audit: { ...audit, symbol: `S${i}`, values: { ...audit.values, momentum: Math.floor(i / 2) } } }));
    const ranked = rankVerifiedUniverse(rows);
    expect(ranked[0].rs_rating).toBe(ranked[1].rs_rating);
    expect(ranked.at(-1).rs_rating).toBeGreaterThan(98);
    expect(rankVerifiedUniverse(rows.slice(1)).every(r => r.rs_rating === null)).toBe(true);
    rows[0].technical_audit.as_of_date = '2000-01-01';
    expect(rankVerifiedUniverse(rows).every(r => r.rs_rating === null)).toBe(true);
  });
  it('independently verifies eight template rules and IBD growth evidence', () => {
    const { row, payload, date } = historyFixture();
    row.technical_audit = auditDailyBars(row, payload, date);
    expect(assess(row).qualified).toBe(true);
    expect(assess(row, 'ibd').qualified).toBe(true);
    expect(row.technical_audit.values.sma50).toBeCloseTo(113.625);
    expect(assess({ ...row, passes_template: false }).qualified).toBe(true);
    expect(assess({ ...row, passes_template: false }).templateMismatch).toBe(true);
  });
  it('rejects an upstream false positive caused by ignoring an intraday high', () => {
    const { row, payload, date } = historyFixture();
    payload.bars[100].high = 200;
    const audit = auditDailyBars(row, payload, date);
    expect(audit.valid).toBe(true);
    expect(assess({ ...row, technical_audit: audit }).qualified).toBe(false);
    expect(assess({ ...row, technical_audit: audit }).templateMismatch).toBe(true);
  });
  it('holds a split-like price jump for source adjustment review', () => {
    const { row, payload, date } = historyFixture();
    for (const bar of payload.bars.slice(-60)) for (const key of ['open', 'close', 'high', 'low']) bar[key] *= 10;
    row.current_price = payload.bars.at(-1).close;
    expect(auditDailyBars(row, payload, date).errors).toContain('大幅な価格断絶：分割・併合調整を要確認');
  });
  const corruptions = [p => p.bars.pop(), p => p.bars.reverse(), p => p.bars.push(p.bars.at(-1)), p => p.bars.splice(0, 100),
    p => p.bars[30].close = '60', p => p.bars[50].high = 1, p => p.bars[40].volume = -1,
    p => p.symbol = 'WRONG', p => p.as_of_date = '2020-01-01', p => p.bars[40].date = '2026-02-30'];
  for (const [index, mutate] of corruptions.entries()) it(`fails closed on corrupt input ${index + 1}`, () => {
    const { row, payload, date } = historyFixture(); mutate(payload);
    const audit = auditDailyBars(row, payload, date);
    expect(audit.valid).toBe(false);
    expect(assess({ ...row, technical_audit: audit }).qualified).toBe(false);
    expect(Object.keys(audit.values)).toHaveLength(0);
  });
  it('does not certify a pass flag or out-of-range/absent ratings', () => {
    expect(assess({ passes_template: true, rs_rating: 95, week_52_low_distance: 100, week_52_high_distance: 0 }).qualified).toBe(false);
    const { row, payload, date } = historyFixture(); row.technical_audit = auditDailyBars(row, payload, date);
    for (const value of [100, 1000, -1, '95', Infinity, null]) expect(assess({ ...row, rs_rating: value }).qualified).toBe(false);
    expect(assess({ ...row, annual_eps_growth_3y: null }, 'ibd').qualified).toBe(false);
    expect(assess({ ...row, eps_growth_yy: null }, 'ibd').qualified).toBe(false);
    expect(assess({ ...row, sales_growth_yy: -5 }, 'ibd').qualified).toBe(false);
    expect(auditValues({ ...row, symbol: 'OTHER' })).toEqual({});
  });
  it('excludes current volume from its baseline and distinguishes screening from entry', () => {
    const { row, payload, date } = historyFixture(); payload.bars.at(-1).volume = 1400000;
    row.technical_audit = auditDailyBars(row, payload, date);
    expect(row.technical_audit.values.volumeRatio).toBe(1.4);
    expect(entryChecks(row)[1].state).toBe('pass');
    expect(entryChecks(row).at(-1).state).toBe('unknown');
  });
  it('rejects mixed dates and conflicting duplicate rows regardless of order', () => {
    const date = '2026-09-23', a = { symbol: 'A', current_price: 100 }, b = { ...a, current_price: 101 };
    const pack = rows => ({ rows, as_of_date: date });
    expect(mergeScanRows([pack([a]), pack([a])], date)).toHaveLength(1);
    for (const rows of [[a, b], [b, a]]) expect(mergeScanRows([pack(rows)], date)[0].technical_audit.valid).toBe(false);
    expect(() => mergeScanRows([pack([a]), { rows: [b] }], date)).toThrow();
  });
});
