// Position sizing for the stock screen's plan: the entry, the stop, the R levels and the shares a
// fixed account risk buys, bound by a single-stock cap of at most 100% (so never above the account: no
// margin). Pure; the stop is capped below STOP_MAX_PERCENT. A plan is made only in the buy zone (entry =
// the close) and below the pivot (entry = the pivot); every other position is blocked with its reason.
// Values derived from the chart (the structural stop, ADR) come from certified bars only; unknown stays
// unknown. The structural stop is chosen per stock: one stock's structure never sets another's stop.
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
/** The widest risk per trade the plan accepts (the input's maximum). */
export const RISK_MAX_PERCENT = 5;
/** The structural stop sits this far below the last contraction's low (独自設定). */
export const STRUCTURAL_STOP_BUFFER_PERCENT = 0.5;
/** ADR%: the mean daily range (high ÷ low − 1) over this many certified bars (独自計算). */
export const ADR_SESSIONS = 20;
/** How many stocks a viewer's structural-stop choice is kept for (the most recent ones). */
export const STRUCTURAL_SYMBOLS_MAX = 50;
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
 * @property {number} entry Planned entry: the close on the analysis date in the buy zone, the pivot below it.
 * @property {'price'|'pivot'} basis What the entry is (「終値 x で買う場合」 / 「ピボット x で買う場合」): the
 *   close is the analysis date's, never presented as a live price.
 * @property {number} stop The entry less stopPercent.
 * @property {number} stopPercent The stop width used (STOP_MIN_PERCENT to STOP_LIMIT_PERCENT).
 * @property {'setting'|'structural'} stopSource Where the width comes from: the viewer's stop setting, or
 *   this stock's own structural stop (chosen for this symbol, and only while it is usable).
 * @property {number} risk Entry − stop, per share.
 * @property {number} r2 Entry + 2R.
 * @property {number} r3 Entry + 3R.
 * @property {number|null} riskDollars Account × risk %, or null without a usable account and risk.
 * @property {number|null} shares Whole shares, never 0: floor(min(risk$ ÷ risk, account × cap ÷ entry)),
 *   or null when that is not a whole share or cannot be computed. The cap is at most 100%, so the count
 *   never buys more than account ÷ entry.
 * @property {number|null} cost Shares × entry, or null. Never above the account (no margin).
 * @property {number|null} weight The cost as a % of the account (≤ 100), or null.
 * @property {number} capPercent The single-stock cap used (0 to POSITION_CAP_MAX_PERCENT).
 * @property {'risk'|'cap'|null} binding The constraint that set the share count: the risk budget or the
 *   single-stock cap (null without a risk budget). The account never binds on its own (cap ≤ 100%).
 * @property {number|null} actualRisk Shares × risk: the loss at the stop, or null.
 * @property {boolean} trialOnly The market guide allows no new position (0%) or is unknown: 試算のみ.
 * @property {{known: boolean, maxPercent: number|null, usedPercent: number|null, over: boolean}} marketGuide
 *   The market's exposure guide (地合いの目安) and how much of it this position takes.
 * @property {boolean} reference The plan is shown for reference only (参考): the trend template is not passed,
 *   the buy setup is broken, or earnings are near.
 * @property {'TT未達'|'TT未確認'|'崩れ'|'決算前'|null} referenceReason Why, in the conclusion's order: TT未達 (a
 *   failed rule) or TT未確認 (no template, an unknown rule, or the daily-bar integrity rule not passed); 崩れ (a
 *   broken setup: the 50-day check or the book's combined warning fired, 独自判定); 決算前 (earnings within
 *   EARNINGS_WARN_DAYS); null when none applies.
 * @property {boolean} defaults Every input (account, risk, stop, cap) is still at its default and the stop
 *   is not this stock's structural stop (既定条件).
 * @property {StructuralStop} structural The stop from the base's last measured contraction, or why there is none.
 * @property {number|null} adrPercent ADR% over ADR_SESSIONS certified bars, or null (ADR 未確認).
 * @property {string|null} adrReason Why ADR is unknown (日足が分析日で未検証, 日足20本未満, …), else null.
 * @property {string} [blocked] Why no plan is made; a blocked plan carries no other field.
 */

