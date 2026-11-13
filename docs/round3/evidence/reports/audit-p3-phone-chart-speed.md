# p3-phone-chart-speed: round 3 audit report (phone at 390, desk at 1440, port 4414)

**There is no report.md.** The harness refused the Write call ("Subagents should return findings as text, not write report files"), so the full report is in this message. The evidence files listed below do exist.

- **Evidence root (E):** `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p3-phone-chart-speed/`. Paths below are written as E + suffix, e.g. E`charts/DRI-6m-390.png`.
- **What I touched:** no commit, push, PR, comment or workflow on GitHub, and no other worktree. I read the snapshot only and never wrote to it. The static server on 4414 has been stopped.
- **Code:**
  - Production `vite build` (VITE_STATIC_SITE=true) of git archives of 8bddb88, 5645ff0 and 8849bf9, in E`trees/<sha>/frontend`.
  - Plain builds are in `dist`. Sourcemap builds are in `dist-map` and were used only to name functions in traces.
  - E`trees/0008849` and E`trees/000bddb` are **instrumented throwaway copies** of 8849bf9 and 8bddb88. They add counters and section timers to priceChart.js.
- **Browser:** Chrome for Testing 147 headless shell with the CI fonts.
- **Scripts:**
  - E`scripts/serve.mjs`: static server.
  - E`scripts/render-probe.mjs`: settled renders and DOM probe.
  - E`scripts/analyse-probe.py`.
  - E`scripts/timing.spec.mjs` with E`scripts/pw.config.mjs`.
  - E`scripts/summarise-timing.py`.
  - E`scripts/trace-analyse.mjs`.

---

## Findings (id, severity, 実測 vs 未検証, evidence, proposed change, how to verify)

### p3-phone-chart-speed-1 — major (evidence correction; affects every persona) — 実測
**The snapshot's chart PNGs were taken during the chart's intro animation, not after it.**

- **Evidence:**
  - `audit3/snapshot/build/src/frontend/tests/snapshot/render.spec.mjs:20` (`settled`) waits only for WAAPI animations.
  - The chart's intro is a set of requestAnimationFrame tweens (8849bf9 priceChart.js:820-868; e.g. tags at :860, level and average names at :861). The pivot line is drawn by dash offset, and the T depths count up.
  - The end of the intro is marked by `.bc-pulsing`, which design-review.mjs `settle()` waits for (:168-172).
  - The snapshot's DOM facts are right: forced-label counts and card heights equal mine in 106/106 views. Its pixels are not:
    - 72/106 PNGs differ from the settled render by 0.5–2.8% of pixels: all 48 週足 phone PNGs, 18/48 6か月 phone, 5/6 週足 and 1/6 6か月 desk (E`charts/snapshot-vs-settled.json`).
  - Example, DRI 6か月 390:
    - The snapshot `audit3/snapshot/charts/DRI-6m-390.png` shows no 52週高, 損切り, 買値, tags or average names.
    - Settled, E`charts/DRI-6m-390.png` shows 52週高 233.98, 買値 227.90, ピボット, 損切り −7.0%, tags 227.90/227.64/211.95, 上抜け 0.67× and 50/150/200.
  - Example, PCRX 週足 1440: the snapshot has the pivot line half drawn and T3 at −4% while counting up.
- **Change:** Personas should use E`charts/<SYM>-<3m|6m|1y|weekly>-<320|390|1440>.png`.
  - These are 476 settled PNGs: 48 stocks × 4 periods at 320 and at 390, plus 23 certified stocks × 4 periods at 1440.
  - The DOM probe for every view is in E`charts/probe-reduce.json`, with a per-view summary in E`charts/probe-summary.json` and E`charts/probe-summary.txt`.
  - Fix the snapshot spec: after each period click, wait for `.bc-pulsing`, or render with `reducedMotion:'reduce'`.
- **Verify:** Reduced motion and pulse-waited renders give identical text nodes and positions (PCRX/DRI at 390, PCRX at 1440). Pixel differences are under 0.25%: the pulse dot and the pivot dash phase. Files: E`render/check-reduce/probe-reduce.json` and E`render/check-pulse/probe-pulse.json`.

