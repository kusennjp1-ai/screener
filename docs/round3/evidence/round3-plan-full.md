# Round 3 plan: Minervini persona audit → build → publish

Planner, 2026-11-13 (JST). Inputs:
- The four persona reports (p1 buyer, p2 data, p3 phone/chart/speed, p4 risk/sell/regime) and their skeptic verdicts, all passed in the workflow JSON. No report.md exists in any persona dir: the harness refused them, so the JSON text is the record.
- docs/STATE.md and docs/round3/snapshot.md on claude/r3-step0.
- The PR #142 body (audit3/pr142.md).
- Round 2's plan (audit2/round2-plan.md), whose structure this plan reuses.

Only skeptic-confirmed findings are used, with the skeptics' corrections applied. Where a correction changes a fix, the corrected fix is the one planned.

Paths:
- `S` = /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad
- `SNAP` = S/audit3/snapshot. This is the 11-12 rebuild on main 8849bf9.
- Persona and skeptic evidence lives under S/audit3/<persona> and S/audit3/skeptic-<n>.

---

## 0. オーナー向けの要約（日本語・時刻は日本時間）

1. 対象は 11-13 20:10 に公開された版（UI 8849bf9・米国 11-12 のデータ）。件数は手元の再現（掲載 980 行・準備 37 行）で、公開版 998 行・43 行の銘柄名は 未検証。
2. 実測：準備のそろった 37 行のうち 8 行は、値動きが張り付いた銘柄。張り付き銘柄の準備合格率は 36.4% で、それ以外は 3.0%。PCRX は 10/8 の +44% の窓開けの後、25 営業日にわたり終値が 36.31〜36.49 なのに、候補の 7 行目に「買いゾーン」・244株の試算付きで表示。（監査役のチャートの読みでは、すぐ買える形は 1 件（IDT）、監視 7 件、見送り 29 件。これは判断で、実測ではない。）
3. 実測：「ブレイク失敗」21 件のうち 7 件は、ピボットができる前の上抜けを数えた誤り（例 MGRC）。保有者に誤った売りのサインを出す。
4. 実測（コードと件数からの推論）：SEC の読み取り失敗 112 件（PayloadMismatch）は、受け取った記録の CIK が整数でなかったため。修正で回復するかは 未検証 で、次の公開のログで判明する。
5. 実測：「EPS 2/342/431」は 25% 基準ではなく Code 33 の EPS 加速の数。第4四半期の EPS を報告しない企業は、加速の合格になりえない。
6. 実測：1440 の最初の表示の最長タスクは 236〜250ms（予算 200ms）。原因は右ペインのチャートの移動平均の名前の配置探索で、約 7ms から約 115ms に増えた。
7. 計画：最初に STEP 0 で検証用の合成銘柄と共通部品を足し、その後、データ・準備と結論・チャート（5項目まで）の 3 トラックで進める。
8. 未検証：公開版の内訳、決算日、第4四半期の参考値の精度、修正の実データでの効果（次の定時公開を読んでから報告）。
9. オーナー判断：第4四半期の EPS を数えるか、張り付きの閾値、一覧への se_pivot_date の追加、ほか（§10）。

---

## 1. Basis and labels

### 1.1 Published facts (pinned, 実測 from CI logs)
- **Publication.** US data date 2026-11-12.
  - Static Site run 43385558863: verified chart universe 4538, long market history updated to 11-12.
  - Research UI Release 43408634161: UI 8849bf9, deployed 2026-11-13 20:10 JST.
- **Coverage.** 998 brief-listed rows. setup_ready: 43 pass / 955 fail.
  - Top failed checks: outside_early_zone 735, readiness_below_threshold 726, volume_above_dryup_cap 435, stage_not_ok 272.
- **SEC.**
  - 998/998 records.
  - sec_state: ok 775, invalid_payload 112 (all PayloadMismatch), no_quarterly 84, stale 11.
  - eps_unknown fiscal_q4_untagged 398.
  - sec_conditions eps 2/342/431. This is Code 33's EPS acceleration.
  - Code 33 pass 0.
- docs/STATE.md still quotes the 10:14 publication (941/41/101). This plan uses the pinned figures above.

### 1.2 Snapshot rebuild (実測 on SNAP)
Every acceptance count in this plan that names rows comes from the rebuild unless marked otherwise:
- 980 listed rows, 37 ready, 615 certified listed rows.
- The 37 ready rows include 7 proxy-bar rows: EMR, EQH, IQV, GEO, BB, BHB and DSGR.
- 30 ready rows are on CI-identical bars.

The published membership (which 998 and which 43) is **未検証**. Never claim a rebuild count as a publication count.

### 1.3 Evidence superseded
The snapshot chart PNGs in `SNAP/charts/` were captured during the chart's intro animation (p3-1, confirmed). Their DOM facts are right, but their pixels are not.
- Settled renders are in `S/audit3/p3-phone-chart-speed/charts/<SYM>-<period>-<width>.png`: 476 views, with probes in `probe-reduce.json` and `probe-summary.json`.
- Any later real-data render waits for `.bc-pulsing` or uses `reducedMotion:'reduce'` (STEP 0 helper H3).

---

## 2. Confirmed findings and where they go

Severity is the skeptic's. "→" is the destination in this plan.

