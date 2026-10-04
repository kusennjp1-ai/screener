// Fetch exact GitHub evidence only. No statement provider, deployment or writes.
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi } from './publication-gate.mjs';
import { sha256 } from './publication-state.mjs';

const contract = JSON.parse(readFileSync(new URL('../../contracts/financial_source_certification_v1.json', import.meta.url)));
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');

export function parseRequest(text) {
  const request = JSON.parse(text);
  if (!sameKeys(request, contract.request_keys) || request.schema_version !== contract.schema_version || !sameKeys(request.source, contract.source_keys)) throw Error('Invalid closed source certification request');
  const s = request.source;
  if (s.repository !== 'kusennjp1-ai/screener' || s.workflow !== contract.source_workflow || !/^[a-f0-9]{40}$/.test(s.head_sha ?? '')
    || !['run_id', 'run_attempt', 'artifact_id'].every(key => positive(s[key]))
    || s.artifact_name !== `financial-statement-recovery-${s.head_sha}-${s.run_attempt}`
    || !['artifact_sha256', 'archive_manifest_sha256', 'acquisition_base_sha256', 'cohort_sha256'].every(key => hash(s[key]))) throw Error('Invalid exact source certification identity');
  return request;
}

export function collectEvidence(request, api = githubApi) {
  const {source:s} = parseRequest(JSON.stringify(request));
  const run = api(`repos/${s.repository}/actions/runs/${s.run_id}/attempts/${s.run_attempt}`);
  const jobs = api(`repos/${s.repository}/actions/runs/${s.run_id}/attempts/${s.run_attempt}/jobs?per_page=100`);
  const artifacts = api(`repos/${s.repository}/actions/runs/${s.run_id}/artifacts?per_page=100`);
  for (const [value, key] of [[jobs, 'jobs'], [artifacts, 'artifacts']]) {
    if (!Number.isSafeInteger(value.total_count) || value.total_count < 0 || value.total_count > 100 || !Array.isArray(value[key]) || value[key].length !== value.total_count) throw Error('Incomplete bounded source API inventory');
  }
  if (run.id !== s.run_id || run.run_attempt !== s.run_attempt || run.head_sha !== s.head_sha || run.path !== s.workflow
    || run.status !== 'completed' || !['success', 'failure'].includes(run.conclusion)) throw Error('Exact source attempt is not terminal');
  const matches = artifacts.artifacts.filter(item => item.id === s.artifact_id && item.name === s.artifact_name);
  if (matches.length !== 1 || matches[0].digest !== `sha256:${s.artifact_sha256}` || matches[0].expired !== false || !positive(matches[0].size_in_bytes) || matches[0].size_in_bytes > 128 * 1024 * 1024) throw Error('Exact source artifact is missing or invalid');
  return {run, jobs: jobs.jobs, artifacts: artifacts.artifacts};
}

async function main() {
  const [requestPath, output] = process.argv.slice(2);
  if (!requestPath || !output) throw Error('Usage: prepare-statement-certification.mjs REQUEST NEW_OUTPUT');
  const request = parseRequest(readFileSync(resolve(requestPath), 'utf8'));
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_NAME !== contract.certifier_branch
    || process.env.GITHUB_REPOSITORY !== request.source.repository) throw Error('Certification must use its explicit branch-only context');
  const evidence = collectEvidence(request);
  const root = resolve(output); mkdirSync(root, {recursive:false});
  writeFileSync(resolve(root, 'source-api-evidence.json'), JSON.stringify(evidence, null, 2), {flag:'wx'});
  const path = resolve(root, 'source.zip'), fd = openSync(path, 'wx');
  try { execFileSync('gh', ['api', `repos/${request.source.repository}/actions/artifacts/${request.source.artifact_id}/zip`], {stdio:['ignore', fd, 'pipe']}); }
  finally { closeSync(fd); }
  if (sha256(readFileSync(path)) !== request.source.artifact_sha256) throw Error('Downloaded source artifact digest mismatch');
  console.log(JSON.stringify({source:request.source, producer_conclusion:evidence.run.conclusion}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