### p3-phone-chart-speed-2 — major (chart, round-3 item 1, outside the plot) — 実測 on the snapshot
**The Setup Engine's base is never drawn, so 21 of the 30 ready charts show nothing but 「収縮は未確認」.**

- **Scope:** "Ready charts" here means ready rows with certified bars that are CI-identical. BB certifies but uses proxy bars, and is excluded.
- **Evidence:**
  - Contraction boxes and depths are drawn on only 9/30: PCRX, MGRC, ADI, RDNT, CFBK, CTKB, LCNB, PRTH, RMBI. Depth texts equal `data-depth` in every such view.
  - Legs come from the brief's own `buildBookTechnicalEvidence` → `measurementsValid` (StockView.jsx:59; useBriefData.js:136-140).
  - Every one of the 37 ready rows carries the Setup Engine's own base: `se_pattern_primary`, `se_pivot_type`, `se_pivot_date` (37/37), and `se_base_length_weeks` / `se_base_depth_pct` (31/37). None of this is drawn.
  - Patterns: cup_with_handle 26, nr7_inside_day 6, three_weeks_tight 5.
  - Example: SWKS (rank 6, ready) is cup_with_handle, 32 weeks, 19.1% deep, pivot 89.88 from the handle high on 2026-10-02. Its chart: E`charts/SWKS-6m-390.png`, E`charts/SWKS-6m-1440.png`.
  - Per-stock table: E`charts/per-stock-390-6m.txt`.
- **Change:**
  - Mark the pivot's source bar (`se_pivot_date`; on 週足, its week) in the date-axis band, below the plot.
  - Add one line in the legend or readout, marked as the Setup Engine's, e.g. 「SE：カップ・ウィズ・ハンドル 32週・深さ19%・ピボット 10/2（ハンドル高値）」.
  - For nr7_inside_day, which has no base length or depth (6 ready rows, 5 of them without legs), show 「SE：NR7・インサイドデイ（土台の長さ・深さなし）・ピボット M/D」.
  - Do not draw a base span: the anchor of `se_base_length_weeks` is unknown.
  - Keep 「収縮は未確認」. Never call the SE base a VCP.
  - The 390 card is a fixed 508px with a 2-line legend, so the line has to fit there or in the readout, or the height budget has to be agreed.
- **Verify:**
  - The round-2 492-view label probe gives byte-identical label boxes: `audit2/r2-chart-labels/verify4/probe`, run by `audit2/r2-chart-labels/fix5/run-sweep.sh` (30 fixture stocks × 4 periods × 320/375/390/1440, plus ZZNV in dark).
  - On the snapshot, 30/30 ready CI-bar charts show the SE line.
  - A vitest puts the tick on the bar for `se_pivot_date`.

### p3-phone-chart-speed-3 — minor (chart, round-3 item 2) — the count is 実測; "non-placer" is 未検証
**The 週足 notice is drawn over the candles on most phone 週足 views.**

- **Evidence:**
  - The notice 「週足は直近64週分（2025/08〜）。」「2年分はありません」 (priceChart.js:646) appears on every real 週足 view, because every served chart has 310 sessions (64 weeks).
  - It is drawn over candles (data-forced) in 30/39 CI-bar 週足 views at 390, 31/39 at 320, and 0/23 at 1440.
  - At 390 週足, notice lines are 85 of the 114 forced label lines.
  - Images: E`charts/SWKS-weekly-390.png`, E`charts/PCRX-weekly-390.png`.
  - The period button already says 「週足（64週）」.
- **Change:** Drop the 週足 lines from the in-plot notice. Put 「週足は2025/08〜の64週分（2年分はありません）」 into the legend or 注記. Keep 「収縮は未確認」 and 「ピボット 未確認」 in the plot.
- **Verify:** The notice is placed last (priceChart.js:645-657, `put` without repair), so I expect other labels not to move. That is read from the code only, so it stays 未検証 until the 492-view probe shows every non-notice label box byte-identical. The snapshot's forced count on 週足 should fall by the notice lines.