| id | Severity (skeptic) | Finding, as corrected | → |
|---|---|---|---|
| p4-1 | major | 7 of 21 ブレイク失敗 hits credit a crossing that came before the pivot formed (MGRC, TMP, CZFS, TBCH, OABI, JILL, ASO; all `nr7_inside_day_trigger_high`). The other 14 (handle_high) are genuine. The chart arrow is dated on or before `se_pivot_date` on 61 certified listed rows (41 handle_high, 17 nr7, 2 tight_area_high, 1 inside_day; soft test). `se_pivot_date` is not in the index `listFields` (export-research.mjs:274). MGRC's 130.13 pivot is the rebuild's; the feature run has 123 (handle_high, 8/14), and against 123 the 11/2 breakout still holds. MGRC is one of Today's three watch flags only under p4's test watchlist. | R1 |
| p1-1 | major | Pinned prices pass readiness. 22 listed rows are pinned (ADR20 < 0.6% and a 20-session range under 3%; thresholds picked after seeing the charts). 8 of them are ready (PCRX, BWIN, TECH, ARX, CEPO, DSGR, PRTH, RNW): 36.4%, against 29/958 for the rest. three_weeks_tight: 5/5 ready rows are pinned. lowRange (60-session range < 5%) misses PCRX 55.05, BWIN 17.92 and PRTH 52.99 because the gap sits in the window. PCRX is liquid rank 1 and row 7 of 候補›買いゾーン, with a 244株 参考 plan. PRTH gets a 1,128株 plan. | R2, R3a |
| p4-3 | moderate | PCRX gets a full VCP and plan, with its stop inside a pre-gap base (low 24.56 on 10/6) paired with the post-gap pivot 36.45. Gap 50.2× prior-50 volume; 25 sessions since closing 36.31–36.49; ADR20 0.150%. The plan already prints 「構造上の損切り目安 24.44（−33.0%）深すぎる」. A 20-session test (ADR20 < 0.5% or 20-session range < 3%) newly flags 10 rows: PCRX, PRTH, BWIN, CCC, PAG*, BMBL, PTC, CPAC*, SYNA, FUSB (* proxy). Only PCRX, BWIN, PAG, PTC and SYNA have a liquid rank. | R2 |
| p1-2 | moderate (KPI only) | Gate 3 mostly measures anchor age. For CWH, readiness ≥ 70 needs a handle ≤ 6.67 weeks old. 672 of the 719 gate-3 failures are CWH. NDSN and NATL fail on age while PCRX and PRTH pass. NR7 is corrected: only a combined NR7 + inside-day trigger 0–1 sessions old with the close above EMA21 passes (73.9/71.5). A plain NR7 tops out at 65.2. | R4 (measure) |
| p1-3 | moderate (KPI only) | Gate 4 sees only today's distance. 17/37 ready rows traded more than 3% above the pivot after the pivot date and came back. The "15/37 more than 5% under the 52-week high" part is weak evidence, because a CWH left-lip pivot is normal. | R3c (diagnostic), R4 (measure) |
| p1-4 | moderate (KPI only) | Gate 6 is a one-day ratio: 33.2% pass share and 5.19 flips per row over 20 sessions. A 5-session mean ≤ 0.9 gives 32.8% and 1.86 flips (28 ready pass today). The failures split 164 up / 257 down / 6 flat closes; HUM (−0.59%) and SONO (−4.98%) were down closes, not up. "Coin toss" is rhetoric. Rejecting the breakout day is by design (setup_ready is pre-breakout). | R4 (measure) |
| p1-5 | minor | The frozen 908 harness cannot see Setup Engine readiness: SETUP = Markets360. The round-2 auxiliary probe (28/588 vs 23/575, +0.8pp) is not committed. PR #142 line 96 omits the caveat. | STEP 0 (H4), I-checklist |
| p1-6 | minor | Gate 8 uses `quick_stage_check`, under which a flat 200-day line (±1%/month) is stage 1 and passes. There are 8 ready rows at scanner stage 3: GLBE, FCNCA, DJCO, RDNT, CEPO and CTKB are SE stage 1; GEO and TECH are SE stage 2. Stage-only failures are 5 (AVTR, SHEL, ITGR, VSTM, ASIC). | R3b |
| p1-7 | minor | 19/37 ready rows are under $10 or under $20M ADV, and 8 are under $5M. CEPO is a Finance-Blank Check row whose 52-week low rests on two anomalous bars; whether they are erroneous prints is 未検証. This inflates only the KPI. | D2 (liquid split); OD12 |
| p1-8 | minor | 28/37 ready rows read 収縮は未確認, and there are no VCP primaries. Partly expected for CWH. | R3c |
| p2-1 | major | All 159 (112 listed) PayloadMismatch records had a payload `cik` that was not a non-negative non-bool int. This is deduced from code and counts; no payload was observed. The strict fix passes 39/39 unit tests on synthetic payloads. Missing or null stays failing. | D1 |
| p2-2 | minor (downgraded) | `sec_conditions.eps` is Code 33's EPS acceleration, not the 25% rule. It cannot pass without a fiscal-Q4 EPS fact in two successive years. It is read only by the CI log, the step summary and the markdown, but STATE.md calls it 「EPS 合格」. Q4-only rows number 171–186, an upper bound on "only enumerated cause". | D2 |
| p2-3 | minor (owner decision) | An SEC Code 33 達成 is impossible for a non-tagging filer, although the Yahoo layer can still show 「Code 33 達成（参考）」. Under a never-counted reference, 0 verdicts change. At most 103 rows have a Code 33 that hinges on a fiscal Q4, and only 21 have a Q4 row to attach to. The accuracy design is 未検証. | D3, OD1 |
| p2-4 | minor | Today is silent about the 112 invalid_payload rows: the block has no warning code for them. The proposed 「取得側の不具合」 asserts an unestablished cause. A new warning code would null the block in an older UI. | deferred (§9), OD14 |
| p2-5 | minor | 「SEC 検証不可」 is shared by invalid_payload and invalid on purpose (comment at fundamentalsExplain.js:44-45). The CIK sentence fired on none of the 112. The CI fixture uses received_cik 1000002 (a cik_mismatch), so CI never runs the published null signature. | STEP 0 oracle; label → OD14 |
| p2-6 | minor | 「算出」 under fiscal-Q4 columns is not explained in the card: the explanation is one fold away under 「Q4算出」, a different term. The 未達 reason and the sales tile's 「前期 +100%」 quote a derived Q4 unmarked. | D4 |
| p3-1 | major (audit evidence) | The snapshot PNGs were captured mid-intro: 72 of 106 compared views differ. | §1.3, H3 |
| p3-2 | minor (downgraded) | 21 of the 30 CI-bar ready charts show only 「収縮は未確認」. The SE pattern, weeks and depth are already on the VCP card (31/37) and the pivot row (37/37). **Only the pivot's date is shown nowhere.** For weekly patterns `se_pivot_date` is the Friday label of the pivot's week, and the daily high equals the pivot on that date in only 6 of 31 rows. A tick on `se_pivot_date` would mark the wrong bar in 25 of 31. | C4 |
| p3-3 | minor | The 週足 notice is drawn over candles in 30/39 CI-bar 週足 views at 390, 31/39 at 320 and 0/23 at 1440. The two weekly lines are 62 of the 114 forced lines at 390. 「収縮は未確認」 is kept in the plot. | C2 |
| p3-4 | minor (narrowed) | The readout already shows the last bar's volume ratio (within 0.03 of `se_volume_vs_50d`), and the VCP card shows 「当日の出来高」. Only 「静かな日 N/10日」 (`se_quiet_days_10d`) is new. The dry-up bracket appears on 2/37. | C4 |
| p3-5 | minor | At 320 the 「最後の収縮の安値」 legend item is folded off the card in 13/13 stocks that draw the 安値 tag. | C3 |
| p3-6 | minor | Card height varies by period at 320 (37/48) and 1440 (23/23). At 320 the cause is the readout, which wraps to 4–6 lines (64/80/96px); the legend stays 34px. | deferred, OD15 |
| p3-7 | major (under waiver) | The 1440 first-load longest task is the right-pane chart draw. On real data with SWKS at CPU 4×: 161→260→250 ms (persona); 126→236 (skeptic). The averages' name section is 7.4→113–115 ms, and the retry fired 5/5. Rounds 3–4 *widened* an existing search (1px over 64px, leader segments, retry pass). Round 5 is indistinguishable from noise. | C1 |
| p3-8 | observation | The stop is always −7.0% because of STOP_DEFAULT_PERCENT = 7 (positionSizing.js:13), a viewer default. | no change |
| p4-2 | minor (design boundary) | 8 of the 86 certified focus rows are ブレイク失敗 on their own screen but read ピボット接近 on rows, because sell checks run only for watched rows (CONTEXT.md:150, 154). A fix needs a new index field. | OD8 |
| p4-4 | minor (design choice) | A failure is forgotten 10 sessions after the breakout (SAIL, GEN −32%, PFG), as CONTEXT.md:150 documents. A permanent brand would be contestable (GEN rebuilt a base). Only the neutral, dated context line is defensible. | R5 (optional), OD9 |
| p4-5 | minor (wording only) | 「弱含み」 is the brief's own SPY 50-day verdict, on a day the backend says correction with 6 distribution days. The 0% cap is stricter than the backend's 20%. | deferred |
| p4-6 | minor (cosmetic) | The readout prints 「+0.0%」/「−0.0%」 where the rows print 「±0.1%未満」: PCRX, PFIS, TECH, LNTH (StockChartCard.jsx:51 `formatPercent`). | C5 |

### 2.1 Refuted (all three are p4 sub-claims)
1. **p4-3: "Only the market gate keeps the call from reading 買いゾーン内".** Refuted. With an open market, buyGate on PCRX returns afterLight / wait (「11/9に上抜け・出来高不足」, 0.35×). The market changes only whether the plan is a reference.
2. **p4-5: "the plan takes no market input".** Refuted. positionPlan reads the market (referenceReason 地合い, 「試算のみ／目安 0%」). Only the sell card and the watch tile take none.
3. **p4-5: "two names for one state on two screens".** Refuted. 弱含み (the brief's SPY 50-day rule, 独自判定) and 「調整」 (the backend's 局面判定, named as such) are two attributed judgments, and exposureRuleText discloses that they differ.

### 2.2 Corrections that change a fix (applied below)
- **R1 needs `se_pivot_date` in the index.** Without it, watch rows and the stock screen disagree.
- **The pivot's own bar is not the bar dated `se_pivot_date`.** For weekly patterns it is the max-high bar within that week. Both R1 and C4 use one STEP 0 helper for this.
- **p3-2 becomes a pivot-date item only.** The SE base line would repeat the VCP card.
- **p3-4 becomes 静かな日 only.**
- **p3-6 cannot be fixed by reserving the legend.** It is deferred.
- **D1 promises no recovery count.** The first run's diagnostic decides.
- **D3's expected verdict change is 0.** Its display is gated on measured accuracy.
- **R3/R4 are measure-first.** They reach only the coverage KPI.

---

## 3. Ground rules (every track; each is a review check)

Round 2's rules 1–15 (audit2/round2-plan.md §1) carry over unchanged. In short:
- Missing values are never 0, あと0 or 達成.
- Stale data is never today's.
- The 90% bar, the transport-hash methods, selection, the trend template (8 published conditions, stage never a 9th veto) and Code 33 (bonus only) are untouched.
- RS推計 is never called IBD RS.
- There are no production actions for verification.
- Measurement is CI-faithful.
- New list fields follow rule 10.
- Negative numbers use U+2212.
- Backend changes follow the red line.
- New thresholds are named constants, labelled 独自設定 or 独自判定.
- Copy is asserted through its producer.
- Older publications render honestly.

New in round 3:

16. **The 492-view label probe is a standing gate for any change to chart code** (priceChart.js, chartLabels.js, PriceChart.jsx, StockChartCard.jsx, chartReadout.js, bookTechnicalEvidence.js).
    - It covers 30 fixture stocks × 4 periods × 320/375/390/1440, plus ZZNV dark at 320/390/1440.
    - It runs from the STEP 0 harness copy (H5), with `PROBE_FIXTURE` pointing at the track's own worktree and on the track's own port. It never uses the r2-integration worktree.
    - Each item states its gate: byte-identical, or an exact expected diff naming the elements that change.
    - Probe outputs and baselines stay in scratch and are never committed.
