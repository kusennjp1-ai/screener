// Independent Node recovery checker: zlib, filesystem inventory, and byte-for-byte
// source comparison. Does not call the packer or browser decoder.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LIMITS, FORMAT, MANIFEST_PATH, RECEIPT_PATH, MAX_SITE_BYTES, canonicalBytes, generationBytes, invariant, validPath, validateManifest } from './format.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function list(root) {
  const paths = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name), logical = relative(root, path).split(sep).join('/');
      invariant(validPath(logical) && !item.isSymbolicLink(), `Invalid physical path: ${logical}`);
      if (item.isDirectory()) await visit(path);
      else { invariant(item.isFile(), `Non-file physical path: ${logical}`); paths.push(logical); }
    }
  }
  const stat = await lstat(root); invariant(stat.isDirectory() && !stat.isSymbolicLink(), 'Not a real directory');
  await visit(root); return paths.sort();
}
async function verifyInto({ source, packed, restore, signal, onProgress = () => {} }) {
  source = resolve(source); packed = resolve(packed);
  if (restore) {
    restore = resolve(restore);
    for (const root of [source, packed]) invariant(restore !== root && !restore.startsWith(`${root}${sep}`) && !root.startsWith(`${restore}${sep}`), 'Restore directory must be separate');

  }
  const receiptStat = await lstat(join(packed, RECEIPT_PATH));
  invariant(receiptStat.isFile() && !receiptStat.isSymbolicLink() && receiptStat.size <= 16 * 1024, 'Receipt cap or type invalid');
  const receiptBytes = await readFile(join(packed, RECEIPT_PATH));
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  invariant(Buffer.from(canonicalBytes(receipt)).equals(receiptBytes), 'Noncanonical receipt');
  const receiptKeys = ['format','generation','manifestPath','manifestBytes','manifestSha256','sourceFiles','dataFiles','identityFiles','originalBytes','dataOriginalBytes','compressedAssetBytes','identityBytes','uniqueCompressedAssets','physicalFiles','outputBytes','siteLimitBytes','gzipLevel','node','zlib'];
  invariant(Object.keys(receipt).sort().join(',') === receiptKeys.sort().join(','), 'Invalid receipt fields');
  invariant(receipt.format === FORMAT && receipt.manifestPath === MANIFEST_PATH && receipt.gzipLevel === 6, 'Invalid receipt format');
  for (const key of ['manifestBytes','sourceFiles','dataFiles','identityFiles','originalBytes','dataOriginalBytes','compressedAssetBytes','identityBytes','uniqueCompressedAssets','physicalFiles','outputBytes','siteLimitBytes']) invariant(Number.isSafeInteger(receipt[key]) && receipt[key] >= 0, `Invalid receipt value: ${key}`);
  invariant(receipt.siteLimitBytes > 0 && receipt.siteLimitBytes <= MAX_SITE_BYTES && typeof receipt.node === 'string' && typeof receipt.zlib === 'string', 'Invalid receipt limits/runtime');
  const manifestStat = await lstat(join(packed, MANIFEST_PATH));
  invariant(manifestStat.size <= DEFAULT_LIMITS.manifestBytes, 'Manifest cap exceeded');
  const bytes = await readFile(join(packed, MANIFEST_PATH));
  invariant(bytes.length === receipt.manifestBytes && hash(bytes) === receipt.manifestSha256, 'Manifest receipt mismatch');
  const manifest = JSON.parse(bytes.toString('utf8'));
  invariant(Buffer.from(canonicalBytes(manifest)).equals(bytes), 'Noncanonical manifest');
  validateManifest(manifest);
  invariant(hash(generationBytes(manifest.files)) === manifest.generation && manifest.generation === receipt.generation, 'Generation mismatch');
  const compressed = manifest.files.filter(entry => entry.kind === 'gzip'), identity = manifest.files.filter(entry => entry.kind === 'identity');
  const uniqueAssets = new Map(compressed.map(entry => [entry.assetPath, entry.encodedBytes]));
  invariant(receipt.dataFiles === compressed.length && receipt.identityFiles === identity.length && receipt.uniqueCompressedAssets === uniqueAssets.size && receipt.dataOriginalBytes === compressed.reduce((sum, entry) => sum + entry.decodedBytes, 0) && receipt.identityBytes === identity.reduce((sum, entry) => sum + entry.decodedBytes, 0) && receipt.compressedAssetBytes === [...uniqueAssets.values()].reduce((sum, value) => sum + value, 0), 'Receipt inventory totals mismatch');
  const originals = await list(source), expectedLogical = manifest.files.map(entry => entry.path);
  invariant(JSON.stringify(originals) === JSON.stringify(expectedLogical), 'Source inventory mismatch: unknown or missing source');
  const expectedPhysical = [...new Set(manifest.files.map(entry => entry.assetPath).concat([MANIFEST_PATH, RECEIPT_PATH]))].sort();
  const physical = await list(packed);
  invariant(JSON.stringify(physical) === JSON.stringify(expectedPhysical), 'Packed inventory mismatch: unknown or missing asset');
  let physicalBytes = 0; const physicalSnapshots = new Map(), sourceSnapshots = new Map();
  for (const path of physical) { const stat = await lstat(join(packed, path)); physicalBytes += stat.size; physicalSnapshots.set(path, stat); }
  invariant(physicalBytes === receipt.outputBytes && physical.length === receipt.physicalFiles && physicalBytes < MAX_SITE_BYTES && physicalBytes < receipt.siteLimitBytes, 'Physical byte budget or receipt mismatch');
  let recoveredBytes = 0, recoveredFiles = 0;
  for (const entry of manifest.files) {
    signal?.throwIfAborted();
    invariant(entry.encodedBytes <= DEFAULT_LIMITS.encodedBytes && entry.decodedBytes <= DEFAULT_LIMITS.decodedBytes, `Decoder cap exceeded: ${entry.path}`);
    const encodedHash = createHash('sha256'), decodedHash = createHash('sha256'); let encodedBytes = 0, decodedBytes = 0, decodedCrc = 0;
    const sourcePath = join(source, entry.path), before = await lstat(sourcePath);
    invariant(before.size === entry.decodedBytes, `Source length mismatch: ${entry.path}`);
    const sourceFile = await open(sourcePath, 'r');
    try {
      const encodedMeter = new Transform({ transform(chunk, encoding, callback) {
        encodedBytes += chunk.length;
        if (encodedBytes > entry.encodedBytes) return callback(new Error(`Encoded inflation/cap: ${entry.path}`));
        encodedHash.update(chunk); callback(null, chunk);
      } });
      const decodedMeter = new Transform({ transform(chunk, encoding, callback) {
        const offset = decodedBytes; decodedBytes += chunk.length;
        if (decodedBytes > entry.decodedBytes) return callback(new Error(`Decoded inflation/cap: ${entry.path}`));
        decodedHash.update(chunk); decodedCrc = crc32(chunk, decodedCrc);
        void (async () => {
          const original = Buffer.allocUnsafe(chunk.length); let read = 0;
          while (read < chunk.length) { const result = await sourceFile.read(original, read, chunk.length - read, offset + read); invariant(result.bytesRead > 0, 'Unexpected source EOF'); read += result.bytesRead; }
          invariant(original.equals(chunk), `Recovered byte mismatch: ${entry.path} at ${offset}`);
        })().then(() => callback(null, chunk), callback);
      } });
      let sink = new Writable({ write(chunk, encoding, callback) { callback(); } });
      if (restore) { const target = join(restore, entry.path); await mkdir(dirname(target), { recursive: true }); sink = createWriteStream(target, { flags: 'wx' }); }
      const stages = [createReadStream(join(packed, entry.assetPath)), encodedMeter];
      const framing = entry.kind === 'gzip' ? singleGzipFraming() : null, inflater = framing ? createInflateRaw() : null;
      if (framing) stages.push(framing.stream, inflater);
      await pipeline(...stages, decodedMeter, sink, { signal });
      framing?.validate(inflater, encodedBytes, decodedBytes, decodedCrc);
      invariant(encodedBytes === entry.encodedBytes && encodedHash.digest('hex') === entry.encodedSha256, `Encoded integrity mismatch: ${entry.path}`);
      invariant(decodedBytes === entry.decodedBytes && decodedHash.digest('hex') === entry.decodedSha256, `Decoded integrity mismatch: ${entry.path}`);
      const after = await lstat(sourcePath);
      invariant(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.ino === after.ino, `Source changed: ${entry.path}`);
      sourceSnapshots.set(entry.path, after);
      recoveredBytes += decodedBytes; recoveredFiles++;
      if (recoveredFiles % 1000 === 0) onProgress({ checked: recoveredFiles, total: manifest.files.length });
    } finally { await sourceFile.close(); }
  }
  invariant(recoveredFiles === receipt.sourceFiles && recoveredBytes === receipt.originalBytes, 'Recovery totals mismatch');
  invariant(JSON.stringify(await list(source)) === JSON.stringify(originals), 'Source inventory changed');
  invariant(JSON.stringify(await list(packed)) === JSON.stringify(physical), 'Packed inventory changed');
  for (const [root, snapshots] of [[source, sourceSnapshots], [packed, physicalSnapshots]]) for (const [path, before] of snapshots) {
    signal?.throwIfAborted();
    const after = await lstat(join(root, path));
    invariant(after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, `Input changed before verification completed: ${path}`);
  }
  signal?.throwIfAborted();
  return { generation: manifest.generation, recoveredFiles, recoveredBytes, physicalFiles: physical.length, physicalBytes, allOriginalBytesEqual: true, ...(restore ? { restoredTo: restore } : {}) };
}
// Our writer emits FLG=0, MTIME=0, XFL=0, then one DEFLATE member.
// Strip only that framing; raw inflate's consumed-byte counter rejects trailing
// zeros and concatenated members that Node gunzip otherwise accepts.
function singleGzipFraming() {
  let pending = Buffer.alloc(0), headerSeen = false, trailer;
  const stream = new Transform({ transform(chunk, encoding, callback) {
    try {
      pending = Buffer.concat([pending, chunk]);
      if (!headerSeen && pending.length >= 10) {
        invariant(pending.subarray(0, 9).equals(Buffer.from('1f8b08000000000000', 'hex')), 'Noncanonical gzip header');
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
export async function verify(options) {
  if (!options.restore) return verifyInto(options);
  const restore = resolve(options.restore);
  for (const root of [resolve(options.source), resolve(options.packed)]) invariant(restore !== root && !restore.startsWith(`${root}${sep}`) && !root.startsWith(`${restore}${sep}`), 'Restore directory must be separate');
  try { await lstat(restore); throw new Error('Restore output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(restore), { recursive: true });
  const staging = await mkdtemp(join(dirname(restore), '.lossless-restore-'));
  try {
    const result = await verifyInto({ ...options, restore: staging });
    options.signal?.throwIfAborted();
    try { await lstat(restore); throw new Error('Restore output appeared while verifying'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, restore);
    return { ...result, restoredTo: restore };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, packed, restore] = process.argv.slice(2);
  invariant(source && packed && process.argv.length <= 5, 'Usage: node verify.mjs SOURCE_DIRECTORY PACKED_DIRECTORY [NEW_RESTORE_DIRECTORY]');
  console.log(JSON.stringify(await verify({ source, packed, restore, onProgress: value => console.error(JSON.stringify(value)) }), null, 2));
}
