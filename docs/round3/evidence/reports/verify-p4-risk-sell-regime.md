{
 "confirmed": [
  {
   "id": "p4-risk-sell-regime-1",
   "severity": "major",
   "note": "Reproduced independently from my own git archive of 8849bf9, bundled with esbuild, on the snapshot's serve dir. 615 of 980 listed rows certify. failedBreakout is hit 21, clear 543, no pivot 51. 7 of the 21 hits cross before the pivot exists. All 7 are nr7_inside_day_trigger_high, and in each the pivot bar is the se_pivot_date bar: MGRC 11/3 vs 11/12, TMP 11/4 vs 11/11, CZFS 11/4 vs 11/11, TBCH 11/9 vs 11/10, OABI 11/9 vs 11/11, JILL 10/29 vs 11/10, ASO 11/9 vs 11/11. The 14 handle_high hits all cross after their pivot bar. The MGRC screen reads 「ブレイク失敗（独自判定）11/3に出来高27.03×で上抜け」. The snapshot's own render (snapshot/charts/index-phone.json) gives the aria label 「ピボットを上抜けた日 2026-11-03（上抜け 27.03×）」. CONTEXT.md:150 defines the check as 'a breakout of today's pivot', and a crossing before the pivot formed is not one. Supporting evidence: the backend feature run has MGRC on pivot 123 (handle_high, 8/14). Against that pivot the 11/2 close of 129.44 on 8.23× is a breakout that still holds at +5.7%, so the 130.13 'failure' is a misattribution. The holder-facing 「保有なら売りのサイン」 is a false sell signal. Scope: of the 7, only MGRC (rank 71) and ASO (rank 379) have a liquid rank. The chart arrow is dated on or before se_pivot_date on 61 certified listed rows (41 handle_high, 17 nr7, 2 tight_area, 1 inside_day), using breakoutBar of the last crossing. All of them are wait state. The published pivots are 未検証. Scripts: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/skeptic-p4/scripts/ev.mjs, output /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/skeptic-p4/work/ev.jsonl, bundle /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/skeptic-p4/bundle/b.mjs."
  },
  {
   "id": "p4-risk-sell-regime-2",
   "severity": "minor (downgraded from major: documented design boundary)",
   "note": "The facts reproduce: focusCounts gives zone 68 / near 82 / total 150, and 86 of the 150 certify. 8 are failedBreakout hits on their stock screen: EMBJ 70 −0.06%, MGRC 71 −0.12%, EBC 76 −0.52%, EWTX 87 −1.06%, ETON 114 −2.32%, MSFT 116 −2.35%, HQY 133 −3.04%, PVLA 148 −4.46%. All are state wait (ピボット接近). ListView.jsx:91 and TodayView.jsx:91 run useWatchSellChecks only for watched rows, and the near-list render shows EWTX and PVLA with no ▲. This is the documented scope, not a regression. CONTEXT.md:154 says 'The rows have no bars (owner decision §9-11)', and CONTEXT.md:150 gives the 崩れ chip only to watched focus rows. A failed breakout always sits under the pivot, so the row is never green; the harm is the 接近 count and the missing ▲. The fix needs a new published index field, which is the owner's decision. The index budget is confirmed in the CI log: 868,379 bytes gzip against 1,000,000. Script: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/skeptic-p4/scripts/focus.mjs"
  },
  {
   "id": "p4-risk-sell-regime-3",
   "severity": "moderate (downgraded from major)",
   "note": "Core reproduced. PCRX closed 25.20 on 10/7, then gapped to 36.39 on 10/8 on 28,900,300 shares (50.2×). It has closed between 36.31 and 36.49 in the 25 sessions since. ADR20 is 0.150% and the 20-session range is 0.52%. The 60-session range is 55.05%, so price_activity.lowRange is false. It is liquid rank 1 (entryPriority ranks a +0.03% distance first), 7th in 候補›買いゾーン, and setup_ready. The VCP card reads 「9週 18/5 3T・土台の高値を上抜け（10/8）」, calling the gap the base breakout. Its legs' lows are 8/14, 9/15 and 10/6, all before the gap. Plan: −1R 33.91 (7% default), 244株, $625 risk, about 47 ADRs, and 「損切りが収縮の中（安値 24.56 より上）」. The 20-session test flags exactly the 10 rows listed, but only PCRX, BWIN, PAG, PTC and SYNA have a liquid rank. Overclaims are in the corrections: the screen already warns twice, and the verdict is not a buy even in an open market. Script: /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/skeptic-p4/scripts/pcrx.mjs"
  },
  {
   "id": "p4-risk-sell-regime-4",
   "severity": "minor (design choice, not a code defect)",
   "note": "Reproduced. SAIL, GEN and PFG read failedBreakout clear with the details quoted, and their failed heavy breakouts are more than 10 sessions old. The persona's replay script, run on my bundle and eval, gives SAIL ▲ from 9/25 to 10/6, clearing 10/7 at 19.58 (−6.3%), and GEN clearing 9/29 at 20.85 (−32.1%). This is the documented rule: CONTEXT.md:150 counts 10 sessions from the breakout itself. GEN's −32% is a real decline on heavy volume from 9/22 to 9/29 (31.41 to 20.85), followed by a 7-week V-shaped recovery, so 30.69 is now the left-side high of a new base. Keeping the failure 'until a close recovers above the pivot' would brand GEN permanently, which is contestable. The neutral, dated context line is the defensible part."
  },
  {
   "id": "p4-risk-sell-regime-5",
   "severity": "minor (lowest; confirmed narrowly)",
   "note": "Confirmed only as wording. The verdict label is 「50日線割れ（弱含み・独自判定）」 on a day the backend regime is correction with SPY 6 distribution days, which my recompute also gives: 10/14, 10/16, 10/22, 10/29, 10/30, 11/5. The 0% guide is paired only with 「新規の買いは控えます」, and the sell card and watch tile say nothing to a holder. The label belongs to the brief's own SPY 50-day rule (portfolioPlan.js:37), is marked 独自判定, and the disclosure separates it from the backend's guide (marketTabStudy.js:72-73). The 0% cap is stricter than the backend's 20%, so the action is not understated; only the word is. The CI log shows market_context present ('List summary gate passed … market_context present'), so on Pages regimeCause should already print the 「調整」 and SPY 6日 line under 目安と判定の基準. Neither render served it, so that line is 未検証."
  },
  {
   "id": "p4-risk-sell-regime-6",
   "severity": "minor (cosmetic)",
   "note": "Reproduced exactly. Certified listed rows within 0.1% of the pivot but not at its cents, where formatPercent prints ±0.0: PCRX +0.0274% → 「+0.0%」, PFIS −0.0274% → 「−0.0%」, TECH +0.0137% → 「+0.0%」, LNTH −0.0197% → 「−0.0%」. The rows use distanceText/pivotDistanceText (briefCandidate.js:471-485) and print 「+0.1%未満」. StockChartCard.jsx:51 uses formatPercent (chartReadout.js:154) instead. The PCRX render shows both on one screen: 「対ピボット+0.0%」 and 「ピボット比 +0.1%未満」. The weekly readouts of PCRX and TECH also print 「+0.0%」. Of the four, only PCRX is high-ranked: PFIS has no liquid rank, and TECH and LNTH rank last (1823 and 1825)."
  }
 ],
 "refuted": [
  {
   "id": "p4-risk-sell-regime-3 (sub-claim: 'Only the market gate keeps the call from reading 買いゾーン内')",
   "why": "I ran buyGate with an open market (cap 0.5, confirmed_uptrend) on PCRX's certified bars. It returns kind afterLight, tone wait, 「11/9に上抜け・出来高不足」 (11/9 crossing at 0.35× against the 1.4× bar), not 買いゾーン内. What the open market changes is the plan: it becomes non-reference (reference false), not the verdict's colour."
  },
  {
   "id": "p4-risk-sell-regime-5 (sub-claim: 'the plan takes no market input')",
   "why": "positionPlan reads the market. On PCRX it returns referenceReason 地合い, and the screen prints 「試算のみ／目安 0%（新規は控える）」, as the persona's own Q2 says. Only the sell card and the watch tile take no market input."
  },
  {
   "id": "p4-risk-sell-regime-5 (sub-claim: 'two names for one state on two screens')",
   "why": "These are two attributed judgments, not two names for one state. 弱含み is the brief's own SPY 50-day verdict (独自判定). regimeCause names 「調整」 explicitly as the backend's 局面判定 (marketTabStudy.js:337-349), and exposureRuleText discloses that the two differ."
  }
 ],
 "corrections": [
  "F1: MGRC being 'one of Today's 3 watch flags' holds only under the persona's own 6-symbol test watchlist (MGRC, EMBJ, HALO, ABCL, PCRX, FCNCA). It is not a property of the publication.",
  "F1: 3 of the 7 misdated hits are ready (MGRC, TMP, CZFS). Only MGRC (rank 71) and ASO (rank 379) have a liquid rank; TMP, CZFS, TBCH, OABI and JILL have none.",
  "F1: MGRC's 130.13 nr7 pivot and its setup_ready pass come from the snapshot recompute. The backend feature run has pivot 123 (handle_high, 8/14) with setup_ready false, and the published value is 未検証. Against 123, the 11/2 breakout still holds at +5.7%, which strengthens the misattribution.",
  "F1: '69 listed rows' counts the raw last crossing (pivotCrossings[0]). The chart arrow uses breakoutBar and is dated on or before se_pivot_date on 61 certified listed rows: 41 handle_high, 17 nr7, 2 tight_area_high, 1 inside_day. So pre-formation crossings also affect handle_high arrows, not only nr7.",
  "F1 fix: se_pivot_date is not in the published index. export-research.mjs:274 listFields carries se_pivot_price and se_pattern_primary but not se_pivot_date or se_pivot_type. It does reach the research detail: recalculate-setups.py:97-99 writes se_* scalars, and export-research.mjs:226-229 keeps the full row in the detail. The stock screen merges the detail and could apply the bound. The watch rows and the Today watch tile use index rows (useWatchSellChecks) and could not, so the screens would disagree unless se_pivot_date is added to listFields.",
  "F2: the spec title quoted in Verify, 「the rows' tone matches the conclusion's」, does not exist in brief-invariants.spec.js. The nearest are 'no green row beside a 参考 conclusion the row can read' (line 83, scoped to what a row can read) and 'Today shows a broken watched focus candidate one way' (line 62, watched only).",
  "F3: the gap-day volume ratio is 50.2×, not 50.3×. There are 25 sessions after 10/8 (26 counting 10/8) in 36.31–36.49.",
  "F3: the report omits that PCRX's plan card already prints 「構造上の損切り目安 24.44（買値比 −33.0%）深すぎる（10%以上・見送り候補）」 (structural state tooDeep, low 24.56 on 10/6). 'Gets a full VCP and risk plan' should say the plan carries that warning.",
  "F4: SAIL's latest crossing, 10/23, was light: the chart shows 「上抜け 1.39×」. PFG had two heavy failures, 9/3 at 2.83× (back under 9/8) and 9/18 at 2.43× (back under 9/21).",
  "F5: the 11-12 market_context is present per the combine log, so the published market tab should show the 「局面判定は「調整」」 line with SPY 6日. Neither render served it, so it is 未検証 in render, not absent.",
  "Reproduced exactly (実測): 615 certified listed rows, all 365 uncertified being proxy rows with 「日足の順序・重複・OHLCVに異常」. failedBreakout 21/543/51 none; ma50 28/76/3/508; book 2; day-down 15/592/8. 255 plans, structural unknown 157 (153 収縮を測定できません), ok 83, tooDeep 15. stopInsideBase 27 true / 71 false. ADR20 p10/p50/p90 2.00/2.85/5.96. SPY 757.12 / SMA50 764.80 / SMA200 731.29, 2.82% under the 60-session high close 779.09, 6 distribution days. CI log: market context from 4648 rows (correction), leaderHealthPercent 58.125, breakoutHoldPercent 58.996, TT count 627, index 868,379 bytes gzip.",
  "Not re-measured by this skeptic (未検証 here, neither confirmed nor refuted): the row-chip counts 51/74/3/33; strength judged 37 / na 578; the identities of the 3 ma50-unknown symbols (PBHC, HFBL, CPBI); the round-lot volume counts; the 50/40 environment thresholds; whether the backend's 6 distribution days (with expiry and stalling) are the same dates as the simple rule's."
 ]
}