17. **Snapshot counts are rebuild counts** (§1.2). Every real-data acceptance number is checked with the STEP 0 harness on SNAP and labelled as the rebuild's. The publication's effect is 未検証 until it has been read after release.
18. **UI before data.** A new record key, warning code or index field must never reach a published UI that refuses it.
    - Admission refuses unknown record keys: bookFinancialAdmission.js:110 `sameKeys`.
    - An unknown warning code nulls the coverage block: fundamentalsExplain.js:333.
    - So each such producer ships with emission off, or behind a UI that already accepts the key, as stated per item.
19. **Readiness is measured first.** Any Setup Engine readiness or stage change reports:
    - snapshot flips, as a list of rows;
    - the frozen 908 harness, which must be unchanged (SETUP +52.0pp);
    - the committed auxiliary readiness probe (H4): entries, controls, discrimination and gate-wise failures, before and after.

    A change adopts only where its item says so.
20. **Settled renders.** Every screenshot or DOM read of a chart waits for `.bc-pulsing` after each period click, or renders with reduced motion (H3).
21. **JS budget.** Round 2's rule was per round: "the entry chunk grows by 3% or less from" that round's base (round2-plan.md §3, base 59e2dd7, line 130.25 kB gzip; 8849bf9 ended at 130.10).
    - Re-anchored for round 3 at 8849bf9 (130.10 kB gzip), the line is **134.00 kB gzip**.
    - STEP 0 may use 0.3% of it, and each track reports its own entry-chunk delta.
    - Integration must end at or under 134.00 kB.
    - Prefer the existing lazy chunks (the price-chart renderer, the market chunk) for chart-only or market-only code.
    - OD2 is about confirming round 2's lazy split, not about this line. The owner may still set a different line.
22. **Nothing large or baseline-shaped is committed.** No books zip and no snapshot or probe baselines.
23. **Owner-facing text** is Japanese, with times in JST and 実測 kept apart from 未検証.

---

## 4. STEP 0 (serial, before the tracks fork)

The orchestrator does this alone on claude/r3-step0, then PR → CI → merge under the owner's loop. Tracks fork from the merged main.

**There is no visible change with the default fixture.** Every new oracle is **opt-in**. The default 30 rows, charts and details stay byte-identical, so the 492-view probe, Today's counts and the height ledger do not move.

### 4.1 Oracles (opt-in: `openBrief(page, hash, { oracles: true })` / `routeBrief(..., { oracles: true })`; exported `ORACLE_ROWS`, `ORACLE_CHARTS`, `ORACLE_DETAILS`)

Every oracle meets these conditions:
- Its ticker starts with ZZ, its company name ends in "(synthetic)", and it collides with no existing symbol (including ZZU000–ZZU099).
- It is built through `withAuditFixture` and the same `consistent()` path, so its bars certify.
- It renders with no page error at 320, 390 and 1440.

| Oracle | Shape | Used by |
|---|---|---|
| **ZZRL** (RS line, new high) | `rs_line` populated (close ÷ a synthetic benchmark), with `rs_line_high` true on the analysis day and a lead mark. It draws the RS panel, the RS新高値 tag and the legend's RS item. | C (heights with an RS line, C3 legend fit), invariants |
| **ZZRW** (RS line, lagging) | `rs_line` populated, RS line 10%+ under its high, `rs_line_high` false. | C |
| **ZZHB** (held breakout, green arrow) | A weekly pattern (`se_pattern_primary` cup_with_handle). `se_pivot_date` is the Friday label of the pivot week, while the bar whose high equals `se_pivot_price` in cents is the Tuesday of that week. A crossing at ≥ 1.4× prior-50 volume 4 sessions before the analysis day, after that Tuesday; every close since at or above the pivot's cents. Market open (fixture default). Expected: a green hollow arrow, and 「M/Dに上抜け・出来高N×」 within staleBreakoutSessions. **It must stay green after R1**, because its crossing follows its pivot bar. | R1, C4, invariants |
| **ZZRD** (ready setup) | `se_setup_ready` true, `setup_recalculation` calculated, `se_pattern_confidence` ≥ 70. Three measurable, progressively shallower contractions with the last leg's interval volume ratio < 1, so boxes, depths and 「出来高の枯渇」 are drawn. `se_volume_vs_50d` ≤ 0.8, `se_quiet_days_10d` set, `se_base_length_weeks`/`se_base_depth_pct` set. Within the early zone under the pivot. | C3, C4, R3c parity, invariants |
| **ZZPM** (PayloadMismatch) | A same-day detail whose `book_financials` is the exact published invalid_payload signature: `invalid_detail` with its 4 keys, cause `PayloadMismatch`, **`received_cik: null`** (copied from the shape `sec-financials.py` writes, tests :236-244). | D1, OD14 |
| **ZZNV** (existing; fiscal-Q4-untagged EPS) | Unchanged. It is named as the oracle for `fiscal_q4_untagged` (「Code 33 未確認 … （Q4は10-Kのみで未確認）」). | D2, D3 |
| **ZZQF** (fiscal-Q4 unknown, derived Q4 in the window) | A June-FY filer with its September 10-Q filed, so the derived June Q4s sit inside the card's window. Q4 EPS untagged. Revenue and net-income Q4 derived (`derived: 'fiscal-year-minus-three-quarters'`). This is p2's q4-mid case. **It carries only keys that 8849bf9's admission accepts.** D3 adds share facts and the reference key in its own spec via `mutate.details`. | D3, D4 |
| **ZZNR** (pivot dated after a heavy crossing; MGRC shape) | `se_pattern_primary` nr7_inside_day, `se_pivot_date` = the analysis day − 1, whose high is the pivot. A close crossing that level at ≥ 1.4× 7 sessions earlier; last close under the pivot. Today, before R1: a ブレイク失敗 hit and an arrow dated before the pivot formed. | R1 |
| **ZZPG** (post-gap pin; PCRX shape) | Three contracting legs, then a +40% one-day gap on ≥ 20× volume, then 25 sessions closing within a 0.5% band (ADR20 about 0.15%). The SE pivot sits at the top of the band (cup_with_handle). `price_activity` is computed by H2 exactly as the exporter would. Today, before R2: lowRange false, 買いゾーン, a plan with shares, and 「損切りが収縮の中（安値 …）」. | R2, R3a parity |

**Oracle specs.** `tests/static/brief-oracles.spec.js` is new and frozen.
- It asserts each oracle's *shape* through producers: `chartCrossing(...)`, `failedBreakout` state, `secStatus(...)`, `footprint(...)`, `PLAN_BLOCKED`, and so on.
- ZZNR and ZZPG carry their **target** assertions as `test.fixme('R1: …')` and `test.fixme('R2: …')`:
  - ZZNR: no ブレイク失敗, and no arrow before the pivot bar.
  - ZZPG: `PLAN_BLOCKED.low`, and no 「損切りが収縮の中」.
- The owning track flips them to `test(...)`. This is the only edit a track may make to a frozen file.
- ZZHB's green arrow is asserted active from STEP 0 on, so R1 cannot break it.

### 4.2 Shared helpers

**H1. `frontend/src/static/brief/pivotBar.js`** (new, frozen). `pivotBar(bars, row)` returns the pivot's own bar `{ index, date }`, or null.
- **Weekly-detected patterns** (cup_with_handle and three_weeks_tight; cup_handle.py:86 `timeframe='weekly'`): the latest bar within the week ending `se_pivot_date` whose high equals `se_pivot_price` in cents.
- **Daily patterns** (nr7_inside_day, inside_day, …): the bar dated `se_pivot_date` itself, if its high equals the pivot in cents.
- **Otherwise null.** That covers no `se_pivot_date`, no pivot, or no matching bar. The helper never guesses.
- **Pattern table.** The pattern → timeframe table is one exported constant with source line refs. A backend unit test (`tests/unit/…/test_pivot_timeframes.py`) pins each detector's timeframe to that same table, so the two sides cannot drift.
- **Vitest cases:**
  - a weekly Friday label with the max high on Tuesday gives Tuesday;
  - nr7 gives the day;
  - no match gives null;
  - a missing date gives null;
  - a pivot in float noise compares in cents.
- **Harness check (rebuild).** pivotBar finds a bar for every one of the 30 CI-bar ready rows. Weekly ones land inside their `se_pivot_date` week. Any null is listed. Proxy rows may be null.

**H1b. Crossing-floor seam** (wiring, with no behaviour change). The bound is applied in one place:
- `pivotCrossings`, `lastPivotCrossing`, `breakoutBar`, `crossingEvent` (breakoutHistory.js), `failedBreakoutCheck` (briefSell.js) and `chartCrossing` (chartReadout.js:303) accept an optional `from` (a bar-index floor).
- Every caller passes `crossingFloor(bars, row)`:
  - StockChartCard.jsx:161, StockView.jsx:86 and buyGate.js:127;
  - the watch-row and Today sell checks (useWatchSellChecks).
