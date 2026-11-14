# Round 3 track CHART

The record of track CHART (plan §5, items C1–C5; order C2, C3, C5, C4, C1). One section per item:
- what changed;
- the gate and its measured result;
- 実測 (measured here, with the command) apart from 未検証;
- integration requests.

Base: 45603f06 (main with STEP 0). Every probe below is the H5 harness copy (`$H` = the scratch `audit3/r3-harness`), CI-faithful:
- Chrome for Testing 147 headless shell and the CI fonts;
- port 4424;
- reduced motion, read after the finite animations finish.

Probe files are named after the commit they measured. Outputs stay in scratch and are never committed (rule 22).

## C2 (package CH-1): the 週足 notice moves from the plot to the 注記

**Commit measured:** 24f1210b `feat(frontend): move the weekly chart's week count from the plot to the 注記` (code and tests). The commit that adds this record changes only `docs/round3/chart.md`, so the probes named `probe-24f1210*.json` are its code.

### What changed

**`priceChart.js`** (lazy price-chart chunk)
- The in-plot notice no longer has the two weekly lines 「週足は直近N週分（YYYY/MM〜）。」 and 「2年分はありません」.
- 「ピボット 未確認」 and 「収縮は未確認」 are unchanged: same order, same block, same `placer.put(w, grid, { half, slack: 64 })`, same corner/grid search.
- The line split before 「（」 is removed. It applied only to a notice with 「（」 at index > 0. The two remaining notices are fixed literals without 「（」, so after the weekly line went it could never apply.
- Unchanged: the placer, `put` options, `settle()`, every other label, the chart's aria-label (it never carried the weekly notice) and the weekly button.

**`chartReadout.js`** (entry chunk)
- New exported `weeklyShortNote(weeks)` gives 「週足はYYYY/MM〜のN週分（2年分はありません）」.
  - N = `weeks.length`.
  - YYYY/MM is the first week's first session (`start`), derived exactly as the removed notice derived it.
  - It returns null with no weeks (never 「0週分」) and at 104 weeks or more.
- `chartNotes` pushes the sentence second, directly after 「—＝…」, only when the series is weekly.
  - Its callers already pass `bars`, `interval` and `period`, so StockView.jsx is unchanged.
  - A weekly series with no whole week (a few sessions from mid-week) gives no sentence, and `chartNotes` does not throw.
- One constant for the 104: `TWO_YEARS_OF_WEEKS = CHART_RANGES['2yw'][0]`.
  - It is the weekly period's existing length, not a new threshold, so it carries no 独自設定 label.
  - `weeklyRangeLabel` now reads it instead of its own literal 104 (no change in behaviour).
- Copy: the sentence is the order's text exactly, with no trailing 「。」. Every other 注記 sentence but the first (「—＝…」) ends in 「。」. This is left to the conductor (see the end of this section).

**Where the sentence shows**
- At 1024px and wider: in the chart card's `.brief-chart-notes`.
- Below 1024px: in the screen's 注記 (`.brief-screen-notes`, outside the card). Its summary 「注記（計算方法・出典 N件）」 counts one more note on 週足.
  - That summary is outside the card, so the probe does not see it.
  - No test pins that count: a grep of `出典`/`件）` over `tests/static` and `src` found only unrelated pins.

### Gate (rule 16): expected diff against the base probe, 実測

**Commands** (port 4424; the comparers are scratch scripts in `audit3/r3-chart/`, never in the repo):

```
$H/probe/run-probe.sh <worktree> 4424                 # → $H/probe/probe-24f1210.json  sha256 1127e3b8…bc62342
$H/probe/run-probe.sh <worktree> 4424 oracles         # → $H/probe/probe-24f1210-oracles.json  sha256 2f1aacc1…b23429
node $H/probe/diff.mjs $H/probe/probe-8849bf9.json $H/probe/probe-24f1210.json --texts
node $H/probe/diff.mjs $H/probe-oracles-step0.json $H/probe/probe-24f1210-oracles.json --texts
node audit3/r3-chart/compare-c2.mjs <base> <head>     # label by label: box, forced, reserved; every other field; card; html
node audit3/r3-chart/forced-c2.mjs <base> <head>      # forced label lines per period × width
```

