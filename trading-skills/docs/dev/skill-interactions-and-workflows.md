# Skill Interaction Patterns & Multi-Skill Workflows (moved from CLAUDE.md)

## Skill Interaction Patterns

### Chart Analysis Skills (Sector Analyst, Breadth Chart Analyst, Technical Analyst)

These skills expect image inputs:
- User provides chart screenshots
- Skill analyzes visual patterns
- Output includes scenario-based probability assessments
- Analysis follows specific frameworks documented in `references/`

**Workflow:**
1. User uploads chart image
2. Skill loads relevant reference framework
3. Analysis generates structured markdown report
4. Report saved to `reports/` directory

### News Analysis Skills (Market News Analyst)

This skill uses automated data collection:
- Executes WebSearch/WebFetch queries to gather news
- Focuses on past 10 days of market-moving events
- Applies impact scoring framework: (Price Impact × Breadth) × Forward Significance
- Ranks events by quantitative score

**Key References:**
- `trusted_news_sources.md`: Source credibility tiers
- `market_event_patterns.md`: Historical reaction patterns
- `geopolitical_commodity_correlations.md`: Event-commodity relationships

### Calendar Skills (Economic Calendar Fetcher, Earnings Calendar)

⚠️ **API Requirement:** These skills require FMP API key to function.

These skills fetch future events via FMP API:
- Execute Python scripts to call FMP API endpoints
- Parse JSON responses
- Generate chronological markdown reports
- Include impact assessment (High/Medium/Low)
- Free tier (250 calls/day) is sufficient for most users

**Output Pattern:**
```markdown
# Economic Calendar
**Period:** YYYY-MM-DD to YYYY-MM-DD
**High Impact Events:** X

## YYYY-MM-DD - Day of Week
### Event Name (Impact Level)
- Country: XX (Currency)
- Time: HH:MM UTC
- Previous: Value
- Estimate: Value
**Market Implications:** Analysis...
```

## Multi-Skill Workflows

> **Canonical source:** `workflows/*.yaml` is the authoritative definition of multi-skill workflows for the Core + Satellite primary user. The prose examples below are quickstart sketches only — if any block here disagrees with a manifest in `workflows/`, the YAML is correct. See [`workflows/README.md`](workflows/README.md) for the manifest schema and `docs/dev/metadata-and-workflow-schema.md` for the full validator rules.

### Canonical workflows (PR2)

| Workflow | Cadence | Required skills |
|---|---|---|
| [`market-regime-daily`](workflows/market-regime-daily.yaml) | daily | market-breadth-analyzer, uptrend-analyzer, exposure-coach |
| [`core-portfolio-weekly`](workflows/core-portfolio-weekly.yaml) | weekly | portfolio-manager, trader-memory-core |
| [`swing-opportunity-daily`](workflows/swing-opportunity-daily.yaml) | daily | vcp-screener, technical-analyst, position-sizer, trader-memory-core |
| [`trade-memory-loop`](workflows/trade-memory-loop.yaml) | per closed trade | trader-memory-core, signal-postmortem |
| [`monthly-performance-review`](workflows/monthly-performance-review.yaml) | monthly | trader-memory-core, signal-postmortem |

### Quickstart prose examples (NOT canonical)

The blocks below are informal sketches kept for skills not yet covered by a YAML manifest. They are quickstart help, not contracts. When in doubt, defer to the YAML manifests above.

**Daily Market Monitoring:**
1. Economic Calendar Fetcher → Check today's events
2. Earnings Calendar → Identify reporting companies
3. Market News Analyst → Review overnight developments
4. Breadth Chart Analyst → Assess market health

**Weekly Strategy Review:**
1. Sector Analyst → Identify rotation patterns
2. Technical Analyst → Confirm trends
3. Market Environment Analysis → Macro briefing
4. US Market Bubble Detector → Risk assessment

**Individual Stock Research:**
1. US Stock Analysis → Fundamental/technical review
2. Earnings Calendar → Check earnings dates
3. Market News Analyst → Recent news
4. Backtest Expert → Validate entry/exit strategy

**Options Strategy Development:**
1. Options Strategy Advisor → Simulate and compare strategies
2. Technical Analyst → Identify optimal entry timing
3. Earnings Calendar → Plan earnings-based strategies
4. US Stock Analysis → Validate fundamental thesis

**Portfolio Review & Rebalancing:**
1. Portfolio Manager → Fetch holdings via Alpaca MCP
2. Review asset allocation and risk metrics
3. Market Environment Analysis → Assess macro conditions
4. Execute rebalancing plan with buy/sell actions
> The canonical version of this routine is [`core-portfolio-weekly.yaml`](workflows/core-portfolio-weekly.yaml).

**Earnings Momentum Trading:**
1. Earnings Trade Analyzer → Score recent earnings reactions (5-factor: gap, trend, volume, MA200, MA50)
2. PEAD Screener (Mode B) → Feed analyzer output, screen for red candle pullback → breakout patterns
3. Technical Analyst → Confirm weekly chart setups on SIGNAL_READY/BREAKOUT candidates
4. Monitor BREAKOUT entries with stop-loss (red candle low) and 2R profit targets

