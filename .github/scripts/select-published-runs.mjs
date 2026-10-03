// Artifact names are immutable per run/attempt. Creation time only orders input
// candidates; live publication evidence and market observation dates decide use.
export function eligibleArtifacts(pages) {
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.artifacts))) throw Error('Invalid artifact response');
  return pages.flatMap(page => page.artifacts).filter(artifact => artifact.expired === false
    && artifact.workflow_run?.head_branch === 'main' && Number.isFinite(Date.parse(artifact.created_at))
    && Number.isSafeInteger(artifact.id) && artifact.id > 0 && Number.isSafeInteger(artifact.workflow_run.id) && artifact.workflow_run.id > 0)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
export function publishedRuns(pages) {
  return [...new Set(eligibleArtifacts(pages).map(artifact => artifact.workflow_run.id))];
}
export function uniqueArtifact(pages, name, runId) {
  const matches = eligibleArtifacts(pages).filter(artifact => artifact.name === name && artifact.workflow_run.id === runId);
  if (matches.length !== 1) throw Error(`No unique retained artifact for ${name}`);
  return matches[0];
}
