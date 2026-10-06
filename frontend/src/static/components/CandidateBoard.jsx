import { currentBaseCount } from '../baseCountHistory';
import CandidateCharts from './CandidateCharts';
import PositionMeter from './PositionMeter';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Paper } from '@mui/material';
import { assess, entryPlan } from '../researchEngine';
import { singleMissingCondition } from '../missingCondition';
import './nearPass.css';
import './candidateGuidance.css';
import { entryReadiness } from '../entryReadiness';
import { verifiedVolumeRatio } from '../qualificationAudit';
import { signed, times, stateKey, STATES } from '../positionGeometry';
const SORTS={rank:'選定・買い位置',distance:'ピボットに近い順',rs:'RSが高い順',volume:'出来高比が高い順',state:'状態'};
const stateOrder=state=>['zone','wait','ext','na','low','acq'].indexOf(stateKey(state));
const CandidateRow=memo(function CandidateRow({item,method,nearOnly,selected,onSelect,onCompare,onMove,now}) {
 const {row:r,assessment:a,plan:p,readiness,volume}=item,key=stateKey(p.state),[label,glyph,tone]=STATES[key];
 const dailyLabel=readiness?`日次 ${readiness.passed}/${readiness.total}`:'日次 未確認';
 const blockers=readiness?.rules.filter(rule=>rule.state!=='pass');
 // Every current blocker belongs to the same summary. A new selection unknown
 // must not hide a separate freshness, earnings, or price warning.
 const dailyDetail=readiness?.ready?'日次の購入条件をすべて通過。発注前に最新価格とリスクを確認':blockers?.length?blockers.map(rule=>`${rule.label}：${rule.state==='not_applicable'?'対象外':rule.state==='unknown'?'未確認':'未達'}。${rule.detail}`).join('。'):'分析日または市場環境が未確認';
 const missing=useMemo(()=>nearOnly?singleMissingCondition(assess(r,method,now)):null,[nearOnly,r,method,now]);
 return <button className="candidate-row" data-near-pass={nearOnly||undefined} aria-current={selected?'true':undefined} aria-label={`${r.symbol} の分析を表示。${label}。ピボット比 ${signed(p.distance)}。RS ${Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'未確認'}。出来高 ${times(volume)}。${a.applicability_label || `選定 ${a.passed}/${a.total}`}。${dailyLabel}。${dailyDetail}${nearOnly?`。${missing?.csv||'判定を再確認してください'}`:''}`} onClick={()=>onSelect(r.symbol)} onKeyDown={e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();onMove(r.symbol,e.key==='ArrowDown'?1:-1,e.currentTarget);}
  if(e.key==='Enter'&&onCompare){e.preventDefault();onCompare(r.symbol);}
 }}>
  <span className="candidate-name"><span className="candidate-name-header"><strong className="mono">{r.symbol}</strong><span className="candidate-daily-check" data-ready={readiness?.ready||undefined} title={dailyDetail}>{dailyLabel}{readiness?.ready?' ✓':''}</span></span><small title={r.company_name}>{r.company_name||'企業名未配信'}{currentBaseCount(r) != null ? ` · 推計ベース${currentBaseCount(r)}` : ''}</small></span>
  <span className="candidate-position"><PositionMeter plan={p}/><span className={`candidate-state ${['zone','wait','ext'].includes(key)?'ordinary':''}`} style={{color:`var(--${tone})`}}>{glyph} {label}</span></span>
  <span className="candidate-distance mono" style={{color:`var(--${tone})`}}>{signed(p.distance)}</span>
  <span className="candidate-rs mono"><span className="mobile-caption">RS </span>{Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'—'}</span>
  <span className="candidate-volume mono">{times(volume)}</span>
  {nearOnly&&<span className="candidate-missing" data-state={missing?.state||'unknown'} title={missing?`${missing.csv}${missing.evidence?` · ${missing.evidence}`:''}`:'公開サマリーと現在の根拠を再照合してください'}>{missing?.text||'判定資料を再確認'}</span>}
  {!a.qualified&&!nearOnly&&<span className="candidate-incomplete">{a.applicability_label || `選定 ${a.passed}/${a.total}${a.unknown ? ` · ?${a.unknown}` : ''}`}</span>}
 </button>;
});
export default memo(function CandidateBoard({ranked,method,nearOnly=false,onNearToggle,selectedSymbol,loading,onSelect,view='list',onView,date,generation,market,now,onCompare,paused,toolbar,onFilters,compareOnly=false}) {
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
 const visible=useMemo(()=>view==='list'?ordered.slice(current*50,current*50+50).map(item=>({...item,plan:item.plan||entryPlan(item.row,null,method),volume:verifiedVolumeRatio(item.row,date),readiness:date&&market?entryReadiness(item.row,date,market,now,method):null})):[],[ordered,current,method,date,market,now,view]);
 useLayoutEffect(()=>{
  if(pageStartRef.current!==current)return;
  pageStartRef.current=null;
  const scroll=scrollRef.current,first=scroll?.querySelector('.candidate-row');
  if(!first)return;
  // Only explicit pagination returns to the first row. Arrow-key navigation
  // keeps its existing target, including the previous page's final row.
  scroll.scrollTop=0;
  first.focus({preventScroll:true});
  if(window.innerWidth<=700){
   const heading=scroll.closest('.research-list')?.querySelector('.candidate-board-heading');
   const top=(heading||first).getBoundingClientRect().top,headerBottom=document.querySelector('.leader-header')?.getBoundingClientRect().bottom||0;
   // Round toward the previous pixel so a fractional target cannot tuck the heading under the fixed header.
   window.scrollTo({top:Math.max(0,Math.floor(window.scrollY+top-headerBottom)),behavior:'instant'});
  }
 },[current]);
 const showPage=useCallback(next=>{pageStartRef.current=next;setPage(next);},[]);
 const sortBy=useCallback(key=>{setSort(key);setPage(0);},[]);
 const move=useCallback((symbol,direction,element)=>{const index=ordered.findIndex(x=>x.row.symbol===symbol),next=ordered[index+direction];if(next){const scroll=element.closest('.candidate-scroll');onSelect(next.row.symbol);setPage(Math.floor((index+direction)/50));requestAnimationFrame(()=>{scroll?.querySelectorAll('.candidate-row')[(index+direction)%50]?.focus({preventScroll:false});});}},[ordered,onSelect]);
 return <Paper component="section" id="candidate-board" tabIndex={-1} aria-label="対象銘柄" className={`research-panel research-list candidate-guidance${compareOnly?' compare-only':''}`}>
  {!compareOnly&&<>{toolbar}<div className="candidate-board-heading"><h2>対象銘柄 <small>{loading?'—':ranked.length.toLocaleString()}件</small></h2><label><span className="sr-only">並び順</span><select aria-label="候補の並び順" value={sort} onChange={e=>sortBy(e.target.value)}>{Object.entries(SORTS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{onNearToggle&&<button className="near-pass-toggle" aria-pressed={nearOnly} onClick={onNearToggle}>あと1条件</button>}{onFilters&&<button onClick={onFilters} aria-label="候補を絞り込む">絞込</button>}</div>
  <div className="candidate-guide"><p>銘柄を選択して、<strong>日次の購入条件</strong>を確認。</p><details className="candidate-glossary"><summary>一覧の見方</summary><dl><div><dt>選定と購入条件</dt><dd>手法の条件通過は候補入り。「日次 n/7」は共通の購入条件の通過数です。買いゾーン内でも、未達・未確認があれば購入条件は通過しません。</dd></div><div><dt>ピボット・買い位置</dt><dd>ピボットは値動きから求める買い位置の基準。帯が買いゾーン、線がピボット、点が日次価格です。許容幅は手法ごとのアプリ設定です。</dd></div><div><dt>RS・出来高</dt><dd>RSは株価の相対的な強さの推計値。出来高は検証済み日足の直前50日平均に対する倍率です。未検証は「—」で表示します。RSはRSIとは異なります。</dd></div><div><dt>日次の購入条件</dt><dd>選定、市場、最新取引日、買い位置、出来高、ベース形状、決算予定を別途検証。アプリ独自の組み合わせ・閾値であり、書籍の原文や発注指示ではありません。</dd></div></dl></details></div></>}
  {!onFilters&&!compareOnly&&<div className="candidate-view-switch" role="group" aria-label="候補の表示形式"><Button aria-pressed={view==='list'} onClick={()=>onView?.('list')}>一覧</Button><Button aria-pressed={view==='charts'} onClick={()=>onView?.('charts')}>チャート比較</Button></div>}
  {view==='charts'&&!loading&&<CandidateCharts ordered={ordered} {...{method,nearOnly,date,generation,market,now,paused}} onSelect={onCompare||onSelect}/>}
  <div className="candidate-scroll" ref={scrollRef} hidden={view!=='list'}>
   <div className="candidate-columns" role="group" aria-label="列の並べ替え">{[['rank','銘柄'],['state','買い位置'],['distance','ピボット比'],['rs','RS'],['volume','出来高']].map(([key,label])=><button key={key} aria-label={`${label}で並べ替え`} aria-pressed={sort===key} onClick={()=>sortBy(key)}>{label}{sort===key?' ↓':''}</button>)}</div>
   <div role="list" aria-label="投資手法別の銘柄候補">{visible.map(item=><div role="listitem" key={item.row.symbol}><CandidateRow now={now} item={item} method={method} nearOnly={nearOnly} selected={item.row.symbol===selectedSymbol} onSelect={onSelect} onCompare={onCompare} onMove={move}/></div>)}</div>
  </div>
  {!ranked.length&&!loading&&<p className="candidate-help">該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</p>}
  {view==='list'&&maxPage>0&&<div className="candidate-pagination"><Button disabled={!current} onClick={()=>showPage(current-1)}>前の50件</Button><span>{current+1} / {maxPage+1}</span><Button disabled={current===maxPage} onClick={()=>showPage(current+1)}>次の50件</Button></div>}
 </Paper>;
});
