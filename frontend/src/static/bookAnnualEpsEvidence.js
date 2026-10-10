import { currentFinancialHistory } from './financialCurrent.js';
import { instrumentApplicability } from './instrumentApplicability.js';
import { evidenceTimestamp, newYorkDate, validClock, validEvidenceDay } from './evidenceTime.js';

export const BOOK_ANNUAL_EPS_ID = 'oneil-appendix-a-annual-eps';
export const BOOK_ANNUAL_EPS_VERSION = 'book-annual-eps-v1';
export const BOOK_ANNUAL_EPS_LABEL = '年次EPS：各年増益＋3年CAGR25%以上（書籍付録Aの一部）';
export const BOOK_ANNUAL_EPS_SOURCE = Object.freeze({
  book: 'オニールの相場師養成講座', scope: 'appendix_a_table_a1_annual_eps_excerpt',
  pages: '197・202–203', edition: 'supplied_historical_japanese_edition',
});
export const BOOK_ANNUAL_EPS_NOTE = '米国株の研究画面の追加条件です。報告希薄化EPSによる近似。利益の調整・株式単位・株式分割・ADR等は要確認。TTM・予想利益・IPO代替等と手法全体は未評価。取得時点の比較で、価格基準日に公表済みだった証明ではありません。';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const aggregate = states => states.includes('fail') ? 'fail' : states.every(value => value === 'pass') ? 'pass' : 'unknown';
const midnightCache = new Map();

// Exact first invalid New York calendar instant, including DST changes. Cache
// only this calendar conversion, never an evidence decision or source object.
export function bookAnnualPriceExpiry(date) {
  if (!validEvidenceDay(date)) return null;
  if (midnightCache.has(date)) return midnightCache.get(date);
  const target = Date.parse(date) + 4 * 86400000;
  const targetDay = new Date(target).toISOString().slice(0, 10);
  let lo = target - 86400000, hi = target + 86400000;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (newYorkDate(mid) < targetDay) lo = mid; else hi = mid;
  }
  if (midnightCache.size >= 64) midnightCache.delete(midnightCache.keys().next().value);
  midnightCache.set(date, hi);
  return hi;
}

