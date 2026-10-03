# Cold Radar cost attribution

This is an optional, diagnostic-only experiment. It does not change `design-review.mjs`, `radar-benchmark.jsx`, their 207 historical stock points, or any acceptance threshold. None of its controls can pass D9 on behalf of the production component.

## The question and stopping condition

The existing CI trace shows one expensive initial layout, substantial cold compilation, and much faster later mounts. It does not establish which compilation belongs to React's first commit, text/frame layout, or Radar calculation and painting. The diagnostic asks whether meaningful removable cost remains after accounting for those first two controls.

Run the matrix once. Review all observations and traces, including failures. Only propose a production change if the full component's excess cost and trace identify removable work that can preserve its data, pixels and interactions. If they do not, retain the acceptance failures and report the unresolved cost. Do not rerun unchanged code to obtain a favorable sample.

## Controls

- `empty-root`: a cold React root commits `null`.
- `prepared-frame`: a cold React root commits the exact host element returned by the current `SetupRadar.render()`. Its data and HTML preparation deliberately happen before timing; its labels and CSS geometry remain, but the canvas lifecycle never runs and it draws no stock points.
- `full-radar`: a cold React root mounts the real production `SetupRadar`, including its geometry, HTML, all 207 points, observers and physical-pixel sizing.

Root creation happens before the first animation frame, as in the existing acceptance harness. The timer covers synchronous render/layout through the next animation frame. The empty control measures the first commit, not the entire cost of creating a root. Control differences are counterfactual comparisons, not an additive decomposition: compilation and browser work can be shared or nonlinear.

Every observation gets a fresh browser context and exactly one mount. Each viewport has three uninstrumented observations per mode, with rotated order. A fourth fresh context per mode records CPU and timeline profiles plus a screenshot. Profiling cannot affect the other three observations. Trace summaries use explicit start/end marks; CPU profiles also include setup and inspection outside those marks and must be interpreted accordingly.

The diagnostic checks that the prepared frame and full component have identical labels and section/header/plot/footer rectangles. It also checks that only the full component reports painted points, and that all 207 full-component points and correct physical size are complete by the first-frame boundary. A mismatched frame invalidates the control comparison.

## Run in the CI browser environment

After the existing acceptance measurements, from `frontend`:

```sh
node tools/build-radar-attribution.mjs
RADAR_ATTRIBUTION_OUTPUT=test-results/design-review/radar-attribution node tools/radar-attribution.mjs
```

Keep the existing acceptance step and its failure status. An `if: always()` diagnostic step can collect these files after its failure; the existing design-review artifact directory then contains the report, profiles, traces, screenshots and source map. This tool exits nonzero only for failed diagnostic execution or comparison invariants, never because a speed threshold was missed or met.

## Existing evidence, before this diagnostic

Source: Design Acceptance run `37125278716`, `design-review/radar-diagnostic` artifacts. These figures describe instrumented diagnostic observations, not the three acceptance results.

- Desktop: 78.1 ms reported first-frame interval; about 27.4 ms of `V8.CompileCode` in the first-to-next-animation-frame interval, 19.83 ms of layout and 2.27 ms of style work.
- Mobile: 75.6 ms reported first-frame interval; about 27.3 ms of compilation, 17.69 ms of layout and 2.42 ms of style work.
- Desktop had a single layout over 48 layout objects. Mobile's first layout was 17.21 ms over 38 objects, with another 0.48 ms before the next animation frame. Repeated forced layout is not supported as the dominant explanation.
- Source-mapped CPU samples attribute the large layout read to the benchmark's required `container.getBoundingClientRect()`. The Radar paint closure has roughly 6.2 ms desktop / 5.6 ms mobile self samples. React reconciliation/commit functions are prominent too. Native samples, V8 compile spans and JS samples overlap; they must not be added.
- The earlier 31.47/34.81 ms compile totals cover the whole recording, including work outside the render interval. They are not Radar-only compilation costs.

No production optimization is justified by these traces alone. The application already memoizes Radar geometry, reuses the canvas and changes selection using a separate overlay; suppressing a paint, removing points or warming React before the acceptance timer would not be a valid fix.
