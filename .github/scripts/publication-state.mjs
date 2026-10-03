import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { githubApi, sameRepository, workflowPath } from './publication-gate.mjs';
import bootstrapData from './approved-ui-bootstrap.json' with { type: 'json' };
import { assertPriceObservationBounds, comparePriceObservations, extractPriceObservations, priceObservationDigest } from './price-observations.mjs';

export const bootstrap = bootstrapData;
function approvedPriceObservations() {
  if (priceObservationDigest(bootstrap.approved_price_observations) !== bootstrap.approved_price_observations_sha256) throw Error('Pinned price observation evidence is corrupt');
  return bootstrap.approved_price_observations;
}
export const dataFiles = ['research-daily.json', 'portfolio-model.json', 'qualification-audit.json', 'ibd-reference.json'];
export const isData = path => path.startsWith('static-data/') || dataFiles.includes(path);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const inventoryDigest = files => sha256(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
export const safePath = path => typeof path === 'string' && /^[A-Za-z0-9._/-]+$/.test(path) && !path.startsWith('/') && !path.includes('\\')
  && !path.includes('?') && !path.includes('#') && !path.split('/').some(part => !part || part === '.' || part === '..');

export function uiInventory(root) {
  const files = {};
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (!safePath(path)) throw Error('Unsafe publication UI path');
      if (isData(path) || path === 'static-data' || path === 'publication.json') continue;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`);
      else if (entry.isFile()) files[path] = sha256(readFileSync(join(directory, entry.name)));
      else throw Error('Publication UI must not contain links');
    }
  };
  visit(root);
  return files;
}

const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function dataInventoryDigest(root) {
  const files = {};
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) { if (path === 'static-data' || path.startsWith('static-data/')) walk(join(directory, entry.name), `${path}/`); }
      else if (isData(path)) {
        if (!entry.isFile()) throw Error('Migration data must contain only regular files');
        files[path] = sha256(readFileSync(join(directory, entry.name)));
      }
    }
  };
  walk(root);
  return inventoryDigest(files);
}

export function dataChronology(manifest) {
  if (!manifest || !validDay(manifest.as_of_date)) return null;
  const markets = manifest.markets;
  if (!markets || typeof markets !== 'object' || !Object.keys(markets).length || !Array.isArray(manifest.supported_markets)
    || new Set(manifest.supported_markets).size !== Object.keys(markets).length || manifest.supported_markets.length !== Object.keys(markets).length || manifest.supported_markets.some(key => !markets[key])
    || !markets[manifest.default_market] || manifest.as_of_date !== markets[manifest.default_market].as_of_date) return null;
  const observations = { as_of_date: Date.parse(manifest.as_of_date) };
  const provenance = {};
  for (const [key, market] of Object.entries(markets)) {
    if (!market || !validDay(market.as_of_date)) return null;
    observations[`${key}.as_of_date`] = Date.parse(market.as_of_date);
    for (const field of ['scan_as_of_date', 'breadth_latest_date', 'groups_latest_date']) {
      const value = market.freshness?.[field];
      if (value != null) {
        if (!validDay(value)) return null;
        observations[`${key}.${field}`] = Date.parse(value);
      }
    }
    for (const field of ['scan_published_at', 'prices_generated_at']) {
      const value = market.freshness?.[field];
      if (value != null) {
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
        provenance[`${key}.${field}`] = Date.parse(value);
      }
    }
  }
  return { observations, provenance };
}
export function compareData(candidate, published) {
  const before = dataChronology(published), after = dataChronology(candidate);
  if (!before || !after) return 'unknown';
  for (const group of ['observations', 'provenance']) {
    if (Object.entries(before[group]).some(([key, value]) => after[group][key] == null || after[group][key] < value)) return 'regression';
  }
  // An export/rebuild time is never evidence of a new trading observation.
  return Object.entries(before.observations).some(([key, value]) => after.observations[key] > value) ? 'advance' : 'equal';
}

const positive = value => Number.isSafeInteger(value) && value > 0;
export function validateReceipt(receipt) {
  const prices = comparePriceObservations(receipt?.price_observations, receipt?.known_price_dates);
  if (prices.regressions.length || priceObservationDigest(prices.knownDates) !== priceObservationDigest(receipt.known_price_dates)) throw Error('Invalid retained price observation ledger');
  const universe = receipt?.verification_universe;
  if (!universe || universe.minimum_target !== 0.9 || !validDay(universe.as_of_date)
    || !Number.isSafeInteger(universe.total) || universe.total <= 0 || !Number.isSafeInteger(universe.verified)
    || universe.verified < 0 || universe.verified > universe.total || universe.verified / universe.total < 0.9
    || !Array.isArray(universe.required_symbols) || universe.required_symbols.length !== universe.total
    || new Set(universe.required_symbols).size !== universe.total
    || universe.required_symbols.some(symbol => typeof symbol !== 'string' || !symbol || symbol.trim() !== symbol)) {
    throw Error('Missing or invalid approved verification universe');
  }
  if (receipt?.schema !== 1 || !/^[a-f0-9]{40}$/.test(receipt.ui_sha || '') || !positive(receipt.run_id) || !positive(receipt.run_attempt)
    || receipt.artifact_name !== `github-pages-${receipt.run_id}-${receipt.run_attempt}` || !/^[a-f0-9]{64}$/.test(receipt.data_manifest_sha256 || '')
    || !receipt.ui_files || !Object.keys(receipt.ui_files).length || !receipt.ui_files['index.html'] || !receipt.ui_files['sw.js']
    || Object.entries(receipt.ui_files).some(([path, hash]) => !safePath(path) || isData(path) || path === 'publication.json' || !/^[a-f0-9]{64}$/.test(hash))
    || receipt.ui_digest !== inventoryDigest(receipt.ui_files)) throw Error('Invalid or truncated live publication receipt');
  return receipt;
}

export function deploymentAnchor(reference, repository, api = githubApi) {
  const runId = reference.run_id, attempt = reference.run_attempt;
  if (!positive(runId) || !positive(attempt)) throw Error('Missing deployment anchor identity');
  const run = api(`repos/${repository}/actions/runs/${runId}/attempts/${attempt}`);
  if (run.id !== runId || run.run_attempt !== attempt || !sameRepository(run, repository) || run.head_branch !== 'main'
    || run.path !== workflowPath('research-ui-release.yml')) throw Error('Deployment anchor is not an approved publisher attempt');
  const jobs = api(`repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, true).flatMap(page => page.jobs);
  const evidence = jobs.filter(job => job.run_attempt === attempt).flatMap(job => (job.steps || []).filter(step =>
    ['Deploy to GitHub Pages', 'Run actions/deploy-pages@v4'].includes(step.name) && step.conclusion === 'success')
    .map(step => ({ job, step }))).sort((a, b) => Date.parse(b.step.completed_at) - Date.parse(a.step.completed_at))[0];
  if (!evidence || !Number.isFinite(Date.parse(evidence.step.completed_at))) throw Error('Deployment anchor lacks successful deployment evidence');
  return { runId, attempt, completed: Date.parse(evidence.step.completed_at), started: Date.parse(evidence.step.started_at),
    jobStarted: Date.parse(evidence.job.started_at), headSha: run.head_sha, runAttempt: attempt, runStarted: Date.parse(run.run_started_at) };
}

