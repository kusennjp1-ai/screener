# Research feed: adopted ideas and boundaries

The product direction is a stock-research feed with explicit condition states.
It follows the request for a clearer, more social-feed/game-status style and
prominent fundamental conditions. Named states represent existing evidence;
they are not a new investment score. This document describes branch scope,
not completed release or performance acceptance.

| Adoption | Reason | Intended effect and boundary |
| --- | --- | --- |
| Stock cards with dated small price traces | Make identity, price context and the next research action readable in one place | Static SVGs use validated actual closes; a missing trace is explicit. No full chart request or interactive chart instance per card. |
| Visible EPS/sales and annual EPS evidence | Growth requirements were difficult to discover behind nested detail surfaces | Show actual/unknown, method requirement or reference, condition, period and source. Use the same current projection as filters, rankings, CSV and portfolio. |
| Persistent removable filter chips | Applied constraints should remain visible while the filter drawer is closed | Remove/reset uses existing filter state and preserves its semantics; no new default liquidity, capitalization or growth gate. |
| Separate formation-volume and latest-day volume evidence | Selected entry examples include both early/tightening and expanded-volume situations | Reuse measured contraction windows and dated daily volume. Dry-up never satisfies breakout volume; 1.4× remains an app proxy. |
| Canonical pivot separate from the validated 252-session high | A local entry level can be below a prior major high | High is context, includes the current session, and never replaces an invalid pivot. Book proximity guidance and method-specific app zones stay distinct. |
| EPS sign/comparison and explanation consistency | Positive percentage change can describe a still-negative EPS or turnaround | Preserve source comparisons as references while withholding ordinary positive-base growth qualification. Text and numbers share the same symbol, period, basis and snapshot. |

## Source use

- [ChartMill's Minervini-style screen](https://www.chartmill.com/stock/markets/usa/screener/minervini-stocks)
  informed the visibility of growth evidence and active filters. Its proprietary
  HGM, ChartMill RS, extra capitalization/share-volume filters and intraday-high
  expression are not copied into the canonical template.
- [ChartMill growth definitions](https://www.chartmill.com/documentation/fundamental-analysis/indicators-and-ratios/141-Fundamental-Growth-Filters)
  distinguish same-quarter prior-year growth from sequential-quarter growth.
  [Its HGM description](https://www.chartmill.com/documentation/fundamental-analysis/indicators-and-ratios/482-the-chartmill-high-growth-momentum-rating)
  motivates inspecting component evidence, but does not disclose enough to
  reproduce its weights. No HGM-equivalent score is claimed.
- [Monty's selected 2021 entries](https://monty-trader.com/2022/01/22/usic-2021%E5%B9%B4%E5%84%AA%E5%8B%9D%E8%80%85%E3%83%9E%E3%83%BC%E3%82%AF%E3%83%BB%E3%83%9F%E3%83%8D%E3%83%AB%E3%83%B4%E3%82%A3%E3%83%8B%E6%B0%8F%E3%81%AE%E3%82%A8%E3%83%B3%E3%83%88%E3%83%AA%E3%83%BC/)
  (published 2022-01-22, updated 2023-04-17) informed the separate formation and
  trigger presentation. These are the article author's retrospective
  interpretations of selected examples, not a complete trade ledger, verified
  fills/exits, or a basis for tuning numerical rules. The charts are not copied.
- [canslim.blog](https://canslim.blog/) supplied useful examples to audit EPS
  sign and numeric/text consistency. It is not used as a market-data provider or
  an authoritative replacement for source contracts and canonical predicates.

Curated resources such as [traderCharlieM](https://linktr.ee/traderCharlieM)
are kept distinct from method owners and primary sources. Personal ADR,
momentum and sell heuristics do not replace Minervini/O'Neil/IBD requirements.
Uninspected linked collections and videos do not establish rules or a verified
historical sample. Additional raw momentum diagnostics, ATR extension displays,
new growth filters and capitalization floors are deferred rather than inferred
from incomplete source/data coverage.

## Layout acceptance changed with the product

The former table layout measured twelve compact desktop rows, three complete
mobile rows and a chart within 160px of the mobile detail heading. Those
chart-first/table-density requirements conflict with the explicit new direction
to expose EPS/sales and condition evidence before the full chart. Their prior
results remain part of the review history.

The feed's replacement checks must establish visible first-card EPS and sales
actual/unknown, role and condition; named next checks/blockers; financial evidence
before the selected full chart; and preserved selection, Back, search, filter and
CSV state. Inspect actual desktop, 360px and short-screen pixels in both themes.
The numerical performance, payload, accessibility, 44px controls, readability,
comparison-layout and data-quality gates remain unchanged. A layout update is
not permission to lower those limits or claim empirical selection improvement.

See [the cross-surface acceptance matrix](static-consistency-acceptance.md) for
source/epoch/identity checks and the exact release evidence required.

## Card hierarchy and one-action evidence

The first feed capture repeated full provider, timestamp, calculation and daily
check explanations in every card. The refinement keeps each card's exact EPS
and sales value/state, required/reference role, condition and reporting period.
A neutral badge records source presence and the literal acquisition date; it
does not assert freshness or qualification. The card's evidence action opens
the selected summary with the full provider, timestamp, metric, basis and
comparison/rounding explanations. Browser acceptance compares these visible
details with the canonical published-row presenter after that real action.

The first feed run [37175649462](https://github.com/kusennjp1-ai/screener/actions/runs/37175649462)
failed performance: desktop/mobile method changes were 1,108/768 ms (400 ms
limit), and initial longest tasks were 284/297 ms (200 ms limit). Its controlled
baseline also failed at 622/632 ms and 341/343 ms. Exact diagnostic profiles
identified substantial accessible-role lookup and React rendering, as well as
desktop chart redraw. These observations motivate reducing duplicate card DOM
and reusing identical locale formatters; they do not establish a latency win for
the revised layout. Absolute budgets remain unchanged and require a new run.
