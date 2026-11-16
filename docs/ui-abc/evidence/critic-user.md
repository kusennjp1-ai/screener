# critic-user: Minervini-style user critic of `ui-abc/plan.md`

Written 2026-11-16 by the user critic (a swing trader who follows SEPA and O'Neil's market direction). This review is read-only. I made no repository edits, ran no builds, no browser and no timings, so I did not record a load average.

**Inputs I read:**
- `ui-abc/plan.md`, all 407 lines.
- `design-r3/{brief-common.md, final-r7.json, gate-r7.json}`.
- The prototypes: `b-chart/index.html` (strip at :1443-1470), `b-chart/notes.md`, `a-gate/index.html` (指数側 and 銘柄側 boxes at :676-700) and the 種別 rows of `c-cockpit/index.html`.
- The code at main `01066ebe` in the `ui-plan` worktree:
  - `portfolioPlan.js` (modelMarket);
  - `brief/{StockVerdict, StockSellCard, StockPlanCard, TodayView, MarketCard, BriefApp, StockVcpCard}.jsx`;
  - `brief/{buyGate, positionSizing, briefSell, briefEnvironment, marketTabModel, pivotBar, breakoutHistory, briefFreshness}.js`;
  - `backend/app/services/market_regime.py`.

## How each claim is tagged

**実測** (each with the command that produced it):
- `python3` over `ui-abc/stop-window.jsonl`. This is the surveyor's 11-12 rebuild output: 564 certified rows that have a pivot.
  - **Hits under A's window: 59.** Of these, 55 are fell-back rows with a pivot-basis plan, 3 are blocked extended rows and 1 is a zone row with a close-basis plan. Without the zone row the count is 58, as D7 states.
  - **Rows with no dated breakout: 145.** Of these, 5 extended rows close above the pivot.
  - **Rows with a pivot-basis plan: 233.** On 3 of them (FCNCA, URI, MPWR), the printed plan stop differs from the half-up cents of pivot −7%.
- `python3` key dump of `audit3/r3-harness/snapshot/out/bd20584/counts.json`. Its only top-level keys are listed, certified_listed, failedBreakout{hit, clear, no_check, …}, lowRange_listed, lowRange_pinned_ready_plus_SLAB, pinned_listed, ready and readout_zero_mismatch.
- `grep -n` of `plan.md` for brief-warnings | todayNote | StatusAlert | verdictWaiting | 更新待ち | stopPercent | structural | NAS調整中 | IBD | 前提 | 推奨 | statusLine | lookback | 60営業日. The only hits are the content-rule list (line 16) and unrelated uses.
- `grep -n` to confirm every code line cited below.

**Code reading** (not a measurement): each file:line cited below.

**未検証**: anything only a build or a browser run would show. Each case is marked where it appears.

## Verdict

**What holds.**
- On the 0% day the market gate holds.
- The unknown, loading and manifest-failure states never print 0%, 未達 or 達成.
- The build, the heights and the chart probe are planned carefully.

**What does not.** Five places are weak:
- the BUYABLE day (50% or 25%);
- a late publication while the guide is open;
- the FTD states;
- holders of fell-back and extended stocks;
- a yardstick that cannot prove values unchanged outside the fixture stocks.

Totals: **3 blockers, 13 majors, 8 minors.**

---

## Blockers

### B1. A late publication with an open guide reads as today's buyable day
- **Where.**
  - S1 state table (plan.md:78-90).
  - S1-P3 (:92-99), S1-P4 (:101-108) and S3-P2.
- **Problem.**
  - The state table has no row for a late publication (freshness `stale`) while cap > 0.
  - `verdictWaiting` exists so that 「新規の買いを検討できます」 never stands on an older session's verdict (marketTabModel.js:162-173, M1e).
    - Only the market tab passes `update`.
    - Its own comment says "Today passes none" (:188).
  - Under the plan, these surfaces all read as today's:
    - the band on every screen (「新規買い 最大50%」);
    - the gate headline (「新規の買いを検討できる」 with a large 最大50%);
    - the 1440 chip and pane.

    The bar's 「n営業日前」 is the only sign that the data is late. Today's tile already has this gap; the plan copies it to every screen and makes it a headline.
  - S1-P3 option (2) for the phone stock bar, 「band short form・name」, does not say it keeps `.brief-bar-stale` (BriefApp.jsx:244-245). That is the stock screen's only display of the publication's age.
  - The §5.2 matrix lists "late publication", but no assertion is attached to it.