### p3-phone-chart-speed-4 — minor (chart, round-3 item 3, outside the plot) — 実測
**Volume dry-up is visible on only 2 of the 37 ready charts.**

- **Evidence:**
  - The dry-up bracket needs a valid last contraction with an interval volume ratio below 1 (StockChartCard.jsx:171). It is drawn only on PCRX and RMBI.
  - The Setup Engine's own dry-up evidence is on 37/37 rows but not on the chart: `se_volume_vs_50d` (e.g. SWKS 0.77) and `se_quiet_days_10d`. 435 published rows failed the gate `volume_above_dryup_cap`.
- **Change:** Add a legend or readout item such as 「出来高 50日比 0.77×・静かな日 3/10日（SE）」. Use the SE's values only, with no new threshold. Do not put it in the volume caption: the caption is reserved before labels are placed, so changing it moves 「出来高の枯渇」.
- **Verify:** The 492-view probe is byte-identical. The item shows on 37/37 ready rows.

### p3-phone-chart-speed-5 — minor (chart, round-3 item 4; the real-data form of the hidden 「80」) — 実測
**At 390 and 1440 the hidden 「80」 matters little. At 320 the 安値 line's price is not on the card at all.**

- **Evidence at 390:**
  - Price tags hide at least one grid value in 36–40/40 views per period, but those tags carry their own price.
  - A price number stays in the lower half of the plot in 39/40 views for every period.
  - Views showing at most 1 grid number: 3か月 20, 6か月 15, 1年 18, 週足 21 (of 40). Views with none: 2 (3か月).
  - The exact 「80」 case, a grid value under the price-less 安値 tag, happens in 7–9/40 phone views per period at 390. The low's price stays in the legend there, except HUM on 1年 and 週足.
- **Evidence at 320:** the 安値 tag hides a grid value in 8–10/40 views per period, and **the 「最後の収縮の安値 xx」 legend item is folded off the card in 13/13 stocks that draw the tag, in every period**. The price is then only in the screen's 注記. Facts: E`charts/facts-extra.txt`.
- **Change:** When the 安値 tag is drawn, make the legend item unfoldable (StockChartCard.jsx:78, the `kept` rule). This touches the legend only; the SVG is untouched.
- **Verify:** At 320 the low's price is on the card for 13/13 stocks. Card height is unchanged. The 492-view probe is byte-identical.

### p3-phone-chart-speed-6 — minor (chart, round-3 item 5) — 実測
**The chart card's height changes when the period changes, so everything below it moves.**

- **Evidence:** At 320, 37/48 stocks change height (489 ↔ 505/521; e.g. PCRX is 489 on daily and 505 on 週足). At 1440, 23/23 change (684–768: the in-card 注記 differs by period). At 390 the height never changes (508). Data: E`charts/probe-reduce.json`.
- **Change:** Reserve the legend's two lines at 320, and the 注記 block at 1440, so heights hold across periods.
- **Verify:** For each stock, the card height is equal across the 4 periods at 320, 390 and 1440, with no change to the chart SVG.

### p3-phone-chart-speed-7 — major (speed; over the 200ms budget, currently under the owner's waiver) — 実測 attribution
**The 1440 first-load longest task is the right pane's chart draw, and label rounds 3–4 roughly doubled it.**

- **What is in the task:** It is the right-pane chart draw: React commit, then PriceChart.jsx layout effect, then `renderPriceChart`. This holds in 42/42 main fixture runs and 263/270 per-stock runs. It always falls inside design-review's window (first row visible + 2 frames); no race was seen. Its growth comes from the averages' name search added in label rounds 3–4 (8bddb88 → 5645ff0: 158f7d4e, 39e09eb6, 792f179e, 9e9e68eb, 43d2ca3a):
  - A 1px grid over a 64px × ±72px window (priceChart.js:592, `MA_SHIFT_FAR`, `step: 1`) with leader-segment checks on every spot.
  - Its retry loop (:603-613), which repeats the whole search when a name is missing or forced.
