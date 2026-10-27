// Two-phase Design lifecycle, without substituting or redating captured data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi } from '../../.github/scripts/publication-gate.mjs';
import { checkedScreeningPriority, screeningPriorityBinding } from './screening-priority-acceptance.mjs';
import { BASELINE, CAPTURE_SCHEMA, MAX_PACKAGE, safePath, REPOSITORY, WORKFLOW, canonical, hash, regular, materialSourceDigest,
  readPriorReview, verifyStoredMeasurement, requireRepresentationContract, verifyPackage, verifyProducer, historicalReviewResult } from './reviewed-design-capture.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const root = () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const output = (env, key, value) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`); };
export function currentConsumer(repo, env = process.env) {
  assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_JOB === 'design-acceptance'
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${WORKFLOW}@${env.GITHUB_REF}`, 'Authenticated Design consumer required');
  assert(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '')
    && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') && git(repo, 'rev-parse', 'HEAD') === env.GITHUB_SHA, 'Invalid current Design run/checkout');
  return { repository: REPOSITORY, workflow_path: WORKFLOW, head_sha: env.GITHUB_SHA, run_id: Number(env.GITHUB_RUN_ID), run_attempt: Number(env.GITHUB_RUN_ATTEMPT) };
}
export const captureConfigurationDigest = (env = process.env) => hash(canonical({ baseline_sha: env.BASELINE_REF || BASELINE, research_quote_url: env.DESIGN_RESEARCH_QUOTE_URL || '' }));
const mainPush = env => env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main' && (env.BASELINE_REF || BASELINE) === BASELINE;
export function selectPriorCapture(repo, env = process.env) {
  currentConsumer(repo, env);
  if (!mainPush(env)) { output(env, 'reuse', 'false'); return { reuse: false, reason: 'Fresh capture required outside default-baseline main push' }; }
  const prior = readPriorReview(repo, env.GITHUB_SHA);
  const eligible = prior?.eligible && prior.reference.configuration_sha256 === captureConfigurationDigest(env);
  const result = { reuse: Boolean(eligible), reason: !prior ? 'No explicit prior-capture review' : eligible ? 'Exact material source has an explicit prior-capture review' : 'Material source or capture configuration changed; fresh capture required' };
  output(env, 'reuse', String(result.reuse));
  return result;
}

export function stageReviewableCapture(repo, env = process.env) {
  const consumer = currentConsumer(repo, env);
  assert(mainPush(env) && env.RUNNER_TEMP && resolve(env.RUNNER_TEMP) === env.RUNNER_TEMP, 'Reviewable packages require genuine default-baseline main push');
  const source = join(repo, 'frontend/test-results/design-review'), baselineRoot = join(env.RUNNER_TEMP, 'design-baseline/frontend/dist');
  assert(git(join(env.RUNNER_TEMP, 'design-baseline'), 'rev-parse', 'HEAD') === BASELINE, 'Actual comparison baseline changed');
  const report = JSON.parse(regular(source, 'report.json'));
  const options = { report, output: source, currentRoot: join(repo, 'frontend/dist'), baselineRoot, inputBasis: env.DESIGN_INPUT_BASIS, env };
  if (!screeningPriorityBinding({ ...options, commit: report.commit, limited: Boolean(report.assessment_mode) })) { output(env, 'staged', 'false'); return { skipped: 'Strict candidate/limited flow, not an ordinary/carry prior-capture producer' }; }
  checkedScreeningPriority(options);
  const measured = verifyStoredMeasurement(source), provenance = regular(env.RUNNER_TEMP, 'design-input-provenance.json');
  requireRepresentationContract(repo, consumer.head_sha, measured.completion);
  assert(hash(provenance) === measured.binding.provenance_sha256 && measured.binding.commit === consumer.head_sha, 'Prepared input differs from completed capture');
  const target = join(env.RUNNER_TEMP, 'reviewable-design-capture');
  assert(!existsSync(target), 'Refuse to reuse a capture staging directory'); mkdirSync(target);
  const files = stageCaptureFiles(source, target, measured.paths);
  writeFileSync(join(target, 'input-provenance.json'), provenance, { flag: 'wx' }); files['input-provenance.json'] = { sha256: hash(provenance), bytes: provenance.length };
  const envelope = { schema: CAPTURE_SCHEMA, publication_authority: 'none', financial_admission: false,
    producer: { repository: REPOSITORY, workflow_path: WORKFLOW, event: 'push', ref: 'refs/heads/main', head_sha: consumer.head_sha, checkout_sha: consumer.head_sha,
      tree: git(repo, 'rev-parse', 'HEAD^{tree}'), run_id: consumer.run_id, run_attempt: consumer.run_attempt },
    baseline_sha: BASELINE, source_inventory_sha256: materialSourceDigest(repo, consumer.head_sha), configuration_sha256: captureConfigurationDigest(env), created_at: new Date().toISOString(), files };
  assert(Object.values(files).reduce((sum, file) => sum + file.bytes, 0) + Buffer.byteLength(canonical(envelope)) <= MAX_PACKAGE, 'Capture package exceeds bound');
  writeFileSync(join(target, 'capture-envelope.json'), canonical(envelope), { flag: 'wx' });
  output(env, 'staged', 'true');
  return { package: target, source_inventory_sha256: envelope.source_inventory_sha256, measured_at: report.measured_at, completed_at: measured.completion.completed_at };
}

export function stageCaptureFiles(source, target, paths) {
  const files = {};
  for (const path of paths) {
    assert(safePath(path) && (!path.includes('/') || path.startsWith('baseline-representation/')), 'Unsupported nested capture path');
    const bytes = regular(source, path); mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), bytes, { flag: 'wx' }); files[path] = { sha256: hash(bytes), bytes: bytes.length };
  }
  return files;
}

export function extractReviewableZip(archive, target) {
  assert(!existsSync(target), 'Extraction target must not already exist');
  execFileSync('python3', ['-c', `import pathlib,re,stat,sys,zipfile,shutil
archive,target=map(pathlib.Path,sys.argv[1:3]); limit=int(sys.argv[3]); root=target
assert archive.is_file() and archive.stat().st_size<=limit, 'ZIP size exceeds bound'
with zipfile.ZipFile(archive) as z:
 entries=z.infolist(); assert 0<len(entries)<=1000, 'Unbounded ZIP member count'
 seen=set(); total=0
 for item in entries:
  name=item.filename; assert re.fullmatch(r'[A-Za-z0-9._/-]+',name) and not any(p in ('','.','..') for p in name.rstrip('/').split('/')), 'Unsafe ZIP path'
  assert name not in seen and not item.flag_bits&1, 'Duplicate or encrypted ZIP member'; seen.add(name)
  mode=item.external_attr>>16
  assert not stat.S_ISLNK(mode) and (stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR)), 'Special ZIP member'
  assert item.file_size<=64*1024*1024, 'Oversized ZIP member'; total+=item.file_size
  assert total<=limit, 'Expanded ZIP exceeds bound'
  if item.is_dir(): assert item.file_size==0, 'Nonempty directory entry'
 root.mkdir()
 for item in entries:
  path=root/item.filename
  if item.is_dir(): path.mkdir(parents=True,exist_ok=True); continue
  path.parent.mkdir(parents=True,exist_ok=True)
  with z.open(item) as source,path.open('xb') as output: shutil.copyfileobj(source,output)
