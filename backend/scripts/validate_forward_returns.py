#!/usr/bin/env python3
"""Forward-return validation — does what the screener flags actually beat SPY?

Minervini: *"price action is the ultimate truth."* A screen that surfaces names
but never measures whether its "Strong Buy" cohort outperforms the market is
flying blind. This harness closes that loop and is the **keystone** the audit
roadmap calls for: every calibration question (RS weights, execution-state caps,
quality thresholds) is unanswerable without it, so it is built first and the
constants are left untouched until it can speak.

For each flagged name at an as-of date it computes the forward return at
T+1/T+5/T+21 and the SPY forward return over the *same* window, then the EXCESS
(stock − SPY). Cohorts are stratified by rating tier × composite-score quartile,
and each cohort is scored: n, mean excess, win-rate, Sharpe, max-drawdown, and a
one-sample t-test of excess-vs-0 (does it beat SPY with significance?). A review
alert fires when a Strong Buy / Buy cohort underperforms SPY by >2% with a
sub-50% win rate.

It NEVER auto-retunes thresholds — it flags for manual review. Run quarterly on a
rolling window in production; the ``main`` demo exercises it on the local OHLCV
fixtures using the real Markets 360 scanner for ratings.

  PYTHONPATH=. python3 scripts/validate_forward_returns.py
"""
from __future__ import annotations

import math
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

HORIZONS = (1, 5, 21)
RATING_TIERS = ("Strong Buy", "Buy", "Watch", "Pass")
QUARTILES = ("Q1", "Q2", "Q3", "Q4")


# --------------------------------------------------------------------------- #
# Pure stats / logic (import-and-test without any data source)
# --------------------------------------------------------------------------- #
def forward_return(price_df: pd.DataFrame, as_of: pd.Timestamp, horizon: int) -> Optional[float]:
    """% close-to-close return from the bar at/just before ``as_of`` to ``horizon``
    bars later. ``None`` when there isn't enough future data (no look-ahead)."""
    if price_df is None or "Close" not in price_df.columns:
        return None
    hist = price_df[price_df.index <= as_of]
    fut = price_df[price_df.index > as_of]
    if len(hist) == 0 or len(fut) < horizon:
        return None
    c0 = float(hist["Close"].iloc[-1])
    if c0 <= 0:
        return None
    cN = float(fut["Close"].iloc[horizon - 1])
    return (cN / c0 - 1.0) * 100.0


def max_drawdown(returns: Sequence[float]) -> float:
    """Max peak-to-trough drawdown (%) of the equity curve formed by compounding
    ``returns`` (each a per-trade % return) in order. Treating the returns as the
    curve itself is wrong — a +0.5% peak next to a −5% trade yields a nonsense
    −1100%; compounding into an equity curve keeps it bounded to ≥ −100%. 0 for
    empty."""
    arr = np.asarray([r for r in returns if r is not None and np.isfinite(r)], dtype="float64")
    if arr.size == 0:
        return 0.0
    equity = np.cumprod(1.0 + arr / 100.0)
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / peak * 100.0
    return round(float(dd.min()), 2)


def welch_one_sample_t(sample: Sequence[float], popmean: float = 0.0) -> Tuple[Optional[float], Optional[float]]:
    """One-sample t-statistic of ``sample`` vs ``popmean`` and a 2-sided p-value
    (normal approximation — scipy-free). Returns ``(None, None)`` when n < 2 or
    the sample has no variance."""
    a = np.asarray([x for x in sample if x is not None and np.isfinite(x)], dtype="float64")
    n = a.size
    if n < 2:
        return (None, None)
    sd = float(a.std(ddof=1))
    if sd == 0.0:
        return (None, None)
    t = (float(a.mean()) - popmean) / (sd / math.sqrt(n))
    # 2-sided p via the standard normal CDF (good for n>~20; approximate else).
    p = 2.0 * (1.0 - 0.5 * (1.0 + math.erf(abs(t) / math.sqrt(2.0))))
    return (round(t, 3), round(p, 4))