- **Fix.**
  - Add a state row: late publication × cap > 0.
    - The band reads 「地合い M/D引け時点・更新待ち（独自判定）」.
    - The gate headline uses `verdictWaiting` (`lead`, or `short` on the phone).
    - The figure keeps 「M/D時点」.
    - Take `target` from `freshness().missing.at(-1)`, the calendar the bar already uses.
  - Add brief-band.spec and brief-gate.spec cases on the brief-freshness clock at 50% and 25%, and on the stock screen. Each asserts that 「検討できる」 never appears without the date and the 更新待ち form.
  - On the phone stock bar, show the stale age first, then the band (keeping 独自), then the name, and pin that order in a test.

### B2. The strip's pivot date falls back to `se_pivot_date`
- **Where.** S2-P2 (plan.md:139).
- **Problem.**
  - This breaks the round-3 C4 rule:
    - pivotBar.js:28-38: "a weekly label is never read as the bar itself";
    - StockVcpCard.jsx:26-46: the card prints 「ピボットの日 未確認」, never the published date.
  - The fallback goes wrong in three cases:
    - **Weekly patterns** (cup_with_handle, three_weeks_tight): the date is a Friday week label, which need not be a session.
    - **Uncertified bars:** the date is unchecked.
    - **A `vcp_pivot` fallback price:** the SE date belongs to another price.
  - The strip would print a date that the VCP card on the same screen calls 未確認.
- **Fix.**
  - Take the strip's date from the gate that `pivotDayNote` already uses:
    - the SE pivot equals `view.pivot` in cents;
    - the recalculation is current;
    - `pivotBar` runs on `judged`.
  - Otherwise print 「日付未確認」. Weekly patterns add 「（週足の型）」.
  - brief-strip.spec asserts strip date = VCP-card date on every fixture and oracle stock, plus a weekly mutator and an uncertified chart. Whether the app's chart draws its own pivot date is 未検証; if it does, the assertion includes it.

### B3. The sell card states 「いま出ているサインはありません」 above a 損切りに到達 該当 row
- **Where.** S2-P6 (plan.md:165-177). It specifies only the summary of the quiet fold.
- **Problem.**
  - `statusLine` (StockSellCard.jsx:43-50) reads only `hits`, `strength` and `weakness`.
  - On a BEH-1 hit with no other sign it prints 「いま出ているサインはありません。」 (or 「判定していない項目 n件。」) on the same card as a bold `--neg` 「損切りに到達（保有なら） 該当」.
  - That is a false statement next to the fact it contradicts.
- **Fix.**
  - Display only; counts and BEH-2 stay out of scope.
  - With `sells.stop` at 該当 or 未確認, `statusLine` gets its own clause in place of 「いま出ているサインはありません」. For example: 「損切りの行：仮の損切りに到達（サインの件数には含めていません）。」.
  - Add a vitest and a 375/1440 Playwright case. The height must stay ≤ 232.5 at 375 in the quiet state; a hit state's height is reported.

---

## Majors

### M1. 止めているもの is unspecified on the BUYABLE day, and its invariant cannot hold
- **Where.** S3-P3 (:214-223) and D13 (:41).
- **Problem.**
  - The market is named only on 0% and unknown days. A clean 買いゾーン row at 50% or 25% has an undefined cell; a blank or 「なし」 reads as "go".
  - `rowBlockers` has no bars, so it cannot see the bar-only gate kinds (buyGate.js:150-165): `failedBreakout`, `broken`, `heavyDown` and `stale`.
  - "Never contradicts the stock gate" therefore cannot hold for unwatched rows.
- **Fix.**
  - On cap > 0 days, a row with no row-level blocker reads 「—（行の条件では該当なし・日足の判定は銘柄画面）」, never blank and never 「なし」.
  - Restate the invariant as "row ⊆ gate".
  - brief-desk.spec on the default 50% fixture asserts: no empty cell and no bare 「なし」.

### M2. The band drops 「目安」
- **Where.** The S1 table (:80, 「新規買い 最大50%」) and the ladder (:95, 「新規 0%（独自）」).
- **Problem.**
  - The removed tile said 「検討可・目安≤50%」, and the market tab says 「エクスポージャーの目安」.
  - Above a list of 買いゾーン rows on a 50% day, 「新規買い 最大50%」 reads as an allocation instruction.
