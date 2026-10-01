import { useLayoutEffect,useMemo,useRef,useState } from 'react';
import { ROTATION_QUADRANTS,sectorRotationGeometry } from '../sectorRotationGeometry';

export default function SectorRotation({groups,period,highlight,onHighlight,compact=false}) {
 const root=useRef(null),[width,setWidth]=useState(338);
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return undefined;
  const measure=()=>{const next=element.getBoundingClientRect().width;if(next>0)setWidth(next);};
  measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
 },[]);
 const height=compact?190:214;
 const geometry=useMemo(()=>sectorRotationGeometry(groups,period,highlight,width,height),[groups,period,highlight,width,height]);
 return <section className="sector-rotation" aria-labelledby="sector-rotation-title">
  <h2 id="sector-rotation-title">業種ローテーション</h2>
  <p>横 {period}営業日の相対指数 · 縦 21日の相対変化<br/>円の大きさ：ミネルヴィニ通過率</p>
  <div ref={root} className="sector-rotation-plot" style={{height}} role="img" aria-label={geometry.aria}>
    <svg width="100%" height={height} viewBox={`0 0 ${geometry.width} ${height}`} aria-hidden="true">
      <rect x={geometry.cx} y={geometry.T} width={geometry.pw/2} height={geometry.ph/2} fill="var(--zone)" opacity=".06"/>
      <rect x={geometry.L} y={geometry.cy} width={geometry.pw/2} height={geometry.ph/2} fill="var(--neg)" opacity=".06"/>
      <path d={`M${geometry.cx} ${geometry.T}V${geometry.T+geometry.ph}M${geometry.L} ${geometry.cy}H${geometry.L+geometry.pw}`} stroke="var(--line-2)" fill="none"/>
      {geometry.nodes.map(node=><circle key={node.key} data-sector={node.key} data-highlight={highlight===node.key} cx={node.x} cy={node.y} r={node.r+(highlight===node.key?2:0)} fill={ROTATION_QUADRANTS[node.q].tone} fillOpacity={highlight===node.key ? .7 : .38} stroke={highlight===node.key?'var(--text)':ROTATION_QUADRANTS[node.q].tone} strokeWidth={highlight===node.key?2:1.2} onMouseEnter={()=>onHighlight(node.key)} onMouseLeave={()=>onHighlight(null)}/>)}
    </svg>
    {geometry.quads.map(quad=><span key={quad.key} className="sector-quadrant-label" aria-hidden="true" style={{left:`${quad.x/width*100}%`,top:quad.y,color:quad.tone}}>{quad.label}</span>)}
    {geometry.labels.map(label=><span key={label.key} data-rotation-label={label.key} className={`sector-node-label${highlight===label.key?' highlighted':''}`} aria-hidden="true" style={{left:`${label.x/width*100}%`,top:label.y,width:label.w,height:label.h}}>{label.text}</span>)}
    {geometry.xTicks.map((tick,index)=><span key={tick.label} className="sector-axis-label" aria-hidden="true" style={{left:`${tick.x/width*100}%`,bottom:0,transform:index===0?'none':index===2?'translateX(-100%)':'translateX(-50%)'}}>{tick.label}</span>)}
  </div>
  <p className="sector-rotation-note">簡易版で、JdKのRS-Ratio / RS-Momentumとは計算が異なります。未確認{geometry.excluded}業種は除外し、全業種は表で確認できます。</p>
 </section>;
}
