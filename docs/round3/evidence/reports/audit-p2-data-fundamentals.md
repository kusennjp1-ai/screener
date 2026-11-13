# p2-data-fundamentals: SEC-side audit report (round 3)

**report.md was not written.** The harness refuses report files from subagents ("Subagents should return findings as text"), so the full report is below. Every evidence file it cites exists.

## Basis
- **Code:** main 8849bf9. Line numbers refer to 8849bf9. The scratch tree `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/src` now has 3 tool files patched. The pristine originals are in `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/tools-orig/`; I checked them byte-identical against `git show 8849bf9a:…`.
- **Data:** Static Site 43385558863, combine-and-build job 131809613471. It logged SEC evidence at 19:07 JST and the published coverage at 19:15 JST on 11-13. Log: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/logs/combine-and-build.log`, lines 1717, 1718, 1735 and 1736.
- **Nothing on GitHub was changed.** The main clone's `git status` is clean.
- **No real SEC record was read.** book-financials.json.gz is not a release asset, and Pages and data.sec.gov are blocked. Carry-projection asset 743402606 holds Yahoo statements only, with 0 `book_financials` and 0 `entityName`.
- **Snapshot examples.**
  - HTFL is the PayloadMismatch example, but its snapshot PNGs cannot show the SEC state (未収録 there). Its card is reconstructed on ZZAR (合成), with the exact published signature.
  - No fiscal_q4_untagged symbol is named anywhere readable, so the Q4 renders use ZZNV (合成).

## Findings summary

| id | severity | finding |
|---|---|---|
| p2-data-fundamentals-1 | major | All 112/998 (159/1403) PayloadMismatch records had **no non-negative int `cik`** in the companyfacts payload. The strict fix is designed and tested. |
| p2-data-fundamentals-2 | major | `sec_conditions.eps` 2/342/431 is Code 33's EPS acceleration. It can fail across a missing Q4, but it can pass only with a Q4 EPS fact. The label and `fiscal_q4_share` mislead. |
| p2-data-fundamentals-3 | major (owner decision) | Code 33 can never be 達成 for filers that don't tag Q4 EPS. Proposal: a 独自計算・参考 Q4 EPS, kept outside `quarterly.eps` and never counted. |
| p2-data-fundamentals-4 | minor | Today shows no warning although 112/998 listed rows lost SEC to a fetch-side error. |
| p2-data-fundamentals-5 | minor | 「SEC 検証不可」 names our own read failure like a filing that failed verification, and it is shared with `invalid`. |
| p2-data-fundamentals-6 | minor | On phones, 「算出」 under fiscal-Q4 columns is unexplained in the card, and the 未達 reason quotes a derived Q4 unmarked. |

---

## p2-data-fundamentals-1 (major): PayloadMismatch means there was no int cik in the payload

### 実測
**The counts (log).**
- Line 1718: `SEC invalid_payload 2026-11-12: {"count": 159, "by_cause": {"PayloadMismatch": 159}}`.
- Line 1735, listed rows: `invalid_payload {count 112, by_cause {PayloadMismatch 112}}`, first HTFL SN CART BRZE HNGE BTSG RAL GFR RSKD ECO.
- **0 `cik_mismatch`** anywhere.

**The code leaves only the type check** (`frontend/tools/sec-financials.py` @8849bf9).
- `PayloadMismatch` is raised only at `:186-187` (invalid as-of) and `:188-189` (`facts.get("cik") != cik`).
  - `:187` is excluded: the date is shared, and 945 records were available on the same run.
- `:236` `received_cik` is the payload cik only if it is a non-bool int ≥ 0, else null. `:238-244` `invalid_cause` returns `cik_mismatch` only when both CIKs are ints and differ; otherwise it returns the class name.
- A non-dict body would surface as `AttributeError`.
- **Conclusion:** all 159 payloads were JSON objects whose `cik` was a string, missing, null or another type, never a different int. This confirms the hypothesis's mechanism, and explains why `invalid_cause` reports the class name (because `received_cik` is null).

**Reproduction** with the shipped module:
- Script: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/scripts/cik-repro.py`
- Output: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/cik-repro.out`

| Payload cik | Result |
|---|---|
| `"0000000006"`, `"6"`, missing, `null` | All identical to the published signature (PayloadMismatch, `received_cik: null`) |
| `999` | `cik_mismatch` |
| `6.0`, and `True` for CIK 1 | Accepted today (the `!=` is lax) |

`test_sec_financials.py` has no string-cik case (`:357-370`; every fixture writes an int).

**Across runs.** The count persists: 11-11 109/1018 (old code, count only), 11-12 158/1396 (run 43314500446 at 09:10 JST), 11-12 159/1403. Logs: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/logs/cab-43152106595.log` and `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/logs/cab-43314500446.log`. Both 11-12 fetches share 9 of their first 10 symbols. CRBG is 7th in the first and absent from the second's first 10, where ECO is 10th.

