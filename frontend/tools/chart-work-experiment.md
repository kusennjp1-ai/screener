# Bounded chart work-avoidance experiment

The separate `Chart Work Avoidance Experiment` workflow runs only on the
`perf/avoid-redundant-chart-work` branch. It has repository/artifact read
permissions and no deployment steps. It cannot satisfy the release gate.
The normal CI, Design Acceptance, publication workflow and their limits are
unchanged.

The fixed baseline is `338a1191a223c403d6b649791abe1bf94149a2b4`, before both
changes. The candidate rejects already-offscreen candle obstacles before
converting their prices, and measures the chart toolbar only while visible.
Both production builds receive the same checked real input. The existing
acceptance measurement runs without modifications, recording all its failures.
The complete static-browser suite also checks keyboard, touch, repeated
navigation and action dimensions.

Run this comparison once after invariant tests and independent review. Inspect
all samples, source provenance, screenshots and failures. Do not rerun unchanged
code for a favorable result. Fewer coordinate calls and hidden layout reads are
specific work-avoidance invariants; they do not establish that the whole method
switch meets its budget. The Radar implementation is unchanged, so unrelated
Radar timing variation cannot be credited to these changes. Neither financial
rules nor displayed data are altered.

The experiment omits the separate subjective-review lookup because its new
images are evidence to review, not a release approval. Promotion still requires
normal CI, current-UI screenshot review, and the unchanged objective budgets.
