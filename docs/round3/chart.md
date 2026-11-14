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

**Commit measured:** 24f1210b `feat(frontend): move the weekly chart's week count from the plot to the 注記` (code and tests).
- Two later commits change no source: one adds this record, and one makes `chartReadout.test.js` assert the sentence through its producer only (`git diff --name-only 24f1210b..HEAD` lists `docs/round3/chart.md` and `frontend/src/static/brief/chartReadout.test.js`).
- So the probes named `probe-24f1210*.json` and the build `build-24f1210.json` are the package's code.

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
- Sanity run: 8849bf9 against c61bf96 (identical code; STEP 0 recorded the same sha256 for both files) gives 0 of 492 differing label views and 0 of 480 value views in the comparer.

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
- priceChart.test.js, chartReadout.test.js, StockChartCard.test.jsx and StockView.test.jsx: 96 tests passed. The filters also match PriceChart.test.jsx, so 5 files ran (49 + 19 + 16 + 9 + 3).
- The full suite on 24f1210b: 247 files, **3984 tests passed** (STEP 0: 3983; +1 new chartReadout case). Load 3.53 → 6.13.
- After the test-only commit (the producer assertions): the same five files, 96 tests passed. The full suite was not re-run for it, since only that one test file changed.

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
  - The base 45603f06 differs from c61bf96 in `frontend/` only by one comment line in pivotBar.js (`git diff --stat c61bf96b 45603f06 -- frontend/src frontend/package.json frontend/package-lock.json frontend/vite.config.js`), so c61bf96's build stands for the base's.
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
  - Adding 「。」 is a one-character change in `weeklyShortNote`. The tests compare with the producer or check only its parts (the month, 「の N週分」), so none would need editing.
- **The literal 104 in `StockChartCard.jsx` `WeeklyLabel`:** `if (count >= 104)` is not in package CH-1's file list, so it is left. The file is CHART's, so a later CHART package can read the same constant (it would need exporting from chartReadout.js).

### Integration requests

None for C2.
- No file outside CHART's list needs a change.
- StockView.jsx already passes `bars`, `interval` and `period` to `chartNotes`.
- No test outside CHART's files failed.
- The H5 baselines that hold a 週足 screen change as stated above: the probe, the oracle probe, and the dump's ZZNV 週足 screens. Integration's re-baseline should expect it.

## C3 (package CH-2): the 安値 price stays in the legend at 320

**Commit measured:** f4b1e404 `feat(frontend): keep the last contraction's low price in the phone legend` (code and tests).
- The package's later commits leave the source as f4b1e404 left it. 5437727b (C5) and 02d820e1 (its revert) cancel out: `git diff --name-only f4b1e40 02d820e1` is empty. 0fa62fd6 adds one spec test. The rest change only this record and two StockChartCard.test.jsx assertions (now through the producer). So `git diff --name-only f4b1e40 HEAD` lists `docs/round3/chart.md`, `frontend/src/static/brief/StockChartCard.test.jsx` and `frontend/tests/static/brief-chart.spec.js`, and neither the probe nor the build reads any of them.
- So `probe-f4b1e40*.json` are the probes of this package's code. They are kept for CH-4.

### What changed

**`chartReadout.js`** (entry chunk)
- New exported `structuralLowLegend(value)`. It gives the legend's texts for the last contraction's low, longest first, each with the price `formatPrice` prints: `[['long', '最後の収縮の安値 xx'], ['short', '収縮の安値 xx'], ['tag', '安値 xx']]`. It gives null when the low is unknown, never a price of 0 or —.

**`StockChartCard.jsx`** (entry chunk)
- `legendItems`: the 'low' item keeps rank 1 (the first foldable item) and stays foldable.
  - Below 1024px it holds the three texts as `span.lg-form.lg-form-{long,short,tag}`.
  - At 1024px and wider it holds the full text only, as before (same DOM).
- `useTwoLineLegend`'s `fold()` places the items exactly as before with the full text. If the low ends hidden, it runs the whole placement again with 「収縮の安値 xx」 (`data-fit="short"`), and then with 「安値 xx」 (`data-fit="tag"`). If no text stays shown, it runs the full-text pass once more, so the legend is then exactly today's. The forms are `LOW_FALLBACK_FORMS`.
- The price is the same `formatPrice` value in every form.

