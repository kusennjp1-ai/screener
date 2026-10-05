import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This public entry point always runs both gates. Each large graph dies with
// its worker before the next is loaded; the parent retains only fixed receipts.
if (process.argv.length !== 2) throw Error('check-data-quality does not accept arguments');
for (const phase of ['core', 'financial']) {
  const worker = fileURLToPath(new URL(`./check-data-quality-${phase}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, [...process.execArgv, worker], {
    // Preserve direct Node flags and inherited NODE_OPTIONS (including heap
    // limits). Ordinary diagnostics stream through; only fd 3 is buffered.
    stdio: ['inherit', 'inherit', 'inherit', 'pipe'], maxBuffer: 256,
  });
  if (result.error) throw Error(`Data quality ${phase} worker failed: ${result.error.message}`, { cause: result.error });
  if (result.signal || result.status !== 0) throw Error(`Data quality ${phase} worker failed: ${result.signal || `exit ${result.status}`}`);
  const expected = Buffer.from(`data-quality:${phase}:complete:v1\n`);
  if (!result.output[3]?.equals(expected)) throw Error(`Data quality ${phase} worker did not complete its gate`);
}
