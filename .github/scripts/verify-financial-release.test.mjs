import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertExpectedPublication, buildVerificationReport, expectedPublication, maxReportBytes, readSourceTiming, serializeReport } from './verify-financial-release.mjs';
import releaseRequest from '../financial-release-request.json' with { type: 'json' };

const expected = expectedPublication;
const hash = 'a'.repeat(64);
const source = releaseRequest.correction.source;
const sourceTiming = () => ({ ...source, run_started_at: '2026-10-04T10:00:00.000Z', artifact_created_at: '2026-10-04T10:05:00.000Z' });

// Pure assertion/report fixtures only. The real CI entry point always calls the
// existing livePublication() with its default API/fetch implementation.
function publication() {
  return {
    latest: { runId: expected.run_id, attempt: expected.run_attempt, headSha: expected.controller_sha,
      started: Date.parse('2026-10-06T13:00:00Z'), completed: Date.parse('2026-10-06T13:01:00Z') },
    receipt: { ...expected, financial_release: { schema_version: 'financial-release-receipt-v1', path: `static-data/financial-corrections/release-${hash}.json`, sha256: hash },
      transport: { schema_version: 'test', root: { path: `static-data/root-${hash}.json`, sha256: hash, bytes: 100, generation: hash } },
      financial_audit_files: { [`static-data/financial-corrections/release-${hash}.json`]: hash },
      data_source: { run_id: 2, attempt: 1, artifact_id: 3 } },
    financialRelease: { mode: 'activation', financial_generation: hash, lineage_sha256: hash, evaluated_at: '2026-10-04T10:10:00Z',
      lineage: { source: structuredClone(source), certificate: releaseRequest.source_validation.certificate, receipt_inventory_sha256: hash },
      source_projection: { path: `static-data/financial-corrections/source-projection-${hash}.json`, sha256: hash },
      evaluation_projection: { path: `static-data/financial-corrections/source-projection-${hash}.json`, sha256: hash }, price_input: { artifact_id: 3 } },
    uiSha: expected.ui_sha, uiDigest: expected.ui_digest, uiFiles: { 'index.html': hash, 'sw.js': hash },
    identity: `${expected.run_id}/1/${hash}/${hash}`, receiptHash: hash, manifestHash: hash,
    manifest: { generated_at: '2026-10-06T12:00:00Z', as_of_date: '2026-10-05', markets: { US: { as_of_date: '2026-10-05', freshness: { prices_generated_at: '2026-10-06T12:00:00Z' } } } },
    priceObservations: { '["US","chart","AAPL"]': '2026-10-05', '["US","chart","MSFT"]': '2026-10-02' },
    knownPriceDates: { '["US","chart","AAPL"]': '2026-10-05', '["US","chart","MSFT"]': '2026-10-02' },
    approval: { type: 'test', controller_sha: 'b'.repeat(40), certificate: { run_id: 4 } },
  };
}

test('exact deployed run, attempt, controller and captured UI pass', () => {
  const live = publication();
  assert.equal(assertExpectedPublication(live), live);
});

for (const [name, mutate] of [
  ['deployment run', live => live.latest.runId++],
  ['deployment attempt', live => live.latest.attempt++],
  ['deployment controller', live => live.latest.headSha = 'f'.repeat(40)],
  ['receipt run', live => live.receipt.run_id++],
  ['receipt attempt', live => live.receipt.run_attempt++],
  ['receipt controller', live => live.receipt.controller_sha = 'f'.repeat(40)],
  ['UI SHA', live => live.uiSha = 'f'.repeat(40)],
  ['UI digest', live => live.uiDigest = 'f'.repeat(64)],
  ['receipt UI SHA', live => live.receipt.ui_sha = 'f'.repeat(40)],
  ['receipt UI digest', live => live.receipt.ui_digest = 'f'.repeat(64)],
  ['financial release mode', live => live.financialRelease.mode = 'carry'],
]) {
  test(`rejects unexpected ${name}`, () => {
    const live = publication(); mutate(live);
    assert.throws(() => assertExpectedPublication(live), error => error.message === `Unexpected financial release: ${name}`);
  });
}

