// Candidate view model for the daily-brief screens: the trend template, a candidate's position, the
// brief's order, Today's focus pool and the list filters. Every value comes from the published research
// rows and the existing rule functions; unknown stays unknown.
import { assess, entryPlan, finite, highDistance } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { stateKey, STATES } from '../positionGeometry';
import { verifiedVolumeRatio } from '../qualificationAudit';

export const BREAKOUT_VOLUME_RATIO = 1.4;
const ZONE_RANK = { zone: 0, wait: 1, ext: 3, low: 4, acq: 5, na: 6 };
const DAY = 86400000;

/** Trend-template rows (8 price/RS conditions) and the integrity rule, from the shared rule function. */
export function trendTemplate(row, now = Date.now()) {
  const result = assess(row, 'minervini', now);
  const rules = result.rules.slice(0, 8);
  return {
    rules,
    integrity: result.rules[8],
    passed: rules.filter(rule => rule.state === 'pass').length,
    failed: rules.filter(rule => rule.state === 'fail').length,
    unknown: rules.filter(rule => rule.state !== 'pass' && rule.state !== 'fail').length,
    qualified: result.qualified,
  };
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

/** One candidate as the brief shows it. */
export function candidateView(item, date) {
  const row = item?.row || item;
  const plan = entryPlan(row, null, 'minervini');
  const key = stateKey(plan.state);
  const volume = verifiedVolumeRatio(row, date);
  return {
    symbol: row.symbol,
    name: row.company_name || row.name || '',
    sector: row.gics_sector || row.sector || '',
    price: finite(plan.price) ? plan.price : null,
    pivot: finite(plan.pivot) ? plan.pivot : null,
    upper: finite(plan.upper) ? plan.upper : null,
    distance: finite(plan.distance) ? plan.distance : null,
    state: key,
    stateLabel: STATES[key]?.[0] || plan.state || '判定不可',
    stateGlyph: STATES[key]?.[1] || '?',
    volumeRatio: finite(volume) ? volume : null,
    rs: finite(row.rs_rating) ? row.rs_rating : null,
    fromHigh: finite(highDistance(row)) ? highDistance(row) : null,
    rsLineHigh: row.se_rs_line_new_high === true,
    qualified: Boolean(item?.assessment?.qualified),
    passed: item?.assessment?.passed ?? null,
    failed: item?.assessment?.failed ?? null,
    unknown: item?.assessment?.unknown ?? null,
    earnings: earningsDays(row, date),
    pivotSource: canonicalPivot(row).reason,
    row,
  };
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
 * The tone of Today's 注目候補 tile from the bundle state, the focus counts and the market verdict
 * (step 0: the market is not read yet).
 */
export function focusTone(state, counts, market) {
  void market;
  return state === 'ready' && counts?.total ? 'zone' : '';
}

/** A note after Today's 注目候補 heading for the market verdict, or null (step 0: always null). */
export function focusHeadingNote(market) {
  void market;
  return null;
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

/** What changed for a watched stock, in the order a trader acts on it. */
export function watchEvent(view) {
  if (view.state === 'zone' && finite(view.volumeRatio) && view.volumeRatio >= BREAKOUT_VOLUME_RATIO) return { kind: 'breakout', tone: 'zone', title: 'ピボットを出来高を伴って上抜け' };
  if (view.state === 'zone') return { kind: 'zone', tone: 'zone', title: '買いゾーン内' };
  if (view.state === 'wait' && finite(view.distance) && view.distance >= -5) return { kind: 'near', tone: 'wait', title: `ピボットまで あと${Math.abs(view.distance).toFixed(1)}%` };
  if (view.state === 'ext') return { kind: 'ext', tone: 'ext', title: '買いゾーンを超過' };
  if (view.state === 'wait') return { kind: 'base', tone: 'neutral', title: '土台を形成中' };
  return { kind: 'unknown', tone: 'neutral', title: view.stateLabel };
}
