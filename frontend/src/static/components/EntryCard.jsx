import { gaugeGeometry, money, signed, STATES, stateKey } from '../positionGeometry';
import EntrySourceNote from './EntrySourceNote';
export function StateChip({state}) { const [label,glyph,tone]=STATES[stateKey(state)];return <span className="state-chip" style={{'--state-tone':`var(--${tone})`}}>{glyph} {label}</span>; }
export default function EntryCard({plan,readiness,onConditions,onConnect}) {
 const g=gaugeGeometry(plan),tone=STATES[stateKey(plan.state)][2];
 const missing=readiness.rules.filter(r=>r.state!=='pass');
 return <section className="entry-card" aria-label="エントリー条件">
  <header><strong>エントリー条件</strong><StateChip state={plan.state}/><button onClick={onConnect}>場中価格を接続</button></header>
  {g ? <div className="entry-gauge" role="img" aria-label={`現在価格 ${money(plan.price)}、共通ピボット ${money(plan.pivot)}、アプリ買い上限 ${money(plan.upper)}、損切り計算例 ${money(plan.stopExample)}`}>
   <div className="gauge-track"><span className="gauge-zone" style={{left:`${g.pivot}%`,width:`${Math.max(0,(g.upper??g.pivot)-g.pivot)}%`}}/>
    {g.price!==null&&<span className="gauge-current" style={{left:`${g.price}%`,color:`var(--${tone})`}}><b>{money(plan.price)}</b><i/>{g.clipped&&<em>範囲外</em>}</span>}
   </div>
   {[-10,-5,0,5,10].map(n=><span className="gauge-tick mono" key={n} style={{left:`${(n+10)*5}%`}}>{n===0?'0%':signed(n,0)}</span>)}
   <span className="gauge-level gauge-pivot" style={{left:`${g.pivot}%`}}>共通ピボット<strong className="mono">{money(plan.pivot)}</strong></span>
   {g.stop!==null&&<span className="gauge-level gauge-stop" style={{left:`${g.stop}%`}}>損切り例<strong className="mono">{money(plan.stopExample)}</strong></span>}
   {g.upper!==null&&<span className="gauge-level gauge-upper" style={{left:`${g.upper}%`}}>アプリ上限<strong className="mono">{money(plan.upper)}</strong></span>}
  </div> : <p className="entry-no-pivot">有効なピボットなし · {plan.pivotSource || '形状の確認資料が不足しています。'}</p>}
  <div className="readiness-heading"><strong>購入条件 <span className="mono">{readiness.passed}/{readiness.total}</span></strong><button onClick={onConditions}>根拠を見る →</button></div>
  <div className="readiness-bar" role="img" aria-label={`購入条件 ${readiness.passed}/${readiness.total} 通過`}>{readiness.rules.map(r=><span key={r.id} style={{background:`var(--${r.state==='pass'?'zone':r.state==='fail'?'neg':'line-2'})`}}/>)}</div>
  <div className="missing-chips">{missing.map(r=><span key={r.id} title={r.detail}>{r.state==='fail'?'×':'?'} {r.label}</span>)}</div>
  <p className="entry-note">未達 {readiness.rules.filter(r=>r.state==='fail').length}件・未確認 {readiness.rules.filter(r=>r.state==='unknown').length}件。未達は条件の変化を待ち、未確認は根拠データを確認します。</p>
  <p className="entry-note">日次の購入条件。価格位置だけで購入を確定しません。損切り例は表示価格の−7%で、注文価格ではありません。</p>
  <EntrySourceNote plan={plan}/>
 </section>;
}
