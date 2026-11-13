**report.md was not written.** The environment refuses report and summary .md files from subagents, so the whole report is in this message and nothing goes in its place. Every script, output and screenshot it cites is on disk at the absolute paths below. Nothing on GitHub was touched, nothing was committed, and port 4415 was used.

# p4-risk-sell-regime: risk, selling and exposure audit (US 2026-11-12, main 8849bf9)

## Summary of findings (ranked)

| id | Severity | Finding |
|---|---|---|
| p4-risk-sell-regime-1 | **major** | 7 of the 21 「ブレイク失敗」 calls credit a breakout to a pivot that formed later. One is MGRC, which is setup_ready and one of Today's 3 watch flags. |
| p4-risk-sell-regime-2 | **major** | Failed breakouts carry no ▲ on unwatched rows. 8 of the 86 certified Today focus rows read 「ピボット接近」 on the list while their stock screens say 「ブレイク失敗」. |
| p4-risk-sell-regime-3 | **major** | A price-pinned stock gets a full VCP and risk plan. PCRX has ADR 0.15%, a −7% stop of about 47 ADRs, and a pre-gap contraction low paired with a post-gap pivot. The 60-session 低変動 test misses it because the gap sits inside the window. |
| p4-risk-sell-regime-4 | minor | A failed breakout is forgotten 10 sessions after the breakout day, so the old pivot comes back as 「ピボット接近」. Examples: SAIL, GEN (−32% since) and PFG. |
| p4-risk-sell-regime-5 | minor | The exposure guide is right in level (0% on 11-12). Its label 「弱含み」 understates a 調整 with 6 distribution days, and nothing tells a holder what 0% means. |
| p4-risk-sell-regime-6 | minor | The chart readout prints 「対ピボット+0.0%」 / 「−0.0%」 where the verdict and the rows print 「+0.1%未満」 (PCRX, PFIS, TECH, LNTH). |

Answers to the three questions:
- **Stop and sell rules:** mostly sound and clearly shown, apart from findings 1, 2 and 4. The 50-day check behaves correctly on real rows.
- **Exposure guide:** consistent with the recovered 11-12 data (実測 below). The difference from the backend's 20% is disclosed.
- **Today:** gives a largely honest picture. Its 接近 count and one watch flag are inflated by findings 1 and 2.

## Method (実測)

**Paths:**
- **P4** = /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime
- **SNAP** = /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot
- File paths below are given in full.

**Code.**
- I extracted my own `git archive 8849bf9 frontend` to /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/src/frontend.
- I bundled the brief's own modules with esbuild: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/bundle/b.mjs, entry /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/bundle/entry.mjs.

**Data.**
- The snapshot's research rows (5955) and chart files, plus its 980 listed rows (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/rows.jsonl).
- I restored the feature run's own `market_above_50dma` / `market_above_200dma` on the 4648 rows that carry a regime. They come from asset 743083867 and are saved in /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/market_fields.json.
  - The export publishes these fields (frontend/tools/export-research.mjs:274), but the snapshot's research.json lacked them.
  - The served copy is /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/serve/research.json.

**Evaluation of the stock screen's own path for each listed row.**
- Steps: candidateView, certifyBars, buildBookTechnicalEvidence, diagnoseBookChart, stockSells, buyGate, then positionPlan with default settings, with the market from modelMarket.
- Script: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/scripts/eval-sell.mjs
- Output: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/sell-eval.jsonl

**Other scripts and outputs.**
- **Today's focus pool and breakouts that later fell back:** /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/scripts/eval-today.mjs, output /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/today-eval.json
- **Crossings against the pivot's date (soft test):** /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/scripts/pivot-date.mjs, output /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/pivot-date.json
- **Day-by-day replay with today's pivot held fixed:** /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/scripts/replay-failed.mjs
- **All one-off measurements in one re-runnable script:** /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/scripts/oneoffs.py, output /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/oneoffs.txt. It covers:
  - the SPY check;
  - the round-lot count;
  - the strict and soft pivot tests;
  - the structural-stop tally;
  - the ADR and gap table.

