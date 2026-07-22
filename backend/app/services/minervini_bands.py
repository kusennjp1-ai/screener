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
- Pressure uses Elder's Force Index (price change * volume, EMA-smoothed), chosen
  by a supervised bake-off of nine money-flow indicators against the date-aligned
  real MM360 bands: it matched the real Pressure strip far better (~85% per-bar vs
  ~66% for an Accumulation/Distribution-line slope) and generalised to held-out
  tickers. Crash/distribution/breakout overrides flip it hard; the result is
  hysteresis-smoothed so the band paints regime blocks, not bar-to-bar chop.
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
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable parameters (kept in one place so they are easy to calibrate later)
# ---------------------------------------------------------------------------
PRESSURE_LOOKBACK = 50        # bars used to judge net demand / normalise
PRESSURE_SLOPE_BARS = 10      # (legacy) AD-line slope window, kept for signature
PRESSURE_NEUTRAL_EPS = 0.0    # |signal| below this -> "neutral"
# Pressure is driven by Elder's Force Index (price change * volume, EMA-smoothed),
# NOT the Accumulation/Distribution-line slope. A supervised bake-off of nine
# money-flow indicators against the date-aligned real bands (IBB + LLY full strips,
# ~300 labelled bars, plus 11 held-out right edges) found Force Index the clear
# winner: it lifts per-bar agreement from ~66% (AD-slope) to ~85% on IBB and ~84%
# on LLY, and from 6/11 to 9/11 on the held-out right edges. See
# scripts/markets360_band_calibration.py.
PRESSURE_FORCE_SPAN = 13      # EMA span of the Force Index

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

# TPR color level. The static trend-template score (0-7) saturates a wide "middle"
# (5-6) that MM360 actually splits between strong and weak by TREND DIRECTION: the
# same mediocre score reads strong while advancing and weak while declining. A
# bake-off against the date-aligned real bands (IBB+LLY, ~300 bars) showed adding
# this direction tiebreak to the borderline lifts per-bar TPR agreement from ~50%
# to ~60% (decisive strong-vs-weak agreement ~75-78%) — the residual is the
# inherently fuzzy transition boundary. Direction = price vs the 50DMA and the
# 50DMA's own slope over TPR_DIR_SLOPE_BARS.
TPR_STRONG_RAW = 7            # raw 7-cond score >= this -> strong
TPR_WEAK_RAW = 4             # raw 7-cond score <= this -> weak (else direction-resolved)
TPR_DIR_SLOPE_BARS = 20
# A borderline bar only reads strong if it is also within this fraction of its
# 52-week high. MM360 keeps TPR weak through bounces during a post-top decline
# (price back above a rising 50DMA but still well off the highs); without the
# proximity gate those bounces read strong too early (the main real-weak/ours-
# strong error on LLY's Oct-2025 top).
TPR_STRONG_NEAR_HIGH = 0.93

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
# CONFIRM is calibrated against the date-aligned IBB ground truth (the real band
# color read above every bar — see scripts/markets360_band_calibration.py
# --date-aligned-ibb), NOT against flip-count alone. Flip-count only measures
# smoothness AMPLITUDE; it misses PHASE. A high CONFIRM debounces so hard that the
# band turns several bars LATE: at CONFIRM=6 our Pressure lagged the real chart by
# ~5 bars and per-bar agreement fell to 55%, even though the flip density matched.
# Dropping to CONFIRM=3 removes that lag (agreement 55% -> 75%, flips 14 ~ the real
# 14) while still smoothing the raw 26-flip chop. So CONFIRM trades two failure
# modes: too low = choppy, too high = laggy; it is tuned to the per-bar-agreement
# optimum, not the smoothness optimum. TPR is held at 3 (its smoothing/agreement
# trade-off is genuinely per-ticker, and 3 keeps both visual smoothness and the
# QQQ V-bounce reading transition).
PRESSURE_CONFIRM_BARS = 3
BUYRISK_CONFIRM_BARS = 3
TPR_CONFIRM_BARS = 3


