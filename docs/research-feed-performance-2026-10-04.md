# Feed rendering investigation, 2026-10-04

The current feed is still blocked by the unchanged performance budgets. Better
source evidence, accessible controls and clearer conditions do not establish a
speed or investment-performance improvement.

## Recorded experiment

[Design run 37182933265](https://github.com/kusennjp1-ai/screener/actions/runs/37182933265)
captured commit `ed92369aaf15fffb8c66c24bb2bef29a117247a6`, tree
`18187587d3286182ddf8bf49f4f76f3e8164c1de`. All 154 expected images were captured;
objective layout, evidence, navigation and accessibility checks passed. Formal
per-image visual review was still missing. CPU 4× measurements remained failing:

| Source | Viewport | Initial candidate median | Maximum method switch | Longest initial task |
|---|---:|---:|---:|---:|
| Official baseline `cd3a6a2` | 1440×900 | 2278 ms | 589 ms | 315 ms |
| Official baseline `cd3a6a2` | 390×844 | 1793 ms | 541 ms | 267 ms |
| Current experiment | 1440×900 | 4123 ms | 1394 ms | 447 ms |
| Current experiment | 390×844 | 3911 ms | 1054 ms | 381 ms |

Absolute limits remain 3500 / 400 / 200 ms. The separate radar first-paint
opportunity was 61.2 / 62.0 ms against 50 ms. Earlier runs also varied; these
numbers are exact observations, not a claim of a stable regression magnitude.

## Restore eager detail-chart creation

A separate same-data comparison used frozen eager source
`80e7d5e5050a2880cc64378ca45dcdc1e2405d53`. On first scrolling to the detail chart,
its event-to-observed-painted-range latency was 56.0 / 29.7 ms (desktop/mobile).
The viewport-gated experiment took 833.5 / 538.7 ms. Both retained the chosen range
on return; current return times were 36.0 / 20.5 ms.

This diagnostic includes bitmap readback/hash overhead, the existing range-label
debounce and two animation-frame observations. It does not measure compositor
presentation directly, and its single samples do not support a population claim.
The lack of an overall measured improvement plus the added first-encounter cost
supports removing the detail-chart mount gate. Eager payload verification,
symbol/date binding, replacement clearing, and navigation correctness remain.
This decision does not concern the separate lazy loading of feed mini-chart images.

## Next bounded change: installed fonts

The separate native timeline recorded 1271.5 ms of main-thread Layout intervals,
302.0 ms of style updates and 153.7 ms of Paint. Its JavaScript envelope was
1497.2 ms. These categories overlap and must not be summed as total CPU time.
The largest layouts traversed roughly 6700–7250 layout objects.

The trace contains 66 font-loaded notifications covering 65 URLs, predominantly
Japanese Zen Kaku subsets. Late groups of subsets immediately precede repeated
full-document layouts of 190.3, 173.5 and 200.7 ms. This is strong temporal evidence
for font swapping as a contributor, not a measured 564.5 ms causal saving.

The bounded revision replaces the static UI's externally loaded Japanese and
monospace families with installed system stacks. The shell, portalled controls
and chart labels share the same font definitions. It retains the global online
app's Inter import, all 50 candidates, every evidence field, and the existing
font-size, contrast, touch-target and performance limits. No rendering-containment
or estimated-height placeholder is added.

The revised typography requires new real desktop/mobile screenshots and exact-code
browser/performance checks. Font changes can affect wrapping and chart axes; no
speedup or visual acceptance is claimed before those checks complete.
