// Browser acceptance observes a logical asset's actual physical response. Pins
// come only from the candidate's publication bootstrap, never a discovered shard
// or a guessed compressed filename. A bad declared transport cannot fall back.
import { createStaticTransport } from '../src/static/transport/index.mjs';
import { consumeBounded, decodeBytes } from '../src/static/transport/codec.mjs';
import { DEFAULT_LIMITS, invariant, sha256, validPath } from '../src/static/transport/format.mjs';
import { validateTransportDescriptor, validateTransportPreview } from '../../.github/scripts/static-transport-publication.mjs';

const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const logicalPath = path => {
  invariant(validPath(path), 'Invalid Design static asset path');
  return `static-data/${path}`;
};

export async function createDesignAssetObserver({ baseURL, fetchImpl = globalThis.fetch }) {
  const url = path => new URL(path, baseURL).href;
  const read = async (path, cap, optional = false) => {
    const response = await fetchImpl(url(path), { redirect: 'error', cache: 'no-cache' });
    if (optional && response.status === 404) return null;
    invariant(response.ok && !response.redirected, `${path}: HTTP ${response.status}`);
    return consumeBounded(response.body, cap);
  };
  const [manifestBytes, publicationBytes] = await Promise.all([
    read('static-data/manifest.json', 256 * 1024),
    read('publication.json', 4 * 1024 * 1024, true),
  ]);
  const manifest = parse(manifestBytes), publication = publicationBytes && parse(publicationBytes);
  const manifestHash = await sha256(manifestBytes);
  let transport;
  if (publication) {
    invariant(publication.data_manifest_sha256 === manifestHash, 'Design publication manifest integrity mismatch');
    if (publication.schema === 'static-json-transport-preview-v1') validateTransportPreview(publication);
    else invariant(publication.schema === 1, 'Unsupported Design publication schema');
    if (Object.hasOwn(publication, 'transport')) {
      validateTransportDescriptor(publication.transport, publication);
      const expectedRoot = publication.transport.root;
      invariant(expectedRoot.bindings.financialGeneration === (manifest.financial_generation ?? null), 'Design financial generation binding mismatch');
      transport = await createStaticTransport({ baseURL, expectedRoot, fetchImpl });
    }
  }
  const publicationHash = publicationBytes && await sha256(publicationBytes);
  return {
    manifest,
    packed: Boolean(transport),
    async readJson(path) {
      const logical = logicalPath(path);
      return transport ? transport.readJson(logical) : parse(await read(logical, DEFAULT_LIMITS.decodedBytes));
    },
    async assertBrowserBootstrap(manifestResponse, publicationResponse) {
      invariant(await sha256(new Uint8Array(await manifestResponse.body())) === manifestHash,
        'Browser loaded a different manifest than the Design source');
      if (transport) invariant(publicationResponse?.ok() && await sha256(new Uint8Array(await publicationResponse.body())) === publicationHash,
        'Browser loaded a different publication/transport than the Design source');
    },
    async observeJson(page, path, action) {
      const logical = logicalPath(path);
      const entry = transport && await transport.lookup(logical);
      invariant(!transport || entry, `Missing Design logical transport asset: ${logical}`);
      const physical = entry?.assetPath || logical;
      // Install the listener before the UI action. Match failed responses too,
      // so a missing/bad asset reports its HTTP failure rather than timing out.
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url() === url(physical)),
        action(),
      ]);
      invariant(response.ok(), `${physical}: browser HTTP ${response.status()}`);
      let bytes = new Uint8Array(await response.body());
      if (entry) {
        invariant(bytes.length === entry.encodedBytes, 'Browser transport encoded length mismatch');
        invariant(await sha256(bytes) === entry.encodedSha256, 'Browser transport encoded SHA-256 mismatch');
        bytes = await decodeBytes(bytes, entry);
      } else invariant(bytes.length <= DEFAULT_LIMITS.decodedBytes, 'Browser asset exceeds permitted size');
      return { value: parse(bytes), observation: { logical_path: logical, physical_path: physical,
        kind: entry?.kind || 'legacy', decoded_bytes: bytes.length, decoded_sha256: await sha256(bytes),
        transport_generation: publication?.transport?.root.generation || null, source: 'actual browser response' } };
    },
    dispose() { transport?.dispose(); },
  };
}
