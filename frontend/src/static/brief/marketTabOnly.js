// The market tab's own parts of marketTabModel.js: values and the breakout row that only the lazily loaded market screen
// (its groups, its index switch and the study it computes) reads. marketTabModel.js re-exports the values, so their
// importers are unchanged, and Today's entry chunk ships none of this. Nothing here adds a threshold, a status or a verdict.
import { BREAKOUT_MIN_SAMPLE } from '../marketLongHistory';
import { ENV_RULES } from './briefModel';
import { monthBefore, num, pointChange, rangePosition, yearRange, BREAKOUT_HOLD_LABEL, BREAKOUT_WINDOW_TEXT, RULE_TEXT } from './marketTabModel';

const finite = Number.isFinite;
/**
 * The breadth series are today's names traced back (the long history's current-universe retrospective): said
 * under the 参加度 and リーダー headers on the desktop, in the 注記 on a phone and in the long history's takeaway.
 */
export const SURVIVORSHIP_NOTE = '現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）';
export const STAGE_FIELDS = ['stage1Percent', 'stage2Percent', 'stage3Percent', 'stage4Percent'];

// Only ever called with a finite number: a unit is never appended to an unknown value.
const sign = value => value > 0 ? '+' : value < 0 ? '−' : '±';
export const signedPercent = value => { const r = Number(value.toFixed(1)); return `${sign(r)}${Math.abs(r).toFixed(1)}%`; };

/**
 * An index series of closes the market tab can chart (indices[i].closes, plan §2.3, validated by readMarketTrends):
 * at least the chart's 60 sessions, else null. Older publications have none: then there is no S&P／Nasdaq switch.
 */
export function indexCloses(item) {
  const closes = Array.isArray(item?.closes) ? item.closes.filter(point => finite(point?.close)) : [];
  return closes.length >= 60 ? closes : null;
}

/** The one session every valued item of a group describes, when they all agree on an older one. */
export function groupDate(items) {
  const valued = items.flatMap(item => item?.rows ? item.rows : [item]).filter(item => item?.valued);
  return valued.length && valued.every(item => item.asOf && item.asOf === valued[0].asOf) ? valued[0].asOf : null;
}

/**
 * The リーダー group's breakout row (`breakout`) and the newest session's judged breakouts (`judgedNow`: a whole number, else
 * null), from marketCardView's shared values (its own names). Only the market tab's parts (marketTabParts) read them;
 * Today's four facts never do.
 */
export function breakoutView({ rows, last, known, rule, older, absent }) {
  // Breakout success: a rate needs at least BREAKOUT_MIN_SAMPLE judged breakouts on that session.
  const rate = known('breakoutHoldPercent');
  const judgedNow = last && Number.isSafeInteger(last.breakoutsJudged) ? last.breakoutsJudged : null;
  const whyNot = !last || !('breakoutsJudged' in last) ? null : judgedNow === null ? '判定期間に観測不足の日を含む' : judgedNow < BREAKOUT_MIN_SAMPLE ? `${judgedNow}件（${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示）` : '成功数を確認できません';
  const breakoutRule = rule('breakout');
  const breakout = (() => {
    const base = { key: 'breakout', label: BREAKOUT_HOLD_LABEL, metric: 'breakoutHoldPercent', rule: RULE_TEXT.breakout };
    if (rate) {
      const before = monthBefore(rows, rate, 'breakoutHoldPercent'), range = yearRange(rows, rate, 'breakoutHoldPercent'), newest = rate.index === rows.length - 1;
      return { ...base, valued: true, b: `${num(rate.value)}%`, asOf: older(rate.date), change: before === null ? null : pointChange(rate.value - before, 0), range, position: rangePosition(range), format: value => `${num(value)}%`,
        note: newest ? `${rate.row.breakoutsJudged}件で判定` : `${rate.row.breakoutsJudged}件で判定${whyNot ? `・最新は${whyNot}` : ''}`,
        detail: newest && Number.isSafeInteger(rate.row.breakoutsHeld) ? `${BREAKOUT_WINDOW_TEXT}の上抜け${rate.row.breakoutsJudged}件のうち${rate.row.breakoutsHeld}件が10日間で−7%に届かず` : null,
        warn: Boolean(breakoutRule?.fired), flag: breakoutRule?.fired ? `${ENV_RULES.breakoutHoldBelow}%未満` : null };
    }
    if (judgedNow !== null && judgedNow < BREAKOUT_MIN_SAMPLE) return { ...base, valued: true, b: `${judgedNow}件`, asOf: older(last.date), note: `${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示` };
    return whyNot ? { ...base, b: '未算出', note: whyNot } : { ...base, ...absent('breakoutsJudged') };
  })();
  return { breakout, judgedNow };
}
