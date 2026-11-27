// The sell card's provisional stop (仮の損切り, plan BEH-1 / D8): ピボットの −7.0%, this app's own setting (独自設定), the same
// for every viewer whatever the plan's stop setting, so whether a stock reached it is a fact of the data, not of a device.
// The plan keeps its own stop (positionSizing.js: entry × (1 − pct/100), unrounded); this level is used by the stop row only.
// This module imports nothing.

/** The provisional stop's width under the pivot, in percent (独自設定). */
export const PROVISIONAL_STOP_PERCENT = 7;

const usable = pivot => Number.isFinite(pivot) && pivot > 0;

/** The provisional stop for `pivot`: pivot × (1 − 7/100), unrounded; null without a usable pivot. */
export const provisionalStop = pivot => (usable(pivot) ? pivot * (1 - PROVISIONAL_STOP_PERCENT / 100) : null);

/**
 * The provisional stop's whole cents, half up, from the pivot's cents (so a pivot of 10.50 gives 977, never the 976 a float
 * product can land on): the one number the stop row judges a low against and prints (cents / 100). Null without a usable pivot.
 */
export const provisionalStopCents = pivot => (usable(pivot) ? Math.round(Math.round(pivot * 100) * (100 - PROVISIONAL_STOP_PERCENT) / 100) : null);
