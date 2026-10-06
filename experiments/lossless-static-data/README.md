# Local lossless static-data transport experiment

**Default off, unintegrated, and not deployable as an application.** This directory adds no imports to the app, no build hook, no dependency, no provider request, no data refresh, and no remote/deployment action. It preserves the existing candidate and works only in fresh output directories. The current application still requests the original JSON URLs, so deploying the packed tree alone would break those readers.

## Bounded scope

The initial all-JSON idea was narrowed before the measured run. Only these complete payload families become gzip assets:

- `static-data/markets/us/charts/*.json`, excluding `index.json`
- `static-data/research-details/*.json`
- `static-data/markets/us/scan/chunks/*.json`

Everything else is copied byte-for-byte, including UI/JS/CSS/HTML, manifests/indexes, verified charts, qualification-audit download, research/portfolio root JSON, candidate history, financial source data, and bootstrap metadata. No payload is deleted semantically, parsed/re-serialized, quantized, pruned, ranked, or given a refreshed timestamp. Filesystem modification times are not a data/proof clock and are not part of the byte-identity contract.

Every original logical path, including unchanged files, has an entry in the closed manifest. Compressed entries identify a physical `_lossless/gzip/<compressed-sha256>.json.gz` asset, compressed length/hash, and original decoded length/hash. Unchanged entries identify their original physical path and the same identity on both sides. The format requires a sorted, unique logical inventory, canonical JSON, exact fields, safe relative paths, matching content addresses, and non-conflicting physical aliases.

The generation is a SHA-256 of the canonical full inventory. No current timestamp is embedded in transport metadata. Gzip uses level 6, default strategy, and a zero timestamp; deterministic output is demonstrated on the pinned Node/zlib runtime, not promised across arbitrary compressor versions.

## Measured full candidate

Source: the immutable certified corrected served artifact from run `37389108358`, produced by controller commit `0ab45896dd825e05e5ef3e28b0d51e25e2928cf7`, with compiled UI captured at `34ecbf507a4270f796078d669c21c373c0d1279a`. The experiment worktree starts at local equivalent controller checkout `acc66bb3fbc16a000ebdd423c568cd1849e6c4dc`; that checkout is not the public artifact’s executed UI commit. The input artifact and its compiled UI are copied/read unchanged.

| Measurement | Bytes/count |
| --- | ---: |
| Original logical files | 19,596 |
| Original file bytes | 1,980,197,848 |
| Compressed logical files | 14,645 |
| Original bytes of those files | 1,583,283,637 |
| Content-addressed gzip asset bytes | 276,382,288 |
| Unchanged files | 4,951 |
| Unchanged physical bytes | 396,914,211 |
| Closed manifest | 7,360,815 |
| Receipt | 614 |
| Entire physical output, 19,598 files | **680,657,928** |
| Headroom below decimal 1,000,000,000-byte limit | **319,342,072** |

Independent streaming recovery compares every decompressed/unchanged chunk directly with the corresponding original source bytes, then checks SHA-256/length and the closed physical inventory. All 19,596 files / 1,980,197,848 bytes matched. It also validates the gzip single-member framing, consumed DEFLATE length, CRC32, and ISIZE. Node's permissive gunzip alone would accept some extra members/trailing bytes that the browser rejects, so it is not used as the sole format validator.

This measurement does **not** include the separate 38,219,744-byte activation projection and 15,281,559-byte activation target base. Keeping those raw would bring the measured bytes plus those two files to 734,159,231, before their additional manifest entries/receipt changes. That is an estimate, not an assembled final release measurement. The existing candidate and activation backups remain intact.

Generation: `53d9d70fd78adb750a7edf333aa2f3b12daded3b5d7fe0aa3e506ed741764399`.

Manifest SHA-256: `a0769e22160f46e3ca5d123bd26de5129ea6e9c7429a15240b03561d98ba4749`.

The receipt/manifest pins here are local test evidence. A receipt fetched beside an untrusted manifest is not an authenticity anchor; deployment must authenticate/pin the selected generation through its approved publication/bootstrap chain.

## Tools and tests

