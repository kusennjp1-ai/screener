import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { entryPlan } from '../researchEngine';
import { radarGeometry, signed, stateKey } from '../positionGeometry';
import { radarFrame, radarSelection, drawRadar, radarHit } from '../radarMarks';
import { palettes } from '../theme/tokens';

export default memo(function SetupRadar({ranked,selectedSymbol,onSelect,small=false}) {
 const container=useRef(null), paintedSelection=useRef(null);
 const points=useMemo(()=>ranked.filter(x=>x.assessment.qualified).map(({row})=>{const p=entryPlan(row,null,'minervini');return {symbol:row.symbol,distance:p.pivot?p.distance:null,rs:row.rs_rating,volume:row.se_volume_vs_50d,state:stateKey(p.state),pickable:Boolean(row.chart_path)};}),[ranked]);
 const g=useMemo(()=>radarGeometry(points,small?340:620,small?124:224),[points,small]);
 const frame=useMemo(()=>({__html:radarFrame(g,small)}),[g,small]);
 const selected=useMemo(()=>g.points.find(point=>point.symbol===selectedSymbol),[g,selectedSymbol]);
 const drawSelection=useCallback(point=>{
  const painted=paintedSelection.current;
  if ((!painted&&!point)||(painted?.geometry===g&&painted.point===point)) return;
  const {overlay,label}=radarSelection(g,point);
  const graphic=container.current.querySelector('[data-radar-selection]');
  const caption=container.current.querySelector('[data-radar-label]');
  graphic.innerHTML=overlay;caption.innerHTML=label;
  paintedSelection.current={geometry:g,point};
 },[g]);
 useLayoutEffect(()=>{
  const node=container.current,canvas=node.querySelector('[data-radar-canvas]'),context=canvas.getContext('2d');
  if(!context){canvas.setAttribute('aria-label','レーダーを描画できません。銘柄一覧から確認できます。');return undefined;}
  const themeOwner=node.closest('[data-theme]');let previous='';
  const paint=()=>{
   const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
   const width=Math.max(1,Math.round((rect.width||g.width)*ratio)),height=Math.max(1,Math.round((rect.height||g.height)*ratio));
   const mode=themeOwner?.dataset.theme||document.documentElement.dataset.theme||'dark';
   const signature=`${width}/${height}/${mode}`;if(previous===signature)return;
   canvas.width=width;canvas.height=height;context.setTransform(width/g.width,0,0,height/g.height,0,0);
   canvas.dataset.radarPointCount=String(drawRadar(context,g,palettes[mode]||palettes.dark));previous=signature;
  };
  paint();
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(paint):null;resize?.observe(canvas);
  const themes=new MutationObserver(paint);themes.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(themeOwner&&themeOwner!==document.documentElement)themes.observe(themeOwner,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('resize',paint);
  return ()=>{resize?.disconnect();themes.disconnect();window.removeEventListener('resize',paint);};
 },[g,frame]);
 useLayoutEffect(()=>{drawSelection(selected);},[frame,selected,drawSelection]);
 const eventPoint=event=>{
  const canvas=container.current.querySelector('[data-radar-canvas]');if(event.target!==canvas||!(Number(canvas.dataset.radarPointCount)>0))return null;
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  return radarHit(g.points,(event.clientX-rect.left)/rect.width*g.width,(event.clientY-rect.top)/rect.height*g.height);
 };
 const hover=event=>{
  const point=eventPoint(event),canvas=container.current.querySelector('[data-radar-canvas]');
  canvas.style.cursor=point?.pickable?'pointer':'default';canvas.title=point?`${point.symbol} · ${signed(point.distance)} · RS ${Math.round(point.rs)}${point.pickable?'':' · 詳細なし'}`:'';
  drawSelection(point||selected);
 };
 return <section ref={container} className="setup-radar" aria-label="セットアップ・レーダー" dangerouslySetInnerHTML={frame}
  onMouseMove={hover} onMouseOver={hover}
  onMouseOut={event=>{if(!event.relatedTarget?.nodeType || !event.currentTarget.contains(event.relatedTarget))drawSelection(selected);}}
  onMouseLeave={()=>drawSelection(selected)}
  onClick={event=>{const point=eventPoint(event);if(point?.pickable)onSelect(point.symbol);}}/>;
});
