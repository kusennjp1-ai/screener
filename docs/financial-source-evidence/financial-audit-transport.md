# Lossless transport for retained financial audit bytes

This controller-only codec compresses only the hash-addressed `source-projection`,
`source-base`, and `carry-projection` JSON members listed in
`publication.financial_audit_files`. Small `release` JSON receipts remain served
at their original identity URLs. Every receipt, map, source hash and predecessor
chain keeps its exact logical meaning and original bytes. An old identity-form
publication remains readable without a new descriptor.

## Two verified layers, unchanged captured consumer

The existing captured browser requires `gzip` exactly for its three known data
families, and validates every entry in a fetched shard. Placing audit gzip entries
directly in those shards would break unrelated chart requests sharing a bucket.
This implementation does not change that browser, its validator, the frontend
tools, or the transport wire format.

The controller stages a second ordinary transport below
`static-data/_financial-audit-transport/`, using the captured frontend's existing
deterministic gzip packer and independent verifier. Inside that isolated root,
an approved audit member has one deterministic internal name:

```
static-data/financial-corrections/<kind>-<logical-sha256>.json
  → static-data/research-details/<kind>-<logical-sha256>.json
```

These internal names are never app research-detail paths: the complete inner
physical closure is ordinary identity data in the outer transport. The inner
root also contains the exact manifest and the same source/UI/candidate/financial
bindings as the outer root. It may contain no other logical paths. Both layers
use the existing authenticated root, 256 shards, inventories and content-addressed
gzip assets, with existing framing, hash and size validation.

The strict `financial_audit_transport` envelope has exactly `schema_version`,
`root`, and `storage_data_inventory_sha256`. Its schema is
`financial-audit-transport-v1`. The root is the existing exact transport root
descriptor, resolved only below the fixed nested prefix. It cannot select an
arbitrary URL, alias, path mapping, codec, decoder or resolver.

The inventories have distinct, explicit meanings:

1. The outer codec's root logical inventory describes intermediate storage:
   ordinary logical app files plus the inner physical closure. Its exact data
   digest is `financial_audit_transport.storage_data_inventory_sha256`.
2. Verification checks the inner physical closure, exact manifest/bindings and
   closed audit mapping, then replaces only that closure with decoded original
   audit entries. `transport.logical_data_inventory_sha256` remains the digest
   of this fully reconstructed canonical data tree and must equal the existing
   `publication.data_inventory_sha256`.
3. `transport.physical_inventory_sha256` remains the exact full hosted closure,
   including both layers' payloads and metadata. Publication JSON is separately
   bound and included in the final physical/TAR guard as before.

Captured-candidate validation still requires every captured original logical
file and every original outer gzip asset to be identical. Only explicitly listed,
hash-bound audit additions may appear. New inner assets are accepted only through
the closed verified mapping and both physical inventories.

## Restoration and resource bounds

Ordinary carries derive the compressed source path solely from the verified live
publication's audit map and pinned nested root. The existing transport reader
checks encoded length/hash, gzip framing, decoded length/hash and the raw logical
SHA-256. Missing or corrupt packed members fail; there is no identity fallback
for a declared compressed member. Release receipts remain identity reads.

Before canonicalization writes decoded files, the controller authenticates the
small roots and logical inventories and checks the complete reconstructed tree
against the existing 8 GiB/200,000-file archive policy. This includes ordinary
app data, not just audits. Each member retains the existing 128 MiB encoded and
decoded transport bounds. Map and publication metadata retain the existing
1 MiB and 4 MiB bounds. No contract threshold changes.

The controller checks available filesystem space for simultaneous outer and
nested restoration, plus 4 KiB per logical file and a 64 MiB reserve. Decoded
audit files are renamed into the restored tree rather than copied a second time.
Verification and recovery stream one payload at a time; the network reader owns
bounded encoded/decoded buffers. These checks do not claim a strict bound on
native inflater heap. Runs use at most two workers and a 3 GiB Node heap.

Final hosted regular-file bytes and actual uncompressed TAR bytes must each stay
strictly below 1,000,000,000 on every carry. The publication controller runs the
unchanged physical/TAR guard after final receipts and both codec layers, and again
at recheck. Logical archive limits cannot bypass either hosted limit.

## Actual retained-byte measurements and finite headroom

The retained capture uses 687,232,801 hosted bytes and a 702,535,680-byte TAR
(15,302,879 bytes of actual baseline TAR overhead). Node v24.19.0, zlib
1.3.2.1-motley-3246f1b, existing gzip level 6/default strategy produced:

