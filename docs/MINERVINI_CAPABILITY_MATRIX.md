# Minervini Capability Matrix — できること/できないこと（複数エージェント分析）

> **生成**: 6レンズ並列分析（ENTRY/SETUP・SELL/RISK・MARKET-TIMING・CANSLIM/FUNDAMENTAL・MOBILE/PWA・DATA/INFRA）→統合。各エージェントは実コードを読んで裏取り（推測でない）。C77時点。
> **注**: workflowのcompleteness-critic/finalizeはFable-5週次上限で失敗→統合レポート(6レンズ+synthesis)はmainループで回収し、監査補遺(§5)をmainループで追加。


*Grounded in the six lens audits (ENTRY/SETUP, SELL/RISK, MARKET-TIMING, CANSLIM/FUNDAMENTAL, MOBILE/PWA, DATA/INFRA). Frozen 908-harness metrics: TT 69.7 / S2 90.0 / SETUP 78.6 / FIRE±5 91.7 / GATE 66.5.*

---

## 1. CAN DO

**Legend:** ✅ **validated** = measured on the 908 harness or a two-window backtest; 🟡 **implemented-but-weak** = present and wired but unvalidated / proxy / display-only.

### Entry / Setup detection

| Capability | Minervini principle | User can… | Status | Evidence |
|---|---|---|---|---|
| Strict 8-condition Trend Template AND-gate | The 8 conditions defining a Stage-2 leader | Get a hard `passes_template` boolean per stock in a cache-only scan | ✅ TT 69.7% recall | `minervini_scanner.py::_calculate_minervini_score`; `criteria/moving_averages.py::comprehensive_ma_analysis` |
| Per-bar 8-point Trend Template band (TPR) w/ self-computed RS = Stage-2 read | "Template ensures a Stage-2 uptrend" | See strong/transition/weak phase chip; strongest Stage-2 detector | ✅ S2 90.0% | `services/minervini_bands.py::compute_tpr` |
| RS Rating (recency-weighted percentile) + RS-line new-high tell | Buy the strongest names; RS line leads price | Filter RS≥70/RPR≥70; see RSH/BD leadership columns | ✅ (RS70 metric) | `criteria/relative_strength.py`; `markets360/ratings.py`, `rs_line.py` |
| Three-path VCP base detector (cup + MA-tight C70 + vol-contract C75), each gated on prior 2× advance | VCP: progressively tighter pullbacks, volume dry-up under a pivot | Detect contraction count/quality; union recall ~55.6% | ✅ SETUP 78.6 / FIRE±5 91.7 | `markets360/vcp_footprint.py`; `analysis/patterns/legacy_vcp_detection.py` |
| Structure-gated pivot proximity w/ +5% chase cap | Buy at the pivot; never chase >~5% | Get near-pivot/ready flags that don't fire on every uptrend | ✅ (detected-gate fixed 96% false-fire) | `vcp_footprint.py` (MAX_PAST_PIVOT_PCT); `legacy_vcp_detection.py::find_pivot_point` |
| 1.5× volume-confirmed triple-barrel "Buying Now!" (trend+pressure+breakout) | Breakout on expanding volume; define R at entry | Get EOD buy card w/ trigger, stop, 2R/3R targets | ✅ (anchored to VCP high) | `markets360/signals.py::compute_buy_signal` |
| Pocket pivot / power trend / volume surge early tells | Pocket pivots & Power Trend for in-base/continuation entries | See timing chips per stock | 🟡 not part of FIRE metric | `markets360/entry_signals.py`; `minervini_scanner.py` |
| Base-quality scoring + recall-aware watchlist ranking | Rank setups by base quality | Sort VCP-detected-first (VCP/VScr/Pvt/Rdy cols) | 🟡 heuristic weights | `legacy_vcp_detection.py` vcp_score; `scan_orchestrator.py` quality_rank (C77) |
| Setup Engine: cup-w-handle, HTF, 3-weeks-tight, double-bottom, NR7 | Additional base archetypes | Get se_* distance-to-pivot / readiness columns | 🟡 separate unreconciled stack | `analysis/patterns/*`; `scanners/setup_engine_screener.py` |

### Sell / Risk management

