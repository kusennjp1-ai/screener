import { describe, expect, it } from 'vitest';
import { advancesPublishedData, releaseSource } from '../../.github/scripts/select-release-source.mjs';

const repository = 'owner/screener';
const sha = 'a'.repeat(40);
const artifact = (id, created_at) => ({ expired: false, created_at, workflow_run: { id, head_branch: 'main' } });
const run = (path, overrides = {}) => ({ path: `.github/workflows/${path}`, event: 'schedule', status: 'completed',
  conclusion: 'success', head_branch: 'main', repository: { full_name: repository }, head_repository: { full_name: repository }, ...overrides });
const manifest = (date = '2026-10-01', freshness = {}) => ({ as_of_date: date, markets: { US: { as_of_date: date,
  freshness: { scan_as_of_date: date, scan_published_at: `${date}T22:00:00Z`, prices_generated_at: `${date}T23:00:00Z`, breadth_latest_date: date, groups_latest_date: date, ...freshness } } } });
const makeApi = (exports = [], overrides = {}) => endpoint => {
  if (endpoint.includes('name=static-site-data')) return [{ artifacts: exports }];
  if (endpoint.includes('name=github-pages')) return [{ artifacts: [artifact(5, '2026-10-01')] }];
  if (endpoint.includes('/jobs?')) return [{ jobs: [{ conclusion: 'success', steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success' }] }] }];
  if (endpoint.endsWith('/5')) return run('research-ui-release.yml');
  return run('static-site.yml', overrides);
};
const makeLoad = (published = manifest(), candidate = manifest('2026-10-02'), receipt = null) => source => ({
  ...source, manifest: source.artifact === 'github-pages' ? published : candidate, receipt,
});
const expectSource = (value, runId, artifact, publish = true) => expect(value).toMatchObject({ runId, artifact, publish });

describe('release data handoff', () => {
  it('consumes a newer dated export after gates finish, even though it was never deployed', () => {
    const api = makeApi([artifact(10, '2026-10-01'), artifact(20, '2026-10-02')]);
    expectSource(releaseSource({ repository, automatic: true }, api, makeLoad()), 20, 'static-site-data');
  });
  it('falls back to deployed data when an export is absent, incomplete, failed or untrusted', () => {
    expectSource(releaseSource({ repository, automatic: true }, makeApi(), makeLoad()), 5, 'github-pages');
    for (const overrides of [{ status: 'in_progress' }, { conclusion: 'failure' }, { event: 'pull_request' },
      { head_repository: { full_name: 'fork/screener' } }, { path: '.github/workflows/other.yml' }]) {
      expectSource(releaseSource({ repository, automatic: true }, makeApi([artifact(20, '2026-10-02')], overrides), makeLoad()), 5, 'github-pages');
    }
  });
  it('keeps manual release restoration on verified published data, even for the same UI SHA', () => {
    expectSource(releaseSource({ repository, automatic: false, sha }, makeApi([artifact(20, '2026-10-02')]), makeLoad(undefined, undefined, { source_sha: sha })), 5, 'github-pages');
  });
  it('retains newer published data despite a recently created rerun of an older snapshot', () => {
    const api = makeApi([artifact(20, '2026-10-03')]);
    expectSource(releaseSource({ repository, automatic: true }, api, makeLoad(manifest('2026-10-02'), manifest('2026-10-01'))), 5, 'github-pages');
  });
  it('walks past a stale rerun to a fresh export produced while gates were blocked', () => {
    const api = makeApi([artifact(20, '2026-10-04'), artifact(10, '2026-10-03')]);
    const load = source => ({ ...source, manifest: manifest(source.runId === 20 ? '2026-09-30' : source.runId === 10 ? '2026-10-02' : '2026-10-01') });
    expectSource(releaseSource({ repository, automatic: true }, api, load), 10, 'static-site-data');
  });
  it('skips duplicate gate events only after this source SHA is actually published', () => {
    expectSource(releaseSource({ repository, automatic: true, sha }, makeApi(), makeLoad(undefined, undefined, { source_sha: sha })), 5, 'github-pages', false);
    expectSource(releaseSource({ repository, automatic: true, sha }, makeApi(), makeLoad()), 5, 'github-pages', true);
    expectSource(releaseSource({ repository, automatic: true, sha: 'b'.repeat(40) }, makeApi(), makeLoad(undefined, undefined, { source_sha: sha })), 5, 'github-pages', true);
  });
  it('does not drop a new-data Static Site completion for an already deployed UI SHA', () => {
    expectSource(releaseSource({ repository, automatic: true, sha }, makeApi([artifact(20, '2026-10-02')]), makeLoad(undefined, undefined, { source_sha: sha })), 20, 'static-site-data', true);
  });
});

describe('dated data does not regress', () => {
  it('requires actual data/provenance to advance, not a later artifact or bundle generation time', () => {
    const published = manifest();
    expect(advancesPublishedData({ ...published, generated_at: '2026-10-30T00:00:00Z' }, published)).toBe(false);
    expect(advancesPublishedData(manifest('2026-10-02'), published)).toBe(true);
    expect(advancesPublishedData(manifest('2026-09-30'), published)).toBe(false);
  });
  it('allows prices-only refreshes for the same scan day', () => {
    expect(advancesPublishedData(manifest('2026-10-01', { prices_generated_at: '2026-10-02T23:00:00Z' }), manifest())).toBe(true);
  });
  it.each(['scan_as_of_date', 'scan_published_at', 'prices_generated_at', 'breadth_latest_date', 'groups_latest_date'])('blocks missing, invalid or regressing %s even with a newer scan date', field => {
    for (const value of [null, 'invalid', '2026-09-30']) {
      expect(advancesPublishedData(manifest('2026-10-02', { [field]: value }), manifest())).toBe(false);
    }
  });
  it('does not drop or regress another published market', () => {
    const published = manifest();
    published.markets.JP = { as_of_date: '2026-10-01' };
    expect(advancesPublishedData(manifest('2026-10-02'), published)).toBe(false);
    const candidate = manifest('2026-10-02');
    candidate.markets.JP = { as_of_date: '2026-09-30' };
    expect(advancesPublishedData(candidate, published)).toBe(false);
  });
  it('retains published data when required dates are absent or malformed', () => {
    expect(advancesPublishedData({}, manifest())).toBe(false);
    expect(advancesPublishedData(manifest('invalid'), manifest())).toBe(false);
    expect(advancesPublishedData(manifest(), {})).toBe(false);
  });
});
