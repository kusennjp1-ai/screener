# Indicator-history artifact preview admission plan

Status: owner-run artifact previews are in review. This worker prepares local
commits; the owner owns remote admission. No provider acquisition or deployment
is part of this preview.

## Proposed isolated branch job

Workflow: `.github/workflows/market-indicator-preview.yml`.

- Trigger only a push to `preview/market-indicator-histories` in `kusennjp1-ai/screener`, with matching repository/event/ref guards in the job and executable controls.
- Repository permission only `contents: read`; checkout does not retain credentials.
- No URL/hash inputs. `.github/market-indicator-preview-input.json` pins
  `https://kusennjp1-ai.github.io/screener/` and publication SHA-256
  `0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a`,
  release #99, run `37456692717`, attempt `1`. Executable controls reject changed
  pins, source overrides, other repositories, branches and event types.
- No private Actions-artifact download or Actions read permission is needed.
- A changed receipt, transport root, manifest, leaf digest, source identity or
  required real sample aborts the job. There is no unpinned/latest/raw fallback.
- Read only the existing application's static publication. No market-data API,
  SEC/OpenFIGI acquisition, cron change, provider credentials or licensing change.
- Build only a separate preview containing the actual imported components.
  `publicDir: false`; the preview has no production receipt or publication authority.
- Run Chromium only in the admitted GitHub Actions job. The capture entry point
  exits before loading the browser outside that environment. No local-browser retry.
- Upload the site, screenshots, source provenance, sample CSV, payload report and
  browser/accessibility/geometry report as a 14-day review artifact, even on failure.
  No Pages artifact or deploy action, release mutation, git push or PR operation.

After owner admission, the owner pushes the reviewed commit to the exact isolated
branch above. This worker does not perform that push. Record the resulting run ID,
attempt and head SHA, then verify that artifact
metadata and the screenshot report name that same head SHA. Review the images
before considering any separate publication request. The workflow does not grant
publication permission.

## Surfaces and truth labels

The wrapper renders `MarketIndicatorHistories`, `CandidateBoard` and
`ResearchDetail` directly from the checked-out application. Charts in the stock
component receive the exact verified sample data through its existing React Query
cache. This isolates visual rendering; it is not a full production bootstrap or
publication-admission test.
The wrapper imports the same research, foundation, motion and workbench style
order and research theme as `StaticLayout`. The candidate list and stock detail
use the production grid, so sticky positioning stays inside its intended column.

Viewports: 1440×900, 390×667 and 360×568. Each viewport captures:

1. Real-source high/low chart and accessible table, with original changing coverage.
2. Real-source PCR and ordinary distribution feeds explicitly unavailable.
3. Real-source six-stock current entry positions; first-observation crossings unknown.
4. Method and below-pivot approach changes.
5. Actual stock detail, history tab, quarterly holders and base-stage history.
6. A separate, conspicuously labeled synthetic panel for PCR zero-denominator gaps,
   distribution expiry/missing volume, and below/above-pivot crossing rearming.

The job produces 27 full-page captures plus three short viewport base-history
captures. It checks runtime errors, page overflow, error overlays and serious
accessibility violations. Real and synthetic screenshots use distinct filenames,
banners and data scopes. Synthetic observations never appear in the real series.
Expanded history tables must be reachable from their disclosure with Tab and
scroll with arrow keys on each overflowing axis. The report records those checks,
offending overflow elements, and full Axe node selectors/HTML/check data. No Axe
rules or severity thresholds are excluded. Chart tooltips and legend labels use
the active theme's text and background colors.

Real samples are NVDA, AMD, AAPL, AVGO, TSM and PLTR from the hash-bound source.
The market high/low series retains its original published-chart universe; current
entry-position counts are explicitly only these six selected real samples. Their
past entry observations are not invented. The global browser clock is unchanged;
all fixed historical/current-source evaluations show the source timestamp. Price
session, publication generation, scalar-proof observation dates and evaluation
time are separate. The reviewed input has October 2 prices and October 4 financial
observations, even though its evaluation timestamp is October 6. The separately
validated, unpublished October 6 renewal is not an input. No old/current-state
reference is turned into a dated real entry event. Existing Design/performance
gates remain mandatory; prior financial-repair acceptance is not feature approval.

## Local checks performed

On the read-only reviewed packed candidate with manifest SHA-256
`ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0`:

- The adapter verified and loaded all six sample identities and chart audits.
- The actual deployed #99 receipt is 766,121 bytes. An exact compressed regression
  fixture verifies its SHA-256 and source bindings under a bounded 1 MiB receipt
  limit; leaf reads remain capped at 128 MiB. A selective 26.2 MB extraction from
  the actual uploaded #99 artifact successfully exercised the full adapter and
  sample preparation path, rather than just the smaller prepublication receipt.
- Existing qualification output stayed identical for all four methods; only the
  three explicitly named base-estimate CSV columns differ.
- The isolated preview production build succeeded without launching a browser.
- Adapter tests reject unpinned, credential-bearing, query-bearing or changed input;
  the browser entry point rejects execution outside admitted CI.
- Read-only full-cohort projection: 5,901 rows, 4,485 verified charts, 1,416 unavailable
  charts, 2,820 usable base-stage estimates, 157 seconds, approximately 490 MB peak RSS.
- Research index before/after: 4,593,565 → 4,629,326 raw bytes and
  975,648 → 978,386 gzip bytes. The unchanged limits are 8,000,000 / 1,000,000 bytes;
  gzip headroom is 21,614 bytes. Detail history envelopes add 15,065,457 raw bytes.

This is a source-bound derivation and index projection, not a complete production
exporter replay. The workflow intentionally fetches only the six-stock visual
sample rather than downloading thousands of charts again. The full-cohort option
is available to the preparation command for an already-restored local bundle.

## Reproduction without a browser

Set `INDICATOR_INPUT_DIRECTORY` to the read-only packed root and
`INDICATOR_PUBLICATION_SHA256` to the independently computed receipt digest.
Set `INDICATOR_PREVIEW_OUTPUT` to a separate writable output directory. Run:

```
node --test .github/scripts/indicator-preview/input.test.mjs
node .github/scripts/indicator-preview/prepare.mjs
node .github/scripts/indicator-preview/build.mjs
```

Set `INDICATOR_FULL_COHORT=true` for the read-only full-universe index projection.
Do not run `capture.mjs` locally; that route remains closed.
