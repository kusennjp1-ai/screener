import { currentFinancialHistory, projectFinancialRow } from './financialCurrent.js';
import { ANNUAL_REPORTED_LIMITATION, NATIVE_ANNUAL_SCHEMA, financialHistoryDeadlines } from './financialHistory.js';
import { instrumentApplicability } from './instrumentApplicability.js';
import { validClock, validEvidenceDay } from './evidenceTime.js';
import { financialUnknownReason } from './financialEvidencePresentation.js';
import { sourceAnnualMath, sourceOr } from './oneilSourceMath.js';
import currentContract from '../../contracts/static_financial_current_v1.json' with { type: 'json' };

export const ONEIL_SOURCE_DIAGNOSTIC_SCOPE = '『オニールの相場師養成講座』の年次EPS（PDF 197頁）と売上（PDF 66頁）の2条件だけを比較する診断です。選定・順位・購入判定には使いません。原典の全条件の再現や売買推奨ではありません。';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const reasons = {
  invalid_diagnostic_context: '銘柄・市場・分析日・評価時刻の対応を確認できません。',
  invalid_history_records: '履歴の期間や数値に欠損または不正な形式があります。補完して比較しません。',
  invalid_annual_history: '年次履歴の出典・通貨・単位・取得時刻・期間を確認できません。',
  incomplete_annual_history: '3年CAGRには、同じ基準による連続4期の年次EPSが必要です。欠損・重複・期間不整合を補完しません。',
  missing_annual_eps: '連続4期の有限な年次EPSが揃っていません。',
  nonpositive_annual_eps: 'ゼロまたは負のEPSを含むため、通常のCAGR・増益比較は比較不可です。',
  stale_annual_source: '年次履歴は既存の取得後72時間の有効期限を過ぎています。',
  future_annual_source: '年次履歴の取得時刻が評価時刻より後です。',
  invalid_annual_clock: '年次履歴の取得時刻の形式を確認できません。',
  rounded_sales_boundary: '25.00%は小数第2位への丸め済み値です。丸め前が25%未満かを区別できないため、原典の境界判定は未確認です。',
  unsupported_sales_diagnostic_basis: '提供元・対象期・計算基準を確認できる通常の売上前年比がありません。前期比や上下限を処理した参考値は使いません。',
  unadmitted_sales_comparisons: '同じ指標・単位・比較可能な期間による直近3四半期の売上YoYを確認できません。取得済みの履歴や単独の成長率だけでは加速を判定しません。',
};
const explanation = reason => reasons[reason] || financialUnknownReason(reason);
const clock = value => {
  const parts = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return parts && validEvidenceDay(parts[1]) && Number(parts[2]) <= 23 && Number(parts[3]) <= 59 &&
    Number(parts[4]) <= 59 && Number(parts[5] || 0) <= 23 && Number(parts[6] || 0) <= 59 ? Date.parse(value) : NaN;
};
const ownRecords = values => {
  if (!Array.isArray(values)) return false;
  for (let index = 0; index < values.length; index++) if (!Object.hasOwn(values, index) || !record(values[index]) || !Object.hasOwn(values[index], 'end')) return false;
  return true;
};
const annualUnknown = reason => ({ state: 'unknown', reason, explanation: explanation(reason),
  cagr: { state: 'unknown', value: null, reason }, eachYear: { state: 'unknown', comparisons: [], reason },
  source: null, observedAt: null, period: null, currency: null, unit: null, validUntil: null, limitations: ANNUAL_REPORTED_LIMITATION });
const latestUnknown = reason => ({ state: 'unknown', value: null, reason, explanation: explanation(reason),
  source: null, observedAt: null, period: null, unit: null, validUntil: null });
const accelerationUnknown = () => ({ state: 'unknown', reason: 'unadmitted_sales_comparisons',
  explanation: reasons.unadmitted_sales_comparisons, comparisons: [] });
const salesResult = latest => {
  const acceleration = accelerationUnknown(), state = sourceOr([latest.state, acceleration.state]);
  return { state, reason: state === 'unknown' ? acceleration.reason : null,
    explanation: state === 'pass' ? '最新25%以上の枝が該当するため、OR条件には該当します。加速枝は未確認のままです。'
      : '片枝が該当すれば該当、両枝が未達の場合だけ未達です。現在は加速枝が未確認なので、最新の枝だけでは未達と断定しません。', latest, acceleration };
};

