import { assess } from './researchEngine.js';
import { projectFinancialRow } from './financialCurrent.js';
import { bookFinancialCurrent } from './bookFinancialCurrent.js';
import { financialHistory } from './financialHistory.js';
import { validClock, validEvidenceDay } from './evidenceTime.js';

// Presentation of the shared current-use projection and existing assessment.
// The current-use projector owns lineage/basis validation; assess owns thresholds.
export const FINANCIAL_PRESENTATION_SCHEMA = 'financial-evidence-presentation-v1';
const SOURCE_MAX_AGE = 7 * 86400000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sourceLabel = value => text(value) && !/^(unknown|unavailable|n\/a|未確認|未取得)$/i.test(value.trim());
const timestamp = value => {
  const parts = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  // Date.parse normalizes invalid calendar days and 24:00. Reject those before
  // parsing the explicit timezone offset; retain normal millisecond semantics.
  if (!parts || !validEvidenceDay(parts[1]) || Number(parts[2]) > 23 || Number(parts[3]) > 59 ||
      Number(parts[4]) > 59 || Number(parts[5] || 0) > 23 || Number(parts[6] || 0) > 59) return NaN;
  return Date.parse(value);
};
const number = value => finite(value) ? value.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) : '未確認';
const METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];
const METRICS = [
  { id: 'eps_growth_yy', label: '四半期 EPS 前年同期比', unit: 'percent_points', suffix: '%', required: ['oneil', 'ibd'], comparison: true },
  { id: 'sales_growth_yy', label: '売上高 前年同期比', unit: 'percent_points', suffix: '%', required: ['oneil', 'ibd'], comparison: true },
  { id: 'annual_eps_growth_3y', label: '直近3年の年次 EPS', unit: 'percent_points', suffix: '%', required: ['oneil', 'ibd'] },
  { id: 'eps_rating', label: 'EPS 推計', unit: 'rating_1_99', suffix: '', required: ['ibd'], derived: true },
  { id: 'composite_rating', label: 'Composite 推計', unit: 'rating_1_99', suffix: '', required: ['ibd'], derived: true },
  { id: 'roe', label: 'ROE', unit: 'percent_points', suffix: '%', required: [] },
  { id: 'profit_margin', label: '純利益率', unit: 'percent_points', suffix: '%', required: [] },
];

export const financialUnknownReason = reason => ({
  invalid_evaluation_context: '銘柄・分析日・判定時刻の対応を確認できません。',
  invalid_envelope: '財務根拠の形式または有効期限を確認できません。',
  missing_or_invalid_value: 'この条件に使える有限の実数値がありません。',
  unsupported_contract: '提供元と計算基準の組み合わせを確認できません。',
  invalid_reporting_period: '対象期・比較期・四半期の連続性を確認できません。',
  stale_reporting_period: '対象の決算期が現在の判定に使える期間を過ぎています。',
  future_source_timestamp: '提供元の取得時刻が判定時刻より後です。',
  alias_conflict: '同じ指標の配信値が一致していません。',
  invalid_source_inputs: '計算元の値と提供元の対応を確認できません。',
  historical_observation: '保持した過去の観測値です。現在の条件判定には使用しません。',
  missing_evidence: '現在の判定に使える財務根拠が未配信です。',
  identity_mismatch: '銘柄・分析日・方式・配信版の対応を確認できません。',
  invalid_evaluation_time: '判定時刻を確認できません。',
  expired_projection: '根拠の有効期限を過ぎています。再確認が必要です。',
  missing_source: 'この値に対応する提供元が未確認です。',
  missing_observed_at: '提供元からの取得時刻が未確認です。',
  missing_period: 'この値の決算期・比較期が未確認です。',
  missing_basis: 'この値の計算基準が未確認です。',
  missing_unit: 'この値の単位が未確認です。割合と百分率を推測して変換しません。',
  unit_mismatch: 'この値の単位は表示に必要な正規化済み単位と一致しません。変換せず未確認とします。',
  missing_expiry: 'この根拠の有効期限が未確認です。',
  stale_source: '提供元からの取得後7日を超えた参考記録です。',
  future_source: '提供元の取得時刻が判定時刻より後です。',
  unverified_source_lineage: '値と提供元の対応が未確認です。',
  unverified_derivation_and_cohort: '推計の入力値・計算方法・比較母集団の根拠が未確認です。',
  missing_condition: 'この値に対応する選定条件の判定が未確認です。',
  value_mismatch: '実数値と選定条件の判定値が一致しません。',
  missing_value: '実数値が未取得です。',
  invalid_history: '有効なUSD報告希薄化EPS履歴がありません（取得後72時間・銘柄・日付などを確認）。',
  incomplete_annual_history: '3年の成長履歴に必要な連続4期の年次EPSが揃っていません。',
  incomparable_annual_growth: '年次成長率を比較できません（欠損・ゼロ／赤字基準年・期間不整合など）。',
}[reason] || '現在の判定に使える根拠を確認できません。');

