# Lossless sharded static transport

This transport changes physical storage, not the canonical data model. It retains
every original JSON byte, including number spelling, array order, missing fields,
nulls, timestamps, and evidence. CSV exports retain every original field and byte.
It does not compact schemas, remove histories, or replace source hashes with hashes
of parsed/re-serialized data.

Only these source JSON families are gzip encoded:

- `static-data/markets/us/charts/*.json`, except `index.json`
- `static-data/research-details/*.json`
- `static-data/markets/us/scan/chunks/*.json` (six chunks in the retained candidate)

Other files, including derived/verified charts, indexes, manifests, audit/proof
files, CSV, HTML, and application assets, remain byte-identical identity files.
`publication.json` alone is excluded: release tooling writes and independently
validates either a real publication receipt or an explicitly non-authorizing
preview receipt. This module never creates publication or deployment authority.

## Browser and worker API

`frontend/src/static/transport/index.mjs` is browser-safe ESM with no Node imports
or additional dependencies. The same module also runs under Node's web APIs.

```js
import { createStaticTransport, isPackedData, validateExpectedRoot }
  from '../../src/static/transport/index.mjs';

const transport = await createStaticTransport({
  baseURL: 'https://example.test/screener/',
  expectedRoot, // supplied by the verified publication/app binding
  fetchImpl: fetch,
  signal: generationController.signal,
  getCurrentGeneration: () => activeExpectedRoot.generation,
});
const bytes = await transport.readBytes(logicalPath, {
  signal: requestController.signal,
  expectedDecodedSha256: originalSourceSha256,
  expectedDecodedBytes: originalSourceBytes,
});
const json = await transport.readJson(logicalPath, { signal });
const entry = await transport.lookup(logicalPath, { signal });
transport.dispose();
```

Creation fetches only the authenticated root (at most 64 KiB). Invoke it lazily
when the first compressed family is requested. `lookup` fetches only the shard
selected by the first two lowercase hexadecimal characters of SHA-256 of the
UTF-8 logical path. It validates every entry in that shard before caching it.
`readBytes` returns the exact original bytes; `readJson` applies fatal UTF-8
decoding and normal JavaScript JSON parsing only after byte verification. Existing
JavaScript number semantics are unchanged; callers needing exact numeric spelling
use `readBytes`. Returned byte arrays are independently owned.

Missing compressed-family entries, missing resources, integrity failures,
malformed metadata, unsupported decompression, stale generations, and cancellations
are errors. There is no raw fallback. Only an independently and positively
identified legacy raw publication may use the legacy raw reader. An unknown
noncohort path may return `undefined` from `lookup`; `readBytes`/`readJson` reject
every unknown path.

Concurrent shard reads and in-flight same-path digests are deduplicated. Each
subscriber owns its cancellation; one cancellation preserves other subscribers,
and the last cancellation aborts the fetch. The default LRU retains at most eight
validated shards of at most 256 KiB wire bytes each, with at most sixteen pending
shards and 64 pending path digests. Excess concurrency fails explicitly: the app's
wrapper should queue bulk callers. Decoded assets are not retained in this cache.
Object overhead is additional to wire-byte sizes. Every asynchronous boundary
checks request cancellation and immutable transport generation. Call `dispose`
when replacing an instance so its in-flight operations are interrupted.

Overrides under `limits` can only decrease defaults. Encoded and decoded assets
are bounded at 128 MiB each, inventories at 32 MiB, roots at 64 KiB, and shards at
256 KiB. The fetch body is read incrementally and checked against its exact
declared length and SHA-256 before decompression. Native inflater input chunks
are at most 1 KiB; returned output is bounded before accumulation. Native inflater
internal heap cannot be guaranteed by this API. Concurrent callers also consume
memory outside the shard cache; the app wrapper bounds its read concurrency.

