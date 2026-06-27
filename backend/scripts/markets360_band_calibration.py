#!/usr/bin/env python3
"""
Markets 360 — color-band calibration & comparison harness.

Quantifies how closely our MM360 color bands (Pressure / Buy Risk / TPR, from
``app.services.minervini_bands.calculate_bands``) match a *real* Minervini
Markets 360 chart, and grid-searches the band parameters to maximise agreement.

Pipeline
--------
1. Ground truth: sample the three color strips out of a reference screenshot
   (pixel classification green/amber/red), bucketed across the time axis.
2. Our bands: load LLY + benchmark OHLCV and run ``calculate_bands`` (optionally
   with overridden tunables), bucketed the same way.
3. Score: per-band agreement (exact 3-class, and coarse green-vs-red).
4. Calibrate: sweep the key tunables, report the config that maximises agreement.

Data source (in priority order)
-------------------------------
* ``--lly-csv / --spy-csv`` (Date,Open,High,Low,Close,Volume) — real data.
* the platform price cache (``PriceCacheService.get_cached_only``) when a DB is
  reachable — i.e. run this against the live backend for the real comparison.
* a documented offline **approximation** of LLY's path (peak→decline→recovery)
  so the harness is exercisable with no network/DB. Clearly flagged as approx;
  agreement numbers from this mode are indicative, not authoritative.

Note: real market-data egress is blocked in the sandbox, so the default run uses
the offline approximation. Point ``--lly-csv``/``--spy-csv`` at real exports (or
run where the cache is warm) for the authoritative comparison.
"""
from __future__ import annotations

import argparse
import itertools
import os
import sys
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# Reference-image band-row pixel bounds (y0,y1) and default bucket count.
DEFAULT_ROWS = {"Pressure": (93, 111), "BuyRisk": (127, 147), "TPR": (160, 178)}
GREEN, AMBER, RED, BG = "G", "A", "R", "."


# --------------------------------------------------------------------------- #
# 1. Ground truth from a reference screenshot
# --------------------------------------------------------------------------- #
def _classify(r: float, g: float, b: float) -> str:
    if r < 55 and g < 55 and b < 55:
        return BG
    if b <= min(r, g) and r > 90 and g > 80 and abs(r - g) < 55:
        return AMBER
    if g > r + 12:
        return GREEN
    if r > g + 12:
        return RED
    return AMBER


def extract_image_bands(path: str, rows=DEFAULT_ROWS, n_buckets: int = 60) -> Dict[str, str]:
    from PIL import Image

    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    H, W, _ = a.shape
    # x-range = where the Pressure row is band-colored.
    y0, y1 = rows["Pressure"]
    press = [_classify(a[y0:y1, x, 0].mean(), a[y0:y1, x, 1].mean(), a[y0:y1, x, 2].mean()) for x in range(W)]
    xs = [x for x, c in enumerate(press) if c != BG]
    xL, xR = min(xs), max(xs)

    def seq(name: str) -> str:
        yy0, yy1 = rows[name]
        cols = [_classify(a[yy0:yy1, x, 0].mean(), a[yy0:yy1, x, 1].mean(), a[yy0:yy1, x, 2].mean()) for x in range(xL, xR)]
        step = (xR - xL) / n_buckets
        out = []
        for k in range(n_buckets):
            s = [c for c in cols[int(k * step):int((k + 1) * step)] if c != BG] or [BG]
            out.append(max(set(s), key=s.count))
        return "".join(out)

    return {name: seq(name) for name in rows}


# --------------------------------------------------------------------------- #
# 2. Our bands from price data
# --------------------------------------------------------------------------- #
def _bucket(states: List[str], n_buckets: int) -> str:
    """Bucket a per-bar state list into n majority-vote buckets (G/A/R)."""
    m = {"buy": GREEN, "low": GREEN, "strong": GREEN,
         "neutral": AMBER, "medium": AMBER, "transition": AMBER,
         "sell": RED, "high": RED, "weak": RED}
    mapped = [m.get(s, BG) for s in states]
    if not mapped:
        return BG * n_buckets
    step = len(mapped) / n_buckets
    out = []
    for k in range(n_buckets):
        s = [c for c in mapped[int(k * step):int((k + 1) * step)] if c != BG] or [BG]
        out.append(max(set(s), key=s.count))
    return "".join(out)


