import assert from 'node:assert/strict';
export const SVG_CHART_RENDERER = 'leader-svg-v1';
export const SVG_EVIDENCE_CONTRACT = 'leader-svg-provenance-v2';
// Serialized directly inside the browser; no expected values enter the DOM observation.
export function observeSvgChart(node) {
 const section=node.closest('.leader-evidence-chart'),zone=node.querySelector('[data-testid="svg-canonical-buy-zone"]'),stop=node.querySelector('[data-testid="svg-stop-example"]');
 const numeric=(el,key)=>el?.getAttribute(key)??null;
 const box=el=>{if(!el)return null;const b=el.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height};};
 const pricePane=node.querySelector('[data-pane="price"]'),clipId=pricePane?.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];
 const annotation_layout={pane:box(clipId?document.getElementById(clipId)?.querySelector('rect'):null),labels:[...node.querySelectorAll('[data-vcp-leg]')].map(leg=>({number:Number(leg.dataset.vcpLeg),box:box(leg.querySelector('[data-vcp-label-box]')),leader:leg.querySelector('[data-vcp-leader]')?.getAttribute('d')??null,anchor:leg.querySelector('circle')?{x:Number(leg.querySelector('circle').getAttribute('cx')),y:Number(leg.querySelector('circle').getAttribute('cy'))}:null}))};
 const rs_context_label=[...node.querySelectorAll('text')].map(el=>el.textContent).find(text=>text.startsWith('RS線'))??null;
 const candles=[...node.querySelectorAll('[data-pane="price"] g[data-date]')].map(el=>({date:el.dataset.date,close:Number(el.dataset.close),title:el.querySelector('title')?.textContent,geometry:[...el.querySelectorAll('line,rect')].map(shape=>Object.fromEntries([...shape.attributes].filter(a=>['x','y','x1','y1','x2','y2','width','height'].includes(a.name)).map(a=>[a.name,Number(a.value)])))}));
 return {evidence_contract:'leader-svg-provenance-v2',annotation_layout,rs_context_label,renderer:'leader-svg-v1',symbol:node.dataset.chartSymbol,as_of_date:node.dataset.chartAsof,pivot:numeric(zone,'data-pivot'),upper:numeric(zone,'data-upper'),stop:numeric(stop,'data-price'),annotation_mode:section.querySelector('button[aria-pressed][disabled]')?.textContent==='VCP注記'?'disabled':[...section.querySelectorAll('button')].find(b=>b.textContent==='VCP注記')?.getAttribute('aria-pressed')==='true'?'vcp-on':'vcp-off',moving_average_labels:[...section.querySelectorAll('.leader-svg-legend span')].map(el=>el.textContent).filter(text=>/^SMA(50|150|200) /.test(text)),panes:[...node.querySelectorAll('[data-pane]')].map(el=>el.dataset.pane),range_label:node.getAttribute('aria-label'),candles,volumes:[...node.querySelectorAll('[data-pane="volume"] rect[data-volume]')].map(el=>({value:Number(el.dataset.volume),title:el.querySelector('title')?.textContent})),rs_missing:node.querySelector('[data-pane="rs"]')?.textContent==='データなし',rs_paths:[...node.querySelectorAll('[data-pane="rs"] polyline')].map(el=>el.getAttribute('points')),date_labels:[...node.querySelectorAll('[data-chart-date-axis] text')].map(el=>el.textContent),vcp_legs:[...node.querySelectorAll('[data-vcp-leg]')].map(el=>({number:Number(el.dataset.vcpLeg),title:el.querySelector('title')?.textContent}))};
}
export function validateSvgChart(view, source, label='SVG', context) {
 assert(view.renderer===SVG_CHART_RENDERER, label+': unknown renderer');
 assert(Array.isArray(view.moving_average_labels)&&view.moving_average_labels.length===3&&[50,150,200].every(period=>view.moving_average_labels.some(text=>text.startsWith('SMA'+period+' '))),label+': missing moving-average values');
 assert(Array.isArray(source)&&source.length>0,label+': missing source bars');
 assert(source.at(-1).date===view.as_of_date,label+': source/as-of mismatch');
 assert.deepEqual(view.panes,['price','volume','rs'],label+': missing or duplicate panes');
 assert(Array.isArray(view.candles)&&view.candles.length>1,label+': missing rendered OHLC');
 assert(Array.isArray(view.volumes)&&view.volumes.length===view.candles.length,label+': missing volume observations');
 let last='';
 for (const [i,candle] of view.candles.entries()) {
  const b=source.find(b=>b.date===candle.date);assert(b&&candle.date>last,label+': unknown/reordered session');last=candle.date;
  assert([b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite),label+': invalid source rendered');
  assert(candle.close===b.close&&candle.title===`${b.date} 始値 ${b.open} 高値 ${b.high} 安値 ${b.low} 終値 ${b.close}`,label+': rendered OHLC differs from source');
  assert(Array.isArray(candle.geometry)&&candle.geometry.length===2&&candle.geometry.every(shape=>Object.values(shape).length>0&&Object.values(shape).every(Number.isFinite)),label+': invalid candle geometry');
  assert(view.volumes[i].value===b.volume&&view.volumes[i].title?.startsWith(b.date+' 出来高 '),label+': rendered volume differs from source');
 }
 assert(view.range_label===`${view.symbol} 価格・出来高・RS 共通時間軸 ${view.candles[0].date}〜${view.candles.at(-1).date}`,label+': wrong time axis range');
 assert(Array.isArray(view.date_labels)&&view.date_labels.length>=2&&view.date_labels.every(s=>/^\d{2}-\d{2}$/.test(s)),label+': missing date axis');
 assert(typeof view.rs_missing==='boolean'&&Array.isArray(view.rs_paths),label+': missing RS observation');
 assert(view.rs_missing?view.rs_paths.length===0:view.rs_paths.length>0&&view.rs_paths.every(p=>typeof p==='string'&&p.split(/[ ,]/).every(n=>n!==''&&Number.isFinite(Number(n)))),label+': RS path/unknown mismatch');
 assert(['vcp-on','vcp-off'].includes(view.annotation_mode),label+': missing annotation state');
 assert(Array.isArray(view.vcp_legs)&&view.vcp_legs.every(l=>Number.isInteger(l.number)&&l.number>0&&typeof l.title==='string'&&l.title.includes('推定')),label+': invalid VCP annotation');
 if(view.annotation_mode==='vcp-off')assert(view.vcp_legs.length===0,label+': disabled VCP still drawn');
 if(view.evidence_contract!==undefined) {
  assert(view.evidence_contract===SVG_EVIDENCE_CONTRACT,label+': unknown SVG evidence contract');
  assert(context&&Object.hasOwn(context,'benchmark_symbol'),label+': missing original RS source context');
  const known=typeof context.benchmark_symbol==='string'&&context.benchmark_symbol.trim().length>0;
  assert(view.rs_context_label===(known?`RS線 · ${context.benchmark_symbol}（RS順位とは別）`:'RS線の比較対象が未確認（データなし）'),label+': RS comparison source/reason mismatch');
  if(!known)assert(view.rs_missing&&view.rs_paths.length===0,label+': unknown RS benchmark was plotted');
  const layout=view.annotation_layout,pane=layout?.pane;
  const validBox=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;
  assert(validBox(pane)&&Array.isArray(layout.labels),label+': missing measured annotation pane');
  assert.deepEqual(layout.labels.map(l=>l.number),view.vcp_legs.map(l=>l.number),label+': VCP labels do not match actual legs');
  for(const [i,item] of layout.labels.entries()) {
   const b=item.box;assert(validBox(b),label+': missing VCP label rectangle');
   assert(b.x>=pane.x&&b.y>=pane.y&&b.x+b.width<=pane.x+pane.width&&b.y+b.height<=pane.y+pane.height,label+': VCP label outside price pane');
   for(const other of layout.labels.slice(0,i)){const a=other.box;assert(b.x>=a.x+a.width||a.x>=b.x+b.width||b.y>=a.y+a.height||a.y>=b.y+b.height,label+': VCP labels overlap');}
   const coordinates=typeof item.leader==='string'?item.leader.match(/^M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)$/):null;
   assert(coordinates&&coordinates.slice(1).every(n=>Number.isFinite(Number(n)))&&item.anchor&&Number.isFinite(item.anchor.x)&&Number.isFinite(item.anchor.y),label+': missing VCP leader/anchor');
   const [,x,y,endX,endY]=coordinates.map(Number);
   assert(endX===item.anchor.x&&endY===item.anchor.y,label+': VCP leader misses its actual low');
   assert((x===b.x||x===b.x+b.width)&&y>=b.y&&y<=b.y+b.height,label+': VCP leader is not attached to label');
  }
 }
 return true;
}
