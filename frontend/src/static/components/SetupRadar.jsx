import { PureComponent } from 'react';
import { entryPlan } from '../researchEngine';
import { radarGeometry, signed, stateKey } from '../positionGeometry';
import { radarFrame, radarSelection, drawRadar, radarHit } from '../radarMarks';
import { palettes } from '../theme/tokens';

// The canvas has an imperative lifecycle. Keep its one immutable publication
// frame and observers on the instance; selection updates never redraw points.
export default class SetupRadar extends PureComponent {
 paintedSelection=null;
 setContainer=node=>{this.container=node;};
 componentDidMount(){this.mountCanvas();this.drawSelected();}
 componentDidUpdate(){
  if(this.mountedGeometry!==this.geometry){this.stopPainting?.();this.mountCanvas();}
  this.drawSelected();
 }
 componentWillUnmount(){this.stopPainting?.();}
 drawSelected=()=>this.drawSelection(this.canvasAvailable&&this.props.selectedSymbol?this.mountedGeometry.points.find(point=>point.symbol===this.props.selectedSymbol):null);
 drawSelection(point){
  const g=this.mountedGeometry,painted=this.paintedSelection;
  if((!painted&&!point)||(painted?.geometry===g&&painted.point===point))return;
  const {overlay,label}=radarSelection(g,point);
  this.container.querySelector('[data-radar-selection]').innerHTML=overlay;
  this.container.querySelector('[data-radar-label]').innerHTML=label;
  this.paintedSelection={geometry:g,point};
 }
 mountCanvas(){
  const g=this.geometry,node=this.container,canvas=node.querySelector('[data-radar-canvas]'),context=canvas.getContext('2d');
  this.mountedGeometry=g;this.canvasAvailable=Boolean(context);
  if(!context){canvas.setAttribute('aria-label','レーダーを描画できません。銘柄一覧から確認できます。');return;}
  const themeOwner=node.closest('[data-theme]'),hasResizeObserver=typeof ResizeObserver==='function';let previous='';
  // Draw the full logical plot synchronously, without forcing layout in React's
  // commit. ResizeObserver delivers the real CSS box before browser paint; its
  // contentRect avoids another layout read on every resize/theme notification.
  let size=hasResizeObserver?{width:g.width,height:g.height}:canvas.getBoundingClientRect();
  const paint=()=>{
   const ratio=window.devicePixelRatio||1;
   const width=Math.max(1,Math.round((size.width||g.width)*ratio)),height=Math.max(1,Math.round((size.height||g.height)*ratio));
   const mode=themeOwner?.dataset.theme||document.documentElement.dataset.theme||'dark';
   const signature=`${width}/${height}/${mode}`;if(previous===signature)return;
   // Unchanged dimensions must not discard/reallocate the backing store.
   if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
   context.setTransform(width/g.width,0,0,height/g.height,0,0);
   canvas.dataset.radarPointCount=String(drawRadar(context,g,palettes[mode]||palettes.dark));previous=signature;
  };
  paint();
  const resize=hasResizeObserver?new ResizeObserver(entries=>{
   const box=entries.find(entry=>entry.target===canvas)?.contentRect;
   if(!box||!Number.isFinite(box.width)||!Number.isFinite(box.height)||box.width<=0||box.height<=0)return;
   size=box;paint();
  }):null;resize?.observe(canvas);
  const themes=new MutationObserver(paint);themes.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(themeOwner&&themeOwner!==document.documentElement)themes.observe(themeOwner,{attributes:true,attributeFilter:['data-theme']});
  const windowResize=()=>{if(!hasResizeObserver)size=canvas.getBoundingClientRect();paint();};
  window.addEventListener('resize',windowResize);
  this.stopPainting=()=>{resize?.disconnect();themes.disconnect();window.removeEventListener('resize',windowResize);};
 }
 eventPoint(event){
  const canvas=this.container.querySelector('[data-radar-canvas]'),g=this.mountedGeometry;if(event.target!==canvas||!(Number(canvas.dataset.radarPointCount)>0))return null;
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  return radarHit(g.points,(event.clientX-rect.left)/rect.width*g.width,(event.clientY-rect.top)/rect.height*g.height);
 }
 hover=event=>{
  const point=this.eventPoint(event),canvas=this.container.querySelector('[data-radar-canvas]');
  canvas.style.cursor=point?.pickable?'pointer':'default';canvas.title=point?`${point.symbol} · ${signed(point.distance)} · RS ${Math.round(point.rs)}${point.pickable?'':' · 詳細なし'}`:'';
  if(point)this.drawSelection(point);else this.drawSelected();
 };
 leave=event=>{if(!event.relatedTarget?.nodeType||!event.currentTarget.contains(event.relatedTarget))this.drawSelected();};
 select=event=>{const point=this.eventPoint(event);if(point?.pickable)this.props.onSelect(point.symbol);};
 render(){
  const {ranked,small=false}=this.props;
  if(!this.geometry||ranked!==this.ranked||small!==this.small){
   const points=ranked.filter(item=>item.assessment.qualified).map(({row})=>{const plan=entryPlan(row,null,'minervini');return {symbol:row.symbol,distance:plan.pivot?plan.distance:null,rs:row.rs_rating,volume:row.se_volume_vs_50d,state:stateKey(plan.state),pickable:Boolean(row.chart_path)};});
   this.geometry=radarGeometry(points,small?340:620,small?124:224);this.frame={__html:radarFrame(this.geometry,small)};this.ranked=ranked;this.small=small;
  }
  return <section ref={this.setContainer} className="setup-radar" aria-label="セットアップ・レーダー" dangerouslySetInnerHTML={this.frame}
   onMouseMove={this.hover} onMouseOver={this.hover} onMouseOut={this.leave} onMouseLeave={this.drawSelected} onClick={this.select}/>;
 }
}
