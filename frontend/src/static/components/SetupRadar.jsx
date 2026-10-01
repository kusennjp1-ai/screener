import { memo, useMemo, useState } from 'react';
import { entryPlan } from '../researchEngine';
import { radarGeometry, signed, stateKey } from '../positionGeometry';
import { radarPlot } from '../radarMarks';
export default memo(function SetupRadar({ranked,selectedSymbol,onSelect,small=false}) {
 const [hover,setHover]=useState(null);
 const points=useMemo(()=>ranked.filter(x=>x.assessment.qualified).map(({row})=>{const p=entryPlan(row,null,'minervini');return {symbol:row.symbol,distance:p.pivot?p.distance:null,rs:row.rs_rating,volume:row.se_volume_vs_50d,state:stateKey(p.state),pickable:Boolean(row.chart_path)};}),[ranked]);
 const g=useMemo(()=>radarGeometry(points,small?340:620,small?124:224),[points,small]);
 const marks=useMemo(()=>({__html:radarPlot(g)}),[g]);
 const eventPoint=event=>{const node=event.target.closest?.('[data-radar-point]');return node?g.points[Number(node.dataset.radarPoint)]:null;};
 const active=g.points.find(p=>p.symbol===(hover||selectedSymbol));
 const percent=(v,size)=>`${v/size*100}%`;
 return <section className="setup-radar" aria-label="セットアップ・レーダー">
  <header><strong>セットアップ・レーダー</strong><span>横：ピボット比 · 縦：RS推計</span></header>
  <div className="radar-plot" style={{aspectRatio:`${g.width}/${g.height}`}}>
   <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`ミネルヴィニ条件通過のうち有効なピボットがある${g.points.length}銘柄。点の大きさは出来高比。銘柄一覧でも選択できます。`} onMouseOver={event=>setHover(eventPoint(event)?.symbol||null)} onMouseOut={event=>{if(!event.relatedTarget?.nodeType || !event.currentTarget.contains(event.relatedTarget))setHover(null);}} onMouseLeave={()=>setHover(null)} onClick={event=>{const point=eventPoint(event);if(point?.pickable)onSelect(point.symbol);}}>
    <g data-radar-marks dangerouslySetInnerHTML={marks}/>
    {active&&<><path d={`M${active.x} ${g.top}V${g.top+g.ph}M${g.left} ${active.y}H${g.left+g.pw}`} stroke="var(--accent)" strokeDasharray="3 4" opacity=".5"/><circle cx={active.x} cy={active.y} r={active.radius+5} fill="none" stroke="var(--accent)"/></>}
    <path d={`M${g.x(10)-3} ${g.top+g.ph+4}l3 -8m1 8l3 -8`} stroke="var(--text-3)"/>
   </svg>
   {[-15,-10,-5,0,5,10,25].filter(n=>!small||[-15,0,5,25].includes(n)).map(n=><span className="radar-x mono" key={n} style={{left:percent(g.x(n),g.width),top:percent(g.top+g.ph+5,g.height)}}>{n===0?'0%':signed(n,0)}</span>)}
   {[70,80,90,100].map(n=><span className="radar-y mono" key={n} style={{left:percent(g.left-6,g.width),top:percent(g.y(n),g.height)}}>{n}</span>)}
   <span className="radar-zone-label" style={{left:percent((g.x(0)+g.x(5))/2,g.width)}}>買いゾーン</span>
   {active&&<span className="radar-point-label" style={{left:percent(active.x,g.width),top:percent(active.y,g.height),transform:active.x>g.left+g.pw*.72?'translate(calc(-100% - 12px),-50%)':'translate(12px,-50%)'}}><b>{active.symbol}</b><small>{signed(active.distance)} · RS {Math.round(active.rs)}{!active.pickable?' · 詳細なし':''}</small></span>}
  </div>
  <footer><span>◔ ピボット待ち</span><span>● ゾーン内</span><span>▲ 超過</span><span>+10%以降は圧縮</span></footer>
 </section>;
});
