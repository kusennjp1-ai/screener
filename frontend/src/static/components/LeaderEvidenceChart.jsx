import { useId, useMemo, useState } from 'react';
import { leaderChartModel, seriesPaths } from './leaderChartModel';
import { relativeStrengthScale, researchVolumeBars } from '../../components/Charts/researchChartModel';
import { buildBookTechnicalEvidence, BOOK_TECHNICAL_VERSION } from '../bookTechnicalEvidence';
import { formatPrice } from '../positionGeometry';
import './leaderEvidenceChart.css';

const finite = Number.isFinite;
const positive = n => finite(n) && n > 0;
const quantity = n => finite(n) ? new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(n) : 'データなし';
const ranges = [['1か月',21],['3か月',63],['6か月',126],['1年',252]];
export default function LeaderEvidenceChart(props) {
  // A publication/symbol switch cannot retain an old viewport or annotation.
  return <EvidenceSurface key={`${props.chartIdentity || `${props.symbol}:${props.date}:${props.generation || ''}`}:${props.comparisonSessions || ''}`} {...props}/>;
}
function EvidenceSurface({ symbol, date, priceData = [], rsLineData = [], benchmarkSymbol,
  row, payload, technicalEvidence, pivotPrice, buyCeiling, stopPrice, smallScreen = false,
  compact = false, expanded = false, compactResearchChrome = false, comparisonSessions, researchActions, onExpand, height = 440 }) {
  const id = useId().replace(/:/g, ''), [timeframe,setTimeframe] = useState('daily');
  const [count,setCount] = useState(comparisonSessions || (smallScreen ? 63 : 126)), [offset,setOffset] = useState(0);
  const [annotations,setAnnotations] = useState(true);
  const model = useMemo(() => leaderChartModel({bars:priceData,symbol,date,rsLine:rsLineData,timeframe}), [priceData,symbol,date,rsLineData,timeframe]);
  const evidence = useMemo(() => {
    const existing = technicalEvidence || row?.book_technical_evidence;
    if (existing?.version === BOOK_TECHNICAL_VERSION && existing.valid === true && existing.symbol === symbol && existing.as_of_date === date) return existing;
    if (!payload || !row || row.symbol !== symbol || payload.symbol !== symbol || payload.as_of_date !== date) return null;
    return buildBookTechnicalEvidence(row,payload,date);
  },[technicalEvidence,row,payload,symbol,date]);
  if (model.error) return <div className="leader-svg-warning" role="alert">チャート：データなし。{model.error}</div>;
  const all=model.candlesticks,end=Math.max(1,all.length-Math.min(offset,Math.max(0,all.length-2))),start=Math.max(0,end-count),bars=all.slice(start,end);
  const width=smallScreen?360:compact?440:760,left=8,right=smallScreen?55:62,plotWidth=width-left-right;
  const chartHeight=compact||expanded?height:Math.max(390,Math.min(height,560)),dense=compact||(expanded&&height<390);
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
  const rs=shown(model.rs),rsScale=relativeStrengthScale(rs)?.priceRange,yRs=value=>rsBottom-(value-rsScale.minValue)/(rsScale.maxValue-rsScale.minValue)*(rsBottom-rsTop);
  const latest=all.at(-1),latestMean=model.volumeMean.at(-1),vcp=evidence?.valid&&!model.warning?evidence.vcp:null;
  const legs=Array.isArray(vcp?.legs)?vcp.legs:[],datedLegs=legs.map((leg,index)=>({...leg,number:index+1})).filter(leg=>finite(leg.depthPct)&&positive(leg.high)&&positive(leg.low)&&leg.startDate&&leg.endDate);
  const visibleLegs=timeframe==='daily'&&annotations?datedLegs.filter(leg=>leg.endDate>=bars[0].time&&leg.startDate<=bars.at(-1).time).slice(-3):[];
  const intervalText=timeframe==='weekly'?'週足（10/30/40週線・直前10週出来高平均）':'日足（50/150/200日線・直前50日出来高平均）';
  const range=countValue=>{setCount(Math.max(2,timeframe==='weekly'?Math.ceil(countValue/5):countValue));setOffset(0);};
  const shift=direction=>setOffset(value=>Math.max(0,Math.min(all.length-2,value+direction*Math.max(1,Math.floor(count/3)))));
  const zoom=factor=>setCount(value=>Math.max(5,Math.min(all.length,Math.round(value*factor))));
  const paths=(points,y,color,key,dash)=>seriesPaths(points,bars,x,y).map((points,index)=><polyline key={`${key}-${index}`} data-series={key} points={points} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={dash} vectorEffect="non-scaling-stroke"/>);
  return <section style={compact?{height,display:'flex',flexDirection:'column'}:undefined} className={`leader-evidence-chart${expanded?' leader-evidence-expanded':''}${compactResearchChrome?' leader-evidence-short':''}`} aria-label={`${symbol} SVG価格・出来高・RSチャート`}>
    {!compact&&<div className="leader-svg-controls" role="group" aria-label="チャートの表示操作">
      {['daily','weekly'].map(value=><button key={value} type="button" aria-pressed={timeframe===value} onClick={()=>{setTimeframe(value);setCount(value==='weekly'?52:smallScreen?63:126);setOffset(0);}}>{value==='daily'?'日足':'週足'}</button>)}
      {smallScreen?<select aria-label="表示期間" value={offset===0?(ranges.find(([,value])=>count===(timeframe==='weekly'?Math.ceil(value/5):value))?.[1]??''):''} onChange={event=>range(Number(event.target.value))}>
        <option value="" disabled>任意期間</option>{ranges.map(([label,value])=><option key={value} value={value}>{label}</option>)}
      </select>:ranges.map(([label,value])=><button key={label} type="button" onClick={()=>range(value)}>{label}</button>)}
      <button type="button" aria-label="表示期間を拡大" onClick={()=>zoom(.7)}>＋</button><button type="button" aria-label="表示期間を縮小" onClick={()=>zoom(1.4)}>−</button>
      <button type="button" aria-label="過去の期間へ" disabled={start===0} onClick={()=>shift(1)}>←</button><button type="button" aria-label="新しい期間へ" disabled={offset===0} onClick={()=>shift(-1)}>→</button>
      <button type="button" onClick={()=>{setCount(timeframe==='weekly'?52:smallScreen?63:126);setOffset(0);}}>リセット</button>
      <button type="button" aria-pressed={annotations} disabled={timeframe!=='daily'} onClick={()=>setAnnotations(value=>!value)}>VCP注記</button>
      {researchActions}{onExpand&&<button type="button" onClick={onExpand} aria-label="日次チャートを分析">拡大 ↗</button>}
    </div>}
    {!compact&&<p className={`leader-svg-caption${smallScreen?' leader-svg-caption-mobile':''}`}>{smallScreen?<><span>最終バー {latest.time} 終値 {formatPrice(latest.close)}</span><span>期間 {bars[0].time}〜{bars.at(-1).time}</span></>:<>{symbol} · {intervalText} · 最終バー {latest.time} 終値 {formatPrice(latest.close)}。期間 {bars[0].time}〜{bars.at(-1).time}</>}</p>}
    {model.warning&&<p role="status" className="leader-svg-warning">{model.warning} 買い帯とVCP注記は保留しています。</p>}
    <svg data-chart-plot data-chart-symbol={symbol} data-chart-asof={date} style={compact?{height,width:'100%',flex:'1 1 0',minHeight:0}:expanded?{height,width:'100%'}:undefined} preserveAspectRatio={compact||expanded?'none':undefined} viewBox={`0 0 ${width} ${chartHeight}`} role="img" aria-label={`${symbol} 価格・出来高・RS 共通時間軸 ${bars[0].time}〜${bars.at(-1).time}`} tabIndex={compact?undefined:0}
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
        {visibleLegs.map(leg=>{const peak=bars.findIndex(bar=>bar.time===leg.peakDate),bottom=bars.findIndex(bar=>bar.time===leg.lowDate);if(peak<0||bottom<0)return null;return <g key={leg.number} data-vcp-leg={leg.number}><title>{`T${leg.number} 推定 ${leg.startDate}〜${leg.endDate} 深さ ${leg.depthPct}%`}</title><path d={`M${x(peak)} ${yPrice(leg.high)}L${x(bottom)} ${yPrice(leg.low)}`} fill="none" stroke="var(--ext)" strokeDasharray="4 3"/><text x={Math.min(width-right-50,Math.max(left,x(bottom)))} y={Math.min(priceBottom-4,yPrice(leg.low)+13)} fill="var(--text)" fontSize="11">T{leg.number} {leg.depthPct.toFixed(1)}%</text></g>;})}
      </g>
      <text x={left} y={volumeTop-10} fill="var(--text)" fontSize="12">出来高 · 破線は直前{timeframe==='weekly'?'10週':'50日'}平均</text>
      <g data-pane="volume">{volume.map((point,index)=><rect key={point.time} data-volume={point.value} x={x(index)-candleWidth/2} y={yVolume(point.value)} width={candleWidth} height={volumeBottom-yVolume(point.value)} fill={point.color}><title>{point.time} 出来高 {quantity(point.value)}</title></rect>)}{paths(model.volumeMean,yVolume,'var(--text)','volume-mean','4 3')}</g>
      {!means.length&&<text x={left} y={volumeTop+15} fill="var(--text-2)" fontSize="11">平均：データなし</text>}
      <text x={left} y={rsTop-10} fill="var(--text)" fontSize="12">RS線 · {benchmarkSymbol||'比較対象データなし'}（RS順位とは別）</text>
      <g data-pane="rs">{rsScale?paths(model.rs,yRs,'var(--accent)','rs'):<text x={left} y={rsTop+18} fill="var(--text-2)" fontSize="12">データなし</text>}</g>
      <g data-chart-date-axis>
        <rect x={0} y={chartHeight-24} width={width} height={24} fill="var(--panel)"/>
        <line x1={0} x2={width} y1={chartHeight-24} y2={chartHeight-24} stroke="var(--line)"/>
        {[0,Math.floor((bars.length-1)/2),bars.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(index=><text key={index} x={x(index)} y={chartHeight-7} textAnchor={index===0?'start':index===bars.length-1?'end':'middle'} fill="var(--text-2)" fontSize="11">{bars[index].time.slice(5)}</text>)}
      </g>
    </svg>
    {!compact&&<><div className="leader-svg-legend"><span>共通ピボット {positive(pivotPrice)&&!model.warning?formatPrice(pivotPrice):'データなし'}</span><span>買い上限 {safeLevels?formatPrice(buyCeiling):'データなし'}</span><span>損切り例 {!model.warning&&positive(stopPrice)?formatPrice(stopPrice):'データなし'}</span><span>直前{timeframe==='weekly'?'10週':'50日'}平均出来高 {quantity(latestMean?.value)}</span></div>
      <div className="leader-svg-legend">{[[50,model.sma50],[150,model.sma150],[200,model.sma200]].map(([period,points])=><span key={period}>SMA{timeframe==='weekly'?period/5:period} {positive(points.at(-1)?.value)?formatPrice(points.at(-1).value):'データなし'}</span>)}</div>
      <p className="leader-svg-caption">{intervalText}。VCPは既存アルゴリズムの推定区間で、合格・買い指示ではありません。週足ではVCP注記を表示しません。共通ピボットと収縮高値は別です。方向キー/期間ボタンで移動、＋/−で拡大縮小できます。自由ドラッグ・ピンチ操作は未対応です。</p>
      <details className="leader-vcp-table"><summary>VCPの期間・深さ・出来高を確認</summary>{datedLegs.length?<table><caption>全収縮区間（推定）。図は表示期間内の直近最大3区間のみ。</caption><thead><tr><th>区間</th><th>期間</th><th>深さ</th><th>最終出来高/直前50日</th></tr></thead><tbody>{datedLegs.map(leg=><tr key={leg.number}><td>T{leg.number}</td><td>{leg.startDate}〜{leg.endDate}<br/>{leg.sessions}営業日</td><td>{leg.depthPct.toFixed(2)}%</td><td>{finite(leg.volumeEvidence?.lastRatio)?`${leg.volumeEvidence.lastRatio.toFixed(2)}倍`:'データなし'}</td></tr>)}</tbody></table>:<p>データなし。収縮区間を作り足しません。</p>}</details></>}
  </section>;
}
