# External audit remediation — 2026-09-27

The supplied audit describes a real coverage/performance problem, but some findings predate the financial-history and conditional-readiness release (87a1338). Missing annual EPS no longer forces IBD to zero. Missing institutional sponsorship still prevents a strict CAN SLIM pass; it must not be demoted to a passing reference criterion.

## Changes
- Export lightweight OHLCV for all cached scan rows beyond the optional top-N chart selection. Independent verification and RS still exclude missing, inconsistent, short, or discontinuous histories. This is the verified published universe, not official all-US RS.
- Separate verified versus evidence-deficient rows with visible counts inside the selected liquidity scope.
- Split large book evidence into content-addressed per-symbol files, fetched for the selected symbol. Keep all actual rule inputs in the index. Repeated exports regenerate details from source data.
- Filter pre-evaluated candidates during search, with deferred input. Refresh manifest first; change the dataset only when its content generation changes.
- Use a single daily Setup Engine pivot (VCP fallback only if absent), including chart views, CSV and portfolio. Levels over 25% away from the daily price are excluded from entry calculations. This is an application guard, not a book-defined proof that a base does or does not exist.
- Prefer near-trigger setups among equally qualified names. Preserve qualification requirements and missing-data semantics.
- Main chart modal reads the same research row/rules instead of conflicting legacy Buy/Composite cards. Label legacy presets and aggregate scores as auxiliary computations, and harmonize the static exposure display with the new-cash model.
- Compact the mobile decision panel, expose top three unmet entry checks, expand desktop list height, suppress empty Themes columns, and format currency and UTC publication timestamps consistently in JST.
- Prefer a dated, unexpired NYSE session calendar for freshness; remove the arbitrary 36-hour weekend warning.

## Follow-up / limitations
- A UI-only deployment restores the previous daily artifact. Full cached-universe coverage takes effect when the backend daily export next runs; missing cache data cannot be fabricated. Report actual coverage, never promise 100%.
- Current financial-history collection prioritizes technically eligible names, not all 5,887 symbols. Point-in-time adjusted EPS and historical institutional sponsorship remain provider constraints.
- Selected-symbol Finnhub quotes do not supply a consolidated market-wide live volume feed or automatically recalculate the entire daily portfolio. Keys remain memory-only. No credential is read or logged during this audit.
- Legacy auxiliary screens have intentionally different filters. Their counts are not described as the book's independent qualification totals.
- bd is unavailable in this workspace; this document tracks remaining work.

## Validation
- UI release 36252793524 succeeded. Public 2026-09-25 compact index: 5,887 rows, 9,096,814 bytes (gzip measurement 959,847 bytes). Legacy details are fetched separately. The pre-expansion dataset still has 830 independently verified symbols, 315 of 1,938 liquid names; the UI discloses these counts.
- Local 2026-09-21 full-versus-compact comparison: all 23,544 assessments (5,886 rows × four methods) identical. Node benchmark: initial assessment 122 ms, average pre-evaluated filtering 2.9 ms across 100 searches; this is not a browser/phone timing claim.
- CI 36252792929: all 968 frontend tests, frontend smoke, backend quality gates and assistant smoke passed. Local follow-up tests cover chart pivot precedence, cache generations, legacy route labels, portfolio and detail verification.
- Browser validation: desktop and 390px mobile layout; SNDK chart/entry both use 1564.99 in the local snapshot; TXG's obsolete pivot is excluded; public delayed detail loading and the unexpired exchange-calendar freshness display verified. No live API key was accessed.
- Removed the redundant detail checklist that unconditionally marked earnings/base review unknown. The seven-condition dated readiness panel remains the one displayed purchase-readiness checklist.
