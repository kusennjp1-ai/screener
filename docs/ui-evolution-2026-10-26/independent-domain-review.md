# Independent domain and data-path review

Reviewed the market-history, numeric-RS and compact-character implementation against the user request. This is a code/data review and targeted verification, not final deployment approval or a physical-device usability study.

## Findings and fixes

- **P1 — fresh daily jobs could lose retained market history on provider failure.** The first collector implementation reused only an existing local `market-trend-source.json`; the production workflow creates a fresh combined bundle. The corrected workflow restores the previous published source before collection. Restoration validates the publication receipt, immutable transport, manifest hash, derived-series/source binding, source hash and dates. A successful pre-feature publication may seed the committed capture; network/integrity errors cannot trigger this fallback. The day-N+1 test starts with an empty directory, executes the real collector and independent exchange calendar with failed external providers, preserves the previous dated records, and leaves the new observation unknown. Tampering and rollback leave the destination unchanged or absent. Independently ran all five restoration tests successfully.
- **P2 — malformed RS history could crash the stock chart.** A null final point was dereferenced before validation, while `Array.some` skipped sparse observation/calendar slots. Added own-slot validation and safe final-point access. Four regressions verify null first/final points and sparse arrays keep the current number visible while withholding the invalid graph.

No remaining product-correctness blockers were found in the reviewed scope after these fixes. The new Python lifecycle test's local Linux runtime provisioning was separately flagged to its owner for the full-suite verification phase; CI already creates the pinned calendar runtime before frontend tests.

## Independent evidence

- Added `frontend/tools/market-history-transport.test.mjs`. The actual committed market source is projected by the production exporter, bound by the manifest, packed, independently restored byte-for-byte, and read through the production transport API. The two index series retain their distinct counts and all 63 Cboe observations. Both the raw market source and derived market series are proven identity assets within the authenticated inventory. A tampered payload is rejected.
- The same test preserves exact numeric RS observations, observation dates and a missing-session gap through both a compressed source-chart path and an identity canonical-chart path. Its RS values are explicitly synthetic transport fixtures; ranking correctness is verified separately.
- Independently calculated weighted returns from the actual downloaded OHLCV and used an all-pairs lower/tied-score comparison to check every available rank on three dates: 2026-08-05 (4,417), 2026-09-15 (4,450), and 2026-10-23 (4,480). All 13,347 observations agree with the produced histories within `1e-12`, including the per-date population. This corroborates the implementation agent's exact latest-rank parity check. Scratch evidence: `work/independent-rs-rank-check.json` in the parent task workspace.
- Focused transport, market producer, distribution, RS producer/consumer and character tests: **35 passed in 6 files**. Restoration lifecycle: **5 passed in 1 file**. ESLint for this review's changed modules and new test: no errors or warnings. `git diff --check`: no whitespace errors.

## Interpretation boundaries retained

The RS series is a retrospective calculation over the current verified publication universe, not an archive of contemporaneously published IBD ratings. Market breadth uses the current public chart population, with observed/expected counts; it does not claim to reconstruct delisted stocks. Cboe total-product volume is not every US options exchange. Basic distribution-day calculations are separate for the actual S&P 500 and Nasdaq Composite index series; they explicitly differ from IBD's editorial count, stalling and follow-through reset rules. Missing observations do not become zero or pass states. The character reflects existing qualification/readiness states and exclusions rather than forecasting returns.

Full repository gates, authenticated image review, public-site verification and physical-device/performance limitations are recorded by the subsequent integration/release stages.
