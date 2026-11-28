# UI slice SV-A record: the 候補 list header and the holiday line

Branch `claude/sv-a`, from main `e7afacdd` (the merge of slice S2, PR #149; its root tree `1663d350` is the S2 head `b5df468e`'s).
The slice adopts the reference screener's list header on the phone 候補 screen (below 1024px) and adds the holiday line (Package H).
One section per package; it grows with each package. Every number is tagged **実測** (measured, with its command) or **未検証**
(not measured). "The yardstick" is the S1-P0 tool set as S2 left it (state matrix, values, phrases, surfaces, ledger, screenshots,
timing) and "the harness" the round-3 measurement harness (probe, dump, heights, snapshot, build); both are scratch tools outside the
repository, never committed. bd is not installed on this machine (`which bd` finds nothing), so each package is tracked here.

**The base of every SV-A comparison is S2's final base** (SVA-P0's table below: the S2-C1 full runs, which the conductor's final
verification reproduced on `75f1f609`), not the S1 head. Because that base holds every view-mode of the matrix (822), SV-A has one
values gate, not S2's two: a values, phrases, ledger or surfaces difference against it that is not in the allow-list below is a
failure.

## Allow-list (cumulative for SV-A)

The machine-readable copy is the yardstick's scratch SV-A allow-list (the same entry format as S2's; `values.mjs` and `surfaces.mjs` read it). **After
SVA-P0 it is an empty JSON array** (`[]` and a newline, sha256 `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`,
the same bytes S2-P0 started from).