`, archive, target, String(MAX_PACKAGE)], { stdio: 'pipe' });
}

export async function acceptPriorCapture(repo, env = process.env, { api = githubApi, download } = {}) {
  const consumer = currentConsumer(repo, env);
  assert(mainPush(env), 'Prior-capture acceptance is restricted to default-baseline main push');
  const prior = readPriorReview(repo, consumer.head_sha);
  assert(prior?.eligible && prior.reference.configuration_sha256 === captureConfigurationDigest(env), 'No eligible committed prior-capture review');
  const { reference, review, review_sha256: reviewHash } = prior;
  assert(reference.run_id !== consumer.run_id, 'A producer cannot review itself as prior capture');
  const base = `repos/${REPOSITORY}`, run = await api(`${base}/actions/runs/${reference.run_id}/attempts/${reference.run_attempt}`);
  const artifact = await api(`${base}/actions/artifacts/${reference.artifact_id}`), workflow = await api(`${base}/actions/workflows/design-acceptance.yml`);
  const jobs = (await api(`${base}/actions/runs/${reference.run_id}/attempts/${reference.run_attempt}/jobs?per_page=100`, true)).flatMap(page => page.jobs);
  assert(run.id === reference.run_id && run.run_attempt === reference.run_attempt && run.status === 'completed' && ['success', 'failure'].includes(run.conclusion)
    && artifact.id === reference.artifact_id && artifact.digest === 'sha256:' + reference.artifact_sha256 && artifact.size_in_bytes === reference.artifact_bytes
    && artifact.expired === false, 'Unverified or unfinished prior artifact');
  assert(env.RUNNER_TEMP && resolve(env.RUNNER_TEMP) === env.RUNNER_TEMP, 'Missing fixed consumer scratch root');
  const scratch = mkdtempSync(join(env.RUNNER_TEMP, 'prior-design-capture-')), zip = join(scratch, 'capture.zip'), extracted = join(scratch, 'capture');
  try {
    if (download) await download(artifact, zip);
    else { const fd = openSync(zip, 'wx'); try { execFileSync('gh', ['api', `${base}/actions/artifacts/${reference.artifact_id}/zip`], { stdio: ['ignore', fd, 'pipe'] }); } finally { closeSync(fd); } }
    const bytes = regular(scratch, 'capture.zip', MAX_PACKAGE);
    assert(bytes.length === reference.artifact_bytes && hash(bytes) === reference.artifact_sha256, 'Downloaded immutable ZIP differs');
    extractReviewableZip(zip, extracted);
    // The same-repository main history must already be in checkout fetch-depth:0.
    // No arbitrary ref fetching or alternative source substitution is performed.
    const measured = verifyPackage(extracted, reference, repo, consumer.head_sha, captureConfigurationDigest(env));
    verifyProducer({ reference, envelope: measured.envelope, completion: measured.completion, report: measured.report, run, jobs, artifact, workflow });
    assert(readPriorReview(repo, consumer.head_sha)?.review_sha256 === reviewHash, 'Review changed during verification');
    const result = historicalReviewResult({ review, reference, reviewHash, measured, consumer });
    const resultPath = join(env.RUNNER_TEMP, 'reviewed-prior-capture-result.json');
    writeFileSync(resultPath, canonical(result), { flag: 'wx' });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n## Reviewed prior capture, not a new measurement\n\nCapture run ${reference.run_id}/${reference.run_attempt}, head ${reference.checkout_sha}. Measured ${result.measured_at}; completed ${result.completed_at}. Review SHA256 ${reviewHash}. Consumer head ${consumer.head_sha}. Original strict result: ${result.image_assessment.strict_result}; performance: ${measured.assessment.performance_acceptance}. Current data and financial freshness have not been certified by this review and remain mandatory publisher checks.\n`);
    return result;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2], repo = root();
  if (command === 'select') console.log(JSON.stringify(selectPriorCapture(repo)));
  else if (command === 'package') console.log(JSON.stringify(stageReviewableCapture(repo)));
  else if (command === 'accept') { const result = await acceptPriorCapture(repo); console.log(`Reviewed prior capture ${result.capture.run_id}/${result.capture.run_attempt}; no current recapture or financial admission claimed.`); }
  else throw Error('Usage: design-capture-lifecycle.mjs select|package|accept');
}
