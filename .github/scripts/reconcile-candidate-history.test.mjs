import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync, gunzipSync} from 'node:zlib';
import {spawnSync, execFileSync} from 'node:child_process';
import {cohortIdentity, freezeObservation, readPerformanceArchive, writePerformanceArchive} from '../../frontend/tools/candidate-performance-archive.mjs';
import {measureCandidateReturn} from '../../frontend/src/static/candidatePerformance.js';
import {prepareHistoryReconciliation, writeHistoryPayloads, commitHistoryCatalogs, verifyReconciledPerformance, restorePackedHistory} from './reconcile-candidate-history.mjs';
import {publishedHistorySource} from './select-release-source.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = path => JSON.parse(readFileSync(path));
const write = (root, path, value) => {mkdirSync(join(root, path, '..'), {recursive: true});writeFileSync(join(root, path), typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);};
const dates = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28'];
const now = Date.parse('2026-09-30T23:00:00Z');
const selectionIndex = 'candidate-history/index.json', performanceIndex = 'candidate-performance-history/index.json';
const script = fileURLToPath(new URL('./select-release-source.mjs', import.meta.url));

for (const packedTransport of [false, true]) test(`completed ${packedTransport ? 'packed' : 'unpacked'} exception seed never silently refreshes a changed live receipt`, {timeout: 60000}, async () => {
  const {performanceLifecycleFixture} = await import('./fixtures/financial-performance-lifecycle.mjs');
  const f = await performanceLifecycleFixture({packedTransport, exceptionVersion: packedTransport ? 2 : 1});
  try {
    const zipPath = f.config.zips[`repos/${f.pin.repository}/actions/artifacts/900030/zip`], archived = readFileSync(zipPath);
    assert.throws(() => f.recaptureSeedPublicationArtifact(), /false/);
    const publicationPath = join(f.liveRoot, 'publication.json');
    writeFileSync(publicationPath, `${readFileSync(publicationPath, 'utf8')}\n`);
    f.save();
    const release = f.advance({id: 40, date: '2026-10-05', price: 120, time: '2026-10-05T12:00:00.000Z'});
    release.command('plan');
    const result = release.command('restore', {allowFailure: true});
    assert.equal(result.status, 1);assert.match(result.stderr, /Archive and live publication receipt disagree/);
    assert.deepEqual(readFileSync(zipPath), archived, 'save, advance, plan and restore preserve the sealed predecessor archive');
  } finally {f.cleanup();}
});

function inventory(root, prefix = '') {
  return Object.fromEntries(readdirSync(root, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? Object.entries(inventory(join(root, entry.name), `${prefix}${entry.name}/`)) : [[`${prefix}${entry.name}`, sha(readFileSync(join(root, entry.name)))]]).sort());
}

function saveSelection(root, snapshot) {
  const raw = gzipSync(JSON.stringify(snapshot)), ref = {path: `candidate-history/${snapshot.as_of}-${sha(JSON.stringify(snapshot)).slice(0, 16)}.json.gz`, sha256: sha(raw), as_of: snapshot.as_of};
  write(root, ref.path, raw);
  return {...snapshot, published_ref: ref};
}