**`brief-chart.css`**
- `.lg-form` is hidden by default. The item shows the full text without `data-fit`, and otherwise the form `data-fit` names.

**Unchanged**
- `priceChart.js`, `chartLabels.js` and so the SVG (byte-identical, below).
- The 注記: chartNotes keeps 「「安値」＝最後の収縮の安値 xx」.
- The legend at 1024px and wider, and the card height at every width.
- The legend is `aria-hidden`, so screen readers are unaffected. Its `textContent` now holds the three texts below 1024px. The readers outside CHART's files were checked (grep of `brief-legend`, `lg-structural`, `最後の収縮の安値` and `収縮の安値` over `frontend/tests`, `frontend/tools` and `frontend/src`):
  - `brief-compact.spec.js` and `tools/design-review.mjs` match `.brief-legend` by 「10週線」 only.
  - The H5 probe and dump read displayed text only (`getClientRects`, `innerText`).
  - None of them reads the low's text.

### Correction to the plan: the item stays foldable

The plan says to make 'low' unfoldable. That is unsafe:
- `useTwoLineLegend` places an unfoldable item that fits neither line on line 2 anyway, and the browser wraps a third line.
- Its trailing guard folds foldable items only, so it cannot take that line back.
- This breaks the plan's own gate (a 34px legend, the card height unchanged). It is likeliest beside the kept 「ピボット」/「損切り」 names and the long RS item.

Keeping it first among the foldable items, with measured shorter texts, gives the same result wherever a text fits, and it can never add a line.

### The fallback ladder, measured

The measurement is on the base code (24f1210), with a scratch spec (`audit3/r3-chart/measure/legend-measure.spec.js`, CI-faithful, port 4424) at 320×640, 375×812 and 390×844 over the default and oracle stocks and every period. `audit3/r3-chart/ladder-summary.mjs` reads it.
- The texts' widths, swatch included: full 142.375px, short 106.375px, 「安値 xx」 70.375px (prices 68.16 and 67.96; tabular figures).
- "Free" is the room left on the better line after the items that must stay. It uses the fold's own rule: `room + 0.5 − used − gap`.

| Width | Set | Views with the low item | Full text already shown | Needs a shorter text |
|---|---|---|---|---|
| 320 (room 262, gap 8) | default | 116 of 120 | 116 | 0 |
| 320 | oracles | 28 of 32 | 20 (ZZRD among them) | 8: ZZRL, ZZRW (their RS item) |
| 375 (room 317) | default | 116 of 120 | 116 | 0 |
| 375 | oracles | 28 of 32 | 26 | 2: ZZRL, ZZRW 週足 |
| 390 | both | 144 of 152 | 144 | 0 |

**Per view** (rung = the text shown after C3):

| View | Free | Full | 「収縮の安値 xx」 | 「安値 xx」 | Rung |
|---|---|---|---|---|---|
| ZZRL, ZZRW 3m/6m/1y at 320 (6 views) | 119.42 | 22.95 over | fits (13.05 spare) | fits | (2) 「収縮の安値 xx」 |
| ZZRL, ZZRW 週足 at 320 (2 views) | 87.42 | 54.95 over | **18.95 over** | fits (17.05 spare) | (3) 「安値 xx」 |
| ZZRL, ZZRW 週足 at 375 (2 views) | 142.42 | see below | fits | fits | (2) 「収縮の安値 xx」 |

