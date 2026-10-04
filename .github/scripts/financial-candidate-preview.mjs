// LOCAL, OFFLINE REVIEW ONLY. This command neither authorizes publication nor
// calls GitHub, providers, Pages, npm lifecycle hooks or a release controller.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { comparePreviewDataIsolated } from './financial-preview-comparison.mjs';
import { contract, parseCorrectionIntent, verifyCorrectionSource, restoreCorrectionSource, verifyConsumerCapability, dataInventory, digest } from './financial-correction.mjs';
import { bootstrap, dataFiles, downloadArtifact, inventoryDigest, safePath, sha256, uiInventory, validateReceipt } from './publication-state.mjs';
import { verifyArchive } from './select-release-source.mjs';
import { extractPriceObservations, priceObservationDigest } from './price-observations.mjs';
import { assessRetainedUniverse, isEligibleForPublication } from './retained-universe.mjs';
import { sameRepository } from './publication-gate.mjs';
import { compareCandidateBaselineData } from './financial-candidate-baseline.mjs';
import currentContract from '../../contracts/static_financial_current_v1.json' with { type: 'json' };
import { CERTIFIED_PREVIEW_SCHEMA, CERTIFIED_SOURCE_GUARD, NATIVE_PROJECTOR_PATH, parseCertifiedPreviewSelection, verifyRecordedCertifiedSource, validateCertifiedPreviewReceipt } from './financial-candidate-preview-v2.mjs';

export const PREVIEW_SCHEMA = 'financial-candidate-preview-v1';
const exact = (value, keys, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error(`Invalid closed ${name}`);
};
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));

export function parsePreviewRequest(value) {
  const certified=value.schema_version===CERTIFIED_PREVIEW_SCHEMA;
  exact(value, ['schema_version', 'kind', ...(certified?['source_validation','destination_projection']:['source_policy']), 'candidate_ui', 'correction'], 'preview request');
  if(certified)parseCertifiedPreviewSelection(value.source_validation,value.destination_projection);
  exact(value.candidate_ui, ['sha', 'tree'], 'candidate UI');
  if (![PREVIEW_SCHEMA,CERTIFIED_PREVIEW_SCHEMA].includes(value.schema_version) || value.kind !== 'unpublished_financial_candidate'
    || (!certified && !['successful_capture', 'terminal_partial_receipts'].includes(value.source_policy))
    || !sha(value.candidate_ui.sha) || !sha(value.candidate_ui.tree)) throw Error('Invalid unpublished candidate identity');
  parseCorrectionIntent(JSON.stringify(value.correction));
  return value;
}

export function verifyCandidateTree(root, candidate) {
  if (git(root, ['rev-parse', `${candidate.sha}^{commit}`]) !== candidate.sha
    || git(root, ['rev-parse', `${candidate.sha}^{tree}`]) !== candidate.tree) throw Error('Candidate SHA/tree mismatch');
  return candidate;
}

// Captured read-only API responses prove consistency with the pinned outer run,
// not current remote state. Activation must independently query these again.
export function verifyRecordedSource(source, evidence, policy = 'successful_capture') {
  exact(evidence, ['run', 'jobs', 'artifacts'], 'recorded source evidence');
  if (policy === 'terminal_partial_receipts') return verifyTerminalPartialPreviewSource(source, evidence);
  if (policy !== 'successful_capture') throw Error('Unknown preview source policy');
  const repo = source.repository;
  return verifyCorrectionSource(source, (endpoint, pages = false) => {
    if (endpoint === `repos/${repo}/actions/runs/${source.run_id}/attempts/${source.run_attempt}` && !pages) return evidence.run;
    if (endpoint === `repos/${repo}/actions/runs/${source.run_id}/attempts/${source.run_attempt}/jobs?per_page=100` && pages) return [{ jobs: evidence.jobs }];
    if (endpoint === `repos/${repo}/actions/runs/${source.run_id}/artifacts?per_page=100` && pages) return [{ artifacts: evidence.artifacts }];
    throw Error('Preview attempted an unrecorded remote lookup');
  });
}

