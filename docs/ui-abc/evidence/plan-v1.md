# UI design implementation plan: A (market gate) + B (stock screen) + C (1440 three panes)

Conductor's plan, written 2026-11-16 JST. Base: main `01066ebe` (worktree `/home/user/screener/.claude/worktrees/ui-plan`, read-only).
Inputs: `ui-abc/survey-gates.md` (G), `ui-abc/survey-design.md` (D), `design-r3/{brief-common.md, final-r7.json, gate-r7.json, */notes.md, present/img}`, and the code cited below.
This file plans; nobody edits the repository in this workflow. Every number is tagged **実測** (measured, with its source), **CI実測**, or **未検証** (an estimate a worker must measure before relying on it).

Paths: `S` = the session scratchpad, `H` = `S/audit3/r3-harness`, `WT` = a worker's own worktree, `B` = `frontend/src/static/brief`.

---

## 0. Rules for every package

1. **Owner lines are never raised.** Entry chunk <= 134.00 kB gzip (`npm run build`, `H/build/run-build.sh`). Phone heights at 375x812: Today 1388, 候補 708 (asserted only as 720; we assert 708 from S1 on), ウォッチ 508, 市場 1288, stock `STOCK_LINE` 3388 and `STOCK_CAP` 3124, chart card 508 (exact pins), bar 48, bar+dock 110, plus every "no taller than before" pin in G §2.2. A package that cannot fit **stops and reports the measured overrun**; it never edits a cap upward, never changes the build target, never edits `brief-design-contract.mjs` budgets, `owner-waiver.json`, `tokens.js` scales (a token edit widens the Design Acceptance gate), transport-hash methods, the 90% bar, selection, the trend template or Code 33.
2. **A lowered or re-homed assertion is a deliberate test change**: each one is listed in the package with its reason, and again in `docs/ui-abc/<slice>.md`. Tests are never deleted to pass.
3. **`tests/static/brief-fixture.js` and `brief-oracles.spec.js` are frozen** (round 3). New states are opened through mutators inside new spec files; no fixture rows are added (that would break probe and dump identity).
4. **Content rules** (each violation is a blocker; `design-r3/brief-common.md` §2): a missing value is never 0 / あと0 / 達成 / eligible; stale data never reads as today's; RS推計 is never IBD RS; Code 33 is a bonus; the trend template is the 8 published conditions; our thresholds say 独自設定 / 独自判定 in visible text; negatives use U+2212; measured facts and estimates are distinguishable; no new score; the gate and the 0% cap are unchanged; nothing reads as a buy recommendation; one name 上抜けの維持; stock-side numbers carry no colour and no ▲ and say 目安は変えません; a positive day change still reads as up.
5. **No model identifiers and no tool-named directory paths in any committed file** (minor A8's lesson).
6. Conventional Commits, scope `frontend` (or `docs`). One PR per slice, branch `claude/ui-abc-s1|s2|s3`. Issues tracked with bd (`AGENTS.md`): one bd issue per package, claimed and closed by its worker.
7. Vocabulary follows `CONTEXT.md`; new terms are added there in the slice that introduces them (§6).
8. Timing is measured only on an idle machine: `H/timing/wait-quiet.sh 0.5 600 <cmd>`, `/proc/loadavg` recorded before and after, always **interleaved against main in the same run**, never against a number in a file. Ports 4461 and 4462 only; never two vite servers on worktrees that share `node_modules`.
9. Commit before measuring (the harness reads `git archive HEAD`).

---

## 1. Decisions taken in this plan

| # | Decision | Why |
|---|---|---|
| D1 | The first package of S1 makes room: `StockView` becomes a lazy chunk. | Entry is 133.85 of 134.00 (実測, `build-01066eb.json`). The what-if build gives entry 104.59 and a 30.70 kB `StockView` chunk (実測, G §3.5). Everything the three slices add to the stock screen then lands in that chunk. |
| D2 | The market band lives **inside the existing two-line bar** on the phone (0 px), and as a chip in the bar at >= 1024. | A separate 44 px row fits only 候補 (593 + 44 = 637 <= 708). It does not fit ウォッチ (498 + 44 = 542 > 508) or the stock screen's governing state (3114 + 44 = 3158 > 3124). All three figures are 実測 at main (G §2.1). One form on every screen beats a row on one screen. The separate row is owner option O1. |
| D3 | Today's gate card on the phone is **compact with a closed fold**: the answer, the figure, the verdict, one 根拠 line and the 再開 status are in the first fold; the full 根拠, the two 再開 conditions, the 指数側 and 銘柄側 boxes are in a fold that is closed on the phone and open in place at >= 1024. It replaces the 地合い tile and the phone's MarketCard facts block. | A's card is 785 px and A's Today 1,974 px (prototype, 390). The app's Today has 24 px of room in its governing state (1364 vs 1388, 実測) and the first 注目候補 row must stay above the dock (`brief-phone.spec.js:27-40`; 115 px of room, 実測). Prototype-exact is owner option O2. |
| D4 | B's 4-number strip is a **sibling block directly under `.brief-chartcard`** (visually attached), not inside it. The chart keeps its size. | The card is pinned at 508 with 0 margin and by exact `toBe(508/476/492)` (`brief-chart.spec.js:437,903,926,949-950`). B's own form (strip between the price pane and the volume pane, taller price pane) needs a split SVG and new pins: owner option O3. |
| D5 | On the stock screen the three tiles, the pivot meter and the chips leave the call card. Phone order becomes: call (地合い line, 銘柄 line) -> chart card -> strip -> chips -> cards. The pivot meter (`StockVerdict.jsx:92-101`) is not drawn on the stock screen any more: it prints no number of its own (a scale, and ピボット比 only in its accessible name; nothing when the row is stale). ピボット比 stays in the readout and the call's sub line; the meter's one sentence for an unknown pivot (「ピボットを確認できないため位置は未確認です。」) moves to the strip's ピボット cell unchanged; 「（参考）」 stays as the strip's qualifier. At >= 1024 the 価格の位置 list takes its place. | Main at 390: call 56-363, tiles 213-289, chart card 373-881, svg 488-828, dock 788 (実測, `shots-main/states/geom-phone.json`): the chart ends under the dock. Removing 76 px of tiles, the meter and the chips from above the chart lifts the whole chart into the first fold and pays for the strip and the new 地合い line inside `STOCK_CAP` (10 px of room, 実測). |
| D6 | A's 価格の位置 list ships at >= 1024 only (in the stock pane, under the strip). | On the phone it costs about +56 px closed and +290 px open (未検証 estimate, 8 rows) against 10 px of room: owner option O4. |
| D7 | **仮の損切り / 損切りに到達 is a separate behaviour item (BEH-1), counted A's way (lows from the bar after the breakout bar), shown as one row on the sell card, and kept outside `tally()` and `BREAKDOWN_KEYS`.** No existing count, chip, tile, gate or plan moves. | The decision "A's window, 判定なし" is taken. Whether a hit also counts as a holder's sell sign is a second, larger behaviour change: on the 11-12 rebuild 58 non-zone rows would gain a hit, 55 of them among the 104 fell-back rows (実測, `ui-abc/stop-window.jsonl`). The prototypes did print 「該当 n件」 for it, so this is stated here plainly and listed as BEH-2 (not in these slices; needs its own decision with the count diff). |
| D8 | The stop's number has one source: `provisionalStop(pivot)` in a new small shared module `B/stopLevel.js` (so `briefSell.js`, which is in the entry, does not pull `positionSizing.js` back out of the stock chunk); `positionSizing.js` imports it for the plan's own stop, so it is the same expression (`entry x (1 - 7/100)`), rounded with `toFixed(2)`. A vitest loops over every cent pivot from 10.00 to 500.00 (49,001 values) and asserts that this value equals the tile's printed `toLocaleString` value (未検証 until that test runs). The strip, the plan card, the chart tag and the stop row all print that value; the row compares lows against it in cents. One stated exception to "one number per level": a stock whose plan is blocked (extended, low activity) has no plan stop, so its strip cell reads `—` 未計算 while its stop row names 仮の損切り with the number; the two carry different names (the plan's 損切り, and 仮の損切り＝ピボットの −7.0%), and the row prints its own basis. | The plan's float stop and a half-up integer-cent stop differ by one cent on 215 of 49,001 cent pivots (実測, D §3.1). Two formulas would put two numbers on one screen. No plan value changes with this choice. |
| D9 | The not-judged word becomes **判定なし on every sell row** (today: 判定せず at 5 sites in `StockSellCard.jsx`, about 11 asserts). Copy only. | Gate ruling S3: one word for one state. A new row saying 判定なし beside rows saying 判定せず is exactly what minor B3 forbids. |
| D10 | Fell-back stocks keep the app's pivot-basis plan (101 of 104 on the rebuild, 実測). The prototypes' 「計画なし」 for them is **not** adopted. | Removing the plan is a `positionPlan`/`buyGate` behaviour change nobody decided. The stop row is judged against the same number either way. |
| D11 | Three panes from **1400 px**; 1024-1399 keeps today's two panes (the pane minimums 320 + 480 + 520 plus 40 px of gaps and 40 px of padding need 1400). Pane widths at 1440: market 320, table about 500, stock about 540 (the chart stays wider than `NARROW_CHART_WIDTH` 480). The 市場 tab stays the full single-column `MarketScreen`. | C's rail is 360 and its stock pane 472 (prototype). A 472 px pane would put the app's chart under its own narrow-chart threshold and re-place every label at 1440. 540 keeps the wide placer; the probe's 1440 views still change and are re-audited (S3-P4). |
| D12 | The 1440 market pane and Today's gate card read only entry modules. The few small pure readers they need that sit in the lazy market chunk today (`publishedMarketContext`, `REGIME_NAMES`, the stock-side figures of `stockSideLine`) are **moved** into one new entry module that the market chunk imports back. `MarketScreen` (34 kB) stays lazy. | At >= 1024 folds are open in place and C's pane shows those figures at first load, so a lazy fold body would load at once anyway. D1 frees about 29 kB; the move is estimated at 1-2 kB gzip (未検証; measured in S1-P2). |
| D13 | 「止めているもの」 in the 1440 table is built from row-level fields only (the market verdict, the row's own position, chips and unmet rule). It never calls a bar-based check. | List rows have no bars. An invariant test ties the row's first non-market blocker to the row's existing chip and to the stock screen's gate kind, so table and stock screen cannot disagree. |
| D14 | 再開の条件 is derived from `modelMarket`'s own rule order (`portfolioPlan.js:25-43`) by a pure function with a property test: **all conditions met <=> `cap > 0`**, for every combination of 50-day, 200-day and regime. | A condition list typed from A's one state would be a second gate. The test makes drift impossible. `modelMarket`'s return value is **not** changed (`portfolioPlan.test.js:66` pins it with `toEqual`): the two line states come from a new sibling export `marketLines(rows)` in `portfolioPlan.js` that applies the same `observed` filter. |
| D15 | Design Acceptance: target **0 edits** to `design-review.mjs` and `brief-design-contract.mjs`. Every selector in G §1.2 and §1.3 is kept (§5.6 lists each one and the package that must keep it). | A harness edit is reviewed as a gate change; keeping selectors is cheaper and safer. |
| D16 | Phone 候補 keeps the 2x2 filter grid with all four filters visible. A's one-row scroller is not built. | `brief-phone.spec.js:192-200` and Design Acceptance's `findCandidates` (clicks 選定すべて) both depend on it; minor A1 then does not arise. |

---

## 2. Slice S1: market band on every screen + Today's first fold (A)

Goal: on every screen and in every market state the reader sees the market verdict and the new-buy guide first; Today's first phone fold answers "can I buy, why, what reopens buying".

### S1-P0 Re-base and yardstick (scratch only; no repository edit)
- Confirm `git diff --stat bd205842 01066ebe -- frontend backend tools` is empty (D found it empty); then `H/snapshot/out/bd20584/counts.json` is main's counts baseline.
- Produce on `01066eb`, CI-faithful, port 4461: `H/probe/run-probe.sh`, the oracle probe, `H/dump/run-dump.sh`, `H/heights/run-heights.sh` (exists), `H/build/run-build.sh` (exists). Record the sha256 of each.
- Build the **state matrix** tools in `S/ui-abc/yard/` (§5.1): `matrix.spec.mjs` (opens every state of §5.2 with the worktree's own fixture helpers), `values.mjs` (text extraction), `shots.spec.mjs` (screenshots). Run all three on main and keep `yard/main/`.
- Timing baseline method (§5.7): a scratch spec `yard/timing4.spec.mjs` that repeats Design Acceptance's four metrics (same selectors, CDP CPU 4x) on the production build served with the 11-12 rebuild (`H/snapshot/scripts/serve.mjs`), 7 runs, two trees interleaved.
- Checks: every tool is deterministic twice on main (byte-identical output) before any slice uses it.

### S1-P1 Lazy stock seam (pure refactor; nothing visible changes)
- Files: `B/StockScreen.jsx` (`const StockView = lazy(loadStockView)`, `Suspense`), new `B/stockViewLoader.js` (one `import('./StockView')`, loaded/failed store like `priceChartLoader.js`), `B/BriefApp.jsx` (imports `./priceChartLoader` so its idle prefetch of the chart renderer stays in the shell; idle prefetch of the stock chunk beside the existing `loadMarketScreen` prefetch at `:227-230`; on a phone `open()` navigates when `loadStockView()` **settles** (resolved or rejected), so the forward view transition never captures an empty fallback and a failed load still reaches the failure box), a small error boundary with a 44 px 再読み込み button (same words and behaviour as the chart chunk's failure box, `brief-chart.spec.js:1067`).
- 1440: two variants are built and measured, then one is kept. **A**: when `wide`, the chunk import starts at module start and the pane renders under `Suspense` (placeholder keeps the pane's box). **B**: the pane mounts inside `startTransition` after the first rows have committed. The noise band is set before any reading: main is run against main once with the same script, and the larger of the two medians' difference and 10 ms is the band. Rule: keep the variant whose `longest_initial_task_ms` and `tab_switch_ms` medians are both <= main's plus that band in the interleaved run; if both qualify, the lower `tab_switch_ms` wins (main CI: 150 and 376 against budgets 200 and 400; the tab switch has 24 ms of room). If neither qualifies, stop and report.
- Tests changed deliberately: `StockView.test.jsx` and callers that render `StockScreen` synchronously (await the lazy chunk); `frontend/tools/precache-assets.test.mjs` / `frontend-context-build.test.mjs` only if they enumerate chunks (a new static lazy chunk is allowed and precached). New: `StockScreen.test.jsx` (fallback, failure box, retry), a Playwright case in a new `tests/static/brief-lazy.spec.js` (blocked stock chunk -> failure box with a 44 px reload; phone open after idle shows no empty frame).
- Checks: vitest, lint, full static Playwright; **probe, dump, `values` and the screenshot matrix byte-identical to main**; `counts.json` cmp-identical; build size (expect entry about 104.6 kB, chunk about 30.7 kB: 実測 what-if; re-measured here); `timing4` interleaved with main (all four metrics, 390 and 1440).
- Optional, same package: `frontend/tools/entry-size.test.mjs` asserting the entry <= 134.00 kB when a `dist` exists (the line is enforced nowhere in CI today, G §3.1). Wiring it into `ci.yml` is 未検証 and is proposed in the PR, not assumed.

### S1-P2 Market gate model (pure functions, entry)
- New `B/marketGate.js`:
  - `marketBand(market, { loading, suffix })` -> `{ verdict, guide, kindWords, short, tone }` for every state of the table below. It reuses `modelMarket`'s label and `capText`; it adds no state.
  - `resumeConditions(market)` -> the conditions in `modelMarket`'s rule order: (1) SPY終値が200日線・50日線の上 (each line named; only unmet lines are listed as unmet), (2) 局面判定が上昇トレンド／上昇に圧力. Each is `met | unmet | unknown`. Shown only when `cap === 0` and the state is known.
  - `gateFacts(brief)` -> rows `{ key, label, value, reading, kind }` with `kind` one of 実測 / 独自判定 / 独自設定 / 実測・基準は独自設定. S1 prints the kind as a tag; S3 prints it as the 「種別」 column.
- `portfolioPlan.js`: new export `marketLines(rows)` -> `{ above50, above200 }` (true / false / null) with `modelMarket`'s own `observed` filter. `modelMarket` and its return value are untouched; the existing tests pass unchanged.
- New `B/marketGateFacts.js` (entry): the moved pure readers of D12. `reference/marketTabStudy.js` and `marketTabGroups.js` import them back; their exports and tests keep their names.
- Tests: `marketGate.test.js` with the **property test of D14** over all 3 x 3 x (5 regimes + null + conflicting) inputs; one case per row of the state table; `marketTabModel.test.js`, `MarketScreen.test.jsx`, `marketTabStudy` tests unchanged and green.
- Checks: build size delta of this package alone (未検証 estimate +1.5 to +3 kB entry); dump/probe/values identical to S1-P1 (nothing renders yet).

**Band and gate card in every market state** (S1-P3 and S1-P4 implement exactly this; recipes in D §4.1):

| State (recipe) | Band (bar) | Gate head | 再開の条件 / signs |
|---|---|---|---|
| 上昇トレンド, cap 50% (default) | 地合い 上昇トレンド（独自判定）・新規買い 最大50%（独自設定） (the cap always through `capText`; the tile's own form 「検討可・目安≤50%」 goes with the tile) | 新規の買いを検討できる (the existing verdict sentence of `marketCardView`) + figure 最大50% | no 再開 block; 根拠 only. The tile's suffix and its full note sentence (`marketTileNote`, e.g. 「Nasdaq総合は安値9/29から反発3日目。4日目以降の+1.2%上昇待ち（独自判定）。判定と目安は変わりません。」) are kept word for word: the suffix on the sign line, the sentence in the fold and in the accessible text |
| 上昇に圧力, cap 25% | same form, 最大25% | same form | none |
| 50日線割れ (`below50Rows`) | 地合い 50日線割れ（弱含み・独自判定）・新規買い 0%（独自設定） | 買いは控える + figure 0% | 1 unmet (50日線), 200日線は維持; 2 from the regime; 反発n日目 as published |
| FTD upgraded under the 50-day line (`compose(ftdUpgraded, belowFiftyIndex)`) | as above (label and cap unchanged) | 買いは控える + 0% | 1 unmet; 2 **met** (regime is confirmed_uptrend); sign line: FTD確認済み, with 前回のFTD M/D when older than 25 sessions (existing rule) |
| 長期トレンド警戒 (`below200`) | 地合い 長期トレンド警戒（独自判定）・新規買い 0%（独自設定） | 買いは控える + 0% | 1 unmet (200日線; the 50-day line stated as it is) |
| 新規購入を抑制 (above both lines, other regime) | 地合い 新規購入を抑制（独自判定）・新規買い 0%（独自設定） | 買いは控える + 0% | 1 met; 2 unmet with the regime's name |
| 市場未確認 / 市場条件未確認 (`fail:'manifest'`, mixed rows) | 地合い 市場未確認・買いは見送り | 買いは見送り; **no % figure** | every condition 未確認; never 未達 / 達成 / 0% |
| loading | 地合い 読込中 | skeleton, no figure | none |
| one session behind (`historyEnd`) | verdict from the rows as today; date line keeps the stale form | as the verdict | signs withheld as today (`marketTileSuffix`), printed as 未確認（M/D分は再集計待ち） |
| index series missing (`fail:'series'`) | verdict from the rows | as the verdict | index-side facts 未確認, never 0 |
| FTD conflict / basis conflict | unchanged by the conflict | unchanged | the existing 一致していません sentence (`marketTabModel.js:121-127`) and the cause line stay inside the fold |

### S1-P3 The band in the bar
- Files: `B/BriefApp.jsx` (bar, `:238-252`), `B/BriefParts.jsx` (`MarketBand`), `B/brief.css`.
- Phone, 候補 and ウォッチ: bar line 1 is the band (a link to 市場, the whole bar title is the 44 px target), line 2 keeps `BarDate` (`time[datetime]`, `M/D（曜）`, the stale form). The product name stays on Today's bar and in the document title. The 市場 screen's bar is unchanged (product name and date): that screen's first block is the verdict itself.
- **Visible 独自 label rule (content rule 6):** at every width and state the band's visible text contains 独自. Ladder of forms, first that fits one line without growing the 48 px bar: full (as in the table) -> 「地合い 50日線割れ・新規 0%（独自判定・独自設定）」 -> 「50日線割れ・新規 0%（独自）」. The full sentence is always in the accessible name. A Playwright assertion checks the visible text at 320 / 375 / 390 in the default, 0%, unknown and stale states.
- Phone, stock screen: both bar lines are already used (ticker and quote; stale age and name). Ordered options, **the first one that measures inside every stock cap ships** (未検証 until measured): (1) the band as the first 12 px line of the call card on days when the call's title is not already the market sentence, paid for px-for-px by the call card's own row gap (conclusion pins `<= 353` and `<= 319` must hold; stalls must stay <= 3124); (2) bar line 2 becomes `band short form・name` with the sector dropped below 1024; (3) neither fits: the phone stock screen keeps today's marketHold title on 0% days and gets its 地合い line with S2-P1; recorded as a deviation in `docs/ui-abc/s1.md`.
- >= 1024: a chip in the bar, right of the date (C's top bar): 「地合い 50日線割れ 独自判定・新規買いの目安 0% 独自設定」. The 1440 stock header's age line (`brief-freshness.spec.js:95`, 6 px to spare) is not touched; the chip must not push the bar's date.
- Tests changed deliberately: `brief-rows.spec.js:157` (bar <= 48: unchanged bound, new content), `brief-freshness.spec.js:37,50,69,132` (bar age: bound unchanged), `brief-phone.spec.js:451` (headings), `ListView.test.jsx`, `BriefApp` tests. New `tests/static/brief-band.spec.js`: every state of the table x {候補, ウォッチ, stock} x {320, 375, 390, 1440}; heights 候補 <= 708 (new assertion of the owner line), ウォッチ <= 508, bar <= 48, bar + dock <= 110.
- Checks: heights (expect 0 px change on 候補 / ウォッチ: 未検証), Design Acceptance date check (`.brief-bar time[datetime]`) by a local run of the contract's `briefMetrics` if feasible, else by the spec above.

### S1-P4 Today's gate card
- Files: new `B/TodayGate.jsx` (entry), `B/TodayView.jsx` (`TodaySummary` loses the 地合い tile; the phone's MarketCard facts move into the gate fold), `B/MarketCard.jsx` (>= 1024 keeps the index chart and the verdict block; exactly **one** region named 地合い per page), new `B/brief-gate.css`, `B/briefPrimitives.jsx` (`Expander` reuse).
- Phone, closed (first fold), top to bottom: kicker 「地合い・M/D（曜）引け」 + 「市場の詳細 ›」 (44 px); headline (買いは控える / 新規の買いを検討できる / 買いは見送り) with the guide as a right-aligned figure (minor C7); verdict line with 独自判定 and 「0%＝新規建ての上限（口座比・独自設定・未検証）」; one 根拠 line from `verdictBasis` with 実測; one status line 「買いの再開：2条件中 n条件（独自設定）」 and the sign line (反発n日目 / FTD) from the published record (the prototypes' 未取得 was a limit of the study, D §1); fold summary 「根拠と再開の条件」 (44 px).
- Fold body (closed on the phone, open in place at >= 1024): 根拠（指数側） with 「分配日 SPY n日（実測）＝○参考（5〜6日・独自設定）」 on one row (minor A6; the SPY count only when the manifest's `market_context` carries it, otherwise 未取得: its presence in the publication is 未検証); 買いの再開 1 and 2 with 未達 / 達成 / 未確認; 上昇再開のサイン（参考・目安は動きません）; 指数側 box (the four facts Today shows now, each with its kind tag); 銘柄側 box 「参考・目安は変えません」 (TT達成, 上抜けの維持 n%（a/b件）, リーダーの健全度), no colour, no ▲.
- Then the two remaining tiles (注目候補, ウォッチの注意) as a two-up row, the 注目候補 card, the watch card, the notes: unchanged.
- Budget on the phone (all 未検証 until measured; main's block = tile row 97-115 px + market card, first row ends at 563-610): the gate card plus the two-up tiles must not exceed the block they replace by more than **24 px** in the governing state (`brief-watch.spec.js:395`: 1364 -> <= 1388) and the first 注目候補 row must end above the dock in all five states of `brief-phone.spec.js:27-40`. Trim order if over: the sign line joins the status line; the 0% definition moves into the fold; the kicker joins the headline row. If still over: stop and report.
- Tests changed deliberately (why: the 地合い tile and the phone facts block no longer exist as such): `brief-phone.spec.js:27` (same bound, new locator for the market answer), `:392` (two tiles of 97 px + the gate's 44 px link instead of three tiles), `brief-market-r3.spec.js:98,139,156,391,423,428` (tile suffix assertions move to the gate's sign line; `TODAY_LINE` there becomes 1388, the owner's figure, was 1400), `brief-market.spec.js:26`, `brief-rows.spec.js:138,547`, `brief-watch.spec.js:112-142,343-395` (bounds unchanged), `brief-compact.spec.js:32,310`, `brief-freshness.spec.js:77`, `brief-invariants.spec.js:44-84,452`, `brief-phone.spec.js:145` (1440 Today: verdict, S&P chart and hero date still visible; the card is new), `TodayView.test.jsx`, `MarketCard.test.jsx`. New `tests/static/brief-gate.spec.js`: every state of the table at 320 / 375 / 390 / 1440, fold closed and open; never 0% / 未達 / 達成 in the unknown, loading and manifest-failure states; the 根拠 words equal the market tab's `verdictBasis` words.
- Timing dependency: Today keeps `[data-testid="brief-candidate"]` rows in every state that has focus rows (Design Acceptance measures timing only then).

### S1-P5 Two copy minors in the lazy market chunk
- `components/MarketHistoryExplorer.jsx:46`: 「今日も観測でき…」 -> 「分析基準日も観測でき…」 (B's extra note). 推移 card: open with the question it answers (minor A7), **replacing** the current first sentence so no pinned market height grows (`PRE_M2` / `PRE_P4` pins have 0 margin; the 推移 section has 259 px, 実測).
- Tests: the matching asserts in `brief-market*.spec.js` / `MarketScreen.test.jsx`. Checks: 市場 heights identical to main in every pinned state.

### S1-P6 Integration, measurement, record
- Full yardstick (§5), `docs/ui-abc/s1.md`, CONTEXT.md terms, PR.

### S1 acceptance
1. Band present, correct and labelled 独自 in every state of the table on 候補, ウォッチ and the stock screen at 320 / 375 / 390 / 1440, light and dark (or deviation (3) of S1-P3 recorded for the phone stock screen).
2. Today's first fold at 375x812, 390x844 and the two PWA-inset sizes shows the answer, the guide (a figure when known, never when unknown), the verdict, a 根拠 line, the 再開 status and the first 注目候補 row above the dock.
3. Heights at 375x812 (実測 by the specs): Today <= 1388 in the governing state, 候補 <= 708, ウォッチ <= 508, 市場 unchanged in every pinned state, stock <= 3124 (stalls) and <= 3388, chart card 508, bar <= 48, bar + dock <= 110.
4. Entry <= 134.00 kB gzip (expected about 108-110: 104.6 実測 what-if + S1's code, 未検証).
5. Value invariance vs main with S1's allow-list (§5.3); `counts.json` cmp-identical; probe identical (the chart is untouched); vitest, lint, full static Playwright green.
6. Timing interleaved with main, 390 and 1440: `longest_initial_task_ms` and `tab_switch_ms` medians not above main's; `first_candidate_ms` and `stock_open_ms` within their budgets (3500 / 1000) and reported.
7. Design Acceptance on the PR: 28 screens, 86/86, 0 failures; timing warnings reported if any.

---

## 3. Slice S2: B's stock screen

Goal: the chart and four numbers (ゾーン上限・ピボット(日付)・損切り・株数) are read in one place; the first line of the call is always the market.

### S2-P1 Call card in B's form
- Files: `B/StockVerdict.jsx`, `B/StockView.jsx` (order), `B/brief-decision.css`. All in the stock chunk.
- The call card keeps `data-testid="brief-conclusion"`, `data-gate`, the tone classes and **every title and sub sentence of `buyGate` unchanged**. It gains line 1 「地合い」 (the band's text; on a marketHold day the existing title is that line and is not repeated) and labels line 2 「銘柄」. The tiles, the meter and the chips leave the card: tiles -> strip (S2-P2); chips -> a chip block under the strip (same chips, same order, same tones); meter -> retired from the stock screen (D5).
- Tests changed deliberately: `brief-decision.spec.js:132,150,394` (card height bounds stay as upper bounds; the card is shorter), `:140` (meter marker: removed with the meter, reason D5), `:404,415` (chip lines: same bounds, new container), `:400-401`, `.brief-tilequal` 「参考」 x3 -> the strip's qualifiers, `StockVerdict.test.jsx`, `brief-rows.spec.js:283` (kgrid tiles at 200% zoom -> the strip), `brief-invariants.spec.js:125-238`.

### S2-P2 The 4-number strip
- Files: new `B/StockStrip.jsx`, `B/StockView.jsx`, new `B/brief-strip.css` (imported by the stock chunk), new `B/stopLevel.js` and `positionSizing.js` (D8).
- Cells: ゾーン上限 (value, 「+5%」; when the published 52-week high lies inside the zone, a 12 px line 「52週高 X（+n%）」, minor B9) | ピボット (value, its date from `pivotBar(judged,row)?.date` or `se_pivot_date`; 日付未確認 when neither exists, never a blank that reads as today) | 損切り (value, 「−7.0%」, 買値; `—` 未計算 when the plan is blocked) | 株数 (value, リスク; `1株未満`, the cap forms as today).
- Qualifiers as today's tiles carry them (参考 / 試算のみ / 既定条件 / 収縮の中), with 「地合い 0%」 in a nowrap span (minors A3, C6). 「試算」 appears only in the strip's title (minor B1). Stock-side numbers have no colour.
- Layout: four cells in one row from 360 px; 2 x 2 below. Placement: sibling right after `.brief-chartcard`, zero gap, shared border.
- Phone budgets (未検証 estimates from the 390 geometry; the worker measures): strip 76-88 px; net stock height change of P1+P2 about -10 to +10 px; **rule: stalls (`brief-decision.spec.js:283`) <= 3124 and every other stock cap as on main**. First fold at 390x844: call about 56-185, chart card about 195-703, strip ends about 780-790 against the dock at 788 -> **assert** the 株数 cell's bottom <= 788 on ZZNV / ZZAR / ZZMO in the default period; if it misses, the trim order is: the call card's padding, the gap between the call and the chart card, the strip's own padding (the chips sit below the strip and cannot help); if it still misses, report the measured position. At 375x812 (dock 756) the strip is expected to end 20-40 px under the dock top; this is reported, not hidden (O3 is the form that fits it).
- New `tests/static/brief-strip.spec.js`: the four values equal the chart's tags, the plan card and the sell row on every fixture stock and oracle (one number per level); blocked, uncertified, 0%-day, near-earnings and broken states print `—` 未計算 / 参考, never 0; 320 / 375 / 390 / 1440.

### S2-P3 One name per level; chart gutter; placer checks
- Files: `B/priceChart.js`, `B/chartLabels.js` (lazy chart chunk), `B/StockChartCard.jsx` (legend, readout), `B/StockPlanCard.jsx`, `B/StockSellCard.jsx`, `B/brief-chart.css`.
- Names everywhere: ゾーン上限, ピボット, 終値, 損切り (minor B1). The chart's 「買いゾーン 〜X」 label becomes 「ゾーン上限 X」.
- Gutter (minor C5): plain text for the levels with one filled 終値 plate, at every width; **style only** (classes and fills), boxes unchanged.
- Placer checks (minors A7, B7): on the 11-12 rebuild render probe (`H/snapshot/run-render.sh`), assert that the 損切り text sits within `LEADER_OFF_LEVEL` of its line and that a T label starts at its bracket's left edge; fix only what reproduces in the app's own placer, each fix with its vitest in `chartLabels.test.js`.
- **Expected probe diff, stated before the run:** in each of the 492 label views that draws the zone label, that one label's text changes and its box width changes; nothing else moves. Any other differing view or field is explained one by one or fixed. `labelAudit` (collision-free at 320 / 375 / 390 / 1440) stays green.
- Tests changed deliberately: `priceChart.test.js`, `chartLabels.test.js`, `StockChartCard.test.jsx`, `brief-chart.spec.js:856,874,974,1019` (label and legend words), `brief-plan.spec.js` (stop tag words).

### S2-P4 価格の位置 list at >= 1024
- Files: new `B/StockLadder.jsx` (stock chunk), `B/StockView.jsx`.
- Rows high to low: ゾーン上限, 52週高値（日中）, 終値, ピボット + date, 損切り, 50日線, 150日線, 200日線; each with its value and 終値比 (a display-only difference of two printed values, U+2212, `distanceText` rules; `—` when either side is missing). Footer 「株数（試算・参考／地合い 0%）n株」 with the qualifier unbroken (minor A3).
- Placement: under the strip in the stock pane. `brief-chart.spec.js:831,846` (periods and caption <= 900 at 1440) must hold unchanged.
- Phone: not rendered (D6).

### S2-P5 Copy items (each its own commit, each with its exact text diff in the record)
- **S4 wording** (minors B9, C1): `briefCandidate.js:471-478` `distanceText` prints 「0〜+0.1%」 / 「0〜−0.1%」 instead of 「±0.1%未満」 forms, nowrap. 12 asserts move (`briefCandidate.test.js` 6, `buyGate.test.js` 2, `briefSell.test.js` 1, `chartReadout.test.js` 1, `brief-watch.spec.js` 2). Rows, calls, readout and sell details change text; no value changes.
- **判定なし** (D9): `StockSellCard.jsx:17,36,69` and the matching asserts (`StockSellCard.test.jsx` 4, `briefSell.test.js` 1, `brief-sell.spec.js` 1); `CONTEXT.md` entry updated.
- **VCP card prefix** (minor B9): `StockVcpCard.jsx:137` 「SEの準備条件（トレンドテンプレートとは別）」 written without the bare abbreviation: 「Setup Engineの準備条件（トレンドテンプレートとは別）」.
- Minor C7's 試算 sentence: the app's own string (`StockPlanCard.jsx:88`) already avoids 「建てない」; no change.

### S2-P6 BEH-1: 損切りに到達 (behaviour; its own commit, tests and count diff)
- Files: `B/briefSell.js` (new `stopReachedCheck`, called from `sellSignals`, returned as `sells.stop`, **not** pushed into `weakness`, not in `tally()`, not in `BREAKDOWN_KEYS`), `B/StockSellCard.jsx` (one row 「損切りに到達（保有なら）」; a hit prints 「該当」 in bold `--neg` ink on one line, no ▲: minors B4, A4), `B/stopLevel.js` (`provisionalStop`).
- Where the row sits on the phone: a quiet result (判定なし, 該当なし) is the first line **inside** the existing quiet fold, and the fold's summary gains one segment (「・損切り 判定なし」 or 「・損切り 該当なし」); the summary's two counts (サインなし n件・判定なし n件) are still computed from `strength` and `weakness` only and do not change. A hit or an 未確認 is shown outside the fold. At >= 1024 the row is always in place. The added summary segment is in S2's allow-list for every stock.
- Rule (gate rulings S2, S3):
  - The breakout is `breakoutBar(lastPivotCrossing(...))` with `crossingFloor`, the same bar the row and the failed-breakout check name.
  - A plan bought at the analysis day's close (zone, basis price): 「判定なし（計画の買値は M/D 終値・その後の日足はまだありません）」.
  - A dated breakout before the analysis day (pivot-basis plan, or a blocked plan such as ext / low activity): level = `provisionalStop(pivot)` named 「仮の損切り（ピボットの −7.0%・独自設定）」; window = lows of the bars **after** the breakout bar to the last bar; the row prints 「M/D の上抜けの後の最安値 X（M/D）」; 該当 when the lowest low's cents <= the level's cents, else 該当なし.
  - Breakout on the analysis day: 「判定なし（上抜けは分析日・その後の日足はまだありません）」.
  - No close above the pivot in the look-back: 「判定なし（上抜けの終値なし）」.
  - Bars not certified, or a low missing in the window: 未確認, never 該当なし.
- Tests: `briefSell.test.js` (each branch; the RLAY shape: crossing-bar low under the level, later lows above it -> 該当なし; the USEA shape -> 判定なし; a one-cent boundary; a missing low), `StockSellCard.test.jsx`, new `tests/static/brief-stop.spec.js` with mutators (stop reached, analysis-day breakout) at 375 and 1440; sell card height <= 232.5 at 375 in the state `brief-sell.spec.js:104` pins (4.2 px of room, 実測; the quiet row is inside the fold, so the closed card must not grow; if the longer summary wraps to a second line there, shorten the segment to 「・損切り なし」 forms and re-measure). A hit state is taller by one row: its measured height is reported, and it must still keep the stock screen under 3124 / 3388.
- Count diff on the 11-12 rebuild (`H/snapshot/scripts/counts.mjs` and `eval-sell.mjs` copies get the mirror in the scratch harness, never in the repo): **existing keys cmp-identical**; one new key `stopReached`. Expected from `ui-abc/stop-window.jsonl` (to be confirmed by the rebuild): hit 58, clear 242, no_check 315 of 615 certified listed rows (114 zone + 145 without a dated breakout + 5 analysis-day breakouts + 51 without a pivot); 55 of the hits are fell-back rows; RLAY, ETON, FROG, STGW and XMTR read 該当なし and USEA 判定なし.
- **Not in this slice (BEH-2):** counting a hit in `tally()` (holder chip on 58 rows, the sell card's 「n件のサイン」) or in `BREAKDOWN_KEYS` (the buy gate's 崩れ, the watch tile). Recorded in `docs/ui-abc/s2.md` with these numbers.

### S2-P7 Line toggles (B's 「表示」) — ships only if it passes its cut rule
- Files: `B/StockChartCard.jsx` (a fifth button in the periods row), `B/priceChart.js` (layer flags), `B/chartReadout.js` (notes follow the layers).
- Layers: 水準・収縮・移動平均・出来高・RS線; default all on; the choice is kept for the session like the period.
- Cut rule: with every layer on, the probe is byte-identical to S2-P3's; the periods row keeps 44 px targets and one line at 320; the card stays 508. If any fails, the package is dropped and reported; the slice ships without it.

### S2-P8 Integration, measurement, record (`docs/ui-abc/s2.md`, CONTEXT.md, PR)

### S2 acceptance
1. Phone 390x844: the whole chart and the strip's four values above the dock on ZZNV / ZZAR / ZZMO (default period); 375x812: the whole chart above the dock, the strip's position reported.
2. One number per level on every fixture stock and oracle (strip = chart tag = plan card = stop row), in every stock state of §5.2, with the one stated exception of D8 (blocked plan: strip `—` 未計算, row 仮の損切り).
3. Heights at 375x812: stalls <= 3124, failed breakout <= 3388, hold market <= 3136, chart card = 508 (all exact pins unchanged), conclusion <= 353 / <= 319, plan <= 396, sell <= 232.5, fundamentals pins unchanged.
4. Entry <= 134.00 (S2 adds nothing to the entry beyond `stopLevel.js`, the stop check in `briefSell.js` and `distanceText`; the stock chunk grows by an estimated 3-6 kB, 未検証).
5. Value invariance vs S1 with S2's allow-list; visual packages (P1-P4, P7): `counts.json` cmp-identical; P5: cmp-identical; P6: the stated diff and nothing else.
6. Probe: exactly the stated diff (S2-P3). Timing interleaved with S1's head: `stock_open_ms` and the period switch (`H/timing/run-period.sh`) not above the base medians.
7. vitest, lint, full static Playwright, Design Acceptance 86/86.

---

## 4. Slice S3: C's 1440 three panes and the 「種別」 column

Goal: at >= 1400 the market, the candidate table and the selected stock are on one screen; every market fact says whether it is measured or our own judgement.

### S3-P1 Three-pane shell
- Files: `B/BriefApp.jsx` (`:254-258`), `B/brief.css` (`:352-383`), new `B/brief-desk.css`.
- >= 1400: grid `320px minmax(480px, 1fr) minmax(520px, 1.1fr)` (at 1440: about 320 / 495 / 545); each pane scrolls on its own; the market pane and the stock pane are memoized and do not re-render on a tab switch. 1024-1399: today's two panes, with the card rows. The 市場 tab: full `MarketScreen`, one column, as today.
- Tabs stay `nav.brief-tabs a` with the texts 今日 / 候補 / ウォッチ / 市場 and move to the top of the middle pane's column head; `.brief-stack h1` keeps the screen's name; the bar keeps `time[datetime]`; the stock pane keeps `.brief-stockhead h2 span:first-child`, ☆ with its accessible names, and one history entry per row open (`goBack`).
- Deep link (minor B6): opening `#/brief/stock/SYM` at >= 1400 for a stock outside Today's focus rows opens the middle pane on 候補・選定すべて with the row highlighted when the stock is listed there; otherwise the pane says 一覧外 as the phone's dock does.

### S3-P2 Market pane with the 「種別」 column
- Files: new `B/DeskMarket.jsx` (entry; reads `gateFacts`, `resumeConditions`, `marketGateFacts.js`, `MarketCard`'s index chart), `B/TodayGate.jsx` (shared rows).
- Table 項目 | 値 | 読み方 | 種別: 判定, 新規買いの目安, 根拠 (SPY vs 50/200), 分配日 (SPY: the regime's count; 指数: ^GSPC・^IXIC, 「判定には使わない別集計」), 50日線より上 / 200日線より上, 新高値／新安値; 銘柄側（参考・目安は変えません）: TT達成, 上抜けの維持, リーダーの健全度; 目安が動く条件（独自設定） with 未達 / 達成 / 未確認; 上昇再開のサイン（参考・目安は動きません）.
- 種別 values: 実測 / 独自判定 / 独自設定 / 「実測・基準は独自設定」 (上抜けの維持). A missing value prints 未取得 with 種別 「—」.
- 分配日 scale (minor A5): neutral segments; `--neg` only when the count is 7 or more.
- Exactly one region named 地合い on the page; 「市場の詳細 ›」 leads to the 市場 tab.

### S3-P3 Candidate table
- Files: new `B/CandidateTable.jsx` (entry; rows are `<tr data-testid="brief-candidate" data-symbol>` with the ticker as a button of >= 24 px), `B/ListView.jsx` and `B/TodayView.jsx` (render the table at >= 1400, the cards below), `B/briefCandidate.js` (`rowBlockers(view, market)`), `B/BriefParts.jsx` (the mini meter reused from the retired stock meter).
- Columns: # ・銘柄 | 状態 | ピボット比 (value + mini meter, nowrap, 16 px wider than C's, minor C1) | 止めているもの（上から優先順） | TT | RS推計 | 前日比 (12 px from RS推計, arrow right-aligned with its number, minor C6).
- 止めているもの (D13): the market first when the guide is 0% or unknown; then the row's own state. A 接近 row that never closed above the pivot says 「ピボットの上の終値なし（M/D 以降）」 only when the row model dates it, else 「上抜けなし」; it never repeats the distance (ruling S1, minor A2).
- Caption, once (minors B8, C2): 「上抜け日の出来高の目安は 1.4×以上（独自設定）・決算日は全行 未確認」 (only while every row's date is unknown); no bare 「SE」 (write Setup Engine).
- Filters at >= 1400: the four existing chips plus 「±5%以内」 = the existing hidden `focus` filter (no new population). Phone unchanged (D16).
- Today at >= 1400: the middle pane is the 注目候補 table (top five, the count line, すべての候補 ›) and the watch card. ウォッチ: the same table without the rank.
- Target: >= 15 rows fully visible at 1440x900 on 選定すべて (未検証; fewer is reported with the measured row height, never hidden by shrinking type under the token scale).
- Tests: `CandidateTable.test.jsx`, `briefCandidate.test.js` (`rowBlockers`), `brief-invariants.spec.js` extension (the row's first non-market blocker = its chip; never contradicts the stock gate's kind; no 「あと0」; U+2212), new `tests/static/brief-desk.spec.js`.
- Tests changed deliberately (every `VIEWPORTS.desktop` variant that reads list rows as cards): `brief-flow.spec.js:22-142,170,205-297`, `brief-rows.spec.js:190,201,221,242,317,462,570` (1440 variants), `brief-compact.spec.js:269,310,330,348`, `brief-phone.spec.js:145,376`, `brief-watch.spec.js:440,448` (1440), `brief-accessibility.spec.js` (axe at 1440), `ListView.test.jsx`.

### S3-P4 The stock pane at its new width
- The pane is about 540 px instead of 960: re-run the probe; **expected diff: every 1440 view (123 label views, 120 value views) changes; no 320 / 375 / 390 view changes**. `labelAudit` must be collision-free at the new width on every fixture stock, oracle and period; the 11-12 render probe at 1440 is re-run for the real-data label counts.
- Tests changed deliberately: `brief-chart.spec.js:791-846` (the readout beside the periods: at 540 px it may sit under them; the bound "periods and caption <= 900" is kept), `brief-fundamentals.spec.js:527` and `brief-market.spec.js:240+` only if their boxes move (bounds kept), `brief-freshness.spec.js:95` (the header's age line keeps >= 6 px to spare, else its short form).
- Strip and ladder inside the pane: one row of four cells; the ladder under it.

### S3-P5 Integration, measurement, record
- Yardstick (§5), with timing at 1440 the main risk: `tab_switch_ms` (24 ms of room on CI) and `longest_initial_task_ms` (50 ms of room).
- `docs/ui-abc/s3.md`; `CONTEXT.md`; a `docs/PROGRESS.md` cycle entry and a whole-file `docs/STATE.md` update (the UI line only; the Minervini loop's metrics untouched).

### S3 acceptance
1. At 1440x900 and 1400x900: three panes, no horizontal scroll, the market verdict, the table and the selected stock's call and chart top all visible without scrolling; at 1024 and 1280 two panes as before.
2. Every market-pane row has a 種別; every threshold row says 独自設定 / 独自判定; stock-side rows have no colour and no ▲.
3. Table: rows carry `brief-candidate` + `data-symbol`; the first blocker is the market on 0% and unknown days; row count visible reported (target >= 15).
4. Phone: **nothing changes** against S2's head: dump, values and screenshots at 320 / 375 / 390 byte-identical (allow-list empty).
5. Entry <= 134.00 (expected about 114-118 after S3, 未検証).
6. Timing interleaved with S2's head and with main: 1440 `longest_initial_task_ms` and `tab_switch_ms` medians not above main's; all four inside their budgets.
7. `counts.json` cmp-identical; vitest, lint, full static Playwright, Design Acceptance 86/86 with 0 edits to the harness.

---

## 5. Verification yardstick (re-based on main 01066ebe)

### 5.1 Tools
- Harness `H` as in its README, with `01066eb` as the base tree (not 8849bf9): probe, oracle probe, dump, heights, build, snapshot + `counts.json`, render probe, timing.
- New scratch tools in `S/ui-abc/yard/` (never committed): `matrix.spec.mjs`, `values.mjs`, `shots.spec.mjs`, `timing4.spec.mjs`. They import the worktree's `tests/static/brief-fixture.js` helpers and the spec-local mutators copied with their source lines (D §4).

### 5.2 State matrix (every state from the fixtures, not only the 0% day)
- **Market states (9):** default 50%; 25% (regime mutator); `below50Rows`; `compose(ftdUpgraded, belowFiftyIndex)` and the same with `ftdAgo(5)`; `below200`; `historyEnd: sessions.at(-2)`; `fail:'series'`; `fail:'manifest'`; FTD conflict (`gspcNotConfirmed`). Screens: Today, 候補 (each of the 4 filters), ウォッチ (4 and 5 symbols, + broken ZZSD), 市場 (each tab).
- **Stock states (11 + 4):** ZZRD ready (oracle), ZZAR near, ZZNV touch, ZZHB held (oracle), ZZKS extended, ZZAR failed breakout, ZZNV broken, ZZZF TT 7/8, ZZPG low activity (oracle), ZZNR pivot after a crossing (oracle), ZZNV marketHold; plus the stalls state (`aboveSince(25)`), an uncertified chart, a detail failure (`fail:'detail'`) and, from S2-P6, stop reached and analysis-day breakout. Each also under the 0% and the unknown market.
- **Late publication** (`brief-freshness.spec.js:35-105` clock) on Today, 候補 and a stock.

### 5.3 Value invariance
- `values.mjs` reads each matrix view at 375x812 and 1440x900 with every `<details>` / Expander opened, after `chartSettled` and 1.5 s of DOM quiet, and emits per view:
  - **numbers**: every token matching `[+−]?\$?\d[\d,]*(\.\d+)?(%|×|株|日|件|銘柄|位|週|営業日|条件)?` from `#brief-main` and `.brief-bar` innerText plus the chart's SVG text, as a multiset;
  - **verdict sentences**: the text of the call's title and sub (`[data-testid="brief-conclusion"] strong, p`), row titles and event titles, every sell check's label, state word and detail, the market verdict, the tiles' `b` / `em`, as a multiset.
- Gate: `diff(main, slice)` per view must equal the slice's **allow-list** (a table in `docs/ui-abc/<slice>.md`: added string, removed string, reason). Expected allow-lists:
  - S1: added = the band's text (with 「最大N%」 / 「0%」 through `capText`), 根拠 / 再開 lines, kind tags, the SPY regime count and the stock-side figures on Today; removed = the 地合い tile's own forms 「検討可・目安≤N%」 and 「目安≤N%」 (the same cap, now printed as 「最大N%」) and nothing else: the tile's verdict words, suffix and note sentence, and the four facts of the phone's market card are still on the screen (fold opened by the extractor).
  - S2: added = ピボットの日付 in the strip, 52週高 line, ladder's 終値比 values (1440), the stop row (BEH-1); the sell fold's summary segment for the stop row; renamed = zone label, 判定せず -> 判定なし, the ±0.1% forms; removed = the meter's accessible name (ピボットからの位置 + the same ピボット比 the readout prints) and its tick labels (−10% … +10%, scale marks, not values).
  - S3 at 1440: added = 種別 words, 止めているもの sentences, caption; removed = card-only chip duplicates listed one by one; at 375: empty.
- A number that changes value (not place) is a failure unless it is BEH-1's row.

### 5.4 Rebuild counts
- `H/snapshot/run-snapshot.sh <WT>` then `cmp H/snapshot/out/bd20584/counts.json H/snapshot/out/<head7>/counts.json` for every visual package and the copy items. BEH-1: the stated diff only. Disk: one `out/<head7>` per slice head; delete the older ones.

### 5.5 Suites, size, heights
- `npm run test:run`, `npm run lint`, the full static Playwright suite CI-faithfully (Chrome for Testing 147 + CI fonts), `make gate-check` untouched.
- `H/build/run-build.sh <WT>`: entry of `npm run build` <= 134.00 kB gzip; every chunk recorded; the `priceChart` chunk name unchanged (Design Acceptance matches it).
- `H/heights/run-heights.sh` and the budget shim of G §2.0 (`ui-abc/gates-budgets/run`, re-pointed at the worker's tree): the table of every bound with its measured value goes into the slice record.

### 5.6 Design Acceptance: the 86 checks and who keeps them

| Check(s) | Depends on | Kept by |
|---|---|---|
| list-near-filter-pressed | `.brief-seg button` 「あと1条件」, aria-pressed | D16; S3-P3 keeps `.brief-seg` at 1440 |
| findCandidates fallback | `.brief-seg` buttons 買いゾーン / ピボット接近 / 選定すべて / あと1条件 | D16; S3-P3 |
| market-regime-region | region 地合い (exact) on 市場 | S1-P4, S3-P2: one region of that name per page; `MarketScreen` untouched |
| market-history-tab-selected / -section / -loaded | tablist 市場タブの表示, `#brief-tab-history`, region 市場環境の推移 | 市場 tab untouched (S1-P5 is copy only) |
| chart-renderer-loaded, row-opens-stock | `brief-candidate` + `data-symbol`, `brief-conclusion`, >= 60 `rect.bc-up/.bc-down`, `.brief-chart-failed` | S1-P1 (lazy seam keeps them), S2-P1, S3-P3 (table rows carry the testid) |
| weekly-range-pressed, weekly-chart-drawn | `.brief-periods button` /^週足/, `.brief-legend` 10週線 | S2-P3, S2-P7 (the fifth button never matches /^週足/) |
| watch-star-pressed, watch-toast, -undo-target | ☆ accessible names, `.brief-toast`, 元に戻す | untouched; S3-P1 keeps ☆ in the pane header |
| back-returns | phone 戻る; 1440 `goBack` | S1-P1 (phone open awaits the chunk, still one entry), S3-P1 |
| theme-toggle-flips / -restores | toggle names, `data-theme` | untouched |
| 7 redirects | route table | untouched |
| per-capture: date | `.brief-bar time[datetime]` = `M/D（曜）` | S1-P3 keeps `BarDate` on line 2 |
| per-capture: fonts, radii | token scales | only sizes 11-42 and radii 4/8/12/16 already in `tokens.js`; no token edit |
| per-capture: targets 44/24, axe, overflow, ASCII minus, NaN | every new control | each package's own spec + `brief-accessibility.spec.js` |
| phone chrome <= 110 | bar + dock | S1-P3 (bar stays 48) |
| timing selectors | `nav.brief-tabs a` 候補 / 今日, `.brief-stack h1` = 候補, `.brief-stockhead h2 span:first-child`, `.brief-bar-title b span`, chunk name `priceChart` | S1-P1, S1-P3 (phone stock bar keeps `b span` = ticker), S3-P1 |
| 28 captures (`design-owner-waiver.test.mjs:54`) | 7 captures x 4 groups | no capture added or removed |

No check is planned to change. If a worker finds one that must, it is listed in the PR with the reason and reviewed as a gate change.

### 5.7 Screenshots and timing
- `shots.spec.mjs`: every matrix view at 320x640, 375x812, 390x844 and 1440x900, light and dark, the first fold as PNG (full page for Today, the stock screen and 市場 at 375 and 1440), CI-faithful, into `S/ui-abc/shots-<slice>/`; the same set on the base for side-by-side. About 60 views x 4 widths x 2 themes.
- Timing: `timing4.spec.mjs` (first candidate, longest initial task, tab switch, stock open; 390 and 1440 dark; CPU 4x; 7 runs; base and slice interleaved; `wait-quiet.sh`; loadavg and the Node calibration loop recorded), plus `H/timing/run-timing.sh <WT> 4461 <base>` for the 1440 first load with the chart-task record and `run-period.sh` for the period switch. Validity rule as the harness README states (1-min load < 1.0 at the start, no foreign process >= 5% CPU). CI's Design Acceptance numbers on the PR are read and recorded; they are warnings there, but a median over a budget is reported to the owner, not waved through.

---

## 6. Open minors of final-r7 / gate-r7 (25 + B's extra)

| # | Minor | Where it lands |
|---|---|---|
| A1 | 候補 390 filter row cut | Not applicable: the app keeps the 2x2 grid with all four filters visible (D16) |
| A2 | 接近 rows repeat the distance; S1 blocker wording | S3-P3 (`rowBlockers`); phone rows have no blocker line |
| A3 | 1440 株数 line lacks 「参考／地合い 0%」 | S2-P2 (strip qualifier), S2-P4 (ladder footer) |
| A4 | ウォッチ 「該当 1件」 grey and wrapping | S2-P6 for the row's 該当 (bold `--neg`, nowrap); the ウォッチ summary string does not exist while BEH-2 is not taken: not applicable there |
| A5 | 分配日 scale tinted on a 参考 day | S3-P2 (the only place a scale is drawn); the phone keeps words |
| A6 | Gate card 3 px above the dock; one-row 分配日 line | S1-P4 (one-row wording in the fold; the compact card keeps the first row above the dock by test) |
| A7 | SWKS 損切り label offset; 推移 card question; optional 目安 on the volume | S2-P3 (placer check), S1-P5 (推移 question); the optional per-row 目安 is not taken (B8 says once in the caption) |
| A8 | Tool-named path in a prototype helper | Not applicable to the app (prototype file); rule 0.5 keeps such paths out of the repo |
| B1 | One name per level | S2-P3, S2-P2 |
| B2 | 仮の損切り window | S2-P6 (BEH-1) |
| B3 | 判定なし for plan stocks; one word | S2-P6, S2-P5 (D9) |
| B4 | 「▲該当」: ▲ is 注意 only | S2-P6 for the new row. The app's other ▲ uses (崩れ chip, extended, distribution marks: >= 5 sites, D §2) are **not** changed in these slices: recorded as a follow-up, because it is a mark change across existing screens that no prototype evaluated |
| B5 | 150日 line teal | Already satisfied in the app (`brief.css:210`, `brief-chart.css:104`); checked in S2 screenshots |
| B6 | #stock-ext: no current dock item; 1440 pane on a list without the stock | S3-P1 (deep link); the phone dock already says 一覧外 |
| B7 | T label vs pivot flag; 省略 note; dropped MA tag value | S2-P3 (placer check; the readout already prints 50/150/200), re-checked in S3-P4 at the new width |
| B8 | 候補 rows repeat the 目安 and 決算日 | Not applicable to phone rows; S3-P3 caption rule |
| B9 | 52週高 in the zone; VCP prefix; S4 | S2-P2; S2-P5; S2-P5 |
| B+ | Glossary 「今日も」 | S1-P5 |
| C1 | S4 wording, nowrap, wider ピボット比 | S2-P5, S3-P3 |
| C2 | 「＋決算日」 token; SE gloss | Token not applicable (no such token); the no-bare-SE rule in S3-P3 and S2-P5 |
| C3 | 仮の損切り window | = B2, S2-P6 |
| C4 | 判定なし; judge no-plan stocks above the pivot | S2-P6 (ext and low-activity rows with a dated breakout are judged) |
| C5 | Gutter: plain text + one filled 終値 plate | S2-P3 (style only) |
| C6 | Table spacing; qualifier break | S3-P3; S2-P2 |
| C7 | Today headline; right-aligned 目安 figure; 試算 sentence; ウォッチ tile | S1-P4 (headline + figure); 試算: already satisfied (S2-P5 note); the ウォッチ tile state does not exist: not applicable |

---

## 7. Docs per slice
- `docs/ui-abc/s1.md`, `s2.md`, `s3.md`: what shipped; each deviation from the prototype with its reason; the allow-list; every deliberate test change (file:line, old, new, why); measurements (heights table, entry and chunks, counts cmp, probe diff, timing with loadavg), each tagged 実測 with its command or 未検証; owner options touched.
- `CONTEXT.md`: S1 地合いの帯, 地合いゲート, 新規買いの目安, 再開の条件, 種別（実測／独自判定／独自設定）; S2 ゾーン上限, 4つの数字の帯, 価格の位置, 仮の損切り, 損切りに到達, 判定なし (replacing 判定せず); S3 止めているもの, 3列（地合い・候補の表・銘柄）.
- `docs/PROGRESS.md`: one cycle entry at S3 covering the three slices; `docs/STATE.md`: whole-file update at S3 (UI state and next actions; the loop's metrics and constraints carried over unchanged).

---

## 8. What the critics look at, per slice

- **S1**: every market state of §5.2 on Today, 候補, ウォッチ and one stock, at 320 / 375 / 390 / 1440, light and dark. Questions: can the first fold be misread as "buy" on a 0% day; does any unknown / loading / failure state print 0% or 未達; is 独自 visible in the band at 320 and in the stale state; does a positive day change still read as up; are the stock-side numbers colourless with 目安は変えません; is the fold's closed state enough to answer "why" and "what reopens".
- **S2**: every stock state of §5.2 under the 50%, 0% and unknown markets, each period (3か月 / 6か月 / 1年 / 週足), 320 / 375 / 390 / 1440, light and dark. Questions: one number and one name per level everywhere; `—` 未計算 never 0; the strip never reads as an order on a 0% day (参考, 試算); the stop row's three 判定なし reasons and the 該当 form; the first fold at 390 and at 375; label collisions; the chips' new place.
- **S3**: 1280 (two panes), 1400, 1440 and 1920 wide, light and dark; Today, 候補 (each filter incl. ±5%以内), ウォッチ, a deep-linked stock outside the list; every market state in the pane. Questions: 種別 on every row and correct; the first blocker; 12-13 px text only where the type rule allows; row count; keyboard stepping (j / k) and focus order across three panes; and that the phone is pixel-identical to S2.

---

## 9. Owner lines: shipped form and owner options (numbers)

| # | Place | Shipped inside the line | Cost inside | Prototype-exact form (owner option, never taken by us) |
|---|---|---|---|---|
| O1 | Band on 候補 / ウォッチ / stock (phone) | In the bar's two lines | 0 px (未検証 until S1-P3 measures); entry about +0.5 kB | Own 44 px row under the bar: 候補 637 (fits 708), ウォッチ 542 (line 508: +34), stock stalls 3158 (line 3124: +34). With the usual 12 px reserve: ウォッチ 554, `STOCK_CAP` 3170 |
| O2 | Today first fold (phone) | Compact gate card + closed fold | <= +24 px in the governing state (1364 -> <= 1388); first row stays above the dock | A's open card (785 px): Today about 1,974 at 390 (line 1388: about +590) and the first 注目候補 row leaves the first screen (the rule of `brief-phone.spec.js:27-40` would have to go) |
| O3 | Stock chart (phone) | Chart as today (340 px, card 508) lifted into the first fold; strip under the card | stock about -10 to +10 px; at 375x812 the strip ends an estimated 20-40 px under the dock top | B's taller price pane with the strip between price and volume, one-line readout: stock about +360 (B 3316 vs main 2954 at 390) -> stalls about 3,480 (line 3124), failed breakout about 3,600 (line 3388), card about 630 (line 508, exact pins rewritten) |
| O4 | 価格の位置 (phone) | Not on the phone; at >= 1024 only | 0 px | Closed fold about +56 px, open about +290 px on every stock screen (stalls -> about 3,170 / 3,400) |
| O5 | 候補 rows per fold (phone) | Unchanged rows (87 px) | 0 px | A's rows with a 止めているもの line: A's 候補 was 1,170-1,245 (line 708) |
| O6 | JS | Stock screen in a lazy chunk; band, gate card, table and market pane in the entry | Entry about 104.6 (実測 what-if) + an estimated 10-14 kB over three slices = about 115-118 (line 134.00); stock chunk about 31 -> about 36 kB; `MarketScreen` 34 kB unchanged | Nothing needs the line raised. Building the 1440 market pane from `MarketScreen` itself would add its 34 kB to the 1440 first load |
| O7 | Speed (1440) | Stock pane as its own task (variant A or B by measurement); market pane from entry code | Rule: medians not above main's plus the pre-set noise band (CI: longest task 150 / 200, tab switch 376 / 400) | C's stock pane at 472 px and a full table render of every row at first paint are not planned; if the three panes cannot hold the tab switch under 400 ms, the measured overrun is reported before anything ships |
| O8 | Existing finding, not caused by this work | none | none | The 市場 FTD-conflict state reads 1300 / 1322 at 375 against the 1288 line on main (実測, G §2.4); no spec guards it. Reported for the owner; this plan adds no height to 市場 |

---

## 10. 実測 and 未検証 in this plan

- 実測 (surveyors, this session, CI-faithful): entry 133.85 kB; what-if entry 104.59 / chunk 30.70 kB; every height and margin quoted from G §2; the 390 stock geometry; the 86 checks and CI timing of PR #146 (CI実測); the stop-window counts on the 11-12 rebuild.
- 未検証 (each is the first thing its package measures): any timing of the lazy seam; every px estimate for the band, the gate card, the strip and the ladder; the entry cost of S1-S3's new code; the row count of the 1440 table; whether the publication carries `market_context.distribution_days`; whether `design-review.mjs`'s timing can run locally (else `timing4.spec.mjs`); the BEH-1 counts until the rebuild confirms them.

### 9.1 Cost by screen and slice (px at 375x812 / 390x844; main's value first)

| Screen | Main (実測) | After S1 | After S2 | After S3 | Line |
|---|---|---|---|---|---|
| Today, governing state | 1364 / 1342 (390: harness state) | <= 1388 (budget +24; estimate -10 to +20, 未検証) | unchanged | unchanged (phone identical) | 1388 |
| Today, first 注目候補 row bottom | 563-610 | <= dock (722-788); estimate +/-20, 未検証 | unchanged | unchanged | dock |
| 候補 | 593 / 593 | 593 (band in the bar, 0 px; 未検証) | 593 (the S4 wording may re-wrap a row: measured) | unchanged | 708 |
| ウォッチ, governing | 498 / 442 (harness state) | 498 (0 px; 未検証) | unchanged | unchanged | 508 |
| 市場, tightest | 1280 | 1280 (copy replaced in place; pins 0) | unchanged | unchanged | 1288 |
| stock, stalls | 3114 | 3114, or +0 by the px-for-px rule of S1-P3 option (1) | <= 3124 (estimate -10 to +10, 未検証) | unchanged | 3124 |
| stock, failed breakout | 3240 | 3240 | <= 3388 (estimate +/-10; +1 row when the stop row is a hit, 未検証) | unchanged | 3388 |
| chart card | 508 | 508 | 508 (exact pins untouched) | 508 on the phone | 508 |
| 1440 screens | no height line | gate card open in place | strip and ladder in the pane | three panes from 1400 | none |

| | Main | After S1 | After S2 | After S3 | Line |
|---|---|---|---|---|---|
| Entry chunk, kB gzip | 133.85 (実測) | about 108-110 (104.59 実測 what-if + estimate) | about 109-111 | about 115-118 | 134.00 |
| Stock chunk (lazy), kB gzip | none | about 30.7 (実測 what-if) | about 34-37 | about 34-37 | none |
| `MarketScreen` chunk | 34.03 | about 33-34 (readers moved out) | same | same | none |
| 1440 longest initial task, ms (CI: 150) | 150 | <= main + band (未検証) | same rule | same rule | 200 |
| 1440 tab switch, ms (CI: 376) | 376 | <= main + band (未検証) | same rule | same rule; the main risk of S3 | 400 |
| 390 stock open, ms (CI: 455) | 455 | prefetched chunk: about the same; cold open + one chunk load (未検証) | same rule | same | 1000 |
| first candidate, ms (CI: 1896 / 2114) | as CI | smaller entry: not above main (未検証) | same | table in the entry: not above main (未検証) | 3500 |

### 9.2 オーナー向けの選択肢（日本語）

線の内側で出す形と、試作どおりにする場合に必要な数字です。線を上げる判断はオーナーだけが行います。こちらからは上げません。

- **O1 地合いの帯（スマホの候補・ウォッチ・銘柄）**：いまある上のバーの2行の中に入れます（高さの増加は0pxの見込み・未検証）。試作どおりにバーの下へ1行（44px）足す場合、候補は637pxで線（708）に収まりますが、ウォッチは542px（線508を34px超過）、銘柄は3,158px（線3,124を34px超過）になります。
- **O2 Todayの最初の1画面**：答え（買いは控える）・目安の数字・判定・根拠1行・再開の条件の達成数までを見せ、根拠の詳細と条件2つ、指数側・銘柄側の数字は折りたたみの中に入れます（増加は24px以内。超える場合は出さずに報告します）。試作どおり全部を開いて見せると、Todayは約1,974px（線1,388を約590px超過）になり、注目候補の1行目が最初の画面から外れます。
- **O3 銘柄画面のチャート（スマホ）**：チャートの大きさは今のまま（カード508px）で、上にあった3つの数字とメーターを外して、チャート全体を最初の1画面に上げます。4つの数字の帯はチャートのすぐ下に置きます（390幅では下のタブの上に収まる見込み、375幅では帯の下端が20〜40pxほど隠れる見込み・どちらも未検証）。試作どおりの大きな価格チャートと、価格と出来高の間の帯にすると、銘柄画面は約+360px（停滞の状態で約3,480px・線3,124、ブレイク失敗の状態で約3,600px・線3,388）、チャートのカードは約630px（線508）になります。
- **O4 価格の位置の一覧**：PC幅（1024px以上）だけに出します。スマホに出す場合は、閉じた状態で約+56px、開くと約+290pxです（どの銘柄画面でも線3,124を超えます）。
- **O5 候補の1行（スマホ）**：今の行（87px）のままです。「止めているもの」の行を足す試作の形では、候補は1,170〜1,245px（線708）でした。
- **O6 JSの大きさ**：銘柄画面を後から読み込む別ファイルにします。最初に読むファイルは133.85kB→約104.6kB（実測の試し組み）になり、3つのスライスを足しても約115〜118kBの見込みで、線（134.00kB）は上げません。
- **O7 速さ（1440幅）**：銘柄の欄は一覧の後に別の処理として描きます。最長の処理（CIで150ms・目標200ms）とタブ切り替え（CIで376ms・目標400ms）が今より遅くならないことを、同じ実行の中で今の版と交互に測って確かめます。3列にしてタブ切り替えが400msを超える場合は、出す前に実測値を報告します。
- **O8 既存の事実（今回の変更が原因ではありません）**：市場タブの「FTDの食い違い」の状態は、今のmainで1,300px／1,322px（線1,288）です。どのテストも見ていません。今回の計画では市場タブの高さは増やしません。
- **別の判断が必要なもの（線ではなく動作）**：「損切りに到達」は、Aの数え方（上抜けた日の次の日足から）で売りのカードに1行として出します。この行は、売りのサインの件数・チップ・ウォッチの注意・買いの判定には数えません。数える場合、11/12の再計算では58銘柄（うち上抜け後にピボットを割った銘柄が55）に売りのサインが増えます（実測）。これは別の判断として残します。
