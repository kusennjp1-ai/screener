// A separate successful certifier may validate an exact failed acquisition.
// Neither its successful status nor any certificate assertion is trusted alone.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from './publication-state.mjs';
import { githubApi } from './publication-gate.mjs';

const readLocal = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const contract = readLocal('../../contracts/financial_source_certification_v1.json');
const referenceContract = readLocal('../../contracts/financial_source_certificate_reference_v1.json');
const trust = readLocal('../../contracts/financial_source_certification_trust_v1.json');
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const clock = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('Invalid certification clock');
  return Date.parse(value);
};
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error(`Invalid closed ${label}`);
};
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const equal = (a, b, label) => { if (canonical(a) !== canonical(b)) throw Error(`Certificate ${label} mismatch`); };

export function parseCertificateReference(value) {
  exact(value, referenceContract.reference_keys, 'certificate reference');
  if (value.schema_version !== referenceContract.schema_version || value.repository !== 'kusennjp1-ai/screener'
    || value.workflow !== contract.certifier_workflow || !sha(value.head_sha)
    || !['run_id', 'run_attempt', 'job_id', 'artifact_id'].every(key => positive(value[key]))
    || value.artifact_name !== `financial-source-certification-${value.head_sha}-${value.run_attempt}`
    || !hash(value.artifact_sha256) || !hash(value.certificate_sha256)) throw Error('Invalid pinned certificate reference');
  return value;
}

function collect(reference, api) {
  const base = `repos/${reference.repository}/actions/runs/${reference.run_id}`;
  const run = api(`${base}/attempts/${reference.run_attempt}`);
  const inventory = (endpoint, key) => {
    const response = api(endpoint);
    if (!Number.isSafeInteger(response.total_count) || response.total_count < 0 || response.total_count > 100
      || !Array.isArray(response[key]) || response[key].length !== response.total_count) throw Error('Incomplete bounded certification API inventory');
    return response[key];
  };
  return {run, jobs: inventory(`${base}/attempts/${reference.run_attempt}/jobs?per_page=100`, 'jobs'),
    artifacts: inventory(`${base}/artifacts?per_page=100`, 'artifacts')};
}

function verifyAttempt(reference, evidence, certifier, now) {
  exact(evidence, ['run', 'jobs', 'artifacts'], 'certification API evidence');
  const {run, jobs, artifacts} = evidence, repo = reference.repository;
  const branch = certifier ? [contract.certifier_branch] : ['main', 'improve/mandatory-financial-source-recovery'];
  if (run.id !== reference.run_id || run.run_attempt !== reference.run_attempt || run.head_sha !== reference.head_sha
    || run.path !== reference.workflow || !branch.includes(run.head_branch) || run.event !== 'push' || run.status !== 'completed'
    || !(certifier ? ['success'] : ['success', 'failure']).includes(run.conclusion)
    || run.repository?.full_name !== repo || run.head_repository?.full_name !== repo
    || !positive(run.repository?.id) || run.head_repository?.id !== run.repository.id) throw Error('Certification attempt identity or conclusion mismatch');
  if (!Array.isArray(jobs) || jobs.length > 100 || !Array.isArray(artifacts) || artifacts.length > 100) throw Error('Unbounded certification API evidence');
  const matchingJobs = jobs.filter(item => item.name === (certifier ? contract.certifier_job : contract.source_job));
  if (matchingJobs.length !== 1) throw Error('Missing or duplicate certification/source job');
  const job = matchingJobs[0];
  if (!positive(job.id) || certifier && job.id !== reference.job_id || job.run_id !== reference.run_id
    || job.run_attempt !== reference.run_attempt || job.head_sha !== reference.head_sha || job.status !== 'completed'
    || job.conclusion !== run.conclusion) throw Error('Certification/source job is not exact and terminal');
  if (!(clock(run.run_started_at) <= clock(job.started_at) && clock(job.started_at) <= clock(job.completed_at)
    && clock(job.completed_at) <= now)) throw Error('Certification/source execution clocks mismatch');
  const matchingArtifacts = artifacts.filter(item => item.name === reference.artifact_name);
  if (matchingArtifacts.length !== 1) throw Error('Missing or duplicate certification/source artifact');
  const artifact = matchingArtifacts[0], binding = artifact.workflow_run;
  if (artifact.id !== reference.artifact_id || artifact.expired !== false || artifact.digest !== `sha256:${reference.artifact_sha256}`
    || !positive(artifact.size_in_bytes) || artifact.size_in_bytes > referenceContract.maximum_zip_bytes
    || binding?.id !== reference.run_id || binding.head_sha !== reference.head_sha || binding.head_branch !== run.head_branch
    || binding.repository_id !== run.repository.id || binding.head_repository_id !== run.repository.id
    || !(clock(job.started_at) <= clock(artifact.created_at) && clock(artifact.created_at) <= clock(job.completed_at))
    || artifact.expires_at != null && clock(artifact.expires_at) <= now) throw Error('Certification/source artifact does not bind exact attempt');
  return {run, job, artifact};
}