- At 320 the daily periods' must-stay items are the averages' item (135.08px, line 1) and the RS line's meaning (231.42px, line 2). On 週足 the averages are three items (3 × 50.36 + 2 gaps = 167.08px).
- **Rung (3) is a disclosed deviation** (the order's step 3). At 320 週足 beside the RS item, 「収縮の安値 xx」 is 18.95px too wide for either line in both views. The tag's own name 「安値」 (the plot's tag reads 「安値」) fits there.
- **375 週足 is a fractional-pixel case** that the base already got wrong:
  - The full text passed the fold's +0.5 tolerance (167.08 + 8 + 142.375 = 317.45px against a 317px line), and the browser wrapped a third line.
  - The trailing guard then folded 「枠＝収縮」 and the low. The base state shows this: both hidden with their `order` set, and only the guard hides an item after placing it.
  - With C3 the full-text pass ends with the low hidden, so the short pass runs. 「収縮の安値 xx」 goes on line 1 and 「枠＝収縮」 fits line 2 again (231.42 + 8 + 48 = 287.42px).
  - So here the low's text brings another item back instead of folding one. The order's expected list did not name this case.
- Rung (4) (nothing fits, the item stays hidden) is reached in no fixture view.

### Gate (rule 16): expected diff against CH-1's probe, 実測

**Commands** (port 4424):

```
$H/probe/run-probe.sh <worktree> 4424            # → probe-f4b1e40.json          sha256 1127e3b8…bc62342
$H/probe/run-probe.sh <worktree> 4424 oracles    # → probe-f4b1e40-oracles.json  sha256 d2e88172…63d2a3
node $H/probe/diff.mjs $H/probe/probe-24f1210-oracles.json $H/probe/probe-f4b1e40-oracles.json --texts
```

**Result: the gate is green.**
- **Default probe** (492 label views + 480 value views): the sha256 equals probe-24f1210.json's (1127e3b8…bc62342). Every view is byte-identical, because the full text already showed wherever the item exists.
- **Oracle probe:** 20 of 264 views differ (0 → 0 page errors), and every one differs in `html` only. Unchanged in all 264 views: the SVG texts, boxes, masks, leaders, solids, aria, the chart and SVG boxes, and the card height.

| Width | Label views | Value views | The card text |
|---|---|---|---|
| 320 | 8: ZZRL, ZZRW × 3m/6m/1y/週足 | 8 | daily: +「収縮の安値 68.16」 (ZZRL) / +「収縮の安値 67.96」 (ZZRW), −「枠＝収縮」; 週足: +「安値 68.16」 / +「安値 67.96」, −「枠＝収縮」 |
| 375 | 2: ZZRL, ZZRW 週足 | 2 | +「収縮の安値 68.16」 / +「収縮の安値 67.96」, and +「枠＝収縮」 |
| 390 | 0 | 0 | — |
| 1440 | 0 | 0 | — |

- **Folded in the low's place:** only 「枠＝収縮」 (rank 6), in the 8 views at 320. The 注記 explains it: chartNotes keeps 「点線＝収縮の安値を結んだ線、枠＝値幅の収縮」. No other legend item changed state in any view.
- **Probe files:**
  - CH-1's `probe-24f1210.json` and `probe-24f1210-oracles.json` were deleted once this diff was recorded. Their sha256 stubs are in `audit3/r3-chart/`.
  - The probes of the reverted C5 commit (`probe-5437727*.json`) were deleted too.
- **Load:** the probe ran at 1-min load 4.80 → 7.93 → 7.55. The probe is not a timing.

## C5 (package CH-2): held. Implemented, measured, reverted

**Commits:**
- 5437727b `fix(frontend): print the readout's 対ピボット by the pivot-distance rule` implemented the order as written:
  - `chartReadout()` gained `pivotText = pivotDistanceText({ price: bar.close, pivot, distance: pivotRatio })`. `briefCandidate.js` was imported and not edited.
  - The Readout printed `readout.pivotText`.
  - It had tests at 1 cent over and under, at the pivot's cents with float noise, ordinary distances, and `formatPercent` ≡ `positionGeometry.signed` over a range.
- 02d820e1 reverts it, because the probe gate showed a card height change.
- 0fa62fd6 pins the case in brief-chart.spec.js.

**What the probe showed** (5437727 against f4b1e40, the same commands as above):
- **Default probe:** the sha256 is unchanged (1127e3b8…). No default fixture stock closes within 0.1% of its pivot off its cents. ZZNV and ZZKS print 「±0.0%」 at the cents, before and after.
- **Oracle probe:** 32 of 264 views differ, all ZZPG: 4 periods × 4 widths × labels and values. The text changes from 「+0.0%」 to 「+0.1%未満」.
  - At 320, 390 and 1440 that text is the only change (`html`).
  - **At 375 the card grows 508 → 524 on every period.** The chart and SVG boxes and every SVG text's screen position move down 16.00px. The SVG-internal texts are identical (`audit3/r3-chart/c5-375-detail.txt`).
  - 524 is past the spec's 520px cap (`CARD_CAP`), and the order says the card height must not change at any width.

**Why: the readout's second line has less spare room than 「未満」 needs**
- The in-band text is 24.00px wider than 「+0.0%」: 「未満」 measured in the readout's 12px font, and the figures are tabular. That is added to the second line (出来高 and its ratio | 対ピボット | 高値から), which wraps to a new 16px row when its slack is under 24px.
- The slack was measured with a scratch spec (`audit3/r3-chart/measure/readout-measure.spec.js`, on 5437727). Only ZZPG's text differs from the base there, so ZZPG's base slack is its measured slack + 24.

| Width | Second line's slack in the base, fixture views | With 「+0.1%未満」 |
|---|---|---|
| 320 | already 2 rows (−31.78 to −38.45) | ZZPG still 2 rows, card 476 unchanged |
| 375 | 16.55–23.64px (default 30 stocks: 16.55 min, 16.55 median, 23.64 max; oracles 16.55–23.22; ZZPG 21.87) | **every fixture stock would wrap: 0.36–7.45px short.** ZZPG wraps (2.13px short) and the card becomes 524 |
| 390 | 31.55–38.64px (ZZPG 36.88) | fits in every fixture view (≥ 7.55px spare) |
| 1440 | one line | fits |

So the order's text and "the card height at any width" cannot both hold. At 375, any stock whose close sits within 0.05% of its pivot and off its cents would take a fourth readout row. The fixtures have only ZZPG. The rebuild's PCRX, PFIS, TECH and LNTH are in the band (plan p4-6), so their 375 readouts would grow too (未検証 on real data).

**The decision is the conductor's.** Each option needs something this order does not grant:
1. **A narrower label in the band, below 1024px:** 「ピボット」 with the 「対」 kept for screen readers. This follows the same line's 「高値から」 with 「52週」 for screen readers. It saves about 12px (one character of the 12px font; not measured, while 「未満」 measured 24.00px for two), so the in-band item adds about 12px: on the measured slack it fits every fixture view at 375 (≥ 4.55px spare). This is a copy change in CHART's file.
2. **A narrower in-band text from the producer** (e.g. 「+<0.1%」). It needs `pivotDistanceText` in `briefCandidate.js` changed, which is not CHART's file and is shared with the rows.
3. **Accept +16px at 375 for in-band closes only.** It needs the "card height unchanged" rule waived and the spec's 520 cap raised.

- C5's code is ready: `git revert 02d820e1` re-applies 5437727b. Any option keeps 「±0.0%」 only at the cents and never prints 「+0.0%」/「−0.0%」.
- 0fa62fd6's spec (ZZPG at 375: the readout keeps 3 rows and the card 508 on every period) goes red on the as-ordered text by design. Under option 3 it is updated on purpose; under options 1 and 2 it stays as it is.

### CH-2 tests and checks (実測, at 3de9a0a9: the source of f4b1e404; 1-min load in parentheses)

**vitest** (`cd frontend && PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=… FINANCIAL_REPLAY_PYTHON=… npx vitest run <files>`)
- StockChartCard.test.jsx, chartReadout.test.js and briefCandidate.test.js (untouched): 3 files, **95 tests passed**.
- After the last commit (two StockChartCard.test.jsx assertions of the low's text now compare with `structuralLowLegend` instead of a literal), StockChartCard.test.jsx: 21 passed, eslint clean. The full suite was not re-run for it, since only that test file changed.
- What the tests cover for C3:
  - `legendItems` keeps 'low' at rank 1, foldable, with its three texts from `structuralLowLegend` below 1024px and the full one only at 1024px and wider.
  - A jsdom fold under mocked widths (a 300px legend; the averages' item on line 1 and the RS item on line 2): the full text fits → full; only the short one fits → short, shown; only 「安値 xx」 fits → tag; nothing fits → hidden, and every other item's state equals today's fold.
  - `structuralLowLegend`'s texts and its null for an unknown low.
  - The existing 「最後の収縮の安値」 assertions still pass.
- **The full suite:** 247 files, 3991 tests. 3990 passed and 1 timed out: `tools/export-market-trends.test.mjs` 「replays identical selected seed and manifest bytes from a foreign cwd…」 took 23.3s against its 20s limit (load 2.25 → 7.46).
  - Re-run once alone: 37 of 37 passed, the case in 13.7s (load 6.54 → 4.68).
  - The track touches nothing under `frontend/tools`.
  - The same suite on 0fa62fd6 (the same source) had passed whole: 3991 of 3991 (`audit3/r3-chart/vitest-full-0fa62fd.log`).

**Playwright** (CI-faithful, 4424, `npx playwright test -c audit3/r3-chart/pw-147.config.mjs`, one spec at a time). No re-run was needed.
- brief-chart.spec.js: **43 passed** (4.6 min; load 0.94 → 8.14). That is CH-1's 39 plus the three C3 tests (ZZRD, ZZRL, ZZNV at 320) and the ZZPG 375 readout test, including the 320 card-height, no-overflow and legend-colour tests.
- brief-oracles.spec.js: **38 passed, 2 skipped** (the R1 and R2 fixmes; file not edited). Load 9.26 → 3.36.
- brief-compact.spec.js and brief-phone.spec.js: **66 passed** (2.2 min; load 2.84 → 2.95).
- **The ZZPG pin with C5 re-applied** (`git revert --no-commit 02d820e1`, run with `-g 'ZZPG keeps the readout'`, then `git revert --abort`; the worktree is clean after): **1 failed**, 「ZZPG 3か月: readout rows」 expected ≤ 3, received 4. So the pin catches the as-ordered text.

**Other checks**
- eslint on StockChartCard.jsx (+test), chartReadout.js (+test) and brief-chart.spec.js: 0 errors, 0 warnings.
- Ownership gate before each commit: `OWNERSHIP OK (CHART)`.

**Entry chunk** (rule 21, `$H/build/run-build.sh <worktree>` → `build-3de9a0a.json`; load 1.13 → 1.31)
- `npm run build`: 130.38 kB gzip (24f1210, CH-1) → **130.60 kB gzip** (+0.22 kB; the line is 134.00). The track is +0.32 kB from STEP 0's 130.28.
- The design-acceptance build's entry: 372,644 → 373,134 raw bytes (+490); gzip -9 130,024 → 130,213 (+189).
- Every other chunk is byte-identical to CH-1's, the lazy priceChart chunk included.
- The C3 code is the legend's fold in the card shell (StockChartCard.jsx) and its texts (chartReadout.js), not chart drawing. It runs before the lazy chunk loads, so it stays in the entry chunk.
- Superseded outputs deleted: `snapshot/trees/24f1210` and `build/npm-build-24f1210`. `build-24f1210.json`, the 1 KB summary the deltas above cite, is kept.

### CH-2 未検証

- **The real-data acceptance** (CH-4): at 320, the low's price on the card in 13/13 rebuild stocks that draw the tag, in every period. **It is not assured.**
  - At 320 週足 beside the RS item, 「安値 68.16」 fit with 17.05px to spare. A price three characters longer (e.g. 1,234.56 against 68.16: two figures and a comma, about 18px) would reach rung (4), the item hidden.
  - The daily periods' 「収縮の安値 xx」 had 13.05px to spare, so two more figures would fall back to 「安値 xx」.
  - The rebuild's prices and RS items decide it.
- **The PCRX, PFIS, TECH and LNTH readouts:** C5 is held, so they print 「+0.0%」/「−0.0%」 as before.
- **The dump and heights harnesses** were not re-run.
  - Expected: no change, because the legend change is inside the card and the card height is unchanged in every probe view.
- **No timings were taken.** C3 can add at most three fold passes on a phone, only when the low's full text does not fit. Its cost is measured at integration with C1.

### CH-2 for the conductor and integration

- **C5 needs a decision** (options 1–3 in the C5 section above). Nothing outside CHART's files has been changed for it. Option 2 would need a change to `briefCandidate.js`, which is outside CHART's list.
- **No integration request for C3.** No file outside CHART's list needs a change. No test outside CHART's files reads the low's text.
- **The H5 oracle baselines** shift by the 20 views above (320 ZZRL/ZZRW, 375 ZZRL/ZZRW 週足; card text only). The default probe does not shift.