- `crossingFloor` lives in breakoutHistory.js. **Its STEP 0 body returns null.** R1 owns the body.

**H2. `frontend/src/static/priceActivity.js`** (new; R-owned after STEP 0). This is a pure move of the exporter's `price_activity` computation (export-research.mjs:122-125).
- `export-research.mjs` and the oracle builder both call it.
- Default fixture rows still carry no `price_activity`, exactly as now.
- Export output is byte-identical: checked on the rebuild's `research.json`.

**H3. `chartSettled(page)`** in brief-fixture.js. It waits for `.bc-pulsing` after each period click. Reduced motion is the alternative.

**H4. `backend/scripts/probe_setup_ready_908.py`** (new, frozen during tracks). The round-2 auxiliary probe, committed:
- Sources: S/audit2/r2-chart/probe/ready_probe.py and probe_908_stage_setup.py.
- It runs offline from the committed 908 bundle and runs the Setup Engine on each entry and control.
- It reports entries and controls, setup_ready pass rates, discrimination, gate-wise failure counts and the stage-2 share.
- **Acceptance:** at 8849bf9 it reproduces 28/588 vs 23/575 (+0.8pp), gate 6 failing 458/588, and 0 ready among the 215 entries that closed ≥ 1.4× above the pivot.
- If the bundle is absent, every 908 figure is 未検証.
- `validate_trade_ideas.py` is not touched.
- PR texts state that the frozen harness's SETUP column is Markets360 and cannot see CH11, CH12 or readiness (p1-5).

**H5. Round-3 harness** in scratch, `S/audit3/r3-harness/`. It is never committed. A README gives one command per check, and `baseline.json` holds the STEP 0 numbers.
- **probe/:** the verify4 label/values probe copy, with `PROBE_FIXTURE`, `AUDIT_PORT` and an added `PROBE_ORACLES=1` set (oracle symbols × 4 periods × 4 widths, plus ZZRL dark at 390).
- **snapshot/:**
  - p4's eval-sell.mjs, eval-today.mjs, pivot-date.mjs and oneoffs.py;
  - p1's analyze.py, stats.py and gate6_alt.py;
  - SNAP/build/scripts/recalc.py and eval.mjs;
  - p3's render-probe.mjs, patched with H3, plus timing.spec.mjs with its pw.config.mjs.

  Each runs against a git archive of the track's head bundled with esbuild, as the personas did.
- **ports:** STEP 0 4421, DATA 4422, READINESS/VERDICT 4423, CHART 4424, integration 4425. Personas' 4411–4415 and round 2's 4301–4355 are not reused.

### 4.3 Frozen files (change only in STEP 0 or at integration)
- `frontend/tests/static/brief-fixture.js` (oracles included) and `frontend/tests/static/brief-oracles.spec.js`. The exception is the `test.fixme` → `test` flips above.
- `frontend/src/test/fixtures/publishedContracts.js` and `frontend/src/test/fixtures/secRecord.js`. A track that needs another shape builds it in its own test file, through `mutate`.
- `frontend/src/static/brief/pivotBar.js` and its test, and the backend timeframe test.
- `frontend/tests/static/brief-compact.spec.js` and `brief-phone.spec.js`: the height budgets and first-screen tests.
- `backend/scripts/validate_trade_ideas.py`, the 908 bundle, and `backend/scripts/probe_setup_ready_908.py`.
- The transport: `frontend/src/static/researchTransport.js`, `frontend/src/static/transport/**`, and every hash method.
- `.github/scripts/fixtures/publisher-export-research-oct6-carry-v1.mjs`, a historical publisher copy.
- `docs/design-review/owner-waiver.json`, which is the owner's.
- `CONTEXT.md`, `docs/STATE.md` and `docs/PROGRESS.md`. Each track writes its vocabulary and records in `docs/round3/<track>.md`, and integration folds them in.
- `frontend/src/static/brief/briefCandidate.js`. No track needs to edit it; a needed change goes through integration.

### 4.4 STEP 0 acceptance
- **Suites:**
  - vitest passes;
  - the static Playwright suite passes CI-faithfully (Chrome for Testing 147 plus CI fonts), with 408 existing tests and the new oracle specs;
  - the `.github/scripts` tests pass, apart from the known sandbox-only failures;
  - the backend red line and gates are unchanged: gate-5 = 43, gate-check OK.
- **Byte-identity:**
  - The 492-view probe output is byte-identical to 8849bf9.
  - Round 2's innerText-and-box dump is byte-identical to 8849bf9 at 375×812 and 1440×900. It covers Today, 候補 and ウォッチ with 4 and 5 symbols, 市場 on each tab, stocks ZZNV, ZZAR, ZZHW and ZZZF, and ZZNV weekly.
  - The rebuild's export output (`research.json`) is identical before and after H2.
- **New baselines:** the oracle probe baseline and the harness `baseline.json` are recorded (§4.5).
- **H4** reproduces the round-2 figures.
- **H1** passes its real-data check.
- **Build:** the entry chunk grows by 0.3% or less over 8849bf9's 130.10 kB gzip (rule 21).

### 4.5 Baseline ledger (scratch: `S/audit3/r3-harness/baseline.json`; the "now" column for every track)

**Heights at 375×812, CI-faithful (budget line):**
- Today: 1342 (line 1388)
- 候補: 593 (708)
- ウォッチ: 495 (508)
- 市場: 1228 (1288); the FTD-conflict state is 1300, or 1322 one session behind
- Stock ZZNV: 3044 (3388)
- Chart card: 508 at 320/375/390; 492 on 週足 at 320; 490 for ZZLI 週足 at 375/390; at most 727.1 at 1440

Oracle heights are recorded fresh.

**Rebuild counts (SNAP):**

| Measure | Value |
|---|---|
| failedBreakout | 21 hit / 543 clear / 51 no pivot, on 615 certified |
| lowRange listed rows | 6 (TECH, ARX, CEPO, DSGR, RNW, SLAB) |
| Ready | 37 (18 liquid / 19 illiquid) |
| Legs drawn on CI-bar ready rows | 9/30 |
| 週足 forced lines at 390 | 114, of which 62 are the two weekly notice lines |
| Dry-up bracket | 2/37 |
| 320 low legend item hidden | 13/13 |
| Readout ±0.0 mismatches | 4 (PCRX, PFIS, TECH, LNTH) |

