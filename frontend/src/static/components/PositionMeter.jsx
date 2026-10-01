import { memo } from 'react';
import { meterGeometry, signed, STATES, stateKey } from '../positionGeometry';
export default memo(function PositionMeter({plan}) {
 const g=meterGeometry(plan.distance,112,plan.zone||5),state=STATES[stateKey(plan.state)];
 return <svg className="position-meter" width="112" height="14" viewBox="0 0 112 14" role="img" aria-label={`ピボット比 ${signed(plan.distance)}。${state[0]}${g.clipped?'。目盛り範囲外':''}`}>
  <path d="M4 7H108" stroke="var(--line-2)" strokeWidth="3" />
  <rect x={g.pivot} y="3" width={g.zoneWidth} height="8" rx="4" fill="var(--zone-fill)" stroke="var(--zone-edge)" />
  <path d={`M${g.pivot} 1.5V12.5`} stroke="var(--text-3)" strokeDasharray="2 2" />
  {g.price!==null&&<circle cx={g.price} cy="7" r="3.5" fill={`var(--${state[2]})`} />}
 </svg>;
});