async function fixture(t, {prior = false} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'reconcile-history-'));t.after(() => rmSync(root, {recursive: true, force: true}));
  const publishedRoot = join(root, 'published'), selectedRoot = join(root, 'selected');
  const snapshot = saveSelection(publishedRoot, {schema_version: 1, as_of: dates[0], generated_at: '2026-09-21T21:00:00Z', rule_version: 'rules-1', universe_version: 'universe-1', source_research_sha256: 'b'.repeat(64),
    records: ['CASE', 'OTHER'].map(symbol => ({symbol, market: 'US', liquid: true, methods: {minervini: {state: 'pass'}}}))});
  write(publishedRoot, selectionIndex, {schema_version: 1, snapshots: [snapshot.published_ref]});
  cpSync(publishedRoot, selectedRoot, {recursive: true});
  const cohort = cohortIdentity(snapshot), prices = {as_of_date: dates.at(-1), calendar: 'NYSE', calendar_provider: 'pandas_market_calendars:NYSE', adjustment: 'split-adjusted-close-no-dividend',
    retrieved_at: '2026-09-28T21:00:00Z', completed_session_close: '2026-09-28T20:00:00Z', sessions: dates, series: {SPY: dates.map((date, i) => ({date, close: 200 + i}))}};
  const observations = new Map(['CASE', 'OTHER'].map(symbol => {
    const stock = {verified: true, bars: dates.map((date, i) => ({date, close: 100 + i})), source: {path: `verified-charts/${symbol}.json`, sha256: 'c'.repeat(64)}};
    const result = measureCandidateReturn({startDate: dates[0], asOf: dates.at(-1), sessions: dates, stock, benchmark: {verified: true, bars: prices.series.SPY}, horizon: 5});
    const observation = freezeObservation({snapshot, symbol, horizon: 5, result, stock, prices, sessions: dates, asOf: dates.at(-1), now: Date.parse(prior && symbol === 'CASE' ? '2026-09-28T22:00:00Z' : '2026-09-29T22:00:00Z')});
    return [`${symbol}:5`, observation];
  }));
  const archive = new Map([[cohort.sha256, {cohort, observations}]]);
  await writePerformanceArchive(selectedRoot, archive);
  await writePerformanceArchive(publishedRoot, prior ? new Map([[cohort.sha256, {cohort, observations: new Map([['CASE:5', observations.get('CASE:5')]])}]]) : new Map());
  const options = {selectedRoot, publishedRoot, selectedAt: '2026-09-30T22:00:00Z', publishedAt: prior ? '2026-09-28T22:30:00Z' : '2026-09-22T00:00:00Z', now};
  return {root, options, snapshot, archive, selectedRoot, publishedRoot};
}

async function updateArchive(f, mutate) {
  mutate(f.archive);
  await writePerformanceArchive(f.selectedRoot, f.archive);
}

test('empty predecessor accepts newly matured observations and retains the new selected daily snapshot', async t => {
  const f = await fixture(t);
  const fresh = saveSelection(f.selectedRoot, {...f.snapshot, published_ref: undefined, as_of: '2026-09-30', generated_at: '2026-09-30T21:00:00Z'});
  write(f.selectedRoot, selectionIndex, {schema_version: 1, snapshots: [f.snapshot.published_ref, fresh.published_ref]});
  const before = inventory(f.selectedRoot), plan = await prepareHistoryReconciliation(f.options);
  assert.equal(plan.summary.admitted_observations, 2);assert.equal(plan.summary.selections, 2);
  writeHistoryPayloads(plan);commitHistoryCatalogs(plan);
  assert.deepEqual(inventory(f.selectedRoot), before);
  const second = await prepareHistoryReconciliation(f.options);writeHistoryPayloads(second);commitHistoryCatalogs(second);
  assert.deepEqual(inventory(f.selectedRoot), before);
});

test('published observations are immutable while a selected addition survives', async t => {
  const f = await fixture(t, {prior: true}), before = inventory(f.publishedRoot);
  const plan = await prepareHistoryReconciliation(f.options);writeHistoryPayloads(plan);commitHistoryCatalogs(plan);
  assert.equal(plan.summary.published_observations, 1);assert.equal(plan.summary.admitted_observations, 1);
  assert.deepEqual(inventory(f.publishedRoot), before);
  await verifyReconciledPerformance({baselineRoot: f.publishedRoot, finalRoot: f.selectedRoot, publishedRoot: f.publishedRoot, publishedAt: f.options.publishedAt, now});
});

