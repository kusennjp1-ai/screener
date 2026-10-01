import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { entryPlan } from '../researchEngine';
import { radarGeometry, stateKey } from '../positionGeometry';
import { radarFrame, radarSelection } from '../radarMarks';

export default memo(function SetupRadar({ranked,selectedSymbol,onSelect,small=false}) {
 const container=useRef(null);
 const points=useMemo(()=>ranked.filter(x=>x.assessment.qualified).map(({row})=>{const p=entryPlan(row,null,'minervini');return {symbol:row.symbol,distance:p.pivot?p.distance:null,rs:row.rs_rating,volume:row.se_volume_vs_50d,state:stateKey(p.state),pickable:Boolean(row.chart_path)};}),[ranked]);
 const g=useMemo(()=>radarGeometry(points,small?340:620,small?124:224),[points,small]);
 const frame=useMemo(()=>({__html:radarFrame(g,small)}),[g,small]);
 const selected=useMemo(()=>g.points.find(point=>point.symbol===selectedSymbol),[g,selectedSymbol]);
 const drawSelection=useCallback(point=>{
  const {overlay,label}=radarSelection(g,point);
  const graphic=container.current.querySelector('[data-radar-selection]');
  const caption=container.current.querySelector('[data-radar-label]');
  graphic.innerHTML=overlay;caption.innerHTML=label;
 },[g]);
 useLayoutEffect(()=>{drawSelection(selected);},[frame,selected,drawSelection]);
 const eventPoint=event=>{const node=event.target.closest?.('[data-radar-point]');return node?g.points[Number(node.dataset.radarPoint)]:null;};
 return <section ref={container} className="setup-radar" aria-label="セットアップ・レーダー" dangerouslySetInnerHTML={frame}
  onMouseOver={event=>drawSelection(eventPoint(event)||selected)}
  onMouseOut={event=>{if(!event.relatedTarget?.nodeType || !event.currentTarget.contains(event.relatedTarget))drawSelection(selected);}}
  onMouseLeave={()=>drawSelection(selected)}
  onClick={event=>{const point=eventPoint(event);if(point?.pickable)onSelect(point.symbol);}}/>;
});