- **Real data** (snapshot research.json, Today `#/brief` at 1440, pane SWKS, CPU 4×, 5 interleaved runs per tree):

  | Tree | Longest task, median (ms) | All samples | Chart task, median (ms) |
  |---|---|---|---|
  | 8bddb88 | 161 | 123, 160, 161, 181, 242 | 121 |
  | 5645ff0 | 260 | 242, 253, 260, 289, 345 | 260 |
  | 8849bf9 | 250 | 233, 241, 250, 262, 269 | 250 |

  On 8bddb88 the longest task is usually the rows render (123–181 ms), not the chart. Data: E`timing/real-snapshot.json`.
- **Instrumented, real data, pane SWKS** (E`timing/instr-snapshot.json`):
  - The averages' names section takes 7.4 ms median on 8bddb88 and 115 ms median on 8849bf9 (93–131).
  - The retry loop fired on all 5 runs: 10 name searches instead of 5.
  - Level, zone and T names (`levels_to_names`) take 9.7 → 31.5 ms.
  - The second full layout (`carry`, round 5) fired 0 times.
- **Fixture** (CPU 4×, 7 interleaved runs per tree; E`timing/main-fixture-summary.json`):

  | Target | 8bddb88 median (samples) | 5645ff0 median (samples) | 8849bf9 median (samples) |
  |---|---|---|---|
  | `#/brief`, pane ZZNV | 221 (187–281) | 292 (188–483) | 299 (218–371) |
  | `#/brief/stock/ZZVX`: Today on the left, ZZVX in the pane; the most expensive stock in the scan | 191 (177–282) | 379 (285–457) | 450 (353–521) |

  The pane symbol and the Today left column were asserted on every run.
- **Per-stock scan** (30 fixture stocks × 3 runs, chart task, median over stocks): **129.5 / 243.5 / 241.5** ms. Data: E`timing/perstock-summary.json`.
- **Instrumented, fixture** (E`timing/instr.json`): ZZVX names section 10.3 → 157 ms median; ZZNV 21.6 → 48.1. Retry 0 and carry 0 on both.
- **Traces:** 12 traces on the sourcemap builds (E`trace/{a,b}/*.json`, attribution in `*.attr.json`).
  - In 5645ff0 and 8849bf9, `renderPriceChart` is 53–77% of the traced longest task. chartLabels.js has the most self time (23–43%). `placeName` takes 18–38% inclusive.
  - About 14% of the traced task is style recalculation and layout, and `PriceChart.jsx :: L68` (72 ms self) did not resolve to a function. Neither is counted as placer time.
  - Tracing roughly doubles absolute durations, so the instrumented section timers carry the placer claim.
- **Round 5 (5645ff0 → 8849bf9):** not separable from noise. ZZVX read 379 vs 450 in one set and 348 vs 355 in another; SWKS read 260 vs 250. Its second layout never fired: carry was 0, counted on 8849bf9 only, for ZZNV, ZZVX and SWKS.
- **Change:** Make the averages' name search cheaper without changing its result. Options:
  - Run the box test before building leader segments.
  - Reuse each row's vertical leader.
  - Memoize per-spot candle (`solid`) results across the retry pass.
  - Keep the spot list across the retry instead of rebuilding the heap.
  - Or split the draw into two tasks, yielding before the label pass, so the final output is identical.
- **Verify:**
  - Gate: the 492-view probe is byte-identical.
  - On real data, SWKS at 1440 should have a longest-task median ≤ 200 ms at CPU 4×.
  - The fixture per-stock median should be near 8bddb88's 130.

### p3-phone-chart-speed-8 — minor (observation for the verdict persona, not a chart defect) — 実測
- **Stop:** every stop reads 「損切り −7.0%」, in 360 of 360 certified views. I did not read positionPlan, so I cannot say why it is always 7%. The structural low is drawn only on the 9 ready charts that have legs.
- **Missing plan levels:** TECH, ARX, CEPO, DSGR and RNW have no plan levels, so no stop line is drawn. The reason is 未検証.
- **PCRX:** rank 1 and ready, but it has closed at 36.31–36.49 since the 10-08 gap. The chart honestly shows ADR 0.1%. Whether it should be selected at all is a question for the buyer persona.

