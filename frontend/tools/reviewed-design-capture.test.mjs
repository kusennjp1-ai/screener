// @vitest-environment node
// Synthetic Git/Actions/package fixtures only, never real screenshots or approval.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './reviewed-design-functional-fixture.mjs';
import { fonts } from '../src/static/theme/tokens.js';
import { RADAR_HARNESS_VERSION, RADAR_CONTEXT_CLASSES } from './radar-benchmark-context.mjs';
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';
import { storedRadarV3 } from './fixtures/radar-stored-v3.mjs';
import { SCREENING_PRIORITY_POLICY, DESIGN_GROUPS, assessScreeningPriority } from './screening-priority-acceptance.mjs';
import { SCREENING_IMAGE_REVIEW_POLICY, REVIEW_AXES, VISUAL_CHECKS } from './screening-priority-image-review.mjs';
import { BASELINE, CAPTURE_SCHEMA, REPOSITORY, WORKFLOW, REVIEW_PATH, REVIEW_RECORDS, IMAGE_STEP, MEASURE_STEP, PACKAGE_STEP, UPLOAD_STEP,
  canonical, hash, materialSourceDigest, readPriorReview, verifyPackage, verifyProducer, verifyStoredMeasurement, requireRepresentationContract, requireAnnotationGeometryContract, historicalReviewResult } from './reviewed-design-capture.mjs';
import { captureConfigurationDigest, selectPriorCapture, extractReviewableZip, stageCaptureFiles, acceptPriorCapture } from './design-capture-lifecycle.mjs';