def sharpe(returns: Sequence[float]) -> Optional[float]:
    """Mean/std of the return sample (per-trade Sharpe proxy). None if n<2 or flat."""
    a = np.asarray([x for x in returns if x is not None and np.isfinite(x)], dtype="float64")
    if a.size < 2:
        return None
    sd = float(a.std(ddof=1))
    if sd == 0.0:
        return None
    return round(float(a.mean()) / sd, 3)


def quartile_edges(scores: Sequence[float]) -> Tuple[float, float, float]:
    """The 25/50/75th percentiles of composite scores → quartile boundaries."""
    a = np.asarray([s for s in scores if s is not None and np.isfinite(s)], dtype="float64")
    if a.size == 0:
        return (25.0, 50.0, 75.0)
    return (float(np.percentile(a, 25)), float(np.percentile(a, 50)), float(np.percentile(a, 75)))


def quartile_label(score: Optional[float], edges: Tuple[float, float, float]) -> Optional[str]:
    """Map a composite score to Q1 (lowest) .. Q4 (highest) given the edges."""
    if score is None or not np.isfinite(score):
        return None
    q25, q50, q75 = edges
    if score < q25:
        return "Q1"
    if score < q50:
        return "Q2"
    if score < q75:
        return "Q3"
    return "Q4"


def cohort_metrics(excess: Sequence[float], raw: Sequence[float]) -> Dict[str, object]:
    """Score one cohort from its excess-vs-SPY returns and raw stock returns."""
    ex = [x for x in excess if x is not None and np.isfinite(x)]
    rw = [x for x in raw if x is not None and np.isfinite(x)]
    n = len(ex)
    if n == 0:
        return {"n": 0, "mean_excess": None, "win_rate": None, "sharpe": None,
                "max_dd": None, "t_stat": None, "p_value": None, "mean_raw": None}
    t, p = welch_one_sample_t(ex, 0.0)
    arr = np.asarray(ex, dtype="float64")
    return {
        "n": n,
        "mean_excess": round(float(arr.mean()), 2),
        "win_rate": round(100.0 * float((arr > 0).mean()), 1),
        "sharpe": sharpe(rw),
        "max_dd": max_drawdown(rw),
        "t_stat": t,
        "p_value": p,
        "mean_raw": round(float(np.mean(rw)), 2) if rw else None,
    }


@dataclass(frozen=True)
class Trade:
    symbol: str
    as_of: pd.Timestamp
    rating: str
    composite_score: float


def build_scorecard(
    trades: Sequence[Trade],
    price_lookup: Callable[[str], Optional[pd.DataFrame]],
    benchmark_df: pd.DataFrame,
    horizon: int,
) -> Dict[str, object]:
    """Compute the rating×quartile cohort matrix at one horizon.

    For each trade: stock fwd return and SPY fwd return over the same window →
    excess. Group by (rating tier, score quartile) and score each cohort. Also
    reports the overall baseline (every flagged trade) for an edge readout.
    """
    edges = quartile_edges([t.composite_score for t in trades])
    cells: Dict[Tuple[str, str], Dict[str, List[float]]] = {}
    base_excess: List[float] = []
    base_raw: List[float] = []

    for t in trades:
        df = price_lookup(t.symbol)
        if df is None:
            continue
        sr = forward_return(df, t.as_of, horizon)
        br = forward_return(benchmark_df, t.as_of, horizon)
        if sr is None or br is None:
            continue
        ex = sr - br
        q = quartile_label(t.composite_score, edges)
        tier = t.rating if t.rating in RATING_TIERS else "Pass"
        key = (tier, q or "Q1")
        cell = cells.setdefault(key, {"excess": [], "raw": []})
        cell["excess"].append(ex)
        cell["raw"].append(sr)
        base_excess.append(ex)
        base_raw.append(sr)

    matrix = {
        f"{tier}|{q}": cohort_metrics(c["excess"], c["raw"])
        for (tier, q), c in sorted(cells.items())
    }
    return {
        "horizon": horizon,
        "quartile_edges": [round(e, 2) for e in edges],
        "baseline": cohort_metrics(base_excess, base_raw),
        "cohorts": matrix,
    }


