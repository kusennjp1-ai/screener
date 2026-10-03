// Publication coverage only. These are the existing export-research eligibility
// limits; retaining an unknown name never makes it an eligible stock candidate.
export const minimumVerificationRatio = 0.9;
const number = value => typeof value === 'number' && Number.isFinite(value);
const symbolIsValid = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const priceMatches = (price, close) => number(close) && close > 0
  && Math.abs(price - close) <= Math.max(0.02, price * 0.0001);
const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});

export const isEligibleForPublication = row => number(row?.current_price) && row.current_price >= 10
  && number(row?.adv_usd) && row.adv_usd >= 20_000_000;

function observationProblems(row, asOfDate) {
  if (!row) return ['missing_row'];
  const reasons = [];
  if (!number(row.current_price) || row.current_price <= 0) reasons.push('missing_or_invalid_current_price');
  if (!number(row.adv_usd) || row.adv_usd < 0) reasons.push('missing_or_invalid_adv_usd');
  if (row.as_of_date != null && row.as_of_date !== asOfDate) reasons.push('stale_row');
  const audit = row.technical_audit;
  if (!audit || typeof audit !== 'object') reasons.push('missing_technical_audit');
  else {
    if (audit.valid !== true || !Array.isArray(audit.errors) || audit.errors.length) reasons.push('invalid_technical_audit');
    if (audit.as_of_date !== asOfDate) reasons.push('stale_technical_audit');
    if (audit.symbol !== row.symbol) reasons.push('audit_symbol_mismatch');
    if (!priceMatches(row.current_price, audit.values?.close)) reasons.push('audit_price_mismatch');
  }
  return reasons;
}

function exitObservationProblems(row, chart, asOfDate) {
  if (!chart || typeof chart !== 'object') return ['missing_chart'];
  const reasons = [];
  if (chart.symbol !== row.symbol) reasons.push('chart_symbol_mismatch');
  if (chart.as_of_date !== asOfDate) reasons.push('stale_chart');
  if (!Array.isArray(chart.bars) || !chart.bars.length) reasons.push('missing_bars');
  else {
    // The payload date is an export target, not evidence of an observation.
    const last = chart.bars.at(-1);
    if (last?.date !== asOfDate) reasons.push('stale_or_missing_latest_bar');
    if (!priceMatches(row.current_price, last?.close)) reasons.push('chart_price_mismatch');
  }
  return reasons;
}

function liquidityObservationProblems(chart, asOfDate) {
  const recent = chart.bars.slice(-50);
  if (recent.length < 50) return ['insufficient_liquidity_history'];
  if (recent.some((bar, i) => !validDay(bar?.date) || [0, 6].includes(new Date(bar.date).getUTCDay())
    || bar.date > asOfDate || (i > 0 && bar.date <= recent[i - 1].date)
    || !number(bar.close) || bar.close <= 0 || !number(bar.volume) || bar.volume < 0
    || !number(bar.close * bar.volume))) return ['invalid_liquidity_observations'];
  // Recalculation can fail before refreshing row.adv_usd. The price audit does
  // not establish its freshness, so prove a liquidity exit from the same last
  // 50 close*volume observations used by recalculate-setups.py.
  const observedAdv = recent.reduce((sum, bar) => sum + bar.close * bar.volume, 0) / 50;
  if (!number(observedAdv)) return ['invalid_liquidity_observations'];
  return observedAdv < 20_000_000 ? [] : ['observed_liquidity_not_below_minimum'];
}

const evidenceSummary = () => ({ total: 0, reasons: {}, examples: {} });
function record(summary, symbol, reasons) {
  summary.total++;
  for (const reason of new Set(reasons)) {
    summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
    const examples = summary.examples[reason] ||= [];
    if (examples.length < 10) examples.push(symbol);
  }
}

/**
 * Carry the last approved denominator through source failures. Supply canonical
 * current rows (including their full technical_audit), and chart payloads keyed
 * by symbol in a Map or object. Only potential exits need chart payloads.
 *
 * A previous symbol leaves only with complete, current, verified observations
 * proving an existing eligibility limit failed. Missing/delisted-looking rows
 * stay unknown: there is no trusted delisting evidence in this data contract.
 * Persist requiredSymbols after approval, including unresolved previous names.
 */
