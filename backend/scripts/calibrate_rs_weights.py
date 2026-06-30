#!/usr/bin/env python3
"""W3.2 — data-driven calibration of the relative-strength recency weights.

The RS rating weights its lookbacks 40/20/20/20 (recent quarter heaviest). Whether
that *actually* predicts forward outperformance is the empirical question the audit
flagged — to be answered with forward returns on the real universe, NOT by
intuition (overfit risk). This runner does exactly that:

  1. Resolve a universe (production: US ex-ETF from the DB; offline: fixtures).
  2. Walk forward over as-of dates. At each, rank every name by a candidate
     weight config's recency-weighted relative outperformance vs SPY, flag the
     top quantile (the "RS leaders" that config would surface), and record their
     forward excess return (stock − SPY) at T+1/T+5/T+21.
  3. Score each config: mean excess, win-rate, Sharpe, and a one-sample t-test
     (does its leader cohort beat SPY with significance?).
  4. Apply a CONSERVATIVE decision rule: keep the baseline unless a challenger
     beats it by a clear margin on Sharpe AND win-rate, consistently across
     horizons. Never auto-edit the constant — emit a recommendation + the stats.

Production run (full US universe ex-ETF, from the DB):
    PYTHONPATH=. python3 scripts/calibrate_rs_weights.py --source db --top-frac 0.30
Offline smoke (fixtures as a stand-in universe):
    PYTHONPATH=. python3 scripts/calibrate_rs_weights.py --source fixtures
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_forward_returns import (  # noqa: E402
    cohort_metrics,
    forward_return,
)

HORIZONS = (1, 5, 21)

# Candidate recency-weight configs: {lookback_days: weight}. Baseline first.
CONFIGS: Dict[str, Tuple[Tuple[int, float], ...]] = {
    "baseline_40_20_20_20": ((63, 0.40), (126, 0.20), (189, 0.20), (252, 0.20)),
    "recency_50_25_15_10": ((63, 0.50), (126, 0.25), (189, 0.15), (252, 0.10)),
    "recency_heavy_60_20_10_10": ((63, 0.60), (126, 0.20), (189, 0.10), (252, 0.10)),
    "flat_30_30_20_20": ((63, 0.30), (126, 0.30), (189, 0.20), (252, 0.20)),
    "equal_25": ((63, 0.25), (126, 0.25), (189, 0.25), (252, 0.25)),
}
BASELINE = "baseline_40_20_20_20"


# --------------------------------------------------------------------------- #
# Pure scoring / decision logic (unit-tested)
# --------------------------------------------------------------------------- #
def _ret_to(close: pd.Series, as_of: pd.Timestamp, lookback: int) -> Optional[float]:
    """Trailing % return over ``lookback`` bars ending at/just before ``as_of``."""
    hist = close[close.index <= as_of]
    if len(hist) <= lookback:
        return None
    now = float(hist.iloc[-1])
    then = float(hist.iloc[-1 - lookback])
    if then <= 0:
        return None
    return (now / then - 1.0) * 100.0


def rs_score(
    close: pd.Series,
    bench: pd.Series,
    as_of: pd.Timestamp,
    weights: Sequence[Tuple[int, float]],
) -> Optional[float]:
    """Recency-weighted relative outperformance (stock − bench) up to ``as_of``.

    This is exactly the driver inside ``ratings.compute_rpr`` before the display
    curve — the quantity a given weight config ranks names by. None when no
    lookback has data."""
    num = 0.0
    den = 0.0
    for lookback, w in weights:
        sr = _ret_to(close, as_of, lookback)
        br = _ret_to(bench, as_of, lookback)
        if sr is None or br is None:
            continue
        num += (sr - br) * w
        den += w
    return num / den if den > 0 else None


def flag_leaders(scores: Dict[str, float], top_frac: float) -> List[str]:
    """The top ``top_frac`` of symbols by score — the RS leaders a config surfaces."""
    ranked = sorted(((s, sym) for sym, s in scores.items() if s is not None), reverse=True)
    if not ranked:
        return []
    k = max(1, int(round(len(ranked) * top_frac)))
    return [sym for _, sym in ranked[:k]]


def decide(
    config_metrics: Dict[str, Dict[int, Dict[str, object]]],
    baseline: str = BASELINE,
    min_sharpe_gain: float = 0.15,
    min_winrate_gain: float = 5.0,
    min_n: int = 30,
) -> Dict[str, object]:
    """Conservative pick: keep the baseline unless a challenger beats it on BOTH
    Sharpe and win-rate by the margins, on a MAJORITY of horizons with enough n.
    Returns {recommended, rationale, beaten_horizons}."""
    base = config_metrics.get(baseline, {})

    def _beats(cand: Dict[int, Dict[str, object]]) -> List[int]:
        wins = []
        for h in HORIZONS:
            b = base.get(h, {})
            c = cand.get(h, {})
            if not b or not c or (c.get("n") or 0) < min_n or (b.get("n") or 0) < min_n:
                continue
            bs, cs = b.get("sharpe"), c.get("sharpe")
            bw, cw = b.get("win_rate"), c.get("win_rate")
            if None in (bs, cs, bw, cw):
                continue
            if (cs - bs) >= min_sharpe_gain and (cw - bw) >= min_winrate_gain:
                wins.append(h)
        return wins

    best = baseline
    best_wins: List[int] = []
    for name, cand in config_metrics.items():
        if name == baseline:
            continue
        wins = _beats(cand)
        if len(wins) > len(best_wins) and len(wins) >= 2:  # majority of 3 horizons
            best, best_wins = name, wins

    if best == baseline:
        return {
            "recommended": baseline,
            "rationale": "No challenger beat the baseline on Sharpe AND win-rate "
                         "across a majority of horizons (with sufficient n) — keep "
                         "the baseline (avoid overfitting).",
            "beaten_horizons": [],
        }
    return {
        "recommended": best,
        "rationale": f"{best} beat the baseline on Sharpe (+{min_sharpe_gain}) AND "
                     f"win-rate (+{min_winrate_gain}%) on horizons {best_wins}.",
        "beaten_horizons": best_wins,
    }


def evaluate_config(
    weights: Sequence[Tuple[int, float]],
    data: Dict[str, pd.DataFrame],
    spy: pd.DataFrame,
    asof_dates: Sequence[pd.Timestamp],
    top_frac: float,
) -> Dict[int, Dict[str, object]]:
    """Per-horizon cohort metrics for the leaders this weight config flags."""
    spy_close = spy["Close"]
    per_h: Dict[int, Dict[str, List[float]]] = {h: {"excess": [], "raw": []} for h in HORIZONS}
    for as_of in asof_dates:
        scores = {
            sym: rs_score(df["Close"], spy_close, as_of, weights)
            for sym, df in data.items()
        }
        leaders = flag_leaders(scores, top_frac)
        for sym in leaders:
            for h in HORIZONS:
                sr = forward_return(data[sym], as_of, h)
                br = forward_return(spy, as_of, h)
                if sr is None or br is None:
                    continue
                per_h[h]["excess"].append(sr - br)
                per_h[h]["raw"].append(sr)
    return {h: cohort_metrics(per_h[h]["excess"], per_h[h]["raw"]) for h in HORIZONS}


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
def render(config_metrics: Dict[str, Dict[int, Dict[str, object]]], decision: Dict[str, object],
           universe_n: int, asof_n: int, top_frac: float) -> str:
    lines = ["# W3.2 — RS recency-weight calibration\n",
             f"Universe: {universe_n} names · {asof_n} as-of dates · top {top_frac:.0%} flagged as leaders\n"]
    for h in HORIZONS:
        lines.append(f"## Horizon T+{h}")
        lines.append("| config | n | mean excess % | win % | sharpe | t | p |")
        lines.append("|---|--:|--:|--:|--:|--:|--:|")
        for name, m in config_metrics.items():
            c = m.get(h, {})
            star = " ⭐" if name == decision["recommended"] else ""
            lines.append(
                f"| {name}{star} | {c.get('n')} | {_f(c.get('mean_excess'))} | "
                f"{_f(c.get('win_rate'))} | {_f(c.get('sharpe'))} | {_f(c.get('t_stat'))} | {_f(c.get('p_value'))} |"
            )
        lines.append("")
    lines.append(f"## Decision\n\n**Recommended: `{decision['recommended']}`** — {decision['rationale']}\n")
    lines.append("> This runner never edits the constant. To adopt a winner, pass it as the "
                 "`periods` arg to RelativeStrengthCalculator (now configurable) and cite these stats.")
    return "\n".join(lines)


def _f(v: object) -> str:
    return "—" if v is None else (f"{v:+.2f}" if isinstance(v, float) else str(v))


# --------------------------------------------------------------------------- #
# Data sources
# --------------------------------------------------------------------------- #
def _load_fixtures() -> Tuple[Dict[str, pd.DataFrame], pd.DataFrame]:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from markets360_band_calibration import _read_csv

    fix = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "markets360"
    syms = [p.stem for p in sorted(fix.glob("*.csv")) if p.stem != "spy"]
    data = {s: _read_csv(str(fix / f"{s}.csv")) for s in syms}
    spy = _read_csv(str(fix / "spy.csv"))
    return data, spy


def _ohlcv_from_close(close: np.ndarray, rng: np.random.Generator, idx: pd.DatetimeIndex) -> pd.DataFrame:
    """Build an OHLCV frame from a close path, shaped exactly like the scanner's
    StockData / the project fixtures (Open/High/Low/Close/Volume, DatetimeIndex)."""
    close = np.asarray(close, dtype="float64")
    open_ = np.concatenate([[close[0]], close[:-1]])
    intraday = np.abs(rng.normal(0.0, 0.012, len(close)))
    high = np.maximum(open_, close) * (1.0 + intraday)
    low = np.minimum(open_, close) * (1.0 - intraday)
    base_vol = rng.uniform(3e5, 5e6)
    vol = base_vol * (1.0 + np.abs(rng.normal(0.0, 0.4, len(close))))
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


def make_synthetic_universe(
    n_symbols: int = 400, n_days: int = 900, seed: int = 7
) -> Tuple[Dict[str, pd.DataFrame], pd.DataFrame]:
    """A large, diverse synthetic universe that MIMICS the screener's data
    structure (real fetch is egress-blocked here). Each name = market beta +
    a persistent latent momentum regime (AR(1)) + idiosyncratic noise. The
    momentum persistence is the factor RS actually exploits — recent trailing
    strength carries forward — so different recency-weight configs genuinely
    differ in how well they capture it. NOT real market data; a structurally
    faithful stand-in so the calibration can run at universe scale."""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2021-01-04", periods=n_days)
    mkt_ret = rng.normal(0.0003, 0.009, n_days)              # benchmark factor
    spy = _ohlcv_from_close(300.0 * np.cumprod(1.0 + mkt_ret), rng, idx)

    data: Dict[str, pd.DataFrame] = {}
    for i in range(n_symbols):
        beta = rng.uniform(0.5, 1.7)
        phi = rng.uniform(0.95, 0.99)                        # momentum persistence
        shock = rng.normal(0.0, rng.uniform(0.0004, 0.0018), n_days)
        mom = np.zeros(n_days)
        for t in range(1, n_days):
            mom[t] = phi * mom[t - 1] + shock[t]
        idio = rng.normal(0.0, rng.uniform(0.010, 0.026), n_days)
        ret = beta * mkt_ret + mom + idio
        close = rng.uniform(12.0, 140.0) * np.cumprod(1.0 + ret)
        data[f"S{i:04d}"] = _ohlcv_from_close(close, rng, idx)
    return data, spy


def _load_csv_dir(data_dir: str, benchmark: str = "spy") -> Tuple[Dict[str, pd.DataFrame], pd.DataFrame]:
    """Ingest REAL OHLCV the user dropped into a directory — the legitimate,
    no-egress data path. Reads every ``*.csv`` (one per symbol) via the same
    reader the project fixtures use (auto-detects yfinance's multi-header export
    and a plain ``Date,Open,High,Low,Close,Volume`` file). One file must be the
    benchmark (default ``spy.csv``). Drop files from any machine where the fetch
    works; nothing here touches the network."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from markets360_band_calibration import _read_csv

    d = Path(data_dir)
    if not d.is_dir():
        raise SystemExit(f"--data-dir not found: {data_dir}")
    files = {p.stem.lower(): p for p in sorted(d.glob("*.csv"))}
    bench_key = benchmark.lower()
    if bench_key not in files:
        raise SystemExit(f"benchmark '{benchmark}.csv' not found in {data_dir} "
                         f"(have: {sorted(files)[:10]}...)")
    spy = _read_csv(str(files.pop(bench_key)))
    data: Dict[str, pd.DataFrame] = {}
    skipped = 0
    for sym, path in files.items():
        try:
            df = _read_csv(str(path))
        except Exception:
            skipped += 1
            continue
        if df is not None and "Close" in df.columns and len(df) >= 300:
            data[sym.upper()] = df
        else:
            skipped += 1
    if not data:
        raise SystemExit("No usable symbol CSVs (need >= 300 rows of OHLCV each).")
    if skipped:
        print(f"  (skipped {skipped} unusable/short files)")
    return data, spy


