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

# Pressure sell-overrides, calibrated against real MM360 charts (the smooth
# AD-line slope is too slow to flag fresh distribution/capitulation):
#  - crash bar: a day return at/under CRASH_RET on >= CRASH_VOL_MULT x avg volume
#    (catches a -49% QURE-style crash the 10-bar slope still reads positive).
#  - distribution cluster off highs: >= DIST_MIN down-on-volume bars within
#    DIST_BARS AND price >= DIST_OFF_HIGH off the window high (catches a GEV-style
#    pullback). Only fires on genuine selling, so it adds little band chop.
PRESSURE_CRASH_RET = -0.06
PRESSURE_CRASH_VOL_MULT = 2.0
PRESSURE_DIST_BARS = 10
PRESSURE_DIST_MIN = 2
PRESSURE_DIST_OFF_HIGH = 0.05

# Pressure buy-override (the accumulation counterpart to the sell-overrides): a
# break to a fresh high on up-volume is confirmed accumulation and flips the band
# green immediately, the same way MM360 turns Pressure green when a leader clears
# to new highs. Without it the smoothing would lag a sharp recovery — a stock
# breaking to new highs right after a shakeout would read red for several more
# bars (seen on LLY/IBB/AA breakouts).
PRESSURE_BREAKOUT_HIGH_BARS = 60
PRESSURE_BREAKOUT_RET = 0.0

# TPR demotion: a perfect-template bar that is meaningfully rolling over
# (5-bar return <= -3% AND 10-bar return <= -1%) reads "transition", not
# "strong" — calibrated to real MM360 (e.g. QQQ fading from highs at a full
# template). Thresholds are deliberately material (not any down-tick) so the
# band strip stays smooth rather than flickering on every shallow dip.
TPR_DEMOTE_R5 = -0.03
TPR_DEMOTE_R10 = -0.01

# ---------------------------------------------------------------------------
# Band smoothing (hysteresis / debounce)
# ---------------------------------------------------------------------------
# MM360's bands are *persistent regime* indicators: they paint long, smooth
# blocks (one stretch of red, then one stretch of green), not a bar-by-bar
# re-classification. Our raw per-bar signals (AD-slope sign, ATR-extension
# threshold crossings, trend-template score) flip far more often, so without
# smoothing the strips look choppy next to the real charts.
#
# A new raw state must persist for CONFIRM bars in a row before the *displayed*
# state flips to it. The deliberate fast-transition rules (Pressure crash /
# distribution, TPR roll-over) bypass the delay and flip immediately, because
# MM360 also reacts to genuine selling without lag.
#
# CONFIRM is calibrated to the SMOOTHNESS of the real charts. Counting band color
# changes ("flips") across the visible window on five real screenshots
# (QQQ/FTNT/CYRX/IBB/LLY) gives a mean of ~10 flips per band per ~186 bars. Our
# raw (unsmoothed) bands flip ~26/21/16 times; the CONFIRM values below bring our
# flip density onto the real charts' (P10.8/B9.0/T8.4 vs the real P10.2/B10.0/
# T9.8), which removes the bar-to-bar chop without over-lagging fresh transitions.
# A grid search held right-edge state agreement at 29/33 across this range, so the
# values are picked to match the real flip density rather than to chase the
# right-edge metric. See scripts/markets360_band_rightedge_eval.py.
PRESSURE_CONFIRM_BARS = 6
BUYRISK_CONFIRM_BARS = 3
TPR_CONFIRM_BARS = 3


def _debounce(raw: List[str], hard: Optional[List[bool]], confirm: int) -> List[str]:
    """Causal hysteresis over a categorical state sequence (oldest -> newest).

    The displayed state only changes after a new raw state appears ``confirm``
    bars in a row. ``hard[i]`` (when supplied) forces the displayed state to the
    raw state at bar ``i`` immediately, bypassing the confirmation delay — used
    for deliberate fast transitions (crash/distribution/roll-over). Being causal
    (each bar depends only on earlier bars) the last element is a valid live
    badge with no look-ahead.
    """
    if not raw:
        return []
    if confirm <= 1:
        return list(raw)
    out: List[str] = []
    cur = raw[0]
    pending: Optional[str] = None
    count = 0
    for i, s in enumerate(raw):
        if hard is not None and hard[i]:
            cur = s
            pending, count = None, 0
        elif s == cur:
            pending, count = None, 0
        else:
            if s == pending:
                count += 1
            else:
                pending, count = s, 1
            if count >= confirm:
                cur = s
                pending, count = None, 0
        out.append(cur)
    return out


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


