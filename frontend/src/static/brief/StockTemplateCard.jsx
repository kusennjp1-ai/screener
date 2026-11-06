import { Expander } from './briefPrimitives';
import { ruleEvidence } from './briefCandidate';

const stateIcon = { pass: '✓', fail: '✕', unknown: '?', not_applicable: '–' };
/**
 * The 200-day line's rise over a period: ✓ when it rose on every session (sustained-up), ✕ when it fell on
 * every one, 一部下落 when it moved both ways, 未確認 when it was not measured (never ✓ by default).
 */
const DIRECTION = { 'sustained-up': '✓', 'sustained-down': '✕', mixed: '一部下落' };
const direction = value => DIRECTION[value?.state] || '未確認';
/**
 * 「上向き：1か月 ✓・4か月 ✓・5か月 未確認」 for the SMA200 rule: one month from the rule itself, four and five
 * months from the technical evidence (bookTechnicalEvidence's preferredFourMonths / preferredFiveMonths, the
 * book's preferred span; not a rule of the template).
 */
function sma200Rise(rule, technical) {
  const month = rule.state === 'pass' ? '✓' : rule.state === 'fail' ? '✕' : '未確認';
  return `上向き：1か月 ${month}・4か月 ${direction(technical?.sma200?.preferredFourMonths)}・5か月 ${direction(technical?.sma200?.preferredFiveMonths)}`;
}
const isSma200Rule = rule => typeof rule?.label === 'string' && rule.label.startsWith('SMA200が21営業日前より上');
/** 「1項目が未達・2項目が未確認」, leaving out a part that is 0 (never 「0項目が未達」). */
const summary = ({ failed, unknown }) => [failed ? `${failed}項目が未達` : '', unknown ? `${unknown}項目が未確認` : ''].filter(Boolean).join('・') || '未確認の項目があります';

/**
 * The trend-template card: the ring, then the unmet rules with the met ones folded on a phone. `technical` (the
 * technical evidence, or null) adds the 200-day line's 4- and 5-month rise to its rule; without the prop the
 * line is not drawn (nothing is claimed).
 */
export default function TemplateCard({ template, wide, technical }) {
  if (!template) return null;
  const circumference = 2 * Math.PI * 28;
  const met = template.rules.filter(rule => rule.state === 'pass'), open = template.rules.filter(rule => rule.state !== 'pass');
  return <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-tt-title">
    <div className="brief-ring-row">
      <div className="brief-ring" aria-hidden="true"><svg viewBox="0 0 68 68"><circle className="ring-bg" cx="34" cy="34" r="28" /><circle className="ring-fg" cx="34" cy="34" r="28" strokeDasharray={circumference} style={{ '--ring': circumference * (1 - template.passed / 8), '--full': circumference }} /></svg><b>{template.passed}/8</b></div>
      <div><h2 id="brief-tt-title">トレンドテンプレート {template.passed}/8</h2><p className="brief-note">{template.passed === 8 ? 'すべての条件を満たしています' : summary(template)}</p></div>
    </div>
    {wide ? <RuleList rules={template.rules} technical={technical} /> : <>
      {open.length > 0 && <RuleList rules={open} technical={technical} />}
      {met.length > 0 && <Expander id="stock-tt-met" summary={open.length ? `達成した条件 ${met.length}件` : '8条件の内訳（すべて達成）'}><RuleList rules={met} offset={open.length} technical={technical} /></Expander>}
    </>}
  </section>;
}

function RuleList({ rules, offset = 0, technical }) {
  return <ul className="brief-checks">{rules.map((rule, i) => <li key={rule.label} className="in" style={{ '--i': 4 + offset + i }}>
    <span className={`brief-check is-${rule.state}`} aria-hidden="true">{stateIcon[rule.state] || '?'}</span>
    <span>{rule.label}<span className="sr-only">（{rule.state === 'pass' ? '達成' : rule.state === 'fail' ? '未達' : '未確認'}）</span><em>{ruleEvidence(rule)}</em>
      {technical !== undefined && isSma200Rule(rule) ? <em data-testid="brief-tt-sma200">{sma200Rise(rule, technical)}</em> : null}</span>
  </li>)}</ul>;
}