**Timings:**
- SWKS 1440 longest initial task at CPU 4× (p3's method, 7 interleaved runs): re-measure at STEP 0 on the sandbox. Last readings were 250 (persona) and 236 (skeptic).
- 390 period switch: 142.5 ms.
- Index size: 868,379 bytes gzip against 1,000,000.
- JS entry chunk: 130.10 kB gzip.

---

## 5. Tracks

Three tracks run in parallel from STEP 0. Each has its own worktree under `.claude/worktrees/r3-<track>`, its own port and its own docs/round3/<track>.md. Merge order: DATA → READINESS/VERDICT → CHART. CHART goes last so that its probe gate runs on the merged tree.

### Track DATA (D)

**Files owned:**
- `frontend/tools/sec-financials.py` and `frontend/tools/test_sec_financials.py`
- `frontend/tools/report-data-coverage.mjs` and its test
- `frontend/src/static/bookFinancialAdmission.js` and its test
- `frontend/src/static/fundamentalsExplain.js` and its test
- `frontend/src/static/brief/StockFundamentalsCard.jsx` and its test
- `frontend/src/static/brief/brief-fundamentals.css`
- `frontend/tests/static/brief-fundamentals.spec.js`
- `docs/round3/data.md`

**D1. PayloadMismatch: a strict identity comparison plus a diagnostic** (p2-1, major)
- **Change** (diffs: S/audit3/p2-data-fundamentals/fix-a-*.diff):
  - `payload_cik(value)` returns an int for:
    - a non-bool int ≥ 0;
    - an ASCII string matching `[0-9]{1,10}`, by `re.fullmatch` (not `isdigit`/`int()`).

    Anything else returns None.
  - `normalize` compares `payload_cik(facts.get("cik")) != cik`, with its message byte-identical. `6.0` and `True` stop being accepted, which tightens the check.
  - `invalid_detail.received_cik = payload_cik(...)`. The 4 keys are unchanged and the value stays an int or null, so a different digit string becomes `cik_mismatch`.
  - A log-only diagnostic `fetch_symbol(..., observe=)` records the `cik_kind` of every received payload: int, digits, missing, null, text, bool, not_object or other. It is tallied across workers under a lock, printed as `SEC payload cik <date>: {...}` and added to the step summary. It is never written into a record.
- **Tests:**
  - `python3 -m unittest test_sec_financials`: 39/39. The 3 new tests fail on 8849bf9.
  - Refusal cases (a different, missing, null, float, bool, signed, spaced, full-width, 11-digit or `6_0` value) each give exactly 4 keys.
  - The diagnostic never reaches a record.
  - The admission browser test still passes.
  - Oracle ZZPM still renders.
- **Acceptance (実測 in the track):** the tests above, and the record schema and transport unchanged.
- **After the next scheduled publication (read-only, until then 未検証):**
  - Read the `SEC payload cik` line, the invalid_payload count and `with_quarters_listed`.
  - If `digits` ≈ 159, the fix recovered them. The listed rows with quarters are bounded above by 908/998 (91.0%).
  - If `missing`/`null` ≈ 159, they stay failing by design, and OD13 applies.
  - No recovery figure is announced before that.

**D2. Coverage report: honest names, the q4_only measure, and the KPI split** (p2-2 minor; p1-7 KPI part)
- **Change** (diff: S/audit3/p2-data-fundamentals/fix-b-report-data-coverage.diff, extended):
  - Rename `sec_conditions` to `code33_parts.{eps_acceleration, sales_acceleration, margin_improvement}` in both the round-1 copy (:53, :63) and the round-2 measurement (:347, :372). The markdown row becomes 「Code 33 parts (listed, SEC)」.
  - Add `eps_unknown.q4_only`: rows whose every enumerated cause is `fiscal_q4_untagged` or `latest_row_fiscal_q4_without_eps`. It is documented as an **upper bound**, because `epsUnknownCauses` does not track no_base, ambiguous_base or not_reported on non-Q4 rows.
  - Add `eps_floor_25.{last2, last4}` (pass/fail/unknown), which counts the card's ≥ 25% chip.
  - Add `code33_parts.eps_acceleration_pass_symbols`, the first 25 symbols, so the STATE item "validity of the EPS passes" can be hand-checked against filings.
  - Add `setup_ready_liquidity: { liquid: {pass, fail, unknown}, illiquid: {…} }` under the brief's own liquidity rule (the rule that lists 18 of the 37 rebuild ready rows).
  - **Not changed:** the published `fundamentals_coverage` block (`BLOCK_KEYS`, report-data-coverage.mjs:157-158) and its warning codes.
- **Tests:** the 16 existing vitest cases pass, plus one per new key.
- **Rebuild run:** `code33_parts.eps_acceleration` equals the old `sec_conditions.eps`, and the liquid split reads 18 / 19.
- **Integration:** STATE.md's 「EPS 合格」 and 「EPS 条件」 are rewritten as 「Code 33 の EPS 加速」.
- **Read later:** the published counts and the pass symbols (未検証 until then).

**D3. A 独自計算・参考 fiscal-Q4 EPS that never counts** (p2-3; counting is OD1)
- **Producer** (`sec-financials.py`):
  - Numerator: `NetIncomeLossAvailableToCommonStockholdersDiluted`, falling back to `…Basic`, then `NetIncomeLoss`. The tag used is recorded. The Q4 value comes from the existing exact `derive_fourth_quarters` (:93-123).
  - Q4 diluted shares = (annual weighted × FY days − Σ quarter × days) ÷ Q4 days. This is exact for basic and approximate for diluted.
  - The value stays unknown when:
    - the facts do not tile the year;
    - Q4 shares fall outside [min, max] of Q1–Q3 ±10% (a split);
    - any of Q1–Q3 fails EPS × shares ≈ NI within 2%.
  - Output: `q4EpsReference: [{end, start, value, method: 'q4-ni-over-q4-diluted-shares-v1', numerator: {tag, components[4]}, shares: {tag, components[4]}}]`, kept apart from `quarterly.eps`.
- **Accuracy, measured before it is shown:**
  - On filers that tag Q4 EPS: the reference against the reported Q4 EPS, as the median absolute error and the share within 1¢ or 2%.
  - On Q1–Q3: NI ÷ shares against the reported EPS.

  The producer prints both every run as a log-only line, `SEC q4 reference accuracy <date>: {...}`, and the coverage report carries them.
- **Release order (rule 18).** 8849bf9's admission refuses a record with this key.
  - Round 3 ships the producer with **emission off**, one named constant. With it off, the computation and the accuracy line still run.
  - Round 3 also ships the admission (an optional, strict key) and the display.
  - Emission is switched on in a follow-up only after both of these:
    - (a) a read-only check confirms the round-3 UI is live on Pages;
    - (b) the owner has seen the published accuracy figures (OD1).
- **Display** (StockFundamentalsCard.jsx, fundamentalsExplain.js):
  - The Q4 column keeps its grey bar, with a dashed outline and 「参考 +45」.
  - One line under the Code 33 box: 「参考（独自計算・判定に使わない）：26-06期 Q4 EPS ≈ 1.23（純利益÷希薄化株数）→ 前年比 +45%」.
  - Code 33 stays 未確認.
- **Never counted.** Tests assert that the key never reaches any of these:
  - `quarterly.eps`
  - `epsYoY`
  - `epsFloor`
  - `chipQuarter`
  - `sec_summary`
  - filters or sorts
  - Code 33 or `code33Layered`

  `admitPoint` and `safeSeries` refuse derived EPS (bookFinancialAdmission.js:49).
- **Tests:**
  - Unit: tiling, a split, a missing fact, a loss quarter (where diluted equals basic), and a Q1–Q3 check failure.
  - Admission: the key is optional and strict, and a record without it is unchanged.
  - Playwright at 320/375/390/1440 on ZZQF with the key added in DATA's own spec: the stock screen stays within its 3388 line at 375, and no chip changes.
- **Expected effect (corrected):**
  - 0 verdicts change.
  - At most 103 listed rows have a Code 33 that hinges on a fiscal Q4, and at most 21 have a Q4 row the reference can attach to.
  - Accuracy is 未検証 until a published run is read.

**D4. Mark every quote of a derived Q4** (p2-6)
- **Change:**
  - The source line carries the derivation note whenever `rows.some(r => r.derived)`, not only when a tile is derived (StockFundamentalsCard.jsx:220).
  - The phone legend (:86-87) is corrected to match its comment.
  - `settledText` (:147-159) and the sales tile's 「前期 +x%」 add 「（Q4算出）」 when they quote a derived Q4.
  - The card, the legend and the 注記 use one term: 「Q4算出」. The axis may keep 「算出」 only where the legend or source line on the same card keys it.
- **Tests:** vitest for each quote. Playwright on ZZQF at 320/375/390 checks that the note is visible on the card, the stock screen is within its line, and the chip lines keep ≥ 6px of slack.
- **Gate:** no chart code is touched.

*D5 (the Today 'unreadable' warning and the label) is deferred: §9 and OD14.*

### Track READINESS/VERDICT (R)

**Files owned:**
- **Backend:**
  - `backend/app/analysis/patterns/{readiness.py, explain_builder.py, config.py, three_weeks_tight.py}`
  - `backend/app/scanners/setup_engine_screener.py`
  - their tests, and the golden snapshots (each diff listed)
- **Frontend tools:** `frontend/tools/export-research.mjs`, and `frontend/tools/recalculate-setups.py` only if a scalar must be copied
- **Frontend static:**
  - `frontend/src/static/priceActivity.js`
  - `frontend/src/static/entryReadiness.js`
  - `frontend/src/static/brief/{breakoutHistory.js, briefSell.js, buyGate.js, positionSizing.js, bookTechnicalEvidence.js*, StockSellCard.jsx, StockVerdict.jsx}`
  - `bookTechnicalEvidence.js` lives at `frontend/src/static/bookTechnicalEvidence.js`
- **Specs:** `frontend/tests/static/{brief-sell, brief-decision, brief-plan, brief-watch, brief-invariants}.spec.js`
- **Docs:** `docs/round3/verdict.md`

Order: R1 and R2 come first, because they are what users see. Then R3, then R4. R5 is optional.

**R1. Crossings count only after the pivot's own bar** (p4-1, major)
- **Change:**
  - Fill the body of `crossingFloor(bars, row)`: the index after `pivotBar(bars, row)` (H1).
  - Every crossing helper honours it through the STEP 0 seam:
    - the failed-breakout check;
    - the conclusion's crossing event;
    - the chart's arrow;
    - the watch-row and Today sell checks.
  - With no crossing after the pivot bar, the failed-breakout check reads clear: 「このピボット（M/D）以降の上抜けなし」.
  - Add `se_pivot_date` to `listFields` (export-research.mjs:274), so index rows and the stock screen read the same field. This is OD7, default add.
- **When the field is absent** (an older publication, or a null from pivotBar), the floor is null and behaviour is exactly today's. One source for both screens:
  - The stock screen reads `se_pivot_date` from the index summary, not from a detail that may carry it alone.
  - A vitest covers an index row without the field plus a detail with it. Both screens must agree, both unbounded.
- **Acceptance on the rebuild (harness):**
  - failedBreakout hits go 21 → 14. MGRC, TMP, CZFS, TBCH, OABI, JILL and ASO turn clear, and the 14 handle_high hits are unchanged.
  - Every chart arrow that moves or disappears under the strict pivot-bar test is listed. The 61 on-or-before-`se_pivot_date` arrows were a soft test, so the strict count is re-measured, not assumed.
  - Under p4's 6-symbol watchlist, MGRC loses its ▲ and the watch tile reads 2件.
  - Index growth is measured and stays under 1,000,000 bytes gzip (868,379 now).
- **Tests:**
  - Flip `test.fixme('R1: …')` on ZZNR.
  - ZZHB keeps its green arrow.
  - Vitest:
    - a pivot dated after a heavy crossing gives no hit and no arrow;
    - a weekly Friday label with an earlier max-high bar bounds at that bar;
    - handle_high cases are unchanged.
  - brief-invariants: one wording per stock on Today, and the watch tile counts only bounded failures.
- **Rule 18:** a test decodes a research index carrying `se_pivot_date` with 8849bf9's transport code (`decodeResearchIndex`) and the 8849bf9 brief. Round 2 added three list fields the same way. If the old UI would refuse the field, R1 ships UI-first.
- **Gate:**
  - The 492-view probe is byte-identical, because the default fixture rows carry no `se_pivot_date`, so the floor is null for all of them.
  - In the oracle probe, only ZZNR's arrow changes.

**R2. Pinned prices after a gap** (p1-1 major; p4-3 moderate)
- **(a) Low activity (H2 `priceActivity`).** Keep the 60-session test, and add a since-gap test:
  - The largest one-day gap in the last 60 sessions is ≥ G%, and the range since it has stayed under Y% for at least N sessions; **or** ADR20 is under X%.
  - X, Y, N and G are named 独自設定 constants (OD6).
  - `price_activity` gains `reason` ('range60' or 'since_gap' / 'adr') and the figures it used. `lowRange` keeps its meaning (true means 低変動・監視のみ).
  - entryReadiness.js:91 prints the actual reason, not always 「60日値幅5%未満」.
  - The existing paths then apply unchanged: `PLAN_BLOCKED.low` (buyGate.js:22), sort last (researchEngine.js:196), and portfolioPlan.js:49.
  - **This is a ranking change for the flagged rows,** which move last. It is named in the PR and in OD6.
- **(b) Structural low.** A contraction base that broke out before the pivot's bar (`vcp.base.breakoutDate` earlier than `pivotBar`'s date) is a previous base.
  - The structural stop reads 未確認 with reason 「前の土台（M/Dに上抜け済み）」.
  - 「損切りが収縮の中」 never pairs that base's low with the current pivot (positionSizing.js, bookTechnicalEvidence.js).
  - The chart's legs and the VCP footprint text are unchanged: the dated history 「土台の高値を上抜け（10/8）」 is true.