test('missing receipt, financial release, or packed transport fails closed', () => {
  for (const mutate of [live => delete live.receipt, live => delete live.financialRelease,
    live => delete live.receipt.financial_release, live => delete live.receipt.transport]) {
    const live = publication(); mutate(live);
    assert.throws(() => assertExpectedPublication(live));
  }
});

test('report separates acquisition, evaluation, generation and actual price dates', () => {
  const report = buildVerificationReport(publication(), sourceTiming(), '2026-10-06T14:00:00Z');
  assert.equal(report.financial.source.artifact_created_at, '2026-10-04T10:05:00.000Z');
  assert.equal(report.financial.evaluated_at, '2026-10-04T10:10:00.000Z');
  assert.equal(report.data.generated_at, '2026-10-06T12:00:00.000Z');
  assert.deepEqual(report.data.actual_price_observations.markets, [{ market: 'US', series_count: 2,
    earliest_observed_date: '2026-10-02', latest_observed_date: '2026-10-05' }]);
  assert.equal(report.ui.verified_file_count, 2);
  assert.ok(Buffer.byteLength(serializeReport(report)) < maxReportBytes);
});

test('report excludes unselected payloads, UI inventories and private metadata', () => {
  const live = publication(), timing = sourceTiming();
  const marker = 'DO_NOT_EXPORT_PRIVATE_METADATA';
  for (const object of [live, live.receipt, live.manifest, live.financialRelease, live.financialRelease.lineage.source, live.approval, live.receipt.transport.root, timing]) object.private_metadata = marker;
  live.huge_payload = marker.repeat(100000);
  const bytes = serializeReport(buildVerificationReport(live, timing));
  assert.ok(!bytes.includes(marker));
  assert.ok(!bytes.includes('"ui_files"'));
  assert.ok(!bytes.includes('"AAPL"'));
});

test('report rejects source clock evidence from another source', () => {
  const timing = sourceTiming(); timing.run_attempt++;
  assert.throws(() => buildVerificationReport(publication(), timing), /Source timing does not describe/);
});

test('report byte limit fails closed rather than truncating evidence', () => {
  assert.throws(() => serializeReport({ payload: 'x'.repeat(maxReportBytes) }), /32 KiB/);
});

function clockEvidence() {
  const run = { id: source.run_id, run_attempt: source.run_attempt, head_sha: source.head_sha, path: source.workflow,
    repository: { full_name: source.repository }, head_repository: { full_name: source.repository }, run_started_at: '2026-10-04T10:00:00Z' };
  const artifact = { id: source.artifact_id, name: source.artifact_name, digest: `sha256:${source.artifact_sha256}`,
    workflow_run: { id: source.run_id, head_sha: source.head_sha }, created_at: '2026-10-04T10:05:00Z' };
  const endpoints = [];
  return { run, artifact, endpoints, api: endpoint => {
    endpoints.push(endpoint);
    if (endpoint === `repos/${source.repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`) return run;
    if (endpoint === `repos/${source.repository}/actions/artifacts/${source.artifact_id}`) return artifact;
    throw Error('Unexpected metadata read');
  } };
}

test('source clocks use only exact read-only run/artifact metadata', () => {
  const evidence = clockEvidence();
  const timing = readSourceTiming(source, evidence.api);
  assert.equal(timing.artifact_created_at, '2026-10-04T10:05:00.000Z');
  assert.equal(evidence.endpoints.length, 2);
});

test('source clock identity or missing clocks cannot be substituted', () => {
  for (const mutate of [value => value.run.run_attempt++, value => value.artifact.workflow_run.id++,
    value => value.artifact.digest = `sha256:${hash}`, value => delete value.artifact.created_at]) {
    const evidence = clockEvidence(); mutate(evidence);
    assert.throws(() => readSourceTiming(source, evidence.api));
  }
});

test('production entry invokes the unmodified strict verifier with defaults', () => {
  const script = readFileSync(new URL('./verify-financial-release.mjs', import.meta.url), 'utf8');
  assert.match(script, /const live = await livePublication\(\);/);
  assert.ok(script.indexOf('const sourceTiming = readSourceTiming(') < script.indexOf('const live = await livePublication();'));
  assert.doesNotMatch(script, /NODE_OPTIONS|downloadTo|fetcher:|fetch\s*\(/);
});
