import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { githubApi } from './publication-gate.mjs';

// Artifact ids and API page order do not establish creation-time order.
export function publishedRuns(pages) {
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.artifacts))) throw Error('Invalid artifact response');
  return [...new Set(pages.flatMap(page => page.artifacts)
    .filter(artifact => artifact.expired === false && artifact.workflow_run?.head_branch === 'main'
      && Number.isFinite(Date.parse(artifact.created_at)) && Number.isSafeInteger(artifact.workflow_run.id) && artifact.workflow_run.id > 0)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map(artifact => artifact.workflow_run.id))];
}

export function wasPublished(run, jobs, repository) {
  return run.status === 'completed' && run.conclusion === 'success' && run.head_branch === 'main'
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && ['.github/workflows/research-ui-release.yml', '.github/workflows/static-site.yml'].includes(run.path)
    && jobs.some(job => job.conclusion === 'success' && job.steps?.some(step =>
      ['Deploy to GitHub Pages', 'Run actions/deploy-pages@v4'].includes(step.name) && step.conclusion === 'success'));
}

export function latestPublishedRun(pages, repository, api = githubApi) {
  for (const id of publishedRuns(pages)) {
    const run = api(`repos/${repository}/actions/runs/${id}`);
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    const jobs = api(`repos/${repository}/actions/runs/${id}/jobs?per_page=100`, true).flatMap(page => page.jobs);
    if (wasPublished(run, jobs, repository)) return id;
  }
  throw Error('No verified successfully deployed artifact');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = latestPublishedRun(JSON.parse(readFileSync(0, 'utf8')), process.env.GH_REPO || process.env.GITHUB_REPOSITORY);
  process.stdout.write(`${run}\n`);
}