export function latestDeployment(repository, api = githubApi, anchor = null) {
  const candidates = ['research-ui-release.yml', 'static-site.yml'].flatMap(file =>
    api(`repos/${repository}/actions/workflows/${file}/runs?branch=main&per_page=100`, true).flatMap(page => page.workflow_runs));
  const deployments = anchor ? [anchor] : [];
  for (const run of candidates.filter(run => sameRepository(run, repository) && run.head_branch === 'main'
    && [workflowPath('research-ui-release.yml'), workflowPath('static-site.yml')].includes(run.path)
    && Date.parse(run.updated_at) >= (anchor?.completed ?? Date.parse('2026-10-03T01:12:40Z')))) {
    // All attempts are required: a later rerun cannot erase an earlier deployment.
    const jobs = api(`repos/${repository}/actions/runs/${run.id}/jobs?filter=all&per_page=100`, true).flatMap(page => page.jobs);
    for (const job of jobs) for (const step of job.steps || []) {
      if (['Deploy to GitHub Pages', 'Run actions/deploy-pages@v4'].includes(step.name) && step.conclusion === 'success') {
        if (!positive(job.run_attempt) || !Number.isFinite(Date.parse(step.completed_at))) throw Error('Incomplete deployment provenance');
        deployments.push({ runId: run.id, attempt: job.run_attempt, completed: Date.parse(step.completed_at), started: Date.parse(step.started_at), jobStarted: Date.parse(job.started_at), headSha: run.head_sha, runAttempt: run.run_attempt, runStarted: Date.parse(run.run_started_at) });
      }
    }
  }
  const latest = deployments.sort((a, b) => b.completed - a.completed)[0];
  if (!latest) throw Error('No authoritative successful Pages deployment');
  if (deployments.some(item => item.completed === latest.completed && (item.runId !== latest.runId || item.attempt !== latest.attempt))) throw Error('A new deployment completed with an ambiguous publication order');
  return latest;
}

