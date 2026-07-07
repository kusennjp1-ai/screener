---
name: ground-truth-908
description: Run or refresh the 908-Minervini-trade ground-truth validation — offline replay from the committed OHLCV bundle, or rebuild the bundle via the CI dispatch trick (Yahoo egress exists only in GitHub Actions). Use when measuring screener changes against Minervini's real entries or when the bundle/report is missing or stale.
---

# 908-trade ground-truth validation

Ground truth: `data/minervini_trade_ideas.csv` — 908 published Minervini trade
ideas (1997-2022, 696 tickers; 1998-2009 missing, 2022 has 1 row). A faithful
SEPA screener should clear TT/S2/SETUP on most of them AND show positive
entry−control discrimination on the timing metrics.

## Offline run (sandbox-safe, ~7 min)

```bash
cd backend
DATABASE_URL="postgresql://local/none" python3 scripts/validate_trade_ideas.py \
  [--json report.json] [--since-year 2015] [--limit 100] [--fixtures]
```

- Reads `backend/calibration/trade_idea_windows/{TICKER}.csv.gz` + `_SPY.csv.gz`
  (committed by CI; ~8.6MB, 476 tickers fetchable of 696 — delisted ones fail).
- Zero look-ahead (evaluation truncated at T0; pinned by
  `tests/unit/services/test_validate_trade_ideas_harness.py`).
- `--fixtures` = mechanics smoke on tests/fixtures/markets360 (NOT truth) —
  doubles as the false-fire control base rate.
- CONTROL row = same stock at T0−63 bars. Report the DISCRIMINATION line;
  raw hit rates alone are gameable.

Reference numbers (2026-07): TT 69.7 / S2 90.0 / SETUP 78.6 / FIRE±5 88.6 /
GATE 45.1; discrimination SETUP +52.0pp, FIRE±5 +24.4pp, TT +30.5pp.
docs/PROGRESS.md's metric table is the source of truth for the latest.

## Rebuilding the bundle (CI dispatch trick)

Yahoo egress exists ONLY in GitHub Actions. `workflow_dispatch` resolves the
workflow by its ID registered on the DEFAULT branch, but executes the FILE AS
IT EXISTS ON THE DISPATCHED REF — so branch-side edits to a registered
workflow are dispatchable, while brand-new workflow files on a branch are NOT.

The bundle job rides in the registered `backtest.yml`:

```
dispatch backtest.yml on your branch with inputs:
  build_bundle: "true"     # fetch 908 windows + run the harness
  bundle_sleep: "0.8"      # seconds between Yahoo downloads
```

The job fetches T−460..T+130d windows per ticker, runs the frozen harness,
publishes the table to the job summary, and COMMITS the bundle + report back
to the branch (`git pull` afterwards). Same dispatch also runs the original
catch-rate backtest job.

Related CI-only validators (all workflow_dispatch): `minervini-validate.yml`
(per-ticker TT+Code33 scorecard), `vcp-calibration.yml` (VCP recall on the
908), `code33-check.yml --from-trade-ideas` (EDGAR Code 33 pass rates).

`code33-check.yml` with `as_of_idea_dates=true` measures the POINT-IN-TIME
Code 33 catch rate: each idea evaluated on filings filed <= its idea date
(compute_code33_from_facts(as_of=...)), against a 1-year-earlier same-stock
control — report the discrimination, not the raw rate. XBRL starts ~2009-2011,
so pre-2010 ideas are mostly not evaluable (reported honestly in the summary).
