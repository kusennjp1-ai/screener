import CandidateCharts from './CandidateCharts';
import ResearchDecisionStatus from './ResearchDecisionStatus';
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
import { normalizeFeedSize, pageForFeedSize } from '../researchFeedPaging';
const SORTS={rank:'選定・買い位置',distance:'ピボットに近い順',rs:'RSが高い順',volume:'出来高比が高い順',state:'状態'};
const METHOD_NAMES={minervini:'ミネルヴィニ',minervini2:'基本と原則',oneil:'オニール',ibd:'IBD型'};
const stateOrder=state=>['zone','wait','ext','na','low','acq'].indexOf(stateKey(state));
function revealKeyboardTarget(target) {
 if(!target?.isConnected)return;
 const header=document.querySelector('.leader-header')?.getBoundingClientRect();
 const nav=document.querySelector('.leader-mobile-nav')?.getBoundingClientRect();
 const top=Math.max(0,header?.bottom||0),bottom=nav?.height?Math.min(window.innerHeight,nav.top):window.innerHeight;
 const offset=(visibleTop,visibleBottom)=>{
  const bounds=target.getBoundingClientRect();
  if(!bounds.height||visibleBottom-visibleTop<bounds.height)return 0;
  // Native focus scrolling can round a fractional edge out of view, and it
  // cannot see the fixed mobile nav. Leave room for the focus ring as well.
  if(bounds.top<visibleTop)return Math.floor(bounds.top-visibleTop-8);
  if(bounds.bottom>visibleBottom)return Math.ceil(bounds.bottom-visibleBottom+8);
  return 0;
 };
 const scroll=target.closest('.candidate-scroll');
 if(scroll&&/auto|scroll/.test(getComputedStyle(scroll).overflowY)&&scroll.scrollHeight>scroll.clientHeight){
  const bounds=scroll.getBoundingClientRect();
  scroll.scrollTop+=offset(Math.max(top,bounds.top),Math.min(bottom,bounds.bottom));
 }
 const delta=offset(top,bottom);
 if(delta)window.scrollBy({top:delta,behavior:'instant'});
}
function CandidatePriceTrace({trace,date,symbol}) {
 const [failed,setFailed]=useState(false);
 const available=!failed&&trace?.status==='available'&&trace.asOfDate===date&&typeof trace.src==='string';
 return <span className="feed-price-trace">{available?<><img src={getStaticDataUrl(trace.src)} loading="lazy" decoding="async" width="360" height="64" alt={`${symbol} ${trace.caption}`} onError={()=>setFailed(true)}/><small>{trace.caption}</small></>:<span className="feed-trace-unavailable">価格推移 未確認<small>対応する日足・対象期間の根拠が未配信</small></span>}</span>;
}
const CandidateRow=memo(function CandidateRow({item,method,date,financialEpoch,nearOnly,selected,onSelect,onCompare,onMove,watched,onWatch}) {
 const {row:r,assessment:a,plan:p,readiness,volume,growth,annual}=item,[label]=STATES[stateKey(p.state)];
 const dailyLabel=readiness?`日次確認 ${readiness.passed}/${readiness.total}`:'日次確認 未確認';
 const blockers=readiness?.rules.filter(rule=>rule.state!=='pass')||[];
 const nextCheck=blockers[0];
 const annualBlocker=annual?.required&&annual.state!=='pass';
 const remainingChecks=annualBlocker?blockers:blockers.slice(1);
 const additionalChecks=remainingChecks.map(rule=>`${rule.label}：${rule.state==='unknown'?'未確認':'未達'}`).join('。');
 const dailyDetail=readiness?.ready?'発注前に最新価格とリスクを確認':nextCheck?`${nextCheck.label}：${nextCheck.state==='unknown'?'未確認':'未達'}`:'分析日または市場環境が未確認';
 const missing=useMemo(()=>nearOnly?singleMissingCondition(assess(r,method,financialEpoch)):null,[nearOnly,r,method,financialEpoch]);
 return <article className="candidate-feed-card" data-selected={selected||undefined} data-near-pass={nearOnly||undefined}>
  <button className="candidate-row" aria-current={selected?'true':undefined} aria-label={`${r.symbol} の分析を表示。価格位置 ${label}。ピボット比 ${signed(p.distance)}。RS ${Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'未確認'}。出来高 ${times(volume)}。選定条件 ${a.passed}/${a.total}。${dailyLabel}。${dailyDetail}${annualBlocker?`。必須 年次EPS ${annual.state==='fail'?'未達':'未確認'}`:''}${additionalChecks?`。${additionalChecks}`:''}${nearOnly?`。${missing?.csv||'判定を再確認してください'}`:''}`} onClick={()=>onSelect(r.symbol)} onKeyDown={e=>{
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();onMove(r.symbol,e.key==='ArrowDown'?1:-1,e.currentTarget);}
   if(e.key==='Enter'&&onCompare){e.preventDefault();onCompare(r.symbol);}
  }}>
   <span className="feed-identity"><span className="feed-monogram" aria-hidden="true">{r.symbol.slice(0,2)}</span><span className="candidate-name"><strong className="mono">{r.symbol}</strong><small title={r.company_name}>{r.company_name||'企業名未配信'}</small></span><span className="feed-price"><strong className="mono">{money(p.price)}</strong><small>{signed(r.price_change_1d)} 前日比</small></span></span>

  </button>
  <div className="feed-card-evidence">
   <ResearchDecisionStatus assessment={a} readiness={readiness} plan={p} annual={annual}/>
   <div className="feed-growth">{growth.map(row=><FinancialGrowthMetric key={row.id} row={row} compact/>)}</div>
   {nearOnly&&<span className="feed-missing" data-state={missing?.state||'unknown'}>{missing?.text||'判定資料を再確認'}</span>}
   <span className="feed-next-check"><strong>次に確認</strong><span>{annualBlocker?`年次EPS：${annual.state==='fail'?'未達':'未確認'}`:dailyDetail}</span></span>
   {additionalChecks&&<div className="feed-other-checks" aria-label="ほかの未達・未確認">{remainingChecks.map(rule=><span key={rule.id} data-state={rule.state}>{rule.label}：{rule.state==='unknown'?'未確認':'未達'}</span>)}</div>}
   <button className="feed-open-evidence" onClick={()=>onSelect(r.symbol)} aria-label={`${r.symbol} の財務・日次根拠を見る`}>根拠を見る →</button>
   <CandidatePriceTrace key={`${date}:${r.priceTrace?.src||r.symbol}`} trace={r.priceTrace} date={date} symbol={r.symbol}/>
  </div>
  <footer className="feed-card-footer"><span>価格 {date||'未確認'} 終値 · RS {Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'未確認'} · 日次出来高 {times(volume)}</span><div>{onCompare&&<button onClick={()=>onCompare(r.symbol)} aria-label={`${r.symbol} のチャートを開く`}>チャート</button>}{onWatch&&<button className="feed-watch" onClick={()=>onWatch(r.symbol)} aria-label={`${r.symbol} ${watched?'ウォッチ解除':'ウォッチに保存'}`} aria-pressed={watched}>{watched?'★':'☆'}</button>}</div></footer>
 </article>;
});
export default memo(function CandidateBoard({ranked,method,nearOnly=false,onNearToggle,selectedSymbol,loading,onSelect,onHighlight,view='list',onView,feedSize,onFeedSizeChange,date,generation,market,now,financialEpoch=now,onCompare,paused,toolbar,filterChips,onFilters,watch=[],onWatch,compareOnly=false}) {
 const [sort,setSort]=useState('rank'),[pagination,setPagination]=useState(()=>({size:normalizeFeedSize(feedSize),page:0}));
 const pageSize=feedSize===undefined?pagination.size:normalizeFeedSize(feedSize);
 const scrollRef=useRef(null),pageStartRef=useRef(null),sizeSelectRef=useRef(null),committedSizeRef=useRef(pageSize);
 const ordered=useMemo(()=>{
  if(sort==='rank')return ranked;
  const values=ranked.map(item=>({...item,plan:entryPlan(item.row,null,method)}));
  const value=item=>sort==='distance'?(item.plan.distance==null?null:Math.abs(item.plan.distance)):sort==='rs'?item.row.rs_rating:sort==='volume'?verifiedVolumeRatio(item.row,date):stateOrder(item.plan.state);
  return values.sort((a,b)=>{const av=value(a),bv=value(b);return av==null?(bv==null?0:1):bv==null?-1:(av-bv)*(sort==='rs'||sort==='volume'?-1:1)||a.row.symbol.localeCompare(b.row.symbol);});
 },[ranked,method,sort,date]);
 const page=pageSize===pagination.size?pagination.page:pageForFeedSize(ordered,selectedSymbol,pagination.page,pagination.size,pageSize);
 // Adjust before committing a changed URL preference so neither an old page
 // nor a transient 20-card page appears during an explicit 50-card load.
 if(pageSize!==pagination.size)setPagination({size:pageSize,page});
 const maxPage=Math.max(0,Math.ceil(ordered.length/pageSize)-1),current=Math.min(page,maxPage);
 const rangeStart=ordered.length?current*pageSize+1:0,rangeEnd=Math.min((current+1)*pageSize,ordered.length);
 // Only the visible list page needs live daily checks. Selection, pagination,
 // and chart mode must not reevaluate the full screening universe.
 const pageRows=useMemo(()=>view==='list'?ordered.slice(current*pageSize,(current+1)*pageSize):[],[ordered,current,pageSize,view]);
 // The page supplies a guarded bundle epoch. Keep financial presentation stable
 // across quote/readiness ticks, and rebuild on its own expiry or replacement.
 const withGrowth=useMemo(()=>pageRows.map(item=>{
  const presentation=financialEvidencePresentation({evidence:buildFinancialEvidencePresentation(item.row,{method,date,generation,now:financialEpoch}),history:item.row.financial_history,symbol:item.row.symbol,date,generation,method,now:financialEpoch});
  return {...item,plan:item.plan||entryPlan(item.row,null,method),volume:verifiedVolumeRatio(item.row,date),growth:presentation.rows.slice(0,2),annual:presentation.rows.find(row=>row.id==='annual_eps_growth_3y')};
 }),[pageRows,method,date,generation,financialEpoch]);
 const visible=useMemo(()=>withGrowth.map(item=>({...item,readiness:date&&market?entryReadiness(item.row,date,market,now,method):null})),[withGrowth,method,date,market,now]);
 useLayoutEffect(()=>{
  const sizeChanged=committedSizeRef.current!==pageSize;
  committedSizeRef.current=pageSize;
  // A controlled preference may be delayed or rejected. Only an accepted
  // size can move focus, and only while the reader is still on that control.
  const request=sizeChanged&&document.activeElement===sizeSelectRef.current?{page:current,symbol:selectedSymbol}:pageStartRef.current;
  if(!request||request.page!==current)return;
  pageStartRef.current=null;
  const scroll=scrollRef.current,first=scroll?.querySelector('.candidate-row');
  if(!first)return;
  const selected=request.symbol&&[...scroll.querySelectorAll('[data-feed-symbol]')].find(item=>item.dataset.feedSymbol===request.symbol)?.querySelector('.candidate-row');
  if(selected){selected.focus({preventScroll:false});revealKeyboardTarget(selected);return;}
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
 },[current,pageSize,selectedSymbol]);
 const showPage=useCallback(next=>{pageStartRef.current={page:next};setPagination({size:pageSize,page:next});},[pageSize]);
 const changePageSize=useCallback(value=>{
  const size=normalizeFeedSize(value);
  if(size===pageSize)return;
  if(feedSize!==undefined){onFeedSizeChange?.(size);return;}
  const next=pageForFeedSize(ordered,selectedSymbol,current,pageSize,size);
  pageStartRef.current={page:next,symbol:selectedSymbol};
  setPagination({size,page:next});onFeedSizeChange?.(size);
 },[ordered,selectedSymbol,current,pageSize,feedSize,onFeedSizeChange]);
 const sortBy=useCallback(key=>{setSort(key);setPagination(previous=>({...previous,page:0}));},[]);
 const revealAfterTab=useCallback(event=>{
  if(event.key!=='Tab')return;
  const board=event.currentTarget;
  // Let the browser choose the next/previous action first. Deliberately keep
  // this on keyboard navigation: Back restores focus with preventScroll and
  // must retain the reader's saved evidence position.
  requestAnimationFrame(()=>{if(board.contains(document.activeElement))revealKeyboardTarget(document.activeElement);});
 },[]);
 const move=useCallback((symbol,direction,element)=>{const index=ordered.findIndex(x=>x.row.symbol===symbol),next=ordered[index+direction];if(next){const scroll=element.closest('.candidate-scroll');(onHighlight||onSelect)(next.row.symbol);setPagination({size:pageSize,page:Math.floor((index+direction)/pageSize)});requestAnimationFrame(()=>{const target=scroll?.querySelectorAll('.candidate-row')[(index+direction)%pageSize];target?.focus({preventScroll:false});revealKeyboardTarget(target);});}},[ordered,onSelect,onHighlight,pageSize]);
 return <Paper component="section" id="candidate-board" tabIndex={-1} aria-label="候補リスト" data-feed-evaluated-at={financialEpoch} data-feed-method={method} data-feed-page-size={pageSize} data-feed-total={ordered.length} data-feed-start={rangeStart} data-feed-end={rangeEnd} data-feed-selected-symbol={selectedSymbol||''} onKeyDownCapture={revealAfterTab} className={`research-panel research-list candidate-guidance candidate-feed${compareOnly?' compare-only':''}`}>
  {!compareOnly&&<>{toolbar}<div className="candidate-board-heading"><h2>{METHOD_NAMES[method]} <small>候補 {loading?'—':ranked.length.toLocaleString()}件</small></h2><label><span className="sr-only">並び順</span><select aria-label="候補の並び順" value={sort} onChange={e=>sortBy(e.target.value)}>{Object.entries(SORTS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{onNearToggle&&<button className="near-pass-toggle" aria-pressed={nearOnly} onClick={onNearToggle}>あと1条件</button>}{onFilters&&<button onClick={onFilters} aria-label="候補を絞り込む">絞込</button>}</div>
  <div className="candidate-filter-context">{filterChips}<div className="candidate-guide"><details className="candidate-glossary"><summary>一覧の見方</summary><p>成長の裏付けと、<strong>日次確認</strong>を確認。</p><dl><div><dt>選定条件と日次確認</dt><dd>手法の条件通過は候補入り。「日次確認 n/7」は共通の購入条件の通過数です。買いゾーン内でも、未達・未確認があれば購入条件は通過しません。</dd></div><div><dt>ピボット・買い位置</dt><dd>ピボットは値動きから求める買い位置の基準。帯が買いゾーン、線がピボット、点が日次価格です。許容幅は手法ごとのアプリ設定です。</dd></div><div><dt>RS・出来高</dt><dd>RSは株価の相対的な強さの推計値。出来高は検証済み日足の直前50日平均に対する倍率です。未検証は「—」で表示します。RSはRSIとは異なります。</dd></div><div><dt>日次確認</dt><dd>選定、市場、最新取引日、買い位置、出来高、ベース形状、決算予定を別途検証。アプリ独自の組み合わせ・閾値であり、書籍の原文や発注指示ではありません。</dd></div></dl></details></div></div></>}
  {!onFilters&&!compareOnly&&<div className="candidate-view-switch" role="group" aria-label="候補の表示形式"><Button aria-pressed={view==='list'} onClick={()=>onView?.('list')}>一覧</Button><Button aria-pressed={view==='charts'} onClick={()=>onView?.('charts')}>チャート比較</Button></div>}
  {view==='charts'&&!loading&&<CandidateCharts ordered={ordered} {...{method,nearOnly,date,generation,market,now,paused}} onSelect={onCompare||onSelect}/>}
  <div className="candidate-scroll" ref={scrollRef} hidden={view!=='list'}>

   <div role="list" aria-label="投資手法別の銘柄候補">{visible.map((item,index)=><div role="listitem" key={item.row.symbol} data-feed-symbol={item.row.symbol} aria-posinset={current*pageSize+index+1} aria-setsize={ordered.length}><CandidateRow item={item} method={method} date={date} financialEpoch={financialEpoch} watched={watch.includes(item.row.symbol)} onWatch={onWatch} nearOnly={nearOnly} selected={item.row.symbol===selectedSymbol} onSelect={onSelect} onCompare={onCompare} onMove={move}/></div>)}</div>
  </div>
  {!ranked.length&&!loading&&<p className="candidate-help">該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</p>}
  {view==='list'&&<nav className="candidate-pagination feed-pagination" aria-label="候補のページ切り替え">
   <div className="feed-page-summary"><span role="status" aria-live="polite" aria-atomic="true">全{ordered.length.toLocaleString()}銘柄中{rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}</span><label>表示 <select ref={sizeSelectRef} aria-label="1ページの銘柄数" value={pageSize} onChange={e=>changePageSize(e.target.value)}><option value={20}>20件</option><option value={50}>50件</option></select></label></div>
   <div className="feed-page-navigation"><Button disabled={!current} onClick={()=>showPage(current-1)}>前の{pageSize}件</Button><label><span className="sr-only">ページ</span><select aria-label="候補のページ" value={current} disabled={!ordered.length} onChange={e=>showPage(Number(e.target.value))}>{Array.from({length:maxPage+1},(_,index)=><option key={index} value={index}>{index+1} / {maxPage+1}</option>)}</select></label><Button disabled={current===maxPage} onClick={()=>showPage(current+1)}>次の{pageSize}件</Button></div>
  </nav>}
 </Paper>;
});