# ---------------------------------------------------------------------------
# Timeframe configuration (daily vs weekly)
# ---------------------------------------------------------------------------
# All the *period* parameters (bar counts) scale with the timeframe; the
# calibrated *thresholds* (ATR levels, return %s, confirm logic, the raw 7-cond
# score cutoffs) are scale-invariant and stay module-level. The DAILY preset is
# exactly the calibrated daily values, so daily behaviour is unchanged. The
# WEEKLY preset divides the day-based windows by ~5 (Minervini's weekly template
# uses 10/30/40-week MAs = the 50/150/200-day equivalents) and smooths a touch
# less, since weekly bars are already smooth.
@dataclass(frozen=True)
class BandConfig:
    history_bars: int
    # Pressure
    pressure_lookback: int
    force_span: int
    breakout_high_bars: int
    dist_bars: int
    pressure_confirm: int
    # Buy Risk
    buyrisk_ma: int
    trend_ma: int            # broken-trend gate (200DMA daily / 40-week)
    buyrisk_confirm: int
    # TPR
    tpr_ma_fast: int         # 50d / 10w
    tpr_ma_mid: int          # 150d / 30w
    tpr_ma_slow: int         # 200d / 40w
    tpr_hl_window: int       # 52-week high/low: 252d / 52w
    tpr_dir_slope_bars: int
    tpr_demote_r5_bars: int
    tpr_demote_r10_bars: int
    tpr_confirm: int
    min_bars: int            # minimum bars before TPR is computable


DAILY = BandConfig(
    history_bars=BAND_HISTORY_BARS, pressure_lookback=PRESSURE_LOOKBACK,
    force_span=PRESSURE_FORCE_SPAN, breakout_high_bars=PRESSURE_BREAKOUT_HIGH_BARS,
    dist_bars=PRESSURE_DIST_BARS, pressure_confirm=PRESSURE_CONFIRM_BARS,
    buyrisk_ma=BUYRISK_MA, trend_ma=200, buyrisk_confirm=BUYRISK_CONFIRM_BARS,
    tpr_ma_fast=50, tpr_ma_mid=150, tpr_ma_slow=200, tpr_hl_window=252,
    tpr_dir_slope_bars=TPR_DIR_SLOPE_BARS, tpr_demote_r5_bars=5, tpr_demote_r10_bars=10,
    tpr_confirm=TPR_CONFIRM_BARS, min_bars=200,
)

WEEKLY = BandConfig(
    history_bars=104, pressure_lookback=10, force_span=6, breakout_high_bars=12,
    dist_bars=3, pressure_confirm=2, buyrisk_ma=10, trend_ma=40, buyrisk_confirm=2,
    tpr_ma_fast=10, tpr_ma_mid=30, tpr_ma_slow=40, tpr_hl_window=52,
    tpr_dir_slope_bars=4, tpr_demote_r5_bars=1, tpr_demote_r10_bars=2,
    tpr_confirm=2, min_bars=40,
)


def to_weekly(price_data: pd.DataFrame) -> pd.DataFrame:
    """Resample a daily OHLCV frame to weekly (Friday-anchored) bars."""
    if price_data is None or price_data.empty:
        return price_data
    agg = {
        "Open": price_data["Open"].resample("W-FRI").first(),
        "High": price_data["High"].resample("W-FRI").max(),
        "Low": price_data["Low"].resample("W-FRI").min(),
        "Close": price_data["Close"].resample("W-FRI").last(),
    }
    if "Volume" in price_data.columns:
        agg["Volume"] = price_data["Volume"].resample("W-FRI").sum()
    return pd.DataFrame(agg).dropna(subset=["Close"])


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
def _pressure_sell_override(price_data: pd.DataFrame, cfg: BandConfig = DAILY) -> pd.Series:
    """Per-bar mask forcing "sell" on crash / fresh-distribution bars."""
    close = price_data["Close"]
    high = price_data["High"]
    vol = price_data["Volume"]
    ret = close.pct_change(fill_method=None)
    avgvol = vol.rolling(cfg.buyrisk_ma).mean()

    crash = (ret <= PRESSURE_CRASH_RET) & (vol >= PRESSURE_CRASH_VOL_MULT * avgvol)

    down_on_vol = (ret < 0) & (vol > avgvol)
    dist_count = down_on_vol.rolling(cfg.dist_bars).sum()
    win_high = high.rolling(cfg.dist_bars).max()
    off_high = (win_high - close) / win_high >= PRESSURE_DIST_OFF_HIGH
    distribution = (dist_count >= PRESSURE_DIST_MIN) & off_high

    return (crash | distribution).fillna(False)


