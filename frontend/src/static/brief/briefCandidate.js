// Candidate view model for the daily-brief screens: the trend template, a candidate's position, the
// brief's order, Today's focus pool and the list filters. Every value comes from the published research
// rows and the existing rule functions; unknown stays unknown.
import { assess, entryPlan, finite, highDistance } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { signed, stateKey, STATES } from '../positionGeometry';
import { auditValues, verifiedVolumeRatio } from '../qualificationAudit';
import { conditionChipLabel, conditionText, conditionValueText, singleMissingCondition } from '../missingCondition';
import { newYorkDate } from '../evidenceTime';
import { EARNINGS_CHIP_PERCENT, meetsEarningsChipPercent, secRowChip, secSummaryCurrent, wholePercent } from '../fundamentalsExplain.js';
import { publishedRsLineHigh } from './briefChartModel';
import { isoDay, shortDate } from './briefShared';

export const BREAKOUT_VOLUME_RATIO = 1.4;
/** Calendar days before an earnings date at which every screen warns (the chips and the conclusion line). */
export const EARNINGS_WARN_DAYS = 10;
const ZONE_RANK = { zone: 0, wait: 1, ext: 3, low: 4, acq: 5, na: 6 };
const DAY = 86400000;
const positive = value => finite(value) && value > 0;

/**
 * A questionable base, flagged on the rows (独自判定, plan §9-18): the Setup Engine base deeper than this %, or
 * shorter than this many weeks, or the verified close more than this % above the 50-day line.
 */
export const BASE_DEPTH_MAX_PERCENT = 35;
export const BASE_LENGTH_MIN_WEEKS = 3;
export const EXTENDED_FROM_SMA50_PERCENT = 25;
/** The base chip's rule as the notes state it (the 候補 tab, and Today when a focus row carries the chip). */
export const BASE_CAUTION_NOTE = `土台の注意：Setup Engineの土台が深さ${BASE_DEPTH_MAX_PERCENT}%超または${BASE_LENGTH_MIN_WEEKS}週未満、または終値が50日線より${EXTENDED_FROM_SMA50_PERCENT}%超上（独自判定）。`;
/**
 * The 候補 tab's EPS filter: the latest quarter's EPS change from the year-ago quarter, from the SEC summary (独自設定).
 * The earnings chip's own bar (data's EARNINGS_CHIP_PERCENT), so the filter and the green chip use one number.
 */
export const EPS_YOY_FILTER_PERCENT = EARNINGS_CHIP_PERCENT;
/**
 * The Setup Engine's confidence floor and the check it fails below it (the backend aggregator's
 * primary_pattern_below_confidence_floor, 55.0): one constant for the pivot source here and the conclusion's
 * base check (buyGate imports it from this module, which it already imports, so there is no cycle).
 */
export const SE_CONFIDENCE_FLOOR = 55;
export const SE_BELOW_FLOOR_CHECK = 'primary_pattern_below_confidence_floor';

/**
 * The one table of position names every screen uses (rows, the conclusion, the meter, the filters).
 * `wait` is split for display only: near is 5% or less below the pivot, base is further below.
 */
export const POSITION_NAMES = { zone: '買いゾーン', near: 'ピボット接近', base: '土台形成中', ext: '買いゾーン超過' };

/** Trend-template rows (8 price/RS conditions) and the integrity rule, from the shared rule function. */
export function trendTemplate(row, now = Date.now()) {
  const result = assess(row, 'minervini', now);
  // The RS rule says what its number is: the app's own estimate, its universe and date, never IBD's.
  const rules = result.rules.slice(0, 8).map(rule => /^RS 推計/.test(rule.label) ? { ...rule, evidence: rsEvidence(rule.value, row) } : rule);
  return {
    rules,
    integrity: result.rules[8],
    passed: rules.filter(rule => rule.state === 'pass').length,
    failed: rules.filter(rule => rule.state === 'fail').length,
    unknown: rules.filter(rule => rule.state !== 'pass' && rule.state !== 'fail').length,
    qualified: result.qualified,
  };
}

/** A displayed RS estimate: the whole number below it (69.9 reads 69, never 70); thresholds use the raw value. */
export const rsShown = value => finite(value) ? String(Math.floor(value)) : '未確認';

function rsEvidence(value, row) {
  const universe = Number.isInteger(row?.rs_universe_size) && row.rs_universe_size >= 0 ? `${row.rs_universe_size}銘柄中` : '母集団 未確認';
  const day = typeof row?.rs_as_of_date === 'string' && row.rs_as_of_date ? row.rs_as_of_date : '基準日 未確認';
  return `RS推計 ${rsShown(value)}（${universe}・${day}・独自推計・IBDの公式値ではない）`;
}

/** The value behind a trend-template rule when the rule carries no evidence text of its own. */
export function ruleEvidence(rule) {
  if (rule?.evidence) return rule.evidence;
  if (!finite(rule?.value) || rule.unit !== '%') return '';
  // The number as the rule's own chip and title show it (rounded away from the threshold's passing side).
  const shown = conditionValueText(rule), size = shown.replace(/^−/, ''), below = shown.startsWith('−');
  if (rule.label.startsWith('52週安値')) return `52週安値から ${below ? '−' : '+'}${size}`;
  if (rule.label.startsWith('52週高値')) return rule.value === 0 ? '52週高値と同値' : `52週高値から ${below ? '+' : '−'}${size}`;
  return shown;
}

/** The earnings date and the calendar days to it from the analysis date, or null (unknown, or before that date). */
export function earningsDays(row, date) {
  const value = row?.entry_evidence?.earnings?.date;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || typeof date !== 'string') return null;
  const days = Math.round((Date.parse(value) - Date.parse(date)) / DAY);
  return Number.isFinite(days) && days >= 0 ? { date: value, days } : null;
}

