// Offline release-candidate diagnostic. No provider calls or publication writes.
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { validateCorrectionProjection, overlayFinancialCorrection, overlayFinancialChart } from './financial-correction-overlay.mjs';
import { financialHistory } from '../src/static/financialHistory.js';
import { assess, rankCandidates, researchCsv } from '../src/static/researchEngine.js';
import { encodeResearchIndex, decodeResearchIndex } from '../src/static/researchTransport.js';
import { projectFinancialRow, mergeFinancialDetail } from '../src/static/financialCurrent.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../src/static/financialEvidencePresentation.js';
import { instrumentApplicability } from '../src/static/instrumentApplicability.js';
import { institutionalGrowth } from '../src/static/institutionalEvidence.js';
import { auditValues } from '../src/static/qualificationAudit.js';
import { filterStaticScanRows } from '../src/static/scanClient.js';
const [originalPath, currentPath, targetPath, inventoryPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw Error('Usage: original-projection current-projection target-base audit-inventory output-report');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const [original, current, target, inventory] = await Promise.all([originalPath, currentPath, targetPath, inventoryPath].map(read));
const equal = (a, b, message) => { if (!isDeepStrictEqual(a, b)) throw Error(message); };
validateCorrectionProjection(original); validateCorrectionProjection(current);
equal(current.derivation.source_projection_sha256, createHash('sha256').update(await readFile(originalPath)).digest('hex'), 'Legacy source file mismatch');
equal(current.receipt_inventory, original.receipt_inventory, 'Receipt inventory changed');
const now = Date.parse(current.financial_evaluated_at), date = target.as_of_date;
const before = target.rows.map(row => projectFinancialRow(overlayFinancialCorrection(row, original), { now }));
const after = target.rows.map(row => projectFinancialRow(overlayFinancialCorrection(row, current), { now }));
const changed = Object.keys(current.symbols).filter(symbol => !isDeepStrictEqual(current.symbols[symbol], original.symbols[symbol])).sort();
equal(changed, [...inventory.candidate_symbols].sort(), 'Unexpected recovered cohort');
const records = [], counts = { accepted_usd_unchanged: 0, native_complete: 0, native_comparable: 0, native_nonpositive: 0, excluded_unchanged: 0, annual_rule_pass: 0, annual_rule_fail: 0, annual_rule_unknown: 0 };
for (const [symbol, item] of Object.entries(current.symbols)) {
  const source = original.symbols[symbol];
  for (const key of ['financial_values', 'financial_current', 'financial_source_evidence', 'source_receipts', 'instrument_applicability', 'financial_identity']) equal(item[key], source[key], `${symbol}/${key} changed`);
  equal(item.financial_history.quarterly, source.financial_history.quarterly, `${symbol} quarterly changed`);
  const oldReport = financialHistory(source.financial_history, symbol, date, now), report = financialHistory(item.financial_history, symbol, date, now);
  equal(report.epsYoY, oldReport.epsYoY, `${symbol} quarterly EPS decision changed`);
  equal(report.salesYoY, oldReport.salesYoY, `${symbol} quarterly sales decision changed`);
  if (oldReport.annualComplete && source.financial_history.currency === 'USD') { equal(item.financial_history, source.financial_history, `${symbol} accepted USD changed`); counts.accepted_usd_unchanged++; }
  if (inventory.blocked_symbols.includes(symbol)) { equal(item, source, `${symbol} excluded case changed`); counts.excluded_unchanged++; }
  if (!changed.includes(symbol)) continue;
  if (!report.annualComplete) throw Error(`${symbol} native history incomplete`);
  const audited = inventory.rows.find(row => row.symbol === symbol);
  equal(report.annual.slice(-4).map(point => point.eps), audited.eps, `${symbol} native cell changed`);
  equal(report.annualGrowth, audited.arithmetic_rates_percent, `${symbol} exact native arithmetic changed`);
  counts.native_complete++; counts[report.annualGrowth ? 'native_comparable' : 'native_nonpositive']++;
  const annualRule = assess(after.find(row => row.symbol === symbol), 'oneil', now).rules[2];
  counts[`annual_rule_${annualRule.state}`]++;
  records.push({ symbol, currency: item.financial_history.currency, annual_rates: report.annualGrowth, annual_comparisons: annualRule.comparisons, annual_rule: annualRule.state });
}
equal(counts, { accepted_usd_unchanged: 1702, native_complete: 99, native_comparable: 81, native_nonpositive: 18, excluded_unchanged: 12, annual_rule_pass: 5, annual_rule_fail: 86, annual_rule_unknown: 8 }, 'Unexpected golden cohort counts');
const decoded = decodeResearchIndex(encodeResearchIndex({ as_of_date: date, rows: after })).rows;
for (const row of decoded.filter(row => changed.includes(row.symbol))) {
  const detail = after.find(value => value.symbol === row.symbol);
  const chart = overlayFinancialChart({ symbol: row.symbol, as_of_date: date, bars: [], stock_data: detail }, current).stock_data;
  for (const candidate of [row, mergeFinancialDetail(row, detail, { now, asOfDate: date }), chart]) {
    for (const method of ['minervini', 'minervini2', 'oneil', 'ibd']) equal(assess(candidate, method, now), assess(detail, method, now), `${row.symbol}/${method} cross-surface mismatch`);
    const evidence = buildFinancialEvidencePresentation(candidate, { method: 'oneil', date, generation: 'native-audit', now });
    const presentation = financialEvidencePresentation({ evidence, history: candidate.financial_history, symbol: row.symbol, date, generation: 'native-audit', method: 'oneil', now });
    equal(presentation.rows.find(value => value.id === 'annual_eps_growth_3y').state, assess(candidate, 'oneil', now).rules[2].state, `${row.symbol} presentation mismatch`);
  }
}
const methods = {};
const summary = (rows, method) => {
  const assessments = rows.map(row => assess(row, method, now));
  const annual = assessments.map(value => value.rules.find(rule => rule.label.includes('3年'))).filter(Boolean);
  return { qualified: assessments.filter(value => value.qualified).length, unknown_conditions: assessments.reduce((sum, value) => sum + value.unknown, 0), rows_with_unknown: assessments.filter(value => value.unknown > 0).length,
    annual: Object.fromEntries(['pass','fail','unknown'].map(state => [state, annual.filter(rule => rule.state === state).length])) };
};
for (const method of ['minervini','minervini2','oneil','ibd']) {
  const previous = summary(before, method), next = summary(after, method);
  methods[method] = { before: previous, after: next, qualified_delta: next.qualified - previous.qualified, unknown_condition_delta: next.unknown_conditions - previous.unknown_conditions };
  equal(researchCsv(rankCandidates(decoded, method, { now }), method, date, now), researchCsv(rankCandidates(after, method, { now }), method, date, now), `${method} CSV/order transport mismatch`);
}
for (const filter of [{ epsGrowthYy: { min: 25 } }, { epsGrowth: { min: 25 } }, { salesGrowth: { min: 25 } }]) {
  const matched = filterStaticScanRows(after, filter, { now }).map(row => row.symbol);
  if (!matched.length || matched.length === after.length) throw Error('Filter did not exercise a real subset');
  equal(filterStaticScanRows(decoded, filter, { now }).map(row => row.symbol), matched, 'Filter parity mismatch');
}

const cohort = new Set(Object.keys(current.symbols));
const pick = (value, keys) => value ? Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])) : null;
const ruleDistributions = rows => {
  const sums = [];
  for (const row of rows) assess(row, 'oneil', now).rules.forEach((rule, index) => {
    sums[index] ||= { rule: rule.label, pass: 0, fail: 0, unknown: 0, not_applicable: 0 };
    sums[index][rule.state]++;
  });
  return { rows: rows.length, rules: sums };
};
const ruleEvidence = (row, rule, index) => {
  const history = row.financial_history, values = auditValues(row);
  if ([0, 1].includes(index)) {
    const field = index === 0 ? 'eps_growth_yy' : 'sales_growth_yy';
    const state = row.financial_current_state.fields[field];
    const raw = row.financial_source_evidence?.fields?.[field];
    return { field, reason: state.reason, source: state.source ?? null, period_end: state.period_end ?? null, comparable_period_end: state.comparable_period_end ?? null,
      retained_receipt: current.symbols[row.symbol]?.source_receipts.find(receipt => receipt.attribute === 'quarterly_income_stmt') ?? null, source_diagnostic: row.financial_source_diagnostics?.fields?.[field] ?? null,
      ...pick(state, ['availability','source','metric','basis','unit','observed_at','valid_until','period_end','comparable_period_end','periods_used','comparison','source_validated']),
      retained_source: pick(raw, ['source','metric','basis','unit','observed_at','period_end','comparable_period_end','capture_id','raw_payload_sha256']) };
  }
  if (index === 2) {
    const report = financialHistory(history, row.symbol, date, now);
    return { reason: row.financial_history_source_diagnostics?.reasons?.annual ?? (!report.valid ? 'invalid_history' : !report.annualComplete ? 'incomplete_annual_history' : !report.annualGrowth ? 'nonpositive_comparison_base' : null),
      source: history?.source ?? null, reporting_currency: history?.annual_currency ?? history?.currency ?? null,
      observed_at: history?.annual_source?.observed_at ?? history?.retrieved_at ?? null, periods: report.annual.slice(-4), annual_rates: report.annualGrowth, annual_complete: report.annualComplete, annual_comparisons: report.annualComparisons };
  }
  if (index === 6) return { reason: institutionalGrowth(row.institutional_evidence, row.symbol, date).reason,
    source: pick(row.institutional_evidence, ['symbol','status','unit','publication_cutoff','source','reason']), observations: row.institutional_evidence?.observations ?? null };
  if (index === 7) return { reason: typeof row.market_above_50dma === 'boolean' && typeof row.market_above_200dma === 'boolean' ? null : 'missing_market_trend_boolean',
    source: 'published target market fields', period: date, market_above_50dma: row.market_above_50dma ?? null, market_above_200dma: row.market_above_200dma ?? null, market_regime: row.market_regime ?? null };
  if (index === 5) return { source: row.rs_method ?? null, period: row.rs_as_of_date ?? null, universe: row.rs_universe_size ?? null, raw_rating: row.rs_rating ?? null, reason: rule.state === 'unknown' ? 'unverified_rs_context' : null };
  return { source: 'verified daily bars', period: row.technical_audit?.as_of_date ?? null, errors: row.technical_audit?.errors ?? [],
    values: index === 3 ? { belowHigh: values.belowHigh ?? null } : { change: values.change ?? null, volumeRatio: values.volumeRatio ?? null }, reason: rule.state === 'unknown' ? 'missing_or_invalid_daily_price_evidence' : null };
};
const eligible = after.filter(row => cohort.has(row.symbol) && row.market === 'US' && row.currency === 'USD' && row.current_price >= 10 && row.adv_usd >= 20000000 && instrumentApplicability(row).status === 'unverified');
const ranked = rankCandidates(eligible, 'oneil', { now }).map(item => ({...item, assessment: assess(item.row, 'oneil', now)}));
const cleanUnknown = ranked.filter(item => item.assessment.failed === 0 && item.assessment.unknown > 0);
const candidates = (cleanUnknown.length ? cleanUnknown : ranked).slice(0, 10).map(({row, assessment}) => ({
  symbol: row.symbol, passed: assessment.passed, failed: assessment.failed, unknown: assessment.unknown, qualified: assessment.qualified,
  canonical_rank: ranked.findIndex(item => item.row.symbol === row.symbol) + 1,
  blockers: assessment.rules.flatMap((rule, index) => ['fail','unknown'].includes(rule.state) ? [{ index, rule: rule.label, state: rule.state, value: rule.value, ...ruleEvidence(row, rule, index), blocker_kind: rule.state === 'fail' ? 'measured_rule_failure' : (ruleEvidence(row, rule, index).reason === 'nonpositive_comparison_base' ? 'known_nonpositive_base_limitation' : 'missing_or_unusable_evidence') }] : []) }));