// Only synthetic fixtures share an epoch; production measurement clocks are never frozen.
const fixtureEpoch = Date.now() - 600000;
const H = 'a'.repeat(64), sha = 'b'.repeat(40), stamp = n => new Date(fixtureEpoch + n * 1000).toISOString();
const write = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)); };
const git = (root, ...args) => execFileSync('git', ['-c', 'user.name=Synthetic fixture', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repoFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'synthetic-capture-repo-')); t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  for (const path of ['frontend/src/App.jsx', 'frontend/tools/design-review.mjs', 'frontend/tools/reviewed-design-capture.mjs', 'frontend/package-lock.json', 'frontend/vite.config.js', 'contracts/input.json', WORKFLOW, '.github/scripts/requirements.txt', 'docs/ordinary.md', 'docs/design-review/2026-10-01.json']) write(join(root, path), 'Synthetic source ' + path);
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Synthetic captured source, not production');
  const captured = git(root, 'rev-parse', 'HEAD'), tree = git(root, 'rev-parse', 'HEAD^{tree}');
  const reference = { schema: 'reviewed-prior-capture-reference-v1', repository: REPOSITORY, workflow_path: WORKFLOW, run_id: 123, run_attempt: 2, head_sha: captured, checkout_sha: captured,
    source_inventory_sha256: materialSourceDigest(root, captured), configuration_sha256: captureConfigurationDigest({}), artifact_id: 456, artifact_sha256: H, artifact_bytes: 100 };
  const review = { review_mode: 'reviewed-prior-capture-v1', review_policy: SCREENING_IMAGE_REVIEW_POLICY, capture: reference, observed_commit: captured,
    reviewer: 'Synthetic fixture only', evidence_run: `https://github.com/${REPOSITORY}/actions/runs/123/attempts/2`, screens: [] };
  const commitReview = () => { write(join(root, REVIEW_PATH), review); git(root, 'add', REVIEW_PATH); git(root, 'commit', '--allow-empty', '-m', 'Synthetic review-only fixture'); return git(root, 'rev-parse', 'HEAD'); };
  const current = commitReview();
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_JOB: 'design-acceptance', GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: current, GITHUB_RUN_ID: '124', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: root };
  return { root, captured, tree, current, reference, review, env, commitReview };
}
function timed(report) {
  const node = { font_family: fonts.body, box_sizing: 'border-box', width: 200, height: 200 };
  const context = { harness_version: RADAR_HARNESS_VERSION, root_theme: 'dark', shell_theme: 'dark', ancestors: RADAR_CONTEXT_CLASSES.map(class_name => ({ class_name })), shell: node, slot: node, canvas: node, radar: { ...node, font_feature_settings: 'palt', font_variant_numeric: 'tabular-nums' }, plot: { animation_name: 'none', transform: 'none' } };
  const radar = { first_frame_ms: 16, point_count: 207, final_point_count: 207, context, pixel_alignment: { matches: true }, visibility: { version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true, styles_visible: true, effective_opacity: 1, transforms_settled: true, expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, readback_error: null } };
  report.measured_at = stamp(1); report.failures = ['1440: Q1 method switch 533ms > 480ms', '1440: P1 exact limits not met (3500ms / 400ms / 200ms)'];
  report.performance = ['baseline', 'current'].flatMap(label => [1440, 390].map(width => ({ label, viewport: { width }, ...(label === 'current' ? { p1_pass: width !== 1440 } : {}), runs: [1, 2, 3].map(() => ({ candidate_ms: 2500, method_switch_ms: label === 'current' && width === 1440 ? 533 : 200, longest_initial_task_ms: 174 })), candidate_median_ms: 2500, maximum_switch_ms: label === 'current' && width === 1440 ? 533 : 200, longest_initial_task_ms: 174 })));
  report.radar = [1440, 390].map(width => ({ viewport: { width }, runs: structuredClone([radar, radar, radar]) }));
}
function packageFixture(t, scope = 'carry') {
  const f = repoFixture(t), packageRoot = join(f.root, 'package'); mkdirSync(packageRoot);
  const { report, binding: initial } = fixture(scope); timed(report); report.commit = f.captured;
  const input = scope === 'carry' ? { schema: 'design-financial-carry-preview-v1', baseline_sha: BASELINE, ui_sha: f.captured, ui_tree: f.tree } : { decision: { mode: 'design' }, sourceSha: f.captured, controllerSha: f.captured };
  const provenanceHash = hash(canonical(input));
  const binding = { ...initial, policy: SCREENING_PRIORITY_POLICY, commit: f.captured, tree: f.tree, run_id: '123', run_attempt: '2', provenance_sha256: provenanceHash,
    publication_sha256: H, manifest_sha256: H, ui_digest: H, logical_data_inventory_sha256: H, physical_inventory_sha256: H, current_inventory_sha256: H, baseline_inventory_sha256: H };
  const paths = ['report.json', 'screening-priority-assessment.json', 'screening-priority-completion.json', 'input-provenance.json'];
  for (const screen of report.screens) { const bytes = Buffer.from('Synthetic PNG byte fixture: ' + screen.key); write(join(packageRoot, screen.screenshot), bytes); screen.sha256 = hash(bytes); if (scope === 'carry') screen.preview_provenance_sha256 = provenanceHash; paths.push(screen.screenshot); }
  for (const item of [...report.financial_cases, ...(report.financial_carry_cases || [])]) item.financial_evaluated_at = stamp(2);
  const csvBytes = csv => Buffer.from(csv.headers.join(',') + '\n' + csv.headers.map(key => csv.row[key]).join(',') + '\n');
  for (const item of report.financial_cases) { const bytes = csvBytes(item.csv); Object.assign(item.csv, { artifact: `synthetic-normal-${item.symbol}-${item.viewport.width}.csv`, sha256: hash(bytes), bytes: bytes.length }); write(join(packageRoot, item.csv.artifact), bytes); paths.push(item.csv.artifact); }
  const downloads = {};
  for (const item of report.financial_carry_cases || []) { item.preview_provenance_sha256 = provenanceHash; const bytes = csvBytes(item.csv); write(join(packageRoot, item.csv.artifact), bytes); item.csv.sha256 = hash(bytes); item.csv.bytes = bytes.length; downloads[item.csv.artifact] = { sha256: hash(bytes), bytes: bytes.length }; paths.push(item.csv.artifact); }
  for (const group of report.financial_carry_browser_ui || []) group.provenance_sha256 = provenanceHash;
  const assessment = assessScreeningPriority(report, binding, DESIGN_GROUPS); assert.equal(assessment.policy_exit, 0);
  write(join(packageRoot, 'report.json'), report); write(join(packageRoot, 'screening-priority-assessment.json'), assessment); write(join(packageRoot, 'input-provenance.json'), input);
  const completion = { schema: 'screening-priority-completion-v1', publication_authority: 'none', financial_admission: false, binding, completed_groups: DESIGN_GROUPS, carry_seal_sha256: null, completed_at: stamp(3), report_sha256: hash(canonical(report)), assessment_sha256: hash(canonical(assessment)), screenshots: Object.fromEntries(report.screens.map(screen => [screen.key, screen.sha256])) };
  if (scope === 'carry') { const seal = { schema: 'financial-carry-design-review-v1', publication_authority: 'none', financial_admission: false, report_sha256: completion.report_sha256, ui_sha: f.captured, preview_provenance_sha256: provenanceHash, publication_sha256: H, physical_inventory_sha256: H, ui_digest: H, manifest_sha256: H, logical_data_inventory_sha256: H, baseline_ui_digest: H, transport_generation: H, objective_failures: report.failures.length, satisfies_fresh_categories: false, sealed_at: stamp(2), screenshots: Object.fromEntries(report.screens.map(screen => [screen.key, { path: screen.screenshot, sha256: screen.sha256 }])), downloads }; write(join(packageRoot, 'financial-carry-evidence.json'), seal); completion.carry_seal_sha256 = hash(canonical(seal)); paths.push('financial-carry-evidence.json'); }
  write(join(packageRoot, 'screening-priority-completion.json'), completion);
  const envelope = { schema: CAPTURE_SCHEMA, publication_authority: 'none', financial_admission: false, producer: { repository: REPOSITORY, workflow_path: WORKFLOW, event: 'push', ref: 'refs/heads/main', head_sha: f.captured, checkout_sha: f.captured, tree: f.tree, run_id: 123, run_attempt: 2 }, baseline_sha: BASELINE, source_inventory_sha256: f.reference.source_inventory_sha256, configuration_sha256: f.reference.configuration_sha256, created_at: stamp(4), files: Object.fromEntries(paths.map(path => { const bytes = readFileSync(join(packageRoot, path)); return [path, { sha256: hash(bytes), bytes: bytes.length }]; })) };
  write(join(packageRoot, 'capture-envelope.json'), envelope);
  f.review.screens = report.screens.map(screen => ({ key: screen.key, screenshot: screen.screenshot, sha256: screen.sha256, scores: Object.fromEntries(REVIEW_AXES.map(axis => [axis, { value: axis === 'originality' ? 7 : 8, reason: 'Synthetic test score, not actual review' }])), visualChecks: Object.fromEntries(VISUAL_CHECKS.map(check => [check, { status: 'pass', reason: 'Synthetic visible-only check' }])), findings: [{ axis: 'originality', category: 'originality', screeningImpact: 'non_screening_aesthetic', reason: 'Synthetic conventional layout concern' }] }));
  f.current = f.commitReview(); f.env.GITHUB_SHA = f.current;
  return { ...f, packageRoot, report, binding, completion, assessment, envelope, paths };
}
function producerFixture(reference = { run_id: 123, run_attempt: 2, head_sha: sha, checkout_sha: sha, artifact_id: 456, artifact_sha256: H, artifact_bytes: 100, schema: 'reviewed-prior-capture-reference-v1', repository: REPOSITORY, workflow_path: WORKFLOW, source_inventory_sha256: H, configuration_sha256: H }) {
  const steps = [MEASURE_STEP, IMAGE_STEP, PACKAGE_STEP, UPLOAD_STEP].map(name => ({ name, status: 'completed', conclusion: name === IMAGE_STEP ? 'failure' : 'success' }));
  return { reference, envelope: { created_at: stamp(4) }, completion: { completed_at: stamp(3) }, report: { measured_at: stamp(1) }, workflow: { id: 9, path: WORKFLOW, state: 'active' },
    run: { id: reference.run_id, run_attempt: reference.run_attempt, workflow_id: 9, path: WORKFLOW, event: 'push', head_branch: 'main', head_sha: reference.head_sha, repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, status: 'completed', conclusion: 'failure', run_started_at: stamp(0), updated_at: stamp(8) },
    artifact: { id: reference.artifact_id, name: `reviewable-design-capture-${reference.checkout_sha}-${reference.run_attempt}`, expired: false, digest: 'sha256:' + reference.artifact_sha256, size_in_bytes: reference.artifact_bytes, workflow_run: { id: reference.run_id, head_sha: reference.head_sha }, created_at: stamp(5) },
    jobs: [{ name: 'Real-data design and performance budgets', run_id: reference.run_id, run_attempt: reference.run_attempt, status: 'completed', conclusion: 'failure', completed_at: stamp(6), steps }] };
}

