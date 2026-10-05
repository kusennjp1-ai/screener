import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './publication-state.mjs';

const releaseCli = fileURLToPath(new URL('./select-release-source.mjs', import.meta.url));
const previewUrl = new URL('./financial-candidate-preview.mjs', import.meta.url).href;
const sha = 'a'.repeat(40);

function fixture(t, { currentSha = sha, preload = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'release-source-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), event = join(root, 'event.json'), output = join(root, 'output');
  mkdirSync(bin);
  writeFileSync(event, '{}');
  const prefix = `repos/${bootstrap.repository}`;
  const api = {
    [prefix]: { full_name: bootstrap.repository, default_branch: 'main' },
    [`${prefix}/git/ref/heads/main`]: { object: { sha: currentSha } },
    ...Object.fromEntries(['ci.yml', 'design-acceptance.yml'].map(workflow => [
      `${prefix}/actions/workflows/${workflow}/runs?branch=main&event=push&head_sha=${sha}&per_page=100`,
      [{ workflow_runs: [] }],
    ])),
  };
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n
const args = process.argv.slice(2), api = ${JSON.stringify(api)};
if (args[0] !== 'api' || args.slice(1, -1).some(arg => !['--paginate', '--slurp'].includes(arg))) throw Error('Unexpected fixture command');
const endpoint = args.at(-1);
if (!Object.hasOwn(api, endpoint)) throw Error('Unexpected fixture API read ' + endpoint);
process.stdout.write(JSON.stringify(api[endpoint]));
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const hook = join(root, 'fetch.mjs');
  writeFileSync(hook, preload || "globalThis.fetch = () => { throw Error('Unexpected fixture fetch'); };");
  return {
    root, output,
    invoke(command = 'plan') {
      // Start the real entrypoint in a fresh process: importing its exports in
      // the test runner would complete evaluation before dispatch and hide this bug.
      return spawnSync(process.execPath, ['--import', hook, releaseCli, command], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: { PATH: bin, RUNNER_TEMP: root, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REPOSITORY: bootstrap.repository, RELEASE_SHA: sha, GITHUB_OUTPUT: output },
      });
    },
  };
}

test('release plan CLI completes a blocked publication without fetching Pages', t => {
  const f = fixture(t, { currentSha: 'b'.repeat(40) }), result = f.invoke();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), 'publish=false\n');
  assert.match(result.stdout, /Controller revision is no longer current main/);
});

test('release plan CLI completes the lazy preview import cycle and reports validator failures', t => {
  // Trigger the actual preview -> select-release-source module dependency from
  // the first offline fetch. This isolates startup from the multi-GB candidate
  // fixture; no release validator or gate is replaced or granted authority.
  const f = fixture(t, { preload: `globalThis.fetch = async () => {
    const { validatePreviewReceipt } = await import(${JSON.stringify(previewUrl)});
    validatePreviewReceipt({});
  };` }), result = f.invoke();
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Invalid closed preview receipt/);
  assert.doesNotMatch(result.stderr, /unsettled top-level await|command did not complete/);
  assert.equal(existsSync(f.output), false);
  assert.equal(existsSync(join(f.root, 'verified-publication/state.json')), false);
});

test('release plan CLI fails closed when asynchronous work never settles', t => {
  const f = fixture(t, { preload: 'globalThis.fetch = () => new Promise(() => {});' }), result = f.invoke();
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Release source command did not complete/);
  assert.equal(existsSync(f.output), false);
  assert.equal(existsSync(join(f.root, 'verified-publication/state.json')), false);
});

test('release CLI rejects unknown commands', t => {
  const result = fixture(t).invoke('unknown');
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Expected plan, design, restore, compose, check-design-data, recheck or export-metadata/);
});