**Statistical Arbitrage:**
1. Pair Trade Screener → Identify cointegrated pairs
2. Technical Analyst → Confirm setups for both legs
3. Monitor z-score signals and spread convergence
4. Manage market-neutral positions

**Income Portfolio Construction:**
1. Value Dividend Screener → High-yield opportunities
2. Dividend Growth Pullback Screener → Growth stocks at pullbacks
3. US Stock Analysis → Deep-dive analysis
4. Portfolio Manager → Monitor and rebalance holdings

**Trade Execution Planning:**
1. Screener skills (VCP, CANSLIM, Dividend, Earnings) → Identify candidates
2. Position Sizer → Calculate risk-based share count with portfolio constraints
3. Data Quality Checker → Validate analysis document before publishing
4. Portfolio Manager → Execute and monitor positions

**Kanchi Dividend Workflow (US stocks):**
1. kanchi-dividend-sop → Run Kanchi 5-step screening and pullback entry planning
2. kanchi-dividend-review-monitor → Execute T1-T5 anomaly detection and review queueing
3. kanchi-dividend-us-tax-accounting → Validate qualified/ordinary assumptions and account location
4. Feed REVIEW findings back to kanchi-dividend-sop before any additional buys

**Edge Research Pipeline (end-to-end):**
1. edge-candidate-agent (--ohlcv) → market_summary.json + anomalies.json + tickets/
2. edge-hint-extractor (--market-summary, --anomalies) → hints.yaml
3. edge-concept-synthesizer (--tickets-dir, --hints) → edge_concepts.yaml
4. edge-strategy-designer (--concepts) → strategy_drafts/*.yaml
5. edge-strategy-reviewer (--drafts-dir) → review.yaml (PASS/REVISE/REJECT)
6. [REVISE] → revision → re-review (max 2 cycles)
7. [PASS + export eligible] → edge-candidate-agent export → strategy.yaml + metadata.json
- **Orchestrated mode:** edge-pipeline-orchestrator runs all stages automatically with feedback loop

**Thesis-Driven Trading Pipeline:**
1. Screener skills (kanchi, earnings-trade-analyzer, vcp, pead, canslim) → Generate candidates
2. Trader Memory Core (register) → `thesis_ingest.py --source <skill> --input <report>` creates IDEA thesis
3. US Stock Analysis / Technical Analyst → Deep-dive validation, link report via `link_report()`
4. Trader Memory Core (transition) → IDEA → ENTRY_READY → ACTIVE with `transition()`
5. Position Sizer → Calculate risk-based sizing, attach via `attach_position()`
6. Portfolio Manager → Execute entry, update thesis with actual price/date
7. Trader Memory Core (review) → `list_review_due()` for periodic checks
8. Trader Memory Core (close + postmortem) → Record exit, generate journal entry with MAE/MFE

**Parabolic Short Pipeline (Phase 1 + Phase 2 + Phase 3):**
1. `screen_parabolic.py` (Phase 1) → daily watchlist JSON; 5-factor weighted score (MA Extension 30 / Acceleration 25 / Volume Climax 20 / Range Expansion 15 / Liquidity 10) → A/B/C/D grade. Hard-rejects via `invalidation_rules` (mode-aware), then attaches `state_caps` / `warnings`. `--dry-run --fixture` for offline pipeline verification.
2. Review the `reports/parabolic_short_<date>.md` watchlist and decide which candidates to promote (A/B by default).
3. `generate_pre_market_plan.py` (Phase 2) → reads Phase 1 JSON, filters by `--tradable-min-grade B`, looks up Alpaca short inventory (or `ManualBrokerAdapter` when env vars missing), inherits `prior_close` for SSR Rule 201 evaluation, splits manual-confirmation reasons into blocking vs advisory, and emits three trigger plans per candidate (5-min ORL break, first red 5-min, VWAP fail).
4. Trader confirms `blocking_manual_reasons` are cleared at the broker (HTB locate, premarket high/low resolved, etc.).
5. `monitor_intraday_trigger.py` (Phase 3) → reads the Phase 2 plan, fetches 5-min bars (Alpaca live or fixture), walks each plan's FSM forward by one step (per-trigger evaluator: ORL break, first red, VWAP fail), and writes `parabolic_short_intraday_<date>.json` with `state` (armed/triggered/invalidated/...), bar-derived transition timestamps, and `size_recipe_resolved.shares_actual` when triggered. One-shot — wrap in `watch -n 60 'python3 ...'` or 5-min cron during market hours. Replay-deterministic: re-runs against the same `--now-et` produce byte-identical output.
6. Optional: `trader-memory-core` `thesis_ingest.py --source parabolic-short-trade-planner --input reports/parabolic_short_plan_<date>.json` to register theses for postmortem tracking.

