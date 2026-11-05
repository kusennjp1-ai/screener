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
  const label = rule.label || '';
  if (/^RS 推計/.test(label)) return String(Math.floor(value));
  if (rule.unit !== '%') return null;
  // Rounded to one decimal, except where that would cross the rule's threshold: a value that fails 「≤ 25%」
  // never reads 25.0% (25.04 reads 25.1%), one that fails 「≥ 30%」 never reads 30.0% (29.96 reads 29.9%).
  const [, op, bound] = label.match(/(≤|≥)\s*(\d+(?:\.\d+)?)/) || [];
  const limit = Number(bound), round = Math.round(value * 10);
  const tenths = op === '≤' && value > limit && round / 10 <= limit ? Math.ceil(value * 10 - 1e-9)
    : op === '≥' && value < limit && round / 10 >= limit ? Math.floor(value * 10 + 1e-9) : round;
  return `${tenths < 0 ? '−' : ''}${(Math.abs(tenths) / 10).toFixed(1)}%`;
}

/** 「RS ≥ 70（61）」: the short label and, when the rule has one, the value that settled it. */
export function conditionText(rule) {
  const value = conditionValueText(rule);
  return `${conditionShortLabel(rule)}${value === null ? '' : `（${value}）`}`;
}

/**
 * A rule's name for a row chip or a conclusion line, short enough for a phone: the 52-week rules read
 * 「高値から25%以内」 / 「安値から30%以上」 (their thresholds from the label), every other rule its short label.
 */
export function conditionCompactLabel(rule) {
  const label = typeof rule?.label === 'string' ? rule.label : '';
  const high = label.match(/52週高値からの距離 ≤ (\d+(?:\.\d+)?)%/), low = label.match(/52週安値から ≥ (\d+(?:\.\d+)?)%/);
  return high ? `高値から${high[1]}%以内` : low ? `安値から${low[1]}%以上` : conditionShortLabel(rule);
}

/** 「高値から25%以内（30.2%）」, 「RS ≥ 70（61）」: the compact name and, when the rule has one, its value. */
export function conditionCompactText(rule) {
  const value = conditionValueText(rule);
  return `${conditionCompactLabel(rule)}${value === null ? '' : `（${value}）`}`;
}

// Row-chip names of the moving-average rules, in the 日線 words of the stock screen (the chip's title and
// the row's label keep the full rule).
const CHIP_LABELS = [
  [/^株価 > SMA50$/, '株価 > 50日線'], [/^株価 > SMA150・SMA200$/, '株価 > 150・200日'], [/^SMA150 > SMA200$/, '150日 > 200日'],
  [/^SMA200の21営業日上昇$/, '200日線が上向き'], [/^SMA50 > SMA150・SMA200$/, '50日 > 150・200日'], [/^日足の整合性・252本$/, '日足の整合性'],
];

/**
 * A rule's name for a phone row's chip (「あと1条件：…」), the shortest of the three: the compact name,
 * with the moving-average comparisons in 日線 words (「150日 > 200日」), so the chip fits the row's second line.
 * The RS rule is named by the estimate, 「RS推計」: the row drops its own RS推計 chip for it, so this chip carries the
 * word and the value (「あと1条件：RS推計（61）」); its threshold is in the chip's title and the row's label, which
 * keep the full rule (「未達：RS ≥ 70（61）」), so a 320px row with a sell chip still keeps two chip lines.
 */
export function conditionChipLabel(rule) {
  const compact = conditionCompactLabel(rule);
  if (/^RS ≥ \d+$/.test(compact)) return 'RS推計';
  return CHIP_LABELS.find(([pattern]) => pattern.test(compact))?.[1] || compact;
}
