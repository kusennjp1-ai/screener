**I could not write report.md.** The Write tool refused it ("Subagents should return findings as text, not write report files"), and I did not route around that. The full report is below. My evidence files are in `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p1-minervini-buyer/`, written as `P1/` from here on:
- metrics: `out/metrics-all.jsonl`, `out/stats.txt`, `out/gate6_alt.txt`, `out/stage_cross.txt`, `out/adr_bias.txt`
- scripts: `scripts/analyze.py`, `scripts/stats.py`, `scripts/gate6_alt.py`
- chart montages: `montage/6m-00..07.png`, `montage/wk-00..03.png`
- my renders: `render/spec/verdict.spec.mjs` on port 4412, output in `render/out/verdicts.json`, `render/out/list-390.png` and `render/out/<SYM>-top-390.png`

Snapshot paths are written `SNAP/` = `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/`. Code lines refer to main 8849bf9, as archived at `SNAP/build/src/`.

# p1-minervini-buyer: are the setup_ready rows buyable on the real 2026-11-12 charts?

## Scope and labels
- **Coverage.** Verdicts cover the 37 ready rows the snapshot rebuilds. The other 6 of the published 43 are 未検証.
- **Proxy bars.** These rows use upstream bars, not the published ones, so their values are approximate: EMR, EQH, IQV, GEO, BB, BHB and DSGR (ready), and HCI and NATL (not ready).
- **Earnings proximity is 未検証 for every row.** The feature run's `days_to_next_earnings` is null for all 48 rows I checked (`P1/fr-slice.json`), and entry-context is not served.
- **Fundamentals are a backend reference only.** EPS and sales growth come from the feature run, not SEC. The brief shows 「SEC 未配信」 here.
- **Market overlay.**
  - The feature run's backend regime on 11-12 is `correction`: exposure 20%, 6 distribution days, no FTD (実測).
  - The snapshot does not serve market trends, so every rendered conclusion reads 「地合い未確認」 and the plan tiles carry 参考. The published market verdict is 未検証.
  - I judged each setup on its own first and applied the market afterwards.
- **"Pinned" vs "deal".** "Pinned price" is 実測. "Deal" and "SPAC" are my inference (未検証), except that CEPO's industry group reads "Finance-Blank Check". The pin thresholds (ADR20 < 0.6% and 20-session range < 3%) were chosen after seeing the charts.
- **Images viewed.**
  - All 48 phone 6か月 cards.
  - Weekly cards for 24 ready rows: PCRX, SWKS, GLBE, EMR, EQH, MGRC, WSFS, FCNCA, BWIN, IDT, IQV, GEO, ADI, DJCO, SIG, RDNT, TECH, ARX, AMAL, BB, BHB, CEPO, CFBK, CTKB.
  - No weekly cards for CZFS, DSGR, FMAO, HAFC, LARK, LCNB, NBTB, OPK, PRTH, RMBI, RNW, TMP, TRST, or for any non-ready row. The HUM, NDSN and NATL calls rest on their 6か月 cards.
