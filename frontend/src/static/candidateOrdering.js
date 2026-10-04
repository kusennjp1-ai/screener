import { entryPlan } from './researchEngine';
import { verifiedVolumeRatio } from './qualificationAudit';
import { stateKey } from './positionGeometry';

const stateOrder = state => ['zone', 'wait', 'ext', 'na', 'low', 'acq'].indexOf(stateKey(state));

// Order the complete filtered cohort before any display pagination or CSV export.
// The default retains the engine's canonical ranking and its lazy plan evaluation.
export function orderCandidates(ranked, { sort = 'rank', method = 'minervini', date } = {}) {
  if (sort === 'rank') return ranked;
  const values = ranked.map(item => ({ ...item, plan: entryPlan(item.row, null, method) }));
  const value = item => sort === 'distance' ? (item.plan.distance == null ? null : Math.abs(item.plan.distance))
    : sort === 'rs' ? item.row.rs_rating
    : sort === 'volume' ? verifiedVolumeRatio(item.row, date)
    : stateOrder(item.plan.state);
  return values.sort((a, b) => {
    const av = value(a), bv = value(b);
    // Unknown observations stay last in their existing canonical rank order.
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    return (av - bv) * (sort === 'rs' || sort === 'volume' ? -1 : 1) || a.row.symbol.localeCompare(b.row.symbol);
  });
}
