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

### 未検証 (as of CH-1; the first two were measured in CH-4)

- **The real-data acceptance.** Forced 週足 lines at 390 should fall by the weekly notice lines (about 62 of 114 on the rebuild; 60 of 111 on the 39 CI-bar views). **Measured in CH-4:** see the next subsection.
- **The dump and heights harnesses** were not re-run in CH-1. **Measured in CH-4** (CH-4 section): the dump's ZZNV 週足 screens show the move and the 注記 count 6 → 7 at 375; phone chart cards are unchanged; the 1440 週足 card is +21.1875.
- **The 最新足 corner in the browser** (vitest only). Still 未検証.
- **No timings were taken.** C2 removes work from the label pass; any timing effect is measured at integration.

### Real-data acceptance (CH-4, 実測 at 57fdcd68; 11-12 rebuild counts, never the publication's)

**Commands** (port 4424; the tree is the `git archive` of 57fdcd68, clean):

```
$H/snapshot/run-snapshot.sh <worktree>              # → $H/snapshot/out/57fdcd6/
$H/build/run-build.sh <worktree>                    # → $H/build/build-57fdcd6.json (dist-t for the render)
$H/snapshot/run-render.sh <worktree> 4424 reduce    # → out/57fdcd6/render/{probe-reduce.json, readout/, counts-render.json}
node audit3/r3-chart/render-compare.mjs out/c61bf96/render/probe-reduce.json out/57fdcd6/render/probe-reduce.json
node audit3/r3-chart/render-card-classes.mjs <same two files>
```

- `render-compare.mjs` matches every SVG text by text, class and occurrence and compares every recorded field (box, forced, visibility, opacity, fill, contrast, layer, group). It also requires the view's other SVG fields to be identical: aria, chart size, plot, gridlines, tags, level lines, zone, legs, lows, dry-up note, RS, earnings, breakout, sells and gaps. The PNG path is left out, since it holds the out-dir name.
- Sanity: c61bf96 against 8849bf9 (the same code) gives 476 of 476 views identical.

**The order's counts (`counts-render.json`, 390, certified 週足 views):**

| Count | c61bf96 (STEP 0) | 57fdcd6 | Expected |
|---|---|---|---|
| `weekly_forced_390_certified` forced lines (40 views) | 114 | **29** | 114 − 62 = 52 |
| … weekly notice lines | 62 | **0** | 0 |
| … all notice lines | 85 | **0** | — |
| `weekly_forced_390_ci_bars` forced lines (39 views) | 111 | **29** | 111 − 60 = 51 |
| … weekly notice lines | 60 | **0** | 0 |
| … all notice lines | 82 | **0** | — |
| views with a forced weekly notice (CI bars) | 30 of 39 | 0 of 39 | 0 |

**The fall is 23 lines (22 on CI bars) larger than the weekly notice lines. Every one of the extra lines is the remaining notice 「収縮は未確認」 returning to a candle-free spot.**
- The remaining notice block is now one line instead of three or four, so the placer finds it a clear spot.
- The 23 certified views are AMAL, BB, BWIN, CEPO, CZFS, DRI, FCNCA, FMAO, GLBE, HAFC, HTFL, IDT, LARK, LTC, NBTB, OPK, RNW, SIG, SONO, SWKS, TECH, WSFS and WSM. BB is the one proxy-bar view, so 22 are on CI bars.
- The 8 unverified symbols (BHB, DSGR, EMR, EQH, GEO, HCI, IQV, NATL) gain the same at 390. They are outside the certified count.
- The non-notice forced labels are the same set in every certified 週足 view at 390: 29 before, 29 after, with the same texts.

**Gated claim 「no other label changes position」: held, with no exception.**
- **357 non-週足 views** (3 periods × 48 at 320, 48 at 390 and 23 at 1440) are identical in every SVG field and every text.
- **All 119 週足 views differ.** The only differences are the removed weekly notice texts and the box of the remaining 「収縮は未確認」 (78 views).
  - Removed: 「2年分はありません」 in 119 views (78 forced); 「週足は直近N週分（YYYY/MM〜）。」 in 71 (39 forced); at 320 the split pair 「週足は直近N週分」 + 「（YYYY/MM〜）。」 in 48 (39 forced).
  - 「収縮は未確認」 moved in 78 views and went from forced to clear in 61 of them (30 at 320, 31 at 390). The other 17 moved without being forced, before or after (4 at 320, 4 at 390, 9 at 1440).
  - Other labels: **0 moved, 0 newly forced, 0 un-forced, 0 missing, 0 added.**
- **Forced texts over all 476 views:** 637 → 381 (−256): 195 removed forced weekly lines, plus 61 「収縮は未確認」 no longer forced. No view's forced count rose.
- **Card side** (outside the SVG; not part of this gate):
  - `card_h` differs only in the 23 週足 views at 1440: +21, the C2 sentence in the card's notes.
  - The `notes` field differs in all 476 views. It reads every `.brief-note` of the screen, so it carries C4's VCP-card line, and on 週足 it loses the in-plot 「週足は直近…」. Nothing else in it differs.
  - `legendItems`/`legendHidden` differ through C3 (see C3).

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

### C5 real-data read (CH-4, 実測 at 57fdcd68; 11-12 rebuild; C5 still held)

**No decision on C5 reached this package, so the readout code is STEP 0's.** The order's 「readout_zero_rendered 4 → 0」 therefore does not hold.
- `counts-render.json` `readout_zero_rendered`: **4 → 4** (LNTH, PCRX, PFIS, TECH; 3m, 6m and 1y at 390). This is identical to c61bf96.
- `counts.json` `readout_zero_mismatch`: 4, identical to c61bf96.

**Command:** `node audit3/r3-chart/c5-readout.mjs out/57fdcd6/bundle.mjs out/57fdcd6`.
- It sets the rendered readout's 対ピボット (the render probe, 390, every period) beside `pivotDistanceText` of the stock screen's view for the same row. The view's price, pivot and distance come from `work/sell-eval.jsonl`, the harness mirror of StockView.
- The output is identical to the same script on c61bf96.

| Row | Close / pivot | Verdict (`pivotDistanceText`) | Readout at 390, 3m / 6m / 1y / 週足 | Equal |
|---|---|---|---|---|
| PCRX | 36.46 / 36.45 | 「+0.1%未満」 | 「+0.0%」 ×4 | 0 of 4 |
| PFIS | 72.85 / 72.87 | 「−0.1%未満」 | 「−0.0%」 ×4 | 0 of 4 |
| TECH | 72.84 / 72.83 | 「+0.1%未満」 | 「+0.0%」 ×4 | 0 of 4 |
| LNTH | 101.25 / 101.27 | 「−0.1%未満」 | 「−0.0%」 ×4 | 0 of 4 |

- The weekly readout prints the same 「±0.0%」 forms, because the last week's close is the last session's close. counts-render does not count 週足, so the weekly column is read from the probe here.
- **The width question is now on real data too.** These four are the rebuild's in-band rows, so under the as-ordered text their 375 readouts would take the extra 24px. The render probe has no 375 views, so whether they wrap is **未検証**.

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

### CH-2 未検証 (as of CH-2; the real-data acceptance was measured in CH-4, next subsection)

- **The real-data acceptance** (CH-4): at 320, the low's price on the card in 13/13 rebuild stocks that draw the tag, in every period. **It is not assured.** CH-4 measured it: 12 of 13 in every period, and HUM in 2 of 4.
  - At 320 週足 beside the RS item, 「安値 68.16」 fit with 17.05px to spare. A price three characters longer (e.g. 1,234.56 against 68.16: two figures and a comma, about 18px) would reach rung (4), the item hidden.
  - The daily periods' 「収縮の安値 xx」 had 13.05px to spare, so two more figures would fall back to 「安値 xx」.
  - The rebuild's prices and RS items decide it.
- **The PCRX, PFIS, TECH and LNTH readouts:** C5 is held, so they print 「+0.0%」/「−0.0%」 as before.
- **The dump and heights harnesses** were not re-run.
  - Expected: no change, because the legend change is inside the card and the card height is unchanged in every probe view.
- **No timings were taken.** C3 can add at most three fold passes on a phone, only when the low's full text does not fit. Its cost is measured at integration with C1.

### C3 real-data acceptance (CH-4, 実測 at 57fdcd68; 11-12 rebuild counts, never the publication's)

**Commands** (the same snapshot, build and render as C2's CH-4 subsection; port 4424):
- `counts-render.json` → `low_legend_hidden_320`.
- `render-compare.mjs` / `render-card-classes.mjs` → the legend fields per view.
- The harness render probe records neither the form shown (`data-fit`) nor the legend's height. A scratch copy of render-probe.mjs reads them instead, with the same navigation and settling, the same server and the same CI setup:
  ```
  audit3/r3-chart/c3-legend/run-legend.sh 57fdcd6 4424 c3-legend/targets-320-390.json c3-legend/out-57fdcd6   # 384 views, 0 errors
  node audit3/r3-chart/c3-legend/analyse-legend.mjs c3-legend/out-57fdcd6/legend-reduce.json out/57fdcd6/render/probe-reduce.json
  ```
  - It reads each legend item's key, fold, rank, `data-fit`, `hidden`, order and box, plus the legend's height and its distinct line tops.
  - For the low item it also reads the width of each of the three texts, in a hidden clone inside the card, and the room the fold's own rule leaves beside the items that must stay.
  - Its card heights equal the harness render probe's in 384 of 384 views.

**`low_legend_hidden_320`:** 13 stocks draw the 安値 tag at 320, in all 4 periods each. They are ADI, BMO, CFBK, CTKB, HUM, LCNB, MGRC, NDSN, PCRX, PRGS, PRTH, RDNT and RMBI.
- Hidden in every period: **13 → 0**.
- **Hidden in some period: HUM only, in 1y and 週足.**
- So the low's price is on the card in **12 of 13 stocks in every period**, and in HUM's 3m and 6m. The plan's 13/13 is **not met for HUM's 1y and 週足.**

**Which text each 320 view shows** (52 views with the low item; c61bf96: hidden in all 52):

| Text | Views | Where |
|---|---|---|
| 「最後の収縮の安値 xx」 (long) | 0 | — (on the rebuild the full text never fits at 320) |
| 「収縮の安値 xx」 (short) | 38 | the 3 daily periods of 12 stocks, and HUM's 3m and 6m |
| 「安値 xx」 (tag) | 12 | 週足 of the 12 stocks other than HUM |
| hidden (rung 4) | 2 | HUM 1y, HUM 週足 |

**HUM's two views, measured** (price 434.09; the 320 legend's room is 262px with an 8px gap, and the fold allows +0.5):
- The texts are 149.05px (long), 113.05px (short) and 77.05px (「安値 434.09」), swatch included.