const adverse = [
  ['lost predecessor cohort', async f => {await updateArchive(f, a => a.clear());}, /lost.*cohort/],
  ['lost predecessor result', async f => {await updateArchive(f, a => a.values().next().value.observations.delete('CASE:5'));}, /lost.*observation/],
  ['changed predecessor observation', async f => {await updateArchive(f, a => a.values().next().value.observations.get('CASE:5').sources.stock.sha256 = 'd'.repeat(64));}, /changed.*observation/],
  ['changed cohort identity', async f => {await updateArchive(f, a => a.values().next().value.cohort.rule_version = 'other');}, /changed.*cohort/],
  ['corrupt late payload', async f => {const ref = parse(join(f.selectedRoot, performanceIndex)).cohorts[0];write(f.selectedRoot, ref.path, 'corrupt');}, /integrity/],
  ['wrong archive count', async f => {const value = parse(join(f.selectedRoot, performanceIndex));value.cohorts[0].observations++;write(f.selectedRoot, performanceIndex, value);}, /count/],
  ['missing predecessor catalog', async f => {rmSync(join(f.publishedRoot, performanceIndex));}, /ENOENT/],
  ['missing predecessor payload', async f => {const ref = parse(join(f.publishedRoot, performanceIndex)).cohorts[0];rmSync(join(f.publishedRoot, ref.path));}, /ENOENT/],
  ['corrupt published selection', async f => {write(f.publishedRoot, f.snapshot.published_ref.path, 'corrupt');}, /integrity/],
  ['future observation', async f => {await updateArchive(f, a => a.values().next().value.observations.get('OTHER:5').observed_at = '2026-10-01T00:00:00Z');}, /Invalid frozen/],
  ['rewritten arithmetic', async f => {await updateArchive(f, a => a.values().next().value.observations.get('OTHER:5').result.return_pct = 999);}, /original inputs/],
  ['observation predates publication', async f => {await updateArchive(f, a => a.values().next().value.observations.get('OTHER:5').observed_at = '2026-09-28T22:00:00Z');}, /chronology/],
  ['nonselected symbol', async f => {await updateArchive(f, a => {const obs = a.values().next().value.observations.get('OTHER:5');obs.symbol = obs.sources.stock.symbol = 'UNSELECTED';});}, /eligibility/],
  ['duplicate selected date', async f => {const value = parse(join(f.selectedRoot, selectionIndex));value.snapshots.push(value.snapshots[0]);write(f.selectedRoot, selectionIndex, value);}, /duplicate/i],
  ['unsafe archive path', async f => {const value = parse(join(f.selectedRoot, performanceIndex));value.cohorts[0].path = '../secret';write(f.selectedRoot, performanceIndex, value);}, /path/],
];
for (const [name, mutate, expected] of adverse) test(`${name} fails before any destination mutation`, async t => {
  const f = await fixture(t, {prior: true});await mutate(f);const before = inventory(f.selectedRoot);
  await assert.rejects(prepareHistoryReconciliation(f.options), expected);
  assert.deepEqual(inventory(f.selectedRoot), before);
});

test('new performance cannot use a never-published selection, even with valid arithmetic', async t => {
  const f = await fixture(t);write(f.publishedRoot, selectionIndex, {schema_version: 1, snapshots: []});
  const before = inventory(f.selectedRoot);await assert.rejects(prepareHistoryReconciliation(f.options), /previously published/);assert.deepEqual(inventory(f.selectedRoot), before);
});

test('retroactive selected dates and changed published first snapshots fail closed', async t => {
  for (const date of ['2026-09-18', '2026-09-21']) {
    const f = await fixture(t), other = saveSelection(f.selectedRoot, {...f.snapshot, published_ref: undefined, as_of: date, generated_at: '2026-09-21T21:00:00Z', rule_version: 'changed'});
    write(f.selectedRoot, selectionIndex, {schema_version: 1, snapshots: [other.published_ref]});
    const before = inventory(f.selectedRoot);await assert.rejects(prepareHistoryReconciliation(f.options), /backfilled|changed a published/);assert.deepEqual(inventory(f.selectedRoot), before);
  }
});

