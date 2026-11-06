import { FINANCIAL_FIELDS } from '../src/static/financialCurrent.js';
import {SCAN_FILTER_FIELDS} from '../src/static/scanClient.js';
// All global filter/sort values survive unchanged. Additional indicators and
// explanations belong to the on-demand detail, not every initial table row.
const fields=new Set([...SCAN_FILTER_FIELDS,...FINANCIAL_FIELDS,'name','product_name','quoteType','quote_type','cusip','isin','cik','issuer_cik','instrument_identity','instrument_applicability','financial_identity','financial_current','financial_publication_input','financial_generation','financial_evaluated_at','financial_knowledge_basis','financial_point_in_time','financial_source_publication_date','financial_policy_version','as_of_date','eps_growth_quarterly','eps_growth_annual',...`adv_usd buy_risk_atr buy_risk_state composite_reason data_status exchange execution_cap_applied execution_cap_reason execution_state field_availability growth_metric_basis is_scannable market_themes pressure_state pressure_value price_sparkline_data price_trend rs_sparkline_data rs_trend se_rs_line_blue_dot se_pivot_price tpr_max tpr_score tpr_state chart_path research_detail_path market_regime market_above_50dma market_above_200dma institutional_sponsors_increasing`.split(' ')]);
export function scanListRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key)));
}

// ---- Round-2 list summaries (plan §2.3, DT5/DT6). Research-index rows only: tools/export-research.mjs writes these
// into the index summary, never onto the canonical rows, so the scan pages and the candidate alias replay are
// unchanged. Kept free of the brief's own modules (this file is also imported by .github/scripts); the RS-line
// rules are passed in, so the export applies the chart track's frozen functions.
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const flag = value => value === true || value === false || value === null;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The research-index summary fields round 2 adds beside listFields (absent from every older publication). */
export const RESEARCH_SUMMARY_FIELDS = Object.freeze(['rs_line_high', 'sec_summary']);

/**
 * A row's `rs_line_high` from its certified chart: `rules` are briefChartModel's frozen rsLineNewHigh and
 * rsLeadMarks; `audit` the row's published technical_audit; `chart` the verified chart (bars and rs_line).
 * Null unless the audit is valid for `date`. With fewer than 252 aligned points, or a chart or RS line whose
 * last point is not `date`, value and leading are null (未確認), never false.
 */
export function rsLineHighSummary(rules, { audit, chart, date }) {
  if (!audit?.valid || audit.as_of_date !== date || !isoDay(date)) return null;
  const bars = Array.isArray(chart?.bars) ? chart.bars : [], line = Array.isArray(chart?.rs_line) ? chart.rs_line : [];
  const last = line.at(-1);
  if (bars.at(-1)?.date !== date || (last?.time ?? last?.date) !== date) return { value: null, leading: null, as_of_date: date };
  const value = rules.rsLineNewHigh(line, bars);
  const marks = rules.rsLeadMarks(line, bars);
  // The last bar's RS-lead rule is judged only when that bar has its 252 prior RS points and 252 bars.
  const judged = marks && marks.points >= 253 && bars.length >= 252;
  return { value: value === true || value === false ? value : null, leading: judged ? marks.dates.at(-1) === date : null, as_of_date: date };
}

/** Whether a published `rs_line_high` has the documented shape for `date` (an absent field is valid: older publications). */
export function validRsLineHigh(value, date) {
  if (value === undefined || value === null) return true;
  return plain(value) && Object.keys(value).length === 3 && flag(value.value) && flag(value.leading) && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'leading') && value.as_of_date === date;
}

export const MARKET_CONTEXT_METHOD = 'backend-market-regime-v1';
const CONTEXT_FIELDS = [['distribution_days', 'market_distribution_days'], ['ftd_date', 'market_ftd_date'], ['ftd_days_since', 'market_ftd_days_since'], ['exposure_pct', 'market_exposure_pct']];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const contextValue = (key, value) => key === 'ftd_date' ? (isoDay(value) ? value : null) : number(value);
/**
 * `manifest.markets.US.market_context` from the canonical rows: the backend regime and its distribution-day, FTD and
 * exposure fields, only when every US row that carries a regime agrees on all of them; otherwise null, with `reason`
 * ('no_rows' or 'disagree', and how many distinct versions) for the log line. A missing field is null.
 * → { block, reason, rows, versions }
 */
export function marketContextBlock(rows, date) {
  const carrying = (rows || []).filter(row => (row?.market ?? 'US') === 'US' && typeof row?.market_regime === 'string' && row.market_regime);
  if (!carrying.length || !isoDay(date)) return { block: null, reason: 'no_rows', rows: 0, versions: 0 };
  const versions = new Map();
  for (const row of carrying) {
    const value = { as_of_date: date, regime: row.market_regime, ...Object.fromEntries(CONTEXT_FIELDS.map(([key, field]) => [key, contextValue(key, row[field])])), guard: null, method: MARKET_CONTEXT_METHOD, source: 'scan-rows' };
    versions.set(JSON.stringify(value), value);
  }
  if (versions.size !== 1) return { block: null, reason: 'disagree', rows: carrying.length, versions: versions.size };
  return { block: [...versions.values()][0], reason: null, rows: carrying.length, versions: 1 };
}

const CONTEXT_KEYS = ['as_of_date', 'regime', 'distribution_days', 'ftd_date', 'ftd_days_since', 'exposure_pct', 'guard', 'method', 'source'];
/** Whether a published market_context block has the documented shape for `date` (absent or null is valid). */
export function validMarketContext(block, date) {
  if (block === undefined || block === null) return true;
  if (!plain(block) || Object.keys(block).length !== CONTEXT_KEYS.length || !CONTEXT_KEYS.every(key => Object.hasOwn(block, key))) return false;
  return block.as_of_date === date && typeof block.regime === 'string' && block.regime.length > 0 && block.guard === null && block.method === MARKET_CONTEXT_METHOD && block.source === 'scan-rows'
    && ['distribution_days', 'ftd_days_since', 'exposure_pct'].every(key => block[key] === null || number(block[key]) !== null) && (block.ftd_date === null || isoDay(block.ftd_date));
}