def _load_db(market: str = "US") -> Tuple[Dict[str, pd.DataFrame], pd.DataFrame]:
    """Production source: resolve the US universe EX-ETF and load cached OHLCV.

    Uses the same universe-resolver + ETF exclusion + price/benchmark caches the
    scanner uses, so this runs on the real, deployed data with no external fetch.
    """
    from app.database import SessionLocal
    from app.wiring.bootstrap import (
        get_price_cache, get_benchmark_cache, initialize_process_runtime_services,
    )
    from app.services.universe_resolver import resolve_symbols
    from app.schemas.universe import UniverseDefinition, UniverseType

    initialize_process_runtime_services()
    price = get_price_cache()
    db = SessionLocal()
    try:
        udef = UniverseDefinition(type=UniverseType.MARKET, market=market)
        symbols = resolve_symbols(db, udef, exclude_etfs=True)
        data: Dict[str, pd.DataFrame] = {}
        for sym in symbols:
            df = price.get_historical_data(sym, period="5y", market=market)
            if df is not None and len(df) >= 300:
                data[sym] = df
    finally:
        db.close()
    bundle = get_benchmark_cache().get_benchmark_bundle(market=market, period="5y")
    spy = bundle.data if bundle is not None else None
    if spy is None:
        raise SystemExit("No benchmark data available from the DB.")
    return data, spy


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=("fixtures", "db", "synthetic", "csv"), default="fixtures")
    ap.add_argument("--top-frac", type=float, default=0.30)
    ap.add_argument("--asof-count", type=int, default=8)
    ap.add_argument("--market", default="US")
    ap.add_argument("--n-symbols", type=int, default=400, help="synthetic universe size")
    ap.add_argument("--seed", type=int, default=7, help="synthetic RNG seed")
    ap.add_argument("--data-dir", default=None, help="dir of per-symbol OHLCV CSVs (--source csv)")
    ap.add_argument("--benchmark", default="spy", help="benchmark CSV stem in --data-dir")
    args = ap.parse_args()

    if args.source == "db":
        data, spy = _load_db(args.market)
    elif args.source == "synthetic":
        data, spy = make_synthetic_universe(n_symbols=args.n_symbols, seed=args.seed)
    elif args.source == "csv":
        if not args.data_dir:
            raise SystemExit("--source csv requires --data-dir <path to OHLCV CSVs>")
        data, spy = _load_csv_dir(args.data_dir, args.benchmark)
    else:
        data, spy = _load_fixtures()
    if not data:
        raise SystemExit("Empty universe — nothing to calibrate.")

    dates = spy.index
    lo, hi = 260, len(dates) - max(HORIZONS) - 1
    if hi <= lo:
        raise SystemExit("Not enough history for a walk-forward.")
    asof_dates = [dates[i] for i in np.linspace(lo, hi, args.asof_count).astype(int)]

    config_metrics = {
        name: evaluate_config(w, data, spy, asof_dates, args.top_frac)
        for name, w in CONFIGS.items()
    }
    decision = decide(config_metrics)
    print(render(config_metrics, decision, len(data), len(asof_dates), args.top_frac))
    if args.source == "fixtures":
        print("\n  CAVEAT: fixtures are a tiny, hand-picked, non-representative set —")
        print("  this run PROVES the pipeline end-to-end; the real verdict comes from")
        print("  --source db on the full US universe ex-ETF in production.")
    elif args.source == "synthetic":
        print(f"\n  NOTE: synthetic universe ({len(data)} names, momentum-structured) — a")
        print("  structurally faithful stand-in (real fetch is egress-blocked here). It")
        print("  exercises the calibration at scale; the verdict reflects the generator's")
        print("  momentum dynamics, NOT live markets. Run --source db in production for the")
        print("  real-market answer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
