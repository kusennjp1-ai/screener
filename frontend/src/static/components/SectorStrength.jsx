import { useState } from 'react';
import { Alert, Button, Paper } from '@mui/material';
import { useWorkbench } from '../useWorkbench';
const number=value=>Number.isFinite(value)?value.toFixed(1):'—';
export default function SectorStrength({entry}) {
  const query=useWorkbench(entry),[period,setPeriod]=useState('63'),[method,setMethod]=useState('minervini'),[view,setView]=useState('map');
  const sectors=query.data?.sectors;
  if(query.isError)return <Alert severity="error">業種データの基準日または取得状態を確認できません。</Alert>;
  if(!sectors)return <p>業種の相対強度を読み込み中…</p>;
  return <section className="sector-strength" aria-label="業種の相対強度と通過率">
    <h2>業種の追い風を確認</h2>
    <p>対SPYの相対価格指数と、当日の分類内で選定条件を通過した割合を並べます。独自の参考指標です。</p>
    <div className="comparison-controls"><label>相対強度の期間 <select value={period} onChange={e=>setPeriod(e.target.value)}><option value="63">63営業日</option><option value="126">126営業日</option></select></label>
      <label>選定方式 <select value={method} onChange={e=>setMethod(e.target.value)}><option value="minervini">ミネルヴィニ</option><option value="minervini2">基本と原則</option><option value="oneil">オニール / CAN SLIM</option><option value="ibd">IBD型リーダー</option></select></label></div>
    <div className="sector-view" role="group" aria-label="業種の表示形式"><Button aria-pressed={view==='map'} onClick={()=>setView('map')}>マップ</Button><Button aria-pressed={view==='table'} onClick={()=>setView('table')}>表</Button></div>
    {view==='table' && <div className="sector-table-scroll"><table aria-label="業種の相対強度一覧"><thead><tr><th>業種 / 代理ETF</th><th>相対価格指数</th><th>21日相対変化</th><th>通過 / 全対象</th><th>未確認</th></tr></thead><tbody>{[...sectors.groups].sort((a,b)=>(b.relative[period].value??-Infinity)-(a.relative[period].value??-Infinity)).map(g=><tr key={g.key}><th><a href={`#/?sector=${encodeURIComponent(g.key)}&view=charts&method=${method}`}>{g.label} / {g.etf||'—'}</a></th><td>{number(g.relative[period].value)}</td><td>{number(g.momentum21.value==null?null:g.momentum21.value-100)}{g.momentum21.value==null?'':'%'}</td><td>{g.rates[method].pass} / {g.rates[method].total} ({number(g.rates[method].percent)}{g.rates[method].percent==null?'':'%'})</td><td>{g.rates[method].unknown}</td></tr>)}</tbody></table></div>}
    {view==='map' && <div className="sector-map">{[...sectors.groups].sort((a,b)=>(b.relative[period].value??-Infinity)-(a.relative[period].value??-Infinity)).map(g=>{
      const relative=g.relative[period],rate=g.rates[method];
      return <Paper key={g.key} variant="outlined" className="sector-cell" data-direction={relative.value==null?'unknown':relative.value>=100?'strong':'weak'}>
        <h3>{g.label} <small>{g.etf||'未分類'}</small></h3>
        <div className="sector-values"><span>相対価格指数<strong>{number(relative.value)}</strong><small>{relative.value==null?'未確認':relative.value>=100?'SPYを上回る':'SPYを下回る'}</small></span><span>条件通過率<strong>{number(rate.percent)}{rate.percent==null?'':'%'}</strong><small>{rate.pass} / {rate.total}銘柄 · 未確認 {rate.unknown}</small></span></div>
        <p>直近21営業日の相対変化：{g.momentum21.value==null?'—':`${g.momentum21.value>=100?'+':''}${number(g.momentum21.value-100)}%`}</p>
        <p>{relative.from?`${relative.from} → ${relative.to}`:relative.reason}{g.small?' · 少数標本（10銘柄未満）':''}</p>
        <Button component="a" href={`#/?sector=${encodeURIComponent(g.key)}&view=charts&method=${method}`}>{g.label}の候補を比較 →</Button>
      </Paper>;
    })}</div>}
    <details className="market-disclosure"><summary>計算方法・対象範囲・欠損の扱い</summary><p>指数＝100 ×（当日のETF終値 / SPY終値）÷（{period}営業日前のETF終値 / SPY終値）。100が基点です。勢いは直近21営業日の同じ比率の変化率です。配当込みリターンではありません。</p><p>ETFはセクターの代理です。銘柄分類の集計対象とETF構成は一致しません。通過率の分母は株価10ドル以上・平均売買代金2,000万ドル以上の全対象銘柄で、未確認も分母に含め、合格には数えません。分類不明は別集計です。</p><p>価格出典：{sectors.source||'未取得'} / 取得：{sectors.retrieved_at||'未確認'} / 調整：分割調整済み終値・配当調整なし。同日・同じ調整方針で取得し、途中の日足が欠ける場合は相対指数を表示しません。IBD公式RS・JdK RRGではありません。</p></details>
  </section>;
}