Scope rule for every later entry: an entry may only be anchored to a 候補 phone view-mode (screen `list` or `list-*`, modes 375 and
390f: 118 of the base's 822 view-modes; the 1440 候補 views are out of scope and must diff 0) or to a view of the holiday line
(Package H states its views before its run). No other entry may match a view of Today, ウォッチ, 市場 or the stock screen, or a 1440
view.

| Package | Values entries | Cross-surface entries | Table |
|---|---|---|---|
| SVA-P0 | 0 | 0 | — |

## Orders carried to a later package

None of S2's carried orders is addressed to SV-A. S2's items 4 (the `STOP_ROW_LABEL` comment, for the next package that edits
`frontend/src/static/brief/briefSell.js`), 5 (S3-P4) and 6 (S3-P0) stay carried in S2's record; SV-A is not scoped to touch
`briefSell.js`, and if one of its packages does, item 4 applies to it.

## SVA-P0 Re-base on main `e7afacdd`

Status: **done.** Started from `e7afacdd` (tree clean). No product code change and no test change: the only committed file is this
record. In scratch: the SV-A allow-list (empty), a manifest of the base files' hashes, a live check on this head, and an SV-A
section in the yardstick's README. No owner line moves; no cap, budget, token, waiver, build target, Design Acceptance tool, fixture
or frozen spec was edited.

### Why S2's final base carries to this head (実測, git on this worktree)

| Commit | What it is | Root tree | `frontend` | `frontend/src` |
|---|---|---|---|---|
| `e7afacdd` | main, the S2 merge (this slice's base) | `1663d350` | `0ef15aae` | `f45745ea` |
| `b5df468e` | the S2 head | `1663d350` | `0ef15aae` | `f45745ea` |
| `75f1f609` | the conductor's final verification | `3ef025de` | `0ef15aae` | `f45745ea` |
| `452d12f5` | S2-C1's resume (the gutter spec) | `2e6e815f` | `0ef15aae` | `f45745ea` |
| `9b2ee399` | where S2-C1's full runs were served (frontend of `3cc6b089`) | `0f0a86cc` | `c35fa176` | `f45745ea` |

- `git diff --stat 9b2ee399 e7afacdd` lists three files: `CONTEXT.md`, `docs/ui-abc/s2.md` and
  `frontend/tests/static/brief-chart.spec.js` (15+/4−, S2-C1's gutter pin). No yardstick or harness tool reads that spec: the tools
  read the served worktree's `brief-fixture.js`, `playwright.static.config.js`, `frontend/contracts`, `tools/design-review.mjs`, its
  build output and `node_modules` (a scan of the tools' sources), and none of those changed. So the S2-C1 runs measured the same
  served frontend as main.
- The conductor's final verification on `75f1f609` (whose `frontend` tree is main's) re-ran the yardstick and the harness: a values
  subset of 500 view-modes reproduced S2-C1's full run with **0 differences** (matrix 374 compared, 0); its surfaces, pinned ledger,
  counts, default probe, oracle probe and dump are byte-identical to S2-C1's; its harness heights equal S2-C1's but for the tree name
  and the probe-derived chart-card block (its probe file had another name; the probe itself is byte-identical).
- The numbers carried below are 実測 on their own commits (`9b2ee399` or `75f1f609`) and carry to `e7afacdd` by this identity; only
  the live check further down is 実測 on `e7afacdd` itself.

### The SV-A base (実測: every file re-hashed on 11-28 from the scratch copies; a scratch manifest holds the list)

| Baseline | Run on | Contents | sha256 |
|---|---|---|---|
| values | `9b2ee399` (S2-C1's full run, 09:41-10:56Z on 11-27, no re-run) | 822 view-modes (375 287, 390f 287, 1440 248), 822 passed, 0 unreached, 0 page errors, 0 notes | `19cacf42e2b90deeadbf0723d1cf3d7ab46a5ec639e9754a465e40fdf55e2676` |
| matrix | the same run | 535 records (375 287, 1440 248) | `19d14e7247acf67755f4cd1584c67f36348180ac36bf941ca3a2f1d6a8e5aac9` |
| phrases | `phrases.mjs scan` of that run | its hits are S2's (S2-C1: equal to S2-P8's) | `fe8fc15406acad60e0139ff9c22552e0ae158e81dba23ec9d5318663068c33ac` |
| surfaces (19 states) | `9b2ee399`; again on `75f1f609` | 19 passed; every surface agrees in all 19 states | `3a2dfc5416e8eaa7065f8d3081abc1ea452801ec42653097cc90189257502fb9` (both runs) |
| per-row ledger, pinned tool | `9b2ee399` (archive of HEAD); again on `75f1f609` | 1845 lines | `2508f6939db8e9961c1d7dfe8398eb1ea7a542751968f0bf42deb639ed6a2542` (both runs) |
| per-row ledger, stop mirror | `9b2ee399` | — | `a9306e6710e1273a59a7e515c248c634b8a9afe0dd383f1e9a008b53398ba34d` |
| rebuild counts (11-12 rebuild) | `9b2ee399`; again on `75f1f609` | listed 980, certified_listed 615 | `34024380373df5db0a87bc09d8dd406ef8f774f8b6e80ce33ec2f7ab7d289f5f` (both, = the S1 head's); the stop mirror's counts `2f655086e6817a3d7958221b5481b26868b9cb05c8e80308a45b845614261e41` |
| harness probe, default | `9b2ee399`; again on `75f1f609` | 972 views | `49facd45c9264799d1c5ed6e8d4a906b1c8bfb75cd95eae8ad6bc52d8a4ed181` (both) |
| harness probe, oracles | `9b2ee399`; again on `75f1f609` | 264 views | `a40a9a4e3b9f08c4f99ec4cf925ee2c83d7bb45766064cd9e3268f2049c64402` (both) |
| harness dump | `9b2ee399`; again on `75f1f609` | 42 screens | `d27119c9a6adac756cc71cd5478f04a1428d2fd94be26629acfb9a3564c70e8a` (both) |
| harness heights | `9b2ee399` (with the probe's chart-card block); `75f1f609` (without it) | 17 screens, identical in both | `352565b72a88d003b095817d838540c525eddad3796995422d3a2c95dadcf291`; `dce824ceea7a9f8ad2dbf4f7ac638ce034beefa5f1523c54bf0b23df99c7fc53` |
| build | `75f1f609` (`run-build.sh`, archive of HEAD) | `npm run build` entry **113.91 kB gzip** / 328.45 raw (line 134.00); Design Acceptance entry `index-DAOu9dBS.js` 113.73 kB (113,617 bytes gzip-9) | build file `aad3f165dbb30db1ae79ea9b7849e0f04db4ff755b228b75993470e5ed0c762d` |
| the tool pin | — | 17 files, 17 of 17 OK | `1d06dacd01a28011f9d88169bf91d6069adc7d8d133ce0347d80488bded90d2c` (S2-P6's pin, unchanged) |

### The live check on this head (実測; `e7afacdd`, this worktree clean, CI-faithful: Chrome for Testing 147 headless shell, the CI fonts, Node 22; port 4461 only, no other browser running at its start; 00:18-00:41Z on 11-28)

- `values.mjs run` with a `--views` filter: every 候補 view-mode of the matrix (screens `list` and `list-*`: 177, that is 59 at each
  of 375, 390f and 1440) and one control each of Today (`below50/today`), ウォッチ (`basisconflict/watch5`), 市場
  (`basisconflict/market-t0`, phone only) and the stock screen (`stock-touch@pub`): **188 view-modes, 125 matrix records**. The first
  pass: 187 passed and 1 timed out (`390f pend-m50/list`: the page closed at the 180 s limit, the known flake); **re-run once with
  `--resume`: passed**. 0 unreached, 0 page errors, 0 notes.
- `values.mjs diff` against the base with the SV-A list (empty) and `--subset`: **0 differences, 0 failures; matrix 125 compared, 0
  differences, 0 height infos**, exit 0. Every one of the 188 values records and 125 matrix records is byte-identical, line for line,
  to the base's record of the same view-mode.
- The tool pin: `sha256sum -c` 17 of 17 OK before and after.

### The SV-A gate (for every later package; commands in the yardstick's README)

- Values: one diff of a full run of the package's head against the base with the SV-A list, **without** `--subset` (the base has
  every view-mode; a `viewMissingInBase` record means a new state, which needs its own base, below). A `--views` run while iterating
  uses `--subset`.
- Phrases: no hit that the base does not have. Surfaces: diff against the base with the SV-A list. Ledger: diff against the pinned
  base ledger with no `--allow` (expected 0 differences; a change of a row's fields is a stated change with its own entry and
  reason). Harness probe, dump and heights: compared with the base files above; only 候補 phone screens and the holiday line's
  screens may differ.
- The tool pin `sha256sum -c` (17 of 17) before and after every run.
- New states (Package H's holiday or early-close clocks, if the matrix has none): their base is run on the read-only S2 head
  worktree (`ui-abc-s2`, clean at `b5df468e`, the same root tree as main), port 4462, into a base directory of their own, with the
  states table change re-pinned and recorded here; the slice's tree is served on 4461.
- The yardstick's sensitivity carries from S2-P0's live-gate proof (the plants it found), because every pinned tool is byte-identical
  to the bytes that proof ran; it was not re-proved here.

### Heights and owner lines (the base readings; 375x812 unless tagged; the values run's matrix and the harness heights file)

| Line | Bound | Base reading |
|---|---|---|
| Entry chunk | ≤ 134.00 kB gzip | 113.91 |
| Today | 1388 | 1360 (`below50/today`, the tallest of 19 Today views); harness governing state 1330 |
| 候補 | 708 (its spec asserts 720); **this slice: ≤ 700 by its own measurement** | **593** on the default tab 買いゾーン (`list-zone`) in 12 of 13 market states (`manifest503` 316) and in the 6 pending and late lists; harness governing state (default 買いゾーン) 593. The other tabs, which no owner line bounds: あと1条件 up to 1070, ピボット接近 up to 1246, 選定すべて up to 1564 (1596 in `row-bigprice`, whose recipe also opens the longer list) |
| ウォッチ | 508 | 442 (`watch5`); 377 (`watch4`, `watchbroken`) |
| 市場 | 1288 | 1228 (harness governing state, one session behind; 1219 at base); `market-t0` up to 1300 in the matrix (`basisconflict`, `below50`); the harness's FTD-conflict screen 1300 and 1322 one session behind (owner finding O8, main's own overrun, no spec on it) |
| Stock `STOCK_CAP` (stalls) | 3124 | 3119 (`stock-stalls@late`, the tallest of 112 stock views). The stopPercent 4.5 state, which has no matrix view, is not re-measured: S2-P2 read 3134 at publication and 3155 late on the S2-P1 head (an overrun the S1 head already had, 3168; S2-P8's record), 未検証 since |
| Chart card | 508 exact (week 492 at 320, 490 for ZZLI's week at 375 / 390) | 508 / 492 / 490 (the probe-derived block of the `9b2ee399` heights file) |
| Bar | 48 | 48 in every 375 view |
| Bar + dock | 110 | 104 in every 375 view |
| Overflow | 0 | 0 in every 375 view |

### Not measured here (未検証)

- A full values run, surfaces, ledger, probe, dump, heights, snapshot, build, vitest, lint and the static suite on `e7afacdd`
  itself: not re-run; they carry by the identity above (the live check covers 188 view-modes).
- Timing (no timing run; S2's carried order 6 is S3-P0's).
- Whether any view the matrix already has shows a US holiday or an early close in the fixture's calendar (the fixture reads the
  real NYSE 2024-2026 session list; the market series' refresh schedule gives every session a 20:00Z close): Package H states it
  before its run.
- The 候補 header's own height (≤ 700): the later packages measure it.

### Deviations from the order

1. The base is not a run on `e7afacdd`: it is S2-C1's full run on `9b2ee399` (and the conductor's re-runs on `75f1f609`), which
   serve the same frontend source as main; the only difference in `frontend` is a spec no tool reads (above). The 188 view-mode live
   check on this head is added as the proof that this worktree reproduces it (its `node_modules` is a link to the main checkout's).
2. The yardstick's README had no S2-C1 section (S2-C1's paragraph sat in a scratch draft); it is appended there now, beside the new
   SV-A section. Scratch only.

### Owner lines

None moves (no product change).

### Owner questions (オーナー向けの質問)

この作業（SVA-P0）でオーナーに伺うことはありません。基準は S2 の最終計測をそのまま使います（数値は上の表）。

### Allow-list delta (this package)

None: the list is empty.
