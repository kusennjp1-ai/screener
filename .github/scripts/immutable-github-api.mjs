import { createHash } from 'node:crypto';

const isSha = value => typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/.test(value);
const modes = new Map([['100644', 'blob'], ['100755', 'blob'], ['120000', 'blob'], ['040000', 'tree'], ['160000', 'commit']]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => object(value) && Object.hasOwn(value, key);
const gitHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const invalid = reason => { throw Error(`Invalid immutable GitHub response: ${reason}`); };
const validPath = path => typeof path === 'string' && path.length > 0 && !/^[A-Za-z]:/.test(path) && !/[\\\u0000-\u001f\u007f-\u009f]/.test(path)
  && Buffer.from(path).toString('utf8') === path && path.split('/').every(part => part && part !== '.' && part !== '..');

function identity(value, expected, label) {
  if (value !== undefined && (!isSha(value) || value !== expected)) invalid(`${label} SHA mismatch`);
  return value !== undefined;
}

function immutableRequest(endpoint, paginate, repository) {
  if (paginate !== false || typeof endpoint !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(endpoint)) return null;
  const prefix = `repos/${repository}/`;
  if (!endpoint.startsWith(prefix)) return null;
  const route = endpoint.slice(prefix.length);
  let match = /^git\/commits\/([a-f0-9]{40})$/.exec(route);
  if (match) return { type: 'commit', sha: match[1] };
  match = /^git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(route);
  if (match) return { type: 'tree', sha: match[1] };
  // Only literal, unambiguous paths. Encoded paths and additional query aliases
  // remain ordinary fresh reads, as do mutable references and paginated calls.
  match = /^contents\/([A-Za-z0-9._ /-]+)\?ref=([a-f0-9]{40})$/.exec(route);
  if (match && validPath(match[1])) return { type: 'content', path: match[1], sha: match[2] };
  return null;
}

function validCommit(value, request) {
  if (!object(value)) return false;
  const identified = identity(value.sha, request.sha, 'commit');
  if (has(value, 'tree') && (!object(value.tree) || (has(value.tree, 'sha') && !isSha(value.tree.sha)))) invalid('commit tree SHA');
  if (has(value, 'parents') && (!Array.isArray(value.parents) || value.parents.some(parent => !object(parent) || !isSha(parent.sha)))) invalid('commit parents');
  // The API JSON does not preserve the original raw commit serialization. This
  // is the existing GitHub commit identity/shape contract, not a reconstructed
  // commit hash. Callers still verify reviewed trees and expected parent SHAs.
  return identified && isSha(value.tree?.sha) && Array.isArray(value.parents);
}

function validTree(value, request) {
  if (!object(value)) return false;
  const identified = identity(value.sha, request.sha, 'tree');
  if (!identified || !has(value, 'truncated') || !has(value, 'tree')) return false;
  if (value.truncated !== false || !Array.isArray(value.tree) || value.tree.length > 100000) invalid('incomplete recursive tree');
  const root = { children: new Map(), mode: '040000', sha: request.sha };
  const directories = [root], paths = new Set();
  for (const entry of value.tree) {
    if (!object(entry) || !validPath(entry.path) || paths.has(entry.path)) invalid('duplicate or unsafe tree path');
    paths.add(entry.path);
    if (!has(entry, 'mode') || !has(entry, 'type') || !has(entry, 'sha')) return false;
    if (modes.get(entry.mode) !== entry.type || !isSha(entry.sha)) invalid('tree entry mode, type or SHA');
    const parts = entry.path.split('/');
    let parent = root;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index], leaf = index === parts.length - 1;
      let node = parent.children.get(name);
      if (!node) {
        node = { name, mode: leaf ? entry.mode : '040000', children: new Map() };
        parent.children.set(name, node);
        if (node.mode === '040000') directories.push(node);
      }
      if (leaf) {
        if (node.mode !== entry.mode) invalid('tree file/directory collision');
        node.sha = entry.sha;
      } else if (node.mode !== '040000') invalid('tree file/directory collision');
      parent = node;
    }
  }
  // Git sorts directory names as if followed by '/', using UTF-8 bytes. Infer
  // omitted directories for flat Git fixtures; verify every declared directory
  // hash when the API includes them. Missing subtree entries cannot match.
  for (const directory of directories.reverse()) {
    const entries = [...directory.children.values()].map(entry => ({ ...entry,
      order: Buffer.from(entry.name + (entry.mode === '040000' ? '/' : '')),
    })).sort((a, b) => Buffer.compare(a.order, b.order));
    const bytes = Buffer.concat(entries.flatMap(entry => [
      Buffer.from(`${entry.mode === '040000' ? '40000' : entry.mode} ${entry.name}\0`),
      Buffer.from(entry.sha, 'hex'),
    ]));
    const sha = gitHash('tree', bytes);
    if (directory.sha !== undefined && directory.sha !== sha) invalid('recursive tree hash mismatch');
    directory.sha = sha;
  }
  return true;
}

function validContent(value, request) {
  if (!object(value)) return false;
  if (has(value, 'path') && value.path !== request.path) invalid('contents path mismatch');
  if (has(value, 'sha') && !isSha(value.sha)) invalid('contents blob SHA');
  if (value.type !== 'file' || value.encoding !== 'base64' || typeof value.content !== 'string') return false;
  const encoded = value.content.replace(/\r?\n/g, ''), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) invalid('contents base64');
  if (has(value, 'size') && (!Number.isSafeInteger(value.size) || value.size !== bytes.length)) invalid('contents size mismatch');
  if (has(value, 'sha') && value.sha !== gitHash('blob', bytes)) invalid('contents blob hash mismatch');
  return has(value, 'path') && has(value, 'sha') && has(value, 'size');
}

const validators = { commit: validCommit, tree: validTree, content: validContent };

// This reader does not grant authority or replace any source/control validator.
// Only successful, validated GET responses for this exact repository can be
// reused, and callers receive independent JSON objects even on the first read.
export function createImmutableGitApi(directApi, repository, { maxEntries = 128, maxBytes = 32 * 1024 * 1024 } = {}) {
  if (typeof directApi !== 'function' || typeof repository !== 'string'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || /[\r\n]/.test(repository)
    || repository.split('/').some(part => part === '.' || part === '..')) throw Error('An exact GitHub repository and direct API are required');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error('Invalid immutable GitHub cache bounds');
  const cache = new Map();
  let totalBytes = 0, disposed = false;
  const api = (endpoint, paginate = false) => {
    const request = disposed ? null : immutableRequest(endpoint, paginate, repository);
    if (!request) return directApi(endpoint, paginate);
    if (cache.has(endpoint)) return JSON.parse(cache.get(endpoint));
    const value = directApi(endpoint, paginate);
    if (!validators[request.type](value, request)) return value;
    const serialized = JSON.stringify(value), bytes = Buffer.byteLength(serialized);
    if (cache.size < maxEntries && totalBytes + bytes <= maxBytes) {
      cache.set(endpoint, serialized);
      totalBytes += bytes;
      return JSON.parse(serialized);
    }
    return value;
  };
  api.dispose = () => { cache.clear(); totalBytes = 0; disposed = true; };
  return api;
}
