import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LIMITS, FORMAT, MANIFEST_PATH, RECEIPT_PATH, MAX_SITE_BYTES, canonicalBytes, generationBytes, invariant, isPackedData, validPath, validateManifest } from './format.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function inventory(root) {
  const files = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name), logical = relative(root, path).split(sep).join('/');
      invariant(validPath(logical) && !logical.startsWith('_lossless/'), `Invalid or reserved source path: ${logical}`);
      invariant(!item.isSymbolicLink(), `Source symlink: ${logical}`);
      if (item.isDirectory()) await visit(path);
      else { invariant(item.isFile(), `Unsupported source type: ${logical}`); files.push(logical); }
    }
  }
  invariant((await lstat(root)).isDirectory() && !(await lstat(root)).isSymbolicLink(), 'Source must be a real directory');
  await visit(root); return files.sort();
}
function meter(cap) {
  const hash = createHash('sha256'); let bytes = 0;
  return { stream: new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; if (bytes > cap) return callback(new Error("Asset exceeds decoder cap")); hash.update(chunk); callback(null, chunk); } }), result: () => ({ bytes, sha256: hash.digest('hex') }) };
}
function separate(a, b) { return a !== b && !a.startsWith(`${b}${sep}`) && !b.startsWith(`${a}${sep}`); }
export async function pack({ source, output, signal, maxSiteBytes = MAX_SITE_BYTES, onProgress = () => {} }) {
  source = resolve(source); output = resolve(output);
  invariant(separate(source, output), 'Source and output must be separate directory trees');
  invariant(Number.isSafeInteger(maxSiteBytes) && maxSiteBytes > 0 && maxSiteBytes <= MAX_SITE_BYTES, 'Invalid site byte limit');
  try { await lstat(output); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const paths = await inventory(source);
  invariant(paths.length > 0 && paths.some(isPackedData), 'Source has no data files');
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), '.lossless-stage-'));
  try {
    await mkdir(join(staging, '_lossless/gzip'), { recursive: true });
    const files = [], assets = new Map(), snapshots = new Map(); let dataBytes = 0, identityBytes = 0, dataFiles = 0;
    for (const [index, path] of paths.entries()) {
      signal?.throwIfAborted();
      const original = join(source, path), before = await lstat(original);
      invariant(before.isFile() && !before.isSymbolicLink(), `Source type changed: ${path}`);
      const raw = meter(DEFAULT_LIMITS.decodedBytes), encoded = meter(DEFAULT_LIMITS.encodedBytes), kind = isPackedData(path) ? 'gzip' : 'identity';
      const temporary = kind === 'gzip' ? join(staging, '_lossless/current.tmp') : join(staging, path);
      await mkdir(dirname(temporary), { recursive: true });
      const stages = [createReadStream(original), raw.stream];
      if (kind === 'gzip') stages.push(createGzip({ level: 6, strategy: constants.Z_DEFAULT_STRATEGY, mtime: 0 }));
      await pipeline(...stages, encoded.stream, createWriteStream(temporary, { flags: 'wx' }), { signal });
      const decodedResult = raw.result(), encodedResult = encoded.result(), after = await lstat(original);
      invariant(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && decodedResult.bytes === before.size, `Source changed while packing: ${path}`);
      snapshots.set(path, after);
      const assetPath = kind === 'gzip' ? `_lossless/gzip/${encodedResult.sha256}.json.gz` : path;
      const entry = { path, kind, assetPath, encodedBytes: encodedResult.bytes, encodedSha256: encodedResult.sha256, decodedBytes: decodedResult.bytes, decodedSha256: decodedResult.sha256 };
      if (kind === 'gzip') {
        if (assets.has(assetPath)) {
          invariant(JSON.stringify(assets.get(assetPath)) === JSON.stringify([entry.encodedBytes, entry.decodedBytes, entry.decodedSha256]), 'Content address conflict');
          await rm(temporary);
        } else { await rename(temporary, join(staging, assetPath)); assets.set(assetPath, [entry.encodedBytes, entry.decodedBytes, entry.decodedSha256]); }
        dataBytes += entry.decodedBytes; dataFiles++;
      } else identityBytes += entry.decodedBytes;
      files.push(entry);
      if ((index + 1) % 1000 === 0) onProgress({ processed: index + 1, total: paths.length });
    }
    invariant(JSON.stringify(await inventory(source)) === JSON.stringify(paths), 'Source inventory changed while packing');
    for (const [path, before] of snapshots) {
      signal?.throwIfAborted();
      const after = await lstat(join(source, path));
      invariant(after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, `Source changed before completion: ${path}`);
    }
    const manifest = { format: FORMAT, generation: sha256(generationBytes(files)), files };
    validateManifest(manifest);
    const manifestBytes = canonicalBytes(manifest);
    invariant(manifestBytes.length <= DEFAULT_LIMITS.manifestBytes, 'Manifest exceeds decoder cap');
    await writeFile(join(staging, MANIFEST_PATH), manifestBytes, { flag: 'wx' });
    const assetBytes = [...assets.values()].reduce((sum, value) => sum + value[0], 0);
    const receipt = { format: FORMAT, generation: manifest.generation, manifestPath: MANIFEST_PATH, manifestBytes: manifestBytes.length, manifestSha256: sha256(manifestBytes), sourceFiles: paths.length, dataFiles, identityFiles: paths.length - dataFiles, originalBytes: dataBytes + identityBytes, dataOriginalBytes: dataBytes, compressedAssetBytes: assetBytes, identityBytes, uniqueCompressedAssets: assets.size, physicalFiles: assets.size + paths.length - dataFiles + 2, outputBytes: 0, siteLimitBytes: maxSiteBytes, gzipLevel: 6, node: process.versions.node, zlib: process.versions.zlib };
    let encodedReceipt;
    for (;;) { encodedReceipt = canonicalBytes(receipt); const total = assetBytes + identityBytes + manifestBytes.length + encodedReceipt.length; if (total === receipt.outputBytes) break; receipt.outputBytes = total; }
    invariant(receipt.outputBytes < maxSiteBytes, `Packed site exceeds strict byte budget: ${receipt.outputBytes}`);
    await writeFile(join(staging, RECEIPT_PATH), encodedReceipt, { flag: 'wx' });
    signal?.throwIfAborted();
    try { await lstat(output); throw new Error('Output appeared while packing'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, output);
    return receipt;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output] = process.argv.slice(2);
  invariant(source && output && process.argv.length === 4, 'Usage: node pack.mjs SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY');
  const controller = new AbortController(); process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  console.log(JSON.stringify(await pack({ source, output, signal: controller.signal, onProgress: value => console.error(JSON.stringify(value)) }), null, 2));
}
