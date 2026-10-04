import { evidenceTimestamp, validClock } from './evidenceTime.js';
import nativeContract from '../../contracts/native_annual_history_v1.json' with { type: 'json' };

const finite = n => typeof n === 'number' && Number.isFinite(n);
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const ANNUAL_REPORTED_LIMITATION = '株式単位・株式分割・ADRの調整は提供元の報告に依存し、独立検証していません（USD履歴も同じ基準）。';
export const NATIVE_ANNUAL_SCHEMA = nativeContract.history_schema;

// This validates the destination's explicit source contract. Original receipt
// replay/cryptographic binding is performed before publication by the exporter.
// Legacy profile-based currency metadata cannot opt into this contract alone.
export function nativeAnnualHistoryContract(data, symbol) {
  const proof = data?.annual_source;
  const observed = evidenceTimestamp(proof?.observed_at), quarter = evidenceTimestamp(data?.quarterly_retrieved_at);
  return data?.schema_version === NATIVE_ANNUAL_SCHEMA && proof &&
    Object.keys(proof).sort().join('|') === ['symbol','metric','currency','unit','share_basis','attribute','receipt_sha256','capture_id','raw_payload_sha256','observed_at'].sort().join('|') && proof.symbol === symbol &&
    Array.isArray(data.annual) && data.annual.every(point => point && Object.keys(point).every(key => ['end','eps','revenue','netIncome'].includes(key))) &&
    proof.attribute === 'income_stmt' && proof.metric === nativeContract.provider_metric &&
    proof.unit === nativeContract.unit && proof.share_basis === nativeContract.share_basis &&
    nativeContract.supported_currencies.includes(data.currency) && data.annual_currency === data.currency && proof.currency === data.currency &&
    data.quarterly_currency === 'USD' && digest(proof.receipt_sha256) && digest(proof.raw_payload_sha256) &&
    typeof proof.capture_id === 'string' && proof.capture_id.trim().length > 0 && finite(observed) &&
    (data.quarterly_retrieved_at === null || finite(quarter)) &&
    evidenceTimestamp(data.retrieved_at) === Math.min(observed, finite(quarter) ? quarter : Infinity);
}

export function financialHistoryDeadlines(data) {
  return (data?.schema_version === NATIVE_ANNUAL_SCHEMA
    ? [data.annual_source?.observed_at, data.quarterly_retrieved_at] : [data?.retrieved_at])
    .map(evidenceTimestamp).filter(finite).map(time => time + 72 * 3600000);
}

// Current research only. This fallback never populates dated SEC/book evidence.
export function financialHistory(data, symbol, date, now = Date.now()) {
  const result = { valid: false, annualComplete: null, annualGrowth: null, annualComparisons: [], epsYoY: null, salesYoY: null, annual: [], quarterly: [] };
  const native = data?.schema_version === NATIVE_ANNUAL_SCHEMA;
  const fresh = value => { const age = validClock(now) ? now - evidenceTimestamp(value) : NaN; return finite(age) && age >= -5000 && age <= 72 * 3600000; };
  if (!data || data.symbol !== symbol || data.as_of_date !== date || !validDay(date) ||
      data.status !== 'available' || data.basis !== 'reported_diluted_eps' ||
      (native ? !nativeAnnualHistoryContract(data, symbol) : data.schema_version !== undefined || data.currency !== 'USD' || !fresh(data.retrieved_at))) return result;
  const clean = values => Array.isArray(values) && values.every((p, i) => p && validDay(p.end) && p.end <= date && (!i || p.end > values[i-1].end)) ? values : [];
  result.annual = !native || fresh(data.annual_source.observed_at) ? clean(data.annual) : [];
  result.quarterly = !native || fresh(data.quarterly_retrieved_at) ? clean(data.quarterly) : [];
  result.valid = result.annual.length > 0 || result.quarterly.length > 0;
  const annual = result.annual.slice(-4);
  const annualPeriodsValid = annual.length === 4 && days(date, annual[3].end) <= 550 &&
      annual.slice(1).every((p,i) => days(p.end,annual[i].end) >= 345 && days(p.end,annual[i].end) <= 385);
  result.annualComplete = annualPeriodsValid && annual.every(p => finite(p.eps)) ? true : null;
  // Partial comparisons need the entire dated four-period window. Never skip a
  // missing year, fill a null cell, or derive a rate from a nonpositive baseline.
  // Legacy USD histories cannot establish a different per-cell source/basis or
  // currency; ambiguous extensions may not authorize a new partial failure.
  const unambiguousAnnual = native || (data.annual_currency === undefined || data.annual_currency === 'USD') &&
      data.annual_source === undefined && annual.every(p => Object.keys(p).every(key => ['end','eps','revenue','netIncome'].includes(key)));
  if (annualPeriodsValid && unambiguousAnnual) result.annualComparisons = annual.slice(1).map((point, i) => {
    const previous = annual[i];
    const reason = !finite(previous.eps) || !finite(point.eps) ? 'missing_annual_eps' : previous.eps <= 0 ? 'nonpositive_comparison_base' : null;
    const growth = reason ? null : (point.eps / previous.eps - 1) * 100;
    return { from: previous.end, to: point.end, previous: previous.eps, latest: point.eps,
      growth: finite(growth) ? growth : null, reason: reason || (finite(growth) ? null : 'invalid_annual_growth') };
  });
  if (result.annualComplete && annual.slice(0,3).every(p => p.eps > 0)) {
    const growth = annual.slice(1).map((p,i) => (p.eps / annual[i].eps - 1) * 100);
    result.annualGrowth = growth.every(finite) ? growth : null;
  }
  const latest = result.quarterly.at(-1);
  const previous = latest ? result.quarterly.filter(p => days(latest.end,p.end) >= 345 && days(latest.end,p.end) <= 385) : [];
  if (latest && days(date,latest.end) <= 190 && previous.length === 1) {
    for (const [metric, output] of [['eps','epsYoY'],['revenue','salesYoY']]) {
      if (finite(latest[metric]) && finite(previous[0][metric]) && previous[0][metric] > 0) result[output] = (latest[metric] / previous[0][metric] - 1) * 100;
    }
  }
  return result;
}

// Shared wording preserves the unresolved comparisons beside any known rates.
export function annualComparisonText(comparison) {
  const result = finite(comparison.growth) ? `${comparison.growth.toFixed(2).replace(/^-/, '−')}%` :
    comparison.reason === 'nonpositive_comparison_base' ? '通常の成長率は比較不可（ゼロ／赤字基準年）' : comparison.reason === 'invalid_annual_growth' ? '年次成長率を計算できません' : 'EPS欠損・未確認';
  return `${comparison.from} → ${comparison.to}: ${result}`;
}
export function annualAvailabilityText(report) {
  return report.annualComplete ? '年次EPS履歴：連続4期取得済み' : '年次EPS履歴：不完全（4期不足・欠損・期間不整合など）';
}
