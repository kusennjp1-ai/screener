// The market tab's own parts of marketTabModel.js: values that only the lazily loaded market screen (its groups, its index
// switch and the study it computes) reads. marketTabModel.js re-exports the values, so their importers are unchanged, and
// Today's entry chunk ships none of this. Nothing here adds a threshold, a status or a verdict.
const finite = Number.isFinite;
// The リーダー group's breakout row moved to marketGateFacts.js (plan D12), which Today's gate reads too; re-exported here so
// its importers are unchanged.
export { breakoutView } from './marketGateFacts';
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

