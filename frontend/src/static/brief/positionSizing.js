// Position sizing for the stock screen's plan: the entry, the stop, the R levels and the shares a
// fixed account risk buys. Pure; the stop is capped below STOP_MAX_PERCENT.
import { finite } from '../researchEngine';

export const STOP_DEFAULT_PERCENT = 7;
export const STOP_MAX_PERCENT = 10;

/**
 * The plan object. The required fields are what the plan carries today; the optional ones belong to
 * the contract other modules read (the conclusion tiles, the chart) and stay undefined until set.
 * @typedef {object} PositionPlan
 * @property {number} entry Planned entry: the pivot, or the price once above it.
 * @property {number} stop The entry less stopPercent.
 * @property {number} stopPercent The stop width used (1 to STOP_MAX_PERCENT − 0.5).
 * @property {number} risk Entry − stop, per share.
 * @property {number} r2 Entry + 2R.
 * @property {number} r3 Entry + 3R.
 * @property {number|null} riskDollars Account × risk %, or null without a usable account and risk.
 * @property {number|null} shares Whole shares that risk buys, or null.
 * @property {number|null} cost Shares × entry, or null.
 * @property {number|null} weight The cost as a % of the account, or null.
 * @property {boolean} [reference] Shown for reference only.
 * @property {boolean} [trialOnly] A trial calculation only.
 * @property {boolean} [defaults] Every input is still at its default.
 * @property {string} [binding] The constraint that set the share count.
 * @property {object} [structural] A structural stop from the last contraction.
 * @property {string} [blocked] Why no plan is made.
 */

/**
 * Position plan from the planned entry (pivot, or price once above it). Stops are capped below 10%.
 * @returns {PositionPlan|null}
 */
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

/**
 * The price levels the chart may draw from a plan: { entry, stop, r2, r3, structuralLow }, each null
 * when unknown. Step 0: the chart draws only `stop`, and structuralLow is always null.
 * @param {PositionPlan|null} plan
 */
export function planLevels(plan) {
  return { entry: plan?.entry ?? null, stop: plan?.stop ?? null, r2: plan?.r2 ?? null, r3: plan?.r3 ?? null, structuralLow: null };
}