- **Fix.**
  - Every form on the ladder keeps 「目安」, e.g. 「新規買いの目安 最大50%（独自設定）」 → 「目安 最大50%（独自）」.
  - Assert this at 320, 375 and 390 for 50%, 25% and 0%.

### M3. The gate card's figure can stand without its label and definition
- **Where.** S1-P4 (:103, :106).
- **Problem.**
  - The figure is `capText`, and the definition is written only for 0%.
  - The definition is second in the trim order.
  - On a 50% day the card can therefore read 「新規の買いを検討できる　最大50%」 with no label.
- **Fix.**
  - Keep the label 「新規買いの目安」 next to the figure in every state.
  - Generate the definition from `capText` for every known state.
  - Take the definition out of the trim order. If the card is still over its height, stop and report.

### M4. Phone Today drops MarketCard content, and the yardstick cannot see it
- **Where.** D3 (:31) and S1-P4 (:102-104).
- **Problem.**
  - MarketCard.jsx:81-91 also renders:
    - `StatusAlert` (「数値は表示しません」);
    - `distReasons`;
    - `dating.todayNote` (「…時点（M/D分は再集計待ち）」);
    - the ▲/○ `brief-warnings` (独自判定);
    - the split alert;
    - the 「IBDの公式値ではありません」 line about RS推計.
  - plan.md names none of these (grep).
  - §5.3 opens every fold and extracts sentences by selector. Demoting any of these into the closed fold, or deleting it, is invisible to the yardstick.
- **Fix.**
  - Give each element a place on the phone:
    - `todayNote` and any firing ▲注意 go in the first fold;
    - the rest go in the fold;
    - the disclaimer stays on Today at every width.
  - Extract the closed first fold per market state.
  - Keep the four facts' AsOf / blockAsOf.

### M5. The stop has two numbers for one level
- **Where.** D8 (:36), S2-P2 and S2-P6.
- **Problem.**
  - The plan's stop is `entry × (1 − pct/100)` (positionSizing.js:272-275), where `pct` is one of:
    - the viewer's persisted `stopPercent`;
    - the structural stop.
  - The stop row uses a fixed pivot −7%.
  - With any non-default setting, or after 「この位置を使う」, the strip, chart tag and plan card show one stop while the row shows another. That is B's own blocker "two stops on one stock" (b-chart/notes.md:213).
  - The 49,001-pivot vitest and brief-strip.spec test the default 7% only.
  - If D8's `toFixed(2)` enters the computation, it moves risk, r2, r3 and the `floor()` share count on some rows.
- **Fix.** The owner chooses one of two options:
  - **(a)** On a pivot-basis plan, the row judges against the plan's own stop and prints it under the plan's name.
    - Cost: 該当 then depends on viewer settings.
    - The count diff is stated at defaults only.
  - **(b)** The row stays at −7%. When the plan's stop differs, it prints that value beside its own, under the plan's name.
  - Either way:
    - `plan.stop` stays unrounded; it is rounded only when printed, and the comparison uses the printed cents.
    - Add test cases with `stopPercent` 5 and with the structural stop applied.

### M6. The stop row hits beside a buy plan on fell-back rows
- **Where.** D10 (:38) together with BEH-1.
- **Problem.**
  - 実測: 55 of the 58 hits are fell-back rows that keep a pivot-basis plan.
  - On those rows the strip prints 損切り equal to the level the row says was reached, plus 株数 N株.
  - On 11-12 (a 0% day) the strip reads 参考. How many rows carry no qualifier under a 50% market is 未検証.
  - This is the "share count beside an active sell sign" major that B fixed in round 5.
- **Fix.**
  - Report it to the owner with the numbers, together with BEH-2 and D10.
  - Until the owner decides, add a display-only strip line: 「保有なら：仮の損切り X に到達（売りのサイン）」.
  - Measure the count under a forced 50% market.

