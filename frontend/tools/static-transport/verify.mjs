// Independent streaming recovery path: Node raw inflate, consumed byte count,
// CRC32, and direct source comparison. It never uses the browser decoder.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { canonicalBytes, DEFAULT_LIMITS, EXTERNAL_BOOTSTRAPS, FORMAT, generationBody, invariant, keysAre, MAX_SITE_BYTES, parseCanonical, PREFIX, validateExpectedRoot, validateRoot, validateShard, validHash, validPath } from '../../src/static/transport/format.mjs';
import { absent, inventoryObject, list, prospectiveRealpath, sameStat, separate, sha256 } from './files.mjs';

function validateInventory(value, logical) {
  invariant(keysAre(value, ['format', 'files']) && value.format === FORMAT && value.files && typeof value.files === 'object' && !Array.isArray(value.files), 'Invalid transport inventory');
  let previous = '';
  for (const [path, entry] of Object.entries(value.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    invariant(validPath(path) && path > previous && !EXTERNAL_BOOTSTRAPS.includes(path) && (!logical || !path.startsWith(PREFIX)), 'Invalid or unsorted inventory path'); previous = path;
    invariant(keysAre(entry, ['bytes', 'sha256']) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= DEFAULT_LIMITS.decodedBytes && validHash(entry.sha256), 'Invalid inventory entry');
  }
  return value.files;
}

function singleGzipFraming() {
  let pending = Buffer.alloc(0), headerSeen = false, trailer;
  const stream = new Transform({ transform(chunk, encoding, callback) {
    try {
      pending = Buffer.concat([pending, chunk]);
      if (!headerSeen && pending.length >= 10) {
        invariant(pending.subarray(0, 9).equals(Buffer.from('1f8b08000000000000', 'hex')), 'Noncanonical gzip framing');
        pending = pending.subarray(10); headerSeen = true;
      }
      if (headerSeen && pending.length > 8) { this.push(pending.subarray(0, -8)); pending = pending.subarray(-8); }
      callback();
    } catch (error) { callback(error); }
  }, flush(callback) {
    try { invariant(headerSeen && pending.length === 8, 'Truncated gzip framing'); trailer = Buffer.from(pending); callback(); } catch (error) { callback(error); }
  } });
  return { stream, validate: (inflater, encodedBytes, decodedBytes, crc) => {
    invariant(inflater.bytesWritten === encodedBytes - 18, 'Trailing bytes or multiple gzip members');
    invariant(trailer?.readUInt32LE(0) === crc && trailer?.readUInt32LE(4) === decodedBytes, 'Gzip CRC32 or size mismatch');
  } };
}

async function verifyInto({ packed, expectedRoot, source, restore, signal, onProgress = () => {} }) {
  validateExpectedRoot(expectedRoot); expectedRoot = JSON.parse(JSON.stringify(expectedRoot));
  packed = resolve(packed); if (source) source = resolve(source);
  signal?.throwIfAborted();
  const paths = await list(packed, { signal }), metadata = new Map(), snapshots = new Map();
  async function readMetadata(descriptor, cap) {
    signal?.throwIfAborted();
    invariant(descriptor.bytes <= cap, 'Metadata cap exceeded');
    const file = join(packed, descriptor.path), before = await lstat(file);
    invariant(before.isFile() && !before.isSymbolicLink() && before.size === descriptor.bytes, 'Metadata size or type mismatch');
    const bytes = await readFile(file, { signal });
    invariant(bytes.length === descriptor.bytes && sha256(bytes) === descriptor.sha256 && sameStat(before, await lstat(file)), 'Metadata integrity mismatch');
    snapshots.set(descriptor.path, before); metadata.set(descriptor.path, { bytes: descriptor.bytes, sha256: descriptor.sha256 });
    return parseCanonical(bytes);
  }
  const root = validateRoot(await readMetadata(expectedRoot, DEFAULT_LIMITS.rootBytes), expectedRoot);
  invariant(sha256(canonicalBytes(generationBody(root))) === expectedRoot.generation, 'Transport generation digest mismatch');
  const logicalInventory = validateInventory(await readMetadata(root.logicalInventory, DEFAULT_LIMITS.inventoryBytes), true);
  const payloadInventory = validateInventory(await readMetadata(root.physicalInventory, DEFAULT_LIMITS.inventoryBytes), false);
  const entries = new Map(), actualLogical = new Map(), actualPayload = new Map();
  for (const descriptor of root.shards) {
    const shard = await validateShard(await readMetadata(descriptor, DEFAULT_LIMITS.shardBytes), descriptor.id, DEFAULT_LIMITS, () => signal?.throwIfAborted());
    for (const [path, entry] of shard) {
      invariant(!entries.has(path), 'Duplicate logical path across shards'); entries.set(path, entry);
      actualLogical.set(path, { bytes: entry.decodedBytes, sha256: entry.decodedSha256 });
      const item = { bytes: entry.encodedBytes, sha256: entry.encodedSha256 };
      invariant(!actualPayload.has(entry.assetPath) || JSON.stringify(actualPayload.get(entry.assetPath)) === JSON.stringify(item), 'Conflicting physical inventory');
      actualPayload.set(entry.assetPath, item);
    }
  }
  invariant(JSON.stringify(inventoryObject(actualLogical)) === JSON.stringify(logicalInventory), 'Logical inventory does not match shards');
  invariant(JSON.stringify(inventoryObject(actualPayload)) === JSON.stringify(payloadInventory), 'Physical inventory does not match shards');
  invariant(logicalInventory['static-data/manifest.json']?.sha256 === root.bindings.manifestSha256, 'Manifest binding does not match inventory');
  const physicalInventory = inventoryObject([...actualPayload, ...metadata]);
  invariant(JSON.stringify(Object.keys(physicalInventory).sort()) === JSON.stringify(paths), 'Packed inventory mismatch: unknown or missing asset');
  let physicalBytes = 0;
  for (const [path, entry] of Object.entries(physicalInventory)) {
    const stat = await lstat(join(packed, path));
    invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size === entry.bytes, `Physical length mismatch: ${path}`);
    invariant(!snapshots.has(path) || sameStat(snapshots.get(path), stat), `Metadata changed during verification: ${path}`);
    if (!snapshots.has(path)) snapshots.set(path, stat);
    physicalBytes += stat.size;
  }
  invariant(physicalBytes < MAX_SITE_BYTES, 'Packed site exceeds strict byte budget');
  const expectedLogicalPaths = Object.keys(logicalInventory).sort();
  if (source) invariant(JSON.stringify(await list(source, { source: true, signal })) === JSON.stringify(expectedLogicalPaths), 'Source inventory mismatch');
  const sourceSnapshots = new Map(); let logicalBytes = 0, compressedFiles = 0, checked = 0;
  for (const path of expectedLogicalPaths) {
    signal?.throwIfAborted();
    const entry = entries.get(path), sourcePath = source && join(source, path);
    let sourceFile;
    if (sourcePath) {
      const before = await lstat(sourcePath);
      invariant(before.isFile() && !before.isSymbolicLink() && before.size === entry.decodedBytes, `Source size or type mismatch: ${path}`);
      sourceSnapshots.set(path, before); sourceFile = await open(sourcePath, 'r');
    }
    try {
      const encodedHash = createHash('sha256'), decodedHash = createHash('sha256'); let encodedBytes = 0, decodedBytes = 0, decodedCrc = 0;
      const encodedMeter = new Transform({ transform(chunk, encoding, callback) {
        encodedBytes += chunk.length;
        if (encodedBytes > entry.encodedBytes) return callback(new Error(`Encoded byte cap exceeded: ${path}`));
        encodedHash.update(chunk); callback(null, chunk);
      } });
      const decodedMeter = new Transform({ transform(chunk, encoding, callback) {
        const offset = decodedBytes; decodedBytes += chunk.length;
        if (decodedBytes > entry.decodedBytes) return callback(new Error(`Decoded byte cap exceeded: ${path}`));
        decodedHash.update(chunk); decodedCrc = crc32(chunk, decodedCrc);
        if (!sourceFile) { callback(null, chunk); return; }
        void (async () => {
          const original = Buffer.allocUnsafe(chunk.length); let read = 0;
          while (read < chunk.length) {
            const result = await sourceFile.read(original, read, chunk.length - read, offset + read);
            invariant(result.bytesRead > 0, 'Unexpected source EOF'); read += result.bytesRead;
          }
          invariant(original.equals(chunk), `Recovered byte mismatch: ${path} at ${offset}`);
        })().then(() => callback(null, chunk), callback);
      } });
      let sink = new Writable({ write(chunk, encoding, callback) { callback(); } });
      if (restore) { const target = join(restore, path); await mkdir(dirname(target), { recursive: true }); sink = createWriteStream(target, { flags: 'wx' }); }
      const stages = [createReadStream(join(packed, entry.assetPath)), encodedMeter];
      const framing = entry.kind === 'gzip' ? singleGzipFraming() : null, inflater = framing ? createInflateRaw() : null;
      if (framing) { stages.push(framing.stream, inflater); compressedFiles++; }
      await pipeline(...stages, decodedMeter, sink, { signal });
      framing?.validate(inflater, encodedBytes, decodedBytes, decodedCrc);
      invariant(encodedBytes === entry.encodedBytes && encodedHash.digest('hex') === entry.encodedSha256, `Encoded integrity mismatch: ${path}`);
      invariant(decodedBytes === entry.decodedBytes && decodedHash.digest('hex') === entry.decodedSha256, `Decoded integrity mismatch: ${path}`);
      logicalBytes += decodedBytes; checked++;
      if (checked % 1000 === 0) onProgress({ checked, total: expectedLogicalPaths.length });
    } finally { await sourceFile?.close(); }
  }
  invariant(JSON.stringify(await list(packed, { signal })) === JSON.stringify(paths), 'Packed inventory changed during verification');
  if (source) invariant(JSON.stringify(await list(source, { source: true, signal })) === JSON.stringify(expectedLogicalPaths), 'Source inventory changed during verification');
  for (const [directory, items] of [[packed, snapshots], [source, sourceSnapshots]]) for (const [path, before] of items) {
    signal?.throwIfAborted(); invariant(sameStat(before, await lstat(join(directory, path))), `Input changed before verification completed: ${path}`);
  }
  return { expectedRoot, logicalInventory, physicalInventory, logicalFiles: expectedLogicalPaths.length, logicalBytes, physicalFiles: paths.length, physicalBytes, compressedFiles, uniqueCompressedAssets: [...actualPayload.keys()].filter(path => path.startsWith(`${PREFIX}gzip/`)).length, ...(source ? { allOriginalBytesEqual: true } : {}) };
}

