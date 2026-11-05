// Position sizing for the stock screen's plan: the entry, the stop, the R levels and the shares a
// fixed account risk buys, bound by a single-stock cap and the account itself (no margin). Pure; the
// stop is capped below STOP_MAX_PERCENT. A plan is made only in the buy zone (entry = price) and below
// the pivot (entry = pivot); every other position is blocked with its reason. Values derived from the
// chart (the structural stop, ADR) come from certified bars only; unknown stays unknown.
import { finite } from '../researchEngine';

export const STOP_DEFAULT_PERCENT = 7;
export const STOP_MAX_PERCENT = 10;
/** The smallest stop width an input, the slider or the structural stop may set. */
export const STOP_MIN_PERCENT = 1;
/** The widest stop the plan accepts (the inputs move in 0.5% steps below STOP_MAX_PERCENT). */
export const STOP_LIMIT_PERCENT = STOP_MAX_PERCENT - 0.5;
/** 1銘柄の上限（%）: the single-stock cap's default, a disclosed house setting (独自設定). */
export const POSITION_CAP_DEFAULT_PERCENT = 25;
export const POSITION_CAP_MAX_PERCENT = 100;
/** The structural stop sits this far below the last contraction's low (独自設定). */
export const STRUCTURAL_STOP_BUFFER_PERCENT = 0.5;
/** ADR%: the mean daily range (high ÷ low − 1) over this many certified bars (独自計算). */
export const ADR_SESSIONS = 20;
/** The plan inputs and their defaults. */
export const PLAN_DEFAULTS = Object.freeze({ stopPercent: STOP_DEFAULT_PERCENT, account: 50000, riskPercent: 1.25, capPercent: POSITION_CAP_DEFAULT_PERCENT });

/** Why no new plan is made, by position (the zone and the wait state get a plan). */
export const PLAN_BLOCKED = Object.freeze({
  ext: '買いゾーン超過：新規の試算はしません（次の土台を待つ）',
  low: '低変動・監視のみ：新規の試算はしません',
  acq: '買収合意・対象外：新規の試算はしません',
  na: '判定不可：新規の試算はしません（有効な買い水準が未確認）',
});

/**
 * The plan object. The first fields are what the plan carried in step 0; the others belong to the
 * contract other modules read (the conclusion tiles, the chart).
 * @typedef {object} PositionPlan
 * @property {number} entry Planned entry: the price in the buy zone, the pivot below it.
 * @property {'price'|'pivot'} basis What the entry is (「現在値で買う場合」 / 「ピボットで買う場合」).
 * @property {number} stop The entry less stopPercent.
 * @property {number} stopPercent The stop width used (STOP_MIN_PERCENT to STOP_LIMIT_PERCENT).
 * @property {number} risk Entry − stop, per share.
 * @property {number} r2 Entry + 2R.
 * @property {number} r3 Entry + 3R.
 * @property {number|null} riskDollars Account × risk %, or null without a usable account and risk.
 * @property {number|null} shares Whole shares, never 0: floor(min(risk$ ÷ risk, account × cap ÷ entry,
 *   account ÷ entry)), or null when that is not a whole share or cannot be computed.
 * @property {number|null} cost Shares × entry, or null. Never above the account (no margin).
 * @property {number|null} weight The cost as a % of the account (≤ 100), or null.
 * @property {number} capPercent The single-stock cap used (0 to POSITION_CAP_MAX_PERCENT).
 * @property {'risk'|'cap'|'account'|null} binding The constraint that set the share count (null
 *   without a risk budget).
 * @property {number|null} actualRisk Shares × risk: the loss at the stop, or null.
 * @property {boolean} trialOnly The market guide allows no new position (0%) or is unknown: 試算のみ.
 * @property {{known: boolean, maxPercent: number|null, usedPercent: number|null, over: boolean}} marketGuide
 *   The market's exposure guide (地合いの目安) and how much of it this position takes.
 * @property {boolean} reference The trend template has a failed rule: shown for reference only (参考).
 * @property {boolean} defaults Every input (account, risk, stop, cap) is still at its default (既定条件).
 * @property {StructuralStop} structural The stop from the last measured contraction, or why there is none.
 * @property {number|null} adrPercent ADR% over ADR_SESSIONS certified bars, or null (ADR 未確認).
 * @property {string} [blocked] Why no plan is made; a blocked plan carries no other field.
 */

