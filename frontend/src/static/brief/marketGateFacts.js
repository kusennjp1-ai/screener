// The market gate's facts that the market tab already reads (plan D12): small pure readers moved here from the lazily loaded
// market modules, so Today's gate card and the wide market pane can read them without loading the market tab. The market
// tab's modules import them back and re-export them under their old names (reference/marketTabStudy.js: publishedMarketContext,
// REGIME_NAMES; marketTabOnly.js: breakoutView), and marketTabGroups.js builds its 銘柄側 line and leader-health row from
// stockSideTerms and leaderHealthView. Nothing here adds a threshold, a status or a verdict.
import { BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from '../marketLongHistory';
import { shortDate, BREAKOUT_HOLD_NAME, ENV_RULES } from './briefModel';
import { monthBefore, num, pointChange, rangePosition, yearRange, BREAKOUT_HOLD_LABEL, BREAKOUT_WINDOW_TEXT, RULE_TEXT } from './marketTabModel';

const finite = Number.isFinite;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// ---- the judge side's market block (moved from reference/marketTabStudy.js) ----------------------------------------------

const REGIMES = new Set(['confirmed_uptrend', 'uptrend_under_pressure', 'correction', 'downtrend']);
const count = value => Number.isSafeInteger(value) && value >= 0;
/**
 * The judge side's market block, `manifest.markets.US.market_context` (plan §2.3, exported by the data track), read
 * raw like publishedFundamentalsCoverage: returned only when it is in shape and dated for the analysis date `date`,
 * else null (an older publication never has it). A null field stays null: a reader says 未収録, never 0.
 */
export function publishedMarketContext(marketEntry, { date = null } = {}) {
  const block = marketEntry?.market_context;
  if (!block || typeof block !== 'object' || Array.isArray(block) || !isDay(date) || block.as_of_date !== date) return null;
  if (marketEntry.as_of_date !== undefined && marketEntry.as_of_date !== date) return null;
  if (block.method !== 'backend-market-regime-v1' || block.source !== 'scan-rows' || !REGIMES.has(block.regime)) return null;
  if (!(block.distribution_days === null || count(block.distribution_days)) || !(block.ftd_days_since === null || count(block.ftd_days_since))) return null;
  if (!(block.ftd_date === null || (isDay(block.ftd_date) && block.ftd_date <= date)) || !(block.exposure_pct === null || finite(block.exposure_pct))) return null;
  return block;
}

/** The backend regimes (market_context.regime) in the app's words. */
export const REGIME_NAMES = Object.freeze({ confirmed_uptrend: '上昇トレンド', uptrend_under_pressure: '上昇に圧力', correction: '調整', downtrend: '下降トレンド' });

// ---- the リーダー group's breakout row (moved from marketTabOnly.js) -------------------------------------------------------

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

// ---- the leaders' health and the 銘柄側 terms (taken out of marketTabGroups.js) ---------------------------------------------

/**
 * The リーダー group's leader-health row (`item`) and the cohort its rate reads (`cohort`: null while the newest cohort is too
 * small for a rate, or without a rate), from marketCardView's shared values (its own names). `details(row)` gives the opened
 * row's lines from the row the value reads (the market tab passes its RS推計90 line, rs90CohortLine); without it, none.
 */
export function leaderHealthView({ rows, last, known, rule, older, absent }, details = () => []) {
  const leadersRule = rule('leaders');
  const health = known('leaderHealthPercent');
  const cohortNow = last && Number.isSafeInteger(last.leaderCohort) ? last.leaderCohort : null;
  const healthBase = { key: 'health', label: 'リーダーの健全度', metric: 'leaderHealthPercent', rule: RULE_TEXT.leaders };
  // A newest cohort too small for a rate is today's state; an older rate is not shown in its place.
  // M8a: the RS推計90 part of the cohort, from the row the value reads (the newest for a small cohort, the rate's own row).
  const healthItem = cohortNow !== null && cohortNow < LEADER_MIN_COHORT ? { ...healthBase, valued: true, b: `${cohortNow}銘柄`, asOf: older(last.date), note: `20営業日前のTT達成が${LEADER_MIN_COHORT}銘柄未満のため率は非表示`, details: details(last) }
    : health ? (() => { const before = monthBefore(rows, health, 'leaderHealthPercent'), range = yearRange(rows, health, 'leaderHealthPercent');
      return { ...healthBase, valued: true, b: `${num(health.value)}%`, asOf: older(health.date), change: before === null ? null : pointChange(health.value - before, 0), range, position: rangePosition(range), format: value => `${num(value)}%`,
        note: `20営業日前のTT達成${num(health.row.leaderCohort)}銘柄が対象`, detail: `${num(health.row.leaderCohort)}銘柄のうち${num(health.row.leaderCohortAbove50)}銘柄が50日線の上`, details: details(health.row),
        warn: Boolean(leadersRule?.fired), flag: leadersRule?.fired ? `${ENV_RULES.leaderHealthBelow}%未満` : null }; })()
      : { ...healthBase, ...absent('leaderCohort') };
  return { item: healthItem, cohort: health && !(cohortNow !== null && cohortNow < LEADER_MIN_COHORT) ? health.row.leaderCohort : null };
}

/** The TT term's name on the 銘柄側 line (the row's own label is TT達成数). */
const STOCK_SIDE_TT = 'TT達成';

/**
 * The 銘柄側 line's three terms (M6), `{ name, value, asOf, extra }` each, and the long history's own session when it is older
 * than the analysis date (`shared`): TT達成 with its count 21 sessions before, the breakout row with the breakouts it judged,
 * the leaders' health (`health`: leaderHealthView's `{ item, cohort }`) with its cohort. A term without a value carries its
 * row's own absent words, never 0. The market tab's stockSideLine words them into its one line.
 */
export function stockSideTerms({ rows, last, date, known, tt, breakout, health }) {
  const ttHit = known('trendTemplateCount'), ttBefore = ttHit ? monthBefore(rows, ttHit, 'trendTemplateCount') : null;
  const rate = known('breakoutHoldPercent');
  const terms = [
    tt.valued && ttHit ? { name: STOCK_SIDE_TT, value: num(ttHit.value), asOf: tt.asOf, extra: ttBefore === null ? '1か月前の値なし' : `1か月前 ${num(ttBefore)}` } : { name: STOCK_SIDE_TT, value: tt.b },
    breakout.valued ? { name: BREAKOUT_HOLD_NAME, value: breakout.b, asOf: breakout.asOf, extra: rate ? `${num(rate.row.breakoutsJudged)}件` : null } : { name: BREAKOUT_HOLD_NAME, value: breakout.b },
    health.item.valued ? { name: health.item.label, value: health.item.b, asOf: health.item.asOf, extra: health.cohort === null ? null : `${num(health.cohort)}銘柄` } : { name: health.item.label, value: health.item.b },
  ];
  // The long history's own session, when it is older than the analysis date (the rows' asOf of that session reads the same).
  const shared = last && date && last.date < date ? shortDate(last.date, date) : null;
  return { terms, shared };
}
