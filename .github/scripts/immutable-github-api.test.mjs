import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImmutableGitApi } from './immutable-github-api.mjs';

const repository = 'owner/screener', prefix = `repos/${repository}`;
const sha = 'a'.repeat(40), parentSha = 'b'.repeat(40), treeSha = 'c'.repeat(40);
const commitEndpoint = `${prefix}/git/commits/${sha}`;
const contentPath = 'contracts/a spaced file.json', contentEndpoint = `${prefix}/contents/${contentPath}?ref=${sha}`;
const gitHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const content = (text = '{"ok":true}\n') => {
  const bytes = Buffer.from(text);
  return { type: 'file', path: contentPath, sha: gitHash('blob', bytes), size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
};
const commit = () => ({ sha, tree: { sha: treeSha }, parents: [{ sha: parentSha }] });
const temporary = t => { const root = mkdtempSync(join(tmpdir(), 'immutable-api-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
function reader(value = commit(), limits) {
  const calls = [];
  const api = createImmutableGitApi((...args) => { calls.push(args); return structuredClone(value); }, repository, limits);
  return { api, calls };
}
function realGitTree(t) {
  const root = temporary(t);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  for (const [path, text] of [['a.c', 'sibling'], ['a/child file.txt', 'nested\n'], ['a/sub/é.txt', 'unicode'], ['a0', 'ordering'], ['z.sh', '#!/bin/sh\ntrue\n']]) {
    mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text);
  }
  chmodSync(join(root, 'z.sh'), 0o755); symlinkSync('a/child file.txt', join(root, 'link'));
  git('add', '.');
  // A gitlink is hashed as a normal leaf with mode 160000; later source policy
  // validators still decide whether this mode is allowed at a reviewed path.
  git('update-index', '--add', '--cacheinfo', `160000,${sha},submodule`);
  const tree = git('write-tree');
  const list = directories => execFileSync('git', ['-C', root, 'ls-tree', '-r', ...(directories ? ['-t'] : []), '-z', tree]).toString('utf8').split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
    return { mode: match[1], type: match[2], sha: match[3], path: match[4] };
  });
  return { endpoint: `${prefix}/git/trees/${tree}?recursive=1`, flat: { sha: tree, truncated: false, tree: list(false) }, recursive: { sha: tree, truncated: false, tree: list(true) } };
}

test('exact immutable commit and content GETs are reused with independent response clones', () => {
  for (const [endpoint, value] of [[commitEndpoint, commit()], [contentEndpoint, content()]]) {
    const { api, calls } = reader(value);
    const first = api(endpoint); first.changed = true;
    if (first.tree) first.tree.sha = parentSha;
    const second = api(endpoint);
    assert.deepEqual(second, value); assert.notEqual(first, second); assert.equal(calls.length, 1);
    second.changed = true; assert.deepEqual(api(endpoint), value);
  }
});

test('complete recursive API trees and flat fixtures reproduce real Git hashes, modes and spaced paths', t => {
  const fixture = realGitTree(t);
  for (const tree of [fixture.flat, fixture.recursive, { ...fixture.recursive, tree: [...fixture.recursive.tree].reverse() }]) {
    const { api, calls } = reader(tree);
    const first = api(fixture.endpoint); first.tree[0].sha = parentSha;
    assert.deepEqual(api(fixture.endpoint), tree); assert.equal(calls.length, 1);
  }
  const emptySha = gitHash('tree', Buffer.alloc(0)), { api, calls } = reader({ sha: emptySha, truncated: false, tree: [] });
  api(`${prefix}/git/trees/${emptySha}?recursive=1`); api(`${prefix}/git/trees/${emptySha}?recursive=1`);
  assert.equal(calls.length, 1);
});

test('mutable state, other repositories, pagination and endpoint/query aliases always fetch', () => {
  const endpoints = [
    `${prefix}`, `${prefix}/git/ref/heads/main`, `${prefix}/git/refs/heads/main`, `${prefix}/git/commits/main`,
    `${prefix}/git/trees/main?recursive=1`, `${prefix}/git/trees/${treeSha}`, `${prefix}/contents/x?ref=main`,
    `${prefix}/actions/runs/1`, `${prefix}/actions/runs/1/attempts/2/jobs?per_page=100`,
    `${prefix}/actions/runs/1/artifacts?per_page=100`, `${prefix}/actions/artifacts/1`, `${prefix}/releases/1`,
    commitEndpoint.replace(repository, 'other/screener'), commitEndpoint.replace(repository, 'owner/screener-extra'),
    `${commitEndpoint}\n`, `${commitEndpoint}\r\n`, `${commitEndpoint}?x=1`, `${commitEndpoint}/`, `/${commitEndpoint}`, `https://api.github.com/${commitEndpoint}`,
    `${prefix}/git/trees/${treeSha}?recursive=1&x=1`, `${prefix}/git/trees/${treeSha}?recursive=true`,
    `${contentEndpoint}\n`, `${contentEndpoint}&x=1`, `${contentEndpoint}&ref=main`, `${contentEndpoint}#fragment`,
    `${prefix}/contents/a%20b?ref=${sha}`, `${prefix}/contents/x%2Fy?ref=${sha}`,
    `${prefix}/contents/../x?ref=${sha}`, `${prefix}/contents/a/./x?ref=${sha}`, `${prefix}/contents/a//x?ref=${sha}`,
    `${prefix}/contents/x?ref=${sha.toUpperCase()}`, `${prefix}/contents/x?ref=${sha}&`,
  ];
  for (const endpoint of endpoints) {
    const { api, calls } = reader(); api(endpoint); api(endpoint); assert.equal(calls.length, 2, endpoint);
  }
  for (const paginate of [true, 'false', 0, null]) {
    const { api, calls } = reader(); api(commitEndpoint, paginate); api(commitEndpoint, paginate);
    assert.equal(calls.length, 2); assert.equal(calls[0][1], paginate);
  }
});

test('wrong commit identities or malformed declared tree/parent SHAs fail without caching', () => {
  for (const mutate of [v => v.sha = parentSha, v => v.tree.sha = 'main', v => v.tree.sha = `${treeSha}\n`, v => v.parents[0].sha = [], v => v.parents = {}, v => v.sha = [sha]]) {
    const value = commit(); mutate(value); const { api, calls } = reader(value);
    assert.throws(() => api(commitEndpoint), /Invalid immutable/); assert.throws(() => api(commitEndpoint), /Invalid immutable/); assert.equal(calls.length, 2);
  }
});

test('tampered tree hashes, directories, paths and entry shapes fail closed', t => {
  const fixture = realGitTree(t);
  for (const mutate of [
    v => v.sha = parentSha, v => v.truncated = true, v => v.tree[0].sha = parentSha,
    v => v.tree.find(e => e.type === 'tree').sha = parentSha, v => v.tree.pop(),
    v => v.tree.push(v.tree[0]), v => v.tree[0].path = '../escape', v => v.tree[0].path = 'a/./bad',
    v => v.tree[0].path = 'a\0bad', v => v.tree[0].path = 'a\nfile', v => v.tree[0].path = 'a\\file', v => v.tree[0].path = 'C:/file', v => v.tree[0].path = 'a//bad', v => v.tree[0].mode = '100664',
    v => v.tree[0].sha = [sha], v => v.tree[0].type = 'other',
    v => v.tree.push({ path: 'a.c/child', mode: '100644', type: 'blob', sha }),
  ]) {
    const value = structuredClone(fixture.recursive); mutate(value); const { api, calls } = reader(value);
    assert.throws(() => api(fixture.endpoint), /Invalid immutable/); assert.throws(() => api(fixture.endpoint), /Invalid immutable/); assert.equal(calls.length, 2);
  }
});

test('contents bind exact path, decoded size and Git blob hash', () => {
  for (const mutate of [v => v.path = 'contracts/other.json', v => v.sha = parentSha, v => v.content = Buffer.from('altered').toString('base64'), v => v.size++, v => v.size = '12', v => v.content += '?', v => v.sha = [sha]]) {
    const value = content(); mutate(value); const { api, calls } = reader(value);
    assert.throws(() => api(contentEndpoint), /Invalid immutable/); assert.throws(() => api(contentEndpoint), /Invalid immutable/); assert.equal(calls.length, 2);
  }
  const value = content(); value.content = value.content.match(/.{1,4}/g).join('\n') + '\n';
  const { api, calls } = reader(value); api(contentEndpoint); api(contentEndpoint); assert.equal(calls.length, 1);
});

test('older mock responses missing required identity fields pass through uncached', t => {
  const fixture = realGitTree(t);
  const examples = [[commitEndpoint, commit(), ['sha', 'tree', 'parents']], [contentEndpoint, content(), ['path', 'sha', 'size', 'content', 'encoding', 'type']], [fixture.endpoint, fixture.flat, ['sha', 'truncated', 'tree']]];
  for (const [endpoint, full, keys] of examples) for (const key of keys) {
    const value = structuredClone(full); delete value[key]; const { api, calls } = reader(value);
    assert.deepEqual(api(endpoint), value); assert.deepEqual(api(endpoint), value); assert.equal(calls.length, 2, key);
  }
  const tree = structuredClone(fixture.flat); delete tree.tree[0].mode;
  const { api, calls } = reader(tree); api(fixture.endpoint); api(fixture.endpoint); assert.equal(calls.length, 2);
});

test('failed reads are never retained and a later successful retry can be reused', () => {
  let calls = 0;
  const api = createImmutableGitApi(() => { if (++calls === 1) throw Error('API unavailable'); return commit(); }, repository);
  assert.throws(() => api(commitEndpoint), /unavailable/); api(commitEndpoint); api(commitEndpoint); assert.equal(calls, 2);
});

test('entry and aggregate byte bounds pass overflow through without evicting stored responses', () => {
  const secondEndpoint = `${prefix}/git/commits/${parentSha}`;
  const bytes = Buffer.byteLength(JSON.stringify(commit()));
  for (const limits of [{ maxEntries: 1 }, { maxBytes: bytes }, { maxEntries: 0 }, { maxBytes: bytes - 1 }]) {
    const calls = [];
    const api = createImmutableGitApi(endpoint => { calls.push(endpoint); return { ...commit(), sha: endpoint.split('/').at(-1) }; }, repository, limits);
    api(commitEndpoint); api(secondEndpoint); api(secondEndpoint); api(commitEndpoint);
    assert.equal(calls.filter(e => e === secondEndpoint).length, 2);
    assert.equal(calls.filter(e => e === commitEndpoint).length, limits.maxEntries === 0 || limits.maxBytes === bytes - 1 ? 2 : 1);
  }
});

test('disposal clears retained values and permanently restores fresh reads', () => {
  const { api, calls } = reader(); api(commitEndpoint); api(commitEndpoint); assert.equal(calls.length, 1);
  api.dispose(); api(commitEndpoint); api(commitEndpoint); assert.equal(calls.length, 3);
});

test('factory requires a single exact repository and bounded configuration', () => {
  for (const repo of ['', '*', 'owner/*', 'owner/repo/x', 'owner/repo\n', '../repo', 'owner/..', 'https://github.com/owner/repo']) assert.throws(() => createImmutableGitApi(() => {}, repo), /exact GitHub repository/);
  for (const limits of [{ maxEntries: -1 }, { maxBytes: Infinity }, { maxEntries: 1.5 }]) assert.throws(() => reader(commit(), limits), /bounds/);
});

test('production wrapper shares only one awaited invocation, including failure, nesting and late async work', t => {
  const root = temporary(t), bin = join(root, 'bin'), trace = join(root, 'trace.jsonl'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst fs=require('node:fs');const endpoint=process.argv.at(-1);fs.appendFileSync(${JSON.stringify(trace)},endpoint+'\\n');console.log(JSON.stringify(${JSON.stringify(commit())}));\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const gate = fileURLToPath(new URL('./publication-gate.mjs', import.meta.url));
  const program = `import assert from 'node:assert/strict';
import {githubApi,withInvocationImmutableGitApi as scope} from ${JSON.stringify(gate)};
const repository=${JSON.stringify(repository)}, endpoint=${JSON.stringify(commitEndpoint)};
githubApi(endpoint);githubApi(endpoint);
assert.equal(scope(repository,()=>{githubApi(endpoint);githubApi(endpoint);return 9;}),9);
assert.throws(()=>scope(repository,()=>{githubApi(endpoint);githubApi(endpoint);throw Error('synchronous failure');}),/synchronous failure/);
assert.equal(await scope(repository,async()=>{githubApi(endpoint);await Promise.resolve();githubApi(endpoint);return 7;}),7);
githubApi(endpoint);
await assert.rejects(scope(repository,async()=>{githubApi(endpoint);githubApi(endpoint);throw Error('failed');}),/failed/);
await scope(repository,async()=>{githubApi(endpoint);githubApi(endpoint);});
await scope(repository,async()=>{githubApi(endpoint);await scope(repository,async()=>{githubApi(endpoint);githubApi(endpoint);});githubApi(endpoint);});
let late;
await scope(repository,async()=>{githubApi(endpoint);late=new Promise(resolve=>setTimeout(()=>{githubApi(endpoint);githubApi(endpoint);resolve();},10));});
await late;
await Promise.all([scope(repository,async()=>{githubApi(endpoint);await new Promise(resolve=>setTimeout(resolve,5));githubApi(endpoint);}),scope(repository,async()=>{githubApi(endpoint);await Promise.resolve();githubApi(endpoint);})]);
await scope(repository,async()=>{githubApi('repos/owner/screener/git/ref/heads/main');githubApi('repos/owner/screener/git/ref/heads/main');});
`;
  execFileSync(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  const calls = readFileSync(trace, 'utf8').trim().split('\n');
  assert.equal(calls.filter(endpoint => endpoint === commitEndpoint).length, 15);
  assert.equal(calls.filter(endpoint => endpoint.endsWith('/git/ref/heads/main')).length, 2);
});
