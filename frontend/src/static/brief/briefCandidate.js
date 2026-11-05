// Candidate view model for the daily-brief screens: the trend template, a candidate's position, the
// brief's order, Today's focus pool and the list filters. Every value comes from the published research
// rows and the existing rule functions; unknown stays unknown.
import { assess, entryPlan, finite, highDistance } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { stateKey, STATES, times } from '../positionGeometry';
import { auditValues, verifiedVolumeRatio } from '../qualificationAudit';
import { conditionText, singleMissingCondition } from '../missingCondition';
import { shortDate } from './briefShared';

export const BREAKOUT_VOLUME_RATIO = 1.4;
/** Calendar days before an earnings date at which every screen warns (the chips and the conclusion line). */
export const EARNINGS_WARN_DAYS = 10;
const ZONE_RANK = { zone: 0, wait: 1, ext: 3, low: 4, acq: 5, na: 6 };
const DAY = 86400000;
const positive = value => finite(value) && value > 0;

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
  const v = Math.abs(rule.value).toFixed(1);
  if (rule.label.startsWith('52週安値')) return `52週安値から +${v}%`;
  if (rule.label.startsWith('52週高値')) return rule.value === 0 ? '52週高値と同値' : `52週高値から −${v}%`;
  return `${rule.value < 0 ? '−' : ''}${v}%`;
}

export function earningsDays(row, date) {
  const value = row?.entry_evidence?.earnings?.date;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || typeof date !== 'string') return null;
  const days = Math.round((Date.parse(value) - Date.parse(date)) / DAY);
  return Number.isFinite(days) && days >= 0 ? { date: value, days } : null;
}

/** True when the earnings date is EARNINGS_WARN_DAYS calendar days away or nearer (an unknown date is not). */
export const earningsSoon = view => Boolean(view?.earnings) && view.earnings.days <= EARNINGS_WARN_DAYS;

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

/** One candidate as the brief shows it. */
export function candidateView(item, date) {
  const row = item?.row || item;
  const plan = entryPlan(row, null, 'minervini');
  const key = stateKey(plan.state);
  const volume = verifiedVolumeRatio(row, date);
  const distance = finite(plan.distance) ? plan.distance : null;
  const pivotSource = canonicalPivot(row).reason;
  const stale = key === 'na' ? stalePivot(row, pivotSource) : null;
  const position = key === 'wait' ? (distance >= -5 ? 'near' : 'base') : stale ? (stale.above ? 'staleAbove' : 'staleBelow') : key;
  const assessment = item?.assessment;
  const failed = assessment?.failed ?? null, unknown = assessment?.unknown ?? null;
  return {
    symbol: row.symbol,
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
    ...verifiedDay(row, date),
    rs: finite(row.rs_rating) ? row.rs_rating : null,
    fromHigh: finite(highDistance(row)) ? highDistance(row) : null,
    rsLineHigh: row.se_rs_line_new_high === true,
    qualified: Boolean(assessment?.qualified),
    passed: assessment?.passed ?? null,
    failed,
    unknown,
    // The one unmet rule of an あと1条件 row, from the same rule function (only those rows pay for it).
    missing: !assessment?.qualified && failed === 1 && unknown === 0 ? oneMissing(row) : null,
    exclusion: assessment?.financial_exclusion?.label || assessment?.applicability_label || null,
    earnings: earningsDays(row, date),
    pivotSource,
    row,
  };
}

/** { text: 「未達：RS ≥ 70（61）」, rs: whether the unmet rule is the RS estimate's (the chip then carries the RS value) }. */
function oneMissing(row) {
  const missing = singleMissingCondition(assess(row, 'minervini'));
  return missing?.state === 'fail' ? { text: `未達：${conditionText(missing)}`, rs: /^RS 推計/.test(missing.label) } : null;
}

const cents = value => Math.round(value * 100);