- `diff.mjs` only names the fields and texts that differ.
- `compare-c2.mjs` matches every SVG text by text, class and occurrence, and compares its box, `forced`, `reserved`, font, opacity and group.
  - It requires every other field of the view to be identical. Those are the leaders, solids (tags, dots, marks), level lines, legs, leg texts, line and average masks, aria, chart and SVG boxes, and overflow.
  - The allowed exceptions are the removed weekly notice texts, the remaining notice block's boxes, and halos with those texts left out.
  - A mask hole may differ only where it lies under a notice line (the removed line's for a removed hole).
  - At 1440 the card may gain exactly one html text matching the sentence, and a new card height with the same top, left and right.
- Both sanity runs agree: 8849bf9 against c61bf96 (identical code) gives 0 of 492 differing views in the comparer, as in `diff.mjs`.

**Result: the gate is green. The diff is exactly the expected one.** No other label moved, none is newly forced, none is missing, and no view's forced count rose.

**The 492-view label probe** (8849bf9 → 24f1210; 0 → 0 page errors):

| | Differing views | Fields that differ |
|---|---|---|
| 3m, 6m, 1y (all widths, light and ZZNV dark; 369 views) | **0** | — |
| 週足 320 (30 light + ZZNV dark) | 31 of 31 | texts, halos |
| 週足 375 (30 light) | 30 of 30 | texts, halos (ZZLI also masks, maskRects) |
| 週足 390 (30 light + ZZNV dark) | 31 of 31 | texts, halos |
| 週足 1440 (30 light + ZZNV dark) | 31 of 31 | texts, halos, html, card |

**Texts removed** (every one a `bc-notice`):
- 「2年分はありません」 in 123 views;
- 「週足は直近N週分（YYYY/MM〜）。」 in 92 views (375, 390, 1440);
- at 320, the split form 「週足は直近N週分」 + 「（YYYY/MM〜）。」 in 31 views.

Notice lines in 週足 views fell from 91 to 1 at 320 and from 61 to 1 at 375, 390 and 1440 (light). The ZZNV dark views fell from 3/2/2 to 0.

**The remaining notice:** only ZZLI keeps one on 週足 (「収縮は未確認」). Its block moved because it is now one line, not three. It was not forced before or after.

| View | Box before (x0–x1, y0–y1) | Box after |
|---|---|---|
| ZZLI 週足 320 | 57.3–129.3, 159–171 | 88–160, 159–171 |
| ZZLI 週足 375 | 36–108, 199–211 | 143–215, 199–211 |
| ZZLI 週足 390 | 52–124, 199–211 | 158–230, 199–211 |
| ZZLI 週足 1440 | 631.5–703.5, 294–306 | 752–824, 294–306 |

**Mask holes:** one view, ZZLI 週足 375, lost one hole (x 35–229.5, y 167–179). It was the cut under the removed line 「週足は直近58週分（2025/08〜）。」. No other hole changed in any view.

**Other labels:**
- Moved: **0**, in all 492 views.
- Newly forced: **0**.
- Missing: **0**.
- The forced counts per period × width are identical before and after in every cell. For example, 週足 320 is 20 → 20, 週足 375 is 2 → 2, and 週足 390 and 1440 are 0 → 0.
- On the fixture no weekly notice line was forced before (0 in every cell), so the fixture's forced count does not fall. The fall p3 measured is on real data (CH-4).

**Card height:**
- 320, 375, 390: **identical in every view**, all periods, light and dark.
- 1440 週足: +21.1875px (one notes line) in all 31 views: 622.375 → 643.5625 (19 views) and 643.5625 → 664.75 (12 views). The card's top, left and right are unchanged.
- 1440 html: exactly one text added, the sentence, in all 31 views.

**The values half** (480 views): 120 differ, all 週足 (30 per width).
- The order expected these identical. They are not, because the values probe also records the SVG texts and the card's html, and it shows the same two changes as the labels half:
  - the SVG texts minus the weekly notice lines;
  - at 1440, the html plus the sentence and the card height +21.1875.
- Nothing else differs. 0 non-週足 value views differ.

**The oracle probe** (STEP 0 `probe-oracles-step0.json` → 24f1210; 0 → 0 page errors), same pattern:
- Labels, 132 views: 33 differ, all 週足 (8 per width + ZZRL dark 390). Non-週足 views: 0.
- Removed: 「2年分はありません」 in 33 views and the weekly line in 33 (8 of them split at 320).
- Only ZZHB keeps a notice (「収縮は未確認」), and its block moved:

  | View | Box before | Box after |
  |---|---|---|
  | ZZHB 週足 320 | 57.3–129.3, 159–171 | 88–160, 159–171 |
  | ZZHB 週足 375 | 28–100, 199–211 | 143–215, 199–211 |
  | ZZHB 週足 390 | 37.5–109.5, 199–211 | 158–230, 199–211 |
  | ZZHB 週足 1440 | 631.5–703.5, 294–306 | 752–824, 294–306 |

- Other labels: 0 moved, 0 newly forced, 0 missing. The forced counts are unchanged: 9 → 9, 5 → 5, 4 → 4, 0 → 0, and ZZRL dark 1 → 1.
- Card heights at 320, 375 and 390 are unchanged. At 1440 each grows by +21.1875 in its 8 views (622.375 → 643.5625 ×3, 643.5625 → 664.75 ×2, 663.5625 → 684.75 ×1, 682.75 → 703.9375 ×2).
- Values, 132 views: 33 differ, the same elements.

**The 最新足 corner** (`freeCorner`, which reads the notice box): the probe does not show it, because no bar is selected. A vitest case covers it on a weekly model without a pivot: the corner avoids the one remaining notice (priceChart.test.js). In the browser it is 未検証.

### Tests and checks (実測, on 24f1210b; load in parentheses)

**vitest**
- Command: `cd frontend && PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=… FINANCIAL_REPLAY_PYTHON=… npx vitest run <files>`.
- priceChart.test.js, chartReadout.test.js, StockChartCard.test.jsx and StockView.test.jsx: 5 files, 96 tests passed.
- The full suite: 247 files, **3984 tests passed** (STEP 0: 3983; +1 new chartReadout case). Load 3.53 → 6.13.

**What the tests cover**
- `priceChart.test.js`:
  - A 週足 model under 104 weeks with a pivot and measured legs draws no `.bc-notice` and no 「週足は」 or 「2年分」.
  - Without a pivot and legs (at 600 and 320) it draws exactly 「ピボット 未確認」「収縮は未確認」; with legs unmeasured only, exactly 「収縮は未確認」.
  - The 最新足 corner avoids the weekly notice.
- `chartReadout.test.js` (through `weeklyShortNote` and `CHART_RANGES`):
  - The sentence is second, for 103 weeks (515 sessions), with N and 2026/01 right.
  - It reads the next week's month when the first week is cut.
  - It is absent at 104 weeks (520 sessions), on 3m, 6m and 1y, without bars (`[]`, null) and with no whole week (three sessions from a Wednesday: no throw, no 「0週分」).
- `brief-chart.spec.js`, the weekly period test, at 390 (ZZNV) and 1440 (ZZKS; this test's existing desktop stock):
  - Read after `chartSettled(page, { redraw: true })`.
  - The 注記 has exactly one item equal to the producer's sentence for the stock's bars: `.brief-screen-notes` at 390, the card's `.brief-chart-notes` at 1440.
  - No SVG text holds 「週足は」 or 「2年分はありません」.

**Playwright** (CI-faithful, 4424, `npx playwright test -c audit3/r3-chart/pw-147.config.mjs`, one at a time). No re-run was needed.
- brief-chart.spec.js: **39 passed** (4.0 min; 1-min load 2.55 at the start, 3.73 midway).
- brief-oracles.spec.js: **38 passed, 2 skipped** (the R1 and R2 fixmes; every active assertion green; file not edited).
- brief-compact.spec.js and brief-phone.spec.js: **66 passed** (the frozen budgets hold).

**Other checks**
- eslint on the five touched files: 0 errors, 0 warnings.
- Ownership gate before the commit: `OWNERSHIP OK (CHART): 5 paths`.

**Entry chunk** (rule 21, `$H/build/run-build.sh <worktree>` on the archive of 24f1210)
- `npm run build`: 130.28 kB gzip (c61bf96, STEP 0) → **130.38 kB gzip** (+0.10 kB; the line is 134.00).
- The design-acceptance build: 372,422 → 372,644 raw bytes (+222); gzip -9 129,915 → 130,024 (+109).
- The lazy priceChart chunk: 43,099 → 42,801 raw (−298); gzip -9 18,228 → 18,071 (−157).

### 未検証

- **The real-data acceptance.** Forced 週足 lines at 390 should fall by the weekly notice lines (about 62 of 114 on the rebuild; 60 of 111 on the 39 CI-bar views). This is measured in CH-4.
- **The dump and heights harnesses** were not re-run.
  - Expected: on ZZNV 週足 at 375 the 注記 summary counts one more note, and its list holds the sentence; at 1440 the card gains the sentence.
  - Phone stock-screen heights should be unchanged, because the 注記 is closed by default. That is inferred, not measured.
- **The 最新足 corner in the browser** (vitest only).
- **No timings were taken.** C2 removes work from the label pass; any timing effect is measured at integration.

### For the conductor

- **Trailing 「。」:** the sentence is the plan's text without 「。」.
  - Every 注記 sentence but 「—＝…」 ends in 「。」. The existing check `notes.every(note => note.endsWith('。') || note.startsWith('—'))` (chartReadout.test.js) runs on a daily list only, so it still passes.
  - Adding 「。」 is a one-character change in `weeklyShortNote`, and the tests read the producer, so none would need editing.
- **The literal 104 in `StockChartCard.jsx` `WeeklyLabel`:** `if (count >= 104)` is not in package CH-1's file list, so it is left. The file is CHART's, so a later CHART package can read the same constant (it would need exporting from chartReadout.js).

### Integration requests

None for C2.
- No file outside CHART's list needs a change.
- StockView.jsx already passes `bars`, `interval` and `period` to `chartNotes`.
- No test outside CHART's files failed.
- The H5 baselines that hold a 週足 screen change as stated above: the probe, the oracle probe, and the dump's ZZNV 週足 screens. Integration's re-baseline should expect it.
