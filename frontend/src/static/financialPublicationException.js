import { projectFinancialRow, currentFinancialHistory } from './financialCurrent.js';
import { annualHistoryMetadataValid } from './financialHistory.js';
import { evidenceTimestamp, validClock, validEvidenceDay } from './evidenceTime.js';

// Explicitly approved availability exception, not financial qualification.
// It grants no source, price, performance, screenshot or publication authority.
export const FINANCIAL_PUBLICATION_EXCEPTION = Object.freeze({
  version: 'five-symbol-financial-unknown-v1',
  symbols: Object.freeze(['NVDA', 'FUTU', 'AAOI', 'ALH', 'AVT']),
  label: '財務未確認・判定対象外',
});
const symbols = new Set(FINANCIAL_PUBLICATION_EXCEPTION.symbols);
const fields = ['eps_growth_yy', 'sales_growth_yy'];
const absenceReasons = new Set(['missing_evidence', 'stale_source', 'stale_reporting_period']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const empty = value => value === null || value === undefined;
const sourceTime = value => {
  const parts = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return Boolean(parts && validEvidenceDay(parts[1]) && Number(parts[2]) <= 23 && Number(parts[3]) <= 59 &&
    Number(parts[4]) <= 59 && Number(parts[5] || 0) <= 23 && Number(parts[6] || 0) <= 59 && finite(evidenceTimestamp(value)));
};

// Only actual absence/expiry is eligible. A malformed/contradictory source is
// still an acceptance failure, even for one of these five named securities.
export function financialPublicationException(input, { date, now = Date.now() } = {}) {
  if (!symbols.has(input?.symbol)) return null; // No extra full-universe projection.
  date ??= input.as_of_date ?? input.technical_audit?.as_of_date;
  if (input.market !== 'US' || !validClock(now) || !validEvidenceDay(date) || date > new Date(now).toISOString().slice(0, 10) ||
      (input.as_of_date != null && input.as_of_date !== date) ||
      (input.technical_audit?.as_of_date != null && input.technical_audit.as_of_date !== date)) return null;
  const current = projectFinancialRow(input, { now, asOfDate: date });
  let missingScalar = false;
  for (const name of fields) {
    if (!empty(input[name]) && !finite(input[name])) return null;
    const state = current.financial_current_state?.fields[name];
    if (!state) return null;
    if (state.availability === 'unknown') {
      if (state.reason === 'nonpositive_comparison_base' && state.source_validated) continue;
      if (state.reason === 'missing_or_invalid_value') {
        if (!empty(input[name]) || !empty(current.financial_historical?.values?.[name])) return null;
      } else if (!absenceReasons.has(state.reason)) return null;
      missingScalar = true;
    }
  }
  const data = input.financial_history;
  let reason = 'missing_history';
  if (!empty(data)) {
    // The existing carry exporter has an explicit all-null unavailable shape.
    // Its lack of currency/basis is absence, unlike a contradictory HKD legacy
    // history or nonempty source cells marked unavailable.
    const unavailablePlaceholder = data.status === 'unavailable' && data.basis === 'current-observation' &&
      data.source === null && data.retrieved_at === null && data.currency === null &&
      empty(data.schema_version) && empty(data.annual_source) && empty(data.annual_currency) && empty(data.quarterly_currency) && empty(data.quarterly_retrieved_at) &&
      Array.isArray(data.annual) && !data.annual.length && (empty(data.quarterly) || (Array.isArray(data.quarterly) && !data.quarterly.length));
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.symbol !== input.symbol || data.as_of_date !== date ||
        (!unavailablePlaceholder && (data.basis !== 'reported_diluted_eps' || !['available', 'unavailable'].includes(data.status) ||
        !annualHistoryMetadataValid(data, input.symbol)))) return null;
    // Compact list transport deliberately omits quarterly history cells.
    for (const points of [data.annual, data.quarterly ?? []]) {
      if (!Array.isArray(points) || points.some((point, index) => !point || !validEvidenceDay(point.end) || point.end > date ||
          (index > 0 && point.end <= points[index - 1].end) || (!empty(point.eps) && !finite(point.eps)))) return null;
    }
    // Cadence contradictions are not an unavailable-history exemption.
    if (data.annual.slice(1).some((point, index) => {
      const gap = (Date.parse(point.end) - Date.parse(data.annual[index].end)) / 86400000;
      return gap < 345 || gap > 385;
    })) return null;
    for (const value of [data.retrieved_at, data.annual_source?.observed_at, data.quarterly_retrieved_at]) {
      if (!empty(value) && (!sourceTime(value) || evidenceTimestamp(value) > now + 5000)) return null;
    }
    if (data.status === 'unavailable') {
      if (data.annual.length || data.quarterly?.length) return null;
    } else {
      if (typeof data.source !== 'string' || !data.source.trim() || /^(unknown|unavailable|n\/a|未確認|未取得)$/i.test(data.source.trim()) ||
          !sourceTime(data.retrieved_at)) return null;
      const history = currentFinancialHistory(data, input.symbol, date, now, current);
      if (history.annualReason === 'inconsistent_annual_metadata') return null;
      if (history.valid && history.annualComplete && !missingScalar) return null;
      reason = !history.annual.length ? 'unavailable_or_expired_annual_history'
        : !history.annualComplete ? 'incomplete_annual_history' : 'missing_current_financial_evidence';
    }
  }
  return { policy: FINANCIAL_PUBLICATION_EXCEPTION.version, symbol: input.symbol, reason,
    status: 'excluded_unknown', label: FINANCIAL_PUBLICATION_EXCEPTION.label,
    qualified: false, satisfies_fresh_category: false };
}

export function isFinancialPublicationExclusion(value) {
  return value && Object.keys(value).sort().join('|') === ['policy','symbol','reason','status','label','qualified','satisfies_fresh_category'].sort().join('|') &&
    value.policy === FINANCIAL_PUBLICATION_EXCEPTION.version && symbols.has(value.symbol) &&
    ['missing_history','unavailable_or_expired_annual_history','incomplete_annual_history','missing_current_financial_evidence'].includes(value.reason) &&
    value.status === 'excluded_unknown' && value.label === FINANCIAL_PUBLICATION_EXCEPTION.label &&
    value.qualified === false && value.satisfies_fresh_category === false;
}
