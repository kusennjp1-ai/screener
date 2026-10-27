import { useEffect, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { historyWindow } from '../marketLongHistory';
import { SECTORS } from '../sectorDefinitions';
import { TrendChart } from './MarketTrendDashboard';
import { useMarketTrends } from '../useMarketTrends';
import MarketUpdateStatus from './MarketUpdateStatus';
import MetricDisclosure from './MetricDisclosure';
import './marketHistoryExplorer.css';
const names=Object.fromEntries(SECTORS.map(([,label,symbol])=>[symbol,label]));
const groupNames=Object.fromEntries([...SECTORS.map(([key,label])=>[key,label]),['Unknown','未分類']]);
const metrics={above50Percent:{label:'50日線上',unit:'%'},leaderCount:{label:'先導株数（価格条件）',unit:'銘柄'},ratio_10day:{label:'4%騰落・10日レシオ',unit:'倍'}};
const fmt=value=>Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:2}):'未確認';

export function HistoricalBreadth({history}){
 const [metric,setMetric]=useState('leaderCount'),[range,setRange]=useState(12),[cursor,setCursor]=useState(null),[group,setGroup]=useState('all');
 const rows=group==='all'?history?.breadth:history?.sectorBreadth?.find(item=>item.sector===group)?.points;
 const points=historyWindow(rows,range,history?.as_of_date),selected=cursor===null?points.length-1:Math.min(cursor,points.length-1),current=points[selected],config=metrics[metric];
 if(!history)return <p>長期の公開データを確認できません。</p>;
 return <section className="market-history-explorer" aria-label="選定対象の価格条件と先導株の長期推移">
  <header><h3>広がりと先導株</h3><span>価格条件による遡及集計</span></header>
  <div className="history-metric-picker" role="group" aria-label="長期推移の指標">{Object.entries(metrics).map(([key,value])=><button key={key} aria-pressed={metric===key} onClick={()=>{setMetric(key);setCursor(null);if(key==='ratio_10day')setGroup('all');}}>{value.label}</button>)}</div>
  {history.sectorBreadth?.length>0&&<label className="history-sector-picker">対象 <select aria-label="業種別推移の対象" value={group} disabled={metric==='ratio_10day'} onChange={event=>{setGroup(event.target.value);setCursor(null);}}><option value="all">全体</option>{history.sectorBreadth.map(item=><option key={item.sector} value={item.sector}>{groupNames[item.sector]||item.sector}（現在分類）</option>)}</select></label>}
  <div className="history-range" role="group" aria-label="先導株と広がりの表示期間">{[[1,'1M'],[3,'3M'],[6,'6M'],[12,'1年'],[24,'2年']].map(([months,label])=><button key={months} aria-pressed={range===months} onClick={()=>{setRange(months);setCursor(null);}}>{label}</button>)}</div>
  <TrendChart points={points} lines={[{key:metric,label:config.label,color:'var(--zone)'}]} unit={config.unit} label={`${config.label}の長期推移`} selected={Math.max(0,selected)} onSelect={setCursor}/>
  <p className="history-scope">{group==='all'?'現在の公開集合':`${groupNames[group]||group}・現在分類を遡及適用`} · 観測 {fmt(current?.coverage)} / 上場後253営業日経過の対象 {fmt(current?.eligibleUniverse)}。{current?.reason||''}</p>
  <MetricDisclosure summary="先導株・10日レシオの定義と観測範囲"><p>先導株数は、当日の価格がミネルヴィニのトレンドテンプレートを満たし、同日OHLCVから独自算出したRSが70以上の件数です。RSは63・126・189・252営業日の騰落率を40・20・20・20%で加重し、同日の観測集合で1〜99に順位化します。IBD公式RSではありません。</p><p>10日レシオ＝10営業日の4%以上上昇した銘柄数の合計 ÷ 4%以上下落した銘柄数の合計。全銘柄の騰落数比とは異なります。分母0または欠測がある窓は未確認です。</p><p>現在公開する{history.universe.symbols.length.toLocaleString('ja-JP')}銘柄を過去へ適用した近似です。各日の上場銘柄集合や廃止銘柄を再現していません。上場後253営業日未満は集計対象外、対象の90%以上の連続日足が確認できる日のみ集計します。過去の決算・財務条件や買い位置を復元した選定数ではありません。</p><p>業種別は現在の公開GICS分類を過去に適用しています。当時の分類変更は復元していません。終値が前日の1.8倍以上・0.55倍以下となる急変は、分割等との独立照合がないためその日を欠測にし、253日窓から除外します。本当の大幅騰落も除外され得ます。上場日未確認・取得失敗の銘柄は対象数に残します。</p><p>観測期間 {points[0]?.date}〜{points.at(-1)?.date}。取得 {history.retrieved_at}。出典：Yahoo Finance。全取得レスポンスのSHA-256・URL・取得時刻を公開データ内に保持しています。</p></MetricDisclosure>
 </section>;
}
export function SectorRankHistory({history}){
 const frames=history?.sectorRotation?.frames||[],[cursor,setCursor]=useState(null),[playing,setPlaying]=useState(false);
 const reduced=useMediaQuery('(prefers-reduced-motion: reduce)'),selected=cursor===null?Math.max(0,frames.length-1):Math.min(cursor,Math.max(0,frames.length-1)),current=frames[selected];
 useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setCursor(previous=>{const next=(previous??0)+1;if(next>=frames.length){setPlaying(false);return Math.max(0,frames.length-1);}return next;}),reduced?900:350);return()=>clearInterval(timer);},[playing,frames.length,reduced]);
 useEffect(()=>{if(reduced)setPlaying(false);},[reduced]);
 if(!history)return null;
 return <section className={`sector-rank-history${reduced?' reduced-motion':''}`} aria-label="セクターETFの独自RS順位の推移">
  <header><div><h3>セクターETF RS</h3><p>公開価格から独自算出 · 11セクター</p></div><time>{current?.date||'未取得'}</time></header>
  <div className="sector-rank-controls"><button disabled={!frames.length} aria-pressed={playing} onClick={()=>{if(!playing&&(cursor===null||selected===frames.length-1))setCursor(0);setPlaying(!playing);}}>{playing?'Ⅱ 一時停止':'▶ 再生'}</button><label><span>日付</span><input type="range" aria-label="セクター順位の対象日" min="0" max={Math.max(0,frames.length-1)} value={selected} aria-valuetext={current?.date} onPointerDown={()=>setPlaying(false)} onKeyDown={()=>setPlaying(false)} onChange={event=>{setPlaying(false);setCursor(Number(event.target.value));}}/></label></div>
  <div className="sector-rank-stage" role="list" aria-label={`${current?.date||'未取得'}のセクター順位。126営業日の対SPY相対価格。`}>
   {current?.ranks?.length===11?current.ranks.map((row,position)=><div className="history-sector-rank-row" role="listitem" aria-label={`${row.rank}位 ${names[row.symbol]} ${row.symbol} 相対価格指数 ${fmt(row.relativeIndex)}`} key={row.symbol} style={{transform:`translateY(${position*36}px)`}}><b className="sector-rank-number">{row.rank}</b><span className="sector-rank-name">{names[row.symbol]}<small>{row.symbol}</small></span><span className="sector-rank-track" aria-hidden="true"><i style={{width:`${Math.max(5,100-(row.rank-1)*8)}%`}}/></span><strong>{fmt(row.relativeIndex)}</strong></div>):<p>この日の11セクターすべてを確認できません。</p>}
  </div>
  <p className="history-scope">{frames[0]?.date}〜{frames.at(-1)?.date} · 数値100＝SPYと同じ騰落。棒の長さは順位を表します。</p>
  <MetricDisclosure summary="独自RSの計算方法・出典"><p>126営業日前を100として、（ETF終値 ÷ SPY終値）の変化を計算。高い順に1〜11位、同値は同順位です。欠測日は順位を作りません。価格は分割調整済み・配当再投資なし。11のSelect Sector SPDR ETFの比較で、IBDの業種グループ分類・公式RSとは異なります。</p><p>自動再生は初期状態では停止。日付バーを動かすと停止します。OSの動きを減らす設定では移動アニメーションを無効にします。</p><a href="https://www.ssga.com/us/en/individual/capabilities/equities/sector-investing/select-sector-etfs" target="_blank" rel="noreferrer">State StreetのセクターETF一覧 ↗</a></MetricDisclosure>
 </section>;
}
export default function ConnectedMarketHistoryExplorer({marketEntry,sectorOnly=false}){
 const query=useMarketTrends(marketEntry);
 if(query.loading)return <p role="status">長期履歴を読み込み中…</p>;
 if(query.error)return <p role="alert">長期履歴の整合性を確認できません。</p>;
 return <><MarketUpdateStatus data={query.data}/>{!sectorOnly&&<HistoricalBreadth history={query.data?.long_history}/>}<SectorRankHistory history={query.data?.long_history}/></>;
}
