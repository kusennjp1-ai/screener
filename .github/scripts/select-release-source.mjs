import { pathToFileURL } from 'node:url';
import { githubApi } from './publication-gate.mjs';
import { latestPublishedRun, publishedRuns } from './select-published-runs.mjs';

export function releaseSource({ repository, automatic }, api = githubApi) {
  if (automatic) {
    // Exported data is intentionally distinct from deployed Pages evidence. A
    // later gate completion can consume exports that arrived while it was blocked.
    const exports = api(`repos/${repository}/actions/artifacts?name=static-site-data&per_page=100`, true);
    for (const id of publishedRuns(exports)) {
      const run = api(`repos/${repository}/actions/runs/${id}`);
      if (run.status === 'completed' && run.conclusion === 'success'
        && run.path === '.github/workflows/static-site.yml' && run.head_branch === 'main'
        && ['schedule', 'workflow_dispatch'].includes(run.event)
        && run.repository?.full_name === repository && run.head_repository?.full_name === repository) {
        return { runId: id, artifact: 'static-site-data' };
      }
    }
  }
  const pages = api(`repos/${repository}/actions/artifacts?name=github-pages&per_page=100`, true);
  return { runId: latestPublishedRun(pages, repository, api), artifact: 'github-pages' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = releaseSource({ repository: process.env.GITHUB_REPOSITORY, automatic: process.env.GITHUB_EVENT_NAME === 'workflow_run' });
  process.stdout.write(`${source.runId} ${source.artifact}\n`);
}
