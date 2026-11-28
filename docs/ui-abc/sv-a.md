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
the same bytes S2-P0 started from). **After SVA-H it holds 30 values entries**, all anchored to the holiday line's views (sha256
`9f4cc03fb78cc80d29f7b765684d846741bf97f9a2424ed0b9ca73df918add09`; SVA-H's section).

Scope rule for every later entry: an entry may only be anchored to a 候補 phone view-mode (screen `list` or `list-*`, modes 375 and
390f: 118 of the base's 822 view-modes; the 1440 候補 views are out of scope and must diff 0) or to a view of the holiday line
(Package H states its views before its run: SVA-H's closure views `hol-m50/…` and `short-m50/…`, every mode). No other entry may match a view of Today, ウォッチ, 市場 or the stock screen, or a 1440
view.

| Package | Values entries | Cross-surface entries | Table |
|---|---|---|---|
| SVA-P0 | 0 | 0 | — |
| SVA-H | 30 (the closure views `hol-m50/…`, `short-m50/…` only) | 0 | SVA-H's allow-list delta |

## Orders carried to a later package

None of S2's carried orders is addressed to SV-A. S2's items 2 and 3 ("any later attempt at the strip") concern S2-P2's 4-number
strip on the stock screen, not this slice's strip of count tabs on 候補. S2's items 4 (the `STOP_ROW_LABEL` comment, for the next package that edits
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

### The live check on this head (実測; `e7afacdd`, this worktree clean, CI-faithful: Chrome for Testing 147 headless shell, the CI fonts, Node 22; port 4461 only, no other browser running at its start; Node v22.23.4; 00:18-00:41Z on 11-28, the resume 00:41-00:42Z)

- `values.mjs run` with a `--views` filter: every 候補 view-mode of the matrix (screens `list` and `list-*`: 177, that is 59 at each
  of 375, 390f and 1440) and one control each of Today (`below50/today`), ウォッチ (`basisconflict/watch5`), 市場
  (`basisconflict/market-t0`, phone only) and the stock screen (`stock-touch@pub`): **188 view-modes, 125 matrix records**. The first
  pass: 187 passed and 1 timed out (`390f pend-m50/list`: the page closed at the 180 s limit, the known flake); **re-run once with
  `--resume`: passed**. 0 unreached, 0 page errors, 0 notes; the merged files: values
  `59b13ef22e121674a1e4ada90dc24697b3f162faa6ebbc291575f0a8f1e7018c`, matrix `81914c1b9209fa4c8db4e0c23aa06a6eafd8cb4f7015d16fd1110211023e26ce`.
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

### Heights and owner lines (実測 on `9b2ee399`, carried to this head by the identity above; the base readings at 375x812 unless tagged; the values run's matrix and the harness heights file)

| Line | Bound | Base reading |
|---|---|---|
| Entry chunk | ≤ 134.00 kB gzip | 113.91 |
| Today | 1388 | 1360 (`below50/today`, the tallest of 19 Today views); harness governing state 1330 |
| 候補 | 708 (its spec asserts 720); **this slice: ≤ 700 by its own measurement** | **593** on the default tab 買いゾーン (`list-zone`) in 12 of 13 market states (`manifest503` 316) and in the 6 pending and late lists; harness governing state (default 買いゾーン) 593. The 720 is `brief-compact.spec.js:24`'s `BUDGET.list`, read at 375x812 as
the bottom of `#brief-main .brief-stack` on `#/brief/list` as it opens, that is on the default tab (`:15`, `:32-37`). The other tabs, which neither that spec nor an owner line bounds: あと1条件 up to 1070, ピボット接近 up to 1246, 選定すべて up to 1564 (1596 in `row-bigprice`, whose recipe also opens the longer list) |
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
   SV-A section. Scratch only (the README's earlier bytes are kept beside this package's scratch outputs).
3. The live check needed one `--resume`: `390f pend-m50/list` timed out once (page closed at the 180 s limit) and passed on its
   re-run, as S2's packages handled the same flake.

### Owner lines

None moves (no product change).

### Owner questions (オーナー向けの質問)

この作業（SVA-P0）でオーナーに伺うことはありません。基準は S2 の最終計測をそのまま使います（数値は上の表）。

### Allow-list delta (this package)

None: the list is empty.

## SVA-H Package H: the holiday and short-session line (latency plan F9)

Status: **done.** Product commit `76384388` (`feat(frontend): say the exchange calendar's holiday and short session on the bar`)
on `dce782a6`; this record is the commit after it. Every measurement below ran on `76384388` with the tree clean (its `frontend`
is the head's). No cap, budget, token, waiver, build target, Design Acceptance tool, fixture or frozen spec was edited, and no
existing assertion changed: the static suite gains one file (`brief-holiday.spec.js`, 19 tests), vitest gains 6 tests.
`brief-phone.spec.js:192-200` (the four filter buttons) is untouched: it belongs to the 候補 header packages, not to H.

### What the line says, and from what

The order limits Package H to the exchange calendar the app already reads (the market series' `refresh_schedule`, validated as
the bar's age is: `validSessions` in `briefFreshness.js`). From it, `closureNote({ trends, date, now })` (new, `briefFreshness.js`)
derives two facts, and only while the age is **current** (no session has closed since the analysis date):

- **休場**: the Monday-Friday dates strictly between the analysis date and the next listed session. The producer lists every NYSE
  session from a week before the target date to 45 days after it (`collect-market-trends.py:86-90`), so such a weekday is one the
  calendar lists no session for. This is read from the calendar's omission; it is still an inference, and a list that dropped a
  session by mistake would be read as a closure (the client cannot tell). A weekend day is never a closure, and without a valid
  calendar (absent, another provider, expired, out of order, not covering the analysis date) nothing is said.
- **短縮取引**: the next session's `close_at` is before 16:00 on the New York wall clock (`Intl`, `America/New_York`, `h23`). It is
  never compared with another session's UTC close (the Mondays after the clock changes close an hour apart in UTC at 16:00 New
  York; both are tested). The close is named in Japan time (`Asia/Tokyo`, never the device's zone; vitest run under `TZ` =
  Asia/Tokyo, America/Los_Angeles and UTC: 11 of 11 each, 実測).

No holiday name is said (the calendar carries none), and no wording says 最新 or 祝日.

| Calendar | Bar (phone: the age only; ≥ 1024 px: age and detail) | 市場's update status, first in its closed explanation |
|---|---|---|
| holiday, the next session short (Thanksgiving) | 「分析基準日 11/25（水）引け・11/26休場」 + 「（11/27 短縮取引・引け 日本時間 11/28 03:00）」 | 「11/26（木）は米国市場の休場日です（取引所カレンダー）。次の取引日 11/27（金）は短縮取引で、引けは日本時間 11/28 03:00 の予定です。」 |
| holiday (Christmas, Good Friday) | 「…引け・12/25休場」 + 「（次の取引日 12/28（月））」 | 「12/25（金）は米国市場の休場日です（取引所カレンダー）。次の取引日は12/28（月）です。」 |
| the next session short (Christmas Eve) | 「…引け・12/24短縮取引」 + 「（引け 日本時間 12/25 03:00）」 | 「次の取引日 12/24（木）は短縮取引で、引けは日本時間 12/25 03:00 の予定です。」 |

Where it is said, and where not:

- **The bar's date line** (`BarDate`, every screen's bar but the phone's stock bar, which names the stock): 「米国株」 becomes the
  age above, in the line's own class, colour, weight and size; the detail is the line's existing second part (`.brief-bar-missing`,
  the slot the late detail 「（10/5・10/6 未反映）」 uses), shown only where it fits and otherwise wrapped out of view under the
  one-line clip, as that detail is. With no closure the markup is byte-identical to before (no new class, attribute or element).
- **市場's update status** (`MarketUpdateStatus.jsx`, the 推移 section): the sentence is put first in the existing `<p>` inside the
  closed disclosure; the summary line is unchanged. With nothing to say the `<p>` text is unchanged.
- **Not** in Today's notes, the gate sentence (`MarketCard late=`), the stock head or the phone stock bar: the line is a separate
  value (`closure`) handed to `BarDate` only, never mixed into `ageLine`, so none of those changes and no screen gains a line.
- **Precedence**: a late age (「n営業日前」), a pending one (the bar unchanged), 鮮度未確認 and loading all keep their own line; the
  closure ends at the next session's close with the age's existing timer (no new timer).

**Classification (D19).** The line is not decision text: it says when the exchange is shut, not what to do about a stock. It keeps
the bar line's existing size (12 px below 521 px, 11 px wider; the 11 px floor holds), weight and colour, and is said in words
(休場 / 短縮取引), never by colour. Its contrast is the existing line's: `text-3` on `ground`, 8.27:1 dark and 4.82:1 light
(computed from `tokens.js`; the spec measures the class, colour, weight, size and height equal to the plain line's).

**What a phone actually shows.** The age only: 「分析基準日 11/25（水）引け・11/26休場」. The next session, its short close and its
close in Japan time are in the line's text (so in the accessible name) but wrapped out of view on every phone width measured
(320-390), and visible at 1440 and in 市場's disclosure.

### Fit and height (実測)

The bar's date line at 12 px (the CI fonts, a scratch fit probe on the served tree, the fixture's dates 10/2 and 10/5): room right of the age's
text, in px, and whether the age is cut.

| Width | 米国株 (plain) | 10/5休場 | 10/5短縮取引 |
|---|---|---|---|
| 320 | 44.0 | 27.2 | 3.2 |
| 360 | 84.0 | 67.2 | 43.2 |
| 375 | 99.0 | 82.2 | 58.2 |
| 390 | 114.0 | 97.2 | 73.2 |

Never cut with the fixture's dates. Real dates with two-digit months, measured by putting the text into the line
(a second scratch probe): 「分析基準日 11/25（水）引け・11/26休場」 has 12.8 / 52.8 / 67.8 / 82.8 px at 320 / 360 / 375 / 390;
「分析基準日 12/23（水）引け・12/24短縮取引」 has **−11.2** / 28.8 / 43.8 / 58.8 px, that is **cut by its ellipsis at 320 px only**
(deviation 4, owner question 3). The spec pins the holiday's room at ≥ 15 px at 320, 375 and 390 (the two-digit months take 14.4 px).

No new height: `brief-holiday.spec.js` opens each screen with and without the closure and compares `document.documentElement.scrollHeight` and
`#brief-main`'s height (equal on 今日, 候補, ウォッチ and 市場 at 320, 375 and 390, on 候補 with the short session at 320 and 390,
and on 今日, 候補 and the stock at 1440); bar ≤ 48, bar + dock ≤ 110 and 0 overflow on every phone case.

### The yardstick (実測)

All on `76384388`, tree clean, port 4461 (the S2 head tree on 4462 for the new views' base only); the tool pin 17 of 17 before
and after every run (after the re-pin below). Logs and outputs are in this package's scratch directory.

**The new views, stated before the run** (the yardstick README's SVA-H section): `states.mjs` gains kind `closure`, the states
`hol` (YARD-OWN HOLIDAY: no 10/5 session, 10/6 closes 17:00Z) and `short` (YARD-OWN SHORT: 10/5 closes 17:00Z), copied from
`brief-holiday.spec.js:11-16`, at the fixture's clock on the default market, on `today`, `list`, `watch4` (375 / 390f / 1440),
`market-t3` (the 推移 tab, 375 / 390f), `market` (1440) and `stock-ZZNV` (375 / 390f / 1440): **12 views, 30 view-modes, 20 matrix
records**; the matrix is 852 view-modes (375 297, 390f 297, 1440 258). Reach: the m50 model and the bar's 「分析基準日 10/2（金）引け」,
which both trees give. `states.mjs` `cac75ec6…` → `51a40ada…`; **`s1/tools.sha256` re-pinned, sha256 `5eef9067fde726e0150577f523ab4580a392e21940a19ec4c65b9dbcf8a63fce`**
(17 files, only `states.mjs` changed; the old bytes are kept beside this package's scratch). The surfaces table does not read the
new kind (19 states, unchanged).

| Check (command, from the yardstick dir) | Result |
|---|---|
| The new views' base: `values.mjs run` on the S2 head tree (`b5df468e`, clean), port 4462, `--views '^(hol\|short)-m50/'`, 01:18-01:21Z | 30 passed, 20 matrix records, 0 unreached / page errors / notes; values `b5573a92e03687b359ca4b790516e7e76dcee2df48ac56e9fa4c96a0a95a7933`, matrix `04ad2fe6fcb38494acbd7da0794adb75b420a76ead3f3a6f5ecd42250b65e93d`, phrases `7ed144b2…` |
| Control: each record of that base against the same screen's default record of the S2-C1 base (`m50/today`, `m50/list-zone`, `m50/watch4`, `m50/market-t3`, `m50/market`, `stock-touch@pub`), id and recipe fields left out | **30 of 30 values records and 20 of 20 matrix records equal**: on a tree without the line, the calendar edit changes nothing else |
| The full run: `values.mjs run` on this worktree, port 4461, 01:21:50-02:35:25Z, load 0.90 → 1.06 | **852 passed** (1.2 h, no re-run), 555 matrix records, 0 unreached, 0 page errors, 0 notes; values `27cc1bfa7d32cae9a21ad03002599ff3fe551eeb799dbcf52a169eb133124ee7`, matrix `7bdb9f6e6d02eed9814a57cb23043c00d72860a4f603055adac248acfa52bc27`, phrases `bc9496e2…` |
| Gate 1: `values.mjs diff` S2's final base → the full run, the SV-A list, `--subset` | **0 differences, 0 failures; matrix 535 compared, 0 differences, 0 height infos**: every one of the 822 old view-modes (Today, 候補, ウォッチ, 市場, stock, 1440) is byte-identical to the base. Without `--subset`: 50 failures, all `viewMissingInBase` (the 30 new view-modes, 20 matrix records) |
| Gate 2: `values.mjs diff` the new views' base → the full run, the SV-A list, `--subset` | before the entries 362 differences (added 274, removed 40, leftFirstFold 16, enteredFirstFold 32) in 26 view-modes (the four phone stock view-modes are identical: the phone stock bar names the stock); **with the 30 entries below: 362 allowed, 0 failures; matrix 20 compared, 0 differences, 0 height infos** (no page, content, bar or dock height moved) |
| `phrases.mjs scan` of the full run; `phrases.mjs diff` S2's final base → the full run | **0 new hits** over all 852 view-modes (the new texts add none). A diff against the new views' base lists 26 old texts, all the base's own hits, because that base holds only the 30 new view-modes (the README's S2-P6 note) |
| `surfaces.mjs run`, `surfaces.mjs diff` against S2's final base with the SV-A list | 19 passed (9 min, no re-run); **0 differences, 0 failures**; `surfaces.json` byte-identical to the base (`3a2dfc54…`) |
| `ledger.mjs run` (git archive of `76384388`) and the stop mirror; `ledger.mjs diff` against the pinned base ledger | **1845 rows, 0 differences, 0 failures**; pinned `2508f693…` and stop mirror `a9306e67…`, both byte-identical to the base. The tool's default 11-12 rebuild (the `bd20584` snapshot) is gone from the scratch, so both ran with `--serve` / `--listed` of the S1 head's rebuild (`9402b05`), first proved on the S2 head tree: its ledger with that rebuild is byte-identical to the base (`2508f693…`) |
| The harness on `76384388` (`run-probe.sh`, `run-probe.sh … oracles`, `run-dump.sh`, `run-heights.sh`, port 4461) | probe `49facd45…`, oracle probe `a40a9a4e…`, dump `d27119c9…`: **`cmp`-identical** to the base's `9b2ee39` files; heights differ from the base's heights file only in the `tree` and `probe` file-name fields |

The 30 new view-modes' heights equal the default ones (the matrix): at 375 `today` 1311 (content 1243), `list` 812 (593), `watch4`
812 (377), `market-t3` 2209 (2141), `stock-ZZNV` 3096 (3028); bar 48, dock 56, overflow 0 in every phone view-mode; at 1440 bar 48,
overflow 0.

The fold reading: on the phone the detail 「（10/6 短縮取引・引け 日本時間 10/7 02:00）」 is counted as entering the first fold, as
the late detail 「（10/5・10/6 未反映）」 already is in the base's `late-*` views: the tool reads the wrapped part's box above the
dock, inside the one-line clip. The spec measures it out of view (`detailShown` false) on every phone width.

### Other checks (実測; CI-faithful, port 4461)

| Check (command) | Result |
|---|---|
| `closureNote` over the fixture's own calendar (`marketTrends()` of the frozen fixture: sessions 9/28-10/7, every close 20:00Z), every 10 minutes from 9/28 00:00Z to its `valid_until`, in a throwaway vitest (not committed) | **1434 clocks, 0 lines**; at the fixture clock, PENDING and LATE: current / pending / stale and no line. So no view the matrix had before can show the line (SVA-P0's open item), which gate 1 then confirmed |
| `npx vitest run` (the session-calendar and replay Python set), 03:28-03:33Z | 256 files passed, 1 skipped; **4346 passed, 1 skipped** (S2-C1 4340; +6: five closure cases in `briefFreshness.test.js`, one in `MarketUpdateStatus.test.jsx`). Without the session-calendar Python, `tools/restore-market-trend-source.test.mjs` fails on `import pandas_market_calendars` (the system `python3` has none): an environment failure, the same file passes 10 of 10 with it |
| `briefFreshness.test.js` under `TZ=Asia/Tokyo`, `America/Los_Angeles`, `UTC` | 11 of 11 in each |
| `npm run lint` | **0 errors**, 4 warnings (main's) |
| The full static suite, one file per run, workers 1, retries 0, 02:51-03:26Z (`brief-holiday.spec.js` included) | 25 files, **941 tests: 939 passed, 2 failed**, no re-run; the 2 are the host baselines `brief-invariants.spec.js:243` and `brief-watch.spec.js:73`; `brief-holiday.spec.js` 19 passed, `brief-freshness.spec.js` 20, `brief-market.spec.js` 24, `brief-phone.spec.js` 39 (S2-C1's chain: 24 files, 922 tests) |
| The two baseline files in their race-free copies (S2-P5's patched copies, pointed at this worktree) | **68 passed** |
| `run-build.sh` on `76384388` | `npm run build` entry **114.70 kB gzip** / 330.33 raw (base 113.91 / 328.45: +0.79 kB; line 134.00); Design Acceptance entry `index-DKLFwBbP.js` 114.49 kB (114,379 bytes gzip-9) |

### Heights and owner lines

No owner line moves. Gate 1 makes every old view-mode's matrix record (page, content, bar, dock, overflow) byte-identical to the
base, so the base readings in SVA-P0's table carry unchanged (Today 1360 at most, 候補 593 on the default tab, ウォッチ 442, 市場
1228 harness / up to 1300 in the matrix as before, stock 3119, chart card 508 / 492 / 490, bar 48, bar + dock 104, overflow 0).
The closure views' heights equal the default views' (above: 候補 593, Today 1243 content, the phone stock 3028 content). Entry
114.70 kB gzip ≤ 134.00.

### Not measured here (未検証)

- Design Acceptance (F9 lists it for the merge) and timing: not run; the line adds no request, no timer and no element on a
  closure-free day.
- A real holiday publication: the next one is Christmas (12/25); every case above is synthetic (the vitest calendars and the
  spec's edited fixture calendar).
- The snapshot, the counts and the sell evaluation: not re-run (no model file changed; the ledger, which reads the tree's model
  modules, is re-run above).
- Screenshots: not taken.

### Deviations from the order

1. **No producer change.** F9 also asks `collect-market-trends.py` for `closures: [{date, label}]`, `early_close: true` per session
   and a small table of holiday names, with a Python test. The order limits Package H to the calendar data already published, so
   none of that was done: the closure is read from the published session list and the short session from its `close_at`, and no
   holiday name (感謝祭) is said. Owner question 1.
2. **The window is wider than F9's.** F9's tests say "show from 11-26 21:00Z to 11-27 18:00Z" (the holiday's would-be close to the
   short session's close). The line shows whenever the age is current and the calendar shows the gap: from the analysis date's
   own publication (11-26 07:34Z in the 11-26 case) to the next session's close. The closure is a fact of the calendar for that
   whole time, and this needs no invented close time for a day that has no session. F9's window is inside it (tested). Owner
   question 2.
3. **Today's notes do not carry the sentence**, though Today's notes carry the late age's: a note line is new height on an
   owner-line screen. On a phone the short close and its time are therefore not in view (owner question 4).
4. **320 px**: the short-session-only line (Christmas Eve, a two-digit month) loses its last characters to the line's ellipsis
   at 320 px (−11.2 px); it fits from 360 px. Owner question 3.
5. **The yardstick gained states** (`hol`, `short`; 12 views, 30 view-modes) and `s1/tools.sha256` was re-pinned (only
   `states.mjs` changed); their base is the S2 head tree on 4462, as SVA-P0's gate says.
6. **The ledger's rebuild dir.** The yardstick's default rebuild (the `bd20584` snapshot) no longer exists in the scratch, so the ledgers ran
   with the S1 head's rebuild (`9402b05`), after proving on the S2 head tree that it reproduces the base ledger byte
   for byte. The snapshot itself was not re-run.
7. **F9's test list**: the Python collector test is not written (no collector change); 「Playwright static (390px と 1440px)」 is
   `brief-holiday.spec.js` at 320, 375, 390 and 1440; Design Acceptance is not run here (not measured, above).

### Owner lines

None moves (the table above). The entry chunk grows 0.79 kB gzip to 114.70 (line 134.00).

### Owner questions (オーナー向けの質問)

1. 休場日の名前（感謝祭など）を出すには、公開する取引所カレンダーに名前を足す変更（`collect-market-trends.py`、F9 の前半）が要ります。今回は「公開済みのデータだけを使う」指示に従い、名前は出していません。名前の追加を別の作業として行いますか？
2. 休場の一行は、分析日の公開が届いた時点から次の取引日の引けまで出ます（例: 11/26 16:34 JST 〜 11/28 03:00 JST）。F9 の案（11/27 06:00 JST 〜 11/28 03:00 JST）より早く出ます。この範囲でよいですか？
3. 幅 320px のスマホでは、短縮取引だけの日（クリスマスイブ）の行が末尾で「…」になります（11.2px 不足、実測）。360px 以上では収まります。「12/24短縮」のように短くしますか、それとも今のままでよいですか？
4. スマホのバーに見えるのは「11/26休場」までで、翌日の短縮取引と引けの時刻（日本時間 03:00）は、市場タブの「推移」の説明（閉じた欄）と幅 1024px 以上でだけ見えます。Today の注記に全文を出すと高さが増えるため出していません。スマホでも時刻を見せる必要がありますか？

### Allow-list delta (this package)

30 values entries, all anchored to the closure views (`hol-m50/…`, `short-m50/…`) only, package `SVA-H`, one reason (the line
and the explanation sentence, against the S2 head, their only base): added `closed.lines` 4 and `opened.lines` 6 (the age line
「分析基準日 10/2（金）引け・10/5休場」 / 「…10/5短縮取引」, its detail, and 市場's explanation with the sentence first), removed
`closed.lines` 1 and `opened.lines` 2 (the plain line 「分析基準日 10/2（金）引け・米国株」 and the explanation without the sentence),
added `closed.numbers` 6 and `opened.numbers` 6 (the tokens 5, 6, 7, 10, 02, 00 the new text carries), `enteredFirstFold` 4 and
`leftFirstFold` 1 (the line in the phone's first fold). No matrix entry and no surfaces entry. Generated by a scratch script that
stops on any difference it cannot name; the SV-A list is now 30 entries, sha256
`9f4cc03fb78cc80d29f7b765684d846741bf97f9a2424ed0b9ca73df918add09` (was `[]`, `37517e5f…b570`).

| Package | Values entries | Cross-surface entries | Table |
|---|---|---|---|
| SVA-P0 | 0 | 0 | — |
| SVA-H | 30 (closure views only) | 0 | above |