### 未検証
- Whether the payload cik is a digit string, or missing or null. The published record cannot tell them apart.
- Whether CRBG flipped between the two fetches. The first-10 list follows target order, which changed (941 → 998 listed). A flip would point away from a payload-type cause.
- Why it affects about 11% of filers. The examples skew to recent IPOs, spin-offs and foreign filers, which is suggestive only.

### Proposed change (minimal, strict)
Diffs:
- `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/fix-a-sec-financials.diff`
- `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/fix-a-test_sec_financials.diff`

1. **`payload_cik(value)`.**
   - It returns an int for a non-bool int ≥ 0, or for an ASCII string matching `re.fullmatch("[0-9]{1,10}")`. It does not use `isdigit`/`int()`, which accept Unicode digits, spaces, `_` and `+`. Anything else is None.
   - `normalize` compares `payload_cik(facts.get("cik")) != cik`, keeping the message byte-identical.
   - **Tightening:** `6.0` and `True` stop being accepted.
2. **`invalid_detail.received_cik = payload_cik(...)`.** A different digit string becomes `cik_mismatch` and turns on the card's CIK sentence. The 4 keys are unchanged, and the value stays int or null, as `bookFinancialAdmission.js:66-69` requires.
3. **Diagnostic, log only and never in a record.**
   - `fetch_symbol(..., observe=)` reports `cik_kind(facts)` and the outcome for every received payload, accepted ones included. Kinds: int, digits, missing, null, text, bool, not_object, other types.
   - `collect` tallies them across the 4 workers under a lock into `output["payload_cik"]`.
   - `main` pops it before writing, then prints `SEC payload cik <date>: {...}` and adds it to the step summary.

### How to verify
**Done (実測):**
- `python3 -m unittest test_sec_financials`: 36/36 on the original, **39/39 patched**. The browser admission test still passes.
- The 3 new tests fail or error on the original module: a digit string is accepted; a different, missing, null, float, bool, signed, spaced, full-width, 11-digit or `6_0` value is refused with exactly 4 keys; the kind count is never written into a record.

**On the first patched run** (the fix and the diagnostic ship together), one of two outcomes:
- **`digits:*` ≈ 159 with invalid_payload near 0.** Fixed. Listed rows with quarters rise by at most 112, from 796/998 (79.8%) to at most 908 (91.0%). That is an upper bound, because some will be `no_quarterly` (20-F filers such as RSKD and ECO).
- **`missing`/`null:invalid_payload` ≈ 159.** They stay failing by design: the identity check is not loosened. Any other proof of identity is an owner decision.

---

## p2-data-fundamentals-2 (major): what `sec_conditions.eps` 2/342/431 actually counts

### 実測 (code)
In `frontend/src/static/bookFinancialEvidence.js` @8849bf9:
- `:2-7`: EPS is never derived, and `acceptedOrigin` refuses a derived EPS.
- `:78-79`: rows are the union of EPS and revenue ends, so a derived revenue Q4 makes a Q4 row with `epsYoY` null (`not_reported`).
- `:104-105`: the window is the last 4 consecutive rows, which always contain one fiscal Q4.
- `:52-58` `risesDetail`:
  - It **fails** on any known later value ≤ a known earlier one, across the null.
  - It **passes** only when all 4 values are known.
- `:121-122`: Code 33 needs all 3 parts to pass.