def _pressure_sell_override(price_data: pd.DataFrame) -> pd.Series:
    """Per-bar mask forcing "sell" on crash / fresh-distribution bars."""
    close = price_data["Close"]
    high = price_data["High"]
    vol = price_data["Volume"]
    ret = close.pct_change()
    avgvol = vol.rolling(BUYRISK_MA).mean()

    crash = (ret <= PRESSURE_CRASH_RET) & (vol >= PRESSURE_CRASH_VOL_MULT * avgvol)

    down_on_vol = (ret < 0) & (vol > avgvol)
    dist_count = down_on_vol.rolling(PRESSURE_DIST_BARS).sum()
    win_high = high.rolling(PRESSURE_DIST_BARS).max()
    off_high = (win_high - close) / win_high >= PRESSURE_DIST_OFF_HIGH
    distribution = (dist_count >= PRESSURE_DIST_MIN) & off_high

    return (crash | distribution).fillna(False)


def _pressure_buy_override(price_data: pd.DataFrame) -> pd.Series:
    """Per-bar mask forcing "buy" on a breakout to a fresh high on up-volume."""
    close = price_data["Close"]
    vol = price_data["Volume"]
    ret = close.pct_change()
    avgvol = vol.rolling(BUYRISK_MA).mean()
    new_high = close >= close.rolling(PRESSURE_BREAKOUT_HIGH_BARS).max()
    breakout = new_high & (ret > PRESSURE_BREAKOUT_RET) & (vol > avgvol)
    return breakout.fillna(False)


def compute_pressure(
    price_data: pd.DataFrame,
    lookback: int = PRESSURE_LOOKBACK,
    slope_bars: int = PRESSURE_SLOPE_BARS,
    with_history: bool = False,
    confirm_bars: int = PRESSURE_CONFIRM_BARS,
) -> Dict[str, object]:
    """Net buying vs selling pressure from the AD-line slope, with sell-overrides
    for crash / fresh-distribution bars and hysteresis so the band paints smooth
    regime blocks like the real MM360 chart (calibrated to it)."""
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
    sell_ov = _pressure_sell_override(price_data)
    buy_ov = _pressure_buy_override(price_data)

    def _raw(slope: float) -> str:
        if slope > PRESSURE_NEUTRAL_EPS:
            return "buy"
        if slope < -PRESSURE_NEUTRAL_EPS:
            return "sell"
        return "neutral"

    # Build the raw per-bar sequence over the chart window, then debounce it.
    # Crash/distribution force "sell" and a fresh-high breakout forces "buy";
    # both flip the band hard (no confirmation delay). Sell wins a tie.
    win = slope_series.tail(BAND_HISTORY_BARS).fillna(0.0)
    sell = sell_ov.tail(BAND_HISTORY_BARS).tolist()
    buy = buy_ov.tail(BAND_HISTORY_BARS).tolist()
    raw = [_raw(float(v)) for v in win]
    hard = [False] * len(raw)
    for i in range(len(raw)):
        if sell[i]:
            raw[i], hard[i] = "sell", True
        elif buy[i]:
            raw[i], hard[i] = "buy", True
    smoothed = _debounce(raw, hard, confirm_bars)

    out: Dict[str, object] = {
        "pressure_state": smoothed[-1],
        "pressure_value": round(slope_now, 4),
    }
    if with_history:
        out["pressure_history"] = smoothed
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
    confirm_bars: int = BUYRISK_CONFIRM_BARS,
) -> Dict[str, object]:
    """How risky it is to buy now: extension from MA, ATR-normalised, VCP-aware,
    debounced so the band paints smooth blocks like the real MM360 chart."""
    if len(price_data) < ma + 1:
        return {"buy_risk_state": None, "buy_risk_atr": None}

    close = price_data["Close"]
    sma = close.rolling(ma).mean()
    sma200 = close.rolling(200).mean()
    atr = _atr(price_data).replace(0, np.nan)
    atr_distance_series = (close - sma) / atr  # how many ATRs above the MA

    last_dist = float(atr_distance_series.iloc[-1])
    is_tight = (_vcp_contraction_pct(price_data) or 999.0) < VCP_TIGHT_PCT
    below = close < sma
    # Only a *broken* trend (below the 200DMA too) makes being under the 50DMA
    # "high risk". A pullback under the 50DMA inside an intact Stage-2 uptrend is
    # LOW buy risk (a low-extension entry), not high — MM360 paints those green,
    # so forcing "high" on every dip under the 50DMA over-reddened the band on
    # healthy pullbacks (verified bar-by-bar against the real IBB strip).
    broken = close < sma200

    # Raw per-bar risk over the chart window, then debounce so a one-bar dip does
    # not flicker the band.
    raw = []
    for d, b, br in zip(
        atr_distance_series.tail(BAND_HISTORY_BARS),
        below.tail(BAND_HISTORY_BARS),
        broken.tail(BAND_HISTORY_BARS),
    ):
        if pd.isna(d):
            raw.append("high")
        elif bool(b) and bool(br):
            raw.append("high")                              # below 50DMA in a broken trend
        else:
            raw.append(_risk_from_extension(float(d), is_tight))  # else extension-driven
    smoothed = _debounce(raw, None, confirm_bars)

    out: Dict[str, object] = {
        "buy_risk_state": smoothed[-1],
        "buy_risk_atr": round(last_dist, 2),
    }
    if with_history:
        out["buy_risk_history"] = smoothed
    return out