function envelopeReason(evidence, context) {
  if (evidence?.schema !== FINANCIAL_PRESENTATION_SCHEMA) return 'missing_evidence';
  const { symbol, date, generation, method, now } = context;
  if (!text(symbol) || !validEvidenceDay(date) || !text(generation) || evidence.symbol !== symbol ||
      evidence.as_of_date !== date || evidence.generation !== generation || evidence.method !== method) return 'identity_mismatch';
  const evaluated = timestamp(evidence.evaluated_at);
  if (!validClock(now) || !finite(evaluated) || evaluated > now) return 'invalid_evaluation_time';
  const expiry = timestamp(evidence.valid_until);
  if (!finite(expiry) || expiry < evaluated) return 'missing_expiry';
  return now > expiry ? 'expired_projection' : null;
}

function scalarReason(metric, data, date, now) {
  if (!data || data.availability !== 'current') return data?.reason || 'unverified_source_lineage';
  if (!finite(data.value)) return 'missing_value';
  if (!text(data.unit)) return 'missing_unit';
  if (data.unit !== metric.unit) return 'unit_mismatch';
  if (metric.derived) return 'unverified_derivation_and_cohort';
  if (!sourceLabel(data.source)) return 'missing_source';
  if (!validEvidenceDay(data.period_end) || data.period_end > date ||
      (metric.comparison && (!validEvidenceDay(data.comparable_period_end) || data.comparable_period_end >= data.period_end))) return 'missing_period';
  if (!text(data.basis)) return 'missing_basis';
  const observed = timestamp(data.observed_at), expiry = timestamp(data.valid_until);
  if (!finite(observed)) return 'missing_observed_at';
  if (observed > now) return 'future_source';
  if (now - observed > SOURCE_MAX_AGE) return 'stale_source';
  if (!finite(expiry) || expiry < observed || expiry > observed + SOURCE_MAX_AGE) return 'missing_expiry';
  return now > expiry ? 'expired_projection' : null;
}

function conditionState(condition, value) {
  if (!text(condition?.label) || !['pass', 'fail', 'unknown'].includes(condition.state)) return { state: 'unknown', reason: 'missing_condition' };
  if (condition.value !== value) return { state: 'unknown', reason: 'value_mismatch' };
  return { state: condition.state, reason: condition.state === 'unknown' ? condition.reason || 'missing_condition' : null };
}

const sourceMetricLabel = metric => ({
  'Basic EPS': '基本EPS（報告値）',
  'Diluted EPS': '希薄化EPS（報告値）',
  'Total Revenue': '売上高（Total Revenue）',
  'Operating Revenue': '営業収益（Operating Revenue）',
}[metric] || (text(metric) ? metric : '指標の種類 未確認'));
const basisLabel = basis => ({
  'quarterly_qoq/v1': '四半期の前期比（報告値）',
  'comparable_period_yoy/v1': '比較可能な四半期の前年同期比（報告値）',
  'quarterly_eps_yoy/v1': '四半期EPSの前年同期比（報告値）',
  'annual_eps_cagr/v1': '年次EPSの年平均成長率（報告値）',
}[basis] || (text(basis) ? basis : '計算基準 未確認'));

const metadata = data => ({
  period: validEvidenceDay(data?.period_end) ? `${data.period_end}${validEvidenceDay(data.comparable_period_end) ? ` / 比較 ${data.comparable_period_end}` : ''}` : '決算期 未確認',
  source: sourceLabel(data?.source) ? data.source : '提供元 未確認',
  observedAt: finite(timestamp(data?.observed_at)) ? data.observed_at : '取得時刻 未確認',
  metric: sourceMetricLabel(data?.metric),
  basis: basisLabel(data?.basis),
  unit: text(data?.unit) ? data.unit : '単位 未確認',
});

