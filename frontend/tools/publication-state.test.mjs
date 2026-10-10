import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConditionalDeploymentJobsReader, withConditionalDeploymentJobsReader } from '../../.github/scripts/conditional-deployment-jobs.mjs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  bootstrap, compareData, dataChronology, deploymentAnchor, inventoryDigest, isData, latestDeployment, legacyArtifactForDeployment,
  livePublication, safePath, sha256, uiInventory, validateReceipt, verifyApproval,
} from '../../.github/scripts/publication-state.mjs';

const repository = bootstrap.repository;
const uiSha = 'b'.repeat(40);
const workflowPath = file => `.github/workflows/${file}`;
const clone = value => JSON.parse(JSON.stringify(value));
const market = (date = '2026-10-01') => ({
  as_of_date: date,
  freshness: {
    scan_as_of_date: date, breadth_latest_date: date, groups_latest_date: date,
    scan_published_at: `${date}T22:00:00Z`, prices_generated_at: `${date}T23:00:00Z`,
  },
});
const manifest = (date = '2026-10-01') => ({
  as_of_date: date, default_market: 'US', supported_markets: ['US'], markets: { US: market(date) },
});
const twoMarkets = () => ({ ...manifest(), supported_markets: ['US', 'JP'], markets: { US: market(), JP: market() } });
const uiBytes = {
  'index.html': '<html><script src="assets/app.js"></script></html>',
  'assets/app.js': 'console.log("approved");',
  'sw.js': 'self.addEventListener("fetch", () => {});',
  'precache-manifest.json': '["index.html","assets/app.js"]',
  'strategy-scorecard.json': '{"version":1}',
};
const uiFiles = Object.fromEntries(Object.entries(uiBytes).map(([path, bytes]) => [path, sha256(bytes)]));
const gateRefs = [
  { id: 101, attempt: 2, path: workflowPath('ci.yml') },
  { id: 102, attempt: 1, path: workflowPath('design-acceptance.yml') },
];
const receipt = (data = manifest(), overrides = {}) => ({
  price_observations: {}, known_price_dates: {},
  schema: 1, ui_sha: uiSha, run_id: 20, run_attempt: 2, artifact_name: 'github-pages-20-2',
  verification_universe: { as_of_date: data.as_of_date, required_symbols: ['KEEP'], minimum_target: 0.9, total: 1, verified: 1 },
  data_manifest_sha256: sha256(JSON.stringify(data)), ui_files: { ...uiFiles }, ui_digest: inventoryDigest(uiFiles),
  approval: { type: 'gates', sha: uiSha, runs: clone(gateRefs) }, ...overrides,
});
const run = (overrides = {}) => ({
  id: 20, run_attempt: 2, head_sha: uiSha, head_branch: 'main', event: 'workflow_run',
  path: workflowPath('research-ui-release.yml'), status: 'completed', conclusion: 'success',
  updated_at: '2026-10-03T02:00:00Z', repository: { full_name: repository }, head_repository: { full_name: repository },
  ...overrides,
});
const deployed = (attempt = 2, completed = '2026-10-03T01:59:00Z', overrides = {}) => ({
  run_attempt: attempt,
  steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success', completed_at: completed, ...overrides }],
});
const gateRun = ref => run({ id: ref.id, run_attempt: ref.attempt, path: ref.path, event: 'push' });
const apiFor = ({ runs = [run()], jobs = { 20: [deployed()] }, gates = {}, staticRuns = [] } = {}) => vi.fn(endpoint => {
  if (endpoint.includes('/actions/workflows/research-ui-release.yml/runs?')) return [{ workflow_runs: runs }];
  if (endpoint.includes('/actions/workflows/static-site.yml/runs?')) return [{ workflow_runs: staticRuns }];
  const jobId = endpoint.match(/\/actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100$/)?.[1];
  if (jobId) return [{ jobs: jobs[jobId] || [] }];
  const gate = gateRefs.find(ref => endpoint.endsWith(`/actions/runs/${ref.id}/attempts/${ref.attempt}`));
  if (gate) return gates[gate.id] || gateRun(gate);
  const exact = endpoint.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)(\/jobs\?per_page=100)?$/);
  if (exact) {
    const id = Number(exact[1]), attempt = Number(exact[2]);
    if (id === bootstrap.approved_run_id) {
      return exact[3] ? [{ jobs: [{ ...deployed(attempt, '2026-10-03T01:23:42Z', { started_at: '2026-10-03T01:23:14Z' }), started_at: '2026-10-03T01:12:45Z' }] }]
        : run({ id, run_attempt: attempt, head_sha: bootstrap.ui_sha, run_started_at: '2026-10-03T01:12:40Z' });
    }
    if (exact[3]) return [{ jobs: (jobs[id] || []).filter(job => job.run_attempt === attempt) }];
    return run({ ...(runs.find(item => item.id === id) || {}), id, run_attempt: attempt });
  }
  throw Error(`Unexpected API request: ${endpoint}`);
});
const fetchFor = (files, overrides = {}) => vi.fn(async url => {
  const path = url.pathname.slice(new URL(bootstrap.site_url).pathname.length);
  const value = Object.hasOwn(overrides, path) ? overrides[path] : files[path];
  const bytes = typeof value === 'function' ? value() : value;
  return { status: bytes == null ? 404 : 200, ok: bytes != null, arrayBuffer: async () => Buffer.from(bytes) };
});
const liveFiles = (data = manifest(), liveReceipt = receipt(data)) => ({
  ...uiBytes, 'publication.json': JSON.stringify(liveReceipt), 'static-data/manifest.json': JSON.stringify(data),
});
const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('market observation chronology', () => {
  it('accepts an advancing market only when all already published markets remain monotonic', () => {
    const before = twoMarkets(), after = twoMarkets();
    after.markets.JP = market('2026-10-02');
    expect(compareData(after, before)).toBe('advance');
    after.markets.US = market('2026-09-30');
    after.as_of_date = '2026-09-30';
    expect(compareData(after, before)).toBe('regression');
  });

  it('rejects a partial export that drops a published market even when US advances', () => {
    expect(compareData(manifest('2026-10-02'), twoMarkets())).toBe('regression');
  });

  it('does not call changed payload hashes or generation times new observations', () => {
    const before = manifest(), after = clone(before);
    after.generated_at = '2026-10-03T22:00:00Z';
    after.research_generation = 'c'.repeat(64);
    after.markets.US.freshness.scan_published_at = '2026-10-03T22:00:00Z';
    after.markets.US.freshness.prices_generated_at = '2026-10-03T23:00:00Z';
    expect(compareData(after, before)).toBe('equal');
    expect(compareData(before, before)).toBe('equal');
  });

  it.each(['scan_as_of_date', 'breadth_latest_date', 'groups_latest_date', 'scan_published_at', 'prices_generated_at'])(
    'does not conceal missing or regressing %s behind a newer scan date', field => {
      const before = manifest();
      for (const value of [null, '2026-09-30']) {
        const after = manifest('2026-10-02');
        after.markets.US.freshness[field] = value;
        expect(compareData(after, before)).toBe('regression');
      }
      const malformed = manifest('2026-10-02');
      malformed.markets.US.freshness[field] = 'not-a-date';
      expect(compareData(malformed, before)).toBe('unknown');
    },
  );

  it.each([
    ['empty data', {}],
    ['missing market list', { ...manifest(), supported_markets: undefined }],
    ['unknown default market', { ...manifest(), default_market: 'JP' }],
    ['listed but missing market', { ...manifest(), supported_markets: ['JP'] }],
    ['duplicated market list', { ...twoMarkets(), supported_markets: ['US', 'US'] }],
    ['impossible calendar date', manifest('2026-02-30')],
    ['aggregate/default-market disagreement', { ...manifest(), as_of_date: '2026-10-02' }],
  ])('fails closed for %s', (_label, value) => {
    expect(dataChronology(value)).toBeNull();
    expect(compareData(value, manifest())).toBe('unknown');
  });

  it('does not let an impossible freshness date roll forward into the next month', () => {
    const value = manifest('2026-02-28');
    value.markets.US.freshness.breadth_latest_date = '2026-02-30';
    expect(dataChronology(value)).toBeNull();
  });
});

