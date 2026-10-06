// Exercise the shared Web API decoder against the largest actual candidate files
// in Node. This is not a real-browser or application integration test.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { openTransport } from './decode.mjs';
import { invariant, MANIFEST_PATH, RECEIPT_PATH } from './format.mjs';

const [directory] = process.argv.slice(2);
invariant(directory && process.argv.length === 3, 'Usage: node check-candidate.mjs PACKED_DIRECTORY');
const root = resolve(directory), receipt = JSON.parse(await readFile(join(root, RECEIPT_PATH))), manifestBytes = new Uint8Array(await readFile(join(root, MANIFEST_PATH)));
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const allowed = new Set(manifest.files.map(entry => entry.assetPath));
const started = performance.now();
const decoder = await openTransport({ manifestBytes, expectedManifestBytes: receipt.manifestBytes, expectedManifestSha256: receipt.manifestSha256, expectedGeneration: receipt.generation, rootUrl: 'https://local-test.invalid/', fetchImpl: async url => {
  const path = new URL(url).pathname.slice(1); invariant(allowed.has(path), 'Unknown local fixture path');
  return new Response(Readable.toWeb(createReadStream(join(root, path))));
} });
const manifestMilliseconds = Math.round(performance.now() - started), samples = [];
const filters = [entry => entry.path.startsWith('static-data/markets/us/scan/chunks/'), entry => entry.path.startsWith('static-data/markets/us/charts/') && entry.kind === 'gzip', entry => entry.path.startsWith('static-data/research-details/'), entry => entry.kind === 'identity'];
for (const filter of filters) {
  const entry = manifest.files.filter(filter).sort((a, b) => b.decodedBytes - a.decodedBytes)[0]; invariant(entry, 'Missing candidate family');
  const start = performance.now(), decoded = await decoder.readBytes(entry.path, { expectedDecodedSha256: entry.decodedSha256, expectedDecodedBytes: entry.decodedBytes });
  invariant(decoded.length === entry.decodedBytes, 'Candidate decode length mismatch');
  samples.push({ path: entry.path, decodedBytes: decoded.length, decodedSha256: entry.decodedSha256, milliseconds: Math.round(performance.now() - start) });
}
console.log(JSON.stringify({ runtime: `Node ${process.versions.node}`, realBrowser: false, generation: receipt.generation, manifestMilliseconds, samples }, null, 2));
