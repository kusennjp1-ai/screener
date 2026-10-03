import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicationDecision } from '../../.github/scripts/publication-gate.mjs';

const repository = { full_name: 'owner/screener', default_branch: 'main' };
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const run = (file, overrides = {}) => ({
  id: 10, run_attempt: 1, path: `.github/workflows/${file}`, event: 'push',
  head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success',
  repository, head_repository: repository, ...overrides,
});
const ci = run('ci.yml');
const design = run('design-acceptance.yml', { id: 11 });
const defaults = { eventName: 'workflow_run', event: { repository, workflow_run: ci }, sha, currentSha: sha, runs: [ci, design] };
const decide = overrides => publicationDecision({ ...defaults, ...overrides });
const trigger = overrides => ({ repository, workflow_run: { ...ci, ...overrides } });

describe('automatic Pages publication gates', () => {
  it('can start when either exact-head gate finishes last', () => {
    expect(decide().publish).toBe(true);
    expect(decide({ event: { repository, workflow_run: design } }).publish).toBe(true);
  });
  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null])('blocks Design conclusion %s', conclusion => {
    expect(decide({ runs: [ci, { ...design, conclusion }] }).publish).toBe(false);
  });
  it('blocks pending, absent, failed CI, and different-head checks', () => {
    for (const runs of [[ci], [design], [ci, { ...design, status: 'in_progress' }],
      [{ ...ci, conclusion: 'failure' }, design], [ci, { ...design, head_sha: otherSha }]]) {
      expect(decide({ runs }).publish).toBe(false);
    }
  });
  it('does not reuse an earlier green run after a newer failed or pending run', () => {
    expect(decide({ runs: [ci, design, { ...design, id: 12, conclusion: 'failure' }] }).publish).toBe(false);
    expect(decide({ runs: [ci, design, { ...design, run_attempt: 2, status: 'queued', conclusion: null }] }).publish).toBe(false);
  });
  it('rejects queued and completing work when main has advanced', () => {
    expect(decide({ currentSha: otherSha }).publish).toBe(false);
    // Checking out later main instead of the CI event head is also forbidden.
    expect(decide({ sha: otherSha, currentSha: otherSha }).publish).toBe(false);
  });
  it.each([
    { event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' },
    { status: 'in_progress' }, { head_sha: otherSha }, { path: '.github/workflows/unrelated.yml' },
    { repository: { full_name: 'fork/screener' } }, { head_repository: { full_name: 'fork/screener' } },
  ])('rejects an untrusted or unsuccessful trigger: %j', overrides => {
    expect(decide({ event: trigger(overrides) }).publish).toBe(false);
  });
  it('rejects PR, fork, and manual results as automatic exact-main quality gates', () => {
    for (const overrides of [{ event: 'pull_request' }, { event: 'workflow_dispatch' },
      { head_repository: { full_name: 'fork/screener' } }, { head_branch: 'feature' }]) {
      expect(decide({ runs: [ci, { ...design, ...overrides }] }).publish).toBe(false);
    }
  });
  it('uses an old completed export only with both gates on current main', () => {
    const event = { repository, workflow_run: run('static-site.yml', { event: 'schedule', head_sha: otherSha }) };
    expect(decide({ event }).publish).toBe(true);
    expect(decide({ event, runs: [ci] }).publish).toBe(false);
    expect(decide({ event, currentSha: otherSha }).publish).toBe(false);
  });
  it('preserves explicit manual release controls but prevents stale manual deploys', () => {
    expect(decide({ eventName: 'workflow_dispatch', event: { repository }, runs: [] }).publish).toBe(true);
    expect(decide({ eventName: 'workflow_dispatch', event: { repository }, currentSha: otherSha }).publish).toBe(false);
  });
});

describe('publication workflow wiring', () => {
  const workflow = file => readFileSync(`../.github/workflows/${file}`, 'utf8');
  it('has one serial publisher, pinned checkout, and two final rechecks', () => {
    const release = workflow('research-ui-release.yml');
    expect(release).toContain('workflows: [CI, Design Acceptance, Static Site]');
    expect(release).toContain('group: research-ui-release\n  cancel-in-progress: false');
    expect(release).toContain('ref: ${{ env.RELEASE_SHA }}');
    expect(release).toContain('ref: ${{ needs.eligibility.outputs.sha }}');
    expect(release.match(/publication-gate.mjs --require/g)).toHaveLength(2);
    expect(release.indexOf('node tools/check-data-quality.mjs')).toBeLessThan(release.indexOf('actions/upload-pages-artifact'));
    expect(release.lastIndexOf('publication-gate.mjs --require')).toBeLessThan(release.indexOf('uses: actions/deploy-pages'));
    expect(release).toContain('cp "$RUNNER_TEMP/publication.json" dist/publication.json');
    expect(release.indexOf('node .github/scripts/select-release-source.mjs')).toBeLessThan(release.indexOf('npm ci'));
    expect(release).toContain("- uses: actions/upload-pages-artifact@v4\n        if: steps.source.outputs.publish == 'true'");
    expect(release).not.toContain('workflows: [Research UI Release');
  });
  it('retains the checked fresh export without a direct Static Site deployment', () => {
    const exports = workflow('static-site.yml');
    expect(exports).toContain('name: static-site-data');
    expect(exports).toContain('name: static-site-data-manifest');
    expect(exports).toContain('node tools/check-data-quality.mjs');
    expect(exports).not.toContain('actions/deploy-pages');
    expect(exports).not.toContain('pages: write');
    expect(exports).not.toContain('id-token: write');
  });
  it('runs unchanged Design checks for every main push', () => {
    const design = workflow('design-acceptance.yml');
    expect(design).toContain('push:\n    branches: [main]\n  pull_request:');
    expect(design).toContain('node tools/design-review.mjs');
    expect(design).toContain('node tools/check-design-review.mjs');
  });
});
