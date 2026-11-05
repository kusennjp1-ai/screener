// A watch view, never an alternate qualification rule. Accept only one
// genuinely non-passing rule from the canonical assessment.
export function singleMissingCondition(assessment) {
  if (!assessment || assessment.method_status || assessment.financial_exclusion || assessment.total < 1 || assessment.passed !== assessment.total - 1 || !Array.isArray(assessment.rules)) return null;
  const missing = assessment.rules.filter(rule => rule.state !== 'pass');
  if (missing.length !== 1 || !['fail', 'unknown'].includes(missing[0].state)) return null;
  const rule = missing[0];
  const stateLabel = rule.state === 'unknown' ? '未確認' : '未達';
  const shortLabel = conditionShortLabel(rule);
  return { ...rule, stateLabel, shortLabel, text: `${stateLabel}：${shortLabel}`, csv: `${stateLabel}：${rule.label}` };
}

/** A rule's short name for a chip or a conclusion line (「RS ≥ 70」, 「株価 > SMA50」). */
export function conditionShortLabel(rule) {
  const label = typeof rule?.label === 'string' ? rule.label : '';
  const rs = label.match(/^RS 推計 ≥ (\d+)/);
  return rs ? `RS ≥ ${rs[1]}`
    : label.startsWith('I：') ? '機関保有（I）'
      : label.includes('SMA200が21営業日前') ? 'SMA200の21営業日上昇'
        : label.startsWith('日足の銘柄') ? '日足の整合性・252本'
          : label.replace(/（[^）]*）/g, '');
}

/**
 * The value that settled a rule, as the short label's parenthesis shows it: an RS estimate as a whole
 * number (never rounded up past its threshold), a percentage to one decimal, or null when the rule
 * carries no single value (a comparison of averages, a yes/no rule, an unknown value).
 */
export function conditionValueText(rule) {
  const value = rule?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (/^RS 推計/.test(rule.label || '')) return String(Math.floor(value));
  return rule.unit === '%' ? `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%` : null;
}

/** 「RS ≥ 70（61）」: the short label and, when the rule has one, the value that settled it. */
export function conditionText(rule) {
  const value = conditionValueText(rule);
  return `${conditionShortLabel(rule)}${value === null ? '' : `（${value}）`}`;
}