/**
 * @typedef {object} StructuralStop
 * @property {'ok'|'tooDeep'|'overLimit'|'tooShallow'|'above'|'unknown'} state ok: usable; tooDeep: at or
 *   beyond STOP_MAX_PERCENT, against the rule of a loss under 10% (見送り候補); overLimit: under 10% but
 *   wider than the STOP_LIMIT_PERCENT the inputs allow; tooShallow: narrower than STOP_MIN_PERCENT; above:
 *   the low is at or above the entry (no stop below it); unknown: not measured (収縮の安値 未確認), with
 *   `reason`.
 * @property {number|null} low The base's last measured contraction's low (the last leg below the pivot).
 * @property {string|null} lowDate Its date.
 * @property {number|null} stop low × (1 − STRUCTURAL_STOP_BUFFER_PERCENT / 100); null when above.
 * @property {number|null} percent (entry − stop) ÷ entry × 100; null when above.
 * @property {number} buffer STRUCTURAL_STOP_BUFFER_PERCENT.
 * @property {string|null} reason Why it is unknown.
 */

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** One plan input clamped to its range (the stop below STOP_MAX_PERCENT, the risk at most 5%, the cap at most 100%). */
export function clampPlanSetting(key, value) {
  if (key === 'stopPercent') return clamp(value, STOP_MIN_PERCENT, STOP_LIMIT_PERCENT);
  if (key === 'riskPercent') return clamp(value, 0, RISK_MAX_PERCENT);
  if (key === 'capPercent') return clamp(value, 0, POSITION_CAP_MAX_PERCENT);
  return Math.max(0, value);
}

const symbolOk = symbol => typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 20;

/**
 * The stocks whose structural stop the viewer chose, as stored: strings only, once each, the most recent
 * STRUCTURAL_SYMBOLS_MAX. Anything else reads as none.
 */
export function cleanStructuralSymbols(value) {
  if (!Array.isArray(value)) return [];
  const seen = [];
  for (const symbol of value) if (symbolOk(symbol)) { const at = seen.indexOf(symbol); if (at >= 0) seen.splice(at, 1); seen.push(symbol); }
  return seen.slice(-STRUCTURAL_SYMBOLS_MAX);
}

/** The list with `symbol` chosen (moved to the most recent end) or no longer chosen. */
export function withStructuralSymbol(list, symbol, chosen) {
  const rest = cleanStructuralSymbols(list).filter(item => item !== symbol);
  return chosen && symbolOk(symbol) ? cleanStructuralSymbols([...rest, symbol]) : rest;
}

/**
 * The plan inputs from a stored object: each number finite and clamped to its range (else its default),
 * and the structural-stop choices cleaned. A stored value never reaches the plan unchecked.
 */
export function readPlanSettings(stored) {
  const value = stored && typeof stored === 'object' ? stored : {};
  return {
    ...Object.fromEntries(Object.entries(PLAN_DEFAULTS).map(([key, fallback]) => [key, finite(value[key]) ? clampPlanSetting(key, value[key]) : fallback])),
    structuralSymbols: cleanStructuralSymbols(value.structuralSymbols),
  };
}

/**
 * Why the trend template leaves the plan a reference only, as the conclusion's gate reads it: TT未達 when a
 * rule failed; TT未確認 without a template, with an unknown rule, or when the daily-bar integrity rule has
 * not passed; null when the template passes.
 * @returns {'TT未達'|'TT未確認'|null}
 */
export function templateReference(template) {
  if (!template) return 'TT未確認';
  if (finite(template.failed) && template.failed > 0) return 'TT未達';
  if (template.failed !== 0 || template.unknown !== 0 || template.integrity?.state !== 'pass') return 'TT未確認';
  return null;
}

/**
 * ADR%: the mean of (high ÷ low − 1) over the last ADR_SESSIONS bars, in percent, as { value, reason }.
 * Only for bars certified for the analysis date (pass null otherwise); unknown says why: the bars are not
 * certified, there are fewer than ADR_SESSIONS of them, or one of them lacks a usable high or low.
 */