export function verifyApproval(receipt, repository, api = githubApi) {
  const approval = receipt.approval;
  if (approval?.type === 'bootstrap' && approval.sha === bootstrap.ui_sha && receipt.ui_sha === bootstrap.ui_sha && receipt.ui_digest === inventoryDigest(bootstrap.ui_files)) return;
  if (approval?.type !== 'gates' || approval.sha !== receipt.ui_sha || approval.runs?.length !== 2) throw Error('Unapproved live UI');
  for (const file of ['ci.yml', 'design-acceptance.yml']) {
    const ref = approval.runs.find(run => run.path === workflowPath(file));
    if (!positive(ref?.id) || !positive(ref?.attempt)) throw Error('Missing immutable UI gate attempt');
    const run = api(`repos/${repository}/actions/runs/${ref.id}/attempts/${ref.attempt}`);
    if (run.id !== ref.id || run.run_attempt !== ref.attempt || !sameRepository(run, repository) || run.head_branch !== 'main' || run.head_sha !== receipt.ui_sha || run.event !== 'push'
      || run.path !== workflowPath(file) || run.status !== 'completed' || run.conclusion !== 'success') throw Error('Live UI approval cannot be verified');
  }
}

export async function livePublication({ repository = bootstrap.repository, fetcher = fetch, api = githubApi, downloadTo } = {}) {
  if (repository !== bootstrap.repository) throw Error('Publication repository does not match the approved bootstrap');
  const read = async (path, optional = false) => {
    if (!safePath(path)) throw Error('Unsafe live path');
    const url = new URL(path, bootstrap.site_url);
    url.searchParams.set('publication_check', `${Date.now()}`);
    const response = await fetcher(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, redirect: 'error' });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw Error(`Cannot read current Pages ${path}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const receiptBytes = await read('publication.json', true);
  const manifestBytes = await read('static-data/manifest.json');
  const manifest = JSON.parse(manifestBytes);
  if (!dataChronology(manifest)) throw Error('Invalid live data chronology');
  const receipt = receiptBytes ? validateReceipt(JSON.parse(receiptBytes)) : null;
  const anchor = deploymentAnchor(receipt || { run_id: bootstrap.approved_run_id, run_attempt: bootstrap.approved_attempt }, repository, api);
  const latest = latestDeployment(repository, api, anchor);
  if (receipt) {
    if (receipt.run_id !== latest.runId || receipt.run_attempt !== latest.attempt) throw Error('Pages has not converged to its latest successful deployment');
    if (receipt.data_manifest_sha256 !== sha256(manifestBytes) || receipt.verification_universe.as_of_date !== manifest.markets.US?.as_of_date) throw Error('Live receipt and data disagree');
    verifyApproval(receipt, repository, api);
  } else if (latest.headSha !== bootstrap.ui_sha) throw Error('Legacy Pages is no longer the approved a9 UI');
  const uiFiles = receipt?.ui_files || bootstrap.ui_files;
  // Verify every non-data file, including HTML, service worker, icons and manifests.
  for (const [path, digest] of Object.entries(uiFiles)) {
    const bytes = await read(path);
    if (sha256(bytes) !== digest) throw Error(`Live UI differs from its approved bytes: ${path}`);
    if (downloadTo) { mkdirSync(dirname(join(downloadTo, path)), { recursive: true }); writeFileSync(join(downloadTo, path), bytes); }
  }
  const legacy = !receipt ? verifyLegacySnapshot(latest, manifestBytes, repository, api) : null;
  const priceObservations = receipt?.price_observations || legacy.priceObservations;
  // The approved snapshot is already proven publication history. Preserve its
  // absent series through migration, including receipts issued before this fix.
  // Merge maxima without rewriting current observations or manufacturing progress.
  const knownPriceDates = comparePriceObservations(receipt?.known_price_dates || priceObservations, approvedPriceObservations()).knownDates;
  assertPriceObservationBounds(priceObservations, latest.completed);
  assertPriceObservationBounds(knownPriceDates, latest.completed);
  const finalReceipt = await read('publication.json', true);
  const finalManifest = await read('static-data/manifest.json');
  if (sha256(finalReceipt || '') !== sha256(receiptBytes || '') || sha256(finalManifest) !== sha256(manifestBytes)) throw Error('Live publication changed while reading it');
  const finalDeployment = latestDeployment(repository, api, latest);
  if (latest.runId !== finalDeployment.runId || latest.attempt !== finalDeployment.attempt) throw Error('A new deployment completed while reading Pages');
  return { identity: `${latest.runId}/${latest.attempt}/${sha256(receiptBytes || '')}/${sha256(manifestBytes)}`, latest,
    receipt, legacyArtifact: legacy?.artifact || null, priceObservations, knownPriceDates, manifest, manifestHash: sha256(manifestBytes), uiSha: receipt?.ui_sha || bootstrap.ui_sha,
    verificationUniverse: receipt?.verification_universe || bootstrap.verification_universe, receiptHash: sha256(receiptBytes || ''), uiFiles, uiDigest: inventoryDigest(uiFiles), approval: receipt?.approval || { type: 'bootstrap', sha: bootstrap.ui_sha } };
}

export function downloadArtifact(artifact, directory, repository = bootstrap.repository, expectedFile = 'artifact.tar') {
  if (!positive(artifact.id)) throw Error('Missing immutable artifact ID');
  mkdirSync(directory, { recursive: true });
  const zip = join(directory, 'artifact.zip');
  if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')) throw Error('Missing immutable artifact digest');
  if (!existsSync(zip)) {
    const output = openSync(zip, 'w');
    try { execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', output, 'pipe'] }); }
    finally { closeSync(output); }
  }
  const digest = execFileSync('sha256sum', [zip], { encoding: 'utf8' }).split(' ')[0];
  if (`sha256:${digest}` !== artifact.digest) throw Error('Artifact archive digest mismatch');
  execFileSync('python3', ['-c', `import zipfile,pathlib,shutil,stat,sys
z=zipfile.ZipFile(sys.argv[1]); names=z.infolist(); expected=sys.argv[3]
assert len(names)==1 and names[0].filename==expected and not stat.S_ISLNK(names[0].external_attr>>16), 'Unexpected artifact ZIP members'
with z.open(names[0]) as src, open(pathlib.Path(sys.argv[2])/expected,'wb') as dst: shutil.copyfileobj(src,dst)
`, zip, directory, expectedFile], { stdio: 'pipe' });
  return directory;
}

export function legacyArtifactForDeployment(artifacts, latest) {
  if (!Number.isFinite(latest.jobStarted) || !Number.isFinite(latest.started)) throw Error('Legacy deployment attempt timing is incomplete');
  const matching = artifacts.filter(artifact => artifact.name === 'github-pages' && artifact.expired === false
    && artifact.workflow_run?.id === latest.runId && artifact.workflow_run?.head_sha === latest.headSha && artifact.workflow_run?.head_branch === 'main'
    && Date.parse(artifact.created_at) >= latest.jobStarted && Date.parse(artifact.created_at) <= latest.started);
  if (matching.length > 1) throw Error('Ambiguous artifacts inside the successful deployment attempt');
  return matching[0] || null;
}

function verifyLegacySnapshot(latest, manifestBytes, repository, api) {
  if (!Number.isFinite(latest.jobStarted) || !Number.isFinite(latest.started)) throw Error('Legacy deployment attempt timing is incomplete');
  const artifacts = api(`repos/${repository}/actions/runs/${latest.runId}/artifacts?per_page=100`, true).flatMap(page => page.artifacts);
  const artifact = legacyArtifactForDeployment(artifacts, latest);
  if (!artifact && latest.runId === bootstrap.approved_run_id && latest.attempt === bootstrap.approved_attempt
    && sha256(manifestBytes) === bootstrap.approved_data_manifest_sha256) {
    return { artifact: null, priceObservations: approvedPriceObservations() };
  }
  if (!artifact) throw Error('Legacy bootstrap needs its exact retained deployed artifact or the exact approved #59 snapshot');
  const directory = downloadArtifact(artifact, join(process.env.RUNNER_TEMP || '/tmp', `legacy-publication-${artifact.id}`), repository);
  const summary = JSON.parse(execFileSync('python3', ['-c', `import tarfile,hashlib,json,sys
ui={}; manifest=None; seen=set(); mutable=set(json.loads(sys.argv[2]))
with tarfile.open(sys.argv[1]) as t:
 for m in t:
  n=m.name
  while n.startswith('./'): n=n[2:]
  n=n.rstrip('/')
  if not n or n=='.': continue
  assert not n.startswith('/') and all(part not in ('','.', '..') for part in n.split('/')) and n not in seen and (m.isfile() or m.isdir()), 'Unsafe archive'
  seen.add(n)
  if not m.isfile(): continue
  if n=='static-data/manifest.json': manifest=hashlib.sha256(t.extractfile(m).read()).hexdigest()
  if n.startswith('static-data/') or n in mutable or n=='publication.json': continue
  ui[n]=hashlib.sha256(t.extractfile(m).read()).hexdigest()
print(json.dumps({'manifest':manifest,'ui':ui}))
`, join(directory, 'artifact.tar'), JSON.stringify(dataFiles)], { encoding: 'utf8' }));
  if (summary.manifest !== sha256(manifestBytes) || inventoryDigest(summary.ui) !== inventoryDigest(bootstrap.ui_files)) {
    throw Error('Legacy Pages has not converged to the approved deployed UI and data');
  }
  const observationFile = join(directory, 'verified-price-observations.json');
  let observationProof;
  if (existsSync(observationFile)) observationProof = JSON.parse(readFileSync(observationFile, 'utf8'));
  if (!observationProof || observationProof.artifact_digest !== artifact.digest
    || priceObservationDigest(observationProof.observations) !== observationProof.digest) {
    const extracted = join(directory, 'price-input');
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    try {
      execFileSync('tar', ['-xf', join(directory, 'artifact.tar'), '-C', extracted, './static-data'], { stdio: 'pipe' });
      const observations = extractPriceObservations({ dataRoot: join(extracted, 'static-data'), manifest: JSON.parse(manifestBytes) });
      observationProof = { artifact_digest: artifact.digest, observations, digest: priceObservationDigest(observations) };
      writeFileSync(observationFile, JSON.stringify(observationProof));
    } finally { rmSync(extracted, { recursive: true, force: true }); }
  }
  return { artifact: artifact, priceObservations: observationProof.observations };
}

