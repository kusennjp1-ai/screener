// Read-only, one-release check. Never invokes a publisher, provider, or replay.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bootstrap, livePublication } from './publication-state.mjs';
import { githubApi, sameRepository } from './publication-gate.mjs';
import { priceObservationDigest } from './price-observations.mjs';
import releaseRequest from '../financial-release-request.json' with { type: 'json' };

export const expectedPublication = Object.freeze({
  run_id: 37456692717,
  run_attempt: 1,
  controller_sha: '8a490df5b0a873637781a8e4e5351cece9313f37',
  ui_sha: '1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',
  ui_digest: '72fd791b42a691e286279cada721207a812d13b13233e814d0c2cfde73571788',
});
export const maxReportBytes = 32 * 1024;
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const referenceKeys = ['repository', 'workflow', 'head_sha', 'run_id', 'run_attempt', 'job_id', 'artifact_id', 'artifact_sha256', 'certificate_sha256'];
const timestamp = value => {
  if (value == null) return null;
  if (!Number.isFinite(typeof value === 'number' ? value : Date.parse(value))) throw Error('Invalid report timestamp');
  return new Date(value).toISOString();
};

// This only narrows the result of the unmodified strict verifier. It cannot
// authorize an otherwise invalid publication, UI, approval, or deployment.
export function assertExpectedPublication(live) {
  const expected = expectedPublication;
  for (const [label, observed, required] of [
    ['deployment run', live?.latest?.runId, expected.run_id],
    ['deployment attempt', live?.latest?.attempt, expected.run_attempt],
    ['deployment controller', live?.latest?.headSha, expected.controller_sha],
    ['receipt run', live?.receipt?.run_id, expected.run_id],
    ['receipt attempt', live?.receipt?.run_attempt, expected.run_attempt],
    ['receipt controller', live?.receipt?.controller_sha, expected.controller_sha],
    ['UI SHA', live?.uiSha, expected.ui_sha],
    ['UI digest', live?.uiDigest, expected.ui_digest],
    ['receipt UI SHA', live?.receipt?.ui_sha, expected.ui_sha],
    ['receipt UI digest', live?.receipt?.ui_digest, expected.ui_digest],
    ['financial release mode', live?.financialRelease?.mode, 'activation'],
  ]) {
    if (observed !== required) throw Error(`Unexpected financial release: ${label}`);
  }
  if (!live.receipt.financial_release || !live.receipt.transport) throw Error('Expected packed financial release is missing');
  return live;
}

// GitHub source clocks are provenance, not issuer publication dates or evidence
// that the deployed prices/statements are newly observed. Read metadata only.
export function readSourceTiming(source, api = githubApi) {
  if (source.repository !== bootstrap.repository) throw Error('Unexpected financial source repository');
  const run = api(`repos/${source.repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`);
  const artifact = api(`repos/${source.repository}/actions/artifacts/${source.artifact_id}`);
  if (run.id !== source.run_id || run.run_attempt !== source.run_attempt || run.head_sha !== source.head_sha
    || run.path !== source.workflow || !sameRepository(run, source.repository)
    || artifact.id !== source.artifact_id || artifact.name !== source.artifact_name
    || artifact.workflow_run?.id !== source.run_id || artifact.workflow_run?.head_sha !== source.head_sha
    || artifact.digest !== `sha256:${source.artifact_sha256}`) throw Error('Financial source clock identity mismatch');
  if (!run.run_started_at || !artifact.created_at) throw Error('Financial source clock is missing');
  return {
    ...pick(source, referenceKeys),
    run_started_at: timestamp(run.run_started_at),
    artifact_created_at: timestamp(artifact.created_at),
  };
}

function priceSummary(observations) {
  const markets = new Map();
  for (const [key, date] of Object.entries(observations)) {
    const [market] = JSON.parse(key);
    const current = markets.get(market) || { market, series_count: 0, earliest_observed_date: date, latest_observed_date: date };
    current.series_count++;
    if (date < current.earliest_observed_date) current.earliest_observed_date = date;
    if (date > current.latest_observed_date) current.latest_observed_date = date;
    markets.set(market, current);
  }
  if (markets.size > 32) throw Error('Too many markets for bounded verification report');
  return { sha256: priceObservationDigest(observations), series_count: Object.keys(observations).length,
    markets: [...markets.values()].sort((a, b) => a.market.localeCompare(b.market)) };
}