/**
 * The earnings date as a trader acting now reads it: the calendar days from the later of the analysis
 * date and today's New York date (`now`), so a stale analysis never counts from its own day. Null for an
 * unknown date. `days` below 0 means the date has passed since the analysis: the analysis predates the
 * report. `soon` (EARNINGS_WARN_DAYS or nearer, or passed) gates the green call. `chip` is the one short
 * form every chip uses (「決算まで3日」, 「決算当日」, 「決算日経過」); `line` the conclusion's line.
 * Without a usable `now` the days count from the analysis date, as before.
 */
export function earningsCall(view, now) {
  const earnings = view?.earnings;
  if (!earnings || !finite(earnings.days)) return null;
  const today = newYorkDate(now);
  const lag = isoDay(view.asOf) && today && today > view.asOf ? Math.round((Date.parse(today) - Date.parse(view.asOf)) / DAY) : 0;
  const days = earnings.days - (finite(lag) ? lag : 0), day = shortDate(earnings.date, view.asOf);
  const chip = days > 0 ? `決算まで${days}日` : days === 0 ? '決算当日' : '決算日経過';
  const line = days > 0 ? `決算まで${days}日（${day}）：新規買いは見送り候補（独自判定）`
    : days === 0 ? `決算当日（${day}）：新規買いは見送り候補（独自判定）`
      : `決算（${day}）後のデータ待ち：新規買いは保留（独自判定）`;
  return { date: earnings.date, days, soon: days <= EARNINGS_WARN_DAYS, chip, line };
}

/** True when the earnings date is EARNINGS_WARN_DAYS calendar days away or nearer, or has passed since the analysis (an unknown date is not). */
export const earningsSoon = (view, now) => Boolean(earningsCall(view, now)?.soon);

/**
 * The analysis day as the publisher verified it (technical_audit for this date only): the close, the
 * change from the previous close, that previous close and the distance from the 50-day line. Anything
 * not verified for this date is null; price_change_1d and the raw bars are never read.
 */
function verifiedDay(row, date) {
  const none = { close: null, change: null, prevClose: null, fromSma50: null };
  if (typeof date !== 'string' || row?.technical_audit?.as_of_date !== date) return none;
  const v = auditValues(row);
  if (!positive(v.close)) return none;
  const change = finite(v.change) && v.change > -100 ? v.change : null;
  return { close: v.close, change, prevClose: change === null ? null : v.close / (1 + change / 100), fromSma50: positive(v.sma50) ? (v.close / v.sma50 - 1) * 100 : null };
}