| View | Items that must stay (px) | Free on the better line | Shortfall of 「安値 434.09」 |
|---|---|---|---|
| HUM 1y | line 1: 「50 150 200日線」 135.08 + 「ピボット」 61; line 2: the RS item 231.42 | 50.42 | **26.63px** |
| HUM 週足 | line 1: 「10週線」「30週線」「40週線」 3 × 50.36 + 「ピボット」 61; line 2: the RS item 231.42 | 23.08 | **53.97px** |

- 「ピボット」 is a kept (unfoldable) item for HUM. With it, no text of the low's fits either line.
  - A price-only text would be about 53px, which would still miss both views.
  - So this is the plan's 「If two lines cannot hold it, the item does not ship and the measured overflow is reported」 for these two views. No code was changed for it.

**What folds in the low's place at 320 on the rebuild** (`node audit3/r3-chart/legend-fold-320.mjs out/c61bf96/render/probe-reduce.json out/57fdcd6/render/probe-reduce.json`: `legendHidden` at 320, before and after, with the low item left out):
- **In all 50 views where the low now shows, 「上抜け」 (the breakout arrow's key, rank 2) is newly folded.**
- **「枠＝収縮」 (rank 6) is newly folded too in the 38 daily-period views.** On 週足 it was already folded.
- No other item changed state, and no item came back.
- This differs from the fixture gate, where only 「枠＝収縮」 folded (ZZRL, ZZRW).
- It is the fold's rank order working as designed: the low keeps rank 1, as at base, and the arrow is rank 2.
  - Both folded items stay explained in the 注記: 「緑の矢印＝…」/「灰色の矢印＝…」 for the arrow, and 「点線＝収縮の安値を結んだ線、枠＝値幅の収縮」.
  - But it means **the 320 legend trades the breakout arrow's key for the low's price** in these 50 views. That is a priority call for the conductor (see "For the conductor (CH-4)").

**Gate on the rebuild:**
- **No legend is taller than two lines:** 192 of 192 views at 320 and 192 of 192 at 390 show 2 line tops and a 34px legend.
- **Card heights identical to c61bf96's histogram:** 320 {489: 95, 505: 61, 521: 36}; 390 {508: 192}.
- **The SVG is identical** in every non-週足 view, as C2's subsection shows. 週足 views differ only by C2's notice.

**Also at 390** (the ladder runs below 1024px; the order did not list this). HUM 1y and HUM 週足 had the low hidden at 390 before. Now they show it:
- 1y shows 「収縮の安値 434.09」; 「損切り」 and 「枠＝収縮」 fold instead.
- 週足 shows 「安値 434.09」; 「枠＝収縮」 folds instead.
- Both stay two lines and 508px. This is the low's rank 1 (first foldable) doing what it is for. Every other 390 view shows the long text, and its legend differs only in the item's `textContent`, which now holds the three spans. (options 1–3 in the C5 section above). Nothing outside CHART's files has been changed for it. Option 2 would need a change to `briefCandidate.js`, which is outside CHART's list.
- **No integration request for C3.** No file outside CHART's list needs a change. No test outside CHART's files reads the low's text.
- **The H5 oracle baselines** shift by the 20 views above (320 ZZRL/ZZRW, 375 ZZRL/ZZRW 週足; card text only). The default probe does not shift.

## C4 (package CH-3): the Setup Engine pivot's own day and the quiet days on the VCP card

**Commits**
- 08bebfc7 `feat(frontend): name the Setup Engine pivot's own day and quiet days on the VCP card`: the code and tests.
- ff4349b2 `test(frontend): assert the VCP card's pivot-day and quiet-day lines through their producers`: tests only.
  - The render tests, the oracle tests and the spec no longer retype 「ピボット $…＝…の高値（SE）」 or 「静かな日 N/10日（SE）」. They compare with the producers, or check only the parts each case is about.
  - The producers' own unit tests keep one pin of each form, as `structuralLowLegend`'s does.
- Source files: `git diff --name-only 503102fd..HEAD -- frontend/src ':!*.test.*'` lists only `StockVcpCard.jsx` and `brief-chart.css`.
- `priceChart.js`, `chartLabels.js`, `PriceChart.jsx` and `StockChartCard.jsx` are untouched, so the SVG and the chart card are unchanged.
- pivotBar.js, briefCandidate.js, StockView.jsx, brief-fixture.js and brief-oracles.spec.js are untouched.

### What changed (StockVcpCard.jsx)

**`pivotDayNote({ view, row, judged, date })`** returns a string or null.
- **No line (null)** unless all three hold:
  - `view.pivot` is finite;
  - `row.se_pivot_price` is finite and equals `view.pivot` in whole cents, so a vcp_pivot fallback or another price shows nothing;
  - the recalculation is current: `setup_recalculation.status === 'calculated'` and `as_of_date === date`.
- That test is now one function, `setupCurrent`, shared with `engineBase`. engineBase's behaviour is unchanged.
- **The dated line:** the bar is `pivotBar(judged, row)` (H1) on the certified bars, and null when `judged` is null. The line reads 「ピボット $48.50＝9/22の高値（SE）」, with the card's own `money` and `shortDate` (M/D; the year only when it is not the analysis date's year).
  - It adds 「（週足の型）」 when `PIVOT_TIMEFRAMES[se_pattern_primary] === 'weekly'`, read through `Object.hasOwn`.
- **No bar** gives 「ピボットの日 未確認」 (`PIVOT_DAY_UNKNOWN`). The cases: no `se_pivot_date`, a pattern outside the table, no bar whose high is the pivot in cents, or bars not certified.
  - `se_pivot_date` itself is never printed, and nothing is guessed.
- **Where it shows:** a `<p className="brief-note brief-vcp-pivotday">` directly under the 「Setup Engine：土台…」 note.
  - 「（週足の型）」 is its own inline-block span, so a wrap at 320 moves it whole.
  - Nothing renders while `pending` is true: the detail that carries the date has not arrived, which is loading, not 未確認.

**`quietDaysText(row, date)`**
- It returns 「静かな日 N/10日（SE）」 only when the recalculation is current (the same test) and `se_quiet_days_10d` is an integer from 0 to 10.
- A real 0 prints 0/10. A missing, fractional, out-of-range or string value prints nothing: absent, never 0.
- `QUIET_DAYS_WINDOW = 10` is the field's own window (backend/app/analysis/patterns/readiness.py `quiet_days_window=10`, field `quiet_days_10d`). It is not a threshold of the brief's.
- **Where it shows:** a second `<small className="brief-vcp-quiet">` in the 「当日の出来高」 dd, on its own line (CSS `display: block`). It also shows when the day's volume ratio is 未確認.
- **Its title** (`QUIET_DAYS_TITLE`) is worded from what readiness.py computes:
  - the title: 「直近10営業日のうち、出来高がその日までの50日平均の0.8倍未満で、かつ真の値幅がその日の14日ATR未満だった日の数（Setup Engineの計算）」;
  - the code: `quiet_day_mask = volume < volume_sma(50) × 0.8 & true_range_pct < atr14_pct`, summed over the last 10 bars.
  - Checked: no caller overrides the defaults. `SetupEngineScanner` (setup_engine_screener.py:240) calls `compute_breakout_readiness_features(price_data, pivot_price=…, benchmark_close=…)`, and `frontend/tools/recalculate-setups.py` runs that scanner.
- **No in-plot or axis mark.**

**brief-chart.css:** two rules, scoped to the new elements (`.brief-vcp-pivotday .brief-vcp-weekly`, `.brief-dl dd small.brief-vcp-quiet`).

**Corrections to the plan, as ordered:**
- ZZHB's line names **9/22**, the Tuesday whose high is the pivot. 9/25 is the Friday label, and 9/28 is the crossing day of the verdict's 「9/28に上抜け・4営業日前」, which this line does not repeat.
- Every stock whose screen pivot is a current Setup Engine pivot with no matching bar gains 「ピボットの日 未確認」, default fixture stocks included. The default rows carry no `se_pivot_date`. See the dump below.

### Gate

- **Rule 16 (the 492-view probe) does not list StockVcpCard.jsx, so no probe was run.** CH-4 proves the chart card byte-identical. The chart card's height is unchanged in all 36 measured oracle views below.
- **Copy through its producer:** the spec and the oracle tests evaluate `pivotDayNote`/`quietDaysText` on the fixture's rows and bars. The spec takes the screen's pivot from `candidateView`, as the frozen brief-oracles.spec.js `viewOf` does.

### Acceptance on the rebuild (実測, no browser; rebuild counts, never the publication's)

- **Command:** `node audit3/r3-chart/c4-rebuild/c4-rebuild.mjs <SNAP bundle> <vcp bundle> $H/snapshot/out/c61bf96 <STEP 0 h1-check.json> <out>`.
  - The VCP producers are esbuild-bundled (jsx loader) from the worktree's StockVcpCard.jsx, at the source of 08bebfc7, which is HEAD's.
  - The screen's view comes from `rankCandidates` → `candidateView`, and the bars from `certifyBars` on serve/charts, as the stock screen takes them.
  - The cross-check is STEP 0's h1-check (pivotBar on ready43's own fields).
  - Output: `audit3/r3-chart/c4-rebuild/c4-rebuild-08bebfc.{json,log}`.
