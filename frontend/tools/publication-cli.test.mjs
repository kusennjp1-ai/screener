// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(project, '.github/scripts/select-release-source.mjs');
const { repository, site_url: siteUrl } = JSON.parse(readFileSync(join(project, '.github/scripts/approved-ui-bootstrap.json'), 'utf8'));
const uiSha = 'b'.repeat(40), mainSha = 'c'.repeat(40), exportSha = 'd'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = files => hash(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
const workflow = file => `.github/workflows/${file}`;
const repoApi = suffix => `repos/${repository}${suffix}`;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const mutableFiles = ['research-daily.json', 'portfolio-model.json', 'qualification-audit.json', 'ibd-reference.json'];
const approvedBytes = {
  'index.html': Buffer.from('<html><script src="assets/approved.js"></script></html>'),
  'assets/approved.js': Buffer.from('console.log("approved live UI");'),
  'assets/approved.css': Buffer.from('body { color: navy; }'),
  'sw.js': Buffer.from('self.addEventListener("fetch", () => {});'),
  'manifest.webmanifest': Buffer.from('{"name":"Approved"}'),
  'precache-manifest.json': Buffer.from('["index.html","assets/approved.js"]'),
  'strategy-scorecard.json': Buffer.from('{"version":"approved"}'),
  'icons/favicon.bin': Buffer.from([0, 255, 13, 10, 128, 1]),
  'nested/notice.txt': Buffer.from('Every non-data byte is retained.\n'),
};
const approvedHashes = Object.fromEntries(Object.entries(approvedBytes).map(([path, bytes]) => [path, hash(bytes)]));
const approvedGates = [
  { id: 101, attempt: 2, path: workflow('ci.yml') },
  { id: 102, attempt: 3, path: workflow('design-acceptance.yml') },
];
const approval = { type: 'gates', sha: uiSha, runs: approvedGates };
const manifest = day => ({
  as_of_date: day, default_market: 'US', supported_markets: ['US'],
  markets: { US: { as_of_date: day,
    assets: { research: { path: 'research-index.json' }, charts: { path: 'charts/index.json' } },
    pages: { home: { path: 'home.json' } }, freshness: {
    scan_as_of_date: day, breadth_latest_date: day, groups_latest_date: day,
    scan_published_at: `${day}T22:00:00Z`, prices_generated_at: `${day}T23:00:00Z`,
  } } },
});
const verifiedRow = (day, symbol = 'KEEP') => ({
  symbol, current_price: 20, adv_usd: 30_000_000,
  technical_audit: { symbol, as_of_date: day, valid: true, errors: [], values: { close: 20 } },
});
const priceObservations = day => ({ '["US","chart","KEEP"]': day, '["US","home","SPY"]': day });
const observationHash = day => hash(JSON.stringify(priceObservations(day)));
const researchFiles = (day, priceDay = day) => ({
  'static-data/research-index.json': jsonBytes({ as_of_date: day, rows: [verifiedRow(day)] }),
  'static-data/data-quality.json': jsonBytes({ as_of_date: day, total: 1, verified: 1, unverified: 0 }),
  'static-data/charts/index.json': jsonBytes({ market: 'US', symbols: [{ symbol: 'KEEP', path: 'charts/KEEP.json' }] }),
  'static-data/charts/KEEP.json': jsonBytes({ market: 'US', symbol: 'KEEP', as_of_date: day,
    bars: [{ date: priceDay, open: 20, high: 21, low: 19, close: 20, volume: 1_500_000 }] }),
  'static-data/home.json': jsonBytes({ market: 'US', as_of_date: day,
    key_markets: [{ symbol: 'SPY', history: [{ date: priceDay, close: 500 }] }] }),
});
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const encode = files => Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')]));
const readTree = root => {
  const files = {};
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`);
      else files[path] = readFileSync(join(directory, entry.name));
    }
  };
  visit(root);
  return files;
};
const uiTree = root => Object.fromEntries(Object.entries(readTree(root)).filter(([path]) =>
  path !== 'publication.json' && !path.startsWith('static-data/') && !mutableFiles.includes(path)));
const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// Construct real tiny ZIP/TAR files, including the directory member extracted by
// restore. All input bytes and GitHub artifact digests are independently hashed.
function makeArchive(path, files, { tar = true, unsafe = false } = {}) {
  const result = spawnSync('python3', ['-c', `
import base64, io, json, sys, tarfile, zipfile
files=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as archive:
 if sys.argv[2]=='tar':
  payload=io.BytesIO()
  with tarfile.open(fileobj=payload, mode='w', format=tarfile.USTAR_FORMAT) as bundle:
   parents={'.'}
   for name in files:
    parts=name.split('/')
    parents.update('/'.join(parts[:i]) for i in range(1,len(parts)))
   for name in sorted(parents):
    member=tarfile.TarInfo('./' if name=='.' else './'+name)
    member.type=tarfile.DIRTYPE; member.mode=0o755
    bundle.addfile(member)
   for name, encoded in files.items():
    data=base64.b64decode(encoded)
    member=tarfile.TarInfo('./'+name); member.mode=0o644; member.size=len(data)
    bundle.addfile(member, io.BytesIO(data))
   if sys.argv[3]=='unsafe':
    member=tarfile.TarInfo('../escaped.txt'); member.size=6
    bundle.addfile(member, io.BytesIO(b'escape'))
  archive.writestr('artifact.tar', payload.getvalue())
 else:
  for name, encoded in files.items(): archive.writestr(name, base64.b64decode(encoded))
`, path, tar ? 'tar' : 'files', unsafe ? 'unsafe' : 'safe'], {
    input: JSON.stringify(encode(files)), encoding: 'utf8', timeout: 10000,
  });
  if (result.status !== 0) throw Error(`Cannot construct archive: ${result.stderr || result.error}`);
  return `sha256:${hash(readFileSync(path))}`;
}

function fixture({ fresh = true, expired = false, sameCode = false, designPassed = false, unsafe = false,
  legacy = false, degraded = false, scanDay = '2026-11-02', priceDay = scanDay,
  bootstrapPrices = priceObservations('2026-11-01') } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'publication-cli-'));
  temporaryDirectories.push(root);
  const runner = join(root, 'runner'), bin = join(root, 'bin');
  mkdirSync(runner); mkdirSync(bin);
  const fixturePath = join(root, 'fixture.json'), logPath = join(root, 'requests.jsonl');
  const outputPath = join(root, 'github-output'), eventPath = join(root, 'event.json');
  const preload = join(root, 'fetch-preload.mjs');
  const controllerSha = sameCode ? uiSha : mainSha;
  const liveManifest = jsonBytes(manifest('2026-11-01'));
  const freshManifest = jsonBytes(manifest(scanDay));
  const receipt = {
    schema: 1, run_id: 500, run_attempt: 2, artifact_name: 'github-pages-500-2',
    controller_sha: legacy ? uiSha : 'e'.repeat(40), ui_sha: uiSha, ui_files: approvedHashes,
    ui_digest: digest(approvedHashes), approval, data_manifest_sha256: hash(liveManifest),
    verification_universe: { as_of_date: '2026-11-01', required_symbols: ['KEEP'], minimum_target: 0.9, total: 1, verified: 1 },
    price_observations: priceObservations('2026-11-01'), known_price_dates: priceObservations('2026-11-01'),
  };
  const liveFiles = { ...approvedBytes, ...researchFiles('2026-11-01'),
    ...Object.fromEntries(mutableFiles.map(path => [path, jsonBytes({ source: 'original-approved-data', file: path })])),
    ...(!legacy && { 'publication.json': jsonBytes(receipt) }),
    'static-data/manifest.json': liveManifest,
    'static-data/markets/us/rows.json': jsonBytes([{ source: 'published' }]),
  };
  const run = overrides => ({
    id: 500, run_attempt: 2, path: workflow('research-ui-release.yml'), head_sha: receipt.controller_sha,
    head_branch: 'main', event: 'workflow_run', status: 'completed', conclusion: 'success',
    run_started_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:10:00Z',
    repository: { full_name: repository }, head_repository: { full_name: repository }, ...overrides,
  });
  const exportRun = run({ id: 600, run_attempt: 3, path: workflow('static-site.yml'), head_sha: exportSha,
    event: 'schedule', run_started_at: '2026-11-03T00:00:00Z', updated_at: '2026-11-03T00:10:00Z' });
  const currentGates = [
    run({ id: 201, run_attempt: 4, path: workflow('ci.yml'), head_sha: controllerSha, event: 'push' }),
    run({ id: 202, run_attempt: 2, path: workflow('design-acceptance.yml'), head_sha: controllerSha,
      event: 'push', conclusion: designPassed ? 'success' : 'failure' }),
  ];
  const config = { siteUrl, api: {}, downloads: {}, live: encode(liveFiles) };
  const api = config.api;
  api[repoApi('')] = { full_name: repository, default_branch: 'main' };
  api[repoApi('/git/ref/heads/main')] = { object: { sha: controllerSha } };
  api[repoApi('/actions/runs/600')] = exportRun;
  for (const gate of currentGates) api[repoApi(`/actions/workflows/${gate.path.split('/').at(-1)}/runs?branch=main&event=push&head_sha=${controllerSha}&per_page=100`)] = [{ workflow_runs: [gate] }];
  for (const gate of approvedGates) api[repoApi(`/actions/runs/${gate.id}/attempts/${gate.attempt}`)] =
    run({ id: gate.id, run_attempt: gate.attempt, path: gate.path, head_sha: uiSha, event: 'push' });
  api[repoApi('/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100')] = [{ workflow_runs: [run()] }];
  api[repoApi('/actions/workflows/static-site.yml/runs?branch=main&per_page=100')] = [{ workflow_runs: [exportRun] }];
  api[repoApi('/actions/runs/500/jobs?filter=all&per_page=100')] = [{ jobs: [{
    id: 5002, name: 'publish', run_attempt: 2, conclusion: 'success',
    started_at: '2026-11-02T00:01:00Z', completed_at: '2026-11-02T00:10:00Z',
    steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success',
      started_at: '2026-11-02T00:08:00Z', completed_at: '2026-11-02T00:09:00Z' }],
  }] }];
  api[repoApi('/actions/runs/500/attempts/2')] = run();
  api[repoApi('/actions/runs/500/attempts/2/jobs?per_page=100')] = api[repoApi('/actions/runs/500/jobs?filter=all&per_page=100')];
  api[repoApi('/actions/runs/600/jobs?filter=all&per_page=100')] = [{ jobs: [] }];
  api[repoApi('/actions/runs/600/attempts/3')] = exportRun;
  api[repoApi('/actions/runs/600/attempts/3/jobs?per_page=100')] = [{ jobs: [{
    id: 6003, name: 'combine-and-build', run_attempt: 3, conclusion: 'success',
    started_at: '2026-11-03T00:01:00Z', completed_at: '2026-11-03T00:09:00Z',
    steps: [{ name: 'Build static frontend', conclusion: 'success',
      started_at: '2026-11-03T00:02:00Z', completed_at: '2026-11-03T00:04:00Z' }],
  }] }];
  const artifact = (id, name, runId, sha, createdAt, bytes, options) => {
    const zip = join(root, `${id}.zip`);
    const value = { id, name, expired: false, created_at: createdAt, digest: makeArchive(zip, bytes, options),
      workflow_run: { id: runId, head_branch: 'main', head_sha: sha } };
    config.downloads[repoApi(`/actions/artifacts/${id}/zip`)] = zip;
    return value;
  };
  const liveArtifact = artifact(700, legacy ? 'github-pages' : receipt.artifact_name, 500,
    receipt.controller_sha, '2026-11-02T00:06:00Z', liveFiles);
  liveArtifact.expired = expired;
  if (expired) delete config.downloads[repoApi('/actions/artifacts/700/zip')];
  const artifacts = [liveArtifact];
  let exportArtifact, metadataArtifact, metadata, exportFiles;
  if (fresh) {
    exportFiles = {
      'index.html': Buffer.from('export UI must never replace approved UI'),
      'sw.js': Buffer.from('unapproved export service worker'),
      ...researchFiles(scanDay, priceDay),
      ...(degraded && { 'static-data/research-index.json': jsonBytes({
        as_of_date: scanDay, rows: [verifiedRow(scanDay, 'NEW')],
      }) }),
      'static-data/manifest.json': freshManifest,
      'static-data/markets/us/rows.json': jsonBytes([{ source: 'advancing-export' }]),
    };
    exportArtifact = artifact(800, 'static-site-data-600-3', 600, exportSha, '2026-11-03T00:05:00Z', exportFiles, { unsafe });
    metadata = { run_id: 600, run_attempt: 3, source_sha: exportSha, artifact_name: exportArtifact.name,
      manifest_json: freshManifest.toString('utf8'), manifest_sha256: hash(freshManifest),
      price_observations: priceObservations(priceDay), price_observations_sha256: observationHash(priceDay) };
    metadataArtifact = artifact(801, 'static-site-data-manifest-600-3', 600, exportSha,
      '2026-11-03T00:06:00Z', { 'source.json': jsonBytes(metadata) }, { tar: false });
    artifacts.push(exportArtifact, metadataArtifact);
  }
  api[repoApi('/actions/artifacts?per_page=100')] = [{ artifacts }];
  api[repoApi('/actions/runs/500/artifacts?per_page=100')] = [{ artifacts: [liveArtifact] }];
  write(eventPath, jsonBytes({ workflow_run: { id: 600 }, inputs: { ui_only: false } }));

  // Replace only a temporary bootstrap pin. The actual controller code and
  // archive verification run unchanged against the tiny publication history.
  const scripts = join(root, '.github/scripts');
  cpSync(dirname(cli), scripts, { recursive: true });
  cpSync(join(project, 'contracts'), join(root, 'contracts'), { recursive: true });
  const pinPath = join(scripts, 'approved-ui-bootstrap.json');
  write(pinPath, jsonBytes({
    site_url: siteUrl, repository, ui_sha: uiSha, ui_files: approvedHashes,
    approved_run_id: 500, approved_attempt: 2, artifact_id: 700,
    artifact_zip_sha256: liveArtifact.digest.slice('sha256:'.length),
    approved_data_manifest_sha256: hash(liveManifest), verification_universe: receipt.verification_universe,
    approved_price_observations: bootstrapPrices,
    approved_price_observations_sha256: digest(bootstrapPrices),
  }));
  const commandPath = join(scripts, 'select-release-source.mjs');

  // No real GitHub executable or network transport is used, even for failures.
  write(join(bin, 'gh'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PUBLICATION_REQUEST_LOG, JSON.stringify({kind:'gh',args})+'\\n');
if (args[0]!=='api' || args.slice(1,-1).some(arg=>!['--paginate','--slurp'].includes(arg))) throw Error('Only fixture API reads are allowed');
const endpoint=args.at(-1), config=JSON.parse(fs.readFileSync(process.env.PUBLICATION_FIXTURE,'utf8'));
if (Object.hasOwn(config.downloads,endpoint)) process.stdout.write(fs.readFileSync(config.downloads[endpoint]));
else if (Object.hasOwn(config.api,endpoint)) process.stdout.write(JSON.stringify(config.api[endpoint]));
else throw Error('Unexpected fixture API request: '+endpoint);
`);
  chmodSync(join(bin, 'gh'), 0o755);
  write(preload, `
import { appendFileSync, readFileSync } from 'node:fs';
globalThis.fetch = async (input, options) => {
  const config=JSON.parse(readFileSync(process.env.PUBLICATION_FIXTURE,'utf8'));
  const url=new URL(input), base=new URL(config.siteUrl);
  if (url.origin!==base.origin || !url.pathname.startsWith(base.pathname)) throw Error('Unexpected fetch destination');
  if (options?.cache!=='no-store' || options?.redirect!=='error' || options?.headers?.['Cache-Control']!=='no-cache' || !url.searchParams.has('publication_check')) throw Error('Live read must bypass caches');
  const path=url.pathname.slice(base.pathname.length);
  appendFileSync(process.env.PUBLICATION_REQUEST_LOG,JSON.stringify({kind:'fetch',path})+'\\n');
  const bytes=config.live[path];
  return { ok:bytes!=null, status:bytes==null?404:200, arrayBuffer:async()=>Buffer.from(bytes,'base64') };
};
`);
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: root, RUNNER_TEMP: runner,
    GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outputPath, GITHUB_RUN_ID: '900', GITHUB_RUN_ATTEMPT: '4', RELEASE_SHA: controllerSha,
    PUBLICATION_FIXTURE: fixturePath, PUBLICATION_REQUEST_LOG: logPath,
  };
  const invoke = command => {
    write(fixturePath, jsonBytes(config)); write(outputPath, '');
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, commandPath, command], {
      cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    });
    return { ...result, text: `${result.stdout || ''}${result.stderr || ''}`, output: readFileSync(outputPath, 'utf8') };
  };
  const success = command => {
    const result = invoke(command);
    expect(result.error, result.text).toBeUndefined();
    expect(result.status, result.text).toBe(0);
    return result;
  };
  const dist = join(root, 'release/frontend/dist');
  const installTransport = (frontend = 'release/frontend') => {
    for (const name of ['researchTransport.js', 'researchFloat64.js', 'researchHex.js', 'financialHistory.js', 'evidenceTime.js']) {
      write(join(root, frontend, 'src/static', name), readFileSync(join(project, 'frontend/src/static', name)));
    }
    write(join(root, frontend, 'contracts/native_annual_history_v1.json'), readFileSync(join(project, 'frontend/contracts/native_annual_history_v1.json')));
    write(join(root, frontend, 'package.json'), '{"type":"module"}');
  };
  const simulateBuild = () => {
    // Represent outputs from the separately gated build without running it here.
    installTransport();
    mkdirSync(dist, { recursive: true });
    cpSync(join(root, 'release/frontend/public/static-data'), join(dist, 'static-data'), { recursive: true });
    for (const path of Object.keys(approvedBytes)) write(join(dist, path), `rebuilt ${path}`);
    write(join(dist, 'assets/unapproved-extra.js'), 'new build bytes');
    for (const path of mutableFiles) write(join(dist, path), jsonBytes({ source: 'validated-build', file: path }));
  };
  return { root, runner, env, config, currentGates, receipt, liveFiles, liveManifest, freshManifest, liveArtifact,
    exportArtifact, metadataArtifact, metadata, exportFiles, pinPath, invoke, success, dist, simulateBuild, installTransport,
    state: () => JSON.parse(readFileSync(join(runner, 'verified-publication/state.json'), 'utf8')),
    requests: () => readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    finalReceipt: () => JSON.parse(readFileSync(join(dist, 'publication.json'), 'utf8')),
  };
}