test('interruption after payload staging leaves visible catalogs unchanged and safely resumes', async t => {
  const f = await fixture(t);write(f.selectedRoot, selectionIndex, {schema_version: 1, snapshots: []});rmSync(join(f.selectedRoot, f.snapshot.published_ref.path));
  const catalogs = [selectionIndex, performanceIndex].map(path => readFileSync(join(f.selectedRoot, path)));
  const plan = await prepareHistoryReconciliation(f.options);writeHistoryPayloads(plan);
  assert.ok(existsSync(join(f.selectedRoot, f.snapshot.published_ref.path)));
  for (const [i, path] of [selectionIndex, performanceIndex].entries()) assert.deepEqual(readFileSync(join(f.selectedRoot, path)), catalogs[i]);
  const retried = await prepareHistoryReconciliation(f.options);writeHistoryPayloads(retried);commitHistoryCatalogs(retried);
  assert.equal(parse(join(f.selectedRoot, selectionIndex)).snapshots.length, 1);
  assert.equal((await readPerformanceArchive(f.selectedRoot, now)).size, 1);
  assert.equal(Object.keys(inventory(f.selectedRoot)).filter(path => path.endsWith('.tmp')).length, 0);
});

test('payload corruption between staging and commit does not alter either catalog', async t => {
  const f = await fixture(t), plan = await prepareHistoryReconciliation(f.options);writeHistoryPayloads(plan);
  const before = [selectionIndex, performanceIndex].map(path => readFileSync(join(f.selectedRoot, path)));
  write(f.selectedRoot, plan.payloads.at(-1).path, 'corrupt');
  assert.throws(() => commitHistoryCatalogs(plan), /changed before catalog/);
  for (const [i, path] of [selectionIndex, performanceIndex].entries()) assert.deepEqual(readFileSync(join(f.selectedRoot, path)), before[i]);
});

test('symlinked archives are rejected before reads or writes', async t => {
  const f = await fixture(t), ref = parse(join(f.selectedRoot, performanceIndex)).cohorts[0], file = join(f.selectedRoot, ref.path);
  const copy = join(f.root, 'outside');writeFileSync(copy, readFileSync(file));rmSync(file);symlinkSync(copy, file);
  await assert.rejects(prepareHistoryReconciliation(f.options), /links/);
});

test('final verification rejects loss after enrichment', async t => {
  const f = await fixture(t), baselineRoot = join(f.root, 'baseline');cpSync(f.selectedRoot, baselineRoot, {recursive: true});
  await updateArchive(f, a => a.values().next().value.observations.delete('OTHER:5'));
  await assert.rejects(verifyReconciledPerformance({baselineRoot, finalRoot: f.selectedRoot, publishedRoot: f.publishedRoot, publishedAt: f.options.publishedAt, now}), /lost.*observation/);
});

function cacheArtifact(root, directory, id, name, created_at, receipt = null) {
  const manifest = {markets: {US: {}}};write(directory, 'static-data/manifest.json', manifest);
  if (receipt) write(directory, 'publication.json', receipt);
  const artifactRoot = join(root, 'verified-publication', `artifact-${id}`);mkdirSync(artifactRoot, {recursive: true});
  execFileSync('tar', ['-cf', join(artifactRoot, 'artifact.tar'), '-C', directory, './static-data', ...(receipt ? ['./publication.json'] : [])]);
  execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.write(sys.argv[2],"artifact.tar");z.close()', join(artifactRoot, 'artifact.zip'), join(artifactRoot, 'artifact.tar')]);
  return {artifact: {id, name, digest: `sha256:${sha(readFileSync(join(artifactRoot, 'artifact.zip')))}`, created_at}, runId: id, attempt: 1, manifest, manifestHash: sha(JSON.stringify(manifest)), priceObservations: {}, priceObservationsDigest: sha('{}'), ...(receipt ? {receiptHash: sha(JSON.stringify(receipt)), publication: receipt} : {})};
}

