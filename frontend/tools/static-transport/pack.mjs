import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { canonicalBytes, DEFAULT_LIMITS, FORMAT, generationBody, invariant, isPackedData, MAX_SITE_BYTES, PREFIX, validateBindings, validateEntry, validateExpectedRoot, validateRoot } from '../../src/static/transport/format.mjs';
import { absent, inventoryObject, list, meter, prospectiveRealpath, sameStat, separate, sha256 } from './files.mjs';

/** Atomically create a new physical site. The original tree is read-only.
 * publication.json is separately sealed by release tooling and is not copied.
 */
export async function pack({ source, output, bindings, signal, maxSiteBytes = MAX_SITE_BYTES, onProgress = () => {} }) {
  validateBindings(bindings); bindings = JSON.parse(JSON.stringify(bindings));
  signal?.throwIfAborted();
  source = resolve(source); output = resolve(output);
  invariant(separate(source, output), 'Source and output must be separate directory trees');
  invariant(Number.isSafeInteger(maxSiteBytes) && maxSiteBytes > 0 && maxSiteBytes <= MAX_SITE_BYTES, 'Invalid site byte limit');
  await absent(output);
  const paths = await list(source, { source: true, signal });
  invariant(paths.length > 0 && paths.some(isPackedData), 'Source has no compressible data');
  invariant(separate(await realpath(source), await prospectiveRealpath(output)), 'Source and output resolve to overlapping trees');
  await mkdir(dirname(output), { recursive: true });
  invariant(separate(await realpath(source), join(await realpath(dirname(output)), output.slice(dirname(output).length + 1))), 'Source and output resolve to overlapping trees');
  const staging = await mkdtemp(join(dirname(output), '.static-transport-pack-'));
  try {
    await mkdir(join(staging, PREFIX, 'gzip'), { recursive: true });
    const files = [], snapshots = new Map(), payload = new Map(), logical = new Map();
    let compressedFiles = 0, logicalBytes = 0;
    for (const [index, path] of paths.entries()) {
      signal?.throwIfAborted();
      const original = join(source, path), before = await lstat(original);
      invariant(before.isFile() && !before.isSymbolicLink(), `Source type changed: ${path}`);
      const kind = isPackedData(path) ? 'gzip' : 'identity';
      const raw = meter(DEFAULT_LIMITS.decodedBytes), encoded = meter(DEFAULT_LIMITS.encodedBytes);
      const temporary = kind === 'gzip' ? join(staging, PREFIX, 'current.tmp') : join(staging, path);
      await mkdir(dirname(temporary), { recursive: true });
      const stages = [createReadStream(original), raw.stream];
      if (kind === 'gzip') stages.push(createGzip({ level: 6, strategy: constants.Z_DEFAULT_STRATEGY }));
      await pipeline(...stages, encoded.stream, createWriteStream(temporary, { flags: 'wx' }), { signal });
      const decodedResult = raw.result(), encodedResult = encoded.result(), after = await lstat(original);
      invariant(sameStat(before, after) && decodedResult.bytes === before.size, `Source changed while packing: ${path}`);
      snapshots.set(path, after);
      const assetPath = kind === 'gzip' ? `${PREFIX}gzip/${encodedResult.sha256}.bin` : path;
      const entry = { path, kind, assetPath, encodedBytes: encodedResult.bytes, encodedSha256: encodedResult.sha256, decodedBytes: decodedResult.bytes, decodedSha256: decodedResult.sha256 };
      validateEntry(entry);
      if (kind === 'gzip') {
        compressedFiles++;
        if (payload.has(assetPath)) {
          invariant(payload.get(assetPath).bytes === encodedResult.bytes, 'Content address collision');
          await rm(temporary);
        } else await rename(temporary, join(staging, assetPath));
      }
      files.push(entry); logical.set(path, decodedResult); payload.set(assetPath, encodedResult); logicalBytes += decodedResult.bytes;
      if ((index + 1) % 1000 === 0) onProgress({ processed: index + 1, total: paths.length });
    }
    invariant(logical.get('static-data/manifest.json')?.sha256 === bindings.manifestSha256, 'Manifest binding does not match source bytes');
    const logicalInventory = inventoryObject(logical), payloadInventory = inventoryObject(payload), metadata = new Map();
    async function metadataFile(family, value, cap) {
      const bytes = canonicalBytes(value), digest = sha256(bytes);
      invariant(bytes.length <= cap, `${family} metadata cap exceeded`);
      const path = `${PREFIX}${family}-${digest}.json`, descriptor = { path, bytes: bytes.length, sha256: digest };
      await writeFile(join(staging, path), bytes, { flag: 'wx' }); metadata.set(path, { bytes: bytes.length, sha256: digest });
      return descriptor;
    }
    const buckets = Array.from({ length: 256 }, () => []);
    for (const entry of files) buckets[parseInt(sha256(Buffer.from(entry.path)).slice(0, 2), 16)].push(entry);
    const shards = [];
    for (const [index, entries] of buckets.entries()) {
      signal?.throwIfAborted();
      const id = index.toString(16).padStart(2, '0');
      shards.push({ id, ...await metadataFile('shard', { format: FORMAT, id, files: entries }, DEFAULT_LIMITS.shardBytes) });
    }
    const body = { format: FORMAT, bindings,
      logicalInventory: await metadataFile('logical', { format: FORMAT, files: logicalInventory }, DEFAULT_LIMITS.inventoryBytes),
      physicalInventory: await metadataFile('physical', { format: FORMAT, files: payloadInventory }, DEFAULT_LIMITS.inventoryBytes), shards };
    const root = { format: FORMAT, generation: sha256(canonicalBytes(body)), bindings, logicalInventory: body.logicalInventory, physicalInventory: body.physicalInventory, shards };
    invariant(sha256(canonicalBytes(generationBody(root))) === root.generation, 'Internal generation mismatch');
    const expectedRoot = { ...await metadataFile('root', root, DEFAULT_LIMITS.rootBytes), generation: root.generation, bindings };
    validateExpectedRoot(expectedRoot); validateRoot(root, expectedRoot);
    const physicalInventory = inventoryObject([...payload, ...metadata]);
    const physicalBytes = Object.values(physicalInventory).reduce((sum, entry) => sum + entry.bytes, 0);
    invariant(physicalBytes < maxSiteBytes, `Packed site exceeds strict byte budget: ${physicalBytes}`);
    invariant(JSON.stringify(await list(source, { source: true, signal })) === JSON.stringify(paths), 'Source inventory changed while packing');
    for (const [path, before] of snapshots) {
      signal?.throwIfAborted(); invariant(sameStat(before, await lstat(join(source, path))), `Source changed before completion: ${path}`);
    }
    await absent(output); signal?.throwIfAborted(); await rename(staging, output);
    return { expectedRoot, logicalInventory, physicalInventory, logicalFiles: paths.length, logicalBytes, physicalFiles: Object.keys(physicalInventory).length, physicalBytes, compressedFiles, uniqueCompressedAssets: [...payload.keys()].filter(path => path.startsWith(`${PREFIX}gzip/`)).length };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output, bindingsFile] = process.argv.slice(2);
  invariant(source && output && bindingsFile && process.argv.length === 5, 'Usage: node pack.mjs SOURCE NEW_OUTPUT BINDINGS_JSON');
  const controller = new AbortController(); process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  console.log(JSON.stringify(await pack({ source, output, bindings: JSON.parse(await readFile(bindingsFile, 'utf8')), signal: controller.signal, onProgress: value => console.error(JSON.stringify(value)) })));
}
