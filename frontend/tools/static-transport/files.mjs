import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { EXTERNAL_BOOTSTRAPS, invariant, PREFIX, validPath } from '../../src/static/transport/format.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const separate = (a, b) => a !== b && !a.startsWith(`${b}${sep}`) && !b.startsWith(`${a}${sep}`);
// Resolve missing destination parents without creating anything. A symlink in
// an existing ancestor must not make a rejected destination mutate an input.
export async function prospectiveRealpath(path) {
  let parent = resolve(path); const suffix = [];
  for (;;) {
    try { return join(await realpath(parent), ...suffix.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(parent); invariant(next !== parent, 'Cannot resolve destination ancestor');
      suffix.push(basename(parent)); parent = next;
    }
  }
}
export const sameStat = (a, b) => b.isFile() && !b.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export async function absent(path) {
  try { await lstat(path); throw new Error(`Output already exists: ${path}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function list(root, { source = false, signal } = {}) {
  const paths = [], stat = await lstat(root);
  invariant(stat.isDirectory() && !stat.isSymbolicLink(), 'Input must be a real directory');
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const file = join(directory, item.name), path = relative(root, file).split(sep).join('/');
      invariant(validPath(path) && !item.isSymbolicLink(), `Invalid path or symlink: ${path}`);
      invariant(!source || !(path === PREFIX.slice(0, -1) || path.startsWith(PREFIX)), `Reserved source path: ${path}`);
      if (item.isDirectory()) await visit(file);
      else { invariant(item.isFile(), `Non-file input: ${path}`); if (!EXTERNAL_BOOTSTRAPS.includes(path)) paths.push(path); }
    }
  }
  await visit(root); return paths.sort();
}
export function meter(cap) {
  const hash = createHash('sha256'); let bytes = 0;
  return { stream: new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > cap) return callback(new Error('Asset exceeds transport cap'));
    hash.update(chunk); callback(null, chunk);
  } }), result: () => ({ bytes, sha256: hash.digest('hex') }) };
}
export async function fileDigest(path, { cap = Number.MAX_SAFE_INTEGER, signal } = {}) {
  const stat = await lstat(path); invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, `Invalid file size or type: ${path}`);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path, { signal })) { bytes += chunk.length; invariant(bytes <= cap, 'File byte cap exceeded'); hash.update(chunk); }
  invariant(sameStat(stat, await lstat(path)) && stat.size === bytes, `Input changed while reading: ${path}`);
  return { bytes, sha256: hash.digest('hex') };
}
export function inventoryObject(entries) { return Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)); }