- **What reaches users.**
  - The brief never reads `setup_ready`. It has no reader under `frontend/src/static/brief/`, and `CandidateBoard`, `ChartDecisionSummary` and `CandidateCharts` are imported by nothing. Only `/brief/*` is routed.
  - setup_ready reaches people through the coverage report (`frontend/tools/report-data-coverage.mjs:378-388`; the owner's 43/955 KPI) and the research index sentence (`frontend/tools/setup-evidence.mjs:12-13`).
  - What users do see comes from the brief's own logic:
    - the position against the pivot (`researchEngine.js:166-175`);
    - `price_activity.lowRange` (`export-research.mjs:123-125`);
    - the base confidence floor (`briefCandidate.js:209-220`);
    - buyGate.

## Verdicts on the 37 ready rows (実測 on the snapshot charts)
BUY = buy at the correct pivot on volume today, before the market gate. WATCH = a real base, but not actionable at the engine's pivot today. REJECT = not a SEPA setup now.

| Row | Rank | Verdict | Reason |
|---|---|---|---|
| PCRX | 1 | REJECT | Pinned. Gapped +44.4% on 10-08 on 19.3× volume, then 26 sessions at 36.31–36.49 (ADR20 0.15%). The pivot 36.45 is the top of the pin. The chart labels T1−18%, T2−12% and T3−5% from before the gap. The brief shows 買いゾーン, a 244-share plan (参考) and the chip 「VCP 9週 18/5 3T・土台の高値を上抜け（10/8）」. Evidence: `SNAP/charts/PCRX-6m-390.png`, `P1/render/out/PCRX-top-390.png` |
| SWKS | 6 | WATCH | A V-shaped cup. The pivot 89.88 is 3.6% under the 93.24 high, which is the real pivot. Chart says 収縮は未確認. RS 91.6, ext50 7.7%. EPS −31.8% (reference). |
| GLBE | 15 | REJECT | Stage 3 on the scanner. Weekly: a 30–45 range for a year. Crossed on 10-20 at 1.12×, reached 45.28 and fell back to 41.05. RS line 11.2% off its high. |
| EMR | 26 | WATCH (proxy) | Pivot 4.6% under the high. No dry-up (10-session volume 1.20×). EPS +3.9% (reference). |
| EQH | 36 | WATCH (proxy) | −5.7% on 11-05. Pivot 4.4% under the high. Contraction unconfirmed. |
| MGRC | 71 | WATCH | Weekly: a one-year 100–135 range with flat MAs. Gapped up on 11-02 on 27× volume. The pivot is an NR7 trigger 3.3% under 134.61. Ext50 11.5%. |
| WSFS | 72 | REJECT | A failed upthrust on 11-04. NR7 pivot 3.8% under the high. A bank. |
| FCNCA | 73 | REJECT | Stage 3 on the scanner. Drifting after a post-earnings-shaped gap. NR7 pivot 4.3% under the high. EPS −7.7% (reference). |
| BWIN | 75 | REJECT | Pinned. +7.9% on 7.3× on 09-14, then 42 sessions in a 3.2% range. The brief makes a 277-share plan (参考). |
| IDT | 83 | **BUY (setup)** | Weekly Stage 2 (50→84). A 6-week flat flag about 5% deep. 10 of the last 10 sessions under 0.8× volume. RS 94.7, RS line 2.1% off its high, ext50 7.1%. But buy through the base high 84.56, not at the engine's 83.50. |
| IQV | 84 | WATCH (proxy) | A 2-month flat base after a weekly V. The pivot is 3.9% under the high (real pivot about 284.5). Contraction unconfirmed. |
| GEO | 86 | REJECT (proxy) | A 24% shakeout to the 200-day line, then a straight V with no handle. Stage 3. |
| ADI | 93 | REJECT | Contractions 22→10→6→18% (the last one expanded). −11.1% on 3.4× on 11-05. |
| DJCO | 94 | WATCH | Averages about 50K shares a day. V-shaped right side. Pivot 2.6% under 691.07. Stage 3. |
| SIG | 105 | WATCH | Post-gap flag. A failed upthrust to 129.26. Pivot 6.8% under the high. |
| RDNT | 521 | REJECT | One template condition short (its 200-day line fell 0.03% over 21 sessions). A cup with no handle. Pivot 10.9% under the 52-week high. RS line 20.9% off its high. |
| TECH | 1823 | REJECT | Pinned. The brief correctly shows 低変動・監視のみ. |
| ARX | 1826 | REJECT | Pinned. The brief flags it 低変動. |
| AMAL | off-list | REJECT | ADV $12.0M. A bank. NR7 pivot. |
| BB | off-list | REJECT (proxy) | Under $10, 32.9% under the 52-week high, 5 months of chop. |
| BHB | off-list | REJECT (proxy) | ADV $3.5M. |
| CEPO | off-list | REJECT | Finance-Blank Check. Pinned. See finding 7. |
| CFBK | off-list | REJECT | ADV $1.3M. |
| CTKB | off-list | REJECT | $5.52, Stage 3, a wide range. |
| CZFS | off-list | REJECT | ADV $3.0M. |
| DSGR | off-list | REJECT (proxy) | Pinned. |
| FMAO | off-list | REJECT | ADV $1.9M. |
| HAFC | off-list | REJECT | A 6-month trading range with a failed upthrust. |
| LARK | off-list | REJECT | Averages about 7.3K shares a day. |
| LCNB | off-list | REJECT | ADV $0.5M. |
| NBTB | off-list | REJECT | ADV $16.8M. Pivot 6.4% under the high. |
| OPK | off-list | REJECT | $1.67. |
| PRTH | off-list | REJECT | Pinned after a +33.8% gap. The chart labels the pin T1−1% and T2−1%. |
| RMBI | off-list | REJECT | ADV $1.4M. |
| RNW | off-list | REJECT | Pinned. |
| TMP | off-list | REJECT | ADV $10.9M. NR7 pivot. |
| TRST | off-list | REJECT | ADV $7.0M. |

**Tally: 1 BUY setup (IDT), 7 WATCH, 29 REJECT.**
- The 29 rejects:
  - 8 pinned: PCRX, BWIN, TECH, ARX, CEPO, DSGR, PRTH, RNW.
  - 12 illiquid or penny stocks: AMAL, BHB, CFBK, CZFS, FMAO, LARK, LCNB, NBTB, RMBI, TMP, TRST, OPK.
  - 9 on structure: GLBE, GEO, ADI, RDNT, HAFC, WSFS, FCNCA, BB, CTKB.
- On the 18 liquid rows the lists can show, the split is 1 BUY, 7 WATCH and 10 REJECT.
- With the backend's correction regime, even IDT is wait or a small pilot only.
- 22 of the 37 (59%) are low-volatility names: 14 banks or thrifts plus the 8 pins. The ready rate is 36.4% for ADR20 under 0.6%, against 0.8–4.4% in every other band.

## The 10 high-ranked non-ready rows (false negatives)
- **No clear buy-today false negative.**
- **Three are watch-quality, and in each the rejection reason is unrelated to the actual weakness:**
  - **HUM** fails only gate 6. Stage 2, contractions 13%→4% (the brief chip reads 「VCP 5週 13/4 2T」), RS 96.4. On 11-12 it traded to 450 but closed at 443.68 (−0.6%) on 1.36×, under the base high of about 456. That is not a clean breakout, so passing on it today is defensible. But gate 6 would also reject a true up-close breakout day.
  - **NDSN** fails gate 3 on handle age (09-04 handle). It is 3.7% under its base high.
  - **NATL** (proxy) fails gate 3 on handle age (07-31 handle). It is a 4-month flat base, about 9% deep, sitting at the pivot, but RS is weak (76; RS line 10.1% off its high).
- **The other seven are correct rejections:**
  - DRI: a V with no handle; EPS −41.9% (reference). Right answer, but gate 3's reason is the handle's age.
  - BMO, HCI, WSM, LTC: right.
  - SONO: gapped +12.8% and then fell 5.0% on 1.95×. Gate 6 would also have rejected the gap day.
  - PRGS: pivot 8.4% under the high.

## Findings

### p1-minervini-buyer-1 (major): pinned prices pass readiness, and two liquid ones get buy-side treatment in the brief
- **Backend (実測, `P1/out/stats.txt` [A]):**
  - 22 listed rows are pinned, and 8 of them are ready (36.4%). The ready rate for everything else is 3.0% (29/958).
  - 5 of the 5 ready three_weeks_tight rows are pinned. 11 of the 22 listed three_weeks_tight primaries are pinned.
  - SLAB, the one hard-coded cash acquisition (`export-research.mjs:126`), is among the 22.
  - Why the code lets them through:
    - `three_weeks_tight.py:221-300` scores tighter closes higher and has no floor.
    - `three_weeks_tight.py:120-127`: readiness rises as the band narrows.
    - Gate 5 (`explain_builder.py:142-149`) caps ATR but has no floor.
- **Brief (実測, served `SNAP/build/serve/research.json`):**
  - lowRange (the 60-session range under 5%) flags TECH, ARX, CEPO, DSGR, RNW and SLAB.
  - It misses PCRX (55.1%), BWIN (17.9%) and PRTH (53.0%), because the gap sits inside the 60 sessions.
  - PCRX keeps bundle rank 1. It is row 7 in the rendered 候補 list as 「● 買いゾーン +0.1%未満」, with a 244-share plan and the VCP/上抜け chip above.
  - BWIN gets a 277-share plan. PRTH is off-list.
- **Evidence:** `SNAP/charts/{PCRX,BWIN,PRTH,TECH}-6m-390.png`, `P1/render/out/{PCRX,BWIN,TECH}-top-390.png`, `P1/render/out/list-390.png`.
- **Proposed change:**
  - (a) A failing readiness check `price_pinned` (独自判定). It fires when the range since the largest one-day gap in the last 60 sessions stays under Y% for at least 15 sessions, or when ADR20 is under X%.
  - (b) Compute lowRange over the sessions since that gap.
  - (c) Give three_weeks_tight a weekly-range or ATR floor.
  - (d) The VCP chip must not call a post-gap pin a VCP or a 上抜け.
  - Calibrate X and Y on the 22 pinned rows plus SLAB, as 独自設定.
- **Verify:**
  - On the snapshot, pinned ready rows go 8→0, and no non-pinned ready row changes.
  - lowRange covers the 8 pinned ready rows and SLAB.
  - A Playwright render of PCRX shows 低変動・監視のみ and no plan.
  - Golden gate-5 stays at 43.

### p1-minervini-buyer-2 (major): gate 3 (readiness_below_threshold) mostly measures the age of the anchor
- **Code (実測):**
  - For cup_with_handle, raw readiness = 78 + 10·vol − 1.2·handle_recency_weeks (`cup_handle.py:196-203`), calibrated as (raw − 45)/50 (`calibration.py:68-75`).
  - Passing 70 therefore needs a handle at most 6.67 weeks old, even with full volume credit. This reconciles with DRI and WSM at 59.6 and BMO at 69.2.
- **Data (`P1/out/stats.txt` [E]):**
  - By pivot-date age, which is not the same axis as the detector's handle recency, the median falls from 81.7 at 1 week to 40.4 at 16+ weeks.
  - Passes: 27/42 at 1 week; 6/97, 3/111 and 6/55 at 8, 9 and 10 weeks; 0 at 11–13 weeks; 1/14 at 14 weeks; 0 after that.
  - 672 of the 719 gate-3 failures are cup_with_handle.
- **NR7:** the raw value tops out at 58 (`nr7_inside_day.py:200-209`) and calibrates to 73.9 (`calibration.py:96-104`). So any fresh NR7 or inside day clears gate 3. 6 of the 37 ready rows are NR7 primaries, with one-day pivots 2.6–4.3% under the 52-week high.
- **Effect:** NDSN and NATL fail on age, while fresh "handles" on pins (PCRX, PRTH) pass.
- **Proposed change:**
  - Judge readiness on present action against a base-high pivot (distance, tightness of the last N sessions, dry-up), or re-anchor the pivot when price returns to the base high.
  - Count NR7 only inside a base that holds a pivot.
- **Verify:** recompute on a copy of `SNAP/build/scripts/recalc.py` and list the rows that flip; run the 908 auxiliary probe (finding 5); golden gate-5 stays at 43.

### p1-minervini-buyer-3 (major): the pivot sits inside the base, and gate 4 cannot see prior crossings
- **Measured (実測, `P1/out/stats.txt` [C], `P1/out/stage_cross.txt`):**
  - 15 of the 37 ready pivots are more than 5% under the 52-week high.
  - 17 of the 37 traded more than 3% above their pivot after the pivot date and came back: GLBE +11.2%, CTKB +15.7%, OPK +12.7%, BB +11.3%, SIG +7.3%, RDNT +7.1%.
  - The chart names a crossing on 29 of the 37. 18 of those crossings are at least 5 sessions old, and 20 of the 29 were on volume under 1.4×.
  - Of those 18 old crossings:
    - 10 came after the pivot date, so the pivot is stale: GLBE, IDT, ADI, FMAO, HAFC, LCNB, NBTB, OPK, PRTH, RNW.
    - 8 came before the pivot date, so the pivot sits inside prior trading: MGRC, WSFS, FCNCA, BWIN, DJCO, CZFS, LARK, RMBI.
- **Code:** gate 4 (`explain_builder.py:129-140`, band −2%/+3% in `config.py:43-44`) checks only today's distance. The brief already handles 停滞 in buyGate and crossingEvent; the backend count does not.
- **Proposed change:** add `pivot_already_crossed` (a close above pivot+X% after the pivot date) and `pivot_below_base_high` (the pivot more than Y% under the highest high since the base started), or re-pivot to the base high.
- **Verify:** recount on the snapshot with a list of affected rows; run the 908 auxiliary probe.

### p1-minervini-buyer-4 (major): gate 6 (volume_above_dryup_cap) is a one-day coin toss
- **Code (実測):** volume_vs_50d is the last day's volume divided by the 50-day SMA (`readiness.py:159-160`, read at `explain_builder.py:151-158`).
- **Data (実測), last 20 sessions of the 980 listed rows:**
  - It passes on 33.2% of row-days and flips state 5.19 times per row.
  - Ready rows that would fail a sustained dry-up test:
    - by the 10-session mean over 0.8×: 24 of 37 (the mean is skewed by single big days, e.g. MGRC's 27× day);
    - by the count rule (at least 5 of the last 10 sessions under 0.8×): 18 of 37 (only 19 pass).
  - 164 of the 427 gate-6 failures (38.4%) were up closes, e.g. HUM 1.36× at −0.6%, SONO 1.95× at −5.0%, HTFL 2.31× at +1.4%. The gate cannot tell breakout volume from distribution.
- **Round 2's measurement** (`docs/PROGRESS.md:813` on claude/r3-step0; I did not re-measure it): gate 6 failed 458 of 588 entries. None of the 215 entries that closed above the pivot on at least 1.4× passed readiness.
- **Stability only (`P1/out/gate6_alt.txt`):** a 5-session mean under 0.9× has the same pass share (32.8%) and flips 1.86 times. The thresholds differ, and one date cannot show discrimination.
- **Proposed change:** evaluate, not adopt, a multi-session dry-up (the 5-session mean, or `quiet_days_10d` at `readiness.py:182-190`) plus an exemption for up-closes at the pivot. Keep the pass share equal, so the bar is not lowered.
- **Verify:** flip rate and pass share on the snapshot, then entry−control discrimination in the 908 auxiliary probe.

### p1-minervini-buyer-5 (minor): the frozen 908 harness cannot show readiness, and the probe that did is not committed
- **Harness (実測):** `backend/scripts/validate_trade_ideas.py:108-169` returns tt, s2, setup, rs70, fire, score and gate. SETUP is the Markets360 watchlist; the Setup Engine is never run.
- **PR #142 (実測):** its only harness line (body line 96, from a grep of the whole body for Markets360, harness, CH11, CH12 and 908) reads 「908-trade harness | SETUP +52.0pp, unchanged before and after」. It does not say that the column cannot see CH11 or CH12. `docs/PROGRESS.md:812` does say so.
- **Round 2 auxiliary probe (`docs/PROGRESS.md:813`):** setup_ready entries 28/588 (4.8%) against controls 23/575 (4.0%), a +0.8pp difference, which is no timing signal.
- **Not in the repo (実測):** a grep for "setup_ready" in `backend/scripts` and `scripts` on claude/r3-step0 finds nothing.
- **Proposed change:** keep the frozen harness and its metrics unchanged. Commit the auxiliary readiness probe as its own script that reports entries and controls, discrimination and gate-wise failures. Require it for every readiness or stage change, and have PR text state that SETUP means Markets360.
- **Verify:** the committed probe reproduces 28/588 and 23/575 at 8849bf9, offline.

### p1-minervini-buyer-6 (minor): gate 8 uses a second stage that disagrees with the brief's
- **Code (実測):**
  - `quick_stage_check` (`stage_analysis.py:441-490`, called at `setup_engine_screener.py:380-383`) returns stage 1 when the 200-day line rises less than 1% a month. Stage 1 passes gate 8 (`explain_builder.py:170-176`).
  - A price under the 50-day line inside a rising trend falls through to stage 3.
- **Data (実測, `P1/out/stage_cross.txt`):**
  - stage_not_ok has 265 rows, all Setup Engine stage 3. 169 of them are stage 2 on the round-2 scanner, 97 of those closed under the 50-day line, and only 4 fail on stage alone.
  - 8 ready rows are stage 3 on the scanner:
    - 6 of them are Setup Engine stage 1, with a 200-day monthly change from −0.03% to +0.91%: GLBE, FCNCA, DJCO, RDNT, CEPO, CTKB;
    - the other 2 are Setup Engine stage 2: GEO, TECH.
  - The brief shows 「ステージ3」 for GLBE and TECH (`P1/render/out/{GLBE,TECH}-top-390.png`).
- **Proposed change (readiness only):** gate 8 reads the stage the brief shows and requires stage 2. The trend template stays the 8 published conditions, and stage is never a 9th veto.
- **Verify:** recount these 8 rows and the 4 stage-only failures on the snapshot; add a parity unit test.

### p1-minervini-buyer-7 (minor): the setup_ready KPI counts rows the brief never lists, including a SPAC carried by two bad bars
- **Liquidity (実測):** 19 of the 37 ready rows are under $10 or under $20M ADV. 8 have ADV under $5M; LARK averages about 7.3K shares a day.
- **CEPO (実測):**
  - Its industry group is Finance-Blank Check.
  - Its 52-week low is set by a 2026-06-24 bar (low 8.22, close 10.00) and a 2026-06-30 close of 8.83. Every other low is 10.03 or higher.
  - Against the current 10.81, removing only the 06-24 bar gives +22.4% (already under the 30% rule). Removing both gives +7.8%.
  - The 06-30 bar is a one-day close spike, not a wick.
- **Proposed change:**
  - Split setup_ready into liquid and illiquid in the coverage report (`report-data-coverage.mjs:378-388`).
  - Have the daily-bar audit flag both shapes for review: an intraday wick of 15% or more below both open and close, and a single-session close that is 15% or more away from both neighbouring closes.
  - Excluding Finance-Blank Check from listing is a selection change, so it is the owner's decision. It would also remove LION (liquid, rank 368).
- **Verify:** the snapshot report reads 18 liquid / 19 illiquid; a unit test of the bar-audit rule on CEPO's two bars.

### p1-minervini-buyer-8 (minor): readiness never asks whether the base contracted
- **Measured (実測):**
  - The app's own chart reads 「収縮は未確認」 on 28 of the 37 ready rows.
  - Of the 9 rows with a contraction sequence, 4 are not VCPs:
    - PCRX: 18/12/5, all from before the gap;
    - PRTH: 1/1, on the pin;
    - ADI: 22→10→6→18, expanding;
    - RMBI: 7→8→4→3→10→6.
  - The ready primary patterns are cup_with_handle 26, NR7 6 and three_weeks_tight 5, with no VCP primaries. PCRX's diagnostics include `vcp:not_detected`.
- **Proposed change:** expose `contraction_unconfirmed` as a readiness diagnostic, so that "ready" and 「収縮は未確認」 cannot silently disagree. Measure any use of it as a gate with the 908 probe first.
- **Verify:** the snapshot count of ready rows with that diagnostic equals 28.

## 未検証
- Which 6 ready rows and which 18 listed rows of the published site are missing from the rebuild.
- Whether the 8 pinned rows are pending cash deals or SPACs; only CEPO's group label is evidence.
- Every earnings date.
- The published market verdict, and so the published conclusion text for PCRX and the others.
- The published bars of the 9 proxy rows.
- Whether any proposed gate change improves 908 discrimination. I did not run a new 908 probe; I used round 2's measured baseline.