export function buildVerificationReport(live, sourceTiming, verifiedAt = new Date().toISOString()) {
  assertExpectedPublication(live);
  const financial = live.financialRelease;
  for (const key of referenceKeys) {
    if (sourceTiming[key] !== financial.lineage.source[key]) throw Error('Source timing does not describe the deployed financial source');
  }
  const markets = Object.entries(live.manifest.markets);
  if (markets.length > 32) throw Error('Too many markets for bounded verification report');
  return {
    schema_version: 'financial-live-verification-v1',
    verified_at: timestamp(verifiedAt),
    repository: bootstrap.repository,
    site_url: bootstrap.site_url,
    expected: expectedPublication,
    publication: { identity: live.identity, receipt_sha256: live.receiptHash,
      controller_sha: live.receipt.controller_sha, run_id: live.latest.runId, run_attempt: live.latest.attempt,
      deployment_started_at: timestamp(live.latest.started), deployment_completed_at: timestamp(live.latest.completed) },
    ui: { sha: live.uiSha, digest: live.uiDigest, verified_file_count: Object.keys(live.uiFiles).length },
    data: { manifest_sha256: live.manifestHash, generated_at: timestamp(live.manifest.generated_at), as_of_date: live.manifest.as_of_date,
      source: pick(live.receipt.data_source, ['run_id', 'attempt', 'artifact_id']),
      markets: markets.map(([market, entry]) => ({ market, as_of_date: entry.as_of_date,
        freshness: pick(entry.freshness, ['scan_as_of_date', 'breadth_latest_date', 'groups_latest_date', 'scan_published_at', 'prices_generated_at']) })),
      actual_price_observations: priceSummary(live.priceObservations),
      retained_known_price_dates: priceSummary(live.knownPriceDates) },
    financial: { mode: financial.mode, generation: financial.financial_generation, lineage_sha256: financial.lineage_sha256,
      evaluated_at: timestamp(financial.evaluated_at), source: pick(sourceTiming, [...referenceKeys, 'run_started_at', 'artifact_created_at']),
      source_clock_meaning: 'GitHub acquisition run/artifact times; not issuer publication dates or price observation dates',
      certificate: pick(financial.lineage.certificate, referenceKeys),
      release: pick(live.receipt.financial_release, ['schema_version', 'path', 'sha256']),
      source_projection: pick(financial.source_projection, ['path', 'sha256']),
      evaluation_projection: pick(financial.evaluation_projection, ['path', 'sha256']),
      receipt_inventory_sha256: financial.lineage.receipt_inventory_sha256,
      price_input: pick(financial.price_input, ['artifact_id', 'artifact_sha256', 'manifest_sha256', 'price_observations_sha256', 'known_price_dates_sha256']) },
    approval: { ...pick(live.approval, ['type', 'sha', 'ui_digest', 'controller_sha', 'approval_sha256']),
      certificate: pick(live.approval.certificate, referenceKeys) },
    transport: { ...pick(live.receipt.transport, ['schema_version']),
      root: pick(live.receipt.transport.root, ['path', 'sha256', 'bytes', 'generation']),
      financial_audit_files_count: Object.keys(live.receipt.financial_audit_files || {}).length },
  };
}

export function serializeReport(report) {
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > maxReportBytes) throw Error('Verification report exceeds its 32 KiB limit');
  return bytes;
}

async function main() {
  if (process.argv.length !== 3) throw Error('Usage: node verify-financial-release.mjs REPORT_PATH');
  // Auxiliary clock reads precede livePublication's final stable reread.
  const sourceTiming = readSourceTiming(releaseRequest.correction.source);
  const live = await livePublication();
  const report = buildVerificationReport(live, sourceTiming);
  const bytes = serializeReport(report);
  writeFileSync(process.argv[2], bytes, { flag: 'wx' });
  process.stdout.write(bytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
