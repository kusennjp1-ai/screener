import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicationDecision } from '../../.github/scripts/publication-gate.mjs';
const repository = { full_name: 'owner/screener', default_branch: 'main' };
const sha = 'a'.repeat(40), otherSha = 'b'.repeat(40);
const run = (file, overrides = {}) => ({ id: 10, run_attempt: 1, path: `.github/workflows/${file}`, event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success', repository, head_repository: repository, ...overrides });
const ci = run('ci.yml'), design = run('design-acceptance.yml', { id: 11 });
const defaults = { eventName: 'workflow_run', event: { repository, workflow_run: ci }, sha, currentSha: sha, runs: [ci, design] };
const decide = overrides => publicationDecision({ ...defaults, ...overrides });
describe('split Pages publication gates', () => {
  it('lets either completion reconcile exactly verified current main and records gate attempts', () => {
    expect(decide()).toMatchObject({ publish: true, mode: 'ui', approval: { type: 'gates', sha } });
    expect(decide({ event: { repository, workflow_run: design } }).mode).toBe('ui');
    expect(decide().approval.runs).toEqual([{ id: 10, attempt: 1, path: ci.path }, { id: 11, attempt: 1, path: design.path }]);
  });
  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null])('retains approved live UI when Design is %s', conclusion => {
    expect(decide({ runs: [ci, { ...design, conclusion }] })).toMatchObject({ publish: true, mode: 'data' });
  });
  it('never approves UI for missing, pending, failed, different-head or superseded gates', () => {
    for (const runs of [[ci], [design], [ci, { ...design, status: 'in_progress' }], [{ ...ci, conclusion: 'failure' }, design],
      [ci, { ...design, head_sha: otherSha }], [ci, design, { ...design, id: 12, conclusion: 'failure' }],
      [ci, design, { ...design, run_attempt: 2, status: 'queued', conclusion: null }]]) expect(decide({ runs }).mode).toBe('data');
  });
  it('rejects a controller main superseded during preparation', () => expect(decide({ currentSha: otherSha }).publish).toBe(false));
  it('reconciles verified current main when a stale completion replaced a useful pending event', () => {
    const runs = [ci, design].map(run => ({ ...run, head_sha: otherSha }));
    expect(decide({ sha: otherSha, currentSha: otherSha, runs })).toMatchObject({ mode: 'ui', approval: { sha: otherSha } });
    expect(decide({ sha: otherSha, currentSha: otherSha }).mode).toBe('data');
  });
  it.each([{ event: 'pull_request' }, { head_branch: 'feature' }, { status: 'in_progress' }, { path: '.github/workflows/unrelated.yml' },
    { repository: { full_name: 'fork/screener' } }, { head_repository: { full_name: 'fork/screener' } }])('rejects untrusted trigger %j', overrides => {
    expect(decide({ event: { repository, workflow_run: { ...ci, ...overrides } } }).publish).toBe(false);
  });
  it('rejects fork, PR and manual check results as exact-main UI approval', () => {
    for (const overrides of [{ event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_repository: { full_name: 'fork/screener' } }, { head_branch: 'feature' }]) {
      expect(decide({ runs: [ci, { ...design, ...overrides }] }).mode).toBe('data');
    }
  });
  it('handles cancelled Static Site completions whose checked export may still be valid', () => {
    const event = { repository, workflow_run: run('static-site.yml', { id: 37078930007, event: 'schedule', conclusion: 'cancelled', head_sha: otherSha }) };
    expect(decide({ event, runs: [ci] })).toMatchObject({ publish: true, mode: 'data' });
  });
  it('gates manual new UI while retaining manual data recovery and stale-main rejection', () => {
    const manual = { eventName: 'workflow_dispatch', event: { repository } };
    expect(decide(manual).mode).toBe('ui');
    expect(decide({ ...manual, runs: [] })).toMatchObject({ publish: true, mode: 'data' });
    expect(decide({ ...manual, currentSha: otherSha }).publish).toBe(false);
  });
});
describe('split workflow wiring', () => {
  const workflow = file => readFileSync(`../.github/workflows/${file}`, 'utf8');
  it('has one serial publisher and separate pinned controller/UI checkouts', () => {
    const release = workflow('research-ui-release.yml');
    expect(release).toContain('workflows: [CI, Design Acceptance, Static Site]');
    expect(release).toContain('group: research-ui-release\n  cancel-in-progress: false');
    expect(release).toContain('ref: ${{ steps.main.outputs.sha }}');
    expect(release).toContain('ref: ${{ steps.plan.outputs.sha }}\n          path: release');
    expect(release).toContain('working-directory: release/frontend');
    expect(release).not.toContain('github.event.repository.default_branch');
    expect(release).not.toContain("github.event.workflow_run.conclusion == 'success'");
  });
  it('keeps quality checks and final identity checks around a unique per-attempt artifact', () => {
    const release = workflow('research-ui-release.yml');
    expect(release.match(/select-release-source.mjs recheck/g)).toHaveLength(2);
    expect(release.indexOf('node tools/check-data-quality.mjs')).toBeLessThan(release.indexOf('select-release-source.mjs compose'));
    expect(release.indexOf('select-release-source.mjs compose')).toBeLessThan(release.indexOf('actions/upload-pages-artifact'));
    expect(release).toContain('name: github-pages-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(release).toContain('artifact_name: github-pages-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(release.lastIndexOf('select-release-source.mjs recheck')).toBeLessThan(release.indexOf('uses: actions/deploy-pages'));
  });
  it('keeps checked export/manifest attempts without direct publication or overwrites', () => {
    const source = workflow('static-site.yml');
    expect(source).toContain('name: static-site-data-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(source).toContain('name: static-site-data-manifest-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(source).toContain('node tools/check-data-quality.mjs');
    for (const forbidden of ['actions/deploy-pages', 'pages: write', 'id-token: write', 'overwrite: true']) expect(source).not.toContain(forbidden);
  });
  it('preserves Design budgets while allowing checked input after Pages artifact expiry', () => {
    const design = workflow('design-acceptance.yml');
    expect(design).toContain('push:\n    branches: [main]\n  pull_request:');
    expect(design).toContain('node tools/design-review.mjs');
    expect(design).toContain('node tools/check-design-review.mjs');
    expect(design).toContain('select-release-source.mjs design');
    expect(design).not.toContain('--name github-pages');
  });
});
