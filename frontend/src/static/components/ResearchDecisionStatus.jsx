import { STATES, stateKey } from '../positionGeometry';
import { EntrySourceBadge } from './EntrySourceNote';
import './researchDecisionStatus.css';

// These are counts and states from the existing assessments, not new gates.
export default function ResearchDecisionStatus({ assessment, readiness, plan, annual, showSourceWarning = true }) {
  const selectionUnknown = assessment.unknown ?? 0;
  const selectionFailed = assessment.failed ?? Math.max(0, assessment.total - assessment.passed - selectionUnknown);
  const dailyFailed = readiness?.rules.filter(rule => rule.state === 'fail').length;
  const dailyUnknown = readiness?.rules.filter(rule => rule.state === 'unknown').length;
  const selectionState = assessment.qualified ? 'pass' : selectionFailed ? 'fail' : 'unknown';
  const dailyState = readiness?.ready ? 'pass' : dailyFailed ? 'fail' : 'unknown';
  const [label, glyph, tone] = STATES[stateKey(plan.state)];
  return <div className="research-decision-status" role="group" aria-label="選定条件・日次確認・価格位置">
    <div className="decision-status-rail">
      <div data-check="selection" data-state={selectionState}>
        <span>選定条件 {assessment.passed}/{assessment.total}</span>
        <strong>未達 {selectionFailed} · 未確認 {selectionUnknown}</strong>
      </div>
      <div data-check="daily" data-state={dailyState}>
        <span className="candidate-daily-check" data-ready={readiness?.ready || undefined}>日次確認 {readiness ? `${readiness.passed}/${readiness.total}` : '未確認'}</span>
        <strong>未達 {dailyFailed ?? '—'} · 未確認 {dailyUnknown ?? '—'}</strong>
      </div>
      <div data-check="price" style={{ '--position-tone': `var(--${tone})` }}>
        <span>価格位置 · アプリ</span><strong>{glyph} {label}</strong>
      </div>
    </div>
    {annual?.required && <p className="decision-annual" data-required="true" data-state={annual.state}><span>必須</span> <strong>年次EPS {annual.state === 'pass' ? '通過' : annual.state === 'fail' ? '未達' : '未確認'}</strong></p>}
    {showSourceWarning && plan.sourceContext?.warning && <p className="decision-source"><EntrySourceBadge plan={plan}/></p>}
  </div>;
}
