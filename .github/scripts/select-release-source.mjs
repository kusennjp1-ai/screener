import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi } from './publication-gate.mjs';
import { latestPublishedRun, publishedRuns } from './select-published-runs.mjs';

function datedEvidence(manifest) {
  const dates = {};
  const add = (key, value) => {
    const timestamp = Date.parse(value);
    if (typeof value !== 'string' || !Number.isFinite(timestamp)) return false;
    dates[key] = timestamp;
    return true;
  };
  if (!add('as_of_date', manifest?.as_of_date)) return null;
  const markets = manifest.markets || { [manifest.default_market || 'US']: manifest };
  if (!Object.keys(markets).length) return null;
  for (const [market, entry] of Object.entries(markets)) {
    if (!add(`${market}.as_of_date`, entry.as_of_date)) return null;
    for (const field of ['scan_as_of_date', 'scan_published_at', 'prices_generated_at', 'breadth_latest_date', 'groups_latest_date']) {
      const value = entry.freshness?.[field];
      if (value != null && !add(`${market}.${field}`, value)) return null;
    }
  }
  return dates;
}

export function advancesPublishedData(candidate, published) {
  const before = datedEvidence(published);
  const after = datedEvidence(candidate);
  if (!before || !after) return false;
  const keys = Object.keys(before);
  // Creation/rebuild timestamps do not prove fresher market data. Preserve every
  // dated field and market already published; ties or unknown provenance keep it.
  return keys.every(key => after[key] !== undefined && after[key] >= before[key])
    && keys.some(key => after[key] > before[key]);
}

function sourceDirectory(source) {
  return join(process.env.RUNNER_TEMP || '/tmp', `release-source-${source.runId}-${source.artifact}`);
}

function downloadArchive(source, repository) {
  const directory = sourceDirectory(source);
  mkdirSync(directory, { recursive: true });
  execFileSync('gh', ['run', 'download', String(source.runId), '--repo', repository, '--name', source.artifact, '--dir', directory], { stdio: 'pipe' });
  return join(directory, 'artifact.tar');
}

function readArchive(archive, file) {
  return JSON.parse(execFileSync('tar', ['-xOf', archive, `./${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }));
}

export function loadBundle(source, repository) {
  if (source.artifact === 'static-site-data') {
    // Compare small manifests first; only download a full export once selected.
    const directory = sourceDirectory(source);
    mkdirSync(directory, { recursive: true });
    execFileSync('gh', ['run', 'download', String(source.runId), '--repo', repository, '--name', 'static-site-data-manifest', '--dir', directory], { stdio: 'pipe' });
    return { ...source, manifest: JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) };
  }
  const archive = downloadArchive(source, repository);
  const manifest = readArchive(archive, 'static-data/manifest.json');
  let receipt = null;
  try { receipt = readArchive(archive, 'publication.json'); } catch { /* Legacy publications have no receipt. */ }
  return { ...source, archive, manifest, receipt };
}

export function releaseSource({ repository, automatic, sha }, api = githubApi, load = loadBundle) {
  const pages = api(`repos/${repository}/actions/artifacts?name=github-pages&per_page=100`, true);
  const published = load({ runId: latestPublishedRun(pages, repository, api), artifact: 'github-pages' }, repository);
  if (automatic) {
    // Exported data remains distinct from deployed Pages evidence. Later gate
    // completions can consume fresh exports that arrived while they were blocked.
    const exports = api(`repos/${repository}/actions/artifacts?name=static-site-data&per_page=100`, true);
    for (const id of publishedRuns(exports)) {
      const run = api(`repos/${repository}/actions/runs/${id}`);
      if (run.status === 'completed' && run.conclusion === 'success'
        && run.path === '.github/workflows/static-site.yml' && run.head_branch === 'main'
        && ['schedule', 'workflow_dispatch'].includes(run.event)
        && run.repository?.full_name === repository && run.head_repository?.full_name === repository) {
        const candidate = load({ runId: id, artifact: 'static-site-data' }, repository);
        if (advancesPublishedData(candidate.manifest, published.manifest)) return { ...candidate, publish: true };
      }
    }
  }
  // Serialized completion events can both observe green gates. Do not rebuild
  // a revision already deployed when none of the exports advances its data.
  const duplicate = automatic && /^[a-f0-9]{40}$/.test(sha ?? '') && published.receipt?.source_sha === sha;
  return { ...published, publish: !duplicate };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = releaseSource({ repository: process.env.GITHUB_REPOSITORY, automatic: process.env.GITHUB_EVENT_NAME === 'workflow_run', sha: process.env.RELEASE_SHA });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${source.publish}\n`);
  if (source.publish) {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const extracted = join(process.env.RUNNER_TEMP || '/tmp', 'selected-release-data');
    mkdirSync(extracted, { recursive: true });
    const archive = source.archive || downloadArchive(source, process.env.GITHUB_REPOSITORY);
    if (JSON.stringify(readArchive(archive, 'static-data/manifest.json')) !== JSON.stringify(source.manifest)) {
      throw Error('Selected export does not match its dated manifest');
    }
    execFileSync('tar', ['-xf', archive, '-C', extracted, './static-data']);
    cpSync(join(extracted, 'static-data'), join(workspace, 'frontend/public/static-data'), { recursive: true });
    writeFileSync(join(process.env.RUNNER_TEMP || '/tmp', 'publication.json'), JSON.stringify({
      source_sha: process.env.RELEASE_SHA,
      data_source: { run_id: source.runId, artifact: source.artifact },
      as_of_date: source.manifest.as_of_date,
    }));
    console.log(`Restored ${source.artifact} from run ${source.runId}, data as of ${source.manifest.as_of_date}`);
  } else {
    console.log('This main revision is already published and no export advances its dated data; skipping duplicate release.');
  }
}
