// The one buy gate (round 2, VD3): what the stock conclusion says, whether its meter and tiles are a
// reference only (参考), and the reason the position plan's heading names, from one decision, so the call,
// the three tiles, positionPlan and the plan card can no longer disagree. Pure; every input is the
// caller's (the candidate view, the trend template, the market verdict, the sell checks, the earnings call
// and the day's dated event). Every step only removes green or adds a warning: nothing here grants a buy.
// positionSizing imports this module and nothing here imports it back, so there is no cycle.
import { finite } from '../researchEngine';
import { conditionCompactLabel, conditionCompactText, conditionNote, conditionNoteValue } from '../missingCondition';
import { baseShortfall, candidateMarketGate, POSITION_NAMES, ratioShown, SE_BELOW_FLOOR_CHECK, SE_CONFIDENCE_FLOOR, underTenth } from './briefCandidate';
import { crossingEvent } from './breakoutHistory';
import { isBreakdown, SELL_RULES } from './briefSell';
import { shortDate } from './briefShared';

/**
 * The Setup Engine's pattern-confidence floor (the backend aggregator's default, 55.0) and the check it names
 * (setup_recalculation.reason) for a primary pattern below it: a fallback, so its pivot is only a reference
 * (独自判定 on screen). One constant, the rows' pivot source's (briefCandidate), re-exported here.
 */
export { SE_BELOW_FLOOR_CHECK, SE_CONFIDENCE_FLOOR };

/** Why no new plan is made, by position (the zone and the wait state get a plan). */
export const PLAN_BLOCKED = Object.freeze({
  ext: '買いゾーン超過：新規の試算はしません（次の土台を待つ）',
  low: '低変動・監視のみ：新規の試算はしません',
  acq: '買収合意・対象外：新規の試算はしません',
  na: '判定不可：新規の試算はしません（有効な買い水準が未確認）',
});

/** The market's exposure guide (modelMarket: cap 0.5, 0.25 or 0) as a percentage, or null if unknown. */
export function marketGuidePercent(market) {
  if (!market || market.state === 'unknown' || !finite(market.cap) || market.cap < 0) return null;
  return market.cap * 100;
}

/**
 * Why the trend template leaves the plan a reference only, from the template alone: TT未達 when a rule
 * failed; TT未確認 without a template, with an unknown rule, or when the daily-bar integrity rule has not
 * passed; null when the template passes.
 * @returns {'TT未達'|'TT未確認'|null}
 */
export function templateReference(template) {
  if (!template) return 'TT未確認';
  if (finite(template.failed) && template.failed > 0) return 'TT未達';
  if (template.failed !== 0 || template.unknown !== 0 || template.integrity?.state !== 'pass') return 'TT未確認';
  return null;
}

/**
 * Whether the stock's Setup Engine base is current for the analysis date and above the confidence floor
 * (VD4), as { current, note }: the rows' predicate (briefCandidate's baseShortfall, so a row never stays green
 * beside this check), with the conclusion's words for why not: setup_recalculation missing, not 'calculated' or of
 * another day, se_pattern_confidence missing (土台の信頼度 未確認, never 0) or under SE_CONFIDENCE_FLOOR, or a reason
 * naming SE_BELOW_FLOOR_CHECK. A certified VCP footprint never overrides it (the default of owner decision §9-13).
 */
export function baseCheck(view) {
  const short = baseShortfall(view?.row, view?.asOf);
  if (!short) return { current: true, note: null };
  const no = note => ({ current: false, note });
  switch (short.kind) {
    case 'unavailable': return no('土台の再計算不可');
    case 'otherDay': return no(`土台の再計算が分析日のものではありません（${shortDate(short.date, view.asOf)}）`);
    case 'noConfidence': return no('土台の信頼度 未確認');
    case 'belowFloor': return no(`土台の信頼度 ${Math.floor(short.confidence)}（基準${SE_CONFIDENCE_FLOOR}）`);
    // The published confidence may clear the floor while the engine names its primary pattern below it: say that, not the number.
    case 'primaryBelowFloor': return no(`主パターンが信頼度の基準${SE_CONFIDENCE_FLOOR}未満（Setup Engine）`);
    default: return no('土台の再計算 未確認');
  }
}

/** The first rule, then 「、ほかN件」 (one rule keeps its value), with the parts a line never splits. */
function listed(prefix, rules) {
  const unit = rules.length === 1 ? conditionCompactText(rules[0]) : conditionCompactLabel(rules[0]);
  return { note: `${prefix}：${unit}${rules.length > 1 ? `、ほか${rules.length - 1}件` : ''}。`, units: [unit] };
}