test('annotation contract downgrade is decided by immutable producer source, not report omission', t => {
  const f = repoFixture(t), path = 'frontend/tools/chart-design-cases.mjs';
  requireAnnotationGeometryContract(f.root, f.captured, {});
  write(join(f.root, path), 'export function verifyChartCases() {}');
  git(f.root, 'add', path); git(f.root, 'commit', '-m', 'Synthetic legacy chart producer');
  const legacy = git(f.root, 'rev-parse', 'HEAD');
  requireAnnotationGeometryContract(f.root, legacy, {});
  write(join(f.root, path), "export function verifyChartCases(report) { report.expanded_annotation_geometry_contract = 'full-plot-v1'; }");
  git(f.root, 'add', path); git(f.root, 'commit', '-m', 'Synthetic annotated chart producer');
  const current = git(f.root, 'rev-parse', 'HEAD');
  for (const report of [{}, { expanded_annotation_geometry_contract: 'unknown' }])
    assert.throws(() => requireAnnotationGeometryContract(f.root, current, report), /requires the expanded annotation/);
  requireAnnotationGeometryContract(f.root, current, { expanded_annotation_geometry_contract: 'full-plot-v1' });
  // Checking an older immutable revision must not inspect the newer worktree.
  requireAnnotationGeometryContract(f.root, legacy, {});
  write(join(f.root, path), 'export function verifyChartCases() {}');
  assert.throws(() => requireAnnotationGeometryContract(f.root, current, {}), /requires the expanded annotation/);
});