So for a filer without a quarter-length EPS fact at fiscal year end (this Q4 and the year-ago Q4 base), EPS acceleration is fail or unknown, never pass. The 2 passes prove at least 2 listed filers have such a fact in two successive years. **"Structurally cannot pass" holds only for non-tagging filers.**

### 実測 (synthetic, through the shipped modules)
Script: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/scripts/q4-demo.mjs`
Output: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/q4-demo.out`

| Case | EPS acceleration | Notes |
|---|---|---|
| A: Q4 untagged, known quarters accelerating (+45→+50→+55) | **unknown** | cause `fiscal_q4_untagged`; epsFloor last4 unknown, last2 pass |
| B: Q4 untagged, decelerating | **fail** | — |
| C: Q4 tagged | **pass** | — |

### 実測 (the label)
`frontend/tools/report-data-coverage.mjs` @8849bf9 counts `report.epsAcceleration` under `sec_conditions.eps`:
- the published coverage at `:347` and `:372`;
- the markdown at `:526`, "SEC conditions (listed) | EPS …";
- the round-1 copy at `:53` and `:63`.

It reads as the 25% EPS rule. Nothing counts the card's real ≥25% chip (`epsFloor`). `sec_conditions` has no other consumer: I grepped every .js, .mjs, .py and .yml.

### Derived from the logged counts (line 1735)
- `fiscal_q4_share` 0.937 overstates what a Q4 EPS would unlock.
- Of the 431 unknowns, the primary cause is a fiscal Q4 for 404 (398 + 6). But `any.prior_year_loss_or_zero` is 241 against 8 primary, so 218–233 of those 404 also have a loss or zero year-ago base, which stays unknown with any Q4 value.
- **Rows whose only cause is the Q4: 171–186** (inclusion-exclusion).

### 未検証
- The exact `q4_only` count.
- Which 2 symbols passed, and whether their Q4 facts are genuine tags or mis-tagged contexts. The STATE.md item (the validity of the 1 or 2 EPS passes) stays open until they are named.

### Proposed change
Diff: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/fix-b-report-data-coverage.diff`
- Rename to `code33_parts.{eps_acceleration, sales_acceleration, margin_improvement}` in both functions, with the markdown row "Code 33 parts (listed, SEC)".
- Add `eps_unknown.q4_only`: every cause is `fiscal_q4_untagged` or `latest_row_fiscal_q4_without_eps`.
- Add `eps_floor_25.last2/last4`.
- Add `code33_parts.eps_acceleration_pass_symbols` (first 25), for the hand-check against the filings.

**Verify:** `npx vitest run tools/report-data-coverage.test.mjs` passes 16/16 before and after (実測). No test pins the new keys yet; add one per key.

---

## p2-data-fundamentals-3 (major, owner decision): a 独自計算・参考 fiscal-Q4 EPS

### 実測 (合成)
ZZNV's card at 390 reads 「Code 33 未確認 … EPS前年比 +10→+20→+40（Q4は10-Kのみで未確認）」 (Code 33 unconfirmed; EPS YoY +10→+20→+40; Q4 only in the 10-K). Render: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/renders/zznv-390.json` and `-card-open.png`.

A Q4-untagged filer can never reach 達成.

### Upper bound on the effect
At most 171–186 listed rows could be settled by a reference Q4. A pass also needs the year-ago Q4. `gaps.fiscal_q4` is 91 (rows with no Q4 row at all); a reference kept outside `quarterly.eps` has no column there.

### Design
- **Inputs.**
  - Diluted shares: `WeightedAverageNumberOfDilutedSharesOutstanding` (unit `shares`), quarterly and annual.
  - Numerator: `NetIncomeLossAvailableToCommonStockholdersDiluted`, falling back to `…Basic`, then `NetIncomeLoss`, with the kind recorded.
