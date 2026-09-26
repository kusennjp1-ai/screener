import { describe, expect, it } from 'vitest';
import { appendJournalEvent, deriveJournal, emptyJournal, exportJournal, importJournal, journalExposurePolicy, reviewJournalExit, reviewJournalOrder } from './localTradeJournal';

const buy = (id, extra = {}) => ({ id, date: '2026-01-02', type: 'buy', symbol: 'AAA', price: 100, shares: 10, fees: 1, stop: 95, ...extra });
const event = (id, type, extra = {}) => ({ id, date: '2026-01-03', type, symbol: 'AAA', ...extra });
const order = extra => ({ date: '2026-01-02', setupDate: '2026-01-02', symbol: 'AAA', price: 100, shares: 10, fees: 1, stop: 95, setupConfirmed: true, setupNote: '新しいベースと出来高を確認', marketConfirmed: true, earningsConfirmed: true, ...extra });

describe('local journal accounting', () => {
  it('starts with no fabricated trades in distinct live and paper modes', () => {
    expect(deriveJournal(emptyJournal())).toMatchObject({ cash: 100000, realized: 0, closedTrades: [], holdings: [], verifiedExternally: false });
    expect(emptyJournal(100000, 'paper').mode).toBe('paper');
    expect(importJournal(exportJournal(emptyJournal(100000, 'paper'))).mode).toBe('paper');
  });

  it('accounts for fees, partial sales and remaining stops without double-counting closed trades', () => {
    let journal = appendJournalEvent(emptyJournal(), buy('b1'));
    journal = appendJournalEvent(journal, event('s1', 'sell', { price: 110, shares: 4, fees: 1 }));
    const partial = deriveJournal(journal);
    expect(partial.cash).toBe(99438);
    expect(partial.realized).toBeCloseTo(38.6);
    expect(partial.holdings[0]).toMatchObject({ shares: 6, stop: 95 });
    expect(partial.holdings[0].costBasis).toBeCloseTo(600.6);
    expect(partial.closedTrades).toHaveLength(0);
    journal = appendJournalEvent(journal, event('s2', 'sell', { price: 120, shares: 6, fees: 1 }));
    const closed = deriveJournal(journal);
    expect(closed.realized).toBeCloseTo(157);
    expect(closed.cash).toBe(100157);
    expect(closed.closedTrades).toHaveLength(1);
    expect(closed.closedTrades[0].returnPct).toBeCloseTo(157 / 1001 * 100);
  });

  it('computes monetary drawdown only from recorded equity snapshots', () => {
    let journal = appendJournalEvent(emptyJournal(), buy('b1', { fees: 0 }));
    journal = appendJournalEvent(journal, event('m1', 'mark', { price: 120 }));
    journal = appendJournalEvent(journal, event('m2', 'mark', { price: 90 }));
    const state = deriveJournal(journal);
    expect(state).toMatchObject({ equity: 99900, maxDrawdown: 300 });
    expect(state.maxDrawdownPct).toBeCloseTo(300 / 100200 * 100);
    expect(state.drawdownBasis).toContain('未記録');
  });

  it('identifies mixed-date marks rather than claiming a synchronized portfolio quote', () => {
    let j = appendJournalEvent(emptyJournal(), buy('a'));
    j = appendJournalEvent(j, buy('b', { symbol: 'BBB' }));
    j = appendJournalEvent(j, event('m', 'mark', { price: 101 }));
    expect(deriveJournal(j).marksAligned).toBe(false);
  });

  it('records bad actual actions honestly rather than deleting policy violations', () => {
    let j = appendJournalEvent(emptyJournal(), buy('b1'));
    j = appendJournalEvent(j, buy('b2', { date: '2026-01-03', price: 90, stop: 85 }));
    const s = deriveJournal(j);
    expect(s.journal.events).toHaveLength(2);
    expect(s.warnings.join(' ')).toContain('含み益のない追加購入');
    expect(s.warnings.join(' ')).toContain('逆指値を引下げ');
  });

  it('rejects oversells, short sales, negative cash and out-of-order records before saving', () => {
    const j = appendJournalEvent(emptyJournal(), buy('b1'));
    expect(() => appendJournalEvent(j, event('s', 'sell', { price: 110, shares: 11, fees: 0 }))).toThrow();
    expect(() => appendJournalEvent(emptyJournal(), event('s', 'sell', { price: 110, shares: 1, fees: 0 }))).toThrow();
    expect(() => appendJournalEvent(j, buy('b2', { date: '2026-01-01' }))).toThrow();
    expect(() => appendJournalEvent(emptyJournal(100), buy('large'))).toThrow();
  });

  it('rejects duplicate IDs, impossible dates, invalid fees and malformed import', () => {
    const j = appendJournalEvent(emptyJournal(), buy('b1'));
    for (const e of [buy('b1'), buy('b2', { date: '2026-02-30' }), buy('b2', { fees: -1 }), buy('b2', { shares: .5 }), buy('b2', { price: Infinity })]) {
      expect(() => appendJournalEvent(j, e)).toThrow();
    }
    for (const text of ['{', '{}', JSON.stringify({ ...emptyJournal(), mode: 'fake' }), 'x'.repeat(2000001)]) expect(() => importJournal(text)).toThrow();
  });

  it('excludes future live records and preserves future scenarios only in paper mode', () => {
    expect(() => appendJournalEvent(emptyJournal(), buy('future', { date: '2999-01-01' }))).toThrow('未来日');
    expect(appendJournalEvent(emptyJournal(100000, 'paper'), buy('future', { date: '2999-01-01' })).mode).toBe('paper');
  });

  it('round-trips declared records while dropping unknown imported fields', () => {
    const j = appendJournalEvent(emptyJournal(), buy('b1'));
    const restored = importJournal(JSON.stringify({ ...j, remoteUrl: 'https://invalid.example', events: [{ ...j.events[0], verified: true }] }));
    expect(restored).toEqual(j);
    expect(deriveJournal(restored).verifiedExternally).toBe(false);
  });
});

