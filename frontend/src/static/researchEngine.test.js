import { describe, expect, it } from 'vitest';
import { assess, compareReference, entryPlan, quoteStatus, rankCandidates, researchCsv, snapshotFreshness } from './researchEngine';

describe('research rules and financial data integrity', () => {
  it('measures analysis age in New York calendar days, independent of publication time', () => {
    const now = Date.parse('2026-09-24T02:00:00Z'); // Still September 23 in New York.
    expect(snapshotFreshness('2026-09-23', now)).toEqual({ state: 'recent', days: 0 });
    expect(snapshotFreshness('2026-09-19', now)).toEqual({ state: 'old', days: 4 });
    expect(snapshotFreshness('2026-09-24', now).state).toBe('future');
    expect(snapshotFreshness('2026-02-30', now).state).toBe('unknown');
    expect(snapshotFreshness(undefined, now).state).toBe('unknown');
    expect(snapshotFreshness('2026-09-18', Date.parse('2026-09-21T12:00:00Z')).state).toBe('recent');
  });
  it('exports dated, auditable CSV with unknown rules and literal spreadsheet text', () => {
    const ranked = rankCandidates([{ symbol: '=HYPERLINK("bad")', current_price: 100, vcp_pivot: 99 }], 'oneil');
    const csv = researchCsv(ranked, 'oneil', '2026-09-21');
    expect(csv).toContain('"as_of_date"');
    expect(csv).toContain('"2026-09-21"');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"false","0","8","8"');
    expect(csv).toContain('年間 EPS 3年成長率');
    expect(csv).toContain('"99"');
  });
  it('normalizes both legacy signed and feature-store unsigned high distance', () => {
    for (const distance of [-10, 10, 0]) expect(assess({ week_52_high_distance: distance }, 'ibd').rules[4].state).toBe('pass');
    for (const distance of [-26, 26]) expect(assess({ week_52_high_distance: distance }, 'minervini').rules[3].state).toBe('fail');
  });
  it('excludes illiquid or missing-liquidity stocks when the liquidity gate is enabled', () => {
    const rows = [{ symbol: 'GOOD', current_price: 10, adv_usd: 20000000 }, { symbol: 'PENNY', current_price: 2, adv_usd: 50000000 }, { symbol: 'UNKNOWN', current_price: 50 }];
    expect(rankCandidates(rows, 'ibd', { liquidOnly: true }).map(r => r.row.symbol)).toEqual(['GOOD']);
  });
  it('does not use QoQ as the CAN SLIM C growth criterion', () => {
    const result = assess({ eps_growth_qq: 200, eps_growth_yy: -10 }, 'oneil');
    expect(result.rules[0].state).toBe('fail');
    expect(assess({ eps_growth_qq: 200 }, 'oneil').rules[0].state).toBe('unknown');
  });
  it('does not silently qualify missing fundamentals', () => {
    expect(assess({}, 'oneil').qualified).toBe(false);
    expect(assess({}, 'ibd').unknown).toBe(5);
  });
  it('keeps a known zero distinct from absent data', () => {
    expect(assess({ eps_growth_yy: 0 }, 'oneil').rules[0].state).toBe('fail');
    expect(assess({ rs_rating: NaN }, 'ibd').rules[1].state).toBe('unknown');
  });
  it('handles pivot boundary, extension, waiting and invalid prices', () => {
    expect(entryPlan({ current_price: 105, se_pivot_price: 100 }).state).toBe('買いゾーン内');
    expect(entryPlan({ current_price: 105.01, se_pivot_price: 100 }).state).toBe('買いゾーン超過');
    expect(entryPlan({ current_price: 99, se_pivot_price: 100 }).state).toBe('ピボット待ち');
    expect(entryPlan({ current_price: 99, se_pivot_price: 0 }).state).toBe('未判定');
  });
  it('never labels old, future, unknown-delay or malformed quotes realtime', () => {
    const now = Date.parse('2026-09-22T15:00:00Z');
    const quote = { price: 100, as_of: '2026-09-22T15:00:00Z', is_realtime: true, delay_seconds: 0 };
    expect(quoteStatus(quote, now)).toBe('リアルタイム');
    expect(quoteStatus(quote, now + 91000)).toBe('期限切れ');
    expect(quoteStatus(quote, now - 10000)).toBe('期限切れ');
    expect(quoteStatus({ ...quote, delay_seconds: undefined }, now)).toBe('遅延データ');
    expect(quoteStatus({ ...quote, price: -1 }, now)).toBe('未接続');
  });
  it('compares reference membership only for verified matching dates', () => {
    const reference = { verified: true, as_of_date: '2026-09-21', constituents: ['AAA', 'BBB'] };
    expect(compareReference([{ symbol: 'AAA' }], reference, '2026-09-22')).toBe(null);
    expect(compareReference([{ symbol: 'AAA' }], { ...reference, verified: false }, '2026-09-21')).toBe(null);
    expect(compareReference([{ symbol: 'AAA' }, { symbol: 'AAA' }], reference, '2026-09-21').recall).toBe(.5);
  });
  it('filters non-US rows and preserves deterministic sorting', () => {
    expect(rankCandidates([{ symbol: 'B', market: 'US' }, { symbol: 'A', market: 'US' }, { symbol: 'JP', market: 'JP' }], 'ibd').map(r => r.row.symbol)).toEqual(['A', 'B']);
  });
});