| Capability | Minervini principle | User can… | Status | Evidence |
|---|---|---|---|---|
| Protective stop: 7-8% hard backstop + tighter structural stop | Never lose >7-8%; hide stop under base low | See entry, stop price, stop_pct, risk/share per candidate | 🟡 (placement validated via sizing) | `markets360/risk.py::compute_risk_plan` (MAX_LOSS_PCT=0.08) |
| Stop-derived position sizing | Entry, stop, size are one decision | Get suggested % of capital so a stop-out = fixed heat | ✅ C61 (2× risk lifted both windows, DD unchanged) | `risk.py:133` |
| 1.25%/2.5% account-risk, regime-scaled progressive risk | Commit harder only in confirmed uptrends | Per-trade heat auto-doubles in confirmed uptrend | ✅ C61 / BACKTEST_C54 | `risk.py:30-44`; `markets360_scanner.py:164` |
| Trailing-stop ladder (1R half-risk → 2R breakeven → 3R lock, trail 50-DMA) | Move stops only up; take to breakeven then lock | See live rising new-stop price + basis per position | 🟡 mechanics sound, ladder not separately harness-tested | `exit_signals.py::compute_trailing_stop` |
| 50-DMA breakdown sell-into-weakness (≥1.5× vol, hold-gated) | Close below 50-DMA on volume = trend broken | Positions flip to exit / tighten-stop w/ confidence | 🟡 | `signals.py::detect_50dma_breakdown` |
| Climax-run sell-into-strength (70%+ over 200-DMA, 8/10 up, exhaustion gap) | Unload into parabolic strength | See climax card w/ tells fired + score | 🟡 | `exit_signals.py::detect_climax_run` |
| Unified precedence-resolved sell plan across surfaces | Manage every trade daily against one framework | One label/position on Positions page, digest, push | 🟡 | `exit_signals.py::compute_sell_plan`; `position_status.py`, `digest_service.py:640` |
| Exit-leash validated near two-window optimal | 50-DMA single-day break is the binding exit | Trust sell tightness isn't accidental (confirm-exit rejected) | ✅ C73 (−23.5/−13.5pp when relaxed) | `docs/MINERVINI_EXIT_LEASH.md`; `exit_leash_diagnostic.py` |

### Market timing / regime

| Capability | Minervini principle | User can… | Status | Evidence |
|---|---|---|---|---|
| 4-state regime classifier from index OHLCV | SEPA Rule 1: buy only in a confirmed uptrend | See regime + health 0-100 per scan row, per market | ✅ C45-audited | `market_regime.py::assess_market_regime`; `benchmark_registry_service.py` |
| O'Neil distribution-day count w/ rally-expiry + stalling days | 4+ = under pressure, 6+ = correction risk | See real Market-Pulse dist-day chip | 🟡 mechanics faithful, count not time-series validated | `market_regime.py::_distribution_days` |
| Follow-through-day confirmation + failure breaker | FTD re-enables buying weeks before MA recovers | Correction→confirmed_uptrend at pilot exposure on live FTD | ✅ GATE 66.5 | `market_regime.py::detect_follow_through` |
| Market gate caps ratings to Watch in hostile regimes (all screeners) | SEPA Rule 1 enforced on output | Never get a Buy in a bear tape | ✅ | `scan_orchestrator.py:599-624` |
| Per-name Pressure / Buy-Risk / TPR bands | Trend phase + buy-timing risk per name | See Force-Index pressure, ATR buy-risk chips | 🟡 ~85% bar-agreement vs MM360, not harness | `minervini_bands.py::calculate_bands` |
| Regime-scaled exposure ladder (0→100%) + post-FTD ramp | Scale exposure to health; pilot after FTD | See suggested exposure % ladder | 🟡 **display-only** (see gap) | `market_regime.py` REGIME_EXPOSURE; `MarketRegimeBanner.jsx` |

### CANSLIM / fundamental quality