**Renders.**
- Setup: the app's own screens on its Vite dev server; Chrome for Testing 147 headless shell with the CI fonts; page clock 2026-11-13 20:10:31 JST; data routed as tests/static/brief-fixture.js routes it.
- Config: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/pw.p4.config.mjs
- Specs:
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/src/frontend/tests/p4/p4.spec.mjs runs with a 6-symbol watchlist (MGRC, EMBJ, HALO, ABCL, PCRX, FCNCA). It covers Today, 候補, ウォッチ and 市場 at 390 and 1440, 8 stock screens at 390 and 2 at 1440.
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/src/frontend/tests/p4/p4b.spec.mjs runs with no watchlist. It covers the near list and 4 stock screens.
- Output: screenshots in /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/shots/, and each screen's innerText in /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/*.txt. There were no page errors.

**Denominators.**
- 365 of the 980 listed rows do not certify in the snapshot. They are proxy bars, with the reason 「日足の順序・重複・OHLCVに異常」.
- Every count of sell checks is therefore taken over the **615 certified listed rows**, and is a lower bound for the published 998.
- Today's focus pool has 150 rows, of which 86 certify here.
- Every symbol cited in findings 1 to 4 is a `bundle_seed_accepted` row (exact CI bars), except PAG and CPAC, which are proxy rows and approximate.

## Answers

### Q1: Are stop and sell rules sound and clearly shown on real rows? (実測, 615 certified rows)

**Sell checks:**

| Check | hit | caution | unknown | clear | Notes |
|---|---|---|---|---|---|
| failedBreakout | 21 | – | – | 543 | 51 rows have no pivot, so no check |
| ma50 | 28 | 76 | 3 | 508 | |
| book | 2 | – | – | 613 | |
| day-down | 15 | – | – | 592 | 8 na |

- Strength checks: judged on 37 rows; `na` on 578, with the gate's reason shown.
- Row chips:
  - 「崩れ（独自判定）」: 51
  - 「50日線の下」: 74
  - 「50日線の下・出来高未確認」: 3
  - 「保有なら売りのサイン」: 33

**The 50-day check is sound.**
- All 28 hits are rows one condition short of the template; none is qualified.
- Each hit is dated and carries its volume ratio, e.g. HALO 「50日線割れ（11/6・出来高2.77×）」.
- PBHC, HFBL and CPBI, whose break-day volume is missing, stay 「未確認」.

**The structural stop is mostly unavailable on real rows.**
- 255 certified zone/near rows have a plan. Their structural stop is:
  - `unknown` on 157, of which 153 read 「収縮を測定できません」;
  - `ok` on 83;
  - `tooDeep` on 15.
- So the plan falls back to the 7% default on about 62% of them.
- The 7% stop is about 2.5 ADR at the median (ADR20 p10/p50/p90 = 2.00/2.85/5.96%).
- 「損切りが収縮の中」 shows on 27 rows and not on 71.

**Display is clear:**
- −1R/+2R/+3R prices;
- 「10%未満」;
- ADR beside the stop;
- 「深すぎる（10%以上・見送り候補）」;
- 「試算のみ」 when the market guide is 0%.

### Q2: Is the market exposure guide consistent with the 11-12 data? (実測)

**Yes.**

SPY from the price bundle:
- Close 757.12, against SMA50 764.80 (below) and SMA200 731.29 (above).
- 2.8% under the 60-session high close of 779.09.
- 25-session distribution days: 10/14, 10/16, 10/22, 10/29, 10/30 and 11/5. That is **6, equal to the backend's `market_distribution_days` 6**.

Backend fields (all 4648 rows agree):
- `market_regime` correction;
- `market_above_50dma` false, `market_above_200dma` true;
- `market_exposure_pct` 20, `market_health` 58.7;
- no FTD.

The CI combine log agrees: 「Market context 2026-11-12: emitted from 4648 rows (correction)」.

