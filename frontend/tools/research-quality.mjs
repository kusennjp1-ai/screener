import { bookAnnualEpsEvidence } from '../src/static/bookAnnualEpsEvidence.js';
import { mergeFinancialDetail } from '../src/static/financialCurrent.js';
import { researchPackets, createResearchReceiver } from '../src/static/researchWorkerPackets.js';
import { isDeepStrictEqual } from 'node:util';
import { decodeAssessment } from '../src/static/assessmentEncoding.js';
import { validClock } from '../src/static/evidenceTime.js';
import { assess, rankCandidates, researchCsv, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';
import { decodeResearchIndex, researchListRow, RESEARCH_METHODS, RESEARCH_TRANSPORT_VERSION } from '../src/static/researchTransport.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';

// A publication is an observation at its declared instant. Never infer that
// instant from generated_at (source capture) or the checker/browser clock.
export function researchEvaluation(index, reference) {
  const now = index.financial_evaluated_at;
  if (!validClock(now) || index.assessment_version !== RULE_SUMMARY_VERSION ||
      index.financial_semantics !== 'current_at_evaluation_not_historical_publication') throw Error('Missing or invalid research evaluation metadata');
  for (const key of ['financial_evaluated_at', 'financial_semantics', 'assessment_version']) {
    if (reference?.[key] !== index[key]) throw Error(`Research evaluation metadata mismatch: ${key}`);
  }
  return now;
}

// Inspect the actual serialized value, independently of runtime summary APIs.
// Runtime consumers must continue ignoring cached summaries and cached orders.
export function validatePublishedSummaries(rows, evaluatedAt) {
  if (!validClock(evaluatedAt)) throw Error('Invalid summary evaluation instant');
  for (const row of rows) {
    if (row.method_summary?.version !== RULE_SUMMARY_VERSION || row.method_summary.evaluated_at !== evaluatedAt) throw Error(`Rule summary evaluation mismatch: ${row.symbol}`);
    for (const method of RESEARCH_METHODS) {
      const { rules, ...expected } = assess(row, method, evaluatedAt);
      void rules;
      const serialized = decodeAssessment(row.method_summary[method]);
      if (!serialized || !isDeepStrictEqual(serialized, expected)) throw Error(`Rule summary mismatch: ${row.symbol}/${method}`);
    }
  }
}

// v2 can explicitly keep cached summaries only in canonical detail. The
// checker still validates those summaries and every current list/detail rule.
// Legacy bundles and bundles carrying list summaries retain the strict check.
export function validateResearchListSummaries(wire, rows, evaluatedAt) {
  if (wire.summary_storage === undefined) return validatePublishedSummaries(rows, evaluatedAt);
  if (wire.schema !== RESEARCH_TRANSPORT_VERSION || wire.summary_storage !== 'canonical-detail-v1' ||
      !validClock(evaluatedAt) || rows.some(row => Object.hasOwn(row, 'method_summary'))) throw Error('Invalid research summary storage');
}

// The caller supplies one clock for every surface in this comparison. A later
// current-time check can legitimately expire evidence without altering the
// immutable published summaries checked above.
export function validateResearchParity(wire, canonicalRows, now) {
  if (!validClock(now)) throw Error('Invalid parity evaluation instant');
  const index = decodeResearchIndex(wire);
  const canonical = new Map(canonicalRows.map(row => [row.symbol, row]));
  if (canonical.size !== canonicalRows.length || canonical.size !== index.rows.length) throw Error('Canonical detail universe differs');
  const prepared = prepareResearchBundle([wire], index.as_of_date, { now });
  const receive = createResearchReceiver();
  let delivered;
  for (const packet of researchPackets(prepared)) delivered = receive(structuredClone(packet));
  for (const row of index.rows) {
    const detail = canonical.get(row.symbol);
    if (!detail || detail.as_of_date !== index.as_of_date) throw Error(`Detail identity mismatch ${row.symbol}`);
    const expectedAnnual = bookAnnualEpsEvidence(detail, { date:index.as_of_date, now });
    const position = delivered.rows.findIndex(item => item.symbol === row.symbol);
    for (const candidate of [row, researchListRow(detail), delivered.rows[position], mergeFinancialDetail(row,detail,{now,asOfDate:index.as_of_date})]) {
      if (!isDeepStrictEqual(bookAnnualEpsEvidence(candidate, { date:index.as_of_date, now }), expectedAnnual)) throw Error(`Canonical annual EPS excerpt mismatch: ${row.symbol}`);
    }
    if (delivered.annual_eps.states[position] !== expectedAnnual.comparisonState) throw Error(`Worker annual EPS excerpt mismatch: ${row.symbol}`);
    for (const method of RESEARCH_METHODS) {
      if (researchCsv([{row}],method,index.as_of_date,now,{annualEpsOnly:true}) !== researchCsv([{row:detail}],method,index.as_of_date,now,{annualEpsOnly:true})) throw Error(`Canonical annual EPS CSV mismatch: ${row.symbol}/${method}`);
      if (!isDeepStrictEqual(assess(row, method, now), assess(detail, method, now))) throw Error(`Canonical detail rule mismatch: ${row.symbol}/${method}`);
      if (researchCsv([{ row }], method, index.as_of_date, now) !== researchCsv([{ row: detail }], method, index.as_of_date, now)) throw Error(`Canonical CSV mismatch: ${row.symbol}/${method}`);
    }
  }
  for (const method of RESEARCH_METHODS) {
    const ranked = rows => rankCandidates(rows, method, { now });
    const contract = items => items.map(({ row, assessment }) => ({ symbol: row.symbol, assessment }));
    const expected = contract(ranked(canonicalRows));
    if (!isDeepStrictEqual(contract(ranked(index.rows)), expected) || !isDeepStrictEqual(contract(prepared.rankings[method]), expected)) throw Error(`Canonical ranking differs: ${method}`);
  }
  const planContract = rows => {
    const plan = buildPortfolioPlan(rows, index.as_of_date, 100000, now);
    return { positions: plan.positions, dailyPositions: plan.dailyPositions, candidateCount: plan.candidateCount,
      invested: plan.invested, cash: plan.cash, exposure: plan.exposure, risk: plan.risk,
      readiness: plan.readiness.map(item => ({ symbol: item.symbol, passed: item.passed, ready: item.ready, states: item.rules.map(rule => [rule.id, rule.state]) })) };
  };
  if (!isDeepStrictEqual(planContract(index.rows), planContract(canonicalRows))) throw Error('Compact research changes order plan or entry readiness');
}
