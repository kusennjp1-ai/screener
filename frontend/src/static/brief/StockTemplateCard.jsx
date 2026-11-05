import { Expander } from './BriefParts';
import { ruleEvidence } from './briefCandidate';

const stateIcon = { pass: '✓', fail: '✕', unknown: '?', not_applicable: '–' };

/** The trend-template card: the ring, then the unmet rules with the met ones folded on a phone. */
export default function TemplateCard({ template, wide }) {
  if (!template) return null;
  const circumference = 2 * Math.PI * 28;
  const met = template.rules.filter(rule => rule.state === 'pass'), open = template.rules.filter(rule => rule.state !== 'pass');
  return <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-tt-title">
    <div className="brief-ring-row">
      <div className="brief-ring" aria-hidden="true"><svg viewBox="0 0 68 68"><circle className="ring-bg" cx="34" cy="34" r="28" /><circle className="ring-fg" cx="34" cy="34" r="28" strokeDasharray={circumference} style={{ '--ring': circumference * (1 - template.passed / 8), '--full': circumference }} /></svg><b>{template.passed}/8</b></div>
      <div><h2 id="brief-tt-title">トレンドテンプレート {template.passed}/8</h2><p className="brief-note">{template.passed === 8 ? 'すべての条件を満たしています' : `${template.failed}項目が未達${template.unknown ? `・${template.unknown}項目が未確認` : ''}`}</p></div>
    </div>
    {wide ? <RuleList rules={template.rules} /> : <>
      {open.length > 0 && <RuleList rules={open} />}
      {met.length > 0 && <Expander id="stock-tt-met" summary={open.length ? `達成した条件 ${met.length}件` : '8条件の内訳（すべて達成）'}><RuleList rules={met} offset={open.length} /></Expander>}
    </>}
  </section>;
}

function RuleList({ rules, offset = 0 }) {
  return <ul className="brief-checks">{rules.map((rule, i) => <li key={rule.label} className="in" style={{ '--i': 4 + offset + i }}>
    <span className={`brief-check is-${rule.state}`} aria-hidden="true">{stateIcon[rule.state] || '?'}</span>
    <span>{rule.label}<span className="sr-only">（{rule.state === 'pass' ? '達成' : rule.state === 'fail' ? '未達' : '未確認'}）</span><em>{ruleEvidence(rule)}</em></span>
  </li>)}</ul>;
}