// This deliberately separate validator is NEVER used by publication. A failed
// producer can leave useful receipts for inspection; its outcome stays failed.
export function verifyTerminalPartialPreviewSource(source, { run, jobs, artifacts }) {
  parseCorrectionIntent(JSON.stringify({ schema_version: contract.schema_version, kind: contract.kind, reason: contract.reason,
    previous_publication_identity: `1/1/${'0'.repeat(64)}/${'0'.repeat(64)}`, source }));
  if (run.id !== source.run_id || run.run_attempt !== source.run_attempt || !sameRepository(run, source.repository)
    || run.head_sha !== source.head_sha || run.path !== source.workflow || !['main', 'improve/mandatory-financial-source-recovery'].includes(run.head_branch)
    || run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'failure') throw Error('Partial preview requires its exact terminal failed producer');
  const matching = jobs.filter(job => job.name === contract.source_job && job.run_attempt === source.run_attempt);
  if (matching.length !== 1 || !Number.isSafeInteger(matching[0].id) || matching[0].id <= 0 || matching[0].status !== 'completed' || matching[0].conclusion !== 'failure') throw Error('Partial preview requires its exact failed source job');
  const job = matching[0], failed = (job.steps || []).filter(step => step.conclusion === 'failure');
  if (failed.length !== 1 || failed[0].name !== 'Continue one bounded source batch from original receipts'
    || (job.steps || []).some(step => !['success', 'failure', 'skipped'].includes(step.conclusion))) throw Error('Partial preview failed outside the bounded receipt collector');
  const selected = artifacts.filter(item => item.name === source.artifact_name);
  if (selected.length !== 1) throw Error('Missing or duplicate partial preview source artifact');
  const artifact = selected[0];
  if (artifact.id !== source.artifact_id || artifact.expired !== false || artifact.digest !== `sha256:${source.artifact_sha256}`
    || artifact.workflow_run?.id !== source.run_id || artifact.workflow_run?.head_sha !== source.head_sha
    || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > 128 * 1024 * 1024
    || ![artifact.created_at, job.started_at, job.completed_at].every(value => Number.isFinite(Date.parse(value)))
    || Date.parse(artifact.created_at) < Date.parse(job.started_at) || Date.parse(artifact.created_at) > Date.parse(job.completed_at)) throw Error('Partial preview artifact does not belong to the pinned failed attempt');
  return { artifact, job: { id: job.id, run_id: source.run_id, run_attempt: source.run_attempt, name: job.name } };
}

export function verifyPartialPreviewCycle(source, files) {
  const bytes = readFileSync(join(files, 'cycle.json')), cycle = JSON.parse(bytes);
  const summary = json(join(files, 'batch/summary.json'));
  if (cycle.schema_version !== 'financial-recovery-cycle-v1' || cycle.phase !== 'completed' || cycle.exit_code !== 3
    || cycle.dry_run !== false || cycle.published !== false || cycle.code_revision !== source.head_sha
    || cycle.archive_manifest_sha256 !== source.archive_manifest_sha256 || cycle.base_artifact_sha256 !== source.acquisition_base_sha256
    || summary.base_artifact_sha256 !== source.acquisition_base_sha256 || summary.exit_code !== 3 || summary.capture_completion_is_source_availability !== false) throw Error('Partial preview cycle did not complete archive merge and verification');
  return { sha256: sha256(bytes), phase: cycle.phase, exit_code: cycle.exit_code, archive_manifest_sha256: cycle.archive_manifest_sha256,
    base_artifact_sha256: cycle.base_artifact_sha256, code_revision: cycle.code_revision, provider_state_before: cycle.provider_state_before,
    published: cycle.published, retained_receipts: cycle.retained_receipts, retained_symbols: cycle.retained_symbols };
}