function annualRow(history, context, required, condition) {
  const { symbol, date, now, method } = context;
  const report = financialHistory(history, symbol, date, now);
  let reason = !report.valid ? 'invalid_history' : !sourceLabel(history.source) ? 'missing_source' : !finite(timestamp(history.retrieved_at)) ? 'missing_observed_at' : null;
  if (!reason && !report.annualComplete) reason = 'incomplete_annual_history';
  if (!reason && method !== 'ibd' && !report.annualGrowth) reason = 'incomparable_annual_growth';
  const value = method === 'ibd' ? report.annualComplete : report.annualGrowth ? Math.min(...report.annualGrowth) : null;
  const decision = !reason && required ? conditionState(condition, value) : { state: reason ? 'unknown' : 'reference', reason };
  return {
    ...decision,
    actual: reason ? '未確認' : report.annualGrowth ? report.annualGrowth.map(n => `${number(n)}%`).join(' → ') : '連続4期の年次EPSあり（成長率は比較不可）',
    period: report.annual.length ? `${report.annual.slice(-4)[0].end} ～ ${report.annual.at(-1).end}` : '決算期 未確認',
    source: sourceLabel(history?.source) ? history.source : '提供元 未確認',
    observedAt: finite(timestamp(history?.retrieved_at)) ? history.retrieved_at : '取得時刻 未確認',
    metric: '希薄化EPS（報告値・年次）',
    basis: '報告希薄化EPS・USD / 独立した年次履歴',
    unit: report.annualGrowth ? 'percent_points（USD報告希薄化EPSから算出した年次成長率）' : 'USD / 株（報告希薄化EPSの履歴・成長率は比較不可）',
  };
}

/**
 * See docs/financial-evidence-presentation.md for the input contract and activation
 * gates. This does not produce current-use evidence or calculate rule thresholds.
 * `history` is the independent financial_history payload, never a scalar fallback.
 */
export function financialEvidencePresentation({ evidence, history, symbol, date, generation, method, now }) {
  if (!METHODS.includes(method)) throw new Error('Unknown research method');
  const context = { symbol, date, generation, method, now };
  const problem = envelopeReason(evidence, context);
  const bound = evidence?.schema === FINANCIAL_PRESENTATION_SCHEMA && text(symbol) && validEvidenceDay(date) && text(generation) &&
    evidence.symbol === symbol && evidence.as_of_date === date && evidence.generation === generation && evidence.method === method;
  const rows = METRICS.map(metric => {
    const required = metric.required.includes(method), data = bound ? evidence.metrics?.[metric.id] : null;
    const condition = data?.condition;
    let result;
    if (metric.id === 'annual_eps_growth_3y') {
      // Independently valid annual history remains readable even before a scalar
      // projection exists, but a required pass still needs the bound rule result.
      result = annualRow(history, context, required, condition);
      if (problem && required) result = { ...result, state: 'unknown', reason: problem };
    } else {
      const reason = problem || scalarReason(metric, data, date, now);
      result = { ...metadata(data), actual: reason ? '未確認' : `${number(data.value)}${metric.suffix}`,
        ...(reason ? { state: 'unknown', reason } : required ? conditionState(condition, data.value) : { state: 'reference', reason: null }) };
    }
    return { id: metric.id, label: metric.label, required,
      condition: required ? text(condition?.label) ? condition.label : '選定条件の根拠待ち' : '選定の数値条件なし・参考',
      ...result, explanation: result.reason ? financialUnknownReason(result.reason) : null };
  });
  // Historical values have no condition state and never enter the current rows.
  const historical = bound && Array.isArray(evidence.historical) ? evidence.historical.flatMap((data, index) => {
    const metric = METRICS.find(m => m.id === data?.id);
    return metric && finite(data.value) ? [{ key: `${data.id}-${index}`, label: metric.label,
      value: data.unit === metric.unit ? `${number(data.value)}${metric.suffix}` : `${data.value}（単位未確認・原値）`,
      ...metadata(data), explanation: financialUnknownReason(data.reason) }] : [];
  }) : [];
  return { rows, historical, requiredCount: rows.filter(r => r.required).length,
    requiredUnknown: rows.filter(r => r.required && r.state === 'unknown').length,
    referenceUnknown: rows.filter(r => !r.required && r.state === 'unknown').length };
}


