# Chart and RS history implementation

## Behavior

- Daily charts initially show 252 trading sessions (the UI's approximate one-year period); weekly charts use 51 bars. Switching symbols/publication or resetting restores that period. Shorter source histories remain shorter.
- Horizontal pointer dragging, horizontal wheel movement, a keyboard-accessible position slider, and arrow keys pan a bounded, fixed-length window. Vertical wheel/touch scrolling and native pinch zoom remain available. Pointer capture begins only after horizontal intent. The implementation follows [Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) and [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) documentation.
- The mobile `view` boundary separates chart and VCP panels without discarding the selected VCP interval. Choosing a contraction returns to the chart at that interval.
- The dated volume ratio is the analysis day's volume divided by the preceding 50 daily volumes' average, excluding the analysis day. It does not drift while panning or switching to weekly candles. The initial summary asks how many times average; the closed disclosure explains 1×, 2× and 0.5×, actual numerator/denominator, and the distinction from VCP interval-average volume.

## RS meaning and data integrity

The price-relative RS line remains stock close divided by its explicitly identified benchmark close. A separate RS rating panel displays the current canonical 1–99 rank, its historical graph, and a dated value/population selector.

Historical ranks are **retrospective calculations over the current verified publication universe**, not archived ranks available to traders on those historical days. For each date, 63/126/189/252-session returns are weighted 40/20/20/20 percent and ranked using the same equal-score midrank as `rankVerifiedUniverse`. Each observation requires 253 continuous calendar-aligned prices and at least 100 eligible instruments. No future close enters an earlier return. Different daily eligible counts are recorded; missing dates split graph lines rather than being interpolated. The panel's initially closed explanation states these limitations and distinguishes this estimate from official IBD ratings.

The canonical chart asset carries `rs_rating_history`; it is not added to the initial research index. Its symbol, analysis date, method, current rating, sorted dates, bounds, and population are validated before display. Unknown or mismatched history is withheld.

## Verification evidence

- Five targeted Vitest files passed **82 tests**, including actual export/readback of canonical chart history for a 101-member synthetic universe; historical no-lookahead; ties; missing sessions; source/date/current-rating mismatch; default/reset/weekly behavior; fixed-window pan; vertical gesture retention; and independent VCP/chart views.
- Targeted ESLint completed without errors.
- Independently fetched all **4,480** current eligible real chart payloads through the existing SHA-verified immutable transport reader, pinned to public UI `b071fc7042849a7d9003529c9bdc9f368fc78948` and transport generation `d05e4da58f8f4e490799c856f90dc1bd62a9398bc5c570d0c22120c6b70ad4ef`. Recomputed latest ranks matched every canonical `row.rs_rating` exactly.
- Actual available rating history spans **1–57 trading sessions**, depending on source length. Daily populations range from 4,417 to 4,480. EPSN, NVDA, AAPL and MSFT each have 57 observations from 2026-08-05 through 2026-10-23. EPSN changes from 35.55298913043478 to 82.48068765349409. These are reconstructed ranks, not past-publication claims.
- Chromium component integration with the real pinned EPSN data plus the producer's history passed four 320/390px dark/light cases. Actual CDP touch drags changed the 252-bar window; vertical swipes scrolled a scrollable page without changing the window; selecting a past RS date returned its exact value/population. All visible controls were at least 44px; no horizontal page overflow or browser exceptions were observed. Screenshots were visually inspected.
- Local audit evidence: `work/rs-actual-source/report.json`, `work/chart-rs-browser-audit/report.json`, its chart/RS PNGs, and `work/chart-rs-final-tests.log`. These are implementation evidence, not a substitute for the complete application/release audit.

This is browser touch emulation and actual-data calculation verification, not physical iOS/Android testing. Final full-application regressions, immutable image review, publication and live-site confirmation remain the release coordinator's responsibility.

## Full-suite integration follow-up

The first complete suite exposed seven older chart-reuse contract failures. Five comparison cases found that the new detail visibility wrapper interrupted the direct fixed-height parent relationship. Compact comparisons now use a React Fragment, restoring the original 220/240px parent and plot contract; the existing height assertions remain unchanged. Two detail cases assumed the VCP lab immediately followed the SVG and the former 390px mobile layout. Their assertions now verify the precise intended flow (plot → pan control → RS/volume metrics; chart wrapper → VCP lab → legend), the 300px mobile/440px desktop plot, retained price values and all three panes, closed dated price help, and evidence preceding numeric data.

After these fixes, **93 tests in both chart files passed** on the supported native Linux runner and on the Windows host. Linux evidence: `work/new-ui-chart-reuse-linux-fixed.log`. No chart-height requirement for comparisons, numeric assertion, or timing threshold was relaxed.