function verifyReviewedCode(reference, source, api) {
  // This controller-owned manifest was computed from reviewed local Git objects,
  // never from the downloaded certificate or its self-reported code manifest.
  const commit = api(`repos/${reference.repository}/git/commits/${reference.head_sha}`);
  const matches = trust.reviewed_requests.filter(review => review.tree_sha === commit.tree?.sha);
  if (commit.sha !== reference.head_sha || matches.length !== 1) throw Error('Certifier code tree is not independently reviewed');
  const review = matches[0];
  equal(review.request.source, source, 'reviewed request source');
  const request = {schema_version:contract.schema_version, source};
  if (sha256(canonical(request)) !== review.request.canonical_sha256) throw Error('Reviewed source request hash mismatch');
  const tree = api(`repos/${reference.repository}/git/trees/${review.tree_sha}?recursive=1`);
  if (tree.sha !== review.tree_sha || tree.truncated !== false || !Array.isArray(tree.tree)) throw Error('Incomplete reviewed certifier tree');
  const requests = tree.tree.filter(item => item.path === review.request.path);
  if (requests.length !== 1 || requests[0].type !== 'blob' || requests[0].mode !== '100644'
    || requests[0].sha !== review.request.git_blob_sha) throw Error('Certifier committed request is not independently reviewed');
  for (const [path, expected] of Object.entries(trust.files)) {
    const entries = tree.tree.filter(item => item.path === path);
    if (entries.length !== 1 || entries[0].type !== 'blob' || entries[0].mode !== '100644' || entries[0].sha !== expected.git_blob_sha) throw Error(`Unreviewed certifier validation file: ${path}`);
  }
  return review;
}

export function verifyCertifiedCorrectionSource(source, certification, api = githubApi) {
  exact(certification, ['reference', 'certificateZipPath'], 'correction certification input');
  const reference = parseCertificateReference(certification.reference);
  if (typeof certification.certificateZipPath !== 'string' || !certification.certificateZipPath) throw Error('Missing local certificate ZIP');
  const now = Date.now(), certified = verifyAttempt(reference, collect(reference, api), true, now);
  const review = verifyReviewedCode(reference, source, api);
  const path = certification.certificateZipPath, stat = statSync(path);
  if (!stat.isFile() || stat.size !== certified.artifact.size_in_bytes || stat.size > referenceContract.maximum_zip_bytes
    || sha256(readFileSync(path)) !== reference.artifact_sha256) throw Error('Certificate ZIP digest or length mismatch');
  // Closed schema, duplicate-key rejection, safe bounded ZIP members and every
  // body hash are checked by local code; the certificate cannot select a schema.
  const result = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('./verify-certified-correction-archive.py', import.meta.url)), path, reference.certificate_sha256],
    {encoding:'utf8', maxBuffer:16 * 1024 * 1024}));
  const {certificate, source_api_evidence: recorded} = result;
  equal(certificate.source, source, 'requested producer identity');
  if (certificate.bindings.request_sha256 !== review.request.canonical_sha256) throw Error('Certificate does not bind reviewed source request');
  if (certificate.validation.code_sha !== reference.head_sha) throw Error('Certificate validation head mismatch');
  const evaluated = clock(certificate.evaluated_at);
  if (!(clock(certified.job.started_at) <= evaluated && evaluated <= clock(certified.artifact.created_at))) throw Error('Certificate evaluation is outside certifier attempt');
  // Re-read original producer independently. A local transcript never supplies
  // current API authority, and the failed producer must remain failed.
  const original = verifyAttempt(source, collect(source, api), false, now);
  const saved = verifyAttempt(source, recorded, false, now);
  for (const key of ['run', 'job']) {
    for (const field of ['id', 'run_attempt', 'head_sha', 'status', 'conclusion', ...(key === 'job' ? ['started_at', 'completed_at'] : ['run_started_at'])]) equal(saved[key][field], original[key][field], `original ${key}.${field}`);
  }
  for (const field of ['id', 'name', 'digest', 'size_in_bytes', 'created_at', 'workflow_run']) equal(saved.artifact[field], original.artifact[field], `original artifact.${field}`);
  if (certificate.source_execution.producer_run_conclusion !== original.run.conclusion
    || certificate.source_execution.producer_job_conclusion !== original.job.conclusion
    || certificate.source_execution.producer_job_id !== original.job.id
    || (certificate.source_execution.producer_exit_code === 0) !== (original.run.conclusion === 'success')
    || clock(original.job.completed_at) > evaluated) throw Error('Certificate changed original producer outcome or clocks');
  return {artifact: original.artifact,
    job: {id:original.job.id, run_id:source.run_id, run_attempt:source.run_attempt, name:original.job.name, conclusion:original.job.conclusion},
    certification: {reference, authority:referenceContract.authority, publication_authority:'none',
      reviewed_source_request: {tree_sha:review.tree_sha, request_sha256:review.request.canonical_sha256, request_git_blob_sha:review.request.git_blob_sha},
      certifier_job: {id:certified.job.id, run_id:reference.run_id, run_attempt:reference.run_attempt, name:certified.job.name, conclusion:certified.job.conclusion},
      source_execution:certificate.source_execution, source_timestamp_bounds:certificate.projection.source_timestamp_bounds,
      bindings:certificate.bindings, validation:certificate.validation, projection:certificate.projection}};
}