| Capability | Minervini principle | User can… | Status | Evidence |
|---|---|---|---|---|
| Full CANSLIM screener, hard C&A&N&S&L gate | O'Neil growth+momentum leadership | Screen for growth leaders, pass/fail + 0-100, no pre-earnings Buys | 🟡 fundamentals=None in 908 harness | `canslim_scanner.py` |
| Minervini fundamental bonus (capped +10, neutral-on-missing) | Technicals decide WHAT, fundamentals WHICH | Template passers re-ranked by ROE/EPS/sales/code33 | 🟡 **unvalidated** | `criteria/fundamental_bonus.py`; `minervini_scanner.py:416` |
| Acc/Dis reworked to close-to-close up/down volume (C77b) | Institutional footprint = up-volume, not intraday CLV | Get 0-99 accumulation w/ NO external data (cache-only) | ✅ measured +7.6pp | `criteria/accumulation_distribution.py:126` |
| Code 33 earnings-accel engine (EPS+sales+margin YoY ×3Q) | Minervini's key earnings signal | Isolate genuine 3-quarter acceleration | 🟡 CI-checked vs live SEC, US-only | `sec_edgar_financials.py`; `code33-check.yml` |
| IBD rating stack: EPS/SMR/Composite/Acc-Dis/group | O'Neil leadership triangulation | Each name carries ratings + IBD-50-style top-N | 🟡 universe-relative proxy, calibrated vs IBD-50 | `eps_rating_service.py`, `smr_rating_service.py`, `composite_rating_service.py` |
| IBD industry-group ranking (~197 groups) → composite | Buy leaders in leading groups | Group rank contributes 12% of Composite | 🟡 | `ibd_group_rank_service.py` |
| User-facing fundamental preset screens | Repeatable IBD-published cuts | Pick named screens instead of hand-tuning | 🟡 | `preset_screens.py` |

### Mobile PWA

| Capability | Minervini principle | User can… | Status | Evidence |
|---|---|---|---|---|
| Post-close decision home (regime banner, top-20 template leaders, leaders-in-leading-groups, group top-10) | Rule 1 + buy leaders in leading groups | One-scroll daily triage on phone after US close | 🟡 | `StaticHomePage.jsx` |
| Full offline-of-backend scan (filter/sort/presets over exported universe) | Systematic SEPA screening | Slice universe by RS/group/VCP/EPS on 375px | 🟡 | `StaticScanPage.jsx`; `scanClient.js` (60+ fields) |
| Per-symbol chart + buy checklist, prev/next nav, URL-synced modal | Buy at VCP pivot on volume; verify template | See candlestick w/ pivot/VCP/MA/RS, Triple-Barrel checklist, swipe symbols | 🟡 | `StaticChartViewerModal.jsx`; `BuyChecklist.jsx` |
| Mobile sell badge strip (SELL/climax/tighten-stop + stop price) | Cut losses / sell into strength | See pulsing exit badge w/ new stop in the field | 🟡 thinner than desktop | `SignalBadges.jsx`; modal L603-608 |
| Group rankings + RRG + breadth (4%-movers, 10-day ratio, benchmark overlay) | Confirm broad leadership rotation before buying | Check candidate's group rank & breadth top-down | 🟡 StockBee-style breadth, siloed | `StaticGroupsPage.jsx`, `StaticBreadthPage.jsx` |
| Installable PWA shell (standalone, safe-area, theme, 4-market, JP glossary) | Discipline through inline education | Install to home screen, tap any metric for JP explanation | 🟡 no service worker | `manifest.webmanifest`; `StaticLayout.jsx` |

### Data / infrastructure

| Capability | Minervini principle | User can… | Status | Evidence |
|---|---|---|---|---|
| CI-brokered vendor egress → Release-asset 2y OHLCV bundles | Stage-2/RS needs clean multi-year daily OHLCV | Run the whole screener offline on real history | ✅ | `github_release_sync_service.py`, `daily_price_bundle_service.py` |
| Cache-only scans w/ fail-closed 409 freshness gate | No decision on stale data | Never scan silently-stale caches; error names market + age | ✅ | `market_data_freshness.py::check_symbol_freshness` |
| 12-market universe machinery (calendars, MICs, currency, suffixes) | SEPA is market-agnostic | Session-aware scans/freshness per exchange | 🟡 non-US coverage thin | `domain/markets/catalog.py`; `market_calendar_service.py` |
| 908-trade offline harness (T0-truncated, 63-bar control) | Validate vs Minervini's own 908 entries | Measure frozen metrics in ~7min, no network | ✅ | `scripts/validate_trade_ideas.py` |
| Precomputed static PWA (fast prices ~4:06pm ET, full rebuild ~2h) | EOD swing needs only daily closes | Mobile closing-bar screens, no backend/keys | ✅ | `dataClient.js`; `static-site.yml` |
| Layered fallback + rate-limit discipline (Finviz→yfinance, AV 25/day, data_fetch queue) | Complete un-throttled data | Refreshes stay within vendor limits, degrade gracefully | ✅ | `data_source_service.py`; `rate_limiter.py` |

