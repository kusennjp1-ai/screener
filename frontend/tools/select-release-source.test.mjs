import { describe, expect, it } from 'vitest';
import { releaseSource } from '../../.github/scripts/select-release-source.mjs';

const repository = 'owner/screener';
const artifact = (id, created_at) => ({ expired: false, created_at, workflow_run: { id, head_branch: 'main' } });
const run = (path, overrides = {}) => ({ path: `.github/workflows/${path}`, event: 'schedule', status: 'completed',
  conclusion: 'success', head_branch: 'main', repository: { full_name: repository }, head_repository: { full_name: repository }, ...overrides });
const makeApi = (exports = [], overrides = {}) => endpoint => {
  if (endpoint.includes('name=static-site-data')) return [{ artifacts: exports }];
  if (endpoint.includes('name=github-pages')) return [{ artifacts: [artifact(5, '2026-10-01')] }];
  if (endpoint.includes('/jobs?')) return [{ jobs: [{ conclusion: 'success', steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success' }] }] }];
  if (endpoint.endsWith('/5')) return run('research-ui-release.yml');
  return run('static-site.yml', overrides);
};

describe('release data handoff', () => {
  it('consumes the newest completed export after gates finish, even though it was never deployed', () => {
    const api = makeApi([artifact(10, '2026-10-01'), artifact(20, '2026-10-02')]);
    expect(releaseSource({ repository, automatic: true }, api)).toEqual({ runId: 20, artifact: 'static-site-data' });
  });
  it('falls back to deployed data when an export is absent, incomplete, failed or untrusted', () => {
    expect(releaseSource({ repository, automatic: true }, makeApi())).toEqual({ runId: 5, artifact: 'github-pages' });
    for (const overrides of [{ status: 'in_progress' }, { conclusion: 'failure' }, { event: 'pull_request' },
      { head_repository: { full_name: 'fork/screener' } }, { path: '.github/workflows/other.yml' }]) {
      expect(releaseSource({ repository, automatic: true }, makeApi([artifact(20, '2026-10-02')], overrides)))
        .toEqual({ runId: 5, artifact: 'github-pages' });
    }
  });
  it('keeps manual release data restoration on verified published data', () => {
    expect(releaseSource({ repository, automatic: false }, makeApi([artifact(20, '2026-10-02')]))).toEqual({ runId: 5, artifact: 'github-pages' });
  });
});
