import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Artifact ids and API page order do not establish creation-time order.
export function publishedRuns(pages) {
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.artifacts))) throw Error('Invalid artifact response');
  return [...new Set(pages.flatMap(page => page.artifacts)
    .filter(artifact => artifact.expired === false && artifact.workflow_run?.head_branch === 'main'
      && Number.isFinite(Date.parse(artifact.created_at)) && Number.isSafeInteger(artifact.workflow_run.id) && artifact.workflow_run.id > 0)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map(artifact => artifact.workflow_run.id))].slice(0, 8);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runs = publishedRuns(JSON.parse(readFileSync(0, 'utf8')));
  if (!runs.length) throw Error('No eligible published artifact');
  process.stdout.write(runs.join('\n') + '\n');
}
