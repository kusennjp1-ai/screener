# Expiry/reprojection capture diagnostic, pending owner review

This is an isolated diagnostic proposal, not renewal A, publication authority, or a replacement for Design Acceptance. No main/PR84/source/intent/pin changes, provider calls, external writes, browser launches, CI dispatches, or new screenshots have been made.

## What is established

The actual failed PNG `financial-AVT-annual-viewport-390x844-light.png` was opened and inspected. It contains only the full loading state. The original failed image and its seven viewport failures remain valid failure evidence.

The source timer at 05:14:55.486Z and the failed capture log at 05:14:55.7279554Z are 242ms apart. The later actual AVT selection and CSV recovered to 7/8, annual FAIL, at 05:15:24.162Z. This is temporal coincidence plus recovery. It is not a measured causal reproduction or a 28.7-second measured loading duration.

The original capture harness waits for readiness once when the financial panel opens. Later, it scrolls, waits two animation frames, and invokes a capture routine that waits another 800ms and performs axe analysis before taking the screenshot. It does not revalidate the research evaluation or financial DOM after that interval. A legitimate source expiry can invalidate that readiness during the gap.

The production research hook intentionally withholds the whole bundle until a matching current evaluation is available. The detail component remains mounted, so its tab state survives; the selected symbol remains in the parent, but detail content and page height disappear temporarily. Native browser scroll offsets can be clamped while that content is absent. The app does not promise scroll restoration; the diagnostic must measure this honestly. The harness can reacquire and scroll its named viewport targets after recovery without claiming the app preserved the user's viewport.

## Local evidence and provenance

`source-equality.json` records local commit 8bb678517f8e32d9d9c0fcc1a7a8449ad6c21f47 and exact equality of 10 relevant source/harness blobs fetched through the GitHub connector at c3e2efe4de7aa33132bcdb46157adefc0276633c. The local checkout is not relabeled as main.

`unit-results.json` contains seven passed tests, using at most two workers. Two render the actual ResearchPage, ResearchDetail, financial components, research hook and projection logic under an explicitly synthetic AVT-like fixture, with only data/worker timing and unrelated chart/hero components mocked:

- At another row's inclusive deadline, AVT remains current.
- One millisecond later, all financial decisions disappear while the matching worker result is pending.
- One ordinary boundary restores AVT's selected financial tab, unchanged source text, and annual FAIL / 7 of 8.
- A second unrelated row can expire while epoch 2 is pending. Delivery of the now-stale epoch 2 never restores AVT. A current epoch 3 must complete first.
- No duplicate restart loop occurs during the held period.
- jsdom proves state continuity and absence of a new application scroll request. It cannot prove pixels or natural browser scroll continuity.

Five focused capture-guard tests verify current worker/DOM identity, fail-closed behavior while a new request is pending, rejection of missing/loading/stale/wrong-symbol/wrong-tab states, retention of a contaminated screenshot before reacquiring the next epoch, and failure rather than concealment of stable bad geometry.

All 53 tests in the four existing temporal test files passed, recorded separately in `existing-temporal-results.json`; they cover the existing deadline, stale worker, rollback, and packet identity protections. This is focused coverage, not the complete suite.

## Concrete proposed external scope

After owner review only, place the files from this directory in `.github/diagnostics/expiry-capture/` on a separate diagnostic branch, proposed `diagnostics/avt-expiry-capture-c3e2efe4`, and place `expiry-capture-diagnostic.yml` in `.github/workflows/`. The workflow runs only on a push to exact branch `diagnostics/avt-expiry-capture-c3e2efe4`, with contents/actions read permissions. A job guard requires repository `kusennjp1-ai/screener`, event `push`, that exact full branch ref, and a non-deletion push. There is no main, pull-request, or manual-dispatch trigger. A separate live step runs against the owner-verified public base URL, without any new live UI or financial build. The only published result is the diagnostic artifact. It does not install or call a renewal, certification, source capture, sealing, release, or deployment route.

The workflow checks out exact production source c3e2efe4de7aa33132bcdb46157adefc0276633c, verifies the reviewed blob hashes, and performs a direct Vite production build. It does not invoke export-research, record-history, financial activation, or any provider. It then uses a clearly labeled three-row synthetic fixture with fixed source timestamps. The compiled UI bytes are inventoried before adding the fixture and remain unchanged.