The brief (rendered from the restored feature-run fields; the Pages copy is 未検証):
- **Verdict:** 「50日線割れ（弱含み・独自判定）」, cap 0.
- **Today:** 「50日線割れ（弱含み）／買いは控える」, with the focus heading 「（地合い：買いは控える・監視のみ）」.
- **Market tab:** 「エクスポージャーの目安 0%」 and 「新規の買いは控えます（独自判定）」.
- **Plan:** 「試算のみ／目安 0%（新規は控える）」.

The brief's 0% against the backend's 20% is disclosed in `exposureRuleText` (frontend/src/static/reference/marketTabStudy.js:72-73: 「バックエンドの局面判定の目安とは別」). It is not a defect.

The CI log's 11-12 environment values:
- `leaderHealthPercent` 58.1 against a rule of under 50, so the rule does not fire;
- `breakoutHoldPercent` 59.0 against a rule of under 40, so the rule does not fire;
- TT count 627.

### Q3: Does Today give a correct, honest picture?

**Largely yes** (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/shots/today-390.png, /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/shots/today-1440.png).
- The header reads 「11月12日（木）の判断」 and each tile 「11/12（木）引け時点」.
- The market tile holds off, and the focus rows lose their green.
- The watch tile reads 「3件・6銘柄を確認・保有未登録」 (EMBJ, MGRC, HALO). ABCL's 50-day caution shows on its row but is not counted, by design.
- At 1440 the right pane shows SWKS.

But:
- 「接近82」 includes rows that their own screens call ブレイク失敗 (finding 2).
- One of the 3 watch flags, MGRC, is misattributed (finding 1).
- 「鮮度未確認」 in these renders is a snapshot gap (no market-trends asset is served), not a defect.

## Findings

### p4-risk-sell-regime-1 (major): ブレイク失敗 is credited to a pivot that formed later

**実測:**
- **7 of 21** failed-breakout hits cross the pivot level before that pivot's bar exists. The strict test (crossing before the bar whose high is the pivot) and the soft test (crossing on or before `se_pivot_date`) both give 7.
- All 7 have an `nr7_inside_day_trigger_high` pivot:

