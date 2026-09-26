import { expect, it } from 'vitest';
import { partialSalePlan } from './partialSalePlan';
const holding = { shares: 100, costBasis: 10010, stop: 95 };
it('accounts for both sets of fees and residual cost without mutating the position', () => {
  const result = partialSalePlan(holding, { shares: 40, price: 120, fees: 4, remainingStop: 105, stopFees: 6 });
  expect(result).toMatchObject({ valid: true, remainingShares: 60, realizedOnSale: 792, remainingBasis: 6006, residualPnLAtStop: 288, combinedPnLAtStop: 1080 });
  expect(holding).toEqual({ shares: 100, costBasis: 10010, stop: 95 });
});
it('handles a full exit without inventing a residual stop or fees', () => {
  expect(partialSalePlan(holding, { shares: 100, price: 90, fees: 5, stopFees: 50 })).toMatchObject({ valid: true, remainingShares: 0, remainingStop: null, combinedPnLAtStop: -1015, stopAlreadyBreached: true });
});
it('rejects impossible quantities, loose stops, fees and invalid numbers', () => {
  for (const change of [{ shares: 101 }, { shares: .5 }, { remainingStop: 94 }, { remainingStop: 120 }, { fees: -1 }, { price: NaN }, { fees: 100000 }]) {
    expect(partialSalePlan(holding, { shares: 50, price: 120, remainingStop: 100, ...change }).valid).toBe(false);
  }
});
