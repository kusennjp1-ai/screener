// @vitest-environment node
import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const repository = resolve(frontend, '..');

it('builds the static app and hashes its financial contract using only the frontend Docker context', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontend-context-build-'));
  const context = join(directory, 'frontend');
  try {
    // Copy the checkout's frontend inputs only, without repository-root files,
    // generated data, local secrets or cached outputs. Dependencies are the
    // already installed equivalent of Dockerfile's npm ci step; no network.
    const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'frontend'],
      { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const path of paths) {
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repository, path), target);
    }
    symlinkSync(join(frontend, 'node_modules'), join(context, 'node_modules'), 'dir');
    expect(existsSync(join(directory, 'contracts'))).toBe(false);
    expect(existsSync(join(directory, 'backend'))).toBe(false);

    const build = spawnSync('npm', ['run', 'build'], {
      cwd: context,
      env: { ...process.env, NODE_ENV: 'production', VITE_STATIC_SITE: 'true', VITE_BASE_PATH: '/screener/', npm_config_offline: 'true', npm_config_update_notifier: 'false' },
      encoding: 'utf8', timeout: 120000, maxBuffer: 5 * 1024 * 1024,
    });
    expect(build.error).toBeUndefined();
    expect(build.status, build.stderr || build.stdout).toBe(0);
    expect(readFileSync(join(context, 'dist/index.html'), 'utf8')).toContain('/screener/assets/');
    expect(JSON.parse(readFileSync(join(context, 'dist/precache-manifest.json'), 'utf8'))).toContain('/screener/index.html');

    // A data-free image build skips the workbench export. Exercise its runtime
    // source hash here as well, inside the same frontend-only context.
    const workbench = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { exportWorkbench } from './tools/export-workbench.mjs';
      import { workbenchRuleFingerprint } from './tools/workbench-comparison.mjs';
      import { readFile, writeFile } from 'node:fs/promises';
      const result = await exportWorkbench({ root: './test-results/context-workbench',
        rows: [], manifest: { generated_at: '2026-10-02T20:00:00Z' },
        entry: { as_of_date: '2026-10-02', assets: {} }, researchContent: '[]' });
      if (!/^[a-f0-9]{64}$/.test(result.rule_version)) throw Error('Missing runtime source hash');
      const nativeContract = './contracts/native_annual_history_v1.json';
      const original = await readFile(nativeContract, 'utf8');
      await writeFile(nativeContract, original + ' ');
      if (await workbenchRuleFingerprint() === result.rule_version) throw Error('Native annual contract missing from policy fingerprint');
    `], { cwd: context, encoding: 'utf8', timeout: 20000 });
    expect(workbench.error).toBeUndefined();
    expect(workbench.status, workbench.stderr || workbench.stdout).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 150000);
