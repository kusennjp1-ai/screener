# September 28 audit remediation

The external audit identified real regressions: mismatched table cells, repeated whole-universe portfolio evaluation on the 15-second clock, period controls resetting, compressed RS, hidden weekly controls, and missing-value percent suffixes. Changes preserve strict selection requirements and do not relabel missing institutional data as a pass.

## Data integrity

- AMD's old 2026-08-24 bar has high 468.14 below **open** 468.54 (not below close). Fresh Yahoo history returns coherent OHLCV. The observation supports stale/inconsistent histories, but does not establish which provider changed in April.
- KLAC's June 12 10:1 split is confirmed in its issuer filing. Fresh vendor history already adjusts the pre-split prices and volumes. No inferred split factor is applied again.
- `repair-price-history.mjs` replaces suspect series only with a full, symbol-matched vendor history passing date, OHLCV, 252-bar and continuity checks. No widening high/low, skipping bad sessions, or changing pass thresholds. Reports retain old/new SHA-256, retrieval time and split events. Failed replacements remain excluded.
- Old Setup Engine pivots/readiness/confidence built from replaced histories are withheld until a full scan rebuild. RS and independent technical evidence are recalculated. This recovers verification coverage without declaring stale setups buyable.
- Both daily and UI publication pipelines repair histories, then stop publication below 90% daily verification in the liquid universe. Exported method summaries must reproduce the canonical full rule function. This is a data-quality threshold, not a user-satisfaction or book-fidelity score.

## Performance and interaction

- Full method assessments are computed during export; browser sorting uses versioned summaries. CSV and detail validation still use the canonical rules.
- Portfolio preparation runs once per immutable rows snapshot. Clock ticks only update current-time checks and the small candidate plan. A regression test asserts that the 15-second tick does not read prices across 1,000 rows again.
- Each research row carries its chart path; the legacy index is requested only after an older bundle lacking embedded paths loads.
- Logical date indices drive range buttons; initialization waits for all daily/weekly panes to replace their time points. Weekly averages use 10/30/40 weeks. RS gets a visible-period scale. Mobile defaults to 63 sessions.
- Latest moving-average values remain readable above the chart. Pivot captions are outside the candle/axis area; contraction labels anchor to troughs with connector lines. Missing EPS displays `—`.
- Chart switching explicitly clears previous-symbol query placeholders.
- SLAB has an issuer-confirmed cash acquisition agreement. It is excluded from purchase plans and demoted in watch rankings. Other 60-session ranges below 5% are marked low variation / watch only (a disclosed application risk setting, not a book rule). Strict book-condition counts remain intact.
- The portfolio's primary count now uses the same $10 / $20m liquidity universe as the default candidate list.

## Verification and remaining scope

Local 5,886-row benchmark: method sorting 14–32 ms; clock plan mean 1.78 ms over 100 updates. These are Node measurements, not a claim of a four-times-throttled mobile browser result. PC range controls and daily/weekly switching were operated in the browser. Mobile checked at 390×844; document width stays 390 px and the chart defaults to three months.

The source of the older inconsistent backend cache still needs ingestion-level diagnosis; the publication repair prevents those rows being silently accepted. Detailed scan payload reduction, point-in-time forward-return tracking and watch notifications remain separate work. CAN SLIM requires actual institutional-ownership evidence; zero full passes must not be fixed by waiving I. A one-condition-away view is a watch aid, not a replacement for that evidence. A fixed -7% line is an example risk rule, not a chart-derived structural stop; it is not added as an automatic sell instruction.

Sources: [Silicon Labs acquisition announcement](https://investor.silabs.com/news-releases/news-release-details/texas-instruments-acquire-silicon-labs), [KLA issuer filing](https://ir.kla.com/sec-filings/all-sec-filings/content/0001193125-26-212093/d116682dex991.htm).
