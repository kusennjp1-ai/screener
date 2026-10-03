import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advancesPublishedData, checkedExport, chooseExport, verifyArchive } from '../../.github/scripts/select-release-source.mjs';
import { sha256 } from '../../.github/scripts/publication-state.mjs';

const repository = 'owner/screener';
const sourceSha = 'a'.repeat(40);
const market = (date = '2026-10-01', freshness = {}) => ({ as_of_date: date, freshness: {
  scan_as_of_date: date, scan_published_at: `${date}T22:00:00Z`, prices_generated_at: `${date}T23:00:00Z`,
  breadth_latest_date: date, groups_latest_date: date, ...freshness,
} });
const manifest = (date = '2026-10-01', freshness = {}) => ({ as_of_date: date, default_market: 'US',
  supported_markets: ['US'], markets: { US: market(date, freshness) } });
const fixture = ({ id = 20, attempt = 2, date = '2026-10-02', data = manifest(date), created = '2026-10-03T01:30:00Z' } = {}) => {
  const workflowRun = { id, head_branch: 'main', head_sha: sourceSha };
  const artifact = { id: id * 100 + attempt * 10 + 1, name: `static-site-data-${id}-${attempt}`,
    expired: false, created_at: created, workflow_run: { ...workflowRun } };
  const companion = { ...artifact, id: artifact.id + 1, name: `static-site-data-manifest-${id}-${attempt}`,
    workflow_run: { ...workflowRun } };
  const run = { ...workflowRun, run_attempt: attempt, status: 'completed', conclusion: 'success', event: 'schedule',
    path: '.github/workflows/static-site.yml', repository: { full_name: repository }, head_repository: { full_name: repository } };
  const job = { name: 'combine-and-build', run_attempt: attempt, conclusion: 'success',
    started_at: '2026-10-03T01:00:00Z', completed_at: '2026-10-03T02:00:00Z',
    steps: [{ name: 'Build static frontend', conclusion: 'success' }] };
  // Preserve whitespace to verify that metadata binds the original bytes.
  const raw = JSON.stringify(data, null, 2) + '\n';
  const metadata = { run_id: id, run_attempt: attempt, source_sha: sourceSha, artifact_name: artifact.name,
    manifest_json: raw, manifest_sha256: sha256(raw), price_observations: {}, price_observations_sha256: sha256('{}') };
  return { artifact, companion, run, job, metadata, data };
};
const pagesFor = (...items) => items.map(item => ({ artifacts: [item.artifact, item.companion] }));
const apiFor = (...items) => vi.fn(endpoint => {
  for (const item of items) {
    const prefix = `repos/${repository}/actions/runs/${item.artifact.workflow_run.id}/attempts/${item.artifact.name.split('-').at(-1)}`;
    if (endpoint === prefix) return item.run;
    if (endpoint === `${prefix}/jobs?per_page=100`) return [{ jobs: [item.job] }];
  }
  throw Error(`Unexpected non-attempt API lookup: ${endpoint}`);
});
const loadFor = (...items) => vi.fn(artifact => {
  const item = items.find(item => item.companion.id === artifact.id);
  if (!item) throw Error(`Unexpected artifact ID ${artifact.id}`);
  return item.metadata;
});
const check = item => checkedExport(item.artifact, pagesFor(item), repository, apiFor(item), loadFor(item));