/**
 * Why the stock is no buy candidate by the trend template, from the template's own rules (never from
 * `qualified` alone), or null when it is one. Every unmet rule is counted in a one-line title (「TT 1条件未達
 * — 買いの対象外」, one line at 375px in a full-width font) and named in the line under it (`note`): the
 * RS estimate as 「未達：RS推計 57（基準70）」 (conditionNote), any other rule with its value.
 */
function templateCall(view, template) {
  const rules = template?.rules || [];
  const failed = rules.filter(rule => rule.state === 'fail'), open = rules.filter(rule => rule.state !== 'pass' && rule.state !== 'fail');
  if (failed.length === 1 && /^RS 推計/.test(failed[0].label)) return { title: 'TT 1条件未達 — 買いの対象外', note: `${conditionNote(failed[0])}。`, units: [conditionNoteValue(failed[0])], reason: 'TT未達' };
  if (failed.length) return { title: `TT ${failed.length}条件未達 — 買いの対象外`, ...listed('未達', failed), reason: 'TT未達' };
  if (!template && view.failed > 0) return { title: 'トレンドテンプレート未達 — 買いの対象外', reason: 'TT未達' };
  if (open.length || (!template && view.unknown > 0)) return { title: 'TT未確認・買い判断不可', ...(open.length ? listed('未確認', open) : {}), reason: 'TT未確認' };
  if (view.qualified === true) {
    // Selected, but the template itself is not passed (none, its counts, or the daily-bar integrity rule): never green.
    const reference = templateReference(template);
    return reference ? { title: reference === 'TT未達' ? 'トレンドテンプレート未達 — 買いの対象外' : 'TT未確認・買い判断不可', reason: reference } : null;
  }
  const integrity = template?.integrity && template.integrity.state !== 'pass' ? `日足の整合性 ${template.integrity.state === 'fail' ? '未達' : '未確認'}` : null;
  return { title: `選定対象外（${view.exclusion || integrity || '選定の判定を確認できません'}）`, reason: templateReference(template) || '選定対象外' };
}

/** The position call when nothing stops it: tone and title only (the conclusion writes the line under it). */
function positionCall(view) {
  switch (view.position) {
    // Just under the pivot the gap is 「0.1%未満」, never a 0.0% that does not exist.
    case 'near': return { kind: 'near', tone: 'wait', title: `${POSITION_NAMES.near}（あと${underTenth(view.distance) ? '0.1%未満' : `${Math.abs(view.distance).toFixed(1)}%`}）` };
    case 'base': return { kind: 'basePosition', tone: 'neutral', title: POSITION_NAMES.base };
    case 'ext': return { kind: 'ext', tone: 'ext', title: POSITION_NAMES.ext };
    case 'staleAbove': case 'staleBelow': return { kind: 'stalePivot', tone: view.stale?.above ? 'ext' : 'neutral', title: view.stale?.text || view.stateLabel };
    default: return { kind: 'unjudged', tone: 'neutral', title: view.stateLabel || '判定不可' };
  }
}

/** The plan heading's earnings reason, by the call's phase: before, on or after the date (決算 when the days are not given). */
const earningsReason = call => (!finite(call.days) ? '決算' : call.days > 0 ? '決算前' : call.days === 0 ? '決算当日' : '決算後');

/** The line under a heavy down day in the zone: no buy range is printed with it (VD3). */
export const HEAVY_DOWN_NOTE = `このため新規の買いは見送ります（出来高${ratioShown(SELL_RULES.breakVolumeRatio)}以上の下落日・独自判定）。`;

/**
 * The one buy gate: `{ kind, tone, title, note, units, reference, reason, moved, blocked, trialOnly, event }`.
 * - `tone`/`title`/`note`: the conclusion's call (`note` the line under it; `units` the parts of it a line
 *   never splits). `moved`: the position moves under a neutral call (位置は参考：…).
 * - `reference`: the call is no buy now, so the meter and the three tiles read 参考.
 * - `reason`: the plan heading's 参考 reason, for every position that gets a plan, in the conclusion's order:
 *   TT未達 / TT未確認 / 選定対象外, 崩れ (a broken setup or a failed breakout), 土台未確認 (VD4), 地合い (a known
 *   market with a cap of 0) / 地合い未確認, 決算前 / 決算当日 / 決算後 (決算 without the days), 下落日の大商い, 停滞
 *   (VD1); null when none applies.
 * - `blocked`: PLAN_BLOCKED's reason for a position that gets no plan, else null. `trialOnly`: the market
 *   guide allows no new position or is unknown (試算のみ).
 * Inputs: `view` (candidateView), `template` (trendTemplate), `market` (prepared.market), `sells` (the
 * stock's sell checks; `broken: true` stands for a broken setup when the caller has only that), `earnings`
 * (earningsCall's `{ days, soon, line }`, or null), `event` (crossingEvent's, computed from `judged`, the certified
 * bars, when it is not given) and `base` (baseCheck's, computed from the view when not given).
 */
