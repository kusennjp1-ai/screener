import { execFileSync } from 'node:child_process';

export const gateWorkflows = ['ci.yml', 'design-acceptance.yml'];
export const sameRepository = (run, repository) => run?.repository?.full_name === repository
  && run?.head_repository?.full_name === repository;
export const workflowPath = file => `.github/workflows/${file}`;

export function publicationDecision({ eventName, event, sha, currentSha, runs = [] }) {
  const repository = event.repository?.full_name;
  const blocked = reason => ({ publish: false, reason });
  if (!repository || event.repository.default_branch !== 'main' || !/^[a-f0-9]{40}$/.test(sha ?? '')) return blocked('Invalid repository or revision');
  if (sha !== currentSha) return blocked('Controller revision is no longer current main');
  const trigger = event.workflow_run;
  if (eventName !== 'workflow_dispatch' && (eventName !== 'workflow_run' || !sameRepository(trigger, repository)
    || trigger.head_branch !== 'main' || trigger.status !== 'completed'
    || ![...gateWorkflows, 'static-site.yml'].some(file => trigger.path === workflowPath(file))
    || (trigger.path !== workflowPath('static-site.yml') && trigger.event !== 'push')
    || (trigger.path === workflowPath('static-site.yml') && !['schedule', 'workflow_dispatch'].includes(trigger.event)))) {
    return blocked('Untrusted publication trigger');
  }
  const gates = gateWorkflows.map(file => runs.filter(run => run.path === workflowPath(file) && run.event === 'push'
    && run.head_branch === 'main' && run.head_sha === sha && sameRepository(run, repository))
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0]);
  if (gates.every(run => run?.status === 'completed' && run.conclusion === 'success' && Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0)) {
    return { publish: true, mode: 'ui', approval: { type: 'gates', sha, runs: gates.map(run => ({ id: run.id, attempt: run.run_attempt, path: run.path })) }, reason: 'Both exact-main UI gates passed' };
  }
  return { publish: true, mode: 'data', reason: 'Keep the approved live UI; validate data with its pinned code' };
}

export function githubApi(endpoint, paginate = false) {
  return JSON.parse(execFileSync('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), endpoint], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

export function checkPublication(event, sha, repository, api = githubApi) {
  const repo = api(`repos/${repository}`);
  if (repo.full_name !== repository) throw Error('Unexpected publication repository');
  let trigger;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    if (!Number.isSafeInteger(event.workflow_run?.id) || event.workflow_run.id <= 0) throw Error('Missing workflow completion identity');
    trigger = api(`repos/${repository}/actions/runs/${event.workflow_run.id}`);
  }
  const normalizedEvent = { ...event, repository: repo, workflow_run: trigger };
  const currentSha = api(`repos/${repository}/git/ref/heads/main`).object.sha;
  const runs = gateWorkflows.flatMap(file => api(`repos/${repository}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${sha}&per_page=100`, true).flatMap(page => page.workflow_runs));
  return publicationDecision({ eventName: process.env.GITHUB_EVENT_NAME, event: normalizedEvent, sha, currentSha, runs });
}
