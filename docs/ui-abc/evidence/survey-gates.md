# SURVEYOR G: gates and budgets for the UI rebuild (A + B's stock + C's 1440)

Read-only survey of main `01066ebe` in `/home/user/screener/.claude/worktrees/ui-plan` (clean). Nothing in the repository was
edited. Every build and browser run used a scratch copy or the harness. JST date 2026-11-16.

Status: complete (sections 1, 3, 4, then 2 appended in that order). All measured values are 実測 unless marked CI実測 or 未検証.

Legend: **実測** = measured here (the command is given). **CI実測** = read from a CI log. **未検証** = not measured.

---

## 1. Design Acceptance

### 1.1 Where it lives

| Piece | File:line | What it does |
|---|---|---|
| Workflow | `.github/workflows/design-acceptance.yml` (253 lines) | On push to main, PRs touching `frontend/**` and others, or dispatch. Job `Real-data design and performance budgets`, ubuntu-24.04, 120 min cap. |
| Baseline | `design-acceptance.yml:8,30,84-104` | `BASELINE_REF` defaults to `1e1943e1d5f78a738a05baa69eb9f2e8508e32ac`. It is cloned to `$RUNNER_TEMP/design-baseline` and only anchors the financial carry replay's code identity. |
| Build | `design-acceptance.yml:167-189` (vite build at :179) | `VITE_STATIC_SITE=true VITE_BASE_PATH=/screener/ npx vite build`, then the real published data is moved back in and the packed transport is verified. |
| Browser checks | `frontend/tools/design-review.mjs` (595 lines), step at `design-acceptance.yml:190-202` | Production Chromium runs on real data. Captures, functional checks, reduced motion and CPU-4x timing go to `test-results/design-review/report.json`. |
| Contract | `frontend/tools/brief-design-contract.mjs` (114 lines) | Groups, captures, budgets, timing and `verifyBriefReport`. |
| Gate | `frontend/tools/check-design-review.mjs` (46 lines), step at `design-acceptance.yml:203-206` | Checks the objective evidence, then requires either a scored review or the waiver. |
| Waiver | `docs/design-review/owner-waiver.json`, validated by `frontend/tools/design-owner-waiver.mjs` and tested in `design-owner-waiver.test.mjs` | Covers the subjective scores and the timing deferral. |
| Publication gate | `.github/scripts/publication-gate.mjs:25,48-53` | A UI is published only when `ci.yml` **and** `design-acceptance.yml` both succeed on the same main push SHA. |

**Groups** (`brief-design-contract.mjs:11-16`):
- 390×844 dark and light: touch, DPR 2.
- 1440×900 dark and light.

**Captures** (`:19-27`): today, list, list-near, market, stock, stock-weekly and watch.
- 4 × 7 = **28** required PNGs (`requiredCaptureKeys`, `:30`).

**CI実測, PR #146** (merge commit `3f850ffa`, log `scratchpad/r3-tracks/da146/log.txt:2695-2744`):
- `"screens": 28`, `"functional": "86/86"`, `"failures": 0`, `"timing_warnings": 0`.
- The gate printed "Subjective screenshot scores waived by repository owner …".

### 1.2 The 86 functional checks, and what each one needs from the DOM

The count is per group:

| Group | Named checks | Redirects | `market-history-tab-selected` | Total |
|---|---|---|---|---|
| 390 | 14 | 7 | 1 (the 推移 tab is visible below 1024px) | **22** |
| 1440 | 14 | 7 | 0 | **21** |

2×22 + 2×21 = **86**, which matches CI's 86/86. An older report, `scratchpad/harness/clean/report.json` (commit 8cecbbf, 11-03), had 80. It predates `chart-renderer-loaded` and `market-history-tab-selected`.

Selectors used by many checks (design-review.mjs):
- `ROWS = [data-testid="brief-candidate"]` with a `data-symbol` attribute (`:114`, `:336`).
- `CANDLES = [data-testid="brief-price-chart"] rect.bc-up, … rect.bc-down` (`:115`).
- Root `.brief[data-theme]` (`:158`).
- The loading regex `読み込み中|読込中|取得中`, which must be gone from `.brief` innerText within 60 s (`:116`, `:157-165`).
- `[data-testid="brief-conclusion"]` (`:339`).
- `.brief-chart-failed` (`:319`).
- `findCandidates` (`:299-310`) tries `#/brief` first. Failing that, it opens `#/brief/list` and clicks the `.brief-seg button` filters with the texts `買いゾーン`, `ピボット接近`, `選定すべて` and `あと1条件`.

Breaks-if column: T = Today, L = 候補, S = stock screen, M = 市場, W = ウォッチ, D = the 1440 layout.