| Symbol | Pivot | Pivot date | Claimed breakout | Notes |
|---|---|---|---|---|
| MGRC | 130.13 | 11/12 (the 11/12 bar's high) | 11/3 | setup_ready pass, liquid rank 71 |
| TMP | 100.83 | 11/11 | 11/4 | ready |
| CZFS | 86.55 | 11/11 | 11/4 | ready |
| TBCH | | 11/10 | 11/9 | |
| OABI | | 11/11 | 11/9 | |
| JILL | | 11/10 | 10/29 | |
| ASO | | 11/11 | 11/9 | |

Evidence: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/oneoffs.txt (section 3).

MGRC's 11/3 close (132.92, 27.0×) did cross 130.13. But 130.13 only became the pivot on 11/12, so the dated event is misattributed. On screen this shows as:
- **Verdict:** 「ブレイク失敗（独自判定）／11/3に出来高27.03×で上抜け、ピボットの下へ戻りました」, with the plan 「参考（崩れ）」.
- **Watch row:** 「▲ 崩れ（独自判定）買いの前提が崩れた／保有なら売りのサイン」, counted in Today's 「ウォッチの注意 3件」.
- **Chart:** the aria label reads 「ピボットを上抜けた日 2026-11-03（上抜け 27.03×）」.

Evidence:
- /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-MGRC-390.txt
- /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/shots/stock-MGRC-390.png
- /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/today-390.txt
- /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/charts/MGRC-6m-390.png

The other 14 hits use `handle_high` pivots whose bar precedes the crossing, so they are genuine by this test.

**Cause:**
- frontend/src/static/brief/briefSell.js:154 calls `pivotCrossings(list, pivot, { lookback: CROSSING_LOOKBACK_SESSIONS })` with no lower bound at the pivot's date.
- frontend/src/static/brief/breakoutHistory.js:10-11 says the pivot is re-detected daily, but pivotCrossings (line 38) credits every crossing in 60 sessions to today's pivot.
- crossingEvent (line 118) and chartCrossing (frontend/src/static/brief/chartReadout.js:303) share the helper.
- With the soft test, 69 listed rows have a last crossing on or before their pivot date. On 11-12 none of them drives a zone event; the effect is on the failed-breakout check and the chart's arrow.

**Proposed change:**
- Bound the crossings below at the pivot bar's date: the last bar on or before `se_pivot_date` whose high equals the pivot to the cent, falling back to `se_pivot_date`.
- Apply this in failedBreakoutCheck, crossingEvent and chartCrossing.
- If no crossing follows the pivot bar, the check reads clear: 「このピボット（11/12）以降の上抜けなし」.

**Verify:**
- Re-run eval-sell.mjs and oneoffs.py on the snapshot.
- Failed-breakout hits should drop from 21 to 14; MGRC, TMP, CZFS, TBCH, OABI, JILL and ASO should be clear.
- MGRC's watch row should lose its ▲, and the watch tile should read 2件 for the same watchlist.
- Add a vitest case: a pivot dated after a heavy crossing gives no hit and no arrow. The handle_high cases stay unchanged.

### p4-risk-sell-regime-2 (major): failed breakouts are invisible on unwatched rows, and Today counts them as 接近

**実測:**
- Sell checks run only for watched rows:
  - frontend/src/static/brief/ListView.jsx:91 has `useWatchSellChecks(kind === 'watch' ? shown : null, brief)`;
  - frontend/src/static/brief/TodayView.jsx:91 and 138 do the same for watched symbols only.
- Of the 86 certified focus-pool rows, **8 are 「ブレイク失敗（独自判定）」 on their own stock screen**, all ピボット接近:

| Symbol | Rank | Pivot distance |
|---|---|---|
| EMBJ | 70 | −0.1% |
| MGRC | 71 | −0.1% |
| EBC | 76 | −0.5% |
| EWTX | 87 | −1.1% |
| ETON | 114 | −2.3% |
| MSFT | 116 | −2.3% |
| HQY | 133 | −3.0% |
| PVLA | 148 | −4.5% |

- After finding 1 is fixed, 7 remain (MGRC drops out). This is a lower bound: 64 pool rows do not certify here.

What the rows and screens show with no watchlist:
- **List rows:** 「EWTX … ◔ ピボット接近 −1.1%」, 「PVLA … ◔ ピボット接近 −4.5%」 and 「ETON … ◔ ピボット接近 −2.3% ▲ 出来高 1.81×」 (the last ▲ is the heavy down day, not the failure).
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/list-near-unwatched-390.txt
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/shots/list-near-unwatched-390.png
- **Stock screens:** 「ブレイク失敗（独自判定）／11/9に出来高1.65×で上抜け、ピボットの下へ戻りました」.
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-EWTX-unwatched-390.txt
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/shots/stock-EWTX-unwatched-390.png
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-PVLA-unwatched-390.txt
- **Today:** the tile 「注目候補 150銘柄・ゾーン68・接近82」 counts them.

**Proposed change:**
- At export, run failedBreakoutCheck and ma50State (briefSell.js) on the served, certified bars.
- Publish a dated row summary beside `rs_line_high`, e.g. `sell_summary: {as_of_date, failed_breakout: {value, cross_date}, ma50: {state, date}}`, validated like validRsLineHigh. An absent field is 未収録 and shows no ▲.
- Rows and focus rows show 「▲ ブレイク失敗」. The near filter and the focus pool mute or exclude these rows, as baseMuted does.
- Check the research index budget: 868 KB gzip against a 1 MB budget on 11-12.

**Verify:**
- On the snapshot, the 7 rows show ▲ in 候補 › ピボット接近 with no watchlist.
- focusCounts().near drops by 7.
- Extend brief-invariants.spec.js ("the rows' tone matches the conclusion's") to an unwatched failed-breakout row.

### p4-risk-sell-regime-3 (major): a price-pinned stock gets a full VCP and risk plan

**実測, PCRX.** PCRX is setup_ready, first in the bundle's liquid order, and 7th row of 候補 › 買いゾーン. It is not in Today's five.

*Bars:*
- 10/7 close 25.20, then 10/8 36.39 on 28.9M shares (50.3×).
- 26 sessions since, all closing between 36.31 and 36.49.
- ADR20 0.15%, 20-session range 0.52%.

*The screen shows* (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-PCRX-390.txt and .../out/shots/stock-PCRX-390.png, stock-PCRX-1440.png; /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/charts/PCRX-6m-390.png):
- TT 8/8 and 「ステージ2」.
- The VCP card: 「9週 18/5 3T・土台の高値を上抜け（10/8）」. This is the pre-gap base, and the gap is its "breakout".
- 「カップ・ウィズ・ハンドル（SE信頼度95）」 with a post-gap pivot of 36.45.
- 「上抜け 0.35×」 on 11/9 (36.43 → 36.46).

*Plan:*
- Prices: 「終値 36.46 で買う場合」, −1R 33.91 (−7.0%, about 47 ADRs), +2R 41.56, +3R 44.12.
- Size: 244株, リスク $625, beside 「ADR 0.1%（20日・独自計算）」.
- 「損切りが収縮の中（安値 24.56 より上）。通常の値動きで刈られやすい位置です」. The plan pairs the last pre-gap contraction low (10/6, 24.56) with the post-gap pivot.
- A fall to the pre-gap close (25.20) would be −30.9%, about 4.4R at the 7% stop.
- Only the market gate keeps the call from reading 「買いゾーン内」.

*Why the guard misses it:*
- The 低変動 guard (`price_activity.lowRange`) uses a 60-session range, which is 55.1% here because it includes the gap.
- frontend/src/static/researchEngine.js:196 sorts lowRange rows last and, among equal scores, favours rows nearest their pivot. So a flat line on its pivot ranks first.

*Wider effect:* the example 20-session test below (ADR20 < 0.5% or a 20-session range < 3%) newly flags **10 listed rows** (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/oneoffs.txt, section 5):
- PCRX: ready, ADR 0.15%, gap +44.2%
- PRTH: ready, zone, ADR 0.37%, gap +33.4%
- BWIN: ready, rank 75, ADR 0.39%
- CCC: ADR 0.42%
- PAG*: rank 142
- BMBL: ADR 0.45%, gap +57.4%
- PTC: rank 400, zone, ADR 0.49%, gap +36.0%
- CPAC*
- SYNA: rank 432, ext
- FUSB

\* proxy row, so approximate.

TECH and ARX are already caught by the 60-session test.

**未検証:** whether any of these is a pending cash acquisition. No news or filings are reachable from here.

**Proposed change.** The thresholds are 独自判定 and the owner's call.
- At export, add a 20-session low-activity test to `price_activity`. A flagged row reads 「低変動・監視のみ」: the plan is blocked and the row sorts last.
- In the plan, say when the stop is more than N×ADR away: 「値動きが極端に小さい（ADR 0.15%）：損切り幅が値動きと見合いません」.
- The structural low must belong to the base the pivot comes from (its legs dated after that base's start). A contraction from before a gap is not used for a post-gap pivot.
- Selection (the template's 8 conditions) does not change.

**Verify:**
- Re-run oneoffs.py, eval-sell.mjs and eval-today.mjs.
- Exactly the flagged rows become `low` and move in the ranking; the listed (980) and ready (37) counts do not change.
- PCRX's plan card shows the PLAN_BLOCKED reason, and 「損切りが収縮の中（安値 24.56…）」 disappears.

### p4-risk-sell-regime-4 (minor): a failure is forgotten 10 sessions after the breakout day

**実測 on 11-12.** Each row below had a heavy breakout after its pivot bar, closed back under, is still under, and the breakout is more than 10 sessions old. Each reads 「ピボット接近」 with the failed-breakout check clear:

| Symbol | Rank | Pivot (handle) | Breakout | Back under | Lowest close since | Now | Sell card says |
|---|---|---|---|---|---|---|---|
| SAIL | 96 | 20.90 (9/4) | 9/22, 2.39× | 9/25 | −12.0% | −1.5% | 「直近10営業日にピボットの上抜けなし」 |
| GEN | 138 | 30.69 (9/11) | 9/14, 1.44× | 9/16 | −32.1% | −3.3% | only the light re-cross: 「11/4 の上抜けは出来高 0.93×（基準 1.40×未満）」 |
| PFG | 134 | (9/11) | 9/18, 2.43× | 9/21 | −8.3% | −3.1% | |

- Rows one condition short with the same pattern: VG, MSM, DK, FTRE, ASND.
- Evidence:
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/work/today-eval.json (`forgotten`)
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-SAIL-unwatched-390.txt
  - /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-GEN-unwatched-390.txt
  - the matching PNGs in .../out/shots/
- Cause: frontend/src/static/brief/briefSell.js:155 filters on `c.sessionsAgo <= failedBreakoutSessions`. The window is anchored on the breakout day, not on the failure.

**Replay with today's pivot held fixed (未検証 as displayed, because the pivot is re-detected daily):**
- SAIL shows ▲ from 9/25 to 10/6 and clears on 10/7 at −6.3%.
- GEN clears on 9/29 at −32%.

**Proposed change.** N is the owner's call.
- Keep the failed state until a close recovers above the pivot, or until the Setup Engine dates a new pivot after the failure.
- After N sessions, show neutral context instead of dropping it, e.g. 「ブレイク失敗後（9/22上抜け→9/25割れ・その後の安値 −32%）」.

**Verify:**
- SAIL, GEN and PFG carry the context line in the verdict and the sell card.
- The 14 genuine in-window hits are unchanged.

### p4-risk-sell-regime-5 (minor): the exposure guide is right in level, but its words understate the regime and it says nothing to holders

**実測:**
- The level is consistent with the data (Q2).
- Today and the market card call 11-12 「50日線割れ（弱含み）」.
- The backend's own threshold for a distribution-driven correction is 6 days (backend/app/services/market_regime.py:32 `DIST_CORRECTION = 6`), and 11-12 has 6.
- 「エクスポージャーの目安 0%」 is paired only with 「新規の買いは控えます」 (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/market-390.txt).
- The sell card, the watch tile and the plan take no market input. A holder learns nothing about what a 0% guide means.

**From code, not rendered:**
- With the published `market_context`, the market tab's cause line (`regimeCause`, frontend/src/static/reference/marketTabStudy.js:337-349, names at :302) would name the same day 「調整」.
- That gives two names for one state on two screens. My renders served no `market_context`.

**Proposed change:**
- When the day's `market_context` regime is correction, label it 「調整（50日線割れ・分配日6・独自判定）」.
- Print the guide with its scope: 「新規の買い：控える（目安0%）」.
- While the guide is 0%, add one neutral, dated line to the sell card and the watch tile: 「地合いの目安 0%（11/12）：保有は各銘柄の損切りと売りのサインで判断」. It is not a recommendation, and the 0% does not change.

**Verify:**
- A Playwright text check on a correction-day fixture for Today, the market tab and a stock screen.
- Today's height at 375 stays within its 1388 line.

### p4-risk-sell-regime-6 (minor): the chart readout prints 「+0.0%」 where every other screen prints 「+0.1%未満」

**実測:**
- PCRX closes at 36.46 against a pivot of 36.45.
- The readout shows 「対ピボット+0.0%」 (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-PCRX-390.txt; /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/charts/PCRX-6m-390.png).
- The verdict on the same screen reads 「ピボット比 +0.1%未満」, and the list row 「買いゾーン +0.1%未満」 (/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/list-390.txt).
- Cause: frontend/src/static/brief/StockChartCard.jsx:51 uses `formatPercent` (chartReadout.js:154), not round 2's pivotDistanceText rule.
- Affected certified listed rows: PCRX, PFIS (−0.0%), TECH and LNTH.

**Proposed change:** print the readout's 対ピボット through the same rule (±0.0% only at the pivot's cents).

**Verify:**
- PCRX's readout reads 「+0.1%未満」.
- A vitest at 1 cent over, 1 cent under, and at the pivot's cents.

## Honesty attack: what held (実測 on the rendered screens)

The screens checked: Today, 候補, ウォッチ and 市場 at 390 and 1440, 12 stock screens at 390 and 2 at 1440.

- **No 「あと0」 and no 「本日」.**
  - 「あと1条件：株価 > 50日線」 is the template's wording.
  - The near-pivot call uses 「あと0.1%未満」 (buyGate.js:94).
- **RS is always 「RS推計」.**
  - IBD appears only in disclaimers: 「IBDの公式値ではありません」 and 「RS推計やIBD RSとは別」.
  - The TT row reads 「RS推計 96（4421銘柄中・2026-11-12・独自推計・IBDの公式値ではない）」.
- **Stale data is never relabelled.**
  - Every tile and event is dated 11/12.
  - From code (briefFreshness.js:13, 37-51): after the 11-13 session closes (06:00 JST on 11-14), no age is shown until 10:00 JST on 11-15. The screen still names 11/12 throughout, so nothing is relabelled as today's.
- **Missing stays missing.**
  - The 3 ma50 'unknown' rows stay 「未確認」.
  - An uncertified chart shows 「売りのサインは未確認です（…）」, 「ADR 未確認」 and 「収縮の安値 未確認」 (EMR: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out/stock-EMR-390.txt).
- **What did not hold:**
  - the misdated breakouts (finding 1);
  - PCRX's contraction low paired across the gap (finding 3);
  - the 「+0.0%」 readout (finding 6).

## 未検証 and snapshot gaps (not defects of the brief)

- **Unserved data.** The market-trends asset, SEC records, earnings dates, research details and the published index are not served here. So 「鮮度未確認」, the 未配信 market tiles, 「SEC未配信」 and 「決算日 未確認」 are snapshot gaps.
- **Market verdict on Pages.** The rendered verdict uses the feature-run fields restored here. That the Pages rows carry the same values is 未検証; the CI log's market_context line agrees.
- **Uncertified rows.** 365 listed rows do not certify here, so every sell-check count is a lower bound.
- **Membership.** Which symbols make up the published 998 and 43 is 未検証.
- **Published pivots.** The published pivots and pivot dates themselves were not read. The values here are the snapshot's recompute on CI-identical bars (seed-accepted rows).
- **Acquisitions.** Whether PCRX, PRTH, PTC, BMBL, BWIN or any other flagged row has a pending acquisition is 未検証.
- **Replay.** The replay in finding 4 holds today's pivot fixed.
- **Analysis-day volume may be provisional.**
  - On 11-12, only 10 of 612 seed-accepted rows have a round-lot (×100) volume, against 606 to 612 on each day from 11-03 to 11-11. SPY's 11-12 volume is 37,043,281.
  - The bundle was generated at 11:55 JST on 11-13.
  - Whether these volumes are understated is unknown. The median 11-12 volume ratio (0.75) equals 11-11's.
  - The October bundle pair (assets 604818246 and 609135986, in /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/dl/) has a different signature, so it does not transfer.
  - HCI (Today #2, 1.28×) is 9% short of the 1.4× bar, so a small understatement could change its call. SWKS (0.77×) would not change.
- **^GSPC and ^IXIC follow-through state on 11-12:** not read.

## Re-run

```
cd /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime
node scripts/eval-sell.mjs bundle/b.mjs /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve work/market_fields.json /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/rows.jsonl work/sell-eval.jsonl
node scripts/eval-today.mjs bundle/b.mjs /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve work/market_fields.json /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/rows.jsonl work/today-eval.json
node scripts/pivot-date.mjs bundle/b.mjs serve work/sell-eval.jsonl work/pivot-date.json
python3 -I scripts/oneoffs.py "$PWD" /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot
cd src/frontend && FONTCONFIG_FILE=/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/ci-fonts/fonts.conf P4_SERVE=/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/serve P4_OUT=/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/out ./node_modules/.bin/playwright test -c /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p4-risk-sell-regime/pw.p4.config.mjs
```