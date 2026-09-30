# Research workbench: review and phase 1

## Scope and design review

The user authorized review, implementation, verification and publication of the attached first phase. I04 (saved candidate changes), I01 (chart comparison), I02 (sector strength), and the necessary I14 snapshot contract are implemented together. Selection thresholds and entry gates are unchanged.

Daily changes need observations recorded at publication, not a retrospective rerun of current fundamentals against old prices. The first release therefore explicitly says that there is no prior saved observation. It must not invent new passes or historical returns. Unknown evidence takes precedence over failure when attributing changes. A return requires an earlier saved pass under the same rule/universe definition. Liquidity boundary changes, missing symbols, unknown conditions and version changes are incomparable.

Sector ETF price strength and constituent selection breadth are different statistics. This release uses 11 broad ETF proxies and SPY with the same split-adjusted Close / no dividend adjustment policy. It does not claim to reproduce the 197 IBD industry groups, JdK RRG or official IBD RS. Provider classifications are normalized (including Financial / Financial Services), fixed in each snapshot, and disclosed as distinct from ETF membership. Unknowns remain in the breadth denominator; zero-member groups have an unknown percentage, not zero percent.

## Implementation

- The candidate board reuses the current ordering, filters and canonical pivots. A comparison page has up to six cards, with actual Lightweight Charts mounted only while visible. The detail modal pauses the cards; closing it retains comparison page and period. Price, RS, volume and SMA50 are distinguished. The cards show price position separately from the existing entry gate. Lightweight Charts attribution is retained.
- A content-addressed workbench asset carries the analysis date, source research hash, snapshot ID, rule hash, universe definition and membership hash, coverage, changes and sector aggregates. The client verifies asset hash, date and ID. The manifest pointer is written after all exports finish. Existing publication quality gates keep the last good deployment on failure.
- Full observations are compressed and excluded from initial page downloads. The final build records the first observation per session; subsequent UI releases do not rewrite it. Daily and UI workflows restore published history before calculating changes. The comparison window retains up to 30 sessions. Same-session and future observations are not comparison baselines. Unknown source publication times remain null rather than being invented.
- Sector data failures explicitly replace the failed optional series; no stale-series fallback. NYSE session coverage is validated at acquisition. Relative indices require every benchmark date and matching adjustment policy. 63/126-session indices and a separately defined 21-session relative change are available as cards or a table, linked to the same filtered candidate board.
- Offline mode explicitly labels saved data with its analysis date.

## Verification record

Initial real-data validation (2026-09-29 analysis): 5,901 rows; 1,840 / 1,889 liquid rows verified (97.4%). All selection summaries reproduce. Twelve actual chart/detail cases, including AMD, TSM, JPM, KLAC and SLAB, retain common scalar values. Sector inputs: all 12 ETF/SPY series available. All sector aggregates reproduce from the published inputs. Financial classification: 277 liquid symbols, 20 Minervini passes; missing evidence remains separate.

Unit cases cover pass/fail/unknown transitions, missing symbols, liquidity-boundary changes, first observations, version changes, return history, future exclusion, relative-price math, missing sessions and actual classification aliases. Browser CI covers both 1440px and 390px, theme contrast, period changes, paused offscreen/modal charts, sector navigation and preservation of comparison state. Final CI and public verification are recorded after release below.

## Follow-ups from the attachment

These are separately scoped ideas, not completed features or promised trading results. `bd` is unavailable on the current workstation, so the follow-ups are recorded here.

| Item | Relative effort | Dependencies / acceptance condition |
|---|---|---|
| I03 volume dry-up evidence | Medium | Detector windows, exclusion of breakout bar, fixed missing-data fixtures; no imported threshold change |
| I05 event timeline | Medium | Dated/confirmed earnings provider, BMO/AMC/timezone, event revisions and publication timestamps |
| I06 hypothesis journal | Medium | Immutable journal revisions, explicit user confirmation, local import/export compatibility |
| I07 Japanese filter AST | Medium–large | Allowlisted grammar, preview of ambiguous conditions; any LLM server/auth/cost is separate |
| I08 chart replay | Large | Point-in-time fundamentals/universe, delistings/splits, immutable judgments, forward-session outcomes |
| I09 research pack | Small–medium | Snapshot-bound JSON/CSV/PNG, sources and missing reasons; no personal holdings by default |
| I10 state alerts | Medium | Dedup event IDs and quote freshness; background push requires an execution service and user notification settings |
| I11 Codex daily commentary | Small–medium | Read-only evidence pack, schema + factual validation, separate authenticated quota/cost controls |
| I12 Codex CI review | Medium | Least-privilege manual workflow, pinned action, dedicated API credential; no auto-merge or public comments |
| I13 skill evaluation | Medium | Small normal/missing/holiday/split/empty fixtures; measures correctness, not investment profitability |

## Remaining limitations

- No real day-to-day changes can be claimed until a second published session exists; no historical backfill was fabricated.
- Sector indices are broad ETF proxies, price-return based, with daily data. They are not real-time industry indices or dividend total returns.
- `published_at` is unknown inside a predeployment bundle; the GitHub deployment record is the external publication evidence. `generated_at` remains the source timestamp, not a fictitious recent price timestamp.
- The existing SEC 13F access/coverage and historical point-in-time financial-data limitations remain. This phase does not turn missing data into passes, or claim investment performance.

