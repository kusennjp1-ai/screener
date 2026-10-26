# Design acceptance recovery

The first Design run for `0a179eab239c0f9390ab0ac100e4cc46eae3bb79`
([40272143741](https://github.com/kusennjp1-ai/screener/actions/runs/40272143741))
failed functional acceptance. It did not produce a reviewable capture and is not
approved by this note.

## Findings and corrections

- The market history card used 20px corners outside the existing 0/4/8/12/16px
  design scale. Its desktop and mobile corners now use 16px.
- The light-theme selected market tab had contrast 4.41:1. Keeping its purple
  selected background and using the existing primary text token gives 11.63:1
  (observed foreground `#222238`, background `#dfddf1`, 11px type).
- The chart capture helper searched for an entry gauge while the new mobile
  chart tab was selected. The gauge belongs to the Conditions tab, inside a
  closed disclosure. This timed out for MSM, ADI and TGTX in both themes and
  prevented 12 required expanded captures. The helper now follows the actual
  Conditions tab and direct-child disclosure summary, waits for the visible
  gauge, verifies all four canonical prices, closes it, and restores the chart
  and its scroll position before continuing.

No accessibility, geometry, source-data or performance threshold was changed.
The existing five P1/D9 warnings remain deferred under the existing policy;
this note does not assert that their strict budgets have passed.

## Local verification

- 60 targeted unit tests passed (market dashboard and versioned detail contract).
- ESLint for the changed capture helper passed; `git diff --check` passed.
- The real chart-case helper completed MSM/ADI/TGTX at 390×844 in dark and light
  themes: six cases, zero failures, 30 chart screenshots. This includes the
  short modal, disclosure, selected-period preservation, navigation, cached
  reopening and focus-return checks, in addition to canonical-price checks.
- Market history checks at 390×844 dark/light and 1440×900 light: zero axe
  violations, 16px measured corners. Three additional screenshots recorded.
- Inspected original failed-run mobile stock/market and desktop chart images,
  then corrected local mobile expanded charts and mobile/desktop market images.
  No further blocking overlap was observed in those inspected images.

Evidence is in the task workspace `work/evolution-first-design-failure/`:
`recheck/report.json`, `recheck/*.png`, `contrast.json`, `unit.log`, and
`recheck-fixed.log`. Local checks use a test-only legacy bootstrap with
SHA-verified published data and new derived market data. They are not an
authenticated publication or a replacement for the next immutable CI capture
and its independent screenshot review. Local MSM/ADI/TGTX use older chart
payloads; their RS-rank history absence is not presented as final publication
evidence.