export function sourceOutcome(request, evidence, files, projection, verifiedCertification=null) {
  const { run } = evidence, job = evidence.jobs.find(item => item.name === contract.source_job && item.run_attempt === request.correction.source.run_attempt);
  const path = join(files, 'batch/summary.json'), bytes = existsSync(path) ? readFileSync(path) : null;
  const summary = bytes ? JSON.parse(bytes) : null;
  if (request.source_policy === 'terminal_partial_receipts' && (!summary || summary.exit_code !== 3 || summary.capture_completion_is_source_availability !== false)) throw Error('Partial preview lacks the original explicit partial-batch outcome');
  const reasons = {};
  for (const item of Object.values(projection.symbols)) for (const code of item.financial_current?.r || '') {
    const reason = currentContract.reason_codes[code];
    if (!reason) throw Error('Unknown recomputed preview field reason');
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return { policy: request.source_policy ?? request.source_validation.guard,
    run: { id: run.id, attempt: run.run_attempt, status: run.status, conclusion: run.conclusion },
    job: { id: job.id, attempt: job.run_attempt, status: job.status, conclusion: job.conclusion,
      failed_steps: (job.steps || []).filter(step => step.conclusion === 'failure').map(({ number, name, conclusion }) => ({ number, name, conclusion })) },
    reported_batch: summary ? { sha256: sha256(bytes), exit_code: summary.exit_code, provider_stop: summary.provider_stop ?? null, execution_stop: summary.execution_stop ?? null, counts: summary.counts } : null,
    reported_cycle: verifiedCertification ? verifyCertifiedPreviewCycle(request.correction.source,files,verifiedCertification) : request.source_policy === 'terminal_partial_receipts' ? verifyPartialPreviewCycle(request.correction.source, files) : null,
    recomputed: { symbols: Object.keys(projection.symbols).length, selected_receipts: projection.receipt_inventory.length, field_reason_counts: reasons } };
}

export function verifyCertifiedPreviewCycle(source,files,certification) {
  const bytes=readFileSync(join(files,'cycle.json')),cycle=JSON.parse(bytes),summaryBytes=readFileSync(join(files,'batch/summary.json')),summary=JSON.parse(summaryBytes);
  const exit=certification.source_execution.producer_exit_code;
  if(sha256(bytes)!==certification.bindings.cycle_sha256 || sha256(summaryBytes)!==certification.source_execution.producer_batch.summary_sha256
    || cycle.schema_version!=='financial-recovery-cycle-v1' || cycle.phase!=='completed' || cycle.exit_code!==exit || summary.exit_code!==exit
    || cycle.dry_run!==false || cycle.published!==false || cycle.code_revision!==source.head_sha
    || cycle.archive_manifest_sha256!==source.archive_manifest_sha256 || cycle.base_artifact_sha256!==source.acquisition_base_sha256
    || summary.base_artifact_sha256!==source.acquisition_base_sha256 || summary.capture_completion_is_source_availability!==false)throw Error('Certified preview cycle/source outcome mismatch');
  return {sha256:sha256(bytes),phase:cycle.phase,exit_code:cycle.exit_code,archive_manifest_sha256:cycle.archive_manifest_sha256,
    base_artifact_sha256:cycle.base_artifact_sha256,code_revision:cycle.code_revision,provider_state_before:cycle.provider_state_before,
    published:cycle.published,retained_receipts:cycle.retained_receipts,retained_symbols:cycle.retained_symbols};
}

export function verifyPredecessor(root, live, artifact, expectedIdentity) {
  const receiptPath = join(root, 'publication.json');
  const receiptBytes = existsSync(receiptPath) ? readFileSync(receiptPath) : Buffer.from('');
  const receipt = receiptBytes.length ? validateReceipt(JSON.parse(receiptBytes)) : null;
  if (!receipt && (live.receipt != null || live.uiSha !== bootstrap.ui_sha || live.uiDigest !== inventoryDigest(bootstrap.ui_files))) throw Error('Unrecognized legacy predecessor');
  const runId = receipt?.run_id ?? live.latest?.runId, attempt = receipt?.run_attempt ?? live.latest?.attempt;
  const manifestBytes = readFileSync(join(root, 'static-data/manifest.json'));
  const identity = `${runId}/${attempt}/${sha256(receiptBytes)}/${sha256(manifestBytes)}`;
  if (identity !== expectedIdentity || identity !== live.identity || digest(receipt) !== digest(live.receipt)
    || (receipt && receipt.data_manifest_sha256 !== sha256(manifestBytes)) || live.manifestHash !== sha256(manifestBytes)
    || artifact.id <= 0 || artifact.name !== (receipt?.artifact_name ?? 'github-pages') || artifact.workflow_run?.id !== runId
    || artifact.workflow_run?.head_sha !== live.latest?.headSha || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')
    || !Number.isFinite(Date.parse(artifact.created_at)) || !Number.isFinite(live.latest?.jobStarted) || !Number.isFinite(live.latest?.started)
    || Date.parse(artifact.created_at) < live.latest.jobStarted || Date.parse(artifact.created_at) > live.latest.started) throw Error('Preview predecessor identity mismatch');
  if (inventoryDigest(uiInventory(root)) !== live.uiDigest || (receipt && (receipt.ui_digest !== live.uiDigest || receipt.ui_sha !== live.uiSha))) throw Error('Predecessor UI bytes mismatch');
  const inventory = inventoryDigest(dataInventory(root));
  if (receipt?.data_inventory_sha256 && receipt.data_inventory_sha256 !== inventory) throw Error('Predecessor data inventory mismatch');
  const observations = extractPriceObservations({ dataRoot: join(root, 'static-data'), manifest: JSON.parse(manifestBytes) });
  if (priceObservationDigest(observations) !== priceObservationDigest(receipt?.price_observations ?? live.priceObservations)) throw Error('Predecessor price observations mismatch');
  return { identity, ui_sha: live.uiSha, ui_digest: live.uiDigest, artifact_id: artifact.id,
    artifact_sha256: artifact.digest.slice(7), data_inventory_sha256: inventory, price_observations_sha256: priceObservationDigest(observations) };
}

function copyData(source, destination) {
  rmSync(join(destination, 'static-data'), { recursive: true, force: true });
  cpSync(join(source, 'static-data'), join(destination, 'static-data'), { recursive: true });
  for (const file of dataFiles) cpSync(join(source, file), join(destination, file));
  rmSync(join(destination, 'publication.json'), { force: true });
}

export function verifyExistingPredecessor(zip, root, artifact) {
  // Stream the authenticated ZIP/TAR once and compare every member to the
  // supplied extraction. No large redundant TAR or second tree is produced.
  const actual = execFileSync('sha256sum', [zip], { encoding: 'utf8' }).split(' ')[0];
  if (`sha256:${actual}` !== artifact.digest) throw Error('Existing predecessor ZIP digest mismatch');
  execFileSync('python3', ['-c', `import hashlib,os,pathlib,stat,sys,tarfile,zipfile
root=pathlib.Path(sys.argv[2]);seen=set();files=set()
actual_files=set()
for base,dirs,names in os.walk(root):
 for name in dirs+names:assert not (pathlib.Path(base)/name).is_symlink(),'Linked predecessor extraction'
 actual_files.update(str((pathlib.Path(base)/name).relative_to(root)) for name in names)
def digest(stream):
 h=hashlib.sha256()
 for data in iter(lambda:stream.read(1024*1024),b''):h.update(data)
 return h.hexdigest()
with zipfile.ZipFile(sys.argv[1]) as z:
 items=z.infolist()
 assert len(items)==1 and items[0].filename=='artifact.tar' and not stat.S_ISLNK(items[0].external_attr>>16),'Unexpected predecessor ZIP members'
 with z.open(items[0]) as raw,tarfile.open(fileobj=raw,mode='r|') as archive:
  for member in archive:
   name=member.name
   while name.startswith('./'):name=name[2:]
   name=name.rstrip('/')
   if name in ('','.'):continue
   assert not name.startswith('/') and '\\\\' not in name and all(p not in ('','.','..') for p in name.split('/')) and name not in seen,'Unsafe or duplicate predecessor member'
   assert member.isfile() or member.isdir(),'Special predecessor member'
   seen.add(name);path=root/name
   assert not path.is_symlink(),'Linked predecessor extraction'
   if member.isdir():assert path.is_dir(),'Missing predecessor directory'
   else:
    assert path.is_file() and path.stat().st_size==member.size,'Missing or truncated predecessor file'
    with path.open('rb') as extracted:assert digest(archive.extractfile(member))==digest(extracted),'Predecessor extraction differs: '+name
    files.add(name)
assert actual_files==files,'Unexpected predecessor extraction files'
`, zip, root], { stdio: 'pipe' });
}

async function research(root, frontend) {
  const manifest = json(join(root, 'static-data/manifest.json'));
  const path = manifest.markets?.US?.assets?.research?.path;
  if (!safePath(path)) throw Error('Unsafe preview research path');
  const { decodeResearchIndex } = await import(pathToFileURL(join(frontend, 'src/static/researchTransport.js')).href);
  return { manifest, index: decodeResearchIndex(json(join(root, 'static-data', path))) };
}

async function writeTargetBase(root,frontend,path) {
  const {index}=await research(root,frontend);
  writeFileSync(path,JSON.stringify({market:'US',as_of_date:index.as_of_date,rows:index.rows}));
  // No decoded rows escape this phase into projection parsing or comparison.
}

async function coverage(root, frontend, live) {
  const { manifest, index } = await research(root, frontend);
  const previousSymbols = live.verificationUniverse.required_symbols, prior = new Set(previousSymbols), charts = new Map();
  for (const row of index.rows) if (prior.has(row.symbol) && !isEligibleForPublication(row) && safePath(row.chart_path)) {
    const path = join(root, 'static-data', row.chart_path);
    if (existsSync(path)) charts.set(row.symbol, json(path));
  }
  const report = assessRetainedUniverse({ previousSymbols, rows: index.rows, asOfDate: manifest.markets.US.as_of_date, charts });
  if (!report.passed) throw Error(`Preview retained-universe gate failed: ${report.verified}/${report.total}`);
  return report;
}

export function previewBuildEnvironment(evaluatedAt, extraEnv = {}, inherited = process.env) {
  const env = { ...inherited, VITE_STATIC_SITE: 'true', VITE_BASE_PATH: '/screener/', FINANCIAL_EVALUATED_AT: evaluatedAt };
  for (const key of Object.keys(env)) if (key.startsWith('FINANCIAL_CORRECTION_') || key.startsWith('FINANCIAL_GENERATION_CARRY_')) delete env[key];
  Object.assign(env, extraEnv);
  return env;
}

function build(frontend, output, evaluatedAt, extraEnv = {}) {
  const env = previewBuildEnvironment(evaluatedAt, extraEnv);
  for (const [script, args] of [['tools/export-research.mjs', []], ['tools/check-data-quality.mjs', []], ['node_modules/vite/bin/vite.js', ['build']]]) {
    execFileSync(process.execPath, [script, ...args], { cwd: frontend, env, stdio: 'inherit' });
  }
  if (existsSync(output)) throw Error('Preview build destination already exists');
  renameSync(join(frontend, 'dist'), output);
  if (existsSync(join(output, 'publication.json'))) throw Error('Unpublished candidate must not carry a publication receipt');
  // Retain the complete build once, then release generated compiler staging.
  // The next build receives its own copy of the verified baseline data.
  rmSync(join(frontend, 'public/static-data'), { recursive: true });
  for (const file of dataFiles) rmSync(join(frontend, 'public', file));
}

export async function preparePreview({ requestPath, evidencePath, candidateRoot, predecessorZip, predecessorRoot, sourceZip, certificateZip, output, python = 'python3' }) {
  const {runPreviewSourcePhase}=await import('./financial-preview-source-phase.mjs');
  const request = parsePreviewRequest(json(requestPath)), evidenceBytes = readFileSync(evidencePath);
  if (evidenceBytes.length > 4 * 1024 * 1024) throw Error('Preview evidence exceeds bounded size');
  const evidence = JSON.parse(evidenceBytes);
  const certified=request.schema_version===CERTIFIED_PREVIEW_SCHEMA;
  exact(evidence, ['live', 'predecessor_artifact', 'source',...(certified?['certifier']:[])], 'preview evidence');
  if(certified!==Boolean(certificateZip))throw Error('Certificate ZIP requires an explicit v2 certified preview request');
  verifyCandidateTree(candidateRoot, request.candidate_ui);
  const verifiedSource = certified
    ? verifyRecordedCertifiedSource(request.correction.source,evidence.source,evidence.certifier,request.source_validation.certificate,certificateZip)
    : verifyRecordedSource(request.correction.source, evidence.source, request.source_policy);
  const controllerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  if (git(controllerRoot, ['status', '--porcelain', '--untracked-files=no'])) throw Error('Preview controller must be committed and clean');
  const controller = { sha: git(controllerRoot, ['rev-parse', 'HEAD']), tree: git(controllerRoot, ['rev-parse', 'HEAD^{tree}']) };
  output = resolve(output);
  if (existsSync(output)) throw Error('Preview output must be a new directory');
  mkdirSync(output, { recursive: true });
  const evaluatedAt = new Date().toISOString();
  write(join(output, 'request.json'), request);
  writeFileSync(join(output, 'evidence.json'), evidenceBytes);
  if(certified){const archive=join(output,'original-certification');mkdirSync(archive);cpSync(certificateZip,join(archive,'artifact.zip'));
    if(sha256(readFileSync(join(archive,'artifact.zip')))!==request.source_validation.certificate.artifact_sha256)throw Error('Copied certificate ZIP changed');}
  const predecessorArchive = join(output, 'original-predecessor');
  mkdirSync(predecessorArchive);
  cpSync(predecessorZip, join(predecessorArchive, 'artifact.zip'));
  const live = evidence.live, artifact = evidence.predecessor_artifact;
  const predecessor = predecessorRoot ? resolve(predecessorRoot) : join(output, 'predecessor');
  if (predecessorRoot) verifyExistingPredecessor(join(predecessorArchive, 'artifact.zip'), predecessor, artifact);
  else {
    downloadArtifact(artifact, predecessorArchive, bootstrap.repository);
    verifyArchive({ manifestHash: live.manifestHash }, join(predecessorArchive, 'artifact.tar'));
    mkdirSync(predecessor);
    execFileSync('tar', ['-xf', join(predecessorArchive, 'artifact.tar'), '-C', predecessor], { stdio: 'pipe' });
  }
  const prior = verifyPredecessor(predecessor, live, artifact, request.correction.previous_publication_identity);
  // Keep the exact original ZIP. Its redundant unpacked TAR is unnecessary
  // after verification and would cost another full predecessor-sized copy.
  rmSync(join(predecessorArchive, 'artifact.tar'), { force: true });
  const sourceRoot = join(output, 'original-source'); mkdirSync(sourceRoot);
  cpSync(sourceZip, join(sourceRoot, 'source.zip'));
  const sourceFiles = restoreCorrectionSource(request.correction.source, sourceRoot, verifiedSource);
  if (request.source_policy === 'terminal_partial_receipts') verifyPartialPreviewCycle(request.correction.source, sourceFiles);
  if(certified)verifyCertifiedPreviewCycle(request.correction.source,sourceFiles,verifiedSource.certification);
  const checkout = join(output, 'candidate-source'); mkdirSync(checkout);
  const candidateTar = join(output, 'candidate-source.tar');
  execFileSync('git', ['-C', candidateRoot, 'archive', '--format=tar', '-o', candidateTar, request.candidate_ui.sha, 'frontend', 'contracts', 'data/ibd_reference'], { stdio: 'pipe' });
  execFileSync('tar', ['-xf', candidateTar, '-C', checkout], { stdio: 'pipe' });
  const frontend = join(checkout, 'frontend');
  await verifyConsumerCapability(frontend);
  symlinkSync(resolve(candidateRoot, 'frontend/node_modules'), join(frontend, 'node_modules'), 'dir');
  const publicRoot = join(frontend, 'public'); mkdirSync(publicRoot, { recursive: true });
  copyData(predecessor, publicRoot);
  const baseline = join(output, 'baseline');
  build(frontend, baseline, evaluatedAt);
  const baselineCoverage = await coverage(baseline, frontend, live);
  // Finish the complete baseline proof before retaining either large native
  // projection or another decoded copy of the target research universe.
  const baselineEquality = await compareCandidateBaselineData(predecessor, baseline, frontend, {auditDirectory:join(output,'verification-phases','baseline')});
  const target = join(output, 'target-base.json');
  await writeTargetBase(baseline,frontend,target);
  const source = request.correction.source;
  const projectionResult = JSON.parse(execFileSync(python, [join(controllerRoot, certified ? NATIVE_PROJECTOR_PATH : 'backend/app/scripts/export_statement_projection.py'),
    '--archive', join(sourceFiles, 'archive'), '--archive-sha256', source.archive_manifest_sha256,
    '--base', join(sourceFiles, 'base.json'), '--cohort', join(sourceFiles, 'cohort.json'), '--cohort-sha256', source.cohort_sha256,
    '--target-base', target, '--target-base-sha256', sha256(readFileSync(target)),
    '--target-publication-identity', live.identity, '--evaluated-at', evaluatedAt, '--output-dir', join(output, 'projection')],
  { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PYTHONPATH: join(controllerRoot, 'backend'), LITELLM_LOCAL_MODEL_COST_MAP: 'true' } }));
  if(certified && (![projectionResult.projection_path,projectionResult.source_projection_path].every(path=>typeof path==='string'&&resolve(path).startsWith(resolve(output,'projection')+sep))
    || !hash(projectionResult.source_projection_sha256)))throw Error('Native preview must retain both immutable destination projections');
  const {sourceStatus,selected,comparison,financial}=runPreviewSourcePhase({schema_version:'financial-preview-source-phase-v1',kind:'projection_metadata',
    projection_path:projectionResult.projection_path,projection_sha256:projectionResult.projection_sha256,request,source_evidence:evidence.source,
    source_files:sourceFiles,certification:verifiedSource.certification??null,controller_root:controllerRoot,projection_result:projectionResult,
    evaluated_at:evaluatedAt,previous_financial_generation:live.receipt?.financial_generation||'legacy-none'},
    {auditDirectory:join(output,'verification-phases','projection-metadata')});
  write(join(output, 'source-outcome.json'), sourceStatus);
  copyData(baseline, publicRoot);
  const corrected = join(output, 'corrected');
  build(frontend, corrected, evaluatedAt, { FINANCIAL_CORRECTION_PROJECTION: projectionResult.projection_path,
    FINANCIAL_CORRECTION_SHA256: projectionResult.projection_sha256, FINANCIAL_CORRECTION_TARGET_IDENTITY: live.identity,
    FINANCIAL_CORRECTION_TARGET_BASE_SHA256: sha256(readFileSync(target)) });
  const correctedCoverage = await coverage(corrected, frontend, live);
  const compatibility=runPreviewSourcePhase({schema_version:'financial-preview-source-phase-v1',kind:'compatibility',
    projection_path:projectionResult.projection_path,projection_sha256:projectionResult.projection_sha256,frontend_root:frontend,data_root:corrected,
    data_inventory_sha256:inventoryDigest(dataInventory(corrected))},{auditDirectory:join(output,'verification-phases','compatibility')});
  const equality = comparePreviewDataIsolated(baseline, corrected, frontend, comparison, {evaluatedAt,auditDirectory:join(output,'verification-phases','correction')});
  const uiDigest = inventoryDigest(uiInventory(corrected));
  if (uiDigest !== inventoryDigest(uiInventory(baseline))) throw Error('Baseline and corrected candidate UI bytes differ');
  if (inventoryDigest(dataInventory(predecessor)) !== prior.data_inventory_sha256 || inventoryDigest(uiInventory(predecessor)) !== prior.ui_digest) throw Error('Predecessor input changed during preview');
  const report = { source_outcome: sourceStatus, baseline_equality: baselineEquality, correction_equality: equality, baseline_coverage: baselineCoverage, corrected_coverage: correctedCoverage, compatibility };
  write(join(output, 'verification.json'), report);
  const receipt = { schema_version: request.schema_version, ...selected, kind: 'unpublished_financial_candidate', publication_authority: 'none',
    verification_basis: 'local_bytes_and_recorded_remote_evidence_requires_live_revalidation', candidate_ui: { ...request.candidate_ui, digest: uiDigest },
    controller, previous_publication: prior, source, source_outcome: sourceStatus, source_evidence_sha256: sha256(evidenceBytes),
    financial,
    bundles: { baseline_data_sha256: inventoryDigest(dataInventory(baseline)), corrected_data_sha256: inventoryDigest(dataInventory(corrected)) },
    verification_sha256: sha256(readFileSync(join(output, 'verification.json'))) };
  validatePreviewReceipt(receipt);
  write(join(output, 'preview-receipt.json'), receipt);
  writeFileSync(join(output, 'UNPUBLISHED.txt'), 'LOCAL REVIEW ONLY. This artifact is not public and grants no publication authority. No CI, Design Acceptance, live-state or durable-backup approval is implied.\n');
  rmSync(join(frontend, 'node_modules'));
  // No publication.json is ever generated. The receipt lives outside both
  // bundles and can never pass validateReceipt/validateCorrectionReceipt.
  return { output, receipt_sha256: sha256(readFileSync(join(output, 'preview-receipt.json'))), receipt };
}

