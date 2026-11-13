I wrote the round 3 plan and committed and pushed the short Japanese copy.

**Where things are**
- **Full plan:** `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/round3-plan.md` (756 lines). The body is in English and the owner summary is in Japanese.
- **Short copy in the repo:** `/home/user/screener/.claude/worktrees/r3-step0/docs/round3/plan.md` (Japanese, about 135 lines).
- **Commits on `claude/r3-step0`:** `05249168` added the copy and `518c3ed7` corrected its summary and JS budget wording. Both end with the two required lines. Both are pushed, and the branch matches origin. There is no PR.
- **Nothing on GitHub changed beyond that push.** No other worktree was touched.

Write accepted both files, so no workaround was needed. This message condenses the plan; the full text is in the file above.

**Owner summary** (§0 of the plan: 9 lines, times in JST, 実測 kept apart from 未検証)
- The audit covers the 11-13 20:10 publication (UI `8849bf9`, US data for 11-12). All counts come from our rebuild (980 listed rows, 37 ready). Which 998 rows and which 43 ready rows were actually published is 未検証.
- 実測:
  - 8 of the 37 ready rows are pinned prices. Their ready rate is 36.4%, against 3.0% for the rest.
  - PCRX still shows 「買いゾーン」 with a 244-share plan.
  - 7 of the 21 「ブレイク失敗」 calls are misdated.
  - The 112 PayloadMismatch failures happen because the payload's cik is not an integer. This is deduced from the code and the counts.
  - The EPS figure 2/342/431 counts Code 33's EPS acceleration, not the 25% rule.
  - At 1440, the longest first-load task is 236–250 ms against a 200 ms budget. The cause is the search for where to place the moving-average names.
- The 1 buy / 7 watch / 29 pass split is labelled as the auditor's chart judgement, not a measurement.

**Findings used**
- Only skeptic-confirmed findings are used, with the skeptics' corrections and severities.
- Three p4 sub-claims were refuted and are listed in §2.1:
  - "Only the market gate keeps PCRX from 買いゾーン内".
  - "The plan takes no market input".
  - "Two names for one state".

**STEP 0** (done first, alone; the default fixture stays byte-identical)
- **Oracles in the fixture, opt-in only** (`openBrief(..., {oracles: true})`):

  | Symbol | What it models |
  |---|---|
  | ZZRL | RS line at a new high |
  | ZZRW | RS line lagging |
  | ZZHB | Held breakout with a green arrow; weekly pattern whose pivot bar is a Tuesday |
  | ZZRD | Ready setup with legs, dry-up and quiet days |
  | ZZPM | PayloadMismatch with `received_cik: null` |
  | ZZNV | Existing stock, named as the fiscal-Q4-untagged case |
  | ZZQF | Derived Q4 inside the card's window |
  | ZZNR | Pivot dated after a heavy crossing (MGRC shape) |
  | ZZPG | Post-gap pin (PCRX shape) |

  ZZNR and ZZPG carry their target assertions as `test.fixme` for R1 and R2 to switch on.
- **Shared helpers:**
  - **H1:** `pivotBar.js`. For weekly patterns it finds the max-high bar in the week of `se_pivot_date`; for daily patterns, the bar on that date. Otherwise it returns null.
  - **H1b:** a seam that threads a crossing floor through every crossing helper. Its body returns null until R1 fills it.
  - **H2:** `priceActivity.js`, moved out of `export-research.mjs:122-125` with identical behaviour.
  - **H3:** `chartSettled`, which waits for `.bc-pulsing`.
  - **H4:** the 908 readiness probe, committed. It must reproduce 28/588 vs 23/575.
  - **H5:** a test harness kept in the scratchpad, on ports 4421–4425.
- **Frozen files:**
  - `brief-fixture.js`, the oracle spec, `publishedContracts.js`, `secRecord.js` and `pivotBar.js`;
  - the budget specs (`brief-compact`, `brief-phone`);
  - `validate_trade_ideas.py`, the 908 bundle and the H4 probe;
  - the transport code and every hash method;
  - the Oct 6 publisher fixture and `owner-waiver.json`;
  - `CONTEXT.md`, `STATE.md` and `PROGRESS.md`;
  - `briefCandidate.js`.
