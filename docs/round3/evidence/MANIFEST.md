# Snapshot manifest — US analysis date 2026-11-12 (round 3)

Built 2026-11-13 (JST) by the Snapshot agent. All inputs below were downloaded read-only; nothing on GitHub was changed.

## Inputs

| Input | Where | Id | Size (bytes) | sha256 |
|---|---|---|---|---|
| `feature-run-us-2026-11-12.json.gz` | kusennjp1-ai/screener release `daily-price-data` (338284553) | asset **743083867** | 110,783,688 | `efbc14c08e4f35054b83a699b7d697024537007e94e71bffaddceb1269ba59ee` |
| `feature-run-latest-us.json` (its pointer) | same release | asset 743084199 | 310 | `abb043c74c68832e73938fa1279000229ab695d9a6fa01d8d2a00e693b2fe8fd` |
| `daily-price-us-20261112.json.gz` | **upstream** `xang1234/stock-screener` release `daily-price-data` (public download URL; see note) | no asset id obtainable (API 403 for that repo in this sandbox; the download redirect names release-asset GUID `f7d6372d-ec68-4fbe-a7af-6752d2822979`) | 118,602,942 | `24799ce0766203b0f582ee74546cb3a3f143065abc85b5b19ff26dc5da4f9b0e` |
| `daily-price-latest-us.json` (its pointer) | upstream, same release | — | 598 | `49b5f7c27a267a2d52744140b1433989788f42cce7d92f5117c2ad0480d5f18e` |

Notes (実測):
- The feature-run sha256 equals its pointer's `sha256`; it was produced by Static Site run 43385558863, job build-market (US), 18:35 JST (`generated_at` 2026-11-13T09:35:49Z), row_count 9915.
- `daily-price-us-20261112*` is **not** an asset of release 338284553 (that release holds daily-price bundles only up to 20261005). The Static Site workflow reads the price bundle from `GITHUB_DATA_REPOSITORY`, which is `xang1234/stock-screener` unless source promotion is on (static-site.yml:343). The downloaded file's sha256 equals the build-market log's `input.sha256` (`Price pipeline summary`, job 131753175471) and the upstream pointer's `sha256`; pointer `generated_at` 2026-11-13T02:55:26Z (11:55 JST), 10,040 symbols, bar_period 2y.

Job logs read (`gh api …/actions/jobs/<id>/logs`), kept under `build/logs/`:

| Run | Job | Log sha256 |
|---|---|---|
| Static Site 43385558863 (16:24–19:20 JST, head 8849bf9) | build-market (US) 131753175471 | `56365d72a5fb2d593dddbc357bb1949516248f90b1d2f1f52a76d743019134c6` |
| same | combine-and-build 131809613471 | `47da72a2c63b4b9ac1c44c8faa59760443076a3980574ec6285c89067bf38349` |
| Research UI Release 43408634161 (19:22–20:10 JST, UI 8849bf9) | publish 131829233957 | `1f3148098676239a784c994a7a7c917ff6c0e46a53a73913ea5b8aa786dc87f3` |

Code: `git archive 8849bf9` (main) at `build/src/`; `frontend/node_modules` is a symlink to `/home/user/screener/frontend/node_modules` (package.json and package-lock.json are identical between 8849bf9 and that checkout). Python: `/home/user/screener/backend/venv` (3.11.18, pandas 2.2.0, numpy 1.26.3, pandas_market_calendars 5.5.0 — the versions CI installed).

## Outputs

| File | Rows | sha256 |
|---|---|---|
| `rows.jsonl` | 980 listed rows (the reproduction of the published 998) | `7aa5d40487c7a12bba1733a6dc2a2e9d59a78c47e2edc056ffab2243e5e325f2` |
| `ready43.jsonl` | 37 setup_ready rows (the reproduction of the published 43) | `d621244cc7a3d3959750d963b57f61bc117ea07e007e310b0bf9fb7219917274` |
| `examples.json` | PayloadMismatch HTFL; fiscal_q4_untagged 未検証; 10 high-ranked non-ready | `a17620c067a9f993f457875b844ce06dc8c8a9164a1de4300f38256594c1a7a7` |
| `charts/*.png` | 96 at 390×844 (48 stocks × 6か月/週足) + 12 at 1440×900 (6 stocks) | `charts/index-phone.json`, `charts/index-desktop.json` list each render |

## Reproduced vs published

Published values are 実測 from the combine-and-build log (`Published coverage (fundamentals)`, `Setups: … calculated`, `Research list summaries …`).

| Measure | Published | This snapshot (proxy variant, used) | Strict variant |
|---|---|---|---|
| Scan rows (feature run minus Finance-ETF / ETN) | 5955 | **5955** (exact) | 5955 |
| Seed import accepted / rejected (of 10,040 bundle symbols) | 6043 / 3997 (invalid_ohlcv 2888, price_discontinuity 1109) | **6043 / 3997 (2888 / 1109)** (exact) | same |
| Setups calculated | 4539 | 4421 | 2946 |
| Verified charts (RS universe) | 4538 | 4421 (−117) | 2946 |
| Trend template qualified (listed) | 627 | 614 (−13) | 420 |
| Brief-listed rows (qualified + one condition short) | 998 | **980 (−18, −1.8%)** | 629 |
| setup_ready pass / fail / unknown | 43 / 955 / 0 | **37 / 943 / 0** | 31 / 598 / 0 |
| Top failed checks | outside_early_zone 735, readiness_below_threshold 726, volume_above_dryup_cap 435, stage_not_ok 272, rs_leadership_insufficient 165, ma_alignment_insufficient 83, setup_score_below_threshold 80, atr14_pct_exceeds_limit 19, quality_below_threshold 5, primary_pattern_below_confidence_floor 1 | 725, 719, 427, 265, 159, 79, 77, 17, 5, 1 (same order) | 461, 455, 268, 161, 117, 45, 56, 15, 3, 1 |
| rs_line_high value true / leading true | 16 / 4 | **16 / 4** | 14 / 3 |
| Base length filled on listed rows | 943 / 998 | 928 / 980 | — |
| Pattern confidence under the floor (55) | 1 | 1 | — |
| Chart bars per verified chart | 310 (p10 = p50 = p90) | 310 for a full history (first bar 2025-08-21) | same |

Only the net counts are compared above. Which symbols make up the published 998 and 43 cannot be read (the published index is on GitHub Pages, which is blocked). The overlap is therefore 未検証; the rebuild may both lack and add rows. Two membership and order checks against what the log does name (実測):
- **Membership.** All 35 symbols the log names as published-listed are among this snapshot's 980 rows. These are the 10 `invalid_payload` PayloadMismatch symbols plus the 25 `unknown_symbols` of `Data coverage (fundamentals)`.
- **Order.** `unknown_symbols` keeps the order of report-data-coverage's candidate list (Minervini top 50, then minervini2 top 50, then briefRows). Its Minervini top-50 head is BMO, MFC, CUBI, HMC, PBA, TD.
  - In this rebuild BMO, CUBI, HMC, PBA and TD are top-50 candidates in that same order (positions 2, 18, 33, 34, 36).
  - MFC is not in this rebuild's top 50. MFC is a `bundle_envelope_proxy` row: its recomputed pivot is 44.54, against 43.81 in the feature run, which puts it outside the buy zone. So a proxy row's Setup Engine output can differ from the published one.
