import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract, validateCorrectionReceipt } from './financial-correction.mjs';
import { validateReceipt } from './publication-state.mjs';
import { parsePreviewRequest, verifyCandidateTree, validatePreviewReceipt, verifyRecordedSource, verifyPartialPreviewCycle, PREVIEW_SCHEMA } from './financial-candidate-preview.mjs';
import { applyPendingCorrectionHold, readPendingCorrection, parsePendingCorrection, HOLD_PATH } from './pending-financial-correction.mjs';

const H = 'a'.repeat(64), S = 'b'.repeat(40), T = 'c'.repeat(40), repository = 'kusennjp1-ai/screener';
const source = () => ({ repository, workflow: contract.source_workflow, head_sha: S, run_id: 12, run_attempt: 2,
  artifact_id: 99, artifact_name: `financial-statement-recovery-${S}-2`, artifact_sha256: H, archive_manifest_sha256: H, acquisition_base_sha256: H, cohort_sha256: H });
const correction = () => ({ schema_version: contract.schema_version, kind: contract.kind, reason: contract.reason, previous_publication_identity: `1/1/${H}/${H}`, source: source() });
const request = () => ({ schema_version: PREVIEW_SCHEMA, kind: 'unpublished_financial_candidate', source_policy: 'successful_capture', candidate_ui: { sha: S, tree: T }, correction: correction() });
const hold = () => ({ schema_version: 'pending-financial-correction-v1', status: 'pending', reason: 'review_corrected_candidate_before_ui_promotion', candidate_ui: { sha: S, tree: T }, correction: correction() });
const receipt = () => ({ schema_version: PREVIEW_SCHEMA, kind: 'unpublished_financial_candidate', publication_authority: 'none',
  verification_basis: 'local_bytes_and_recorded_remote_evidence_requires_live_revalidation', candidate_ui: { sha: S, tree: T, digest: H }, controller: { sha: S, tree: T },
  previous_publication: { identity: correction().previous_publication_identity, ui_sha: S, ui_digest: H, artifact_id: 88, artifact_sha256: H, data_inventory_sha256: H, price_observations_sha256: H },
  source: source(), source_outcome: { policy: 'successful_capture', run: { id: 12, attempt: 2, status: 'completed', conclusion: 'success' },
    job: { id: 5, attempt: 2, status: 'completed', conclusion: 'success', failed_steps: [] }, reported_batch: null, reported_cycle: null,
    recomputed: { symbols: 1, selected_receipts: 1, field_reason_counts: { missing_evidence: 16 } } },
  source_evidence_sha256: H, financial: { generation: H, projection_sha256: H, receipt_inventory_sha256: H,
    evaluated_at: '2026-10-04T13:00:00.000Z', knowledge_basis: contract.knowledge_basis, point_in_time: false, source_publication_date: null },
  bundles: { baseline_data_sha256: H, corrected_data_sha256: H }, verification_sha256: H });

test('preview inputs are closed and distinct from publication authority', () => {
  assert.deepEqual(parsePreviewRequest(request()), request());
  assert.deepEqual(validatePreviewReceipt(receipt()), receipt());
  assert.throws(() => validateReceipt(receipt()));
  assert.throws(() => validateCorrectionReceipt(receipt()));
  for (const change of [v => v.allow_publish = true, v => v.candidate_ui.tree = 'main', v => v.backup_success = true, v => v.correction.source.run_attempt = 0]) {
    const value = request(); change(value); assert.throws(() => parsePreviewRequest(value));
  }
  for (const change of [v => v.publication_authority = 'approved', v => v.financial.point_in_time = true,
    v => v.financial.source_publication_date = '2026-10-02', v => v.financial.success = true,
    v => v.previous_publication.backup_success = true, v => v.bundles.corrected_data_sha256 = 'latest']) {
    const value = receipt(); change(value); assert.throws(() => validatePreviewReceipt(value));
  }
});

