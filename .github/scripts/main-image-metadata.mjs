// Main-push metadata from the runner's immutable event, without a repository API
// lookup. Tag/semver releases keep docker/metadata-action in ci.yml.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {closeSync, constants, fstatSync, openSync, readSync, writeSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const LICENSE_SHA256 = '3876ce8c3f8dd96815b2ad38e007f348f0096d03d379663b81b2b74e80b0f083';
export const EVENT_LIMIT = 32 * 1024 ** 2;
const REPOSITORY = 'kusennjp1-ai/screener';
const REPOSITORY_ID = 1203919607;
const OWNER = 'kusennjp1-ai';
const URL = `https://github.com/${REPOSITORY}`;
const SHA = /^[a-f0-9]{40}$/;
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && Buffer.byteLength(value) <= 4096 && !CONTROL.test(value);

export function mainImageMetadata({event, env, head, licenseBytes, now = new Date()}) {
  assert(object(event) && object(event.repository) && object(event.repository.owner), 'Invalid push repository');
  const repo = event.repository;
  assert(env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main', 'Only main pushes are supported');
  assert(env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID), 'Runner repository mismatch');
  assert(text(env.GITHUB_REPOSITORY_OWNER) && env.GITHUB_REPOSITORY_OWNER.toLowerCase() === OWNER, 'Runner owner mismatch');
  assert(SHA.test(env.GITHUB_SHA ?? '') && head === env.GITHUB_SHA && event.after === head, 'Push and checkout SHA mismatch');
  assert(env.GITHUB_WORKFLOW_SHA === head && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/.github/workflows/ci.yml@refs/heads/main`, 'Workflow identity mismatch');
  assert(event.ref === env.GITHUB_REF && event.deleted === false, 'Invalid main push ref');
  assert(repo.id === REPOSITORY_ID && repo.full_name === REPOSITORY && repo.name === 'screener', 'Event repository mismatch');
  assert(text(repo.owner.login) && repo.owner.login.toLowerCase() === OWNER, 'Event owner mismatch');
  assert(repo.default_branch === 'main' && repo.html_url === URL, 'Event default branch or URL mismatch');
  assert(Object.hasOwn(repo, 'description') && (repo.description === null || text(repo.description)), 'Invalid repository description');
  assert(Buffer.isBuffer(licenseBytes) && licenseBytes.length <= 65536 && createHash('sha256').update(licenseBytes).digest('hex') === LICENSE_SHA256, 'Unreviewed license bytes');
  // Push payloads may omit/null license metadata. The committed license is the
  // authority; a supplied SPDX value must agree rather than silently override it.
  assert(repo.license == null || (object(repo.license) && repo.license.spdx_id === 'Apache-2.0'), 'Conflicting event license');
  assert(now instanceof Date && Number.isFinite(now.getTime()), 'Invalid metadata clock');
  const tags = component => ['main', 'latest', `sha-${head.slice(0, 7)}`].map(tag => `ghcr.io/${OWNER}/stockscreenclaude-${component}:${tag}`);
  // Same keys/priority semantics as the pinned v5 main path. The two images
  // deliberately share one creation timestamp and the immutable event snapshot.
  const labels = Object.entries({
    'org.opencontainers.image.title': repo.name,
    'org.opencontainers.image.description': repo.description ?? '',
    'org.opencontainers.image.url': repo.html_url,
    'org.opencontainers.image.source': repo.html_url,
    'org.opencontainers.image.version': 'main',
    'org.opencontainers.image.created': now.toISOString(),
    'org.opencontainers.image.revision': head,
    'org.opencontainers.image.licenses': 'Apache-2.0',
  }).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`);
  return {backend_tags: tags('backend'), frontend_tags: tags('frontend'), labels};
}

export function renderOutputs(metadata) {
  assert(object(metadata) && JSON.stringify(Object.keys(metadata).sort()) === JSON.stringify(['backend_tags', 'frontend_tags', 'labels']), 'Unexpected metadata outputs');
  const delimiter = 'MAIN_IMAGE_METADATA_END';
  const result = Object.entries(metadata).map(([key, values]) => {
    assert(Array.isArray(values) && values.length > 0 && values.length <= 8 && values.every(value => text(value) && value.length > 0 && value !== delimiter), 'Unsafe output value');
    return `${key}<<${delimiter}\n${values.join('\n')}\n${delimiter}\n`;
  }).join('');
  assert(Buffer.byteLength(result) <= 16384, 'Metadata output exceeds limit');
  return result;
}

export function readBoundedFile(path, limit) {
  assert(typeof path === 'string' && path.length > 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= EVENT_LIMIT, 'Missing or unbounded metadata input');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    assert(before.isFile() && before.size > 0 && before.size <= limit, 'Unsafe metadata input size/type');
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const after = fstatSync(fd);
    assert(offset === before.size && ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]), 'Metadata input changed while reading');
    return buffer.subarray(0, offset);
  } finally { closeSync(fd); }
}

export function runMainImageMetadata(env = process.env, cwd = process.cwd()) {
  const event = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(readBoundedFile(env.GITHUB_EVENT_PATH, EVENT_LIMIT)));
  const licenseBytes = readBoundedFile(resolve(cwd, 'LICENSE'), 65536);
  const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 1024}).trim();
  const output = renderOutputs(mainImageMetadata({event, env, head, licenseBytes}));
  assert(typeof env.GITHUB_OUTPUT === 'string' && env.GITHUB_OUTPUT.length > 0, 'Missing runner output');
  // Validate everything before opening the output: rejected inputs write nothing.
  const fd = openSync(env.GITHUB_OUTPUT, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.size + Buffer.byteLength(output) <= 1024 ** 2, 'Unsafe runner output');
    const bytes = Buffer.from(output);
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset);
      assert(count > 0, 'Runner output write stopped');
      offset += count;
    }
  } finally { closeSync(fd); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runMainImageMetadata(); }
  catch { process.stderr.write('Main image metadata validation failed\n'); process.exitCode = 1; }
}