| Audit member | Exact logical bytes | Gzip bytes |
| --- | ---: | ---: |
| Source projection | 38,219,744 | 3,516,818 |
| Source base | 15,281,559 | 1,432,923 |
| One real carry on the unchanged retained target | 120,813,637 | 10,440,186 |

All three were independently inflated and compared byte-for-byte. The carry
reproduced SHA-256
`f878e84b8676d83b4ef6d1746b7230bf5afb1db74212ffd322ea691cb003046c`.
It was evaluated in an explicitly synthetic, nonpublishing identity envelope;
no source observations or market prices were renewed.

The carry has only 13,404,091 decoded bytes of headroom under 128 MiB, about 11.1%
growth relative to the measured carry. Its encoded headroom is 123,777,542 bytes.
A larger carry must fail rather than silently increase either codec bound.

With the primary site and source held fixed and one similarly sized distinct
carry per day, an estimate including baseline TAR overhead and conservative
receipt/metadata reserves gives 27 carries at 977,592,172 hosted bytes and
993,437,259 TAR bytes. The estimated 28th reaches 1,003,955,269 TAR bytes and fails.
Reserves include a 1 MiB publication, 64 KiB per release receipt, 4 KiB per audit
asset for additional entries, 128 KiB fixed inner files, 270 KiB outer inventory
entries, 270 KiB additional inner TAR overhead and per-entry TAR padding.

This is a finite capacity estimate, not a 27-day guarantee. Ordinary data growth,
larger carries, receipt growth, filesystem/TAR overhead and the 128 MiB decoded
member cap can stop publication sooner. Every actual final candidate needs its
own physical/TAR measurement. No deletion, external storage, new provider,
scheduled work, source authority, UI authority or policy change is introduced.

## Verification scope

Focused tests cover unchanged identity form, exact restoration, strict mapping,
wrong roots, corrupt gzip, decoded bounds, extra paths, storage/canonical digest
binding, and aggregate decoded limits before restoration. They deliberately place
an app chart in every shard bucket and validate all 256 outer shards with the
unchanged browser validator, including many chart/audit-metadata collisions.

The production offline controller fixture runs R0 → C1 → C2 → C3, restores all
prior receipts and evaluations byte-for-byte, advances real fixture price data,
and lets financial availability expire on the original source clocks. This is
local controller verification, not new browser execution, certification,
deployment approval, or publication.

## Retained full-size R0 through C3 boundary result

The 2026-10-06 local boundary run used the exact retained capture at
`1e1943e1d5f78a738a05baa69eb9f2e8508e32ac` and its unchanged pack/verify modules.
It restored the original 1,980,234,183 logical bytes, then added the actual source,
base, three distinct 120,813,637-byte carry streams and append-only synthetic
release envelopes. Each carry has a different hash, evaluation time and synthetic
predecessor identity. Repeating one deduplicated carry was not used as a capacity
test. The [machine-readable measurements](financial-audit-codec-measurement.json)
record those hashes, exact inventories, bounds and verification scope.

| Stage | Hosted bytes, including bootstrap | Actual uncompressed TAR bytes |
| --- | ---: | ---: |
| R0 | 692,521,719 | 708,341,760 |
| C1 | 702,966,320 | 718,786,560 |
| C2 | 713,411,096 | 729,231,360 |
| C3 | 723,855,846 | 739,686,400 |

All four stages passed exact canonical and nested-reader recovery, all 256
captured-format shard checks, and the physical/TAR guards. All 19,597 original
logical files and 14,645 original captured gzip assets stayed exact. C3 retained
all nine audit members and left 260,313,600 TAR bytes of headroom.

A fresh process using the committed controller independently reverified and
restored final C3 after the publication-bootstrap accounting correction. Its full
canonical tree, including the 4,770-byte publication, was 2,396,185,885 bytes and
19,607 files. The conservative restore requirement was 2,579,963,702 bytes, with
4,894,883,840 available before recovery. The largest sampled validation allocation
was 3,246,698,496 bytes; this is a sampled disk observation, not a continuous peak.
The final verification process reported maximum RSS of 501,760 KiB. No strict
native-heap bound is inferred from that observation.

These are actual retained data bytes in explicitly synthetic, nonpublishing
authority envelopes. The original manifest generation and app/UI/source bindings
remain unchanged; the distinct carry streams are audit byte evidence rather than
active publication authority. No source acquisition, full financial recomputation,
browser launch, remote write or live publication was performed. The complete
production controller behavior remains separately covered by the offline CLI
lifecycle tests and the existing release gates.
