# One new packed financial capture

The packed exception mechanism ships disabled. Its v2 policy has `enabled: false`
and `capture: null`; there are no v2 approval, candidate pin, or release-intent
records. This state cannot certify, activate, or authorize a packed publication.
The original v1 policy and its historical approval semantics remain unchanged.

An enabled v2 policy must describe exactly one newly reviewed packed capture:
its executed Git commit/tree/UI digest, PR head/base and CI/failed Design attempts
and jobs, original diagnostic and Design ZIP identities/hashes, report/review
hashes, full screenshot key set, unchanged timing failures and budgets, transport
seal hash, and bounded activation deadline. Only P1/Q1/D9 timing misses qualify.
Incomplete measurements, interrupted diagnostics, accessibility findings, and
geometry or other nonperformance failures do not qualify. The original report
and review retain their failed/unapproved flags. Enabling a policy alone grants
no publication authority.

The three independent v2 control paths are
`.github/financial-performance-approval-v2.json`,
`.github/financial-performance-candidate-v2.json`, and
`.github/financial-performance-release-v2.json`. Their closed schemas end in
`-v2`. The approval additionally binds `transport_sha256`; the sealed
`financial-performance-candidate-v2` record carries the same hash and its archive
contains the exact `transport.json`. A retained v1 pin cannot skip v2
certification. Two release intents fail closed. Historical receipt verification
does not consult current activation controls.

Once v2 is bound and certified, keep that policy immutable so historical
receipts and ordinary carries can still resolve their original authority.
Stopping a pending activation removes its release-intent record; it must not
reset the policy to disabled or replace its capture. A later exceptional capture
requires a separate policy version and its own review, never reuse of v2.

The operational order stays approval, read-only artifact certification, reviewed
immutable pin, then explicit release intent. Certification and initial activation
rerun the existing source/certificate, original-price, predecessor, protected-code,
native projection replay, financial-only equality, and expiry proofs. Both final
publisher rechecks still run. Packed activation retains every captured original
logical and encoded byte; only the prescribed content-addressed audit additions
may be appended. It cannot accept a v1 capture merely by repacking it.

After publication, `performance-exception-v2` can carry only that exact UI and
original financial lineage. Each carry needs current-controller CI, preserves
original source clocks, and independently evaluates expiry. Historical UI
acceptance survives the one-time activation deadline; future UI changes require
the ordinary strict CI and Design gates.

Before a real release, bind the final capture only after its full nonperformance
review. Run the retained-input activation/carry rehearsal with its real source,
certificate, predecessor, and packed diagnostic archives, preserving its explicit
synthetic next-price-day labeling. Synthetic unit and carry fixtures do not
replace this rehearsal or certify production approval. Then verify the exact
main certification artifact and fresh predecessor/source evidence before adding
any release intent.
