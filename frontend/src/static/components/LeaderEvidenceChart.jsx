import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ChartSetupEvidence from './ChartSetupEvidence';
import MetricDisclosure from './MetricDisclosure';
import RsRatingHistory from './RsRatingHistory';
import { leaderChartModel, seriesPaths } from './leaderChartModel';
import { relativeStrengthScale, researchVolumeBars } from '../../components/Charts/researchChartModel';
import { buildBookTechnicalEvidence, BOOK_TECHNICAL_VERSION } from '../bookTechnicalEvidence';
import { formatPrice } from '../positionGeometry';
import './leaderEvidenceChart.css';

const finite = Number.isFinite;
const positive = n => finite(n) && n > 0;
// One chart renders hundreds of volume tooltips. Reuse the immutable locale
// formatter instead of constructing one for every bar and every interaction.
const quantityFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
const quantity = n => finite(n) ? quantityFormatter.format(n) : 'データなし';
const ranges = [['1か月',21],['3か月',63],['6か月',126],['1年',252]];
const precedingDailyMean = bars => bars.length >= 51 ? bars.slice(-51,-1).reduce((sum,bar)=>sum+bar.volume,0)/50 : null;
export default function LeaderEvidenceChart(props) {
  // A publication/symbol switch cannot retain an old viewport or annotation.
  return <EvidenceSurface key={`${props.chartIdentity || `${props.symbol}:${props.date}:${props.generation || ''}`}:${props.comparisonSessions || ''}`} {...props}/>;
}
function EvidenceSurface({ symbol, date, priceData = [], rsLineData = [], benchmarkSymbol,
  row, payload, technicalEvidence, pivotPrice, buyCeiling, stopPrice, smallScreen = false,
  compact = false, expanded = false, compactResearchChrome = false, comparisonSessions, researchActions, onExpand, height = 440, rsRatingValue, view = 'all', onShowChart }) {
  const id = useId().replace(/:/g, ''), [timeframe,setTimeframe] = useState('daily');
  const [count,setCount] = useState(comparisonSessions || 252), [offset,setOffset] = useState(0);
  const [annotations,setAnnotations] = useState(false);
  const plotRef = useRef(null);
  const dragRef = useRef(null);
  const [measuredWidth, setMeasuredWidth] = useState(null);
  const [selectedLeg, setSelectedLeg] = useState(null);
  const model = useMemo(() => leaderChartModel({bars:priceData,symbol,date,rsLine:rsLineData,timeframe}), [priceData,symbol,date,rsLineData,timeframe]);
  useLayoutEffect(()=>{
    const plot=plotRef.current;
    if(!plot)return undefined;
    const measure=()=>{const width=plot.getBoundingClientRect().width;if(width>0)setMeasuredWidth(width);};
    measure();
    if(typeof ResizeObserver==='undefined')return undefined;
    const observer=new ResizeObserver(measure);observer.observe(plot);
    return ()=>observer.disconnect();
  },[smallScreen,model.error,view]);
  useEffect(()=>{
    const plot=plotRef.current;
    if(!plot||compact)return undefined;
    // Horizontal wheel motion pans; an ordinary vertical wheel always scrolls
    // the page. Explicit non-passive listener only cancels horizontal gestures.
    const wheel=event=>{
      if(event.ctrlKey||event.metaKey||Math.abs(event.deltaX)<=Math.abs(event.deltaY))return;
      const maximum=Math.max(0,(model.candlesticks?.length||0)-count);
      if(!maximum)return;
      event.preventDefault();
      const pixels=event.deltaX*(event.deltaMode===1?16:event.deltaMode===2?plot.clientWidth:1);
      setOffset(value=>Math.max(0,Math.min(maximum,Math.min(value,maximum)-Math.round(pixels*count/Math.max(1,plot.clientWidth-60)))));
    };
    plot.addEventListener('wheel',wheel,{passive:false});
    return()=>plot.removeEventListener('wheel',wheel);
  },[compact,count,model,view]);
  const evidence = useMemo(() => {
    const existing = technicalEvidence || row?.book_technical_evidence;
    if (existing?.version === BOOK_TECHNICAL_VERSION && existing.valid === true && existing.symbol === symbol && existing.as_of_date === date) return existing;
    if (!payload || !row || row.symbol !== symbol || payload.symbol !== symbol || payload.as_of_date !== date) return null;
    return buildBookTechnicalEvidence(row,payload,date);
  },[technicalEvidence,row,payload,symbol,date]);
  if (model.error) return <div className="leader-svg-warning" role="alert">チャート：データなし。{model.error}</div>;
  const all=model.candlesticks,maxOffset=Math.max(0,all.length-count),boundedOffset=Math.min(offset,maxOffset),end=all.length-boundedOffset,start=Math.max(0,end-count),bars=all.slice(start,end);
  const width=measuredWidth||(smallScreen?360:compact?440:760),left=8,right=smallScreen?55:62,plotWidth=width-left-right;
  const chartHeight=compact||expanded?height:smallScreen?Math.max(280,Math.min(height,360)):Math.max(390,Math.min(height,560)),dense=compact||chartHeight<390;
  const priceTop=26,priceBottom=chartHeight*(compact?.45:dense?.5:.55),volumeTop=priceBottom+(dense?22:34),volumeBottom=chartHeight*(compact?.66:dense?.72:.75),rsTop=volumeBottom+(dense?22:32),rsBottom=chartHeight-32;
  const x=index=>left+(index+.5)/bars.length*plotWidth,candleWidth=Math.max(.8,Math.min(7,plotWidth/bars.length*.65));
  const visibleDates=new Set(bars.map(bar=>bar.time));
  const shown=points=>points.filter(point=>visibleDates.has(point.time));
  const safeLevels=!model.warning&&positive(pivotPrice)&&positive(buyCeiling)&&buyCeiling>=pivotPrice;
  const prices=bars.flatMap(bar=>[bar.low,bar.high]);
  for(const points of [model.sma50,model.sma150,model.sma200])for(const point of shown(points))prices.push(point.value);
  if(safeLevels)prices.push(pivotPrice,buyCeiling);
  if(!model.warning&&positive(stopPrice))prices.push(stopPrice);
  const min=Math.min(...prices),max=Math.max(...prices),pad=Math.max((Math.log(max)-Math.log(min))*.08,.001);
  const low=Math.log(min)-pad,high=Math.log(max)+pad,yPrice=value=>priceBottom-(Math.log(value)-low)/(high-low)*(priceBottom-priceTop);
  const volume=shown(researchVolumeBars(model.volume,timeframe==='weekly'?10:50,{vol:'var(--text-3)','vol-hi':'var(--zone)'})),means=shown(model.volumeMean),maxVolume=Math.max(1,...volume.map(point=>point.value),...means.map(point=>point.value)),yVolume=value=>volumeBottom-value/maxVolume*(volumeBottom-volumeTop);
  const benchmarkKnown=typeof benchmarkSymbol==='string'&&benchmarkSymbol.trim().length>0;
  const rs=benchmarkKnown?shown(model.rs):[],rsScale=relativeStrengthScale(rs)?.priceRange,yRs=value=>rsBottom-(value-rsScale.minValue)/(rsScale.maxValue-rsScale.minValue)*(rsBottom-rsTop);
  const latest=all.at(-1),latestMean=model.volumeMean.at(-1),vcp=evidence?.valid&&!model.warning?evidence.vcp:null;
  const legs=Array.isArray(vcp?.legs)?vcp.legs:[],datedLegs=legs.map((leg,index)=>({...leg,number:index+1})).filter(leg=>finite(leg.depthPct)&&positive(leg.high)&&positive(leg.low)&&leg.startDate&&leg.endDate);
  // The lab and SVG share the exact measured intervals. No second detector.
  const labAnnotations = {candidate:vcp?.measurementsValid === true && vcp?.depthsContract === true,
    legs:datedLegs.map(leg=>({start:leg.startDate,end:leg.endDate,high:leg.high,low:leg.low,depthPct:leg.depthPct,volume:leg.averageVolume})),
    summary:'有効な測定区間がありません。',boxes:[]};
  const focusLeg = leg => {
    const first=all.findIndex(bar=>bar.time===leg.start),last=all.findIndex(bar=>bar.time===leg.end);
    if(first<0||last<first)return;
    const from=Math.max(0,first-3),to=Math.min(all.length,last+4);
    setAnnotations(true);setSelectedLeg(`${leg.start}/${leg.end}`);setCount(to-from);setOffset(all.length-to);
    onShowChart?.();
    requestAnimationFrame(()=>plotRef.current?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'}));
  };
  const visibleLegs=timeframe==='daily'&&annotations?datedLegs.filter(leg=>leg.endDate>=bars[0].time&&leg.startDate<=bars.at(-1).time).slice(-3):[];
  // Keep text out of the candles. Detailed mode adds measured lines only;
  // the touch targets sit above the plot, visible before any long-chart scroll.
  const anchoredLegs=visibleLegs.map(leg=>({...leg,peak:bars.findIndex(bar=>bar.time===leg.peakDate),bottom:bars.findIndex(bar=>bar.time===leg.lowDate)})).filter(leg=>leg.peak>=0&&leg.bottom>=0);
  const intervalText=timeframe==='weekly'?'週足（10/30/40週線・直前10週出来高平均）':'日足（50/150/200日線・直前50日出来高平均）';
  const range=countValue=>{setCount(Math.max(2,timeframe==='weekly'?Math.ceil(countValue/5):countValue));setOffset(0);setSelectedLeg(null);};
  const shift=direction=>setOffset(value=>Math.max(0,Math.min(maxOffset,Math.min(value,maxOffset)+direction*Math.max(1,Math.floor(count/3)))));
  const zoom=factor=>setCount(value=>Math.max(5,Math.min(all.length,Math.round(value*factor))));
  const clearDrag=()=>{dragRef.current=null;};
  const pointerDown=event=>{
    if(compact||event.isPrimary===false||event.button!==0)return;
    dragRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,offset:boundedOffset,horizontal:false};
  };
  const pointerMove=event=>{
    const drag=dragRef.current;if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.horizontal){
      if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){clearDrag();return;}
      if(Math.abs(dx)<8||Math.abs(dx)<=Math.abs(dy))return;
      drag.horizontal=true;
      // Capture only after horizontal intent. Vertical scroll / pinch remain
      // native through touch-action: pan-y pinch-zoom (MDN Pointer Events).
      // https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setOffset(Math.max(0,Math.min(maxOffset,drag.offset+Math.round(dx*bars.length/plotWidth))));
  };
  const dailyVolumeMean=precedingDailyMean(priceData);
  const dailyVolume=priceData.at(-1)?.volume;
  const volumeRatio=!model.warning&&dailyVolumeMean>0&&finite(dailyVolume)?dailyVolume/dailyVolumeMean:null;
  const paths=(points,y,color,key,dash)=>seriesPaths(points,bars,x,y).map((points,index)=><polyline key={`${key}-${index}`} data-series={key} points={points} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={dash} vectorEffect="non-scaling-stroke"/>);
  // Comparison plots remain direct children of their fixed-height section.
  // Only the full detail chart needs a wrapper for its chart/VCP tab visibility.
  const ChartSurface=compact?Fragment:'div';
  const detailLegends=<><div className="leader-svg-legend"><span>共通ピボット {positive(pivotPrice)&&!model.warning?formatPrice(pivotPrice):'データなし'}</span><span>買い上限 {safeLevels?formatPrice(buyCeiling):'データなし'}</span><span>損切り例 {!model.warning&&positive(stopPrice)?formatPrice(stopPrice):'データなし'}</span><span>直前{timeframe==='weekly'?'10週':'50日'}平均出来高 {quantity(latestMean?.value)}</span></div>
    <div className="leader-svg-legend">{[[50,model.sma50],[150,model.sma150],[200,model.sma200]].map(([period,points])=><span key={period}>SMA{timeframe==='weekly'?period/5:period} {positive(points.at(-1)?.value)?formatPrice(points.at(-1).value):'データなし'}</span>)}</div></>;
  return <section style={compact?{height,display:'flex',flexDirection:'column'}:undefined} className={`leader-evidence-chart${expanded?' leader-evidence-expanded':''}${compactResearchChrome?' leader-evidence-short':''}`} aria-label={`${symbol} SVG価格・出来高・RSチャート`}>
    <ChartSurface {...(compact?{}:{className:'leader-chart-surface',hidden:view==='setup'})}>
    {!compact&&<span className="sr-only" data-testid="chart-visible-range">{bars[0].time} ～ {bars.at(-1).time}</span>}
    {!compact&&<div className="leader-svg-controls" role="group" aria-label="チャートの表示操作">
      {['daily','weekly'].map(value=><button key={value} type="button" aria-pressed={timeframe===value} onClick={()=>{setTimeframe(value);setCount(value==='weekly'?51:252);setOffset(0);setSelectedLeg(null);}}>{value==='daily'?'日足':'週足'}</button>)}
      {smallScreen?<select aria-label="表示期間" value={offset===0?(ranges.find(([,value])=>count===(timeframe==='weekly'?Math.ceil(value/5):value))?.[1]??''):''} onChange={event=>range(Number(event.target.value))}>
        <option value="" disabled>任意期間</option>{ranges.map(([label,value])=><option key={value} value={value}>{label}</option>)}
      </select>:ranges.map(([label,value])=><button key={label} type="button" onClick={()=>range(value)}>{label}</button>)}
      <div className="leader-svg-extra-controls" style={!smallScreen?{display:'contents'}:undefined}>
      <details open={smallScreen?undefined:true}>
      <summary hidden={!smallScreen}>操作</summary>
      <button type="button" aria-label="表示期間を拡大" onClick={()=>zoom(.7)}>＋</button><button type="button" aria-label="表示期間を縮小" onClick={()=>zoom(1.4)}>−</button>
      <button type="button" aria-label="過去の期間へ" disabled={start===0} onClick={()=>shift(1)}>←</button><button type="button" aria-label="新しい期間へ" disabled={boundedOffset===0} onClick={()=>shift(-1)}>→</button>
      <button type="button" onClick={()=>{setCount(timeframe==='weekly'?51:252);setOffset(0);setSelectedLeg(null);}}>リセット</button>
      <button type="button" aria-pressed={annotations} disabled={timeframe!=='daily'} onClick={()=>setAnnotations(value=>!value)}>VCP注記</button>
      </details></div>
      {researchActions}{onExpand&&<button type="button" onClick={onExpand} aria-label="日次チャートを分析">拡大 ↗</button>}
    </div>}
    {!compact&&<p className={`leader-svg-caption${smallScreen?' leader-svg-caption-mobile':''}`}>{smallScreen?<span>期間 {bars[0].time}〜{bars.at(-1).time} · 左右スワイプ</span>:<>{symbol} · {intervalText} · 最終バー {latest.time} 終値 {formatPrice(latest.close)}。期間 {bars[0].time}〜{bars.at(-1).time}</>}</p>}
      {!compact&&anchoredLegs.length>0&&<div className="chart-vcp-intervals" aria-label="表示中のVCP推定区間">{anchoredLegs.map(leg=><button key={leg.number} type="button" data-vcp-interval={leg.number} aria-pressed={selectedLeg===`${leg.startDate}/${leg.endDate}`} aria-label={`C${leg.number} ${leg.startDate}から${leg.endDate}、深さ${leg.depthPct.toFixed(1)}%を拡大`} onClick={()=>focusLeg({start:leg.startDate,end:leg.endDate})}>C{leg.number} <strong>{leg.depthPct.toFixed(1)}%</strong></button>)}</div>}
    {model.warning&&<p role="status" className="leader-svg-warning">{model.warning} 買い帯とVCP注記は保留しています。</p>}
    <svg ref={plotRef} data-chart-plot data-chart-symbol={symbol} data-chart-asof={date} data-chart-annotation-mode={annotations?'detail':'simple'} style={compact?{height,width:'100%',flex:'1 1 0',minHeight:0}:expanded?{height,width:'100%'}:undefined} preserveAspectRatio={compact||expanded?'none':undefined} viewBox={`0 0 ${width} ${chartHeight}`} role="img" aria-label={`${symbol} 価格・出来高・RS 共通時間軸 ${bars[0].time}〜${bars.at(-1).time}`} tabIndex={compact?undefined:0}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={clearDrag} onPointerCancel={clearDrag} onLostPointerCapture={clearDrag}
      onKeyDown={event=>{if(event.key==='ArrowLeft'){event.preventDefault();shift(1);}if(event.key==='ArrowRight'){event.preventDefault();shift(-1);}if(event.key==='+'){event.preventDefault();zoom(.7);}if(event.key==='-'){event.preventDefault();zoom(1.4);}}}>
      <title>{symbol} 実データのSVGチャート。上から価格、出来高、RS線。買い帯は共通ピボットと方式別上限のみ。</title>
      <defs><clipPath id={`${id}-price`}><rect x={left} y={priceTop} width={plotWidth} height={priceBottom-priceTop}/></clipPath></defs>
      {[priceBottom,volumeBottom,rsBottom].map(y=><line key={y} x1={left} x2={width} y1={y} y2={y} stroke="var(--line)"/>)}
      {[0,.5,1].map(t=>{const value=Math.exp(low+t*(high-low)),y=yPrice(value);return <g key={t}><line x1={left} x2={width-right} y1={y} y2={y} stroke="var(--line)" opacity=".5"/><text x={width-right+5} y={y+4} fill="var(--text-2)" fontSize="11">{formatPrice(value)}</text></g>;})}
      <text x={left} y={16} fill="var(--text)" fontSize="12">価格 · 対数軸</text>
      <g clipPath={`url(#${id}-price)`} data-pane="price">
        {safeLevels&&<g data-testid="svg-canonical-buy-zone" data-pivot={pivotPrice} data-upper={buyCeiling}><rect x={left} y={yPrice(buyCeiling)} width={plotWidth} height={yPrice(pivotPrice)-yPrice(buyCeiling)} fill="var(--zone-fill)"/><line x1={left} x2={width-right} y1={yPrice(pivotPrice)} y2={yPrice(pivotPrice)} stroke="var(--zone)" strokeDasharray="5 3"/><line x1={left} x2={width-right} y1={yPrice(buyCeiling)} y2={yPrice(buyCeiling)} stroke="var(--zone)"/></g>}
        {!model.warning&&positive(stopPrice)&&<line data-testid="svg-stop-example" data-price={stopPrice} x1={left} x2={width-right} y1={yPrice(stopPrice)} y2={yPrice(stopPrice)} stroke="var(--neg)" strokeDasharray="4 3"/>}
        {paths(model.sma50,yPrice,'var(--accent)','sma50')}{paths(model.sma150,yPrice,'var(--text-3)','sma150','5 3')}{paths(model.sma200,yPrice,'var(--wait)','sma200','2 3')}
        {bars.map((bar,index)=>{const up=bar.close>=bar.open,color=up?'var(--zone)':'var(--neg)';return <g key={bar.time} data-date={bar.time} data-close={bar.close}><title>{bar.time} 始値 {bar.open} 高値 {bar.high} 安値 {bar.low} 終値 {bar.close}</title><line x1={x(index)} x2={x(index)} y1={yPrice(bar.high)} y2={yPrice(bar.low)} stroke={color}/><rect x={x(index)-candleWidth/2} y={yPrice(Math.max(bar.open,bar.close))} width={candleWidth} height={Math.max(.8,Math.abs(yPrice(bar.open)-yPrice(bar.close)))} fill={color}/></g>;})}
        {anchoredLegs.map(leg=>{
          const anchorX=x(leg.bottom),anchorY=yPrice(leg.low);
          return <g key={leg.number} data-vcp-leg={leg.number} data-selected={selectedLeg===`${leg.startDate}/${leg.endDate}`} data-vcp-peak-date={leg.peakDate} data-vcp-low-date={leg.lowDate} data-vcp-high={leg.high} data-vcp-low={leg.low}>
            <title>{`C${leg.number} 推定 ${leg.startDate}〜${leg.endDate} 深さ ${leg.depthPct}%`}</title>
            <path data-vcp-leader={leg.number} d={`M${x(leg.peak)} ${yPrice(leg.high)}L${anchorX} ${anchorY}`} fill="none" stroke="var(--ext)" strokeDasharray="4 3"/>
            <circle cx={anchorX} cy={anchorY} r="2" fill="var(--ext)"/>
          </g>;
        })}
      </g>
      <text x={left} y={volumeTop-10} fill="var(--text)" fontSize="12">出来高 · 破線は直前{timeframe==='weekly'?'10週':'50日'}平均</text>
      <g data-pane="volume">{volume.map((point,index)=><rect key={point.time} data-volume={point.value} x={x(index)-candleWidth/2} y={yVolume(point.value)} width={candleWidth} height={volumeBottom-yVolume(point.value)} fill={point.color}><title>{point.time} 出来高 {quantity(point.value)}</title></rect>)}{paths(model.volumeMean,yVolume,'var(--text)','volume-mean','4 3')}</g>
      {!means.length&&<text x={left} y={volumeTop+15} fill="var(--text-2)" fontSize="11">平均：データなし</text>}
      <text x={left} y={rsTop-10} fill="var(--text)" fontSize="12">{benchmarkKnown?`RS線 · ${benchmarkSymbol}（RS順位とは別）`:'RS線の比較対象が未確認（データなし）'}</text>
      <g data-pane="rs">{rsScale?paths(model.rs,yRs,'var(--accent)','rs'):<text x={left} y={rsTop+18} fill="var(--text-2)" fontSize="12">データなし</text>}</g>
      <g data-chart-date-axis>
        <rect x={0} y={chartHeight-24} width={width} height={24} fill="var(--panel)"/>
        <line x1={0} x2={width} y1={chartHeight-24} y2={chartHeight-24} stroke="var(--line)"/>
        {[0,Math.floor((bars.length-1)/2),bars.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(index=><text key={index} x={x(index)} y={chartHeight-7} textAnchor={index===0?'start':index===bars.length-1?'end':'middle'} fill="var(--text-2)" fontSize="11">{bars[index].time.slice(5)}</text>)}
      </g>
    </svg>
    {!compact&&<>
      <div className="chart-scroll-control"><span>← 過去</span><input aria-label="チャートの表示位置" type="range" min="0" max={maxOffset} value={maxOffset-boundedOffset} disabled={!maxOffset} onChange={event=>setOffset(maxOffset-Number(event.target.value))}/><span>最新 →</span></div>
      <div className="chart-snapshot-metrics">
        <RsRatingHistory history={payload?.rs_rating_history} symbol={symbol} date={date} current={row?.rs_rating??rsRatingValue}/>
        <MetricDisclosure className="chart-volume-ratio" summary={<span className="rs-rating-summary"><span>出来高 / 50日平均 <small>{date} · 最新配信日足</small></span><strong>{finite(volumeRatio)?volumeRatio.toFixed(2):'—'}<small> 倍</small></strong></span>}><p>出来高比＝{date}の出来高 ÷ 直前50営業日の平均出来高。当日は平均から除外します。1倍なら平均と同じ、2倍なら2倍の取引量、0.5倍なら半分です。</p><p>この公開データの分析日 {date} に確定した日足です。今日のリアルタイム出来高ではありません。RSの対象日やチャートの表示期間を変えても、この値の対象日は変わりません。</p><p>当日 {quantity(dailyVolume)}株 ／ 直前50日平均 {quantity(dailyVolumeMean)}株。出来高だけでは上昇・下落や購入可否は決まりません。VCPの「区間平均出来高」は収縮区間同士の比較で、別の比率です。</p></MetricDisclosure>
      </div>
      <MetricDisclosure summary="チャートの操作・線の見方"><p>最終バー {latest.time} 終値 {formatPrice(latest.close)}。左右スワイプ・横スクロール・方向キーで過去と最新へ移動。期間ボタンと＋/−で拡大縮小。1年は252営業日、週足は51本が目安で、配信済みの範囲だけ表示します。</p><p>{intervalText}。RS線は株価÷{benchmarkSymbol||'比較対象未確認'}価格。RS順位とは異なります。VCPは既存アルゴリズムの推定区間で、合格・買い指示ではありません。共通ピボットと収縮高値は別です。</p>{view==='chart'&&detailLegends}</MetricDisclosure>
    </>}
    </ChartSurface>
    {!compact && view!=='chart' && <ChartSetupEvidence measured annotations={labAnnotations} symbol={symbol} date={date}
      warning={model.warning} daily={timeframe==='daily'} detailed={annotations} selectedLeg={selectedLeg}
      onToggle={()=>setAnnotations(value=>!value)} onFocus={focusLeg}/>}
    {!compact&&view==='all'&&<>{detailLegends}
      <details className="leader-vcp-table"><summary>VCPの期間・深さ・出来高を確認</summary>{datedLegs.length?<table><caption>全収縮区間（推定）。図は表示期間内の直近最大3区間のみ。</caption><thead><tr><th>区間</th><th>期間</th><th>深さ</th><th>最終出来高/直前50日</th></tr></thead><tbody>{datedLegs.map(leg=><tr key={leg.number}><td>C{leg.number}</td><td>{leg.startDate}〜{leg.endDate}<br/>{leg.sessions}営業日</td><td>{leg.depthPct.toFixed(2)}%</td><td>{finite(leg.volumeEvidence?.lastRatio)?`${leg.volumeEvidence.lastRatio.toFixed(2)}倍`:'データなし'}</td></tr>)}</tbody></table>:<p>データなし。収縮区間を作り足しません。</p>}</details></>}
  </section>;
}
