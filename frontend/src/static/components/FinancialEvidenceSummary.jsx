import { useMemo } from 'react';
import { financialEvidencePresentation, financialEvidenceSummary } from '../financialEvidencePresentation';
import './financialEvidence.css';

const actionTarget = { minHeight: 44, minWidth: 44 };
const status = { pass: '✓ 通過', fail: '× 未達', unknown: '? 未確認', reference: '参考' };
const observedLabel = value => /^\d{4}-\d{2}-\d{2}T/.test(value || '') ? `取得 ${value.replace('T', ' ').replace(/:00(?:\.000)?Z$/, ' UTC')}` : value || '取得時刻 未確認';

// This is a literal metadata summary, not a freshness or usability decision.
// A source record can be present while the ordinary growth condition is unknown.
function financialSourceBadge(row) {
  const sourceKnown = Boolean(row.source && row.source !== '提供元 未確認');
  const observedDate = /^\d{4}-\d{2}-\d{2}T/.test(row.observedAt || '') ? row.observedAt.slice(0, 10) : null;
  return { sourceKnown, observedDate, label: `${sourceKnown ? '提供元あり' : '提供元 未確認'} · ${observedDate ? `取得 ${observedDate}` : '取得日 未確認'}` };
}

// Both surfaces consume the canonical presenter, including its unknown reasons.
// This component formats metadata only; it never infers financial availability.
export function FinancialGrowthMetric({ row, compact = false, onNavigate }) {
  const title = compact ? ({eps_growth_yy:'四半期EPS前年比',sales_growth_yy:'売上前年比'}[row.id] || row.label) : row.title || row.label;
  const sourceBadge = compact ? financialSourceBadge(row) : null;
  return <div className={`financial-growth-metric${compact ? ' compact' : ''}`} data-state={row.state} data-metric={row.id}>
    <div className="financial-growth-heading"><span>{title}</span><small className="financial-evidence-role">{row.required ? '必須' : '参考'}</small></div>
    <div className="financial-summary-result"><strong>{row.actual}</strong><span className={`financial-evidence-status-${row.state}`}>{status[row.state]}</span></div>
    <p className="financial-growth-condition">{row.condition}</p>
    <p className="financial-growth-period">{row.period}</p>
    {compact ? <p className="financial-growth-source financial-source-badge" data-source-presence={sourceBadge.sourceKnown ? 'recorded' : 'unknown'} data-observed-date={sourceBadge.observedDate || undefined}>{sourceBadge.label}</p>
      : <><p className="financial-growth-source">{row.source} · {observedLabel(row.observedAt)}</p><p className="financial-growth-basis">{row.metric} · {row.basis}</p></>}
    {!compact && row.actual !== '未確認' && row.comparisonLabel && row.comparisonLabel !== row.actual && <p className="financial-comparison-note">{row.comparisonLabel}</p>}
    {row.referenceActual && <p className="financial-comparison-note" data-reference-value>参考計算：{compact ? row.referenceActual.split('（')[0] : row.referenceActual}</p>}
    {!compact && row.actual !== '未確認' && row.calculationNote && <p className="financial-comparison-note">{row.calculationNote}</p>}
    {!compact && row.explanation && <p className="financial-evidence-reason">{row.explanation}</p>}
    {onNavigate && <button className="financial-metric-action" type="button" style={actionTarget} aria-label={`${row.title || row.label} ${row.actual}・${status[row.state]}。財務の根拠を開く`} onClick={() => onNavigate('financial', row.id)}>取得・計算の根拠を見る ↗</button>}
  </div>;
}

export default function FinancialEvidenceSummary({ onNavigate, ...input }) {
  const { evidence, history, bookFinancials, symbol, date, generation, method, now } = input;
  const rows = useMemo(() => {
    const context = { evidence, history, bookFinancials, symbol, date, generation, method, now };
    const summary = financialEvidenceSummary(context);
    const annual = financialEvidencePresentation(context).rows.find(row => row.id === 'annual_eps_growth_3y');
    return { primary: [...summary.slice(0, 2), annual], secondary: summary.slice(2) };
  }, [evidence, history, bookFinancials, symbol, date, generation, method, now]);
  return <section className="financial-evidence-summary" aria-label="財務の確認状況">
    <header><h3>成長の裏付け</h3><span>実数値・条件・対象期</span></header>
    <div className="financial-growth-primary">{rows.primary.map(row => <FinancialGrowthMetric key={row.id} row={row} onNavigate={onNavigate}/>)}</div>
    <div className="financial-growth-secondary">{rows.secondary.map(row => <button key={row.id} type="button" data-state={row.state} style={actionTarget}
      aria-label={`${row.title} ${row.actual}・${status[row.state]}。書籍検証の根拠を開く`} title={[row.condition,row.period,row.source,row.observedAt,row.explanation].filter(Boolean).join(" ／ ")} onClick={() => onNavigate(row.target, row.id)}>
      <span>{row.title} <small>参考</small></span><strong>{row.actual} ↗</strong><small>{row.condition}</small><small>{row.period} · {row.source}</small>
    </button>)}</div>
  </section>;
}
