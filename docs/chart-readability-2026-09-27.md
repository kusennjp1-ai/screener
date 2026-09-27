# Chart readability redesign

Price, relative strength and volume now use separate panes in research charts (70/12/18). Only candles drive the research price autoscale; distant long averages can fall outside the viewport. SMA150/200 also use distinct dash styles. Legacy non-research chart layout is retained.

Inline and expanded charts share a decision summary using entryPlan, canonicalPivot and entryReadiness. Mobile places it below the chart. The expanded chart uses full width with criteria in a disclosure below, removes duplicate metric badges, and retains stock swipe versus chart pan mode. Buttons outside the plotting area select date-based ranges, zoom and reset; annotations can be hidden. Compact C1–C6 labels connect to percentages below the chart. Inferred base/VCP and historical crossings remain explicitly distinct from current purchase approval. No screening thresholds changed.

Missing analysis date/evidence previously allowed undefined equality to dereference missing calendar data. The readiness guard now treats absent evidence as unknown.

Validation: PC and 390px mobile browser inspection in light/dark; TGTX base-only and ADI four-contraction example, range and annotation toggles; static missing/empty/error fixtures and swipe/pan regression tests. Relevant 20 tests and lint (zero errors, eight pre-existing warnings). Production build passed. Full CI and Pages deployment checked after push.

The bd command is unavailable on this host. No data-coverage claims or book-fidelity pass-rate claims are added by this presentation change.