| # | Check (id) | design-review.mjs | Depends on (selector, text or role) | Breaks if rebuilt |
|---|---|---|---|---|
| 1 | `list-near-filter-pressed` | 368-373 | `.brief-seg button` with text `あと1条件`; `aria-pressed="true"` after click | L (filter renamed or removed, not a `.brief-seg` button, no aria-pressed). Prototype A adds `±5%以内`. Keeping `あと1条件` keeps this check. |
| 2 | `market-regime-region` | 377, 379 | `getByRole('region', {name:'地合い', exact:true})` visible on `#/brief/market` | M; D if the 1440 market pane drops the region or its accessible name |
| 3 | `market-history-tab-selected` (390 only) | 382-387 | `getByRole('tablist',{name:'市場タブの表示'})` → `#brief-tab-history`; `aria-selected="true"` after click | M phone (the tablist name, the tab id, or the history behind a tab) |
| 4 | `market-history-section` | 378, 390 | `getByRole('region',{name:'市場環境の推移', exact:true})` visible, after the 推移 tab on phones | M, D |
| 5 | `market-history-loaded` | 391-393 | No `[role="alert"]` inside that region | M |
| 6 | `chart-renderer-loaded` | 404-407 | No `.brief-chart-failed` text after a row opens | S (the chart box's failure element) |
| 7 | `row-opens-stock` | 335-342, 408 | The first ROW `click()` → hash `#/brief/stock/<SYM>`; `brief-conclusion` visible; ≥ `MIN_CANDLES`=60 candles (contract `:41`) | T (Today rows), L, S (testids, `bc-up/bc-down` classes, ≥60 daily bars by default) |
| 8 | `weekly-range-pressed` | 412-417 | `.brief-periods button` matching `/^週足/`; `aria-pressed="true"` | S (period control class, label starting 週足, aria-pressed) |
| 9 | `weekly-chart-drawn` | 418-420 | `.brief-legend` containing `10週線` attached; >0 candles | S (legend class or weekly-MA wording) |
| 10 | `watch-star-pressed` | 425-428 | `getByRole('button',{name:'ウォッチに追加',exact:true}).first()` → `'ウォッチから外す'` with `aria-pressed="true"` | S (☆ accessible names). D: the 1440 header holds them today (StockScreen.jsx). |
| 11 | `watch-toast` | 429-433 | `.brief-toast` visible; innerText includes `<SYM> をウォッチに追加しました` | the shell's toast (any rebuild of the toast) |
| 12 | `watch-toast-undo-target` | 434-435 | Toast `getByRole('button',{name:'元に戻す'})` box ≥ 44 px (390) / ≥ 24 px (1440) | toast |
| — | (watch capture precondition, a failure if it times out) | 436-439 | `#/brief/watch` shows `ROWS[data-symbol=SYM]`; toast hidden within 10 s | W |
| 13 | `back-returns` | 441-452 | Return to origin and open the first row. Phone: `getByRole('button',{name:'戻る',exact:true})`. 1440: `page.goBack()`. Then the hash equals the origin (`#/brief`) and the first ROW is visible. | T, S (phone 戻る button), D (the 1440 pane navigation must be one history entry that `goBack` undoes) |
| 14 | `theme-toggle-flips` | 453-458 | Button `ライトモードに切り替え` / `ダークモードに切り替え` (exact); `.brief` and `<html>` `data-theme` flip | bar/header |
| 15 | `theme-toggle-restores` | 459-461 | same | bar/header |
| 16-22 | `redirect #/`, `#/compare`, `#/scan`, `#/breadth`, `#/groups`, `#/themes`, `#/?symbol=X` | 463-473; contract 47-55 | Land on `#/brief`, `#/brief/list`, `#/brief/market` or `#/brief/stock/X` | the route table. Keep the four routes and their hashes. |

**Per-capture objective checks** (`capture`, `:257-291`; `briefMetrics`, `:178-243`). Any finding is a blocking failure:
- **Theme:** `.brief[data-theme]` and `<html data-theme>` match the group.
- **axe:** wcag2a / 2aa / 21aa / 22aa on `.brief`, zero violations.
- **Hit targets:** `button, a[href], [role=button], summary, select, textarea, input` must be ≥ 44 px below 768 px and ≥ 24 px otherwise (`contract:37`). Range inputs and links inside `<p>` are exempt.
- **Font sizes:** every visible text node's computed font-size must be in `FONT_SIZES`. That is `tokens.js` `fontSizes` = [11,12,13,14,16,20,26,34,42] (`contract:34`; README:19).
- **Corner radii:** every radius must be in `RADII` = tokens `radii` [4,8,12,16], or ≥ half the box (`contract:35`).
- **Text:** no ASCII hyphen as a minus (`:212`), and no visible NaN / undefined / null / Infinity (`:213`).
- **Layout:** no horizontal overflow (`:235`, `:281`). On phones, `.brief-bar` height + the fixed `.brief-dock` must be ≤ **110 px** (`MOBILE_CHROME_BUDGET`, `contract:39`; `:282`).
- **Analysis date:** `.brief-bar time[datetime]` must equal the published as-of date, and its text must equal `M/D（曜）` (`:230-239`, `:283-287`).
  - Every capture checks it, except `stock` and `stock-weekly` on phones (`requireDate: !group.mobile`, `:410`, `:422`).
  - So the **1440 stock view must keep `<time datetime>` in `.brief-bar`**.
- **Errors:** page errors, console errors, HTTP ≥ 400 and any non-local request (`:119-150`).
- **Reduced motion** (`:480-503`): once per width, open the first row with `reducedMotion: 'reduce'`. Nothing may still be `running` 400 ms later (`REDUCED_MOTION_SETTLE_MS`, `contract:43`).

**Note: a token edit widens the gate.**
- `FONT_SIZES` and `RADII` are read from `src/static/theme/tokens.js`.
- So a token edit changes the allowed type and corner scale with no change to the gate file.
- Review any `tokens.js` change as a gate change.

### 1.3 Timing (warnings only, never `failures`)

**Method** (`design-review.mjs:505-577`; `contract:65-86`):
- 390 and 1440, **dark only**, CDP `Emulation.setCPUThrottlingRate` 4, 3 runs, median (`summarizeTiming`).
- A long-task `PerformanceObserver` (buffered) is installed by an init script on every document (`:508-511`).
- **Prerequisite:** `found[width].origin === '#/brief'` (`:515`), meaning **Today must show `[data-testid="brief-candidate"]` rows on the published data**.
  - Otherwise every metric is "not measured" and becomes a warning.
  - Under the timing waiver, the gate then passes with no number.
  - This is the dependency most likely to break silently if A's Today drops candidate rows in some states.
  - A's prototype keeps a 監視リスト on Today, but whether its rows carry `brief-candidate` is the implementer's choice.

| Metric | How it is measured | Budget (warn above) | CI実測 PR #146 median (runs) |
|---|---|---|---|
| `first_candidate_ms` | `about:blank` → `goto #/brief` → first ROW visible → 2 rAF; `Date.now()` delta (`:524-529`) | 3500 | 390: **1896** (1896/1932/1894); 1440: **2114** (2067/2128/2114) |
| `longest_initial_task_ms` | Max long-task duration in this document up to the read just after the first candidate (`:530`) | 200 | 390: **78** (78/82/71); 1440: **150** (143/150/157) |
| `tab_switch_ms` | Click `nav.brief-tabs a` with text `候補`. Wait for hash `#/brief/list` **and** a `.brief-stack h1` whose text is exactly `候補`, then 2 rAF (`:531-535`). | 400 | 390: **199** (318/198/199); 1440: **376** (426/376/324), the tightest margin: 24 ms, and run 1 was over |
| `stock_open_ms` | Click `今日` (`nav.brief-tabs a`), settle. Click the **2nd** row on 1440 (1st on phone). Wait for the hash, plus an element in `.brief-stockhead h2 span:first-child, .brief-bar-title b span` with the exact ticker text, plus `brief-conclusion`, plus ≥ 1 candle; then 2 rAF (`:539-547`). | 1000 | 390: **455** (625/449/455); 1440: **450** (676/450/407) |
| cold stock open | Fresh page; first row clicked as soon as visible; also records whether `/priceChart[-.]…\.js` was already requested (`:552-568`) | none (reported) | 390: 454 (chunk already requested); 1440: 334 |

**Timing selectors a rebuild must keep** (a miss turns into an interrupted timing note, a warning, not a failure):
- `nav.brief-tabs a` with texts `候補` and `今日`.
- `.brief-stack h1` = `候補`.
- `.brief-stockhead h2 span:first-child` (1440) or `.brief-bar-title b span` (phone) = the ticker.
- The chunk name matching `priceChart`.

### 1.4 Is the waiver or BASELINE_REF bound to a UI, a commit or screenshots?

**Waiver: no.**
- `validateOwnerWaiver` (`design-owner-waiver.mjs:14-28`) checks only these fields:
  - `schema_version`, `scope` = `subjective-screenshot-scores` and `objective_checks` = `required`;
  - `granted_by`, `instruction` and `granted_at`;
  - the `timing_instruction` / `timing_granted_at` pair.
- No commit, tree, UI or screenshot hash is read.
- The dated scored reviews **are** bound (`check-design-review.mjs:19-27`). Each one needs:
  - `observed_commit` to be an ancestor;
  - `git diff --exit-code observed_commit HEAD -- frontend/src frontend/index.html frontend/vite.config.js` to show no change.
- So any UI change skips every dated review and falls to the waiver path (`:41-44`).
- The waiver's `effect` text cites the 2026-10-21 policy, but README:110 says only the required fields are read.

**BASELINE_REF: bound to commit `1e1943e1` (2026-10-06), but not to a UI.**
- It is used only by the financial carry preview:
  - `design-acceptance.yml:84,95-103` (env, SHA format check, fetch, clone, detached checkout and SHA check);
  - `design-financial-carry.mjs:248-249` (`codeIdentity` of the comparison checkout) and `:280` (`DESIGN_COMPARISON_BASELINE`).
- That path runs only when the live publication has a financial release whose generation differs (`:246`).
- "No UI is built from it" (`design-acceptance.yml:92-93`; README:9).

**So the redesign needs no owner decision to pass Design Acceptance**, as long as all objective checks and the 86 functional checks pass. An owner decision would be needed only for these:
1. Revoking or changing `owner-waiver.json`. Its timing deferral is what lets an overrun (e.g. 1440 tab switch > 400 ms) pass as a warning. Without it, `requireObjectiveEvidence` throws (`design-owner-waiver.mjs:45-50`).
2. Changing any budget in `brief-design-contract.mjs`:
   - `MOBILE_CHROME_BUDGET` 110, `MIN_CANDLES` 60, the 44/24 px targets, `REDUCED_MOTION_SETTLE_MS` 400;
   - the `TIMING` budgets 3500/400/1000/200, CPU 4 or 3 runs.
   - The task's owner line names the 1440 longest-task target of 200 ms.
3. Removing or renaming a capture or a functional check. The redesign should instead keep the selectors in 1.2. Editing `design-review.mjs` so that it finds a renamed control is a harness change and should be reviewed as one. It is not a budget change.
4. Changing `BASELINE_REF` is unrelated to the UI. Its default is a reviewed full SHA, and leaving it alone is correct.

---

## 3. The entry chunk

### 3.1 実測 at main 01066eb

`run-build.sh /home/user/screener/.claude/worktrees/ui-plan` → `audit3/r3-harness/build/build-01066eb.json`; log in `ui-abc/gates-build.out`. It ran 23:35 JST.

| Build | Entry | raw | gzip |
|---|---|---|---|
| `npm run build` (the owner line's measure) | `index-*.js` | 382.74 kB | **133.85 kB** (line 134.00: **0.15 kB of room**) |
| design-acceptance build (`/screener/`) | `index-hUwb2OEE.js` | 382.31 kB | 133.64 kB (gzip -9: 133,462 B) |

Every other JS chunk (design-acceptance build, gzip kB as vite prints it):

| Chunk | gzip kB | When it loads |
|---|---|---|
| `react-vendor` | 54.11 | at start (static import) |
| `MarketScreen` | 34.03 (+ its CSS 1.62) | **lazy** |
| `researchWorker` | 29.08 (gzip -9) | **Worker**, prewarmed at start |
| `priceChart` | 18.57 | **lazy** |
| `query-vendor` | 12.52 | at start |
| `charts-vendor`, `mui-vendor` | 0.06 each | empty stubs |

There is no CI check of the 134.00 line:
- `ci.yml` has no size step.
- `vite.config.js:87` sets only `chunkSizeWarningLimit: 1000`.
- The line is the round-3 plan's rule 21 (the owner line in the task) and is measured by `run-build.sh`.

The other size budgets in CI are data-side:
- research index ≤ 8 MB raw / 1 MB gzip (`frontend/tools/export-research.mjs:305`, `check-data-quality-core.mjs:25`, `scan-list-payload.mjs:21`);
- Pages tar ≤ 1,000,000,000 B (`site-size-breakdown.mjs:18`; enforced in `financial-source-renewal-certification.mjs:214`).

### 3.2 What the entry contains (実測, sourcemap)

Method:
- In the harness's throwaway copy `audit3/r3-harness/build/npm-build-01066eb/frontend`, ran `npx vite build --sourcemap --outDir dist-sm` with no `VITE_*` env, the same vite step as `npm run build`. Its entry is 133.88 kB gzip: +0.03 for the sourceMappingURL comment.
- Ran `node ui-abc/gates-tools/attrib.cjs <entry.js> <node_modules>`. It attributes every minified byte to its source through the map.
- Output: `ui-abc/gates-entry-attrib.txt`.
- 94 modules; 380,249 of 382,785 bytes are mapped.
- "est gz" = the module's share of raw × the entry's gzip. **This is an estimate**: gzip is not additive.

By folder: `src/static/brief/` 213.9 kB raw (55.9%, ~74.7 kB gz est); `src/static/` 149.1 kB (39.0%, ~52.1); `transport/` 11.6; `theme/` 3.4. No `node_modules` code is in the entry; vendors are split out.

Largest modules (raw kB, ~gz est):

| Module | raw | ~gz | Which screen needs it |
|---|---|---|---|
| `src/static/fundamentalsExplain.js` | 20.8 | 7.3 | Shared. Today/List use 2 constants and coverage. The stock card uses most of it. |
| `brief/briefCandidate.js` | 16.8 | 5.9 | rows: all screens |
| `brief/StockFundamentalsCard.jsx` | 16.1 | 5.6 | **stock only** |
| `brief/marketTabModel.js` | 14.9 | 5.2 | Today's MarketCard (Today-only) |
| `brief/briefSell.js` | 13.1 | 4.6 | watch sell checks (Today/watch) and stock |
| `src/static/financialCurrent.js` | 12.9 | 4.5 | data client |
| `brief/StockChartCard.jsx` | 12.2 | 4.3 | **stock only** |
| `brief/BriefApp.jsx` | 11.8 | 4.1 | shell |
| `brief/TodayView.jsx` | 11.3 | 4.0 | Today |
| `brief/StockPlanCard.jsx` | 10.9 | 3.8 | **stock only** |
| `brief/chartReadout.js` | 10.2 | 3.6 | **stock only** |
| `src/static/marketLongHistory.js` | 9.8 | 3.4 | Today's market tile via `marketTabModel` |
| `brief/briefEnvironment.js` | 9.2 | 3.2 | Today |
| `researchEngine.js`, `bookTechnicalEvidence.js` | 9.1 each | 3.2 each | shared / stock data |
| `instrumentApplicability.js` | 8.5 | 3.0 | shared |
| `brief/StockVerdict.jsx` | 7.8 | 2.7 | **stock only** |
| `brief/ListView.jsx` | 7.7 | 2.7 | 候補 / ウォッチ |
| `brief/StockVcpCard.jsx` | 6.6 | 2.3 | **stock only** |
| `brief/MarketCard.jsx` | 6.4 | 2.2 | Today |
| `brief/StockSellCard.jsx` | 5.0 | 1.7 | **stock only** |

**Static-import reachability** (`node ui-abc/gates-tools/graph.mjs <worktree>/frontend/src`; a regex import graph from `main.jsx`): 102 modules.
- **Reached only through `StockScreen.jsx`** (12):
  - `PriceChart.jsx`, `StockChartCard.jsx`, `StockFundamentalsCard.jsx`, `StockPlanCard.jsx`, `StockScreen.jsx`, `StockSellCard.jsx`, `StockTemplateCard.jsx`, `StockVcpCard.jsx`, `StockVerdict.jsx`, `StockView.jsx`, `chartReadout.js`, `priceChartLoader.js`.
  - Together about 79 kB raw, **~27 kB gz by share (estimate)**.
- **Only through `TodayView.jsx`:** `MarketCard.jsx`, `briefEnvironment.js`, `briefModel.js`, `marketTabEnvironment.js`, `marketTabModel.js`, `marketTabOnly.js`, `reference/indexSummary.js`.
- **Shared by stock and Today, not the shell:** `buyGate.js`, `positionSizing.js`.
- `useBriefData.js` is in the shell. It carries `useStockData` and its imports into the entry: `bookTechnicalEvidence`, `financialHistory`, `bookFinancialCurrent`, `institutionalEvidence`, `code33Reference`, `bookChartDiagnostics` and `qualificationAudit`. `useWatchSellChecks` (Today/watch) needs part of the same code (`certifyBars`, `stockSells`).

### 3.3 Already lazy, and what sits in the entry

| Code | Status | Where |
|---|---|---|
| `MarketScreen` (市場 tab) | `React.lazy`; prefetched on idle (`requestIdleCallback` timeout 4000, else 1.5 s) | `BriefApp.jsx:30-31`, `:227-230`, `:232` |
| `priceChart.js` (the chart renderer) | dynamic `import()`; prefetched on idle (else 200 ms) | `priceChartLoader.js:10,17` |
| `researchWorker.js` | `new Worker`, prewarmed in `StaticRoot.jsx:16` | `researchWorkerClient.js:6` |
| `App` (non-static) | `React.lazy`; never in the static build | `main.jsx:12` |
| `TodayView`, `ListView`, **`StockScreen` → `StockView` and every Stock*Card**, `MarketCard` (Today's 地合い), `useBriefData` (incl. `useStockData`) | **static, in the entry** | `BriefApp.jsx:20-22` |

The chunk graph is pinned by tests:
- `frontend/tools/precache-assets.test.mjs` (`precacheAssets` throws when the entry chunk is missing, `precache-assets.mjs:23`).
- `frontend/tools/frontend-context-build.test.mjs` and `vite-dependency-boot.test.mjs` (read in §4).
- `design-review.mjs:561` matches the chunk name `priceChart`.
- Source comments promise "Today's entry chunk ships none of this" (`marketTabEnvironment.js:3`, `marketTabOnly.js:3`, `marketHistoryWindow.js:3`).

### 3.4 Where new UI code can live lazily (analysis; timing effect 未検証)

**390 (phone).** The stock screen is never on the first screen: Today, 候補 and ウォッチ are list screens.
- B's stock screen (the large chart, the 4-number strip, the cards) can be a `React.lazy` chunk loaded on a row tap, with an idle prefetch like `MarketScreen`/`priceChart`.
- The first candidate is untouched on 390.
- The cost lands on `stock_open_ms`, which is 455 ms at 390 against a 1000 ms budget. With the prefetch landed it should be close to today's 455 ms; a cold open adds a chunk fetch and parse. 未検証.

**1440 (desktop).** `BriefApp.jsx:145,258`: on 1440, Today, 候補 and ウォッチ render `StockScreen` in the right pane at first load (`selected` = the kept or first symbol).
- So lazy at 1440 does not mean deferred: the stock chunk is requested during the first load.
- It is outside the first-candidate window only if the right pane is allowed to fill after the rows paint (Suspense with a placeholder).
- Its parse may then still add a long task inside or after the `longest_initial_task_ms` window. That metric is read right after the first candidate + 2 frames, and is 150 ms on CI now against 200.
- C's three panes make this sharper: market, table and stock all on one screen at 1440.
- **C's market pane collides with the deliberate split.** Today's MarketCard is in the entry; the full `MarketScreen` (34 kB gz) is lazy. A 1440 market pane built from `MarketScreen` parts would pull that chunk into the first load. Built from Today's `MarketCard` / `marketTabModel` (already in the entry), it would not.

**Candidate seams, smallest risk first** (sizes are estimates by share, not 実測):
1. Lazy-load **`StockView`**, the body of `StockScreen`: the 12 stock-only modules, about 27 kB gz. Make room this way **before** adding B's new code, and put B's new parts (the 4-number strip, the big-chart layout) in that chunk. At 1440 render the pane under Suspense after the list.
2. Move `useStockData` out of `useBriefData.js` into the stock chunk. Keep `certifyBars` / `stockSells`, which Today's sell checks need, where they are.
3. C's 「種別」 column and the 1440-only layout code: a lazy chunk behind `useMediaQuery('(min-width:1024px)')`. The phone never downloads it, but 1440's first load does.
4. A's Today gate (地合いゲート) is Today's first screen, so it must stay in the entry. To fit it, take bytes from 1-3, not from Today.

### 3.5 What-if build (実測; a scratch copy, never the repository)

The edit was made in `ui-abc/gates-exp/frontend`, a copy of the harness's `npm run build` tree:
- `StockScreen.jsx` imports `StockView` through `lazy(() => import('./StockView'))`.
- Its return is wrapped in `<Suspense fallback={null}>`.

Build: `env -u VITE_STATIC_SITE -u VITE_BASE_PATH npx vite build --sourcemap --outDir dist-exp`, the same vite step as `npm run build`. Log: `ui-abc/gates-exp/vite-exp.log`.

| | entry gzip (vite) | entry gzip -9 | new chunk |
|---|---|---|---|
| main (`dist-sm`, same flags) | 133.88 kB | 133,703 B | n/a |
| lazy `StockView` | **104.59 kB** | 104,474 B | `StockView-*.js` 85.17 kB raw / **30.70 kB gzip** (12 modules) |
| lazy `StockView`, design-acceptance config (`VITE_STATIC_SITE=true VITE_BASE_PATH=/screener/`, `dist-exp-static`; log `gates-exp/vite-exp-static.log`) | **104.37 kB** (main's same config: 133.64) | n/a | `StockView-*.js` 85.12 kB raw / **30.66 kB gzip** |

So **about 29.3 kB gzip of room** comes from this one seam, in both configs. The `npm run build` variant is the connected build: it also emits `App`, `ServerApp` and the full vendors.

The chunk holds (`attrib.cjs`):
- `StockFundamentalsCard` 16.1 kB raw, `StockChartCard` 12.2, `StockPlanCard` 10.9, `chartReadout` 10.2;
- `StockVerdict` 7.8, `StockVcpCard` 6.5, `positionSizing` 5.5, `StockSellCard` 5.0, `StockView` 4.3;
- `PriceChart` 2.9, `StockTemplateCard` 2.6, `priceChartLoader` 0.4.

**Caveat from the same build: `priceChartLoader.js` moved into the lazy chunk.** Its module-level idle prefetch of the `priceChart` chunk (`priceChartLoader.js:17`) would then run only after a stock is opened.
- On the phone the chart's renderer would load cold on every first open: two chunk loads in series.
- A real split should either keep `priceChartLoader` imported from the shell, or prefetch the stock chunk on idle the way `MarketScreen` is (`BriefApp.jsx:227-230`).
- The effect on `stock_open_ms` and on the 1440 first load is **未検証**: no timing was run on the what-if.

---

## 4. Specs and unit tests that pin copy, DOM or layout (a rebuild updates them deliberately)

All Playwright specs run on the synthetic fixture `frontend/tests/static/brief-fixture.js` (502 lines):
- analysis date 10/2;
- 30+ symbols, the round-3 `ORACLE_*` rows, `SEC_SYMBOL` = ZZNV;
- helpers `openBrief`, `chartSettled` and `marketTrends`, plus mutators.

`brief-fixture.js` and `brief-oracles.spec.js` are **frozen by round 3**: "a track may only flip its own test.fixme" (`brief-oracles.spec.js:1-4`).

Rough assertion density per spec, from `grep` counts:
- **copy:** toHaveText / toContainText / getByText / hasText / innerText / textContent;
- **class:** `.brief-*` / `.market-*` selectors;
- **testid**;
- **role:** getByRole;
- **geometry:** boundingBox / contentHeight / getBoundingClientRect.

| Spec | lines | copy | class | testid | role | geometry |
|---|---|---|---|---|---|---|
| brief-market.spec.js | 441 | 95 | 74 | 13 | 94 | 7 |
| brief-fundamentals.spec.js | 531 | 90 | 41 | 23 | 10 | 16 |
| brief-chart.spec.js | 1097 | 67 | 56 | 25 | 56 | 28 |
| brief-market-r3.spec.js | 655 | 61 | 62 | 20 | 24 | 31 |
| brief-watch.spec.js | 481 | 56 | 55 | 32 | 58 | 14 |
| brief-decision.spec.js | 445 | 52 | 25 | 14 | 12 | 17 |
| brief-rows.spec.js | 589 | 49 | 37 | 13 | 30 | 23 |
| brief-phone.spec.js | 502 | 48 | 56 | 23 | 62 | 20 |
| brief-market-phone.spec.js | 542 | 46 | 55 | 11 | 49 | 38 |
| brief-invariants.spec.js | 520 | 42 | 16 | 49 | 30 | 2 |
| brief-plan.spec.js | 362 | 38 | 22 | 18 | 22 | 10 |
| brief-compact.spec.js | 419 | 32 | 40 | 11 | 20 | 25 |
| brief-flow.spec.js | 311 | 30 | 26 | 16 | 60 | 5 |
| brief-sell.spec.js | 234 | 21 | 6 | 19 | 2 | 3 |
| brief-freshness.spec.js | 136 | 12 | 19 | 2 | 2 | 10 |
| brief-accessibility / legacy-redirects / oracles | 41 / 47 / 309 | 2 / 1 / 1 | — | 4 / 1 / 9 | 6 / 4 / 0 | 0 |

**Screen → files → what they assert.** Playwright specs are in `frontend/tests/static/`; vitest files are in `frontend/src/static/brief/`.

### Today (`#/brief`)

**Playwright:**
- `brief-phone`:
  - `:27`: the first screen at 375/390, and as a PWA with insets, shows the market answer and a candidate above the dock.
  - `:76`: the TT 8/8 chip is left out on focus rows.
  - `:114`, `:126`: 未確認 and "cannot be fetched", never 0.
  - `:145`: **"Today on desktop is unchanged": verdict, S&P chart and hero date visible at 1440.**
  - `:281-302`: the boot ground before scripts.
  - `:313`, `:376`: row entrance animations.
  - `:392`: each tile is a 44px link to 市場, the focus pool and ウォッチ, 97 px tall at 375.
- `brief-flow`:
  - `:22`: today → stock → back.
  - `:68`: **"Today shows the top five of the focus pool"** and opens the near-pivot list.
- `brief-rows`:
  - `:138`: the focus tile under a hold market.
  - `:391`: the day's event short forms on Today and the list.
  - `:529`: 「土台−40%」.
  - `:547`: the 注目候補 tile counts and its 44px link.
- `brief-watch`:
  - `:51`, `:73`: Today's watch card folds beyond 3.
  - `:112-142`: the watch tile 1件 / 2件 / 0件 / 未確認（上限12銘柄）.
  - `:343`, `:366`, `:386`: the height budgets.
- `brief-market`:
  - `:26`: today's 地合い card leads to the market tab.
- `brief-market-r3`:
  - `:139`: Today's tile strips 独自判定 and keeps 97 px.
  - `:206`: Today unclipped.
  - `:391`, `:423`: 反発n日目 on Today's tile.
  - `:417`: `TODAY_LINE`.
- `brief-invariants`:
  - `:44-84`: one wording per stock on Today.
  - `:452`: no 「あと0」.
- `brief-freshness`:
  - `:37`: the bar age.
  - `:77`: Today's notes.
- `brief-compact`:
  - `:32`: today ≤ 1400 with `region '注目候補'` × 5 rows (`:14`).
  - `:310`: no 注記 fold on the desktop.
- `brief-legacy-redirects`: the heading `'10月2日（金）の判断'` (`:6`).

**Vitest:**
- Components: `TodayView.test.jsx` (26 tests), `MarketCard.test.jsx` (62), `BriefParts.test.jsx` (32), `WhenNear.test.jsx`, `briefPrimitives.test.jsx`, `useWatchSellChecks.test.jsx`.
- The models whose strings the screens print: `briefCandidate.test.js` (53), `briefEnvironment.test.js` (19), `marketTabModel.test.js` (70), `briefModelShared.test.js`, `briefFreshness.test.js`, `briefSell.test.js` (42).

### 候補 (`#/brief/list`)

**Playwright:**
- `brief-rows`:
  - `:58`: filters and search.
  - `:157`: the bar ≤ 48 px and the verified day change.
  - `:201`, `:221`: chips and the rank gutter.
  - `:242`, `:317`, `:462`: rows ≤ 100 px on two chip lines, decimal RS, and 「あと1条件」 naming the unmet rule.
  - `:432`: the 条件 menu and the EPS filter.
  - `:570`: the placeholder and 「並び順」.
- `brief-phone`:
  - `:192`: **all four filters on screen at 320/375/390**.
  - `:434`: すべての候補.
  - `:451`: list, watch and market headings visually hidden, never removed.
- `brief-flow`:
  - `:170`: the tab switch.
  - `:205-297`: stepping, back and the list ends.
- `brief-compact`:
  - `:32`: list ≤ 720.
  - `:330`: tablet 50-row pages.
  - `:348`: leading groups.
- `brief-invariants`:
  - `:89`: no green beside a 参考 conclusion.
  - `:461`: every filter has no 「あと0」.
- `brief-watch`:
  - `:268`: a search never hides a watched stock.

**Vitest:** `ListView.test.jsx` (20), `BriefParts.test.jsx`, `briefCandidate.test.js`.

### Stock (`#/brief/stock/:SYM`; B's screen)

**Playwright:**
- `brief-chart` (24 declarations, many generated tests):
  - `:454`: the period control and 週足 weeks.
  - `:501`: **periods, readout and the chart top above `DOCK_TOP` 788 at 390×844, and the card ≤ 508**.
  - `:546`, `:758`: label collisions on every fixture stock and period at 320/375/390/1440.
  - `:603`: 10/21-day lines on 3か月.
  - `:622`, `:657`: the crossing mark and 未検証の足.
  - `:686`: the touch scrub and 最新足.
  - `:718`: earnings markers.
  - `:791-846`: the 1440 readout beside the periods, with the chart and volume on the first screen.
  - `:856`, `:874`: legend swatch colours.
  - `:895`, `:915`, `:938`: card heights 508 / 476 / 492, legend 34 px.
  - `:974`, `:1019`: the pivot day text.
  - `:1043`: no overflow.
  - `:1067`: the chunk-failure box with a 44px reload.
- `brief-decision` (18):
  - the conclusion card's titles, as literals such as `'TT 1条件未達 — 買いの対象外'`, `'上抜けから25営業日・停滞（次のピボット待ち）'` and `'ブレイク失敗（独自判定）'`;
  - tone classes `tone-zone`/`tone-wait`/`tone-neutral` and `data-gate`;
  - `.brief-tilequal` 「参考」 ×3;
  - the plan region `/^建て玉と損切りの計画/` heading.
  - heights: card ≤ 353, screen ≤ 3136 / 3124 / 3388.
  - `:425`: a pinned stock at 320/390/1440.
- `brief-fundamentals` (21): the SEC card's copy and sources (`出典：SEC XBRL`), Q4 derived marks, and the card height caps at 375/320 and on the desktop.
- `brief-plan` (17): the plan card's height over step 0, its 44px inputs, 「この位置を使う」 moving the chart's stop tag, and no plan beyond the zone.
- `brief-sell` (7): the sell card's qualifier and its height ≤ 232.5.
- `brief-oracles`: each oracle's stock screen renders with no page error at 320/390/1440.
- `brief-invariants`:
  - `:125`: one volume ratio across row, conclusion and readout.
  - `:148-238`: cent rules.
  - `:347`, `:414`: one sell wording and one low-activity state.
  - `:505`: one earnings count.
- `brief-rows`:
  - `:283`: kgrid tiles at 200% zoom.
  - `:451`: the pivot source.
  - `:190`: the desktop header day change.
- `brief-compact`:
  - `:32`: stock ≤ 3400 (ZZNV with `出典：SEC XBRL` visible).
  - `:256`: VCP 未確認.
- `brief-freshness`:
  - `:61`: the stock bar's age before the name.
  - `:95`: the desktop stock header.

**Vitest:**
- Components: `StockVerdict.test.jsx` (28), `StockChartCard.test.jsx` (23), `StockFundamentalsCard.test.jsx` (21), `StockPlanCard.test.jsx` (25), `StockSellCard.test.jsx` (11), `StockTemplateCard.test.jsx` (2), `StockVcpCard.test.jsx` (21) and `.oracles.test.jsx` (4), `StockView.test.jsx` (9), `PriceChart.test.jsx` (3).
- `priceChart.test.js` (50 tests; ~172 DOM asserts on the SVG).
- `chartReadout.test.js` (26), `chartLabels.test.js` (24), `buyGate.test.js` (15), `positionSizing*.test.js` (40), `breakoutHistory.test.js` (24), `pivotBar.test.js`.
- B's 4-number strip (ゾーン上限・ピボット(日付)・損切り・株数) will re-home strings that `StockChartCard`, `chartReadout`, `StockPlanCard` and `StockVerdict` tests now assert in their current places.

### 市場 (`#/brief/market`)

**Playwright:**
- `brief-market` (14):
  - `:26`: the metric switch.
  - `:119-191`: failure, unknown, lagging and older-schema states.
  - `:240-416`: **1440 「過去の傾向 spans the card under the three columns」**, the index chart, the Nasdaq row, 分配日 and the SPY count.
- `brief-market-phone` (18):
  - the verdict and S&P chart on the phone;
  - 12px secondary text;
  - 320 words;
  - `MARKET_LINE` 1288 and the lead above 756 in every variant;
  - the stamp `'◷ 10/1引け・10/2分は再集計待ち'` (`:174`).
- `brief-market-r3` (20): M1a-M9 states (FTD suffix, disclosure fold 44-48 px, M1c, M1e, distribution-day grades, FTD age, 反発n日目, the 銘柄側 line, legends), each with "no taller than before" caps `PRE_M2` / `PRE_P4`.
- `brief-compact`:
  - `:42`: **tabs `['指数','参加度?未確認あり','リーダー?未確認あり','推移']`**; each section ≤ 2400.
  - `:91`, `:114`: keyboard tabs and sticky tabs.
  - `:370`: landscape.
  - `:404`: 320 labels.
- `brief-invariants`:
  - `:472`: every market tab has no 「あと0」.

**Vitest:** `MarketScreen.test.jsx` (9), `MarketCard.test.jsx` (62), `MarketSectors.test.jsx` (2), `marketTabModel.test.js` (70).

### ウォッチ (`#/brief/watch`)

**Playwright:**
- `brief-watch` (18): the tile counts, unlisted symbols with a 44px 外す, a broken setup's rows ≤ 100 px and the event ≤ 78 px, the budgets 520 / 508, and the list across a round trip.
- `brief-flow`:
  - `:86`: ☆, the toast `をウォッチに追加しました` and 元に戻す.
- `brief-rows`:
  - `:221`: no rank gutter.
  - `:338`: 320 rows.
- `brief-compact`:
  - `:32`: watch ≤ 520 with `region 'ウォッチ中の銘柄'`.
- `brief-invariants`:
  - `:269`, `:304`: failed breakouts in the tile.

**Vitest:** `ListView.test.jsx`, `useWatchSellChecks.test.jsx`.

### 1440 layout (C)

Every spec with a `VIEWPORTS.desktop` variant:
- `brief-flow`: the desktop variants of `:22`-`:142`. The stock opens beside the list, and back is `goBack`.
- `brief-phone`:
  - `:145`: Today desktop unchanged.
  - `:376`: rows keep still when a stock opens beside them.
- `brief-compact`:
  - `:269`: the type scale at 1440.
  - `:310`: every footnote in place and open.
- `brief-chart`:
  - `:791-846`: the readout beside the periods; periods and caption ≤ 900.
- `brief-market`:
  - `:240+`: the three columns.
- `brief-market-r3`:
  - `:125`, `:192`, `:440`, `:538`: 「in place」 at 1440.
- `brief-freshness`:
  - `:95`: the bar names the missing sessions with 6 px to spare.
- `brief-decision`:
  - `:425`: a pinned stock at 1440.
- `brief-rows`:
  - `:190`: the desktop header.
  - `:239`, `:314`, `:460`, `:507`, `:568`: the 1440 variants.
- `brief-invariants`: desktop variants (e.g. `:449`, `:503`).
- `brief-accessibility`: axe on every screen at desktop.

C's 「種別」 column (measured fact vs our judgement) is new copy. No spec asserts it yet. The content rules in the task need new assertions for it.

### Design harness unit tests

- `frontend/tools/design-owner-waiver.test.mjs:54` asserts `report.screens` has **28** captures, built from `CAPTURES` × `DESIGN_GROUPS`. Adding or removing a capture changes it.
- `precache-assets.test.mjs` and `frontend-context-build.test.mjs:43-47` pin that `App` / `ServerApp` / `mui-vendor` / `charts-vendor` are never precached in the static build. A new lazy brief chunk is allowed: static lazy routes are precached.

---

## 2. Height and size budgets (frontend/tests/static/** and CI)

### 2.0 How measured (実測, CI-faithful, port 4461, main 01066eb clean)

All runs used Chrome for Testing 147 headless shell plus the CI fonts (`FONTCONFIG_FILE=scratchpad/ci-fonts/fonts.conf`), with the worktree's own `playwright.static.config.js` (its vite dev server) on 4461.

**A. Harness heights.**
- Command: `$H/timing/wait-quiet.sh 0.5 600 $H/heights/run-heights.sh /home/user/screener/.claude/worktrees/ui-plan 4461 /nonexistent-probe 375,390`.
- Ran 23:37:38 → 23:39:15 JST.
- **loadavg** 0.38 0.98 0.98 at start, 1.01 1.11 1.01 at end.
- Output: `audit3/r3-harness/heights/heights-01066eb.json`; log `ui-abc/gates-heights.out`.
- The probe was not run, so there are no chart-card heights from the probe; the card heights come from B below.

**B. Every numeric assertion of the budget tests, logged with its actual value.**
- `ui-abc/gates-budgets/run/` holds copies of the 12 spec files. Only these edits were made:
  - imports made absolute, with line numbers unchanged;
  - `@playwright/test` swapped for `shim.mjs`. The shim re-exports `test` and wraps `expect`, so every numeric matcher appends `{spec:line, title, actual, bound}` to `budget-log.jsonl`, then runs the real matcher.
- The 67 test declarations that hold a height or size assertion (`gates-budgets/targets.txt`) produce **209 tests: 209 passed (5.0 min)**, with 1,588 logged comparisons.
- Ran 23:51:48 → 23:56:50 JST.
- **loadavg** 0.49 0.93 1.05 at start, 3.75 2.37 1.63 at end. Other agents' work raised it during the run. These are layout values, not timings, and every assertion passed.
- Summary: `gates-budgets/summary.tsv`, from `python3 -I gates-tools/summarise-budgets.py`.

The 'stalls' measurement is in B: `brief-decision.spec.js:283`.

### 2.1 The owner-quoted lines against what the specs enforce

The convention is budget − 12 px (round-3 plan rule 9). Not every quoted line is asserted.

| Screen | Owner figure | Enforced as (file:line) | Governing state | Measured at main (375×812) | Margin |
|---|---|---|---|---|---|
| Today | **1388** | `brief-watch.spec.js:378` (≤1388, beside ≤1400 at :376) and `:395` (≤1388) | One session behind, 5 watched (one unlisted) + broken ZZSD + broken watched focus row + rows just under the pivot (`:386`) | **1364** (:395); 1342 / 1319 / 1303 (:378 variants) | **24** |
| Today | 1400 (budget) | `brief-compact.spec.js:24,37`; `brief-market-r3.spec.js:387,417` (`TODAY_LINE = 1400`, not 1388); `brief-watch.spec.js:343,348` (1400 for 5 watched; **1326** for 4 watched + broken) | 4 watched (compact); 4 watched + broken ZZSD | 1252 (compact); **1274 vs 1326** (watch :348); 1313 vs 1400; 1153-1278 (market-r3 :417; 1278 at 320) | 52 at the 1326 cap |
| 候補 | **708** | **Not asserted by any spec.** Only `brief-compact.spec.js:24,37` asserts ≤ **720**. 708 is the harness's line (`heights/summarise.py`). | Default filter 買いゾーン, WATCH 4 | **593** | 127 to 720; 115 to 708 |
| ウォッチ | **508** | `brief-watch.spec.js:304` (≤508 after ≤520 at :302) and `:333` (≤508) | 5 symbols + a questionable base (± broken ZZSD), 注記 folded (`:316`) | **498** (:333); 442 (:302/:304) | **10** |
| ウォッチ | 520 (budget) | `brief-compact.spec.js:37` | 4 watched | 377 | 143 |
| 市場 | **1288** | `MARKET_LINE` in `brief-market-phone.spec.js:81` (used :96, :147, :181, :310, :475, :499, :535) and `brief-market-r3.spec.js:31` (used :115, :149, :230) | Tightest: index series unavailable (:499) and 7 distribution days ▲ (market-r3 :230) | **1280** (both) | **8** |
| 市場 | 1300 (budget) | `brief-compact.spec.js:37` | base | 1219 | 81 |
| stock | **STOCK_LINE 3388** | `brief-decision.spec.js:217`, used `:303`; also `brief-fundamentals.spec.js:510` (≤3388) | Failed breakout ZZNV (decision); ZZQF derived Q4 (fundamentals) | **3240**; 3000 | 148; 388 |
| stock | **STOCK_CAP 3124** | `brief-decision.spec.js:216`, used **`:283`** | **"stalls"**: a breakout still in the zone 25 sessions on (`aboveSince(25)`); also the pullback variant | **stalls 3114**; pullback 3001 | **10** |
| stock | 3136 (= 3056 + 80, no −12) | `brief-decision.spec.js:136` | Hold market (worst of 4) | 3091 (pivot 3044, breakout 3044, earnings 3046) | 45 |
| stock | 3400 (budget) | `brief-compact.spec.js:37` | ZZNV with its SEC card | 3044 | 356 |

### 2.2 Every other height and size budget in the specs

Scope: every numeric bound on a height, a width, a line count or a position in the 12 spec files, measured in B.

Not listed, because they are geometric relations that compare two boxes of the same page rather than budgets (each was run in B or is a pass/fail relation):
- `brief-invariants:260` (row height unchanged within 0.5 while its chart loads);
- `brief-market:257`, `:313`, `:382` (first lines aligned, marks inside the box, line gap under 8);
- `brief-phone:198` (filters inside the width and ≥ 44) and `:229` (focused controls above the dock);
- `brief-flow:75` (≥ 44) and `:223` (scroll restored within 2 px);
- `brief-compact:122-127`, `:147` (sticky tabs under the bar, focus above the dock), `:167` (summaries ≥ 44), `:359-414` (labels inside their card or tab at 320).

A rebuild that moves those boxes must keep each relation.

The measured value is the worst across the test's variants (B). Margin = bound − actual.

| Name / what | Value | Governing state | file:line | Measured at main | Margin |
|---|---|---|---|---|---|
| Market lead (verdict, warnings, first tab) above the dock | ≤ 756 (812−56) | market 375, every variant | brief-compact:49; market-phone :102, :151, :184, :311, :476, :500, :536; market-r3 :116, :148, :180, :259, :281, :329, :482 | worst 685.8 (market-r3 :281, 320, beside the heading, one session behind) | 70 |
| Each market section (tab) at 375 | ≤ 2400 | 推移 tab | brief-compact:54 | 2141 | 259 |
| **"No taller than before" caps (pinned; margin 0)** | `PRE_M2` (market-r3:300), `PRE_P4` (:454), inline caps | M2 FTD-age states, M5/M6/M7 fold/legend states at 320/375/390 | market-r3 :328, :481, :516, :527 | e.g. 1390/1390, 1391/1391, 1341/1341, 1159/1159 (320); 1242/1242, 1219/1219 (375) | **0**. Any growth in these market states fails. |
| Market switch "no taller with the Nasdaq's closes" | ≤ the same state without | 6 states | market-phone:474 | 1150-1245 vs 1168-1264 | 18 |
| Distribution-day head pair | ≤ single ▲ height (40.39) | 320 | market-r3:256 | 40.39 | 0 |
| Market head heights | ≤ 44 / 44.39 / 62.39 | 320, beside switch / heading | market-r3:280 | equal | 0 |
| Fold summaries | 44-48 (52.17 at 320 behind) | guide basis fold | market-phone :111, :533; market-r3 :114, :479 | 44; 52.17 | 0-4 |
| Lag stamp / signals head | ≤ 16 / ≤ 20 | 375 | market-phone :180, :314, :495 | 16 / 20 | 0 |
| Today tiles | 97 ± 2 (115 ± 2 with 5 watched) | 375 | phone:407; market-r3 :98, :156, :428; watch:351 | deviation 0.8 or less | ≥ 1.2 |
| **Today's first candidate above the dock** | ≤ dock.y: 756 (375), 788 (390), 722 / 754 (PWA insets) | the first `region '注目候補'` row, 5 rows, `scrollY` 0 | **brief-phone:27-40** | 563 / 563 / 607 / 610; 591 (390 lagged) | **115** (PWA 375) |
| Bar height | ≤ 48 | 320 three-digit price; stale at 320 | rows:164; freshness:50 | 48 | **0** |
| Phone chrome (bar + dock) | ≤ 110 | stale at 320 | freshness :51, :69, :132; also Design Acceptance `MOBILE_CHROME_BUDGET` | 104 | 6 |
| Candidate / watch rows | ≤ 100 px, ≤ 2 chip lines | every filter, 320-1440 | rows :214, :255, :274, :328, :345, :472; watch:440 | 87.19 px; 2 lines | 12.8 px; **0 lines** |
| Watch event line | ≤ 78 | broken setup, 1440 | watch:448 | 73.6 | 4.4 |
| Conclusion card | ≤ 353 (333+20) | hold market | decision :132, :150 | 339.6 | 13.4 |
| Conclusion card at 390 | ≤ 319 (307+24−12) | ZZNV | decision:394 | 306.8 | 12.2 |
| RS-only card shrinks | < 387.5 (ZZHW) / < 366.5 (ZZZF) | | decision:231 | 306.8 | 59.7 |
| Conclusion title | ≤ 2 lines; 1 line with ≥ 6 px slack | stalls; RS-only | decision :135, :228-229, :282 | 2; 1 line, 13.8 px slack | 0 lines |
| Chips | ≤ 2 / ≤ 3 lines | ZZNV 390 | decision :404, :415 | 2 / 3 | 0 |
| Pivot meter marker | ≤ the 0% tick + 0.5 | | decision:140 | 187.59 vs 188.09 | 0.5 |
| Conclusion, periods, readout above the dock | < 788 | ZZNV 390 | decision :400-401 | 487.8 | 300 |
| **Chart card at 390×844 (`CARD_LINE`)** | ≤ 508 (`CARD_CAP` 520 − 12) | ZZNV/ZZAR/ZZMO every period, weekly, tapped | chart:56, :437 (via `withinBudget`) | **508** | **0** |
| Chart card at 320×640 | ≤ 508 | ZZNV, ZZSD | chart:903 | 508 | 0 |
| Chart card at 375 | **=== 508** (`toBe`) | ZZPG every period | chart:926 | 508 | exact |
| Chart card / legend at 320 | **=== 476 / 492 / 508; legend === 34** | ZZRD/ZZRL (476 daily), ZZNV (508), 週足 492 | chart :949-950 | equal | exact |
| Readout rows / legend lines | ≤ 3 / ≤ 2 (390); ≤ 2 (1440) | | chart :436, :438, :797, :838, :904, :925, :948 | 3 / 2 / 2 | 0 |
| Periods, readout, chart top + 60 above the dock | ≤ `DOCK_TOP` 788 | ZZNV/ZZAR/ZZMO 390 | chart:18, :509-511 | 483 / 539 / 601 | 187 |
| 1440: periods bottom; caption bottom | ≤ 900 | ZZNV 1440 | chart :831, :846 | 447.9; 858.9 | 452; 41 |
| 1440: readout beside the periods | ≤ periods bottom + 1 | | chart:841 | 447.9 vs 448.9 | 1 |
| Fundamentals card | ≤ 140 closed; ≤ 600 open | 390 | fund :170, :175, :331, :347 | 104.5; 593 | 35.5; **7** |
| Fundamentals "does not grow" caps | ≤ 588.1/655, 286/349.5, 657/731.5, 341/344.2/872.7, 847 | bank, Yahoo-only, split, unreadable, ZZQF 1440 | fund :367, :382, :405, :438, :527 | 588 / 286 / 349.5 / 657 / 341 / 344 / 872.5 / 847 | **0-0.2** (pinned) |
| Plan card | ≤ 396 (316+80) | ZZSD 390 | plan :69, :81, :91 | 391.2 | 4.8 |
| Plan card, round 2 | ≤ step-0 + 40 − 12 (396.8 ZZNV, 419.2 ZZSD/ZZHW) | ZZHW (DEEP) | plan :70, :256 | 415.2 | 4.0 |
| Sell card | ≤ 232.5 (228.5+16−12) | 375 | sell:104 | 228.3 | 4.2 |
| Targets | ≥ 44 phone / ≥ 24 desktop | everywhere | many; Design Acceptance `minimumTarget` | 44 | 0 |

### 2.3 CI workflow budgets

| Budget | Value | Where | At main |
|---|---|---|---|
| Design Acceptance phone chrome | ≤ 110 px | `brief-design-contract.mjs:39` | 104 on the fixture (B); CI 0 findings on PR #146 |
| Design Acceptance hit targets | 44 / 24 px | `contract:37` | pass (CI) |
| Design Acceptance min daily candles | ≥ 60 | `contract:41` | pass (CI) |
| Design Acceptance reduced-motion settle | 400 ms | `contract:43` | pass (CI) |
| Design Acceptance timing (warnings only) | first 3500 / tab 400 / stock 1000 / long task 200 ms | `contract:65-70` | §1.3: 1440 tab 376 is the tightest (24 ms); long task 150 |
| Entry chunk | ≤ 134.00 kB gzip | **not in CI**: owner line / plan rule 21, measured by `run-build.sh` | **133.85** (§3) |
| Research index | ≤ 8 MB raw / 1 MB gzip | `export-research.mjs:305`, `check-data-quality-core.mjs:25` | data-side; unchanged by a UI rebuild |
| Pages | tar ≤ 1,000,000,000 B | `site-size-breakdown.mjs:18`; `financial-source-renewal-certification.mjs:214` | the UI is ~0.94 MB of dist (design build `dist_bytes` 941,843) |

### 2.4 Harness heights (A), 375 and 390 (実測)

Content = bottom of `#brief-main .brief-stack`; reduced motion; 1.5 s DOM quiet.

| State | 375 | 390 | Line (375) |
|---|---|---|---|
| today base, 4 watched / 5 watched | 1252 / 1291 | 1252 / 1291 | 1388 |
| today lag 5 / lag 5 + broken ZZSD (governing) | 1319 / **1342** | 1319 / 1342 | 1388 (46 left) |
| 候補 default 買いゾーン | **593** | 593 | 708 |
| ウォッチ 4 / 5 / 5 + broken | 377 / **442** / 442 | same | 508 |
| 市場 base / lag | 1219 / **1228** | 1219 / 1219 | 1288 |
| 市場 FTD-conflict (rows under the 50-day line + `confirmed_uptrend`, no index state) / + lag | **1300 / 1322** | 1277 / 1299 | 1288: **over by 12 / 34**. No spec asserts this state. The spec variant `compose(ftdUpgraded, belowFiftyIndex)` reads 1223 / 1245 (market-phone :475). Same values at bd20584. |
| stock ZZNV / ZZAR / ZZHW / ZZZF / ZZSD broken | **3044** / 2488 / 2591 / 2567 / 2615 | 2954 / 2465 / 2591 / 2567 / 2615 | 3388 |
| chart card (every stock) | 508 | 508 | 508 |

### 2.5 The prototypes' 390 heights against these lines

The prototypes' own notes (`design-r3/*/notes.md`) are prototype numbers, one state, synthetic rows. They are not app measurements.

| Screen | A (a-gate notes:33-36) | B (b-chart notes:34) | C (task: Today 1,318) | App line (375) | Main (390) |
|---|---|---|---|---|---|
| Today | **1974** | 1993 | 1318 | 1388 | 1252-1342 |
| 候補 | **1170-1245** (7 rows per filter) | 1153-1258 | n/a | 720 (708) | 593 |
| ウォッチ | **917** | 1251 | n/a | 508 / 520 | 377-442 |
| 市場 | **1856** | 1202 | n/a | 1288 / 1300 | 1219 |
| stock | **3870** (short 3825, ext 3316) | 3316 (short 3592, ext 3088) | n/a | 3388; STOCK_CAP 3124 | 2954 (ZZNV) |

- **A's gate card ends at 785 px with the dock at 788** (a-gate notes:33). `brief-phone.spec.js:27-40` requires the first 注目候補 row (of 5) to end above the dock with `scrollY` 0, in 5 states. Main: 563-610 against 722-788.
- **Inference from the prototype notes, not measured in the app (未検証):** drawn as A drew it, Today would fail that test, and the A/B figures above exceed every Today/候補/ウォッチ/市場/stock line.
- **A's phone filter row** (a-gate notes:70): the four filters sit in one sideways-scrolling 44px row, with the fourth chip (あと1条件) cut by the card edge. A's filters are ±5%以内・買いゾーン・ピボット接近・あと1条件, with no 選定すべて.
  - `brief-phone.spec.js:192-200` asserts 4 buttons in `group '絞り込み'`, each inside the viewport, and `scrollWidth − clientWidth === 0` at 320/375/390. Measured at main: it passes.
  - Design Acceptance's `findCandidates` (`design-review.mjs:305`) clicks `選定すべて` when Today, 買いゾーン and ピボット接近 have no rows. A missing button there makes the click time out, an interrupted step and so a **failure**.
- **B's 4-number strip sits inside the chart card**, between the price pane and the volume/RS panes (b-chart notes:204; the strip starts at 627 px on the 390 page, :196).
  - Today the card is pinned: `CARD_LINE` ≤ 508 with 0 margin (chart:437, :903); **exact** `toBe(508)` at 375 (chart:926); `toBe(476/492/508)` and legend `toBe(34)` at 320 (chart:949-950).
  - The plan must say whether the strip is inside `.brief-chartcard`, where it counts toward 508 and changes the exact pins, or below it.
  - B's larger chart changes these pins either way. Raising 508 is a phone-height decision (the owner line).
- Whether the first-screen goal or any cap yields is an **owner decision, reported with these numbers**. The plan should otherwise fit A's content inside the current lines.

---

## 5. 未検証, and process notes

**未検証:**
- Any timing at main in this sandbox. The timings in §1.3 are CI's from PR #146.
- The timing effect of a lazy `StockView` at 390 (`stock_open_ms`, cold and warm) and at 1440 (`first_candidate_ms`, `longest_initial_task_ms`).
- The prototypes' heights inside the app.
- Whether A's Today rows will carry `data-testid="brief-candidate"` on real data in every market state, which the timing needs.
- The published data's own heights. Every spec height here is on the synthetic fixture.

**Process.**
- Ports 4461 and 4462 are shared by this workflow's agents.
- My first, killed full-suite run left an orphaned vite on 4461. I killed it, and the budget run then waited for a free port. Another agent's `ui-abc/shots-run` Playwright run was on 4461 during that window.
- Nothing of mine listens on 4461 or 4462 now.
- I deleted my own large outputs: `dist-sm`, `gates-exp/frontend` and the run's `test-results`.
- I kept the harness tree `snapshot/trees/01066eb` and `build/npm-build-01066eb`, which other agents may reuse.

**Files:**
- `ui-abc/gates-build.out`, `gates-entry-attrib.txt` and `gates-heights.out`;
- `gates-budgets/{budget-log.jsonl, summary.tsv, run.log, targets.txt, run/*.spec.js, run/shim.mjs, run/pw.config.mjs}`;
- `gates-exp/{vite-exp.log, vite-exp-static.log}`;
- `gates-tools/{attrib.cjs, graph.mjs, summarise-budgets.py}`;
- `audit3/r3-harness/build/build-01066eb.json` and `heights/heights-01066eb.json`.