- **Acceptance:** the 492-view probe and round 2's screen dump are byte-identical to `8849bf9`. The entry chunk grows by at most 0.3%.

**DATA track**
- **D1:** strict `payload_cik` (ASCII digits) plus a log-only tally of cik kinds. It passes 39/39 tests. No recovery count is promised: if the cik is missing or null, the row stays failing.
- **D2:** `sec_conditions` is renamed to `code33_parts`. It adds `q4_only` (an upper bound), `eps_floor_25`, the symbols that pass, and a liquid/illiquid split of setup_ready (18/19 on the rebuild). The published block's keys do not change.
- **D3:** a 独自計算・参考 Q4 EPS that is never counted. It ships with record emission switched off and accuracy logged; turning it on is a later decision. Expected verdict changes: 0; at most 103 rows hinge on it, and at most 21 have a Q4 row.
- **D4:** every quote of a derived Q4 is marked 「Q4算出」.

**READINESS/VERDICT track**
- **R1:** crossings count only after the pivot's own bar, and `se_pivot_date` is added to the index. Failed breakouts should drop from 21 to 14 on the rebuild.
- **R2:** a new low-activity test for prices pinned since a gap (thresholds are an owner decision; flagged rows move to the bottom of the ranking). It also keeps a previous base's low out of the stop.
- **R3:**
  - **R3a** adds a `price_pinned` readiness gate.
  - **R3b** makes gate 8 use the stage the screen shows. It is adopted only if the probe does not show worse discrimination.
  - **R3c** adds diagnostics only.
- **R4:** gates 3, 4 and 6 are evaluated, not changed.
- **R5 (optional):** a dated context line on old failed breakouts.

**CHART track** (5 items; the 492-view probe gates each one)
- **C1:** make the moving-average name search faster with identical output. Target: 200 ms or less on SWKS at 1440.
- **C2:** move the weekly notice from the plot into the 注記.
- **C3:** keep the low's price on the card at 320 without changing the card height.
- **C4:** show the pivot bar's date and 静かな日 on the VCP card, with no change to the drawing.
- **C5:** the 対ピボット readout uses the same distance wording as the rows.

**Ops (optional, outside round 3 scope)**
- The watchdog re-acquires the same date before the upstream bundle exists.
- `producer-price-history.mjs:59` stops the whole run on a same-day history.
- `require_current` should name the ETF that failed. This one is trivial and could join round 3.
- The AMD RS-context failure.

**Owner decisions** (§10; round 3 ships the default for each)
1. Whether to count the Q4 EPS reference.
2. Confirming the lazy chart split. The JS line becomes 3% over `8849bf9`: 134.00 kB gzip, the same per-round rule as round 2.
3. `EARNINGS_CHIP_PERCENT` = 25.
4. `FRESHNESS_GRACE_HOURS` = 28.
5. The 市場 FTD-conflict height: 1300, or 1322 one session behind, against a 1288 line.
6. Pin thresholds and the ranking change they cause.
7. Adding `se_pivot_date` to the index (default: add; R1 does not ship without it).
8. A `sell_summary` field for unwatched rows.
9. How long a failed breakout is remembered.
10. Readiness gate alternatives.
11. How setup_ready is shown as a KPI.
12. Excluding Finance-Blank Check stocks.
13. Another way to prove identity when the cik is missing.
14. The 「SEC 読取エラー」 label and a Today warning.
15. Card height across periods at 320 and 1440.
16. Serving deeper chart history.

**What I read in the code myself**
- `sec_conditions` is outside the published block's keys (`report-data-coverage.mjs:157-158`).
- `listFields` does not include `se_pivot_date` (`export-research.mjs:274`).
- `chartNotes` (`:261`) and `chartCrossing` (`:303`) both live in `chartReadout.js`.
- The label probe loops over the fixture's `rows`.
- Only `researchEngine`, `entryReadiness` and `portfolioPlan` read `price_activity`, and only its `lowRange`.
- Round 2's JS rule was per round: "3% or less from" that round's base.

**Taken from the reports and not checked by me (未検証)**
- Every rebuild count and timing.
- Which module holds the brief's liquidity rule.
- Whether published research details carry `se_quiet_days_10d`.
- Whether the `8849bf9` index decoder accepts a new list field. R1 must test this.