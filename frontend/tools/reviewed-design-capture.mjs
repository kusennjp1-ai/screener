// Historical capture verification only. No new data or publication authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assessHistoricalScreeningPriority, verifyRepresentationReport } from './screening-priority-acceptance.mjs';
import { parseFinancialCsv } from './financial-design-cases.mjs';
import { validateFunctionalEvidence } from './reviewed-design-functional-evidence.mjs';
import { assessScreeningImageReview } from './screening-priority-image-review.mjs';

export const CAPTURE_SCHEMA = 'reviewable-design-capture-v1';
export const REVIEW_PATH = 'docs/design-review/prior-capture-review.json';
export const REVIEW_RECORDS = [REVIEW_PATH, 'docs/design-review/prior-capture-review.md'];
export const REPOSITORY = 'kusennjp1-ai/screener';
export const WORKFLOW = '.github/workflows/design-acceptance.yml';
export const BASELINE = '1e1943e1d5f78a738a05baa69eb9f2e8508e32ac';
export const MAX_FILE = 64 * 1024 * 1024, MAX_PACKAGE = 256 * 1024 * 1024;
export const IMAGE_STEP = 'Require reviewed screenshots and four design scores of at least 8.0';
export const MEASURE_STEP = 'Measure all routes, screenshots, accessibility and CPU 4x';
export const PACKAGE_STEP = 'Stage immutable reviewable Design capture';
export const UPLOAD_STEP = 'Preserve immutable reviewable Design capture';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = object => JSON.stringify(object, null, 2) + '\n';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const clock = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const safePath = value => typeof value === 'string' && /^[A-Za-z0-9._/-]+$/.test(value)
  && !value.split('/').some(part => !part || part === '.' || part === '..');