- **The 30 CI-bar ready rows:**
  - 30/30 show a dated line, and the date equals H1's bar in all 30.
  - In all 30, the dated bar's high equals the pivot in cents. **0 are 未確認.**
  - SWKS reads 「ピボット $89.88＝9/28の高値（SE）（週足の型）」 (9/28, not the label 10/2).
  - Weekly patterns: 24/24 carry 「（週足の型）」. The 6 nr7_inside_day rows carry none.
  - 「静かな日 N/10日（SE）」: 30/30, with N from 1 to 9.
- **All 37 ready rows:** 「静かな日 N/10日（SE）」 shows for **37/37**.
- **The 7 bundle-envelope-proxy rows** show the line in all 7.
  - BB is certified and dated: 10/12, with 「（週足の型）」.
  - The 6 uncertified rows read 「ピボットの日 未確認」, because their bars are not certified: EMR, EQH, IQV, GEO, BHB, DSGR. STEP 0's H1 check found a bar for each on its own bars, so this is the certification rule, not a missing pivot bar.
- **No CI-bar row differs from the expectation.**

### Heights (実測, CI-faithful, 4424, oracles: true, reduced motion, settled)

- **Command:** a scratch spec `audit3/r3-chart/measure/c4-heights.spec.js`, measuring as STEP 0's oracle heights do (content = the bottom of `#brief-main .brief-stack`).
- **Before:** at 503102f, CH-2's head, without C4. These equal STEP 0's §4 table exactly.
- **After:** at 08bebfc7, the same source as HEAD.
- Load: before not recorded; after 3.65 → 5.22.

| Stock screen content | 320 | 375 | 390 |
|---|---|---|---|
| ZZNV | 3308 → 3338 (+30) | 3044 → 3075 (+31) | 2954 → 2985 (+31) |
| ZZHB | 2476 → 2527 (+51) | 2348 → 2379 (+31) | 2330 → 2361 (+31) |
| ZZRD | 2621 → 2686 (+65) | 2496 → 2543 (+47) | 2496 → 2543 (+47) |

| VCP card | 320 | 375 | 390 | 1440 |
|---|---|---|---|---|
| ZZNV (未確認) | 459.9 → 490.3 | 422.1 → 452.5 | 422.1 → 452.5 | 434.7 → 467.1 |
| ZZHB (9/22, weekly) | 349.5 → 400.3 | 311.7 → 342.1 | 311.7 → 342.1 | 252.3 → 284.7 |
| ZZRD (未確認 + 静かな日 2) | 490.3 → 555.5 | 452.5 → 500.3 | 452.5 → 500.3 | 467.1 → 517.5 |

- **Why the heights grow:**
  - The pivot line adds one 12px note line, about +30px.
  - At 320, ZZHB's line wraps once: 「（週足の型）」 moves whole to the second line.
  - ZZRD adds the quiet-days line: +17px at 375/390. At 320 「（SE）」 wraps under 「静かな日 2/10日」 in the half-width dd, as 「上抜けの目安 1.40×以上」 already does. That is the +65 at 320.
- **1440:** the stock screen's content and page heights are unchanged (1832/1864); the card grows inside the scrolling pane.
- **Other oracle stocks:** +30 or +31 at 375. The largest at 375 is ZZNV, 3075: under the plan's 3388 line for the stock screen and brief-compact.spec.js's `BUDGET.stock` (3400, content height).
- **Every view:** horizontal overflow 0, no page errors, chart card height unchanged.
- Screenshots of the VCP card for ZZRD, ZZHB and ZZNV at 320/375/1440: `audit3/r3-chart/measure/shots-ff4349b/`.

### The dump (実測, `$H/dump/run-dump.sh <worktree> 4424` → `dump-ff4349b.json`; load 1.37 → 1.18)

- **Compared with dump-8849bf9:** `python3 -I audit3/r3-chart/dump-compare.py dump-8849bf9.json dump-ff4349b.json` → `audit3/r3-chart/dump-compare-8849bf9-ff4349b.txt`.
- **18 screens are identical:** every 375 list, watch, Today and market screen, and 1440 market.
- **24 differ**, and in each the only text added by C4 is 「ピボットの日 未確認」 (the default rows have no `se_pivot_date`):
  - the 6 stock screens at 375 and the 6 at 1440;
  - 1440's 4 lists × 2 watchlists, Today × 2 and watch × 2, whose right pane shows a stock.
- **ZZNV 週足** also shows C2's move: the in-plot 「週足は直近58週分（2025/08〜）。」「2年分はありません」 become the 注記 sentence 「週足は2025/08〜の58週分（2年分はありません）」, and the 注記 count goes from 6 to 7 at 375. Nothing from C3 shows at 375 or 1440.
- **375 stock screen content:**
  - ZZAR 2488 → 2518
  - ZZHW 2591 → 2621
  - ZZNV 3044 → 3075, and 週足 3044 → 3075
  - ZZSD-broken 2615 → 2646
  - ZZZF 2567 → 2597
- **1440:** no page or content height changes.
- **So the H5 dump baseline shifts on these 24 screens.**

### Tests and checks (実測)

**Earlier session**
- This session resumed after the usage-limit cut-off. These ran on 08bebfc7 before the cut-off (logs in `audit3/r3-chart/`, 15 Nov ~01:00–01:19 UTC, after the 00:58 commit). The source is HEAD's.
- No re-run is visible in the logs. Whether a run was repeated before its log was written is not known.
- brief-chart.spec.js: 47 passed (4.6 min; load 4.51 → 7.69).
- brief-oracles.spec.js (frozen, not edited): **38 passed, 2 skipped** (the R1/R2 fixmes; load 7.87 → 9.77). ZZHB's green arrow and every other active assertion stay green.
- brief-compact.spec.js + brief-phone.spec.js (frozen height budgets): **66 passed** (load 9.78 → 5.42).
- brief-accessibility.spec.js + brief-rows.spec.js: 68 passed (10 + 58; load 4.30 → 3.31).
- Full vitest: 248 files, 4007 passed (load 2.87 → 4.52).

**This session, on ff4349b2**
- vitest (`cd frontend && PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=… FINANCIAL_REPLAY_PYTHON=… npx vitest run <files>`):
  - StockVcpCard.test.jsx, StockVcpCard.oracles.test.jsx, StockView.test.jsx and pivotBar.test.js (untouched): **4 files, 41 tests passed** (load 0.64 → 0.83). The two C4 files were re-run after the test edits: 23 passed.
  - **The full suite: 248 files, 4007 passed** (load 2.60 → 7.06). CH-2 had 247 files and 3991 tests; +16 are C4's (12 in StockVcpCard.test.jsx, 4 in the oracle file).
- Playwright (CI-faithful, `npx playwright test -c audit3/r3-chart/pw-147.config.mjs`, AUDIT_PORT=4424). No re-run was needed.
  - brief-chart.spec.js, whole: **47 passed** (4.1 min; load 0.60 → 2.98). That is CH-2's 43 plus C4's 4: ZZHB, ZZNR and ZZRD at 390, and ZZHB at 1440.
  - Each C4 test checks four things:
    - the line equals `pivotDayNote` on the fixture row and bars, with ZZHB naming 9/22 and not 9/25, ending 「（週足の型）」;
    - ZZNR names the day before the analysis day, with no suffix;
    - ZZRD shows `PIVOT_DAY_UNKNOWN`, and its quiet days equal `quietDaysText`, with the title;
    - no overflow and no page errors.
  - **The other stock-screen specs, track R's and the rest:** brief-fundamentals, brief-decision, brief-plan, brief-flow, brief-sell, brief-invariants, brief-freshness, brief-watch and brief-legacy-redirects, one invocation (8.1 min; load 5.38 → 6.03). **179 of 180 passed, 1 failed:**
    - `brief-decision.spec.js:269` 「a breakout still in the zone 25 sessions on that stalls waits for the next pivot, its tiles 参考」 at 375×812, line 281: content **3145**, against `STOCK_CAP` = 3056 + 80 − 12 = **3124**.
    - Re-run alone: the same, 3145 against 3124 (load 3.38 → 3.51). It is a layout height, not a timeout.
    - With C4's source reverted (`git checkout 503102fd -- StockVcpCard.jsx brief-chart.css`, then restored to HEAD), both cases of that loop pass. The pre-C4 height is derived, not measured: about 3114–3115, which is 3145 less the 30–31px the line adds on every 375 stock screen in the dump. So the state had about 9–10px of slack, and the line takes 30–31px.
    - The other case of the loop (「was pulled back to the pivot after a run」) and every other `STOCK_CAP`/`STOCK_LINE` check in the nine specs pass.
    - Logs: `audit3/r3-chart/pw-ch3b-others.log`, `pw-ch3b-decision-rerun.log`, `pw-ch3b-decision-preC4.log`.
- eslint on StockVcpCard.jsx, StockVcpCard.test.jsx, StockVcpCard.oracles.test.jsx and brief-chart.spec.js: clean.
- Ownership gate before each commit: `OWNERSHIP OK (CHART)`.

**What the vitest cases cover**
- Weekly: the Tuesday bar, not the Friday label, plus the suffix.
- Daily: the se_pivot_date bar, no suffix.
- A float-noise pivot (89.88000000000001) matches.
- The year shows across a year end.
- 未確認 for: a VCP primary without a date, a high one cent short, `judged` null, an unnamed pattern, and no pattern.
- No line for:
  - a vcp_pivot fallback or another price;
  - no view or no row;
  - a stale, failed or missing recalculation, or no date;
  - `pending`.
