# Evidence (baseline 9762ea8)

Source line citations in this report refer to commit 9762ea84fa2d49482043ea3e4940b4ccb43a3407, before implementation. Four independent evidence roles covered structure, visual/accessibility, copy/honesty and weight/friction. Root owns scoring. Browser evidence used isolated Chromium touch contexts, not human participants or physical phones. Agent-browser was unavailable; repository Playwright was used.

## E1 — Primary task and structure

MobileMarketMap.jsx:25–38 has 2+G+B+C actions (15 with six sectors, six candidates and expansion). ResearchDetail.jsx:49–65 owns seven persistent actions; nested components add more. Maximum owned JSX depth is seven in ResearchDetail and MarketContextCards (custom components treated as leaves, not full rendered DOM). Three repeated-destination groups contain ten affordances: six lead to the same purchase tab, two to the trend disclosure, two to connection setup. VCP/volume/market gates do not identify the chosen rule (LeaderDetailOverview.jsx:25,30; ResearchDetail.jsx:44). Two unused boundary props, verificationSymbol/onBack, are passed in ResearchPage.jsx:293 but not consumed by ResearchDetail. No demonstrated unused imports in the bounded seven-component review.

VCP leg selection calls onFocus with the exact measured interval (ChartSetupEvidence.jsx:39–44). Chart, volume, RS and measured annotations share existing evidence; no detector replacement is needed.

## E2 — Mobile visual evidence

At 390×844 the first candidate heading starts at y=817.4, below the fixed navigation. At 320×568 the chart section starts around y=294; fixed actions begin around y=465. No horizontal document overflow was found. Baseline dark text sizes: 11,12,13,14,16,20,26,34px. Map nonzero spacing: 3,4,6,8,12,14,16px plus bottom clearance; detail additionally uses 1,2,5,7,9,10,20px. Computed CSS color strings: map12, detail22–24, market28 (not raster colors or unique authored tokens).

Primary text #F0F2FA measured at least12.56:1 on sampled solid backgrounds. Small breadth legend red #F44336 on #1D2132 measured4.33:1 (BreadthChart.jsx:243,278). The apparent low-contrast absolute gauge label was a background-measurement false positive and is excluded.

## E3 — Disclosure and copy

ResearchDetail.jsx:62–63 exposes all rule evidence inline. FinancialEvidencePanel.jsx:27–37 exposes intro paragraphs and six metadata fields per metric. LeaderDetailOverview.jsx:50 explicitly opens Code33. ChartSetupEvidence.jsx:30–35 combines all metric explanations behind one mobile-only control; desktop exposes them. MarketContextCards.jsx:32,38,44,49 repeats interpretation and scope prose.

MobileMarketMap.jsx:31,36 uses similar “all” language for reset versus expand. CandidateBoard.jsx:72 gives a filter-reset message for an empty watch. VCP gate label can be broader than the shape-candidate check. The bounded copy inventory includes125 literal source-line records across eight components; generated/imported strings were not claimed complete.

## E4 — Honesty and state coverage

Preserve pass/fail/unknown/not-applicable, financial exclusion (ResearchDetail.jsx:53), evidence-date matching, stale observations and public-subset scope. Sector color is RS median, not market return. VCP measurements are retrospective candidates, not purchase permission. Financial reference data does not certify all SEPA conditions. No deceptive purchase/subscription flow or fabricated urgency found in the reviewed components.

Observed empty, loading, unknown, watch-save success, focus and disabled states. Candidate/save/C1/disclosure work with Enter; 2px focus outlines observed. Error simulation did not reach the expected error within20 seconds, so baseline error behavior is not marked verified. One main landmark, named research navigation and detail regions are present. No skip link; SEC13F source link measured24px high. These gaps require verification/follow-up, not assumptions.

## E5 — Weight and friction

Fresh390×844 Chromium, cache disabled, service workers blocked, unthrottled single run:13 initial requests,7 JS loads,837,572 JS transferred bytes (835,472 encoded /2,685,156 decoded). Resource Timing total includes two worker requests whose completion was absent from CDP; the lower CDP total is incomplete. FCP624ms, candidate-ready2,590ms, chart SVG ready323ms after click. These are not TTI. Idle Web Animations0 at quiet and2s later; initial alerts/statuses/dialogs/identified badges0. Initial visible-layout/intersecting controls21/14; detail43/15 (intersection does not account for fixed-bar occlusion). Dark mode and reduced-motion styling exist. No energy measurement or peer-product novelty study.
