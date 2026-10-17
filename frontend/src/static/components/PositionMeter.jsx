import { memo } from 'react';
import { meterGeometry, signed, STATES, stateKey } from '../positionGeometry';

// Readiness/clock updates create new plans even when their displayed geometry
// is unchanged. Compare the primitive presentation inputs, and let React
// update only changed SVG attributes rather than reparsing the entire subtree.
const Meter = memo(function Meter({distance, zone, state}) {
 const g=meterGeometry(distance,112,zone),[label,,tone]=STATES[state];
 if(![g.pivot,g.zoneWidth].every(Number.isFinite)||(g.price!==null&&!Number.isFinite(g.price))) throw Error('Invalid position meter geometry');
 return <svg className="position-meter" width="112" height="14" viewBox="0 0 112 14" role="img" aria-label={`ピボット比 ${signed(distance)}。${label}${g.clipped?'。目盛り範囲外':''}`}>
  <path d="M4 7H108" stroke="var(--line-2)" strokeWidth="3"/>
  <rect x={g.pivot} y="3" width={g.zoneWidth} height="8" rx="4" fill="var(--zone-fill)" stroke="var(--zone-edge)"/>
  <path d={`M${g.pivot} 1.5V12.5`} stroke="var(--text-3)" strokeDasharray="2 2"/>
  {g.price!==null&&<circle cx={g.price} cy="7" r="3.5" fill={`var(--${tone})`}/>}
 </svg>;
});
export default function PositionMeter({plan}) {
 return <Meter distance={plan.distance} zone={plan.zone||5} state={stateKey(plan.state)}/>;
}
