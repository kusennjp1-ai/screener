# Implementation and audit loops

## Loop1 — baseline → simplify

Implemented native item-level disclosures for selection/purchase rules, financial metrics, institutional history, VCP metrics and market context. Formula/source/version prose starts closed. Metric values, result states, observation date/mismatch, exclusion and cohort scope remain available in the closed view. Code33 now starts closed. Chart price/volume/RS, measured VCP legs, interval focus and guides retain their canonical data. No thresholds/provider contracts changed.

Reduced market tile/header spacing and removed the duplicate mobile header watch action; the fixed thumb-accessible watch button remains. Clarified filter reset versus sector expansion. Each VCP/volume/market gate now opens and focuses its exact purchase-condition summary. Empty watch explains saving and provides a market CTA. Added a keyboard skip link,44px source link, and readable theme-colored breadth legend text. Removed two unused child props.

## Loop2 — actual-data local browser scenarios → repair

Used local source with read-only GET proxy to the actual public data; no invented production values. Tested390/320/1440px × dark/light (six cases), including320×568. All six passed: closed defaults, keyboard Enter toggling, measured C1 chart focus, specific volume rule focus, lazy financial rows and provenance opening, no horizontal overflow or JavaScript errors. Formula bodies measured318px at390 and248px at320 after fixing narrow-column expansion. Chart section begins around243px at320 versus294px baseline. The market candidate now appears earlier; a viewport audit confirmed the first candidate rather than only the six sector tiles.

Further fixes from this loop: selected VCP styling no longer claims an interval is selected before activation; expanded metric explanation spans the full metric grid; removed duplicate disclosure indicators; retained source-note disclosure separately to avoid nesting its entry point inside another closed help item. Updated regression/capture scenarios to activate disclosures before checking rendered evidence instead of weakening source/value checks.

## Loop3 — independent visual/interaction re-audit

An independent read-only evidence worker inspected updated market and loaded empty-watch states at390/320px in dark/light. All four variants had closed disclosures, no measured controls below44px, no focused summary occluded by fixed navigation, no horizontal overflow, no page errors and single disclosure markers. At320×568 the empty-watch CTA was around y230, above navigation around y518. No blocking defect found in that bounded audit.

## Loop4 — production acceptance → repair

The production capture exposed off-scale heading/value sizes (18,24,30px) and a stale purchase-rule text-order assertion after adding disclosures. Aligned the values to the existing type scale (16,20,26px) without relaxing the font gate. The purchase capture now reads the visible summary label and exact state separately, verifies both counts and the original list count against the canonical model, and retains the existing review-record shape. Hidden explanatory prose no longer changes the state assertion. The failed capture was not approved for publication.

## Verification boundaries

Production Vite build passed. ESLint reported no errors (six existing refresh warnings). Full unit/browser and immutable publication gates run separately against the final commit; their final outcomes belong to release evidence, not this pre-release record. Meaningful browser regressions cover default closure,44px summaries, Enter/Space, target focus, symbol-change reset and empty-watch recovery. Existing canonical-value and historical-provenance checks remain intact.

This is Chromium emulation and AI scenario/pixel inspection, not physical iOS/Android testing, screen-reader user testing or a human usability study. Initial JavaScript weight, variable CPU timing and publication latency remain tracked in issue107. No claim of measured energy savings or perfect usability is made.