describe('immutable UI inventory and receipt boundaries', () => {
  it('inventories all non-data files, including service worker, manifests, icons, and scorecards', () => {
    const directory = mkdtempSync(join(tmpdir(), 'publication-state-'));
    temporaryDirectories.push(directory);
    const files = { ...uiBytes, 'manifest.webmanifest': '{}', 'fire.svg': '<svg/>', 'nested/extra.txt': 'immutable' };
    for (const [path, bytes] of Object.entries({ ...files, 'publication.json': '{}', 'static-data/manifest.json': '{}',
      'static-data/markets/us/data.json': '{}', 'research-daily.json': '{}', 'portfolio-model.json': '{}',
      'qualification-audit.json': '{}', 'ibd-reference.json': '{}' })) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), bytes);
    }
    expect(uiInventory(directory)).toEqual(Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)])));
    expect(isData('strategy-scorecard.json')).toBe(false);
    expect(isData('precache-manifest.json')).toBe(false);
    expect(isData('static-data/markets/us/data.json')).toBe(true);
    expect(isData('assets/static-data.json')).toBe(false);
  });

  it('rejects symlinks in immutable UI instead of hashing their targets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'publication-state-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'index.html'), 'shell');
    symlinkSync('index.html', join(directory, 'sw.js'));
    expect(() => uiInventory(directory)).toThrow(/links/);
  });

  it('makes inventory identity independent of discovery order and sensitive to any byte change', () => {
    expect(inventoryDigest({ a: sha256('a'), b: sha256('b') })).toBe(inventoryDigest({ b: sha256('b'), a: sha256('a') }));
    expect(inventoryDigest({ ...uiFiles, 'sw.js': sha256('changed') })).not.toBe(inventoryDigest(uiFiles));
  });

  it.each(['../index.html', './index.html', '/index.html', 'assets/../index.html', 'assets//app.js',
    'assets\\app.js', 'assets/app.js?version=2', 'assets/app.js#fragment', 'https://outside.example/app.js',
    'http:outside.example', '%2e%2e/index.html', 'assets/%2e%2e/index.html', 'bad\0name'])('rejects unsafe UI path %s', path => {
    expect(safePath(path)).toBe(false);
    const files = { ...uiFiles, [path]: sha256('untrusted') };
    expect(() => validateReceipt(receipt(undefined, { ui_files: files, ui_digest: inventoryDigest(files) }))).toThrow();
  });

  it('accepts a consistent receipt and rejects mutable data in its UI inventory', () => {
    expect(validateReceipt(receipt())).toEqual(receipt());
    for (const path of ['static-data/manifest.json', 'research-daily.json', 'publication.json']) {
      const files = { ...uiFiles, [path]: sha256('{}') };
      expect(() => validateReceipt(receipt(undefined, { ui_files: files, ui_digest: inventoryDigest(files) }))).toThrow();
    }
  });

  it.each([
    { schema: 2 }, { ui_sha: 'main' }, { run_id: 0 }, { run_attempt: 0 }, { artifact_name: 'github-pages-20-1' },
    { data_manifest_sha256: 'bad-hash' }, { ui_digest: sha256('different inventory') }, { ui_files: {} },
  ])('rejects malformed or inconsistent receipt fields %j', overrides => {
    expect(() => validateReceipt(receipt(undefined, overrides))).toThrow();
  });

  it.each(['index.html', 'sw.js'])('rejects a receipt missing required %s even with a recomputed inventory digest', path => {
    const files = { ...uiFiles };
    delete files[path];
    expect(() => validateReceipt(receipt(undefined, { ui_files: files, ui_digest: inventoryDigest(files) }))).toThrow();
  });
});