// One audited calculation for the optional filter, detail, source card and CSV.
// Never accepts published pass flags or scalar growth. A known failure remains
// a failure beside unknown components; all four positive cells are needed for
// CAGR. This numeric excerpt never qualifies the whole method or a purchase.
export function bookAnnualEpsEvidence(row = {}, { date, now = Date.now() } = {}) {
  const applicability = instrumentApplicability(row);
  const today = newYorkDate(now);
  const priceExpiry = bookAnnualPriceExpiry(date);
  // The admitted provider histories have no independently bound market. This
  // first overlay is only for the existing US research universe.
  const identity = typeof row.symbol === 'string' && row.symbol.trim() && row.market === 'US';
  const scope = row.financial_identity?.observed_scope;
  const scopeMatches = scope == null || (typeof scope === 'object' && !Array.isArray(scope) && [['symbol', row.symbol], ['market', row.market], ['as_of_date', date]].every(([key, value]) => !Object.hasOwn(scope, key) || scope[key] === value));
  const containedIdentity = (!Object.hasOwn(row.technical_audit || {}, 'symbol') || row.technical_audit.symbol === row.symbol) &&
    (!Object.hasOwn(row.financial_history || {}, 'market') || row.financial_history.market === row.market);
  const dateMatches = (row.as_of_date ?? row.technical_audit?.as_of_date) === date && (!row.technical_audit?.as_of_date || row.technical_audit.as_of_date === date);
  const priceCurrent = Boolean(today && validEvidenceDay(date) && date <= today && priceExpiry > now);
  const context = identity && containedIdentity && scopeMatches && dateMatches && priceCurrent && applicability.status === 'unverified';
  const history = currentFinancialHistory(context ? row.financial_history : null, row.symbol, date, now, row);
  const comparable = history.annualComparisons.length === 3;
  const points = comparable ? history.annual.slice(-4).map(({ end, eps }) => ({ end, eps: finite(eps) ? eps : null })) : [];
  const comparisons = comparable ? history.annualComparisons.map(item => ({ ...item,
    state: finite(item.growth) ? item.growth > 0 ? 'pass' : 'fail' : 'unknown',
  })) : [];
  const annualIncreaseState = comparisons.length === 3 ? aggregate(comparisons.map(item => item.state)) : 'unknown';
  const positive = points.length === 4 && points.every(point => finite(point.eps) && point.eps > 0);
  const calculated = positive ? ((points[3].eps / points[0].eps) ** (1 / 3) - 1) * 100 : null;
  const cagr = finite(calculated) ? calculated : null;
  // Compare the unrounded ratio to the exact 1.25^3 boundary. Presentation
  // rounding cannot promote a value below 25%.
  const cagrState = cagr === null ? 'unknown' : points[3].eps / points[0].eps >= 1.25 ** 3 ? 'pass' : 'fail';
  const comparisonState = applicability.status === 'not_applicable' ? 'not_applicable' : aggregate([annualIncreaseState, cagrState]);
  const unknownReasons = [];
  if (!identity || !containedIdentity || !scopeMatches || !dateMatches || applicability.status === 'quarantined') unknownReasons.push('identity_mismatch');
  if (!priceCurrent) unknownReasons.push('price_date_not_current');
  if (!history.annual.length) unknownReasons.push('annual_source_not_current_or_untrusted');
  if (!comparable) unknownReasons.push('four_consecutive_comparable_periods_required');
  for (const item of comparisons) if (item.reason) unknownReasons.push(item.reason);
  if (comparable && !positive) unknownReasons.push('four_positive_eps_required_for_cagr');
  const raw = comparable ? row.financial_history : null;
  const observedAt = raw?.annual_source?.observed_at || raw?.retrieved_at || null;
  const sourceExpiry = evidenceTimestamp(observedAt) + 72 * 3600000 + 1;
  const validUntilExclusive = comparable && validClock(sourceExpiry) && priceExpiry ? Math.min(sourceExpiry, priceExpiry) : null;
  return {
    id: BOOK_ANNUAL_EPS_ID, version: BOOK_ANNUAL_EPS_VERSION, symbol: row.symbol || null, market: row.market || null,
    comparisonState, annualIncreaseState, cagrState, points, comparisons, cagr,
    unknownReasons: [...new Set(unknownReasons)], source: BOOK_ANNUAL_EPS_SOURCE,
    basis: raw?.basis || null, currency: raw?.annual_currency || raw?.currency || null,
    provider: raw?.source || null, observedAt, validUntilExclusive, priceDate: date || null,
    evaluatedAt: validClock(now) ? now : null, receiptSha256: raw?.annual_source?.receipt_sha256 || null,
    rawPayloadSha256: raw?.annual_source?.raw_payload_sha256 || null, captureId: raw?.annual_source?.capture_id || null,
    financialSemantics: 'current_at_evaluation_not_historical_publication',
    reviewStatus: 'manual_required', completeMethodStatus: 'not_evaluated',
  };
}

export function bookAnnualEvidenceText(evidence) {
  const reasons = { identity_mismatch:'銘柄・市場・基準日の不整合', price_date_not_current:'価格基準日の鮮度不足', annual_source_not_current_or_untrusted:'年次出典または72時間鮮度が未確認', four_consecutive_comparable_periods_required:'連続4期の比較可能な年次データが不足', missing_annual_eps:'EPSの欠損', nonpositive_comparison_base:'ゼロ・赤字基準年で比較不可', invalid_annual_growth:'年次増益率を計算不可', four_positive_eps_required_for_cagr:'CAGRに必要な4つの正のEPSが不足' };
  const value = number => finite(number) ? number.toFixed(2) : '未確認';
  const points = evidence.points.map(point => `${point.end} ${value(point.eps)}`).join(' → ');
  const rates = evidence.comparisons.map(item => `${item.from} → ${item.to}: ${value(item.growth)}%（${item.state === 'unknown' ? '未確認' : item.state === 'pass' ? '増益' : '未達'}）`).join(' / ');
  return `${points ? `報告希薄化EPS：${points}（${evidence.currency}）。各年の前年比 ${rates}。` : '出典・鮮度・連続4期・比較可能な年次EPSが未確認。'}3年CAGR＝(終点EPS / 起点EPS)^(1/3) − 1：${value(evidence.cagr)}%。${evidence.provider ? `提供元 ${evidence.provider}。取得 ${evidence.observedAt}、有効期限（未満）${new Date(evidence.validUntilExclusive).toISOString()}。` : ''}${evidence.unknownReasons.length ? `未確認の要素：${evidence.unknownReasons.map(reason => reasons[reason] || reason).join(' / ')}。` : ''}`;
}
