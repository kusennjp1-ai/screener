# Book fidelity implementation, 2026-09-26

This is a partial, auditable implementation, not a claim to reproduce the books completely or to reproduce official IBD selections.

## Implemented

- Separate Minervini profiles: first book 30% above the 252-session intraday low; second book 25%. The second-book entry-zone ceiling is 3%, distinct from the existing 5% comparison profile.
- VCP legacy fixes: two to six contractions, chronological duration, retained small final contractions, sequential depth checks, unavailable volume cannot certify contraction.
- Revalidated chart diagnostics: aligned 30/65-session RS endpoints, disjoint recent/prior volume windows, combined price/volume warnings, preliminary power-play windows. These are explicitly incomplete proxies, not pattern certification.
- Risk workbench: declared completed-trade returns, expectancy and realized payoff ratio, half-average-win stop guidance with an absolute 10% ceiling, retained attained-peak profit protection, distinct 2R/3R/twice-average-win review, stop-loosening detection, defensive loss/position budgets.
- Sticky defensive state: a flat trade or a single win cannot immediately restore size. Three wins and a positive cumulative mean is a disclosed application proxy, not an author-prescribed rule.
- Market overview: same-date verified-universe leadership counts and RS evidence coverage. No automatic exposure inference from index strength alone.

## Fixed fictional-monitor audit

Three independent agent reviews applied 100 fixed viewpoints (34 risk, 33 selection, 33 second-book fidelity). This is not 100 independently executed agents or real users. No claim that all recording pages were read without OCR omissions.

| Review | Pass | Fail | Unknown |
| --- | ---: | ---: | ---: |
| Risk | 31 | 1 | 2 |
| Selection | 20 | 0 | 13 |
| Second-book fidelity | 32 | 0 | 1 |
| Total | 83 | 1 | 16 |

The pass count progressed from 35 to 49 to 83 through repeated implementation and independent reviews. The fixed 98% target remains unmet; unknowns are not passes. Manual, sourced interval measurement meets the original measurement criteria but does not certify an unreviewed real stock. The second-book reviewer explicitly corrected an earlier overly broad interpretation of B25: the fixed criterion concerns separating the power-play financial exception, not proving every discretionary pattern automatically.

## Latest implementation loop

- Dated SEC normalization and financial evidence: filing cutoff, comparable quarter durations, four observations / three increases, EPS and sales YoY acceleration, **net-margin levels** (not margin YoY), annual EPS and inventory/receivables warnings. Annual EPS subtraction cannot manufacture Q4 EPS. Missing actual filings remain unknown. Local SEC requests returned HTTP 403; release automation also attempts the official public endpoint without bypassing access controls.
- Independent SPY OHLCV with exact exchange-session validation; rolling 200-day average direction and independent RS series. An unavailable benchmark is explicitly empty, never replaced with simulated prices.
- Actual reviewer-specified VCP intervals, final-contraction volume baselines, 3C, low-cheat and power-play measurement. Source, date and interval storage is local. Structural stop values are examples from the specified interval, not certified orders.
- New-high/new-low, price/volume and historical leader-cohort evidence. Missing sessions and insufficient rank universes remain unknown. Available charts are a selected subset, not the entire historical market. Proper-breakout dates explicitly reviewed by the user are stored separately from mechanical proxy events and can be listed in date order.
- Empty live and paper journals, separated storage, dated events, fees, whole-account exposure/risk, cash, monetary drawdown and strategy results. No prior trading history is required; future actual performance is not invented. The new journal does not change the separate cash-first illustrative portfolio automatically.
- Persistent dated MA50 observations and ratcheted close-based trailing evidence, distinct fixed backstop, prospective partial-sale/residual protection calculator, and context-aware post-breakout / early-versus-late warnings. None places or changes broker orders.
- Repeated reviews corrected missing-data-as-zero, skipped-session daily returns, partial-sale accounting, stop rounding, stale Code 33 flags, comparative-quarter durations, trailing-history loss and async input/result races.

## Remaining work / evidence dependencies

- S11/S12/S13/S14/S18: acquire and verify actual candidate quarterly/annual filings. Calculators and synthetic tests alone are insufficient.
- S15/S16/S17/S19/S20: adjusted EPS and one-time items, pre-announcement consensus, revision histories, balance-sheet business context and sourced catalysts need actual evidence. A TradingView subscription alone is not a general data API entitlement; CSV coverage must be inspected before using it as these data.
- S09: official RS universe/equivalence has not been established. Independent public-market estimates are labeled as estimates.
- S28/S33: actual reviewed base and power-play examples with boundaries, volume, weekly tightness and stage need validation; available manual tools do not make unreviewed examples pass.
- R31: historical counts of genuinely buyable setups are still missing. Fixed-window proxy counts and manually reviewed historical breakout dates are not substitutes.
- R33/R34/B33: full source coverage, omitted recording pages, switching-frame gaps and figure/numeral verification remain unresolved. Three unresolved coverage criteria alone prevent 98/100 even if every other criterion passes. Clear missing pages or lawful complete text/images are needed; repeating a synthetic audit cannot recover unrecorded content.
- The portfolio's 7% stop and 20% target remain disclosed arithmetic examples, not individualized book-derived exit orders.
- Real daily marks, executions, fees and the user's chart/context confirmations will be recorded prospectively. Margin, deposits/withdrawals, stock splits, dividends, tax and FX are not modeled in the local journal.
- Recording coverage and key OCR numerals/figures are not equivalent to verified complete book transcription. Source recordings and full extracted text remain local, not public repository assets.

Do not mark the book-fidelity task complete until these evidence and implementation gaps are independently resolved.