- **Thresholds.** The track reports the flagged set on the rebuild under both persona definitions:
  - p1: ADR20 < 0.6% with a 20-session range < 3%; its proposal is a since-gap range < Y% for ≥ 15 sessions, or ADR20 < X%.
  - p4: ADR20 < 0.5%, or a 20-session range < 3%.

  For each row it gives the symbol, liquid rank, ADR20, gap date and size, and whether the row is ready. It then proposes defaults. The thresholds were chosen after seeing the charts, so the owner confirms them (OD6).
- **Acceptance on the rebuild:**
  - PCRX, BWIN and PRTH are flagged. The existing 6 stay flagged.
  - Listed rows (980) and ready rows (37) are unchanged: selection is not touched.
  - No unflagged row changes its brief state.
  - Ranks shift as flagged rows move last; PCRX leaves liquid rank 1. The new top 10 and Today's top five are listed before and after.
  - **Rule 18:** the 8849bf9 brief reads a `price_activity` with the new keys without error and still keys only on `lowRange`. No validator checks `price_activity`'s keys (grep: researchEngine.js, entryReadiness.js and portfolioPlan.js only read `lowRange`). A vitest pins this.
  - PCRX shows 低変動・監視のみ, gets no plan shares, and loses 「損切りが収縮の中（安値 24.56…）」.
  - Rows whose structural state changes under (b) are listed.
- **Tests:**
  - Flip `test.fixme('R2: …')` on ZZPG.
  - priceActivity vitest: a gap inside the window, a gap older than 60 sessions, ADR alone, a missing bar giving null, and never a lowRange from missing data.
  - positionSizing vitest for the previous-base rule.
- **Gate:** the 492-view probe is byte-identical, since there is no chart change. In the oracle probe only ZZPG's plan area changes; its chart does not.

**R3. Backend readiness** (the reach is the coverage KPI only; rule 19)
- **R3a. `price_pinned` as a failing readiness check** (p1-1).
  - Same definition and constants as R2(a), ported to Python. A parity test checks that the backend's pinned set equals the brief's flagged set on the CI-bar rows of the rebuild; any difference is listed.
  - **Adopt if:**
    - on the rebuild, pinned ready rows go 8 → 0 with no non-pinned ready row changing (37 → 29 if all 8 are flagged);
    - gate-5 ≥ 43 passes, with every golden diff listed;
    - gate-1 and gate-check pass, and the red line passes (`test_mcp_market_copilot` is the known existing failure);
    - the frozen 908 is unchanged;
    - H4's discrimination does not fall.

    The expected 908 effect is near zero, but that is 未検証.