const keys = (value, expected, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label + ' has missing/unknown fields');
};
export function regular(root, path, cap = MAX_FILE) {
  assert(safePath(path), 'Unsafe capture file path');
  let cursor = resolve(root);
  assert(lstatSync(cursor).isDirectory() && !lstatSync(cursor).isSymbolicLink(), 'Capture root must be a real directory');
  const parts = path.split('/');
  for (const part of parts.slice(0, -1)) { cursor = join(cursor, part); const stat = lstatSync(cursor); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Linked capture parent'); }
  const file = join(cursor, parts.at(-1)), stat = lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= cap, 'Missing, linked or oversized capture file');
  return readFileSync(file);
}
const json = (root, path) => JSON.parse(regular(root, path));
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// Exclusions are exact, designated review records, and only regular blobs.
// All renderer, config, workflow, verifier, dependency and contract files stay in.
export function materialSourceInventory(root, revision) {
  assert(commit(revision), 'Full source commit required');
  const records = git(root, 'ls-tree', '-r', '-z', revision).split('\0').filter(Boolean).map(record => {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
    assert(match, 'Unexpected Git tree record');
    return { mode: match[1], type: match[2], blob: match[3], path: match[4] };
  });
  assert(records.length > 0 && new Set(records.map(record => record.path)).size === records.length, 'Empty or duplicate source tree');
  for (const record of records.filter(record => REVIEW_RECORDS.includes(record.path))) assert(record.mode === '100644' && record.type === 'blob', 'Review record is not an ordinary regular blob');
  return records.filter(record => !REVIEW_RECORDS.includes(record.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export const materialSourceDigest = (root, revision) => hash(canonical(materialSourceInventory(root, revision)));

export function validateReference(reference) {
  keys(reference, ['schema', 'repository', 'workflow_path', 'run_id', 'run_attempt', 'head_sha', 'checkout_sha', 'source_inventory_sha256', 'configuration_sha256', 'artifact_id', 'artifact_sha256', 'artifact_bytes'], 'Capture reference');
  assert(reference.schema === 'reviewed-prior-capture-reference-v1' && reference.repository === REPOSITORY && reference.workflow_path === WORKFLOW, 'Unrecognized capture reference');
  assert([reference.run_id, reference.run_attempt, reference.artifact_id, reference.artifact_bytes].every(positive)
    && reference.artifact_bytes <= MAX_PACKAGE && commit(reference.head_sha) && reference.checkout_sha === reference.head_sha
    && sha(reference.source_inventory_sha256) && sha(reference.configuration_sha256) && sha(reference.artifact_sha256), 'Malformed capture pins');
  return reference;
}

export function readPriorReview(root, current) {
  assert(commit(current), 'Current source commit required');
  const listing = git(root, 'ls-tree', current, '--', REVIEW_PATH).trim();
  if (!listing) return null;
  assert(/^100644 blob [a-f0-9]{40}\t/.test(listing), 'Review record must be a regular Git blob');
  const bytes = regular(root, REVIEW_PATH, 8 * 1024 * 1024), recorded = execFileSync('git', ['-C', root, 'show', `${current}:${REVIEW_PATH}`], { maxBuffer: 8 * 1024 * 1024 });
  assert(bytes.equals(recorded), 'Review worktree bytes differ from committed review');
  const review = JSON.parse(bytes);
  assert(review.review_mode === 'reviewed-prior-capture-v1', 'Explicit prior-capture review mode required');
  const reference = validateReference(review.capture);
  assert(review.observed_commit === reference.checkout_sha
    && review.evidence_run === `https://github.com/${REPOSITORY}/actions/runs/${reference.run_id}/attempts/${reference.run_attempt}`, 'Review is not bound to exact captured commit/run/attempt');
  return { review, reference, review_sha256: hash(bytes), eligible: materialSourceDigest(root, current) === reference.source_inventory_sha256 };
}

// Source-aware downgrade boundary: legacy captures remain readable under their
// old material source, while a producer containing the adapter must retain v2.
export function requireRepresentationContract(sourceRoot, revision, completion) {
  if (git(sourceRoot, 'ls-tree', revision, '--', 'frontend/tools/baseline-representation.mjs').trim())
    assert(completion.schema === 'screening-priority-completion-v2', 'This material source requires the baseline representation capture contract');
}

// A missing report marker is legacy only when its authenticated producer source
// predates the opened-annotation measurement. Report fields cannot choose that
// downgrade themselves; the immutable Git blob determines the required contract.
export function requireAnnotationGeometryContract(sourceRoot, revision, report) {
  const path = 'frontend/tools/chart-design-cases.mjs';
  if (!git(sourceRoot, 'ls-tree', revision, '--', path).trim()) return;
  const producer = git(sourceRoot, 'show', `${revision}:${path}`);
  if (producer.includes('expanded_annotation_geometry_contract'))
    assert(report.expanded_annotation_geometry_contract === 'full-plot-v1', 'This material source requires the expanded annotation geometry capture contract');
  if (producer.includes('inline_warning_geometry_contract'))
    assert(report.inline_warning_geometry_contract === 'source-warning-v1', 'This material source requires the inline warning geometry capture contract');
}

export function verifyStoredMeasurement(root, now = Date.now()) {
  const reportBytes = regular(root, 'report.json'), assessmentBytes = regular(root, 'screening-priority-assessment.json');
  const report = JSON.parse(reportBytes), assessment = JSON.parse(assessmentBytes), completion = json(root, 'screening-priority-completion.json'), binding = completion.binding;
  keys(completion, ['schema', 'publication_authority', 'financial_admission', 'binding', 'completed_groups', 'carry_seal_sha256', 'completed_at', 'report_sha256', 'assessment_sha256', 'screenshots'], 'Completion');
  const representation = completion.schema === 'screening-priority-completion-v2';
  assert((representation || completion.schema === 'screening-priority-completion-v1') && completion.publication_authority === 'none' && completion.financial_admission === false, 'Completion cannot grant authority');
  assert(clock(report.measured_at) && clock(completion.completed_at) && Date.parse(report.measured_at) <= Date.parse(completion.completed_at) && Date.parse(completion.completed_at) <= now, 'Invalid historical measurement clock');
  assert(completion.report_sha256 === hash(reportBytes) && completion.assessment_sha256 === hash(assessmentBytes), 'Stored report/assessment changed');
  keys(binding, [...(representation ? ['baseline_representation_sha256'] : []), 'policy', 'scope', 'commit', 'tree', 'run_id', 'run_attempt', 'provenance_sha256', 'publication_sha256', 'manifest_sha256', 'ui_digest', 'logical_data_inventory_sha256', 'physical_inventory_sha256', 'current_inventory_sha256', 'baseline_inventory_sha256', 'as_of_date', 'research_generation'], 'Capture binding');
  assert(commit(binding.commit) && commit(binding.tree) && /^[1-9][0-9]*$/.test(binding.run_id) && /^[1-9][0-9]*$/.test(binding.run_attempt), 'Invalid captured source/run identity');
  for (const field of ['provenance_sha256', 'publication_sha256', 'manifest_sha256', 'ui_digest', 'logical_data_inventory_sha256', 'physical_inventory_sha256', 'current_inventory_sha256', 'baseline_inventory_sha256', 'research_generation']) assert(sha(binding[field]), 'Missing captured ' + field);
  const recomputed = assessHistoricalScreeningPriority(report, binding, completion.completed_groups);
  assert.deepEqual(assessment, recomputed, 'Historical acceptance classification changed');
  assert(assessment.functional_acceptance === 'passed' && assessment.policy_exit === 0 && assessment.blocking_failures.length === 0, 'Incomplete or failed functional measurement');
  validateFunctionalEvidence(report, binding);
  assert.deepEqual(completion.screenshots, Object.fromEntries(report.screens.map(screen => [screen.key, screen.sha256])), 'Captured image inventory changed');
  const paths = ['report.json', 'screening-priority-assessment.json', 'screening-priority-completion.json'];
  if (representation) {
    assert(sha(binding.baseline_representation_sha256), 'Missing baseline proof identity');
    const verified = verifyRepresentationReport(root, report, binding.baseline_representation_sha256);
    assert(verified.proof.baseline_sha === BASELINE, 'Captured baseline decoder differs');
    assert(verified.proof.current_manifest_sha256 === binding.manifest_sha256 && verified.proof.canonical_data_inventory_sha256 === binding.logical_data_inventory_sha256, 'Captured representation input differs');
    paths.push(...verified.paths.map(path => 'baseline-representation/' + path));
  }
  for (const screen of report.screens) { assert(hash(regular(root, screen.screenshot)) === screen.sha256, 'Captured PNG changed'); paths.push(screen.screenshot); }
  const downloadedCsv = cases => {
    assert(cases.length === 10, 'All ten normal/carry CSV downloads required');
    const entries = {};
    for (const item of cases) {
      const csv = item.csv; assert(csv && safePath(csv.artifact) && sha(csv.sha256) && Number.isSafeInteger(csv.bytes) && csv.bytes > 0, 'Missing captured CSV bytes/identity');
      assert(!Object.hasOwn(entries, csv.artifact), 'Duplicate CSV artifact path');
      const bytes = regular(root, csv.artifact); assert(hash(bytes) === csv.sha256 && bytes.length === csv.bytes, 'Captured CSV differs from report');
      const parsed = parseFinancialCsv(bytes.toString('utf8')), matches = parsed.rows.filter(row => row.symbol === item.symbol);
      assert.deepEqual(parsed.headers, csv.headers, 'Captured CSV headers differ');
      assert(matches.length === 1, 'Captured CSV matching row is missing/duplicate');
      assert.deepEqual(matches[0], csv.row, 'Captured CSV row differs from report');
      entries[csv.artifact] = { sha256: csv.sha256, bytes: csv.bytes }; paths.push(csv.artifact);
    }
    return entries;
  };
  downloadedCsv(report.financial_cases);
  if (binding.scope === 'carry') {
    const bytes = regular(root, 'financial-carry-evidence.json'), seal = JSON.parse(bytes);
    assert(seal.schema === 'financial-carry-design-review-v1' && seal.satisfies_fresh_categories === false && hash(bytes) === completion.carry_seal_sha256 && seal.publication_authority === 'none' && seal.financial_admission === false
      && seal.report_sha256 === completion.report_sha256 && seal.ui_sha === binding.commit && seal.preview_provenance_sha256 === binding.provenance_sha256
      && seal.publication_sha256 === binding.publication_sha256 && seal.physical_inventory_sha256 === binding.physical_inventory_sha256
      && seal.ui_digest === binding.ui_digest && seal.manifest_sha256 === binding.manifest_sha256 && seal.logical_data_inventory_sha256 === binding.logical_data_inventory_sha256
      && seal.objective_failures === report.failures.length && clock(seal.sealed_at) && Date.parse(seal.sealed_at) >= Date.parse(report.measured_at) && Date.parse(seal.sealed_at) <= Date.parse(completion.completed_at), 'Historical carry seal changed');
    assert.deepEqual(seal.screenshots, Object.fromEntries(report.screens.map(screen => [screen.key, { path: screen.screenshot, sha256: screen.sha256 }])), 'Carry seal PNG inventory differs');
    assert.deepEqual(seal.downloads, downloadedCsv(report.financial_carry_cases), 'Carry seal CSV inventory differs');
    paths.push('financial-carry-evidence.json');
  } else assert(completion.carry_seal_sha256 === null, 'Ordinary capture has unexpected carry seal');
  assert(new Set(paths).size === paths.length, 'Duplicate capture paths');
  return { report, assessment, completion, binding, paths };
}

export function verifyPackage(root, reference, sourceRoot, current, configurationDigest, now = Date.now()) {
  validateReference(reference);
  const bytes = regular(root, 'capture-envelope.json'), envelope = JSON.parse(bytes);
  assert(bytes.toString() === canonical(envelope), 'Capture envelope is noncanonical or has duplicate keys');
  keys(envelope, ['schema', 'publication_authority', 'financial_admission', 'producer', 'baseline_sha', 'source_inventory_sha256', 'configuration_sha256', 'created_at', 'files'], 'Capture envelope');
  assert(envelope.schema === CAPTURE_SCHEMA && envelope.publication_authority === 'none' && envelope.financial_admission === false && envelope.baseline_sha === BASELINE, 'Unknown or authority-bearing capture');
  keys(envelope.producer, ['repository', 'workflow_path', 'event', 'ref', 'head_sha', 'checkout_sha', 'tree', 'run_id', 'run_attempt'], 'Producer');
  assert(sha(configurationDigest) && reference.configuration_sha256 === configurationDigest && envelope.configuration_sha256 === configurationDigest, 'Capture configuration changed');
  const producer = envelope.producer;
  assert(producer.repository === REPOSITORY && producer.workflow_path === WORKFLOW && producer.event === 'push' && producer.ref === 'refs/heads/main'
    && producer.head_sha === reference.head_sha && producer.checkout_sha === reference.checkout_sha && producer.run_id === reference.run_id && producer.run_attempt === reference.run_attempt, 'Captured producer identity differs');
  const capturedDigest = materialSourceDigest(sourceRoot, reference.checkout_sha), currentDigest = materialSourceDigest(sourceRoot, current);
  assert(capturedDigest === currentDigest && envelope.source_inventory_sha256 === capturedDigest && reference.source_inventory_sha256 === capturedDigest, 'Renderer/measurement/config/contract source changed');
  assert(producer.tree === git(sourceRoot, 'rev-parse', `${reference.checkout_sha}^{tree}`).trim(), 'Captured source tree changed');
  const measured = verifyStoredMeasurement(root, now);
  requireRepresentationContract(sourceRoot, current, measured.completion);
  requireAnnotationGeometryContract(sourceRoot, reference.checkout_sha, measured.report);
  assert(measured.binding.commit === producer.checkout_sha && measured.binding.tree === producer.tree && measured.binding.run_id === String(producer.run_id) && measured.binding.run_attempt === String(producer.run_attempt), 'Measurement belongs to another producer');
  assert(clock(envelope.created_at) && Date.parse(measured.completion.completed_at) <= Date.parse(envelope.created_at) && Date.parse(envelope.created_at) <= now, 'Invalid capture package clock');
  const input = regular(root, 'input-provenance.json');
  assert(hash(input) === measured.binding.provenance_sha256, 'Captured input provenance changed');
  const provenance = JSON.parse(input);
  if (measured.binding.scope === 'carry') assert(provenance.baseline_sha === BASELINE && provenance.ui_sha === producer.checkout_sha && provenance.ui_tree === producer.tree, 'Captured carry comparison source differs');
  else assert(provenance.decision?.mode === 'design' && provenance.sourceSha === producer.checkout_sha && provenance.controllerSha === producer.checkout_sha, 'Captured ordinary provenance differs');
  const expected = [...measured.paths, 'input-provenance.json'].sort();
  assert.deepEqual(Object.keys(envelope.files).sort(), expected, 'Missing or extra required package member');
  let total = bytes.length;
  for (const path of expected) { const bytes = regular(root, path), record = envelope.files[path]; keys(record, ['sha256', 'bytes'], 'Capture file'); assert(record.sha256 === hash(bytes) && record.bytes === bytes.length, 'Package member changed: ' + path); total += bytes.length; }
  assert(total <= MAX_PACKAGE, 'Capture package exceeds bound');
  const all = [];
  const walk = (directory, prefix = '') => { for (const item of readdirSync(directory, { withFileTypes: true })) { const path = prefix + item.name; assert(safePath(path) && !item.isSymbolicLink(), 'Unsafe package entry'); if (item.isDirectory()) walk(join(directory, item.name), path + '/'); else { regular(root, path); all.push(path); } } };
  walk(root); assert.deepEqual(all.sort(), [...expected, 'capture-envelope.json'].sort(), 'Unexpected package files');
  return { ...measured, envelope };
}

export function verifyProducer({ reference, envelope, completion, report, run, jobs, artifact, workflow, now = Date.now() }) {
  validateReference(reference);
  assert(workflow.id === run.workflow_id && workflow.path === WORKFLOW && workflow.state === 'active', 'Wrong Design workflow identity');
  assert(run.id === reference.run_id && run.run_attempt === reference.run_attempt && run.path === WORKFLOW && run.event === 'push' && run.head_branch === 'main'
    && run.head_sha === reference.head_sha && run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY
    && run.status === 'completed' && ['success', 'failure'].includes(run.conclusion), 'Untrusted, canceled or incomplete capture producer');
  assert(artifact.id === reference.artifact_id && artifact.expired === false && artifact.name === `reviewable-design-capture-${reference.checkout_sha}-${reference.run_attempt}`
    && artifact.digest === 'sha256:' + reference.artifact_sha256 && artifact.size_in_bytes === reference.artifact_bytes
    && artifact.workflow_run?.id === reference.run_id && artifact.workflow_run?.head_sha === reference.head_sha, 'Artifact identity/digest differs');
  assert(Array.isArray(jobs), 'Missing producer jobs');
  const candidates = jobs.filter(job => job.name === 'Real-data design and performance budgets');
  assert(candidates.length === 1, 'Unique Design producer job required');
  const job = candidates[0];
  assert(job.run_id === reference.run_id && job.run_attempt === reference.run_attempt && job.status === 'completed' && ['success', 'failure'].includes(job.conclusion), 'Wrong or incomplete Design job attempt');
  assert(run.conclusion === job.conclusion && Array.isArray(job.steps) && job.steps.every(step => step.status === 'completed' && ['success', 'skipped', 'failure'].includes(step.conclusion)), 'Incomplete or failed producer steps');
  for (const name of [MEASURE_STEP, PACKAGE_STEP, UPLOAD_STEP]) { const steps = job.steps.filter(step => step.name === name); assert(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success', 'Required producer step did not succeed: ' + name); }
  const image = job.steps.filter(step => step.name === IMAGE_STEP);
  assert(image.length === 1 && image[0].status === 'completed' && ['success', 'failure'].includes(image[0].conclusion), 'Missing completed image-review step');
  assert((image[0].conclusion === 'failure') === (job.conclusion === 'failure'), 'Producer outcome differs from screenshot review');
  assert(job.steps.every(step => !['failure', 'cancelled', 'timed_out', 'action_required'].includes(step.conclusion) || step.name === IMAGE_STEP && step.conclusion === 'failure'), 'Producer failed outside image review');
  const times = [run.run_started_at, report.measured_at, completion.completed_at, envelope.created_at, artifact.created_at, job.completed_at, run.updated_at];
  assert(times.every(clock) && times.every((time, index) => index === 0 || Date.parse(times[index - 1]) <= Date.parse(time)) && Date.parse(times.at(-1)) <= now, 'Producer/capture timestamps are inconsistent');
  return true;
}

export function historicalReviewResult({ review, reference, reviewHash, measured, consumer }) {
  assert(review.observed_commit === reference.checkout_sha && review.evidence_run === `https://github.com/${REPOSITORY}/actions/runs/${reference.run_id}/attempts/${reference.run_attempt}`, 'Review identity differs from captured evidence');
  assert(sha(reviewHash) && consumer?.repository === REPOSITORY && consumer.workflow_path === WORKFLOW && commit(consumer.head_sha) && positive(consumer.run_id) && positive(consumer.run_attempt), 'Current consumer/review identity required');
  const images = assessScreeningImageReview({ review, report: measured.report, binding: measured.binding, assessment: measured.assessment });
  assert(images.policy_exit === 0 && images.blocking_failures.length === 0, 'Material, unknown or unclassified visible screening findings remain');
  return { schema: 'reviewed-prior-capture-result-v1', result_kind: 'reviewed_prior_capture', publication_authority: 'none', financial_admission: false,
    measured_in_current_run: false, current_data_validated: false, current_financial_freshness_validated: false,
    consumer, capture: reference, review_sha256: reviewHash, measured_at: measured.report.measured_at, completed_at: measured.completion.completed_at,
    historical_input: { as_of_date: measured.binding.as_of_date, research_generation: measured.binding.research_generation, provenance_sha256: measured.binding.provenance_sha256 },
    original_objective_assessment: measured.assessment, image_assessment: images, policy_exit: 0 };
}