test('candidate is pinned to an existing full commit and exact tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'candidate-git-'));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git(['init']); writeFileSync(join(root, 'file'), 'candidate'); git(['add', 'file']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Candidate']);
    const pinned = { sha: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
    assert.deepEqual(verifyCandidateTree(root, pinned), pinned);
    assert.throws(() => verifyCandidateTree(root, { ...pinned, tree: S }));
    assert.throws(() => verifyCandidateTree(root, { ...pinned, sha: S }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('recorded evidence uses exact outer attempt; nested provenance is not consulted', () => {
  const evidence = { run: { id: 12, run_attempt: 2, repository: { full_name: repository }, head_repository: { full_name: repository },
    head_sha: S, path: contract.source_workflow, head_branch: 'improve/mandatory-financial-source-recovery', event: 'push', status: 'completed', conclusion: 'success' },
  jobs: [{ id: 5, name: contract.source_job, run_attempt: 2, conclusion: 'success', started_at: '2026-10-04T12:00:00Z', completed_at: '2026-10-04T12:30:00Z' }],
  artifacts: [{ id: 99, name: source().artifact_name, expired: false, digest: `sha256:${H}`, workflow_run: { id: 12, head_sha: S }, size_in_bytes: 100, created_at: '2026-10-04T12:29:00Z' }] };
  assert.equal(verifyRecordedSource(source(), evidence).job.run_attempt, 2);
  evidence.run.run_attempt = 1;
  assert.throws(() => verifyRecordedSource(source(), evidence));
});

test('explicit terminal-partial preview preserves failure without weakening successful-source policy', () => {
  const evidence = { run: { id: 12, run_attempt: 2, repository: { full_name: repository }, head_repository: { full_name: repository },
    head_sha: S, path: contract.source_workflow, head_branch: 'improve/mandatory-financial-source-recovery', event: 'push', status: 'completed', conclusion: 'failure' },
  jobs: [{ id: 5, name: contract.source_job, run_attempt: 2, status: 'completed', conclusion: 'failure',
    steps: [{ number: 8, name: 'Continue one bounded source batch from original receipts', conclusion: 'failure' }],
    started_at: '2026-10-04T12:00:00Z', completed_at: '2026-10-04T12:30:00Z' }],
  artifacts: [{ id: 99, name: source().artifact_name, expired: false, digest: `sha256:${H}`, workflow_run: { id: 12, head_sha: S }, size_in_bytes: 100, created_at: '2026-10-04T12:29:00Z' }] };
  assert.throws(() => verifyRecordedSource(source(), evidence));
  const original = structuredClone(evidence);
  assert.equal(verifyRecordedSource(source(), evidence, 'terminal_partial_receipts').job.id, 5);
  assert.deepEqual(evidence, original);
  for (const change of [v => v.run.status = 'in_progress', v => v.run.conclusion = 'cancelled', v => v.run.run_attempt = 1,
    v => v.jobs[0].steps[0].name = 'Checkout', v => v.jobs[0].conclusion = 'success', v => v.artifacts[0].expired = true,
    v => v.artifacts[0].created_at = '2026-10-04T11:59:00Z', v => v.artifacts.push(v.artifacts[0])]) {
    const modified = structuredClone(original); change(modified); assert.throws(() => verifyRecordedSource(source(), modified, 'terminal_partial_receipts'));
  }
  const partial = receipt(); partial.source_outcome.policy = 'terminal_partial_receipts';
  partial.source_outcome.run.conclusion = 'failure'; partial.source_outcome.job.conclusion = 'failure';
  partial.source_outcome.job.failed_steps = original.jobs[0].steps;
  partial.source_outcome.reported_batch = { sha256: H, exit_code: 3, provider_stop: null, execution_stop: null, counts: { failed_attributes: 4 } };
  partial.source_outcome.reported_cycle = { sha256: H, phase: 'completed', exit_code: 3, archive_manifest_sha256: H, base_artifact_sha256: H,
    code_revision: S, provider_state_before: 'available', published: false, retained_receipts: 2, retained_symbols: 1 };
  validatePreviewReceipt(partial);
  assert.throws(() => validateReceipt(partial)); assert.throws(() => validateCorrectionReceipt(partial));
  partial.source_outcome.run.conclusion = 'success'; assert.throws(() => validatePreviewReceipt(partial));
});

test('partial preview rejects a merge or final-verification crash after an exit-3 batch', () => {
  const root = mkdtempSync(join(tmpdir(), 'partial-cycle-'));
  const cycle = { schema_version: 'financial-recovery-cycle-v1', phase: 'completed', exit_code: 3, dry_run: false, published: false,
    code_revision: S, archive_manifest_sha256: H, base_artifact_sha256: H, provider_state_before: 'available', retained_receipts: 2, retained_symbols: 1 };
  try {
    mkdirSync(join(root, 'batch')); writeFileSync(join(root, 'batch/summary.json'), JSON.stringify({ base_artifact_sha256: H, exit_code: 3, capture_completion_is_source_availability: false }));
    writeFileSync(join(root, 'cycle.json'), JSON.stringify(cycle)); assert.equal(verifyPartialPreviewCycle(source(), root).phase, 'completed');
    for (const [key, value] of [['phase', 'archive_merge'], ['exit_code', 1], ['published', true], ['code_revision', T], ['archive_manifest_sha256', 'c'.repeat(64)], ['base_artifact_sha256', 'd'.repeat(64)]]) {
      writeFileSync(join(root, 'cycle.json'), JSON.stringify({ ...cycle, [key]: value })); assert.throws(() => verifyPartialPreviewCycle(source(), root));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pending correction always holds all new UI and never grants approval', () => {
  const ui = { publish: true, mode: 'ui', approval: { sha: T }, reason: 'Exact gates passed' };
  for (const value of [{ active: true, record: hold() }, { active: true, invalid: true }, { active: true, record: { candidate_ui: { sha: 'removed' } } }]) {
    const decision = applyPendingCorrectionHold(ui, value);
    assert.equal(decision.mode, 'data'); assert.equal(decision.pendingFinancialCorrection, true); assert.equal(decision.approval, undefined);
  }
  for (const decision of [{ publish: true, mode: 'data' }, { publish: false }, { publish: true, mode: 'data', migration: true }, { publish: true, mode: 'design' }]) {
    assert.deepEqual(applyPendingCorrectionHold(decision, { active: true }), decision);
  }
  assert.deepEqual(applyPendingCorrectionHold(ui, null), ui);
});

test('present malformed hold or broken symlink remains active; absent is ordinary behavior', () => {
  const root = mkdtempSync(join(tmpdir(), 'candidate-hold-')), path = join(root, HOLD_PATH);
  try {
    assert.equal(readPendingCorrection(root), null); mkdirSync(join(root, '.github'));
    for (const value of ['{', JSON.stringify({ status: 'cleared' }), JSON.stringify({ ...hold(), candidate_ui: { sha: 'removed' } })]) {
      writeFileSync(path, value); assert.deepEqual(readPendingCorrection(root), { active: true, invalid: true });
    }
    writeFileSync(path, JSON.stringify(hold())); assert.equal(readPendingCorrection(root).active, true);
    assert.deepEqual(parsePendingCorrection(hold()), hold());
    rmSync(path); symlinkSync(join(root, 'nonexistent'), path); assert.deepEqual(readPendingCorrection(root), { active: true, invalid: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
