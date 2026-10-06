# One-capture financial performance exception

This path can approve only the original financial repair captured at
`34ecbf507a4270f796078d669c21c373c0d1279a`, tree
`9331c7c06b54dc2ad54fabff3d6503f3b24a673b`, compiled UI digest
`8ce392f29270efbd7d7e47da996c4b7cff18eb550ab88b2243b3c1ef61a7a38f`.
The policy is not approval. With the three control records absent, this path
cannot certify or activate anything.

Design 37282323021 remains **failed**. Its exact eight failure strings, report,
134 screenshot hashes, score review, and original diagnostic metadata are retained.
P1 stays 3500/400/200 ms, Q1 stays 4200/480 ms, and radar stays 50 ms. The
historical review's `performance_exception_approved: false` and
`release_approved: false` fields are never edited. The exception is a separate,
later authority and does not claim that Design passed.

The original Actions runs used a pull-request API head of `0e2c0b6...`; their
executed synthetic merge capture is `34ecbf50...`. Both identities and the merge
parents are checked. Original CI has four successful quality jobs and a skipped
Docker publishing job, which is recorded as skipped. Every current-main controller
used for initial activation or exception-backed daily carry must independently
pass all five existing main CI jobs, including Docker publishing.

## Control records and integration order

1. Review and test the implementation. Preserve the original capture as an actual
   ancestor when integrating it; the workflows also fetch its exact Git object.
   No frontend, backend, projector, data, or original review bytes change.
2. Add `.github/financial-performance-approval.json` only after the exact controller
   code is final. It is a closed `financial-performance-approval-v1` record that
   identifies the one-capture scope and approval time, the original request,
   projection and preview hashes, the unchanged report/review and failures, and
   the complete original/current protected source inventories' digests. Its
   per-file before/after Git blob map must contain every change and may name only
   the finite controller files enumerated in the policy. The original protected
   inventory is not weakened or rewritten. The exact current nonperformance
   review must be present at the record's hash-bound documentation path.
3. Successful CI for that exact current main automatically starts Financial
   Performance Certification. No manual dispatch or publication occurs. The
   certifier rejects stale CI/main identities, skips an already successful
   certification for the same head, and stops if a candidate is already pinned.
   Its only output is `financial-performance-candidate-RUN-ATTEMPT`, retained
   for 14 days. Back up the exact certified artifact durably before activation.
4. Review the successful certifier attempt and immutable artifact. Add its exact
   `financial-performance-candidate-pin-v1` identity to
   `.github/financial-performance-candidate.json`. The pin-only commit needs its
   own normal CI and must preserve all protected code from the certifier commit.
   A pin alone does not authorize deployment.
5. After the before-publication review, add the closed
   `.github/financial-performance-release.json` intent with schema
   `financial-performance-release-intent-v1`, exact approval-file SHA-256,
   candidate-record SHA-256, and current predecessor identity. This explicit
   final control change can activate on the existing CI-completion publisher
   trigger after its own current-main CI succeeds. `ui_only=true` cannot activate
   the exception. An unrelated typed financial correction remains unsupported
   by this exception.

Neither control-only pinning nor enabling the intent changes protected source.
This avoids a circular requirement to know a future artifact ID while producing
that artifact. The certification source commit and later publisher source commit
are distinct and both are verified; publication UI source stays the original
captured SHA.

## Certification and publication proofs

The exact original diagnostic ZIP and Design artifact are fetched by immutable
IDs and SHA-256, with original PR attempt/job timing, expiry, repository and head
identity checks. Bounded extraction rejects traversal, duplicate members, links,
special files, unlisted authority files and inventory changes. The original
UNAPPROVED diagnostic is never promoted by changing its metadata.

Only missing audit material is reconstructed: original source/certificate and
predecessor archives, and the baseline produced by the captured exporter at the
original evaluation time. Its data hash must equal the original baseline hash.
The corrected UI/data directory is never rebuilt. Existing complete predecessor,
source certification, offline native projection replay, financial-only equality,
consumer compatibility, price history, universe and expiry checks run before a
separate exception candidate is sealed. The entire original Design ZIP is also
retained and rechecked, preserving screenshots, profiles, maps and the failed
report beyond the original diagnostic artifact lifetime. The same proofs run during activation
and immediately before both upload and deployment.

Initial activation requires a deadline no later than
2026-10-07T10:46:54.945Z, as well as the existing current compatibility/expiry
checks. This deadline does not renew any acquisition/evaluation clock. If the
source is too old or the predecessor has changed, activation fails closed.

Publication and financial receipts use the separate
`performance-exception-v1` approval. The live reader verifies the exact immutable
approval and original request at the certification commit, both complete Git
inventories, original PR CI/failed Design, and the successful certifier attempt
and required steps. Inner and outer approvals and activation candidate identities
must agree. The original projection, source and certificate must stay bound to
that approved request. An exception publication without its financial lineage
is invalid.

After activation, daily data carry retains precisely the approved UI and original
source lineage. It requires current-main controller CI at planning and both final
rechecks. Historical UI acceptance survives the activation deadline and normal
Actions artifact expiry; each new financial carry independently reevaluates the
original source clocks and may truthfully show unknown/expired values. New UI
bytes still require the ordinary exact-main CI and Design success gates.

## Verification boundaries

Unit and small offline CLI fixtures exercise contracts, transport identities,
strict receipt readers, mutation rejection, and daily carry. Synthetic GitHub
transport or small synthetic policy fixtures do not certify the real archive or
prove production deployment. Before enabling the final release intent, complete the
real immutable archive certification/lifecycle check, independent negative review,
final current-head CI, and a predecessor/source-freshness check. The earlier approval
record enables artifact-only certification; it does not itself authorize activation. The certifier has
read-only Actions/contents permissions and no Pages publishing permission.