- **Q4 numerator:** the existing exact `derive_fourth_quarters` (`sec-financials.py:93-123`).
- **Q4 shares:** (annual weighted × FY days − Σ quarter × days) ÷ Q4 days. Exact for basic; approximate for diluted (ASC 260 antidilution per period, and a loss quarter's diluted equals its basic).
- **Stay unknown when any of these holds:**
  - the 4 facts don't tile the year;
  - Q4 shares fall outside [min, max] of Q1–Q3 ±10%. This catches a split between the 10-Qs and the 10-K's restated year;
  - a Q1–Q3 check fails (EPS × shares ≈ NI within 2%).
- **Output.** A separate optional key `q4EpsReference: [{end, start, value, method: 'q4-ni-over-q4-diluted-shares-v1', numerator: {tag, components[4]}, shares: {tag, components[4]}}]`, never in `quarterly.eps`. `admitPoint` (`bookFinancialAdmission.js:49`) and `safeSeries` refuse derived EPS, so it can never reach `epsYoY`, `epsFloor`, `chipQuarter`, `sec_summary`, filters, sorts or Code 33.
- **Display.**
  - The Q4 column keeps its grey bar, plus a dashed outline and 「参考 +45」.
  - One line under the Code 33 box: 「参考（独自計算・判定に使わない）：26-06期 Q4 EPS ≈ 1.23（純利益÷希薄化株数）→ 前年比 +45%」 (reference, own calculation, not used for any judgement: the Q4 EPS is about 1.23, net income ÷ diluted shares, so the YoY is +45%).
  - Code 33 stays 未確認.
- **Sequencing hazard.** Admission refuses a record with an unknown key (`bookFinancialAdmission.js:110`, `sameKeys`; code-verified). The UI that admits the key must ship first. Whether an older UI can ever meet newer data in this release flow is 未検証.
- **Measure before showing it.**
  - On filers that tag Q4 EPS: the reference against the reported Q4 EPS, as the median absolute error and the share within 1¢ or 2%.
  - On Q1–Q3: NI ÷ shares against the reported EPS.
  - Publish both in the coverage report.

**Verify:**
- Unit tests: tiling, a split, a missing fact, a loss quarter.
- Admission: the key is optional and strict.
- A coverage line for the backtest.
- Playwright at 320, 375 and 390 within the height budget.

**オーナー判断:**
- 第4四半期の EPS を「純利益÷希薄化株数」で独自計算し、参考値として表示するか（判定・達成には数えない）。
- 将来これを数えるか（例：Yahoo の参考判定と同様に「Code 33（参考）」として別に数え、「達成」とは呼ばない）。誤差の実測を見てから決める。

---

## p2-data-fundamentals-4 (minor): Today is silent about the 112 invalid_payload rows

### 実測
I ran the brief's own `publishedFundamentalsCoverage` and `fundamentalsCoverageWarning` on the logged published block.
- Script: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/scripts/coverage-warning.mjs`
- Output: `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/coverage-warning.out`

Results:
- The block's `warnings` is `[]`, and Today's warning is **null**.
- Meanwhile the CI report warns "cover 796/998 brief-listed rows (79.8%, below 80%)".
- **Cause:** `coverageWarnings` (`report-data-coverage.mjs:151-155`) has no code for admitted `invalid_payload` records.
- The lists show no chip for an unknown SEC state; the EPS filter does say 「該当N・未確認M」.

### Proposed change
- Add a warning code, e.g. `unreadable`, above a stated share (独自設定). Today then reads 「業績データ：SEC記録の読み取り失敗 N/M銘柄（取得側の不具合）」 (SEC records unreadable for N/M stocks, a fetch-side fault).
- **Hazard (code-verified):** `publishedFundamentalsCoverage` (`fundamentalsExplain.js:333`) nulls a block with an unknown warning code, and the block validator has exact keys (`report-data-coverage.mjs` ~`:165-168`). Ship the UI's `COVERAGE_WARNINGS` first. Release-order exposure is 未検証.

**Verify:** a unit test on the logged block, and a Today render at 375 within the height budget.

---

## p2-data-fundamentals-5 (minor): the 「SEC 検証不可」 label

### 実測 (合成, the exact published signature `received_cik: null`)
Renders:
- `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/renders/invalid-null-390-card-open.png`
- `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/renders/invalid-null-390.json`

What a phone user sees on HTFL-like rows:
- 「業績：SEC検証不可・Code 33 未確認」.
- Three tiles reading 「— SEC 検証不可」.
- The conclusion chip 「業績 未確認・SEC検証不可」.
- The long text is right: 「…取得側の処理エラーで、業績の良し悪しではありません」 (a fetch-side processing error, not a verdict on the results).

Two problems:
- The short label is shared with `invalid` (`fundamentalsExplain.js:46-47`; 7 rows).
- `payloadText`'s CIK sentence (`:70-73`) never fires on real data.

### Proposed change
Give invalid_payload the label 「SEC 読取エラー」 (chip 「業績 未確認・SEC読取エラー」), and keep 「SEC 検証不可」 for `invalid`.

**Verify:** update `tests/static/brief-fundamentals.spec.js:313` and the copy tests, and render at 320.

---

## p2-data-fundamentals-6 (minor): unexplained 「算出」 on phones, and an unmarked derived Q4

### 実測 (合成: ZZNV plus a September 10-Q, so the derived June Q4s are inside the window)
Renders:
- `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/renders/q4-mid-390-card-open.png`
- `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/renders/q4-mid-390.json`

What the card shows:
- The axis prints 「算出」 under 25年6月 and 26年6月.
- **The source line has no derivation note:** it reads 「出典：SEC XBRL（10-Q 2026-10-01 提出）・2026-09期まで」. It adds the note only when a *tile* is derived (`StockFundamentalsCard.jsx:220`).
- **The phone legend omits it** (`:86-87`).
- The 注記 calls it 「Q4算出」 (`:7`), but the axis says 「算出」.
- At 1440 the legend explains it (`/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/renders/q4-mid-1440.json`).
- **The 未達 reason** reads 「売上 前年比が2026-06期 +100% → …」, quoting a derived Q4 unmarked (`settledText`, `:147-159`).

### How common it is
- 937 of 1403 records have a derived revenue Q4 (実測, line 1717).
- How many listed cards show this is 未検証; it is likely common, since the newest row is not a Q4 in 3 quarters out of 4.

### Proposed change
- Show the derivation note when `rows.some(r => r.derived)`, in the source line or the phone legend.
- Write 「（Q4算出）」 in `settledText`.
- Use one term for it.

**Verify:** render at 320, 375 and 390 within the height budget.

---

## Checked, no change proposed
- **EPS filter.** It counts unknowns apart (`briefCandidate.js:583`, `ListView.jsx:120,165`).
- **≥25% chip.** It uses 4 quarters when settled, else 2. A Q4-untagged filer's 4-quarter state can only be 未達, so a pass reads 「（直近2期）」. It names its window, so it is honest.
- **Code 33 on the conclusion.** It shows only when 達成 (`StockVerdict.jsx:151`); 未達 and 未確認 stay in neutral tone in the card. It is never a gate.
- **Q4-cause text.** It states that no estimate is made (`fundamentalsExplain.js:270`, `StockFundamentalsCard.jsx:139`).

## Rules check
- Missing values stay null or unknown.
- The identity check is not loosened: missing and null still fail.
- The 90% bar, transport hashes, selection and Code 33's bonus status are untouched.
- The reference Q4 EPS is never counted.

## Evidence index
All under `/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p2-data-fundamentals/`.
- **Patches:** fix-a-sec-financials.diff, fix-a-test_sec_financials.diff, fix-b-report-data-coverage.diff.
- **Scripts:** scripts/cik-repro.py, scripts/q4-demo.mjs, scripts/coverage-warning.mjs.
- **Outputs:** cik-repro.out, q4-demo.out, coverage-warning.out.
- **Renders** (合成, Chrome for Testing 147, CI fonts, port 4413), in renders/:
  - invalid-null-390-card.png, invalid-null-390-card-open.png, invalid-null-1440-card.png, invalid-null-1440-card-open.png;
  - q4-mid-390-card.png, q4-mid-390-card-open.png, q4-mid-1440-card.png, q4-mid-1440-card-open.png;
  - zznv-390-card.png, zznv-390-card-open.png, zznv-1440-card.png, zznv-1440-card-open.png;
  - plus a matching .json for each case and width.
- **Spec and config:** src/frontend/tests/p2/fund.spec.mjs, pw-4413.config.mjs.
- **Logs:** logs/combine-and-build.log (Static Site 43385558863), logs/cab-43314500446.log, logs/cab-43152106595.log, logs/release-publish.log.
- **Pristine 8849bf9 originals:** tools-orig/.
