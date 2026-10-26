# Independent whole-application UX review

Reviewed the completed mobile workflow with Chromium at 320×568 and 390×844 in both dark and light mode, plus 1440×900 desktop dark mode. All five final flows passed after the changes below. Actual pixel screenshots were inspected, including the 320px market graph and the 390px detailed price/volume/RS chart. This is local implementation evidence; final authenticated CI capture review and public deployment acceptance remain separate release gates.

## Data and test boundary

The audit used the actual published source pinned to UI `b071fc7042849a7d9003529c9bdc9f368fc78948`, read through the existing SHA-verified immutable transport. Its new derived market series has SHA-256 `559378e113923fbf2aea9111e1917451b9d220bf2f8aad589fab30468b35e1f9`. EPSN used the complete real chart and independently calculated 57-day retrospective RS history. The market reference date is 2026-10-23.

Browser test routes supplied a test-only legacy bootstrap, the newly derived market asset and EPSN history to local Vite. All other data came from the pinned verified reader. This does **not** establish production transport integrity or deployment success; no production trust code was changed. The separate domain review covers export/packed readback. `work/verify-evolution-public.mjs <expected SHA>` repeats real public asset reads and the user flows without routes after publication.

## Defects found and repaired

1. Fixed-width SVG view boxes shrank market axis text to approximately 7 CSS pixels on the narrow phone. Market and RS history now measure the available width with a cleaned-up ResizeObserver, retaining a deterministic fallback and the last nonzero hidden-panel size. The final measured physical text size, computed using SVG screen transforms, is **11px** in all five cases. Font-size thresholds were not reduced.
2. Explicit light mode was lost when reloading after saving a watch. The application now stores only validated `light`/`dark` preferences locally, retains its dark default, and handles unavailable storage. Full browser flows assert the selected mode after reload without toggling it again.
3. Opening an empty watch directly placed the recovery action below filters on a short phone. A successfully loaded, genuinely empty watch now hides redundant feed controls and shows the market recovery action above the bottom navigation. Loading failures and saved watches with zero filtered results do not receive this state. Existing query/filter state remains intact.
4. The integration reviewer corrected VCP selection preservation and the existing mobile focus-clearance contract. The final visual flows ran after those source changes settled.

## Final user-flow evidence

Each phone flow starts at the direct empty-watch URL, recovers to the market and opens EPSN. It verifies the 252-session daily default, actual horizontal touch drag, keyboard panning and slider restoration; 57 dated RS observations with current 82.5 and the first dated value 35.6; closed volume explanation with the preceding-50-session meaning; C1 selection through VCP → chart → VCP; mutually exclusive stock sections; long rule text wrapping; financial details initially closed; reduced-motion character behavior; and keyboard section navigation.

It saves a note and watch, reloads, reopens EPSN from the restored watch, checks both persisted values and the selected theme, returns through the visible candidate action, then enters market analysis. Market checks cover 35.2% above-50-day breadth over 4,480 eligible instruments, 123 highs/275 lows, 63 Cboe observations with period/date controls, and separately selectable S&P 500=5 and Nasdaq Composite=3 calculated distribution days with dated events. These counts use the documented basic rule, not an assertion of official IBD counts.

All five cases had zero page exceptions, zero HTTP errors and no horizontal document overflow. Stock section targets and visible market controls met the existing 44px requirement. Native page scrolling reaches further chart/data details; a 320×568 viewport is not claimed to show every detailed chart pane simultaneously. These are Chromium touch/reduced-motion checks, not physical iOS/Android or performance certification.

## Regression results and artifacts

- SVG/history/theme affected suites: **22 passed** across `useSvgViewportWidth.test.jsx` (2), `RsRatingHistory.test.jsx` (12), `MarketTrendDashboard.test.jsx` (5), and `useColorModePreference.test.jsx` (3).
- ResearchPage full file: **117 passed** before the final added loading-error case. Final targeted empty-watch regressions: **3 passed** in the current 118-test file (loaded recovery, loading failure and saved-but-filtered zero).
- ESLint for the owned affected source/tests: zero errors and zero warnings. Repository `git diff --check` passed.
- Task scratch evidence: `work/evolution-full-audit/report.json`, PNGs in the same directory, `work/evolution-axis-theme-tests.log`, `work/evolution-empty-watch-tests.log`, `work/evolution-empty-watch-final-tests.log`, and `work/evolution-final-owned-lint.log`.
- User preview copies: task-root `outputs/ui-evolution-stock-preview.png` and `outputs/ui-evolution-market-preview.png`. They are actual-data local previews, not public-site proof.

## Public verification prepared before deployment

`work/verify-evolution-upgrade.mjs prepare` created a fresh dedicated persistent browser profile against the actual prior public SHA `b071fc7042849a7d9003529c9bdc9f368fc78948`. It saved EPSN, recorded script `assets/index-a6WqwED1.js` and the active `sw.js` controller, and closed the browser. Baseline: `work/evolution-upgrade-before.json`; profile: `work/evolution-upgrade-profile`. It refuses to overwrite the baseline.

After publication, run from the task `work` directory:

```text
node verify-evolution-public.mjs <expected 40-character UI SHA>
node verify-evolution-upgrade.mjs verify <expected 40-character UI SHA>
```

The first requires the exact public identity, raw-source/derived-asset SHA reads, current/history RS parity and new public interactions. The second uses ordinary reloads and verifies the new bundle plus retained watch, without clearing caches or forcing a service-worker update. Outputs are written to task-root `outputs/evolution-public/` and `outputs/evolution-cache-upgrade.json`. Neither post-publication command has been claimed successful by this local review.