/**
 * The analysis day as an event, from the verified close, its change and the verified volume ratio only:
 * a breakout is strictly previous close < pivot < close on an up day with BREAKOUT_VOLUME_RATIO or more.
 * Only for a stock in the buy zone; null when any input is missing (nothing is said about a breakout).
 * `bars`, when given, are bars certified for the analysis date: they date a crossing 1–3 sessions back.
 */
export function breakoutEvent(view, bars = null) {
  if (view?.state !== 'zone' || !positive(view.pivot) || !positive(view.close) || !positive(view.prevClose) || !finite(view.change)) return null;
  const { pivot, close, prevClose, change } = view, volume = finite(view.volumeRatio) ? view.volumeRatio : null;
  const heavy = volume !== null && volume >= BREAKOUT_VOLUME_RATIO;
  if (change < 0 && heavy) return { kind: 'heavyDown', tone: 'ext', title: `下落日の大商い ${times(volume)}（要注意）` };
  if (prevClose < pivot && cents(close) === cents(pivot)) return { kind: 'touch', tone: 'zone', title: 'ピボット到達' };
  if (prevClose < pivot && close > pivot) {
    if (change > 0 && heavy) return { kind: 'breakout', tone: 'zone', title: `本日ピボットを出来高${times(volume)}で上抜け` };
    return { kind: 'cross', tone: 'zone', title: volume === null ? '本日ピボットを上抜け（出来高 未確認）' : `本日ピボットを上抜け（出来高${times(volume)}・${BREAKOUT_VOLUME_RATIO}×未満）` };
  }
  if (prevClose >= pivot) {
    const crossed = pivotCrossing(bars, pivot);
    return { kind: 'after', tone: 'zone', title: crossed ? `買いゾーン内（${shortDate(crossed.date, bars.at(-1)?.date)}に上抜け・${crossed.sessionsAgo}営業日前）` : '買いゾーン内（上抜け後）', crossed };
  }
  return null;
}

/**
 * The session the close last crossed the pivot from below, when it was 1 to `sessions` sessions before
 * the last bar and every close since is at or above the pivot; null otherwise (or with any close missing).
 */
export function pivotCrossing(bars, pivot, sessions = 3) {
  if (!Array.isArray(bars) || !positive(pivot)) return null;
  const n = bars.length, close = i => (positive(bars[i]?.close) ? bars[i].close : null);
  for (let i = n - 1; i >= n - 1 - sessions && i >= 1; i--) {
    const today = close(i), before = close(i - 1);
    if (today === null || before === null || today < pivot) return null;
    if (before < pivot) return i === n - 1 ? null : { date: bars[i].date, sessionsAgo: n - 1 - i };
  }
  return null;
}

/** Buy zone first, then within 5% below the pivot, then by the shared assessment score and RS. */
export function briefOrder(a, b) {
  const near = view => view.state === 'wait' && finite(view.distance) && view.distance >= -5 ? 1 : view.state === 'wait' ? 2 : ZONE_RANK[view.state] ?? 6;
  return near(a) - near(b) || (b.passed ?? -1) - (a.passed ?? -1) || (b.rs ?? -1) - (a.rs ?? -1) || a.symbol.localeCompare(b.symbol);
}

// One eligibility rule for Today's focus rows, their counts and the list's zone/near filters.
const inZone = view => view.state === 'zone';
const nearPivot = view => view.state === 'wait' && finite(view.distance) && view.distance >= -5;
const focusPool = (ranked, date) => (ranked || []).filter(item => item?.assessment?.qualified).map(item => candidateView(item, date))
  .filter(view => inZone(view) || nearPivot(view));

/** Today's focus list: qualified, liquid Minervini candidates in the buy zone or within 5% below the pivot. */
export function focusCandidates(ranked, date, limit = 5) {
  return focusPool(ranked, date).sort(briefOrder).slice(0, limit);
}

