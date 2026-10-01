import CandidateCharts from './CandidateCharts';
import PositionMeter from './PositionMeter';
import { memo, useMemo, useState } from 'react';
import { Button, Paper } from '@mui/material';
import { assess, entryPlan } from '../researchEngine';
import { singleMissingCondition } from '../missingCondition';
import './nearPass.css';
import { signed, times, stateKey, STATES } from '../positionGeometry';
const SORTS={rank:'選定・買い位置',distance:'ピボットに近い順',rs:'RSが高い順',volume:'出来高比が高い順',state:'状態'};
const stateOrder=state=>['zone','wait','ext','na','low','acq'].indexOf(stateKey(state));
const CandidateRow=memo(function CandidateRow({item,method,nearOnly,selected,onSelect,onCompare,onMove}) {
 const {row:r,assessment:a,plan:p}=item,key=stateKey(p.state),[label,,tone]=STATES[key];
 const missing=useMemo(()=>nearOnly?singleMissingCondition(assess(r,method)):null,[nearOnly,r,method]);
 return <button className="candidate-row" data-near-pass={nearOnly||undefined} aria-current={selected?'true':undefined} aria-label={`${r.symbol} の分析を表示。${label}。ピボット比 ${signed(p.distance)}。RS ${r.rs_rating??'未確認'}。選定 ${a.passed}/${a.total}${nearOnly?`。${missing?.csv||'判定を再確認してください'}`:''}`} onClick={()=>onSelect(r.symbol)} onKeyDown={e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();onMove(r.symbol,e.key==='ArrowDown'?1:-1,e.currentTarget);}
  if(e.key==='Enter'&&onCompare){e.preventDefault();onCompare(r.symbol);}
 }}>
  <span className="candidate-name"><strong className="mono">{r.symbol}</strong><small title={r.company_name}>{r.company_name||'企業名未配信'}</small></span>
  <span className="candidate-position"><PositionMeter plan={p}/><span className={`candidate-state ${['zone','wait','ext'].includes(key)?'ordinary':''}`} style={{color:`var(--${tone})`}}>{label}</span></span>
  <span className="candidate-distance mono" style={{color:`var(--${tone})`}}>{signed(p.distance)}</span>
  <span className="candidate-rs mono"><span className="mobile-caption">RS </span>{Number.isFinite(r.rs_rating)?Math.round(r.rs_rating):'—'}</span>
  <span className="candidate-volume mono">{times(r.se_volume_vs_50d)}</span>
  {nearOnly&&<span className="candidate-missing" data-state={missing?.state||'unknown'} title={missing?`${missing.csv}${missing.evidence?` · ${missing.evidence}`:''}`:'公開サマリーと現在の根拠を再照合してください'}>{missing?.text||'判定資料を再確認'}</span>}
  {!a.qualified&&!nearOnly&&<span className="candidate-incomplete">{a.passed}/{a.total}{a.unknown?` · ?${a.unknown}`:''}</span>}
 </button>;
});
export default memo(function CandidateBoard({ranked,method,nearOnly=false,onNearToggle,selectedSymbol,loading,onSelect,view='list',onView,date,generation,market,now,onCompare,paused,toolbar,onFilters,compareOnly=false}) {
 const [sort,setSort]=useState('rank'),[page,setPage]=useState(0);
 const ordered=useMemo(()=>{
  const values=ranked.map(item=>({...item,plan:entryPlan(item.row,null,method)}));
  if(sort==='rank')return values;
  const value=item=>sort==='distance'?(item.plan.distance==null?null:Math.abs(item.plan.distance)):sort==='rs'?item.row.rs_rating:sort==='volume'?item.row.se_volume_vs_50d:stateOrder(item.plan.state);
  return values.sort((a,b)=>{const av=value(a),bv=value(b);return av==null?(bv==null?0:1):bv==null?-1:(av-bv)*(sort==='rs'||sort==='volume'?-1:1)||a.row.symbol.localeCompare(b.row.symbol);});
 },[ranked,method,sort]);
 const maxPage=Math.max(0,Math.ceil(ordered.length/50)-1),current=Math.min(page,maxPage);
 const sortBy=key=>{setSort(key);setPage(0);};
 const move=(symbol,direction,element)=>{const index=ordered.findIndex(x=>x.row.symbol===symbol),next=ordered[index+direction];if(next){onSelect(next.row.symbol);setPage(Math.floor((index+direction)/50));requestAnimationFrame(()=>{element.closest('.candidate-scroll')?.querySelectorAll('.candidate-row')[(index+direction)%50]?.focus({preventScroll:false});});}};
 return <Paper component="section" id="candidate-board" tabIndex={-1} aria-label="候補リスト" className={`research-panel research-list${compareOnly?' compare-only':''}`}>
  {!compareOnly&&<>{toolbar}<div className="candidate-board-heading"><h2>候補リスト <small>{loading?'—':ranked.length.toLocaleString()}件</small></h2><label><span className="sr-only">並び順</span><select aria-label="候補の並び順" value={sort} onChange={e=>sortBy(e.target.value)}>{Object.entries(SORTS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{onNearToggle&&<button className="near-pass-toggle" aria-pressed={nearOnly} onClick={onNearToggle}>あと1条件</button>}{onFilters&&<button onClick={onFilters} aria-label="候補を絞り込む">絞込</button>}</div>
  <div className="candidate-legend"><span>● ゾーン内 ◔ 待ち ▲ 超過</span><span>帯＝買いゾーン / 線＝ピボット</span></div></>}
  {!onFilters&&!compareOnly&&<div className="candidate-view-switch" role="group" aria-label="候補の表示形式"><Button aria-pressed={view==='list'} onClick={()=>onView?.('list')}>一覧</Button><Button aria-pressed={view==='charts'} onClick={()=>onView?.('charts')}>チャート比較</Button></div>}
  {view==='charts'&&!loading&&<CandidateCharts ordered={ordered} {...{method,nearOnly,date,generation,market,now,paused}} onSelect={onCompare||onSelect}/>}
  <div className="candidate-scroll" hidden={view!=='list'}>
   <div className="candidate-columns" role="group" aria-label="列の並べ替え">{[['rank','銘柄'],['state','位置'],['distance','ピボット比'],['rs','RS'],['volume','出来高']].map(([key,label])=><button key={key} aria-label={`${label}で並べ替え`} aria-pressed={sort===key} onClick={()=>sortBy(key)}>{label}{sort===key?' ↓':''}</button>)}</div>
   <div role="list" aria-label="投資手法別の銘柄候補">{ordered.slice(current*50,current*50+50).map(item=><div role="listitem" key={item.row.symbol}><CandidateRow item={item} method={method} nearOnly={nearOnly} selected={item.row.symbol===selectedSymbol} onSelect={onSelect} onCompare={onCompare} onMove={move}/></div>)}</div>
  </div>
  {!ranked.length&&!loading&&<p className="candidate-help">該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</p>}
  {view==='list'&&maxPage>0&&<div className="candidate-pagination"><Button disabled={!current} onClick={()=>setPage(current-1)}>前の50件</Button><span>{current+1} / {maxPage+1}</span><Button disabled={current===maxPage} onClick={()=>setPage(current+1)}>次の50件</Button></div>}
 </Paper>;
});
