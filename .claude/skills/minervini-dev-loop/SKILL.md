---
name: minervini-dev-loop
description: The improvement-cycle discipline for the Minervini screener — frozen validation metrics, red lines, the 908-trade ground-truth harness, and the PROGRESS.md protocol. Use when continuing screener development (any model/session), starting an improvement cycle, or asking "what do I measure and where do I record it".
---

# Minervini screener — improvement loop protocol

State lives in **docs/PROGRESS.md** (cycle log + current metric values) and
**docs/SPEC.md** (canonical spec, fidelity table, frozen validation contract).
Read both FIRST; a fresh session can restore everything from them.

## The cycle (1 concern = 1 commit)

1. Pick the highest-impact incomplete item (PROGRESS.md keeps a prioritized queue at the end).
2. Implement + pin with tests.
3. **Red line** (never skip, revert immediately on any drop):
   ```bash
   cd backend
   DATABASE_URL="postgresql://local/none" python3 -m pytest \
     tests/unit/scanners tests/unit/services tests/unit/golden \
     tests/unit/test_scan_orchestrator.py \
     --ignore=tests/unit/golden/test_mcp_market_copilot.py -q
   cd .. && DATABASE_URL="postgresql://local/none" make gate-5   # golden 43
   ```
   Frontend when touched: `cd frontend && npx vitest run <area> && npm run lint`
   (Node via `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`; vitest MUST
   run from frontend/ or `describe is not defined`).
4. Measure the frozen metrics (below) when the change touches scanner/band/regime logic.
5. Append the cycle to docs/PROGRESS.md: date, change, numbers, next, unresolved.
6. Commit (Conventional Commits) + push. Report 3 lines: 変更点 / 検証数値 / 次.

## Frozen metrics — never add/repoint metrics to fake an improvement

| metric | command | notes |
|---|---|---|
| 908-trade ground truth | `cd backend && DATABASE_URL="postgresql://local/none" python3 scripts/validate_trade_ideas.py` | Columns COV/TT/S2/SETUP/RS70/FIRE±5/MSCORE/GATE + CONTROL row (T0−63). Truth = entry−control DISCRIMINATION, not raw hit rate (an always-on signal games hit rate, not the delta). ~7 min. Needs `backend/calibration/trade_idea_windows/` (see ground-truth-908 skill). |
| Band right-edge agreement | `python3 scripts/markets360_band_rightedge_eval.py` (PYTHONPATH=.) | 12 tickers vs real MM360 screenshots. Floor: P 82% / BR 92% / TPR 100% — never lower. |
| Golden regression | `make gate-5` | 43 passed = floor. |
| Forward returns | `scripts/validate_forward_returns.py` | cohort×quartile, T+1/5/21; flags, never auto-retunes. |

Full-strip band agreement (LLY harness) uses screenshot-APPROXIMATED prices —
noisy ground truth; do not calibrate against it directly. Correct approach:
compare flip-rate / dwell-time statistics vs the REAL strips (see PROGRESS C19).

## Theory guardrails (primary source)

- Trend Template = the published 8 conditions EXACTLY (`passes_template`).
  "Stage 2" is the label the 8 jointly define, never a 9th veto (C6: the
  regression-slope veto rejected 8pp of Minervini's own entries).
- SEPA rule 1 (trade WITH the market) gates RATINGS at three layers:
  markets360 `buyable_now`, MinerviniScanner rating, and the orchestrator's
  FINAL rating. Setups (`passes*`) stay market-independent.
- FTD (follow-through day) lifts correction→confirmed_uptrend weeks before
  MAs recover; exposure ladders 25→50→75→100 (progressive exposure).
- Pivot states require detected VCP structure + chase limit +5% past pivot.
- Code 33 = 3 quarters of accelerating EPS+sales+margins
  (`services/sec_edgar_financials.py`) — NOT the CANSLIM earnings blackout.

## Environment truths

- App sandbox blocks ALL market-data vendors (yfinance/stooq 403). GitHub raw
  is open. NEVER bypass the egress proxy.
- Yahoo egress exists ONLY in GitHub Actions — see the ground-truth-908 skill
  for the CI dispatch trick.
- Missing deps cause pytest collection errors (celery/httpx etc.) — install
  with pip or `--ignore` the affected files; 37 backend failures are
  pre-existing from main.
