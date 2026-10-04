import { financialEvidencePresentation } from '../financialEvidencePresentation';
import './financialEvidence.css';

const status = { pass: '✓ 通過', fail: '× 未達', unknown: '? 未確認', reference: '参考・取得済み' };

function EvidenceMetadata({ row }) {
  return <dl className="financial-evidence-metadata">
    <div><dt>対象期</dt><dd>{row.period}</dd></div>
    <div><dt>提供元</dt><dd>{row.source}</dd></div>
    <div><dt>取得</dt><dd>{row.observedAt}</dd></div>
    <div><dt>指標</dt><dd>{row.metric}</dd></div>
    <div><dt>基準</dt><dd>{row.basis}</dd></div>
    <div><dt>単位</dt><dd>{row.unit}</dd></div>
  </dl>;
}

export default function FinancialEvidencePanel(props) {
  const view = financialEvidencePresentation(props);
  return <section className="financial-evidence-panel" aria-label="財務の判定根拠">
    <header><h3>財務の判定根拠</h3><p>{view.requiredCount ? `財務の必須条件 ${view.requiredCount}件 · 未確認 ${view.requiredUnknown}件` : '財務は参考確認・トレンド選定の点数には含めません'}</p></header>
    <p className="financial-evidence-intro">価格の基準日 {props.date || '未確認'} · 財務の確認時刻 {Number.isFinite(props.now) ? new Date(props.now).toISOString() : '未確認'}。基準日より後に取得した情報を含む場合があります。基準日当時に公表済みだったことの証明ではありません。</p>
    <p className="financial-evidence-intro">実数値と条件、対象期、提供元を並べて確認します。参考値の取得だけでSEPA全体を認定しません。</p>
    <ul className="financial-evidence-rows">{view.rows.map(row => <li key={row.id} id={`financial-evidence-${row.id}`} tabIndex={-1} data-state={row.state}>
      <div className="financial-evidence-heading"><div><span className="financial-evidence-role">{row.required ? '必須' : '参考'}</span><h4>{row.label}</h4></div><span className={`financial-evidence-status financial-evidence-status-${row.state}`}>{status[row.state]}</span></div>
      <div className="financial-evidence-value"><strong>{row.actual}</strong><span>{row.condition}</span></div>
      {row.explanation && <p className="financial-evidence-reason">{row.explanation}</p>}
      <EvidenceMetadata row={row}/>
    </li>)}</ul>
    <p className="financial-evidence-intro">四半期の報告希薄化EPS履歴は別資料です。上の四半期前年比や推計値への自動補完には使いません。ROEと純利益率には選定の必須閾値を設けていません。</p>
    <details className="research-disclosure financial-historical-reference"><summary>過去の参考記録（現在の判定には不使用） · {view.historical.length}件</summary>
      <p>以下は保持した観測記録です。現在の通過・未達の判定には加算しません。</p>
      {view.historical.length ? <ul>{view.historical.map(row => <li key={row.key}><h4>{row.label} <strong>{row.value}</strong></h4><p>{row.explanation}</p><EvidenceMetadata row={row}/></li>)}</ul> : <p>保持された参考記録はありません。</p>}
    </details>
  </section>;
}
