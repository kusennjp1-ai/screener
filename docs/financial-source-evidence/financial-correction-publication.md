# Audited financial correction preparation

The `financial-correction-v1` path is **prepare-only**. The Research UI Release
workflow validates and retains a candidate; its correction branch never uploads
a Pages artifact and never deploys. Ordinary advancing data, new UI approval and
metadata migration keep their existing paths. Untyped manual dispatch can no
longer replay and enrich the same approved UI and price date.

## Authority and ownership

Dispatch `financial_correction` is a closed JSON intent with exactly:

- `schema_version`: `financial-correction-v1`
- `kind`: `financial_source_correction`
- `reason`: `audited_statement_source_recovery`
- `previous_publication_identity`: exact deployment run/attempt/receipt/manifest identity
- `source`: repository, allowlisted workflow, full head SHA, run ID and attempt,
  immutable artifact ID/name/ZIP SHA-256, archive manifest SHA-256, original
  acquisition base SHA-256 and cohort SHA-256

The controller resolves immutable attempt endpoints and successful jobs itself.
A nested source-provenance file identifies prior seed history, not the outer
capture run. Artifact names, creation interval, expiry, duplicate inventory,
repository, head and ZIP bytes must agree. No success flag or generic equal-date
bypass is accepted.

The current live artifact is always the correction base. Its entire data bundle
and UI identity are retained. Missing prior bytes, a superseded predecessor,
missing approved consumer hook or failed/skipped/incomplete CI job rejects the
candidate. Both exact controller CI and the already approved consumer's exact CI
and Design Acceptance jobs must pass. Code in the controller checkout cannot be
copied into the separate consumer checkout to manufacture compatibility.

The Python adapter calls `load_archive` and `project_symbol` offline on original
frames and receipts. It binds the original acquisition base/cohort separately
from the current target publication/base. All original price/liquidity inputs
and the complete symbol/market/date set must match. It projects the full explicit
cohort, including unacquired symbols with explicit null values. It never trusts
collector result summaries as financial evidence or performs provider requests.

The content-addressed overlay owns every contracted financial scalar, alias,
context and annual/quarterly series for its symbols. Null means unavailable; no
old scalar, envelope, history, rating, scanner score or chart alias can provide a
fallback. Original raw receipt bytes and original quarterly/annual capture clocks
remain in the source archive. An October 4 observation at an October 2 price date
is current knowledge, not point-in-time knowledge from October 2.

`instrument_applicability` distinguishes the three independently sourced fund
registry entries from ordinary unverified instruments. Compatible observed names
and available identifiers are checked; missing/conflicting identity quarantines
a registry match. Neither not-applicable nor quarantined instruments acquire
corporate financial pass states. Registry identifiers are not claimed to be
reconciled with the ticker-bound price or statement receipts. Price-universe
membership and technical history remain intact.

## Offline execution and verification

The controller sets a single actual `FINANCIAL_EVALUATED_AT` and invokes its own
`backend/app/scripts/export_statement_projection.py`, then runs the approved
consumer's exporter with `FINANCIAL_CORRECTION_PROJECTION`, its exact SHA-256,
`FINANCIAL_CORRECTION_TARGET_IDENTITY` and target-base SHA-256. All normal network
enrichment, statement refresh and price repair steps are skipped.

The approved helper independently recalculates current financial projections,
scan/filter/sort aliases, summaries, qualification audit, daily candidates,
portfolio and current workbench identity. Recheck uses the actual current clock,
so an expired proof cannot retain a build-time exemption. The full content-addressed
research index still has the 8 MB raw / 1 MB gzip budget. Existing data quality and
retained-universe requirements remain 90%; financial acquisition coverage is not
a replacement gate.

The controller independently compares full chart histories, OHLCV and adjustment
context, original chart aliases, home/benchmark/sector and all other nonfinancial
data. Hash-addressed generated paths are compared by stable symbol/asset identity.
Mixed files allow only explicit financial ownership or outputs independently
recomputed by the approved consumer. Changes to untouched files are rejected.
Every old candidate catalog and snapshot remains immutable; historical selection
and performance attribution are not recalculated from newly learned financials.

The correction receipt hashes its projection, selected original receipt inventory,
policy/projector identity, original clock bounds, exact predecessor, full data
inventory, successful controller/consumer job identities and compatibility report.
To avoid a circular self-hash, its data inventory excludes only that new correction
receipt. `publication.json` binds the complete final inventory including the new
projection and receipt. Recheck validates the source ZIP, local binding files,
final inventory, consumer compatibility and live predecessor again.

## Review and activation boundary

Preparation retains an immutable candidate artifact plus source/predecessor audit
material for 90 days. This is **expiring operational retention**, not a claim of
permanent storage. Before any future activation, an operator must independently
retain and verify the exact final source ZIP/archive, full predecessor bundle,
projection and correction receipt in durable private storage. Keep private storage
IDs and links out of the repository, public receipts and CI.

A separate reviewed promotion mechanism must bind the exact prepared artifact's
repository/run/attempt/ID/ZIP digest and candidate receipt digest, repeat all
predecessor/UI/proof/price/quality checks, and record the new publication identity.
The separate [coordinated activation implementation](financial-release-activation.md)
requires an exact retained-candidate pin and normal gates; the v1 correction branch remains
prepare-only. A boolean assertion
that backup or review succeeded cannot authorize it. Rebinding to another live
predecessor requires a new intent; an already-applied identical intent is a no-op.
