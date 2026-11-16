# Design critic: implementation plan for A + B + C (plan.md of 2026-11-16)

Reviewer role: a senior product designer for dense financial tools, phone first. I only read and measured. I did not edit the repository and did not commit, push, dispatch or delete anything.

What I read:
- `ui-abc/plan.md` (all 407 lines) and `ui-abc/survey-design.md` (§4, §1).
- `design-r3/final-r7.json`, `gate-r7.json`, `brief-common.md`, and `c-cockpit/notes.md` (round 6, 1440 density).
- `present/img/{a-today-390,b-stock-390,c-pc-1440}.png`, plus the A, B and C prototype shots (list, stock, 1440).
- `ui-abc/shots-main/*` (today 0% and 50%, list 0%, stock ZZNV 0%, today 1440) and `shots-main/states/geom-*.json`.
- Code at main `01066ebe` in `/home/user/screener/.claude/worktrees/ui-plan`: `BriefApp.jsx:82-90,238-252`, `brief.css:12-18,196-203,352-359,650`, `brief-watch.css:60-73`, `brief-decision.css:72-77`, `StockVerdict.jsx`, `buyGate.js:130-161`, `priceChart.js:39,133-157`, `brief-chart.spec.js:430-440,898-955`, `brief-phone.spec.js:18-45`, `tools/design-review.mjs` (axe and theme per capture).

## 実測 (measured) and 未検証 (not verified)

**実測:**
- Text widths measured with Chrome for Testing 147 headless and the CI fonts.
  - Setup: `FONTCONFIG_FILE=scratchpad/ci-fonts/fonts.conf`, isolated spans in the app's font stacks (`tokens.js:24-25`).
  - Scripts: `node ui-abc/critic-design-tools/measure.cjs`, `measure2.cjs`, `measure3.cjs`. `/proc/loadavg` was 0.27 0.10 0.23 at the start and 0.00 0.00 0.09 at the end.
  - These are text widths only; nothing was laid out in the app's DOM.
- Real 11-12 rows with a four-digit price: 9 of 980 listed rows (FCNCA 2,317.86, LLY 1,427.28, GWW 1,502.61, MTD 1,730.93, MPWR 1,447.40, BLK, URI, ARGX, MCK). Source: `python3 -I` over `audit3/r3-harness/snapshot/out/45601a2/rows.jsonl`.

**未検証:**
- Every available-width figure below. These are derived from CSS:
  - bar line 1 = 390 − 8 (bar padding) − 8 (title indent) − 4 (gap) − 44 (toggle) − 8 = about 318 px at 390, 303 at 375 and 248 at 320;
  - strip cell content of about 57 px at 390.
- Every px forecast quoted from the plan, and every row-count forecast.

Measured widths (16 px bold unless noted):

| Text | px |
|---|---|
| 地合い 50日線割れ（弱含み・独自判定）・新規買い 0%（独自設定） (rung 1, 0%) | 497.8 |
| 地合い 50日線割れ・新規 0%（独自判定・独自設定） (rung 2, 0%) | 385.8 |
| 50日線割れ・新規 0%（独自） (rung 3, 0%) | 221.4 |
| 上昇トレンド・新規 最大50%（独自） (rung 3, 50%) | 276.5 |
| 長期トレンド警戒・新規 0%（独自） (rung 3) | 267.6 |
| 新規購入を抑制・新規 0%（独自） (rung 3) | 251.6 |
| 地合い 市場未確認・買いは見送り | 244.5 |
| 地合い 控える・目安 0%（独自判定） (width evidence only) | 272.0 |
| 地合い 検討可・最大50%（独自判定） (width evidence only) | 276.5 |
| 地合い 買いは控える・目安 0% / 地合い 検討可・目安 最大50% | 224.0 / 216.9 |
| 12 px: 独自判定・独自設定・11/12（木）引け | 209.1 |
| 12 px: 分析基準日 10/2（金）引け・2営業日前（10/5・10/6 未反映） | 335.4 |
| 14 px: 0%＝新規建ての上限（口座比・独自設定・未検証） | 328.2 |
| 14 px: 0%＝新規建ての上限（口座比・独自設定） | 272.2 |
| 14 px: 買いの再開：2条件中 0条件（独自設定） | 257.5 |
| mono 16 bold: 465.14 / 3,456.78 | 57.6 / 76.8 |
| 12 px: リスク $625 / 52週高 114.16（+3.1%） / 上限25%・実リスク $590 | 66 / 134.9 / 138 |
| 12 px / 14 px: ピボットを確認できないため位置は未確認です。 | 264 / 308 |