describe('exact UI approval and deployment provenance', () => {
  it('verifies the stored gate attempts directly without substituting the latest run', () => {
    const api = apiFor();
    expect(() => verifyApproval(receipt(), repository, api)).not.toThrow();
    expect(api.mock.calls.map(([endpoint]) => endpoint)).toEqual(gateRefs.map(ref =>
      `repos/${repository}/actions/runs/${ref.id}/attempts/${ref.attempt}`));
  });

  it.each([
    { run_attempt: 3 }, { id: 999 }, { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' },
    { head_sha: 'c'.repeat(40) }, { head_branch: 'feature' }, { path: workflowPath('other.yml') },
    { head_repository: { full_name: 'fork/screener' } }, { repository: { full_name: 'other/screener' } },
  ])('rejects a gate response not proving the exact approved revision and attempt %j', overrides => {
    const api = apiFor({ gates: { 101: { ...gateRun(gateRefs[0]), ...overrides } } });
    expect(() => verifyApproval(receipt(), repository, api)).toThrow();
  });

  it('does not let duplicate CI references stand in for Design Acceptance', () => {
    const value = receipt();
    value.approval.runs = [gateRefs[0], gateRefs[0]];
    expect(() => verifyApproval(value, repository, apiFor())).toThrow();
  });

  it('limits bootstrap approval to the pinned revision and exact complete UI inventory', () => {
    const value = receipt(undefined, { ui_sha: bootstrap.ui_sha, ui_files: bootstrap.ui_files,
      ui_digest: inventoryDigest(bootstrap.ui_files), approval: { type: 'bootstrap', sha: bootstrap.ui_sha } });
    expect(() => verifyApproval(value, repository, apiFor())).not.toThrow();
    expect(() => verifyApproval({ ...value, ui_sha: uiSha }, repository, apiFor())).toThrow();
    expect(() => verifyApproval({ ...value, ui_digest: inventoryDigest(uiFiles) }, repository, apiFor())).toThrow();
  });

  it('retains a real deployment from an earlier attempt when the later rerun fails', () => {
    const api = apiFor({ runs: [run({ run_attempt: 3, conclusion: 'failure' })], jobs: { 20: [deployed(2),
      deployed(3, '2026-10-03T02:00:00Z', { conclusion: 'failure' })] } });
    expect(latestDeployment(repository, api)).toMatchObject({ runId: 20, attempt: 2, headSha: uiSha });
    expect(api.mock.calls.some(([endpoint]) => endpoint.includes('/jobs?filter=all&'))).toBe(true);
  });

  it('preserves Static Site run 37078930007 after cancellation during successful deployment finalization', () => {
    const publication = run({ id: 37078930007, run_attempt: 1, path: workflowPath('static-site.yml'),
      conclusion: 'cancelled', updated_at: '2026-10-03T02:18:58Z' });
    const deployJob = { id: 111106132542, conclusion: 'success',
      ...deployed(1, '2026-10-03T02:18:55Z', { name: 'Run actions/deploy-pages@v4' }) };
    const api = apiFor({ runs: [], staticRuns: [publication], jobs: { 37078930007: [deployJob] } });
    expect(latestDeployment(repository, api)).toMatchObject({ runId: 37078930007, attempt: 1,
      completed: Date.parse('2026-10-03T02:18:55Z'), headSha: uiSha });
  });

  it('selects actual deployment completion time rather than run ID or update time', () => {
    const api = apiFor({ runs: [run({ id: 40 }), run({ id: 20, conclusion: 'failure' })], jobs: {
      40: [deployed(1, '2026-10-03T01:45:00Z')], 20: [deployed(2, '2026-10-03T01:59:00Z')],
    } });
    expect(latestDeployment(repository, api)).toMatchObject({ runId: 20, attempt: 2 });
  });

  it.each([{ head_branch: 'feature' }, { head_repository: { full_name: 'fork/screener' } },
    { repository: { full_name: 'other/screener' } }, { path: workflowPath('unrelated.yml') }])(
    'ignores untrusted deployment candidates %j', overrides => {
      expect(() => latestDeployment(repository, apiFor({ runs: [run(overrides)] }))).toThrow();
    },
  );

  it.each([deployed(0), deployed(2, 'invalid')])('fails closed on incomplete deployment provenance %j', job => {
    expect(() => latestDeployment(repository, apiFor({ jobs: { 20: [job] } }))).toThrow();
  });
});

describe('live Pages identity and retention-safe verification', () => {
  it('verifies a published receipt and UI bytes without requiring any retained artifact', async () => {
    const api = apiFor(), fetcher = fetchFor(liveFiles());
    const value = await livePublication({ repository, api, fetcher });
    expect(value).toMatchObject({ uiSha, uiFiles, uiDigest: inventoryDigest(uiFiles), latest: { runId: 20, attempt: 2 } });
    expect(api.mock.calls.every(([endpoint]) => !endpoint.includes('/artifacts'))).toBe(true);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url.origin).toBe(new URL(bootstrap.site_url).origin);
      expect(url.searchParams.has('publication_check')).toBe(true);
      expect(options).toMatchObject({ cache: 'no-store', redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
    }
  });

  it.each([
    { run_id: 19, artifact_name: 'github-pages-19-2' },
    { run_attempt: 1, artifact_name: 'github-pages-20-1' },
  ])('rejects a self-consistent but stale CDN receipt %j', overrides => {
    const files = liveFiles(undefined, receipt(undefined, overrides));
    return expect(livePublication({ repository, api: apiFor({ jobs: { 19: [deployed(2, '2026-10-03T01:57:00Z')], 20: [deployed(1, '2026-10-03T01:58:00Z'), deployed()] } }), fetcher: fetchFor(files) })).rejects.toThrow(/converged/);
  });

  it('rejects a live manifest that does not match its receipt', () => {
    const fetcher = fetchFor(liveFiles(), { 'static-data/manifest.json': JSON.stringify(manifest('2026-10-02')) });
    return expect(livePublication({ repository, api: apiFor(), fetcher })).rejects.toThrow(/data disagree/);
  });

  it('rejects legacy a9 asset bytes that differ from the approved archive', () => {
    const firstUiPath = Object.keys(bootstrap.ui_files)[0];
    const fetcher = fetchFor({ 'static-data/manifest.json': JSON.stringify(manifest()), [firstUiPath]: 'unapproved bytes' });
    const api = apiFor({ runs: [run({ head_sha: bootstrap.ui_sha })] });
    return expect(livePublication({ repository, api, fetcher })).rejects.toThrow(/Live UI differs from its approved bytes/);
  });

  it('never grants bootstrap approval to receiptless arbitrary main UI', () => {
    const fetcher = fetchFor({ 'static-data/manifest.json': JSON.stringify(manifest()) });
    return expect(livePublication({ repository, api: apiFor(), fetcher })).rejects.toThrow(/Legacy Pages is no longer the approved/);
  });

  it('detects receipt replacement while downloading approved UI files', () => {
    let reads = 0;
    const fetcher = fetchFor(liveFiles(), { 'publication.json': () => JSON.stringify(receipt(undefined,
      ++reads === 1 ? {} : { run_id: 21, artifact_name: 'github-pages-21-2' })) });
    return expect(livePublication({ repository, api: apiFor(), fetcher })).rejects.toThrow(/changed while reading/);
  });

  it('detects a new deployment even if Pages keeps serving the previous internally consistent receipt', () => {
    let observations = 0;
    const original = apiFor(), updated = apiFor({ runs: [run({ id: 21 })], jobs: { 21: [deployed()] } });
    const api = endpoint => {
      if (endpoint.includes('/actions/workflows/research-ui-release.yml/runs?')) observations += 1;
      return (observations > 1 ? updated : original)(endpoint);
    };
    return expect(livePublication({ repository, api, fetcher: fetchFor(liveFiles()) })).rejects.toThrow(/new deployment completed/);
  });
});


describe('bounded deployment reconciliation', () => {
  it('verifies the exact anchor attempt despite later overall cancellation', () => {
    const api = apiFor({ runs: [run({ conclusion: 'cancelled' })] });
    expect(deploymentAnchor(receipt(), repository, api)).toMatchObject({ runId: 20, attempt: 2, completed: Date.parse('2026-10-03T01:59:00Z') });
    expect(api).toHaveBeenCalledWith(`repos/${repository}/actions/runs/20/attempts/2/jobs?per_page=100`, true);
  });
  it('skips historical job scans but catches late old-run reruns', () => {
    const old = Array.from({ length: 1200 }, (_, index) => run({ id: index + 100, updated_at: '2026-10-02T00:00:00Z' }));
    const api = apiFor({ runs: [...old, run(), run({ id: 5, run_attempt: 3, updated_at: '2026-10-03T02:10:00Z' })], jobs: {
      20: [deployed()], 5: [deployed(3, '2026-10-03T02:09:00Z')],
    } });
    const anchor = { runId: 20, attempt: 2, completed: Date.parse('2026-10-03T01:59:00Z'), headSha: uiSha };
    expect(latestDeployment(repository, api, anchor)).toMatchObject({ runId: 5, attempt: 3 });
    expect(api.mock.calls.filter(([endpoint]) => endpoint.includes('/jobs?filter=all'))).toHaveLength(2);
  });
});


describe('actual #59 rerun artifact association', () => {
  const original = { id: 11260473996, name: 'github-pages', expired: false, created_at: '2026-10-03T01:23:14Z',
    workflow_run: { id: 37085210014, head_sha: bootstrap.ui_sha, head_branch: 'main' } };
  const unpublished = { ...original, id: 11263530485, created_at: '2026-10-03T03:07:42Z' };
  const first = { runId: 37085210014, attempt: 1, headSha: bootstrap.ui_sha,
    jobStarted: Date.parse('2026-10-03T01:12:45Z'), started: Date.parse('2026-10-03T01:23:14Z') };
  it('cannot substitute the later failed attempt2 upload for attempt1 publication', () => {
    expect(legacyArtifactForDeployment([unpublished, original], first)?.id).toBe(11260473996);
    expect(legacyArtifactForDeployment([unpublished], first)).toBeNull();
  });
  it('can bind a successful later attempt only to the artifact created in that exact job interval', () => {
    const second = { ...first, attempt: 2, jobStarted: Date.parse('2026-10-03T02:57:00Z'), started: Date.parse('2026-10-03T03:08:00Z') };
    expect(legacyArtifactForDeployment([original, unpublished], second)?.id).toBe(11263530485);
    expect(() => legacyArtifactForDeployment([unpublished, { ...unpublished, id: 42 }], second)).toThrow(/Ambiguous/);
  });
  it('rejects wrong run/head evidence and expired artifacts', () => {
    for (const changed of [{ ...original, expired: true }, { ...original, workflow_run: { ...original.workflow_run, id: 9 } },
      { ...original, workflow_run: { ...original.workflow_run, head_sha: uiSha } }]) expect(legacyArtifactForDeployment([changed], first)).toBeNull();
  });
  it('keeps the actual old Static Site deployment authoritative after #59 attempt2 deployment failed', () => {
    const research = run({ id: 37085210014, run_attempt: 2, head_sha: bootstrap.ui_sha, conclusion: 'failure', updated_at: '2026-10-03T03:08:00Z' });
    const oldUi = run({ id: 37078930007, run_attempt: 1, head_sha: '0'.repeat(40), path: workflowPath('static-site.yml'), conclusion: 'cancelled', updated_at: '2026-10-03T02:18:58Z' });
    const api = apiFor({ runs: [research], staticRuns: [oldUi], jobs: {
      37085210014: [deployed(1, '2026-10-03T01:23:42Z'), deployed(2, '2026-10-03T03:08:00Z', { conclusion: 'failure' })],
      37078930007: [deployed(1, '2026-10-03T02:18:55Z')],
    } });
    expect(latestDeployment(repository, api)).toMatchObject({ runId: 37078930007, attempt: 1, headSha: oldUi.head_sha });
  });
});


describe('complete scoped deployment history transport', () => {
  // These complete rows are synthetic transport fixtures. They create no
  // genuine source/caller proof and authorize no publication or cache opener.
  const scope = { repository: 'kusennjp1-ai/screener', repository_id: 1203919607,
    run_id: 990001, run_attempt: 1, controller_sha: uiSha };
  const fullRun = (id, file, changes = {}) => ({
    id, run_attempt: 2, head_sha: uiSha, head_branch: 'main', event: 'workflow_run',
    workflow_id: file === 'static-site.yml' ? 294257497 : 364666954,
    path: workflowPath(file), name: 'Synthetic ' + file, status: 'completed', conclusion: 'failure',
    repository: { id: 1203919607, full_name: scope.repository },
    head_repository: { id: 1203919607, full_name: scope.repository },
    created_at: '2026-10-09T01:00:00Z', run_started_at: '2026-10-09T01:00:00Z',
    updated_at: '2026-10-09T01:10:00Z', ...changes,
  });
  const fullJob = (candidate, id, attempt, minute, conclusion = 'success') => ({
    id, run_id: candidate.id, run_attempt: attempt, head_sha: candidate.head_sha,
    head_branch: candidate.head_branch, workflow_name: candidate.name, name: 'Synthetic deploy job',
    run_url: 'https://api.github.com/repos/' + scope.repository + '/actions/runs/' + candidate.id,
    url: 'https://api.github.com/repos/' + scope.repository + '/actions/jobs/' + id,
    status: 'completed', conclusion, created_at: '2026-10-09T01:00:01Z',
    started_at: '2026-10-09T01:' + minute + ':00Z', completed_at: '2026-10-09T01:' + minute + ':40Z',
    steps: [{ number: 1, name: 'Deploy to GitHub Pages', status: 'completed', conclusion,
      started_at: '2026-10-09T01:' + minute + ':10Z', completed_at: '2026-10-09T01:' + minute + ':30Z' }],
  });
  const publisher = fullRun(710001, 'research-ui-release.yml');
  const staticRun = fullRun(710002, 'static-site.yml', { run_attempt: 1, conclusion: 'cancelled' });
  const fixtures = {
    [publisher.id]: [fullJob(publisher, 710010, 1, '01'), fullJob(publisher, 710011, 2, '03', 'failure')],
    [staticRun.id]: [fullJob(staticRun, 710020, 1, '05')],
  };
  const discovery = ({ allowOrdinaryJobs = false, includeStatic = true } = {}) => vi.fn(endpoint => {
    if (endpoint.includes('/actions/workflows/research-ui-release.yml/runs?')) return [{ workflow_runs: [clone(publisher)] }];
    if (endpoint.includes('/actions/workflows/static-site.yml/runs?')) return [{ workflow_runs: includeStatic ? [clone(staticRun)] : [] }];
    const id = endpoint.match(/\/actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100$/)?.[1];
    if (allowOrdinaryJobs && id && fixtures[id]) return [{ jobs: clone(fixtures[id]) }];
    throw Error('Unexpected ordinary history fallback: ' + endpoint);
  });
  function nativeWorker(failedProof = false) {
    const workerUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)),
      '../../.github/scripts/conditional-deployment-jobs-worker.mjs')).href;
    const calls = [];
    const execute = (_command, _args, options) => {
      const config = JSON.parse(options.input); calls.push(config);
      const source = [
        "import {readFileSync} from 'node:fs';import {readConditionalDeploymentJobs} from " + JSON.stringify(workerUrl) + ";",
        "const config=JSON.parse(readFileSync(0,'utf8')),fixtures=" + JSON.stringify(fixtures) + ";let clock=0,count=0;",
        "const result=await readConditionalDeploymentJobs(config,{token:'synthetic-state-native-token',monotonic:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async(url,init)=>{count++;const id=Number(new URL(url).pathname.match(/\\/runs\\/(\\d+)\\/jobs$/)[1]);const conditional=Boolean(init.headers['if-none-match']);const etag=conditional?'\"synthetic-'+id+'\"':'W/\"synthetic-'+id+'\"';const response=new Response(conditional?null:JSON.stringify({total_count:fixtures[id].length,jobs:fixtures[id]}),{status:conditional?304:200,headers:{etag,'content-type':'application/json','x-ratelimit-limit':'15000','x-ratelimit-remaining':String(15000-count),'x-ratelimit-used':String(count),'x-ratelimit-reset':'1791514800','x-ratelimit-resource':'core'}});Object.defineProperty(response,'url',{value:url});return response;}});",
        failedProof ? "result.jobs.pop();" : "",
        "process.stdout.write(JSON.stringify(result));",
      ].join('\n');
      return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
        input: options.input, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024,
      });
    };
    return { calls, execute };
  }
  const ownedReader = (worker, reports = []) => createConditionalDeploymentJobsReader({ scope,
    token: () => 'synthetic-state-native-token', run: worker.execute, report: value => reports.push(value) });

  it('ordinary fallback retains both cohorts and reads every all-attempt route after full discovery', () => {
    const api = discovery({ allowOrdinaryJobs: true });
    expect(latestDeployment(scope.repository, api)).toMatchObject({ runId: staticRun.id, attempt: 1 });
    expect(api.mock.calls.slice(0, 2).map(([endpoint]) => endpoint)).toEqual([
      'repos/' + scope.repository + '/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100',
      'repos/' + scope.repository + '/actions/workflows/static-site.yml/runs?branch=main&per_page=100',
    ]);
    expect(api.mock.calls.filter(([endpoint]) => endpoint.includes('/jobs?filter=all&'))).toHaveLength(2);
  });

  it('passes one complete combined cohort per fresh round through the actual native worker and preserves old attempts', () => {
    const worker = nativeWorker(), reports = [], reader = ownedReader(worker, reports), api = discovery();
    withConditionalDeploymentJobsReader(reader, () => {
      const first = latestDeployment(scope.repository, api);
      expect(first).toMatchObject({ runId: staticRun.id, attempt: 1 });
      expect(latestDeployment(scope.repository, api, first)).toMatchObject({ runId: staticRun.id, attempt: 1 });
      expect(reader.disposed).toBe(false);
    });
    expect(worker.calls).toHaveLength(2);
    expect(worker.calls[0].runs.map(row => row.id)).toEqual([publisher.id, staticRun.id]);
    // The first anchor bounds the second fresh cohort; it must still include
    // both runs, whose updated_at remains later than deployment completion.
    expect(worker.calls[1].runs.map(row => row.id)).toEqual([publisher.id, staticRun.id]);
    expect(worker.calls[0].cache).toEqual([]);
    expect(worker.calls[1].cache).toHaveLength(2);
    expect(api.mock.calls.some(([endpoint]) => endpoint.includes('/jobs?filter=all&'))).toBe(false);
    expect(reports).toHaveLength(1);
    expect(reports[0].counts).toMatchObject({ conditional_batch_calls: 2, conditional_requests_issued: 4,
      conditional_http_200: 2, conditional_http_304: 2, conditional_pages_revalidated: 2 });
    expect(reader.disposition).toBe('complete');
  });

  it('the native scoped inventory retains an earlier successful deployment after the later attempt fails', () => {
    const worker = nativeWorker(), reader = ownedReader(worker), api = discovery({ includeStatic: false });
    const latest = withConditionalDeploymentJobsReader(reader, () => latestDeployment(scope.repository, api));
    expect(latest).toMatchObject({ runId: publisher.id, attempt: 1, runAttempt: 2,
      completed: Date.parse('2026-10-09T01:01:30Z') });
    expect(worker.calls[0].runs.map(row => row.id)).toEqual([publisher.id]);
    expect(api.mock.calls.some(([endpoint]) => endpoint.includes('/jobs?filter=all&'))).toBe(false);
  });

  it('a failed scoped inventory proof is terminal and never falls back to ordinary jobs', () => {
    const worker = nativeWorker(true), reader = ownedReader(worker), api = discovery({ allowOrdinaryJobs: true });
    expect(() => withConditionalDeploymentJobsReader(reader, () =>
      latestDeployment(scope.repository, api))).toThrow(/incomplete-worker-inventories/);
    expect(worker.calls).toHaveLength(1);
    expect(api.mock.calls.some(([endpoint]) => endpoint.includes('/jobs?filter=all&'))).toBe(false);
    expect(reader.disposition).toBe('failed');
  });

  it('rejects a scoped Map missing any candidate without ordinary fallback', () => {
    const worker = nativeWorker(), reader = ownedReader(worker), api = discovery({ allowOrdinaryJobs: true });
    reader.read = () => new Map([[publisher.id, clone(fixtures[publisher.id])]]);
    expect(() => withConditionalDeploymentJobsReader(reader, () =>
      latestDeployment(scope.repository, api))).toThrow(/Incomplete scoped deployment job inventory/);
    expect(worker.calls).toHaveLength(0);
    expect(api.mock.calls.some(([endpoint]) => endpoint.includes('/jobs?filter=all&'))).toBe(false);
    expect(reader.disposition).toBe('failed');
  });
});
