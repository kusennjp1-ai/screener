// A watch view, never an alternate qualification rule. Accept only one
// genuinely non-passing rule from the canonical assessment.
export function singleMissingCondition(assessment) {
  if (!assessment || assessment.total < 1 || assessment.passed !== assessment.total - 1 || !Array.isArray(assessment.rules)) return null;
  const missing = assessment.rules.filter(rule => rule.state !== 'pass');
  if (missing.length !== 1 || !['fail', 'unknown'].includes(missing[0].state)) return null;
  const rule = missing[0];
  const stateLabel = rule.state === 'unknown' ? '未確認' : '未達';
  const rs = rule.label.match(/^RS 推計 ≥ (\d+)/);
  const shortLabel = rs ? `RS ≥ ${rs[1]}`
    : rule.label.startsWith('I：') ? '機関保有（I）'
      : rule.label.includes('SMA200が21営業日前') ? 'SMA200の21営業日上昇'
        : rule.label.startsWith('日足の銘柄') ? '日足の整合性・252本'
          : rule.label.replace(/（[^）]*）/g, '');
  return { ...rule, stateLabel, shortLabel, text: `${stateLabel}：${shortLabel}`, csv: `${stateLabel}：${rule.label}` };
}
