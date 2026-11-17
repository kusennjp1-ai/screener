# ui-abc yardstick (plan §5.1-§5.4, §5.7): scratch only, never committed

`Y=$SCRATCH/ui-abc/yard`
`H=$SCRATCH/audit3/r3-harness`

Built in S1-P0 on main `01066ebe` (worktree `/home/user/screener/.claude/worktrees/ui-plan`, port 4462).
Every browser tool is CI-faithful through `$H/lib/common.sh` (Chrome for Testing 147 headless shell, the CI fonts,
`PATH=/opt/node22/bin`), runs the worktree's own `playwright.static.config.js` vite dev server (`--strictPort`) and reads the
worktree's own fixture (`tests/static/brief-fixture.js`, frozen; never edited). Ports: 4461 (S1, or a throwaway tree when S1
is not served) and 4462 (main) only; never two vite servers on one tree. Commit before you measure (ledger and timing read
`git archive HEAD`; values/surfaces/shots serve the working tree, which must be clean: `values.mjs run` REFUSES a tree with
any modified or untracked file (exit 2) unless `--allow-dirty`, and `meta.json` / `ledger-meta.json` record the state).

**Round 1 (conductor's orders on S1-P0) changed the tools and re-baselined main: see `## Round 1` at the end. The hashes in
`## Records` below the round-1 section are the S1-P0 originals (kept in `main/base-r0/`), superseded by round 1's.**

**Round 2 (the conductor's second orders on S1-P0) added the ordered lines (`seq`, diff kind `lineOrder`), the VCP leg pairs
(`leg|…`) and the matrix `errors` / `notes` check, and re-baselined main again: see `## Round 2` at the very end. The current
baseline is `main/base` → `base-r2/` (re-run `main/rerun` → `rerun-r2/`) and the current tool pin is `main/tools-r2.sha256`;
round 1's `base-r1/` / `rerun-r1/` and `tools-r1.sha256` are superseded and kept for the record.**

See `## Records` at the end for main's hashes, the determinism record and the sensitivity record.

## Files

| File | What |
|---|---|
| `states.mjs` | THE state table of plan §5.2 as data (13 market states x 12 phone / 9 desktop screens; the newer-session states pending/late x 50%/25%/0% x Today/候補/ウォッチ/stock; 18 stock states x as published / 0% / unknown market; ROW_STATES (row-level recipes on a 候補 screen: BIG_PRICE); declared GAPS). Every mutator is copied with its `file:line`; YARD-OWN mutators are marked and reach-checked. A later package adds a row (a state, a screen, a surface), not code. |
| `extract.mjs` | Page-side extraction in ONE page function (`pageSide`): lines, SVG text, label-bound pairs (`PAIR_CELLS`, dt/dd, th/td, and the generic bindings `li|…`, `row|<symbol>|…`, `input|<label>|<value>`), numbers, the dock section, accessible names from the aria snapshot, the closed first fold from per-character Range rects grouped into runs and lines. One visibility rule for all of it: rendered (client rects) and NOT inside a closed `<details>` outside its own first `<summary>`. Also the shared `openView` (steps: filter, tab, `more` = 「さらに表示」) / `settledView` / `openAll`. |
| `lib.sh` | `yard_run_dir <kind> <worktree> <port> <spec>`: per-run Playwright dir and config (sources `$H/lib/common.sh`). |
| `matrix.spec.mjs` | The driver: one test per view and mode, fresh context each, page clock PINNED (openBrief's `setFixedTime(FINANCIAL_TEST_NOW)`; a newer-session view moves it and reloads), reach check per view, collectors `matrix` and `values`. |
| `values.mjs` | `run` / `merge` / `diff` (value invariance §5.3; `diff` also compares the order of the first fold (`foldOrder`), (round 2) the order of the whole page's lines (`lineOrder` over `seq`, closed and opened; `seqMissing` when a record has no `seq`) and the matrix records (rows as an ordered list, overflow, bar, dock, reach.model, reach.gate, (round 2) new `errors` / `notes`; heights as info)). |
| `phrases.mjs` | `scan` / `diff` (§5.3 phrase scan). |
| `surfaces.spec.mjs` + `surfaces.mjs` | Cross-surface oracle §5.3 (`SURFACES` table) and its runner / diff / table. |
| `ledger.mjs` | Per-row ledger §5.4 on the 11-12 rebuild: `run` / `diff`. |
| `shots.spec.mjs` + `shots.sh` | Screenshots §5.7. |
| `timing4.spec.mjs` + `timing4.sh` | Design Acceptance's four timing metrics, trees interleaved §5.7 / S1-P1. |
| `clock-facts.mjs` | The clock facts of D18 (tree's own modules on the fixture asset). |
| `main-harness.sh` | Step 2: the round-3 harness's probe, oracle probe, dump, heights and build on main. |
| `main-yard.sh` | Steps 3-4 on main: values+matrix and surfaces twice, ledger twice, phrases, byte comparison. |
| `count-views.mjs` | Counts the matrix's views per mode. |
| `dev/r1-runB.sh`, `dev/r1-postB.sh` | Round 1 only: run B of the re-baseline (from the start, after the container restart) and the tail after it (A/B byte identity, phrases, main-against-main diff, surfaces twice) → `main/r1/runB.log`, `main/r1/postB.txt`. |
| `dev/rebase-check.mjs` | Round 1 only: classifies every difference between the S1-P0 baseline (`main/base-r0`) and the re-baseline (each must be a fold changed by the closed-details rule, a new pair kind, the dock section, a closed pair now folded away, or `reach.now`). |
| `dev/r2/` | Round 2 only: `synth-test.mjs` (offline checks of `lineOrder` / `seqMissing` / the matrix errors-notes rule, output `synth-test.txt`), `precheck.sh` (the live pre-check before the pin), `runA.sh` / `runB.sh` (the re-baseline drivers), `postA.sh` / `postB.sh` (the checks after them; `allow-r1-r2.json` is postA's list), `regress/` (the old diff kinds re-run with round 2's `values.mjs`), `strip-check.mjs` (r2 record minus `seq` and `leg|` pairs = r1 record; `multiset(seq)` = `lines`), `order3-acceptance.txt`, `dumpdiff.js.txt` (the order-4 one-liner's body). |
| `main/` | Main's outputs. **`base` = the current baseline (a symlink to `base-r2/`, round 2: merged files, `raw/` for `--resume`, surfaces, phrases), `rerun` = its determinism re-run (a symlink to `rerun-r2/`)**; `ledger1/` (the ledger baseline), `ledger2/`, `clock/`, logs; `base-r0/` and `rerun-r0/` = S1-P0's superseded baseline and re-run (merged files and logs only; `base-r0/tools/` = the tool bytes it was made with), `base-r1/` and `rerun-r1/` = round 1's superseded baseline and re-run, `r1/` = round 1's logs, ledger runs and post-run records, `r2/` = round 2's logs and post-run records, `tools-r2.sha256` = the current tool pin (`tools-r1.sha256`: round 1's). |
| `sens/` | The sensitivity record (planted tree's outputs and the diffs). |

## Commands (every tool takes a worktree, a port and an output dir; later slices reuse them unchanged)

```bash
Y=$SCRATCH/ui-abc/yard
export PATH=/opt/node22/bin:$PATH
# the matrix + value invariance (plan §5.2/§5.3): 660 tests, about 57 min on an idle 4-core host (round 1, main)
node $Y/values.mjs run <worktree> <port> <outdir> [--views <regex on view id>] [--modes 375,390f,1440] [--resume] [--allow-dirty]
node $Y/values.mjs diff $Y/main/base <outdir> [allow.json] [--subset]      # values sections, fold, foldOrder, lineOrder (seq), then the matrix section (incl. new errors/notes)
# phrase scan over a values run
node $Y/phrases.mjs scan <outdir>;  node $Y/phrases.mjs diff $Y/main/base <outdir>
# the cross-surface oracle (19 states x 4 UI surfaces + modelMarket), ~5 min
node $Y/surfaces.mjs run <worktree> <port> <outdir> [--views <regex on state id>]
node $Y/surfaces.mjs diff $Y/main/base <outdir> [allow.json];  node $Y/surfaces.mjs table <outdir>
# the per-row ledger on the 11-12 rebuild (no browser, ~3 s; reads git archive HEAD)
node --max-old-space-size=8192 $Y/ledger.mjs run <worktree> <outdir> [--serve <rebuild serve dir>] [--listed <rows.jsonl>]
node $Y/ledger.mjs diff $Y/main/ledger1/ledger.jsonl <outdir>/ledger.jsonl [--allow <field regex>]
# screenshots into $S/ui-abc/shots-<label>/ (not a byte gate)
$Y/shots.sh <worktree> <port> <label> [view regex] [--resume]          # env YARD_SIZES, YARD_THEMES narrow it
# timing (Design Acceptance's four metrics), trees interleaved, idle machine; A = B gives the noise band
$Y/timing4.sh <worktree A> <worktree B> <port> <outdir> [runs=7] [label]  # env T4_WIDTHS=390,1440
# clock facts of D18
node $Y/clock-facts.mjs <worktree> <outdir>
```

Outputs of `values.mjs run`: `matrix.json` (per view and mode: hash, page/content height, overflow, bar/dock height, the
candidate rows, the reach check `{now, model, gate, why[]}`, notes, page errors) and `values.json` (per view and mode: `closed`
and `opened` = `{lines, svg, pairs, numbers, names, dock}` multisets plus (round 2) the ordered `seq`, `fold` = the closed first fold's lines at 375x812 /
390x844, `openedCount`), `sha256.txt` over both, `foldcheck.json` (OFF-HASH: per fold, `noRule` = the same fold built without
the closed-details rule and `skipped` = the closed-details text nodes whose box lay above the dock; both depend on stale rects),
`meta.json` (tree, dirty state, port, times, loadavg: outside the hashes), `run.log`, `raw/`. A view whose state is not reached
(the page clock included) fails its test in every mode and is listed as UNREACHED by the merge (390f writes no matrix record:
there only the run's exit code shows it).

What each section holds:
- `lines`: every rendered text line of `.brief-bar` and `#brief-main` (innerText, which leaves closed-`<details>` content out).
- `seq` (round 2): the same lines as `lines`, as an ordered list in document order (`.brief-bar`, then `#brief-main`; the same
  innerText, so the same closed-details rule). Not a multiset section: `diff` reads it only for `lineOrder`, and the phrase scan
  skips it (it scans `lines`). `multiset(seq)` equals `lines` in every record of the round-2 baseline (`dev/r2/strip-check.mjs`).
- `pairs`: `tile|` `kgrid|` `fact|` `stats|` `ftdrow|` (PAIR_CELLS), `dl|<dt>|<dd>`, `tr|<th>|<td> | …`, and the generic bindings
  `li|<first line>|<the rest joined by " / ">` (every li of the bar and #brief-main; sr-only text as innerText gives it),
  `row|<data-symbol>|<the row's lines joined by " / ">` (every candidate row) and `input|<aria-label, else label text>|<value>`
  (every input/select/textarea; checkbox/radio as checked/unchecked), and (round 2) `leg|T<n>|<depth> / <length> / <volume>`
  (every VCP leg button of StockVcpCard, the button holding `.brief-legbar`: its `<b>` and the spans after it, e.g. main's
  ZZNV `leg|T1|−13% / 28日 / 0.90×`, `leg|T2|−4% / 11日 / 0.83×`). Only cells that are rendered and not inside a closed
  `<details>` (outside its summary): in the closed state a pair behind a fold is in `opened.pairs` only.
- `numbers`: the §5.3 number tokens of `lines` and `svg`. `names`: `role "name"` of links, buttons, regions, img, tabs, groups.
- `dock`: the phone's `.brief-dock` outside `#brief-main` (the tab bar, or the stock screen's list position and buttons):
  `line|<text line>` and `name|<role name>`. Never in `lines` or the fold. At >= 1024 the tab bar carries the class inside the
  left pane and is read with `#brief-main`, so the 1440 dock section is empty.
- `fold` (375 and 390f only): the visual lines whose box lies wholly above the dock's top at scroll 0, left to right, top to
  bottom. Text that is clipped (sr-only, clip-path, a 1 px overflow box), invisible, or inside a CLOSED `<details>` outside that
  details' own first `<summary>` is left out (Chrome keeps stale rects for closed-details content above the dock, and no style
  shows it hidden; only the ancestor rule sees it). The summary line itself stays.

View ids: `<market>/<screen>` (market states: m50 m25 below50 ftd ftd5 below200 restrain lag1 series404 manifest503 partunk
ftdconflict basisconflict; screens: today, list-zone/near/all/one, watch4, watch5, watchbroken, market-t0..t3 at 375, market at
1440), `<pend|late>-<m50|m25|below50>/<today|list|watch4|stock-ZZNV>`, `stock-<state>@<pub|m0|unk>`. Modes: `375` (closed,
fold, opened), `390f` (fold only), `1440` (closed, opened).

How a later package extends the yardstick (no tool rewrite): a state = a row in `states.mjs` (MARKETS / STOCKS / NEWER /
ROW_STATES, with a cited recipe and an `expect` reach check); a surface = a row in `surfaces.spec.mjs` SURFACES (reader + parser
that throws on unparsed text); a label/value cell = a selector in `extract.mjs` PAIR_CELLS (most need none: li, rows and inputs
are bound generically); an expected difference = an allow-list entry
(`values.mjs diff`: `{kind: added|removed|movedIntoFold|leftFirstFold|enteredFirstFold|foldOrder|lineOrder|seqMissing, section?, text, views?, reason}`
or `{kind: 'matrix', field: <regex on rows|overflow|bar|dock|reach.model|reach.gate|reach.why|errors|notes>, views?, reason}`;
`surfaces.mjs diff`: `{state?, surface?, change: reading|added|removed|flag, reason}`; `ledger.mjs diff --allow <field regex>`).
Note: adding a state or a surface changes main's baseline file too, so re-run the tool on main (`/home/user/screener/.claude/worktrees/ui-plan`, port 4462) for the new rows before diffing.

## Clock facts (S1-P0 item 6; plan D18) — 実測, `node clock-facts.mjs /home/user/screener/.claude/worktrees/ui-plan main/clock`

- Every static spec opens through `openBrief`, which pins the page clock: `page.clock.setFixedTime(new Date(now))` with
  `now = FINANCIAL_TEST_NOW = 2026-10-03T16:35:00Z` (Sat; `brief-fixture.js:14,443`, `src/static/testFinancialFixture.js:3`).
  Five sites move it and reload: `brief-chart.spec.js:715-722` (10/3 16:35Z, 10/6 16:00Z, 10/7 16:00Z),
  `brief-invariants.spec.js:495-509` (10/3, 10/5, 10/6, 10/7 16:00Z), `brief-freshness.spec.js:9-21` (TWO_LATER 10/7 09:00Z,
  WITHIN_GRACE 10/6 21:00Z), `brief-market-r3.spec.js:171,194` (TWO_LATER). Design Acceptance uses the **actual browser clock**
  (`tools/design-review.mjs:37`) on the current published data (`design-acceptance.yml` copies `frontend/public/static-data`).
- Default fixture: analysis date 2026-10-02 (Fri); sessions end `…09-30, 10-01, 10-02`; the market asset's `refresh_schedule`
  (`brief-fixture.js:383-387`) lists 9/28 … 10/7, each closing 20:00Z, `valid_until` 2026-10-07T23:00Z.
- `marketUpdateState().target` / `verdictWaiting().short` (default market 上昇トレンド 50%; 25%; 0%):

| Clock | target (state) | freshness | verdictWaiting 50% / 25% / 0% |
|---|---|---|---|
| fixture clock 10/3 16:35Z (Sat) | 2026-10-02 (current) | current | null / null / null |
| (a) Mon 10/5 15:00Z, mid-session | 2026-10-02 (current) | current | null / null / null |
| (b) Mon 10/5 20:10Z, 10 min after the close (yard PENDING) | 2026-10-05 (pending) | pending | 10/2時点の判定・更新待ち / same / null |
| (c) Sat 10/3 20:00Z | 2026-10-02 (current) | current | null / null / null |
| (c2) Sat 10/10 16:00Z (past valid_until) | null (unknown) | unknown (bar 鮮度未確認) | null / null / null |
| (d) the real wall clock (2026-11-16) | null (unknown) | unknown (bar 鮮度未確認) | null / null / null |
| brief-chart / brief-invariants 10/6 16:00Z | 2026-10-05 | pending | waiting / waiting / null |
| brief-chart / brief-invariants 10/7 16:00Z | 2026-10-06 | stale (2営業日前) | waiting / waiting / null |
| brief-invariants 10/5 16:00Z | 2026-10-02 | current | null |
| TWO_LATER 10/7 09:00Z (freshness, market-r3; yard LATE) | 2026-10-06 | stale (2営業日前) | waiting / waiting / null |
| WITHIN_GRACE 10/6 21:00Z | 2026-10-06 | pending | waiting / waiting / null |

## Records

### Step 1 (実測)
`git diff --stat bd205842 01066ebe -- frontend backend tools` in `/home/user/screener/.claude/worktrees/ui-plan`: empty (0 lines; the
whole diff touches 4 files under docs/ only). So `$H/snapshot/out/bd20584/counts.json` (sha256 `34024380…289f5f`; listed 980,
certified_listed 615, failedBreakout hit 14, lowRange 24, pinned 22, ready 26, readout_zero_mismatch 4) is main's counts baseline.

### Step 2: the round-3 harness on main 01066eb, CI-faithful, port 4462 (実測, `main-harness.sh`, log `main/harness.log`)
| Check | Output | sha256 | Same as bd20584? |
|---|---|---|---|
| `$H/probe/run-probe.sh … default` | `$H/probe/probe-01066eb.json` (492 label / 480 value views, 0 errors) | `69ce3c5a25d779292e0978c8b09d914aa7b876a9d8d2490adf86e035f67ea326` | identical to `probe-bd20584.json` |
| oracle probe (`… oracles`) | `$H/probe/probe-01066eb-oracles.json` (132 / 132 views, 0 errors) | `98bd4cf26cfe75e3d61f3bf9893713f0d78b27b07ffc0a085ab6a8887095b930` | identical |
| `$H/dump/run-dump.sh` | `$H/dump/dump-01066eb.json` (42 screens, 0 errors) | `aaf7ae71c44852c12772d8925b0380b74fdda25f16460e4bcc5f68371f0d509e` | identical |
| `$H/heights/run-heights.sh` (re-run as `heights-01066eb-yard`) | `$H/heights/heights-01066eb-yard.json` | `e52436276fbd61839ddabf74316d53772e3bf348b54ed37177010970e42d149d` | the 17 screens, 5 cards and 8 governing entries equal both `heights-01066eb.json` (which also carries 390 entries from a 375,390 run) and `heights-bd20584.json` (differs only in its tree/probe names) |
| `$H/build/run-build.sh` | `$H/build/build-01066eb.json` | (not an identity: the file holds vite's 「✓ built in N s」 line, so its sha changes with every build; compare by sizes) | npm run build rc 0, entry index-iuj_DKAx.js **382.74 kB raw / 133.85 kB gzip**; react-vendor 167.06 / 54.38, mui-vendor 418.92 / 128.18, charts-vendor 592.13 / 168.12, ServerApp 673.97 / 205.94; Design Acceptance build entry index-hUwb2OEE.js 382.31 / 133.64 kB, MarketScreen 102.92 / 34.03 — every size equal to the previous `build-01066eb.json` (kept as `main/build-01066eb.prev.json`) |

### Sensitivity (実測; required: a deterministic tool that sees nothing is worthless)
Throwaway worktree `$Y/sens-wt` (`git worktree add --detach … 01066ebe`; node_modules `cp -al` from ui-plan, its `.vite` cache
removed), one scratch commit `4e91cb8` (never pushed; the plants are in `sens/plants.diff`, the commit in `sens/sens-wt-log.txt`):
- (a) one changed number: Today's 注目候補 tile prints `counts.total + 1` (TodayView.jsx:195);
- (b) one swapped label/value pair: Today's TT達成数 and 200日線より上 facts exchange their values (marketTabModel.js:307);
- (c) one dropped sentence inside a fold: the plan card's rule 「損失は最大でも10%未満に抑え、平均の損失はそれより小さく保つ。」
  (StockPlanCard.jsx:198; the rules fold is closed on the phone, open in place at 1440);
- (d) one positionPlan field for one row: SWKS's stop × 0.999 (positionSizing.js:272);
- (e) one surface stating a different figure: the verdict block's exposure `cap * 80` (marketTabModel.js:269: the 市場 tab says
  最大 40% while Today and modelMarket say 50%).
Served on port 4461 while S1 was not served. Then `git worktree remove --force` and `git worktree prune`.

| Tool and command | Result |
|---|---|
| `values.mjs run sens-wt 4461 sens/values --views '^(m50/today\|m50/market-t0\|m50/market\|stock-touch@pub\|m50/watch4)$'`, then `values.mjs diff main/base sens/values --subset` (that `main/base` was S1-P0's baseline, now `main/base-r0`) → `sens/values-diff.txt` | exit 1, 118 differences, all FAIL (no allow-list). **(a)**: `21銘柄 → 22銘柄` in closed/opened lines, numbers, the tile pair, the tile link's accessible name and the first fold at 375 and 390 (Today, and the 1440 left pane of every view). **(b)**: only the pairs section (`fact\|TT達成数\|2銘柄` → `61.0%`, `fact\|200日線より上\|61.0%` → `2銘柄`), lines and numbers unchanged (plus the fold, where the two facts share a visual line). **(c)**: at 375 `removed opened.lines 損失は最大でも…` and nothing in closed (closed ≠ opened proven); at 1440 removed in closed and opened (open in place, and in the right pane of every 1440 view showing ZZNV, the control m50/watch4 included). **(e)**: `最大 50% → 最大 40%` in lines/numbers and the 375/390 first fold of 市場. Control m50/watch4 at 375/390: 0 differences. |
| `surfaces.mjs run sens-wt 4461 sens/values --views '^(m50\|below50)$'`, then `surfaces.mjs diff sens/base-subset sens/values` (main's two states) → `sens/surfaces-diff.txt` | exit 1: **(e)** `m50 market-verdict@390` and `@1440` reading `open/最大50% -> open/最大40%`, `agree figureLoose true -> false`, `figureStrict true -> false`. below50 (control): no difference. |
| `ledger.mjs run sens-wt sens/ledger`, then `ledger.mjs diff main/ledger1/ledger.jsonl sens/ledger/ledger.jsonl` → `sens/ledger-diff.txt` | exit 1, 12 differences, all **(d)** and nothing else: `SWKS pub/f50/unk plan.stop 83.72789999999999 -> 83.64417209999999`, `plan.shares 99 -> 97`, `plan.r2`, `plan.r3` (1845 rows each side). (a)(b)(c)(e) touch no ledger module and the ledger shows none of them; the fixture has no SWKS, so values shows no (d). |

### Main's yard baseline, S1-P0 (SUPERSEDED by round 1; its merged files are now in `main/base-r0/` and `main/rerun-r0/`) (実測; `main-yard.sh`, log `main/yard.log`; tree 01066eb clean, port 4462)
| Output | sha256 | Determinism (run twice; `cmp`) |
|---|---|---|
| `main/base-r0/matrix.json` (419 view-modes: 229 at 375, 190 at 1440; reach 0 unreached, 0 page errors) | `442e394a2b8d83d9841c29fab9552dded70b9be9ac8d7702582f175063af60f5` | IDENTICAL to `main/rerun-r0/matrix.json` |
| `main/base-r0/values.json` (648 view-modes incl. 229 first folds at 390x844) | `7c1be7f92da377259a00ce443d5aa15981bbb2e434a1c365e6471565fe60d2f5` | IDENTICAL to `main/rerun-r0/values.json` |
| `main/base-r0/surfaces.json` (19 states) | `35eb1cb717efaeaaa0804a9a7b6780bf4ce045462ad3db70eada0ce9c1980046` | IDENTICAL to `main/rerun-r0/surfaces.json` |
| `main/base-r0/phrases.json` | `3508ef3b40d4ba5daa2e767fe87c9372868e60a30506ca6ddd4270085c2172da` | IDENTICAL to `main/rerun-r0/phrases.json` |
| `main/ledger1/ledger.jsonl` (615 certified listed rows x 3 markets = 1845 lines) | `f919ea679479d93c9ad9700cbfe4f574bafad56ee3fe2fc19643d58a4d94c2ac` | IDENTICAL to `main/ledger2/ledger.jsonl` |
| `main/clock/clock-facts.json` | (computed; the wall-clock row (d) moves with time by design) | — |

The base run's history (all in `main/yard.log`): two restarts before any output was kept (the first-fold extraction was
changed to group text runs, then to skip visually-hidden text: `.brief-chip-aside`'s `clip-path: inset(50%)`); then the base
run: 642 passed, 6 failed — 5 were the yard's own reach check on the pending stock view (the phone's stock bar names the stock,
not the date: the check was wrong and was fixed in `states.mjs`), 1 was a **Playwright timeout** (`390f pend-m50/stock-ZZNV`,
180 s, inside `settleAll` awaiting an animation's `finished` that never resolved). That test was **re-run once** (with
`settleAll` changed to poll running animations, bounded 15 s) and passed: `values.mjs run … --resume` re-ran exactly those
9 view-modes (639 skipped, 9 passed). The rerun (`main/rerun`, now `main/rerun-r0`, 648 passed, 56.4 min) used the final tool bytes throughout and is
byte-identical to the base, so the base's mixed history changed no output.

Main's own readings that later slices compare against (not failures of the tool):
- surfaces: every state agrees on the answer except **pend-m50, pend-m25, late-m50, late-m25** (the 市場 tab's verdict says
  `10/2時点の判定・更新待ち` while Today's tile and Today's 1440 verdict still say 検討可 / 検討できる: D18's gap, and
  `brief-market-r3.spec.js:181-184` asserts it). `figureStrict` is false on every 0% state (Today's tile and Today's 1440 verdict
  print no figure; the 市場 tab prints 0%); `figureLoose` is true everywhere.
- phrases: 0 hits for してください / 推奨 / 買い時 / 今すぐ / エントリー / 条件中 / ASCII minus; **36 distinct texts with a bare
  「独自」** (独自計算 ×10, 独自近似 ×9, 独自推計 ×6, （独自） ×6, 独自算出, 独自選択, 独自・, 独自の目安) — e.g.
  「10日線・21日EMAは独自計算です。」, 「ADR 1.3%（20日・独自計算）」, 「RS推計 97（1000銘柄中・2026-10-02・独自推計・IBDの公式値ではない）」,
  「独自の目安：上昇トレンド 最大50%…」. The plan's §5.3 rule (「独自」 only before 判定/設定/集計/定義) is not met by main
  itself; the scan gates on **new** hits only, and the conflict is reported, not resolved by widening the rule.

### Screenshots (実測; `shots.sh /home/user/screener/.claude/worktrees/ui-abc-s1 4461 main-yard`)
`$S/ui-abc/shots-main-yard/`: 936 tests passed, 1036 PNGs, 234 MB, `manifest.txt` (sha256 per PNG). Served from the S1 worktree
while it was clean at `01066ebe` (the same commit as main; `shots.log` records tree and clean state), on port 4461, so that
main's port served the determinism runs at the same time. 95 phone and 95 desktop views flagged `shot` in `states.mjs`, at
320x640 / 375x812 / 390x844 / PWA 375 (insets 44/34) / PWA 390 (47/34; Today and stock only) / 1440x900, light and dark;
full-page PNGs for Today and 市場 in m50 / below50 / partunk / manifest503 and every stock state as published, at 375 and 1440.
Views added after this set was taken (flagged `shot: false` in `states.mjs`, so `shots.sh` skips them and main has no PNG
of them): round 1's `stock-bigprice@pub`, `stock-bigprice@m0`, `stock-bigprice@unk` and `row-bigprice/list-all`. A slice that
wants their pictures sets the flag and shoots main and the slice with the same tool bytes.

### Timing: main against main (実測; `timing4.sh ui-plan ui-plan 4462 main/timing 7 main-vs-main`)
`main/timing/timing4-main-vs-main.json` + `.log`. wait-quiet waited 105 s; 1-min load 0.40 at the start (the run's own
Chrome raises it to 3.67 by the end, recorded per run); no foreign process ≥ 5% CPU before (ps list in the json); Node
calibration loop median 905 ms before, 926 ms after; in-page loop 5-8 ms unthrottled, 27-40 ms at CPU 4x. 7 runs per tree,
A/B interleaved, order rotated; opened stock SWKS (390, first row) and HCI (1440, second row, as design-review picks) in 7/7 runs; 0 page errors.

| Width | Tree | first_candidate_ms | longest_initial_task_ms | tab_switch_ms | stock_open_ms |
|---|---|---|---|---|---|
| 390 | A: 01066eb | 2566 | 69 | 238 | 499 |
| 390 | B: 01066eb | 2565 | 75 | 205 | 448 |
| 1440 | A: 01066eb | 2786 | 251 | 344 | 427 |
| 1440 | B: 01066eb | 2632 | 257 | 347 | 452 |

Medians' A-B gaps (the plan's S1-P1 noise band is the larger of this gap and 10 ms): 390 longest 6 → 10 ms, tab 33 ms;
1440 longest 6 → 10 ms, tab 3 → 10 ms. One reading only; S1-P1 runs its own main-against-main in the same session as its
interleaved comparison (never against these numbers). On this host 1440's longest initial task (~250 ms) is over Design
Acceptance's 200 ms budget on main itself (CI read 150): absolute ms are host-specific.

### Which existing checks would see a different screen under D18 (target = marketUpdateState().target on every surface)
- At the fixture clock (every spec except the five sites above) target = 10/2 = the analysis date: verdictWaiting is null in
  every market state → no spec sees a different screen there.
- brief-chart.spec.js:715-722 and brief-invariants.spec.js:495-509 (ZZNV, phone 390 and 1440, default 50% market): at 10/6 and
  10/7 the target is 10/5 / 10/6 → waiting. The phone stock bar is unchanged in S1 (D2), but the 1440 bar chip (S1-P3) would
  read 更新待ち. Their assertions (chart aria-label, earnings flag, 決算…あと N日 in #brief-main) read nothing S1 changes (未検証
  until S1 runs them).
- brief-freshness.spec.js: TWO_LATER (Today/候補/ウォッチ at 320 and 390, the stock bar at 320/390/1440) and WITHIN_GRACE (Today at
  320 and 1440) both have a waiting target → band, chip and gate in the 更新待ち form. Assertions at risk: `:85` Today's stack
  bottom at TWO_LATER must EQUAL its height at the fixture clock (the gate's 更新待ち form + 「・2営業日前」 kicker must not change
  Today's height; S1-P4 lists `:77`); `:112` `.brief-bar-date` toHaveText exactly 「分析基準日 10/2（金）引け・米国株」 (no kind label
  may enter that element on Today); `:95-101` the 1440 stock bar's date line exact text with ≥ 6 px slack (the chip must not
  push it).
- brief-market-r3.spec.js:171-187 (M1e, 320/375): `:184` asserts Today's 地合い tile still `toContainText('目安≤50%')` at TWO_LATER.
  Under D18 Today says 更新待ち and S1-P4 removes the tile: this assertion must change deliberately, and **it is not in S1-P4's
  list** (`brief-market-r3.spec.js:98,139,156,391,423,428`). `:194` (1440, 市場 tab) is unchanged.
- Design Acceptance: the actual browser clock on the current publication, whose `refresh_schedule.valid_until` is target + 46 days
  (`frontend/tools/collect-market-trends.py:89`), so its target is the real last closed session. When it runs after a US close
  and before the next publication on an open-guide day, Today, the band and the chip would read 更新待ち; it asserts no verdict
  text (objective checks and `.brief-bar time[datetime]` only), so no check changes, but its captures depend on the time of
  day (未検証 for a given run).

### Tool bytes and the re-baseline rule
(Round 2: the current pin is `main/tools-r2.sha256` (round 1's was `main/tools-r1.sha256`); the rule below is unchanged.) `main/tools.sha256` pins the bytes of every tool as of the baseline (states.mjs `0980cf1e…`, extract.mjs `4f98138f…`,
matrix.spec.mjs `2bf84349…`, surfaces.spec.mjs `59fbd41e…`). `states.mjs`, `extract.mjs`, `matrix.spec.mjs` and
`surfaces.spec.mjs` are exactly the bytes both determinism runs used (the rerun ran them throughout); `values.mjs` gained only
its exit code afterwards (non-zero on any failed test, unreached state or page error; payload bytes unchanged), `phrases.mjs`
its fold exclusion before either scan, `timing4.spec.mjs` its about:blank parking after the first timing reading.
**Rule:** a new state, screen or surface row only needs `values.mjs run … --resume` / a surfaces re-run on main for the new
ids (existing files are kept); any change to `extract.mjs` (PAIR_CELLS included), `matrix.spec.mjs` or the settle helpers needs a
FULL main re-run (`--resume` never re-extracts an existing view), and a new baseline sha recorded here.

### Allow-list mechanics (実測, no browser; `sens/allow/`, `sens/synth/`)
- (In this section `main/base` is S1-P0's baseline, now `main/base-r0`.) `values.mjs diff main/base sens/values sens/allow/a-only.json --subset`: the 48 rows of plant (a) turn `allowed`, exit stays 1
  (70 FAIL left: (b), (c), (e), and (a)'s fold rows, whose kinds the list does not name); with `sens/allow/all.json`: 118 allowed,
  0 FAIL, exit 0.
- `sens/synth`: one base view (375 m50/today) with one line removed from `closed.lines` only (the IBD sentence, still in
  `opened`): `removed closed.lines` + `movedIntoFold`, exit 1; with an allow-list naming both kinds: exit 0.
- `surfaces.mjs diff … sens/allow/surfaces-readings.json`: the two readings allowed, the two flag rows still FAIL (exit 1);
  allowing reading+flag for m50: exit 0. `ledger.mjs diff … --allow '^plan\.(stop|shares)$'`: 6 allowed, 6 FAIL (r2, r3), exit 1;
  `--allow '^plan\.'`: exit 0.
- The first fold sees the viewport: main's Today fold at 375x812 is 25 lines ending at candidate 4's second line; at 390x844 it is
  26 lines and includes candidate 5's first line (`main/base-r0/values.json`; unchanged in round 1's `main/base`).

### Screenshot source cross-check (実測)
`shots.sh /home/user/screener/.claude/worktrees/ui-plan 4462 main-check '^(m50/today|stock-touch@pub|below50/market-t0)$'` with
`YARD_SIZES=375x812,1440x900,pwa390 YARD_THEMES=light,dark`: 14 tests, 24 PNGs, **24/24 byte-identical** (sha256) to the same
files in `shots-main-yard/manifest.txt` (shot from the S1 worktree at 01066ebe). The check dir was then deleted.

### Timing, second reading with parked pages (実測; `timing4-main-vs-main-parked.json`)
Each page parked on about:blank after its run. Load 0.41 at the start (wait-quiet 45 s), 3.68 at the end: the climb is the
measured Chrome itself at CPU 4x, not the idle tree (parking did not lower it). Medians: 390 A 2108 / 75 / 210 / 492, B 2197 / 81 /
239 / 483; 1440 A 2754 / 242 / 364 / 448, B 2648 / 254 / 339 / 438 (first / longest / tab / stock, ms). A-B gaps: 390 longest 6,
tab 29; 1440 longest 12, tab 25. With the first reading (tab gaps 33 and 3) the tab switch's noise on this host is about 25-35 ms.

### Limits (say them; not fixed here)
- values reads `.brief-bar`, `#brief-main` and (round 1) the phone dock; `title` attributes are not compared; accessible names
  come from Playwright's aria snapshot of the same roots.
- The first fold is collected at 375x812 and 390x844 only: there is no 1440-only fold (the 1440 view is `closed` and `opened`).
- Closed-`<details>` content keeps stale rects in Chrome: anything rect-based about it (the off-hash `foldcheck.json`) depends on
  the order of DOM reads, so it is never in a hashed file.
- The installed-PWA sizes are in the screenshots only (no values/fold extraction).
- The ledger mirrors 01066eb's call sites (StockVerdict.jsx:120, StockPlanCard.jsx:34-43, StockView.jsx:54-60) and merges no
  research detail; a slice that changes a call site must mirror it in `ledger.mjs`.
- The cause of the one 180 s hang (an animation whose `finished` never resolved) is 未検証; `settleAll` now polls running
  animations with a 15 s bound.
- Market tabs at 375 are tabs 0-3 by index; the 市場 tab count is 4 on main.
- (Round 2) `seq` is DOM order: a reorder made by CSS alone (`order`, `flex-direction`, grid placement) keeps `seq` and is seen
  only in the first fold (`foldOrder`, 375 / 390) and in the screenshots.
- (Round 2) `lineOrder` keeps one LCS in place, so in a two-block swap the SMALLER block's lines are the ones reported (the view
  FAILs either way); a line whose text appears on one side only is `added` / `removed`, never `lineOrder`.
- (Round 2) 390f writes no matrix record (fold only), so a page error or a note seen only at 390x844 reaches neither
  `values.mjs diff` (order 3's check reads matrix records) nor the run's exit code (merge counts errors from matrix.json);
  375 and 1440 are covered. The same page code serves 375 and 390, so a 390-only error is unlikely, but it is not checked.

### Errata in cited lines (the `src` strings are inside `matrix.json`, so they are corrected here, not in states.mjs)
`brief-invariants.spec.js` fit/onRow are :14-15 (cited 15-16), failedBreakout :19-29 (cited 20-30), broken :31-36 (cited
32-37); `brief-market-r3.spec.js` gspcRally :384-385 (cited 383-384); `brief-freshness.spec.js` TWO_LATER :11 and WITHIN_GRACE :12
(cited 9 and 10-11; also in clock-facts.mjs's case names). All other cited lines were checked with `grep -n` and are exact.

### Deviations from the order
- `docs/ui-abc/s1.md` is not written: S1-P0 allows no repository edit. Its P0 entry is for the next package to write.
- Shots were taken from the S1 worktree (clean at 01066ebe) on 4461 while main's port ran the determinism runs; a 24-PNG
  cross-check from ui-plan on 4462 is byte-identical (above).
- Declared gaps (no recipe on main): no pivot, vcp_pivot fallback price (S2 adds them in its own spec files), stop
  reached / analysis-day breakout (S2-P6). (Round 2 correction: the stale-pivot GATE is covered by `stock-bigprice@pub/m0/unk`,
  BIG_PRICE on ZZNV, which main pins at data-gate `stalePivot`; only a dedicated stale-pivot recipe is missing, and `states.mjs`
  GAPS now says so.) Round 1: the four-digit price is no longer a gap (brief-rows.spec.js:152 BIG_PRICE is
  a row-level recipe; states `stock-bigprice@*` and `row-bigprice/list-all`); weekly-pattern pivot is covered by ZZHB and a
  sell chip the call does not state by ZZNR. YARD-OWN recipes, each reach-checked through the tree's own modelMarket / data-gate:
  新規購入を抑制 (rows' regime correction above both lines), one condition unknown (50-day field null on every row: main says
  市場未確認), the applied structural stop (stored `structuralSymbols: ['ZZSD']`).
- The base run was restarted twice before any output was kept, and one Playwright timeout was re-run once (above).
- The throwaway tree was served on 4461 (S1 not served at the time).

## Round 1: the conductor's orders on S1-P0 (tool changes, one full main re-baseline)

Everything below is 実測 on main 01066eb (worktree ui-plan, port 4462) unless a line says otherwise. The S1-P0 baseline's merged
files and the tool bytes it was made with are kept in `main/base-r0/` (values `7c1be7f9…`, matrix `442e394a…`, phrases
`3508ef3b…`, surfaces `35eb1cb7…`; `main/base-r0/tools/`). Round 1's tool bytes: `main/tools-r1.sha256` (checked with
`sha256sum -c` before run A and after run B).

### What changed in the tools
| Order | Change | File |
|---|---|---|
| 1 [major] | The closed-`<details>` rule: a node is folded away when an ancestor `<details>` is closed and the node is not inside that details' own first `<summary>`. Applied to the first fold AND to every pair cell, SVG text, li, row and input (one predicate in one page function, `pageSide`). The fold record also yields `noRule` / `skipped` into the off-hash `foldcheck.json`. | `extract.mjs`, `matrix.spec.mjs`, `values.mjs` (merge) |
| 2 [major] | Generic bindings: `li|<first line>|<rest>` (every visible li of the bar and #brief-main), `row|<symbol>|<lines>` (every candidate row), `input|<aria-label or label>|<value>` (every input/select/textarea). | `extract.mjs` |
| 3 [major] | `values.mjs diff`: kind `foldOrder` (LCS over the lines common to both folds, occurrence-indexed; prints the first displaced line with old and new index), and the matrix section (FAIL on rows as an ordered list, overflow, bar, dock, reach.model, reach.gate, non-empty reach.why; page/content heights printed as info); allow-list kinds `foldOrder` and `matrix` (with `field`). | `values.mjs` |
| 4 [minor] | BIG_PRICE (brief-rows.spec.js:152, its onRow :36) as `stock-bigprice@pub/m0/unk` (ZZNV; reach: data-gate `stalePivot` as main gives it, text `\$1,23[45]`) and `row-bigprice/list-all` (候補 選定すべて + 「さらに表示」: ZZNV sorts 21st, past the phone's 20-row page; reach: text 「前日比 −12.3%」); GAPS keeps stale pivot / no pivot / vcp_pivot fallback for S2's own spec files. `reachOf` records `now` = the page's `Date.now()` and fails the reach when it is not the view's clock (or the fixture's `now`). | `states.mjs`, `extract.mjs` (step `more`), `matrix.spec.mjs` |
| 5 [minor] | `.brief-dock` (outside #brief-main) as section `dock` (`line|…`, `name|…`), scanned by phrases, diffed by values; `values.mjs run` refuses a dirty tree (tracked or untracked) with exit 2 unless `--allow-dirty`; `ledger.mjs` writes `dirty` into ledger-meta.json and warns; the README compares the build by sizes. | `extract.mjs`, `values.mjs`, `phrases.mjs`, `ledger.mjs`, this file |

### The re-baseline (one full main re-baseline, run twice)
| Run | Command | Result |
|---|---|---|
| A (baseline) | `node values.mjs run /home/user/screener/.claude/worktrees/ui-plan 4462 $Y/main/base-r1` (log `main/r1/runA.log`; 20:48-21:45Z, load 0.38 → 0.64) | 660 passed (56.6 min), 0 unreached, 0 page errors, 0 notes, no timeout, no re-run. 427 matrix records (233 at 375, 194 at 1440), 660 values records (incl. 233 folds at 390x844). |
| B (determinism) | the same into `$Y/main/rerun-r1` (driver `dev/r1-runB.sh`, log `main/r1/runB.log`; 21:59:20-22:57:52Z, load 0.72 → 0.92) | 660 passed (58.4 min), 0 unreached, 0 page errors, 0 notes, no timeout, no re-run; tools checked against `tools-r1.sha256` before and after. **matrix.json and values.json byte-identical to run A** (`cmp`). |

One aborted attempt before run A, recorded: the first run A (20:43Z) was stopped by hand after about 3 minutes because the
round-1 rewrite of `clean()` had lost its NBSP (`[ \t ]` became `[ \t ]`, so 「Code 33」 no longer read 「Code 33」:
found by `dev/rebase-check.mjs` on a subset); the byte was restored (`clean` is again byte-identical to S1-P0's line), its
partial output deleted, and the tools re-frozen (`main/tools-r1.sha256`; the mis-copied hash is kept as
`dev/tools-r1-misCopiedClean.sha256`). No output of the aborted attempt is used anywhere.

**The container restart (recorded).** The container was restarted around 21:52Z on 11-16 while the first run B (started
21:44:55Z) was running; its process and servers were lost. Its log has no closing rc line, so it counts as interrupted: the log is
kept as `main/r1/runB.interrupted.log`, its partial output (`main/rerun-r1`, 3 raw dirs) was deleted unused, and run B was
re-run **from the start** (21:59:20Z) with the same tool bytes (`sha256sum -c main/tools-r1.sha256`: OK before and after).
Run A, the ledger pair, the round-1 sensitivity run and the fold-order probe finished before the restart and were kept after
re-checking their outputs offline (below). `main/r1/postA.txt` shows `rc=1` for `dev/rebase-check.mjs`: that run predates the
classification of the 8 stale-rect folds and is superseded by `main/r1/rebase-check.txt` (exit 0, UNEXPLAINED 0), which a re-run
after the restart reproduces byte for byte.

The offline re-checks after the restart (実測 between 21:59Z and 23:15Z on 11-16, tools as in `main/tools-r1.sha256`):
- `node dev/rebase-check.mjs main/base-r0 main/base-r1`: exit 0, output byte-identical to `main/r1/rebase-check.txt`.
- `node values.mjs diff main/base-r1 sens/values-r1 --subset`: exit 1, 1094 FAIL, output byte-identical to `sens/values-r1-diff.txt`.
- The fold-order table recomputed (python) from `dev/probe/out/order.json` (20 entries) against `base-r0` / `base-r1`: all 20 rows
  equal `main/r1/fold-order-probe.txt`. That probe's Playwright log was not kept; its JSON is written after every test, and holds 20.
- The synthetic matrix-rows swap re-run (`values.mjs diff main/base-r0 sens/synth-order` exit 1, `FAIL 375 m50/list-zone matrix rows`;
  with `allow.json` exit 0): appended to `sens/order-acceptance.txt`.
- `main/r1/ledger-a` and `ledger-b`: both `f919ea67…`, equal to `main/ledger1`, 1845 lines, ledger-meta `dirty: clean`.
- `sens/values-r1/meta.json`: tree 8a71148 (the plant commit), clean, 12 passed. The throwaway tree is gone, so the round-1 plant
  run, the clock negative probe (`sens/clock-negative.txt`) and the dirty check (`sens/dirty-check.txt`) were not re-run: their
  records are kept as measured before the restart.
- Not re-run with round-1 tool bytes: S1-P0's plants (a)-(e). They carry over because the r0 -> r1 rebase-check finds lines, svg,
  numbers, names and the pre-existing pair kinds unchanged in every pre-existing view, and surfaces and the ledger are byte-identical.

**Layout after round 1.** `main/base` → `base-r1/` and `main/rerun` → `rerun-r1/` (symlinks; both hold `raw/` for `--resume` (deleted in round 2),
the surfaces and the phrases); S1-P0's `main/base` (merged files byte-equal to `base-r0/`) was removed after moving its two logs
into `base-r0/`, and S1-P0's `main/rerun` is now `main/rerun-r0/` (merged files and logs; its `raw/` deleted). The ledger baseline
stays `main/ledger1/` (round 1's two ledger runs are byte-identical to it).

| Output | sha256 (round 1) | Determinism |
|---|---|---|
| `main/base/matrix.json` (427 view-modes) | `d5f573a397a73451e840eede52ba4449dbbcb0593d4aa2696d316714c384c8c9` | IDENTICAL to `main/rerun/matrix.json` (run B) |
| `main/base/values.json` (660 view-modes) | `4601f4cfb4fd0a2e4f3ba618b832e4fa35cff76402e5d06c7fd1406c9f831bd9` | IDENTICAL to `main/rerun/values.json` (run B) |
| `main/base/phrases.json` | `32c1a21ac1d35485146078c28fae8684c04ac81d1e374874a63fcc2b7c186d90` | IDENTICAL to `main/rerun/phrases.json` (`phrases.mjs scan` of run B) |
| `main/base/foldcheck.json` (off-hash diagnostics) | `cbe6769d…` (not a gate: rect-dependent) | equal in run B too (`cmp`), but never gated |
| `main/r1/ledger-a/ledger.jsonl`, `ledger-b` (`ledger.mjs run ui-plan …` twice) | `f919ea679479d93c9ad9700cbfe4f574bafad56ee3fe2fc19643d58a4d94c2ac` | IDENTICAL to each other and to S1-P0's `main/ledger1` (ledger-meta: tree 01066eb, dirty `clean`, 1845 lines; bundle sha differs only by the output dir's relative paths) |
| `main/base/surfaces.json` (19 states; `surfaces.mjs run ui-plan 4462 main/base-r1`, then the same into `main/rerun-r1`; 19 passed, 3.7 and 3.6 min, 22:58-23:05Z) | `35eb1cb717efaeaaa0804a9a7b6780bf4ce045462ad3db70eada0ce9c1980046` | IDENTICAL to `main/rerun/surfaces.json`, and byte-identical to S1-P0's `main/base-r0/surfaces.json` (`surfaces.mjs diff main/base-r0 main/base-r1`: 0 differences): the round-1 changes to `states.mjs` / `extract.mjs` (which surfaces.spec.mjs imports) changed no surface reading |

### Order 1 acceptance (実測)
(1) `main/r1/postA.txt`: the closed first fold of main's 市場 tab keeps the summary 「目安と判定の基準・」 and no longer holds
「独自の目安：」 or 「TT達成数の急減（10営業日前が20銘柄未満）」:

| View | S1-P0 fold | round-1 fold | 目安と判定の基準・ | 独自の目安： | TT達成数の急減（10営業日前が20銘柄未満） |
|---|---|---|---|---|---|
| 375 m50/market-t0 | 38 lines | 24 | kept | gone | gone |
| 375 m50/market-t1 | 39 | 25 | kept | gone | gone |
| 390f m50/market-t0 | 41 | 26 | kept | gone | gone |
| 390f m50/market-t1 | 43 | 27 | kept | gone | gone |

(2) `sens/r1-acceptance.txt` (plant P1, a closed `<details><summary>注</summary>` around MarketCard.jsx:91's note):
`leftFirstFold` for BOTH visual lines (「地合いの判定・各集計・RS推計は公開日足からの独自判」 and 「定・独自集計で、IBDの公式値ではありません。」)
at 375 m50/today AND at 390f m50/today, plus `enteredFirstFold 注`, `removed` + `movedIntoFold` in closed.lines (375 and 1440).
The S1-P0 tool kept the sentence in the 390f fold (stale rects); the rule fixes both sizes.

(3) `main/r1/rebase-check.txt` (`node dev/rebase-check.mjs main/base-r0 main/base-r1`, exit 0, UNEXPLAINED 0): of the 458 folds
both baselines have, **310 are byte-unchanged and every one of them had no closed-details text above the dock** (`noRule` =
the fold); **148 changed, and every changed fold had closed-details text** (`noRule` ≠ the new fold): 140 where the rule-less fold
of this run reproduces S1-P0's fold exactly, and 8 (375 manifest503/market-t0..t3, series404/market-t0..t3) where it does not
because stale rects moved between runs. For those 8, `main/r1/fold-order-probe.txt` (a probe on ui-abc-s1 at 01066ebe, port
4461): read in S1-P0's order (S1-P0's collectValues, then the fold) the rule-less fold equals S1-P0's fold for all 8 (and the
2 controls m50/market-t0/t1), and the round-1 fold equals the new baseline's in that order AND when the fold is read first: the
round-1 fold does not depend on the read order; the rule-less one does. Changed folds by family: every market state's 市場 tabs
and 候補 views (10 each: the 候補 screens' closed 「選定銘柄＝…」 note, the 市場 tabs' closed 根拠/目安 bodies), manifest503 16,
series404 10, pend/late-*/list 2 each. Three examples (removed lines / added lines):
- `375 basisconflict/list-zone`: removed 「選定銘柄＝トレンドテンプレート8条件と日足の整合性」, 「をすべて満たす銘柄。あと1条件＝未達が1つだけで未確」, … (7 lines of the closed 注記), added none.
- `390f basisconflict/list-zone`: removed the same note's 9 visual lines at 390, added none.
- `390f series404/market-t3`: removed 「根拠（10/2スキャン時点）：S&P 500（SPY）が50日」, 「独自の目安：上昇トレンド 最大50%・上昇に圧力 最大」, … and the interleaved 「日線と局面判定から。バックエンドの局面判定の目安指数 参加度 リーダー 推移」; added the visible lines they were interleaved with (「指数 参加度 リーダー 推移」, 「? ? ? ?」, …).

Every other difference old → new is one of (counts of view-mode × section rows): new pair kinds (closed: li 8300, row 2063,
input 1025; opened: li 10493, row 2063, input 1224 distinct strings), the dock section (419 + 419), 22 closed `dl||` pairs gone
(dt/dd cells inside a closed `<details>`: innerText gives '' there, so S1-P0 recorded an empty pair; the same 4 cells per view
read in full in `opened.pairs`, unchanged), and `reach.now` in all 419 old matrix records (every other matrix field equal).
lines, svg, numbers and names: 0 differences in every pre-existing view.

### Order 2 acceptance (実測; `sens/r1-acceptance.txt`)
Plants in `sens-wt` (scratch commit `8a71148` on 01066ebe, `sens/plants-r1.diff`): P2 template evidence swap
(`ruleEvidence(rules[i ^ 1] ?? rule)`, StockTemplateCard.jsx RuleList), P3 the first two sell checks of each group exchange
their detail texts (StockSellCard.jsx SellChecks), P4 `STOP_DEFAULT_PERCENT` 7 → 8 (positionSizing.js). `values.mjs diff
main/base-r1 sens/values-r1 --subset`: exit 1, 1094 differences, all FAIL. The swapped renders, as read:
- P2 at 375 (opened.pairs) and 1440 (closed and opened): `li|✓|株価 > SMA50 / （達成） / 110.74 > 99.67` → `… / 52週安値から +50.0%`,
  `li|✓|52週安値から ≥ 30%（日中安値） / （達成） / 52週安値から +50.0%` → `… / 110.74 > 99.67`, 8 rules on stock-touch, 6 on stock-tt7.
- P3 at 375 and 1440: `li|·|出来高を伴う50日線割れ（1.40×以上） / （サインなし） / 終値は50日線から +3.6%` → `… / 最大は 6/5 の −3.2%` and
  `li|·|起点以来で最大の1日の下落（直近5営業日） / （サインなし） / 最大は 6/5 の −3.2%` → `… / 終値は50日線から +3.6%` (the strength
  group's first two share one detail, so only the weakness group's swap is visible: a null half-plant, said here).
- P4: `input|損切り幅（%）|7` ×2 (number and range) → `input|損切り幅（%）|8` ×2 in opened.pairs at 375 and closed + opened at 1440
  (the inputs are in the plan card's fold on the phone).
- Controls: 375 and 390f m50/watch4: 0 differences. The S1-P0 tool saw none of P2 at 375 (conductor's record).

### Order 3 acceptance (実測; `sens/order-acceptance.txt`, `sens/synth-order/`)
- The conductor's synthetic (`../verify-p0/synth-b`: 375 m50/watch4's fold reversed, 375 m50/today's first six fold lines moved
  to the end) against `main/base-r0`: `FAIL 375 m50/today foldOrder fold ×6 米国株スクリーナー [old index 0 -> new index 19 (6 of 25
  common lines displaced)]` and `FAIL 375 m50/watch4 foldOrder fold ×9 米国株スクリーナー [old index 0 -> new index 11 (9 of 12 common
  lines displaced)]` (12 lines, 11 distinct: the two 「● 10/2ピボット到達 TT 8/8 出来高 1.60×」 lines keep an LCS of 3), exit 1 (S1-P0's
  tool: 0 differences, exit 0). With an allow-list naming `foldOrder` for m50/today only: that row allowed, watch4 still FAIL, exit 1.
- A synthetic swap of two entries of `rows` in `375 m50/list-zone` (`sens/synth-order/matrix.json`): `FAIL 375 m50/list-zone matrix
  rows ×1 ["ZZNV","ZZKS",…] -> ["ZZKS","ZZNV",…]`, exit 1; allowed by `{"kind":"matrix","field":"^rows$","views":"m50/list-zone"}`, exit 0.
- Main against main: `values.mjs diff main/base-r0 main/rerun` (that `main/rerun` is S1-P0's re-run, now `main/rerun-r0`) → 0 differences (419 matrix records compared), exit 0; round 1:
  `values.mjs diff main/base-r1 main/rerun-r1` → `{"differences":0,…,"matrix":{"compared":427,"differences":0,"failures":0,"info":0}}`, exit 0
  (`main/r1/postB.txt`; the same through the `main/base` / `main/rerun` symlinks).

### Order 4 acceptance (実測)
- BIG_PRICE: `stock-bigprice@pub` reaches data-gate `stalePivot` at 375 and 1440 (main's own value, pinned after observing it);
  the bar reads `$1,235` at 375 and `$1,234.56` at 1440; `row-bigprice/list-all` lists ZZNV 21st (`rows` ends `…ZZCM, ZZPF, ZZNV`)
  at 375 (after 「さらに表示」) and 1440, its row `row|ZZNV|21 / ZZNV / 前日比 / −12.3% / … / ▲ 旧ピボットから +1015%・有効な買い水準なし / …`.
- The clock check (`sens/clock-negative.txt`): with a run-dir copy of extract.mjs whose openView does not move the clock,
  pend-m50/today fails at 375 and 390f with only `page clock 2026-10-03T16:35:00.000Z != 2026-10-05T20:10:00.000Z` (its bar checks
  pass at the fixture clock: S1-P0 could not tell). In the baseline every view's `reach.now` is its clock: fixture views
  2026-10-03T16:35:00Z, pend-* 2026-10-05T20:10:00Z, late-* 2026-10-07T09:00:00Z.

### Order 5 acceptance (実測; `sens/dirty-check.txt`)
- `values.mjs run` on sens-wt with one untracked file: `refused: … is dirty: ?? frontend/yard-dirty-probe.txt …`, exit 2, nothing
  started. `ledger.mjs run` on it: warning on stderr and `"dirty": "dirty: ?? frontend/yard-dirty-probe.txt"` in ledger-meta.json.
- The dock: e.g. `375 stock-touch@pub` closed.dock = `line|1/5`, `line|5件中1件目`, `line|注目候補（上位）`, `name|button ウォッチから外す`,
  `name|button 前の候補`, `name|button 次の候補`; Today/候補/ウォッチ/市場 at 375: the four tabs (`line|今日` …, `name|link ウォッチ 4件` …);
  1440: empty (the tab bar is inside #brief-main there).
- Phrases (`main/r1/phrases-r0-r1.txt`): 9 new bareDokuji texts, all `li|…` pair strings re-reading lines already in S1-P0's
  hits (「10日線・21日EMAは独自計算です。」, RS推計 rule rows 「…独自推計…」, the sell note); no new rule, no new line.

## Round 2: the conductor's second orders on S1-P0 (tool changes, one full main re-baseline)

Everything below is 実測 on main 01066eb (worktree ui-plan, port 4462) unless a line says otherwise. Round 1's baseline and tool
pin are kept (`main/base-r1/`, `main/rerun-r1/`, `main/tools-r1.sha256`). Round 2's tool bytes: `main/tools-r2.sha256`
(written 01:08Z on 11-17, after the offline and live pre-checks below; `sha256sum -c` before every run and after it). Three
files changed against round 1's pin: `extract.mjs` (`9d097a6c…`), `values.mjs` (`970112e5…`), `states.mjs` (`59bcc55e…`; the
GAPS text only, which no output carries); the other 14 are byte-identical to `tools-r1.sha256`.

**Status: round 2 DONE (03:12Z on 11-17).** Pin written 01:08Z; planted acceptance run `sens/values-r2` 01:08:39Z; run A
(`main/base-r2`, `dev/r2/runA.sh`, `main/r2/runA.log`) 01:09:24-02:06:59Z rc=0; `dev/r2/postA.sh` rc=0 (`main/r2/postA.txt`);
run B (`main/rerun-r2`, `dev/r2/runB.sh`, `main/r2/runB.log`) 02:07:22-03:04:52Z rc=0; `dev/r2/postB.sh` 03:05:04-03:12:26Z
rc=0 (`main/r2/postB.txt`: A = B, surfaces twice, symlinks moved, final acceptance). Every log closes with its rc line.

### What changed in the tools
| Order | Change | File |
|---|---|---|
| 1 [major] | (1) `seq`: per view, closed and opened, the ORDERED visible lines of `.brief-bar` and `#brief-main` (the same innerText lines as `lines`, in document order: the closed-details rule is the same by construction). (2) `values.mjs diff` kind `lineOrder` (section `closed.seq` / `opened.seq`): an LCS over the lines common to both sides, one FAIL row per displaced line with its old and new index; allow-listable as `{kind:'lineOrder', text, views?, reason}` (text may be `/regex/`). Kind `seqMissing` FAILs a record that has no `seq` on either side (a pre-round-2 baseline), so the check is never silently skipped. (3) Pair `leg|T<n>|<depth> / <length> / <volume>` from every VCP leg button (the button holding `.brief-legbar`: its `<b>` and the spans after it), under the same `shown()` rule as every pair. | `extract.mjs`, `values.mjs` |
| 2 [minor] | GAPS row 'stale pivot' now says the stale-pivot gate is covered by `stock-bigprice@*` (BIG_PRICE on ZZNV, data-gate `stalePivot`) and only a dedicated stale-pivot recipe is missing; the README's gap line says the same. | `states.mjs`, this file |
| 3 [minor] | `values.mjs diff`'s matrix section FAILs (kind `matrix`, field `errors` / `notes`) when the slice's record has an entry (as a multiset) that the base's record has not; allow-listable as `{kind:'matrix', field:'^errors$', views?, reason}`. | `values.mjs` |
| 4 [minor] | The section `### The harness dump from S1-P3 on` below. | this file |

`lineOrder` differs from `foldOrder` in one deliberate way: its LCS runs on the raw texts, without foldOrder's occurrence index.
A whole page repeats 「✓」, 「未確認」, 「前日比」 dozens of times; with an occurrence index, one repeat added anywhere (a new
「未確認」 in the band) would shift every later repeat and read as a reorder. On raw texts the result is empty exactly when the
slice's sequence is the base's with lines inserted and deleted only, and a line is reported only when it is outside the LCS on
both sides beyond what `added` / `removed` account for. Prefix and suffix are trimmed before the DP. `foldOrder` is unchanged.

### Offline checks before the pin (実測; `dev/r2/synth-test.mjs`, output `dev/r2/synth-test.txt`)
- `lineOrder`: identical → 0; a duplicate 「未確認」 inserted early → 0; two new lines at the top → 0; one duplicate removed → 0;
  two cards swapped → 3 displaced (the smaller card's lines); two depths swapped (`T1 −13% T2 −4%` → `T1 −4% T2 −13%`) → 2;
  one duplicate 「✓」 moved down → 1.
- `diffValues` on the card swap: 6 FAIL (3 closed.seq + 3 opened.seq); allow-listing ONE displaced text leaves 4 FAIL; allowing
  `/./` for the view → 0. A base without `seq` → `FAIL seqMissing closed.seq no seq in base` (and opened).
- matrix: an injected page error → `FAIL matrix errors [] -> [...]`, an injected note → `FAIL matrix notes`; the same entry in
  both records → no row; an entry only in the base → no row; the same error twice in the slice, once in the base → FAIL.

### Live pre-check before the pin (実測; `dev/r2/precheck.sh`, log `dev/r2/precheck.log`, diff `dev/r2/precheck-diff.txt`)
`values.mjs run ui-plan 4462 dev/r2/main-sub --views '^(stock-touch@pub|stock-ready@pub)$'` (6 passed, 26.0 s) and the same on
the planted tree (4461, 6 passed, 26.9 s), 01:06:53-01:07:48Z, load 0.20 → 2.35. Main's leg pairs, as read:
`leg|T1|−13% / 28日 / 0.90×`, `leg|T2|−4% / 11日 / 0.83×` (ZZNV, stock-touch) and `leg|T1|−18% / 19日 / 1.04×`,
`leg|T2|−8% / 11日 / 0.72×`, `leg|T3|−5% / 8日 / 0.51×` (ZZRD, stock-ready), at 375 and 1440, closed and opened.
`node dev/r2/strip-check.mjs main/base-r1 dev/r2/main-sub --subset`: the 6 new records minus `seq` and the 20 `leg|` pairs
equal round 1's records, `multiset(seq)` = `lines` in all 12 parts, the 4 matrix records equal (exit 0).

### Order 1 acceptance: the plants (実測; `sens/values-r2`, log `main/r2/plant-r2.log`)
Throwaway worktree `$Y/sens-wt` (`git worktree add --detach … 01066ebe`; `git apply --check` then `git apply` of the
conductor's `../verify-p0-r3/plants-r3.diff`; scratch commit `6bb95ce6`, never pushed; node_modules `cp -al` from ui-plan, its
`.vite` removed), served on 4461 while S1 was not served. `values.mjs run sens-wt 4461 sens/values-r2 --views
'^(stock-touch@pub|stock-ready@pub)$'` with the pinned tools: 6 passed (25.4 s), 01:08:39Z, byte-identical to the pre-check's
planted run (`cmp`). The diff against the new baseline (`node values.mjs diff main/base-r2 sens/values-r2 --subset`, run A's
baseline; repeated through the `main/base` symlink by `dev/r2/postB.sh`, output `main/r2/accept-plants.txt`; run A's copy
`main/r2/accept-plants-A.txt`): **exit 1, 277 differences, all FAIL** (`added` 44, `removed` 108, `lineOrder` 89, `movedIntoFold`
36; matrix 4 compared, 0 differences). Per view-mode (kind/section × rows):

| View-mode | FAIL rows | What they show |
|---|---|---|
| 375 stock-touch@pub (ZZNV) | leg pairs: added 2 + removed 2 in closed.pairs, the same in opened.pairs; `lineOrder` 5 in closed.seq, 5 in opened.seq | depth swap: `removed leg\|T1\|−13% / 28日 / 0.90×`, `added leg\|T1\|−4% / 28日 / 0.90×`, `removed leg\|T2\|−4% / 11日 / 0.83×`, `added leg\|T2\|−13% / 11日 / 0.83×`; card order: `lineOrder closed.seq 機関の保有（13F） [old index 176 -> new index 114 (5 of 206 common lines displaced)]`, `13F の集計値は未取得です。` 177 → 115, the 13F note 178 → 116, plus `−13%` 95 → 99 and `−4%` 99 → 95 (the swapped depths as lines) |
| 375 stock-ready@pub (ZZRD) | leg pairs: added 2 + removed 2 in closed and in opened; `lineOrder` 4 in closed.seq, 5 in opened.seq | depth swap: `leg\|T1\|−18% / 19日 / 1.04×` → `leg\|T1\|−8% / 19日 / 1.04×`, `leg\|T2\|−8% / 11日 / 0.72×` → `leg\|T2\|−18% / 11日 / 0.72×` (T3 −5% is legs[3] ?? leg: unchanged, no row); card order: closed.seq `業績の加速` 121 → 124 and `業績：SEC未配信・Code 33 未確認` 122 → 125 (on the phone the fundamentals card shows two lines closed, the smaller block, so the LCS reports it), opened.seq `機関の保有（13F）` 167 → 154 and the two 13F lines 168 → 155, 169 → 156 |
| 390f stock-touch@pub, 390f stock-ready@pub | none | the first fold at 390x844 reaches neither the VCP card nor the two cards (the plants are below it): 0 differences is the right answer there |
| 1440 stock-touch@pub, 1440 stock-ready@pub | each: the same leg pairs (2 added + 2 removed, closed and opened); `lineOrder` 16 in closed.seq = 2 depth lines + 3 13F-card lines + 11 left-pane lines, 19 in opened.seq = 2 + 3 + 14; `movedIntoFold` 18; the tile / li / fact pairs, lines, numbers and names of the left pane | the stock pane's two plants as at 375; the left pane's TodayView plants: the summary moved below the market card (the 11 / 14 left-pane `lineOrder` lines: 地合い, 市場の詳細, 上昇トレンド（独自判定）, 注目候補, 21銘柄, …), `目安≤40%` for `目安≤50%` (tile and li pairs, the tile link's name, numbers `40%` / `50%`); MarketCard's facts inside a closed 内訳 (the four `fact\|…` pairs leave closed.pairs, their 18 lines `movedIntoFold`, `内訳` added). MarketScreen's stats swap and buyGate's stale reference do not render in these views (no `stats\|` row, 0 grep hits): they are seen on the 市場 tab and in the ledger |

Before round 2 the same planted run gave records byte-identical to `main/base` at 375 / 390f for both views (the conductor's
record): values now sees both plants on the phone.

### Order 3 acceptance (実測, offline; `dev/r2/order3-acceptance.txt`)
`dev/r2/synth-matrix` = `dev/r2/main-sub` (the live pre-check's main records, with `seq`) with one page error injected into
`375 stock-touch@pub` and one note into `1440 stock-ready@pub` (`allow.json` beside it):
- `node values.mjs diff dev/r2/main-sub dev/r2/synth-matrix` → `FAIL 1440 stock-ready@pub matrix notes [] -> ["chartSettled: Timeout
  15000ms exceeded (synthetic)"]`, `FAIL 375 stock-touch@pub matrix errors [] -> ["pageerror: TypeError: …(synthetic)"]`, exit 1.
- the same with `dev/r2/synth-matrix/allow.json` (`{kind:'matrix', field:'^errors$', views:'^375 stock-touch@pub$'}`, `{kind:'matrix',
  field:'^notes$', views:'stock-ready'}`) → both `allowed`, exit 0.
- base = slice = `synth-matrix` (the same entries on both sides) → 0 differences, exit 0; an entry only in the base → 0, exit 0.
- `dev/r2/synth-test.mjs` (offline): the same error twice in the slice and once in the base → FAIL (multiset rule).
Not covered: 390f (no matrix record; see Limits).

### The old diff kinds are unchanged (実測, offline; `dev/r2/regress/`)
With round 2's `values.mjs`, round 1's recorded diffs come out row for row (only `seqMissing` rows are new, since those inputs
have no `seq`):
- `node values.mjs diff main/base-r1 sens/values-r1 --subset` (round 1's plants P2-P4): exit 1, 1110 FAIL = the 1102 recorded
  rows **byte-identical** to `sens/values-r1-diff.txt` (`cmp`, summary lines aside) + 16 `seqMissing`.
- `node values.mjs diff main/base-r0 sens/synth-order` (and with its `allow.json`): the recorded `FAIL 375 m50/list-zone matrix rows`
  row (allowed with the list), identical to `sens/order-acceptance.txt`, + 838 `seqMissing`.
- The conductor's foldOrder synthetic (`../verify-p0/synth-b`, since deleted) rebuilt from `main/base-r0` as recorded (375
  m50/watch4's fold reversed, 375 m50/today's first six fold lines moved to the end; `dev/r2/regress/make-synth-b.mjs` rebuilds it, the input itself was deleted after the run), `--subset`: the two `foldOrder` rows
  byte-identical to the ones in `sens/order-acceptance.txt` (`[old index 0 -> new index 19 (6 of 25 …)]`, `[… 11 (9 of 12 …)]`).
- `node values.mjs diff main/base-r0 main/rerun-r0`: 0 differences apart from 838 `seqMissing`.

### The harness dump from S1-P3 on (order 4)
Up to S1-P2 a package's `$H/dump/run-dump.sh <worktree> 4461` must give `dump-<head7>.json` byte-identical to
`dump-01066eb.json` (`aaf7ae71…`). From S1-P3 on the band is in the bar of every screen, so the bytes differ on all 42 screens
and the dump is compared **per screen, with an ordered text diff of its `text` field** against `dump-01066eb.json`; every
changed line (`-` / `+` with its line numbers) is explained in the package's record (`docs/ui-abc/s1.md`), and a line nobody
explains is a failure. The dump's 42 screens are default-market screens at 375 and 1440 (`values.mjs` covers the other states);
`text` is the screen's innerText in document order, so the diff sees order changes as well as values. The command (one line;
prints `=== <screen>` and the `diff -U0` hunks of each changed screen, then `N screens changed`; exit 1 when N > 0; temp files
under `$S`, removed at the end):

```bash
S=$SCRATCH; H=$S/audit3/r3-harness
TMPDIR=$S /opt/node22/bin/node -e 'const fs=require("fs"),os=require("os"),cp=require("child_process"),[A,B]=process.argv.slice(1).map(f=>JSON.parse(fs.readFileSync(f,"utf8"))),t=fs.mkdtempSync(os.tmpdir()+"/dumpdiff-");let n=0;for(const k of [...new Set([...Object.keys(A),...Object.keys(B)])].sort()){const a=A[k]?.text??"",b=B[k]?.text??"";if(a===b)continue;n++;fs.writeFileSync(t+"/a",a+"\n");fs.writeFileSync(t+"/b",b+"\n");console.log("=== "+k+(A[k]?"":" (new screen)")+(B[k]?"":" (screen gone)"));process.stdout.write(cp.spawnSync("diff",["-U0",t+"/a",t+"/b"],{encoding:"utf8"}).stdout.split("\n").slice(2).join("\n"))}fs.rmSync(t,{recursive:true});console.log(n+" screens changed");process.exitCode=n?1:0' $H/dump/dump-01066eb.json $H/dump/dump-<head7>.json
```

Run once each (実測, output `dev/r2/dumpdiff-test.txt`): `dump-01066eb.json` against `dump-bd20584.json` (the same bytes,
`aaf7ae71…`): `0 screens changed`, exit 0. `dump-fab1694.json` (an older tree) against `dump-01066eb.json`: `24 screens
changed`, exit 1, e.g. `=== 375-stock-ZZNV` / `@@ -50 +50,2 @@` / `-対ピボット±0.0%` / `+対` / `+ピボット±0.0%`. No temp dir left.

### The re-baseline (one full main re-baseline, run twice; 実測)
| Run | Command | Result |
|---|---|---|
| A (baseline) | `node values.mjs run /home/user/screener/.claude/worktrees/ui-plan 4462 $Y/main/base-r2` (driver `dev/r2/runA.sh`, log `main/r2/runA.log`; 01:09:24-02:06:59Z, load 1.19 → 0.77; ui-plan 01066eb, 0 porcelain lines) | 660 passed (57.6 min), 0 unreached, 0 page errors, 0 notes, no timeout, no re-run; tools-r2 OK before and after. 427 matrix records, 660 values records. |
| B (determinism) | the same into `$Y/main/rerun-r2` (driver `dev/r2/runB.sh`, log `main/r2/runB.log`; 02:07:22-03:04:52Z, load 0.55 → 0.69) | 660 passed (57.5 min), 0 unreached, 0 page errors, 0 notes, no timeout, no re-run; tools-r2 OK before and after. **matrix.json and values.json byte-identical to run A** (`cmp`). |

Offline after run A (`dev/r2/postA.sh`, output `main/r2/postA.txt`, rc=0):
- `main/base-r2/matrix.json` = `d5f573a397a73451e840eede52ba4449dbbcb0593d4aa2696d316714c384c8c9`: **byte-identical to round 1's**
  (`cmp`): nothing in the matrix record moved.
- `main/base-r2/values.json` = `38e6298421836575f53c62b1f80b528f9d8a0be5f20e28e45f428295f275c0c0` (round 1: `4601f4cf…`).
- `node dev/r2/strip-check.mjs main/base-r1 main/base-r2`: all **660** records minus `seq` and the **876** `leg|` pairs equal
  round 1's records; `multiset(seq)` = `lines` in every part; 427 matrix records equal (exit 0). So round 2 changed no existing
  section of any view: nothing was loosened.
- `node phrases.mjs scan main/base-r2` twice: `32c1a21ac1d35485146078c28fae8684c04ac81d1e374874a63fcc2b7c186d90` both times,
  **identical to round 1's** `phrases.json` (the leg pairs hit no rule; 45 distinct bare-「独自」 texts as before, 0 for every other rule).
- `node values.mjs diff main/base-r1 main/base-r2 dev/r2/allow-r1-r2.json` (allow: `added` `/^leg\|T\d+\|/` in pairs, and
  `seqMissing` `no seq in base`): exit 0, 1730 differences, **0 failures** (876 `added` leg pairs, 854 `seqMissing` = the 427 × 2
  closed/opened parts of round 1's 375 and 1440 records), matrix 427 compared, 0 differences.

After run B (`dev/r2/postB.sh`, output `main/r2/postB.txt`, rc=0; Playwright only on 4462, one at a time):

| Output | sha256 (round 2) | Determinism |
|---|---|---|
| `main/base/matrix.json` (427 view-modes) | `d5f573a397a73451e840eede52ba4449dbbcb0593d4aa2696d316714c384c8c9` | IDENTICAL to `main/rerun/matrix.json` (run B), and to round 1's |
| `main/base/values.json` (660 view-modes) | `38e6298421836575f53c62b1f80b528f9d8a0be5f20e28e45f428295f275c0c0` | IDENTICAL to `main/rerun/values.json` (run B) |
| `main/base/phrases.json` | `32c1a21ac1d35485146078c28fae8684c04ac81d1e374874a63fcc2b7c186d90` | scanned twice on A and once on B: identical; `phrases.mjs diff main/base-r2 main/rerun-r2`: `{"new_hits":0}`; identical to round 1's |
| `main/base/surfaces.json` (19 states; `surfaces.mjs run ui-plan 4462 main/base-r2` 03:05:06Z, then into `main/rerun-r2` 03:08:46Z; 19 passed, 3.6 min each, no timeout) | `35eb1cb717efaeaaa0804a9a7b6780bf4ce045462ad3db70eada0ce9c1980046` | IDENTICAL to `main/rerun/surfaces.json` and to round 1's (`surfaces.mjs diff main/base-r1 main/base-r2`: 0 differences) |
| `main/base/foldcheck.json` (off-hash diagnostics) | not a gate | — |

- `node values.mjs diff main/base-r2 main/rerun-r2`: `{"differences":0,"failures":0,…,"matrix":{"compared":427,"differences":0,…}}`,
  exit 0; through the moved symlinks (`main/base` → `base-r2`, `main/rerun` → `rerun-r2`): exit 0.
- `node dev/r2/strip-check.mjs main/base-r1 main/rerun-r2`: 660 equal, 876 leg pairs stripped, matrix bytes equal (exit 0).
- Final acceptance through the symlink: `node values.mjs diff main/base sens/values-r2 --subset` → exit 1, 277 FAIL,
  `main/r2/accept-plants.txt` byte-identical to run A's `main/r2/accept-plants-A.txt` (the table in Order 1 acceptance above).
- `sha256sum -c main/tools-r2.sha256`: OK before every run and after `postB.sh`.

### Cleanup (round 2)
- The throwaway tree: `git worktree remove --force $Y/sens-wt` and `git worktree prune` (its commit and diffstat are in
  `sens/sens-wt-log-r2.txt`); `git worktree list` no longer shows it.
- Deleted as superseded: `main/base-r1/raw/` and `main/rerun-r1/raw/` (round 1's `--resume` input; their merged files and logs
  stay), `dev/r2/plant-sub/` (byte-identical to `sens/values-r2`), `dev/r2/synth/` (the synthetic dirs; `synth-test.txt` keeps
  their output). Kept: `dev/r2/main-sub/` and `dev/r2/synth-matrix/` (the inputs of `dev/r2/order3-acceptance.txt`).
- No commit anywhere but the scratch commit in the removed throwaway tree; `ui-abc-s1` stays at `01066ebe` with an empty status,
  `ui-plan` at `01066eb`, clean. No server or browser of mine is left running.

**Layout after round 2.** `main/base` → `base-r2/` and `main/rerun` → `rerun-r2/` (both with `raw/` for `--resume`, surfaces and
phrases); `main/base-r1/`, `main/rerun-r1/` = round 1's merged files and logs; `main/base-r0/`, `main/rerun-r0/` = S1-P0's; the
ledger baseline stays `main/ledger1/` (round 2 changed no ledger byte); the current pin is `main/tools-r2.sha256`.