def _pressure_buy_override(price_data: pd.DataFrame, cfg: BandConfig = DAILY) -> pd.Series:
    """Per-bar mask forcing "buy" on a breakout to a fresh high on up-volume."""
    close = price_data["Close"]
    vol = price_data["Volume"]
    ret = close.pct_change(fill_method=None)
    avgvol = vol.rolling(cfg.buyrisk_ma).mean()
    new_high = close >= close.rolling(cfg.breakout_high_bars).max()
    breakout = new_high & (ret > PRESSURE_BREAKOUT_RET) & (vol > avgvol)
    return breakout.fillna(False)


def compute_pressure(
    price_data: pd.DataFrame,
    lookback: Optional[int] = None,
    slope_bars: int = PRESSURE_SLOPE_BARS,
    with_history: bool = False,
    confirm_bars: Optional[int] = None,
    cfg: BandConfig = DAILY,
) -> Dict[str, object]:
    """Net buying vs selling pressure from the Force Index, with crash/distribution
    sell- and breakout buy-overrides and hysteresis so the band paints smooth
    regime blocks like the real MM360 chart (calibrated to it)."""
    lookback = cfg.pressure_lookback if lookback is None else lookback
    confirm_bars = cfg.pressure_confirm if confirm_bars is None else confirm_bars
    if len(price_data) < lookback + slope_bars:
        return {"pressure_state": None, "pressure_value": None}

    # Force Index = price change * volume, EMA-smoothed (Elder). Its sign is the
    # net buy/sell pressure; calibrated to MM360's real bands (see module notes).
    force = (price_data["Close"].diff() * price_data["Volume"]).ewm(
        span=cfg.force_span, adjust=False
    ).mean()
    # Normalise by recent |force| so the reported value is comparable across
    # symbols of very different price/liquidity (the SIGN drives the state).
    fscale = force.abs().rolling(lookback).mean().replace(0, np.nan)
    signal_series = force / fscale
    slope_now = float(signal_series.iloc[-1]) if np.isfinite(signal_series.iloc[-1]) else 0.0
    sell_ov = _pressure_sell_override(price_data, cfg)
    buy_ov = _pressure_buy_override(price_data, cfg)

    def _raw(slope: float) -> str:
        if slope > PRESSURE_NEUTRAL_EPS:
            return "buy"
        if slope < -PRESSURE_NEUTRAL_EPS:
            return "sell"
        return "neutral"

    # Build the raw per-bar sequence over the chart window, then debounce it.
    # Crash/distribution force "sell" and a fresh-high breakout forces "buy";
    # both flip the band hard (no confirmation delay). Sell wins a tie.
    win = signal_series.tail(cfg.history_bars).fillna(0.0)
    sell = sell_ov.tail(cfg.history_bars).tolist()
    buy = buy_ov.tail(cfg.history_bars).tolist()
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
    ma: Optional[int] = None,
    with_history: bool = False,
    confirm_bars: Optional[int] = None,
    cfg: BandConfig = DAILY,
) -> Dict[str, object]:
    """How risky it is to buy now: extension from MA, ATR-normalised, VCP-aware,
    debounced so the band paints smooth blocks like the real MM360 chart."""
    ma = cfg.buyrisk_ma if ma is None else ma
    confirm_bars = cfg.buyrisk_confirm if confirm_bars is None else confirm_bars
    if len(price_data) < ma + 1:
        return {"buy_risk_state": None, "buy_risk_atr": None}

    close = price_data["Close"]
    sma = close.rolling(ma).mean()
    sma_trend = close.rolling(cfg.trend_ma).mean()
    atr = _atr(price_data).replace(0, np.nan)
    atr_distance_series = (close - sma) / atr  # how many ATRs above the MA

    last_dist = float(atr_distance_series.iloc[-1])
    is_tight = (_vcp_contraction_pct(price_data) or 999.0) < VCP_TIGHT_PCT
    below = close < sma
    # Only a *broken* trend (below the long-trend MA too) makes being under the
    # 50DMA "high risk". A pullback under the 50DMA inside an intact Stage-2
    # uptrend is LOW buy risk (a low-extension entry), not high — MM360 paints
    # those green, so forcing "high" on every dip over-reddened healthy pullbacks
    # (verified bar-by-bar against the real IBB strip).
    broken = close < sma_trend

    # Raw per-bar risk over the chart window, then debounce so a one-bar dip does
    # not flicker the band.
    raw = []
    for d, b, br in zip(
        atr_distance_series.tail(cfg.history_bars),
        below.tail(cfg.history_bars),
        broken.tail(cfg.history_bars),
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
def compute_tpr(
    price_data: pd.DataFrame,
    benchmark_close: Optional[pd.Series] = None,
    with_history: bool = False,
    confirm_bars: Optional[int] = None,
    cfg: BandConfig = DAILY,
    with_breakdown: bool = False,
) -> Dict[str, object]:
    """Score the 8-point Trend Template per bar; map the count to a phase color,
    debounced so the band paints smooth regime blocks like the real MM360 chart.
    Roll-over demotion flips hard (no delay), matching MM360's quick fade."""
    confirm_bars = cfg.tpr_confirm if confirm_bars is None else confirm_bars
    if len(price_data) < cfg.min_bars:
        return {"tpr_state": None, "tpr_score": None}

    close = price_data["Close"]
    sma50 = close.rolling(cfg.tpr_ma_fast).mean()
    sma150 = close.rolling(cfg.tpr_ma_mid).mean()
    sma200 = close.rolling(cfg.tpr_ma_slow).mean()
    hi52 = price_data["High"].rolling(cfg.tpr_hl_window).max()
    lo52 = price_data["Low"].rolling(cfg.tpr_hl_window).min()
    slow_slope_bars = max(1, cfg.tpr_ma_slow // 9)  # ~1-month slope of the slow MA

    def score_at(i: int) -> int:
        c = close.iloc[i]
        s50, s150, s200 = sma50.iloc[i], sma150.iloc[i], sma200.iloc[i]
        if any(pd.isna(x) for x in (s50, s150, s200)):
            return 0
        conds = [
            c > s150 and c > s200,                         # 1 price above mid & slow
            s150 > s200,                                   # 2 mid above slow
            (i >= slow_slope_bars and s200 > sma200.iloc[i - slow_slope_bars]),  # 3 slow rising
            s50 > s150 and s50 > s200,                     # 4 fast above mid & slow
            c > s50,                                       # 5 price above fast
            c >= lo52.iloc[i] * 1.30,                      # 6 >=30% above 52w low
            c <= hi52.iloc[i] and c >= hi52.iloc[i] * 0.75,  # 7 within 25% of 52w high
        ]
        return sum(bool(x) for x in conds)

    sma50_slope = sma50 - sma50.shift(cfg.tpr_dir_slope_bars)

    def _color_from_score(i: int, s7: int) -> str:
        """7-cond template level, with trend direction splitting the borderline
        (5-6) zone between strong and weak (see TPR color notes)."""
        if s7 >= TPR_STRONG_RAW:
            return "strong"
        if s7 <= TPR_WEAK_RAW:
            return "weak"
        above = close.iloc[i] > sma50.iloc[i]
        rising = sma50_slope.iloc[i] > 0
        near_high = close.iloc[i] >= hi52.iloc[i] * TPR_STRONG_NEAR_HIGH
        if above and rising and near_high:
            return "strong"
        if (not above) and (not rising):
            return "weak"
        return "transition"

    r5, r10 = cfg.tpr_demote_r5_bars, cfg.tpr_demote_r10_bars

    def _rolling_over(i: int) -> bool:
        """A perfect-template bar fading from highs: a material short- and
        medium-window pullback (thresholds keep the strip smooth, not flickery)."""
        if i - r10 < 0:
            return False
        p5, p10 = close.iloc[i - r5], close.iloc[i - r10]
        if p5 <= 0 or p10 <= 0:
            return False
        return (close.iloc[i] / p5 - 1) <= TPR_DEMOTE_R5 and (close.iloc[i] / p10 - 1) <= TPR_DEMOTE_R10

    # 8th condition (RS) as a per-bar series so the band history and the live
    # badge use identical logic (previously RS was current-bar only).
    rs_series = None
    hl = cfg.tpr_hl_window
    if benchmark_close is not None and len(benchmark_close) >= hl + 1:
        bench = benchmark_close.reindex(close.index).ffill()
        rs_line = close / bench
        if len(rs_line.dropna()) >= hl + 1:
            rs_series = (rs_line > rs_line.shift(hl)) & (rs_line > rs_line.rolling(cfg.tpr_ma_fast).mean())
    max_score = 8 if rs_series is not None else 7

    def full_score(i: int) -> int:
        s = score_at(i)
        if rs_series is not None and bool(rs_series.iloc[i]):
            s += 1
        return s

    n = len(close)
    start = max(0, n - cfg.history_bars)
    raw: List[str] = []
    hard: List[bool] = []
    for i in range(start, n):
        s7 = score_at(i)                       # 7-cond level drives the COLOR
        st = _color_from_score(i, s7)
        roll = st == "strong" and s7 >= TPR_STRONG_RAW and _rolling_over(i)
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
    if with_breakdown:
        # The 8-point Trend Template checklist for the LATEST bar, using the same
        # conditions the band scores — so the scorecard the UI shows can never
        # disagree with the TPR colour. Additive: only present when asked, so the
        # frozen band/golden metrics (default callers) are byte-unchanged.
        i = n - 1
        c = close.iloc[i]
        s50, s150, s200 = sma50.iloc[i], sma150.iloc[i], sma200.iloc[i]
        ma_ok = not any(pd.isna(x) for x in (s50, s150, s200))
        conds = [
            ("price_above_150_200", "価格 > 150日・200日線", ma_ok and c > s150 and c > s200),
            ("ma_150_above_200", "150日線 > 200日線", ma_ok and s150 > s200),
            ("ma_200_rising", "200日線が上向き（約1か月）",
             ma_ok and i >= slow_slope_bars and s200 > sma200.iloc[i - slow_slope_bars]),
            ("ma_50_above_150_200", "50日線 > 150日・200日線", ma_ok and s50 > s150 and s50 > s200),
            ("price_above_50", "価格 > 50日線", ma_ok and c > s50),
            ("above_52w_low_30", "52週安値から +30% 以上", c >= lo52.iloc[i] * 1.30),
            ("within_52w_high_25", "52週高値から 25% 以内", c <= hi52.iloc[i] and c >= hi52.iloc[i] * 0.75),
        ]
        if rs_series is not None:
            conds.append(("rs_line_rising", "RSライン上昇（対ベンチマーク）", bool(rs_series.iloc[i])))
        out["tpr_conditions"] = [
            {"key": k, "label": lbl, "passed": bool(v)} for (k, lbl, v) in conds
        ]
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def calculate_bands(
    price_data: pd.DataFrame,
    benchmark_close: Optional[pd.Series] = None,
    with_history: bool = False,
    cfg: BandConfig = DAILY,
) -> Dict[str, object]:
    """Compute all three MM360-style bands for one symbol.

    Args:
        price_data: OHLCV DataFrame (Date index; Open/High/Low/Close/Volume).
        benchmark_close: optional benchmark Close series (e.g. SPY/^GSPC) for
            the RS condition in TPR. If omitted, TPR uses 7 conditions.
        with_history: also return per-bar *_history lists for rendering bands.
        cfg: timeframe period config (``DAILY`` default, ``WEEKLY`` for a weekly
            chart computed on already-resampled weekly bars; see ``to_weekly``).
    """
    if price_data is None or price_data.empty:
        return {}

    result: Dict[str, object] = {}
    try:
        result.update(compute_pressure(price_data, with_history=with_history, cfg=cfg))
    except Exception as e:  # never let one band break the others
        logger.debug(f"pressure band failed: {e}")
    try:
        result.update(compute_buy_risk(price_data, with_history=with_history, cfg=cfg))
    except Exception as e:
        logger.debug(f"buy_risk band failed: {e}")
    try:
        result.update(compute_tpr(price_data, benchmark_close, with_history=with_history, cfg=cfg))
    except Exception as e:
        logger.debug(f"tpr band failed: {e}")
    return result
