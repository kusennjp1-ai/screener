import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {EVENT_LIMIT, LICENSE_SHA256, mainImageMetadata, readBoundedFile, renderOutputs} from './main-image-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const licenseBytes = readFileSync(join(root, 'LICENSE'));
const sha = '0123456789abcdef0123456789abcdef01234567';
const now = new Date('2026-10-17T14:00:00.000Z');
function input(head = sha) {
  return {
    event: {ref: 'refs/heads/main', after: head, deleted: false, repository: {
      id: 1203919607, name: 'screener', full_name: 'kusennjp1-ai/screener',
      owner: {login: 'kusennjp1-ai'}, default_branch: 'main',
      html_url: 'https://github.com/kusennjp1-ai/screener', description: 'Stock screening',
    }},
    env: {GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'kusennjp1-ai/screener', GITHUB_REPOSITORY_ID: '1203919607',
      GITHUB_REPOSITORY_OWNER: 'kusennjp1-ai', GITHUB_SHA: head,
      GITHUB_WORKFLOW_SHA: head,
      GITHUB_WORKFLOW_REF: 'kusennjp1-ai/screener/.github/workflows/ci.yml@refs/heads/main'},
    head, licenseBytes, now,
  };
}
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'main-image-metadata-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function parseOutputs(value) {
  const lines = value.split('\n');
  const result = {};
  for (let i = 0; i < lines.length && lines[i]; i++) {
    const match = /^([a-z_]+)<<([A-Z_]+)$/.exec(lines[i]);
    assert(match, 'Unexpected output header');
    const values = [];
    while (++i < lines.length && lines[i] !== match[2]) values.push(lines[i]);
    assert(i < lines.length, 'Unclosed output');
    assert(!Object.hasOwn(result, match[1]), 'Duplicate output');
    result[match[1]] = values;
  }
  return result;
}

test('golden main tags and all eight sorted OCI labels preserve pinned v5 meanings', () => {
  assert.equal(createHash('sha256').update(licenseBytes).digest('hex'), LICENSE_SHA256);
  const result = mainImageMetadata(input());
  for (const component of ['backend', 'frontend']) assert.deepEqual(result[`${component}_tags`], [
    `ghcr.io/kusennjp1-ai/stockscreenclaude-${component}:main`,
    `ghcr.io/kusennjp1-ai/stockscreenclaude-${component}:latest`,
    `ghcr.io/kusennjp1-ai/stockscreenclaude-${component}:sha-0123456`,
  ]);
  assert.deepEqual(result.labels, [
    'org.opencontainers.image.created=2026-10-17T14:00:00.000Z',
    'org.opencontainers.image.description=Stock screening',
    'org.opencontainers.image.licenses=Apache-2.0',
    `org.opencontainers.image.revision=${sha}`,
    'org.opencontainers.image.source=https://github.com/kusennjp1-ai/screener',
    'org.opencontainers.image.title=screener',
    'org.opencontainers.image.url=https://github.com/kusennjp1-ai/screener',
    'org.opencontainers.image.version=main',
  ]);
  assert.deepEqual(parseOutputs(renderOutputs(result)), result);
});

for (const description of [null, '', '日本語, "quoted" = value', 'MAIN_IMAGE_METADATA_END']) test(`safe description ${JSON.stringify(description)}`, () => {
  const value = input(); value.event.repository.description = description;
  const result = mainImageMetadata(value);
  assert(result.labels.includes(`org.opencontainers.image.description=${description ?? ''}`));
  assert.deepEqual(parseOutputs(renderOutputs(result)), result);
});
test('owner capitalization preserves fixed lowercase image destinations', () => {
  const value = input(); value.env.GITHUB_REPOSITORY_OWNER = 'KUSENNJP1-AI'; value.event.repository.owner.login = 'KUSENNJP1-AI';
  assert.deepEqual(mainImageMetadata(value), mainImageMetadata(input()));
});
for (const license of [undefined, null, {spdx_id: 'Apache-2.0'}]) test(`committed license authority accepts ${JSON.stringify(license)}`, () => {
  const value = input(); value.event.repository.license = license;
  assert.deepEqual(mainImageMetadata(value), mainImageMetadata(input()));
});

