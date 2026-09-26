# Chart readability and evidence-based daily entry review

Removed the unconditional portfolio hold. The research model now checks selection, market, completed NYSE session, price versus pivot, prior-50-session volume, automatic base candidate and dated upcoming earnings evidence. Passing all checks enables the daily-ready label, not a fabricated live quote or fill. Ready candidates receive allocation priority.

Calendar and earnings evidence refresh on each Research UI Release, including successful daily-export-triggered releases. Missing, ranged, expired or failed earnings data remains unknown. Local acquisition returned 50/50 dates; production coverage must be checked after deployment. Seven-day earnings avoidance, 1.4x volume and 0–5% entry range are disclosed application settings, not claimed verbatim book rules. Base detection remains heuristic; IBD filters remain an independent proxy, not proprietary list reproduction.

Chart candles and volume use green/red; long moving averages use blue/slate/lavender with light-theme contrast. Removed redundant EMA/EPS lines in book mode, old colored bands and the redundant buy checklist. Narrower sidebar preserves chart width. Smartphone horizontal gestures change symbols; vertical/short/slow gestures do not. Chart pan/zoom is opt-in on mobile.

Validation: targeted regression tests for readiness and allocation, swipe handler integration, chart annotations and rendering; Python earnings-date normalization; lint (zero errors, eight pre-existing warnings); build. Browser inspection at desktop and 390x844. Release additionally runs 100 synthetic task profiles, not 100 independent human reviewers.

Remaining: intraday quote endpoint is not configured; daily evidence cannot validate an execution-time price. Automatic shape candidates do not certify the full book methodology. Missing financial observations stay unknown. No change to previously reported full-book audit score. No real trades executed.