/**
 * @typedef {object} StructuralStop
 * @property {'ok'|'tooDeep'|'tooShallow'|'above'|'unknown'} state ok: usable; tooDeep: wider than
 *   STOP_LIMIT_PERCENT (見送り候補); tooShallow: narrower than STOP_MIN_PERCENT; above: the low is at or
 *   above the entry; unknown: not measured (収縮の安値 未確認), with `reason`.
 * @property {number|null} low The last measured contraction's low.
 * @property {string|null} lowDate Its date.
 * @property {number|null} stop low × (1 − STRUCTURAL_STOP_BUFFER_PERCENT / 100).
 * @property {number|null} percent (entry − stop) ÷ entry × 100.
 * @property {number} buffer STRUCTURAL_STOP_BUFFER_PERCENT.
 * @property {string|null} reason Why it is unknown.
 */

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** One plan input clamped to its range (the stop below STOP_MAX_PERCENT, the cap at most 100%). */
export function clampPlanSetting(key, value) {
  if (key === 'stopPercent') return clamp(value, STOP_MIN_PERCENT, STOP_LIMIT_PERCENT);
  if (key === 'capPercent') return clamp(value, 0, POSITION_CAP_MAX_PERCENT);
  return Math.max(0, value);
}

/**
 * ADR%: the mean of (high ÷ low − 1) over the last ADR_SESSIONS bars, in percent. Only for bars
 * certified for the analysis date (pass null otherwise); fewer bars or a non-finite value gives null.
 */
export function adrPercent(judged, sessions = ADR_SESSIONS) {
  if (!Array.isArray(judged) || judged.length < sessions) return null;
  const window = judged.slice(-sessions);
  if (!window.every(bar => finite(bar?.high) && finite(bar?.low) && bar.low > 0 && bar.high >= bar.low)) return null;
  return window.reduce((sum, bar) => sum + (bar.high / bar.low - 1), 0) / sessions * 100;
}

const unknownStructural = reason => ({ state: 'unknown', low: null, lowDate: null, stop: null, percent: null, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason });

/**
 * The structural stop: the last measured contraction's low (technical.vcp, only with valid
 * measurements) less STRUCTURAL_STOP_BUFFER_PERCENT, checked against the bars certified for the
 * analysis date (`judged`, or null). Never falls back to a fixed percentage: unknown says why.
 * @returns {StructuralStop}
 */
export function structuralStop({ technical, judged, entry }) {
  if (!Array.isArray(judged) || !judged.length) return unknownStructural('日足が分析日で未検証');
  const vcp = technical?.vcp;
  const leg = vcp?.measurementsValid === true && Array.isArray(vcp.legs) ? vcp.legs.at(-1) : null;
  if (!leg || !finite(leg.low) || leg.low <= 0 || typeof leg.lowDate !== 'string') return unknownStructural('収縮を測定できません');
  // The measurement must be of these bars: same last session and the low on the bar it names.
  if (typeof technical.as_of_date === 'string' && technical.as_of_date !== judged.at(-1)?.date) return unknownStructural('収縮の測定日が日足と不一致');
  const bar = judged.find(item => item?.date === leg.lowDate);
  if (!bar || !finite(bar.low) || Math.abs(bar.low - leg.low) > Math.abs(leg.low) * 1e-9) return unknownStructural('収縮の測定日が日足と不一致');
  const stop = leg.low * (1 - STRUCTURAL_STOP_BUFFER_PERCENT / 100);
  const percent = finite(entry) && entry > 0 ? (entry - stop) / entry * 100 : null;
  if (!finite(percent)) return unknownStructural('買値が未確認');
  const state = percent <= 0 ? 'above' : percent > STOP_LIMIT_PERCENT ? 'tooDeep' : percent < STOP_MIN_PERCENT ? 'tooShallow' : 'ok';
  return { state, low: leg.low, lowDate: leg.lowDate, stop, percent, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason: null };
}