Technical reference for synchronized ranges: [Lightweight Charts time-scale API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi). The installed library implementation and existing chart wrapper were reused; third-party screen assets and sample prices were not copied into production.

## Measured performance

Same workstation, Chromium in-app browser, actual 1265px viewport, three interleaved warm reloads of production builds against the identical 2026-09-29 dataset. No CPU throttling. A local server recorded DOM readiness through PerformanceObserver / MutationObserver; these are not internet cold-load or completed GPU-paint measurements.

| Metric | Before | Phase 1 |
|---|---:|---:|
| First candidate DOM, median | 454.4 ms | 469.3 ms |
| First chart canvas DOM, median | 519.1 ms | 534.7 ms |
| Longest initial task across three runs | 86 ms | 87 ms |
| Research index, gzip equivalent | 1,751,381 bytes | unchanged |
| Additional workbench, gzip equivalent | none | 28,066 bytes |
| Full observations downloaded at startup | none | none |

Candidate samples: before 454.4 / 457.8 / 436.9 ms; after 516.5 / 469.3 / 439.7 ms. Chart samples: before 519.1 / 528.0 / 510.7 ms; after 596.8 / 534.7 / 518.0 ms. Compression figures are computed from files, not browser-observed compressed wire transfer; the measurement server served uncompressed content. Workbench raw size was 1,160,554 bytes, compressed history archive 706,980 bytes. Browser heap readings varied with GC and other open tabs and do not support a memory-improvement claim. Comparison mounts only visible cards (two in the inspected desktop viewport, at most six); opening the detail modal leaves zero comparison charts mounted.

The local preview tabs initially did not follow the browser viewport override, so their measurements use the actual 1265px content width. Responsive appearance was first inspected in a local fixed-width iframe, and 1440px / 390px interactions and accessibility were checked in CI Chromium. The override later worked on the public verification tab: the published site was additionally operated at a measured 390px window width (375px content plus scrollbar), with no horizontal content overflow. The temporary override was reset afterwards.

## Final checks

- Frontend suite on 5b2fa3d: 130 files, 1,024 tests passed; six frontend smoke tests passed. Subsequent focused tests for the dialog/history/sector changes: 19 passed. Lint: zero errors, eight existing warnings.
- Browser regression on bb73ba8: all four tests passed, including 1440px and 390px comparison/navigation and dark/light axe checks. CI screenshots were downloaded and visually inspected. Fixtures are explicitly labeled Synthetic and never exported into production.
- Regression testing exposed a missing dialog role on the existing chart modal. The actual modal now has `role="dialog"`, `aria-modal` and a heading reference; the test was retained rather than weakened.
- [CI and browser screenshots](https://github.com/kusennjp1-ai/screener/actions/runs/36737611608) (`static-browser-evidence` artifact).

Additional real-data inspection found LBRDA's last candle was 2026-08-21 even though the payload carried the 2026-09-29 analysis date. The new comparison view now rejects failed daily audits and mismatched final candles, showing the reason instead of drawing a stale comparison. The actual LBRDA card showed the mismatch warning and zero chart canvases. Three regression cases cover verified history, failed audits and a stale final candle despite matching payload metadata.

The first release attempt was cancelled before deployment to include this correction. Research UI Release now has an explicit `ui_only` option (default false): for display-only changes it reuses the last successfully published fundamentals and setup evidence, restores saved history and fetches benchmark/sector prices, then reruns export and all data-quality gates. It does not rewrite the source price timestamp. Normal daily/automatic releases retain the full evidence refresh. This release uses the verified-data path; it is not a claim that previously unavailable institutional data was acquired.

## Published result — 2026-10-01 JST

- Code: `6217331`. [Final CI](https://github.com/kusennjp1-ai/screener/actions/runs/36740682152) succeeded: 132 frontend files / 1,028 tests; six smoke tests; four static browser tests; all backend quality gates. The release repeats the relevant rule tests including the new history, sector and comparison guard cases.
- [Research UI Release 36740696089](https://github.com/kusennjp1-ai/screener/actions/runs/36740696089) succeeded. ETF/SPY acquisition: 12 / 12 series. Publication gates: 1,840 / 1,889 daily histories verified; all 5,901 selection summaries reproduce; 12 real cross-view cases and global filters/sorts agree; sector aggregates and saved-observation hashes reproduce.
- [Public site](https://kusennjp1-ai.github.io/screener/) was loaded after deployment. Daily-history initialization, comparison charts, detail dialog and return, period retention, mobile light/dark display, sector navigation (Financial: 277 candidates), and the LBRDA warning were confirmed. The latter displayed no chart canvas.
- Public `workbench-14e44e918baf2bc4.json`: 1,160,554 bytes uncompressed; analysis date 2026-09-29; source timestamp remains 2026-09-30T04:56:47Z. Public asset hashes, source research hash, archive hash/date and first saved session were verified from the deployed URL. No previous session was invented.
- Actual public AMD, TSM, JPM, KLAC and SLAB charts each contained 310 daily bars and 310 RS points. Their current-price, canonical-pivot, setup-state and RS scalars matched the published research rows.

Proof files are saved in the workspace output folder `output/phase1-2026-10-01`: `public-comparison.png`, `public-mobile-light.png` and `local-comparison-metrics.json`. They are separate from test-fixture screenshots. Existing external institutional-data and point-in-time financial-data limits remain as described above.
