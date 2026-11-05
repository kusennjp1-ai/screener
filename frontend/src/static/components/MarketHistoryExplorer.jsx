import { useEffect, useRef, useState } from 'react';
import { bifurcation, environmentPoint, historyWindow, BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from '../marketLongHistory';
import { SECTORS } from '../sectorDefinitions';
import { TrendChart } from './MarketTrendDashboard';
import MetricDisclosure from './MetricDisclosure';
import './marketHistoryExplorer.css';
// The brief's market tab draws the sector ranks itself (MarketSectors); this module keeps the long-run breadth chart.
const groupNames=Object.fromEntries([...SECTORS.map(([key,label])=>[key,label]),['Unknown','未分類']]);
const metrics={
 trendTemplateCount:{label:'トレンドテンプレート達成数',unit:'銘柄',lines:[{key:'trendTemplateCount',label:'8条件すべて達成',color:'var(--zone)'},{key:'rs90TemplateCount',label:'うちRS推計90以上',color:'var(--wait)'}],globalOnly:true},
 stages:{label:'ステージ構成',unit:'%',lines:[{key:'stage1Percent',label:'ステージ1',color:'var(--wait)'},{key:'stage2Percent',label:'ステージ2',color:'var(--zone)'},{key:'stage3Percent',label:'ステージ3',color:'var(--ext)'},{key:'stage4Percent',label:'ステージ4',color:'var(--neg)'}],globalOnly:true},
 movingAverages:{label:'移動平均線の上',unit:'%',lines:[{key:'above50Percent',label:'50日線上',color:'var(--zone)'},{key:'above200Percent',label:'200日線上',color:'var(--wait)'}],globalOnly:true},
 leaderHealthPercent:{label:'リーダーの健全度',unit:'%',lines:[{key:'leaderHealthPercent',label:'20営業日前のTT達成銘柄のうち50日線の上',color:'var(--zone)'}],globalOnly:true},
 breakoutHoldPercent:{label:'ブレイクアウトの成功率',unit:'%',lines:[{key:'breakoutHoldPercent',label:'10日間 −7%に届かず',color:'var(--zone)'}],globalOnly:true},
 highsLows:{label:'新高値・新安値',unit:'銘柄',lines:[{key:'newHighs',label:'52週の新高値',color:'var(--zone)'},{key:'newLows',label:'52週の新安値',color:'var(--neg)'}],globalOnly:true,everySchema:true},
 above50Percent:{label:'50日線上',unit:'%'},leaderCount:{label:'先導株数（価格条件）',unit:'銘柄'},ratio_10day:{label:'4%騰落・10日レシオ',unit:'倍',globalOnly:true}};
const linesFor=(key,config)=>config.lines||[{key,label:config.label,color:'var(--zone)'}];
const fmt=value=>Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:2}):'未確認';

/**
 * Long-run breadth and leader series. `request` ({ metric, seq }) opens a metric from outside (the market
 * tab's rows); a metric this history cannot draw falls back to the opening one. `id` names the heading so
 * a caller can move focus to it; `showSplit` hides the index/breadth split note where the caller shows it.
 */