### M7. The 種別 vocabulary has no kind for estimates
- **Where.** `gateFacts` (:70), S3-P2 (:209-210) and S1-P4 (:104).
- **Problem.**
  - The kinds are only 実測, 独自判定, 独自設定 and 実測・基準は独自設定.
  - TT達成数 counts the 8 conditions 「RS推計70以上を含む」 (marketTabModel.js:69). A 実測 tag, as C printed, hides RS推計 (content rules 3 and 8).
  - リーダーの健全度 is our own definition, and MarketCard's footer calls these aggregates 独自集計.
  - On the SPY row, two gaps:
    - S3-P2 says "the regime's count", but the phone's one-row wording (:104) drops that label.
    - The regime's own threshold is printed nowhere: 4 days makes 上昇に圧力 (market_regime.py:31, :265-275).
  - Whether the published 200日線より上 is the breadth-guard input is 未検証.
- **Fix.**
  - Add the kinds 「独自集計（RS推計を含む）」 and 「独自定義」.
  - On the phone, the SPY row says 「局面判定が数える」 and names the regime's threshold of 4. It keeps the display tier (5–6 / 7+) apart from that threshold.

### M8. The 指数側／銘柄側 split departs from A and lists TT達成 twice
- **Where.** S1-P4 (:104).
- **Problem.**
  - The 指数側 box holds "the four facts Today shows now" (marketTabModel.js:307): 分配日, TT達成数, 200日線より上 and 新高値・新安値.
  - 銘柄側 also lists TT達成.
  - A's split is different:
    - 指数側 = 分配日 SPY and 新高値／新安値;
    - 銘柄側 = TT達成, 上抜けの維持 and リーダーの健全度.
  - 「判定には使わない別集計」 is promised only for the 1440 pane.
- **Fix.**
  - Use A's grouping on the phone, with the same rows as C's pane.
  - Show TT達成 once, under 銘柄側.
  - Label ^GSPC/^IXIC 「判定には使わない別集計」 on the phone as well.

### M9. The strip lacks B's 前提 line and its 推奨 tag
- **Where.** S2-P2 (:137-143).
- **Problem.**
  - B's strip (b-chart/index.html:1443-1470) has:
    - a title for each state;
    - the tag 「買いの推奨ではありません」;
    - the 前提 line 「口座 $50,000・1回 1.25%（$625）・買値 X（終値／ピボット）・損切 −7%」;
    - for stocks with no plan, a sentence naming 仮の損切り.
  - B added these after its blocker "strip shares without assumptions" (notes.md:254).
  - The plan names only 「試算」 in the title. On a 50% day with a 買いゾーン stock, the strip under the chart is an order ticket.
- **Fix.**
  - Define the title for each state, plus the tag, the 前提 line and the no-plan sentence.
  - Fit them within the 3124 cap or report the overrun.

### M10. The yardstick cannot prove that values did not change
- **Where.** §5.3 and §5.4 (:256-267).
- **Problem.**
  - **(a)** counts.json (実測 keys above) holds no gate kind, plan, sell tally or chip. "cmp-identical" proves neither that BEH-1 stayed out of `tally()` nor that D8 left the plans as they were.
  - **(b)** A number multiset loses the label. Swapping 50日線より上 with 200日線より上, or ゾーン上限 with ピボット, still passes.
  - **(c)** Sentences are taken by main's selectors, which miss new components and dropped disclaimers.
  - **(d)** Nothing checks colour or ▲, and nothing scans for forbidden phrases.
  - **(e)** Nothing checks that every surface states the same verdict.
- **Fix.**
  - **A per-row ledger** on the 11-12 rebuild:
    - Rows: every certified listed row.
    - Markets: as published, forced 50% and unknown.
    - Fields: buyGate {kind, reason, reference, title}; positionPlan {basis, entry, stop, shares, r2, r3, trialOnly, referenceReason, blocked}; the sell tally {hits, strengthHits, weaknessHits, breakdownHits, cautions, unknowns}; the `sellChipView` text; `pivotDistanceText`; the stop row (BEH-1 only).
    - Diff per row, main against each slice head.
  - **values.mjs** emits:
    - label-bound pairs;
    - every visible text line as a multiset;
    - the accessible names.
  - **A computed-colour assertion** for the 銘柄側 rows and the strip cells.
  - **A phrase scan** for 〜してください, 推奨 (outside 「推奨ではありません」), 買い時, 今すぐ and エントリー.
  - **A cross-surface oracle:** band = gate = call line 1 = pane = 市場 tab = `modelMarket` label + `capText`, in all 9 market states.