test('historical reader preserves literal v3 classification without admitting it as a fresh v4 measurement', t => {
  const f = packageFixture(t, 'ordinary');
  const current = verifyStoredMeasurement(f.packageRoot).assessment;
  for (const group of f.report.radar) group.runs = [1,2,3].map(() => structuredClone(storedRadarV3));
  const saveReport = () => {
    write(join(f.packageRoot, 'report.json'), f.report);
    f.completion.report_sha256 = hash(canonical(f.report));
    write(join(f.packageRoot, 'screening-priority-completion.json'), f.completion);
  };
  saveReport();
  // Assessment bytes stay unchanged: historical recomputation must retain the
  // original classification, with all source/hash/image checks still active.
  assert.deepEqual(verifyStoredMeasurement(f.packageRoot).assessment, current);
  assert.equal(assessScreeningPriority(f.report, f.completion.binding, DESIGN_GROUPS).policy_exit, 1);
  f.report.radar[0].runs[0].context.ancestors[0].class_name = 'leader-shell workspace-shell'; saveReport();
  assert.throws(() => verifyStoredMeasurement(f.packageRoot), /Historical acceptance classification changed/);
  f.report.radar[0].runs[0] = structuredClone(storedRadarV3);
  f.report.radar[0].runs[0].context.harness_version = 'unknown-radar-contract'; saveReport();
  assert.throws(() => verifyStoredMeasurement(f.packageRoot), /Historical acceptance classification changed/);
});

