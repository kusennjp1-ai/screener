// Read-only adapter for an exact, already-published packed static bundle.
// Never fetch market providers, alter the source, or infer a trusted root.
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createStaticTransport } from '../../../frontend/src/static/transport/index.mjs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const ASSET_BYTE_LIMIT = 128 * 1024 * 1024;
export const PUBLICATION_BYTE_LIMIT = 1024 * 1024;
const invariant = (condition, message) => { if (!condition) throw Error(message); };
export function parsePinnedPublication(bytes, expectedSha256) {
  invariant(bytes.length <= PUBLICATION_BYTE_LIMIT, 'Publication receipt exceeds the 1 MiB cap');
  invariant(sha256(bytes) === expectedSha256, 'Publication receipt digest mismatch');
  return JSON.parse(bytes);
}
export async function openPublishedInput({ directory, baseURL, publicationSha256 }) {
  invariant(/^[a-f0-9]{64}$/.test(publicationSha256 || ''), 'An exact publication SHA-256 is required');
  invariant(Boolean(directory) !== Boolean(baseURL), 'Select exactly one local directory or published HTTPS base URL');
  const local = directory && await realpath(directory);
  const url = new URL(baseURL || 'https://local-preview.invalid/');
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('/'), 'Invalid published base URL');
  let requests = 0, bytesRead = 0;
  const fetchImpl = async (target, { signal, byteCap = ASSET_BYTE_LIMIT } = {}) => {
    const requested = new URL(target);
    invariant(requested.origin === url.origin && requested.pathname.startsWith(url.pathname) && !requested.search && !requested.hash, 'Source request escaped the pinned site');
    let bytes;
    if (local) {
      const relative = decodeURIComponent(requested.pathname.slice(url.pathname.length));
      const file = await realpath(resolve(local, relative));
      invariant(file.startsWith(local + sep), 'Source path escaped the read-only root');
      invariant((await stat(file)).size <= byteCap, 'Source asset exceeds cap');
      bytes = await readFile(file);
    } else {
      const response = await fetch(requested, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)].filter(Boolean)) });
      invariant(response.ok, `Published input HTTP ${response.status}`);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; invariant(size <= byteCap, 'Source response exceeds cap'); chunks.push(Buffer.from(chunk)); }
      bytes = Buffer.concat(chunks);
    }
    invariant(bytes.length <= byteCap, 'Source asset exceeds cap'); requests++; bytesRead += bytes.length;
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  };
  const publicationBytes = Buffer.from(await (await fetchImpl(new URL('publication.json', url), { byteCap: PUBLICATION_BYTE_LIMIT })).arrayBuffer());
  const publication = parsePinnedPublication(publicationBytes, publicationSha256);
  invariant(publication.transport?.root, 'An explicitly bound packed transport root is required');
  const transport = await createStaticTransport({ baseURL: url.href, expectedRoot: publication.transport.root, fetchImpl });
  const manifestBytes = await transport.readBytes('static-data/manifest.json');
  const manifestHash = publication.transport.root.bindings.manifestSha256;
  invariant(sha256(manifestBytes) === manifestHash, 'Source manifest digest mismatch');
  const manifest = JSON.parse(Buffer.from(manifestBytes));
  const market = manifest.markets?.US;
  invariant(market?.as_of_date && market?.assets?.research?.path && market?.assets?.charts?.path && market?.pages?.breadth?.path, 'Incomplete US source manifest');
  return { manifest, market, publication,
    readJson: path => transport.readJson(path.startsWith('static-data/') ? path : `static-data/${path}`),
    readBytes: path => transport.readBytes(path.startsWith('static-data/') ? path : `static-data/${path}`),
    provenance: () => ({ source_kind: 'existing_packed_publication', source: local ? 'local read-only packed directory' : url.href,
      publication_sha256: publicationSha256, manifest_sha256: manifestHash, transport_root: publication.transport.root,
      source_as_of_date: market.as_of_date, generated_at: manifest.generated_at, requests, bytes_read: bytesRead,
      provider_acquisition: false, publication_authority: 'none' }),
    close: () => transport.dispose() };
}