const invalid = {
  'wrong event': v => {v.env.GITHUB_EVENT_NAME = 'pull_request';},
  'tag ref': v => {v.env.GITHUB_REF = 'refs/tags/v1.0.0';},
  'event ref mismatch': v => {v.event.ref = 'refs/heads/develop';},
  'deleted push': v => {v.event.deleted = true;},
  'missing deleted flag': v => {delete v.event.deleted;},
  'wrong runner repository': v => {v.env.GITHUB_REPOSITORY = 'other/screener';},
  'wrong runner repository ID': v => {v.env.GITHUB_REPOSITORY_ID = '1';},
  'wrong runner owner': v => {v.env.GITHUB_REPOSITORY_OWNER = 'other';},
  'wrong event repository': v => {v.event.repository.full_name = 'other/screener';},
  'wrong event repository ID': v => {v.event.repository.id = 1;},
  'wrong event name': v => {v.event.repository.name = 'other';},
  'wrong event owner': v => {v.event.repository.owner.login = 'other';},
  'missing event owner': v => {delete v.event.repository.owner;},
  'wrong event URL': v => {v.event.repository.html_url += '/other';},
  'nondefault main': v => {v.event.repository.default_branch = 'develop';},
  'missing default branch': v => {delete v.event.repository.default_branch;},
  'wrong after': v => {v.event.after = 'f'.repeat(40);},
  'wrong checkout': v => {v.head = 'f'.repeat(40);},
  'invalid SHA': v => {v.head = v.event.after = v.env.GITHUB_SHA = 'x'.repeat(40);},
  'missing SHA': v => {delete v.env.GITHUB_SHA;},
  'wrong workflow SHA': v => {v.env.GITHUB_WORKFLOW_SHA = 'f'.repeat(40);},
  'wrong workflow ref': v => {v.env.GITHUB_WORKFLOW_REF = 'other';},
  'missing description': v => {delete v.event.repository.description;},
  'object description': v => {v.event.repository.description = {};},
  'oversized description': v => {v.event.repository.description = 'a'.repeat(4097);},
  'LF injection': v => {v.event.repository.description = 'value\nMAIN_IMAGE_METADATA_END\nother=value';},
  'CR injection': v => {v.event.repository.description = 'value\rother=value';},
  'NUL injection': v => {v.event.repository.description = 'value\0other=value';},
  'Unicode separator': v => {v.event.repository.description = 'value\u2028other=value';},
  'conflicting SPDX': v => {v.event.repository.license = {spdx_id: 'MIT'};},
  'malformed license': v => {v.event.repository.license = 'Apache-2.0';},
  'missing explicit SPDX': v => {v.event.repository.license = {};},
  'changed license bytes': v => {v.licenseBytes = Buffer.concat([licenseBytes, Buffer.from('\n')]);},
  'missing license bytes': v => {delete v.licenseBytes;},
  'invalid clock': v => {v.now = new Date(NaN);},
};
for (const [name, mutate] of Object.entries(invalid)) test(`rejects ${name}`, () => {
  const value = input(); mutate(value); assert.throws(() => mainImageMetadata(value));
});
test('output encoder rejects altered keys, delimiters and multiline values', () => {
  for (const change of [v => {v.extra = ['x'];}, v => {v.labels = ['MAIN_IMAGE_METADATA_END'];}, v => {v.labels = ['safe\nother=value'];}, v => {v.backend_tags = [];}]) {
    const value = mainImageMetadata(input()); change(value); assert.throws(() => renderOutputs(value));
  }
});
test('bounded reads reject empty, oversized, directory, symbolic-link and FIFO inputs', t => {
  const dir = temporary(t), file = join(dir, 'input'), link = join(dir, 'link'), fifo = join(dir, 'fifo');
  writeFileSync(file, 'abc'); assert.equal(readBoundedFile(file, 3).toString(), 'abc');
  assert.throws(() => readBoundedFile(file, 2));
  assert.throws(() => readBoundedFile(dir, 100));
  assert.throws(() => readBoundedFile(file, EVENT_LIMIT + 1));
  symlinkSync(file, link); assert.throws(() => readBoundedFile(link, 3));
  execFileSync('mkfifo', [fifo]); assert.throws(() => readBoundedFile(fifo, 3));
  writeFileSync(file, ''); assert.throws(() => readBoundedFile(file, 3));
});