export function buyGate({ view, template = null, market = null, sells = null, broken = false, earnings = null, event, base, judged = null } = {}) {
  const blocked = (view && PLAN_BLOCKED[view.state]) || null, guide = marketGuidePercent(market), trialOnly = !(guide > 0);
  if (!view) return { kind: 'unjudged', tone: 'neutral', title: '判定不可', note: null, units: [], reference: false, moved: false, reason: null, blocked, trialOnly, event: null };
  const day = event === undefined ? crossingEvent(view, judged, { staleSessions: SELL_RULES.staleBreakoutSessions }) : event;
  const tt = templateCall(view, template);
  const breakdown = Array.isArray(sells?.weakness) ? sells.weakness.find(isBreakdown) : null;
  const isBroken = Boolean(breakdown) || broken === true;
  const footing = base === undefined ? baseCheck(view) : base;
  const gate = candidateMarketGate(market);
  const zoneReason = view.position === 'zone' ? (day?.kind === 'heavyDown' ? '下落日の大商い' : day?.kind === 'stale' ? '停滞' : null) : null;
  const reason = tt?.reason ?? (isBroken ? '崩れ' : null) ?? (footing?.current === false ? '土台未確認' : null)
    ?? (gate === 'hold' ? '地合い' : gate !== 'open' ? '地合い未確認' : null) ?? (earnings?.soon ? earningsReason(earnings) : null) ?? zoneReason;
  const result = (call, extra = {}) => ({ note: null, units: [], reference: false, moved: false, ...call, ...extra, reason, blocked, trialOnly, event: day ?? null });

  const moved = { reference: true, moved: true };
  if (tt) return result({ kind: 'template', tone: 'neutral', title: tt.title, note: tt.note ?? null, units: tt.units ?? [] }, moved);
  // A broken buy setup is never a buy-side call, whatever the position: a neutral line names the check.
  if (breakdown?.key === 'failedBreakout') {
    const unit = `${shortDate(breakdown.crossDate, view.asOf)}に出来高${ratioShown(breakdown.ratio)}で上抜け`;
    return result({ kind: 'failedBreakout', tone: 'neutral', title: 'ブレイク失敗（独自判定）', note: `${unit}、ピボットの下へ戻りました。`, units: [unit], check: breakdown }, moved);
  }
  if (isBroken) {
    const text = breakdown ? breakdown.headline || breakdown.label : null;
    return result({ kind: 'broken', tone: 'neutral', title: '買いの前提が崩れた（独自判定）', note: text ? `${text}。` : null, units: text ? [text] : [], check: breakdown }, moved);
  }
  // The market, the base and the earnings date only stop what would otherwise invite a buy: the buy zone and near the pivot.
  if (view.position !== 'zone' && view.position !== 'near') return result(positionCall(view));
  if (footing?.current === false) return result({ kind: 'baseCheck', tone: 'neutral', title: '土台を確認できない — ピボットは参考（独自判定）', note: `${footing.note}。`, units: [footing.note] }, moved);
  if (gate === 'hold') return result({ kind: 'marketHold', tone: 'neutral', title: '地合いが新規の買いを控える状態（独自判定）' }, moved);
  if (gate !== 'open') return result({ kind: 'marketUnknown', tone: 'neutral', title: '地合い未確認（新規の買いは判断を保留）' }, moved);
  if (earnings?.soon) return result({ kind: 'earnings', tone: 'neutral', title: earnings.line }, moved);
  if (view.position === 'near') return result(positionCall(view));
  // In the buy zone: the day's event (breakoutEvent's, its 'after' dated by crossingEvent).
  if (day?.kind === 'heavyDown') return result({ kind: 'heavyDown', tone: day.tone, title: day.title, note: HEAVY_DOWN_NOTE, reference: true });
  if (day?.kind === 'stale') return result({ kind: 'stale', tone: 'wait', title: day.title, note: day.note, units: day.units ?? [], reference: true });
  return result({ kind: day?.kind || 'zone', tone: day?.tone || 'zone', title: day?.title || '買いゾーン内', note: day?.note ?? null });
}
