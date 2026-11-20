// The market gate's facts that the market tab already reads (plan D12): small pure readers moved here from the lazily loaded
// market modules, so Today's gate card and the wide market pane can read them without loading the market tab. The market
// tab's modules import them back and re-export them under their old names (reference/marketTabStudy.js: publishedMarketContext,
// REGIME_NAMES, regimeCause, gspcFtdWords; marketTabOnly.js: breakoutView), and marketTabGroups.js builds its 銘柄側 line and leader-health row from
// stockSideTerms and leaderHealthView. Nothing here adds a threshold, a status or a verdict.
import { BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from '../marketLongHistory';
import { capText } from '../portfolioPlan';
import { ftdPrevious, shortDate, BREAKOUT_HOLD_NAME, ENV_RULES, FTD_PREVIOUS_NAME, FTD_TEXT } from './briefModel';
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

// ---- the regime's cause line (moved from reference/marketTabStudy.js) ----------------------------------------------------

/** What the backend regime reads besides the count (market_regime.py: the 50/200-day lines and the breadth guard). */
const REGIME_READS = '分配日のほか50日線・200日線と参加度も見ます';

/**
 * What the app's own ^GSPC record of the analysis date (gspcFollowThrough: the フォロースルーデー row and its ◆) reads
 * beside the regime's SPY FTD, in words, only where the two differ: 「^GSPCの日足ではFTD未確認」 / 「…FTD失敗」 for a
 * record that is not a confirmed FTD, 「^GSPCの日足ではFTD 8/13」 for a confirmed one dated otherwise than the regime's
 * known FTD date, 「^GSPCの日足では前回のFTD 8/13」 when that FTD is older than FTD_RECENT_SESSIONS (ftdPrevious, as the
 * row, its ◆ and ownFtdLine call it; a record without a whole count keeps 「FTD」); else null (the same reading, an
 * unknown regime date, or no record of that day to compare).
 */
export function gspcFtdWords(ft, ftdDate, date) {
  if (!ft) return null;
  if (ft.state === 'ftd_failed') return '^GSPCの日足ではFTD失敗';
  if (ft.state !== 'confirmed') return '^GSPCの日足ではFTD未確認';
  const own = ft.ftd?.date;
  return ftdDate && isDay(own) && own !== ftdDate ? `^GSPCの日足では${ftdPrevious(ft) ? FTD_PREVIOUS_NAME : 'FTD'} ${shortDate(own, date)}` : null;
}

/**
 * One line under the verdict's basis on why the regime (局面判定, the backend's SPY read) reads as it does (inside
 * 「目安と判定の基準」).
 *  - An FTD-upgraded uptrend (modelMarket's ftdUpgraded) whose guide is 0%: the regime is confirmed_uptrend through SPY's
 *    follow-through day while SPY is under a line. The FTD's date comes only from the regime's block (`context`,
 *    publishedMarketContext); without it the date is left out, never guessed from the ^GSPC series. When the app's own
 *    ^GSPC record of that day reads otherwise (`gspc`, gspcFollowThrough), the line says what it reads (gspcFtdWords),
 *    so the two FTD reads on the screen are each attributed. The guide is printed from the cap (capText), never typed.
 *  - Otherwise, with the regime's block for the analysis date: its SPY distribution count (stalling days included), kept
 *    apart from the ^GSPC/^IXIC counts of the 分配日 row. The regime is named only where the basis line does not already
 *    name it (it does for 上昇トレンド and 上昇に圧力). Under any regime but a confirmed uptrend the line adds that the
 *    regime also reads the moving averages and the breadth (REGIME_READS), so a small count never reads as its cause.
 *    A null count reads 未収録, never 0. Under a correction or a downtrend, a confirmed ^GSPC record of the same day adds
 *    that it is the index's separate count (ownFtdLine, M2).
 *  - Without the block (an older publication): null, the basis line alone as before.
 * A block is used only when its regime is the verdict's rows' regime (a market without one borrows none).
 */
export function regimeCause(market, context, basis, date, { gspc = null } = {}) {
  if (!market || market.state === 'unknown') return null;
  const block = context && market.regime && context.regime === market.regime ? context : null;
  if (market.ftdUpgraded === true && market.cap === 0) {
    const ftdDate = block?.ftd_date || null, other = gspcFtdWords(gspc, ftdDate, date);
    return `局面判定はSPYのFTD${ftdDate ? `（${shortDate(ftdDate, date)}）` : ''}による上昇トレンド。${other ? `${other}。` : ''}この目安はSPYが${basis?.above200 === false ? '200日線' : '50日線'}の下のため${capText(market.cap)}（独自判定）`;
  }
  const name = block ? REGIME_NAMES[block.regime] : null;
  if (!name) return null;
  const count = block.distribution_days === null ? '局面判定の分配日（SPY）は未収録' : `局面判定の分配日：SPY ${num(block.distribution_days)}日（ストーリング日を含む数え方）`;
  const reads = block.regime !== 'confirmed_uptrend', named = Boolean(basis?.text?.includes(`「${name}」`));
  const regime = named ? (reads ? `局面判定は${REGIME_READS}` : null) : `局面判定は「${name}」${reads ? `で、${REGIME_READS}` : ''}`;
  return [count, regime, ownFtdLine(block, gspc, date)].filter(Boolean).join('。');
}

/**
 * Under a correction or a downtrend, the app's own ^GSPC record of the same day (`gspc`, gspcFollowThrough, dated `date`)
 * that still reads a confirmed FTD (M2): one clause saying it is the index's separate count, which a decline under
 * FTD_TEXT.decline from the high does not withdraw (独自設定), 「前回のFTD」 when older than FTD_RECENT_SESSIONS. A record of
 * another day, any other state or any other regime adds nothing.
 */
function ownFtdLine(block, gspc, date) {
  if (!['correction', 'downtrend'].includes(block.regime) || gspc?.available !== true || gspc.state !== 'confirmed' || !isDay(date) || gspc.asOf !== date) return null;
  const day = isDay(gspc.ftd?.date) ? `（${shortDate(gspc.ftd.date, date)}）` : '';
  return `下の^GSPCの${ftdPrevious(gspc) ? FTD_PREVIOUS_NAME : 'FTD'}${day}は指数の別集計で、高値から${FTD_TEXT.decline}未満の下落では取り消しません（独自設定）`;
}

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

/** The 銘柄側 line's head (M6): the stock side, for reference, beside a guide it does not move. */
export const STOCK_SIDE_HEAD = '銘柄側（参考・目安は変えません）';
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

// ---- what the gate reads of the 地合い card's shared values --------------------------------------------------------------

/**
 * The 地合い card's values the market gate's facts read (marketGate.js gateFacts), from marketCardView's shared values (its own
 * names): pass it as marketCardView's `facts` option, as the market tab passes `tab`. The breadth rows (a200, a50), TT達成 (tt),
 * the two indices' distribution counts (dist) and the new highs and lows are the card's own; the breakout row and the leaders'
 * health are this module's readers, with the raw counts of the rows their rates read (`counts`, null where a count is not a whole
 * number: a reader never prints 0 for it); the 銘柄側 terms are stockSideTerms'. Null fields mean the series is not ready.
 */
export function gateReads(shared) {
  const { ready, status, rows, last, known, date, tt, a200, a50, dist, highsLows, extremesAsOf } = shared;
  const { breakout } = breakoutView(shared);
  const health = leaderHealthView(shared);
  const whole = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const rate = known('breakoutHoldPercent'), healthRate = known('leaderHealthPercent');
  const counts = {
    breakout: rate ? { held: whole(rate.row.breakoutsHeld), judged: whole(rate.row.breakoutsJudged) } : null,
    health: health.cohort !== null && healthRate ? { above: whole(healthRate.row.leaderCohortAbove50), cohort: whole(health.cohort) } : null,
  };
  return { ready, status, tt, a200, a50, dist, highsLows, extremesAsOf, breakout, health, counts,
    stockSide: ready ? stockSideTerms({ rows, last, date, known, tt, breakout, health }) : null };
}
