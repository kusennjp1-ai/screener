import { describe, expect, it } from 'vitest';
import { parseTradeReturns, reviewPosition, tradeEvidence } from './bookRiskPolicy';

const position = { entry: 100, current: 108, peak: 108, initialStop: 93, currentStop: 93, shares: 50, capital: 100000 };
const history = () => tradeEvidence([14, -5, 16]);

describe('declared trade evidence', () => {
  it('includes flat trades in win rate and arithmetic expectancy, not an account return', () => {
    const result = tradeEvidence(parseTradeReturns('10%, -5、0\n+15'));
    expect(result).toMatchObject({ count: 4, wins: 2, losses: 1, averageWin: 12.5, averageLoss: 5, winRate: .5, expectancy: 5, accountPerformanceVerified: false });
    expect(result).not.toHaveProperty('allocationCap');
  });

  it('keeps absent winning or losing evidence unknown rather than zero', () => {
    expect(tradeEvidence([])).toMatchObject({ averageWin: null, averageLoss: null, winRate: null, expectancy: null, stopCeilingPct: null });
    expect(tradeEvidence([-4, 0])).toMatchObject({ averageWin: null, averageLoss: 4, stopCeilingPct: null });
    expect(tradeEvidence([12])).toMatchObject({ averageWin: 12, averageLoss: null, stopCeilingPct: 6 });
  });

  it.each([null, 12, 'NaN', 'Infinity', '1e3', '-101', '10001', '10%;5%', '10,invalid'])('rejects malformed text %s', text => {
    expect(() => parseTradeReturns(text)).toThrow();
  });

  it('rejects oversized and sparse histories through either entry point', () => {
    expect(() => parseTradeReturns(Array(1001).fill('1').join(','))).toThrow();
    expect(() => tradeEvidence(Array(1001).fill(1))).toThrow();
    expect(() => tradeEvidence(Array(3))).toThrow();
    expect(() => tradeEvidence([1, undefined])).toThrow();
  });

  it('derives a half-average-win ceiling with an absolute 10% cap', () => {
    expect(tradeEvidence([15, -5]).stopCeilingPct).toBe(7.5);
    expect(tradeEvidence([30, -5]).stopCeilingPct).toBe(10);
  });

  it('verifies the actual payoff ratio without inventing missing outcomes', () => {
    expect(tradeEvidence([10, -5])).toMatchObject({ payoffRatio: 2, payoffState: 'pass', payoffMinimum: 2 });
    expect(tradeEvidence([10, -6])).toMatchObject({ payoffState: 'fail' });
    for (const returns of [[], [0], [10, 12], [-2, -3]]) {
      expect(tradeEvidence(returns)).toMatchObject({ payoffRatio: null, payoffState: 'unknown' });
    }
    expect(tradeEvidence([10000, -Number.MIN_VALUE])).toMatchObject({ payoffRatio: null, payoffState: 'unknown' });
  });

  it('does not mistake positive expectancy for a passing two-times payoff guideline', () => {
    const stats = tradeEvidence([10, 10, 10, 10, -8]);
    expect(stats.expectancy).toBeGreaterThan(0);
    expect(stats).toMatchObject({ payoffRatio: 1.25, payoffState: 'fail' });
  });

  it('does not let three recent wins erase negative overall expectancy', () => {
    expect(tradeEvidence([-50, 5, 5, 5])).toMatchObject({ positiveTrials: true, defensive: true, phase: '縮小', riskPerTrade: .0025 });
    expect(tradeEvidence([5, 5, 5])).toMatchObject({ phase: '段階的拡大を検討', accountPerformanceVerified: false, riskPerTrade: .005 });
  });

  it('shrinks after consecutive losses even if the arithmetic mean remains positive', () => {
    expect(tradeEvidence([30, -2, -2])).toMatchObject({ defensive: true, lossStreak: 2, riskPerTrade: .0025 });
  });
  it('does not restore reduced size after a flat trade or one tiny winner', () => {
    for (const tail of [[0], [.01], [2, 2]]) expect(tradeEvidence([15, -2, -2, ...tail]).defensive).toBe(true);
    expect(tradeEvidence([15, -2, -2, 2, 2, 2]).defensive).toBe(false);
  });
});

