# Compact stock workspace — implementation audit

This records implementation checks, not the final independent design acceptance or public-site verification.

## Findings and fixes

1. The previous phone screen appended chart, VCP, overview, entry plan, fundamentals and evidence. Replaced that stack with six labeled icon sections. Only the selected evidence section is mounted; the chart is hidden rather than destroyed, preserving selected VCP ranges.
2. An initial version retained three fixed bottom rails. At 320×568 that left almost no initial price-plot area. The stock screen now has two rails: section selection and previous/save/next. The redundant global market/chart/watch rail returns when the user uses the persistent “候補一覧” back action. Fixed chrome dropped from about 166px to about 109px.
3. Repeated analysis dates and a full company header on every section consumed useful space. The analysis date remains in the persistent symbol header. The chart retains full company/price-position context; other sections use a short price-and-character header. Financial exclusion warnings remain visible.
4. The companion has a visible text label, exact counts behind a default-closed disclosure, and conservative state precedence. It uses existing readiness only. The brief entrance animation is disabled under reduced motion; it has no idle animation loop.
5. Existing selection, purchase and financial logic was retained. Price-plan detail is closed on mobile, existing long-rule wrapping remains, and clicking the trend gate switches to the actual eight-condition evidence.

## Local verification

- 58 targeted unit tests passed: ResearchDetail (32), LeaderDetailOverview (14), StockCompanion (4), ResearchPage navigation (5), ResearchPage detail identity (3). The 50 component tests were repeated after the final compact-header adjustments.
- ESLint on the changed implementation modules: zero errors and zero warnings. `git diff --check` passed.
- Actual public data, rendered by the current local Vite source, was checked at 320×568 and 390×844 in both themes. Four cases passed: no document overflow, six ≥44px controls, exclusive sections, native companion disclosure, long-rule wrapping, financial metadata initially closed, editable notes and fixed rail visibility after page scrolling. No browser exceptions were observed.
- Reduced-motion emulation reported `animation-name: none` for the companion.
- Final measured targets: 320px → 49×45.5px; 390px → at least 60.65×45.5px. Initial chart SVG top was 324.19px; section-rail top was 459.5px / 735.5px respectively. At 390px the price, volume and price-relative RS panes are visible together. At 320×568 the price pane begins above the rail, and scrolling/expand remains necessary to inspect every detailed pane. No claim is made that all detail fits a short phone viewport simultaneously.
- Local evidence: task `work/compact-stock-audit/report.json` and screenshots (chart, conditions, financial, notes × four viewport/theme cases). These are implementation snapshots using Chromium touch emulation, not physical iOS/Android validation.

## Integration handoff

Legacy capture/browser contracts that assumed stacked mobile sections or the global bottom navigation must navigate the selected section before testing the same canonical values. Do not remove numeric/provenance checks to accommodate the new layout. Identified files: `mobile-integrated.spec.js`, `vcp-chart-evidence.spec.js`, `financial-layout.spec.js`, `mobile-first-workbench.spec.js`, `leader-detail-design-contract.mjs`, `financial-viewport-geometry.mjs`, and `design-review.mjs`. Final full quality gates, authenticated captures, publication and public interaction verification are coordinated separately.
