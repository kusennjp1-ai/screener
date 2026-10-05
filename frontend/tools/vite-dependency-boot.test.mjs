// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { optimizeDeps, resolveConfig } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let cacheDir;
let optimized;

beforeAll(async () => {
  cacheDir = await mkdtemp(join(root, 'node_modules/.vite-boot-test-'));
  const config = await resolveConfig({
    root,
    configFile: join(root, 'vite.config.js'),
    cacheDir,
    logLevel: 'error',
  }, 'serve');
  ({ optimized } = await optimizeDeps(config, true));
});

afterAll(async () => {
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
});

describe('cold Vite dependency initialization', () => {
  // A production build and a Vitest-transformed import cannot catch the dev
  // optimizer's split-chunk ordering bug. Evaluate the actual generated ESM in
  // a fresh process per entry: loading styles first would hide the Box failure.
  // Only direct entrypoints still imported by the app are expected in Vite
  // discovery. Tooltip and Chip now use the @mui/material barrel; the app no
  // longer imports their standalone entries. Check Chip on that actual entry.
  it.each([
    '@mui/material/Box',
    '@mui/material',
    '@mui/material/styles',
    '@mui/material/CircularProgress',
    '@mui/material/Link',
    '@mui/material/Typography',
    '@mui/icons-material/InfoOutlined',
  ])('can load %s before other MUI entries', (id) => {
    expect(optimized[id], `Expected Vite to discover ${id}`).toBeDefined();
    const url = pathToFileURL(optimized[id].file).href;
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `const entry = await import(${JSON.stringify(url)});${id === '@mui/material' ? "if (!entry.Chip) throw new Error('Material barrel must provide Chip');" : ''}`,
    ], { encoding: 'utf8' });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