describe('checked export attempt and immutable artifact binding', () => {
  it('binds a successful exact attempt to its unique companion artifact and raw manifest bytes', () => {
    const item = fixture(), api = apiFor(item), load = loadFor(item);
    expect(checkedExport(item.artifact, pagesFor(item), repository, api, load)).toEqual({
      artifact: item.artifact, runId: 20, attempt: 2, manifest: item.data, manifestHash: sha256(item.metadata.manifest_json), priceObservations: {}, priceObservationsDigest: sha256('{}'),
    });
    expect(load).toHaveBeenCalledWith(item.companion, repository);
    expect(api.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      `repos/${repository}/actions/runs/20/attempts/2`,
      `repos/${repository}/actions/runs/20/attempts/2/jobs?per_page=100`,
    ]);
  });

  it.each(['static-site-data', 'static-site-data-21-2', 'static-site-data-20-0', 'static-site-data-20-9007199254740992',
    'static-site-data-manifest-20-2', 'github-pages-20-2'])('ignores an unbound export name %s', name => {
    const item = fixture();
    item.artifact.name = name;
    const api = apiFor(item);
    expect(checkedExport(item.artifact, pagesFor(item), repository, api, loadFor(item))).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it.each([{ id: 21 }, { run_attempt: 1 }, { status: 'in_progress' }, { event: 'pull_request' },
    { head_branch: 'feature' }, { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'other/screener' } }, { head_repository: { full_name: 'fork/screener' } }])(
    'rejects the wrong run, attempt, or trust context %j', overrides => {
      const item = fixture();
      Object.assign(item.run, overrides);
      expect(check(item)).toBeNull();
    },
  );

  it.each([{ conclusion: 'failure' }, { run_attempt: 1 }, { name: 'unrelated-job' },
    { steps: [] }, { steps: [{ name: 'Build static frontend', conclusion: 'failure' }] }])(
    'rejects a missing or failed exact combine validation %j', overrides => {
      const item = fixture();
      Object.assign(item.job, overrides);
      expect(check(item)).toBeNull();
    },
  );

  it('keeps a checked combined bundle even if an unrelated market job failed', () => {
    const item = fixture();
    item.run.conclusion = 'failure';
    expect(check(item)).toMatchObject({ runId: 20, attempt: 2 });
  });

  it('does not let a newer failed rerun erase successful exact prior-attempt evidence', () => {
    const item = fixture({ attempt: 1 }), exactApi = apiFor(item);
    const api = vi.fn(endpoint => endpoint === `repos/${repository}/actions/runs/20`
      ? { ...item.run, run_attempt: 2, conclusion: 'failure' } : exactApi(endpoint));
    expect(checkedExport(item.artifact, pagesFor(item), repository, api, loadFor(item))).toMatchObject({ attempt: 1 });
    expect(api.mock.calls.every(([endpoint]) => endpoint.includes('/attempts/1'))).toBe(true);
  });

  it.each(['artifact', 'companion'])('rejects a %s from another head SHA or outside the successful combine interval', target => {
    for (const override of [
      { workflow_run: { id: 20, head_branch: 'main', head_sha: 'b'.repeat(40) } },
      { created_at: '2026-10-03T00:59:59Z' }, { created_at: '2026-10-03T02:00:01Z' },
    ]) {
      const item = fixture();
      Object.assign(item[target], override);
      expect(() => check(item)).toThrow(/validated attempt/);
    }
  });

  it.each(['started_at', 'completed_at'])('rejects absent combine %s instead of inventing an artifact window', field => {
    const item = fixture();
    delete item.job[field];
    expect(() => check(item)).toThrow(/validated attempt/);
  });

  it('refuses an old, missing, expired, or duplicate companion instead of borrowing its manifest', () => {
    for (const mutation of [item => { item.companion.name = 'static-site-data-manifest-20-1'; },
      item => { item.companion.expired = true; }, item => { item.companion.workflow_run.id = 21; }]) {
      const item = fixture();
      mutation(item);
      expect(() => check(item)).toThrow(/No unique retained artifact/);
    }
    const item = fixture();
    const pages = [...pagesFor(item), { artifacts: [{ ...item.companion, id: 9999 }] }];
    expect(() => checkedExport(item.artifact, pages, repository, apiFor(item), loadFor(item))).toThrow(/No unique retained artifact/);
  });

  it.each([{ run_id: 21 }, { run_attempt: 1 }, { source_sha: 'b'.repeat(40) }, { artifact_name: 'static-site-data-20-1' },
    { manifest_json: undefined }, { manifest_sha256: sha256('different bytes') }])('rejects mismatched companion metadata %j', overrides => {
    const item = fixture();
    Object.assign(item.metadata, overrides);
    expect(() => check(item)).toThrow(/provenance disagree/);
  });

  it('rejects changed raw manifest content even when the parsed observation dates remain equal', () => {
    const item = fixture();
    item.metadata.manifest_json = JSON.stringify({ ...item.data, research_generation: 'changed' });
    expect(() => check(item)).toThrow(/provenance disagree/);
  });
});

