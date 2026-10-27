import { useId, useMemo, useState } from 'react';
import { useMarketTrends } from '../useMarketTrends';
import MetricDisclosure from './MetricDisclosure';
import MarketUpdateStatus from './MarketUpdateStatus';
import useSvgViewportWidth from './useSvgViewportWidth';
import './marketTrendDashboard.css';
import { historyWindow } from '../marketLongHistory';

const choices=[['breadth','◒','50日線'],['highlow','↗','新高値・安値'],['putcall','⇄','P/C'],['distribution','◈','分配日']];
const number=(value,digits=1)=>Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:digits}):'未確認';

export function TrendChart({points,lines,unit,label,selected,onSelect}){
 const id=useId();
 const [plotRef,width]=useSvgViewportWidth(330);
 const values=points.flatMap(point=>lines.filter(line=>!line.secondary).map(line=>point[line.key])).filter(Number.isFinite),max=Math.max(...values,1),min=unit==='%'?0:Math.min(...values,0);
 const secondary=lines.find(line=>line.secondary),secondaryValues=secondary?points.map(point=>point[secondary.key]).filter(Number.isFinite):[],secondaryMax=Math.max(...secondaryValues,1),secondaryMin=Math.min(...secondaryValues,secondaryMax);
 const right=width-(secondary?54:18);
 const x=i=>36+(points.length>1?i/(points.length-1):.5)*(right-36),y=value=>22+(1-(value-min)/(max-min||1))*132;
 const lineY=(line,value)=>line.secondary?22+(1-(value-secondaryMin)/(secondaryMax-secondaryMin||1))*132:y(value);
 const paths=line=>{let next=true;return points.map((point,i)=>{if(!Number.isFinite(point[line.key])){next=true;return '';}const command=next?'M':'L';next=false;return `${command}${x(i).toFixed(2)},${lineY(line,point[line.key]).toFixed(2)}`;}).join(' ');};
 const current=points[selected]||points.at(-1);
 return <div className="market-trend-plot" ref={plotRef}>
  {values.length||secondaryValues.length?<>
   <svg viewBox={`0 0 ${width} 184`} height="184" role="img" aria-labelledby={id}><title id={id}>{label}。{points[0]?.date}から{points.at(-1)?.date}。欠測は線を接続しません。</title>
    {[0,.5,1].map(level=><g key={level}><line x1="36" x2={right} y1={22+level*132} y2={22+level*132} stroke="currentColor" opacity=".12"/><text x="30" y={26+level*132} textAnchor="end">{number(max-level*(max-min),unit==='倍'?2:0)}</text></g>)}
    {secondary&&[0,.5,1].map(level=><text key={`secondary-${level}`} x={right+5} y={26+level*132} fill={secondary.color}>{number(secondaryMax-level*(secondaryMax-secondaryMin),0)}</text>)}
    {lines.map(line=><path key={line.key} d={paths(line)} stroke={line.color} strokeWidth={line.secondary?'1.8':'2.5'} strokeDasharray={line.secondary?'5 3':undefined} fill="none"/>)}
    {current&&<line x1={x(selected)} x2={x(selected)} y1="18" y2="158" stroke="var(--market-muted)" strokeDasharray="3 4"/>}
    {lines.map(line=>Number.isFinite(current?.[line.key])?<circle key={line.key} cx={x(selected)} cy={lineY(line,current[line.key])} r="4" fill={line.color} stroke="var(--market-card)" strokeWidth="2"/>:null)}
    <text x="36" y="178">{points[0]?.date}</text><text x={right} y="178" textAnchor="end">{points.at(-1)?.date}</text>
   </svg>
   <label className="market-trend-scrubber"><span>日付を動かして確認</span><input type="range" min="0" max={Math.max(0,points.length-1)} value={selected} onChange={event=>onSelect(Number(event.target.value))} aria-label={`${label}の対象日`} aria-valuetext={current?.date}/></label>
  </>:<p className="market-trend-empty">この期間の履歴は未取得です。</p>}
  <div className="market-trend-readout" aria-live="polite"><time>{current?.date||'対象日未確認'}</time><div>{lines.map(line=><span key={line.key}><i style={{background:line.color}} aria-hidden="true"/>{line.label} <b>{number(current?.[line.key],unit==='倍'?2:1)}{Number.isFinite(current?.[line.key])?(line.unit||unit):''}</b></span>)}</div></div>
 </div>;
}

