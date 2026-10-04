# Public static screener consistency acceptance

This matrix is a release checklist for the source-aware static application.
It does not certify the online SQL/API paths, historical profitability, or a
completed browser review. Record the tested commit, input manifest digest,
evaluation timestamp, CI run and screenshot manifest with each release. A
passing unit suite alone does not complete the matrix.

## Shared authorities

| Subject | Authority | Surfaces that must agree | Regression evidence |
| --- | --- | --- | --- |
| Current financial value | `financialCurrent.js`, validated v2 proof and explicit evaluation time | Feed, detail, legacy scan filters/sort, Research rules, CSV, portfolio | `financialCurrent.test.js`, `financialCurrentConsumers.test.js`, `export-financial-current.test.mjs` |
| Method qualification | `researchEngine.js` evaluated on projected rows | Counts, rankings, rules, candidate history export, CSV and allocation eligibility | `researchEngine.test.js`, `research-quality.mjs`, `check-data-quality.test.mjs` |
| Financial wording | `financialEvidencePresentation.js` receives the same row and assessment | Feed summaries and expanded financial evidence | `financialEvidencePresentation.test.js`, component tests and browser financial-evidence fixture |
| Selection versus entry | Technical/method assessment and `entryReadiness.js` are distinct | Feed status, detail, chart, purchase-condition explanation | Candidate guidance, entry-readiness and chart decision tests |
| Price levels | Canonical pivot and verified price audit | Entry band, stops, chart, setup evidence and CSV where exported | Pivot, entry-plan, readiness, price-audit and setup-evidence tests |
| Volume | Dated contraction interval versus verified latest-day volume | Formation evidence, daily trigger and chart annotations | Book technical evidence, entry-readiness and setup-evidence tests |
| Current bundle identity | Symbol, market, as-of, generation and evaluation epoch | Worker results, selected detail, open views and navigation | `researchWorkerPackets.test.js`, `useResearchBundle.test.jsx`, `useFinancialClock.test.jsx`, navigation and adapter tests |
| Serialized publication | Explicit export epoch and exact encoded rows/summaries | Initial index, full detail, workbench, CSV and derived rankings | `export-financial-current.test.mjs`, `check-data-quality.test.mjs`, actual-data exporter replay |

All frontend source tests above are under `frontend/src/static`, its component
subdirectory, or `frontend/tools`. The release runs the complete frontend suite;
the names in the matrix identify meaningful coverage rather than replace it.

## Required adversarial cases

- Keep unavailable, expired, invalid, failed and genuine zero distinct. Unknown
  source facts cannot satisfy a growth filter or become a financial rating.
- At an expiry boundary, rebuild the rows, counts, rankings and portfolio at
  one epoch. Withhold old results while the replacement is pending. Recheck on
  focus and visibility restoration as well as an open-view timer.
- Switching symbols or publications must clear the former stock's evidence.
  A late response, including one from the same date but another content
  generation, cannot populate the newly selected stock.
- Preserve fresh EPS loss narrowing and turnaround as explicitly sourced
  references. They remain unknown for ordinary positive-base growth thresholds.
  Preserve the distinction between Basic and Diluted EPS, sequential quarters
  and year-on-year comparisons, and clipped and ordinary rounded percentages.
- A source acquired after the price snapshot may be current at evaluation.
  It cannot be labeled available at that historical snapshot's publication.
- Preserve raw historical values separately. A detail merge or old compact
  index must not restore an unproven scalar, cached pass summary or old ranking.
- Preserve the method distinction: Minervini's technical template is not the
  complete SEPA process. Reference financial facts do not silently become new
  required conditions; existing O'Neil/IBD requirements retain their meaning.
- A contraction-volume observation cannot satisfy a breakout-volume condition.
  A reference major high cannot replace an absent canonical pivot. Chart
  annotations using later extrema confirmation remain retrospective diagrams.

## Release record

For each candidate UI commit, retain these results together:

1. Full frontend tests, lint, relevant backend source/storage/export tests and
   standalone frontend/Docker build. PostgreSQL integration results must come
   from the actual database CI service, not a local skipped test.
2. An immutable real input replay through export, candidate history and data
   quality checks. Compare every serialized method summary with its canonical
   assessment at the declared export epoch and recompute current decisions at
   the separately declared current epoch. Retain the input SHA and row counts.
3. Old/new bundle roundtrips, source-expiry and delayed-response tests; exact
   current financial values, unknown states, rankings, CSV and portfolio parity.
4. Actual browser screenshots for all supported methods, desktop/mobile and
   themes, including stale/missing evidence and short-screen navigation. Inspect
   the pixels and bind reviews to the observed commit and image hashes.
5. Existing accessibility, geometry, payload and CPU budgets without relaxed
   limits. Record failures separately from visual scores and source correctness.
6. Exact same-commit normal CI and Design Acceptance success for new UI
   publication, followed by the existing data/provenance release gates. Data-only
   updates preserve the approved UI bytes. Verify the resulting live receipt and
   assets before claiming a release.

The approved research-feed default is 20 cards per page, with an optional
50-card page; full validation, rankings, filters, counts and CSV retain the
entire universe. The default must meet the original P1/Q1 limits. Retain the
optional50 cold-load results separately with those same limits and explicit
failures; its budget misses are not labeled passing or used to override the
approved20 release criterion. The legacy dense50 control is measured once per
viewport in the same run and reused for both current workloads. It is a
different product default, not an equal-DOM comparison. D9 uses the versioned
production style context with its existing 207-point, 50 ms, three-run gate.
See [the measurement protocol](research-feed-20-performance-protocol.md) for
committed-DOM witnesses, historical conditions and capture/input provenance.

A material mismatch at any surface blocks promotion until diagnosed and fixed.
Use incomplete/unknown wording for missing evidence; these checks establish
software and source consistency, not superior stock-picking performance.
