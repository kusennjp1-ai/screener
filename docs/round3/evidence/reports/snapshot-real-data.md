I built the shared snapshot, but it does not match the published site exactly. It reproduces **980 of the 998 listed rows and 37 of the 43 ready rows**, comparing counts only. The published index can't be read here, so which symbols overlap is 未検証.

`docs/round3/snapshot.md` is committed and pushed on claude/r3-step0 (776763ee, then 824c4017). No PR was opened and nothing on GitHub was triggered.

**Paths** (all in /tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/):
- `MANIFEST.md`: input ids, sizes, sha256, output hashes, and the full published-vs-reproduced table.
- `README.md`: what is in the snapshot, how it was built, what is missing, known differences, and how a persona renders more stocks.
- `rows.jsonl`: the 980 listed rows, in the brief's own ranking order, with their bars.
- `ready43.jsonl`: the 37 ready rows (the file keeps the requested name).
- `examples.json`, `render-targets.json`.
- `charts/<SYM>-<6m|weekly>-<390|1440>.png` (108 PNGs) and `charts/index-{phone,desktop}.json`.
- `build/`: scripts, logs, the code archive of 8849bf9, the esbuild bundle, the render fixture and the Playwright config.

**Inputs (実測)**
- **Feature run:** asset 743083867, 110,783,688 bytes, sha256 efbc14c0…ba59ee. It matches its pointer (asset 743084199).
- **Price bundle:** `daily-price-us-20261112.json.gz` is not in release 338284553 (that release stops at 20261005).
  - CI reads it from upstream `xang1234/stock-screener`. I downloaded it from there: 118,602,942 bytes, sha256 24799ce0…5b9f0e.
  - That hash equals the `input.sha256` in the CI build-market log.
  - No asset id can be read for that repo here (the API returns 403).

**Reproduced vs published**

| Measure | Published | Reproduced |
|---|---|---|
| Scan rows | 5955 | 5955 (exact) |
| Price import accepted / rejected | 6043 / 3997 (2888 / 1109) | exact |
| Verified charts | 4538 | 4421 |
| Trend template qualified | 627 | 614 |
| Listed rows | 998 | 980 |
| setup_ready pass / fail | 43 / 955 | 37 / 943 |
| Failed checks: early zone, readiness, volume, stage | 735 / 726 / 435 / 272 | 725 / 719 / 427 / 265 (same order) |
| RS-line new high / leading | 16 / 4 | 16 / 4 |

- **Membership check (実測):** all 35 symbols the CI log names as listed are in the 980.
- **Order check (実測):** in the CI log's candidate order, BMO, CUBI, HMC, PBA and TD keep their relative order in my ranking. MFC does not; it is a proxy row (explained below) and its recomputed pivot is 44.54 against 43.81 in the feature run.

**Why it is off**
- CI rejected 3997 symbols' upstream bars and refilled 2989 of them from Yahoo during the run; Yahoo is unreachable from this sandbox.
  - 368 listed rows, including 7 of the ready ones (EMR, EQH, IQV, GEO, BB, BHB, DSGR), use the raw upstream bars instead.
  - For counting only, each of those bars had its high and low widened to cover its own open and close. Their rows are tagged `bars_basis = bundle_envelope_proxy`.
- 120 symbols CI could chart have no bars here: 59 have a split discontinuity, 47 are missing from the bundle, 14 stay incoherent. This shrinks the RS推計 universe by about 2.6%.
- SPY comes from the bundle, not from yfinance. The two were not compared because Yahoo is blocked.
- The other 612 listed rows use exactly the bars CI held.

**Rendering**
- 48 stocks at 390×844, each at 6か月 and 週足: the 37 ready rows, HTFL as the PayloadMismatch example, and the 10 highest-ranked rows that are not ready (DRI, BMO, HCI, HUM, WSM, SONO, PRGS, NDSN, LTC, NATL).
- 6 stocks at 1440: PCRX, SWKS, GLBE, HTFL, DRI, HCI.
- Each card is the app's own stock screen on Chrome for Testing 147 with the CI fonts. There were no page errors, and every phone card is 508px tall.
- 8 proxy-bar stocks render as 「未検証の足」 (the app's own refusal to certify): BHB, DSGR, EMR, EQH, GEO, HCI, IQV, NATL. The README says so.

**Gaps (未収録 or 未検証)**
- Not available, so not served: SEC records, the published index and details, earnings dates, institutional evidence and market trends. Where the rendered screens say 「SEC 未配信」, it means 未収録 here.
- The fiscal_q4_untagged example is 未検証: no log line or readable asset names a symbol.
- Which symbols make up the published 998 and 43 is 未検証.

**Facts personas may want first (実測)**
- Only 18 of the 37 ready rows are on the brief's liquid lists.
- TECH and ARX rank last because their 60-session price range is under 5%.
- PCRX (rank 1, ready) gapped from 25.20 to 36.39 on 10-08 and has closed between 36.31 and 36.49 since.