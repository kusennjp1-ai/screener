# Financial audit retention across ordinary carries

The current v1 financial release receipt is unchanged. Its publication envelope
now includes `financial_audit_files`, a path-to-SHA-256 map covering every actual
content-addressed `source-projection`, `source-base`, `carry-projection`, and
`release` JSON file in `static-data/financial-corrections/`.

The older financial-correction `receipt-`/`projection-` directory is outside this
release inventory. Its existing workflow remains prepare-only. Any future
promotion of a mixed directory fails on unknown audit paths and requires an
explicit compatibility review; those files are never silently discarded.

The map is optional for an existing original activation. Its authenticated active
release, original source/base and evaluation references seed the first indexed
carry. A legacy carry without a map is rejected: its current references cannot
prove which original activation or older evaluations have already been lost.
The controller never fabricates or silently reconstructs missing history.

Every subsequent carry restores all declared audit files into a clean directory,
checks each content hash, and retains the previous map before adding its new
receipt and evaluation. Missing files, lost entries, mismatched hashes, duplicate
JSON keys (including escaped aliases), unsafe names, links, hard links, and
special files fail closed. Inventory comparison ignores object-key order. A map
is bounded to 1 MiB, the full publication metadata remains bounded to the
browser's existing 4 MiB. Audit recovery uses the existing 128 MiB per-file
transport limit and 8 GiB decoded archive limit. The full reconstructed
publication, including ordinary app data, shares that archive limit. The final physical tree and its
actual uncompressed TAR are checked after receipts and metadata are written and
again in the existing prepublication recheck. No payload limit increases.

These fields preserve audit bytes only. They do not renew source observations,
change financial formulas, make expired values current, alter the price ledger,
change a consumer, or grant activation/renewal authority. Both performance
exception versions continue to use `financial-release-receipt-v1`; no renewal
schema, controller, producer, registry, or policy is introduced.

The focused tests exercise a fresh R0 → C1 → C2 → C3 restoration chain and the
actual production controller CLI through three ordinary price advances. They
check that the original R0 receipt remains readable and each earlier evaluation
and receipt remains byte-identical. Packed exception-v2 carries, unchanged
browser publication parsing, existing approval/source/price gates, and the
1 GB payload guard are separate regression checks. Tiny fixtures are offline
controller tests, not new source certification or real deployment authority.

This controller-source change alters the protected code inventory. Existing
sealed inputs remain evidence of their original capture; the release owner must
perform the existing exact-controller rebind/review before activation. This
backport does not modify a control pin, approval, provider schedule, or deployed
publication.

## Raw representation capacity boundary

The retained capture's actual native projection is 38,219,744 bytes (SHA-256
`a93042a6f6ad40c9bbf0f518bf5580d1a1a014e2fc70380569edcde76c965b9a`). Its
target base is 15,281,559 bytes (SHA-256
`94d3f1f08869fe625c678e64c1699bf024050c7a5208847168a67c3c0e2b8b27`). The
optional byte-only smoke assembles an explicitly synthetic activation envelope
using these exact retained bytes and restores all three immutable assets into a
clean directory. It does not recompute financials or manufacture market data.

Against the reported 687,232,801-byte packed UI/data baseline, those two source
assets leave at most 259,265,896 bytes below 1 GB for every carry evaluation,
receipt, metadata field, new-data growth, and TAR overhead. An actual-data byte measurement on the unchanged retained October 2 target
produced a 120,813,637-byte carry (synthetic publication identity, no new price
observations or fabricated timestamps). The estimates excluding receipts and
TAR overhead are 861,547,741 bytes for C1, 982,361,378 for C2, and 1,103,175,015
for C3. Thus C3 certainly exceeds the cap; C2 has only 17,638,622 bytes of
headroom before receipts, metadata, TAR overhead and real data growth. It is not
proven publishable by this arithmetic. The tiny three-carry tests therefore establish
retention correctness only, not real-cohort multi-day capacity. The final guard
must reject any carry exceeding either physical or TAR limits.

The separately reviewed narrow codec reuses the existing lossless transport for
source/base/carry JSON while retaining small release receipts as identity files.
See [the nested codec contract and finite measured headroom](financial-audit-transport.md).
No history is removed, no format is weakened, and the captured browser stays
byte-identical. Compression provides finite headroom; it is not unlimited storage.