export function validatePreviewReceipt(value) {
  const certified=value.schema_version===CERTIFIED_PREVIEW_SCHEMA;
  exact(value, ['schema_version',...(certified?['source_validation','destination_projection']:[]), 'kind', 'publication_authority', 'verification_basis', 'candidate_ui', 'controller', 'previous_publication', 'source', 'source_outcome', 'source_evidence_sha256', 'financial', 'bundles', 'verification_sha256'], 'preview receipt');
  if (![PREVIEW_SCHEMA,CERTIFIED_PREVIEW_SCHEMA].includes(value.schema_version) || value.kind !== 'unpublished_financial_candidate' || value.publication_authority !== 'none'
    || value.verification_basis !== 'local_bytes_and_recorded_remote_evidence_requires_live_revalidation') throw Error('Preview cannot grant publication authority');
  exact(value.candidate_ui, ['sha', 'tree', 'digest'], 'preview candidate');
  exact(value.controller, ['sha', 'tree'], 'preview controller');
  exact(value.previous_publication, ['identity', 'ui_sha', 'ui_digest', 'artifact_id', 'artifact_sha256', 'data_inventory_sha256', 'price_observations_sha256'], 'preview predecessor');
  exact(value.financial, ['generation', 'projection_sha256', 'receipt_inventory_sha256', 'evaluated_at', 'knowledge_basis', 'point_in_time', 'source_publication_date'], 'preview financial');
  if (!sha(value.candidate_ui.sha) || !sha(value.candidate_ui.tree) || !hash(value.candidate_ui.digest)
    || !sha(value.controller.sha) || !sha(value.controller.tree) || !hash(value.source_evidence_sha256) || !hash(value.verification_sha256)) throw Error('Invalid preview code/evidence identity');
  const prior = value.previous_publication;
  if (!sha(prior.ui_sha) || !['ui_digest', 'artifact_sha256', 'data_inventory_sha256', 'price_observations_sha256'].every(key => hash(prior[key]))
    || !Number.isSafeInteger(prior.artifact_id) || prior.artifact_id <= 0) throw Error('Invalid preview predecessor binding');
  exact(value.source_outcome, ['policy', 'run', 'job', 'reported_batch', 'reported_cycle', 'recomputed'], 'preview source outcome');
  const outcome = value.source_outcome, expectedConclusion = certified ? value.source_validation?.certificate?.source_execution?.producer_run_conclusion : outcome.policy === 'successful_capture' ? 'success' : 'failure';
  exact(outcome.run, ['id', 'attempt', 'status', 'conclusion'], 'preview producer outcome');
  exact(outcome.job, ['id', 'attempt', 'status', 'conclusion', 'failed_steps'], 'preview job outcome');
  exact(outcome.recomputed, ['symbols', 'selected_receipts', 'field_reason_counts'], 'preview recomputed counts');
  if (outcome.reported_batch) exact(outcome.reported_batch, ['sha256', 'exit_code', 'provider_stop', 'execution_stop', 'counts'], 'preview reported batch');
  if (outcome.reported_cycle) exact(outcome.reported_cycle, ['sha256', 'phase', 'exit_code', 'archive_manifest_sha256', 'base_artifact_sha256', 'code_revision', 'provider_state_before', 'published', 'retained_receipts', 'retained_symbols'], 'preview reported cycle');
  if (outcome.run?.id !== value.source.run_id || outcome.run?.attempt !== value.source.run_attempt || outcome.run?.status !== 'completed' || outcome.run?.conclusion !== expectedConclusion
    || outcome.job?.attempt !== value.source.run_attempt || outcome.job?.status !== 'completed' || outcome.job?.conclusion !== expectedConclusion
    || !Number.isSafeInteger(outcome.job.id) || outcome.job.id <= 0 || !Array.isArray(outcome.job.failed_steps)
    || (outcome.policy === 'terminal_partial_receipts' && (outcome.reported_batch?.exit_code !== 3 || outcome.job.failed_steps.length !== 1))
    || !Number.isSafeInteger(outcome.recomputed.symbols) || outcome.recomputed.symbols <= 0
    || !Number.isSafeInteger(outcome.recomputed.selected_receipts) || outcome.recomputed.selected_receipts <= 0
    || !outcome.recomputed.field_reason_counts || Object.values(outcome.recomputed.field_reason_counts).some(count => !Number.isSafeInteger(count) || count < 0)
    || (outcome.reported_batch && !hash(outcome.reported_batch.sha256))) throw Error('Preview source outcome cannot claim successful capture');
  if (outcome.policy === 'terminal_partial_receipts' && (!outcome.reported_cycle || !hash(outcome.reported_cycle.sha256)
    || outcome.reported_cycle.phase !== 'completed' || outcome.reported_cycle.exit_code !== 3 || outcome.reported_cycle.published !== false
    || outcome.reported_cycle.archive_manifest_sha256 !== value.source.archive_manifest_sha256 || outcome.reported_cycle.base_artifact_sha256 !== value.source.acquisition_base_sha256
    || outcome.reported_cycle.code_revision !== value.source.head_sha)) throw Error('Partial preview cycle binding changed');
  if(certified)validateCertifiedPreviewReceipt(value);
  parsePreviewRequest({ schema_version: value.schema_version, kind: value.kind, ...(certified?{source_validation:{guard:value.source_validation.guard,certificate:value.source_validation.certificate.reference},destination_projection:{projector:value.destination_projection.projector,policy:value.destination_projection.policy.id}}:{source_policy:outcome.policy}), candidate_ui: { sha: value.candidate_ui.sha, tree: value.candidate_ui.tree },
    correction: { schema_version: contract.schema_version, kind: contract.kind, reason: contract.reason, previous_publication_identity: value.previous_publication.identity, source: value.source } });
  exact(value.bundles, ['baseline_data_sha256', 'corrected_data_sha256'], 'preview bundles');
  if (!Object.values(value.bundles).every(hash) || value.financial?.point_in_time !== false || value.financial?.source_publication_date !== null
    || value.financial?.knowledge_basis !== contract.knowledge_basis || !hash(value.financial?.generation)
    || !hash(value.financial?.projection_sha256) || !hash(value.financial?.receipt_inventory_sha256)
    || !Number.isFinite(Date.parse(value.financial?.evaluated_at))) throw Error('Invalid preview financial binding');
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), options = {};
  const names = { '--request': 'requestPath', '--evidence': 'evidencePath', '--candidate-root': 'candidateRoot', '--predecessor-zip': 'predecessorZip', '--predecessor-root': 'predecessorRoot', '--source-zip': 'sourceZip', '--certificate-zip':'certificateZip', '--output': 'output', '--python': 'python' };
  if (args.shift() !== 'prepare') throw Error('Expected candidate preview prepare');
  while (args.length) { const key = names[args.shift()], value = args.shift(); if (!key || !value || options[key]) throw Error('Invalid preview argument'); options[key] = value; }
  if (Object.values(names).filter(key => !['python', 'predecessorRoot','certificateZip'].includes(key)).some(key => !options[key])) throw Error('Missing exact preview inputs');
  console.log(JSON.stringify(await preparePreview(options)));
}