export function HistoricalBreadth({history,showSplit=true,request=null,id}){
 const hasEnvironment=history?.breadth?.some(row=>'trendTemplateCount' in row);
 const available=Object.entries(metrics).filter(([,value])=>hasEnvironment||!value.lines||value.everySchema);
 const opening=hasEnvironment?'trendTemplateCount':'leaderCount',allowed=key=>available.some(([name])=>name===key);
 const [metric,setMetric]=useState(()=>request&&allowed(request.metric)?request.metric:opening),[range,setRange]=useState(12),[cursor,setCursor]=useState(null),[group,setGroup]=useState('all');
 const applied=useRef(request?.seq);
 useEffect(()=>{if(!request||request.seq===applied.current)return;applied.current=request.seq;setMetric(allowed(request.metric)?request.metric:opening);setCursor(null);setGroup('all');},[request]); // eslint-disable-line react-hooks/exhaustive-deps
 const rows=(group==='all'?history?.breadth:history?.sectorBreadth?.find(item=>item.sector===group)?.points)?.map(environmentPoint);
 const split=bifurcation(history);
 const points=historyWindow(rows,range,history?.as_of_date),selected=cursor===null?points.length-1:Math.min(cursor,points.length-1),current=points[selected],config=metrics[metric];
 if(!history)return <p>長期の公開データを確認できません。</p>;
 return <section className="market-history-explorer" aria-label="選定対象の価格条件と先導株の長期推移">
  <header><h3 id={id} tabIndex={id?-1:undefined}>広がりと先導株</h3><span>株価条件だけで過去にさかのぼった集計</span></header>
  {showSplit&&split?.warning&&<p className="history-bifurcation" role="note">▲ {split.fromHigh>-0.05?'指数は1年高値の水準にありますが':`指数は1年高値まであと${Math.abs(split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{split.above200Percent.toFixed(1)}%です。指数と個別株の乖離（独自判定）。</p>}
  <div className="history-metric-picker" role="group" aria-label="長期推移の指標">{available.map(([key,value])=><button key={key} aria-pressed={metric===key} onClick={()=>{setMetric(key);setCursor(null);if(value.globalOnly)setGroup('all');}}>{value.label}</button>)}</div>
  {history.sectorBreadth?.length>0&&!config.globalOnly&&<label className="history-sector-picker">対象 <select aria-label="業種別推移の対象" value={group} onChange={event=>{setGroup(event.target.value);setCursor(null);}}><option value="all">全体</option>{history.sectorBreadth.map(item=><option key={item.sector} value={item.sector}>{groupNames[item.sector]||item.sector}（現在分類）</option>)}</select></label>}
  <div className="history-range" role="group" aria-label="先導株と広がりの表示期間">{[[1,'1M'],[3,'3M'],[6,'6M'],[12,'1年'],[24,'2年']].map(([months,label])=><button key={months} aria-pressed={range===months} onClick={()=>{setRange(months);setCursor(null);}}>{label}</button>)}</div>
  <p className="history-chart-title">{config.label}<span>{group==='all'?'全体':`${groupNames[group]||group}（現在分類）`}</span></p>
  <TrendChart points={points} lines={linesFor(metric,config)} unit={config.unit} label={`${config.label}の長期推移`} selected={Math.max(0,selected)} onSelect={setCursor}/>
  <p className="history-scope">{group==='all'?'現在の公開集合':`${groupNames[group]||group}・現在分類を遡及適用`} · 観測 {fmt(current?.coverage)} / 上場後253営業日経過の対象 {fmt(current?.eligibleUniverse)}。{current?.reason||''}</p>
  <MetricDisclosure summary="先導株・10日レシオの定義と観測範囲">{hasEnvironment&&<><p>トレンドテンプレート達成数は、8条件（株価が150日・200日線の上、150日線が200日線の上、200日線が21営業日前より上、50日線が150日・200日線の上、株価が50日線の上、52週安値から30%以上上、52週高値から25%以内、RS推計70以上）をすべて満たす件数です。先導株数は安値条件を25%とした従来の集計です。</p><p>ステージは、200日線の20営業日変化（±1%以内は横ばい）、60営業日の終値の回帰傾き（1日±0.05%）、株価と200日線の位置から、銘柄ごとのステージ判定と同じ規則で日ごとに再計算します。200日線が下向きで株価がその下にあるときの値動きの形による例外は再現せず、ステージ4に数えます。</p><p>ブレイクアウトは、終値が過去251営業日の高値を超え、出来高が直前50日平均の1.4倍以上で、価格条件を満たした日です。その後10営業日の安値が上抜け当日の終値から7%下に届かなければ成功とし、10〜29営業日前のブレイクアウトを集計します。判定数が{BREAKOUT_MIN_SAMPLE}件未満の日は未確認です。</p><p>リーダーの健全度は、20営業日前にトレンドテンプレートを満たしていた銘柄のうち、今日も観測でき、終値が50日線の上にある割合です。リーダー株の崩れは指数より先に表れやすいという考え方に基づく独自集計で、対象が{LEADER_MIN_COHORT}銘柄未満の日は未確認です。</p></>}<p>先導株数は、当日の価格がミネルヴィニのトレンドテンプレートを満たし、同日OHLCVから独自算出したRSが70以上の件数です。RSは63・126・189・252営業日の騰落率を40・20・20・20%で加重し、同日の観測集合で1〜99に順位化します。IBD公式RSではありません。</p><p>10日レシオ＝10営業日の4%以上上昇した銘柄数の合計 ÷ 4%以上下落した銘柄数の合計。全銘柄の騰落数比とは異なります。分母0または欠測がある窓は未確認です。</p><p>現在公開する{history.universe.symbols.length.toLocaleString('ja-JP')}銘柄を過去へ適用した近似です。各日の上場銘柄集合や廃止銘柄を再現していません。上場後253営業日未満は集計対象外、対象の90%以上の連続日足が確認できる日のみ集計します。過去の決算・財務条件や買い位置を復元した選定数ではありません。</p><p>業種別は現在の公開GICS分類を過去に適用しています。当時の分類変更は復元していません。終値が前日の1.8倍以上・0.55倍以下となる急変は、分割等との独立照合がないためその日を欠測にし、253日窓から除外します。本当の大幅騰落も除外され得ます。上場日未確認・取得失敗の銘柄は対象数に残します。</p><p>観測期間 {points[0]?.date}〜{points.at(-1)?.date}。取得 {history.retrieved_at}。出典：Yahoo Finance。全取得レスポンスのSHA-256・URL・取得時刻を公開データ内に保持しています。</p></MetricDisclosure>
 </section>;
}
