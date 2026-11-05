// Position sizing for the stock screen's plan: the entry, the stop, the R levels and the shares a
// fixed account risk buys. Pure; the stop is capped below STOP_MAX_PERCENT.
import { finite } from '../researchEngine';

export const STOP_DEFAULT_PERCENT = 7;
export const STOP_MAX_PERCENT = 10;

/** Position plan from the planned entry (pivot, or price once above it). Stops are capped below 10%. */
export function positionPlan(view, { stopPercent = STOP_DEFAULT_PERCENT, account = 50000, riskPercent = 1.25 } = {}) {
  const pct = Math.min(STOP_MAX_PERCENT - 0.5, Math.max(1, stopPercent));
  const entry = finite(view?.pivot) && finite(view?.price) ? Math.max(view.pivot, view.price) : null;
  if (!finite(entry) || entry <= 0) return null;
  const stop = entry * (1 - pct / 100), risk = entry - stop;
  const riskDollars = finite(account) && account > 0 && finite(riskPercent) && riskPercent > 0 ? account * riskPercent / 100 : null;
  const shares = riskDollars ? Math.floor(riskDollars / risk) : null;
  return { entry, stop, stopPercent: pct, risk, r2: entry + 2 * risk, r3: entry + 3 * risk, riskDollars, shares,
    cost: shares === null ? null : shares * entry, weight: shares === null ? null : shares * entry / account * 100 };
}
