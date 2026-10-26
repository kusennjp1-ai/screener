```text
/make-plan Redesign the screener's secondary information hierarchy based on a Dieter Rams audit (13/30).

Verdict: REDESIGN the secondary information hierarchy around the existing detailed chart (13/30); preserve measured chart/data behavior while replacing always-open explanations with item-level disclosure. This scope follows the user's request, not a wholesale application rewrite.

User: Japanese-speaking, primarily one-handed smartphone use. Task: market map → candidate → detailed price/volume/RS/VCP → condition evidence → save watch.
Constraints: React/static GitHub Pages, existing canonical data and unknown/exclusion semantics,320/390px and short568px screens,1440px desktop,44px controls, keyboard focus, light/dark themes. No change to trading thresholds or providers. No synthetic production data. No forced disclosure of explanations on initial load.

Moves:
1. Keep chart/volume/RS/VCP measurements detailed; make formulas and provenance closed per item, with status/value/date visible (principles2,5,10; E1,E3,E4).
2. Reduce mobile map/header height and retain44px controls so candidates and chart appear sooner (principles2,3; E2).
3. Make each gate open its corresponding condition; clarify reset versus expansion and empty-watch next action (principles4,8; E1,E3).
4. Verify keyboard, unknown/stale/excluded states, light/dark contrast and320/390px layouts in repeated audit/fix cycles (principles6,8; E2,E4).
5. Record bundle/performance limits honestly; do not conflate a single desktop timing with phone TTI (principle9; E5).

Inline evidence: baseline9762ea8; candidate heading817px on390×844; chart starts294px on320×568 with fixed controls465px; financial rows expose six metadata labels each; Code33 initially open; three gate buttons share an unfiltered tab target; empty watch uses a search-reset message; red legend contrast4.33:1. Initial JS838KB transferred/2.69MB decoded,13requests, no idle animation. Single unthrottled candidate-ready2.59s, not TTI. Baseline network-error scenario unverified. No human/physical-device study.

Deliverable: component/disclosure map, explicit visible versus expanded data, empty/loading/error/success/focus/disabled checks, then implementation and meaningful regression tests. Preserve detailed charts and audit exact values. Run multiple scenario audits, repair findings, and verify the published UI. The user explicitly authorized implementation, so this artifact is context rather than a stopping point.
```
