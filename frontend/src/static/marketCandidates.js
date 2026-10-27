import { entryReadiness } from './entryReadiness.js';
import { entryPlan } from './researchEngine.js';

// This uses the current worker's Minervini assessments, never another selected
// strategy's result or a cached provider badge. Missing evidence cannot qualify.
export function strongestMarketCandidates(ranked, date, market, now) {
  return ranked.filter(({ row, assessment: a }) => a?.qualified === true
    && !a.financial_exclusion && !a.method_status && a.unknown === 0 && a.failed === 0
    && Number.isSafeInteger(a.total) && a.total > 0 && a.passed === a.total
    && !row.corporate_action?.cash_acquisition && !row.price_activity?.lowRange
    && Number.isFinite(row.current_price) && row.current_price >= 10
    && Number.isFinite(row.adv_usd) && row.adv_usd >= 20e6
    && Number.isFinite(row.rs_rating) && row.rs_rating >= 80 && row.rs_rating <= 99)
    .map(item => ({ ...item, readiness: entryReadiness(item.row, date, market, now, 'minervini'), position: entryPlan(item.row, null, 'minervini') }))
    .sort((a, b) => Number(b.readiness.ready) - Number(a.readiness.ready)
      || b.readiness.passed - a.readiness.passed
      || Number(b.position.state === '買いゾーン内') - Number(a.position.state === '買いゾーン内')
      || b.row.rs_rating - a.row.rs_rating
      || b.row.adv_usd - a.row.adv_usd
      || a.row.symbol.localeCompare(b.row.symbol));
}
