import { signed, STATES, stateKey } from '../positionGeometry';
import { EntrySourceBadge } from './EntrySourceNote';

// These strips visualize existing condition counts. They are not a score,
// chronology, or a claim that the stock has just entered a new stage.
function ConditionStrip({ total, passed, failed }) {
 if (!Number.isInteger(total) || total < 1) return null;
 return <span className="feed-condition-strip" aria-hidden="true">{Array.from({ length: total }, (_, index) => <span key={index} data-state={index < passed ? 'pass' : index < passed + failed ? 'fail' : 'unknown'}/>)}</span>;
}

export default function CandidateCurrentState({ assessment, readiness, plan, annual }) {
 const selectionUnknown = assessment.unknown ?? 0;
 const selectionFailed = assessment.failed ?? Math.max(0, assessment.total - assessment.passed - selectionUnknown);
 const dailyFailed = readiness?.failed ?? readiness?.rules.filter(rule => rule.state === 'fail').length;
 const dailyUnknown = readiness?.unknown ?? (readiness ? Math.max(0, readiness.total - readiness.passed - dailyFailed) : null);
 const selectionState = assessment.qualified ? 'pass' : selectionFailed ? 'fail' : 'unknown';
 const dailyState = readiness?.ready ? 'pass' : dailyFailed ? 'fail' : 'unknown';
 const priceKey = stateKey(plan.state), [priceLabel, glyph] = STATES[priceKey];
 const priceState = priceKey === 'zone' ? 'pass' : priceKey === 'na' ? 'unknown' : 'fail';
 return <div className="research-decision-status feed-current-state" role="group" aria-label="選定条件・日次確認・価格位置">
  <div className="feed-state-headline" data-check="price" data-state={priceState}>
   <span className="feed-state-label">現在の状態 · 価格位置</span><strong>{glyph} {priceLabel}</strong><span className="feed-price-distance">ピボット比 {signed(plan.distance)}</span>
  </div>
  <div className="feed-state-context">
   {annual?.required && <p className="decision-annual" data-required="true" data-state={annual.state}><span>必須</span> <strong>年次EPS {annual.state === 'pass' ? '通過' : annual.state === 'fail' ? '未達' : '未確認'}</strong></p>}
   <span className="feed-price-model">価格位置 · アプリ{Number.isFinite(plan.zone) ? ` 0〜+${plan.zone}%` : ' · 未確認'}</span>
   {plan.sourceContext?.warning && <EntrySourceBadge plan={plan}/>}
  </div>
  <div className="decision-status-rail">
   <div data-check="selection" data-state={selectionState}>
    <span>選定条件 <strong>{assessment.passed}/{assessment.total}</strong></span>
    <ConditionStrip total={assessment.total} passed={assessment.passed} failed={selectionFailed}/>
    <small>通過 {assessment.passed} · 未達 {selectionFailed} · 未確認 {selectionUnknown}</small>
   </div>
   <div data-check="daily" data-state={dailyState}>
    <span className="candidate-daily-check" data-ready={readiness?.ready || undefined}>日次確認 {readiness ? `${readiness.passed}/${readiness.total}` : '未確認'}</span>
    {readiness ? <ConditionStrip total={readiness.total} passed={readiness.passed} failed={dailyFailed}/> : <span className="feed-condition-unavailable" aria-hidden="true"/>}
    <small>通過 {readiness?.passed ?? '—'} · 未達 {dailyFailed ?? '—'} · 未確認 {dailyUnknown ?? '—'}</small>
   </div>
  </div>
 </div>;
}