// This adapter never promotes raw scalars or an availability flag into evidence.
// The compact contract is verified again before selecting the engine's rules.
export function buildFinancialEvidencePresentation(row, { method, date, generation, now }) {
  if (!row || !validClock(now) || !validEvidenceDay(date) || !text(generation)) return null;
  const current = projectFinancialRow(row, { now, asOfDate: date });
  const assessment = assess(current, method, now);
  const ruleMatchers = {
    eps_growth_yy: rule => /四半期 EPS/.test(rule.label),
    sales_growth_yy: rule => /売上高 前年/.test(rule.label),
    annual_eps_growth_3y: rule => /3年/.test(rule.label),
    eps_rating: rule => /^EPS 推計/.test(rule.label),
    composite_rating: rule => /^Composite 推計/.test(rule.label),
  };
  const metrics = Object.fromEntries(METRICS.map(({ id }) => [id, {
    ...current.financial_current_state.fields[id],
    condition: ruleMatchers[id] ? assessment.rules.find(ruleMatchers[id]) : undefined,
  }]));
  const deadlines = Object.values(metrics).filter(metric => metric.availability === 'current').map(metric => timestamp(metric.valid_until)).filter(finite);
  const history = financialHistory(current.financial_history, current.symbol, date, now);
  const historyObserved = timestamp(current.financial_history?.retrieved_at);
  if (history.valid && finite(historyObserved)) deadlines.push(historyObserved + 72 * 3600000);
  const saved = current.financial_historical;
  const historical = METRICS.flatMap(({ id }) => {
    const value = saved?.values?.[id];
    if (!finite(value)) return [];
    const retained = saved.source_evidence?.fields?.[id];
    return [{ id, value, metric: retained?.metric, unit: retained?.unit, source: retained?.source, observed_at: retained?.observed_at,
      period_end: retained?.period_end, comparable_period_end: retained?.comparable_period_end, basis: retained?.basis,
      reason: current.financial_current_state.fields[id]?.reason || 'historical_observation' }];
  });
  return { schema: FINANCIAL_PRESENTATION_SCHEMA, symbol: current.symbol, as_of_date: date, generation, method,
    evaluated_at: new Date(now).toISOString(), valid_until: new Date(deadlines.length ? Math.min(...deadlines) : now).toISOString(), metrics, historical };
}

// Summaries share exact scalar presentation with the detailed panel. Book
// measurements stay separate from the technical screen and reported history.
export function financialEvidenceSummary(input) {
  const view = financialEvidencePresentation(input);
  const scalar = (id, title) => ({ ...view.rows.find(row => row.id === id), title, target: 'financial' });
  const bound = !envelopeReason(input.evidence, input);
  const currentBook = bookFinancialCurrent(bound ? input.bookFinancials : null, input.symbol, input.date, input.now);
  const book = currentBook.report;
  const source = sourceLabel(book.source) ? book.source : '提供元 未確認';
  const usableBook = currentBook.current && sourceLabel(book.source);
  const continuityState = usableBook && book.epsAcceleration !== 'unknown' && book.salesAcceleration !== 'unknown' ? 'reference' : 'unknown';
  const bookPeriod = book.rows.length ? `${book.rows.slice(-4)[0].end} ～ ${book.rows.at(-1).end}` : '決算期 未確認';
  const measured = state => state === 'pass' ? '充足' : state === 'fail' ? '未充足' : '未確認';
  return [scalar('eps_growth_yy', 'EPS前年比'), scalar('sales_growth_yy', '売上前年比'),
    { id: 'continuity', title: '業績の連続性', actual: continuityState === 'reference' ? '4四半期を確認' : '未確認', state: continuityState, target: 'book',
      condition: '参考・4四半期のEPS／売上成長加速', period: bookPeriod, source,
      explanation: continuityState === 'reference' ? `EPS加速 ${measured(book.epsAcceleration)}・売上加速 ${measured(book.salesAcceleration)}。連続成長やSEPA全体の認定ではありません。` : currentBook.reason === 'stale_book_period' ? '最新期末が現在の確認日から180日超前です。基準日時点の書籍照合記録は詳細に保持しています。' : '提出日付きの比較可能な4四半期が必要です。単期の伸びや取得時点のYahoo履歴では代替しません。' },
    { id: 'quality', title: '利益の質', actual: '追加確認', state: 'unknown', target: 'book',
      condition: '参考・一時利益、売上の裏付け、在庫・売掛金', period: bookPeriod, source,
      explanation: `純利益率改善 ${measured(usableBook ? book.marginImprovement : 'unknown')}。調整後EPS・一時利益・予想修正は未確認です。` },
  ];
}
