# Market history and compact stock workspace

User request: show changes over time in market breadth, highs/lows, put/call and numeric RS; correctly track distribution days separately for the S&P 500 and Nasdaq; default daily charts to one year with horizontal navigation; explain volume comparisons; replace the long mobile stock page with a compact, expressive visual workspace; publish after verification.

## Ownership and implementation phases

1. Market history: inspect actual retained observations and their provenance, implement independent index distribution tracking with documented threshold and expiration rules, add time-series cards without inventing missing observations. Owner: `market_history_impl`.
2. Stock chart: one-year initial daily view, bounded horizontal navigation, numeric RS history distinct from the price-relative RS line, and clear volume comparison labels. Owner: `chart_rs_impl`.
3. Compact stock workspace: chart, VCP, purchase conditions, financial evidence, selection evidence and notes are mutually exclusive mobile sections. Existing detailed chart stays mounted so selecting a VCP interval can return to the same chart window. Owner: `compact_stock_impl`.
4. Independent integration verification: domain correctness, anti-pattern and code review, existing numeric/source contracts, keyboard/touch behavior, reduced motion, 320/390px dark/light and desktop screenshots. Fix discovered issues before committing.
5. Run repository quality gates, push, authenticate current design captures, publish through the existing workflow, verify the exact public identity and real public touch/cache flows. No weakened thresholds or fabricated review claims.

## Mobile presentation contract

- The section rail is a six-column icon + text control above the existing thumb actions; it remains reachable while scrolling. On the stock detail screen the redundant global market/chart/watch rail is hidden; the persistent top “候補一覧” action returns to the market, where global navigation remains available. Each target is at least 44px. Arrow keys, Home and End move the selected section.
- Only the selected evidence section is mounted. The chart stays hidden when another section is selected to preserve its view state. There is one page-level vertical scroll owner, without nested vertical panel scrolling.
- Opening a different symbol/date/method/generation returns the mobile workspace to its chart. Notes remain stored per symbol. Desktop retains the existing detailed comparison arrangement.
- The small sprout character communicates existing evidence: complete applicable conditions = bright, failed conditions = concerned, missing evidence = curious, excluded/not-applicable = resting. Exclusions take precedence. The visible label and expandable exact count explanation accompany every expression; it does not forecast prices or create a purchase recommendation.
- Character motion is a single brief entrance, disabled by `prefers-reduced-motion`. The character does not add an animation loop.
- Formula/source/character explanations and the optional price-position plan start closed. Unknown, failed and not-applicable results remain distinguishable.

## Verification evidence

Implementation evidence will be completed after integration verification. Targeted compact-workspace tests currently cover exclusive mobile sections, keyboard movement, chart preservation, identity reset, note preservation across widths, existing source/financial evidence contracts, and character unknown/exclusion precedence.