- **R3b. Gate 8 reads the stage the brief shows** (p1-6).
  - `setup_engine_screener.py:380-383` uses the CH11 stage classification (the scanner's, with SMA150 and the 52-week high) in place of `quick_stage_check`, and requires stage 2.
  - The trend template is untouched, and stage stays out of it.
  - **Report the rebuild flips:**
    - the 8 ready rows at scanner stage 3 (GLBE, FCNCA, DJCO, RDNT, CEPO, CTKB, GEO, TECH) would fail;
    - of the stage-only failures, AVTR, SHEL, ITGR and VSTM may pass, and ASIC stays.
  - A parity unit test is added.
  - **Adopt only if** H4's discrimination does not fall and the golden diff is listed. Otherwise report it and leave it as is. The owner is told either way.
- **R3c. Diagnostics with no effect on readiness** (p1-3, p1-8).
  - Add `contraction_unconfirmed`, `pivot_already_crossed` (a close above pivot + X% after the pivot bar) and `pivot_below_base_high` to `explain.diagnostics`. These are never new top-level scalars (round-2 rule 10).
  - **Rebuild check:** `contraction_unconfirmed` on 28 of the 37 ready rows. `pivot_already_crossed` is reported against p1's 17/37.

**R4. Evaluation only: gates 3, 4 and 6** (p1-2, p1-3, p1-4; adoption is OD10)
- **Alternatives measured:**
  - Gate 3 on present action against a base-high pivot (distance, last-N tightness, dry-up), using the corrected NR7 math.
  - Gate 4 with `pivot_already_crossed` as a failing check.
  - Gate 6, three ways:
    - a 5-session mean ≤ 0.9;
    - at least 5 of the last 10 sessions under 0.8×;
    - the one-day rule plus an up-close exemption at the pivot.

    The pass share is held equal to today's, so the bar is not lowered.
- **Per alternative:** rebuild flips (rows), pass share, flips per row over 20 sessions (gate 6), and H4's entries, controls and discrimination.
- **Output:** a table in docs/round3/verdict.md and in the PR. **No change to `derived_ready`** in round 3.

**R5 (optional). The failed-breakout context after the window** (p4-4)
- After `failedBreakoutSessions`, the verdict and the sell card show one neutral, dated line, e.g. 「ブレイク失敗後（9/22上抜け→9/25割れ・その後の安値 −32%）」.
- The 10-session rule and the counts are unchanged.
- **Rebuild:** SAIL, GEN and PFG carry the line. The 14 genuine in-window hits are unchanged.
- **Heights:** stock ZZNV is within its line, and the sell card is within its cap.

### Track CHART (C): five bounded items. No placer rework; rule 16 for every item.

**Files owned:**
- `frontend/src/static/brief/{priceChart.js, chartLabels.js, PriceChart.jsx, StockChartCard.jsx, StockVcpCard.jsx, chartReadout.js}` (`chartReadout.js` after the STEP 0 seam)
- `brief-chart.css`
- their vitest files
- `frontend/tests/static/brief-chart.spec.js`
- `docs/round3/chart.md`

**C1. Speed: the averages' name search, output-identical** (p3-7, major, under the waiver)
- **Change.** Make priceChart.js:586-614 (the 1px × 64px spot grid, the leader segments and the retry pass) cheaper **without changing any output**. Options, from p3:
  - test the box before building leader segments;
  - reuse each row's vertical leader;
  - memoize per-spot candle (`solid`) results across the retry;
  - keep the spot list across the retry instead of rebuilding the heap;
  - or yield before the label pass, so the work runs as two tasks with an identical final DOM.
- **Gate: byte-identical everywhere.**
  - The 492-view probe, and the oracle probe.
  - p3's 476 settled real-data views: the DOM text, boxes and forced flags match `probe-reduce.json` regenerated on 8849bf9 with H3.
  - A vitest determinism check: the serialized label set for every fixture stock and period is identical before and after.
- **Acceptance, real data (rebuild `research.json`):**
  - Today at 1440 with SWKS in the pane, CPU 4×, design-review's window, 7 interleaved runs: the median longest task is **≤ 200 ms**. The STEP 0 re-measure is the baseline.
  - The chart-task median is reported.
  - The fixture per-stock chart task median is reported against 8bddb88's 129.5 and 8849bf9's 241.5.
  - The 390 period switch is not slower than 142.5 ms.
- **If ≤ 200 ms cannot be reached output-identically,** report the measured figure. The waiver stays, and the owner is told; tie this to OD2.

**C2. The 週足 notice moves from the plot to the 注記** (p3-3)
- **Change:**
  - Drop the two weekly lines (「週足は直近N週分（YYYY/MM〜）。」「2年分はありません」, priceChart.js:646) from the in-plot notice.
  - Add one 注記 sentence in `chartNotes` (chartReadout.js:261): 「週足はYYYY/MM〜のN週分（2年分はありません）」.
  - 「収縮は未確認」 and 「ピボット 未確認」 stay in the plot.
- **Gate (expected diff):**
  - In 週足 views, the only SVG changes are the two removed lines, plus the position of the remaining notice block.
  - Every other label box is byte-identical in all views.
  - Non-週足 views are byte-identical.
  - The 注記 gains one sentence.
- **Acceptance on the rebuild:**
  - At 390, forced label lines on 週足 fall by the notice's weekly lines: about 62 of 114. 60 of 111 on the 39 CI-bar views.
  - No other label changes position. This was the 未検証 claim p3 made, and it is now gated.
- **Heights:** the chart card is unchanged, because the 注記 sits outside the card at 320/375/390. The 1440 card height change is reported.
- **Tests:**
  - priceChart.test.js: a 週足 model under 104 weeks draws no weekly notice line but keeps 「収縮は未確認」 and 「ピボット 未確認」.
  - chartReadout.test.js: `chartNotes` gives the weekly sentence only for a 週足 period under 104 weeks.
  - brief-chart.spec.js: on ZZNV 週足 at 390, the 注記 holds the sentence and the SVG has no 「2年分はありません」.

**C3. The 安値 price stays on the card at 320** (p3-5)
- **Change.** In `legendItems` (StockChartCard.jsx:69-90), keep the 'low' item at narrow widths whenever the 安値 tag is drawn. At 320, where the full text does not fit two lines, shorten it to 「収縮の安値 xx」.
- **Gate:**
  - The SVG is byte-identical everywhere.
  - At 320 the legend stays two lines (34px) in every fixture, oracle (ZZRL with its RS item, ZZRD) and rebuild view.
  - The card height is unchanged.

  If two lines cannot hold it, the item does not ship and the measured overflow is reported.
- **Acceptance:** at 320, the low's price is on the card in 13/13 rebuild stocks that draw the tag, in every period.
- **Tests:**
  - StockChartCard.test.jsx: `legendItems` keeps 'low' unfoldable at narrow widths when the tag is drawn, and gives the short text at 320.
  - brief-chart.spec.js at 320: on ZZRD and ZZRL, the legend is 34px tall and contains the low's price, and the card height equals the STEP 0 baseline.

**C4. The pivot's date and the quiet days, on the stock screen** (p3-2 and p3-4, corrected)
- **Change.**
  - In StockVcpCard.jsx, the SE line gains the pivot's own bar date from `pivotBar` (H1): 「ピボット 89.88＝9/28の高値（SE）」, plus 「（週足の型）」 for weekly patterns.
  - When pivotBar is null, the line says 「ピボットの日 未確認」 and never prints `se_pivot_date` as the bar.
  - The 「当日の出来高」 row gains 「静かな日 N/10日（SE）」 from `se_quiet_days_10d`. It is absent (未収録) when the field is missing, never 0.
  - **No in-plot or axis mark in round 3.** A date-band mark at the pivot bar waits for the owner's image comments (§9).
- **Gate:** the SVG is byte-identical. Only the VCP card's text changes. Stock screen heights stay within their lines.
- **Acceptance on the rebuild:**
  - For the 30 CI-bar ready rows, the date shown equals the bar whose high equals the pivot in cents. For SWKS that is 9/28, not 10/2.
  - 静かな日 shows on 37/37 ready rows.
- **Tests:** vitest on weekly, daily and null cases, with ZZHB (the Tuesday bar) and ZZRD.

**C5. The readout's 対ピボット follows the pivot-distance rule** (p4-6)
- **Change.** StockChartCard.jsx:51 prints through `pivotDistanceText` (briefCandidate.js:485, imported and not edited) instead of `formatPercent`:
  - 「±0.0%」 only at the pivot's cents;
  - otherwise 「+0.1%未満」 or 「−0.1%未満」;
  - never 「+0.0%」 or 「−0.0%」.
- **Gate:** the SVG is byte-identical. The readout text changes only where the close is within 0.1% of the pivot and not at its cents.
- **Acceptance on the rebuild:** the PCRX, PFIS, TECH and LNTH readouts match their verdicts, on both the daily and the weekly readout.
- **Tests:** vitest at 1 cent over, 1 cent under, and at the pivot's cents with float noise.

**Not in CHART for round 3** (each reason in §9):
- p3-6 (heights);
- the round-2 label leftovers (the hidden 「80」, leader crossings +2–3, forced 106/17/6/2, the thin buy-zone name, the 320 pivot name, average names far from their line ends);
- a pivot-bar mark on the axis;
- deeper history.

---

## 6. File ownership (merge without conflicts)

The orchestrator keeps `S/audit3/round3-ownership.json`, which maps track → paths (fnmatch globs). Before merging a track it runs `git diff --name-only main...HEAD`, and any path outside the list blocks the merge.

| Path | Owner |
|---|---|
| frontend/tools/sec-financials.py, test_sec_financials.py, report-data-coverage.mjs (+test) | DATA |
| frontend/src/static/{bookFinancialAdmission, fundamentalsExplain}.js (+tests); brief/StockFundamentalsCard.jsx (+test); brief-fundamentals.css; tests/static/brief-fundamentals.spec.js | DATA |
| backend/app/analysis/patterns/*, backend/app/scanners/setup_engine_screener.py, backend tests and goldens | R |
| frontend/tools/export-research.mjs, recalculate-setups.py | R |
| frontend/src/static/{priceActivity, entryReadiness, bookTechnicalEvidence}.js (+tests) | R |
| frontend/src/static/brief/{breakoutHistory, briefSell, buyGate, positionSizing}.js, StockSellCard.jsx, StockVerdict.jsx (+tests); tests/static/brief-{sell,decision,plan,watch,invariants}.spec.js | R |
| frontend/src/static/brief/{priceChart, chartLabels, chartReadout}.js, PriceChart.jsx, StockChartCard.jsx, StockVcpCard.jsx (+tests); brief-chart.css; tests/static/brief-chart.spec.js | CHART |
| §4.3 frozen list | STEP 0 / integration only |
| docs/round3/{data,verdict,chart}.md | each track |

Cross-track needs are met through the STEP 0 seams:
- R1 sets the floor's body, and CHART's arrow follows it without an edit.
- C4 reads H1.
- D2 reads the liquidity rule without editing it.

---

## 7. Integrate, publish, measure (later phases, under the owner's standing loop)

This planning step is read-only. The steps below happen in the implementation phase.

1. **I1. Merges** on `claude/r3-integration`: DATA, then R, then CHART. The suites run after each merge.
2. **I2. Integrated checks** (CI-faithful):
   - vitest, static Playwright, `.github/scripts`, the renewal lifecycle;
   - backend red line, gates 1–5 and gate-check;
   - the frozen 908 (unchanged) and H4 (before and after);
   - lint and build (entry chunk against rule 21);
   - the 492-view probe and the oracle probe (only the diffs each item names);
   - the height ledger (every line, with its governing variant);
   - the harness counts on the rebuild (every expected delta, and nothing else).
3. **I3. Docs:**
   - fold docs/round3/{data,verdict,chart}.md into CONTEXT.md (new terms: ピボットの足, the since-gap 低変動, 独自計算・参考 Q4 EPS, payload cik kinds);
   - append a cycle to PROGRESS.md;
   - overwrite STATE.md, including the 「EPS 合格」 wording fix.
4. **I4. PR to main.** The body keeps 実測 and 未検証 apart, and states that the frozen harness's SETUP is Markets360 (p1-5). Then CI, Design Acceptance (real data, under the existing waiver) and merge.
5. **I5. A UI-only release,** then the next scheduled data publication. There is no manual refetch.
6. **I6/I7. Read-only measurement** from CI logs and release assets (Pages stays blocked from this sandbox):
   - **D1:** `SEC payload cik`, invalid_payload and `with_quarters_listed`.
   - **D2:** `code33_parts`, `q4_only`, `eps_floor_25`, the pass symbols, and `setup_ready_liquidity`.
   - **D3:** the accuracy line.
   - **R3:** setup_ready and the top failed checks, `price_pinned` included.
   - **R2:** the low-activity rows, from the index asset if available, else the feature-run rebuild.
   - **C1:** the Design timings at 1440.
   - Each figure is reported with its run id and JST time. What cannot be read stays 未検証.

---

## 8. Ops items (optional; pre-existing pipeline defects; not round-3 scope unless trivial)

None is verified by dispatching or re-running a workflow. Each is checked against later scheduled runs' logs.

- **O1.** The watchdog (`.github/workflows/postclose-watchdog.yml`) starts a same-date re-acquisition before the upstream daily-price bundle exists. That re-run then fails at O2. Seen 11-06, 11-11 and 11-13.
  - **Fix:** don't re-acquire for a date whose upstream bundle is absent. Wait for it.
  - This also bears on chart_coverage 0.894 against the 0.9 bar on 11-12. The bar is not lowered; the timing is fixed.
- **O2.** `producer-price-history.mjs:59` asserts 「A retained history must be genuinely older than target」. A same-day published history should not stop the whole run.
- **O3.** `collect-market-history.py`'s `require_current` drops all five long-history series when one sector ETF's bar is bad, and the summary does not name the ETF.
  - **Trivial part:** print the failing ETF and its reason in the summary. This may join round 3.
  - **The rest** (keeping the good series) is a behaviour change, reviewed separately.
- **O4.** The AMD RS-context failure. Pre-existing; cause not yet investigated.

---

## 9. Deferred (confirmed, not in round 3)

| Item | Why deferred |
|---|---|
| p2-4 Today 'unreadable' warning; p2-5 「SEC 読取エラー」 label (D5) | Depends on D1's first-run outcome: if the digit-string case holds, invalid_payload goes to about 0. A new warning code needs UI-first sequencing (rule 18). The cause wording must not assert 「取得側の不具合」. The shared label was deliberate. → OD14 |
| p4-2 failed breakouts on unwatched rows (`sell_summary` in the index) | A new published field, and CONTEXT.md §9-11 says rows have no bars. → OD8 |
| p4-4 keeping the failure beyond 10 sessions | A design choice; only R5's context line is planned. → OD9 |
| p4-5 「弱含み」 vs 「調整」 wording; a line for holders at 0% | Wording only. Both judgments are attributed and disclosed. Revisit with the owner. |
| p3-6 card height by period | The cause at 320 is the readout's wrap. Fixing it reserves height and touches budgets. → OD15 |
| A pivot-bar mark in the date band; any in-plot SE drawing | A new chart element: it waits for the owner's comments on images. |
| Round-2 label leftovers: the hidden 「80」, leader crossings +2–3, forced over candles 106/17/6/2, the thin buy-zone name, the 320 pivot name, average names far from their line ends | Placer rework: it waits for the owner's comments on images. The probe gate stands. |
| Deeper served history (200日線 111 points, 40週線 25, 64 weeks of 週足) | Pages budget cost not measured. → OD16 |
| p1-7 bar-audit flags (a 15% wick, a one-day close spike) | Whether CEPO's bars are erroneous is 未検証. A flag could change certification counts. Report-only design first. |
| p3-8 stop always −7.0% | Not a defect: STOP_DEFAULT_PERCENT is a viewer default. |

---

## 10. Owner decisions (round 3 ships the default; none blocks the tracks)

**Carried:**
1. **OD1. Q4 EPS counting.**
   - **Default:** the 独自計算・参考 value is built with emission off (D3). Display on Pages is switched on only after the owner has seen the published accuracy figures. It is never counted.
   - **Option, later:** count it apart as 「Code 33（参考）」, never 達成.
   - **Facts:** 0 verdicts change; at most 103 rows hinge on a fiscal Q4; at most 21 have a Q4 row.
2. **OD2. The lazy price-chart split.**
   - Round 2 shipped the price-chart renderer as its own lazy chunk to meet that round's 3% line (integrate-result.md: commits 43f9b1b and d40fd18). The owner has not confirmed it.
   - `stock_open_ms` with the split is 未検証.
   - **Default:** keep the split.
   - Round 3's line is 3% over 8849bf9, i.e. 134.00 kB gzip (rule 21), unless the owner sets another.
   - **Option:** revert the split and accept the larger entry chunk.
   - C1's 1440 result is input to this decision.
3. **OD3. `EARNINGS_CHIP_PERCENT` = 25** (fundamentalsExplain.js:398, 独自設定). Default: unchanged.
4. **OD4. `FRESHNESS_GRACE_HOURS` = 28** (briefFreshness.js:13). Default: unchanged.
5. **OD5. 市場 in the FTD-upgraded state with its conflict line** measures 1300, or 1322 one session behind, against the 1288 line (budget 1300). This was already so on db8e297. Default: unchanged, and reported.

**New in round 3:**

6. **OD6. Pinned-price thresholds** (R2/R3a: X, Y, N, G).
   - **Default:** the track's proposed values, with the flagged list on the rebuild.
   - Flagged rows sort last (a ranking change) and get 低変動・監視のみ.
   - `price_pinned` fails readiness.
   - The thresholds were chosen after seeing the charts.
7. **OD7. `se_pivot_date` in the research index** (R1).
   - **Default:** add it. It is needed so the watch rows and the stock screen agree. Growth is measured against the 1 MB index budget.
   - **If declined,** R1 does not ship, because a bound on one screen only would make them disagree.
8. **OD8. `sell_summary` in the index** (failed breakout and 50-day state for unwatched rows, p4-2). Default: no (the documented boundary).
9. **OD9. Failed-breakout memory.** Default: 10 sessions from the breakout, plus R5's neutral context line. Option: keep the failure until a close recovers above the pivot or a new pivot is dated.
10. **OD10. Readiness gate alternatives** (R4: gates 3, 4 and 6). Default: none adopted; R4's table is presented. R3b (gate 8 parity) adopts only on its probe gate, and the owner may veto.
11. **OD11. Setup_ready as a KPI.**
    - Default: report it split into liquid and illiquid (D2).
    - Option: report only liquid ready rows as the headline KPI.
12. **OD12. Excluding Finance-Blank Check from listing** (p1-7). This is a selection change; it also removes LION, rank 368. Default: no.
13. **OD13. PayloadMismatch with a missing or null cik.** If D1's diagnostic shows that case, any other proof of identity (e.g. the ticker map's CIK plus the entity name) is the owner's call. Default: it stays failing; the identity check is never loosened.
14. **OD14. The invalid_payload label and Today's warning** (p2-4/p2-5). Default: unchanged until D1's first-run result. Then 「SEC 読取エラー」 and a warning line whose wording does not assert a cause.
15. **OD15. Chart card height across periods at 320 and 1440** (p3-6). Default: unchanged. A fixed readout height at 320 would raise the card's height.
16. **OD16. Deeper served chart history.** Default: unchanged until the Pages cost is measured.

---

## Appendix: evidence index
- **p1 (buyer):** S/audit3/p1-minervini-buyer/{out,scripts,montage,render}; skeptic S/audit3/skeptic-p1/scripts/{v1,v2}.py.
- **p2 (data):** S/audit3/p2-data-fundamentals/{fix-a-*.diff, fix-b-*.diff, scripts, renders, logs}; skeptic S/audit3/skeptic-p2/.
- **p3 (chart and speed):** S/audit3/p3-phone-chart-speed/{charts, timing, trace, scripts, trees}; skeptic S/audit3/skeptic-p3/.
- **p4 (risk and sell):** S/audit3/p4-risk-sell-regime/{scripts, work, out}; skeptic S/audit3/skeptic-p4/{scripts, work, bundle}.
- **Snapshot:** SNAP/{rows.jsonl, ready43.jsonl, examples.json, build/{scripts, serve, src}, charts (superseded, §1.3)}.
- **Round 2 prior art:**
  - S/audit2/r2-verify/real-data-scripts/
  - S/audit2/r2-chart-labels/verify4/probe/ and fix5/run-sweep.sh
  - S/audit2/r2-chart/probe/ready_probe.py
  - S/audit2/round2-plan.md
