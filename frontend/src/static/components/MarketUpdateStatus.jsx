import { useEffect, useState } from 'react';
import { marketUpdateState } from '../marketUpdateState';
import { formatPublished } from '../researchPresentation';
import MetricDisclosure from './MetricDisclosure';
import './marketUpdateStatus.css';

export default function MarketUpdateStatus({data, now: suppliedNow}) {
 const [clock,setClock]=useState(Date.now);
 useEffect(()=>{
  if(suppliedNow!==undefined)return undefined;
  const wake=()=>setClock(Date.now());
  const visible=()=>{if(document.visibilityState!=='hidden')wake();};
  const interval=setInterval(visible,30000);
  window.addEventListener('focus',wake);document.addEventListener('visibilitychange',visible);
  return()=>{clearInterval(interval);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',visible);};
 },[suppliedNow]);
 if(!data)return null;
 const state=marketUpdateState(data,suppliedNow??clock);
 const day=(state.state==='pending'?state.target:state.daily)?.slice(5).replace('-','/');
 const status=state.state==='current'?`${day} · 長期履歴反映`:state.state==='pending'?`${day} 履歴更新待ち`:`${day||'日付未確認'} · 更新状況を確認`;
 return <MetricDisclosure className="market-update-status" summary={<span data-update-state={state.state}><span aria-hidden="true">◷</span><span>{status}</span></span>}>
  <dl><div><dt>日次の分析基準日</dt><dd>{state.daily||'未確認'}</dd></div><div><dt>長期履歴の最終日</dt><dd>{state.history||'未取得'}</dd></div><div><dt>最新の取引終了日</dt><dd>{state.target||'取引カレンダー未確認'}</dd></div><div><dt>市場データの取得</dt><dd>{formatPublished(data.retrieved_at)}</dd></div></dl>
  <p>終値と取得日時は別です。休日・夏時間・短縮取引を取引カレンダーで確認します。データ配信が遅れた場合は再取得し、確認できるまで以前の観測日を保持します。個別の指数・P/Cの最終観測日は各グラフに表示します。</p>
 </MetricDisclosure>;
}
