import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPublication, githubApi, sameRepository, workflowPath } from './publication-gate.mjs';
import { eligibleArtifacts, uniqueArtifact } from './select-published-runs.mjs';
import { assertPriceObservationBounds, comparePriceObservations, extractPriceObservations, priceObservationDigest } from './price-observations.mjs';
import { bootstrap, compareData, dataFiles, dataInventoryDigest, downloadArtifact, inventoryDigest, isData, livePublication, sha256, uiInventory, validateReceipt, safePath } from './publication-state.mjs';

const scratch = () => join(process.env.RUNNER_TEMP || '/tmp', 'verified-publication');
const statePath = () => join(scratch(), 'state.json');
const repository = () => process.env.GITHUB_REPOSITORY || bootstrap.repository;
const artifactDirectory = artifact => join(scratch(), `artifact-${artifact.id}`);
export const advancesPublishedData = (candidate, published) => compareData(candidate, published) === 'advance';

export function checkedExport(artifact, pages, repo, api = githubApi, load = loadExportManifest) {
  const match = /^static-site-data-(\d+)-(\d+)$/.exec(artifact.name || '');
  if (!match || Number(match[1]) !== artifact.workflow_run.id) return null;
  const id = Number(match[1]), attempt = Number(match[2]);
  if (!Number.isSafeInteger(attempt) || attempt <= 0) return null;
  const run = api(`repos/${repo}/actions/runs/${id}/attempts/${attempt}`);
  if (run.id !== id || run.run_attempt !== attempt || !sameRepository(run, repo) || run.head_branch !== 'main' || run.path !== workflowPath('static-site.yml')
    || !['schedule', 'workflow_dispatch'].includes(run.event) || run.status !== 'completed') return null;
  const jobs = api(`repos/${repo}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`, true).flatMap(page => page.jobs);
  const job = jobs.find(job => job.name === 'combine-and-build' && job.run_attempt === attempt && job.conclusion === 'success');
  if (!job?.steps?.some(step => step.name === 'Build static frontend' && step.conclusion === 'success')) return null;
  const companion = uniqueArtifact(pages, `static-site-data-manifest-${id}-${attempt}`, id);
  for (const item of [artifact, companion]) {
    if (!Number.isFinite(Date.parse(item.created_at)) || item.workflow_run.head_sha !== run.head_sha || Date.parse(item.created_at) < Date.parse(job.started_at)
      || Date.parse(item.created_at) > Date.parse(job.completed_at) || !Number.isFinite(Date.parse(job.started_at)) || !Number.isFinite(Date.parse(job.completed_at))) {
      throw Error('Export artifact was not created by its validated attempt');
    }
  }
  const metadata = load(companion, repo);
  if (metadata.run_id !== id || metadata.run_attempt !== attempt || metadata.source_sha !== run.head_sha
    || metadata.artifact_name !== artifact.name || typeof metadata.manifest_json !== 'string' || sha256(metadata.manifest_json) !== metadata.manifest_sha256) throw Error('Export attempt and manifest provenance disagree');
  if (priceObservationDigest(metadata.price_observations) !== metadata.price_observations_sha256) throw Error('Export price observation proof is inconsistent');
  assertPriceObservationBounds(metadata.price_observations, artifact.created_at);
  return { artifact, runId: id, attempt, manifest: JSON.parse(metadata.manifest_json), manifestHash: metadata.manifest_sha256,
    priceObservations: metadata.price_observations, priceObservationsDigest: metadata.price_observations_sha256 };
}
export function loadExportManifest(artifact, repo) {
  const directory = downloadArtifact(artifact, artifactDirectory(artifact), repo, 'source.json');
  return JSON.parse(readFileSync(join(directory, 'source.json'), 'utf8'));
}

export function chooseExport(live, pages, repo, api = githubApi, load = loadExportManifest) {
  // Once all current markets/dates are preserved, an advancing candidate is safe.
  // Equal observation dates with changed payloads do not establish chronology.
  for (const artifact of eligibleArtifacts(pages)) {
    const source = checkedExport(artifact, pages, repo, api, load);
    if (source) {
      const chronology = compareData(source.manifest, live.manifest);
      const prices = comparePriceObservations(source.priceObservations, live.knownPriceDates);
      if (!['unknown', 'regression'].includes(chronology) && !prices.regressions.length && (chronology === 'advance' || prices.advances)) return source;
    }
  }
  return null;
}