export function adrState(judged, sessions = ADR_SESSIONS) {
  if (!Array.isArray(judged)) return { value: null, reason: '日足が分析日で未検証' };
  if (judged.length < sessions) return { value: null, reason: `日足${sessions}本未満` };
  const window = judged.slice(-sessions);
  if (!window.every(bar => finite(bar?.high) && finite(bar?.low) && bar.low > 0 && bar.high >= bar.low)) return { value: null, reason: `直近${sessions}本の高値・安値に欠落` };
  return { value: window.reduce((sum, bar) => sum + (bar.high / bar.low - 1), 0) / sessions * 100, reason: null };
}

/** ADR% (adrState's value): a number, or null when unknown. */
export const adrPercent = (judged, sessions = ADR_SESSIONS) => adrState(judged, sessions).value;

const unknownStructural = reason => ({ state: 'unknown', low: null, lowDate: null, stop: null, percent: null, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason });

/**
 * The structural stop: the low of the base's last measured contraction (technical.vcp, only with valid
 * measurements: the last leg whose low is under the pivot, since a leg above it is a pullback after the
 * breakout) less STRUCTURAL_STOP_BUFFER_PERCENT, checked against the bars certified for the analysis date
 * (`judged`, or null). Never falls back to a fixed percentage: unknown says why.
 * @returns {StructuralStop}
 */
export function structuralStop({ technical, judged, entry, pivot }) {
  if (!Array.isArray(judged) || !judged.length) return unknownStructural('日足が分析日で未検証');
  const vcp = technical?.vcp;
  const legs = vcp?.measurementsValid === true && Array.isArray(vcp.legs) ? vcp.legs : [];
  if (!legs.length || !legs.every(item => finite(item?.low) && item.low > 0 && typeof item.lowDate === 'string')) return unknownStructural('収縮を測定できません');
  if (!finite(pivot) || pivot <= 0) return unknownStructural('ピボットが未確認');
  const leg = [...legs].reverse().find(item => item.low < pivot);
  if (!leg) return unknownStructural('最後の収縮がピボットより上（上抜け後の押し）');
  // The measurement must be of these bars: same last session and the low on the bar it names.
  if (typeof technical.as_of_date === 'string' && technical.as_of_date !== judged.at(-1)?.date) return unknownStructural('収縮の測定日が日足と不一致');
  const bar = judged.find(item => item?.date === leg.lowDate);
  if (!bar || !finite(bar.low) || Math.abs(bar.low - leg.low) > Math.abs(leg.low) * 1e-9) return unknownStructural('収縮の測定日が日足と不一致');
  if (!finite(entry) || entry <= 0) return unknownStructural('買値が未確認');
  // Already at or under the contraction's low: there is no stop below it to place.
  if (leg.low >= entry) return { state: 'above', low: leg.low, lowDate: leg.lowDate, stop: null, percent: null, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason: null };
  const stop = leg.low * (1 - STRUCTURAL_STOP_BUFFER_PERCENT / 100);
  const percent = (entry - stop) / entry * 100;
  const state = percent >= STOP_MAX_PERCENT ? 'tooDeep' : percent > STOP_LIMIT_PERCENT ? 'overLimit' : percent < STOP_MIN_PERCENT ? 'tooShallow' : 'ok';
  return { state, low: leg.low, lowDate: leg.lowDate, stop, percent, buffer: STRUCTURAL_STOP_BUFFER_PERCENT, reason: null };
}

/** The market's exposure guide (modelMarket: cap 0.5, 0.25 or 0) as a percentage, or null if unknown. */
function marketMax(market) {
  if (!market || market.state === 'unknown' || !finite(market.cap) || market.cap < 0) return null;
  return market.cap * 100;
}