---

## Answers to the chart questions (実測 unless marked)

**Readable?** Yes on size and contrast.
- Every chart text is 12 CSS px.
- Plain labels reach at least 6.71:1 in dark and 5.3:1 in light. Tag text on its plate reaches at least 8.69:1 in dark and 5.7:1 in light. This was checked on 16 views per theme, plus all 476 dark views (E`render/theme-light/`, E`render/theme-dark/`).
- axe cannot check this, because the chart SVG is aria-hidden.
- What hurts reading is labels placed over candles:
  - 週足: the notice (item 3).
  - Elsewhere at 390: 6か月 24 labels in 15/40 views, 1年 26 in 13/40, 3か月 31 in 19/40. At 1440, 2–6 per period over 23 views.
  - These are placer issues, and the placer is not reworked without the owner's comment on images.

**52週高 traceable?** Yes, beside its own line.
- The name's centre sits 9 px from its line (median), 11 px at most.
- No other level line lies between the name and its line in any 390 or 1440 view (one view at 320).
- It is never forced at 390 or 1440.
- 未検証: the round-2 fallback (the name over its price on a 2-row tag) never fired in the 476 real views, so how traceable that path is on real data is unknown.

**Hidden 「80」?** See item 5. It matters little at 390 and 1440 and is a small real loss at 320.

**Missing Minervini detail** (37 ready rows):

| Detail | Status on the 37 ready rows |
|---|---|
| Contraction depths | Conditional: 9/30 on CI-identical bars; the Setup Engine's base is not drawn (item 2) |
| Pivot | Always drawn (37/37); its source date is not marked (item 2) |
| Volume dry-up | 2/37 (item 4) |
| RS line | 37/37; RS新高値 0/37 (1/48 overall: HTFL); lead underline 6/37 |
| Earnings date | 未収録 in the snapshot (`entry_evidence.earnings` is null everywhere), so real-data rendering is **未検証** |
| Stop | 32/37, always −7.0% (item 8) |

Outside my top 5 (未検証 cost): served charts hold 310 sessions, so the 200日線 has only 111 points, the 40週線 has 25, and 週足 is 64 weeks. Deepening the history would cost Pages budget that I have not measured.

## 未検証 (not verified)
- Which symbols are in the published 998/43 (inherited from the snapshot).
- The earnings flag on real data.
- The 52週高 name-over-price fallback on real data.
- Whether the published research details (exporter `book_technical_evidence`, run with a benchmark argument) give the same 「収縮は未確認」 counts as the browser recompute.
- That items 3–6 leave placement unchanged, until the 492-view probe confirms it.
- Whether SWKS is the published first candidate at 1440.
- The reason TECH, ARX, CEPO, DSGR and RNW have no plan.
- Absolute timings. They differ from design-review's method in five ways, so compare trees, not raw values:
  - page.clock fixed time; its shim takes about 3% of a trace.
  - A MutationObserver records the marks.
  - The per-stock scan ran before I added the idle-page fix, and briefly overlapped the theme probe.
  - The sandbox has 4 CPUs.
  - Builds are served under /t-<sha>/.

## Owner-facing summary (Japanese)
- 実測：スナップショットのチャート画像の多くはアニメーション途中の状態で、週足は全数、6か月の一部が該当します。完了後の画像を撮り直しました。文字は全表示12px、コントラストは4.5:1以上です。52週高は自分の線のそばに表示されています。準備が整った30銘柄のうち21銘柄では、チャートに「収縮は未確認」しか出ず、Setup Engine の土台情報（型・週数・深さ・ピボット日）を表示していません。
- 実測：1440で最初の表示が長くなる原因は、右ペインのチャート描画です。具体的には移動平均の名前の配置探索（ラベル改修の第3〜4回で追加）です。実データで最長タスクは 161→260→250ms（8bddb88→5645ff0→8849bf9）。第5回の影響は誤差の範囲で区別できません。
- 未検証：決算日の旗（スナップショットに決算日が無いため）、公開版998件の中身。