export function assessRetainedUniverse({ previousSymbols, rows, asOfDate, charts = {} } = {}) {
  const errors = [];
  const previous = new Set();
  if (!validDay(asOfDate)) errors.push('invalid_as_of_date');
  if (!Array.isArray(previousSymbols) && !(previousSymbols instanceof Set)) errors.push('invalid_previous_symbols');
  else for (const symbol of previousSymbols) {
    if (symbolIsValid(symbol)) previous.add(symbol);
    else if (!errors.includes('invalid_previous_symbol')) errors.push('invalid_previous_symbol');
  }
  const bySymbol = new Map(), fingerprints = new Map(), conflicts = new Set(), eligible = new Set();
  if (!Array.isArray(rows)) errors.push('invalid_rows');
  else for (const row of rows) {
    if (!row || !symbolIsValid(row.symbol)) {
      if (!errors.includes('invalid_row_symbol')) errors.push('invalid_row_symbol');
      continue;
    }
    if (isEligibleForPublication(row)) eligible.add(row.symbol);
    const fingerprint = canonical(row);
    if (bySymbol.has(row.symbol) && fingerprints.get(row.symbol) !== fingerprint) conflicts.add(row.symbol);
    else { bySymbol.set(row.symbol, row); fingerprints.set(row.symbol, fingerprint); }
  }
  if (conflicts.size) errors.push('conflicting_duplicate_rows');
  const validCharts = charts instanceof Map || (charts != null && typeof charts === 'object' && !Array.isArray(charts));
  if (!validCharts) errors.push('invalid_charts');
  const chartFor = symbol => charts instanceof Map ? charts.get(symbol)
    : validCharts && Object.hasOwn(charts, symbol) ? charts[symbol] : undefined;

  const required = new Set([...previous, ...eligible]);
  const exitedSymbols = [], missing = evidenceSummary(), exits = evidenceSummary();
  let verified = 0;
  for (const symbol of [...required].sort()) {
    const row = bySymbol.get(symbol);
    const reasons = observationProblems(row, asOfDate);
    if (!validDay(asOfDate)) reasons.push('invalid_as_of_date');
    if (conflicts.has(symbol)) reasons.push('conflicting_duplicate_rows');
    if (previous.has(symbol) && !eligible.has(symbol)) {
      // Callers may omit charts for rows already known to lack complete current
      // observations; do not report that intentional omission as missing data.
      if (!reasons.length) reasons.push(...exitObservationProblems(row, chartFor(symbol), asOfDate));
      if (!reasons.length) {
        const exitReasons = [];
        if (row.current_price < 10) {
          // The audit's price-identity tolerance must never move a name across
          // the eligibility boundary: prove the exit with the actual close.
          if (chartFor(symbol).bars.at(-1).close < 10) exitReasons.push('price_below_minimum');
          else reasons.push('observed_price_not_below_minimum');
        }
        if (row.adv_usd < 20_000_000) {
          const liquidityProblems = liquidityObservationProblems(chartFor(symbol), asOfDate);
          if (!liquidityProblems.length) exitReasons.push('liquidity_below_minimum');
          else if (!exitReasons.length) reasons.push(...liquidityProblems);
        }
        if (exitReasons.length) {
          required.delete(symbol);
          exitedSymbols.push(symbol);
          record(exits, symbol, exitReasons);
          continue;
        }
      }
    }
    if (!reasons.length && eligible.has(symbol)) verified++;
    else record(missing, symbol, reasons);
  }
  const requiredSymbols = [...required].sort();
  const total = requiredSymbols.length;
  const ratio = total > 0 ? verified / total : null;
  if (!total) errors.push('empty_required_universe');
  return {
    schema: 1, as_of_date: asOfDate, minimum_target: minimumVerificationRatio,
    previousSymbols: [...previous].sort(), requiredSymbols,
    enteredSymbols: [...eligible].filter(symbol => !previous.has(symbol)).sort(), exitedSymbols,
    total, verified, ratio, passed: errors.length === 0 && total > 0 && ratio >= minimumVerificationRatio,
    exits, missing, errors,
  };
}
