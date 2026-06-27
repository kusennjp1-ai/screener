"""
Minervini Markets 360-style color bands.

Reproduces the three horizontal color bands shown on MM360 charts as
self-contained, function-equivalent calculations (MM360's exact formulas are
proprietary, so these match the *intent* and behaviour, not the internals):

1. Pressure   - buy vs sell demand   -> "buy" (green) / "sell" (red) / "neutral"
2. Buy Risk   - risk of buying now    -> "low" (green) / "medium" (amber) / "high" (red)
3. TPR        - trend-template phase   -> "strong" / "transition" / "weak"

Each band returns:
- a current categorical state (for dashboard badges),
- a current numeric driver (for tooltips / sorting),
- an optional per-bar history list (for rendering the horizontal band itself).

Design notes / accuracy choices (vs. the naive version):
- Pressure uses an Accumulation/Distribution-style money-flow slope, not a raw
  up-vol vs down-vol count. Each bar is weighted by where it closes inside its
  own range (close-location value), then by volume. This captures intrabar
  accumulation that a simple "green bar = buying" rule misses.
- Buy Risk normalises extension by ATR (ATR-distance from the 50DMA) instead of
  a fixed % threshold, so the same thresholds work across low- and high-vol
  names. VCP contraction nudges risk down (tight base = lower risk), and a
  break below the 50DMA forces high risk regardless of extension.
- TPR scores the full 8-point Trend Template *including* a self-computed
  relative-strength condition (vs. a benchmark series when supplied), rather
  than the 7 price/MA conditions alone.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable parameters (kept in one place so they are easy to calibrate later)
# ---------------------------------------------------------------------------
PRESSURE_LOOKBACK = 50        # bars used to judge net demand
PRESSURE_SLOPE_BARS = 10      # bars used to measure the AD-line slope
PRESSURE_NEUTRAL_EPS = 0.0    # |normalised slope| below this -> "neutral"

# Per-bar history length for the chart band strips. All three bands share this so
# their colored strips span the SAME chart window — otherwise the shortest band
# (Pressure was 50) leaves the rest of the strip row an uncolored black gap.
BAND_HISTORY_BARS = 252

BUYRISK_MA = 50               # extension is measured from this SMA
# Calibrated against 6 real Markets 360 charts (LLY/FTNT/CYRX/IBB/QQQ/MRVL):
# their Buy Risk reads "low" (green) for strong uptrends extended up to ~6 ATRs
# above the 50DMA, not 4 — a 4.0 cutoff flipped extended leaders to amber too
# early. Raising the low-risk band to 6.0 lifted right-edge state agreement with
# the real charts from 67% to 83%. See scripts/markets360_band_calibration.py.
BUYRISK_LOW_ATR = 6.0         # < this many ATRs above MA -> low risk
BUYRISK_HIGH_ATR = 8.0        # > this many ATRs above MA -> high risk
VCP_TIGHT_PCT = 5.0           # range-contraction% under this = "tight" base

TPR_STRONG = 8                # >= this many conditions -> strong
TPR_TRANSITION = 5            # >= this many conditions -> transition (else weak)


# ---------------------------------------------------------------------------
# Band 1: Pressure
# ---------------------------------------------------------------------------
def _ad_line(price_data: pd.DataFrame) -> pd.Series:
    """Accumulation/Distribution line (Chaikin), money-flow based."""
    high = price_data["High"]
    low = price_data["Low"]
    close = price_data["Close"]
    volume = price_data["Volume"]

    rng = (high - low).replace(0, np.nan)
    # Close Location Value in [-1, +1]: +1 closes on the high, -1 on the low.
    clv = ((close - low) - (high - close)) / rng
    clv = clv.fillna(0.0)
    mfv = clv * volume
    return mfv.cumsum()


def compute_pressure(
    price_data: pd.DataFrame,
    lookback: int = PRESSURE_LOOKBACK,
    slope_bars: int = PRESSURE_SLOPE_BARS,
    with_history: bool = False,
) -> Dict[str, object]:
    """Net buying vs selling pressure from the AD-line slope."""
    if len(price_data) < lookback + slope_bars:
        return {"pressure_state": None, "pressure_value": None}

    ad = _ad_line(price_data)

    # Normalise the AD-line slope by recent volume so the value is comparable
    # across symbols of very different liquidity.
    vol_norm = price_data["Volume"].tail(lookback).mean()
    if not vol_norm or vol_norm <= 0:
        return {"pressure_state": None, "pressure_value": None}

    slope_series = (ad - ad.shift(slope_bars)) / (slope_bars * vol_norm)
    slope_now = float(slope_series.iloc[-1])

    if slope_now > PRESSURE_NEUTRAL_EPS:
        state = "buy"
    elif slope_now < -PRESSURE_NEUTRAL_EPS:
        state = "sell"
    else:
        state = "neutral"

    out: Dict[str, object] = {
        "pressure_state": state,
        "pressure_value": round(slope_now, 4),
    }

    if with_history:
        # Span the full chart window (not the 50-bar state lookback) so the
        # Pressure strip is colored across the same range as the other bands.
        hist = slope_series.tail(BAND_HISTORY_BARS)
        out["pressure_history"] = [
            ("buy" if v > PRESSURE_NEUTRAL_EPS else "sell" if v < -PRESSURE_NEUTRAL_EPS else "neutral")
            for v in hist.fillna(0.0)
        ]
    return out


# ---------------------------------------------------------------------------
# Band 2: Buy Risk
# ---------------------------------------------------------------------------
def _atr(price_data: pd.DataFrame, period: int = 14) -> pd.Series:
    high = price_data["High"]
    low = price_data["Low"]
    close = price_data["Close"]
    tr = pd.concat(
        [high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def _vcp_contraction_pct(price_data: pd.DataFrame, window: int = 10) -> Optional[float]:
    """Recent high-low range as % of price; small = tight (contracting)."""
    if len(price_data) < window:
        return None
    recent = price_data.tail(window)
    hi = recent["High"].max()
    lo = recent["Low"].min()
    last = price_data["Close"].iloc[-1]
    if last <= 0:
        return None
    return float((hi - lo) / last * 100)


def _risk_from_extension(atr_distance: float, is_tight: bool) -> str:
    low_thr = BUYRISK_LOW_ATR + (1.0 if is_tight else 0.0)   # tight base widens "low" zone
    high_thr = BUYRISK_HIGH_ATR
    if atr_distance < low_thr:
        return "low"
    if atr_distance > high_thr:
        return "high"
    return "medium"


def compute_buy_risk(
    price_data: pd.DataFrame,
    ma: int = BUYRISK_MA,
    with_history: bool = False,
) -> Dict[str, object]:
    """How risky it is to buy now: extension from MA, ATR-normalised, VCP-aware."""
    if len(price_data) < ma + 1:
        return {"buy_risk_state": None, "buy_risk_atr": None}

    close = price_data["Close"]
    sma = close.rolling(ma).mean()
    atr = _atr(price_data).replace(0, np.nan)
    atr_distance_series = (close - sma) / atr  # how many ATRs above the MA

    last_close = float(close.iloc[-1])
    last_sma = float(sma.iloc[-1])
    last_dist = float(atr_distance_series.iloc[-1])
    is_tight = (_vcp_contraction_pct(price_data) or 999.0) < VCP_TIGHT_PCT

    # Below the 50DMA = broken / no-buy zone, always high risk.
    if last_close < last_sma:
        state = "high"
    else:
        state = _risk_from_extension(last_dist, is_tight)

    out: Dict[str, object] = {
        "buy_risk_state": state,
        "buy_risk_atr": round(last_dist, 2),
    }

    if with_history:
        below = close < sma
        hist = []
        for d, b in zip(atr_distance_series.tail(BAND_HISTORY_BARS), below.tail(BAND_HISTORY_BARS)):
            if b or pd.isna(d):
                hist.append("high")
            else:
                hist.append(_risk_from_extension(float(d), is_tight))
        out["buy_risk_history"] = hist
    return out


# ---------------------------------------------------------------------------
# Band 3: TPR (Trend Template phase)
# ---------------------------------------------------------------------------
def _relative_strength_ok(
    close: pd.Series,
    benchmark_close: Optional[pd.Series],
    lookback: int = 252,
) -> Optional[bool]:
    """RS condition: stock's lookback return beats the benchmark's, and the
    RS line is rising. Returns None if no benchmark supplied."""
    if benchmark_close is None or len(benchmark_close) < lookback + 1:
        return None
    bench = benchmark_close.reindex(close.index).ffill()
    rs_line = close / bench
    if len(rs_line.dropna()) < lookback + 1:
        return None
    rs_now = rs_line.iloc[-1]
    rs_past = rs_line.iloc[-(lookback)]
    rs_ma = rs_line.rolling(50).mean().iloc[-1]
    return bool(rs_now > rs_past and rs_now > rs_ma)


def compute_tpr(
    price_data: pd.DataFrame,
    benchmark_close: Optional[pd.Series] = None,
    with_history: bool = False,
) -> Dict[str, object]:
    """Score the 8-point Trend Template; map the count to a phase color."""
    if len(price_data) < 200:
        return {"tpr_state": None, "tpr_score": None}

    close = price_data["Close"]
    sma50 = close.rolling(50).mean()
    sma150 = close.rolling(150).mean()
    sma200 = close.rolling(200).mean()
    hi52 = price_data["High"].rolling(252).max()
    lo52 = price_data["Low"].rolling(252).min()

    def score_at(i: int) -> int:
        c = close.iloc[i]
        s50, s150, s200 = sma50.iloc[i], sma150.iloc[i], sma200.iloc[i]
        if any(pd.isna(x) for x in (s50, s150, s200)):
            return 0
        conds = [
            c > s150 and c > s200,                         # 1 price above 150 & 200
            s150 > s200,                                   # 2 150 above 200
            (i >= 22 and s200 > sma200.iloc[i - 22]),      # 3 200 rising ~1mo
            s50 > s150 and s50 > s200,                     # 4 50 above 150 & 200
            c > s50,                                       # 5 price above 50
            c >= lo52.iloc[i] * 1.30,                      # 6 >=30% above 52w low
            c <= hi52.iloc[i] and c >= hi52.iloc[i] * 0.75,  # 7 within 25% of 52w high
        ]
        n = sum(bool(x) for x in conds)
        return n

    # 8th condition (RS) is evaluated only for the current bar (benchmark-based).
    base_now = score_at(len(close) - 1)
    rs_ok = _relative_strength_ok(close, benchmark_close)
    score_now = base_now + (1 if rs_ok else 0)
    max_score = 8 if rs_ok is not None else 7

    if score_now >= TPR_STRONG and max_score == 8:
        state = "strong"
    elif score_now >= (TPR_STRONG - 1) and max_score == 7:
        state = "strong"
    elif score_now >= TPR_TRANSITION:
        state = "transition"
    else:
        state = "weak"

    out: Dict[str, object] = {
        "tpr_state": state,
        "tpr_score": score_now,
        "tpr_max": max_score,
    }

    if with_history:
        hist = []
        for i in range(max(0, len(close) - BAND_HISTORY_BARS), len(close)):
            s = score_at(i)  # history uses the 7 price/MA conditions only
            hist.append("strong" if s >= 7 else "transition" if s >= 5 else "weak")
        out["tpr_history"] = hist
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def calculate_bands(
    price_data: pd.DataFrame,
    benchmark_close: Optional[pd.Series] = None,
    with_history: bool = False,
) -> Dict[str, object]:
    """Compute all three MM360-style bands for one symbol.

    Args:
        price_data: OHLCV DataFrame (Date index; Open/High/Low/Close/Volume).
        benchmark_close: optional benchmark Close series (e.g. SPY/^GSPC) for
            the RS condition in TPR. If omitted, TPR uses 7 conditions.
        with_history: also return per-bar *_history lists for rendering bands.
    """
    if price_data is None or price_data.empty:
        return {}

    result: Dict[str, object] = {}
    try:
        result.update(compute_pressure(price_data, with_history=with_history))
    except Exception as e:  # never let one band break the others
        logger.debug(f"pressure band failed: {e}")
    try:
        result.update(compute_buy_risk(price_data, with_history=with_history))
    except Exception as e:
        logger.debug(f"buy_risk band failed: {e}")
    try:
        result.update(compute_tpr(price_data, benchmark_close, with_history=with_history))
    except Exception as e:
        logger.debug(f"tpr band failed: {e}")
    return result