Verified runtime: Node 24.19.0, zlib `1.3.2.1-motley-3246f1b`. The independent checker uses `node:zlib` CRC32 and requires a Node runtime providing it. No packages were installed.

```sh
node --test --test-concurrency=2 experiments/lossless-static-data/transport.test.mjs
node experiments/lossless-static-data/pack.mjs SOURCE_DIRECTORY NEW_PACKED_DIRECTORY
node experiments/lossless-static-data/verify.mjs SOURCE_DIRECTORY PACKED_DIRECTORY
# Optional full recovery to a fresh directory, published only after all checks:
node experiments/lossless-static-data/verify.mjs SOURCE_DIRECTORY PACKED_DIRECTORY NEW_RESTORE_DIRECTORY
node experiments/lossless-static-data/check-candidate.mjs PACKED_DIRECTORY
```

Packer and restorer stage their output and publish only after success. Existing outputs are rejected; source/output nesting, symlinks within input trees, unknown/missing files, and source changes observed during the run fail. Both logical and physical inventories and file identity/size/mtime/ctime snapshots are rechecked at completion. These checks assume local immutable input directories without a hostile concurrent filesystem actor; they are not a filesystem snapshot or an OS-level atomic no-replace primitive. Abrupt process termination can leave a hidden staging directory; handled aborts clean it up.

The tests cover deterministic complete physical outputs on fixtures; all logical-byte recovery; number spelling and negative-zero bytes; null/missing/array semantics; corrupt/truncated gzip; compressed/decoded/manifest SHA and lengths; wrong path/generation/proof; duplicate/conflicting maps and duplicate JSON keys; unknown/missing source and assets; oversized inflation; unsupported decoder; HTTP content transformations; active abort and stale completion; hanging cancellation; extra gzip members/trailing junk; bounded inflater input chunks; falsified receipts; and already-processed input mutation. Eighteen Node tests pass. Full frontend/backend suites were not run because this experiment does not alter or import application/backend code.

`browser-contract.mjs` is a reproducible page + module Worker harness with 15 contract cases per realm plus optional actual candidate maxima. It serves only selected fixtures on loopback and uses an already-installed Playwright module supplied by the caller. Syntax is checked; **zero real-browser cases ran**. Installed Chromium 154.0.8037.57 failed before page creation with:

```text
chrome/browser/process_singleton_posix.cc:297 Check failed: . socket() failed: Operation not permitted (1)
```

The supported escalation also failed. Local browser launch is closed for this task and must not be retried by another launch route. A later separately authorized artifact-only CI job can run this harness; no such job or remote write is part of this experiment.

## Decoder contract and bounds

`decode.mjs` is dependency-free browser/Worker ESM. It requires pinned manifest SHA/length/generation, Web Crypto, Fetch, ReadableStream, TextDecoder, AbortController, and native `DecompressionStream('gzip')`. Manifest bytes are copied and fully authenticated before parsing; duplicate-key/noncanonical bytes are rejected. Every request resolves only through the closed inventory, rejects HTTP transformations/redirects, checks compressed length/hash first, inflates under an exact output cap, then checks decoded exact length/hash **before** returning bytes or parsing JSON. It never silently retries a raw URL or exposes partial decoded data.

Caps are 32 MiB manifest, 128 MiB encoded file, and 128 MiB decoded file; callers can only lower them. The measured largest decoded file is 98,523,068 bytes. Compressed bytes enter the native inflater in at most 1 KiB pull-driven chunks, with input high-water mark zero, rather than expanding a whole compressed file in one native transform. Decoded output is counted before retaining each yielded chunk and rejected at the declared length/cap. This bounds retained application output; source high-water mark zero does not prevent read-ahead inside native queues (the Node fixture accepted all eight compressed chunks before rejection). Native decompressor internal buffering, one inflation-step overshoot, browser queues, hashing copies, and JSON object allocations are not a precise total-heap guarantee. The complete compressed buffer and decoded output/chunk-copy buffers remain in memory because Web Crypto digest is not streaming. Production concurrency must be bounded, especially the home's six large scan chunks.

