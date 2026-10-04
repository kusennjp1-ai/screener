import { money, signed, STATES, stateKey } from '../positionGeometry';
import EntrySourceNote from './EntrySourceNote';
import PositionMeter from './PositionMeter';
import './entryEvidence.css';
export function StateChip({state}) { const [label,glyph,tone]=STATES[stateKey(state)];return <span className="state-chip" style={{'--state-tone':`var(--${tone})`}}>{glyph} {label}</span>; }
export default function EntryCard({plan,readiness,onConditions,onConnect}) {
 const missing=readiness.rules.filter(r=>r.state!=='pass');
 return <section className="entry-card entry-evidence" aria-label="エントリー条件">
  <header><strong>次に確認すること</strong><button onClick={onConditions}>日次 {readiness.passed}/{readiness.total} · すべての根拠 →</button></header>
  <p className="entry-note">未達 {readiness.rules.filter(r=>r.state==='fail').length}件・未確認 {readiness.rules.filter(r=>r.state==='unknown').length}件。未達は条件の変化を待ち、未確認は根拠データを確認します。</p>
  <div className="missing-chips" aria-label="日次の未達・未確認">{missing.map(r=><span key={r.id} data-state={r.state}>{r.state==='fail'?'× 未達':'? 未確認'} · {r.label}</span>)}</div>
  <ul className="entry-next-checks">{missing.slice(0,2).map(r=><li key={r.id}><strong>{r.label}</strong><span>{r.detail}</span></li>)}</ul>
  {missing.length>2&&<details className="entry-more-checks"><summary>ほかの {missing.length-2} 条件の詳細</summary><ul className="entry-next-checks">{missing.slice(2).map(r=><li key={r.id}><strong>{r.state==='fail'?'× 未達':'? 未確認'} · {r.label}</strong><span>{r.detail}</span></li>)}</ul></details>}
  {!missing.length&&<p className="entry-note">日次モデルの条件をすべて通過。発注前に最新価格とリスクを確認します。</p>}
  <div className="entry-price-position" role="img" aria-label={`現在価格 ${money(plan.price)}、共通ピボット ${money(plan.pivot)}、アプリ買い上限 ${money(plan.upper)}、損切り計算例 ${money(plan.stopExample)}`}><strong>価格位置</strong><PositionMeter plan={plan}/><StateChip state={plan.state}/><span>ピボット比 {signed(plan.distance)}</span></div>
  <dl className="entry-price-levels"><div><dt>共通ピボット</dt><dd>{money(plan.pivot)}</dd></div><div><dt>アプリ上限</dt><dd>{money(plan.upper)}</dd></div><div><dt>損切り計算例</dt><dd>{money(plan.stopExample)}</dd></div></dl>
  {!Number.isFinite(plan.pivot)&&<p className="entry-no-pivot">有効なピボットなし · {plan.pivotSource || '形状の確認資料が不足しています。'}</p>}
  <p className="entry-note">価格位置だけで購入を確定しません。損切り例は表示価格の−7%で、注文価格ではありません。</p>
  <EntrySourceNote plan={plan}/><button onClick={onConnect}>場中価格を接続</button>
 </section>;
}