describe('whole-portfolio prospective review', () => {
  it('permits a first conditional pilot without demanding imaginary past winners', () => {
    const review = reviewJournalOrder(deriveJournal(emptyJournal()), order());
    expect(review).toMatchObject({ valid: true, empiricalStopCheck: 'not-yet-observed', minimumStop: 90, proposalNumericallySupported: true, executable: false });
    expect(review.maxShares).toBeLessThanOrEqual(62);
  });

  it('distinguishes unavailable discretionary evidence from arithmetic errors', () => {
    const review = reviewJournalOrder(deriveJournal(emptyJournal()), order({ setupConfirmed: false, marketConfirmed: false, earningsConfirmed: false }));
    expect(review.errors).toHaveLength(0);
    expect(review.unknowns).toHaveLength(3);
    expect(review.proposalNumericallySupported).toBe(false);
  });

  it('rounds a half-average-win stop UP and rejects a looser rounded order', () => {
    let j = appendJournalEvent(emptyJournal(), buy('b1', { shares: 10, fees: 0 }));
    j = appendJournalEvent(j, event('s1', 'sell', { price: 115, shares: 10, fees: 0 }));
    const review = reviewJournalOrder(deriveJournal(j), order({ symbol: 'BBB', date: '2026-01-04', price: 10.01, stop: 9.25 }));
    expect(review.minimumStop).toBe(9.26);
    expect(review.errors.join(' ')).toContain('半分');
  });

  it('blocks loss-averaging and requires a new setup for reentry', () => {
    let j = appendJournalEvent(emptyJournal(), buy('b1', { fees: 0 }));
    expect(reviewJournalOrder(deriveJournal(j), order({ price: 99, stop: 95 })).errors.join(' ')).toContain('追加購入は不可');
    j = appendJournalEvent(j, event('s1', 'sell', { price: 95, shares: 10, fees: 0 }));
    expect(reviewJournalOrder(deriveJournal(j), order({ date: '2026-01-04' })).unknowns.join(' ')).toContain('再仕掛け');
    expect(reviewJournalOrder(deriveJournal(j), order({ date: '2026-01-04', reentryConfirmed: true, setupDate: '2026-01-01' })).unknowns.join(' ')).toContain('手仕舞い以後');
    expect(reviewJournalOrder(deriveJournal(j), order({ date: '2026-01-04', reentryConfirmed: true, setupDate: '2026-01-04' })).unknowns.join(' ')).not.toContain('再仕掛け');
  });

  it('checks combined capital risk for a profitable addition', () => {
    const s = deriveJournal(appendJournalEvent(emptyJournal(), buy('b1', { fees: 0 })));
    const unsafe = reviewJournalOrder(s, order({ price: 110, stop: 95, shares: 1, fees: 0 }));
    expect(unsafe.errors.join(' ')).toContain('元本リスクが増える');
    const safer = reviewJournalOrder(s, order({ price: 110, stop: 100, shares: 1, fees: 0 }));
    expect(safer.errors.join(' ')).not.toContain('元本リスクが増える');
    expect(safer.combinedRisk).toBe(10);
  });

  it('shrinks total exposure with actual account losses even if percentage average is positive', () => {
    let j = emptyJournal();
    for (let i = 0; i < 3; i++) {
      j = appendJournalEvent(j, buy(`b${i}`, { shares: 1, fees: 0 }));
      j = appendJournalEvent(j, event(`s${i}`, 'sell', { date: '2026-01-02', price: 110, shares: 1, fees: 0 }));
    }
    j = appendJournalEvent(j, buy('large', { shares: 100, fees: 0 }));
    j = appendJournalEvent(j, event('loss', 'sell', { price: 95, shares: 100, fees: 0 }));
    const s = deriveJournal(j);
    expect(s.stats.expectancy).toBeGreaterThan(0);
    expect(s.realized).toBe(-470);
    expect(journalExposurePolicy(s)).toMatchObject({ defensive: true, expansionSupported: false, totalCap: .125 });
    expect(s.largestClosedLoss).toBe(500);
    expect(s.strategyStats[0].realized).toBe(-470);
  });

  it('subtracts other holdings from the total exposure room', () => {
    const j = appendJournalEvent(emptyJournal(), buy('b1', { symbol: 'BBB', shares: 250, fees: 0 }));
    const review = reviewJournalOrder(deriveJournal(j), order());
    expect(review.maxShares).toBe(0);
    expect(review.errors.join(' ')).toContain('全保有');
  });
});