`readBytes` preserves original JSON byte spelling, including unsafe integers, `1.2300`, `-0`, whitespace, and timestamps. `readJson` deliberately uses ordinary `JSON.parse`: it preserves the same application parse behavior (including unsafe-integer rounding) rather than claiming JavaScript numbers preserve textual spelling. Lossless transport does not improve existing floating-point JSON parsing.

Abort/staleness is checked around awaits and before return/parse. Callers must pass a live `getCurrentGeneration` or abort old transports on generation replacement; its default represents a single immutable pinned generation. No automatic cache invalidation, publication selection, or query/Worker lifecycle integration is implemented. SHA operations and synchronous JSON parsing themselves cannot be preempted mid-call; their results are checked before being returned.

[MDN documents DecompressionStream availability across browsers since May 2023 and support in Workers](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream). This is not universal support for old browsers/webviews. [Web Crypto digest requires all input bytes in memory](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest). The present fallback is an explicit unsupported-decoder error. Before production, choose either a stated supported-browser baseline or an explicitly reviewed, pinned, separately tested bounded inflater dependency. No dependency or transparent raw fallback was added.

## Reader and migration inventory

- `frontend/src/static/dataClient.js`: main-thread JSON reader and Worker dispatch. It currently fetches raw URLs and sometimes checks original text SHA before parsing. A future adapter must map logical paths and preserve original proof checks.
- `frontend/src/static/researchWorker.js`: its own raw fetch/text/JSON path, including research chunk reads. It must share the adapter and carry generation/abort identity through completion.
- `frontend/src/static/chartClient.js`: delegates source chart loads to dataClient; verified charts and indexes stay raw in this scope.
- `frontend/src/static/pages/StaticHomePage.jsx`: actually loads the full source scan chunks through dataClient. They are required, not dead duplicates of scan-list.
- `frontend/src/static/pages/ResearchPage.jsx` and research detail hooks: logical detail/chart paths and original proof SHA must survive. Its direct `ibd-reference.json` fetch and `qualification-audit.json` download remain raw and unchanged.
- `frontend/public/sw.js` and `precache-manifest.json`: cache lifecycle needs generation-aware integration and asset policy review before activation. They are copied unchanged here.
- Node verification/export/publication tools, including `frontend/tools/financial-correction-overlay.mjs`, currently use direct filesystem reads. They require a byte-preserving resolver/materialized recovery tree, or equivalent explicit transport-aware verification, before a packed artifact can enter release qualification.
- Public/third-party HTTP consumers of the three compressed families currently request raw `.json` URLs. Those physical URLs are absent in the experiment. Logical paths remain manifest keys, and UI page routes are unchanged, but direct raw HTTP compatibility is **not** retained. Static GitHub Pages cannot make a JSON client decode these explicit `.gz` assets automatically. Publish a deliberate client/protocol migration or choose hosting with suitable content negotiation; do not describe this as a transparent URL-preserving deployment.

## Bounded next design, not implementation

The 7.36 MB eager manifest is a real unresolved startup/parse/allocation cost. Keep the full inventory for offline publication proof, and design an authenticated lazy lookup before app integration:

1. A small pinned raw bootstrap selects one immutable transport generation and authenticates a bounded directory of 256 content-addressed shard hashes/lengths (target bootstrap cap 64 KiB).
2. Route a canonical logical path by the first byte of SHA-256(path); fetch and validate only that shard, retaining original-path proof checks. The actual inventory partitioned this way yields 20,014–38,939 bytes per shard, average 28,883.67, maximum 103 entries. Those are in-memory design measurements, not emitted production shards.
3. Cap shard size/count and cache generation-keyed shard promises with bounded eviction/concurrency. Unknown paths fail closed. Authenticate each shard against the bootstrap; prove the full set against the offline closed inventory. No shard may mix generations.
4. Add one shared adapter at main-thread and Worker readers, retain raw untouched families, bind query/cache/worker lifecycle to the selected generation, then run complete app/route/performance/release-proof/browser tests. Include abort/stale/repeated navigation and the max-size scan path.