/** Verify every registered byte; optional restore atomically recreates the entire
 * canonical tree (including UI), excluding separately authored publication.json.
 */
export async function verify(options) {
  if (!options.restore) return verifyInto(options);
  const restore = resolve(options.restore);
  for (const root of [options.source, options.packed].filter(Boolean).map(path => resolve(path))) invariant(separate(restore, root), 'Restore directory must be separate');
  await absent(restore);
  const prospective = await prospectiveRealpath(restore);
  for (const root of [options.source, options.packed].filter(Boolean)) invariant(separate(prospective, await realpath(root)), 'Restore resolves to overlapping tree');
  await mkdir(dirname(restore), { recursive: true });
  const restoreReal = join(await realpath(dirname(restore)), restore.slice(dirname(restore).length + 1));
  for (const root of [options.source, options.packed].filter(Boolean)) invariant(separate(restoreReal, await realpath(root)), 'Restore resolves to overlapping tree');
  const staging = await mkdtemp(join(dirname(restore), '.static-transport-restore-'));
  try {
    const result = await verifyInto({ ...options, restore: staging });
    options.signal?.throwIfAborted(); await absent(restore); await rename(staging, restore);
    return { ...result, restoredTo: restore };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
export const unpack = options => verify(options);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [packed, expectedRootFile, restore, source] = process.argv.slice(2);
  invariant(packed && expectedRootFile && process.argv.length <= 6, 'Usage: node verify.mjs PACKED EXPECTED_ROOT_JSON [NEW_RESTORE] [SOURCE]');
  const controller = new AbortController(); process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  console.log(JSON.stringify(await verify({ packed, expectedRoot: JSON.parse(await readFile(expectedRootFile, 'utf8')), source, restore, signal: controller.signal, onProgress: value => console.error(JSON.stringify(value)) })));
}
