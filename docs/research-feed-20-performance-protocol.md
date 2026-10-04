# Research-feed page-size and radar acceptance protocol

The approved research-feed product default is **20 cards per page**, with an
optional **50-card page**. Full source validation, ranking, filters, totals,
pagination and the CSV universe remain unchanged. The existing Scan tables are
unchanged. This change does not implement a research-feed/table toggle.

This document specifies the next measurements. It does **not** report the new
UI or corrected radar harness as passing; both require new exact-commit CI
browser evidence. Existing failed reports remain unchanged.

## P1 and Q1 measurements

`frontend/tools/design-review.mjs` measures three workloads at both 1440×900 and
390×844, under the existing CDP CPU 4× throttle:

1. Official `cd3a6a2` legacy dense table: its real 50-row default, once per
   viewport. This is the same-run reference for both current workloads.
2. Current research feed: its real 20-card default, opened without an override.
   This is the approved release criterion.
3. Current research feed with `#/?feedSize=50`: load the 50-card option directly
   into a fresh document on every run. This separate optional stress section
   retains its own P1/Q1 pass flags and every limit failure.

These products have different DOM structures and defaults. The baseline is a
paired full-data control, not an equal-DOM comparison. No second baseline run is
added to seek a more favorable result for the stress presentation.

Every workload keeps the same complete checked input. The pre-existing untimed
load prepares the in-memory HTTP response cache; it does not shrink the
publication or precompute a smaller screening universe. All three measured
navigation/mount runs are retained, including the first. Every measured
workload explicitly reloads its requested route; a changed document time origin
and navigation type verify that a repeated hash URL was not treated as
same-document navigation. This correction applies equally to baseline,
current20 and current50. The optional size is
selected through its real URL state before navigation, not through a warmed
20-to-50 click or a synthetic smaller fixture.

Timing boundaries remain navigation/first visible candidate plus two animation
frames, and method click plus two animation frames. At the second frame, the
same synchronous observer captures the committed DOM for all workloads. Its
read/serialization cost is inside the measured interval. Each witness records
`collection_ms` for its synchronous DOM reads; serialization and transport
remain additional included overhead. No observation cost is subtracted, so the
reported latency is not application-only latency. The observer performs no
style/layout mutations, polling, completion wait, transition or deferred
rendering.

For each initial and switched state, evidence includes the actual row and card
counts, observed page-size control or legacy pagination label, complete visible
candidate total, method, and every rendered symbol and selection text. The
current feed also records its committed range and evaluation epoch. The
observer checks every row's selection denominator (Minervini 9; O'Neil 8), so a
new active method control with an unfinished previous method body fails. The
legacy table uses its real method control and selection cells; it is not
required to have current-only card attributes. Each version is checked against
its own complete publication, including every index chunk and canonical duplicate handling, with the unchanged US/missing
market and default liquidity filters (finite price ≥$10, ADV ≥$20m). Financial
assessment changes do not affect this default cohort, but exporters can change
liquidity values even when symbol sets agree. Therefore legacy/current filtered
cohort differences are recorded diagnostically, not treated as truncation. The
full source symbol sets must still agree, each observed total and rendered
symbol must match its version's own full cohort, and current50 must match
current20. Fast but incomplete or mismatched rendering is a measurement failure.

The P1 limits remain candidate median **3500 ms**, maximum method switch
**400 ms**, and maximum initial long task **200 ms**. Q1 remains **4200/480 ms**
for candidate median/method switch. A Q1 pass cannot convert a P1 failure to a
pass. `performance` holds the baseline and release-default evidence;
`performance_stress` separately holds optional50 results, their unchanged
limits, `p1_pass`, `q1_pass`, raw runs and explicit failure reasons. Optional50
budget misses do not change the approved20 release criterion. Missing or invalid
measurements still block acceptance. CPU profiles remain separate diagnostic
runs and never replace, discount or discard acceptance runs.

## D9 harness context correction

The new harness is identified as `production-overview-context-v2`. The previous
harness mounted SetupRadar under a bare div and missed production shell font
inheritance and border-box sizing. It also imposed standalone widths of 628 px
and 358 px rather than using the actual expanded-overview grid.

Version 2 reproduces the relevant production ancestry:
`leader-shell → leader-content → research-workbench → research-hero
research-overview → market-overview-expanded → SetupRadar`. The explanation
column remains a grid sibling. The normal harness width is determined by the
actual production styles; only the separate DPR2 diagnostic declares an
explicit shell-width override. The component's production 700 px small-screen
breakpoint replaces the former harness-only 768 px breakpoint.

The harness imports the production global reset, research, shell foundation,
workbench, motion and expanded-overview CSS, plus the inherited App CssBaseline
body text metrics. Root and shell share the production dark theme. Every run
records computed font family, font-feature settings, numeric variant,
box-sizing, theme, ancestor widths, component/canvas widths and DPR. Missing
ancestry, fallback font inheritance, content-box sizing, or a mixed theme fails
the context check. Browser evidence is required; jsdom tests of context
construction do not certify rendered geometry or timing.

The test remains the actual SetupRadar with exactly **207 canonical real
2026-09-29 points**, actual CSS/DPR sizing by the same first-frame boundary, and
an unchanged **50 ms** budget. The timer starts before the first React render;
there is no React/component warm-up, moved component work or discarded cold
run. All three runs remain. Current-only D9 results are not a legacy/current
paired comparison. Historical bare-div measurements remain evidence of their
original conditions, not measurements of version 2.

## Retained historical evidence and provenance

The artifact from [CI 37185249269](https://github.com/kusennjp1-ai/screener/actions/runs/37185249269)
contains capture commit `0a9c004cc488afc5ca1bf9271fe8accb674a593d`, measured at
`2026-10-04T07:21:13.990Z`, before the approved20 product default:

| Product under those historical conditions | Desktop candidate / switch / long task | Mobile candidate / switch / long task |
| --- | --- | --- |
| Legacy dense50 `cd3a6a2` | 2775 / 926 / 492 ms | 2037 / 556 / 374 ms |
| Current research feed, then default50 | 3481 / 748 / 250 ms | 3083 / 563 / 240 ms |

The same historical D9 v1 cold first frames were **60.0 / 57.9 ms**, both above
50 ms. Those failures are not reclassified by changing the new product default
or correcting the harness style context.

That artifact's unmodified report stored `source_run: "37178754997"`, which was
the selected publication-input run, not the capturing CI run. New reports
prefer the current `GITHUB_RUN_ID`/`GITHUB_REPOSITORY` for `source_run` and retain
the inherited publication `SOURCE_RUN` separately as `input_source_run`.
Outside GitHub, only an explicit `CAPTURE_SOURCE_RUN` may identify a capture;
the input run is never silently used for that purpose.
