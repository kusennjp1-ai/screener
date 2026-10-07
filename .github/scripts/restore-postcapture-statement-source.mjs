// NEW reconstructed adapter. Verify existing local bytes; never download,
// extract, acquire provider data, publish, or relabel the failed producer.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {verifyPostcaptureCorrectionSource} from './verify-postcapture-correction-source.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../../contracts/${name}`, import.meta.url)));
const policy = read('financial_source_postcapture_restore_v1.json');
const request = read('financial_source_postcapture_request_v1.json');
const trust = read('financial_source_postcapture_trust_v1.json');
const fixedPolicy = {schema_version: 'financial-source-postcapture-restore-policy-v1', authority: 'retained_source_baseline_only',
  companion_zip_bytes: 4079616, maximum_source_zip_bytes: 134217728, maximum_source_expanded_bytes: 536870912,
  maximum_source_members: 30000, maximum_source_member_bytes: 33554432};
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const equal = (a, b) => canonical(a) === canonical(b);
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !equal(Object.keys(value).sort(), [...keys].sort())) throw Error(`Invalid closed ${label}`);
};

export function validateRestorationPolicy(value = policy) {
  exact(value, Object.keys(policy), 'restore policy');
  for (const [key, expected] of Object.entries(fixedPolicy)) if (value[key] !== expected) throw Error('Fixed restore scope or bounds changed');
  for (const key of Object.keys(policy)) if (!['restore_enabled', 'reviewed_requests'].includes(key) && !equal(value[key], policy[key])) throw Error('Exact restore policy/source/bounds changed');
  if (value.restore_enabled !== true || !Array.isArray(value.reviewed_requests) || value.reviewed_requests.length !== 1) throw Error('Postcapture restore disabled or not independently admitted');
  const matches = trust.reviewed_requests.filter(entry => equal(entry.reference, value.companion_reference));
  if (matches.length !== 1 || !equal(matches[0], value.reviewed_requests[0]) || !equal(matches[0].source, request.source) || !equal(value.source, request.source)) throw Error('Restore review differs from existing exact controller admission');
  return matches[0];
}

function python(script, arguments_, remaining) {
  return JSON.parse(execFileSync('python3', [fileURLToPath(new URL(script, import.meta.url)), ...arguments_],
    {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: Math.min(180000, remaining()), killSignal: 'SIGKILL'}));
}

export function validateBaselineProof(baseline, value = policy) {
  exact(baseline, ['schema_version', 'kind', 'source', 'companion_reference', 'producer_execution', 'captured_inventory_sha256',
    'retained_archive_counts', 'github_success_independently_authenticated', 'publication_authority', 'provider_work_authorized'], 'baseline proof');
  const execution = {failed_step_number: 10, original_final_guard_result: 'failed', original_outcomes_retained: true,
    producer_batch_exit_code: 0, producer_cycle_exit_code: 0, producer_job_conclusion: 'failure', producer_job_id: request.producer_job_id, producer_run_conclusion: 'failure'};
  if (baseline.schema_version !== 'financial-source-postcapture-baseline-v1' || baseline.kind !== 'postcapture_validated_baseline' ||
      !equal(baseline.source, request.source) || !equal(baseline.companion_reference, value.companion_reference) ||
      !equal(baseline.producer_execution, execution) || !equal(baseline.retained_archive_counts, request.refresh.archive_counts) ||
      baseline.captured_inventory_sha256 !== request.captured_inventory.sha256 || baseline.github_success_independently_authenticated !== false ||
      baseline.publication_authority !== 'none' || baseline.provider_work_authorized !== false) throw Error('Baseline proof authority/source/failed-producer mismatch');
  return baseline;
}

// Dependency injection is direct-call testing only; no CLI/env/file can select
// a verifier or API implementation. Production uses the existing A verifier.
export function verifyRestoredPostcaptureSource(paths, dependencies = {}) {
  exact(paths, ['sourceZipPath', 'sourceDirectory', 'certificateZipPath'], 'restored source paths');
  if (Object.values(paths).some(path => typeof path !== 'string' || !path)) throw Error('Missing restored source path');
  exact(dependencies, Object.keys(dependencies), 'direct-call dependencies');
  if (Object.keys(dependencies).some(key => !['policy', 'api', 'baselineVerifier', 'archiveVerifier'].includes(key))) throw Error('Unknown direct-call dependency');
  const selected = dependencies.policy ?? policy;
  const entry = validateRestorationPolicy(selected);
  const started = performance.now();
  const remaining = () => {
    const milliseconds = Math.floor(270000 - (performance.now() - started));
    if (milliseconds <= 0) throw Error('Typed source verification time bound exceeded');
    return milliseconds;
  };
  const baselineVerifier = dependencies.baselineVerifier ?? ((input) => python('./verify-postcapture-statement-baseline.py',
    [input.sourceZipPath, input.sourceDirectory, input.certificateZipPath], remaining));
  const baseline = validateBaselineProof(baselineVerifier(paths), selected);
  remaining();
  const reference = selected.companion_reference, repository = selected.source.repository;
  const allowed = new Set([selected.source, reference].flatMap(ref => {
    const base = `repos/${repository}/actions/runs/${ref.run_id}`;
    return [`${base}/attempts/${ref.run_attempt}`, `${base}/attempts/${ref.run_attempt}/jobs?per_page=100`, `${base}/artifacts?per_page=100`];
  }).concat([`repos/${repository}/git/commits/${reference.head_sha}`, `repos/${repository}/git/trees/${entry.tree_sha}?recursive=1`]));
  const called = new Set();
  const api = endpoint => {
    remaining();
    if (!allowed.has(endpoint) || called.has(endpoint) || called.size >= 8) throw Error('Exact GitHub verification call budget/path exceeded');
    called.add(endpoint);
    const result = dependencies.api ? dependencies.api(endpoint) : JSON.parse(execFileSync('gh', ['api', endpoint],
      {encoding: 'utf8', timeout: Math.min(15000, remaining()), killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024}));
    remaining();
    return result;
  };
  const archiveVerifier = dependencies.archiveVerifier ?? ((path, receipt) => python('./verify-postcapture-correction-archive.py', [path, receipt], remaining));
  const verified = verifyPostcaptureCorrectionSource(selected.source, {reference, certificateZipPath: paths.certificateZipPath},
    api, [entry], archiveVerifier);
  remaining();
  if (called.size !== 8 || verified.job.conclusion !== 'failure' || verified.certification.certifier_job.conclusion !== 'success' ||
      verified.certification.publication_authority !== 'none' || !equal(verified.certification.receipt.producer_execution, baseline.producer_execution)) throw Error('Independent companion/failed-producer verification is incomplete');
  const after = validateBaselineProof(baselineVerifier(paths), selected);
  remaining();
  if (!equal(after, baseline)) throw Error('Retained source changed during independent API verification');
  return {schema_version: 'financial-source-postcapture-restore-v1', kind: 'postcapture_validated_recovery',
    authority: 'retained_source_baseline_only', source: selected.source, companion: verified.certification,
    producer_job: verified.job, baseline, publication_authority: 'none', provider_work_authorized: false, published: false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) throw Error('Usage: restore-postcapture-statement-source.mjs SOURCE_ZIP SOURCE_DIRECTORY COMPANION_ZIP');
  const [sourceZipPath, sourceDirectory, certificateZipPath] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(verifyRestoredPostcaptureSource({sourceZipPath, sourceDirectory, certificateZipPath})) + '\n');
}