function archiveMember(archive, name) {
  return execFileSync('tar', ['-xOf', archive, `./${name}`], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function verifyArchive(source, archive) {
  // Reject links, traversal, special files and duplicate paths before extraction.
  execFileSync('python3', ['-c', `import tarfile,sys,pathlib
seen=set()
with tarfile.open(sys.argv[1]) as t:
 for m in t:
  n=m.name
  while n.startswith('./'): n=n[2:]
  n=n.rstrip('/')
  if not n or n=='.': continue
  assert not n.startswith('/') and '\\\\' not in n and all(part not in ('','.', '..') for part in n.split('/')) and n not in seen, 'Unsafe or duplicate archive path'
  assert m.isfile() or m.isdir(), 'Links or special archive entries are forbidden'
  seen.add(n)
`, archive], { stdio: 'pipe' });
  if (sha256(archiveMember(archive, 'static-data/manifest.json')) !== source.manifestHash) throw Error('Archive and dated manifest disagree');
}
function materialize(source, destination, migration = false) {
  const directory = downloadArtifact(source.artifact, artifactDirectory(source.artifact), repository());
  const archive = join(directory, 'artifact.tar');
  verifyArchive(source, archive);
  if (source.receiptHash && sha256(archiveMember(archive, 'publication.json')) !== source.receiptHash) throw Error('Archive and live publication receipt disagree');
  rmSync(join(destination, 'static-data'), { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', destination, './static-data'], { stdio: 'pipe' });
  const observations = extractPriceObservations({ dataRoot: join(destination, 'static-data'), manifest: source.manifest });
  assertPriceObservationBounds(observations, source.artifact.created_at);
  if (priceObservationDigest(observations) !== source.priceObservationsDigest) throw Error('Archive price observations disagree with its exact attempt metadata');
  if (migration) {
    for (const file of dataFiles) writeFileSync(join(destination, file), archiveMember(archive, file));
    const state = readState();
    state.migrationDataDigest = dataInventoryDigest(destination);
    writeFileSync(statePath(), JSON.stringify(state));
  }
}
function publishedSource(live, pages) {
  if (live.receipt) {
    const artifact = uniqueArtifact(pages, live.receipt.artifact_name, live.receipt.run_id);
    if (artifact.workflow_run.head_sha !== live.latest.headSha || Date.parse(artifact.created_at) < live.latest.jobStarted
      || Date.parse(artifact.created_at) > live.latest.started || !Number.isFinite(live.latest.jobStarted) || !Number.isFinite(live.latest.started)) {
      throw Error('Published artifact does not belong to its successful deployment attempt');
    }
    return { artifact, runId: live.receipt.run_id, attempt: live.receipt.run_attempt, manifest: live.manifest, manifestHash: live.manifestHash, priceObservations: live.priceObservations, priceObservationsDigest: priceObservationDigest(live.priceObservations), receiptHash: live.receiptHash };
  }
  if (!live.legacyArtifact) throw Error('Legacy approved input expired; a checked advancing export is required');
  return { artifact: live.legacyArtifact, runId: live.latest.runId, attempt: live.latest.attempt, manifest: live.manifest, manifestHash: live.manifestHash, priceObservations: live.priceObservations, priceObservationsDigest: priceObservationDigest(live.priceObservations) };
}
function readState() { return JSON.parse(readFileSync(statePath(), 'utf8')); }
function output(values) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

async function plan(design = false) {
  mkdirSync(scratch(), { recursive: true });
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const sha = process.env.RELEASE_SHA;
  const decision = design ? { publish: true, mode: 'design' } : checkPublication(event, sha, repository());
  if (!decision.publish) { output({ publish: false }); console.log(decision.reason); return; }
  const uiDirectory = join(scratch(), 'live-ui');
  rmSync(uiDirectory, { recursive: true, force: true });
  const live = await livePublication({ repository: repository(), downloadTo: uiDirectory });
  const pages = githubApi(`repos/${repository()}/actions/artifacts?per_page=100`, true);
  // Install durable provenance without refreshing any currently approved byte.
  // This cannot be blocked by a newly exported but degraded candidate bundle.
  const migration = !design && !live.receipt && Boolean(live.legacyArtifact);
  const fresh = migration ? null : chooseExport(live, pages, repository());
  if (migration) { decision.mode = 'data'; decision.migration = true; }
  const automatic = process.env.GITHUB_EVENT_NAME === 'workflow_run';
  const duplicate = !design && !migration && automatic && !fresh && (decision.mode === 'data' || live.uiSha === sha);
  if (duplicate) { output({ publish: false }); console.log('No advancing data or newly verified UI to publish.'); return; }
  const source = fresh || publishedSource(live, pages);
  const sourceSha = decision.mode === 'ui' || design ? sha : live.uiSha;
  const state = { live, source, decision, sourceSha, controllerSha: sha, uiDirectory };
  writeFileSync(statePath(), JSON.stringify(state));
  if (design && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SOURCE_RUN=${source.runId}\n`);
  output({ publish: true, sha: sourceSha, mode: decision.mode, migration });
  console.log(`${decision.mode} publication uses UI ${sourceSha} and artifact ${source.artifact.id} (${fresh ? 'checked export' : 'verified live input'})`);
}
async function recheck() {
  const state = readState();
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const decision = checkPublication(event, state.controllerSha, repository());
  if (!decision.publish || (state.decision.mode === 'ui' && decision.mode !== 'ui')) throw Error('Current-main publication gates changed');
  const live = await livePublication({ repository: repository() });
  if (live.identity !== state.live.identity) throw Error('Live UI or data changed; discard this superseded publication');
  const finalManifest = JSON.parse(readFileSync('release/frontend/dist/static-data/manifest.json', 'utf8'));
  if (['regression', 'unknown'].includes(compareData(finalManifest, live.manifest))
    || ['regression', 'unknown'].includes(compareData(finalManifest, state.source.manifest))) throw Error('Final data would regress a published or selected market');
  const receipt = validateReceipt(JSON.parse(readFileSync('release/frontend/dist/publication.json', 'utf8')));
  const observed = extractPriceObservations({ dataRoot: resolve('release/frontend/dist/static-data'), manifest: finalManifest });
  assertPriceObservationBounds(observed, state.source.artifact.created_at);
  const progress = comparePriceObservations(observed, live.knownPriceDates);
  if (priceObservationDigest(receipt.known_price_dates) !== priceObservationDigest(progress.knownDates)) throw Error('Final retained price ledger differs from the proven publication history');
  if (priceObservationDigest(observed) !== priceObservationDigest(receipt.price_observations) || progress.regressions.length
    || comparePriceObservations(observed, state.source.priceObservations).regressions.length) throw Error('Final price observations regress or disagree with the receipt');
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run' && !state.decision.migration && state.sourceSha === live.uiSha
    && compareData(finalManifest, live.manifest) !== 'advance' && !progress.advances) throw Error('No observed data advance remains after preparation');
  if (receipt.ui_sha !== state.sourceSha || receipt.ui_digest !== inventoryDigest(uiInventory('release/frontend/dist'))
    || (state.decision.mode === 'data' && receipt.ui_digest !== live.uiDigest)
    || receipt.data_manifest_sha256 !== sha256(readFileSync('release/frontend/dist/static-data/manifest.json'))) {
    throw Error('Final UI/data bytes differ from the approved publication plan');
  }
}
async function verifyCoverage(frontendRoot, dataRoot, previousSymbols) {
  const manifest = JSON.parse(readFileSync(join(dataRoot, 'manifest.json'), 'utf8'));
  const researchPath = manifest.markets?.US?.assets?.research?.path;
  if (!safePath(researchPath)) throw Error('Missing safe research index for retained-universe verification');
  const { decodeResearchIndex } = await import(pathToFileURL(join(frontendRoot, 'src/static/researchTransport.js')).href);
  const index = decodeResearchIndex(JSON.parse(readFileSync(join(dataRoot, researchPath), 'utf8')));
  if (index.as_of_date !== manifest.markets.US.as_of_date) throw Error('Retained-universe research date mismatch');
  const { assessRetainedUniverse, isEligibleForPublication } = await import('./retained-universe.mjs');
  const previous = new Set(previousSymbols), charts = new Map();
  for (const row of index.rows || []) {
    if (previous.has(row.symbol) && !isEligibleForPublication(row) && safePath(row.chart_path)) {
      try { charts.set(row.symbol, JSON.parse(readFileSync(join(dataRoot, row.chart_path), 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const coverage = assessRetainedUniverse({ previousSymbols, rows: index.rows, asOfDate: index.as_of_date, charts });
  writeFileSync(join(scratch(), 'retained-universe-report.json'), JSON.stringify(coverage, null, 2));
  console.log(`Retained-universe verification: ${coverage.verified}/${coverage.total}; fully observed exits ${coverage.exits.total}; unresolved ${coverage.missing.total}`);
  if (!coverage.passed) throw Error(`Retained-universe verification below the existing 90% requirement: ${coverage.verified}/${coverage.total}; ${JSON.stringify(coverage.missing.reasons)}`);
  return coverage;
}
async function compose() {
  const state = readState(), dist = resolve('release/frontend/dist');
  if (state.decision.migration) {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    cpSync('release/frontend/public/static-data', join(dist, 'static-data'), { recursive: true });
    for (const file of dataFiles) cpSync(join('release/frontend/public', file), join(dist, file));
  }
  const coverage = await verifyCoverage(resolve('release/frontend'), join(dist, 'static-data'), state.live.verificationUniverse.required_symbols);
  if (state.decision.mode === 'data') {
    for (const entry of readdirSync(dist)) if (entry !== 'static-data' && !isData(entry)) rmSync(join(dist, entry), { recursive: true, force: true });
    cpSync(state.uiDirectory, dist, { recursive: true });
    if (inventoryDigest(uiInventory(dist)) !== state.live.uiDigest) throw Error('Data-only release changed approved UI bytes');
  }
  const finalManifest = JSON.parse(readFileSync(join(dist, 'static-data/manifest.json'), 'utf8'));
  const observed = extractPriceObservations({ dataRoot: join(dist, 'static-data'), manifest: finalManifest });
  assertPriceObservationBounds(observed, state.source.artifact.created_at);
  const prices = comparePriceObservations(observed, state.live.knownPriceDates);
  if (prices.regressions.length) throw Error('Prepared price series would move backward');
  console.log(`Actual price observations: ${Object.keys(observed).length}; absent known series ${prices.missing.length} (retained in the date ledger)`);
  const files = uiInventory(dist);
  const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const receipt = { schema: 1, run_id: runId, run_attempt: attempt, artifact_name: `github-pages-${runId}-${attempt}`,
    controller_sha: state.controllerSha, ui_sha: state.sourceSha, ui_files: files, ui_digest: inventoryDigest(files),
    approval: state.decision.mode === 'ui' ? state.decision.approval : state.live.approval,
    price_observations: observed, known_price_dates: prices.knownDates,
    verification_universe: { as_of_date: coverage.as_of_date, required_symbols: coverage.requiredSymbols, minimum_target: coverage.minimum_target, total: coverage.total, verified: coverage.verified },
    data_manifest_sha256: sha256(readFileSync(join(dist, 'static-data/manifest.json'))),
    data_source: { artifact_id: state.source.artifact.id, run_id: state.source.runId, attempt: state.source.attempt } };
  if (state.decision.migration && dataInventoryDigest(dist) !== state.migrationDataDigest) throw Error('Metadata migration changed approved data bytes');
  validateReceipt(receipt);
  writeFileSync(join(dist, 'publication.json'), JSON.stringify(receipt));
}
function exportMetadata() {
  const bytes = readFileSync('frontend/dist/static-data/manifest.json');
  const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const directory = join(process.env.RUNNER_TEMP || '/tmp', 'export-provenance');
  mkdirSync(directory, { recursive: true });
  const observations = extractPriceObservations({ dataRoot: resolve('frontend/dist/static-data'), manifest: JSON.parse(bytes) });
  assertPriceObservationBounds(observations, Date.now());
  writeFileSync(join(directory, 'source.json'), JSON.stringify({ price_observations: observations, price_observations_sha256: priceObservationDigest(observations), run_id: runId, run_attempt: attempt, source_sha: process.env.GITHUB_SHA,
    artifact_name: `static-site-data-${runId}-${attempt}`, manifest_json: bytes.toString('utf8'), manifest_sha256: sha256(bytes) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === 'plan') await plan();
  else if (command === 'design') { await plan(true); materialize(readState().source, resolve('frontend/public')); }
  else if (command === 'restore') { const state = readState(); materialize(state.source, resolve('release/frontend/public'), state.decision.migration); }
  else if (command === 'compose') await compose();
  else if (command === 'check-design-data') await verifyCoverage(resolve('frontend'), resolve('frontend/public/static-data'), readState().live.verificationUniverse.required_symbols);
  else if (command === 'recheck') await recheck();
  else if (command === 'export-metadata') exportMetadata();
  else throw Error('Expected plan, design, restore, compose, check-design-data, recheck or export-metadata');
}
