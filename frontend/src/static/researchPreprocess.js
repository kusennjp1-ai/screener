import { decodeResearchIndex, RESEARCH_METHODS } from './researchTransport.js';
import { mergeScanRows } from './qualificationAudit.js';
import { assessmentSummary, rankCandidates, RULE_SUMMARY_VERSION } from './researchEngine.js';
import { preparePortfolioRows } from './portfolioPlan.js';
import { decodeAssessment } from './assessmentEncoding.js';

export function prepareResearchBundle(payloads, expectedDate) {
  const decoded = payloads.map(decodeResearchIndex);
  const date = decoded[0]?.as_of_date;
  if (!date || (expectedDate && date !== expectedDate)) throw Error('Snapshot date mismatch');
  const rows = mergeScanRows(decoded, date);
  const orders = decoded[0]?.orders;
  const eligible = rows.filter(row => row.market === 'US' || !row.market);
  const rankings = Object.fromEntries(RESEARCH_METHODS.map(method => {
    if (!orders) return [method, rankCandidates(rows, method)];
    const indices = orders[method];
    if (!Array.isArray(indices) || indices.length !== eligible.length || new Set(indices).size !== indices.length || indices.some(id => !Number.isInteger(id) || !rows[id] || (rows[id].market && rows[id].market !== 'US'))) throw Error('Invalid published ranking');
    // Published order belongs to the published rule version, just like its
    // scores. Old or invalidated summaries require a fresh order too.
    if (eligible.some(row => row.method_summary?.version !== RULE_SUMMARY_VERSION || !decodeAssessment(row.method_summary[method]))) return [method, rankCandidates(rows, method)];
    return [method, indices.map(id => ({ row: rows[id], assessment: assessmentSummary(rows[id], method) }))];
  }));
  return { rows, date, rankings, prepared: preparePortfolioRows(rows) };
}