/** The whole focus pool, not the top-`limit` slice Today shows: in the buy zone, near the pivot, and both. */
export function focusCounts(ranked, date) {
  const pool = focusPool(ranked, date), zone = pool.filter(inZone).length;
  return { zone, near: pool.length - zone, total: pool.length };
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
 * The tone of Today's 注目候補 tile: zone only for a ready bundle with focus candidates while the market
 * verdict is open to new buying; neutral while it says to hold off or is unknown.
 */
export function focusTone(state, counts, market) {
  return state === 'ready' && counts?.total && candidateMarketGate(market) === 'open' ? 'zone' : '';
}

/** A note after Today's 注目候補 heading for the market verdict, or null (open, or not loaded yet). */
export function focusHeadingNote(market) {
  const gate = candidateMarketGate(market);
  return gate === 'hold' ? '（地合い：買いは控える・監視のみ）' : gate === 'unknown' ? '（地合い未確認）' : null;
}

export const LIST_FILTERS = {
  zone: { label: '買いゾーン', test: view => view.qualified && inZone(view) },
  near: { label: 'ピボット接近', test: view => view.qualified && nearPivot(view) },
  all: { label: '選定すべて', test: view => view.qualified },
  one: { label: 'あと1条件', test: view => !view.qualified && view.failed === 1 && view.unknown === 0 },
  // Today's focus pool (the zone and near filters together). Hidden: never a segment button.
  focus: { label: '注目候補', hidden: true, test: view => view.qualified && (inZone(view) || nearPivot(view)) },
};
/** Case-insensitive ticker or company-name match. */
export const matchesSearch = (view, query) => !query || `${view.symbol} ${view.name}`.toUpperCase().includes(query.trim().toUpperCase());
export const LIST_SORTS = {
  priority: { label: '優先度', compare: briefOrder },
  rs: { label: 'RS推計', compare: (a, b) => (b.rs ?? -1) - (a.rs ?? -1) || briefOrder(a, b) },
  pivot: { label: 'ピボットに近い順', compare: (a, b) => (finite(a.distance) ? Math.abs(a.distance) : 99) - (finite(b.distance) ? Math.abs(b.distance) : 99) || briefOrder(a, b) },
  volume: { label: '出来高比', compare: (a, b) => (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1) || briefOrder(a, b) },
  high: { label: '52週高値に近い順', compare: (a, b) => (a.fromHigh ?? 999) - (b.fromHigh ?? 999) || briefOrder(a, b) },
};

/** Why a stock is not a buy candidate by the trend template: 'TT未達', 'TT未確認' or '選定対象外'. */
export const templateShort = view => Number.isInteger(view?.failed) && view.failed > 0 ? 'TT未達' : Number.isInteger(view?.unknown) && view.unknown > 0 ? 'TT未確認' : '選定対象外';

/** What changed for a watched stock, in the order a trader acts on it. */
export function watchEvent(view) {
  // Not a buy candidate: the position stays visible, in a neutral tone, with the reason.
  if (!view.qualified) return { kind: 'unqualified', tone: 'neutral', title: `${view.stateLabel}（${templateShort(view)}）` };
  const event = breakoutEvent(view);
  if (event?.kind === 'breakout') return { kind: 'breakout', tone: 'zone', title: event.title };
  if (event?.kind === 'heavyDown') return { kind: 'heavyDown', tone: 'ext', title: event.title };
  if (view.state === 'zone') return { kind: 'zone', tone: 'zone', title: event?.title || '買いゾーン内' };
  if (view.position === 'near' || (view.state === 'wait' && finite(view.distance) && view.distance >= -5)) return { kind: 'near', tone: 'wait', title: `${POSITION_NAMES.near}（あと${Math.abs(view.distance).toFixed(1)}%）` };
  if (view.state === 'ext') return { kind: 'ext', tone: 'ext', title: POSITION_NAMES.ext };
  if (view.state === 'wait') return { kind: 'base', tone: 'neutral', title: POSITION_NAMES.base };
  if (view.stale) return { kind: 'stale', tone: view.stale.above ? 'ext' : 'neutral', title: view.stale.short };
  return { kind: 'unknown', tone: 'neutral', title: view.stateLabel };
}