def our_bands(lly: pd.DataFrame, spy: Optional[pd.DataFrame], params: Dict, n_buckets: int = 60,
              display_bars: Optional[int] = None) -> Dict[str, str]:
    """Run the real band computation under overridden tunables, bucketed.

    ``display_bars`` keeps only the trailing N bars of each history so we compare
    the *visible* window — the bars before it are warmup needed for valid MAs
    (just as MM360 computes its strips off history preceding the display window).
    """
    import app.services.minervini_bands as mb

    saved = {k: getattr(mb, k) for k in params}
    try:
        for k, v in params.items():
            setattr(mb, k, v)
        bench_close = spy["Close"] if spy is not None and "Close" in getattr(spy, "columns", []) else None
        bands = mb.calculate_bands(lly, benchmark_close=bench_close, with_history=True)
    finally:
        for k, v in saved.items():
            setattr(mb, k, v)

    def tail(key):
        h = bands.get(key, [])
        return h[-display_bars:] if display_bars else h

    return {
        "Pressure": _bucket(tail("pressure_history"), n_buckets),
        "BuyRisk": _bucket(tail("buy_risk_history"), n_buckets),
        "TPR": _bucket(tail("tpr_history"), n_buckets),
    }


# --------------------------------------------------------------------------- #
# 3. Scoring
# --------------------------------------------------------------------------- #
def _coarse(c: str) -> str:
    return {GREEN: "g", RED: "r", AMBER: "g"}.get(c, "x")  # amber grouped with green (low-risk/transition lean)


def score(real: Dict[str, str], ours: Dict[str, str], skip_left: int = 0) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for band in real:
        r, o = real[band][skip_left:], ours[band][skip_left:]
        n = min(len(r), len(o))
        if n == 0:
            out[band] = {"exact": 0.0, "coarse": 0.0}
            continue
        exact = sum(1 for i in range(n) if r[i] == o[i] and r[i] != BG) / max(sum(1 for i in range(n) if r[i] != BG), 1)
        coarse = sum(1 for i in range(n) if _coarse(r[i]) == _coarse(o[i]) and r[i] != BG) / max(sum(1 for i in range(n) if r[i] != BG), 1)
        out[band] = {"exact": round(exact * 100, 1), "coarse": round(coarse * 100, 1)}
    return out


def mean_coarse(s: Dict[str, Dict[str, float]]) -> float:
    return round(sum(v["coarse"] for v in s.values()) / len(s), 1)


# --------------------------------------------------------------------------- #
# Price loading
# --------------------------------------------------------------------------- #
def _read_csv(path: str) -> pd.DataFrame:
    """Read a daily OHLCV CSV. Handles both a plain ``Date,Open,High,Low,Close,
    Volume`` file and yfinance's 3-row multi-header export (Price/Ticker/Date)."""
    head = pd.read_csv(path, nrows=1)
    if list(head.columns)[:1] == ["Price"]:
        # yfinance: row0 = field names (first col 'Price'), rows 1-2 = Ticker/Date meta.
        df = pd.read_csv(path, skiprows=[1, 2]).rename(columns={"Price": "Date"})
    else:
        df = pd.read_csv(path)
        df.columns = [c.capitalize() for c in df.columns]
    df["Date"] = pd.to_datetime(df["Date"])
    for col in ("Open", "High", "Low", "Close", "Volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.set_index("Date").sort_index()


def load_prices(lly_csv: Optional[str], spy_csv: Optional[str]) -> Tuple[pd.DataFrame, Optional[pd.DataFrame], str]:
    if lly_csv:
        return _read_csv(lly_csv), (_read_csv(spy_csv) if spy_csv else None), "csv"
    # Try the live cache (real data, when a DB is reachable).
    try:
        from app.wiring.bootstrap import get_benchmark_cache, get_price_cache
        lly = get_price_cache().get_cached_only("LLY", period="2y")
        if lly is not None and not lly.empty:
            spy = get_benchmark_cache().get_benchmark_data(market="US", period="2y")
            return lly, spy, "cache"
    except Exception:  # noqa: BLE001
        pass
    # Offline approximation (documented; indicative only).
    return _approx_lly(), _approx_spy(), "approx"


def _shape_frame(close: np.ndarray, vol: float = 3e6) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2025-10-01", periods=n)
    close = np.asarray(close, float)
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.where(close >= open_, close * 1.004, np.maximum(open_, close) * 1.012)
    low = np.where(close >= open_, np.minimum(open_, close) * 0.988, close * 0.996)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close,
                         "Volume": np.full(n, vol)}, index=idx)


