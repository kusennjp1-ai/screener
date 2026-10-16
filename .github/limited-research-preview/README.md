# Limited Research Preview v1

This is a separate, explicit, finite, manual UI-only publication scope. Ordinary
CI + full Design approval remains the default. No approval control is committed,
so the preview cannot activate from this change alone. The offline
`limited-research-preview.mjs` consistency helper is not publication authority.
The integrated publisher is `limited-research-publisher.mjs`.

## User-visible scope and tradeoff

The preview displays a permanent warning and labels CSV exports. Performance
failures are recorded by exact measured values. Original source dates remain
visible; stale or absent mandatory financial evidence remains unknown and never
qualifies. The first preview freezes the already admitted published data. Later
automatic price or financial updates are blocked while that UI is retained.
This is a material tradeoff against up-to-date prices and requires explicit
owner acceptance before activation. Exit requires a full-scope UI build passing the original complete CI and Design
gates and selected through the ordinary new-UI path; then ordinary
publication and data updates resume. A future narrowly verified price-only path
would be a separately reviewed scope, not part of v1.

## Capture and review

1. Land reviewed implementation with no approval file. Run CI.
2. Dispatch the separate Limited Research Assessment at exact current main.
   It restores only the authenticated deployed artifact, keeps original data
   bytes and dates, builds with Vite (no exporter/provider calls), and measures
   all existing functional/accessibility/visual cases. The same five named
   financial cases record their authentic current state; unavailable categories
   have explicit reasons. Original full Design failures stay failures.
3. Retrieve the immutable capture bundle. Independently review every screenshot
   from that exact UI, frozen data and actual scope. Keep all four review scores
   and reasons; each must be at least 8. Retain exact raw evidence bytes.
4. Obtain owner acceptance of exact scope, performance limitations, frozen data,
   original dates, and exit path. No message or field is fabricated here.
5. Prepare `.github/limited-research-preview/approval.json`, a closed
   `limited-research-release-control-v1` document. It contains the finite approved
   scope, exact capture run/job/artifact/hash, frozen financial identity, and raw
   string fields `assessment`, `review`, `screenshots`, and `notice`. Raw strings
   preserve hashes including whitespace. The approval has a maximum 24-hour
   activation window and exact predecessor/UI/data/evidence bindings.
6. Independent implementation/evidence review must pass before saving controls.
   Manually dispatch Research UI Release on exact current main with
   `limited_research_preview=.github/limited-research-preview/approval.json`.
   Other mode inputs must be empty/false. A stale executed workflow is rejected.

The publisher verifies immutable code, successful exact CI/capture jobs, capture
artifact origin/expiry, all raw hashes, screenshot review, actual frozen data,
current live predecessor and all existing correction/source holds. It composes
a UI-only financial carry with unchanged source lineage, generation, evaluation
timestamp, original evaluation bytes and price input. Only audit receipts are
added. It rechecks immediately before upload and deployment under the existing
serial publication lock. A second activation cannot reuse the predecessor.
Historical approval stays auditable after the activation window expires.

## Limits of local validation

Synthetic fixtures establish logic and fail-closed boundaries; they are not
live financial evidence, owner approval, browser acceptance or actual screenshot
review. No provider call, source admission, fabricated freshness, activation,
permission change or remote publication is authorized by this implementation.
