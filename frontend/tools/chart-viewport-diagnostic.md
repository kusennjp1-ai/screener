# Inline chart viewport diagnostic

The viewport-gated detail-chart experiment was reverted after
[run 37182933265](https://github.com/kusennjp1-ai/screener/actions/runs/37182933265)
showed no overall improvement and added first-encounter delay in the separate
instrumented chart sample. See the
[recorded evidence and limits](../../docs/research-feed-performance-2026-10-04.md#restore-eager-detail-chart-creation).
The current chart mounts on verified data again, retains its instance during
matching updates, and clears it during replacement. The gate, display placeholder
and hidden height reservation are removed. This is a reversion decision, not an
overall performance claim.

Run this separate CI-only pass **after** the three official production budget
runs. It never changes/replaces those runs or their thresholds. There is no diagnostic
latency threshold; completeness or provenance failures exit nonzero and block
the diagnostic in CI. Do not set CI=1
to run production browser measurements locally. Pure tests can run locally:

```sh
npx vitest run tools/chart-viewport-diagnostic.test.mjs
```

Supply the current production output and a separate frozen, source-equivalent
eager build on exactly the same immutable static-data publication. The official
harness's historical baseline is not that eager build. Each output must have
`build-source-provenance.json` written by the workflow:

```json
{"revision":"<full 40-character SHA>","tree":"<full 40-character tree SHA>","label":"eager"}
```

Use label `current` for the current build. The runner checks the exact revision
against the environment and records sorted emitted JS/CSS paths, byte sizes,
SHA-256s and a list hash. Source attribution is a workflow assertion, not proof
that bundle semantics match the commit.

```sh
# CI only, after the official harness (including on its failure):
CURRENT_BUILD=dist CHART_EAGER_BUILD=/tmp/eager/frontend/dist \
CURRENT_REVISION="$GITHUB_SHA" CHART_EAGER_REVISION="$PINNED_EAGER_SHA" \
CHART_DIAGNOSTIC_OUTPUT=test-results/chart-viewport \
node tools/chart-viewport-diagnostic.mjs
```

The runner captures one sample per build/action at 1440×900 and 390×844 with 4×
CPU, then a separate current-build 1440px timeline. Each chart case has a fresh
context and 60-second deadline; individual waits are bounded at 15 seconds.
Completed screenshots, JSON and errors are preserved. An incomplete shared
scroll comparison, invalid provenance or incomplete timeline exits nonzero and
blocks the CI diagnostic. This checks diagnostic completeness and identity;
it adds no latency threshold. One instrumented sample is not a
statistical acceptance result.

## Integration exports

`runChartViewportDiagnostics({browser, baselineUrl, currentUrl, output, viewport,
provenance, captureContext, capture})` accepts caller-owned Playwright browser
and server URLs. `baselineUrl` must point at the separate eager build. The
caller retains browser/server ownership; the helper owns fresh contexts.

`provenance` is `{baseline, current}`, each containing build/source context and
optional expected symbol, as_of_date, manifest_sha256, research_sha256 and
chart_sha256. Identity fields are checked against fetched bytes. The default
symbol is ADI. Optional `capture` receives `{page, output, name, phase, result,
label, viewport, action, theme, symbol, ...captureContext}` after timing and
should return screenshot artifact metadata. Without it, PNGs and hashes are
written automatically. All browser exports keep the CI guard; import has no
browser side effects.

`captureResearchTimeline({browser, serverUrl, output, viewport, label,
captureContext})` is independently callable outside acceptance timing loops.

## Evidence and limits

- Scroll is the shared eager/current action. Invocation and actual captured
  scroll-event timestamps are separate. If no scrolling occurs, missing event
  timing remains missing, never a zero-latency pass.
- Display-button request is separate and never baseline-comparable. Both the
  current reverted eager chart and the frozen eager source have no display
  button, so this path is explicitly `not_applicable`, with no request timing
  and `complete: false`. It is not a failed or zero-latency measurement; shared
  scroll completeness still controls comparison validity. The helper waits for
  either a display button or a chart after the query, so it can also inspect
  historical deferred builds. A normal
  Playwright click may automatically activate the chart while scrolling toward
  the button. That path is explicitly `auto_activated_before_request`, without
  inventing request latency or bypassing viewport behavior with a scripted click.
- Readiness requires matching symbol/as-of, valid populated visible date range,
  exact opaque expected up/down candle colors in the visible price-pane base
  bitmap, and the same raster fingerprint on consecutive animation frames.
  Price/date-axis, RS/volume and crosshair canvases are excluded. Hidden,
  covered, empty, tainted or oversize canvases cannot pass. Bitmap sampling stops
  above a visible fixed mobile navigation bar; hidden/desktop navigation does
  not shorten it. The hit tests remain required.
- Each phase also records section top/bottom/width/height, document-relative
  top, scrollY and document height before/after, independently of layout-shift
  support, so chart reflow and scroll movement can be inspected.
- The first 1-month interaction must change range and raster. Warm return must
  keep that selected range and the same chart node.
- Phase-local overlapping longtasks and layout shifts are reported. Input-
  related shifts are distinguished; the shift sum is not session-window CLS.
  Observers are drained in a later task so the final sample's longtask is not
  silently lost, while the original latency endpoint stays unchanged.
- Manifest/research/selected-chart byte hashes must match before measuring.
  The union of all consumed static-data paths is checked against both servers
  afterward. Changed/differing data invalidates comparison. The first fetched
  bytes and actual response content-types are replayed within each context to
  freeze refreshes while keeping SVG price traces and JSON payloads intact.

This is conservative raster/range evidence after a paint opportunity, not an
exact compositor timestamp. Existing visible-range notification contributes
roughly 100 ms debounce. The screenshot is afterward and needs visual review.
Readback plus full RGBA hashing can stall rendering. Before-action sampling,
cumulative sampling and maximum sample cost are reported and never subtracted
from latency/longtasks; validation, observers and automation add further cost.
The visible bitmap is capped at one million pixels at DPR 1. Its 32-bit hash is
a change detector with collision risk, not cryptographic pixel validation;
matching candle colors does not prove every candle's geometry. Data SHA-256 and
screenshot review are separate evidence. Missing observations never imply pass.

The timeline records devtools.timeline, v8.execute and phase marks. Summaries
union complete X-event intervals for Layout, UpdateLayoutTree, Paint and selected
JS event names per thread. Categories overlap, exclude other native work, and
cannot be summed as exclusive CPU attribution. Missing categories remain null.
Raw trace is bounded at 100,000 events; truncation/incomplete capture is explicit.
Neither diagnostic establishes that chart work or full-universe projection alone
causes or fixes the original budget failures.
