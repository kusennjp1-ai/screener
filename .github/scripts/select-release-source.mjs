import {financialAuditInventory,requiredFinancialAuditFiles,assertFinancialAuditPreserved,parsePublicationReceipt} from './financial-audit-history.mjs';
import {isPerformanceException, isPackedCandidate, selectExceptionVersion, readExceptionPin, readExceptionReleaseIntent, selectExceptionActivation, verifyPerformanceUiApproval, verifyExceptionFinancialScope} from './financial-performance-exception.mjs';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyPendingCorrectionHold, readPendingCorrection } from './pending-financial-correction.mjs';
import { contract, parseCorrectionIntent, verifyCorrectionSource, verifyCorrectionChecks, verifyCorrectionConsumerChecks, restoreCorrectionSource, verifyConsumerCapability, compareCorrectionData, assertCorrectionProgress, validateCorrectionReceipt, dataInventory, digest } from './financial-correction.mjs';
import { checkPublication, githubApi, sameRepository, workflowPath } from './publication-gate.mjs';
import { eligibleArtifacts, uniqueArtifact } from './select-published-runs.mjs';
import { assertPriceObservationBounds, comparePriceObservations, extractPriceObservations, priceObservationDigest } from './price-observations.mjs';
import { bootstrap, compareData, dataFiles, dataInventoryDigest, downloadArtifact, inventoryDigest, isData, livePublication, sha256, uiInventory, validateReceipt, safePath } from './publication-state.mjs';
import { financialReleasePolicy, readFinancialReleaseRequest, readFinancialActivationCandidate, selectActivationCandidate, verifyActivationCandidate, sourceLineage, writeFinancialReleaseReceipt, verifyFinancialReleaseAssets, assertFinancialLineageContinuity, restorePublishedFinancialSource } from './financial-release-activation.mjs';
import {verifyCarriedBundle} from './financial-generation-carry-controller.mjs';
import {canonicalPublication,removeCanonical,transportCapable,packPublication,assertTransportDeclaration,verifyCapturedTransportAssets} from './static-transport-publication.mjs';

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
async function materialize(source, destination, migration = false,frontendRoot=resolve('release/frontend')) {
  const directory = downloadArtifact(source.artifact, artifactDirectory(source.artifact), repository());
  const archive = join(directory, 'artifact.tar');
  verifyArchive(source, archive);
  if (source.receiptHash && sha256(archiveMember(archive, 'publication.json')) !== source.receiptHash) throw Error('Archive and live publication receipt disagree');
  rmSync(join(destination, 'static-data'), { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  if(source.publication?.transport){
    const physical=join(directory,'packed-predecessor'),logical=join(directory,'logical-predecessor');
    rmSync(physical,{recursive:true,force:true});rmSync(logical,{recursive:true,force:true});mkdirSync(physical);
    try{
      execFileSync('tar',['-xf',archive,'-C',physical],{stdio:'pipe'});
      await canonicalPublication({root:physical,frontendRoot,publication:source.publication,restore:logical});
      cpSync(join(logical,'static-data'),join(destination,'static-data'),{recursive:true});
      for(const file of dataFiles)cpSync(join(logical,file),join(destination,file));
    }finally{rmSync(physical,{recursive:true,force:true});rmSync(logical,{recursive:true,force:true});}
  }else{
    execFileSync('tar', ['-xf', archive, '-C', destination, './static-data'], { stdio: 'pipe' });
    assertTransportDeclaration(destination,source.publication);
  }
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
    return { artifact, runId: live.receipt.run_id, attempt: live.receipt.run_attempt, manifest: live.manifest, manifestHash: live.manifestHash, priceObservations: live.priceObservations, priceObservationsDigest: priceObservationDigest(live.priceObservations), receiptHash: live.receiptHash, publication:live.receipt };
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
  const intent = parseCorrectionIntent(event.inputs?.financial_correction);
  if (intent && (design || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || event.inputs?.ui_only === true || event.inputs?.ui_only === 'true')) throw Error('Correction requires its exclusive typed manual mode');
  const gated = design ? { publish: true, mode: 'design' } : checkPublication(event, sha, repository());
  const decision = design ? gated : applyPendingCorrectionHold(gated, readPendingCorrection());
  if (!decision.publish) { output({ publish: false }); console.log(decision.reason); return; }
  const uiDirectory = join(scratch(), 'live-ui');
  rmSync(uiDirectory, { recursive: true, force: true });
  const live = await livePublication({ repository: repository(), downloadTo: uiDirectory });
  const pages = githubApi(`repos/${repository()}/actions/artifacts?per_page=100`, true);
  const releaseRequest=!design&&!intent?readFinancialReleaseRequest():null;
  const alreadyActive=releaseRequest&&live.financialRelease
    &&digest(live.financialRelease.lineage.source)===digest(releaseRequest.correction.source)
    &&digest(live.financialRelease.lineage.certificate)===digest(releaseRequest.source_validation.certificate);
  let activation=null;
  if(releaseRequest&&!alreadyActive){
    const pin=readFinancialActivationCandidate();
    const exceptionVersion=selectExceptionVersion(),exceptionPin=readExceptionPin(process.cwd(),exceptionVersion),exceptionIntent=readExceptionReleaseIntent(process.cwd(),exceptionVersion);
    if(financialReleasePolicy.activation_enabled&&exceptionPin&&exceptionIntent){
      if(event.inputs?.ui_only===true||event.inputs?.ui_only==='true')throw Error('Exception activation requires ui_only=false');
      activation=await selectExceptionActivation({live,request:releaseRequest,mainSha:sha});
      Object.assign(decision,{publish:true,mode:'activation',approval:activation.approval,reason:'Explicit one-capture performance exception; Design remains failed'});
    }else if(financialReleasePolicy.activation_enabled&&pin&&gated.mode==='ui'){
      activation=await selectActivationCandidate({live,request:releaseRequest,pin,mainSha:sha,approval:gated.approval,pages});
      Object.assign(decision,gated,{mode:'activation'});
    }else if(decision.mode==='ui'){
      decision.mode='data';delete decision.approval;decision.pendingFinancialCorrection=true;
    }
    if(!pin)console.log('Financial activation held: the exact tested candidate has not been pinned.');
  }
  // Install durable provenance without refreshing any currently approved byte.
  // This cannot be blocked by a newly exported but degraded candidate bundle.
  const migration = !intent && !activation && !design && !live.receipt && Boolean(live.legacyArtifact);
  const fresh = migration || intent || activation ? null : chooseExport(live, pages, repository());
  if (migration) { decision.mode = 'data'; decision.migration = true; }
  const duplicate = !intent && !activation && !design && !migration && !fresh && (decision.mode === 'data' || live.uiSha === sha);
  if (duplicate) { output({ publish: false }); console.log('No advancing data or newly verified UI to publish.'); return; }
  let correction = null;
  if (intent) {
    if (!live.receipt || live.identity !== intent.previous_publication_identity) {
      if (live.financialCorrection?.previous_publication.identity === intent.previous_publication_identity && digest(live.financialCorrection.source) === digest(intent.source)) { output({ publish: false }); console.log('This exact financial correction was already applied.'); return; }
      throw Error('Financial correction predecessor is missing or superseded');
    }
    const sourceVerification = verifyCorrectionSource(intent.source);
    const checks = verifyCorrectionChecks(repository(), sha);
    const consumerChecks = verifyCorrectionConsumerChecks(live, repository());
    correction = { intent, sourceVerification, checks, consumerChecks, evaluatedAt: new Date().toISOString() };
    decision.mode = 'data';
  }
  const source = fresh || publishedSource(live, pages);
  const sourceSha = activation?.exception?activation.record.captured_ui.sha:['ui','activation'].includes(decision.mode) || design ? sha : live.uiSha;
  const state = { live, source, decision, sourceSha, controllerSha: sha, uiDirectory, ...(correction ? { correction } : {}),...(activation?{activation}:{}),
    ...(!activation&&!correction&&!design&&live.financialRelease?{carry:{}}:{}) };
  if(state.carry&&isPerformanceException(live.approval))state.carry.controllerChecks=verifyCorrectionChecks(repository(),sha);
  writeFileSync(statePath(), JSON.stringify(state));
  if (design && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SOURCE_RUN=${source.runId}\n`);
  output({ publish: true, sha: sourceSha, mode: decision.mode, migration, ...(!fresh && !migration && !correction && !activation && !design ? { published_input: true } : {}), ...(correction ? { correction: true, correction_prepare_only: true } : {}),...(activation?{activation:true}:{}),...(state.carry?{carry:true}:{}) });
  console.log(`${decision.mode} publication uses UI ${sourceSha} and artifact ${source.artifact.id} (${fresh ? 'checked export' : 'verified live input'})`);
}
async function recheck() {
  const state = readState();
  // Queued runs can retain older workflow YAML while checking out current main.
  // Enforce the same physical payload bound through their existing recheck too.
  // Prepare-only correction archives are never deployed and keep their own bounds.
  if (!state.correction) execFileSync('python3', [fileURLToPath(new URL('./check-pages-payload.py', import.meta.url)),
    resolve('release/frontend/dist')], { stdio: 'inherit' });
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const gated=checkPublication(event, state.controllerSha, repository());
  const decision = state.activation?gated:applyPendingCorrectionHold(gated, readPendingCorrection());
  if (!decision.publish || (state.decision.mode === 'ui' && decision.mode !== 'ui')) throw Error('Current-main publication gates changed');
  if(state.activation&&!state.activation.exception&&(gated.mode!=='ui'||digest(gated.approval)!==digest(state.activation.approval)||!financialReleasePolicy.activation_enabled))throw Error('Activation current-main gates changed');
  const live = await livePublication({ repository: repository() });
  if (live.identity !== state.live.identity) throw Error('Live UI or data changed; discard this superseded publication');
  const physical=resolve('release/frontend/dist'),receipt = validateReceipt(parsePublicationReceipt(readFileSync(join(physical,'publication.json'))));
  const canonical=join(scratch(),'recheck-logical');rmSync(canonical,{recursive:true,force:true});
  const logical=await canonicalPublication({root:physical,frontendRoot:resolve('release/frontend'),publication:receipt,restore:canonical});
  try {
  const finalManifest = JSON.parse(readFileSync(join(logical,'static-data/manifest.json'), 'utf8'));
  if (['regression', 'unknown'].includes(compareData(finalManifest, live.manifest))
    || ['regression', 'unknown'].includes(compareData(finalManifest, state.source.manifest))) throw Error('Final data would regress a published or selected market');
  const observed = extractPriceObservations({ dataRoot: join(logical,'static-data'), manifest: finalManifest });
  assertPriceObservationBounds(observed, state.source.artifact.created_at);
  const progress = comparePriceObservations(observed, live.knownPriceDates);
  if (priceObservationDigest(receipt.known_price_dates) !== priceObservationDigest(progress.knownDates)) throw Error('Final retained price ledger differs from the proven publication history');
  if (priceObservationDigest(observed) !== priceObservationDigest(receipt.price_observations) || progress.regressions.length
    || comparePriceObservations(observed, state.source.priceObservations).regressions.length) throw Error('Final price observations regress or disagree with the receipt');
  if (!state.correction && !state.activation && !state.decision.migration && state.sourceSha === live.uiSha
    && compareData(finalManifest, live.manifest) !== 'advance' && !progress.advances) throw Error('No observed data advance remains after preparation');
  if (state.correction) await verifyPreparedCorrection(state, live,logical);
  if(state.carry&&isPerformanceException(live.approval)&&digest(verifyCorrectionChecks(repository(),state.controllerSha))!==digest(state.carry.controllerChecks))throw Error('Exception carry controller CI changed');
  if(state.activation||state.carry)await verifyPreparedFinancialRelease(state,live,logical);
  if(live.financialRelease&&!state.activation&&!state.carry)throw Error('Ordinary release lost required financial carry');
  if (receipt.ui_sha !== state.sourceSha || receipt.ui_digest !== inventoryDigest(uiInventory('release/frontend/dist'))
    || (state.decision.mode === 'data' && receipt.ui_digest !== live.uiDigest)
    || receipt.data_manifest_sha256 !== sha256(readFileSync('release/frontend/dist/static-data/manifest.json'))) {
    throw Error('Final UI/data bytes differ from the approved publication plan');
  }
  }finally{removeCanonical(physical,logical);}
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
    approval: ['ui','activation'].includes(state.decision.mode) ? state.decision.approval : state.live.approval,
    price_observations: observed, known_price_dates: prices.knownDates,
    verification_universe: { as_of_date: coverage.as_of_date, required_symbols: coverage.requiredSymbols, minimum_target: coverage.minimum_target, total: coverage.total, verified: coverage.verified },
    data_manifest_sha256: sha256(readFileSync(join(dist, 'static-data/manifest.json'))),
    data_source: { artifact_id: state.source.artifact.id, run_id: state.source.runId, attempt: state.source.attempt } };
  if (state.correction) {
    const prepared = await prepareCorrectionReceipt(state, dist);
    receipt.financial_correction = prepared.reference;
    receipt.financial_generation = prepared.receipt.financial.generation;
    receipt.data_inventory_sha256 = inventoryDigest(dataInventory(dist));
  }
  if(state.activation||state.carry){
    const prepared=await prepareFinancialReleaseReceipt(state,dist,receipt);
    receipt.financial_release=prepared.reference;receipt.financial_lineage_sha256=prepared.receipt.lineage_sha256;
    receipt.financial_generation=prepared.receipt.financial_generation;receipt.data_inventory_sha256=inventoryDigest(dataInventory(dist));
    receipt.financial_audit_files=financialAuditInventory(dist);
    if(state.live.financialRelease)assertFinancialAuditPreserved(requiredFinancialAuditFiles(state.live),receipt.financial_audit_files);
    state.financialPrepared=prepared;writeFileSync(statePath(),JSON.stringify(state));
  }
  if (state.decision.migration && dataInventoryDigest(dist) !== state.migrationDataDigest) throw Error('Metadata migration changed approved data bytes');
  // The final logical tree is complete before encoding. A data-only release
  // discovers this capability in its retained approved UI, never the controller.
  if(!state.correction&&transportCapable(dist)){
    if(state.activation&&!isPackedCandidate(state.activation.record))throw Error('Packed activation requires a newly captured packed candidate');
    await packPublication({root:dist,frontendRoot:resolve('release/frontend'),publication:receipt,compressFinancialAudit:Boolean(receipt.financial_audit_files),bindings:{
      sourceCommit:state.controllerSha,appCommit:state.sourceSha,candidateId:state.activation?.record.transport_sha256??sha256(JSON.stringify({artifact:state.source.artifact.digest,run:state.source.runId,attempt:state.source.attempt,manifest:state.source.manifestHash}))}});
  }else assertTransportDeclaration(dist,receipt);
  validateReceipt(receipt);
  writeFileSync(join(dist, 'publication.json'), JSON.stringify(receipt));
  // Audit receipts and their metadata are included in the final physical/TAR guard.
  if(!state.correction)execFileSync('python3',[fileURLToPath(new URL('./check-pages-payload.py',import.meta.url)),dist],{stdio:'inherit'});
}

async function restoreCorrection(state) {
  await verifyConsumerCapability(resolve('release/frontend'));
  const root = resolve('release/frontend/public');
  const archive = join(artifactDirectory(state.source.artifact), 'artifact.tar');
  const predecessorArchive = join(scratch(),'correction-predecessor-artifact','artifact.zip');
  mkdirSync(join(scratch(),'correction-predecessor-artifact'),{recursive:true});
  cpSync(join(artifactDirectory(state.source.artifact),'artifact.zip'),predecessorArchive);
  if(`sha256:${sha256(readFileSync(predecessorArchive))}`!==state.source.artifact.digest)throw Error('Retained full predecessor artifact digest mismatch');
  for (const file of dataFiles) writeFileSync(join(root, file), archiveMember(archive, file));
  const baseline = join(scratch(), 'correction-predecessor');
  rmSync(baseline, { recursive:true, force:true }); mkdirSync(baseline,{recursive:true});
  cpSync(join(root,'static-data'),join(baseline,'static-data'),{recursive:true});
  for (const file of dataFiles) cpSync(join(root,file),join(baseline,file));
  if (state.live.receipt.data_inventory_sha256 && inventoryDigest(dataInventory(baseline)) !== state.live.receipt.data_inventory_sha256) throw Error('Predecessor full data inventory disagrees with publication');
  const sourceRoot = restoreCorrectionSource(state.correction.intent.source, join(scratch(),'correction-source'), state.correction.sourceVerification);
  const { decodeResearchIndex } = await import(pathToFileURL(resolve('release/frontend/src/static/researchTransport.js')).href);
  const researchPath = state.live.manifest.markets.US.assets.research.path;
  if (!safePath(researchPath)) throw Error('Invalid predecessor research path');
  const target = decodeResearchIndex(JSON.parse(readFileSync(join(root,'static-data',researchPath),'utf8')));
  const targetPath = join(scratch(),'correction-target-base.json');
  writeFileSync(targetPath,JSON.stringify({market:'US',as_of_date:target.as_of_date,rows:target.rows}));
  const source = state.correction.intent.source;
  const output = execFileSync(process.env.FINANCIAL_CORRECTION_PYTHON || 'python3', [resolve('backend/app/scripts/export_statement_projection.py'),
    '--archive',join(sourceRoot,'archive'),'--archive-sha256',source.archive_manifest_sha256,
    '--base',join(sourceRoot,'base.json'),'--cohort',join(sourceRoot,'cohort.json'),'--cohort-sha256',source.cohort_sha256,
    '--target-base',targetPath,'--target-base-sha256',sha256(readFileSync(targetPath)),
    '--target-publication-identity',state.live.identity,'--evaluated-at',state.correction.evaluatedAt,
    '--output-dir',join(scratch(),'correction-projection')],
    {encoding:'utf8',maxBuffer:2*1024*1024,env:{...process.env,PYTHONPATH:resolve('backend'),LITELLM_LOCAL_MODEL_COST_MAP:'true'}});
  const projection = JSON.parse(output);
  state.correction = {...state.correction, baseline, predecessorArchive, sourceRoot, projection, targetBaseSha256:sha256(readFileSync(targetPath))};
  const value = readProjection(state);
  assertCorrectionProgress(value,state.live.receipt.financial_generation || 'legacy-none');
  writeFileSync(statePath(),JSON.stringify(state));
  if(process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV,
    `FINANCIAL_CORRECTION_PROJECTION=${projection.projection_path}\nFINANCIAL_CORRECTION_SHA256=${projection.projection_sha256}\nFINANCIAL_EVALUATED_AT=${state.correction.evaluatedAt}\nFINANCIAL_CORRECTION_TARGET_IDENTITY=${state.live.identity}\nFINANCIAL_CORRECTION_TARGET_BASE_SHA256=${state.correction.targetBaseSha256}\n`);
}

async function restoreActivation(state) {
  const physical=join(state.activation.candidate,'corrected'),restore=join(scratch(),'activation-logical');rmSync(restore,{recursive:true,force:true});
  const publication=isPackedCandidate(state.activation.record)?JSON.parse(readFileSync(join(physical,'publication.json'),'utf8')):null;
  const prepared=await canonicalPublication({root:physical,frontendRoot:resolve('release/frontend'),publication,restore});
  try {
  for(const destination of [resolve('release/frontend/dist'),resolve('release/frontend/public')]){
    if(destination.endsWith('/dist'))rmSync(destination,{recursive:true,force:true});
    mkdirSync(destination,{recursive:true});cpSync(prepared,destination,{recursive:true});rmSync(join(destination,'publication.json'),{force:true});
  }
  }finally{removeCanonical(physical,prepared);}
}
async function restoreCarrySources(state) {
  const root=join(scratch(),'carry-source');
  await restorePublishedFinancialSource(state.live,root);
  cpSync(join(root,'static-data/financial-corrections'),resolve('release/frontend/public/static-data/financial-corrections'),{recursive:true});
  state.carry.sourceRoot=root;writeFileSync(statePath(),JSON.stringify(state));
}
function copyBundleData(source,destination) {
  mkdirSync(destination,{recursive:true});cpSync(join(source,'static-data'),join(destination,'static-data'),{recursive:true});
  for(const file of dataFiles)cpSync(join(source,file),join(destination,file));
}
async function prepareCarry() {
  const state=readState();if(!state.carry)throw Error('Missing financial carry plan');
  const frontend=resolve('release/frontend'),root=join(frontend,'public'),evaluatedAt=new Date().toISOString();
  const env={...process.env,FINANCIAL_EVALUATED_AT:evaluatedAt};
  for(const key of Object.keys(env))if(key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_'))delete env[key];
  // Establish the fully prepared new-price baseline once, including normal
  // performance history, before the carry takes exclusive financial ownership.
  execFileSync(process.execPath,['tools/export-research.mjs'],{cwd:frontend,env,stdio:'inherit'});
  const baseline=join(scratch(),'carry-baseline');rmSync(baseline,{recursive:true,force:true});copyBundleData(root,baseline);
  const manifest=JSON.parse(readFileSync(join(root,'static-data/manifest.json'),'utf8'));
  const {decodeResearchIndex}=await import(pathToFileURL(join(frontend,'src/static/researchTransport.js')).href);
  const index=decodeResearchIndex(JSON.parse(readFileSync(join(root,'static-data',manifest.markets.US.assets.research.path),'utf8')));
  const target=JSON.stringify({market:'US',as_of_date:index.as_of_date,rows:index.rows});
  const previous=state.live.financialRelease;
  const sourceProjection=readFileSync(join(state.carry.sourceRoot,previous.source_projection.path));
  const sourceBase=readFileSync(join(state.carry.sourceRoot,previous.source_base.path));
  const helper=await import(pathToFileURL(join(frontend,'tools/financial-generation-carry.mjs')).href);
  const carry=helper.createFinancialGenerationCarry({sourceProjection,sourceProjectionSha256:previous.source_projection.sha256,sourceBase,sourceBaseSha256:previous.source_base.sha256,
    sourceLineage:previous.lineage_sha256,previousPublicationIdentity:state.live.identity,targetBase:target,targetBaseSha256:sha256(target),evaluatedAt});
  const projectionPath=join(scratch(),'carry-projection.json'),bytes=JSON.stringify(carry);writeFileSync(projectionPath,bytes);
  state.carry={...state.carry,baseline,projectionPath,projectionSha256:sha256(bytes),targetBaseSha256:sha256(target),evaluatedAt};
  writeFileSync(statePath(),JSON.stringify(state));
  if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`FINANCIAL_GENERATION_CARRY_PROJECTION=${projectionPath}\nFINANCIAL_GENERATION_CARRY_SHA256=${sha256(bytes)}\nFINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE=${previous.lineage_sha256}\nFINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY=${state.live.identity}\nFINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256=${sha256(target)}\nFINANCIAL_EVALUATED_AT=${evaluatedAt}\n`);
}
async function carryAssessment(state,root) {
  const bytes=readFileSync(state.carry.projectionPath);if(sha256(bytes)!==state.carry.projectionSha256)throw Error('Carried projection changed');
  const carry=JSON.parse(bytes),frontend=resolve('release/frontend');
  const {compatibility,equality}=await verifyCarriedBundle({baselineRoot:state.carry.baseline,root,frontendRoot:frontend,carry,evaluatedAt:Date.now(),excludePaths:state.financialPrepared?.added||[]});
  return {carry,compatibility,equality};
}
function financialConsumerChecks(uiSha,uiDigest,approval){
  if(isPerformanceException(approval))return verifyPerformanceUiApproval({ui_sha:uiSha,ui_digest:uiDigest,approval},repository()).checks;
  return verifyCorrectionConsumerChecks({uiSha,approval},repository());
}
async function prepareFinancialReleaseReceipt(state,dist,publication) {
  const priceInput={artifact_id:state.source.artifact.id,artifact_sha256:state.source.artifact.digest.slice(7),manifest_sha256:state.source.manifestHash,
    price_observations_sha256:priceObservationDigest(publication.price_observations),known_price_dates_sha256:priceObservationDigest(publication.known_price_dates)};
  if(state.activation){
    const {projection,receipt}=await verifyActivationCandidate(state.activation,state.live);
    const original=state.activation.candidate;
    const lineage=sourceLineage({source:receipt.source,certificate:receipt.source_validation.certificate.reference,sourceProjectionSha256:receipt.financial.projection_sha256,
      receiptInventorySha256:receipt.financial.receipt_inventory_sha256,projectionPolicy:projection.policy});
    const projectionBytes=readFileSync(state.activation.projectionPath);
    return writeFinancialReleaseReceipt({dist,mode:'activation',previousIdentity:state.live.identity,lineage,sourceProjectionBytes:projectionBytes,sourceBaseBytes:readFileSync(join(original,'target-base.json')),
      evaluationBytes:projectionBytes,generation:projection.financial_generation,evaluatedAt:projection.financial_evaluated_at,ui:{approved_sha:state.sourceSha,captured_sha:receipt.candidate_ui.sha,digest:publication.ui_digest,approval:publication.approval,checks:state.activation.consumerChecks},priceInput,candidate:state.activation.reference});
  }
  const assessed=await carryAssessment(state,dist),previous=state.live.financialRelease;
  state.carry.assessment={compatibility:assessed.compatibility,equality:assessed.equality};
  const consumerChecks=financialConsumerChecks(state.sourceSha,publication.ui_digest,publication.approval);
  return writeFinancialReleaseReceipt({dist,mode:'carry',previousIdentity:state.live.identity,lineage:{id:previous.lineage_sha256,value:previous.lineage},
    sourceProjectionBytes:readFileSync(join(state.carry.sourceRoot,previous.source_projection.path)),sourceBaseBytes:readFileSync(join(state.carry.sourceRoot,previous.source_base.path)),evaluationBytes:readFileSync(state.carry.projectionPath),
    generation:assessed.carry.financial_generation,evaluatedAt:assessed.carry.financial_evaluated_at,ui:{approved_sha:state.sourceSha,captured_sha:state.sourceSha===state.live.uiSha?previous.ui.captured_sha:state.sourceSha,digest:publication.ui_digest,approval:publication.approval,checks:consumerChecks},priceInput});
}
async function verifyPreparedFinancialRelease(state,live,dist=resolve('release/frontend/dist')) {
  const publication=parsePublicationReceipt(readFileSync(join(dist,'publication.json')));
  const receipt=verifyFinancialReleaseAssets(dist,publication.financial_release,publication);
  if(!publication.financial_audit_files)throw Error('Prepared financial publication lost its complete audit inventory');
  if(live.financialRelease)assertFinancialAuditPreserved(requiredFinancialAuditFiles(live),publication.financial_audit_files);
  if(isPerformanceException(publication.approval))verifyExceptionFinancialScope(receipt,verifyPerformanceUiApproval(publication,repository()));
  if(receipt.previous_publication_identity!==live.identity)throw Error('Financial release predecessor changed');
  const checks=financialConsumerChecks(state.sourceSha,receipt.ui.digest,receipt.ui.approval);
  if(digest(checks)!==digest(receipt.ui.checks))throw Error('Financial release consumer checks changed');
  if(state.activation){
    await verifyActivationCandidate(state.activation,live);
    const candidatePhysical=join(state.activation.candidate,'corrected'),restore=join(scratch(),'activation-recheck-logical');rmSync(restore,{recursive:true,force:true});
    const candidatePublication=isPackedCandidate(state.activation.record)?JSON.parse(readFileSync(join(candidatePhysical,'publication.json'),'utf8')):null;
    const original=await canonicalPublication({root:candidatePhysical,frontendRoot:resolve('release/frontend'),publication:candidatePublication,restore});
    try {
      const candidate=dataInventory(original),actual=dataInventory(dist,state.financialPrepared.added.filter(path=>!Object.hasOwn(candidate,path)));
      if(inventoryDigest(actual)!==inventoryDigest(candidate))throw Error('Activation changed tested candidate data');
    }finally{removeCanonical(candidatePhysical,original);}
    if(inventoryDigest(uiInventory(dist))!==state.activation.record.captured_ui.digest)throw Error('Activation changed tested candidate UI');
    if(candidatePublication)await verifyCapturedTransportAssets({candidateRoot:candidatePhysical,root:resolve('release/frontend/dist'),frontendRoot:resolve('release/frontend'),candidatePublication,publication,allowedAdditions:state.financialPrepared.added});
  }else{
    assertFinancialLineageContinuity(live,receipt);
    const assessed=await carryAssessment(state,dist);
    if(digest(assessed.compatibility)!==digest(state.carry.assessment.compatibility)||digest(assessed.equality)!==digest(state.carry.assessment.equality))throw Error('Carry compatibility or price baseline changed');
  }
}
function readProjection(state) {
  const reference=state.correction.projection, bytes=readFileSync(reference.projection_path);
  if(sha256(bytes)!==reference.projection_sha256)throw Error('Correction projection digest mismatch');
  const projection=JSON.parse(bytes);
  if(projection.bindings?.target_publication_identity!==state.live.identity || projection.financial_evaluated_at!==state.correction.evaluatedAt
    || projection.bindings?.archive_manifest_sha256!==state.correction.intent.source.archive_manifest_sha256
    || projection.bindings?.acquisition_base_sha256!==state.correction.intent.source.acquisition_base_sha256
    || projection.bindings?.cohort_sha256!==state.correction.intent.source.cohort_sha256
    || projection.bindings?.target_base_sha256!==state.correction.targetBaseSha256)throw Error('Correction projection bindings changed');
  const now=Date.now();
  if(!Number.isFinite(Date.parse(projection.financial_evaluated_at)) || Date.parse(projection.financial_evaluated_at)>now)throw Error('Financial evaluation is in the future');
  for(const receipt of projection.receipt_inventory) if(!Number.isFinite(Date.parse(receipt.observed_at))||Date.parse(receipt.observed_at)>now)throw Error('Financial capture clock is invalid');
  for(const symbol of Object.values(projection.symbols)) for(const proof of Object.values(symbol.financial_current?.p||{})) if(!Number.isFinite(proof[5])||proof[5]<now)throw Error('Financial proof expired before publication');
  return projection;
}
async function correctionAssessment(state, root) {
  const projection=readProjection(state);
  assertCorrectionProgress(projection,state.live.receipt.financial_generation||'legacy-none');
  const consumer=await verifyConsumerCapability(resolve('release/frontend'));
  const compatibility=await consumer.verifyCorrectionCompatibility({root:join(root,'static-data'),projection,evaluatedAt:Date.now()});
  const equality=await compareCorrectionData(state.correction.baseline,root,resolve('release/frontend'),projection);
  return {projection,compatibility,equality};
}
async function prepareCorrectionReceipt(state,dist) {
  const {projection,compatibility,equality}=await correctionAssessment(state,dist);
  const projectionPath=`static-data/financial-corrections/projection-${state.correction.projection.projection_sha256}.json`;
  mkdirSync(join(dist,'static-data/financial-corrections'),{recursive:true});
  cpSync(state.correction.projection.projection_path,join(dist,projectionPath));
  const source=state.correction.intent.source;
  const timestamps=projection.receipt_inventory.map(item=>item.observed_at).sort((a,b)=>Date.parse(a)-Date.parse(b));
  const reasons={};for(const symbol of Object.values(projection.symbols))for(const reason of symbol.financial_current.r||[])reasons[reason]=(reasons[reason]||0)+1;
  const receipt={schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,
    previous_publication:{identity:state.live.identity,ui_sha:state.live.uiSha,ui_digest:state.live.uiDigest,
      data_inventory_sha256:equality.before_inventory_sha256,artifact_id:state.source.artifact.id,
      artifact_sha256:state.source.artifact.digest.slice(7),financial_generation:state.live.receipt.financial_generation||'legacy-none'},
    source,
    target:{markets:Object.fromEntries(Object.entries(state.live.manifest.markets).map(([key,value])=>[key,value.as_of_date])),
      universe_sha256:equality.universe_sha256,semantic_sha256:equality.semantic_sha256,
      price_observations_sha256:priceObservationDigest(state.live.priceObservations),known_price_dates_sha256:priceObservationDigest(state.live.knownPriceDates)},
    financial:{generation:projection.financial_generation,projection_path:projectionPath,projection_sha256:state.correction.projection.projection_sha256,
      receipt_inventory_sha256:projection.receipt_inventory_sha256,evaluated_at:projection.financial_evaluated_at,knowledge_basis:projection.knowledge_basis,
      point_in_time:false,source_publication_date:null,policy:projection.policy,source_timestamp_bounds:{earliest:timestamps[0],latest:timestamps.at(-1)},
      scope:{symbols:Object.keys(projection.symbols).length,fields:contract.financial_fields},unavailable_reasons:reasons},
    validation:{controller_sha:state.controllerSha,required_checks:state.correction.checks,consumer_checks:state.correction.consumerChecks,consumer_sha:state.sourceSha,ui_digest:state.live.uiDigest,
      compatibility_sha256:digest(compatibility),data_inventory_sha256:inventoryDigest(dataInventory(dist))}};
  validateCorrectionReceipt(receipt);
  const bytes=JSON.stringify(receipt),hash=sha256(bytes),path=`static-data/financial-corrections/receipt-${hash}.json`;
  writeFileSync(join(dist,path),bytes);
  state.correction.prepared={path,sha256:hash,compatibility_sha256:digest(compatibility),equality};
  writeFileSync(statePath(),JSON.stringify(state));
  return {receipt,reference:{schema_version:contract.schema_version,path,sha256:hash}};
}
async function verifyPreparedCorrection(state,live,dist=resolve('release/frontend/dist')) {
  if(live.identity!==state.correction.intent.previous_publication_identity)throw Error('Correction predecessor was superseded');
  const checks=verifyCorrectionChecks(repository(),state.controllerSha);
  if(digest(checks)!==digest(state.correction.checks))throw Error('Correction controller check identity changed');
  if(digest(verifyCorrectionConsumerChecks(live,repository()))!==digest(state.correction.consumerChecks))throw Error('Correction consumer approval changed');
  const source=state.correction.intent.source;
  if(`sha256:${sha256(readFileSync(state.correction.predecessorArchive))}`!==state.source.artifact.digest)throw Error('Retained full predecessor ZIP changed');
  if(sha256(readFileSync(join(scratch(),'correction-source/source.zip')))!==source.artifact_sha256)throw Error('Retained source ZIP changed');
  for(const [name,key]of [['archive/manifest.json','archive_manifest_sha256'],['base.json','acquisition_base_sha256'],['cohort.json','cohort_sha256']])if(sha256(readFileSync(join(state.correction.sourceRoot,name)))!==source[key])throw Error('Retained correction source binding changed');
  const verified=verifyCorrectionSource(source);
  if(digest(verified)!==digest(state.correction.sourceVerification))throw Error('Correction source attempt changed');
  const reference=state.correction.prepared;
  const bytes=readFileSync(join(dist,reference.path));
  if(sha256(bytes)!==reference.sha256)throw Error('Correction receipt changed after composition');
  const receipt=validateCorrectionReceipt(JSON.parse(bytes));
  if(inventoryDigest(dataInventory(dist,[reference.path]))!==receipt.validation.data_inventory_sha256)throw Error('Correction final inventory changed');
  const publication=JSON.parse(readFileSync(join(dist,'publication.json'),'utf8'));
  if(publication.financial_correction?.sha256!==reference.sha256||publication.financial_correction?.path!==reference.path
    ||publication.financial_generation!==receipt.financial.generation||publication.data_inventory_sha256!==inventoryDigest(dataInventory(dist)))throw Error('Publication correction binding changed');
  // Compare the prepared bundle without the newly added audit artifacts. They
  // are separately hash-verified above, and never treated as financial values.
  const checked=join(scratch(),'correction-recheck');rmSync(checked,{recursive:true,force:true});mkdirSync(checked,{recursive:true});
  cpSync(join(dist,'static-data'),join(checked,'static-data'),{recursive:true});for(const file of dataFiles)cpSync(join(dist,file),join(checked,file));
  rmSync(join(checked,reference.path));rmSync(join(checked,receipt.financial.projection_path));
  const {compatibility,equality}=await correctionAssessment(state,checked);
  if(digest(compatibility)!==receipt.validation.compatibility_sha256||digest(equality)!==digest(state.correction.prepared.equality))throw Error('Correction compatibility or semantic proof changed');
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
async function runCommand(command) {
  if (command === 'plan') await plan();
  else if (command === 'design') { await plan(true); await materialize(readState().source, resolve('frontend/public'),false,resolve('frontend')); }
  else if (command === 'restore') { const state = readState(); if(state.activation)await restoreActivation(state);else{await materialize(state.source, resolve('release/frontend/public'), state.decision.migration); if(state.correction) await restoreCorrection(state);if(state.carry)await restoreCarrySources(state);} }
  else if(command==='prepare-carry')await prepareCarry();
  else if (command === 'compose') await compose();
  else if (command === 'check-design-data') await verifyCoverage(resolve('frontend'), resolve('frontend/public/static-data'), readState().live.verificationUniverse.required_symbols);
  else if (command === 'recheck') await recheck();
  else if (command === 'export-metadata') exportMetadata();
  else throw Error('Expected plan, design, restore, compose, check-design-data, recheck or export-metadata');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Finish evaluating this module before activation lazily imports preview,
  // which imports verifyArchive from this entrypoint.
  // A pending promise cannot keep Node alive; unfinished commands fail closed.
  let completed = false;
  process.once('beforeExit', () => {
    if (!completed) { console.error('Release source command did not complete'); process.exitCode = 1; }
  });
  runCommand(process.argv[2]).then(
    () => { completed = true; },
    error => { completed = true; console.error(error.stack || error); process.exitCode = 1; },
  );
}
