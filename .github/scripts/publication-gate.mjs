import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const gateWorkflows = ['ci.yml', 'design-acceptance.yml'];
const workflowPath = file => `.github/workflows/${file}`;
const sameRepository = (run, repository) => run?.repository?.full_name === repository
  && run?.head_repository?.full_name === repository;

export function publicationDecision({ eventName, event, sha, currentSha, runs = [] }) {
  const repository = event.repository?.full_name;
  const blocked = reason => ({ publish: false, reason });
  if (!repository || event.repository.default_branch !== 'main' || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
    return blocked('Invalid publication repository or revision');
  }
  if (sha !== currentSha) return blocked('Release revision is no longer current main');
  if (eventName === 'workflow_dispatch') return { publish: true, reason: 'Manual main release' };
  const trigger = event.workflow_run;
  const isGate = gateWorkflows.some(file => trigger?.path === workflowPath(file));
  const isExport = trigger?.path === workflowPath('static-site.yml');
  if (eventName !== 'workflow_run' || !sameRepository(trigger, repository)
    || trigger.head_branch !== 'main' || trigger.status !== 'completed' || trigger.conclusion !== 'success'
    || (!isGate && !isExport) || (isGate && (trigger.event !== 'push' || trigger.head_sha !== sha))
    || (isExport && !['schedule', 'workflow_dispatch'].includes(trigger.event))) {
    return blocked('Trigger is not a successful trusted main workflow');
  }
  for (const file of gateWorkflows) {
    // Inspect the latest run, including pending/failed reruns; never search only successes.
    const latest = runs.filter(run => run.path === workflowPath(file) && run.event === 'push'
      && run.head_branch === 'main' && run.head_sha === sha && sameRepository(run, repository))
      .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
    if (latest?.status !== 'completed' || latest.conclusion !== 'success') {
      return blocked(`${file} has not succeeded for this exact main revision`);
    }
  }
  return { publish: true, reason: 'CI and Design Acceptance passed for current main' };
}

export function githubApi(endpoint, paginate = false) {
  return JSON.parse(execFileSync('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), endpoint], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

export function checkPublication(env = process.env, api = githubApi) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const sha = env.RELEASE_SHA;
  const currentSha = api(`repos/${env.GITHUB_REPOSITORY}/git/ref/heads/main`).object.sha;
  const runs = env.GITHUB_EVENT_NAME === 'workflow_run' ? gateWorkflows.flatMap(file =>
    api(`repos/${env.GITHUB_REPOSITORY}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${sha}&per_page=100`, true)
      .flatMap(page => page.workflow_runs)) : [];
  return publicationDecision({ eventName: env.GITHUB_EVENT_NAME, event, sha, currentSha, runs });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkPublication();
  console.log(result.reason);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${result.publish}\nsha=${process.env.RELEASE_SHA}\n`);
  if (process.argv.includes('--require') && !result.publish) process.exitCode = 1;
}