/** The market's exposure guide (modelMarket: cap 0.5, 0.25 or 0) as a percentage, or null if unknown. */
function marketMax(market) {
  if (!market || market.state === 'unknown' || !finite(market.cap) || market.cap < 0) return null;
  return market.cap * 100;
}

/**
 * Position plan for the view's position, or { blocked } when no new plan is made (買いゾーン超過,
 * 低変動, 買収, 判定不可), or null without a usable entry. `context` holds the market verdict
 * (brief.market), the trend template, the technical evidence and `judged` (the bars certified for the
 * analysis date, or null: the only bars the structural stop and ADR are computed from).
 * @returns {PositionPlan|{blocked: string}|null}
 */
export function positionPlan(view, settings = {}, { market = null, template = null, technical = null, judged = null } = {}) {
  if (view && PLAN_BLOCKED[view.state]) return { blocked: PLAN_BLOCKED[view.state] };
  const input = { ...PLAN_DEFAULTS, ...settings };
  const { account, riskPercent } = input;
  const pct = clampPlanSetting('stopPercent', finite(input.stopPercent) ? input.stopPercent : STOP_DEFAULT_PERCENT);
  const capPercent = clampPlanSetting('capPercent', finite(input.capPercent) ? input.capPercent : POSITION_CAP_DEFAULT_PERCENT);
  // In the zone the entry is the price; waiting, it is the pivot. Any other state has no state key here.
  const basis = view?.state === 'zone' ? 'price' : view?.state === 'wait' ? 'pivot' : finite(view?.price) && finite(view?.pivot) && view.price >= view.pivot ? 'price' : 'pivot';
  const entry = finite(view?.pivot) && finite(view?.price) ? (basis === 'price' ? view.price : view.pivot) : null;
  if (!finite(entry) || entry <= 0) return null;
  const stop = entry * (1 - pct / 100), risk = entry - stop;
  const usableAccount = finite(account) && account > 0;
  const riskDollars = usableAccount && finite(riskPercent) && riskPercent > 0 ? account * riskPercent / 100 : null;
  let shares = null, binding = null;
  if (riskDollars !== null) {
    const limits = [['risk', riskDollars / risk], ['cap', account * capPercent / 100 / entry], ['account', account / entry]];
    // The tightest limit sets the count; a tie names the earlier one (the risk budget first).
    [binding, shares] = limits.reduce((best, limit) => (limit[1] < best[1] ? limit : best));
    shares = Math.floor(shares);
    if (!(shares > 0)) shares = null;
  }
  const cost = shares === null ? null : shares * entry;
  const weight = cost === null ? null : cost / account * 100;
  const maxPercent = marketMax(market);
  const structural = structuralStop({ technical, judged, entry });
  return {
    entry, basis, stop, stopPercent: pct, risk, r2: entry + 2 * risk, r3: entry + 3 * risk, riskDollars, shares, cost, weight,
    capPercent, binding, actualRisk: shares === null ? null : shares * risk,
    trialOnly: !(maxPercent > 0),
    marketGuide: { known: maxPercent !== null, maxPercent, usedPercent: maxPercent > 0 ? weight : null, over: maxPercent > 0 && weight !== null && weight > maxPercent + 1e-9 },
    reference: finite(template?.failed) && template.failed > 0,
    defaults: Object.entries(PLAN_DEFAULTS).every(([key, value]) => input[key] === value),
    structural, adrPercent: adrPercent(judged),
  };
}

/**
 * The price levels the chart may draw from a plan: { entry, stop, r2, r3, structuralLow }, each null
 * when unknown. A blocked plan (or none) has no level, so the chart draws no stop. structuralLow is the
 * last measured contraction's low whenever it was measured on certified bars.
 * @param {PositionPlan|{blocked: string}|null} plan
 */
export function planLevels(plan) {
  if (!plan || plan.blocked) return { entry: null, stop: null, r2: null, r3: null, structuralLow: null };
  return { entry: plan.entry ?? null, stop: plan.stop ?? null, r2: plan.r2 ?? null, r3: plan.r3 ?? null, structuralLow: finite(plan.structural?.low) ? plan.structural.low : null };
}
