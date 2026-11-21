// The stop row's own level (plan D8): 仮の損切り, the pivot less PROVISIONAL_STOP_PERCENT, judged the same for every viewer
// (whatever their stop setting or an applied structural stop), so a count of stop hits is a fact of the data. The plan keeps
// its own stop (positionSizing.js, unrounded, untouched): this module never feeds a plan, a share count or a gate. Both
// numbers are printed through the one money formatter (stopPrinted), and the screen compares them as printed strings: equal,
// it shows one number under the two names (損切り for the plan, 仮の損切り for the row); different, each under its own name.
import { STOP_DEFAULT_PERCENT } from './positionSizing';

const finite = Number.isFinite;

/** The 仮の損切り's width below the pivot (独自設定): the plan's default stop width, fixed for the row. */
export const PROVISIONAL_STOP_PERCENT = STOP_DEFAULT_PERCENT;

/** 仮の損切り: pivot × (1 − 7/100), unrounded; null without a positive pivot. */
export function provisionalStop(pivot) {
  return finite(pivot) && pivot > 0 ? pivot * (1 - PROVISIONAL_STOP_PERCENT / 100) : null;
}

/** A level as every stock-side figure prints it (two decimals, grouped), or null when it is not a number. */
export function stopPrinted(value) {
  return finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
}

/**
 * The two stops as the screen prints them: `{ plan, provisional, same }`, `plan` the plan's stop and `provisional` the
 * row's level (each a printed string, or null), `same` true only when both are printed and equal (then one number stands
 * under both names). `plan` is a positionPlan (a blocked or missing plan has no stop); `pivot` the screen's pivot.
 */
export function stopLevels(plan, pivot) {
  const planStop = plan && !plan.blocked ? stopPrinted(plan.stop) : null;
  const provisional = stopPrinted(provisionalStop(pivot));
  return { plan: planStop, provisional, same: planStop !== null && planStop === provisional };
}