---

## 2. CANNOT DO (yet)

*Sorted by PRIORITY = importance × performance-impact. Tier A = highest leverage & lowest blocker.*

| # | Gap | Minervini principle | Import. | Blocker | How to enable (in THIS codebase) | Est. perf impact |
|---|---|---|---|---|---|---|
| 1 | **Stop-HIT never surfaced as a sell action** — a name bleeding below the user's stop on light volume (above 50-DMA) reads "hold" | The stop is inviolable — cut at −7-8% | critical | **none** (pure logic) | Add top-precedence branch in `compute_sell_plan`: if `last_close ≤ trailing.stop/initial_stop` → `stop_hit`/`exit`; add SellPlanCard state + urgency-0 digest map (~5 lines) | **High**: caps left-tail losses at intended 1R/backstop — the failure Minervini says destroys accounts |
| 2 | **Regime is breadth-blind** — computed from index price/volume only; a cap-weighted index can print highs on 5 mega-caps while breadth rots, still reads confirmed_uptrend @100% | Market health = participation, not index level | critical | **none** (all cached) | Extend `BreadthCalculatorService` to compute %>50/200-DMA + net-new-highs from same cached OHLCV; pass breadth-divergence penalty into `assess_market_regime` to downgrade + trim exposure | **High**: catches distribution tops 1-3 wks before MA/dist structure breaks — largest DD-avoidance lever |
| 3 | **Exposure ladder is display-only; gate is binary** — under_pressure @55% gates identically to confirmed @100%; sizing is fixed 1.25% regardless of regime | Scale exposure to health; pilot after FTD | high | none (in-repo) | Tier rating cap by regime (under_pressure: Strong Buy→Buy); feed `exposure_pct` into `risk.py` sizing so pilot regimes shrink size | **Med-high**: enforces smaller/fewer names under pressure — core DD control currently unapplied |
| 4 | **No market-level SELL/risk-off alert** — only late MA-derived correction flip; nothing says "dist count crossed 6 / index broke 50-DMA → raise cash" | Sell into strength / raise cash when market tops | high | none for trigger (PushNotification is a deferred tool) | Add top-side trigger in `market_regime.py` (dist ≥ correction + index breaks 21EMA/50DMA on vol, or failed FTD) → banner state + push; dist/FTD-failure logic already exists | **High**: raise cash near top vs after structure breaks — cuts give-back on 2-3 largest corrections/cycle |
| 5 | **No portfolio-heat aggregation / concentration cap** — nothing stops 8 positions × 2.5% = 20% correlated heat | Cap total open risk & concurrent positions | high | none (positions table has shares/entry/stop) | Portfolio-status endpoint summing `account_risk_pct` across open rows; warn over configurable heat/slot cap; render on PositionsPage | **Med-high**: aggregate-heat is a primary DD lever; per-trade sizing is only local without it |
| 6 | **No offline PWA (no service worker)** — every launch re-fetches over network | Tool must be available at the moment of decision | critical(usability) | none (static immutable JSON = ideal cache case) | Add vite-plugin-pwa/Workbox to `vite.config`: precache shell, StaleWhileRevalidate the daily-`run_id` JSON (~1 day) | Neutral on alpha, **decisive on adherence** — missed daily reviews erode SEPA discipline |
| 7 | **No watchlist / position tracking on mobile** — watchlist disabled, sell_plan never cross-referenced to holdings | Position mgmt & exits are half of SEPA — only for what you hold | critical | none (localStorage suffices) | localStorage/IndexedDB watchlist; "My Positions" page surfacing per-holding exit badges + R-multiple from exported sell_plan (~2-3 days) | **High**: edge is disproportionately in exits — a held name breaking 50-DMA must be visible same-day |
| 8 | **Fundamental bonus + entire rating stack UNVALIDATED** — +10 bonus & MSCORE contribute 0 in 908 harness (fundamentals=None) | Every overlay must earn its weight vs outcomes | critical | **data** (point-in-time 2015-20 fundamentals not cached) | Snapshot point-in-time cached fundamentals at each 908 entry, re-score, measure catch-rate edge like `measure_accdis_discrimination.py` | **High/unknown**: reorders which passers users buy first with no measured edge — could be net-neutral or mis-allocating |
| 9 | **CANSLIM 'A' proxied by a single quarter Y/Y** — not O'Neil's 3-yr annual EPS ≥25% | Durable multi-year record, not one hot print | high | none (annual history already fetched in GHA) | Expose 3yr-annual-growth field into fundamentals cache; have `_check_annual_earnings` consume it | **Med+**: filters one-quarter wonders → modestly lifts CANSLIM Buy precision |
| 10 | **Institutional 'I' = static % band** — not INCREASING sponsorship / fund count | Rising quality sponsorship matters more than absolute % | high | partial (finviz Inst Trans in GHA; true 13F not ingested) | QoQ sponsorship-change feature from finviz Inst Trans / SCD2 history into `_check_institutional` + composite | **Med**: accumulating vs distributing sponsorship closer to real 'I' |
| 11 | **Three non-reconciled pivot/base detectors** (footprint / legacy VCPDetector / Setup Engine) can disagree on the same stock | One authoritative buy point per base | high | none (correlated display change) | Reconciliation layer in `scan_orchestrator` resolving one pivot/base_low before populating columns (SPEC.md:34) | **Meaningful UX/trust** gain, neutral on raw metrics; browser-verify required |
| 12 | **VCP recall tops ~55%** — misses W/complex/base-on-base; segmentation keys on single monotonic depth sequence | VCP across all base archetypes | high | none (harness exists); frozen-metric red line | Redesign `find_consolidation_bases` to split composite/W/handle bases (STATE.md #1); measure on 908 | **Bounded/marginal**: C76 showed +18.7pp recall LOWERED FIRE±5 −2.2pp → reverted. Easy to make worse |
| 13 | **No hard profit-taking / partial scale-out** — R-targets & 20-25% rule are display-only | Sell into strength at 20-25% / 2-3R; scale out | medium | none (pure logic) | Add `compute_sell_plan` branch: `take_partial` when r_multiple≥2 or gain≥20-25% & no climax; `r_multiple_targets` already computes levels | **Med**: captures ordinary register-ring; today profits only taken on trend break |
| 14 | **No track-from-scan wiring; stop not validated ≤8%** — `create_position` only checks stop<entry | Buy point, stop, size recorded together | medium | none (both halves exist) | "Track this" action seeding Position from `risk_plan`; warn on create if stop implies >8% loss | **Med**: prevents transcription error & looser-than-8% stops breaking sizing math |
| 15 | **Non-US fundamentals absent** — HK/JP/TW run pure-technical; no EPS/SMR/Composite/code33/inst | Leadership screening applies in any market | high | **data+egress** (finviz/EDGAR US-only, GHA-only) | Wire OpenDART(KR)/EDINET(JP)/HKEX/TWSE adapters into `hybrid_fundamentals_service` + per-market harness | **High for non-US users**: entire earnings/sponsorship half of CANSLIM silently missing |
| 16 | **No push alerts** — never notified on fresh buy pivot or held-name sell | Timely reaction to breakouts / stop breaches | high | partial (Web Push needs a server; Pages is static) | GHA diff today-vs-yesterday on exported `signal.active`/`sell_plan.action` → push; SW + Web Push relay endpoint (~3-5 days) | **Med-high**: converts "saw it 2 days late" into same-day action, esp. on exits |
| 17 | **VCP depth measured on CLOSE, not intraday H/L** (legacy cup path) | Pullback depth is intraday high-to-low | medium | none; frozen golden must be re-baselined | Feed H/L into `find_consolidation_bases`/`_find_peaks`; MA-tight & vol-contract already do; run gate-5 + 908 | **Small-mod**: truer depths → precision > recall gain, low single-digit pp |
| 18 | **Legacy cup VCP lacks prior-2× advance guard** (only MA-tight/vol-contract enforce it) | VCP valid only as continuation of an uptrend | medium | none; frozen-metric caution | Add prior-advance precondition to `VCPDetector.detect_vcp`, validate on 908 | **Small+** on precision (C76 shows the guard supplies FIRE±5 discrimination), small− recall |
| 19 | **RS Rating is scan-universe percentile, not full-market 1-99** | RS Rating is a whole-market percentile | medium | egress (full-universe daily pricing is CI-only) | Nightly full-market recency-weighted snapshot passed as `universe_performances` | **Moderate** distortion on narrow scans; several pp candidate quality |
| 20 | **No time-series regime persistence** — recomputed per-scan, no dist-count history/backtest | Track dist-count & transitions to anticipate roll-over | medium | none (daily breadth Celery cadence exists) | Persist per-market regime snapshots to small table; timeline on BreadthPage; enables standalone gate backtest | **Med**: better UX + threshold tuning; compounding accuracy |
| 21 | **No uptrend-QUALITY tiering** — confirmed_uptrend is one bucket @100% (young power-trend = late extended) | Most aggressive in young/broad/low-dist uptrends | medium | none (health/dist already computed) | Split confirmed_uptrend into Power-Trend (health>80, dist<2 →100%) vs mature (→~80%) driving exposure enforcement | **Med**: concentrates aggression in best windows |
| 22 | **No margin-expansion trend / true SMR** — code33 margin-accel gated OFF by default | Widening margins, not just high current margin | medium | config+egress (EDGAR GHA-only) | Enable code33 in GHA; surface margin-trend feature into `smr_rating_service` | **Med**: margin direction is a genuine quality signal |
| 23 | **StaticThemesPage built but unrouted; Signals/Chatbot unported** | Leading-theme context (top-down) | medium | none for themes; chatbot needs live LLM | Add `/themes` route to `StaticAppShell` + nav item (~1 hr); chatbot impossible on Pages | **Low-med**: secondary confirmation, near-zero cost |
| 24 | **Mobile sell reasoning thinner than desktop** — full SellPlanCard is `!isMobile` gated | Exit decisions should be evidence-based | medium | none (data already exported) | Reflow SellPlanCard into in-flow accordion below chart on mobile (~0.5 day) | **Low-med**: execution not blocked, gap is explanatory depth |
| 25 | **No intraday / real-time data** — EOD 1d bars, prices ~30min post-close | Buy the pivot intraday as it clears on volume | high | **egress** (vendors CI-only; no always-on host) | Intraday path only via a hosted egress-capable worker — out of scope for Pages/CI | **Moderate** (~1-3% slippage/trade); by-design for EOD swing, not a defect |
| 26 | **Pocket-pivot / power-trend never validated as FIRE triggers** | Timed in-base/continuation entries | low | none (harness supports adding a trigger) | Add as candidate FIRE triggers in `validate_trade_ideas.py`, measure discrimination | **Unknown-until-measured**; cheap, de-risks their use |
| 27 | **Vendor data refreshable only via merged GHA workflows; no ad-hoc rebuild** | Ranks/validation only as current as last CI bundle | high | **env rule** (new workflows undispatchable until merged) | Keep merged `workflow_dispatch` refreshers; scheduled rebuild + freshness alert | **Low-mod, risk-side**: 409 gate converts staleness to blocked scans, not bad trades |
| 28 | **Single-vendor (Yahoo) unadjusted-risk backtest** — no cross-vendor reconciliation | Mis-adjusted split fabricates a false signal | low | egress (2nd source also CI-only) | Add Stooq in CI, reconcile OHLCV deltas before publishing | **Low but fat-tailed**: removes rare severe data mistrades |
| 29 | **No pyramiding / position-aware add-on logic** | Add to winners as they prove | low | architectural (scan path is stateless) | Belongs in a position-mgmt layer, not the screener (SPEC backlog #4) | Zero on screening; affects compounding/mgmt |
| 30 | **Universe completeness/survivorship unverified** | Missing tickers bias RS percentiles up | medium | data+egress (authoritative listings CI-only/paid) | Per-market reconciliation vs official source (UniverseReconciliation scaffolded) + CI coverage report | **Moderate** ranking-fidelity: inflates RS/group ranks, backtest optimism |

---

## 3. Mobile PWA verdict

**Yes — for its stated job.** As a *post-close daily review and buy/sell-planning* tool the PWA is genuinely usable in the field today: it shows the market regime, trend-template leaders in leading groups, per-symbol candlestick charts with pivot/VCP/MA/RS overlays and a Triple-Barrel buy checklist, group rankings/RRG, breadth, a mobile sell-badge strip with the trailing stop price, and it installs to the home screen with iOS safe-area handling and an inline JP glossary (`StaticHomePage.jsx`, `StaticChartViewerModal.jsx`, `SignalBadges.jsx`). It is *not* an intraday execution surface (EOD static publish, ~4:06pm ET fast / ~4:10pm full) and never claims to be. The **top 3 mobile gaps**, all low-blocker and un-built: (1) **no service worker / offline** — every launch re-fetches, so a weak-signal review silently fails (Workbox over immutable daily JSON, ~1 day); (2) **no watchlist / position tracking** — the sell engine computes per-symbol but never cross-references the user's actual holdings, so a held name breaking its 50-DMA isn't surfaced against their book (localStorage watchlist, ~2-3 days); (3) **no push alerts** on a fresh pivot or a stop breach — the trader must remember to open the app. Fixing (1) and (2) has more leverage on realized returns (adherence + exits) than any signal tweak.

---

## 4. Top 5 next cycles

Ranked by leverage × low-blocker, respecting project discipline (grounded, two-window/908-gated, no fitting).

**1. Stop-hit sell branch in `compute_sell_plan`** — *Build:* top-precedence `stop_hit`/`exit` when `last_close ≤ trailing/initial_stop`, plus SellPlanCard state + urgency-0 digest mapping. *Why:* the single most fundamental Minervini rule (honor the stop) is currently unenforced — a light-volume bleed below the stop while above the 50-DMA reads "hold", letting losses exceed the 7-8% backstop; this directly caps the left tail. *Effort:* ~5 lines + UI state, <0.5 day. *Gating:* pure logic, no data needed; **browser-verify** the SellPlanCard/digest state via `sandbox-e2e` at 1440/375px. No harness change (exit-side, not a FIRE trigger), but sanity-check no regression on `docs/MINERVINI_EXIT_LEASH.md` two-window portfolio return before shipping.

**2. Breadth-confirmed market regime** — *Build:* extend `BreadthCalculatorService` to compute %>50/200-DMA and net-new-highs from the *same cached universe OHLCV*, feed a breadth-divergence penalty into `assess_market_regime` so index-at-highs + falling-breadth downgrades confirmed_uptrend→under_pressure and trims exposure. *Why:* breadth divergence is the most reliable early O'Neil top signal; the current index-only regime misses classic distribution tops and stays at 100% exposure into them — the largest drawdown-avoidance lever available. *Effort:* ~2-3 days (pure wiring/compute, zero egress). *Gating:* **must re-run the 908 harness — GATE 66.5 is frozen; any regression triggers immediate revert.** Two-window regime backtest recommended before merge; persist a regime time-series (cycle 20 dependency) to actually validate the transition timing rather than fit thresholds.

**3. Enforce the exposure ladder + regime-tiered rating cap + market sell alert** — *Build:* tier the rating cap by regime (under_pressure caps Strong Buy→Buy; correction→Watch), feed `exposure_pct` into `risk.py` sizing (replace the fixed 1.25%), and add a market-level sell trigger (dist ≥ correction + index breaks 21EMA/50DMA on volume / failed FTD) surfaced as a banner state + PushNotification. *Why:* today under_pressure@55% and confirmed@100% gate *identically* and sizing ignores regime — "trade smaller under pressure" and the post-FTD 25/50/75 pilot ramp are advice text only; combined with a top alert this is the core Minervini DD-control mechanism. *Effort:* ~2-3 days in-repo. *Gating:* re-run 908 (GATE frozen); two-window portfolio backtest via `backtest_minervini_tactics.py` to confirm the tighter under_pressure sizing doesn't lose raw return the way C73's exit relaxation did; browser-verify banner + push wiring.

**4. Offline service worker + localStorage watchlist w/ per-holding exit surfacing (mobile)** — *Build:* vite-plugin-pwa/Workbox precaching the shell and StaleWhileRevalidate-ing the daily-`run_id` JSON; a localStorage/IndexedDB watchlist and "My Positions" page pulling each flagged symbol's exported `sell_plan`/`signal`, sorting active SELL/tighten-stop first, storing entry/stop locally for R-multiple. *Why:* closes the two highest-leverage mobile gaps — daily-review adherence (offline) and same-day visibility of exits on names the user actually holds; Minervini's edge is disproportionately in exits. *Effort:* ~3-4 days combined; no backend needed. *Gating:* no harness impact (client-side); **browser-verify offline launch + watchlist persistence + exit-badge ordering** at 375px via `sandbox-e2e`. Static JSON is immutable per-publish (`staleTime:Infinity`), so caching is safe.

**5. Fundamentals-attached 908 replay to validate the rating stack** — *Build:* snapshot point-in-time cached fundamentals at each of the 908 entry dates, re-score with fundamentals attached, and measure the catch-rate edge of the +10 bonus and each rating component (mirroring `measure_accdis_discrimination.py`, which found Acc/Dis +7.6pp). *Why:* the fundamental bonus and EPS/SMR/Composite currently reorder which passers users buy first with *zero measured edge* — before investing in the 'A' 3-year fix (cycle 9) or 'I' sponsorship (cycle 10), prove the overlay earns its weight rather than fitting weights blind. *Effort:* medium; the constraint is **data** — point-in-time 2015-2020 fundamentals aren't in the cache (bundle is current-week finviz), so this needs the `ground-truth-908` CI dispatch trick to reconstruct historical fundamentals (Yahoo/finviz egress is GHA-only). *Gating:* additive to the harness (new measurement, doesn't touch frozen TT/S2/SETUP/FIRE±5/GATE); results decide whether cycles 9/10 ship — measurement first, no fitting.
---

## 5. 監査補遺（completeness-critic代替・mainループ）

synthesisが網羅する30 CANNOTに加え、ミネルヴィニ体系で**どのレンズも拾わなかった規律側の空白**を3点補う。いずれも α より「規律・継続的エッジ改善」に効く。

| # | Gap | Minervini原則 | 重要度 | Blocker | 実装方針 | 成績影響 |
|---|---|---|---|---|---|---|
| 31 | **トレード日誌/事後分析が皆無** — Positionsに約定は残るが、買/売理由・R実績・スクショ・反省の記録と集計がない | 「日誌と事後分析が上達の核」— 彼の教育の中心 | medium | なし（Positionsテーブル拡張＋localStorage） | Positionに`entry_reason/exit_reason/note/screenshot`と決済後の実現R/保有日数の集計ビュー。mobileは"My Positions"に統合 | **間接的に高**: 自分のミス分布（早売り/損切り遅れ）を可視化→行動修正。単発αでなく継続改善レバー |
| 32 | **決算持ち越しリスクの管理不在** — CANSLISは決算前Buyを止める(no pre-earnings Buy)が、保有中の決算通過（減量/回避）ガイダンスがない | 決算はギャップリスク; リーダーでも決算で減量/様子見 | medium | data（次回決算日; finviz/EDGAR=GHA） | 各保有の次回決算日を特徴量化→SellPlanに`earnings_within_Nd`警告（減量/ストップ厳格化の助言） | **Med**: 決算ギャップの左テールを縮小。頻度は低いが1件が大きい |
| 33 | **"チート/ローチート"早仕掛けピボットが未検証** — Setup Engineに近い型はあるが、ハンドル内の早期ピボットを独立エントリーとして未計測 | ベース内の早仕掛けで平均コストを下げRを改善 | low-med | なし（908 harnessに候補追加可） | `validate_trade_ideas.py`にチート・ピボット候補を足し判別計測（pocket-pivot #26と同枠） | **測るまで不明**: 安く仕掛けRを改善しうるが早すぎブレイク失敗も。計測先行 |

**監査総括**: 買い側（発見）は忠実・広くカバー、`FIRE±5 91.7`まで検証済み。**最大の空白は「執行の規律」側** — (a)ストップ・ヒットの売りアクション化(§4 #1)、(b)ブレッドス連動レジーム(§4 #2)、(c)エクスポージャー梯子の実効化(§4 #3)、(d)mobileのオフライン+保有連動の売り可視化(§4 #4)。いずれも**データ/egressブロッカー無し**で、ミネルヴィニが「口座を守るのは執行」と説く核心。α追加より先にここを埋めるのが最大レバー。fundamentalスタックは**未検証(§4 #5)**＝重み付けを盲目的に足す前に908で測る。