function addExportCharts(f, dates) {
  const index = JSON.parse(f.exportFiles['static-data/charts/index.json']);
  for (const [symbol, date] of Object.entries(dates)) {
    index.symbols.push({ symbol, path: `charts/${symbol}.json` });
    f.exportFiles[`static-data/charts/${symbol}.json`] = jsonBytes({ market: 'US', symbol,
      bars: [{ date, open: 20, high: 21, low: 19, close: 20, volume: 1_500_000 }] });
    f.metadata.price_observations[JSON.stringify(['US', 'chart', symbol])] = date;
  }
  f.exportFiles['static-data/charts/index.json'] = jsonBytes(index);
  f.exportArtifact.digest = makeArchive(f.config.downloads[repoApi('/actions/artifacts/800/zip')], f.exportFiles);
  f.metadata.price_observations_sha256 = digest(f.metadata.price_observations);
  f.metadataArtifact.digest = makeArchive(f.config.downloads[repoApi('/actions/artifacts/801/zip')],
    { 'source.json': jsonBytes(f.metadata) }, { tar: false });
}

describe('split Pages publication CLI', () => {
  it('holds all new UI with any pending correction but permits proven data advances', () => {
    const f = fixture({ designPassed: true, expired: true });
    write(join(f.root, '.github/pending-financial-correction.json'), '{ malformed or superseded hold');
    expect(f.success('plan').output).toBe(`publish=true\nsha=${uiSha}\nmode=data\nmigration=false\n`);
    expect(f.state().decision.pendingFinancialCorrection).toBe(true);
    expect(f.state().decision.approval).toBeUndefined();
    f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    expect(uiTree(f.dist)).toEqual(approvedBytes);
  });

  it('holds equal-date automatic UI promotion as a no-op without weakening metadata migration', () => {
    for (const legacy of [false, true]) {
      const f = fixture({ designPassed: true, fresh: false, legacy });
      write(join(f.root, '.github/pending-financial-correction.json'), '{}');
      const result = f.success('plan');
      if (!legacy) expect(result.output).toBe('publish=false\n');
      else expect(f.state()).toMatchObject({ sourceSha: uiSha, decision: { mode: 'data', migration: true } });
    }
  });

  it('recheck rejects a UI build when a pending correction appears after planning', () => {
    const f = fixture({ designPassed: true, expired: true });
    f.success('plan'); f.success('restore'); f.simulateBuild(); f.success('compose');
    write(join(f.root, '.github/pending-financial-correction.json'), '{}');
    expect(f.invoke('recheck').text).toContain('Current-main publication gates changed');
  });

  it('advances data after the old Pages artifact expires while failing current Design preserves every approved UI byte', () => {
    const f = fixture({ expired: true });
    const plan = f.success('plan');
    expect(plan.output).toBe(`publish=true\nsha=${uiSha}\nmode=data\nmigration=false\n`);
    expect(f.state()).toMatchObject({ sourceSha: uiSha, controllerSha: mainSha,
      source: { runId: 600, attempt: 3, artifact: { id: 800 }, manifestHash: hash(f.freshManifest) } });
    write(join(f.root, 'release/frontend/public/static-data/stale.json'), 'old leftover');
    f.success('restore');
    expect(existsSync(join(f.root, 'release/frontend/public/static-data/stale.json'))).toBe(false);
    expect(readFileSync(join(f.root, 'release/frontend/public/static-data/manifest.json'))).toEqual(f.freshManifest);
    f.simulateBuild();
    f.success('compose');
    expect(uiTree(f.dist)).toEqual(approvedBytes);
    for (const path of mutableFiles) expect(JSON.parse(readFileSync(join(f.dist, path), 'utf8'))).toEqual({ source: 'validated-build', file: path });
    expect(f.finalReceipt()).toMatchObject({ ui_sha: uiSha, controller_sha: mainSha, approval,
      run_id: 900, run_attempt: 4, artifact_name: 'github-pages-900-4',
      ui_files: approvedHashes, ui_digest: digest(approvedHashes), data_manifest_sha256: hash(f.freshManifest),
      verification_universe: { as_of_date: '2026-11-02', required_symbols: ['KEEP'], minimum_target: 0.9, total: 1, verified: 1 },
      data_source: { artifact_id: 800, run_id: 600, attempt: 3 } });
    f.success('recheck');
    const endpoints = f.requests().filter(item => item.kind === 'gh').map(item => item.args.at(-1));
    expect(endpoints).toContain(repoApi('/actions/runs/500/attempts/2'));
    expect(endpoints).toContain(repoApi('/actions/runs/500/attempts/2/jobs?per_page=100'));
    for (const gate of approvedGates) expect(endpoints).toContain(repoApi(`/actions/runs/${gate.id}/attempts/${gate.attempt}`));
    expect(endpoints).toContain(repoApi('/actions/runs/600/attempts/3/jobs?per_page=100'));
    expect(endpoints).not.toContain(repoApi('/actions/artifacts/700/zip'));
  });

  it('publishes rebuilt UI only when both exact-main gates pass', () => {
    const f = fixture({ designPassed: true, expired: true });
    expect(f.success('plan').output).toBe(`publish=true\nsha=${mainSha}\nmode=ui\nmigration=false\n`);
    f.success('restore'); f.simulateBuild();
    const builtUi = uiTree(f.dist);
    f.success('compose'); f.success('recheck');
    expect(uiTree(f.dist)).toEqual(builtUi);
    expect(f.finalReceipt()).toMatchObject({ ui_sha: mainSha, approval: { type: 'gates', sha: mainSha,
      runs: f.currentGates.map(run => ({ id: run.id, attempt: run.run_attempt, path: run.path })) } });
  });

  it('marks a newly approved UI using existing prices as offline published input', () => {
    const f = fixture({ fresh: false, designPassed: true });
    expect(f.success('plan').output).toBe(`publish=true\nsha=${mainSha}\nmode=ui\nmigration=false\npublished_input=true\n`);
    expect(f.state().source.artifact.id).toBe(700);
    f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
  });

  it('skips duplicate automatic and untyped manual same-code data changes', () => {
    const f = fixture({ fresh: false, sameCode: true });
    expect(f.success('plan').output).toBe('publish=false\n');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
    f.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    expect(f.success('plan').output).toBe('publish=false\n');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
  });
  it('fails the final deployment recheck when a different valid live publication supersedes the plan', () => {
    const f = fixture();
    f.success('plan'); f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    const runs = f.config.api[repoApi('/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100')][0].workflow_runs;
    runs[0] = { ...runs[0], id: 501, run_attempt: 1, updated_at: '2026-11-03T01:10:00Z' };
    f.config.api[repoApi('/actions/runs/501/jobs?filter=all&per_page=100')] = [{ jobs: [{
      id: 5011, run_attempt: 1, started_at: '2026-11-03T01:00:00Z',
      steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success',
        started_at: '2026-11-03T01:08:00Z', completed_at: '2026-11-03T01:09:00Z' }],
    }] }];
    f.config.api[repoApi('/actions/runs/501/attempts/1')] = runs[0];
    f.config.api[repoApi('/actions/runs/501/attempts/1/jobs?per_page=100')] = f.config.api[repoApi('/actions/runs/501/jobs?filter=all&per_page=100')];
    f.config.live['publication.json'] = jsonBytes({ ...f.receipt, run_id: 501,
      run_attempt: 1, artifact_name: 'github-pages-501-1' }).toString('base64');
    const result = f.invoke('recheck');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Live UI or data changed; discard this superseded publication');
  });

  it('rejects traversal before extracting any selected data', () => {
    const f = fixture({ unsafe: true });
    f.success('plan');
    const marker = join(f.root, 'release/frontend/public/static-data/existing.json');
    write(marker, 'keep existing data until the archive is validated');
    const result = f.invoke('restore');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Unsafe or duplicate archive path');
    expect(readFileSync(marker, 'utf8')).toBe('keep existing data until the archive is validated');
    expect(existsSync(join(f.root, 'release/frontend/escaped.txt'))).toBe(false);
  });

  it('rejects an export whose ZIP bytes disagree with the GitHub artifact digest', () => {
    const f = fixture();
    f.exportArtifact.digest = `sha256:${'0'.repeat(64)}`;
    f.success('plan');
    const result = f.invoke('restore');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Artifact archive digest mismatch');
    expect(existsSync(join(f.root, 'release/frontend/public/static-data'))).toBe(false);
  });

  it('rejects a provenance companion with a different exact attempt, even when its own digest is valid', () => {
    const f = fixture();
    const zip = f.config.downloads[repoApi('/actions/artifacts/801/zip')];
    f.metadataArtifact.digest = makeArchive(zip, { 'source.json': jsonBytes({ ...f.metadata, run_attempt: 2 }) }, { tar: false });
    const result = f.invoke('plan');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Export attempt and manifest provenance disagree');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
  });

  it('keeps a missing previously verified symbol in the denominator despite a perfect current-only quality report', () => {
    const f = fixture();
    f.success('plan'); f.success('restore'); f.simulateBuild();
    write(join(f.dist, 'static-data/research-index.json'), jsonBytes({
      as_of_date: '2026-11-02', rows: [verifiedRow('2026-11-02', 'NEW')],
    }));
    const result = f.invoke('compose');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Retained-universe verification below the existing 90% requirement: 1/2');
    expect(JSON.parse(readFileSync(join(f.runner, 'verified-publication/retained-universe-report.json'), 'utf8')))
      .toMatchObject({ requiredSymbols: ['KEEP', 'NEW'], total: 2, verified: 1, passed: false,
        exitedSymbols: [], missing: { total: 1, reasons: { missing_row: 1 } } });
    expect(existsSync(join(f.dist, 'publication.json'))).toBe(false);
  });

  it('installs a receipt on the exact legacy snapshot before considering a newer degraded export', () => {
    const f = fixture({ legacy: true, degraded: true });
    expect(f.success('plan').output).toBe(`publish=true\nsha=${uiSha}\nmode=data\nmigration=true\n`);
    expect(f.state()).toMatchObject({ decision: { mode: 'data', migration: true },
      source: { runId: 500, attempt: 2, artifact: { id: 700, name: 'github-pages' }, manifestHash: hash(f.liveManifest) } });
    f.success('restore'); f.installTransport();
    const restored = readTree(join(f.root, 'release/frontend/public'));
    for (const [path, bytes] of Object.entries(f.liveFiles)) {
      if (path.startsWith('static-data/') || mutableFiles.includes(path)) expect(restored[path], path).toEqual(bytes);
    }
    expect(existsSync(f.dist)).toBe(false);
    f.success('compose'); f.success('recheck');
    const published = readTree(f.dist);
    expect(Object.keys(published).sort()).toEqual([...Object.keys(f.liveFiles), 'publication.json'].sort());
    delete published['publication.json'];
    expect(published).toEqual(f.liveFiles);
    expect(f.finalReceipt()).toMatchObject({ ui_sha: uiSha, approval: { type: 'bootstrap', sha: uiSha },
      data_manifest_sha256: hash(f.liveManifest), data_source: { artifact_id: 700, run_id: 500, attempt: 2 },
      verification_universe: { as_of_date: '2026-11-01', required_symbols: ['KEEP'], total: 1, verified: 1 } });
    const endpoints = f.requests().filter(item => item.kind === 'gh').map(item => item.args.at(-1));
    expect(endpoints).toContain(repoApi('/actions/artifacts/700/zip'));
    expect(endpoints).not.toContain(repoApi('/actions/artifacts/800/zip'));
    expect(endpoints).not.toContain(repoApi('/actions/artifacts/801/zip'));
    expect(endpoints).not.toContain(repoApi('/actions/runs/600/attempts/3'));
  });

  it('retains an absent bootstrap series through migration without rewriting any live data or UI byte', () => {
    const absent = '["US","chart","ABSENT"]';
    const f = fixture({ legacy: true, bootstrapPrices: { ...priceObservations('2026-10-31'), [absent]: '2026-10-30' } });
    f.success('plan'); f.success('restore'); f.installTransport(); f.success('compose'); f.success('recheck');
    const receipt = f.finalReceipt();
    expect(receipt.price_observations).toEqual(priceObservations('2026-11-01'));
    expect(receipt.known_price_dates).toEqual({ ...priceObservations('2026-11-01'), [absent]: '2026-10-30' });
    const published = readTree(f.dist);
    delete published['publication.json'];
    expect(published).toEqual(f.liveFiles);
  });

  it('rejects a stale returning series omitted by an already-issued receipt even when other prices advance', () => {
    const absent = '["US","chart","ABSENT"]';
    const f = fixture({ bootstrapPrices: { ...priceObservations('2026-10-31'), [absent]: '2026-10-30' } });
    expect(f.receipt.known_price_dates).not.toHaveProperty(absent);
    addExportCharts(f, { ABSENT: '2026-10-29' });
    expect(f.success('plan').output).toBe('publish=false\n');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
    expect(existsSync(f.dist)).toBe(false);
    expect(f.requests().some(item => item.kind === 'gh' && item.args.at(-1) === repoApi('/actions/artifacts/800/zip'))).toBe(false);
  });

  it.each(['2026-10-30', '2026-11-02'])('accepts a returning series dated %s and preserves the maximum dates from all proven sources', date => {
    const absent = '["US","chart","ABSENT"]', receiptOnly = '["US","chart","RECEIPT_ONLY"]';
    const f = fixture({ bootstrapPrices: { ...priceObservations('2026-10-31'), [absent]: '2026-10-30' } });
    f.receipt.known_price_dates[receiptOnly] = '2026-10-31';
    f.config.live['publication.json'] = jsonBytes(f.receipt).toString('base64');
    addExportCharts(f, { ABSENT: date, NEW: '2026-10-01' });
    f.success('plan'); f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    const observed = { ...priceObservations('2026-11-02'), [absent]: date, '["US","chart","NEW"]': '2026-10-01' };
    expect(f.finalReceipt().price_observations).toEqual(observed);
    expect(f.finalReceipt().known_price_dates).toEqual({ ...observed, [receiptOnly]: '2026-10-31' });
    expect(uiTree(f.dist)).toEqual(approvedBytes);
  });

  it('does not manufacture a data advance from a missing bootstrap date or a previously unknown series', () => {
    const f = fixture({ scanDay: '2026-11-01', bootstrapPrices: {
      ...priceObservations('2026-10-31'), '["US","chart","ABSENT"]': '2026-10-30',
    } });
    addExportCharts(f, { NEW: '2026-11-02' });
    expect(f.success('plan').output).toBe('publish=false\n');
    expect(f.success('plan').output).toBe('publish=false\n');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
    expect(existsSync(f.dist)).toBe(false);
  });

  it.each([false, true])('rejects corrupt bootstrap evidence before publication with legacy=%s', legacy => {
    const f = fixture({ legacy });
    const pin = JSON.parse(readFileSync(f.pinPath, 'utf8'));
    pin.approved_price_observations['["US","chart","ABSENT"]'] = '2026-10-30';
    write(f.pinPath, jsonBytes(pin));
    const result = f.invoke('plan');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Pinned price observation evidence is corrupt');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
  });

  it.each([
    ['["US","chart","ABSENT"]', '9999-01-01', 'Price observation exceeds capture date'],
    ['["US","chart","ABSENT"]', '2026-02-30', 'Invalid price observation date'],
    ['["us","chart","ABSENT"]', '2026-10-30', 'Invalid price observation identity'],
  ])('rejects self-consistent invalid bootstrap evidence %s %s', (key, date, message) => {
    const f = fixture({ bootstrapPrices: { ...priceObservations('2026-11-01'), [key]: date } });
    const result = f.invoke('plan');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain(message);
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
  });

  it.each(['expired', 'missing'])('refreshes the exact pinned receiptless snapshot when its original artifact is %s', availability => {
    const f = fixture({ legacy: true, expired: true });
    if (availability === 'missing') {
      f.config.api[repoApi('/actions/runs/500/artifacts?per_page=100')] = [{ artifacts: [] }];
      const pages = f.config.api[repoApi('/actions/artifacts?per_page=100')];
      pages[0].artifacts = pages[0].artifacts.filter(artifact => artifact.id !== 700);
    }
    expect(f.success('plan').output).toBe(`publish=true\nsha=${uiSha}\nmode=data\nmigration=false\n`);
    expect(f.state()).toMatchObject({ decision: { mode: 'data' }, sourceSha: uiSha,
      live: { receipt: null, legacyArtifact: null, priceObservations: priceObservations('2026-11-01') },
      source: { runId: 600, attempt: 3, artifact: { id: 800 }, manifestHash: hash(f.freshManifest) } });
    f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    expect(uiTree(f.dist)).toEqual(approvedBytes);
    expect(readFileSync(join(f.dist, 'static-data/manifest.json'))).toEqual(f.freshManifest);
    expect(f.finalReceipt()).toMatchObject({ ui_sha: uiSha, approval: { type: 'bootstrap', sha: uiSha },
      data_source: { artifact_id: 800, run_id: 600, attempt: 3 },
      price_observations: priceObservations('2026-11-02'), known_price_dates: priceObservations('2026-11-02') });
    const endpoints = f.requests().filter(item => item.kind === 'gh').map(item => item.args.at(-1));
    expect(endpoints).not.toContain(repoApi('/actions/artifacts/700/zip'));
    expect(endpoints).toContain(repoApi('/actions/artifacts/800/zip'));
    expect(endpoints).toContain(repoApi('/actions/artifacts/801/zip'));
  });

  it.each(['changed manifest', 'later deployment'])('rejects an unpinned receiptless %s without its exact artifact despite a fresh export', change => {
    const f = fixture({ legacy: true, expired: true });
    if (change === 'changed manifest') {
      f.config.live['static-data/manifest.json'] = jsonBytes({ ...manifest('2026-11-01'),
        generation: 'not-the-pinned-live-snapshot' }).toString('base64');
    } else {
      const runs = f.config.api[repoApi('/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100')][0].workflow_runs;
      runs.unshift({ ...runs[0], id: 501, run_attempt: 1, run_started_at: '2026-11-03T01:00:00Z',
        updated_at: '2026-11-03T01:10:00Z' });
      f.config.api[repoApi('/actions/runs/501/jobs?filter=all&per_page=100')] = [{ jobs: [{
        id: 5011, run_attempt: 1, started_at: '2026-11-03T01:00:00Z',
        steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success',
          started_at: '2026-11-03T01:08:00Z', completed_at: '2026-11-03T01:09:00Z' }],
      }] }];
      f.config.api[repoApi('/actions/runs/501/artifacts?per_page=100')] = [{ artifacts: [] }];
    }
    const result = f.invoke('plan');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Legacy bootstrap needs its exact retained deployed artifact or the exact approved #59 snapshot');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
    expect(existsSync(f.dist)).toBe(false);
    const endpoints = f.requests().filter(item => item.kind === 'gh').map(item => item.args.at(-1));
    expect(endpoints).not.toContain(repoApi('/actions/artifacts/800/zip'));
    expect(endpoints).not.toContain(repoApi('/actions/artifacts/801/zip'));
  });

  it('rejects missing retained symbols in Design data before any timing run', () => {
    const f = fixture({ degraded: true });
    f.success('design'); f.installTransport('frontend');
    const result = f.invoke('check-design-data');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Retained-universe verification below the existing 90% requirement: 1/2');
    expect(JSON.parse(readFileSync(join(f.runner, 'verified-publication/retained-universe-report.json'), 'utf8')))
      .toMatchObject({ requiredSymbols: ['KEEP', 'NEW'], total: 2, verified: 1, passed: false,
        missing: { total: 1, reasons: { missing_row: 1 } } });
    expect(existsSync(f.dist)).toBe(false);
  });

  it('publishes advancing chart and home observations even when the scan manifest is unchanged', () => {
    const f = fixture({ expired: true, scanDay: '2026-11-01', priceDay: '2026-11-02' });
    expect(f.freshManifest).toEqual(f.liveManifest);
    expect(f.success('plan').output).toBe(`publish=true\nsha=${uiSha}\nmode=data\nmigration=false\n`);
    expect(f.state().source).toMatchObject({ runId: 600, attempt: 3, artifact: { id: 800 } });
    f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    expect(readFileSync(join(f.dist, 'static-data/manifest.json'))).toEqual(f.liveManifest);
    expect(f.finalReceipt()).toMatchObject({ price_observations: priceObservations('2026-11-02'),
      known_price_dates: priceObservations('2026-11-02') });
    expect(uiTree(f.dist)).toEqual(approvedBytes);
  });

  it('records raw manifest provenance and actual chart/home dates from export bytes', () => {
    const f = fixture();
    const bytes = jsonBytes(manifest('2026-10-01'));
    for (const [path, content] of Object.entries({ ...researchFiles('2026-10-01', '2026-10-02'),
      'static-data/manifest.json': bytes })) write(join(f.root, 'frontend/dist', path), content);
    Object.assign(f.env, { GITHUB_SHA: exportSha, GITHUB_RUN_ID: '600', GITHUB_RUN_ATTEMPT: '3' });
    f.success('export-metadata');
    expect(JSON.parse(readFileSync(join(f.runner, 'export-provenance/source.json'), 'utf8'))).toMatchObject({
      run_id: 600, run_attempt: 3, source_sha: exportSha, artifact_name: 'static-site-data-600-3',
      manifest_json: bytes.toString('utf8'), manifest_sha256: hash(bytes),
      price_observations: priceObservations('2026-10-02'), price_observations_sha256: observationHash('2026-10-02'),
    });
  });

  it('rejects self-consistent price metadata that invents an advance absent from the artifact', () => {
    const f = fixture({ scanDay: '2026-11-01', priceDay: '2026-11-01' });
    const zip = f.config.downloads[repoApi('/actions/artifacts/801/zip')];
    f.metadataArtifact.digest = makeArchive(zip, { 'source.json': jsonBytes({ ...f.metadata,
      price_observations: priceObservations('2026-11-02'), price_observations_sha256: observationHash('2026-11-02'),
    }) }, { tar: false });
    expect(f.success('plan').output).toContain('publish=true\n');
    const result = f.invoke('restore');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Archive price observations disagree with its exact attempt metadata');
    expect(existsSync(f.dist)).toBe(false);
  });

  it('fails final recheck when preparation loses the selected same-scan price advance', () => {
    const f = fixture({ scanDay: '2026-11-01', priceDay: '2026-11-02' });
    f.success('plan'); f.success('restore'); f.simulateBuild();
    const prior = researchFiles('2026-11-01');
    for (const path of ['static-data/charts/KEEP.json', 'static-data/home.json']) write(join(f.dist, path), prior[path]);
    f.success('compose');
    expect(f.finalReceipt().price_observations).toEqual(priceObservations('2026-11-01'));
    const result = f.invoke('recheck');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Final price observations regress or disagree with the receipt');
  });

  it('rejects deleting an absent series from the retained ledger after compose', () => {
    const f = fixture();
    const absent = '["US","chart","ABSENT"]';
    f.receipt.known_price_dates[absent] = '2026-10-30';
    f.config.live['publication.json'] = jsonBytes(f.receipt).toString('base64');
    f.success('plan'); f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    const receipt = f.finalReceipt();
    expect(receipt.price_observations).not.toHaveProperty(absent);
    expect(receipt.known_price_dates[absent]).toBe('2026-10-30');
    delete receipt.known_price_dates[absent];
    write(join(f.dist, 'publication.json'), jsonBytes(receipt));
    const result = f.invoke('recheck');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Final retained price ledger differs from the proven publication history');
  });

  it('rejects year-9999 export observations even when metadata and archive agree', () => {
    const f = fixture({ priceDay: '9999-01-01' });
    const result = f.invoke('plan');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Price observation exceeds capture date');
    expect(result.text).toContain('9999-01-01 > 2026-11-03');
    expect(existsSync(join(f.runner, 'verified-publication/state.json'))).toBe(false);
    expect(existsSync(f.dist)).toBe(false);
  });

  it('rejects year-9999 final observations even if the final receipt was changed to agree', () => {
    const f = fixture();
    f.success('plan'); f.success('restore'); f.simulateBuild(); f.success('compose');
    const impossible = researchFiles('2026-11-02', '9999-01-01');
    for (const path of ['static-data/charts/KEEP.json', 'static-data/home.json']) write(join(f.dist, path), impossible[path]);
    const receipt = f.finalReceipt();
    receipt.price_observations = priceObservations('9999-01-01');
    receipt.known_price_dates = priceObservations('9999-01-01');
    write(join(f.dist, 'publication.json'), jsonBytes(receipt));
    const result = f.invoke('recheck');
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('Price observation exceeds capture date');
    expect(result.text).toContain('9999-01-01 > 2026-11-03');
  });

  it('accepts a legitimate next-UTC-day observation within the immutable UTC+14 capture bound', () => {
    const f = fixture({ priceDay: '2026-11-04' });
    f.exportArtifact.created_at = '2026-11-03T10:05:00Z';
    f.metadataArtifact.created_at = '2026-11-03T10:06:00Z';
    Object.assign(f.config.api[repoApi('/actions/runs/600/attempts/3')], {
      run_started_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:10:00Z',
    });
    const job = f.config.api[repoApi('/actions/runs/600/attempts/3/jobs?per_page=100')][0].jobs[0];
    job.started_at = '2026-11-03T10:01:00Z'; job.completed_at = '2026-11-03T10:09:00Z';
    job.steps[0].started_at = '2026-11-03T10:02:00Z'; job.steps[0].completed_at = '2026-11-03T10:04:00Z';
    f.success('plan'); f.success('restore'); f.simulateBuild(); f.success('compose'); f.success('recheck');
    expect(f.finalReceipt()).toMatchObject({ price_observations: priceObservations('2026-11-04'),
      known_price_dates: priceObservations('2026-11-04') });
    expect(uiTree(f.dist)).toEqual(approvedBytes);
  });
});