test('only designated review records preserve the independently computed material inventory', t => { const f = repoFixture(t); assert.equal(materialSourceDigest(f.root, f.current), materialSourceDigest(f.root, f.captured)); assert.equal(readPriorReview(f.root, f.current).eligible, true); assert.equal(selectPriorCapture(f.root, f.env).reuse, true); });
for (const path of ['frontend/src/App.jsx', 'frontend/tools/design-review.mjs', 'frontend/tools/reviewed-design-capture.mjs', 'frontend/package-lock.json', 'frontend/vite.config.js', 'contracts/input.json', WORKFLOW, '.github/scripts/requirements.txt', 'docs/ordinary.md', 'docs/design-review/2026-10-01.json', 'docs/design-review/unrelated.md']) test('material change requires fresh capture: ' + path, t => { const f = repoFixture(t); write(join(f.root, path), 'Changed synthetic source'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Synthetic material change'); f.env.GITHUB_SHA = git(f.root, 'rev-parse', 'HEAD'); assert.equal(selectPriorCapture(f.root, f.env).reuse, false); });
test('no explicit review preserves ordinary fresh capture', t => { const f = repoFixture(t); git(f.root, 'checkout', '--detach', f.captured); f.env.GITHUB_SHA = f.captured; assert.equal(selectPriorCapture(f.root, f.env).reuse, false); });
test('changed quote configuration forces fresh capture', t => { const f = repoFixture(t); f.env.DESIGN_RESEARCH_QUOTE_URL = 'https://example.invalid/changed'; assert.equal(selectPriorCapture(f.root, f.env).reuse, false); });
test('PR and nondefault baseline do not enter historical lane', t => { const f = repoFixture(t); f.env.BASELINE_REF = 'c'.repeat(40); assert.equal(selectPriorCapture(f.root, f.env).reuse, false); f.env.BASELINE_REF = BASELINE; f.env.GITHUB_EVENT_NAME = 'pull_request'; assert.equal(selectPriorCapture(f.root, f.env).reuse, false); });
test('uncommitted review bytes cannot authorize reuse', t => { const f = repoFixture(t); write(join(f.root, REVIEW_PATH), { ...f.review, reviewer: 'Uncommitted' }); assert.throws(() => readPriorReview(f.root, f.current), /worktree/); });
test('review record symlink or executable mode cannot be excluded', t => { const f = repoFixture(t); rmSync(join(f.root, REVIEW_PATH)); symlinkSync('prior-capture-review.md', join(f.root, REVIEW_PATH)); write(join(f.root, REVIEW_RECORDS[1]), 'Synthetic'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Synthetic linked review'); assert.throws(() => materialSourceDigest(f.root, git(f.root, 'rev-parse', 'HEAD')), /regular blob/); });
test('material executable mode change changes source identity', t => { const f = repoFixture(t); chmodSync(join(f.root, 'frontend/src/App.jsx'), 0o755); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Synthetic source mode'); assert.notEqual(materialSourceDigest(f.root, git(f.root, 'rev-parse', 'HEAD')), f.reference.source_inventory_sha256); });
for (const scope of ['ordinary', 'carry']) test(scope + ' exact synthetic package preserves historical clocks and strict warnings', t => { const f = packageFixture(t, scope), before = readFileSync(join(f.packageRoot, 'report.json')); const measured = verifyPackage(f.packageRoot, f.reference, f.root, f.current, f.reference.configuration_sha256); const result = historicalReviewResult({ review: f.review, reference: f.reference, reviewHash: hash(canonical(f.review)), measured, consumer: { repository: REPOSITORY, workflow_path: WORKFLOW, head_sha: f.current, run_id: 124, run_attempt: 1 } }); assert.equal(result.result_kind, 'reviewed_prior_capture'); assert.equal(result.measured_in_current_run, false); assert.equal(result.current_financial_freshness_validated, false); assert.equal(result.image_assessment.strict_result, 'failed'); assert.equal(result.original_objective_assessment.performance_acceptance, 'deferred_warning'); assert.equal(result.measured_at, f.report.measured_at); assert.deepEqual(readFileSync(join(f.packageRoot, 'report.json')), before); });
for (const path of ['report.json', 'screening-priority-assessment.json', 'screening-priority-completion.json', 'input-provenance.json', 'financial-carry-evidence.json', 'home-1440-dark.png', 'synthetic-NVDA-1440.csv']) test('changed authenticated member rejects: ' + path, t => { const f = packageFixture(t); write(join(f.packageRoot, path), 'Changed synthetic bytes'); assert.throws(() => verifyPackage(f.packageRoot, f.reference, f.root, f.current, f.reference.configuration_sha256)); });
for (const path of ['input-provenance.json', 'financial-carry-evidence.json', 'synthetic-NVDA-1440.csv']) test('missing required member rejects: ' + path, t => { const f = packageFixture(t); rmSync(join(f.packageRoot, path)); assert.throws(() => verifyPackage(f.packageRoot, f.reference, f.root, f.current, f.reference.configuration_sha256)); });
test('extra package file and duplicate envelope property reject', t => { const f = packageFixture(t); write(join(f.packageRoot, 'extra.txt'), 'unexpected'); assert.throws(() => verifyPackage(f.packageRoot, f.reference, f.root, f.current, f.reference.configuration_sha256)); rmSync(join(f.packageRoot, 'extra.txt')); const p = join(f.packageRoot, 'capture-envelope.json'); write(p, readFileSync(p, 'utf8').replace('{', '{"schema":"duplicate",')); assert.throws(() => verifyPackage(f.packageRoot, f.reference, f.root, f.current, f.reference.configuration_sha256), /noncanonical/); });
test('material visual finding and unrelated review run/commit reject', t => { const f = packageFixture(t), measured = verifyPackage(f.packageRoot, f.reference, f.root, f.current, f.reference.configuration_sha256), options = { review: f.review, reference: f.reference, reviewHash: hash(canonical(f.review)), measured, consumer: { repository: REPOSITORY, workflow_path: WORKFLOW, head_sha: f.current, run_id: 124, run_attempt: 1 } }; f.review.screens[0].findings[0].screeningImpact = 'screening_material'; assert.throws(() => historicalReviewResult(options), /visible screening/); f.review.screens[0].findings[0].screeningImpact = 'non_screening_aesthetic'; f.review.observed_commit = sha; assert.throws(() => historicalReviewResult(options), /identity/); f.review.observed_commit = f.captured; f.review.evidence_run += '0'; assert.throws(() => historicalReviewResult(options), /identity/); });
test('only completed measurement with image-review-only failure is reusable', () => { assert.equal(verifyProducer(producerFixture()), true); });
for (const [name, mutate] of [
  ['workflow id', f => f.workflow.id++], ['workflow path', f => f.workflow.path = 'other'], ['inactive workflow', f => f.workflow.state = 'disabled_manually'], ['run id', f => f.run.id++], ['attempt', f => f.run.run_attempt++], ['head', f => f.run.head_sha = 'c'.repeat(40)], ['fork', f => f.run.head_repository.full_name = 'other/fork'], ['repository', f => f.run.repository.full_name = 'other/repo'], ['PR producer', f => f.run.event = 'pull_request'], ['branch', f => f.run.head_branch = 'other'], ['incomplete run', f => f.run.status = 'in_progress'], ['canceled run', f => f.run.conclusion = 'cancelled'], ['artifact id', f => f.artifact.id++], ['artifact digest', f => f.artifact.digest = 'sha256:' + 'c'.repeat(64)], ['artifact size', f => f.artifact.size_in_bytes++], ['artifact attempt name', f => f.artifact.name += '-3'], ['artifact run', f => f.artifact.workflow_run.id++], ['expired artifact', f => f.artifact.expired = true], ['job attempt', f => f.jobs[0].run_attempt++], ['duplicate job', f => f.jobs.push(f.jobs[0])], ['missing measure', f => f.jobs[0].steps.shift()], ['failed measure', f => f.jobs[0].steps[0].conclusion = 'failure'], ['missing package', f => f.jobs[0].steps.splice(2, 1)], ['failed upload', f => f.jobs[0].steps[3].conclusion = 'failure'], ['canceled step', f => f.jobs[0].steps[0].conclusion = 'cancelled'], ['unfinished step', f => f.jobs[0].steps[0].status = 'in_progress'], ['other failure', f => f.jobs[0].steps.push({ name: 'Post checkout', status: 'completed', conclusion: 'failure' })], ['future completion', f => f.completion.completed_at = new Date(Date.now() + 60000).toISOString()], ['capture predates producer', f => f.report.measured_at = '2000-01-01T00:00:00Z'], ['artifact predates completion', f => f.artifact.created_at = stamp(1)]
]) test('producer fails closed: ' + name, () => { const f = producerFixture(); mutate(f); assert.throws(() => verifyProducer(f)); });
for (const mode of ['duplicate', 'traversal', 'symlink', 'oversized']) test('ZIP rejects ' + mode + ' before producing usable files', t => { const f = repoFixture(t), zip = join(f.root, 'bad.zip'); execFileSync('python3', ['-c', `import zipfile,stat,sys\np,mode=sys.argv[1:]\nwith zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED) as z:\n if mode=='duplicate': z.writestr('same.json','a');z.writestr('same.json','b')\n elif mode=='traversal': z.writestr('../escape','a')\n elif mode=='symlink':\n  i=zipfile.ZipInfo('link');i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'target')\n else: z.writestr('big',bytes(64*1024*1024+1))\n`, zip, mode], { stdio: 'pipe' }); assert.throws(() => extractReviewableZip(zip, join(f.root, 'extracted'))); });
test('unmodified old capture without new actual measurements cannot be retroactively packaged', t => { const f = packageFixture(t); delete f.report.screens[0].reduced_motion_running_animations; write(join(f.packageRoot, 'report.json'), f.report); f.completion.report_sha256 = hash(canonical(f.report)); write(join(f.packageRoot, 'screening-priority-completion.json'), f.completion); assert.throws(() => verifyStoredMeasurement(f.packageRoot), /reduced-motion/); });
test('actual acceptance transport authenticates synthetic ZIP, emits distinct result, never captures', async t => { const f = packageFixture(t), zip = join(f.root, 'synthetic.zip'); execFileSync('python3', ['-c', `import pathlib,sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],'w') as z:\n for p in pathlib.Path(sys.argv[1]).iterdir():z.write(p,p.name)\n`, f.packageRoot, zip]); const bytes = readFileSync(zip); f.reference.artifact_sha256 = hash(bytes); f.reference.artifact_bytes = bytes.length; f.current = f.commitReview(); f.env.GITHUB_SHA = f.current; await new Promise(resolve => setTimeout(resolve, 1100)); const auth = producerFixture(f.reference); auth.envelope = f.envelope; auth.completion = f.completion; auth.report = f.report; const api = endpoint => endpoint.endsWith('/jobs?per_page=100') ? [{ jobs: auth.jobs }] : endpoint.includes('/actions/artifacts/') ? auth.artifact : endpoint.includes('/actions/workflows/') ? auth.workflow : auth.run; const result = await acceptPriorCapture(f.root, f.env, { api, download: (_artifact, path) => write(path, bytes) }); assert.equal(result.result_kind, 'reviewed_prior_capture'); assert.equal(result.measured_in_current_run, false); assert.equal(result.consumer.head_sha, f.current); assert.equal(result.capture.checkout_sha, f.captured); assert.equal(JSON.parse(readFileSync(join(f.root, 'reviewed-prior-capture-result.json'))).policy_exit, 0); });
import { storedFixture as representationFixture } from './fixtures/design-baseline-representation.mjs';
function v2PackageFixture(t) {
  const f = packageFixture(t, 'ordinary'), r = representationFixture(join(f.packageRoot, 'baseline-representation'), { canonical_data_inventory_sha256: f.binding.logical_data_inventory_sha256 });
  f.binding.baseline_representation_sha256 = r.sha256;
  f.binding.manifest_sha256 = r.proof.current_manifest_sha256;
  f.report.baseline_representation = { schema: r.proof.schema, proof_sha256: r.sha256, baseline_sha: r.proof.baseline_sha,
    canonical_data_inventory_sha256: r.proof.canonical_data_inventory_sha256, research: r.proof.research,
    served: Object.fromEntries(Object.entries(r.proof.files).map(([path, identity]) => [path, { ...identity, responses: 1 }])) };
  f.report.baseline_representation.received = structuredClone(f.report.baseline_representation.served);
  f.report.transport = [{ label: 'baseline', raw_bytes: r.proof.research.raw_bytes, gzip_bytes: r.proof.research.gzip_bytes }];
  f.completion.schema = 'screening-priority-completion-v2';
  f.assessment = assessScreeningPriority(f.report, f.binding, DESIGN_GROUPS);
  write(join(f.packageRoot, 'report.json'), f.report); write(join(f.packageRoot, 'screening-priority-assessment.json'), f.assessment);
  f.completion.report_sha256 = hash(canonical(f.report)); f.completion.assessment_sha256 = hash(canonical(f.assessment));
  write(join(f.packageRoot, 'screening-priority-completion.json'), f.completion);
  return { ...f, representation: r };
}
test('v2 historical capture includes exact baseline representation bodies while v1 remains closed', t => {
  const f = v2PackageFixture(t), measured = verifyStoredMeasurement(f.packageRoot);
  assert(measured.paths.includes('baseline-representation/proof.json')); assert(measured.paths.includes('baseline-representation/served/static-data/manifest.json'));
  f.completion.schema = 'screening-priority-completion-v1'; write(join(f.packageRoot, 'screening-priority-completion.json'), f.completion);
  assert.throws(() => verifyStoredMeasurement(f.packageRoot), /fields/);
});
for (const [name, mutate] of [
  ['missing proof', f => rmSync(join(f.packageRoot, 'baseline-representation/proof.json'))],
  ['missing body', f => rmSync(join(f.packageRoot, 'baseline-representation/served/static-data/manifest.json'))],
  ['extra override', f => write(join(f.packageRoot, 'baseline-representation/served/static-data/extra.json'), '{}')],
  ['unbound current manifest', f => { f.binding.manifest_sha256 = 'e'.repeat(64); write(join(f.packageRoot, 'screening-priority-completion.json'), f.completion); }],
  ['missing responses', f => { f.report.baseline_representation.served = {}; write(join(f.packageRoot, 'report.json'), f.report); f.completion.report_sha256 = hash(canonical(f.report)); write(join(f.packageRoot, 'screening-priority-completion.json'), f.completion); }],
]) test('v2 historical capture rejects '+name, t => { const f = v2PackageFixture(t); mutate(f); assert.throws(() => verifyStoredMeasurement(f.packageRoot)); });

test('material source with representation adapter cannot downgrade to v1 by removing all proof fields', t => {
  const f = repoFixture(t);
  requireRepresentationContract(f.root, f.current, { schema: 'screening-priority-completion-v1' });
  write(join(f.root, 'frontend/tools/baseline-representation.mjs'), 'Synthetic contract presence'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Synthetic representation material');
  const current = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => requireRepresentationContract(f.root, current, { schema: 'screening-priority-completion-v1' }), /requires/);
  requireRepresentationContract(f.root, current, { schema: 'screening-priority-completion-v2' });
});

test('v2 nested representation staging and authenticated package ZIP roundtrip retain every byte', t => {
  const f = v2PackageFixture(t), measured = verifyStoredMeasurement(f.packageRoot), staged = join(f.root, 'staged-v2'); mkdirSync(staged);
  const files = stageCaptureFiles(f.packageRoot, staged, measured.paths);
  const provenance = readFileSync(join(f.packageRoot, 'input-provenance.json')); write(join(staged, 'input-provenance.json'), provenance);
  files['input-provenance.json'] = { sha256: hash(provenance), bytes: provenance.length };
  const envelope = { ...f.envelope, files }; write(join(staged, 'capture-envelope.json'), envelope);
  verifyPackage(staged, f.reference, f.root, f.current, f.reference.configuration_sha256);
  const zip = join(f.root, 'nested-v2.zip'), extracted = join(f.root, 'extracted-v2');
  execFileSync('python3', ['-c', 'import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w") as z:\n for p in r.rglob("*"):\n  if p.is_file():z.write(p,p.relative_to(r).as_posix())', staged, zip]);
  extractReviewableZip(zip, extracted); verifyPackage(extracted, f.reference, f.root, f.current, f.reference.configuration_sha256);
  assert.throws(() => stageCaptureFiles(f.packageRoot, join(f.root, 'unsafe'), ['other/unknown.json']), /nested/);
});