const signedWhole = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.round(Math.abs(value))}%`;

/** A pivot more than 25% from the price (canonicalPivot drops it): where it was, never a 「ベース崩れ」. */
function stalePivot(row, reason) {
  if (!reason.includes('25%超')) return null;
  const raw = row?.se_pivot_price ?? row?.vcp_pivot, price = row?.current_price;
  if (!positive(raw) || !positive(price)) return null;
  const distance = (price / raw - 1) * 100, above = distance > 0;
  const short = `旧ピボットから ${signedWhole(distance)}・有効な買い水準なし`;
  return { distance, above, short, text: `${short}（${above ? '新しいベース待ち' : 'ベース再形成待ち'}）` };
}

/** The Setup Engine's base as of the analysis date: its recalculation is current for that date (else null). */
function currentSetup(row, date) {
  const calculation = row?.setup_recalculation;
  return calculation?.status === 'calculated' && isoDay(date) && calculation.as_of_date === date ? calculation : null;
}

/** The Setup Engine detectors' pattern ids (backend analysis/patterns) as the brief names them; an unknown id is shown as it is. */
const SE_PATTERN_NAMES = { vcp: 'VCP', cup_with_handle: 'カップ・ウィズ・ハンドル', double_bottom: 'ダブルボトム', three_weeks_tight: '3週タイト',
  high_tight_flag: 'ハイ・タイト・フラッグ', first_pullback: '初回の押し', nr7_inside_day: 'NR7・インサイドデイ' };
/** The name of a Setup Engine pattern id (se_pattern_primary), the id itself when the table has none, or null. */
export const setupPatternName = id => typeof id === 'string' && id.trim() ? SE_PATTERN_NAMES[id.trim()] || id.trim() : null;

/**
 * Where the pivot comes from (RW14): a Setup Engine (SE) pivot names its pattern and confidence (「カップ・ウィズ・
 * ハンドル（SE信頼度72）」, 「VCP（SE信頼度31・基準55未満）」, without a pattern 「SE信頼度60」: as short as step 0's
 * 「Setup Engine（日次）」, so the VCP card keeps its lines on a phone). The pattern and the confidence are read only
 * while the recalculation is current for the analysis date (a stale pattern is never named as today's), and the
 * confidence reads 未確認 otherwise, never 0. Any other source keeps canonicalPivot's reason.
 */
function pivotSourceLabel(row, reason, date) {
  if (reason !== 'Setup Engine（日次）') return reason;
  const current = currentSetup(row, date), confidence = current ? row.se_pattern_confidence : null;
  const below = (finite(confidence) && confidence < SE_CONFIDENCE_FLOOR) || Boolean(current && String(current.reason || '').includes(SE_BELOW_FLOOR_CHECK));
  const shown = `SE信頼度${finite(confidence) ? Math.floor(confidence) : ' 未確認'}${below ? `・基準${SE_CONFIDENCE_FLOOR}未満` : ''}`;
  const pattern = current ? setupPatternName(row?.se_pattern_primary) : null;
  return pattern ? `${pattern}（${shown}）` : shown;
}

// A measure shown against a threshold it crossed (`over` it, or under it): whole when that keeps its side of the
// threshold, else to one decimal (35.4% over a 35% bar reads 35.4, never 35). One it did not cross reads whole.
const sideShown = (value, limit, over, crossed = true) => {
  const whole = Math.round(value);
  return !crossed || (over ? whole > limit : whole < limit) ? String(whole) : value.toFixed(1);
};

/**
 * A questionable base (RW7, 独自判定): the current Setup Engine base deeper than BASE_DEPTH_MAX_PERCENT or
 * shorter than BASE_LENGTH_MIN_WEEKS (「土台3週・−38%」), else the verified close more than
 * EXTENDED_FROM_SMA50_PERCENT above the 50-day line (「50日線から+28%」). One neutral chip, or null for a normal
 * row (and for values not dated for the analysis date). `short` names only the measure that crossed its bar
 * (「土台−38%」, 「土台2週」): a phone's Today puts it in the RS chip's place without a line more.
 */
function baseCaution(row, date, fromSma50) {
  const current = currentSetup(row, date);
  const weeks = current && finite(row.se_base_length_weeks) ? row.se_base_length_weeks : null;
  const depth = current && finite(row.se_base_depth_pct) ? Math.abs(row.se_base_depth_pct) : null;
  const deep = depth !== null && depth > BASE_DEPTH_MAX_PERCENT, short = weeks !== null && weeks < BASE_LENGTH_MIN_WEEKS;
  if (deep || short) {
    const length = weeks === null ? '週数 未確認' : `${sideShown(weeks, BASE_LENGTH_MIN_WEEKS, false, short)}週`;
    const size = depth === null ? '深さ 未確認' : `−${sideShown(depth, BASE_DEPTH_MAX_PERCENT, true, deep)}%`;
    return { kind: 'base', text: `土台${length}・${size}`, short: deep && short ? `土台${length}・${size}` : `土台${deep ? size : length}`,
      title: `Setup Engineの土台が${[deep ? `深さ${BASE_DEPTH_MAX_PERCENT}%超` : null, short ? `${BASE_LENGTH_MIN_WEEKS}週未満` : null].filter(Boolean).join('・')}（独自判定）` };
  }
  if (finite(fromSma50) && fromSma50 > EXTENDED_FROM_SMA50_PERCENT) {
    const text = `50日線から+${sideShown(fromSma50, EXTENDED_FROM_SMA50_PERCENT, true)}%`;
    return { kind: 'extended', text, short: text, title: `終値が50日線より${EXTENDED_FROM_SMA50_PERCENT}%超上（伸びすぎ・独自判定）` };
  }
  return null;
}

/**
 * Why the stock's Setup Engine base is not current for the analysis date `date`, or null when it is (VD4's one
 * predicate: the rows' tone and the conclusion's base check read it). `kind` is 'unchecked' (no recalculation
 * record, or one in another state), 'unavailable', 'otherDay' (with its `date`), 'noConfidence' (未確認, never 0),
 * 'belowFloor' (with its `confidence`) or 'primaryBelowFloor' (the reason names SE_BELOW_FLOOR_CHECK while the
 * published confidence clears the floor).
 */
export function baseShortfall(row, date) {
  const calculation = row?.setup_recalculation;
  if (!calculation || typeof calculation !== 'object') return { kind: 'unchecked' };
  if (calculation.status !== 'calculated') return { kind: calculation.status === 'unavailable' ? 'unavailable' : 'unchecked' };
  if (typeof date !== 'string' || calculation.as_of_date !== date) return { kind: 'otherDay', date: calculation.as_of_date };
  const confidence = row.se_pattern_confidence;
  if (!finite(confidence)) return { kind: 'noConfidence' };
  if (confidence < SE_CONFIDENCE_FLOOR) return { kind: 'belowFloor', confidence };
  if (typeof calculation.reason === 'string' && calculation.reason.includes(SE_BELOW_FLOOR_CHECK)) return { kind: 'primaryBelowFloor' };
  return null;
}
/** Whether the Setup Engine base is current for `date` and over the confidence floor (baseShortfall finds nothing). */
export const baseCurrent = (row, date) => baseShortfall(row, date) === null;
/**
 * baseShortfall's reason in the conclusion's words (buyGate's baseCheck note, and the title of the rows' 土台未確認 chip),
 * or null for a current base. `asOf` is the analysis date another day's recalculation is dated against.
 */
export function baseShortfallNote(short, asOf) {
  if (!short) return null;
  switch (short.kind) {
    case 'unavailable': return '土台の再計算不可';
    case 'otherDay': return `土台の再計算が分析日のものではありません（${shortDate(short.date, asOf)}）`;
    case 'noConfidence': return '土台の信頼度 未確認';
    case 'belowFloor': return `土台の信頼度 ${Math.floor(short.confidence)}（基準${SE_CONFIDENCE_FLOOR}）`;
    // The published confidence may clear the floor while the engine names its primary pattern below it: say that, not the number.
    case 'primaryBelowFloor': return `主パターンが信頼度の基準${SE_CONFIDENCE_FLOOR}未満（Setup Engine）`;
    default: return '土台の再計算 未確認';
  }
}
/** The rows' word for a base that is not current, in the RS chip's place on a grey row (the conclusion's 土台を確認できない). */
export const BASE_UNCHECKED_CHIP = '土台未確認';
/** The notes' line for those grey rows (Today and the lists, while a row shows the word). */
export const BASE_UNCHECKED_NOTE = `${BASE_UNCHECKED_CHIP}：Setup Engineの土台が分析日のものでないか、信頼度が${SE_CONFIDENCE_FLOOR}未満または未確認のため、ピボットは参考（灰色の行・独自判定）。`;
/**
 * A buy-zone or near-pivot row whose Setup Engine base is not current (view.baseCurrent false): where the conclusion's
 * base check decides the call (土台を確認できない — ピボットは参考), the row keeps no green and Today's counts set it apart.
 * Other positions are judged by their position, as the conclusion does, so the base does not grey them.
 */
export const baseMuted = view => view?.baseCurrent === false && (view.position === 'zone' || view.position === 'near');

/**
 * The latest EPS change from the year-ago quarter (%) in the row's SEC summary, or null (未確認 or 未収録): only a summary
 * data's secSummaryCurrent reads as current for the analysis date at `now` (the bundle's evaluation clock), the rule the
 * row's SEC chip applies with the same clock (rowSecChip), so an EPS quarter past the 180-day rule (each point is judged
 * on its own quarter) is never counted or sorted as current. The bundle is evaluated again when a point passes the rule
 * (financialNextExpiry reads the summaries' quarter ends).
 */
function secEpsYoy(row, date, now) {
  const summary = secSummaryCurrent(row, { now, date });
  return summary && finite(summary.eps_yoy?.value) ? summary.eps_yoy.value : null;
}

/**
 * The row's SEC chip as the rows show it (data's secRowChip, dated by the analysis date and the clock the view's EPS filter
 * and sort read, `view.secNow`, so a row that shows a chip is the row the filter counts): a notable one only, else null.
 * `now` overrides that clock (a test); a view built without one reads the summary as the export judged it.
 */
export function rowSecChip(view, now = view?.secNow ?? null) {
  const sec = view?.row ? secRowChip(view.row, { now, date: view.asOf }) : null;
  return sec?.notable ? sec : null;
}

/**
 * One candidate as the brief shows it. `now` (optional) is the clock its SEC summary is dated with: the bundle's
 * evaluation clock when the view comes from memoCandidateView; without it the summary is read as the export judged it.
 */
export function candidateView(item, date, { now = null } = {}) {
  const row = item?.row || item;
  const plan = entryPlan(row, null, 'minervini');
  const key = stateKey(plan.state);
  const volume = verifiedVolumeRatio(row, date);
  const distance = finite(plan.distance) ? plan.distance : null;
  const reason = canonicalPivot(row).reason;
  const stale = key === 'na' ? stalePivot(row, reason) : null;
  const position = key === 'wait' ? (distance >= -5 ? 'near' : 'base') : stale ? (stale.above ? 'staleAbove' : 'staleBelow') : key;
  const assessment = item?.assessment;
  const failed = assessment?.failed ?? null, unknown = assessment?.unknown ?? null;
  const day = verifiedDay(row, date);
  const current = currentSetup(row, date), shortfall = baseShortfall(row, date);
  const view = {
    symbol: row.symbol,
    // The analysis date every value here is as of (an event is that day's, never 「本日」's).
    asOf: typeof date === 'string' ? date : null,
    name: row.company_name || row.name || '',
    sector: row.gics_sector || row.sector || '',
    price: finite(plan.price) ? plan.price : null,
    pivot: finite(plan.pivot) ? plan.pivot : null,
    upper: finite(plan.upper) ? plan.upper : null,
    distance,
    state: key,
    position,
    stateLabel: POSITION_NAMES[position] || stale?.short || STATES[key]?.[0] || plan.state || '判定不可',
    stateGlyph: stale ? (stale.above ? '▲' : '○') : STATES[key]?.[1] || '?',
    stale,
    volumeRatio: finite(volume) ? volume : null,
    ...day,
    rs: finite(row.rs_rating) ? row.rs_rating : null,
    fromHigh: finite(highDistance(row)) ? highDistance(row) : null,
    // The published RS-line high for this date only (the stock view reads the same function); unknown is not true.
    rsLineHigh: publishedRsLineHigh(row, date)?.value === true,
    qualified: Boolean(assessment?.qualified),
    passed: assessment?.passed ?? null,
    failed,
    unknown,
    // The one unmet rule of an あと1条件 row, from the same rule function: read on first use (below), so only the
    // rows that show it pay for the rule evaluation.
    missing: null,
    exclusion: assessment?.financial_exclusion?.label || assessment?.applicability_label || null,
    earnings: earningsDays(row, date),
    pivotSource: pivotSourceLabel(row, reason, date),
    // The Setup Engine pattern confidence, only while its recalculation is current for the analysis date.
    setupConfidence: current && finite(row.se_pattern_confidence) ? row.se_pattern_confidence : null,
    baseCaution: baseCaution(row, date, day.fromSma50),
    // The Setup Engine base is current and over the floor (baseCurrent): when it is not, a zone or near row keeps no green
    // and says 土台未確認 (baseMuted; the conclusion reads 土台を確認できない for the same stock), with `baseNote` the
    // conclusion's reason; membership and order do not change.
    baseCurrent: shortfall === null,
    baseNote: baseShortfallNote(shortfall, date),
    epsYoy: secEpsYoy(row, date, now),
    // The clock that dates the SEC summary for the filter, the sort and the row's chip (rowSecChip).
    secNow: finite(now) ? now : null,
    row,
  };
  // The analysis day as an event (breakoutEvent) and its rows' short form (rowEvent), once per view: the rows'
  // chip and label, the order and the filters read them.
  view.event = breakoutEvent(view);
  view.rowEvent = shortEvent(view, view.event);
  if (!assessment?.qualified && failed === 1 && unknown === 0) {
    Object.defineProperty(view, 'missing', { enumerable: true, configurable: true,
      get() { const value = oneMissing(row); Object.defineProperty(view, 'missing', { value, enumerable: true, writable: true, configurable: true }); return value; } });
  }
  return view;
}

/**
 * candidateView once per research item of one bundle: Today, the lists, the bar and the stock pane share
 * the same view object for an item. A new bundle (`bundle.data`) or date starts a new memo.
 */
const viewMemo = new WeakMap();
export function memoCandidateView(item, date, bundle) {
  if (!item || typeof item !== 'object' || !bundle || typeof bundle !== 'object') return candidateView(item, date);
  let memo = viewMemo.get(bundle);
  if (!memo || memo.date !== date) { memo = { date, views: new WeakMap() }; viewMemo.set(bundle, memo); }
  let view = memo.views.get(item);
  // The bundle's evaluation clock dates the SEC summary (a new evaluation is a new bundle, so a new memo).
  if (!view) { view = candidateView(item, date, { now: finite(bundle.evaluated_at) ? bundle.evaluated_at : null }); memo.views.set(item, view); }
  return view;
}

/**
 * The one unmet rule of an あと1条件 row: `chip` the row's one chip for it (「あと1条件：RS推計（61）」,
 * 「あと1条件：高値から25%以内」, 「あと1条件：150日 > 200日」: only the RS rule keeps its value there, so the
 * chip fits a 320px row's second line), `text` the full rule with its value (「未達：52週高値からの距離 ≤ 25%
 * （30.2%）」: the chip's title and the row's label), `rs` whether it is the RS estimate's rule (the chip then
 * carries the RS value and the row drops its RS chip).
 */
function oneMissing(row) {
  const missing = singleMissingCondition(assess(row, 'minervini'));
  if (missing?.state !== 'fail') return null;
  const rs = /^RS 推計/.test(missing.label), value = rs ? conditionValueText(missing) : null;
  return { chip: `あと1条件：${conditionChipLabel(missing)}${value === null ? '' : `（${value}）`}`, text: `未達：${conditionText(missing)}`, rs };
}

const cents = value => Math.round(value * 100);
/** A volume ratio as an event title shows it: floored to 2 decimals, so 1.396 never reads 1.40× under a 1.4× bar. */
export const ratioShown = value => `${(Math.floor(value * 100 + 1e-9) / 100).toFixed(2)}×`;

/**
 * The line under a touch that holds, once certified bars show the run at the pivot's cents began from below (crossingEvent's
 * 'afterTouch'): no close above the pivot since, and the green is the arrival's day only (独自判定).
 */
export const TOUCH_HELD_NOTE = '終値でピボットを上回っていないため、上抜けの裏付けはありません（緑はピボット到達の当日のみ・独自判定）。';
/** A stock already above the pivot's cents the day before, undated (breakoutEvent's `'after'`; crossingEvent dates it). */
export const AFTER_EVENT = Object.freeze({ kind: 'after', tone: 'zone', title: '買いゾーン内（上抜け後）' });
/**
 * In the buy zone without a breakout day the screen can date (tone 'wait', never green): the rows' event for a close
 * above the pivot's cents after a close at them, and the conclusion's when its certified bars cannot date the breakout.
 */
export const UNDATED_EVENT = Object.freeze({ kind: 'undated', tone: 'wait', title: '買いゾーン内（上抜け日 未確認）', note: '上抜けの日を検証済みの日足で確認できないため、買いの裏付けはありません。' });

/**
 * The analysis day as an event, from the verified close, its change and the verified volume ratio only, in whole
 * cents as the touch rule and the bars' crossing compare them (the previous close is rebuilt from the close and the
 * change, so a raw comparison with the pivot would hang on float noise): a breakout is a previous close under the
 * pivot's cents and a close above them on an up day with BREAKOUT_VOLUME_RATIO or more. Only for a stock in the buy
 * zone; null when any input (the analysis date too) is missing: nothing is said about a breakout. The titles name the
 * analysis date (「10/2に上抜け」, 「10/2にピボット到達」, 「10/2 下落日の大商い」), never 「本日」: the data may be older than today.
 * - A crossing without the volume (or with it unknown) is not a breakout: tone 'wait', never the green call.
 * - A close at the pivot's cents after a close under it is a touch (green, the day it arrives).
 * - A previous close at the pivot's cents is a touch only when the closes before it were under the pivot, and the rows
 *   have no bars to tell it from a pullback onto the pivot after an earlier breakout. So a close above the pivot's
 *   cents after one at them is `'undated'` (UNDATED_EVENT: 「上抜け日 未確認」 on the rows, tone 'wait', counted as
 *   未確認 by the 上抜け filter), and a second close at them is `'touchHeld'` (「ピボットと同値のまま」, tone 'wait'). The
 *   conclusion tells them apart from certified bars (crossingEvent): a run at the cents that began from below gives
 *   the day's breakout (`touched`, below) or 「ピボット到達からN営業日」; an earlier close above dates the breakout from it.
 * - A stock already above the pivot's cents the day before is `'after'`, undated (AFTER_EVENT: 「買いゾーン内（上抜け後）」):
 *   the conclusion dates it from certified bars through crossingEvent (breakoutHistory.js).
 * `touched` (crossingEvent's only): certified bars show the run at the pivot's cents began from below, so a close above
 * the cents after one at them is the day's breakout (or a crossing without the volume), as after a close under them.
 */
export function breakoutEvent(view, { touched = false } = {}) {
  if (view?.state !== 'zone' || !isoDay(view.asOf) || !positive(view.pivot) || !positive(view.close) || !positive(view.prevClose) || !finite(view.change)) return null;
  const pivot = cents(view.pivot), close = cents(view.close), before = cents(view.prevClose), change = view.change;
  const volume = finite(view.volumeRatio) ? view.volumeRatio : null, heavy = volume !== null && volume >= BREAKOUT_VOLUME_RATIO, day = shortDate(view.asOf);
  if (change < 0 && heavy) return { kind: 'heavyDown', tone: 'ext', title: `${day} 下落日の大商い ${ratioShown(volume)}（要注意）` };
  if (before < pivot && close === pivot) return { kind: 'touch', tone: 'zone', title: `${day}にピボット到達` };
  if (before === pivot && close === pivot) return { kind: 'touchHeld', tone: 'wait', title: 'ピボットと同値のまま', note: 'ピボットに届いた日を検証済みの日足で確認できないため、買いの裏付けはありません。' };
  if ((before < pivot || (touched === true && before === pivot)) && close > pivot) {
    if (change > 0 && heavy) return { kind: 'breakout', tone: 'zone', title: `${day}に上抜け・出来高${ratioShown(volume)}` };
    // The ratio and the bar go in the call's line under the title (`note`), so the title stays one line on a phone.
    return { kind: 'cross', tone: 'wait', title: volume === null ? `${day}に上抜け・出来高 未確認` : `${day}に上抜け・出来高不足`,
      note: volume === null ? '出来高を確認できないため、上抜けの裏付けはありません。' : `出来高${ratioShown(volume)}は基準の${BREAKOUT_VOLUME_RATIO}×に届きません。` };
  }
  if (before === pivot && close > pivot) return { ...UNDATED_EVENT };
  if (before > pivot) return { ...AFTER_EVENT };
  return null;
}
/** The view's day event: the one candidateView computed, or breakoutEvent's for a view built elsewhere. */
const dayEvent = view => (view?.event === undefined ? breakoutEvent(view) : view.event);

/**
 * The day's event in the one short form every row surface uses (RW1): Today's focus rows, the 候補 and
 * ウォッチ lists and Today's watch card. `{ kind, glyph, text, tone }` (a breakout's and a heavy down day's text carry the
 * volume ratio), or null when the row shows its plain
 * position (no event, or 'after': 「● 買いゾーン +x%」 as before). A crossing without the volume is never
 * green (tone 'wait'), and a heavy down day is a warning (tone 'ext').
 */
export const rowEvent = view => (view?.rowEvent === undefined ? shortEvent(view, dayEvent(view)) : view.rowEvent);
function shortEvent(view, event) {
  if (!event) return null;
  const day = shortDate(view.asOf);
  if (event.kind === 'breakout') return { kind: 'breakout', glyph: '↗', text: `${day}上抜け ${ratioShown(view.volumeRatio)}`, tone: 'zone' };
  if (event.kind === 'touch') return { kind: 'touch', glyph: '●', text: `${day}ピボット到達`, tone: 'zone' };
  // At the pivot's cents since the day before (a touch held, or a pullback onto the pivot: the rows cannot tell), never green.
  if (event.kind === 'touchHeld') return { kind: 'touchHeld', glyph: '●', text: 'ピボットと同値のまま', tone: 'wait' };
  // Above the pivot's cents after a close at them: the day's breakout or a rise after an earlier one, never green or dated here.
  if (event.kind === 'undated') return { kind: 'undated', glyph: '●', text: '上抜け日 未確認', tone: 'wait' };
  if (event.kind === 'cross') return { kind: 'cross', glyph: '●', text: finite(view.volumeRatio) ? '上抜け・出来高不足' : '上抜け・出来高 未確認', tone: 'wait' };
  // A heavy down day's chip carries its volume ratio, as a breakout's does (the row then shows no second volume chip).
  if (event.kind === 'heavyDown') return { kind: 'heavyDown', glyph: '▲', text: `下落日の大商い ${ratioShown(view.volumeRatio)}`, tone: 'ext' };
  return null;
}

/** A close under the pivot by less than 0.05%: one decimal would print a gap of 0.0% that does not exist. */
export const underTenth = value => finite(value) && value < 0 && Math.abs(value).toFixed(1) === '0.0';
/** A close over the pivot by less than 0.05%, the same on the other side (「+0.1%未満」, never 「+0.0%」). */
export const overTenth = value => finite(value) && value > 0 && value.toFixed(1) === '0.0';
/**
 * A distance from the pivot as every screen prints it: signed, 「−0.1%未満」 just under the pivot and 「+0.1%未満」 just over
 * it (never a 0.0% that does not exist), 「±0.0%」 for an exact zero.
 */
export const distanceText = value => (underTenth(value) ? '−0.1%未満' : overTenth(value) ? '+0.1%未満' : signed(value));
/**
 * The price at the pivot's cents (the touch rule's own test): its distance is none to the cent, whichever side of the
 * cent the float noise in a published pivot falls. The position itself (zone or near) stays the shared rule's.
 */
export const atPivotCents = view => positive(view?.price) && positive(view?.pivot) && cents(view.price) === cents(view.pivot);
/** A view's distance from the pivot as every screen prints it: 「±0.0%」 at the pivot's cents, else distanceText. */
export const pivotDistanceText = view => (atPivotCents(view) ? '±0.0%' : distanceText(view?.distance));
/** The position as a row chip says it, without its glyph: 「買いゾーン +1.2%」, 「ピボット接近・ピボット比 未確認」. */
export const positionText = view => `${view.stateLabel}${view.stale ? '' : finite(view.distance) ? ` ${pivotDistanceText(view)}` : '・ピボット比 未確認'}`;

// Within the buy zone (RW2): the day's breakout first, then a touch (still at the pivot included), a crossing without
// the volume or a close above the pivot after one at its cents (its breakout day not told on the rows), then a stock
// already above the pivot (or a day not verified), then a heavy down day last.
const EVENT_RANK = { breakout: 0, touch: 1, touchHeld: 1, cross: 1, undated: 1, after: 2, heavyDown: 3 };
const eventRank = view => EVENT_RANK[dayEvent(view)?.kind] ?? EVENT_RANK.after;

/**
 * Buy zone first, then within 5% below the pivot, then further below, then the rest; within a position by the
 * shared assessment score. Within the buy zone, the day's event (EVENT_RANK), then a dated RS-line new high,
 * then RS; elsewhere RS, as before.
 */
export function briefOrder(a, b) {
  const near = view => view.state === 'wait' && finite(view.distance) && view.distance >= -5 ? 1 : view.state === 'wait' ? 2 : ZONE_RANK[view.state] ?? 6;
  const position = near(a) - near(b) || (b.passed ?? -1) - (a.passed ?? -1);
  if (position) return position;
  const zone = a.state === 'zone' && b.state === 'zone' ? eventRank(a) - eventRank(b) || Number(b.rsLineHigh === true) - Number(a.rsLineHigh === true) : 0;
  return zone || (b.rs ?? -1) - (a.rs ?? -1) || a.symbol.localeCompare(b.symbol);
}

// One eligibility rule for Today's focus rows, their counts and the list's zone/near filters.
const inZone = view => view.state === 'zone';
const nearPivot = view => view.state === 'wait' && finite(view.distance) && view.distance >= -5;
const focusPool = (ranked, date, bundle) => (ranked || []).filter(item => item?.assessment?.qualified).map(item => memoCandidateView(item, date, bundle))
  .filter(view => inZone(view) || nearPivot(view));

/**
 * Today's focus list: qualified, liquid Minervini candidates in the buy zone or within 5% below the pivot.
 * With `bundle` (the research bundle's data) the views come from the shared memo (memoCandidateView).
 */
export function focusCandidates(ranked, date, limit = 5, bundle = null) {
  return focusPool(ranked, date, bundle).sort(briefOrder).slice(0, limit);
}

/**
 * The whole focus pool, not the top-`limit` slice Today shows: in the buy zone, near the pivot, and both;
 * `reference`: those whose Setup Engine base is not current (baseMuted: grey, their pivot a reference only); and
 * `breakout`: the analysis day's breakouts among them (LIST_FILTERS.breakout, which leaves a 参考 pivot's out).
 */
export function focusCounts(ranked, date, bundle = null) {
  const pool = focusPool(ranked, date, bundle), zone = pool.filter(inZone).length;
  return { zone, near: pool.length - zone, total: pool.length, reference: pool.filter(baseMuted).length, breakout: pool.filter(LIST_FILTERS.breakout.test).length };
}

/**
 * What the market verdict (prepared.market) means for a new buy: 'open' (a known state with a cap above
 * 0), 'hold' (a known state with a cap of 0: 控える), 'unknown' (an unknown state, never 控える), or null
 * for no verdict at all (not loaded yet: nothing is said, so nothing flashes while it loads).
 */
export function candidateMarketGate(market) {
  if (!market) return null;
  if (market.state === 'unknown' || !finite(market.cap)) return 'unknown';
  return market.cap > 0 ? 'open' : 'hold';
}

/**
 * The tone of Today's 注目候補 tile: zone only for a ready bundle with a focus candidate whose base is current (not
 * every one 参考, counts.reference) while the market verdict is open to new buying; neutral while it says to hold off
 * or is unknown.
 */
export function focusTone(state, counts, market) {
  return state === 'ready' && counts?.total > (counts?.reference ?? 0) && candidateMarketGate(market) === 'open' ? 'zone' : '';
}

/**
 * A note after Today's 注目候補 heading for the market verdict, or null (open, or not loaded yet). With the
 * bundle's `state`, a ready bundle that carries no verdict at all also reads 「（地合い未確認）」 (the verdict
 * comes with the bundle, so once it is ready nothing is still loading); without it, nothing is said.
 */
export function focusHeadingNote(market, state) {
  const gate = candidateMarketGate(market);
  if (gate === null && state === 'ready') return '（地合い未確認）';
  return gate === 'hold' ? '（地合い：買いは控える・監視のみ）' : gate === 'unknown' ? '（地合い未確認）' : null;
}

export const LIST_FILTERS = {
  zone: { label: '買いゾーン', test: view => view.qualified && inZone(view) },
  near: { label: 'ピボット接近', test: view => view.qualified && nearPivot(view) },
  all: { label: '選定すべて', test: view => view.qualified },
  one: { label: 'あと1条件', test: view => !view.qualified && view.failed === 1 && view.unknown === 0 },
  // Today's focus pool (the zone and near filters together). Hidden: never a segment button.
  focus: { label: '注目候補', hidden: true, test: view => view.qualified && (inZone(view) || nearPivot(view)) },
  // The analysis day's breakouts among the selected stocks (Today's 「うち上抜けN」 and the 条件 menu). Hidden. A
  // selected stock in the zone whose day is not verified (no event), whose close above the pivot follows one at its
  // cents (breakoutEvent's 'undated': the rows cannot tell the day's breakout from a rise after an earlier one), or
  // whose breakout is of a pivot that is only a reference (baseMuted: the conclusion reads 土台を確認できない), is counted
  // apart (`unknown`), never as a miss. `why` ends in a noun: the list says 「…のため判定していません」 after it.
  breakout: { label: '上抜け', hidden: true, test: view => view.qualified && dayEvent(view)?.kind === 'breakout' && !baseMuted(view),
    unknown: view => view.qualified && inZone(view) && (!dayEvent(view) || dayEvent(view).kind === 'undated' || (dayEvent(view).kind === 'breakout' && baseMuted(view))),
    why: '分析基準日の値動きが未検証か、上抜けの日が未確認か、Setup Engineの土台が未確認' },
  // The selected stocks whose latest SEC EPS change is EPS_YOY_FILTER_PERCENT or more; a stock whose SEC summary
  // is missing, not dated for the analysis date or without the value is counted apart (`unknown`), never as a miss.
  // `field`: the published row field it reads (absent from older publications: 未収録).
  eps: { label: `EPS前年比≥${EPS_YOY_FILTER_PERCENT}%（直近・SEC）`, short: `EPS前年比≥${EPS_YOY_FILTER_PERCENT}%`, hidden: true, field: 'sec_summary',
    // Compared as the chip prints it (meetsEarningsChipPercent: 24.6 reads +25%), so a row reading 「EPS +25%」 is in it.
    test: view => view.qualified && meetsEarningsChipPercent(view.epsYoy), unknown: view => view.qualified && !finite(view.epsYoy), why: 'SECのEPS前年比が未確認' },
};
/** A list filter's label as the screen shows it: the breakout filter names the analysis date (「10/2の上抜け」); `short` is the 条件 menu's. */
export const filterLabel = (key, date) => key === 'breakout' ? `${isoDay(date) ? `${shortDate(date)}の` : ''}上抜け` : LIST_FILTERS[key]?.label || '';
/**
 * Every list filter's count over the same views in one pass, plus `unknown` counts for the filters that have
 * them ({ zone: 5, …, eps: 3 } and { breakout: 0, eps: 18 }), and `unpublished`: for a filter that reads a
 * published field, true when no selected row carries it (an older publication: 未収録, never 該当0).
 */
export function filterCounts(views) {
  const keys = Object.keys(LIST_FILTERS), filters = keys.map(key => LIST_FILTERS[key]);
  const hits = keys.map(() => 0), misses = keys.map(() => 0), carried = keys.map(() => false), list = views || [];
  for (const view of list) {
    for (let k = 0; k < keys.length; k++) {
      const filter = filters[k];
      if (filter.test(view)) hits[k] += 1;
      else if (filter.unknown?.(view)) misses[k] += 1;
      if (filter.field && !carried[k] && view.qualified && view.row && Object.hasOwn(view.row, filter.field)) carried[k] = true;
    }
  }
  const pick = (when, value) => Object.fromEntries(keys.flatMap((key, k) => (when(filters[k]) ? [[key, value(k)]] : [])));
  return { counts: pick(() => true, k => hits[k]), unknown: pick(filter => filter.unknown, k => misses[k]), unpublished: pick(filter => filter.field, k => !carried[k]) };
}
/** Case-insensitive ticker or company-name match. */
export const matchesSearch = (view, query) => !query || `${view.symbol} ${view.name}`.toUpperCase().includes(query.trim().toUpperCase());
// A value sorted high to low, an unknown last.
const highFirst = (a, b) => (finite(b) ? b : -Infinity) - (finite(a) ? a : -Infinity) || 0;
export const LIST_SORTS = {
  priority: { label: '優先度', compare: briefOrder },
  rs: { label: 'RS推計', compare: (a, b) => (b.rs ?? -1) - (a.rs ?? -1) || briefOrder(a, b) },
  pivot: { label: 'ピボットに近い順', compare: (a, b) => (finite(a.distance) ? Math.abs(a.distance) : 99) - (finite(b.distance) ? Math.abs(b.distance) : 99) || briefOrder(a, b) },
  volume: { label: '出来高比', compare: (a, b) => (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1) || briefOrder(a, b) },
  high: { label: '52週高値に近い順', compare: (a, b) => (a.fromHigh ?? 999) - (b.fromHigh ?? 999) || briefOrder(a, b) },
  // By the value as the chip prints it (wholePercent), then the raw value, an unknown last.
  eps: { label: 'EPS前年比', filter: 'eps', compare: (a, b) => highFirst(wholePercent(a.epsYoy), wholePercent(b.epsYoy)) || highFirst(a.epsYoy, b.epsYoy) || briefOrder(a, b) },
  // The Setup Engine confidence, an unknown last (the list's notes say so).
  base: { label: '土台の質', compare: (a, b) => highFirst(a.setupConfidence, b.setupConfidence) || briefOrder(a, b) },
};

/**
 * The row's trend-template chip (RW4): 「TT 8/8」 for a selected stock; for the rest the unmet and the
 * unconfirmed conditions apart, so an unknown never reads as 「あと0」: 「TT未確認（2条件）」, 「未達1・未確認2」,
 * 「あと1条件」, or the exclusion (選定対象外) when nothing is unmet or unknown. `zone` marks the one green chip.
 */
export function templateChip(view) {
  if (view?.qualified) return { text: 'TT 8/8', zone: true };
  const failed = Number.isInteger(view?.failed) ? view.failed : null, unknown = Number.isInteger(view?.unknown) ? view.unknown : null;
  if (failed === null || unknown === null) return { text: '条件 未確認', zone: false };
  if (failed === 0 && unknown > 0) return { text: `TT未確認（${unknown}条件）`, zone: false };
  if (failed > 0 && unknown > 0) return { text: `未達${failed}・未確認${unknown}`, zone: false };
  if (failed > 0) return { text: `あと${failed}条件`, zone: false };
  return { text: view.exclusion || templateShort(view), zone: false };
}

/** Why a stock is not a buy candidate by the trend template: 'TT未達', 'TT未確認' or '選定対象外'. */
export const templateShort = view => Number.isInteger(view?.failed) && view.failed > 0 ? 'TT未達' : Number.isInteger(view?.unknown) && view.unknown > 0 ? 'TT未確認' : '選定対象外';

/**
 * What changed for a watched stock, in the order a trader acts on it. With `market` (prepared.market, or
 * null when the bundle carries none), a market that is not open to new buying turns the green tones
 * neutral, as Today's focus rows do; the titles stay. Without the argument, the tones are as before. A view
 * whose Setup Engine base is not current in the zone or near the pivot (baseMuted) has no green either, as its focus row.
 */
export function watchEvent(view, market) {
  // The day's event in the rows' short form (rowEvent), so Today says one stock one way.
  const event = rowEvent(view);
  // Not a buy candidate: the day's event or the position stays visible with the reason, never green; a heavy
  // down day keeps its warning.
  if (!view.qualified) {
    const why = `（${templateShort(view)}）`;
    if (!event) return { kind: 'unqualified', tone: 'neutral', title: `${view.stateLabel}${why}` };
    // The kind keeps the row chip's glyph (↗, ▲, or ● for a touch or a crossing).
    return { kind: event.kind === 'breakout' || event.kind === 'heavyDown' ? event.kind : 'zone', tone: event.tone === 'ext' ? 'ext' : 'neutral', title: `${event.text}${why}` };
  }
  const held = (market !== undefined && candidateMarketGate(market) !== 'open') || baseMuted(view);
  const tone = value => held && value === 'zone' ? 'neutral' : value;
  if (event?.kind === 'breakout') return { kind: 'breakout', tone: tone('zone'), title: event.text };
  if (event?.kind === 'heavyDown') return { kind: 'heavyDown', tone: 'ext', title: event.text };
  // A crossing without the volume keeps the zone's ● but not its green (tone 'wait').
  if (view.state === 'zone') return { kind: 'zone', tone: tone(event?.tone || 'zone'), title: event?.text || positionText(view) };
  // Near the pivot: the focus row's chip text (positionText), so a watched focus candidate reads one way on Today.
  if (view.position === 'near' || nearPivot(view)) return { kind: 'near', tone: 'wait', title: positionText(view) };
  if (view.state === 'ext') return { kind: 'ext', tone: 'ext', title: POSITION_NAMES.ext };
  if (view.state === 'wait') return { kind: 'base', tone: 'neutral', title: POSITION_NAMES.base };
  if (view.stale) return { kind: 'stale', tone: view.stale.above ? 'ext' : 'neutral', title: view.stale.short };
  return { kind: 'unknown', tone: 'neutral', title: view.stateLabel };
}