### M11. The FTD states are not safe in the first fold
- **Where.** S1 table (:83) and the trim order of S1-P4.
- **Problem.**
  - Below the 50-day line with an FTD upgrade, the first fold shows 「2条件中1条件」 and 「FTD確認済み」.
  - 「参考・目安は動きません」 is promised only inside the fold, and the trim order may merge the sign line into the status line.
  - The 一致していません conflict sentence sits inside the fold, while the first-fold 根拠 line states one side only.
- **Fix.**
  - In the first fold, always print 「FTD確認済み（参考・目安は 0%のまま：SPYが50日線の下）」, never merged.
  - In a conflict, the 根拠 line adds 「（指数の履歴と不一致・下に詳細）」.

### M12. 「判定なし（上抜けの終値なし）」 is false on some extended stocks
- **Where.** S2-P6 (:173).
- **Problem.**
  - 実測: 5 extended rows have no dated breakout but close above the pivot.
  - The cause is 未検証. Three paths return null:
    - the 60-session lookback (breakoutHistory.js:13, :100);
    - the pivot-bar floor (`crossingFloor`);
    - a missing close.
- **Fix.**
  - The reason names the actual cause, e.g. 「直近60営業日に上抜けの日付なし」 or 「ピボットの日以降に上抜けなし」. Never claim there is no close above the pivot.
  - Add a vitest for each cause.

### M13. ウォッチの注意 reads 0件 while a watched stop is reached (a consequence for the owner)
- **Where.** D7 and S2-P6, together with TodayView.jsx:58-76 (`watchAttention` counts `breakdownHits` only).
- **Problem.**
  - After BEH-1, the tile says 0件 while that stock's sell card says 該当.
  - D7 defers this to BEH-2, so it is not a wording fix.
  - A longer tile is also untested against Today's height pins.
- **Fix.** List it in `docs/ui-abc/s2.md` and the owner's BEH-2 decision, with the count of watched-style rows affected on the rebuild (58 hits).

---

## Minors

- **m1. Band rule versus unknown and loading.** S1-P3 requires 独自 in every state of the band, but the unknown and loading forms have none. Either exempt them explicitly or add the word. Also assert that they never print 0%.
- **m2. 「NAS調整中」 has no stated home.** The 50% row's example is the rally sentence, which `tileReading` produces only at cap 0 (briefEnvironment.js:123-131). The 50% and 25% rows carry the suffix plus `nasdaqNote().long`.
- **m3. The stop at 375x812 and on extended stocks.**
  - At 375x812 the strip's stop is expected 20-40 px under the dock (未検証). Main's tiles sit at 213-289 at 390. Assert that the chart's 損切り tag is in the first fold at 375x812.
  - On extended stocks, the strip prints 損切り —, and a 該当なし 仮の損切り sits inside a closed fold. Name it in the strip, as B does.
- **m4. The stock call's 地合い line has no date** (S2-P1). B printed 「地合い 11/12」. Add M/D, or the B1 更新待ち form.
- **m5. The fold summary's 判定なし count leaves out the visible stop row** (「判定なし n件・損切り 判定なし」). Separate the segment.
- **m6. Optional measured fact for zone rows.** Zone rows with an earlier breakout read 判定なし under ruling S3, which is kept. Optionally print the measured 「M/D の上抜けの後の最安値 X」, and test the shakeout shape within 232.5.
- **m7. §8's critic questions cover only the 0% day.** Add the 50%, 25%, FTD and late-publication states to every slice's questions and screenshot sets.
- **m8. D9 coverage.** The list `StockSellCard.jsx:17,36,69` misses `statusLine`'s 「判定していない項目 n件」 (:50), which names the same state. Either include it in D9 or state that sentences giving a reason are out of scope.

## What is sound

- **D7** keeps BEH-1 out of `tally()` and `BREAKDOWN_KEYS`, and it states the count diff in advance.
- **D9** changes copy only.
- **D14** has a property test: all 再開 conditions met ⇔ `cap > 0`.
- **The unknown, loading and manifest-failure states** never print 0%, 未達 or 達成.
- **The probe's expected diff** is stated before the run.
- **Fixtures and oracles** are frozen.
- **D16** keeps the 2x2 filter grid.
- **D11** keeps the chart above its narrow-chart threshold.
- **The owner options** carry numbers.
