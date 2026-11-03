// Report where a built site's bytes go, before the strict Pages budget is applied.
// Files the transport packs are measured as gzip (level 6, as pack.mjs does);
// every other file counts at its raw size, as GitHub Pages stores it.
// Usage: node tools/site-size-breakdown.mjs DIST [TOP]
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, constants } from 'node:zlib';
import { isPackedData, MAX_SITE_BYTES } from '../src/static/transport/format.mjs';

// Group by directory, keeping enough depth to tell data families apart.
export function groupOf(path) {
  const parts = path.split('/');
  const dirs = parts.slice(0, -1);
  if (dirs.length === 0) return path;
  return `${dirs.slice(0, dirs[0] === 'static-data' ? 3 : 2).join('/')}/`;
}

async function* walk(root, dir = root) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(root, path);
    else if (entry.isFile()) yield relative(root, path).split(sep).join('/');
  }
}

export async function breakdown(root) {
  const groups = new Map();
  let total = 0, files = 0;
  for await (const path of walk(root)) {
    const packed = isPackedData(path);
    const bytes = packed
      ? gzipSync(await readFile(join(root, path)), { level: 6, strategy: constants.Z_DEFAULT_STRATEGY }).length
      : (await stat(join(root, path))).size;
    const key = groupOf(path);
    const group = groups.get(key) || { group: key, files: 0, bytes: 0, packed };
    group.files += 1; group.bytes += bytes; groups.set(key, group);
    total += bytes; files += 1;
  }
  return { total, files, groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, top = '30'] = process.argv.slice(2);
  if (!root) throw new Error('Usage: node tools/site-size-breakdown.mjs DIST [TOP]');
  const result = await breakdown(resolve(root));
  const mb = value => (value / 1e6).toFixed(1).padStart(8);
  console.log(`Site size estimate: ${mb(result.total)} MB in ${result.files} files (budget ${MAX_SITE_BYTES / 1e6} MB; packed files as gzip, others raw)`);
  for (const group of result.groups.slice(0, Number(top))) {
    console.log(`${mb(group.bytes)} MB ${String(group.files).padStart(6)} files ${group.packed ? 'gzip' : 'raw '} ${group.group}`);
  }
}