describe('non-regressing exports remain usable independently of Pages artifacts', () => {
  it('selects a fresh checked export when zero Pages artifacts remain', () => {
    const item = fixture(), pages = pagesFor(item);
    expect(pages.flatMap(page => page.artifacts).some(item => item.name.startsWith('github-pages'))).toBe(false);
    expect(chooseExport({ knownPriceDates: {}, manifest: manifest() }, pages, repository, apiFor(item), loadFor(item))).toMatchObject({
      runId: 20, attempt: 2, artifact: { id: item.artifact.id },
    });
  });

  it('walks past a recently rebuilt stale export to a truly advancing export', () => {
    const stale = fixture({ id: 30, date: '2026-09-30', created: '2026-10-03T01:45:00Z' });
    const fresh = fixture({ id: 20, date: '2026-10-02', created: '2026-10-03T01:30:00Z' });
    expect(chooseExport({ knownPriceDates: {}, manifest: manifest() }, pagesFor(stale, fresh), repository, apiFor(stale, fresh), loadFor(stale, fresh)))
      .toMatchObject({ runId: 20, artifact: { id: fresh.artifact.id } });
  });

  it('does not publish equal-day changed payloads or newer generation timestamps', () => {
    const data = manifest('2026-10-01', { prices_generated_at: '2026-10-03T23:00:00Z', scan_published_at: '2026-10-03T22:00:00Z' });
    data.generated_at = '2026-10-03T23:30:00Z';
    data.research_generation = 'different-payload';
    const item = fixture({ data });
    expect(advancesPublishedData(data, manifest())).toBe(false);
    expect(chooseExport({ knownPriceDates: {}, manifest: manifest() }, pagesFor(item), repository, apiFor(item), loadFor(item))).toBeNull();
  });

  it('rejects a partial-market regression even when the default market advances', () => {
    const published = manifest();
    published.supported_markets.push('JP');
    published.markets.JP = market();
    for (const data of [manifest('2026-10-02'), { ...manifest('2026-10-02'), supported_markets: ['US', 'JP'],
      markets: { US: market('2026-10-02'), JP: market('2026-09-30') } }]) {
      const item = fixture({ data });
      expect(chooseExport({ knownPriceDates: {}, manifest: published }, pagesFor(item), repository, apiFor(item), loadFor(item))).toBeNull();
    }
  });

  it('skips a failed combined candidate without hiding a valid older export', () => {
    const failed = fixture({ id: 30, created: '2026-10-03T01:45:00Z' }), good = fixture();
    failed.job.conclusion = 'failure';
    expect(chooseExport({ knownPriceDates: {}, manifest: manifest() }, pagesFor(failed, good), repository, apiFor(failed, good), loadFor(failed, good)))
      .toMatchObject({ runId: 20 });
    expect(chooseExport({ knownPriceDates: {}, manifest: manifest() }, [], repository, apiFor(), loadFor())).toBeNull();
  });
});

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const makeArchive = entries => {
  const directory = mkdtempSync(join(tmpdir(), 'release-archive-test-'));
  temporaryDirectories.push(directory);
  const archive = join(directory, 'artifact.tar');
  execFileSync('python3', ['-c', `import io,json,sys,tarfile
with tarfile.open(sys.argv[1], 'w') as archive:
 for entry in json.loads(sys.argv[2]):
  member=tarfile.TarInfo(entry['name'])
  kind=entry.get('kind', 'file')
  if kind=='file':
   body=entry.get('body', '').encode(); member.size=len(body); archive.addfile(member, io.BytesIO(body))
  else:
   member.type={'symlink':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE,'fifo':tarfile.FIFOTYPE}[kind]
   member.linkname=entry.get('target', 'index.html'); archive.addfile(member)
`, archive, JSON.stringify(entries)], { stdio: 'pipe' });
  return archive;
};

describe('archive verification before extraction', () => {
  const raw = JSON.stringify(manifest('2026-10-02'), null, 2) + '\n';
  const member = { name: './static-data/manifest.json', body: raw };
  const source = { manifestHash: sha256(raw) };

  it('accepts a valid archive with the exact checked manifest bytes', () => {
    const archive = makeArchive([member, { name: './static-data/markets/us/data.json', body: '{}' }]);
    expect(() => verifyArchive(source, archive)).not.toThrow();
  });

  it.each(['./../escape.json', '/absolute.json', './static-data/../../escape.json', './static-data\\escape.json'])(
    'rejects unsafe tar path %s before extraction', name => {
      expect(() => verifyArchive(source, makeArchive([member, { name, body: '{}' }]))).toThrow();
    },
  );

  it.each(['symlink', 'hardlink', 'fifo'])('rejects %s archive entries', kind => {
    expect(() => verifyArchive(source, makeArchive([member, { name: './static-data/link', kind, target: '../index.html' }]))).toThrow();
  });

  it('rejects duplicate normalized manifest paths that could replace verified content during extraction', () => {
    const duplicate = { name: 'static-data/manifest.json', body: 'unverified replacement' };
    expect(() => verifyArchive(source, makeArchive([member, duplicate]))).toThrow();
  });

  it('rejects interior-dot aliases that could overwrite the manifest after hash verification', () => {
    const alias = { name: './static-data/./manifest.json', body: 'unverified replacement' };
    expect(() => verifyArchive(source, makeArchive([member, alias]))).toThrow();
  });

  it.each(['{"as_of_date":', JSON.stringify(manifest('2026-09-30')), JSON.stringify(manifest('2026-10-02'))])(
    'rejects truncated, changed, or reserialized manifest bytes %s', body => {
      expect(() => verifyArchive(source, makeArchive([{ ...member, body }]))).toThrow(/Archive and dated manifest disagree/);
    },
  );

  it('rejects a missing manifest or a truncated archive', () => {
    expect(() => verifyArchive(source, makeArchive([{ name: './static-data/data.json', body: '{}' }]))).toThrow();
    const archive = makeArchive([member]);
    truncateSync(archive, 64);
    expect(() => verifyArchive(source, archive)).toThrow();
  });
});