test('CLI validates a real checkout, emits complete outputs, and writes nothing on failures', t => {
  const dir = temporary(t);
  const git = (...args) => execFileSync('git', args, {cwd: dir, stdio: 'pipe', encoding: 'utf8'}).trim();
  git('init', '--quiet'); writeFileSync(join(dir, 'LICENSE'), licenseBytes); git('add', 'LICENSE');
  git('-c', 'user.name=Metadata test', '-c', 'user.email=metadata@example.invalid', 'commit', '--quiet', '-m', 'Fixture');
  const value = input(git('rev-parse', 'HEAD'));
  const eventFile = join(dir, 'event.json'), outputFile = join(dir, 'output');
  const env = {...process.env, ...value.env, GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: outputFile};
  const invoke = () => spawnSync(process.execPath, [join(root, '.github/scripts/main-image-metadata.mjs')], {cwd: dir, env, encoding: 'utf8', timeout: 10000, maxBuffer: 65536});
  writeFileSync(eventFile, JSON.stringify(value.event)); writeFileSync(outputFile, '');
  const result = invoke(); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  const outputs = parseOutputs(readFileSync(outputFile, 'utf8'));
  const created = outputs.labels.find(x => x.startsWith('org.opencontainers.image.created=')).split('=').slice(1).join('=');
  assert.deepEqual(outputs, mainImageMetadata({...value, now: new Date(created)}));
  for (const bad of ['{', Buffer.from([0xff]), JSON.stringify({...value.event, after: sha})]) {
    writeFileSync(eventFile, bad); writeFileSync(outputFile, 'sentinel\n');
    const failed = invoke(); assert.equal(failed.status, 1); assert.equal(failed.stderr, 'Main image metadata validation failed\n');
    assert.equal(readFileSync(outputFile, 'utf8'), 'sentinel\n');
  }
  writeFileSync(eventFile, '{}'); truncateSync(eventFile, EVENT_LIMIT + 1); writeFileSync(outputFile, 'sentinel\n');
  assert.equal(invoke().status, 1); assert.equal(readFileSync(outputFile, 'utf8'), 'sentinel\n');
  writeFileSync(eventFile, JSON.stringify(value.event));
  rmSync(outputFile); symlinkSync(eventFile, outputFile);
  assert.equal(invoke().status, 1); assert.equal(readFileSync(eventFile, 'utf8'), JSON.stringify(value.event));
  rmSync(outputFile); execFileSync('mkfifo', [outputFile]);
  const fifoResult = invoke(); assert.equal(fifoResult.status, 1); assert.equal(fifoResult.error, undefined);
});

test('CI preserves image publication gates and the complete upstream tag rules', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const publish = workflow.split('  publish-images:\n')[1].split('\n  release:\n')[0];
  assert(publish.includes('needs: [backend, frontend, assistant-compose-smoke, static-browser]'));
  assert(publish.includes("if: github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))"));
  assert(publish.includes('permissions:\n      contents: read\n      packages: write'));
  assert(publish.includes("id: main-meta\n        if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n        run: node .github/scripts/main-image-metadata.mjs"));
  assert.equal((publish.match(/push: true/g) ?? []).length, 2);
  assert(!/continue-on-error|provenance:|github-token:|GITHUB_TOKEN.*main-image|always\(\)/.test(publish));
  const tagRules = `          tags: |\n            type=ref,event=branch\n            type=ref,event=tag\n            type=sha\n            type=raw,value=latest,enable={{is_default_branch}}\n            type=semver,pattern={{version}},enable=\${{ startsWith(github.ref, 'refs/tags/v') }}\n            type=semver,pattern={{major}}.{{minor}},enable=\${{ startsWith(github.ref, 'refs/tags/v') }}`;
  assert.equal(publish.split(tagRules).length - 1, 2);
  for (const component of ['backend', 'frontend']) {
    assert(publish.includes(`id: ${component}-meta\n        if: startsWith(github.ref, 'refs/tags/v')\n        uses: docker/metadata-action@v5`));
    assert(publish.includes(`tags: \${{ steps.main-meta.outputs.${component}_tags }}\${{ steps.${component}-meta.outputs.tags }}`));
    assert(publish.includes(`labels: \${{ steps.main-meta.outputs.labels }}\${{ steps.${component}-meta.outputs.labels }}`));
    assert(publish.includes(`cache-from: type=gha,scope=${component}-image\n          cache-to: type=gha,mode=max,scope=${component}-image`));
  }
  assert(publish.includes('context: .\n          file: backend/Dockerfile'));
  assert(publish.includes('context: ./frontend\n          file: ./frontend/Dockerfile'));
  assert(publish.includes('build-args: |\n            VITE_API_URL=/api'));
  const frontend = workflow.split('  frontend:\n')[1].split('\n  static-browser:\n')[0];
  assert(frontend.includes('node-version: 22'));
  assert(frontend.includes('run: node --test .github/scripts/main-image-metadata.test.mjs'));
  assert(workflow.includes("name: Create GitHub Release\n    needs: [backend, frontend, publish-images]\n    if: startsWith(github.ref, 'refs/tags/v')"));
});