# The visible window is ~186 sessions (Oct-2025 .. Jul-2026); the bands need
# ~250 sessions of warmup before it for valid 50/150/200 MAs (LLY's Aug->Oct
# run-up into the peak), so the harness builds warmup + display and compares
# only the display tail.
WARMUP_BARS = 250
DISPLAY_BARS = 186


def _approx_lly() -> pd.DataFrame:
    warm = np.linspace(560, 1180, WARMUP_BARS) + 12 * np.sin(np.linspace(0, 8, WARMUP_BARS))
    t = np.linspace(0, 1, DISPLAY_BARS)
    decline = 1180 - (1180 - 850) * (t / 0.62) + 35 * np.sin(t * 7)
    recover = 850 + (1191 - 850) * ((np.clip(t - 0.62, 0, None)) / 0.38) ** 1.25
    disp = np.where(t < 0.62, decline, recover)
    return _shape_frame(np.concatenate([warm, disp]))


def _approx_spy() -> pd.DataFrame:
    n = WARMUP_BARS + DISPLAY_BARS
    t = np.linspace(0, 1, n)
    return _shape_frame(380 + 355 * t + 8 * np.sin(t * 9), vol=70e6)


# --------------------------------------------------------------------------- #
# 4. Calibration
# --------------------------------------------------------------------------- #
CAL_GRID = {
    "PRESSURE_LOOKBACK": [30, 50],
    "PRESSURE_SLOPE_BARS": [5, 8, 10],
    "PRESSURE_NEUTRAL_EPS": [0.0],
    "BUYRISK_LOW_ATR": [3.0, 4.0, 5.0],
    "BUYRISK_HIGH_ATR": [7.0, 8.0],
}


def calibrate(real, lly, spy, n_buckets, skip_left, display_bars):
    keys = list(CAL_GRID)
    best = None
    for combo in itertools.product(*[CAL_GRID[k] for k in keys]):
        params = dict(zip(keys, combo))
        try:
            s = score(real, our_bands(lly, spy, params, n_buckets, display_bars), skip_left)
        except Exception:  # noqa: BLE001
            continue
        mc = mean_coarse(s)
        if best is None or mc > best[0]:
            best = (mc, params, s)
    return best


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", default="/root/.claude/uploads/fcde633b-a038-5ae9-872c-05978f147147/37dba2f2-IMG_2058.jpeg")
    ap.add_argument("--lly-csv", default=os.environ.get("MARKETS360_LLY_CSV"))
    ap.add_argument("--spy-csv", default=os.environ.get("MARKETS360_SPY_CSV"))
    ap.add_argument("--buckets", type=int, default=60)
    ap.add_argument("--skip-left", type=int, default=18, help="ignore the leftmost buckets (label overlap zone)")
    ap.add_argument("--display-bars", type=int, default=186, help="trailing bars = the chart's visible window")
    ap.add_argument("--calibrate", action="store_true")
    args = ap.parse_args()

    real = extract_image_bands(args.image, n_buckets=args.buckets)
    lly, spy, src = load_prices(args.lly_csv, args.spy_csv)
    print(f"price source: {src}  (skip_left={args.skip_left} buckets to avoid label overlap)\n")

    display_bars = args.display_bars
    base = our_bands(lly, spy, {}, args.buckets, display_bars)
    s = score(real, base, args.skip_left)
    for band in real:
        print(f"{band:9s} REAL {real[band]}")
        print(f"{band:9s} OURS {base[band]}   exact={s[band]['exact']}%  coarse(g/r)={s[band]['coarse']}%")
    print(f"\nbaseline mean coarse agreement: {mean_coarse(s)}%")

    if args.calibrate:
        print("\ncalibrating ...")
        best = calibrate(real, lly, spy, args.buckets, args.skip_left, display_bars)
        if best:
            mc, params, bs = best
            print(f"best mean coarse agreement: {mc}%  with {params}")
            for band in bs:
                print(f"  {band:9s} exact={bs[band]['exact']}%  coarse={bs[band]['coarse']}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
