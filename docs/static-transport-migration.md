# Lossless static-data transport migration

This change is being prepared for the financial repair release. It is not an
activation record, approval of an untested build, or evidence that the public
site has changed.

## Why the transport changes

GitHub Pages limits the published site to 1 GB. The retained predecessor has
1,709,427,690 bytes of regular files; the repaired candidate has 1,980,197,848.
These are hosted file sizes, not the smaller compressed workflow artifacts.
The release controller now checks both regular file bytes and the actual TAR
stream against a conservative 1,000,000,000-byte ceiling before Pages upload.
See [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
and the distinct [Pages artifact validation rules](https://github.com/actions/upload-pages-artifact#artifact-validation).

The proposed transport preserves the exact original JSON bytes while storing
three large families as gzip members: source chart payloads (excluding their
index), research details, and source scan chunks. Manifests, indexes, verified
charts, history, financial evidence, audit downloads, and UI files remain raw.
No row, property, numeric precision, null, or historical observation is removed
to meet the limit.

## Compatibility boundary

Application routes and deep links continue to use the same logical asset paths.
The shared page/worker reader resolves those paths through an authenticated,
generation-specific transport registry. CSV exports consume the same decoded
objects and must retain every existing exported field.

Direct HTTP clients of a compressed family's old `.json` URL must migrate to
the versioned transport descriptor and decoder. Those old physical URLs are
not transparently preserved. This change affects any external scripts that
use those URLs. All other retained
raw JSON routes keep their existing payload bytes.

Already-open tabs running the previous UI may need a reload after deployment.
The old code cannot decode the new physical transport. Existing service-worker
caches are not evidence that a stale or mixed generation is current; the new
reader checks the publication/manifest pair before using a packed generation.

An ordinary `JSON.parse` still has JavaScript's ordinary numeric semantics.
Byte equality is established before parsing; this does not add an arbitrary
precision number system.

## Data and release boundaries

The logical inventory identifies the original payload bytes. The physical
inventory identifies the files actually hosted, including compressed members
and registry metadata. Publication metadata is bound separately to avoid a
self-referential file hash. A decoder must reject incorrect generations,
lengths, hashes, framing, and stale request identities before returning data.
It must not replace a failed packed read with unverified legacy values.
An unpublished browser candidate uses a closed preview descriptor explicitly
marked `publication_authority: none`. The production publication validator
rejects that descriptor as a release receipt. Its purpose is to exercise the
same transport before there is any deployment approval.

The browser loads only the required registry shards, rather than eagerly
parsing the prototype's 7.36 MB complete path map. Registry caching is bounded
and scoped to the immutable generation. A new financial observation does not
alter its original observation clock or the price analysis date.

Proof and carry checks reconstruct the canonical logical tree before running
the existing financial and price comparisons. Final publication additionally
checks the complete physical closure and hosted-size guard. Data-only updates
must retain the approved decoder UI and regenerate a transport binding for
the new data generation.

## Validation required before activation

- Shared codec and registry tests cover corruption, omissions, extra files,
  aborts, stale generations, cache eviction, and bounded expansion.
- Page and worker consumers produce the same data, method decisions, chart
  evidence, filters, and CSV values as the canonical raw inputs.
- The actual packed production build is measured and captured in the browser.
  The old comparison build remains raw because it predates the decoder.
- Every retained original logical file recovers byte-for-byte from the packed
  tree. Candidate, source, UI, logical inventory, and physical inventory hashes
  are bound to the exact tested attempt.
- Activation and next-data carry are rehearsed with retained real source
  archives, including expired/missing financial evidence becoming unknown.
- The final hosted tree and its TAR stream pass the permanent Pages guard.

The initial isolated Chromium diagnostic passed 30 codec contracts and four
real asset reads. It did not test the full application or release/carry path.
Native decompression implementations may buffer internally; stream checks
bound accepted input/output and prevent partial data use, but are not a claim
of a strict browser heap limit. Fresh full-application timing is required.

The earlier raw candidate and its performance acceptance cannot establish
correctness of this new transport build. Exact new provenance and review are
required. Publication remains disabled until that evidence is complete.

The current normal Design planner can choose a fresh raw export after a
financial release is already active. If that export lacks the active financial
generation, the transport preparation rejects it with a carry-required error.
That future new-UI path still needs a validated financial carry; it is not
covered by the initial repair or ordinary data-only carry results.

The unpublished bootstrap is smaller than a production receipt containing
the retained price ledger. Design therefore records separate, explicitly
synthetic production-shaped metadata trials with the actual application, in
addition to the unchanged exact-candidate trials. These extra trials omit
approval, never alter candidate files, and cannot replace a failed budget.

The browser codec requires the platform's single-member gzip contract in the
[Compression Standard](https://compression.spec.whatwg.org/#supported-formats).
The independent Node verifier additionally checks the consumed deflate length,
CRC, and trailer rather than relying on tolerant general-purpose gzip readers.
