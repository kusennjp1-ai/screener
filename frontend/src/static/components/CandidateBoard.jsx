import CandidateCharts from './CandidateCharts';
import CandidateFeedCard from './CandidateFeedCard';
import ResearchCandidateTable from './ResearchCandidateTable';
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
import { orderCandidates } from '../candidateOrdering';
import { normalizeFeedSize, pageForFeedSize } from '../researchFeedPaging';
const SORTS={rank:'選定・買い位置',distance:'ピボットに近い順',rs:'RSが高い順',volume:'出来高比が高い順',state:'状態'};
const METHOD_NAMES={minervini:'ミネルヴィニ',minervini2:'基本と原則',oneil:'オニール',ibd:'IBD型'};
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
export default memo(function CandidateBoard({ranked,method,nearOnly=false,onNearToggle,selectedSymbol,loading,onSelect,onHighlight,view='list',onView,onSortChange,feedSize,onFeedSizeChange,date,generation,market,now,financialEpoch=now,onCompare,paused,toolbar,filterChips,onFilters,filterCount,watch=[],onWatch,compareOnly=false}) {
 const [sort,setSort]=useState('rank'),[pagination,setPagination]=useState(()=>({size:normalizeFeedSize(feedSize),page:0}));
 const pageSize=feedSize===undefined?pagination.size:normalizeFeedSize(feedSize);
 const scrollRef=useRef(null),pageStartRef=useRef(null),sizeSelectRef=useRef(null),committedSizeRef=useRef(pageSize);
 const ordered=useMemo(()=>orderCandidates(ranked,{sort,method,date}),[ranked,method,sort,date]);
 const page=pageSize===pagination.size?pagination.page:pageForFeedSize(ordered,selectedSymbol,pagination.page,pagination.size,pageSize);
 // Adjust before committing a changed URL preference so neither an old page
 // nor a transient 20-card page appears during an explicit 50-card load.
 if(pageSize!==pagination.size)setPagination({size:pageSize,page});
 const maxPage=Math.max(0,Math.ceil(ordered.length/pageSize)-1),current=Math.min(page,maxPage);
 const rangeStart=ordered.length?current*pageSize+1:0,rangeEnd=Math.min((current+1)*pageSize,ordered.length);
 // Only the visible list page needs live daily checks. Selection, pagination,
 // and chart mode must not reevaluate the full screening universe.
 const pagedView=view!=='charts';
 const pageRows=useMemo(()=>pagedView?ordered.slice(current*pageSize,(current+1)*pageSize):[],[ordered,current,pageSize,pagedView]);
 // The page supplies a guarded bundle epoch. Keep financial presentation stable
 // across quote/readiness ticks, and rebuild on its own expiry or replacement.
 const withGrowth=useMemo(()=>pageRows.map(item=>{
  const presentation=financialEvidencePresentation({evidence:buildFinancialEvidencePresentation(item.row,{method,date,generation,now:financialEpoch}),history:item.row.financial_history,symbol:item.row.symbol,date,generation,method,now:financialEpoch});
  const selection=item.assessment.rules?item.assessment:(!item.assessment.qualified||nearOnly)?assess(item.row,method,financialEpoch):null;
  return {...item,plan:item.plan||entryPlan(item.row,null,method),volume:verifiedVolumeRatio(item.row,date),growth:presentation.rows.slice(0,2),annual:presentation.rows.find(row=>row.id==='annual_eps_growth_3y'),selectionRules:selection?.rules||[],missing:nearOnly?singleMissingCondition(selection):null};
 }),[pageRows,method,date,generation,financialEpoch,nearOnly]);
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
 const sortBy=useCallback(key=>{setSort(key);setPagination(previous=>({...previous,page:0}));onSortChange?.(key);},[onSortChange]);
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
  {!compareOnly&&<>{toolbar}<div className="candidate-board-heading"><h2>{METHOD_NAMES[method]} <small>候補 {loading?'—':ranked.length.toLocaleString()}件</small></h2><label><span className="sr-only">並び順</span><select aria-label="候補の並び順" value={sort} onChange={e=>sortBy(e.target.value)}>{Object.entries(SORTS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{onNearToggle&&<button className="near-pass-toggle" aria-pressed={nearOnly} onClick={onNearToggle}>あと1条件</button>}{onFilters&&<button onClick={onFilters} aria-label="候補を絞り込む">絞込{Number.isInteger(filterCount)?` ${filterCount}`:''}</button>}</div>
  <div className="candidate-filter-context">{filterChips}<div className="candidate-guide"><details className="candidate-glossary"><summary>一覧の見方</summary><p>基準日の現在状態です。状態の変化や新着イベントを示すものではありません。</p><dl><div><dt>選定条件と日次確認</dt><dd>手法の条件通過は候補入り。「日次確認 n/7」は選定手法とは別の共通購入モデルへの適合を含む通過数です。買いゾーン内でも、未達・未確認があれば購入条件は通過しません。</dd></div><div><dt>ピボット・買い位置</dt><dd>ピボットは値動きから求める買い位置の基準。価格位置と日足の推移は別に表示します。許容幅は手法ごとのアプリ設定です。</dd></div><div><dt>RS・出来高</dt><dd>RSは株価の相対的な強さの推計値。出来高は検証済み日足の直前50日平均に対する倍率です。未検証は「—」で表示します。RSはRSIとは異なります。</dd></div><div><dt>日次確認</dt><dd>共通購入モデル（ミネルヴィニとIBD型の両方）、市場、最新取引日、買い位置、出来高、ベース形状、決算予定を別途検証。アプリ独自の組み合わせ・閾値であり、書籍の原文や発注指示ではありません。</dd></div></dl></details></div></div></>}
  {!onFilters&&!compareOnly&&<div className="candidate-view-switch" role="group" aria-label="候補の表示形式"><Button aria-pressed={view==='list'} onClick={()=>onView?.('list')}>フィード</Button><Button aria-pressed={view==='table'} onClick={()=>onView?.('table')}>表</Button><Button aria-pressed={view==='charts'} onClick={()=>onView?.('charts')}>チャート比較</Button></div>}
  {view==='charts'&&!loading&&<CandidateCharts ordered={ordered} {...{method,nearOnly,date,generation,market,now,paused}} onSelect={onCompare||onSelect}/>}
  <div className="candidate-scroll" ref={scrollRef} hidden={view==='charts'}>

   <div hidden={view!=='list'} role="list" aria-label="投資手法別の銘柄候補">{view==='list'&&visible.map((item,index)=><div role="listitem" key={item.row.symbol} data-feed-symbol={item.row.symbol} aria-posinset={current*pageSize+index+1} aria-setsize={ordered.length}><CandidateFeedCard item={item} date={date} watched={watch.includes(item.row.symbol)} onWatch={onWatch} nearOnly={nearOnly} selected={item.row.symbol===selectedSymbol} onSelect={onSelect} onCompare={onCompare} onMove={move}/></div>)}</div>
   {view==='table'&&<ResearchCandidateTable items={visible} {...{method,date,selectedSymbol,onSelect,onCompare,onWatch,watch}} onMove={move}/>}
  </div>
  {!ranked.length&&!loading&&<p className="candidate-help">該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</p>}
  {view!=='charts'&&<nav className="candidate-pagination feed-pagination" aria-label="候補のページ切り替え">
   <div className="feed-page-summary"><span role="status" aria-live="polite" aria-atomic="true">全{ordered.length.toLocaleString()}銘柄中{rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}</span><label>表示 <select ref={sizeSelectRef} aria-label="1ページの銘柄数" value={pageSize} onChange={e=>changePageSize(e.target.value)}><option value={20}>20件</option><option value={50}>50件</option></select></label></div>
   <div className="feed-page-navigation"><Button disabled={!current} onClick={()=>showPage(current-1)}>前の{pageSize}件</Button><label><span className="sr-only">ページ</span><select aria-label="候補のページ" value={current} disabled={!ordered.length} onChange={e=>showPage(Number(e.target.value))}>{Array.from({length:maxPage+1},(_,index)=><option key={index} value={index}>{index+1} / {maxPage+1}</option>)}</select></label><Button disabled={current===maxPage} onClick={()=>showPage(current+1)}>次の{pageSize}件</Button></div>
  </nav>}
 </Paper>;
});