- Quiet days: 2, 0 and 10 show; undefined, null, 2.5, 11, −1, '2', NaN and Infinity show nothing; a stale or unavailable recalculation shows nothing.
- The rendered card: the note follows the Setup Engine note, the weekly span, the `<small>` with its title, and the 未確認 volume ratio. An older publication gives 未確認 and no quiet days. The other rows are unchanged.
- **The data path:** `mergeFinancialDetail(summary without the keys, detail with them)` keeps `se_pivot_date` and `se_quiet_days_10d` on the merged row. A detail of another day leaves them absent.

### Deviations from the order

- **One extra test file, `StockVcpCard.oracles.test.jsx`, with `// @vitest-environment node`.**
  - vitest cannot import `tests/static/brief-fixture.js` under jsdom: 「TypeError: The URL must be of scheme file」. That was measured here with a temporary test, then deleted.
  - So the ZZHB, ZZNR and ZZRD cases read `ORACLE_ROWS`/`ORACLE_CHARTS` in a node-environment file beside the jsdom one.
  - The ownership gate accepts it as one of the StockVcpCard tests.
- **ff4349b2** brings the tests to the track's producer-only rule (as 8edf27ca and 503102fd did for C2 and C3). The order's expected strings are kept as the producers' unit-test pins.

### 未検証

- **The detail-only path in a browser.** The oracle rows carry both keys on the list row itself. The detail merge is covered only by the `mergeFinancialDetail` vitest and by reading the code: export-research.mjs `listFields` omits both keys, and the detail is the whole row.
- **Whether a published research detail carries `se_pivot_date` and `se_quiet_days_10d`.** Not checked until a release is read; no production action was taken.
- **The entry-chunk delta.** StockVcpCard.jsx now imports pivotBar.js, which no production module imported before, so it joins the entry chunk. No build was run in CH-3. **CH-4 measured it** (CH-4 section): +0.84 kB gzip over CH-2.
- **Timings.** None were taken.
- **brief-market.spec.js and brief-market-phone.spec.js** were not run. Neither opens a stock screen, and the dump's market screens are identical.
- **The headroom left in the other `STOCK_CAP` states** of brief-decision.spec.js (they pass) was not measured.

### C4 on the rendered rebuild screen (CH-4, 実測 at 57fdcd68; 11-12 rebuild)

- **Command:** the CH-4 render, with `notes` read from `out/57fdcd6/render/probe-reduce.json`. That field reads every `.brief-note` of the screen, so it carries the VCP card's pivot-day line. A scratch read compared it with CH-3's no-browser `c4-rebuild-08bebfc.json`.
- **All 37 ready rows are among the rendered stocks.** In **352 of 352** of their views (296 on CI bars, 56 on proxy bars; 320/390/1440 × 4 periods), the rendered line equals CH-3's producer read. Examples:
  - SWKS 「ピボット $89.88＝9/28の高値（SE）（週足の型）」;
  - ADI 「ピボット $415.18＝10/13の高値（SE）（週足の型）」;
  - BB 「ピボット $8.86＝10/12の高値（SE）（週足の型）」;
  - EMR 「ピボットの日 未確認」 (bars not certified).
- **The detail-only path is still not exercised.** The rebuild's `serve/research.json` is full rows: `se_pivot_date` is on 4,421 of 5,955 rows, and SWKS carries `se_quiet_days_10d` 3. So the render reads both keys from the row itself, and the probe's 404 for every other path never stands in for a detail.
  - The published detail-only path stays **未検証**, as above.
  - The quiet-days text is not in the probe's `notes` filter, so it was not read from the render. CH-3's 37/37 is the producer read.

### For integration

- **Vocabulary for CONTEXT.md:**
  - 「ピボットの日」: the bar whose high is the Setup Engine pivot, found by pivotBar (H1) on certified bars; 未確認 when there is none.
  - 「静かな日」: the Setup Engine's `quiet_days_10d` over its own 10 sessions.
- **Both fields are detail-only on a publication.** While the detail loads, no pivot-day line shows. When the detail fails, or on an older publication without the keys, the card reads 「ピボットの日 未確認」 and shows no quiet days. It never shows 0 or a guessed date.
- **The H5 baselines shift:**
  - the dump on the 24 screens above;
  - the oracle stock heights, as in the table;
  - 375 stock screens +30 or +31, ZZRD +47.
