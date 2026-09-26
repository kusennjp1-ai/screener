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
| Risk | 17 | 10 | 7 |
| Selection | 18 | 0 | 15 |
| Second-book fidelity | 14 | 18 | 1 |
| Total | 49 | 28 | 23 |

The initial pass count was 35. Repeated audits found and corrected premature size restoration, omitted first-book 3R protection, and a power-play drawdown denominator bug. The fixed 98% target remains unmet; unknowns are not passes and criteria have not been relaxed.

## Remaining work / evidence dependencies

- Continuous quarterly/annual financial histories, margin quality, revisions and catalyst disclosures need sourced data and point-in-time validation.
- Actual base boundaries, contraction evidence, volume behavior, stage, breakout date and post-breakout behavior are not fully certified by fixed windows.
- Historical leaders/new highs/new lows/setup success and account trade/position records are needed for validated dynamic total exposure. The manual workbench does not silently change the separate cash-first portfolio model.
- The portfolio's 7% stop and 20% target remain disclosed arithmetic examples, not individualized book-derived exit orders.
- Optional moving-average trailing, backstop rules, discretionary sell context and leverage/staging are incomplete.
- Recording coverage and key OCR numerals/figures are not equivalent to verified complete book transcription. Source recordings and full extracted text remain local, not public repository assets.

Do not mark the book-fidelity task complete until these evidence and implementation gaps are independently resolved.
