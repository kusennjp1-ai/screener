import { decodeResearchIndex, RESEARCH_METHODS } from './researchTransport.js';
import { mergeScanRows } from './qualificationAudit.js';
import { rankCandidates, RULE_SUMMARY_VERSION } from './researchEngine.js';
import { preparePortfolioRows } from './portfolioPlan.js';
import { financialNextExpiry, projectFinancialRow } from './financialCurrent.js';
import { validClock, validEvidenceDay } from './evidenceTime.js';
import { priceTraceForRow } from './priceTrace.js';

export function prepareResearchBundle(payloads, expectedDate, { now = Date.now(), generation = null, evaluationEpoch = 0 } = {}) {
  if (!validClock(now) || !Number.isSafeInteger(evaluationEpoch) || evaluationEpoch < 0) throw Error('Invalid research evaluation');
  const decoded = payloads.map(decodeResearchIndex);
  const date = decoded[0]?.as_of_date;
  if (!validEvidenceDay(date) || (expectedDate != null && date !== expectedDate)) throw Error('Snapshot date mismatch');
  const priceTraces = decoded[0].price_traces;
  if (decoded.some(payload => payload.price_traces && payload.price_traces.root !== priceTraces?.root)) throw Error('Mixed price trace generations');
  const rows = mergeScanRows(decoded, date).map(row => {
    const current = projectFinancialRow(row, { now, asOfDate: date });
    return { ...current, priceTrace: priceTraceForRow(current, priceTraces, date) };
  });
  // Never accept a cached assessment/order independently of its current inputs.
  // This work runs once per publication or evidence expiry in the data worker.
  const rankings = Object.fromEntries(RESEARCH_METHODS.map(method => [method, rankCandidates(rows, method, { now })]));
  // rankCandidates projects defensively; share the same final row objects in
  // packets and portfolio preparation to preserve references across delivery.
  const bySymbol = new Map(rows.map(row => [row.symbol, row]));
  for (const ranked of Object.values(rankings)) for (const item of ranked) {
    item.row = bySymbol.get(item.row.symbol);
    const {rules,...summary}=item.assessment; void rules; item.assessment=summary;
  }
  const metadata = { evaluated_at: now, next_expiry_at: financialNextExpiry(rows, now), generation, evaluation_epoch: evaluationEpoch, assessment_version: RULE_SUMMARY_VERSION };
  return { rows, date, rankings, prepared: preparePortfolioRows(rows, now), ...(priceTraces ? { price_traces: priceTraces } : {}), ...metadata };
}

// This metadata is produced by prepareResearchBundle after source validation,
// never copied from published input. Null means no remaining expiry; otherwise
// the deadline is the first invalid millisecond, strictly after evaluation.
export const validResearchEvaluation = bundle => Boolean(bundle && validEvidenceDay(bundle.date) && validClock(bundle.evaluated_at) &&
  Number.isSafeInteger(bundle.evaluation_epoch) && bundle.evaluation_epoch >= 0 &&
  bundle.assessment_version === RULE_SUMMARY_VERSION &&
  (bundle.next_expiry_at === null || (validClock(bundle.next_expiry_at) && bundle.next_expiry_at > bundle.evaluated_at)));

export const researchBundleCurrent = (bundle, now, generation = bundle?.generation) => Boolean(validResearchEvaluation(bundle) && validClock(now) &&
  bundle.evaluated_at <= now && bundle.generation === generation && (bundle.next_expiry_at === null || now < bundle.next_expiry_at));
