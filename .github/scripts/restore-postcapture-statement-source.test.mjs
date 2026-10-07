// Reconstructed adapter guard fixtures. No provider, GitHub or artifact fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateRestorationPolicy, validateBaselineProof, verifyRestoredPostcaptureSource} from './restore-postcapture-statement-source.mjs';
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const policy = read('../../contracts/financial_source_postcapture_restore_v1.json');
const request = read('../../contracts/financial_source_postcapture_request_v1.json');
const entry = read('./fixtures/postcapture-restore-review.fixture.json');
const enabled = () => ({...structuredClone(policy), restore_enabled: true, reviewed_requests: [structuredClone(entry)]});
const paths = {sourceZipPath: '/missing-source', sourceDirectory: '/missing-files', certificateZipPath: '/missing-companion'};
const baseline = () => ({schema_version: 'financial-source-postcapture-baseline-v1', kind: 'postcapture_validated_baseline',
  source: structuredClone(request.source), companion_reference: structuredClone(policy.companion_reference),
  producer_execution: {failed_step_number: 10, original_final_guard_result: 'failed', original_outcomes_retained: true,
    producer_batch_exit_code: 0, producer_cycle_exit_code: 0, producer_job_conclusion: 'failure',
    producer_job_id: request.producer_job_id, producer_run_conclusion: 'failure'},
  captured_inventory_sha256: request.captured_inventory.sha256, retained_archive_counts: structuredClone(request.refresh.archive_counts),
  github_success_independently_authenticated: false, publication_authority: 'none', provider_work_authorized: false});

test('new policy remains disabled and fixture serializes only the already-admitted A review', () => {
  assert.equal(policy.restore_enabled, false);
  assert.deepEqual(policy.reviewed_requests, []);
  assert.deepEqual(validateRestorationPolicy(enabled()), entry);
});
test('default denies before reading source or consulting API even with env switches', () => {
  process.env.RESTORE_ENABLED = 'true'; process.env.EXECUTION_ENABLED = 'true';
  try {
    assert.throws(() => verifyRestoredPostcaptureSource(paths, {api() {throw Error('API called');}, baselineVerifier() {throw Error('Reader called');}}), /disabled or not independently admitted/);
  } finally {delete process.env.RESTORE_ENABLED; delete process.env.EXECUTION_ENABLED;}
});
for (const [name, change] of [
  ['truthy enable', p => {p.restore_enabled = 1;}], ['empty review', p => {p.reviewed_requests = [];}],
  ['duplicate review', p => p.reviewed_requests.push(entry)], ['new tree', p => {p.reviewed_requests[0].tree_sha = 'f'.repeat(40);}],
  ['new source', p => {p.source.run_id++;}], ['new companion', p => {p.companion_reference.job_id++;}],
  ['larger member budget', p => {p.maximum_source_members++;}], ['extra authority', p => {p.publication = true;}],
]) test(`restore policy rejects ${name}`, () => {const p = enabled(); change(p); assert.throws(() => validateRestorationPolicy(p));});
test('synthetic baseline structure retains explicit false authority and original failure', () => {
  assert.deepEqual(validateBaselineProof(baseline()), baseline());
});
for (const [name, change] of [
  ['producer success', b => {b.producer_execution.producer_run_conclusion = 'success';}],
  ['job success', b => {b.producer_execution.producer_job_conclusion = 'success';}],
  ['unearned GitHub success', b => {b.github_success_independently_authenticated = true;}],
  ['provider authorization', b => {b.provider_work_authorized = true;}], ['publication authority', b => {b.publication_authority = 'publish';}],
  ['wrong source', b => {b.source.run_attempt++;}], ['wrong companion', b => {b.companion_reference.receipt_sha256 = '0'.repeat(64);}],
  ['lost attempts', b => {b.retained_archive_counts.attempts--;}], ['lost objects', b => {b.retained_archive_counts.objects--;}],
  ['ordinary source', b => {b.kind = 'recovery_archive';}], ['extra field', b => {b.override = true;}],
]) test(`baseline proof rejects ${name} before API calls`, () => {
  const b = baseline(); change(b);
  assert.throws(() => verifyRestoredPostcaptureSource(paths, {policy: enabled(), baselineVerifier: () => b, api() {throw Error('API called');}}), /baseline|Baseline/);
});
test('enabled direct fixture routes first through exact local baseline verification', () => {
  assert.throws(() => verifyRestoredPostcaptureSource(paths, {policy: enabled(), baselineVerifier: () => {throw Error('local proof absent');}, api() {throw Error('API called');}}), /local proof absent/);
});
test('first API path is finite companion attempt and cannot fall back after failure', () => {
  const seen = [];
  assert.throws(() => verifyRestoredPostcaptureSource(paths, {policy: enabled(), baselineVerifier: baseline, api(endpoint) {
    seen.push(endpoint); throw Error('synthetic unavailable API');
  }}), /synthetic unavailable API/);
  assert.deepEqual(seen, [`repos/${policy.source.repository}/actions/runs/${policy.companion_reference.run_id}/attempts/1`]);
});
test('path and dependency input are closed', () => {
  assert.throws(() => verifyRestoredPostcaptureSource({...paths, trustOverride: true}), /closed/);
  assert.throws(() => verifyRestoredPostcaptureSource(paths, {override: true}), /Unknown/);
});
test('CLI offers no policy or verifier override', () => {
  const script = fileURLToPath(new URL('./restore-postcapture-statement-source.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script, 'source', 'files', 'companion', '--enable'], {stdio: 'pipe', timeout: 10000}), /Usage:/);
  assert.throws(() => execFileSync(process.execPath, [script, 'source', 'files', 'companion'], {stdio: 'pipe', timeout: 10000}), /disabled or not independently admitted/);
});
