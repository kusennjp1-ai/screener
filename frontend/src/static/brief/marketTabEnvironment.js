// The market tab's own part of briefEnvironment.js: the ^GSPC record of the analysis date that the market tab's study
// (reference/marketTabStudy.js) compares with the regime. Only the lazily loaded market screen reads it, so it lives apart
// from briefEnvironment.js (which re-exports it) and Today's entry chunk does not ship it.
import { isoDay } from './briefShared';
import { trendsStatus } from './briefEnvironment';

/**
 * The app's own ^GSPC follow-through record (indices[^GSPC].followThrough: the market tab's フォロースルーデー row and its
 * ◆ mark) when it is available and judged on the analysis date's session, else null (an older or missing record is
 * nothing to compare). The regime's FTD is SPY's (backend market_regime.py: its own low anchor and volume rule), so the
 * two can legitimately differ on one day.
 */
export function gspcFollowThrough(trends) {
  if (trendsStatus(trends).state !== 'ready') return null;
  const ft = (trends.data.indices || []).find(item => item?.symbol === '^GSPC')?.followThrough;
  return ft?.available === true && isoDay(ft.asOf) && ft.asOf === trends.data.as_of_date ? ft : null;
}