def review_alerts(scorecard: Dict[str, object]) -> List[str]:
    """Flag Strong Buy / Buy cohorts that lag SPY by >2% with a sub-50% win rate.
    Both conditions required (avoids noise on tiny samples)."""
    alerts: List[str] = []
    for key, m in scorecard.get("cohorts", {}).items():
        tier = key.split("|", 1)[0]
        if tier not in ("Strong Buy", "Buy"):
            continue
        if m["n"] < 5 or m["mean_excess"] is None or m["win_rate"] is None:
            continue
        if m["mean_excess"] < -2.0 and m["win_rate"] < 50.0:
            alerts.append(
                f"H{scorecard['horizon']} {key}: mean excess {m['mean_excess']:+.1f}% "
                f"vs SPY, win {m['win_rate']:.0f}% (n={m['n']}) — REVIEW"
            )
    return alerts


def render_markdown(scorecards: Sequence[Dict[str, object]]) -> str:
    """Render the per-horizon cohort matrices + baselines as a markdown report."""
    lines: List[str] = ["# Forward-return validation\n"]
    for sc in scorecards:
        h = sc["horizon"]
        b = sc["baseline"]
        lines.append(f"## Horizon T+{h}  (quartile edges {sc['quartile_edges']})\n")
        lines.append(
            f"- BASELINE (all flagged): n={b['n']} mean-excess={_fmt(b['mean_excess'])}% "
            f"win={_fmt(b['win_rate'])}% sharpe={_fmt(b['sharpe'])} t={_fmt(b['t_stat'])}\n"
        )
        lines.append("| cohort | n | mean excess % | win % | sharpe | maxDD % | t | p |")
        lines.append("|---|--:|--:|--:|--:|--:|--:|--:|")
        for key, m in sc["cohorts"].items():
            lines.append(
                f"| {key} | {m['n']} | {_fmt(m['mean_excess'])} | {_fmt(m['win_rate'])} | "
                f"{_fmt(m['sharpe'])} | {_fmt(m['max_dd'])} | {_fmt(m['t_stat'])} | {_fmt(m['p_value'])} |"
            )
        for a in review_alerts(sc):
            lines.append(f"\n> ⚠️ {a}")
        lines.append("")
    return "\n".join(lines)


def _fmt(v: object) -> str:
    return "—" if v is None else (f"{v:+.2f}" if isinstance(v, float) else str(v))


# --------------------------------------------------------------------------- #
# CLI demo on fixtures (uses the real Markets 360 scanner for ratings)
# --------------------------------------------------------------------------- #
def _fixture_demo() -> int:
    pkg = "app.scanners"
    if pkg not in sys.modules:
        stub = types.ModuleType(pkg)
        stub.__path__ = [str(Path(__file__).resolve().parents[1] / "app" / "scanners")]
        sys.modules[pkg] = stub
    import importlib

    base = importlib.import_module("app.scanners.base_screener")
    scanner_mod = importlib.import_module("app.scanners.markets360_scanner")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from markets360_band_calibration import _read_csv  # noqa: E402

    fix = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "markets360"
    symbols = [p.stem for p in sorted(fix.glob("*.csv")) if p.stem != "spy"]
    data = {s: _read_csv(str(fix / f"{s}.csv")) for s in symbols}
    spy = _read_csv(str(fix / "spy.csv"))
    scanner = scanner_mod.Markets360Scanner()
    StockData = base.StockData

    dates = spy.index
    lo, hi = 230, len(dates) - max(HORIZONS) - 1
    asof_dates = [dates[i] for i in np.linspace(lo, hi, 6).astype(int)]

    price_lookup = lambda s: data.get(s)  # noqa: E731
    trades: List[Trade] = []
    for as_of in asof_dates:
        spy_hist = spy[spy.index <= as_of]
        for s, df in data.items():
            hist = df[df.index <= as_of]
            if len(hist) < 210:
                continue
            res = scanner.scan_stock(s.upper(), StockData(
                symbol=s.upper(), price_data=hist, benchmark_data=spy_hist, market="US"))
            trades.append(Trade(s, as_of, res.rating, float(res.score)))

    scorecards = [build_scorecard(trades, price_lookup, spy, h) for h in HORIZONS]
    print(render_markdown(scorecards))
    print("\n  CAVEAT: the 12-name fixture set is hand-picked to stress the color")
    print("  bands, NOT a representative universe — these numbers are illustrative.")
    print("  In production, point build_scorecard() at real screener output + history.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_fixture_demo())