# ---------------------------------------------------------------------------
# Band 3: TPR (Trend Template phase)
# ---------------------------------------------------------------------------
def _tpr_state_from_score(score: int, max_score: int) -> str:
    strong_thr = TPR_STRONG if max_score == 8 else TPR_STRONG - 1
    if score >= strong_thr:
        return "strong"
    if score >= TPR_TRANSITION:
        return "transition"
    return "weak"


def compute_tpr(
    price_data: pd.DataFrame,
    benchmark_close: Optional[pd.Series] = None,
    with_history: bool = False,
    confirm_bars: int = TPR_CONFIRM_BARS,
) -> Dict[str, object]:
    """Score the 8-point Trend Template per bar; map the count to a phase color,
    debounced so the band paints smooth regime blocks like the real MM360 chart.
    Roll-over demotion flips hard (no delay), matching MM360's quick fade."""
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
        return sum(bool(x) for x in conds)

    def _rolling_over(i: int) -> bool:
        """A perfect-template bar fading from highs: a material 5- and 10-bar
        pullback (thresholds keep the strip smooth, not flickery)."""
        if i - 10 < 0:
            return False
        p5, p10 = close.iloc[i - 5], close.iloc[i - 10]
        if p5 <= 0 or p10 <= 0:
            return False
        return (close.iloc[i] / p5 - 1) <= TPR_DEMOTE_R5 and (close.iloc[i] / p10 - 1) <= TPR_DEMOTE_R10

    # 8th condition (RS) as a per-bar series so the band history and the live
    # badge use identical logic (previously RS was current-bar only).
    rs_series = None
    if benchmark_close is not None and len(benchmark_close) >= 252 + 1:
        bench = benchmark_close.reindex(close.index).ffill()
        rs_line = close / bench
        if len(rs_line.dropna()) >= 252 + 1:
            rs_series = (rs_line > rs_line.shift(252)) & (rs_line > rs_line.rolling(50).mean())
    max_score = 8 if rs_series is not None else 7

    def full_score(i: int) -> int:
        s = score_at(i)
        if rs_series is not None and bool(rs_series.iloc[i]):
            s += 1
        return s

    n = len(close)
    start = max(0, n - BAND_HISTORY_BARS)
    raw: List[str] = []
    hard: List[bool] = []
    for i in range(start, n):
        score_i = full_score(i)
        st = _tpr_state_from_score(score_i, max_score)
        roll = st == "strong" and score_i >= max_score and _rolling_over(i)
        if roll:
            st = "transition"
        raw.append(st)
        hard.append(roll)
    smoothed = _debounce(raw, hard, confirm_bars)

    out: Dict[str, object] = {
        "tpr_state": smoothed[-1],
        "tpr_score": full_score(n - 1),
        "tpr_max": max_score,
    }
    if with_history:
        out["tpr_history"] = smoothed
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
