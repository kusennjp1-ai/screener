import { financialEvidenceSummary } from '../financialEvidencePresentation';
import './financialEvidence.css';

const status = { pass: '通過', fail: '未達', unknown: '未確認', reference: '参考' };

export default function FinancialEvidenceSummary({ onNavigate, ...input }) {
  const rows = financialEvidenceSummary(input);
  return <section className="financial-evidence-summary" aria-label="財務の確認状況">
    {rows.map(row => <button key={row.id} type="button" data-state={row.state} className="financial-summary-item"
      aria-label={`${row.title} ${row.actual}・${status[row.state]}。${row.target === 'book' ? '書籍検証' : '財務'}の根拠を開く`}
      title={[row.condition, row.period, row.source, row.observedAt, row.explanation].filter(Boolean).join(' ／ ')}
      onClick={() => onNavigate(row.target, row.id)}>
      <span className="financial-summary-title">{row.title}<small> {row.required ? '必須' : '参考'}</small><span aria-hidden="true"> ↗</span></span>
      <span className="financial-summary-result"><strong>{row.actual}</strong>{row.actual !== status[row.state] && <span className={`financial-evidence-status-${row.state}`}>{status[row.state]}</span>}</span>
    </button>)}
  </section>;
}