/**
 * Position plan for the view's position, or { blocked } when no new plan is made (買いゾーン超過,
 * 低変動, 買収, 判定不可), or null without a usable entry. `settings` holds the inputs and
 * `structuralSymbols`, the stocks whose own structural stop the viewer chose: for this stock (view.symbol)
 * that stop sets the width while it is usable; every other stock keeps the stop setting. `context` holds
 * the market verdict (brief.market), the trend template, the technical evidence, `judged` (the bars
 * certified for the analysis date, or null: the only bars the structural stop and ADR are computed from),
 * `broken` (a broken buy setup, from the sell checks) and `earningsSoon` (earnings within EARNINGS_WARN_DAYS):
 * either makes the plan a reference only, as the conclusion does.
 * @returns {PositionPlan|{blocked: string}|null}
 */
export function positionPlan(view, settings = {}, { market = null, template = null, technical = null, judged = null, broken = false, earningsSoon = false } = {}) {
  if (view && PLAN_BLOCKED[view.state]) return { blocked: PLAN_BLOCKED[view.state] };
  const input = { ...PLAN_DEFAULTS, ...settings };
  const { account } = input;
  const riskPercent = finite(input.riskPercent) ? clampPlanSetting('riskPercent', input.riskPercent) : null;
  const capPercent = clampPlanSetting('capPercent', finite(input.capPercent) ? input.capPercent : POSITION_CAP_DEFAULT_PERCENT);
  // In the zone the entry is the close; waiting, it is the pivot. Any other state has no state key here.
  const basis = view?.state === 'zone' ? 'price' : view?.state === 'wait' ? 'pivot' : finite(view?.price) && finite(view?.pivot) && view.price >= view.pivot ? 'price' : 'pivot';
  const entry = finite(view?.pivot) && finite(view?.price) ? (basis === 'price' ? view.price : view.pivot) : null;
  if (!finite(entry) || entry <= 0) return null;
  const structural = structuralStop({ technical, judged, entry, pivot: view.pivot });
  // This stock's own structural stop, only when the viewer chose it for this symbol and it is usable.
  const stopSource = structural.state === 'ok' && cleanStructuralSymbols(input.structuralSymbols).includes(view.symbol) ? 'structural' : 'setting';
  const pct = stopSource === 'structural' ? structural.percent : clampPlanSetting('stopPercent', finite(input.stopPercent) ? input.stopPercent : STOP_DEFAULT_PERCENT);
  const stop = entry * (1 - pct / 100), risk = entry - stop;
  const usableAccount = finite(account) && account > 0;
  const riskDollars = usableAccount && riskPercent > 0 ? account * riskPercent / 100 : null;
  let shares = null, binding = null;
  if (riskDollars !== null) {
    // The tightest limit sets the count; a tie names the risk budget. The cap is at most 100%, so the
    // cap's limit never exceeds account ÷ entry: the account bounds the count through it (no margin).
    const limits = [['risk', riskDollars / risk], ['cap', account * capPercent / 100 / entry]];
    [binding, shares] = limits.reduce((best, limit) => (limit[1] < best[1] ? limit : best));
    shares = Math.floor(shares);
    if (!(shares > 0)) shares = null;
  }
  const cost = shares === null ? null : shares * entry;
  const weight = cost === null ? null : cost / account * 100;
  const maxPercent = marketMax(market);
  const referenceReason = templateReference(template) ?? (broken === true ? '崩れ' : earningsSoon === true ? '決算前' : null);
  const adr = adrState(judged);
  return {
    entry, basis, stop, stopPercent: pct, stopSource, risk, r2: entry + 2 * risk, r3: entry + 3 * risk, riskDollars, shares, cost, weight,
    capPercent, binding, actualRisk: shares === null ? null : shares * risk,
    trialOnly: !(maxPercent > 0),
    marketGuide: { known: maxPercent !== null, maxPercent, usedPercent: maxPercent > 0 ? weight : null, over: maxPercent > 0 && weight !== null && weight > maxPercent + 1e-9 },
    reference: referenceReason !== null, referenceReason,
    defaults: stopSource === 'setting' && Object.entries(PLAN_DEFAULTS).every(([key, value]) => input[key] === value),
    structural, adrPercent: adr.value, adrReason: adr.reason,
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