function correctionFixture() {
  const f = fixture({fresh:true});
  const contract = JSON.parse(readFileSync(join(project,'contracts/financial_correction_v1.json'),'utf8'));
  const base = jsonBytes({market:'US',as_of_date:'2026-11-01',rows:[{symbol:'KEEP',market:'US',current_price:20,adv_usd:30000000}]}), cohort = jsonBytes({symbols:['KEEP'],base_artifact_sha256:hash(base)}), archive = jsonBytes({schema_version:'fixture-archive'});
  const artifact = {id:990,name:`financial-statement-recovery-${exportSha}-2`,expired:false,size_in_bytes:1000,created_at:'2026-11-03T01:05:00Z',workflow_run:{id:950,head_sha:exportSha}};
  const zip=join(f.root,'correction-source.zip');artifact.digest=makeArchive(zip,{'base.json':base,'cohort.json':cohort,'archive/manifest.json':archive},{tar:false});
  f.config.downloads[repoApi('/actions/artifacts/990/zip')]=zip;
  const source={repository,workflow:contract.source_workflow,head_sha:exportSha,run_id:950,run_attempt:2,artifact_id:990,artifact_name:artifact.name,artifact_sha256:artifact.digest.slice(7),archive_manifest_sha256:hash(archive),acquisition_base_sha256:hash(base),cohort_sha256:hash(cohort)};
  const run={id:950,run_attempt:2,repository:{full_name:repository},head_repository:{full_name:repository},head_sha:exportSha,path:contract.source_workflow,head_branch:'improve/mandatory-financial-source-recovery',event:'push',status:'completed',conclusion:'success'};
  f.config.api[repoApi('/actions/runs/950/attempts/2')]=run;
  f.config.api[repoApi('/actions/runs/950/attempts/2/jobs?per_page=100')]=[{jobs:[{id:9502,name:'statement-recovery',run_attempt:2,conclusion:'success',started_at:'2026-11-03T01:00:00Z',completed_at:'2026-11-03T01:06:00Z'}]}];
  f.config.api[repoApi('/actions/runs/950/artifacts?per_page=100')]=[{artifacts:[artifact]}];
  for(const ref of [f.currentGates[0],...approvedGates.map(gate=>f.config.api[repoApi(`/actions/runs/${gate.id}/attempts/${gate.attempt}`)])]) {
    f.config.api[repoApi(`/actions/runs/${ref.id}/attempts/${ref.run_attempt}`)]=ref;
    const names=ref.path.endsWith('ci.yml')?contract.required_ci_jobs:['Real-data design and performance budgets'];
    f.config.api[repoApi(`/actions/runs/${ref.id}/attempts/${ref.run_attempt}/jobs?per_page=100`)]=[{jobs:names.map((name,i)=>({id:ref.id*10+i+1,name,run_attempt:ref.run_attempt,status:'completed',conclusion:'success'}))}];
  }
  const intent={schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:`500/2/${hash(jsonBytes(f.receipt))}/${hash(f.liveManifest)}`,source};
  f.env.GITHUB_EVENT_NAME='workflow_dispatch';
  const setIntent=value=>write(f.env.GITHUB_EVENT_PATH,jsonBytes({inputs:{ui_only:false,financial_correction:JSON.stringify(value)}}));setIntent(intent);
  return {...f,intent,setIntent};
}