## Verdict

The plan is careful about the owner lines, verification and behaviour. As a design plan it keeps A's intent on Today only in part, and it does not yet carry B's or C's intent in the places they were chosen for:

- **S1:** the band form in the phone bar cannot meet the plan's own visible-独自 rule at 320. On every phone it drops the subject 地合い (blocker).
- **S1, Today:** the first fold shows a count 「2条件中 n条件」 where A named what reopens buying.
- **S2:** "chart and strip together in the first fold" is aimed only at bare 390x844, and the plan's own numbers put it at the dock line there. The installed-PWA sizes are not checked, and 375 is an accepted miss. The strip's quarter-width cells cannot hold several real states.
- **S3:** the pane split gives the candidate table about 495 px, where C needed 604-710 px and C's own round 5 failed at 470. The acceptance asks only for the "chart top" in the stock pane, not the four numbers.
- **The buyable day** (50% / 25%) has wording but no design: tone, strip title, the table's blocker cell, the gate card's fold.

Counts: blocker 1, major 12, minor 5. All are fixable inside the owner lines.

**Defensible cuts** (I would keep them):
- D1, the lazy stock seam.
- D4: the 508 pin, with the strip as a sibling and not a split SVG.
- D6: 価格の位置 at ≥1024 only.
- D7: BEH-1 kept outside `tally()`.
- D9: 判定なし everywhere.
- D10.
- D16: the 2x2 filter grid, which also makes minor A1 moot.
- D2's principle: no extra 44 px row on ウォッチ and the stock screen. O1's numbers show it does not fit. The form is the problem, not the principle.
- D12, D13 and D14.

## Coverage of the four questions

**Owner lines kept by design intent:**
- (1) Today's first fold at 390 answers "can I buy" and "why" (one 根拠 line), but only counts "what reopens". See issue 7.
- (2) B's chart and strip together in the first stock fold: not secured at 375, or at the installed-PWA sizes, and marginal at bare 390. See issues 4 and 6.
- (3) C's 1440 one-screen review: not secured. See issues 2 and 3.

**Least harmful cuts:**
- Good: D4, D6, D7, D16.
- Better cuts exist for:
  - D3: name the conditions and merge the tiles (issue 7);
  - D11: the table gets the width and the chart goes to the narrow placer (issue 2);
  - S2's trim order: the readout first (issue 4).

**Type:** not planned. See issue 10.

