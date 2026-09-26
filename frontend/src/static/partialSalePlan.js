const finite = n => typeof n === 'number' && Number.isFinite(n);
// A prospective calculation only: never appends transactions to the journal.
export function partialSalePlan(holding, { shares, price, fees = 0, remainingStop, stopFees = 0 }) {
  const fail = error => ({ valid: false, error });
  if (!holding || !Number.isSafeInteger(holding.shares) || holding.shares <= 0 || !finite(holding.costBasis) || holding.costBasis <= 0 || !finite(holding.stop) || holding.stop <= 0) return fail('有効な保有記録が必要です。');
  if (!Number.isSafeInteger(shares) || shares <= 0 || shares > holding.shares || !finite(price) || price <= 0 || !finite(fees) || fees < 0 || !finite(stopFees) || stopFees < 0) return fail('売却株数・想定価格・手数料を確認してください。');
  const remainingShares = holding.shares - shares;
  if (remainingShares && (!finite(remainingStop) || remainingStop < holding.stop || remainingStop >= price)) return fail('残株の逆指値は記録済み逆指値以上、想定売却価格未満で指定してください。');
  const soldBasis = holding.costBasis * shares / holding.shares;
  const netProceeds = shares * price - fees;
  if (netProceeds < 0) return fail('売却代金を超える手数料です。');
  const remainingBasis = holding.costBasis - soldBasis;
  const remainingProceedsAtStop = remainingShares ? remainingShares * remainingStop - stopFees : 0;
  const realizedOnSale = netProceeds - soldBasis;
  const residualPnLAtStop = remainingProceedsAtStop - remainingBasis;
  if (![netProceeds, remainingBasis, remainingProceedsAtStop, realizedOnSale, residualPnLAtStop].every(finite)) return fail('計算範囲を超えています。');
  return { valid: true, soldShares: shares, remainingShares, netProceeds, realizedOnSale, remainingBasis,
    remainingStop: remainingShares ? remainingStop : null, residualPnLAtStop,
    combinedPnLAtStop: realizedOnSale + residualPnLAtStop, executable: false,
    stopAlreadyBreached: price <= holding.stop };
}