The synthetic browser probe runs only 390×844/light AVT-like annual evidence and its associated source/selection/actual CSV checks. The separate live probe captures actual AVT evidence and annual target viewports at 390×844/light and 1440×900/dark. It does not rerun the 134-screen suite or performance benchmarks. All unrelated external browser requests are blocked, and the quote provider URL is empty.

For this causal fixture only, the page and every real module worker use the same historical clock offset while native wall time, intervals and animation frames continue advancing. No source timestamp is rewritten and no clock is frozen. The first deadline occurs 60 seconds after the anchor, and the second a second later. The worker's real computation and request-bound generation/evaluation identity remain intact. A harness gate holds the complete packet long enough to inspect the fail-closed state and let the second deadline pass. It then verifies that stale epoch 2 stays withheld and current epoch 3 restores the financial tab.

The artifact must include before-boundary, loading, overlapping-loading, recovered-attempt PNGs; all attempted screenshots including failures; exact selected source/criteria checks; the actual downloaded CSV; worker request/complete/delivery metadata; loading intervals; natural scroll displacement; and geometry for all seven annual viewport targets. Compute/packet time, deliberately held-completion time, and final DOM recovery time are reported separately. Synthetic timing does not establish full-universe production recovery latency.

## Capture acceptance

The proposed helper checks the actual delivered worker generation, epoch, evaluation clock and next expiry against the requested identity, plus the visible selected symbol, financial tab and panel clock. It reacquires the current DOM and scrolls again after a legitimate expiry. It samples identity before scrolling and after the screenshot. A screenshot affected by a genuine prior expiry is retained and marked contaminated, then retried within the diagnostic deadline. Unexplained state changes and stable geometry failures fail the diagnostic. No checks are skipped and no loading evidence is erased.

Every accepted recovered PNG still needs actual-pixel review. The generated three-row fixture was also checked through the production projection/assessment helpers: both exact deadlines and the final 7/8 annual FAIL pass (`fixture-contract-results.json`). The browser route and its environment clock/worker instrumentation have only been syntax-checked locally, not executed, because local browser launch is denied and publishing the diagnostic branch to start CI is pending scope review.

## Remaining evidence before later publication

A synthetic screenshot cannot replace real AVT source evidence. The separate `run-live.mjs` probe uses the unmodified real clock and no completion gate. It requires exact live receipt SHA-256 0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a, UI 1e1943e1d5f78a738a05baa69eb9f2e8508e32ac, and AVT price date 2026-10-02. Receipt bytes are reread before and after each viewport and at the end; a changed publication fails rather than adopting a replacement. The browser manifest, detail response, and loaded UI response bytes are checked against pinned metadata. All non-publication/browser-provider requests are blocked. It captures actual live evidence and annual target viewports at 390×844/light and 1440×900/dark only after genuine latest worker readiness, checks all financial row source/value/criteria fields, and requires actual selection and downloaded CSV to remain 7/8 with annual FAIL. The live files and report are stored in a separate `live/` artifact directory. No new financial or live UI build is performed. `live-source-equality.json` independently confirms the 10 relevant source blobs also match UI 1e1943e1 through GitHub.

The public base URL is https://kusennjp1-ai.github.io/screener/, confirmed by the parent against the actual receipt at 04:55–04:57 UTC. The manifest is additionally pinned to ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0, and the receipt run/attempt to 37456692717/1. The stale README demo URL is not used or inferred. All live captures are still unexecuted and require owner-reviewed publishing the diagnostic branch to start CI.

Before any later publication, capture and inspect actual post-expiry AVT annual PNG evidence from the exact reviewed production source/data. The failed original image must remain in the record. Do not report all visual checks passing until that proof exists.

If many unrelated financial deadlines cluster, the current whole-bundle UX can repeatedly show loading. The overlap test establishes safe eventual recovery for a finite set of deadlines; it does not remove that UX limitation or prove bounded recovery under an arbitrarily dense stream. This proposal makes no UI/state architecture or TTL changes.
