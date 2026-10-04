// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const checker = readFileSync(fileURLToPath(new URL('./check-design-review.mjs', import.meta.url)), 'utf8');
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-source-provenance-'));
  directories.push(root);
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  write('frontend/package.json', '{"type":"module"}');
  write('frontend/tools/check-design-review.mjs', checker);
  write('frontend/src/current.js', 'export const version = 1;');
  write('contracts/static_financial_current_v1.json', '{"version":1,"source_max_age_ms":604800000}');
  git('add', '.'); git('commit', '-m', 'Synthetic captured source');
  const observed = git('rev-parse', 'HEAD').trim();
  // Synthetic metadata exercises source binding only. It is not an actual
  // screenshot review and is never installed in the project's review directory.
  write('docs/design-review/2026-10-04-fixture.json', JSON.stringify({ observed_commit: observed,
    reviewer: 'synthetic checker test', evidence_run: 'fixture', screens: [{ key: 'fixture', screenshot: 'fixture.png',
      scores: Object.fromEntries(['design', 'usability', 'originality', 'content'].map(key => [key, { value: 8, reason: 'synthetic source-binding fixture' }])) }] }));
  write('frontend/test-results/design-review/report.json', JSON.stringify({ screens: [{ key: 'fixture' }], failures: [] }));
  const commit = () => { git('add', '.'); git('commit', '-m', 'Synthetic subsequent source'); };
  const run = () => spawnSync(process.execPath, ['tools/check-design-review.mjs'], { cwd: join(root, 'frontend'), encoding: 'utf8' });
  return { write, commit, run };
}

describe('visual review source binding includes the compiled financial contract', () => {
  it('accepts the captured source with later documentation only', () => {
    const f = fixture(); f.write('docs/unrelated.md', 'Documentation only.'); f.commit();
    expect(f.run().status).toBe(0);
  });
  it.each(['contracts/static_financial_current_v1.json', 'frontend/src/current.js'])(
    'rejects a review captured before %s changed', path => {
      const f = fixture(); f.write(path, path.endsWith('.json') ? '{"version":1,"source_max_age_ms":999999999}' : 'export const version = 2;'); f.commit();
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No screenshot-based design review matches the current UI');
    },
  );
});