describe('remaining-position protection', () => {
  it('persists dated MA observations, ratchets protection after activation, and resets on a new cycle', () => {
    let j = appendJournalEvent(emptyJournal(), buy('b', { fees: 0 }));
    const observe = (id, date, ma50) => ({ id, date, symbol: 'AAA', type: 'ma50', close: 110, ma50 });
    j = appendJournalEvent(j, observe('m1', '2026-01-03', 101));
    expect(deriveJournal(j).holdings[0].ma50TrailingLevel).toBeUndefined();
    j = appendJournalEvent(j, observe('m2', '2026-01-04', 104));
    j = appendJournalEvent(j, observe('m3', '2026-01-05', 98));
    const restored = deriveJournal(importJournal(exportJournal(j)));
    expect(restored.holdings[0].ma50TrailingLevel).toBe(104);
    expect(reviewJournalExit(restored.holdings[0], { close: 103 }, restored.stats)).toMatchObject({ ma50TrailingLevel: 104, ma50CloseExit: true });
    expect(() => appendJournalEvent(j, observe('same', '2026-01-05', 120))).toThrow('前回より後');
    j = appendJournalEvent(j, event('sold', 'sell', { date: '2026-01-06', price: 110, shares: 10, fees: 0 }));
    j = appendJournalEvent(j, buy('again', { date: '2026-01-07', fees: 0 }));
    expect(deriveJournal(j).holdings[0].ma50Observations).toBeUndefined();
  });
  it('retains the stop after a partial sale and distinguishes close-based MA50 from a fixed backstop', () => {
    let j = appendJournalEvent(emptyJournal(), buy('b1', { fees: 0 }));
    j = appendJournalEvent(j, event('m', 'mark', { price: 120 }));
    j = appendJournalEvent(j, event('s', 'sell', { price: 120, shares: 5, fees: 0 }));
    const s = deriveJournal(j), p = s.holdings[0];
    expect(p.stop).toBe(95);
    const r = reviewJournalExit(p, { close: 109, ma50: 110, backstop: 105, previousMa50: 109, previousMa50Date: '2026-01-02', asOfDate: '2026-01-03', previousTrailingLevel: 109 }, s.stats);
    expect(r).toMatchObject({ remainingShares: 5, stopFloor: 105, ma50CloseExit: true, fixedBackstop: 105, stopTouched: false });
  });

  it('does not use an MA below cost as breakeven trailing protection', () => {
    const s = deriveJournal(appendJournalEvent(emptyJournal(), buy('b1', { fees: 0 })));
    expect(reviewJournalExit(s.holdings[0], { close: 96, ma50: 98 }, s.stats)).toMatchObject({ ma50Eligible: false, ma50CloseExit: null });
    expect(reviewJournalExit(s.holdings[0], { close: 110, backstop: 90 }, s.stats).valid).toBe(false);
  });
  it('keeps historical trailing protection on a falling MA and requires dated evidence', () => {
    const s = deriveJournal(appendJournalEvent(emptyJournal(), buy('b1', { fees: 0 })));
    const p = s.holdings[0];
    expect(reviewJournalExit(p, { close: 110, ma50: 109 }, s.stats).ma50CloseExit).toBeNull();
    const input = { close: 111, ma50: 110, previousMa50: 112, previousTrailingLevel: 112, previousMa50Date: '2026-01-02', asOfDate: '2026-01-03' };
    expect(reviewJournalExit(p, input, s.stats)).toMatchObject({ ma50TrailingLevel: 112, ma50CloseExit: true });
    expect(reviewJournalExit(p, { ...input, previousMa50Date: input.asOfDate }, s.stats).ma50Eligible).toBe(false);
  });
});

it('subtracts other positions capital risk from the whole-account loss budget', () => {
  const j = appendJournalEvent(emptyJournal(), buy('b1', { symbol: 'BBB', shares: 100, stop: 90, fees: 0 }));
  const result = reviewJournalOrder(deriveJournal(j), order({ fees: 0 }));
  expect(result.maxShares).toBe(0);
  expect(result.portfolioRisk).toBe(1050);
  expect(result.errors.join(' ')).toContain('口座全体');
});