The integration identity must bind both the market/research generation and the financial-observation generation; a repeated market date can still have corrected financial facts. All current raw JSON SHA-256 proofs must continue to identify the recovered original bytes. Transport generation hashes the entire inventory here, but the prototype does not yet connect that identity to either application generation or its caches.

Activation must atomically select a versioned compatible decoder UI and packed-data generation. The old raw-only UI cannot consume these packed payloads. After an approved activation, ordinary data-only publications must continue using the approved transport protocol/decoder UI, perform full decoded-byte qualification, and enforce the complete physical published-site limit on every publication. A later raw-only rebuild or data-only release must not silently undo packing or exceed the site budget. None of that release-state integration is implemented here.

Before any release: make the browser support/fallback decision, integrate Node proof readers and the service worker, measure memory/CPU and startup lookup costs in actual browsers, assemble and measure the complete activation artifact, and obtain the separately required release authorization. This prototype establishes byte-lossless size feasibility, not production readiness or full end-to-end behavior.

## Separately isolated browser-evidence CI

The diagnostic branch `diagnostic/lossless-transport-browser-20261006` adds `.github/workflows/lossless-browser-diagnostic.yml`. Its only trigger is a push to that branch in the expected repository. The job is bounded to 20 minutes, with `contents: read` and `actions: read`, checkout credentials disabled, no Pages/id-token permission, and no provider, projection, activation, or publication step. This stage is prepared locally for the parent's upload; no CI/browser result is claimed before the run succeeds.

CI pins Node 24.19.0, installs the existing frontend lockfile using `npm ci --ignore-scripts`, and installs the lockfile's official Playwright Chromium with `npx --no-install playwright install --with-deps chromium`. The browser runner uses that installed Chromium rather than a system-browser path. This is a separately authorized CI route; the failed local browser route remains closed.

The intake helper authorizes only the following immutable source, verifies artifact/run/attempt/job/workflow metadata, streams the archive to a bounded file, and checks its complete length and SHA before opening it:

- Artifact `11381411253`, `financial-performance-candidate-37389108358-1`
- Run `37389108358`, attempt `1`, job `112029676592`
- Producer/controller `0ab45896dd825e05e5ef3e28b0d51e25e2928cf7`; captured compiled UI `34ecbf507a4270f796078d669c21c373c0d1279a`
- Raw ZIP length `1,057,593,973`; SHA-256 `63a7ac2e5e0046789c0a5ade8e78a9af6aa05ff2f6053143bf112dbff19fc11e`

It streams `candidate.tar` from the ZIP, validates archive paths/types/bounds, and writes only `corrected/`. Skipped source roots are not restored; no original-source provider acquisition or new financial projection is involved. The fresh corrected tree is packed with the existing prototype and measured against the physical limit. The full 19,596-file decoded parity proof remains the separate local verification; this browser job is not a replacement for that proof or for complete application/release gates.

The runner retains all 15 cases in the page and all 15 in a module Worker, including per-case failures and native high-ratio stream-boundary observations. Actual candidate decoding is sampled on the page: the largest 98,523,068-byte scan chunk and largest chart, detail, and unchanged audit file. It records manifest transfer/validation time, each sample's elapsed time, and `performance.memory` snapshots when available. These are approximate renderer JS-heap snapshots, possibly quantized, not peak memory, Worker heap, native inflater buffers, or total browser/process memory. There is no forced GC. Sequential samples can retain prior allocations. Instrumented inflater-boundary observations can themselves affect scheduling and do not prove a native heap bound.

One ordinary artifact is restricted to 16 named result files, at most 8 MiB per file and 32 MiB total. It contains only small source/runtime fingerprints, metadata/receipt, raw test output, pack receipt/progress, and browser JSON/stderr, including completed-case JSONL checkpoints in browser stderr and partial final results on harness failure. Each contract has a five-second timeout; an uncooperative realm stops after its completed results are recorded. A process/job kill can still prevent final aggregate JSON, so the incremental checkpoints and GitHub step outcome remain necessary evidence. No ZIP, source tree, packed tree, or generated site is uploaded. The 7.36 MB eager lookup remains deliberately present in the actual-candidate test; sharding and application integration remain future work rather than hidden benchmark changes.