function annualDiagnostic(row, date, now) {
  const data = row.financial_history;
  if (!record(data)) return annualUnknown('invalid_annual_history');
  // The common history validator assumes dense JSON arrays. Reject malformed
  // in-memory arrays before calling it; do not repair, sort or fill any source.
  if (!ownRecords(data.annual) || (data.quarterly !== undefined && !ownRecords(data.quarterly))) return annualUnknown('invalid_history_records');
  let report;
  try { report = currentFinancialHistory(data, row.symbol, date, now, row); }
  catch { return annualUnknown('invalid_history_records'); }
  if (report.annualReason) return annualUnknown(report.annualReason);
  const observedAt = data.schema_version === NATIVE_ANNUAL_SCHEMA ? data.annual_source?.observed_at : data.retrieved_at;
  const observed = clock(observedAt);
  if (!finite(observed)) return annualUnknown('invalid_annual_clock');
  if (observed > now) return annualUnknown('future_annual_source');
  // Use the existing history deadline rather than defining a second TTL.
  const deadline = financialHistoryDeadlines(data)[0];
  if (finite(deadline) && now > deadline) return annualUnknown('stale_annual_source');
  if (!report.valid || !report.annual.length) return annualUnknown('invalid_annual_history');
  if (!report.annualComplete) return annualUnknown('incomplete_annual_history');
  const points = report.annual.slice(-4);
  // The history validator checks period age at the analysis date. This panel
  // is a current-use diagnostic too: apply the existing annual period deadline
  // at the live clock, without changing the history validator or app rules.
  const periodDeadline = Date.parse(points[3].end) + (currentContract.annual_max_age_days + 1) * 86400000 - 1;
  if (now > periodDeadline) return annualUnknown('stale_reporting_period');
  // EPS must be an own finite cell. Inherited or unavailable cells never become
  // a calculated current value even if a different series is otherwise valid.
  if (points.some(point => !Object.hasOwn(point, 'eps') || !finite(point.eps))) return annualUnknown('missing_annual_eps');
  const result = sourceAnnualMath(points.map(point => point.eps));
  result.eachYear.comparisons = result.eachYear.comparisons.map((comparison, index) => ({ ...comparison, from: points[index].end, to: points[index + 1].end }));
  return { ...result, explanation: result.reason ? explanation(result.reason) : '3年CAGR25%以上と、過去3年の各年増益の両方を確認します。CAGRの丸め表示は判定に使いません。',
    source: data.source, observedAt, period: `${points[0].end} ～ ${points[3].end}`, currency: data.annual_currency || data.currency, validUntil: Math.min(deadline, periodDeadline),
    unit: `${data.annual_currency || data.currency} / 提供元の株式単位（報告希薄化EPS）`, limitations: `${ANNUAL_REPORTED_LIMITATION}取得時点の履歴であり、分析日当時の公表確認ではありません。` };
}

function latestSalesDiagnostic(row, date, now) {
  let field;
  try { field = projectFinancialRow(row, { now, asOfDate: date, market: row.market }).financial_current_state.fields.sales_growth_yy; }
  catch { return latestUnknown('invalid_envelope'); }
  if (field.availability !== 'current' || !field.source_validated || !field.ordinary_growth_eligible || !finite(field.value)) return latestUnknown(field.reason || 'missing_evidence');
  if (field.basis !== 'comparable_period_yoy/v1' || field.unit !== 'percent_points' || field.calculation !== 'rounded_percent_change' || field.clipped ||
      Number(field.value.toFixed(2)) !== field.value) return latestUnknown('unsupported_sales_diagnostic_basis');
  // The shared proof certifies round(raw growth, 2). Values strictly above or
  // below 25 retain their side of that boundary; exactly 25 cannot resolve it.
  // Never reconstruct raw inputs or a separate admission path to rescue 25.00.
  const reason = field.value === 25 ? 'rounded_sales_boundary' : null;
  return { state: reason ? 'unknown' : field.value > 25 ? 'pass' : 'fail', value: field.value, reason,
    explanation: reason ? explanation(reason) : '提供元との対応が検証された、小数第2位への丸め済みYoYです。25.00%の境界は未確認として扱います。',
    source: `${field.source} / ${field.metric}`, observedAt: field.observed_at, validUntil: field.expiry,
    period: `${field.period_end} / 比較 ${field.comparable_period_end}`, unit: 'percent_points（検証済み・小数第2位への丸め値）' };
}

export function oneilSourceDiagnostics(row, { date, now } = {}) {
  const scope = row?.financial_identity?.observed_scope;
  const invalid = !record(row) || !text(row.symbol) || !text(row.market) || !validEvidenceDay(date) || !validClock(now) || date > new Date(now).toISOString().slice(0, 10) ||
    (Object.hasOwn(row, 'as_of_date') && row.as_of_date !== date) || (row.technical_audit?.as_of_date != null && row.technical_audit.as_of_date !== date) ||
    (record(scope) && [['symbol', row.symbol], ['market', row.market], ['as_of_date', date]].some(([key, value]) => Object.hasOwn(scope, key) && scope[key] !== value));
  const applicability = instrumentApplicability(row);
  const blockedReason = invalid ? 'invalid_diagnostic_context' : applicability.status !== 'unverified' ? applicability.reason : null;
  if (blockedReason) return { annual: annualUnknown(blockedReason), sales: salesResult(latestUnknown(blockedReason)), nextCheckAt: null };
  const annual = annualDiagnostic(row, date, now), sales = salesResult(latestSalesDiagnostic(row, date, now));
  const deadlines = [annual.validUntil, sales.latest.validUntil].filter(value => finite(value) && value >= now);
  return { annual, sales, nextCheckAt: deadlines.length ? Math.min(...deadlines) + 1 : null };
}
