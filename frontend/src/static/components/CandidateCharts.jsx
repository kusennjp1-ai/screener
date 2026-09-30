import { memo, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Paper } from '@mui/material';
import CandlestickChart from '../../components/Charts/CandlestickChart';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';
import { entryReadiness } from '../entryReadiness';
const money=value=>Number.isFinite(value)?`$${value.toFixed(2)}`:'—';
const Card = memo(function ComparisonCard({item,date,generation,method,market,now,sessions,onSelect,paused}) {
  const {row,plan}=item, ref=useRef(null),[visible,setVisible]=useState(false);
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'0px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[]);
  const query=useQuery({queryKey:[...staticChartKeys.payload(row.symbol,row.chart_path),generation],enabled:visible&&!paused&&Boolean(row.chart_path),staleTime:Infinity,
    queryFn:async()=>{const data=await fetchStaticChartPayload(row.chart_path);if(data.symbol!==row.symbol||data.as_of_date!==date)throw Error('Chart snapshot mismatch');return data;}});
  const invalidIdentity=query.data && (query.data.symbol!==row.symbol || query.data.as_of_date!==date);
  const bars=invalidIdentity?null:query.data?.bars, ready=entryReadiness(row,date,market,now ?? Date.now());
  const invalidHistory=row.technical_audit?.valid===false || (bars?.length && bars.at(-1).date!==date);
  const points=(bars||[]).slice(-sessions),low=Math.min(...points.map(p=>p.close)),high=Math.max(...points.map(p=>p.close));
  return <Paper ref={ref} component="article" variant="outlined" className="comparison-card" data-method={method} aria-label={`${row.symbol} 比較チャート`}>
    <div className="comparison-card-title"><Button onClick={()=>onSelect(row.symbol)}>{row.symbol} を分析</Button><strong>{money(row.current_price)}</strong></div>
    <p className="comparison-name">{row.company_name}</p>
    <div className="comparison-state"><span>価格位置：{plan.state}</span><span>ピボット比 {Number.isFinite(plan.distance)?`${plan.distance>0?'+':''}${plan.distance.toFixed(1)}%`:'—'}</span></div>
    <p className="comparison-entry">選定 {item.assessment.passed}/{item.assessment.total} · 購入条件：{ready.ready?'日次条件通過':`未達・未確認 ${(ready.rules||[]).filter(r=>r.state!=='pass').length}件`} · 共通ピボット {money(plan.pivot)}</p>
    <div className="comparison-canvas" data-active-chart={!invalidHistory&&visible&&!paused&&Boolean(bars?.length)}>
      {query.isError||invalidIdentity?<Alert severity="warning">銘柄・日付の整合性または取得状態を確認できません。</Alert>:invalidHistory?<Alert severity="warning">日足を検証できません：{row.technical_audit?.errors?.[0] || '最終日足が分析日と不一致'}。現在の比較チャートには使用しません。</Alert>:query.isSuccess&&!bars?.length?<Alert severity="info">日足データが不足しています。買い形状は確認できません。</Alert>:visible&&!paused&&bars?.length ? <CandlestickChart key={row.symbol} symbol={row.symbol} priceData={bars} rsLineData={query.data.rs_line||[]} rsRatingValue={row.rs_rating} compact researchView comparisonSessions={sessions} interactive={false} pivotPrice={plan.pivot} height={330} /> :
        <div className="comparison-placeholder">{points.length>1&&<svg viewBox="0 0 300 100" role="img" aria-label={`${row.symbol} 終値のサムネイル`}><polyline fill="none" stroke="currentColor" strokeWidth="2" points={points.map((p,i)=>`${i*300/(points.length-1)},${95-(p.close-low)/(high-low||1)*90}`).join(' ')} /></svg>}<span>{!row.chart_path?'チャート未配信':query.isFetching?'チャートを読み込み中…':'表示位置でチャートを描画します'}</span></div>}
    </div>
    <div className="comparison-foot"><span>日次 {date} / {sessions}営業日</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a></div>
  </Paper>;
});
export default function CandidateCharts({ordered,method,date,generation,market,now,onSelect,paused}) {
  const [page,setPage]=useState(0),[sessions,setSessions]=useState(63);
  const current=Math.min(page,Math.max(0,Math.ceil(ordered.length/6)-1));
  return <div className="candidate-comparison">
    <div className="comparison-controls"><label>全チャートの期間 <select value={sessions} onChange={e=>setSessions(Number(e.target.value))}><option value={21}>1か月</option><option value={63}>3か月</option><option value={126}>6か月</option><option value={252}>1年</option></select></label><span>同時に最大6銘柄 · 縦軸は各銘柄で調整</span></div>
    <div className="comparison-grid">{ordered.slice(current*6,current*6+6).map(item=><Card key={item.row.symbol} {...{item,method,date,generation,market,now,sessions,onSelect,paused}} />)}</div>
    {!ordered.length&&<p>条件に一致する銘柄はありません。</p>}
    <div className="candidate-pagination"><Button disabled={!current} onClick={()=>setPage(current-1)}>前の6銘柄</Button><span>{ordered.length?current*6+1:0}–{Math.min((current+1)*6,ordered.length)} / {ordered.length}</span><Button disabled={(current+1)*6>=ordered.length} onClick={()=>setPage(current+1)}>次の6銘柄</Button></div>
  </div>;
}
