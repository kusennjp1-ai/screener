const SUMMARY_SCHEMA = 'workbench-summary-v1';
const IDENTITY_FIELDS = ['as_of', 'snapshot_id', 'generated_at', 'published_at', 'rule_version', 'universe_version', 'source_research_sha256', 'universe_members_sha256'];
const REF_FIELDS = ['path', 'sha256', 'snapshot_id', 'as_of_date'];

// Preserve the published counts verbatim. Missing details are deliberately not
// represented by an empty list: they have not been fetched yet.
export function summarizeWorkbench(value, details = value.details) {
  const { changes, ...metadata } = value;
  return {
    ...metadata,
    summary_schema: SUMMARY_SCHEMA,
    ...(changes ? { changes: Object.fromEntries(Object.entries(changes).map(([method, result]) => [method, {
      counts: result.counts,
      item_count: Array.isArray(result.items) ? result.items.length : result.item_count,
    }])) } : {}),
    ...(details ? { details } : {}),
  };
}

export function validateWorkbenchIdentity(value, ref, asOf, researchPath) {
  if (!value || !ref?.snapshot_id || value.as_of !== asOf || value.snapshot_id !== ref.snapshot_id) throw Error('Snapshot identity mismatch');
  if (ref.as_of_date && ref.as_of_date !== asOf) throw Error('Workbench reference date mismatch');
  if (ref.source_research_sha256 && value.source_research_sha256 !== ref.source_research_sha256) throw Error('Workbench research generation mismatch');
  const researchHash = /research-index-([a-f0-9]{16})\.json$/.exec(researchPath || '')?.[1];
  if (researchHash && !value.source_research_sha256?.startsWith(researchHash)) throw Error('Workbench research generation mismatch');
  return value;
}

export function validateWorkbenchSummary(value, ref, detailsRef, asOf, researchPath, isSummaryAsset) {
  validateWorkbenchIdentity(value, ref, asOf, researchPath);
  if (!detailsRef?.path || !detailsRef.sha256 || detailsRef.snapshot_id !== value.snapshot_id) throw Error('Missing workbench details identity');
  if (isSummaryAsset) {
    if (value.summary_schema !== SUMMARY_SCHEMA || REF_FIELDS.some(key => value.details?.[key] !== detailsRef[key])) throw Error('Workbench summary details reference mismatch');
    if (Object.values(value.changes || {}).some(result => Object.hasOwn(result, 'items'))) throw Error('Workbench summary includes full details');
  }
  const summary = summarizeWorkbench(value, detailsRef);
  for (const result of Object.values(summary.changes || {})) {
    const counts = Object.values(result.counts || {});
    if (!counts.length || counts.some(count => !Number.isInteger(count) || count < 0) || !Number.isInteger(result.item_count) || counts.reduce((sum, count) => sum + count, 0) !== result.item_count) throw Error('Workbench summary count mismatch');
  }
  return summary;
}

export function validateWorkbenchDetails(value, summary) {
  validateWorkbenchIdentity(value, summary.details, summary.as_of);
  if (IDENTITY_FIELDS.some(key => value[key] !== summary[key])) throw Error('Workbench details generation mismatch');
  if (JSON.stringify(value.history) !== JSON.stringify(summary.history)) throw Error('Workbench details history mismatch');
  const methods = Object.keys(summary.changes || {});
  if (!methods.length || Object.keys(value.changes || {}).length !== methods.length) throw Error('Workbench details missing methods');
  for (const method of methods) {
    const expected = summary.changes[method], actual = value.changes[method];
    if (!Array.isArray(actual?.items) || actual.items.length !== expected.item_count) throw Error('Workbench details count mismatch');
    const counts = Object.fromEntries(Object.keys(expected.counts).map(state => [state, 0]));
    for (const item of actual.items) {
      if (!Object.hasOwn(counts, item.state) || !item.symbol || !Array.isArray(item.changes)) throw Error('Invalid workbench change item');
      counts[item.state]++;
    }
    if (Object.keys(actual.counts || {}).length !== Object.keys(counts).length || Object.keys(counts).some(state => counts[state] !== expected.counts[state] || counts[state] !== actual.counts[state])) throw Error('Workbench details count mismatch');
  }
  return value;
}
