import { describe, expect, it } from 'vitest';
import { eligibleArtifacts, publishedRuns, uniqueArtifact } from '../../.github/scripts/select-published-runs.mjs';

const artifact = (id = 501, runId = 20, attempt = 1, overrides = {}) => ({
  id, name: `github-pages-${runId}-${attempt}`, expired: false, created_at: '2026-10-03T01:00:00Z',
  workflow_run: { id: runId, head_branch: 'main', head_sha: 'a'.repeat(40) }, ...overrides,
});

describe('retained artifact candidates', () => {
  it('orders all pages by creation time without treating IDs or page order as freshness evidence', () => {
    const earlier = artifact(900, 90, 1, { created_at: '2026-10-01T01:00:00Z' });
    const later = artifact(100, 10, 1, { created_at: '2026-10-03T01:00:00Z' });
    expect(eligibleArtifacts([{ artifacts: [earlier] }, { artifacts: [later] }])).toEqual([later, earlier]);
  });

  it.each([
    { expired: true }, { expired: undefined }, { created_at: 'invalid' }, { id: 0 }, { id: '501' },
    { id: Number.MAX_SAFE_INTEGER + 1 }, { workflow_run: { id: 20, head_branch: 'feature' } },
    { workflow_run: { id: 0, head_branch: 'main' } }, { workflow_run: { id: '20', head_branch: 'main' } },
    { workflow_run: null },
  ])('ignores an expired, malformed, or other-branch candidate %j', overrides => {
    expect(eligibleArtifacts([{ artifacts: [artifact(501, 20, 1, overrides)] }])).toEqual([]);
  });

  it.each([{}, null, [{ unexpected: [] }], [{ artifacts: {} }]])('fails closed on an incomplete API response %j', pages => {
    expect(() => eligibleArtifacts(pages)).toThrow('Invalid artifact response');
  });

  it('does not truncate the candidate set to a few recent uploads', () => {
    const artifacts = Array.from({ length: 12 }, (_, index) => artifact(100 + index, 20 + index));
    expect(eligibleArtifacts([{ artifacts: artifacts.slice(0, 6) }, { artifacts: artifacts.slice(6) }])).toHaveLength(12);
  });

  it('deduplicates run candidates without declaring that any was deployed', () => {
    expect(publishedRuns([{ artifacts: [artifact(501), artifact(502), artifact(503, 21)] }])).toEqual([20, 21]);
  });
});

describe('immutable artifact identity', () => {
  it('returns the exact artifact ID for one run and attempt across paginated results', () => {
    const expected = artifact(700, 20, 2);
    const pages = [{ artifacts: [artifact(501, 20, 1), artifact(601, 21, 2)] }, { artifacts: [expected] }];
    expect(uniqueArtifact(pages, 'github-pages-20-2', 20)).toBe(expected);
    expect(uniqueArtifact(pages, 'github-pages-20-2', 20).id).toBe(700);
  });

  it('does not borrow a same-named artifact from a different run', () => {
    const wrongRun = artifact(500, 21, 2, { name: 'github-pages-20-2' });
    expect(() => uniqueArtifact([{ artifacts: [wrongRun] }], 'github-pages-20-2', 20)).toThrow('No unique retained artifact');
  });

  it('does not substitute a retained earlier attempt for an expired latest attempt', () => {
    const pages = [{ artifacts: [artifact(501, 20, 1), artifact(502, 20, 2, { expired: true })] }];
    expect(() => uniqueArtifact(pages, 'github-pages-20-2', 20)).toThrow('No unique retained artifact');
  });

  it('rejects duplicate artifact names within the same run and attempt instead of picking an ID', () => {
    const pages = [{ artifacts: [artifact(501, 20, 2)] }, { artifacts: [artifact(502, 20, 2)] }];
    expect(() => uniqueArtifact(pages, 'github-pages-20-2', 20)).toThrow('No unique retained artifact');
  });

  it('requires the exact companion-manifest name and attempt', () => {
    const expected = artifact(802, 20, 2, { name: 'static-site-data-manifest-20-2' });
    const pages = [{ artifacts: [artifact(801, 20, 1, { name: 'static-site-data-manifest-20-1' }), expected] }];
    expect(uniqueArtifact(pages, 'static-site-data-manifest-20-2', 20)).toBe(expected);
    expect(() => uniqueArtifact(pages, 'static-site-data-manifest-20-3', 20)).toThrow();
  });
});
