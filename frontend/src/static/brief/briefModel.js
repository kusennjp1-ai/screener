// Pure view model for the daily-brief screens. Every value comes from the
// published research rows and the existing rule functions; unknown stays unknown.
import { assess, entryPlan, finite } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { stateKey, STATES } from '../positionGeometry';
import { verifiedVolumeRatio } from '../qualificationAudit';

export const STOP_DEFAULT_PERCENT = 7;
export const STOP_MAX_PERCENT = 10;
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

/** Today's focus list: qualified, liquid Minervini candidates in the buy zone or within 5% below the pivot. */
export function focusCandidates(ranked, date, limit = 5) {
  return (ranked || []).filter(item => item?.assessment?.qualified).map(item => candidateView(item, date))
    .filter(view => view.state === 'zone' || (view.state === 'wait' && finite(view.distance) && view.distance >= -5))
    .sort(briefOrder).slice(0, limit);
}

export const LIST_FILTERS = {
  zone: { label: '買いゾーン', test: view => view.qualified && view.state === 'zone' },
  near: { label: 'ピボット接近', test: view => view.qualified && view.state === 'wait' && finite(view.distance) && view.distance >= -5 },
  all: { label: '選定すべて', test: view => view.qualified },
  one: { label: 'あと1条件', test: view => !view.qualified && view.failed === 1 && view.unknown === 0 },
};
/** Case-insensitive ticker or company-name match. */
export const matchesSearch = (view, query) => !query || `${view.symbol} ${view.name}`.toUpperCase().includes(query.trim().toUpperCase());
export const LIST_SORTS = {
  priority: { label: '優先度', compare: briefOrder },
  rs: { label: 'RS推計', compare: (a, b) => (b.rs ?? -1) - (a.rs ?? -1) || briefOrder(a, b) },
  pivot: { label: 'ピボットに近い順', compare: (a, b) => (finite(a.distance) ? Math.abs(a.distance) : 99) - (finite(b.distance) ? Math.abs(b.distance) : 99) || briefOrder(a, b) },
  volume: { label: '出来高比', compare: (a, b) => (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1) || briefOrder(a, b) },
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

/** Position plan from the planned entry (pivot, or price once above it). Stops are capped below 10%. */
export function positionPlan(view, { stopPercent = STOP_DEFAULT_PERCENT, account = 50000, riskPercent = 1.25 } = {}) {
  const pct = Math.min(STOP_MAX_PERCENT - 0.5, Math.max(1, stopPercent));
  const entry = finite(view?.pivot) && finite(view?.price) ? Math.max(view.pivot, view.price) : null;
  if (!finite(entry) || entry <= 0) return null;
  const stop = entry * (1 - pct / 100), risk = entry - stop;
  const riskDollars = finite(account) && account > 0 && finite(riskPercent) && riskPercent > 0 ? account * riskPercent / 100 : null;
  const shares = riskDollars ? Math.floor(riskDollars / risk) : null;
  return { entry, stop, stopPercent: pct, risk, r2: entry + 2 * risk, r3: entry + 3 * risk, riskDollars, shares,
    cost: shares === null ? null : shares * entry, weight: shares === null ? null : shares * entry / account * 100 };
}

/** RS line (price ÷ S&P 500) at or above its high of the prior 251 sessions; null when the history is too short. */
export function rsLineNewHigh(rsLine, bars) {
  const dates = new Set((bars || []).map(b => b.date));
  const values = (rsLine || []).filter(p => dates.has(p.time || p.date) && finite(p.value)).map(p => p.value);
  if (values.length < 252) return null;
  const last = values.at(-1), prior = values.slice(-252, -1);
  return last >= Math.max(...prior);
}

/** VCP footprint text from measured legs, e.g. "VCP 14週 24/3 4T". */
export function footprint(evidence, bars) {
  const legs = evidence?.vcp?.legs || [];
  if (legs.length < 2 || !evidence.vcp.measurementsValid) return null;
  const first = legs[0].startDate, last = bars?.at?.(-1)?.date || legs.at(-1).endDate;
  const weeks = Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / DAY / 7));
  return { weeks, deepest: legs[0].depthPct, shallowest: legs.at(-1).depthPct, count: legs.length,
    text: `VCP ${weeks}週 ${Math.round(legs[0].depthPct)}/${Math.round(legs.at(-1).depthPct)} ${legs.length}T`,
    contracting: evidence.vcp.depthsContract, volumeContracting: evidence.vcp.volumeContracts };
}
