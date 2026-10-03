import { useState } from 'react';
import { Alert, Button, Paper } from '@mui/material';
import { CHANGE_LABELS } from '../candidateHistory';
import { dailyChangePresentation } from '../dailyChangePresentation';
const display=tuple=>!tuple?'—':`${({pass:'通過',fail:'未通過',unknown:'未確認'})[tuple[0]]} · ${typeof tuple[1]==='boolean'?(tuple[1]?'はい':'いいえ'):tuple[1]??'—'}${tuple[2]?` (${tuple[2]})`:''}`;
export default function DailyChanges({query,method,onSelect,availableSymbols}) {
  const [selectedKind,setKind]=useState(null),[page,setPage]=useState(0);
  if(query.isError) return <Alert severity="warning">候補の変化を取得できません。脱落とは扱いません。</Alert>;
  const data=query.data, summary=data?.changes?.[method];
  const presentation=dailyChangePresentation(query,method);
  if(!presentation.ready || !Array.isArray(summary?.items)) return <p role="status">候補の変化の内訳を読み込み中… 未取得を0件とは扱いません。</p>;
  const kind=selectedKind ?? (presentation.fullyIncomparable?'incomparable':'new');
  const items=summary.items.filter(i=>i.state===kind);
  const current=Math.min(page,Math.max(0,Math.ceil(items.length/20)-1));
  return <Paper component="section" className="daily-changes" variant="outlined" aria-label="候補の日次変化">
    <div className="daily-changes-heading"><strong>候補の変化</strong><span>{data.history.previous_as_of?`${data.history.previous_as_of} → ${data.as_of}`:`記録開始 ${data.as_of}`}</span></div>
    {!data.history.previous_as_of ? <p>前回比較は、次の営業日の公開後から表示します。</p> : <p>日次の選定条件の変化です。購入シグナルではありません。全業種・流動性フィルター内を比較します。</p>}
    {presentation.explanation&&<Alert severity="info">{presentation.explanation}</Alert>}
    {data.history.previous_as_of&&<p>{Object.entries(CHANGE_LABELS).filter(([key])=>key!=='unchanged').map(([key,label])=>`${label} ${summary.counts[key]}`).join(' · ')}</p>}
    <details><summary>変化の内訳を開く</summary>
      {!data.history.previous_as_of&&<p>{data.history.reason}</p>}
      <div className="change-tabs" role="group" aria-label="変化の種類">{Object.entries(CHANGE_LABELS).map(([key,label])=><Button key={key} aria-pressed={kind===key} onClick={()=>{setKind(key);setPage(0);}}>{label} {summary.counts[key]}</Button>)}</div>
      {items.slice(current*20,current*20+20).map(item=><details className="change-row" key={item.symbol}><summary>{item.symbol} · {CHANGE_LABELS[item.state]}{item.changes.length?` · ${item.changes.length}条件が変化`:''}</summary>
        {item.reason&&<p>{item.reason}</p>}{item.changes.map(c=><div key={c.id}><strong>{c.label}</strong><p>前回：{display(c.before)}{c.unit}<br/>今回：{display(c.after)}{c.unit}</p></div>)}
        {!item.changes.length&&!item.reason&&<p>条件ごとの通過状態は前回と同じです。</p>}
        <Button disabled={availableSymbols && !availableSymbols.has(item.symbol)} onClick={()=>onSelect(item.symbol)}>{availableSymbols && !availableSymbols.has(item.symbol)?`${item.symbol} の現在データなし`:`現在の ${item.symbol} を分析`}</Button>
      </details>)}
      {!items.length&&<p>この分類の銘柄はありません。</p>}
      {items.length>20&&<div className="candidate-pagination"><Button disabled={!current} onClick={()=>setPage(current-1)}>前へ</Button><span>{current+1} / {Math.ceil(items.length/20)}</span><Button disabled={(current+1)*20>=items.length} onClick={()=>setPage(current+1)}>次へ</Button></div>}
      <p className="research-muted">「今回通過」は直前の未通過からの変化。「再通過」は同じ定義で過去の通過を確認できた場合です。保存範囲：最大{data.history.limit || 126}営業日。欠損・定義変更・対象範囲変更は比較不能です。</p>
    </details>
  </Paper>;
}