test('real restore CLI executes controller reconciliation against release data without changing approved UI code', async t => {
  const f = await fixture(t), sourceDir = join(f.root, 'source-input'), priorDir = join(f.root, 'prior-input');
  cpSync(f.selectedRoot, join(sourceDir, 'static-data'), {recursive: true});cpSync(f.publishedRoot, join(priorDir, 'static-data'), {recursive: true});
  const source = cacheArtifact(f.root, sourceDir, 101, 'static-site-data-101-1', f.options.selectedAt);
  const predecessor = cacheArtifact(f.root, priorDir, 102, 'github-pages-102-1', f.options.publishedAt, {schema: 1, test: 'authenticated fixture receipt'});
  const state = {source, historyPredecessor: predecessor, decision: {mode: 'data'}, live: {receiptHash: predecessor.receiptHash, manifestHash: predecessor.manifestHash, latest: {runId: 102, attempt: 1, completed: Date.parse(f.options.publishedAt)}}};
  write(f.root, 'verified-publication/state.json', state);
  const approved = 'raise RuntimeError("old approved helper must not execute")\n';write(f.root, 'release/frontend/tools/restore-candidate-history.py', approved);
  const result = spawnSync(process.execPath, [script, 'restore'], {cwd: f.root, encoding: 'utf8', env: {...process.env, RUNNER_TEMP: f.root, GITHUB_EVENT_NAME: 'workflow_dispatch'}});
  assert.equal(result.status, 0, result.stderr);assert.match(result.stdout, /admitted 2/);
  assert.equal(readFileSync(join(f.root, 'release/frontend/tools/restore-candidate-history.py'), 'utf8'), approved);
  assert.equal(parse(join(f.root, 'verified-publication/state.json')).historyReconciliation.admitted_observations, 2);
  assert.equal((await readPerformanceArchive(join(f.root, 'release/frontend/public/static-data'), now)).size, 1);
  const workflow = readFileSync(new URL('../workflows/research-ui-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /python tools\/restore-candidate-history\.py/);
  assert.match(workflow, /run: node \.github\/scripts\/select-release-source\.mjs restore/);
});

test('final gate must reject valid arithmetic for an unpublished selected cohort', async t => {
  const f = await fixture(t);
  const fresh = saveSelection(f.selectedRoot, {...f.snapshot, published_ref: undefined, as_of: dates[1], generated_at: '2026-09-30T21:00:00Z'});
  write(f.selectedRoot, selectionIndex, {schema_version: 1, snapshots: [f.snapshot.published_ref, fresh.published_ref]});
  const plan = await prepareHistoryReconciliation(f.options);writeHistoryPayloads(plan);commitHistoryCatalogs(plan);
  const baselineRoot=join(f.root,'baseline');cpSync(f.selectedRoot,baselineRoot,{recursive:true});
  const ds=[...dates.slice(1), '2026-09-29'];
  const stock={verified:true,bars:ds.map((date,i)=>({date,close:100+i})),source:{path:'chart.json',sha256:'c'.repeat(64)}};
  const prices={as_of_date:ds.at(-1),calendar:'NYSE',calendar_provider:'pandas_market_calendars:NYSE',adjustment:'split-adjusted-close-no-dividend',retrieved_at:'2026-09-29T21:00:00Z',completed_session_close:'2026-09-29T20:00:00Z',sessions:ds,series:{SPY:ds.map((date,i)=>({date,close:200+i}))}};
  const result=measureCandidateReturn({startDate:ds[0],asOf:ds.at(-1),sessions:ds,stock,benchmark:{verified:true,bars:prices.series.SPY},horizon:5});
  const observation=freezeObservation({snapshot:fresh,symbol:'CASE',horizon:5,result,stock,prices,sessions:ds,asOf:ds.at(-1),now});
  const cohort=cohortIdentity(fresh);f.archive.set(cohort.sha256,{cohort,observations:new Map([['CASE:5',observation]])});await writePerformanceArchive(f.selectedRoot,f.archive);
  await assert.rejects(prepareHistoryReconciliation(f.options));
  await assert.rejects(verifyReconciledPerformance({baselineRoot,finalRoot:f.selectedRoot,publishedRoot:f.publishedRoot,publishedAt:f.options.publishedAt,now}), /lineage|published|selection/);
});

test('final gate must reject dropped selected daily snapshot',async t=>{
  const f=await fixture(t);const baselineRoot=join(f.root,'baseline');cpSync(f.selectedRoot,baselineRoot,{recursive:true});
  write(f.selectedRoot,selectionIndex,{schema_version:1,snapshots:[]});
  await assert.rejects(verifyReconciledPerformance({baselineRoot,finalRoot:f.selectedRoot,publishedRoot:f.publishedRoot,publishedAt:f.options.publishedAt,now}), /selection|snapshot/);
});


test('interruption between catalog renames leaves complete catalogs and safely resumes', async t=>{
  const f=await fixture(t);write(f.selectedRoot,selectionIndex,{schema_version:1,snapshots:[]});rmSync(join(f.selectedRoot,f.snapshot.published_ref.path));
  const plan=await prepareHistoryReconciliation(f.options);writeHistoryPayloads(plan);
  const originalPerformance=readFileSync(join(f.selectedRoot,performanceIndex));
  const serial={...plan,payloads:plan.payloads.map(x=>({...x,bytes:x.bytes.toString('base64')})),catalogs:plan.catalogs.map(x=>({...x,bytes:x.bytes.toString('base64')}))};
  const planPath=join(f.root,'plan.json');writeFileSync(planPath,JSON.stringify(serial));
  const driver=join(f.root,'interrupt.mjs');
  writeFileSync(driver,`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
  const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b.endsWith('/candidate-history/index.json'))process.exit(85)};syncBuiltinESMExports();
  const {commitHistoryCatalogs}=await import(${JSON.stringify(new URL('./reconcile-candidate-history.mjs', import.meta.url).href)});
  const p=JSON.parse(fs.readFileSync(process.argv[2]));for(const kind of ['payloads','catalogs'])for(const f of p[kind])f.bytes=Buffer.from(f.bytes,'base64');commitHistoryCatalogs(p);`);
  const interrupted=spawnSync(process.execPath,[driver,planPath],{encoding:'utf8'});assert.equal(interrupted.status,85,interrupted.stderr);
  assert.deepEqual(readFileSync(join(f.selectedRoot,selectionIndex)),plan.catalogs[0].bytes);
  assert.deepEqual(readFileSync(join(f.selectedRoot,performanceIndex)),originalPerformance);
  assert.equal((await readPerformanceArchive(f.selectedRoot,now)).size,1);
  const retried=await prepareHistoryReconciliation(f.options);writeHistoryPayloads(retried);commitHistoryCatalogs(retried);
  assert.deepEqual(readFileSync(join(f.selectedRoot,selectionIndex)),plan.catalogs[0].bytes);
  assert.deepEqual(readFileSync(join(f.selectedRoot,performanceIndex)),originalPerformance);
});

test('staged directory replacement by a symlink fails before writes outside the root',async t=>{
  const f=await fixture(t);write(f.selectedRoot,selectionIndex,{schema_version:1,snapshots:[]});rmSync(join(f.selectedRoot,f.snapshot.published_ref.path));
  const plan=await prepareHistoryReconciliation(f.options), outside=join(f.root,'outside');mkdirSync(outside);writeFileSync(join(outside,'index.json'),'untouched');
  rmSync(join(f.selectedRoot,'candidate-history'),{recursive:true});symlinkSync(outside,join(f.selectedRoot,'candidate-history'));
  assert.throws(()=>writeHistoryPayloads(plan), /links/);
  assert.deepEqual(readdirSync(outside),['index.json']);assert.equal(readFileSync(join(outside,'index.json'),'utf8'),'untouched');
});

test('future selected price dates cannot enter history before their generated NY date', async t => {
  const f = await fixture(t), future = saveSelection(f.selectedRoot, {...f.snapshot, published_ref: undefined, as_of: '2026-10-20', generated_at: '2026-09-30T21:00:00Z'});
  write(f.selectedRoot, selectionIndex, {schema_version: 1, snapshots: [f.snapshot.published_ref, future.published_ref]});
  const before = inventory(f.selectedRoot);await assert.rejects(prepareHistoryReconciliation(f.options), /selection.*time/);assert.deepEqual(inventory(f.selectedRoot), before);
});

test('an aged-out published selection remains authenticated by its original immutable file', async t => {
  const f = await fixture(t, {prior: true});
  cpSync(join(f.publishedRoot, 'candidate-performance-history'), join(f.selectedRoot, 'candidate-performance-history'), {recursive: true});
  for (const root of [f.publishedRoot, f.selectedRoot]) write(root, selectionIndex, {schema_version: 1, snapshots: []});
  const plan = await prepareHistoryReconciliation(f.options);assert.equal(plan.summary.published_observations, 1);
  rmSync(join(f.publishedRoot, f.snapshot.published_ref.path));
  await assert.rejects(prepareHistoryReconciliation(f.options), /ENOENT/);
});

async function packedFixture(t) {
  const f = await fixture(t), source = join(f.root, 'packed-source'), packed = join(f.root, 'packed');
  cpSync(f.publishedRoot, join(source, 'static-data'), {recursive: true});
  write(source, 'static-data/manifest.json', {markets: {US: {}}});
  write(source, 'static-data/research-details/example.json', {test: 'one compressible member'});
  const {pack} = await import('../../frontend/tools/static-transport/pack.mjs');
  const result = await pack({source, output: packed, bindings: {manifestSha256: sha(readFileSync(join(source, 'static-data/manifest.json'))), uiInventorySha256: 'a'.repeat(64), financialGeneration: null, financialLineageSha256: null, sourceCommit: 'a'.repeat(40), appCommit: 'b'.repeat(40), candidateId: 'c'.repeat(64)}});
  const metadata = parse(join(packed, result.expectedRoot.path));
  const fetcher = corrupt => async url => {
    const path = `static-data/${new URL(url).pathname.split('/static-data/')[1]}`;
    const bytes = readFileSync(join(packed, path));
    return new Response(path === corrupt ? Buffer.from('corrupt') : bytes);
  };
  return {...f, packed, metadata, expectedRoot: result.expectedRoot, fetcher};
}

test('expired predecessor artifact falls back only to an authenticated packed history root', async t => {
  const f = await packedFixture(t);
  const live = {receipt: {artifact_name: 'github-pages-102-1', run_id: 102, transport: {root: f.expectedRoot}}, receiptHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64), latest: {runId: 102, attempt: 1}};
  const proof = publishedHistorySource(live, [{artifacts: [{id: 102, name: live.receipt.artifact_name, expired: true, workflow_run: {id: 102}}]}]);
  assert.equal(proof.kind, 'packed-live');assert.deepEqual(proof.expectedRoot, f.expectedRoot);
  const restored = join(f.root, 'packed-history'), report = await restorePackedHistory({expectedRoot: proof.expectedRoot, root: restored, fetcher: f.fetcher()});
  assert.equal(report.files, 3);assert.deepEqual(inventory(restored), inventory(f.publishedRoot));
  const plan = await prepareHistoryReconciliation({...f.options, publishedRoot: restored});assert.equal(plan.summary.admitted_observations, 2);
  assert.throws(() => publishedHistorySource({...live, receipt: {...live.receipt, transport: undefined}}, [{artifacts: []}]), /retained artifact/);
});

for (const target of ['root', 'inventory', 'catalog', 'payload', 'shard']) test(`packed predecessor with corrupt ${target} fails before materialization`, async t => {
  const f = await packedFixture(t), path = target === 'root' ? f.expectedRoot.path : target === 'inventory' ? f.metadata.logicalInventory.path : target === 'catalog' ? `static-data/${selectionIndex}` : target === 'payload' ? `static-data/${f.snapshot.published_ref.path}` : f.metadata.shards[parseInt(sha(`static-data/${selectionIndex}`).slice(0, 2), 16)].path;
  const restored = join(f.root, 'packed-history');
  await assert.rejects(restorePackedHistory({expectedRoot: f.expectedRoot, root: restored, fetcher: f.fetcher(path)}), /length|SHA-256/);
  assert.equal(existsSync(restored), false);
});

test('real restore CLI uses the packed-live proof when the exact predecessor ZIP expired', async t => {
  const f = await packedFixture(t), sourceDir = join(f.root, 'source-input');
  cpSync(f.selectedRoot, join(sourceDir, 'static-data'), {recursive: true});
  const source = cacheArtifact(f.root, sourceDir, 101, 'static-site-data-101-1', f.options.selectedAt);
  const live = {receipt: {artifact_name: 'github-pages-102-1', run_id: 102, transport: {root: f.expectedRoot}}, receiptHash: 'a'.repeat(64), manifestHash: f.expectedRoot.bindings.manifestSha256, latest: {runId: 102, attempt: 1, completed: Date.parse(f.options.publishedAt)}};
  const historyPredecessor = publishedHistorySource(live, [{artifacts: [{id: 102, name: live.receipt.artifact_name, expired: true, workflow_run: {id: 102}}]}]);
  write(f.root, 'verified-publication/state.json', {source, historyPredecessor, decision: {mode: 'data'}, live});
  const hook = join(f.root, 'packed-fetch.mjs');
  writeFileSync(hook, `import {readFileSync} from 'node:fs';import {join} from 'node:path';globalThis.fetch=async url=>new Response(readFileSync(join(${JSON.stringify(f.packed)},'static-data/'+new URL(url).pathname.split('/static-data/')[1])));`);
  const result = spawnSync(process.execPath, ['--import', hook, script, 'restore'], {cwd: f.root, encoding: 'utf8', env: {...process.env, RUNNER_TEMP: f.root, GITHUB_EVENT_NAME: 'workflow_dispatch'}});
  assert.equal(result.status, 0, result.stderr);assert.match(result.stdout, /admitted 2/);
  const state = parse(join(f.root, 'verified-publication/state.json'));
  assert.equal(state.historyReconciliation.predecessor_digest, f.expectedRoot.sha256);
  assert.equal((await readPerformanceArchive(join(f.root, 'release/frontend/public/static-data'), now)).size, 1);
});

test('final gate permits normal 126-session catalog retention while keeping payload bytes',async t=>{
  const f=await fixture(t);
  const refs=[];
  for(let i=0;i<125;i++) {
    const day=new Date(Date.parse('2026-05-01T00:00:00Z')+i*86400000).toISOString().slice(0,10);
    refs.push(saveSelection(f.publishedRoot,{...f.snapshot,published_ref:undefined,as_of:day}).published_ref);
  }
  refs.push(f.snapshot.published_ref);write(f.publishedRoot,selectionIndex,{schema_version:1,snapshots:refs});
  cpSync(join(f.publishedRoot,'candidate-history'),join(f.selectedRoot,'candidate-history'),{recursive:true});
  const plan=await prepareHistoryReconciliation(f.options);writeHistoryPayloads(plan);commitHistoryCatalogs(plan);
  const baselineRoot=join(f.root,'baseline');cpSync(f.selectedRoot,baselineRoot,{recursive:true});
  const fresh=saveSelection(f.selectedRoot,{...f.snapshot,published_ref:undefined,as_of:'2026-09-30',generated_at:'2026-09-30T21:00:00Z'});
  write(f.selectedRoot,selectionIndex,{schema_version:1,snapshots:[...refs.slice(1),fresh.published_ref]});
  await verifyReconciledPerformance({baselineRoot,finalRoot:f.selectedRoot,publishedRoot:f.publishedRoot,publishedAt:f.options.publishedAt,now});
  assert.equal(parse(join(f.selectedRoot,selectionIndex)).snapshots.length,126);
});

test('no-addition export can predate a later UI-only predecessor deployment',async t=>{
  const f=await fixture(t,{prior:true});f.archive.values().next().value.observations.delete('OTHER:5');await writePerformanceArchive(f.selectedRoot,f.archive);
  const plan=await prepareHistoryReconciliation({...f.options,publishedAt:'2026-09-30T22:30:00Z'});
  assert.equal(plan.summary.published_observations,1);assert.equal(plan.summary.admitted_observations,0);
});

test('timestamp reorder never bypasses the publication floor for new observations',async t=>{
  const f=await fixture(t,{prior:true});
  await assert.rejects(prepareHistoryReconciliation({...f.options,publishedAt:'2026-09-30T22:30:00Z'}), /chronology/);
});
