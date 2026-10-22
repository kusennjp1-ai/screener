# Explicit review of a completed historical capture

This lane separates measurement from its later human/image review. It never
changes capture timestamps, substitutes input data, grants financial admission,
or claims that a review-only commit recaptured the UI.

## Why a separate lane is necessary

The financial evidence UI displays the actual evaluation time. A new genuine
measurement therefore produces new PNG bytes even when rendering source is
unchanged. Committing a review and silently treating the next run's different
PNGs as reviewed is invalid. Freezing the clock or suppressing the displayed
time is also invalid.

Ordinary fresh capture remains the default. Historical acceptance is restricted
to a genuine `push` to this repository's `main` branch, using the existing fixed
baseline. Pull requests, dispatches, other baselines, changed material source,
and changed quote configuration continue through fresh capture.

## Explicit sequence

1. Include the lifecycle verifier, capture instrumentation, workflow, dependency
   pins, renderer fixes and any approved request archival BEFORE the genuine
   capture. Obtain a real post-fix PR capture and inspect its actual pixels.
   PR captures cannot be consumed by this initial main-only lane.
2. An independently authorized merge starts the genuine main capture. The
   measurement must finish with complete functional/accessibility evidence.
   Strict speed results may remain honest declared-policy warnings. A failed
   image-review step does not erase completed measurement. An `always()` step
   then stages and uploads the bounded immutable capture package. No financial
   admission or post-review publication seal is moved earlier.
3. Read the official completed run, exact attempt, workflow, job steps and
   artifact metadata. Download the named `reviewable-design-capture-<sha>-<attempt>`
   artifact and verify its actual ZIP SHA256 and byte size. Inspect every exact
   PNG and retain all original raw scores. Material clipping, unreadable labels,
   wrong visible content or navigation affordances still block. Only explicit
   non-screening cosmetic/originality findings may be advisory under the scoped
   image policy. Runtime behavior and financial truth are not inferred from PNGs.
4. Commit the complete explicit review at
   `docs/design-review/prior-capture-review.json`, optionally accompanied by
   `docs/design-review/prior-capture-review.md`. These are the ONLY two source
   inventory exclusions, and both must be regular non-executable Git blobs.
   All other tracked files, including all other Markdown/reviews, verifiers,
   builders, workflow files, locks and input contracts, remain material.
5. The review-only main push authenticates and evaluates the original artifact.
   It emits a distinct `reviewed_prior_capture` result with separate producer
   and consumer identities, original clocks and original strict assessment.
   It does not run a browser or pretend to have performed a fresh measurement.
   The existing final publisher must still validate its CURRENT data, financial
   freshness, truthful unknowns, mandatory qualification and publication guards.

Archiving an obsolete active publication request can separately enable normal
data routing, potentially updating data with the previously approved UI while
the new main Design capture is pending. Review that automatic effect and source/
consumer compatibility BEFORE merging. Do not race it, remove its guards, or
archive after capture merely to avoid source-inventory binding. Preserve the
original request bytes and expired windows; do not cancel pending financial
renewal or turn expired/unknown evidence into a pass.

## Review record

Use the existing scoped image-review fields and exact screenshot records, plus:

- `review_mode`: `reviewed-prior-capture-v1`.
- `observed_commit`: exact captured main checkout SHA.
- `evidence_run`: exact official `/actions/runs/<id>/attempts/<attempt>` URL.
- `capture`: an exact `reviewed-prior-capture-reference-v1` object containing
  `repository`, `workflow_path`, `run_id`, `run_attempt`, `head_sha`,
  `checkout_sha`, `source_inventory_sha256`, `configuration_sha256`,
  `artifact_id`, `artifact_sha256`, and `artifact_bytes`.

Populate pins only from the authenticated original package and official Actions
metadata. A record is not approval merely because its IDs look plausible. The
consumer recomputes both historical and current complete material inventories,
binds reviewer metadata to the exact historical producer, and checks all bytes.

## Package and fail-closed boundaries

The package contains original report, objective assessment, completion, input
provenance, all 134 ordinary or 162 carry PNGs, all 10 normal financial CSVs and,
for carry, the existing non-authorizing measurement seal and 10 carry CSVs.
CSV bytes are independently checked against report hashes, parsed headers and
the exact observed symbol row; carry declarations must also agree with the seal.
No data provider is contacted and no old CSV bytes are fabricated.

New captures serialize already-measured reduced-motion animation counts and
scan sparkline geometries. Old captures without those observations cannot be
retroactively completed. The functional validator requires unique expected
screen/chart/Daily/financial identities, complete metrics and axe observations,
actual geometry/keyboard evidence and honest unknown metadata. Missing fields,
duplicates, invalid numbers or observations cannot be replaced by `policy_exit=0`.

Official run/attempt/head/repository/workflow and artifact digest/size/name must
match. Canceled/incomplete captures fail. The only allowed producer failure is
its image-review step, while measurement, package and upload must have succeeded.
Unexpected failed/canceled/skipped required steps, altered clocks, changed
source/configuration, missing members, conflicting seals, path traversal,
duplicate ZIP members, symlinks, hardlinks, extra files and oversized packages
fail closed. Packages are bounded to 64 MiB per member and 256 MiB total/ZIP, with
14-day producer-artifact retention. Expired artifacts require a new genuine
capture; there is no unverified historical fallback.

Locked dependencies are installed before selection because the existing
observation contract imports React. The historical lane does not install a
browser or Python projection runtime. Existing read-only Actions permissions
are sufficient; no credentials, token scopes or security settings are expanded.

If source/configuration changed, selection requests a new genuine capture.
Once an eligible explicit historical review is selected, invalid review,
artifact or metadata fails the job, rather than falling back to recapture or
publishing an unreviewed result. The acceptance record explicitly states that
current data and current financial freshness were NOT validated by this lane.