const reasonCounts = (rows, field) => Object.fromEntries([...new Set(rows.map(row => row.financial_current_state.fields[field].reason || 'current'))].sort().map(reason => [reason, rows.filter(row => (row.financial_current_state.fields[field].reason || 'current') === reason).length]));
const cohortRows = after.filter(row => cohort.has(row.symbol));
const oneil_diagnostic = { full_universe: ruleDistributions(after), intended_cohort: ruleDistributions(cohortRows),
  verified_price_cohort: ruleDistributions(cohortRows.filter(row => row.technical_audit?.valid && row.technical_audit?.as_of_date === date)),
  eligible_rows: eligible.length, zero_failed_only_unknown_count: cleanUnknown.length, verified_price_zero_failed_only_unknown_count: cleanUnknown.filter(item => item.row.technical_audit?.valid && item.row.technical_audit?.as_of_date === date).length,
  nearest_selection: cleanUnknown.length ? 'canonical_ranked_eligible_zero_failed_only_unknown' : 'canonical_ranked_eligible_with_failed_and_unknown_separately',
  nearest_candidates: candidates,
  cohort_scalar_reasons: { eps_growth_yy: reasonCounts(cohortRows, 'eps_growth_yy'), sales_growth_yy: reasonCounts(cohortRows, 'sales_growth_yy') },
  cohort_institutional_input_status: Object.fromEntries([...new Set(cohortRows.map(row => row.institutional_evidence?.status || 'absent'))].map(status => [status, cohortRows.filter(row => (row.institutional_evidence?.status || 'absent') === status).length])),
  cohort_market_inputs: Object.fromEntries([...new Set(cohortRows.map(row => JSON.stringify([row.market_above_50dma ?? null,row.market_above_200dma ?? null])))].map(key => [key, cohortRows.filter(row => JSON.stringify([row.market_above_50dma ?? null,row.market_above_200dma ?? null]) === key).length])) };
const report = { target_bindings: current.bindings, source_projection_sha256: current.derivation.source_projection_sha256, receipt_inventory_sha256: current.receipt_inventory_sha256, projection_policy: current.policy, evaluated_at: current.financial_evaluated_at, as_of_date: date, universe_rows: after.length, cohort_symbols: Object.keys(current.symbols).length, counts, methods, oneil_diagnostic, native_records: records, invariants: { scalar_proofs_and_values_unchanged: true, quarterly_results_unchanged: true, accepted_usd_histories_unchanged: true, original_receipt_inventory_unchanged: true, native_amounts_not_valuation_inputs: true, list_detail_chart_csv_filter_parity: true } };
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ counts, methods, output: outputPath }, null, 2));