describe('position review with explicit attained high', () => {
  it('starts a distinct 2R review without imposing the later mandatory breakeven rule', () => {
    const atTwo = reviewPosition({ ...position, peak: 114 }, tradeEvidence([20]));
    expect(atTwo).toMatchObject({ twoRProtectionReview: true, book1ProtectionReview: false, protectionReview: false, breakevenRequired: false, stopFloor: 93 });
    expect(atTwo.errors).toContain('初期リスクの2倍に到達：利益保護を検討（3R・平均利益2倍の条件とは別）');
    expect(reviewPosition({ ...position, peak: 113.99 }, tradeEvidence([20])).twoRProtectionReview).toBe(false);
  });

  it('retains the early review after a pullback and does not loosen an existing stop', () => {
    const result = reviewPosition({ ...position, current: 109, peak: 114, currentStop: 107 }, tradeEvidence([20]));
    expect(result).toMatchObject({ twoRProtectionReview: true, stopFloor: 107, breakevenRequired: false });
  });
  it('retains two-times-average-win protection after a pullback below the trigger', () => {
    const result = reviewPosition({ ...position, peak: 116 }, tradeEvidence([8, -3]));
    expect(result).toMatchObject({ valid: true, breakevenRequired: true, protectionReview: false, stopFloor: 100, qualified: false });
    expect(result.peakMultiple).toBeCloseTo(16 / 7);
    expect(result.errors).toContain('平均利益の2倍に到達：少なくとも建値までの利益保護を確認');
  });

  it('distinguishes 3R review from the mandatory two-times-average-win rule', () => {
    const result = reviewPosition({ ...position, entry: 50, initialStop: 47.5, currentStop: 47.5, current: 54, peak: 57.5 }, tradeEvidence([12]));
    expect(result).toMatchObject({ protectionReview: true, breakevenRequired: false, stopFloor: 50, peakMultiple: 3 });
    expect(result.errors).toContain('初期リスクの3倍に到達：建値以上への利益保護を検討');
  });

  it('does not claim an average-profit condition has been met when it has not', () => {
    const result = reviewPosition({ ...position, initialStop: 95, currentStop: 95, peak: 115 }, tradeEvidence([20]));
    expect(result).toMatchObject({ protectionReview: false, breakevenRequired: false });
    expect(result).toMatchObject({ book1ProtectionReview: true, stopFloor: 100 });
  });

  it('never substitutes current price for an omitted or invalid peak', () => {
    for (const peak of [undefined, null, NaN, 107, 0, '116']) {
      expect(reviewPosition({ ...position, peak }, history()).valid).toBe(false);
    }
  });

  it('keeps an already higher stop and flags a stop lowered from explicit prior evidence', () => {
    expect(reviewPosition({ ...position, peak: 130, current: 125, currentStop: 120 }, history()).stopFloor).toBe(120);
    const lowered = reviewPosition({ ...position, previousStop: 104, currentStop: 101 }, history());
    expect(lowered.stopFloor).toBe(104);
    expect(lowered.errors).toContain('前回の逆指値から水準を引き下げています');
    expect(reviewPosition({ ...position, currentStop: 92 }, history()).errors).toContain('初期逆指値より損切り幅を広げています');
  });

  it('treats equality at the current stop as triggered without guaranteeing execution', () => {
    expect(reviewPosition({ ...position, current: 93, peak: 108 }, history())).toMatchObject({ triggered: true, averagingDown: true, qualified: false });
  });

  it('flags a purported stop above every attained price', () => {
    expect(reviewPosition({ ...position, currentStop: 109 }, history()).errors).toContain('現在の逆指値が入力された購入後最高値を超えています');
  });

  it('does not label missing winning-return evidence as a clean risk check', () => {
    const result = reviewPosition(position, tradeEvidence([]));
    expect(result.valid).toBe(true);
    expect(result.errors).toContain('平均利益の実績がなく、損切り幅の適合は未確認です');
    expect(result.qualified).toBe(false);
  });

  it('checks initial stop against both the book ceiling and actual average win', () => {
    const result = reviewPosition({ ...position, initialStop: 89 }, history());
    expect(result.errors).toContain('初期損切り幅が10%上限を超えています');
    expect(result.errors).toContain('初期損切り幅が実績平均利益の半分を超えています');
  });

  it('does not permit a rounded stop beyond the half-average-win boundary', () => {
    const result = reviewPosition({ ...position, entry: 10.01, current: 10.02, peak: 10.02, initialStop: 9.25, currentStop: 9.25 }, history());
    expect(result.errors).toContain('初期損切り幅が実績平均利益の半分を超えています');
  });

  it('shrinks both dollar-risk and position ceilings, even with tight stops', () => {
    const normal = history(), defensive = tradeEvidence([15, -2, -2]);
    const tight = { ...position, initialStop: 99.5, currentStop: 99.5, shares: 0 };
    expect(reviewPosition(tight, normal)).toMatchObject({ riskBudget: 500, maxShares: 100 });
    expect(reviewPosition(tight, defensive)).toMatchObject({ riskBudget: 250, maxShares: 50 });
    expect(reviewPosition({ ...position, shares: 0 }, normal).maxShares).toBe(71);
    expect(reviewPosition({ ...position, shares: 0 }, defensive).maxShares).toBe(35);
  });

  it('flags shares beyond the risk budget and distinguishes capital loss from profit at risk', () => {
    const result = reviewPosition({ ...position, shares: 72, currentStop: 105 }, history());
    expect(result.plannedLoss).toBe(504);
    expect(result.protectionLoss).toBe(216);
    expect(result.errors).toContain('入力株数が独自モデルの損失予算または1銘柄上限を超えています');
  });

  it('rejects invalid evidence, impossible inputs, unsafe shares and overflow', () => {
    for (const evidence of [null, {}, { ...history(), riskPerTrade: 1 }, { ...history(), averageWin: NaN }, { ...history(), stopCeilingPct: 99 }]) {
      expect(reviewPosition(position, evidence).valid).toBe(false);
    }
    for (const input of [null, { ...position, entry: Infinity }, { ...position, shares: 1.5 }, { ...position, shares: Number.MAX_SAFE_INTEGER + 1 }, { ...position, initialStop: 100 }, { ...position, capital: 0 }, { ...position, previousStop: NaN }, { ...position, entry: Number.MIN_VALUE * 2, initialStop: Number.MIN_VALUE }]) {
      expect(reviewPosition(input, history()).valid).toBe(false);
    }
  });
});