export function MarketTrendDashboard({data,loading=false,error=false}){
 const [section,setSection]=useState('breadth'),[range,setRange]=useState(3),[cursor,setCursor]=useState(null),[indexSymbol,setIndexSymbol]=useState('^GSPC');
 const index=data?.indices?.find(item=>item.symbol===indexSymbol);
 const historicalIndex=Boolean(index?.historical),confirmedIndexDate=index?.points?.at(-1)?.date||'未確認';
 const all=useMemo(()=>{
  if(section==='distribution')return index?.points||[];
  if(section==='putcall')return data?.put_call?.points||[];
  const breadth=data?.long_history?.breadth||data?.breadth?.points||[];
  const sp=new Map((data?.long_history?.sp500||[]).map(point=>[point.date,point.close]));
  return breadth.map(point=>({...point,sp500:sp.get(point.date)??null}));
 },[section,index,data]);
 const points=historyWindow(all,range,data?.as_of_date),selected=cursor===null?points.length-1:Math.min(cursor,points.length-1),latest=all.at(-1),current=points[selected];
 const configurations={breadth:{title:'50日線より上にいる銘柄',label:'50日線上の割合',unit:'%',lines:[{key:'above50Percent',label:'50日線上',color:'var(--zone)'}]},highlow:{title:'新高値と新安値のバランス',label:'新高値・新安値の推移',unit:'銘柄',lines:[{key:'newHighs',label:'新高値',color:'var(--zone)'},{key:'newLows',label:'新安値',color:'var(--neg)'}]},putcall:{title:'プットとコールの出来高',label:'プットコールレシオの推移',unit:'倍',lines:[{key:'value',label:'P/C',color:'var(--accent)'}]},distribution:{title:'指数ごとの売り圧力を追う',label:'分配日の有効件数の推移',unit:'日',lines:[{key:'value',label:'有効な分配日',color:'var(--ext)'}]}};
 const config=configurations[section];
 if(section==='highlow'&&data?.long_history?.sp500?.length)config.lines.push({key:'sp500',label:'S&P 500（右軸）',unit:'pt',color:'var(--accent)',secondary:true});
 const ranges=section==='highlow'?[[1,'1M'],[3,'3M'],[12,'1年'],[24,'2年'],[60,'5年']]:section==='breadth'?[[1,'1M'],[3,'3M'],[12,'1年'],[24,'2年']]:[[1,'1か月'],[3,'3か月']];
 const choose=value=>{setSection(value);setCursor(null);setRange(value==='putcall'||value==='distribution'?3:Math.min(range,24));};
 return <section className="market-trends" aria-label="市場指標の推移">
  <header><div><span className="research-kicker">MARKET</span><h2>市場指標</h2></div>{data?<MarketUpdateStatus data={data}/>:<span>取得待ち</span>}</header>
  <div className="market-trend-tabs" role="tablist" aria-label="推移を確認する市場指標">{choices.map(([key,icon,label])=><button key={key} type="button" role="tab" aria-selected={section===key} aria-controls="market-trend-panel" id={`market-trend-${key}`} tabIndex={section===key?0:-1} onClick={()=>choose(key)} onKeyDown={event=>{const keys=choices.map(choice=>choice[0]),i=keys.indexOf(section);let next;if(event.key==='ArrowRight')next=keys[(i+1)%keys.length];if(event.key==='ArrowLeft')next=keys[(i+keys.length-1)%keys.length];if(event.key==='Home')next=keys[0];if(event.key==='End')next=keys.at(-1);if(next){event.preventDefault();choose(next);document.getElementById(`market-trend-${next}`)?.focus();}}}><span aria-hidden="true">{icon}</span>{label}</button>)}</div>
  <div id="market-trend-panel" role="tabpanel" aria-labelledby={`market-trend-${section}`}>
   <div className="market-trend-title"><h3>{config.title}</h3><div role="group" aria-label="指標の表示期間">{ranges.map(([value,label])=><button key={value} onClick={()=>{setRange(value);setCursor(null);}} aria-pressed={range===value}>{label}</button>)}</div></div>
   {loading?<p role="status">推移を読み込み中…</p>:error?<p role="alert">履歴の読み込み・整合性を確認できません。未取得として表示します。</p>:<>
    {section==='distribution'&&<div className="distribution-index-picker" role="group" aria-label="分配日を確認する指数">{data?.indices?.map(item=><button key={item.symbol} aria-label={`${item.symbol==='^GSPC'?'S&P 500':'NASDAQ総合'} ${number(item.latest?.value,0)}${Number.isFinite(item.latest?.value)?'日':''}`} onClick={()=>{setIndexSymbol(item.symbol);setCursor(null);}} aria-pressed={indexSymbol===item.symbol}><span>{item.symbol==='^GSPC'?'S&P 500':'NASDAQ総合'}</span><strong>{number(item.latest?.value,0)}{Number.isFinite(item.latest?.value)?'日':''}</strong><small>基本ルールによる計算</small></button>)}</div>}
    {section!=='distribution'&&<div className="market-trend-current"><span>最新観測 {latest?.date||'未確認'}</span><strong>{config.lines.filter(line=>!line.secondary).map(line=>`${line.label} ${number(latest?.[line.key],section==='putcall'?2:1)}${Number.isFinite(latest?.[line.key])?config.unit:''}`).join(' / ')}</strong></div>}
    <TrendChart key={`${section}/${indexSymbol}/${range}/${data?.as_of_date}`} points={points} lines={config.lines} unit={config.unit} label={config.label} selected={Math.max(0,selected)} onSelect={setCursor}/>
    {(section==='breadth'||section==='highlow')&&data?.long_history&&<p className="market-trend-scope">表示 {points[0]?.date}〜{points.at(-1)?.date}。{section==='highlow'?'左軸：銘柄数 · 右軸：S&P 500指数（点）。':''}{current?.reason||''}</p>}
    {section==='breadth'||section==='highlow'?<p className="market-trend-scope">現在の公開集合を遡及集計 · 観測 {number(current?.coverage,0)} / 当日対象 {number(current?.eligibleUniverse??current?.universe,0)}銘柄</p>:section==='putcall'?<p className="market-trend-scope">Cboe 全商品合計 · 全米全取引所の合計ではありません</p>:<p className="market-trend-scope">{index?.symbol==='^GSPC'?'S&P 500':'Nasdaq Composite'} · {index?.available?'Yahooの指数出来高を使用。IBD公式件数とは別です。':index?.reason||'指数履歴は未取得です。'}</p>}
    <MetricDisclosure summary="計算方法・出典・読み方">
     {section==='breadth'&&<p>その日の終値が直近50営業日の単純平均を上回る銘柄数 ÷ 同日に計算できた公開チャート銘柄数 × 100。同値は含めません。現在の公開集合を過去へ計算した近似で、過去当時の全上場銘柄や廃止銘柄を再現していません。上部の価格・流動性対象の集計とは母集団が異なります。</p>}
     {section==='highlow'&&<p>当日高値・安値が直前251営業日の高値・安値を厳密に更新した件数。現在の公開集合を過去へ計算した近似です。上場後253営業日未満は対象外。対象の90%以上の連続日足が確認できる日のみ表示します。前日終値比1.8倍以上・0.55倍以下の急変は未照合として欠測化し、その253日窓を除外します。実際の大幅騰落も除外され得ます。欠測銘柄をゼロ件・健康な銘柄に置き換えていません。</p>}
     {section==='putcall'&&<><p>プット出来高 ÷ コール出来高。1倍なら同数、1倍より上ならプットの契約数が多い状態です。売買の方向や弱気投資家の割合を直接測る値ではありません。</p><p>選択日：プット {number(current?.puts,0)}契約 / コール {number(current?.calls,0)}契約。建玉ではなく、その日の出来高です。</p><p>取得日時 {current?.provenance?.retrieved_at||'未確認'}。対象日と取得日は別です。</p><a href={current?.provenance?.url||'https://www.cboe.com/markets/us/options/market-statistics/daily'} target="_blank" rel="noreferrer">Cboeの対象日データ ↗</a></>}
     {section==='distribution'&&<><p>前日終値から0.2%を超える下落、かつ前日より出来高が多い日を追加します。丸めて閾値を超えさせません。同値の出来高は対象外です。</p><p>発生日を0日目とし、25営業日経過で失効。翌日以降の高値が発生日終値から5%以上上昇した時点でも除外し、後の下落で復活させません。高値を使うことはこのアプリの明示した計算仕様です。</p><p>ストーリング日、IBD編集判断、フォロースルー後のリセットは推定せず含めません。Yahooの指数出来高はIBDが使う取引所売買高と独立照合していないため、公式件数との一致は認定しません。短縮取引の翌日も同じ条件で数え、一覧に注意を付けます。</p><a href="https://shop.investors.com/Images/promotional/Wizards-QA.pdf" target="_blank" rel="noreferrer">IBDの分配日・出来高の定義 ↗</a>{index?.provenance&&<p>取得 {index.provenance.retrieved_at} · 対象 {historicalIndex?confirmedIndexDate:data.as_of_date} · 提供元 {index.source}</p>}</>}
    </MetricDisclosure>
    {section==='distribution'&&<MetricDisclosure summary={historicalIndex?`最終確認日 ${confirmedIndexDate} 時点の発生日一覧・失効理由`:'現在の発生日一覧・失効理由'}><p>{historicalIndex?`最終確認日 ${confirmedIndexDate} 時点の有効日すべてと、最近12件の失効記録。分析基準日 ${data?.as_of_date} 現在は未確認です。`:`分析基準日 ${data?.as_of_date} 時点の有効日すべてと、最近12件の失効記録。`}グラフで選択した過去日の状態とは別です。</p><ul className="distribution-events">{[...(index?.events||[]).filter(event=>event.state==='active'),...(index?.events||[]).filter(event=>event.state!=='active').slice(-12)].sort((a,b)=>b.date.localeCompare(a.date)).map(event=><li key={event.date}><b>{event.date} · {number(event.changePct,2)}%</b><span>{event.state==='active'?(historicalIndex?'有効（最終確認日時点）':'有効'):`${event.removedDate} ${event.removal}`}</span>{event.comparisonNote&&<small>{event.comparisonNote}</small>}</li>)}</ul>{!index?.events?.length&&<p>{index?.available?'確認した期間に該当記録はありません。':'記録を確認できません。'}</p>}</MetricDisclosure>}
   </>}
  </div>
 </section>;
}

export default function ConnectedMarketTrendDashboard({marketEntry}){
 const query=useMarketTrends(marketEntry);
 return <MarketTrendDashboard data={query.data} loading={query.loading} error={query.error}/>;
}
