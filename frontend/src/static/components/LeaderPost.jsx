import { memo, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PositionMeter from './PositionMeter';
import { signed, times, stateKey, STATES } from '../positionGeometry';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';
import { requireChartIdentity } from '../chartPayloadIdentity';
import { auditValues, hasVerifiedDailyBars } from '../qualificationAudit';
import { invalidChartHistory } from '../../components/Charts/researchChartModel';
import { singleMissingCondition } from '../missingCondition';

const CONDITION_LABELS={pass:'達成',fail:'未達',unknown:'未確認',not_applicable:'対象外'};
const CONDITION_ICONS={pass:'✓',fail:'×',unknown:'?',not_applicable:'—'};
export function RSRing({value}) {
 const valid=Number.isFinite(value)&&value>=0&&value<=100;
 return <span className="leader-rs-ring">
  <svg viewBox="0 0 48 48" width="48" height="48" role="img" aria-label={valid?`RS ${Math.round(value)}（独自推計）`:'RS データなし'}>
   <circle cx="24" cy="24" r="20" fill="none" stroke="var(--line)" strokeWidth="3"/>
   {valid&&<circle cx="24" cy="24" r="20" fill="none" stroke="var(--accent)" strokeWidth="3" pathLength="100" strokeDasharray={`${value} ${100-value}`} transform="rotate(-90 24 24)"/>}
   <text x="24" y="28" textAnchor="middle" fill="currentColor" fontSize="14">{valid?Math.round(value):'—'}</text>
  </svg><span>RS{valid?'':' データなし'}</span>
 </span>;
}
export function DailyConditionStrip({readiness}) {
 if(!Array.isArray(readiness?.rules)||!readiness.rules.length)return <span className="leader-daily-empty">日次条件：データなし</span>;
 return <span className="leader-condition-strip" role="group" aria-label={`日次条件 ${readiness.passed}/${readiness.total}`}>
  {readiness.rules.map((rule,index)=><span key={rule.id||index} data-state={rule.state} title={`${rule.label}：${CONDITION_LABELS[rule.state]||'未確認'}`} aria-label={`${rule.label}：${CONDITION_LABELS[rule.state]||'未確認'}`}>{CONDITION_ICONS[rule.state]||'?'}</span>)}
 </span>;
}
// Geometry is presentation-only: no resampling, smoothing or fabricated points.
export function PriceSparkline({bars,symbol}) {
 if(!Array.isArray(bars)||bars.length<2||bars.some(bar=>!Number.isFinite(bar.close)))return <span className="leader-chart-empty">チャート：データなし</span>;
 const visible=bars.slice(-63),values=visible.map(bar=>bar.close),min=Math.min(...values),max=Math.max(...values),range=max-min;
 const points=visible.map((bar,index)=>`${4+index/(visible.length-1)*272},${range?48-(bar.close-min)/range*40:28}`).join(' ');
 return <svg className="leader-mini-chart" viewBox="0 0 280 56" role="img" aria-label={`${symbol} 実日足の終値 ${visible[0].date}〜${visible.at(-1).date}`}><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.75" vectorEffect="non-scaling-stroke"/><title>{symbol} 日次終値。装飾用の補間なし。</title></svg>;
}
export function FeedMiniChart(props) {
 if(!props.row.chart_path)return <span className="leader-mini-chart-slot"><span className="leader-chart-empty">チャート：データなし</span></span>;
 return <LoadedFeedMiniChart {...props}/>;
}
function LoadedFeedMiniChart({row,date,generation}) {
 const ref=useRef(null),[visible,setVisible]=useState(false);
 useEffect(()=>{if(typeof IntersectionObserver!=='function')return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'120px'});observer.observe(ref.current);return()=>observer.disconnect();},[]);
 const verified=Boolean(date)&&hasVerifiedDailyBars(row,date);
 const query=useQuery({queryKey:[...staticChartKeys.payload(row.symbol,row.chart_path),generation],enabled:visible&&verified&&Boolean(row.chart_path),staleTime:60000,placeholderData:()=>undefined,queryFn:()=>fetchStaticChartPayload(row.chart_path,{generation}),select:payload=>requireChartIdentity(payload,row.symbol,date)});
 const bars=query.data?.bars,ready=verified&&!query.isError&&bars?.length&&!invalidChartHistory(bars);
 return <span className="leader-mini-chart-slot" ref={ref}>{ready?<PriceSparkline bars={bars} symbol={row.symbol}/>:<span className="leader-chart-empty">{visible&&query.isLoading&&row.chart_path&&verified?'日足を読み込み中…':'チャート：データなし'}{!verified?'（未検証）':''}</span>}</span>;
}
export default memo(function LeaderPost({item,date,generation,nearOnly=false,missingCondition}) {
 const {row,assessment,plan,readiness,volume}=item,[label,glyph,tone]=STATES[stateKey(plan.state)];
 const change=date&&hasVerifiedDailyBars(row,date)?auditValues(row).change:null;
 const blockers=readiness?.rules.filter(rule=>rule.state!=='pass');
 const dailyDetail=readiness?.ready?'日次の購入条件をすべて通過。発注前に最新価格とリスクを確認':blockers?.length?blockers.map(rule=>`${rule.label}：${CONDITION_LABELS[rule.state]||'未確認'}。${rule.detail}`).join('。'):'分析日または市場環境が未確認';
 const missing=nearOnly&&!assessment.financial_exclusion?(missingCondition??singleMissingCondition(assessment)):null;
 const unknown=readiness?.unknown??readiness?.rules?.filter(rule=>rule.state==='unknown').length;
 const failed=readiness?.failed??readiness?.rules?.filter(rule=>rule.state==='fail').length;
 return <span className="leader-post">
  <span className="leader-post-avatar" aria-hidden="true">{row.symbol}</span>
  <span className="leader-post-body">
   <span className="leader-post-identity"><strong>{row.company_name||'企業名データなし'}</strong><span>@{row.symbol} · {date||'基準日なし'}</span></span>
   <span className="leader-post-judgment"><span style={{color:`var(--${tone})`}}>{glyph} {label}</span><span><span className="leader-daily-badge candidate-daily-check" title={dailyDetail} data-ready={readiness?.ready||undefined}>{readiness?`日次条件 ${readiness.passed}/${readiness.total}${readiness.ready?' ✓':''}`:'日次 未確認'}</span>{readiness&&!readiness.ready&&<span> · 未達 {failed??'—'} / 未確認 {unknown??'—'}</span>}</span></span>
   <span className="leader-post-metrics"><RSRing value={row.rs_rating}/><span><small>出来高比</small><strong>{Number.isFinite(volume)?times(volume):'データなし'}</strong></span><span><small>前日比</small><strong className="leader-post-change" style={{color:Number.isFinite(change)?`var(--${change>=0?'zone':'neg'})`:undefined}}>{Number.isFinite(change)?signed(change):'データなし'}</strong></span><span className="leader-post-position"><PositionMeter plan={plan}/><span>ピボット比 {Number.isFinite(plan.distance)?signed(plan.distance):'データなし'} · 上限 {Number.isFinite(plan.zone)?`+${plan.zone}%`:'データなし'}</span></span><FeedMiniChart row={row} date={date} generation={generation}/></span>
   <DailyConditionStrip readiness={readiness}/>
   <span className="leader-post-evidence">{assessment.financial_exclusion?.label||assessment.applicability_label||`選定 ${assessment.passed}/${assessment.total}${assessment.unknown?` · 未確認 ${assessment.unknown}`:''}`}{nearOnly&&!assessment.financial_exclusion&&<span className="candidate-missing" data-state={missing?.state||'unknown'} title={missing?`${missing.csv}${missing.evidence?` · ${missing.evidence}`:''}`:'公開サマリーと現在の根拠を再照合してください'}>{missing?.text||'判定資料を再確認'}</span>}<span>条件・チャートを見る →</span></span>
  </span>
 </span>;
});