Gzip requires a conforming `DecompressionStream('gzip')`; no permissive Node
`gunzip` fallback is used. The [Compression Standard](https://compression.spec.whatwg.org/#supported-formats)
requires one member, correct CRC/ISIZE, and rejection of trailing input. The codec
also checks the writer's fixed header and declared trailer length. The independent
Node verifier instead uses raw inflate with a consumed-byte count and CRC32 to
detect trailing bytes and additional members. Unsupported runtimes fail closed.
Normal HTTP content compression is accepted only if the resulting Fetch body
matches the pinned file bytes. The [Fetch Standard](https://fetch.spec.whatwg.org/#http-network-fetch)
decodes HTTP content codings before exposing body bytes; a retained
`Content-Encoding: gzip` or `br` header alone therefore is not a corruption signal.
The native HTTP harness checks both wrappers around identity JSON and stored gzip
assets. If a server instead mislabels the stored gzip member itself as the HTTP
coding, the premature expansion fails the pinned physical length/hash checks.
Gzip assets use `.bin`, avoiding accidental
interpretation of a stored `.gz` file as an HTTP content-encoding instruction.

## Wire format and trust boundary

All transport metadata uses canonical UTF-8 JSON (`JSON.stringify(value)` followed
by one newline), rejects duplicate keys/noncanonical representations, and uses
strict field sets. All assets and metadata are under `static-data/_transport/` so
the publication data inventory accounts for them. There is no root `_lossless/`.

The expected root descriptor has exactly these fields:

```js
{
  path: 'static-data/_transport/root-<sha256>.json',
  bytes: 57000, // illustrative; the exact observed size is required
  sha256: '<64 lowercase hex>',
  generation: '<64 lowercase hex>',
  bindings: {
    manifestSha256: '<64 lowercase hex>',
    uiInventorySha256: '<64 lowercase hex>',
    financialGeneration: '<64 lowercase hex or null>',
    financialLineageSha256: '<64 lowercase hex or null>',
    sourceCommit: '<40 lowercase hex>',
    appCommit: '<40 lowercase hex>',
    candidateId: '<64 lowercase hex>'
  }
}
```

The two financial fields must both be hashes or both be null. The packer verifies
the manifest binding against the exact `static-data/manifest.json` source bytes.
The release controller is responsible for deriving and verifying the UI inventory,
financial lineage, source/app commits, and candidate identity. Merely fetching a
self-declared descriptor from the same directory is not independent authentication.

The root contains `{format,generation,bindings,logicalInventory,physicalInventory,
shards}`. `format` is `screener-static-transport-v1`. Its immutable generation is
the SHA-256 of canonical `{format,bindings,logicalInventory,physicalInventory,
shards}`. Each inventory descriptor is `{path,bytes,sha256}`. The sorted 256 shard
descriptors are `{id,path,bytes,sha256}`, with IDs `00` through `ff`. Metadata paths
are `static-data/_transport/{root,logical,physical,shard}-<sha256>.json`.

Each shard contains `{format,id,files}` with sorted entries using the exact fields
`path,kind,assetPath,encodedBytes,encodedSha256,decodedBytes,decodedSha256`.
Compressed entries point to `static-data/_transport/gzip/<encodedSha256>.bin`;
identity entries point to the original logical path with equal encoded/decoded
sizes and hashes. Equal compressed bytes share an immutable physical asset.

Both inventory documents contain `{format,files}`, where `files` is a canonical
object mapping paths to `{bytes,sha256}`. Paths are compared lexicographically;
JSON serialization retains JavaScript's normal integer-key ordering. The logical
inventory covers every original file except `publication.json`. The root's
physical inventory covers payload assets (identity and gzip), excluding metadata
to avoid a self-hash cycle. The exact full physical closure is the union of:

1. That physical payload inventory
2. All 256 shard files
3. Both inventory documents
4. The content-addressed root file

The verifier derives this closure and rejects every missing or extra file other
than the separately validated `publication.json`. It compares both inventories
against the complete shard entries and independently verifies every payload byte.
Content-addressed roots and assets permit cache-safe old/new generations; a
publisher wanting old uncached requests to remain available must retain those
older immutable files explicitly. This single-generation verifier deliberately
rejects unlisted old files rather than silently treating them as approved assets.

## Local pack and exact restoration

Use the repository's Node 22 CI runtime or later. The verifier needs built-in
[`zlib.crc32`](https://nodejs.org/api/zlib.html#zlibcrc32data-value), available since
Node 22.2.0 and 20.15.0; this API does not require Node 24. The local contracts and
retained-input measurement were run on Node 24.19.0. No npm installation or
provider access is required for packing and verification.

```js
import { pack } from './pack.mjs';
import { verify, unpack } from './verify.mjs';

const result = await pack({ source, output, bindings, signal });
const verified = await verify({
  packed: output,
  expectedRoot: result.expectedRoot,
  source,             // optional direct byte-for-byte original comparison
  restore: newPath,    // optional full canonical tree for existing verifiers
  signal,
});
```

`unpack` is an alias of `verify`: restoration never bypasses verification.
The result contains `expectedRoot`, `logicalInventory`, `physicalInventory`,
`logicalFiles`, `logicalBytes`, `physicalFiles`, `physicalBytes`, `compressedFiles`,
and `uniqueCompressedAssets`. Here `physicalInventory` is the complete derived
closure, including all metadata. Verification with a source additionally returns
`allOriginalBytesEqual: true`; restoration returns `restoredTo`.

Output and restore directories must not exist and must be separate from inputs.
Symlinks and non-file inputs are rejected. Files are staged beside the destination,
source fingerprints/inventories are checked again at completion, and the new
directory is published by rename only after success. Interrupted operations remove
their own staging directory and leave inputs unchanged. Compression is deterministic
for identical source bytes, bindings, and Node/zlib implementation. The generation
records actual hashes; a runtime's different compressed bytes yield a different
generation, never an assumed-equivalent artifact.

CLI equivalents:

```sh
node frontend/tools/static-transport/pack.mjs SOURCE NEW_OUTPUT BINDINGS_JSON
node frontend/tools/static-transport/verify.mjs PACKED EXPECTED_ROOT_JSON [NEW_RESTORE] [SOURCE]
node --test frontend/tools/static-transport/contracts.node.mjs
node --test frontend/tools/static-transport/browser-harness.node.mjs
```

`browser-harness.node.mjs` validates the production browser fixture and all twenty
shared contract cases under Node web APIs, without importing Playwright or
launching a browser. This is harness validation, not browser execution. Authorized
CI with the existing Playwright/Chromium install may run:

```sh
node frontend/tools/static-transport/browser-contract.mjs --report test-results/static-transport-browser-report.json
```

The browser driver runs the same twenty cases in a Chromium page and a module
Worker (forty total), writes each completed case to the report before continuing,
and fails on a missing or failed case. It serves only an explicit local fixture
route map and blocks other origins. Cases have five-second deadlines; page and
worker evaluations also have outer deadlines. The artifact distinguishes Node
harness validation, synthetic Chromium contracts, and actual application/candidate
validation. Native input/output boundary observations do not measure native heap,
peak memory, full application behavior, or real candidate resource costs.

The strict core payload budget remains less than 1,000,000,000 bytes. Release
tooling must also count the separately written publication receipt and every other
deployed byte before applying the permanent whole-site guard. Packing or successful
verification alone does not approve or publish a site.

## Endpoint migration

Original compressed-family `.json` URLs are intentionally absent from the physical
site. External consumers fetching those URLs directly will need this transport
reader or an explicitly designed compatibility endpoint; raw endpoint compatibility
is not claimed. Existing application deep links retain their URLs when the page
and worker readers are integrated with the transport. Raw identity JSON endpoints
and CSV downloads remain unchanged. Deployment requires a newly bound application
build and candidate/browser verification of these production readers; prototype
browser results or packing an old application do not establish that integration.
