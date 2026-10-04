import CandidateCharts from './CandidateCharts';
import PositionMeter from './PositionMeter';
import { getStaticDataUrl } from '../../config/runtimeMode';
import { FinancialGrowthMetric } from './FinancialEvidenceSummary';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../financialEvidencePresentation';
import './candidateFeed.css';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Paper } from '@mui/material';
import { assess, entryPlan } from '../researchEngine';
import { singleMissingCondition } from '../missingCondition';
import './nearPass.css';
import './candidateGuidance.css';
import { entryReadiness } from '../entryReadiness';
import { verifiedVolumeRatio } from '../qualificationAudit';
import { money, signed, times, stateKey, STATES } from '../positionGeometry';
const SORTS={rank:'選定・買い位置',distance:'ピボットに近い順',rs:'RSが高い順',volume:'出来高比が高い順',state:'状態'};
const stateOrder=state=>['zone','wait','ext','na','low','acq'].indexOf(stateKey(state));
function CandidatePriceTrace({trace,date,symbol}) {
 const [failed,setFailed]=useState(false);
 const available=!failed&&trace?.status==='available'&&trace.asOfDate===date&&typeof trace.src==='string';
 return <span className="feed-price-trace">{available?<><img src={getStaticDataUrl(trace.src)} loading="lazy" decoding="async" width="360" height="64" alt={`${symbol} ${trace.caption}`} onError={()=>setFailed(true)}/><small>{trace.caption}</small></>:<span className="feed-trace-unavailable">価格推移 未確認<small>対応する日足・対象期間の根拠が未配信</small></span>}</span>;
}
const CandidateRow=memo(function CandidateRow({item,method,date,financialEpoch,nearOnly,selected,onSelect,onCompare,onMove,watched,onWatch}) {
 const {row:r,assessment:a,plan:p,readiness,volume,growth}=item,key=stateKey(p.state),[label,glyph,tone]=STATES[key];
 const dailyLabel=readiness?`日次 ${readiness.passed}/${readiness.total}`:'日次 未確認';
 const blockers=readiness?.rules.filter(rule=>rule.state!=='pass')||[];
 const nextCheck=blockers[0];
 const additionalChecks=blockers.slice(1).map(rule=>`${rule.label}：${rule.state==='unknown'?'未確認':'未達'}`).join('。');
 const dailyDetail=readiness?.ready?'日次モデルの条件をすべて通過。発注前に最新価格とリスクを確認':nextCheck?`${nextCheck.label}：${nextCheck.state==='unknown'?'未確認':'未達'}。${nextCheck.detail}`:'分析日または市場環境が未確認';
 const missing=useMemo(()=>nearOnly?singleMissingCondition(assess(r,method,financialEpoch)):null,[nearOnly,r,method,financialEpoch]);
 const selectionLabel=method.startsWith('minervini')?'トレンド':'手法の選定';
 return <article className="candidate-feed-card" data-selected={selected||undefined} data-near-pass={nearOnly||undefined}>
  <button className="candidate-row" aria-current={selected?'true':undefined} aria-label={`${r.symbol} の分析を表示。${label}。ピボット比 ${signed(p.distance)}。RS ${Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'未確認'}。出来高 ${times(volume)}。選定 ${a.passed}/${a.total}。${dailyLabel}。${dailyDetail}${additionalChecks?`。${additionalChecks}`:''}${nearOnly?`。${missing?.csv||'判定を再確認してください'}`:''}`} onClick={()=>onSelect(r.symbol)} onKeyDown={e=>{
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();onMove(r.symbol,e.key==='ArrowDown'?1:-1,e.currentTarget);}
   if(e.key==='Enter'&&onCompare){e.preventDefault();onCompare(r.symbol);}
  }}>
   <span className="feed-identity"><span className="feed-monogram" aria-hidden="true">{r.symbol.slice(0,2)}</span><span className="candidate-name"><strong className="mono">{r.symbol}</strong><small title={r.company_name}>{r.company_name||'企業名未配信'}</small></span><span className="feed-price"><strong className="mono">{money(p.price)}</strong><small>{signed(r.price_change_1d)} 前日比</small></span></span>
   <span className="feed-status-lanes">
    <span data-state={a.qualified?'pass':a.unknown?'unknown':'fail'}><small>{selectionLabel}</small><strong>{a.passed}/{a.total}{a.unknown?` · ?${a.unknown}`:''}</strong></span>
    <span className="feed-position" style={{'--position-tone':`var(--${tone})`}}><small>価格位置</small><strong>{glyph} {label}</strong><span className="feed-position-meter"><PositionMeter plan={p}/><span>{signed(p.distance)}</span></span></span>
    <span><small>日次確認</small><strong className="candidate-daily-check" data-ready={readiness?.ready||undefined}>{dailyLabel}{readiness?.ready?' ✓':''}</strong></span>
   </span>
  </button>
  <div className="feed-card-evidence">
   <CandidatePriceTrace key={`${date}:${r.priceTrace?.src||r.symbol}`} trace={r.priceTrace} date={date} symbol={r.symbol}/>
   <span className="feed-growth-label">成長の裏付け</span>
   <div className="feed-growth">{growth.map(row=><FinancialGrowthMetric key={row.id} row={row} compact/>)}</div>
   {nearOnly&&<span className="feed-missing" data-state={missing?.state||'unknown'}>{missing?.text||'判定資料を再確認'}</span>}
   <span className="feed-next-check"><strong>次に確認</strong><span>{dailyDetail}</span></span>
   {additionalChecks&&<span className="feed-other-checks">ほかの未達・未確認：{additionalChecks}</span>}
   <button className="feed-open-evidence" onClick={()=>onSelect(r.symbol)} aria-label={`${r.symbol} の財務・日次根拠を見る`}>根拠を見る →</button>
  </div>
  <footer className="feed-card-footer"><span>価格 {date||'未確認'} 終値 · RS {Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'未確認'} · 日次出来高 {times(volume)}</span><div>{onCompare&&<button onClick={()=>onCompare(r.symbol)} aria-label={`${r.symbol} のチャートを開く`}>チャート</button>}{onWatch&&<button className="feed-watch" onClick={()=>onWatch(r.symbol)} aria-label={`${r.symbol} ${watched?'ウォッチ解除':'ウォッチに保存'}`} aria-pressed={watched}>{watched?'★':'☆'}</button>}</div></footer>
 </article>;
});
export default memo(function CandidateBoard({ranked,method,nearOnly=false,onNearToggle,selectedSymbol,loading,onSelect,onHighlight,view='list',onView,date,generation,market,now,financialEpoch=now,onCompare,paused,toolbar,filterChips,onFilters,watch=[],onWatch,compareOnly=false}) {
 const [sort,setSort]=useState('rank'),[page,setPage]=useState(0);
 const scrollRef=useRef(null),pageStartRef=useRef(null);
 const ordered=useMemo(()=>{
  if(sort==='rank')return ranked;
  const values=ranked.map(item=>({...item,plan:entryPlan(item.row,null,method)}));
  const value=item=>sort==='distance'?(item.plan.distance==null?null:Math.abs(item.plan.distance)):sort==='rs'?item.row.rs_rating:sort==='volume'?verifiedVolumeRatio(item.row,date):stateOrder(item.plan.state);
  return values.sort((a,b)=>{const av=value(a),bv=value(b);return av==null?(bv==null?0:1):bv==null?-1:(av-bv)*(sort==='rs'||sort==='volume'?-1:1)||a.row.symbol.localeCompare(b.row.symbol);});
 },[ranked,method,sort,date]);
 const maxPage=Math.max(0,Math.ceil(ordered.length/50)-1),current=Math.min(page,maxPage);
 // Only the visible list page needs live daily checks. Selection, pagination,
 // and chart mode must not reevaluate the full screening universe.
 const pageRows=useMemo(()=>view==='list'?ordered.slice(current*50,current*50+50):[],[ordered,current,view]);
 // The page supplies a guarded bundle epoch. Keep financial presentation stable
 // across quote/readiness ticks, and rebuild on its own expiry or replacement.
 const withGrowth=useMemo(()=>pageRows.map(item=>({...item,plan:item.plan||entryPlan(item.row,null,method),volume:verifiedVolumeRatio(item.row,date),growth:financialEvidencePresentation({evidence:buildFinancialEvidencePresentation(item.row,{method,date,generation,now:financialEpoch}),history:item.row.financial_history,symbol:item.row.symbol,date,generation,method,now:financialEpoch}).rows.slice(0,2)})),[pageRows,method,date,generation,financialEpoch]);
 const visible=useMemo(()=>withGrowth.map(item=>({...item,readiness:date&&market?entryReadiness(item.row,date,market,now,method):null})),[withGrowth,method,date,market,now]);
 useLayoutEffect(()=>{
  if(pageStartRef.current!==current)return;
  pageStartRef.current=null;
  const scroll=scrollRef.current,first=scroll?.querySelector('.candidate-row');
  if(!first)return;
  // Only explicit pagination returns to the first row. Arrow-key navigation
  // keeps its existing target, including the previous page's final row.
  scroll.scrollTop=0;
  first.focus({preventScroll:true});
  if(window.innerWidth<=1279){
   const heading=scroll.closest('.research-list')?.querySelector('.candidate-board-heading');
   const top=(heading||first).getBoundingClientRect().top,headerBottom=document.querySelector('.leader-header')?.getBoundingClientRect().bottom||0;
   // Round toward the previous pixel so a fractional target cannot tuck the heading under the fixed header.
   window.scrollTo({top:Math.max(0,Math.floor(window.scrollY+top-headerBottom)),behavior:'instant'});
  }
 },[current]);
 const showPage=useCallback(next=>{pageStartRef.current=next;setPage(next);},[]);
 const sortBy=useCallback(key=>{setSort(key);setPage(0);},[]);
 const move=useCallback((symbol,direction,element)=>{const index=ordered.findIndex(x=>x.row.symbol===symbol),next=ordered[index+direction];if(next){const scroll=element.closest('.candidate-scroll');(onHighlight||onSelect)(next.row.symbol);setPage(Math.floor((index+direction)/50));requestAnimationFrame(()=>{scroll?.querySelectorAll('.candidate-row')[(index+direction)%50]?.focus({preventScroll:false});});}},[ordered,onSelect,onHighlight]);
 return <Paper component="section" id="candidate-board" tabIndex={-1} aria-label="候補リスト" className={`research-panel research-list candidate-guidance candidate-feed${compareOnly?' compare-only':''}`}>
  {!compareOnly&&<>{toolbar}<div className="candidate-board-heading"><h2>候補リスト <small>{loading?'—':ranked.length.toLocaleString()}件</small></h2><label><span className="sr-only">並び順</span><select aria-label="候補の並び順" value={sort} onChange={e=>sortBy(e.target.value)}>{Object.entries(SORTS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{onNearToggle&&<button className="near-pass-toggle" aria-pressed={nearOnly} onClick={onNearToggle}>あと1条件</button>}{onFilters&&<button onClick={onFilters} aria-label="候補を絞り込む">絞込</button>}</div>
  {filterChips}<div className="candidate-guide"><p>成長の裏付けと、<strong>日次の購入条件</strong>を確認。</p><details className="candidate-glossary"><summary>一覧の見方</summary><dl><div><dt>選定と購入条件</dt><dd>手法の条件通過は候補入り。「日次 n/7」は共通の購入条件の通過数です。買いゾーン内でも、未達・未確認があれば購入条件は通過しません。</dd></div><div><dt>ピボット・買い位置</dt><dd>ピボットは値動きから求める買い位置の基準。帯が買いゾーン、線がピボット、点が日次価格です。許容幅は手法ごとのアプリ設定です。</dd></div><div><dt>RS・出来高</dt><dd>RSは株価の相対的な強さの推計値。出来高は検証済み日足の直前50日平均に対する倍率です。未検証は「—」で表示します。RSはRSIとは異なります。</dd></div><div><dt>日次の購入条件</dt><dd>選定、市場、最新取引日、買い位置、出来高、ベース形状、決算予定を別途検証。アプリ独自の組み合わせ・閾値であり、書籍の原文や発注指示ではありません。</dd></div></dl></details></div></>}
  {!onFilters&&!compareOnly&&<div className="candidate-view-switch" role="group" aria-label="候補の表示形式"><Button aria-pressed={view==='list'} onClick={()=>onView?.('list')}>一覧</Button><Button aria-pressed={view==='charts'} onClick={()=>onView?.('charts')}>チャート比較</Button></div>}
  {view==='charts'&&!loading&&<CandidateCharts ordered={ordered} {...{method,nearOnly,date,generation,market,now,paused}} onSelect={onCompare||onSelect}/>}
  <div className="candidate-scroll" ref={scrollRef} hidden={view!=='list'}>

   <div role="list" aria-label="投資手法別の銘柄候補">{visible.map(item=><div role="listitem" key={item.row.symbol}><CandidateRow item={item} method={method} date={date} financialEpoch={financialEpoch} watched={watch.includes(item.row.symbol)} onWatch={onWatch} nearOnly={nearOnly} selected={item.row.symbol===selectedSymbol} onSelect={onSelect} onCompare={onCompare} onMove={move}/></div>)}</div>
  </div>
  {!ranked.length&&!loading&&<p className="candidate-help">該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</p>}
  {view==='list'&&maxPage>0&&<div className="candidate-pagination"><Button disabled={!current} onClick={()=>showPage(current-1)}>前の50件</Button><span>{current+1} / {maxPage+1}</span><Button disabled={current===maxPage} onClick={()=>showPage(current+1)}>次の50件</Button></div>}
 </Paper>;
});