describe('typed financial correction preparation CLI',()=>{
  it('pins the published predecessor rather than selecting the newer ordinary export',()=>{
    const f=correctionFixture();expect(f.success('plan').output).toBe(`publish=true\nsha=${uiSha}\nmode=data\nmigration=false\ncorrection=true\ncorrection_prepare_only=true\n`);
    expect(f.state()).toMatchObject({source:{artifact:{id:700}},sourceSha:uiSha,controllerSha:mainSha,correction:{intent:f.intent}});
    const endpoints=f.requests().filter(v=>v.kind==='gh').map(v=>v.args.at(-1));expect(endpoints).not.toContain(repoApi('/actions/runs/600/attempts/3'));
  });
  it('cannot inject a main-only helper into an incompatible approved release checkout',()=>{
    const f=correctionFixture();f.success('plan');
    write(join(f.root,'frontend/tools/financial-correction-overlay.mjs'),'throw Error("ROOT helper must never run");');
    const result=f.invoke('restore');expect(result.status).not.toBe(0);expect(result.text).toContain('Approved UI lacks the financial correction consumer hook');expect(result.text).not.toContain('ROOT helper must never run');
    expect(existsSync(join(f.root,'release/frontend/tools/financial-correction-overlay.mjs'))).toBe(false);
    expect(f.requests().some(v=>v.kind==='gh'&&v.args.at(-1)===repoApi('/actions/artifacts/990/zip'))).toBe(false);
  });
  it.each(['controller','consumer','design'])('rejects skipped exact %s jobs rather than ordinary data fallback',kind=>{
    const f=correctionFixture(),id=kind==='controller'?201:kind==='consumer'?101:102,attempt=kind==='controller'?4:kind==='consumer'?2:3;
    f.config.api[repoApi(`/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`)][0].jobs[0].conclusion='skipped';
    const result=f.invoke('plan');expect(result.status).not.toBe(0);expect(result.text).toMatch(/Correction.*(?:successful|CI job)/);expect(existsSync(join(f.runner,'verified-publication/state.json'))).toBe(false);
  });
  it('rejects an intent bound to a superseded predecessor before restoring a source',()=>{
    const f=correctionFixture();f.setIntent({...f.intent,previous_publication_identity:`499/1/${'a'.repeat(64)}/${'b'.repeat(64)}`});
    const result=f.invoke('plan');expect(result.status).not.toBe(0);expect(result.text).toContain('predecessor is missing or superseded');
    expect(f.requests().some(v=>v.kind==='gh'&&v.args.at(-1)===repoApi('/actions/artifacts/990/zip'))).toBe(false);
  });
});