- **Integration request: brief-decision.spec.js `STOCK_CAP` (track R's file; a decision for the conductor).**
  - C4's line makes `brief-decision.spec.js:269` (the 'stalls' case) fail at 375: 3145 against 3124 (see Tests and checks).
  - It shows only where C4 and R's spec meet, at integration; R's branch does not have C4.
  - The cap is 「verdict's +80 over step 0」 less 12px of headroom. C4's line, about 31px, is not in that allowance.
  - **(a)** Track R or integration raises `STOCK_CAP` by C4's measured 31px (3124 → 3155). The frozen budgets (brief-compact.spec.js `BUDGET.stock` 3400, `STOCK_LINE` 3388) are not reached.
  - **(b)** Hold C4: `git revert ff4349b2 08bebfc7` (tests, then code); this record stays.
  - **(c)** Another placement for the line, which needs a new order. No placement in CHART's files fits about 9px for a text line.
  - Nothing outside CHART's list was edited.
- **For CH-4:** this failure is known, and it is C4's. It is not a regression of C1–C3.

## CH-4: the pre-C1 checkpoint

**P = 57fdcd686ac27f9b2992ceee109e34b9d871972c** (`57fdcd68 docs(round3): record the brief-decision STOCK_CAP failure C4 causes and the budget wording`). It is CH-3's head.
- **No code was changed in this package.** No check exposed a defect in CHART's files that a fix in them could remove (see "For the conductor").
- So every measurement below is from P. Outputs are named `57fdcd6`.
- The only commit after P is this record. `git diff --name-only 57fdcd68..HEAD` lists `docs/round3/chart.md` only, so P stays the pre-C1 head for C1's purposes.
- **Load:** the 1-min load average is in parentheses, before → after. The machine was shared with another track and another workflow. No figure here is a timing.

### STEP 1: suites (実測 at P)

- **Full vitest:** `cd frontend && PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=… FINANCIAL_REPLAY_PYTHON=… npx vitest run`.
  - **248 files, 4007 tests passed** (260 s; load 4.73 → 5.15). That is STEP 0's 247/3983 plus this track's 1 file and 24 tests.
  - Log: `audit3/r3-chart/vitest-full-57fdcd6.log`.
- **Full static Playwright, CI-faithful:** `cd frontend && PATH=/opt/node22/bin:$PATH FONTCONFIG_FILE=…/ci-fonts/fonts.conf AUDIT_PORT=4424 npx playwright test -c audit3/r3-chart/pw-147.config.mjs` (no AUDIT_MATCH).
  - **456 tests: 453 passed, 2 skipped, 1 failed** (25.2 min; load 4.44 → 12.83). No re-run was needed for a timeout.
  - **The 2 skips** are track R's `test.fixme('R1: …')` and `test.fixme('R2: …')` in brief-oracles.spec.js. They are the only fixme/skip in `tests/static`. Every active brief-oracles assertion passed, ZZHB's green arrow included.
  - **The failure is the known one, C4's** (C4 section, "For integration"): `brief-decision.spec.js:269` 「a breakout still in the zone 25 sessions on that stalls waits for the next pivot, its tiles 参考」 at 375×812, line 281, content **3145** against `STOCK_CAP` **3124**.
    - Re-run alone (`… playwright test -c … tests/static/brief-decision.spec.js -g 'stalls waits for the next pivot'`): the same 3145 against 3124 (load 11.71 → 11.66). It is a layout height, not a timeout.
    - No other spec failed, including brief-market.spec.js and brief-market-phone.spec.js, which CH-3 had not run.
  - So the order's 「0 failures」 does not hold at P. The cause is the open C4 × `STOCK_CAP` decision, not C1–C3.
  - Log: `audit3/r3-chart/pw-full-57fdcd6.log`; re-run: `pw-decision-rerun-57fdcd6.log`.
- **Lint:** `npm run lint` → **0 errors, 4 warnings** (the base's four: App.jsx, StockDetails.jsx, MetricInfoPopover.jsx, StaticMarketContext.jsx). Load 8.22 → 7.95.

### STEP 2: fixture gates (実測 at P)

**Probes:**
- Commands: `$H/probe/run-probe.sh <worktree> 4424` and `… 4424 oracles`. 0 page errors; load 4.48 → 4.81 → 6.28.
- `probe-57fdcd6.json` sha256 `1127e3b8…bc62342`. It is **byte-identical** (cmp) to CH-2's `probe-f4b1e40.json`, and so to CH-1's `probe-24f1210.json`.
- `probe-57fdcd6-oracles.json` sha256 `d2e88172…63d2a3`. It is **byte-identical** (cmp) to CH-2's `probe-f4b1e40-oracles.json`.
- `node $H/probe/diff.mjs <CH-2 probe> <P probe> --texts`: 0 of 972 and 0 of 264 views differ.
- So C4 (CH-3) changed nothing the probe reads. **The C1 probe baseline does not depend on the C4 decision:** holding or keeping C4 leaves both probe files as they are.
- CH-2's probe files were deleted after this comparison; their sha256 stubs are in `audit3/r3-chart/`.

**Cumulative statement against the base probes** (8849bf9 / STEP 0 `probe-oracles-step0.json`; `diff.mjs --texts` and `audit3/r3-chart/compare-c2.mjs`):
- **Default set, 243 of 972 views differ: 123 label views and 120 value views, all 週足.** The diff and the comparer's output are identical to CH-1's (`cmp` of both outputs, with the head name normalised).
  - 3m, 6m and 1y: 0 views differ, at every width and theme.
  - 週足 labels: 31 at 320, 30 at 375, 31 at 390 and 31 at 1440, counting ZZNV dark at 320, 390 and 1440. Values: 30 per width.
  - The classes of difference are those in C2's gate table: the removed weekly notice texts, the remaining notice block's boxes (ZZLI's 「収縮は未確認」), their halos, ZZLI 週足 375's one mask hole, and at 1440 the card's one added sentence and +21.1875 card height.
  - Labels other than the notice that moved: **none**. Newly forced or missing: none.
- **Oracle set, 78 of 264 views differ.** That is CH-1's 66 (33 label + 33 value, all 週足) plus C3's 12 views that CH-1 did not already count (ZZRL and ZZRW 3m/6m/1y at 320, labels and values).
  - Every non-CH-1 difference is C3's card text: the comparer's `unexpected` list is exactly C3's stated 20 html changes (10 label + 10 value views).
  - SVG: as CH-1 (only ZZHB's 「収縮は未確認」 moved). No other label moved.

**Dump** (`$H/dump/run-dump.sh <worktree> 4424` → `dump-57fdcd6.json`, sha256 `8ccec66c…c43d56`; load 0.66 → 2.86):
- It is byte-identical to CH-3's `dump-ff4349b.json` (the same source), which was then deleted as superseded.
- Against `dump-8849bf9.json` (`audit3/r3-chart/dump-compare.py`), **18 screens are identical:** every 375 list ×4 filters ×2 watchlists, 375 Today ×2, 375 watch ×2, 375 market ×4 tabs, and 1440 market and its tab count.
- **24 screens differ.** Each gains 「ピボットの日 未確認」, C4's line on a default row without `se_pivot_date`, and the blank lines around it.
  - 6 stock screens at 375 and 6 at 1440.
  - 1440's 4 lists × 2 watchlists, Today × 2 and watch × 2. Their right pane shows a stock, so the order's "Today, 候補 and ウォッチ byte-identical" holds at 375 only.
- **ZZNV 週足** also shows C2: the in-plot 「週足は直近58週分（2025/08〜）。」「2年分はありません」 become 「週足は2025/08〜の58週分（2年分はありません）」.
  - At 375 the sentence goes into the closed 注記, whose summary reads 「注記（計算方法・出典 7件）」 (was 6).
  - At 1440 it goes into the card's notes.
- **375 content heights:** ZZAR 2488 → 2518, ZZHW 2591 → 2621, ZZNV and ZZNV 週足 3044 → 3075, ZZSD-broken 2615 → 2646, ZZZF 2567 → 2597. No 1440 height changed.
- **C3 shows nowhere in the dump.** The legend text is unchanged at 375 and 1440 on the default rows.

**Heights** (`$H/heights/run-heights.sh <worktree> 4424` → `heights-57fdcd6.json`, compared with `heights-c61bf96.json`; load 4.16 → 5.60):
- Unchanged: Today **1342**, 候補 **593**, ウォッチ **442**, 市場 **1228 / 1300 / 1322**.
- **Stock ZZNV: 3044 → 3075** (C4's line; the line is 3388).
- **Chart card at 320/375/390:** unchanged.
  - 508 on every daily period.
  - 492 on 週足 at 320.
  - 508 on 週足 at 375 and 390, except ZZLI's 490 (as at STEP 0).
- **Chart card at 1440:** 週足 622.375 ×18 / 643.5625 ×12 → **643.5625 ×18 / 664.75 ×12** (+21.1875, C2's sentence). Every other 1440 period is unchanged.
- **VCP card at 375:** 422.1 → 452.5 (ZZAR, ZZHW, ZZNV, ZZZF), 294.3 → 324.7 (ZZSD-broken).

### STEP 3: real data (実測 at P; every number is the 11-12 rebuild's, never the publication's)

**Commands:**
- `$H/snapshot/run-snapshot.sh <worktree>`: 7.7 min; load 3.90 → 3.97.
- `$H/build/run-build.sh <worktree>`: load 3.88 → 4.94.
- `$H/snapshot/run-render.sh <worktree> 4424 reduce`: 476 renders and the 2 readout targets, 0 errors; load 4.89 → 6.41.

**Identity with STEP 0's kept outputs (`out/c61bf96`):** `rows.jsonl`, `ready43.jsonl` and `serve/research.json` are byte-identical (and equal SNAP's). So are `counts.json` and `work/sell-eval.jsonl`, and `serve/charts/` has no differing file. CHART touches neither selection nor the Setup Engine.

**The items** (each detailed in its own section above):

| Count (`counts-render.json` unless noted) | c61bf96 | 57fdcd6 | Verdict |
|---|---|---|---|
| C2 `weekly_forced_390_certified` forced lines / weekly-notice lines | 114 / 62 | **29 / 0** | Held. The extra −23 are 「収縮は未確認」 placed clear; no label moved. |
| C2 `weekly_forced_390_ci_bars` | 111 / 60 | **29 / 0** | Held. The extra −22 are the same. |
| C3 `low_legend_hidden_320`: stocks with the tag / hidden in every period | 13 / 13 | **13 / 0** | HUM is hidden in 1y and 週足 (shortfall 26.63 / 53.97px). The 13/13 is not met there. |
| C3: legends taller than 2 lines at 320 (scratch probe) | — | **0 of 192** | Held. |
| C5 `readout_zero_rendered` | 4 | **4** | C5 is held: not delivered. |
| card heights 320 / 390 | {489: 95, 505: 61, 521: 36} / {508: 192} | identical | Held. |
| card heights 1440 | {684: 14, 704: 9, 705: 2, 725: 10, 726: 15, 746: 23, 748: 3, 768: 16} | {705: 16, 725: 19, 726: 15, 746: 23, 748: 3, 768: 16} | The 23 週足 views +21 (684 → 705 ×14, 704 → 725 ×9). No other view changed. |
| `legs_drawn_ci_ready` | 9 / 30 | 9 / 30 | Unchanged. |
| `dry_up_bracket_ready` | 2 / 37 | 2 / 37 | Unchanged. |
| unverified symbols | 8 | the same 8 | Unchanged. |

**Entry chunk** (rule 21; `$H/build/build-57fdcd6.json`):
- `npm run build` entry: **131.44 kB gzip** (375.60 kB raw).
  - STEP 0 (c61bf96) 130.28: **+1.16 kB**.
  - CH-1 130.38, CH-2 130.60: C4 alone is **+0.84 kB**.
  - **2.56 kB under the 134.00 line.**
- Design-acceptance build entry: 375,167 raw / 131,076 gzip -9 bytes. CH-2: 373,134 / 130,213 (+2,033 / +863). STEP 0: 372,422 / 129,915.
- **Lazy priceChart chunk:** 42,801 raw / 18,071 gzip -9.
  - Its raw size is unchanged since CH-1 (C2's −298 against STEP 0's 43,099).
  - Against CH-2's 18,072 its gzip is 1 byte smaller. The chunk imports `./index-<hash>.js`, and that name changed with the entry chunk (same length), so this is not new code. CH-2's build tree had been deleted, so the bytes were not diffed.
  - No CHART item since C2 put code in it, because C3's and C4's code is not chart drawing.
- **pivotBar.js now ships in the entry chunk** through StockVcpCard.jsx. R1 will import it too, so it is counted once at integration.
  - Alone it is 879 bytes minified and 548 gzip -9 (`npx esbuild src/static/brief/pivotBar.js --bundle --minify`). That is an estimate: inside the chunk its marginal gzip is smaller.
  - The rest of C4's +2,033 raw is StockVcpCard.jsx's producers and markup.

### STEP 4: the frozen pre-C1 baselines (for CH-5)

These are recorded in the C1 section header below and in `audit3/r3-chart/pre-c1-baselines.txt`, with the exact normalisation commands. They are exempt from the "delete superseded" rule until C1 is proven.
- **Deleted now:** CH-2's `probe-f4b1e40.json` and `probe-f4b1e40-oracles.json` (with their raw dirs) and CH-3's `dump-ff4349b.json`. CH-1's probes were deleted in CH-2.

### CH-4 未検証

- **The publication's counts.** Every count above is the 11-12 rebuild's. Nothing was read from a publication, and no production action was taken.
- **The detail carrying `se_pivot_date` and `se_quiet_days_10d` on a real publication.** The rebuild serves full rows, so the detail-only path was not exercised (see C4).
- **The C5 readouts at 375 on real data.** The render probe has no 375 views.
- **The quiet-days text in the real-data render.** It was read through its producer only (CH-3).
- **The 最新足 corner in the browser** (C2; vitest only).
- **No timings were taken.** C1 is next; its timings are taken at integration on an idle machine.

### For the conductor (CH-4)

- **The full suite shows the known C4 × brief-decision failure.** See STEP 1. The (a)/(b)/(c) decision in the C4 section is still open.
- **C5 is still held.** `readout_zero_rendered` stays 4, and the four rows' readouts still differ from their verdicts in all 16 views (C5 section).
  - The decision (options 1–3 in the C5 section) is still open.
  - If option 1 or 2 is chosen, it is a change in CHART's or R's files. It moves P, so the C1 baselines would be re-frozen after it.
- **C3 does not reach 13/13 on the rebuild.** HUM's 1y and 週足 at 320 keep the low hidden: its 3-figure price, the kept 「ピボット」 and the RS item leave 50.42px and 23.08px against 77.05px. This is reported as the plan says, not fixed.
  - A fix would need a shorter must-stay item or another item allowed to fold before the low, which is a design decision.
- **C3 at 320 trades the breakout arrow's legend key for the low's price.** In all 50 rebuild views where the low now shows, 「上抜け」 (rank 2) folds, and 「枠＝収縮」 also folds in the 38 daily views.
  - The arrow stays explained in the 注記, and it is the existing rank order (low 1, arrow 2).
  - If the arrow's key should win at 320, the fix is a rank swap in `legendItems` (CHART's file). It would move P and need the C1 baselines re-frozen.
- **C3 at 390 on the rebuild:** HUM 1y and 週足 now show the low, and 「損切り」/「枠＝収縮」 fold in its place. It is within the gate (two lines, 508), but it was not in the order's expected list.

### Integration requests (CH-4)

- **No new request.** The open ones are unchanged:
  - C4's `STOCK_CAP` in brief-decision.spec.js (track R's file);
  - the vocabulary 「ピボットの日」 and 「静かな日」 for CONTEXT.md.
- **The harness's p4 copies need no mirroring.** No caller's crossing or readiness wiring changed in this track.
- **The H5 baselines integration re-takes shift as stated:**
  - the probe and oracle probe by C2 (and C3 in the oracles);
  - the dump by C2 and C4 on the 24 screens above;
  - the heights by C4 (stock screens) and C2 (1440 週足 card);
  - the render counts by C2 and C3 as in the STEP 3 table.

## C1 (package CH-5): speed, output-identical. Frozen pre-C1 baselines

C1 must reproduce these byte for byte. They are from P = 57fdcd68 and kept in scratch (never committed). The list and the commands are also in `audit3/r3-chart/pre-c1-baselines.txt`.

| Baseline | Path (`$H` = scratch `audit3/r3-harness`) | sha256 |
|---|---|---|
| 492-view label + 480 value probe | `$H/probe/probe-57fdcd6.json` | `1127e3b88c52ee79c3f16e2474d3eda5b0a01b92de78e89e86f54e327bc62342` |
| Oracle probe (132 + 132 views) | `$H/probe/probe-57fdcd6-oracles.json` | `d2e881720b434b64f2fa114661c77cecf5debe939782665d5543f1a9b163d2a3` |
| Real-data render probe (476 views), normalised | `$H/snapshot/out/57fdcd6/render/probe-reduce.json` | `c889d746e341a81109498a6351b3675cfb7f487170ada4e5b8425d42d4198cc6` |
| Readout render probe (PFIS, LNTH at 390), normalised | `$H/snapshot/out/57fdcd6/render/readout/probe-reduce.json` | `9854506c6e726b272772bc2010a971174d985874f29ff797a225a2c463f8cd11` |
| Render counts | `$H/snapshot/out/57fdcd6/render/counts-render.json` | `b47a77583c27c17963a255bc3190f69f5cca6729abfa0d55bb82844d9602346b` |
| Snapshot payload manifest, less the three tree-named files | `manifest.sh $H/snapshot/out/57fdcd6`, then `grep -v` of `./bundle.mjs` and the two `probe-reduce.json` (4,437 lines) | `8feeeb730090e6f0fddbe6d2a821cea0f21bbb12302b028ab1395a31e9128209` |
| The archived tree with its dist-t | `$H/snapshot/trees/57fdcd6/` | — (the archive of P) |

- **Normalisation:** `sed "s/<head7>/<T>/g" <file> | sha256sum`. The two render probes and `bundle.mjs` embed the tree name (the tree field and each PNG path).
  - Checked here: 8849bf9 and c61bf96, which have identical code, give the same normalised render-probe hash.
  - The two fixture probes embed no tree name, so `cmp` applies directly.
- **The probe baselines do not depend on the C4 decision.** Holding C4 (`git revert ff4349b2 08bebfc7`) changes no file the probe or the render probe's SVG fields read. It would change the render probe's `notes` field, and with it the normalised render-probe hash.
  - If C4 is held before C1, re-freeze the render probe and the manifest.
  - If C5 lands before C1, re-freeze the oracle probe (ZZPG's readout), the render probes (the four rows' readouts) and the manifest.
  - In CH-2, the as-ordered C5 left the default probe's sha256 unchanged, but any C5 variant must be re-checked.

### C1: what changed (c8b2c54a code, 45601a25 tests; P = 57fdcd68)

Only `priceChart.js` and `chartLabels.js` changed. The grid, the costs, the gaps, the constants, the retry loop and the label order are as at P. Every shortcut is a test-only `reference: true` option away: `renderPriceChart(el, model, { reference: true })` passes it to `labelPlacer`, and the second layout (`carry`) forwards it, because it spreads `options`. The app never passes it.

1. **One candidate set per average's line end** (`nameSpots`, priceChart.js).
   - A name's spots depend only on its end (`end.at`, `end.y`, `w`). They do not depend on `offLevel` or on the try.
   - So the `spots()` object built for the first placement serves every retry. Its lazily ordered prefix and its memo (`solid`, `soft`, `strike` per spot) are worked out once per render.
   - The memo key (`w`, `half`, `struck`) is the same on every try (`half: 6.5`, the placer's own `strike`). `fill()` only extends the ordered prefix. The memo holds pure functions of the spot's box. `restore()` touches neither, so no placer state leaks through the shared object.
   - Unit test: `chartLabels.test.js` 「places a label again from a reused candidate set (after restore) exactly where a new set does」.
2. **A spot over candles that cannot beat the best so far is passed early** (`place`, chartLabels.js).
   - Its score (`count × perCandle + cost`, or `count`) is computed before `hits` and the leader, not after.
   - A spot with `score ≥ worst` would be passed anyway, and neither `hits` nor `leader` changes state. So the same spot wins.
3. **Candles and volume bars counted from per-bar edges** (`solidCount`, priceChart.js).
   - Each bar's box edges are worked out once (the same sums as `solid`), and no box object is built per bar.
   - `solid` stays for every other caller and for `reference`.
4. **Boxes further apart across than the widest gap are never compared** (`CLASH_REACH` in `clash`).
   - `CLASH_REACH` = max(`KIN_GAP.plan` 36, `KIN_GAP.figure` 26, `LABEL_GAP` 16, `BOX_GAP` 3) = 36.
   - Every `clash` path ends in `a.x0 < b.x1 + gap && a.x1 > b.x0 − gap` with `gap ≤ 36`, or needs the boxes to overlap across. So `a.x0 ≥ b.x1 + 36` or `a.x1 ≤ b.x0 − 36` is false on every path.
5. **The averages' last stretches (`tail`) sit in bands of their own** (`tails`, chartLabels.js).
   - A tail box meets only a box with `label` whose `kin` is not `'ma'` (the `clash` tail branch). So `hits` scans `tails` only for such a box (`meetsTails`).
   - `take`, `release` and `restore` keep the two maps in step.
   - `repair` still treats a tail in the way as fixed. A tail has no `of`, so it was fixed at P too, and a fixed spot is passed whatever the blockers were.
   - Unit test: 「keeps an average's last stretch in the way of a label being repaired, never of a name」.
6. **One reused probe box per `place` call.** A spot is tested with `probe`, and its own box is built only once nothing is in its way. `hits` keeps no box.
7. **Leader tests cached per left edge and per row** (`lineBeside`, `alongLevel` in `placeName`).
   - The line's height 3px right of a moved name depends only on `x0`. Whether a level runs along the row depends only on `yc` (and the call's `offLevel`).
   - The caches live inside one `placeName` call, so `offLevel` is fixed within each.
   - The segments, their keys, `from`, `up`, `tip` and the leader kinds are built exactly as at P.

**Not done, and why:**
- The `carry` second layout (the whole chart drawn again for a level's name) is untouched: a shortcut there was not attempted. It is 13 of the 608 fixture models.
- Yielding to the main thread: not implemented (see the timings).

### C1 profile: where the time went, before (P) and after (head), 実測 (advisory, shared machine)

Scratch tools in `audit3/r3-chart/c1/`:
- `capture/`: the chart models recorded from the browser. There are 608 fixture models (the default and oracle sets at 320/375/390/1440) and 476 real-data models (the 11-12 rebuild at P), 1,084 deduplicated.
- `build-bundles.mjs`: esbuild bundles of P's files (`ref/`, = `git show 57fdcd68:…`, checked with `diff`) and of HEAD's (`head-final/`, = `git show HEAD:…`).
- `render.mjs`: draws a matrix in jsdom (modes `ab`, `bench`, `each`). `instrument.py` makes counted and timed copies. `profsum.mjs` gives self time per function from a `.cpuprofile`.

**Self time per function, fixture matrix (608 models, one pass, `node --cpu-prof one.mjs <bundle> 1 '*' '*' '*' -- <8 fixture model files>`; load 5.35 → 5.68):**

| Function | P (37,077 ms sampled) | head (29,449 ms sampled) |
|---|---|---|
| garbage collector | 7,226 ms (19.5%) | 7,169 ms (24.3%) |
| `clash` | 4,382 (11.8%) | 2,235 (7.6%) |
| `hits` (head: `scan` + `hits`) | 3,760 (10.1%) | 2,235 + 312 (8.7%) |
| `solid` (head: `solidCount`) | 3,315 (8.9%) | 1,496 (5.1%) |
| `place` | 2,085 (5.6%) | 1,171 (4.0%) |
| `s.fill` + `batch` (the spots' heap) | 978 + 974 (5.3%) | 756 + 803 (5.3%) |
| `soft`, `segmentCrosses` | 363 + 375 | 342 + 324 |
| the label search together (these rows less GC) | about 16.2 s (44%) | about 9.7 s (33%) |

The rest is jsdom building the markup (`_node`, `Attr.setup`, the HTML parser) and `fmt`. They are about the same in both.

**SWKS 6か月 at 1440, the first-load chart** (`models/swks-6m-1440.json`, 30 renders per process, `one.mjs`; three interleaved pairs, load 5.69 → 5.01):
- P: 3,140 / 3,110 / 2,668 ms. head: 2,087 / 2,371 / 2,289 ms.
- Per render, by the medians: about 104 → 76 ms (−26%).
- Under `--cpu-prof`, head's remaining label search (`place`, `clash`, `scan`, `batch`, `solidCount`, `segmentCrosses`, `spots`, `hits`, the two `cost`s) is about 0.79 s of about 3.0 s of rendering (26%).
- A single cold render (`render.mjs each`, instrumented, 3 processes each, load 5.88 → 5.90):
  - P: render 211 / 227 / 221 ms, the names 151 / 160 / 138.
  - head: render 111 / 138 / 124 ms, the names 62 / 74 / 76.
  - The names are still about half of a cold SWKS render (10 `placeName` calls: the first pass and one retry).

**Node micro-benchmark, fixture matrix** (`node render.mjs bench 5 reffinal headfinal -- <8 fixture model files>`; CPU time of the renders only, P and head interleaved, after one warm-up pass; load 2.26 → 4.45):
- P: 38,442 / 39,171 / 38,688 / 38,887 / 40,453 ms, **median 38,887**.
- head: 30,526 / 31,685 / 29,124 / 29,776 / 31,902 ms, **median 30,526 (−21.5%)**.
- placeName (instrumented bundles, wall time; `node render-names.mjs bench 3 instreffinal instheadfinal -- <8 fixture model files>`, interleaved; load 7.66 → 6.60):
  - P: 27,211 / 30,855 / 31,769 ms, **median 30,855**.
  - head: 15,164 / 15,543 / 15,819 ms, **median 15,543 (−49.6%)**.
  - Instrumented render: medians 50,475 → 34,407 ms.
  - An earlier 3-run reading of the same bundles kept only the last run: P 32,211 → head 16,884 ms (render 53,079 → 36,202).

**What each change did, by its counters** (real-data matrix, 476 models, instrumented, one pass each, from the build-up in `c1/prof-real-*.json`):
- The timers in those files are not comparable across steps, because the instrumentation changed between s2 and s3. So each change is credited by what it counts, not by its ms.

| Counter (476 models) | P | after 1 (one set per end) | after 2 (early pass) | head (after 3–7) |
|---|---|---|---|---|
| spots ordered (`fill_pop`) | 7,056,833 | 2,844,866 | 2,844,866 | 2,844,866 |
| candle counts computed (`solid_miss`) | 7,055,567 | 2,844,539 | 2,844,539 | 2,844,539 |
| spots that reach `hits` (`place_visit`) | 3,051,695 | 3,051,695 | 1,472,518 | 1,472,518 |
| leader calls | 2,920,313 | 2,920,313 | 1,439,036 | 1,439,036 |
| `hits` calls | 10,396,677 | 10,396,677 | 6,147,178 | 6,147,178 |
| `clash` calls | 200,934,438 | — | — | 46,833,130, of which 16,227,016 end at `CLASH_REACH` |
| `clash` calls against a tail | 115,485,847 | — | — | 191,326 |

- Changes 3, 6 and 7 change no counter: they make each call cheaper. Their share is inside the head's totals above.
- `retry` 81, `replay` 70, `placeName` 2,705, `repair` 1,300 and `carry_render` 6 are the same at P and head, so the same work is reached.

**Stop decision.** I stopped **before the gains flattened**: on a cold SWKS render the names are still about half the render, so the name search is not exhausted.
- I stopped because every further change re-opens all four proofs (a)–(d): a snapshot, a render, both probes and the full Playwright suite.
- **The transferable figure is the same-run ratio,** head / base = 306 / 498 = **0.61** (first load, below). Projections from it are **未検証**:
  - against the README's quiet base readings (313–355 ms), about 192–218 ms, which is borderline for ≤ 200;
  - against CI's Design Acceptance 779 ms (PR #145), about 480 ms.
- p3's browser breakdown of 8849bf9 (`audit3/p3-phone-chart-speed/timing/instr-snapshot.json`, another session) had the names at 93–131 ms of a 229–250 ms chart task, about half. It is context, not a measurement of this tree.
- **Two levers remain:**
  - more identity-preserving work on the name search: `hits` against reserved boxes, then the spots' heap;
  - yielding (not implemented, as ordered).

### C1 identity proofs (all four, 実測)

**(a) Committed vitest determinism check.**
- `renderPriceChart`'s and `labelPlacer`'s test-only `reference` option bypasses every shortcut. The JSDoc says TEST ONLY.
- **`priceChart.identity.test.js`** (new file; deviation, see below):
  - It draws every fixture stock (30) and every oracle chart in `tests/static/brief-fixture.js`, plus 4 crowded charts (`wall`, `tall`, `capped`, `levels`).
  - Each is drawn × the 4 periods × the plot boxes of 320/375/390/1440 (262×292, 317×340, 332×340, 926×470), with and without `reference`.
  - It asserts the outerHTML (uid normalised), the aria-label, the legend, the two `freeCorner` answers, and the retry and layout counts are identical.
  - Its last test asserts the matrix reached the names' retries, the full replay, forced names and a second layout (`carry`).
  - The models are built from each fixture row and its bars (Setup Engine pivot, measured legs). They are close to, not exactly, the stock screen's plan; the browser probes (c) cover the exact plan.
- **`priceChart.test.js`:** this file's own chart at the 4 sizes and a wall of bars at 390 (names forced), with and without `reference`.
- **`chartLabels.test.js`:**
  - seeded scenes of every kind of box placed with and without the shortcuts;
  - a reused candidate set after `restore()` placing exactly where a fresh one does;
  - a tail in the way of a repaired label but never of a name.
- **Deviation:** the matrix is in its own file, not in `priceChart.test.js` as ordered.
  - The browser fixture reads its session calendar through `node:fs` and Node's URL, so it does not load under priceChart.test.js's jsdom environment.
  - The new file runs under `@vitest-environment node` with a jsdom document of its own.
  - It is in CHART's paths (`OWNERSHIP OK (CHART): 15 paths`).
  - Duration: 124.8 s for 43 tests under load 7.6–9.9 (longest test 6.6 s against a 120 s per-test timeout). In the full run it took 99.7 s.

**(b) Scratch A/B against P's real files** (`node render.mjs ab reffinal headfinal headfinal:reference=1 -- <the 9 model files>`; load 3.38 → 3.52):
- **1,084 models** (608 fixture + 476 real-data views, deduplicated).
- Each is drawn with P's `priceChart.js`/`chartLabels.js`, the head's, and the head's with `reference`. The outerHTML (uid normalised), aria-label, legend and two `freeCorner` answers are compared byte for byte.
- **0 differing.** The three cumulative sha256 are all `dfacbf1c349f8d39e31a696e5092e1a2cb41ac7e3770cce7b3d509aa642be052`.
- The bundles were rebuilt from `git show 57fdcd68:` and `git show HEAD:`. The head bundle equals the one used during development except for esbuild's path comments.

**(c) Fixture probes** (`$H/probe/run-probe.sh $W 4424` and `… 4424 oracles`, at 45601a2; 0 page errors; load 9.54 → 11.16 and 10.17 → 8.98):
- `probe-45601a2.json` sha256 `1127e3b88c52ee79c3f16e2474d3eda5b0a01b92de78e89e86f54e327bc62342`: **equal** to P's frozen hash (`probe-57fdcd6.json`, the C1 header table and `pre-c1-baselines.txt`).
- `probe-45601a2-oracles.json` sha256 `d2e881720b434b64f2fa114661c77cecf5debe939782665d5543f1a9b163d2a3`: **equal** to P's frozen hash (`probe-57fdcd6-oracles.json`).
- sha256 equality is the identity claim. The head's two files were re-hashed in this session.
- When the probes were taken, `node $H/probe/diff.mjs <P> <head> --texts` printed 「0 of 972 views differ」 and 「0 of 264 views differ」 (`audit3/r3-chart/diff-57fdcd6-45601a2.txt`, `diff-oracles-57fdcd6-45601a2.txt`).
- P's probe files were deleted in the clean-up, so the `cmp` and the diff can no longer be re-run; their `.sha256` stubs are kept.

**(d) Real data, the 11-12 rebuild** (`$H/snapshot/run-snapshot.sh $W` 8.8 min, load 9.30 → 4.10; `$H/build/run-build.sh $W`; `$H/snapshot/run-render.sh $W 4424 reduce`: 476 renders and the 2 readout targets, 0 errors, load 2.27 → 1.14):

| File | P (57fdcd6) | head (45601a2) |
|---|---|---|
| `render/probe-reduce.json` (normalised, `sed "s/<head7>/<T>/g"`) | `c889d746…` | `c889d746…`, identical |
| `render/readout/probe-reduce.json` (normalised) | `9854506c…` | `9854506c…`, identical |
| `render/counts-render.json` | `b47a7758…` | `b47a7758…`, byte-identical |
| `counts.json` | `4b1866dd…` | `4b1866dd…`, byte-identical |
| manifest less the 3 tree-named files (4,437 lines) | `8feeeb73…` | `8feeeb73…`, `cmp` identical |
| `bundle.mjs` (normalised) | `31c168df…` | `31c168df…` |

`rows.jsonl`, `ready43.jsonl` and `serve/research.json` equal SNAP's, as at P.

### C1 timings (ADVISORY: a shared 4-CPU machine; the counting timings are re-taken at integration on an idle machine)

**First load, 1440 Today** (`$H/timing/wait-quiet.sh 0.5 600 $H/timing/run-timing.sh $W 4424 /home/user/screener/.claude/worktrees/r3-base 7`; the 8849bf9 base and the head interleaved in one run):
- `wait-quiet` waited 45 s. Load 0.56 at the start, 4.05 at the end: the loads rose during the run with the run's own Chrome. The host calibration was 925 → 934 ms.
- Validity rule: the 1-min load was under 1.0 at the start, and SWKS was in the pane 7/7 for both trees.
  - The processes in `ps_before` appear to be the run's own chrome-headless and node (00:07 elapsed), and `claude` at 3.1%. That is inferred, not checked.
  - The rule was met at the start only. The load during the runs was 1–4, and head's in-page calibration was slower than base's (25.3–42.8 ms against 18.9–31.0). So this is a **valid-at-start but advisory** reading.

| Tree | longest task in design-review's window, per run | median | chart task median | chart was the longest |
|---|---|---|---|---|
| 8849bf9 (base) | 529, 424, 498, 494, 477, 549, 508 | **498** | 498 | 7/7 |
| 45601a2 (head, C1) | 396, 290, 299, 375, 264, 306, 414 | **306** | 306 | 7/7 |

- **The target of ≤ 200 ms is not reached:** 306 ms against base's 498 in the same run (−39%).
  - This session reads base about 1.5× slower than the README's quiet readings (313–355 ms). So the absolute figure is not comparable with the target.
  - The counting figure is integration's on an idle machine, and CI's Design Acceptance (779 ms median on PR #145) is 未検証 here.
- **The rest of the chart task** is building the markup and the levels before the names (in p3's breakdown, about 24 + 31 + 8 + 7 ms of base's task), React's commit and GC.
  - Yielding (drawing the labels in a second task) was not implemented, as ordered.
  - It would change PriceChart's synchronous contract: the draw, the `legend` the card reads and the controller would exist before the labels. It would also change what 'settled' means for the probes and H3's `chartSettled`. The conductor decides.

**Period switch at 390 and 1440** (`$H/timing/run-period.sh`, `PERIOD_NAME` overrides; medians of 120 switches):

| Run | started (JST) | load before → after | 390 median | 1440 median |
|---|---|---|---|---|
| head 45601a2 (`period-45601a2-c1`; wait-quiet 360 s) | 18:22 | 0.45 → 1.64 | **192.5** | 204.0 |
| base 8849bf9 (`period-8849bf9-c1chart`; wait-quiet hit its 600 s cap) | 18:42 | 3.64 → 6.91 | **207.0** | 213.0 |
| head 45601a2 again (`period-45601a2-c1b`; no wait) | 19:03 | 5.04 → 7.04 | **191.5** | 217.5 |

- The three runs were about 20 minutes apart under different loads, so they are not strictly back to back. Head's 390 switch is not slower than base's in either head run, including the one under the heavier load.

### C1 other checks (実測 at 45601a2)

- **Build** (`$H/build/run-build.sh $W` → `$H/build/build-45601a2.json`):
  - The entry chunk is **byte-identical to P's once the three hashed chunk names it imports are normalised**: `index-*`, `priceChart-*` and `MarketScreen-*` in the design-acceptance build, `cmp` after `sed`. MarketScreen's chunk is identical too.
  - The harness's gzip -9 figure moves 131,076 → 131,079 bytes (npm run build 131.44 → 131.45 kB). Those 3 bytes are the new hash strings, not code.
  - **Lazy priceChart chunk:** 42,801 → 44,160 raw (+1,359) and 18,071 → 18,546 gzip -9 (+475; the harness's figures). C1's code is in the lazy chunk only.
- **vitest:**
  - **The five named files and the identity file, in the full run at HEAD:** priceChart.test.js 50, priceChart.identity.test.js 43, StockChartCard.test.jsx 21, StockView.test.jsx 9, chartLabels.test.js 24 and PriceChart.test.jsx 3, so 150 tests passed. A targeted run before the commit gave the same 6 files and 150 tests (`c1/vitest-targeted.log`).
  - **Full:** `cd frontend && PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=… FINANCIAL_REPLAY_PYTHON=… npx vitest run`.
    - **249 files, 4,054 tests: 4,053 passed, 1 failed** (351 s; load 3.07 → 6.25; `audit3/r3-chart/vitest-full-45601a2.log`).
    - The failure is `tools/export-market-trends.test.mjs` 「writes raw and derived data with exact content hashes and binds the manifest reference」: `Test timed out in 20000ms`. It is not CHART's file.
    - Re-run alone (`npx vitest run tools/export-market-trends.test.mjs`): **37/37 passed**, that test 14.1 s (load 4.87 → 3.57). The same timeout and the same re-run pass happened in CH-2 (`vitest-rerun-export-market-trends.log`).
    - Counts: CH-4's 248 files / 4,007 tests plus the identity file and 47 tests (43 identity, 3 chartLabels.test.js, 1 priceChart.test.js).
- **Lint** (`npm run lint`): 0 errors, 4 warnings (the base's four); load 6.70 → 7.43.
- **Full static Playwright, CI-faithful, 4424:** `cd frontend && PATH=/opt/node22/bin:$PATH FONTCONFIG_FILE=…/ci-fonts/fonts.conf AUDIT_PORT=4424 npx playwright test -c audit3/r3-chart/pw-147.config.mjs`.
  - **456 tests: 453 passed, 2 skipped, 1 failed** (26.2 min; load 3.02 → 8.82; `audit3/r3-chart/pw-full-45601a2.log`). No re-run was needed for a timeout.
  - The 2 skips are track R's `test.fixme('R1: …')` and `test.fixme('R2: …')`. Every active brief-oracles assertion passed, ZZHB's green arrow included.
  - **The failure is the known C4 one, as at P:** `brief-decision.spec.js:269` 「… stalls waits for the next pivot, its tiles 参考」 at 375×812, line 281, **3145** against `STOCK_CAP` **3124**.
  - Re-run alone (`-g 'stalls waits for the next pivot'`): the same 3145 against 3124 (load 8.32 → 8.62). It is a layout height, not a timeout, and C1 does not touch it (C1 changes no output).
  - So the order's 「0 failures」 does not hold, for the same reason as at P: the open C4 × `STOCK_CAP` decision.
- **Ownership gate:** `OWNERSHIP OK (CHART): 15 paths`.
- **Clean-up after the proofs:**
  - Deleted P's `$H/snapshot/out/57fdcd6/` (302 MB), `$H/snapshot/trees/57fdcd6/`, `$H/probe/probe-57fdcd6{,-oracles}.json` with their `raw/` dirs, and `$H/build/npm-build-57fdcd6/`.
  - The probes' `.sha256` stubs, `build-57fdcd6.json` and P's manifests in `audit3/r3-chart/` are kept.
  - The head's (45601a2) outputs are kept. Nothing of 8849bf9, c61bf96, the base or another track was touched.

### C1 未検証

- **The idle-machine first-load timing and the period switch.** Every figure above is advisory; integration re-takes them.
- **CI's Design Acceptance 1440 median.** It was last read at 779 ms on PR #145. Not read for this tree, because no PR or dispatch is allowed.
- **The browser share of the remaining name search.** The browser was not profiled with instrumentation in this package; the name-search shares above are from node/jsdom.
- **Real-data timing.** The first load reads the rebuild's SWKS only.

### For the conductor (CH-5)

- **C1 is output-identical and committed.** The 1440 first-load target of ≤ 200 ms is **not reached** in this session: 306 against base's 498 ms, interleaved and advisory.
  - Per the order, the owner waiver stays and the figure goes to OD2.
  - The same-run ratio, 0.61, projects to about 192–218 ms against quiet base readings and about 480 ms against CI's 779. Both projections are 未検証.
  - **Two levers remain:**
    - more identity-preserving name-search work (`hits` against reserved boxes, then the spots' heap; the names are still about half of a cold SWKS render);
    - yielding, which is the conductor's decision.
- **Open decisions carried from earlier packages, unchanged by C1:** C4 × `STOCK_CAP` (a, b or c), C5 (options 1–3), C3's HUM at 320 and the arrow key folding at 320.
  - C1 changes no output, so none of them interacts with it.
  - Any of them, once decided, moves the chart's outputs. That is integration's re-baseline, not a C1 re-proof, unless it touches priceChart.js or chartLabels.js. Then rerun `priceChart.identity.test.js` and `render.mjs ab`.

### Integration requests (CH-5)

- **None new.** C1 changes no output, so the H5 baselines integration re-takes are not shifted by it.
- **The timings that count are integration's:** the first load and the period switch on an idle machine, and CI's Design Acceptance 1440 median.

## Track CHART: closing summary (after CH-5)

| Item | Package | State | Gate (rule 16) |
|---|---|---|---|
| C2: the 週足 week count from the plot to the 注記 | CH-1 | delivered | Expected diff: only 週足 views changed, no other label moved, none newly forced or missing; the forced count never rose. |
| C3: the last contraction's 安値 price kept in the 320 legend | CH-2 | delivered; 12 of 13 rebuild stocks in every period (HUM hidden at 320 in 1y and 週足) | Expected diff: card text only (ZZRL, ZZRW at 320). |
| C5: the readout's 対ピボット by the pivot-distance rule | CH-2 | **held** (implemented, then reverted: the card grew at 375); `readout_zero_rendered` stays 4 | none (not delivered) |
| C4: the Setup Engine pivot's own day and the quiet days on the VCP card | CH-3 | delivered; **one cross-track failure** (`brief-decision.spec.js:269`, 3145 against `STOCK_CAP` 3124 at 375) | Probe byte-identical; dump and heights shift as stated. |
| C1: the averages' name search made cheaper | CH-5 | delivered, output-identical; 1440 first load 498 → 306 ms (advisory), target ≤ 200 not reached | Probes, oracle probe, real-data render probes and counts all byte-identical to P. |

- **Entry chunk** (rule 21; `npm run build`, gzip): STEP 0 130.28 kB → CH-1 130.38 → CH-2 130.60 → C4 131.44 → C1 131.45 kB.
  - Net **+1.17 kB**, 2.55 kB under the 134.00 line.
  - C1's +0.01 kB is the changed chunk-name hashes only: the entry is byte-identical to P's once they are normalised.
  - pivotBar.js (C4, H1) is now in the entry chunk; R1 imports it too.
  - The lazy priceChart chunk is 43,099 raw at STEP 0, 42,801 after C2, and 44,160 after C1.
- **Integration requests, all open:**
  1. `STOCK_CAP` in brief-decision.spec.js (track R's file): options (a) raise by 31px to 3155, (b) hold C4, (c) a new placement.
  2. Vocabulary for CONTEXT.md: 「ピボットの日」 and 「静かな日」 (C4).
  3. The H5 baselines integration re-takes shift by C2 (the probe and the oracle probe: 週足; the dump: ZZNV 週足; the 1440 週足 card +21.19), C3 (the oracle probe: ZZRL/ZZRW at 320; render counts) and C4 (the dump on 24 screens; stock heights). C1 shifts none.
  4. Decisions for the conductor: C5 (options 1–3), C3's HUM at 320 and the arrow key at 320 (a rank swap in `legendItems` if the arrow's key should win), and yielding for the ≤ 200 ms target (OD2).
- **Nothing was pushed.** No production action was taken. No file outside CHART's paths was edited (ownership gate OK on every commit).