**Touch targets:**
- Stated at 44 px:
  - the 再読み込み button (S1-P1);
  - the band link (the whole bar title, in a 48 px bar);
  - the gate kicker 「市場の詳細 ›」;
  - the gate fold summary;
  - the period row, including the fifth button (S2-P7's cut rule).
- The 2x2 filter grid is unchanged (D16). The 1440 table ticker is stated at ≥24 px.
- Unstated:
  - the ≥1024 bar chip (whether it is a link, and its size);
  - the ≥1400 filter chips, including 「±5%以内」;
  - whether the whole 1440 table row or only the ticker opens the stock;
  - the merged tile row proposed in issue 7, which must be 44 px.

  See issue 18.

**Themes:** dark is in the screenshot matrix and in S1's acceptance, but not in S2's or S3's acceptance, and no new spec checks contrast. See issue 15.

**States:** see issues 8, 12 and 13. The buyable day is the largest gap.

## Issues (ranked)

### 1. BLOCKER: S1-P3 / D2, the band ladder in the phone bar
**Problem:**
- Line 1 of the bar has about 318 / 303 / 248 px at 390 / 375 / 320 (未検証, from CSS). Rungs 1-2 measure 386-498 px (実測), so every phone gets rung 3 on every 0% day: 「50日線割れ・新規 0%（独自）」.
- Rung 3 drops 「地合い」. On 候補 and ウォッチ, a screen full of stock rows, 「50日線割れ」 without its subject reads as being about a stock.
- Rung 3 also shrinks both required labels to a bare 「（独自）」, which is neither 独自判定 nor 独自設定.
- At 320, rung 3 does not fit for 上昇トレンド (276.5 against about 248: 28 px over) or 長期トレンド警戒 (267.6: about 20 px over). 新規購入を抑制 (251.6) is inside the error of the derived width. `.brief-bar-title b` has `text-overflow: ellipsis` (`brief.css:14`), so on the buyable day the ellipsis cuts the label. S1 acceptance 1 cannot pass as specified.

**Fix:**
- Rebuild the ladder around subject + answer + figure. Prove it by measurement in the DOM at 320 / 375 / 390 for every state of the S1 table before S1-P3 starts, leaving at least 8 px of slack (CI fonts are not the phone's fonts).
- Each label must stay with what it labels: the verdict with 独自判定, the 目安 figure with 独自設定.
- The table's 「…目安 0%（独自判定）」 strings are width evidence only. They put the wrong label on the figure.
- A shape that fits: line 1 is the answer and figure (「地合い 買いは控える・目安 0%」, 224 px, 実測), and the labels are carried where they fit (for example 「独自判定・独自設定・11/12（木）引け」 on line 2: 209 px at 12 px, 実測).
- In the late-publication state, line 2 is already full with the age. There the age wins, and the labels must then fit on line 1 (a 14 px line 1 is allowed, 未検証).
- Never use bare 「独自」. Never drop 地合い. Never allow an ellipsis on line 1: assert `scrollWidth <= clientWidth`.
- If no form fits a state at 320, report that state with its numbers. Do not ship a truncation.

### 2. MAJOR: S3 D11 / S3-P1, the pane split inverts C's density
**Problem:**
- The plan sets 320 / about 495 / about 545 (market / table / stock) to keep the chart above `NARROW_CHART_WIDTH` 480.
- C's own form was 360 / 604 / 476 on #today and 360 / 710 / 370 on #list. Its round-5 gate major was "the table was not dense" at a 470 px table (7-8 rows). C's notes say 状態 and 止めているもの "cannot both be two lines at 470" (`c-cockpit/notes.md:188-203`).
- The plan's seven columns sum to about 680 px at C's widths (未検証), so "≥15 rows" at 495 is not credible. It is also only a target, with "fewer is reported".
- The reason given for 540 is weak:
  - S3-P4 already expects every 1440 view to change.
  - C itself ran the stock pane in the narrow chart mode.
  - The narrow placer is the one audited collision-free at 320-390.
- The market pane at 320 is also narrower than C's 360. C's rail, at 13 px, already ended at 822-886 of 900, so the 再開 conditions and signs would fall below the fold.

**Fix:**
- Decide the split now, table first: rail 340-360, table ≥600, stock about 440-480 in the narrow placer at 1400-1440.
- Add a density spike before S3-P1: one static table with real 11-12 rows at 1440x900 and 1400x900.
- Make acceptance measurable, as C's `densityCheck` did:
  - every row is ≤2 lines and ≤50 px;
  - ≥14 rows fully visible on 候補 ±5%以内 and すべて, and ≥11 on Today;
  - the rail's last row ends ≤900.
- If the narrow chart is rejected, cut a column instead (C dropped 決算日; Today omitted 前日比), and say which one.

### 3. MAJOR: S3 acceptance 1, "one-screen review" is not tested
**Problem:**
- At ≥1024 the plot is a fixed 470 px (`brief.css:359`). In a 545 px pane the stack is about:
  - bar plus stock head, about 136;
  - call, about 150;
  - chart card, about 660 (periods, a readout that wraps at 545, the 470 plot and the legend).
- That puts the B strip at about 950-1050 (未検証), under 900. The four numbers (ゾーン上限・ピボット・損切り・株数), and with them the reason the owner took B, are not on the one screen.
- B's own 1440 form put the strip beside the call, above the chart (`b-chart/shots/stock-1440-light-fold.png`).
- The acceptance only asks for "the call and chart top".

**Fix:**
- At ≥1400, place the strip directly under the call (attached to the chart card's top edge), or size the pane's plot to the remaining height (for example `min(470px, 100vh − ...)`).
- Acceptance at 1440x900 and 1400x900: the call's 地合い and 銘柄 lines, the strip's four values and the whole price plot are inside the stock pane without scrolling, on ZZNV / ZZAR / ZZMO and one four-digit-price stock. Stepping with j / k keeps that true.

### 4. MAJOR: S2-P2 / S2 acceptance 1, B's first fold misses the phone the app is used on
**Problem:**
- The plan's own estimate puts the strip's end at 780-790 against the dock at 788 (bare 390x844). That estimate is taken from the 0% marketHold geometry (call 56-363, `geom-phone.json`).
- The governing state is the buyable-day zone stock, which carries:
  - the new 地合い line plus the 銘柄 title;
  - the 2-line sub 「ピボット比…。ピボットから＋5%までが買いの範囲です。」 (`shots-main/today-default50`, `design-r3/current/stock-ZZNV-390-light-fold.png`);
  - possibly the caution line.
  
  That call is taller (未検証, about +30-60 px).
- This app is an installed PWA. `brief-phone.spec.js:18-21` already tests Today at 375x812 with insets 44/34 and at 390x844 with 47/34. That gives first folds of about 630 and 659 px (95 → 754 at 390).
- Even with the plan's estimates, call 129 + gap 10 + card 508 + strip 76-88 = 723-735 px. That misses the PWA fold by 64-76 px before the call grows (未検証 arithmetic).
- S2 acceptance checks bare 390x844 only. 375 is an accepted miss. "Report the position" is not a fallback. The trim order leaves out the one large in-card saving B itself made: the readout's 3 rows (48 px of HTML, not SVG) become B's one row.

**Fix:**
- Name the governing states: the buyable-day zone stock, the 0% marketHold stock, and an earnings-soon stock.
- Assert at four sizes: 390x844, 375x812, and both PWA inset sizes.
- Add to the trim order, first: the readout to one row (date・終値・前日比・ピボット比), with the rest in the legend or the 1440 ladder.
  - That lowers the 508 pin; it does not raise it.
  - It is a stated probe diff, not "untouched": the probe records the card height, and the heights check reads it. The diff is the card height in every phone view, and possibly the value views (480). State it before the run.
  - The SVG labels themselves should not move (未検証).
- Name the fallback now and use one order on all phones. If "under the chart" fails at any of the four sizes, the strip goes directly under the call, on the chart card's top edge. The strip and the price plot stay together in the fold and the volume pane is cut instead. Record it as a deviation with the measured numbers (an owner option beside O3).

### 5. MAJOR: O3 / D4, B's "large chart" is offered all-or-nothing
**Problem:**
- The owner chose 「Bの大きなチャート」. The plan ships today's chart unchanged: the price area is about 210 px of the 340 px SVG at 390 (未検証, read off the screenshot), because the volume and RS panes share it (`priceChart.js:141`: volH 15%, rsH ≥40).
- The only alternative offered is +360 px (O3). No middle option inside the 508 card is offered or measured.

**Fix:**
- Measure and offer an in-card middle option:
  - the readout to one row gives about +32 px to the plot (未検証);
  - the RS pane collapses to its one-line note when it prints 「RS線 未配信」 (about +25 px, 未検証);
  - the card stays 508, so the exact pins hold.
- Price it as a stated probe diff (every phone view re-placed; `labelAudit` must stay green) and put it in §9.2 as O3-a. The same readout pixels can buy either fit (issue 4) or size: say which one the plan takes.

### 6. MAJOR: S2-P2, the strip's quarter-width cells do not hold real states
**Problem:**
- Four cells in a row at 390 leave about 57 px of content per cell with today's tile padding (`brief.css:196-197`; 未検証). Against that (実測):
  - 465.14 is 57.6 px;
  - four-digit prices are 76.8 px, and 9 of 980 listed rows have them (FCNCA 2,317.86, LLY 1,427.28 …). `nowrap` would clip or overflow a price;
  - 「リスク $625」 is 66 px, 「52週高 114.16（+3.1%）」 135 and 「上限25%・実リスク $590」 138;
  - D5 moves 「ピボットを確認できないため位置は未確認です。」 (264-308 px) into a cell "unchanged": 4-5 lines in one cell.
- The 76-88 px strip estimate covers only the plain state.
- If the strip reuses `.brief-kgrid` outside `.brief-call`, its labels fall to 11 px: the 12 px override is scoped to `.brief-call .brief-kgrid` (`brief-decision.css:75`; `brief.css:198`). Those labels carry 「−7.0%」 and 「+5%」.

**Fix:** per-cell fit rules in S2-P2:
- a value is never clipped. Order of preference: one row at 16 px; one row with the values at 14 px mono; 2x2. "No clipped value" wins over "one row".
- A 2x2 strip doubles its height in the shortest fold (375 PWA, about 630 px). The under-the-call fallback of issue 4 is what absorbs that height; say so in S2-P2;
- the unknown-pivot sentence becomes one full-width line under the strip, with the cell reading 未確認;
- the 52週高 and cap forms get a full-width sub-line;
- the strip has its own size rules: label ≥12, value ≥16;
- add a four-digit-price mutator to §5.2, with assertions that no clipped value appears (`scrollWidth <= clientWidth` per cell) and on the strip height in every state.

### 7. MAJOR: S1-P4 / D3, Today's first fold replaces "what reopens" with a count
**Problem:**
- A's first fold named the two conditions with 未達. The plan shows 「買いの再開：2条件中 n条件（独自設定）」 and folds the names.
- A count reads as progress and does not say which line must be crossed. No prototype tested it.
- Its meaning with 未確認 conditions is unspecified. The state table says both "shown only when … known" and "every condition 未確認" for 市場未確認. 「2条件中 1条件」 with the other condition unknown would read as 未達 (content rule 1).

**Fix:**
- Print the unmet conditions by name in the first fold, one short line each: 「SPY終値が50日線の上 未達」 and 「局面が上昇トレンド／上昇に圧力 未達」.
- Pay for them by merging the two tiles (97 px) into one 44 px row of two links (「注目候補 21銘柄 ›」 and 「ウォッチの注意 0件 ›」), which saves about 50 px (未検証). Adapt `brief-phone.spec.js:392` deliberately.
- Unknown form: 「再開の条件：未確認」 with no count. Partial form: 「1条件 達成・1条件 未確認」. Assert that no count prints when any condition is unknown.

### 8. MAJOR: the buyable day (50% / 25%) has wording but no design
**Problem:** the prototypes drew only 0%. The plan specifies the 50% text but not:
- (a) the tone of the gate card, the band and the figure. Today's tile and call are zone-green on that day (`shots-main/today-default50-390-light-fold.png`, `current/stock-ZZNV-390-light-fold.png`). A band on every screen in zone green reads as a go signal across the app.
- (b) the N% form of the 「0%＝…」 definition line.
- (c) the gate fold's summary 「根拠と再開の条件」, which is wrong when there are no conditions, and what the fold holds instead. C's 「目安が動く条件」 covers both directions.
- (d) the strip's title when 「参考（地合い 0%）」 does not apply. The tiles' qualifier on that day is 既定条件 or 試算のみ or none (`StockVerdict.jsx:132`). Whether B's 「買いの推奨ではありません」 survives is not said. §8's critic question checks "reads as an order" on the 0% day only, but the buyable-day zone stock (green call + 株数 80株 under the chart) is the riskiest screen.
- (e) the 1440 止めているもの cell for a clean zone row. An empty cell or 「なし」 reads as "nothing stops you".

**Fix:** add a buyable-day section to S1, S2 and S3:
- one tone rule for band, gate and strip on every day (see issue 9);
- the definition line as 「最大50%＝新規建ての上限（口座比・独自設定）」;
- the fold summary per state;
- the strip title on every day carries 試算 and 「買いの推奨ではありません」;
- a clean row's cell prints the facts it checked (for example 「出来高 1.60×（目安 1.4×以上・独自設定）・決算日 未確認」), never an empty cell or 「なし」;
- assertions on the 50% and 25% states at 375 and 1440.

### 9. MAJOR: A's colour rule is silently dropped (survey T1)
**Problem:**
- One of A's cited strengths is "green only inside the candles" (`final-r7.json` A strengths), and survey D notes that the phone rows' day change 「+2.0%」 stays green on 0% days (`survey-design.md:85`, T1).
- The plan never mentions T1, `.is-up`, or the tone of the new band, gate card and strip. It keeps the phone rows as they are (O5).

**Fix:**
- Adopt A's rule in S1 at 0 px: day change in text ink with ↑ / ↓ (it still reads as up, per content rule 12); zone and up colours only inside the chart.
- Apply the same rule to the band, the gate figure, the strip and the 1440 table.
- Assert with computed style, on 0% and 50% days in both themes, that the day change and the new elements (band, gate figure, strip, table cells) use no `--zone` or `--up` colour.
- The plan keeps the chips' zone tones (「same tones」: ステージ2, RS推計 ≥70 …). Decide whether they stay as a stated exception or turn neutral. A blanket "nothing outside the chart" assertion would fail on them.
- If the owner wants green kept, list it as a deviation from A with its reason.

### 10. MAJOR: type sizes are not planned
**Problem:**
- The plan has no size map for its new elements. It relies on the 12 px floor tests and the token scale.
- The brief's rule (body ≥14 px at 390; ≥12 px for anything with a number) is not asserted.
- S1-P3 option (1) is a 12 px market-verdict line. Option (2) moves the band into the bar's 12 px line 2 (`brief-watch.css:67`). The verdict is decision text and needs 14.
- The strip-label 11 px fall-through is covered in issue 6.

**Fix:**
- Add a size table to S1-P3, S1-P4, S2-P1, S2-P2, S2-P6 and S3-P2/P3. Drop option (1), or set it at 14 px.
- Add a spec helper: at 390, the decision text of the new elements (band, gate headline, verdict, 根拠, 再開 lines, strip values and labels, the stop row) is ≥14, except the labels the brief allows at 12; any node with a digit is ≥12.
- At 1440, 12-13 px only for column heads, chips and sub-lines (C's rule).

### 11. MAJOR: S1-P4 trim step 2 removes the visible 独自設定 from Today's first fold
**Problem:**
- The trim order moves 「0%＝新規建ての上限（口座比・独自設定・未検証）」 into the fold. Today's bar keeps the product name, not the band, so the figure 「新規買いの目安 0%」 would then sit in the first fold with no visible 独自設定 (content rule 6).
- The line also wraps at 390: 328.2 px (実測) against about 326 px inside the card (未検証).

**Fix:**
- Keep the definition in the first fold as 「0%＝新規建ての上限（口座比・独自設定）」 (272.2 px 実測, one line) and move 「未検証」 into the fold.
- Or attach 「（独自設定）」 to the figure's label. Replace trim step 2 accordingly.

### 12. MAJOR: late publication is missing from the band and gate state table (content rule 2)
**Problem:**
- The S1 table covers "one session behind" (the market series), but not a late publication, where the analysis day itself is old (`brief-freshness.spec.js:35-105`). That state appears only in §5.2's matrix.
- On Today, the gate headline 「新規の買いを検討できる・最大50%」 is in large type, while the age is only in the bar's 12 px line. The kicker shows the date, but not the age.
- On 候補 and ウォッチ, line 2 keeps today's by-design clipping (the missing-sessions detail drops out, `brief-watch.css:73`). The age part must stay visible once the band shares the bar.

**Fix:**
- Add the row to the S1 table. The gate kicker carries 「M/D（曜）引け・n営業日前」 in the warning tone, as the bar does; the band never pushes the age out.
- Assert at 320 and 390 in that state that the age text is visible (not clipped) on Today, 候補, ウォッチ and the stock screen.

### 13. MAJOR: §5.2, the state matrix misses states the plan itself introduces
**Problem:** the matrix lacks:
- 新規購入を抑制 (S1 table row: 1 met, 2 unmet; the only state with the regime unmet above both lines);
- the basis conflict;
- the earnings-soon gate (`buyGate.js:161`, kind 'earnings');
- a stale pivot;
- a stock with no pivot (the strip's unknown cell);
- a four-digit-price stock;
- a stock whose sell chip is not already in the call;
- the buyable-day zone stock at the PWA sizes;
- late publication on the band.

**Fix:** add a mutator for each (new spec files only; the fixture stays frozen) and list each one under the slice that renders it. The owner asked specifically for every market and stock state, and the buyable day.

### 14. MINOR: D5, chips move below the strip and out of the phone's first fold
**Problem:** the sell chip (for example a climax sign on a call that is not broken) and the earnings chip on positions where `buyGate` does not carry earnings leave the first fold.

**Fix:** when a sell chip exists and the call does not already say it, its short form joins the 銘柄 line. The same applies to 決算日 within n days.

### 15. MINOR: themes, contrast is only covered where CI's data happens to land
**Problem:** dark mode is covered by scratch screenshots. Design Acceptance runs axe per capture in both themes (`design-review.mjs:246-273`), but only on whatever market state its served data shows (未検証: which state that is). The new specs do not check contrast for the new text in the 0%, 50%, unknown and stale states.

**Fix:** in `brief-band`, `brief-gate`, `brief-strip` and `brief-desk.spec.js`, compute contrast in light and dark for:
- the band on `--ground`;
- the warning-tone age;
- 該当 in `--neg`;
- the kind tags;
- the strip border.

### 16. MINOR: S3-P2, 「種別」 values are not tabulated
**Problem:** only 上抜けの維持 (実測・基準は独自設定) is named. Correctness of the other rows is left to the code.

**Fix:** list row → 種別 in S3-P2, for example:
- 判定: 独自判定;
- 目安: 独自設定;
- 根拠 SPY vs lines: 実測;
- 分配日 SPY: 実測 (段階は独自設定);
- 新高値／新安値: 実測・参考;
- 再開 rows: 独自設定.

Add a vitest that pins `gateFacts` kinds to that table.

### 17. MINOR: the 1440 bar chip and the phone band have no shared wording source
**Problem:** the chip text 「地合い 50日線割れ 独自判定・新規買いの目安 0% 独自設定」 (S1-P3) and the phone ladder are written separately.

**Fix:** derive both from `marketBand()` and add one test that both carry the same verdict, figure and labels.

### 18. MINOR: touch targets are unstated for the new desktop controls
**Problem:** the plan gives no size, and no statement of whether these are interactive, for:
- the ≥1024 bar chip;
- the ≥1400 filter chips, including the new 「±5%以内」;
- the 1440 table row click target (row or ticker only).

Design Acceptance enforces 44 / 24 per capture, but only on the screens and states it captures.

**Fix:**
- State the target size and role for each one: ≥24 px at ≥1024; the chip is a link to 市場 or plain text.
- Assert the sizes in `brief-desk.spec.js` and `brief-band.spec.js`.
- Keep any phone control 44 px, including the merged tile row of issue 7.
