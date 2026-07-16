"""General-market regime assessment — Minervini's first rule.

Minervini/O'Neil: *only buy when the general market is in a confirmed uptrend, and
scale exposure to market health.* This module scores the market from the index
(benchmark) OHLCV alone — no external feed — so the screener can gate and
down-weight buy signals by regime.

Signals (all from the index daily OHLCV):
- Trend: close > 50DMA > 200DMA with a rising 50DMA  (the index in its own Stage 2)
- Distribution days: O'Neil's institutional-selling tell — index down >= 0.2% on
  volume above the prior session, plus STALLING days (churn: heavy-volume up
  sessions making no real headway near highs). Counted over the last ~25
  sessions; a day EXPIRES early once the index rallies 5% above its close.
  4+ = under pressure, 6+ = topping/correction risk (DIST_* constants below).
- Follow-through day: the O'Neil bottom confirmation that re-enables buying
  weeks before the MA structure can recover (detect_follow_through).
- Position vs the 21EMA / 50DMA and drawdown from the recent high.

Output is a label, a 0-100 health score, and a suggested equity exposure %, which
the screener maps onto each candidate.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd

DIST_WINDOW = 25            # sessions to count distribution days over
DIST_DOWN_PCT = -0.002      # a down day of >= 0.2% counts
DIST_UNDER_PRESSURE = 4     # >= this many = uptrend under pressure
DIST_CORRECTION = 6         # >= this many = distribution-driven correction risk
# O'Neil expiry: a distribution day stops counting once the index rallies 5%
# above that day's close — institutional selling that the market has already
# absorbed and left behind is no longer a warning.
DIST_EXPIRY_RALLY = 0.05
# Stalling day (churn): an up session that makes no real headway (<= +0.2%) on
# volume above the prior session, closing in the lower half of its range while
# near the highs — heavy selling INTO strength. O'Neil counts it as
# distribution. The exact IBD definition is proprietary; this is a documented
# approximation of its published description.
STALL_MAX_GAIN = 0.002
STALL_NEAR_HIGH_PCT = 0.03  # within 3% of the 25-session high

REGIME_EXPOSURE = {
    "confirmed_uptrend": 100,
    "uptrend_under_pressure": 55,
    "correction": 20,
    "downtrend": 0,
}

# Breadth-divergence guard (C80): a confirmed_uptrend with the index within 3%
# of its 52w high while fewer than this % of the tradable universe holds its
# 200DMA is a narrow distribution top — downgraded to under-pressure. 40% is
# the mirror of the conventional 60% healthy-majority line; 3% = "at the highs".
BREADTH_ROT_PCT = 40.0
BREADTH_DIVERGENCE_NEAR_HIGH = 0.03

# --- Follow-through day (O'Neil's bottom-confirmation signal) ---------------
# After a correction low, day 1 of a rally attempt is the first up close; a
# follow-through is a >= +1.2% index gain on volume above the prior session,
# landing on attempt day 4 or later (canonically days 4-7, accepted to ~15).
# An FTD is the EARLIEST valid all-clear — MA structure recovers weeks later,
# which is exactly why regimes derived from MAs alone are late at bottoms.
FTD_MIN_GAIN = 0.012        # +1.2% (modern IBD threshold)
FTD_MIN_DAY = 4             # earliest attempt day that can confirm
FTD_MAX_DAY = 15            # a "follow-through" past ~3 weeks is stale
FTD_LOOKBACK = 120          # sessions searched for the correction low
FTD_MIN_DECLINE = 0.06      # the low must cap a >= 6% decline to need an FTD
# Progressive exposure after an FTD (Minervini/IBD Market School: probe with
# pilot buys, add only as the rally proves itself; full size belongs to a
# mature uptrend whose MA structure has recovered — the base-regime path).
# True progressive exposure feeds on per-position traction, which a market
# scan cannot see; rally AGE + post-FTD distribution is the honest stateless
# proxy: fresh confirmation -> 25%, surviving 1 week -> 50%, surviving 3 weeks
# clean (<= 2 new distribution days) -> 75%.
FTD_EXPOSURE_FRESH = 25     # sessions 0-4 after the FTD
FTD_EXPOSURE_WEEK = 50      # sessions 5-14
FTD_EXPOSURE_PROVEN = 75    # 15+ sessions with <= 2 distribution days since


def _ftd_exposure(days_since: int, dist_since: int) -> int:
    if days_since < 5:
        return FTD_EXPOSURE_FRESH
    if days_since < 15:
        return FTD_EXPOSURE_WEEK
    return FTD_EXPOSURE_PROVEN if dist_since <= 2 else FTD_EXPOSURE_WEEK


def _distribution_days(
    close: pd.Series,
    volume: pd.Series,
    window: int = DIST_WINDOW,
    high: Optional[pd.Series] = None,
    low: Optional[pd.Series] = None,
) -> int:
    """Count live distribution days over the trailing ``window`` sessions.

    O'Neil-faithful counting:
      - classic distribution: down >= 0.2% on volume above the prior session
      - stalling (churn): up <= +0.2% on higher volume, closing in the lower
        half of the day's range while within 3% of the recent high (needs
        High/Low; skipped when unavailable)
      - expiry: a flagged day stops counting once ANY later close is 5% above
        that day's close (the market absorbed the selling and moved on)
    """
    ret = close.pct_change(fill_method=None)
    vol_up = volume > volume.shift(1)
    dist = (ret <= DIST_DOWN_PCT) & vol_up

    if high is not None and low is not None:
        rng = high - low
        lower_half = (close - low) <= 0.5 * rng.where(rng > 0)
        near_high = close >= close.rolling(window, min_periods=1).max() * (1 - STALL_NEAR_HIGH_PCT)
        stalling = (ret > 0) & (ret <= STALL_MAX_GAIN) & vol_up & lower_half.fillna(False) & near_high
        dist = dist | stalling

    flagged = dist.tail(window)
    closes = close.tail(window)
    count = 0
    values = close.to_numpy(dtype="float64")
    offset = len(close) - len(flagged)
    for j, (is_dist, c0) in enumerate(zip(flagged.to_numpy(), closes.to_numpy(dtype="float64"))):
        if not is_dist:
            continue
        # expired if any later close rallied 5% above this day's close
        later = values[offset + j + 1:]
        if later.size and (later >= c0 * (1 + DIST_EXPIRY_RALLY)).any():
            continue
        count += 1
    return int(count)


def detect_follow_through(index_ohlcv: Optional[pd.DataFrame]) -> Optional[Dict[str, object]]:
    """Detect a live O'Neil follow-through day off the latest correction low.

    Stateless: recomputed from the index OHLCV tail each call. Returns None
    when there is no valid, still-standing FTD; otherwise a dict with the
    confirmation metadata:

      date            FTD session timestamp
      attempt_day     rally-attempt day it landed on (>= FTD_MIN_DAY)
      gain_pct        the FTD session's % gain
      days_since      sessions elapsed since the FTD
      dist_since_ftd  distribution days AFTER the FTD (the count resets at a
                      confirmation — stale pre-FTD distribution must not kill
                      a brand-new uptrend)

    Failure handling is built in: a close below the FTD session's low is the
    classic failed-follow-through circuit breaker and returns None.
    """
    if (
        index_ohlcv is None
        or "Close" not in getattr(index_ohlcv, "columns", [])
        or len(index_ohlcv) < FTD_MIN_DAY + 2
    ):
        return None
    tail = index_ohlcv.tail(FTD_LOOKBACK)
    closes = tail["Close"].to_numpy(dtype="float64")
    vols = (
        tail["Volume"].to_numpy(dtype="float64")
        if "Volume" in tail.columns else np.ones(len(tail))
    )
    lows = (
        tail["Low"].to_numpy(dtype="float64")
        if "Low" in tail.columns else closes
    )

    low_pos = int(lows.argmin())
    if low_pos < 1 or low_pos >= len(closes) - FTD_MIN_DAY:
        return None
    # The low must cap a real decline — an FTD off a shallow dip is noise.
    prior_high = float(closes[:low_pos].max())
    if prior_high <= 0 or (prior_high - closes[low_pos]) / prior_high < FTD_MIN_DECLINE:
        return None

    # Rally attempt day 1 = the first up close after the low session.
    day1 = None
    for i in range(low_pos + 1, len(closes)):
        if closes[i] > closes[i - 1]:
            day1 = i
            break
    if day1 is None:
        return None

    for i in range(day1, len(closes)):
        attempt_day = i - day1 + 1
        if attempt_day < FTD_MIN_DAY:
            continue
        if attempt_day > FTD_MAX_DAY:
            return None
        gain = closes[i] / closes[i - 1] - 1.0
        if gain >= FTD_MIN_GAIN and vols[i] > vols[i - 1]:
            # Circuit breaker: any later close under the FTD session's low.
            if (closes[i + 1:] < lows[i]).any():
                return None
            after = tail.iloc[i:]
            after_vol = (
                after["Volume"] if "Volume" in after.columns
                else pd.Series(1.0, index=after.index)
            )
            return {
                "date": tail.index[i],
                "attempt_day": int(attempt_day),
                "gain_pct": round(float(gain) * 100.0, 2),
                "days_since": int(len(closes) - 1 - i),
                "dist_since_ftd": _distribution_days(
                    after["Close"], after_vol,
                    high=after.get("High"), low=after.get("Low"),
                ),
            }
    return None


def assess_market_regime(
    index_ohlcv: Optional[pd.DataFrame],
    breadth_pct_above_200dma: Optional[float] = None,
) -> Dict[str, object]:
    """Assess the general-market regime from the index/benchmark OHLCV.

    ``breadth_pct_above_200dma`` (0-100, optional): fraction of the tradable
    universe above its 200DMA. When supplied and ROTTEN (<40% — the mirror of
    the conventional 60% healthy-majority line), a confirmed_uptrend is
    downgraded to uptrend_under_pressure: a cap-weighted index can print highs
    on a few mega-caps while the majority of stocks break down (a classic
    distribution top the index-only read misses). None = index-only behaviour,
    byte-identical to before (the 908 GATE harness supplies no breadth).
    Two-window validated at C80 before shipping.

    Returns: {regime, health (0-100), exposure_pct (0-100), distribution_days,
    above_50dma, above_200dma, fifty_above_200, pct_from_high, breadth_pct_above_200dma,
    components}. All keys are None/empty when there is insufficient data.
    """
    empty = {
        "regime": None, "health": None, "exposure_pct": None,
        "distribution_days": None, "above_50dma": None, "above_200dma": None,
        "fifty_above_200": None, "pct_from_high": None,
        "breadth_pct_above_200dma": None,
    }
    if index_ohlcv is None or "Close" not in getattr(index_ohlcv, "columns", []) or len(index_ohlcv) < 200:
        return empty

    close = index_ohlcv["Close"]
    volume = index_ohlcv["Volume"] if "Volume" in index_ohlcv.columns else pd.Series(1.0, index=close.index)
    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()
    ema21 = close.ewm(span=21, adjust=False).mean()

    c = float(close.iloc[-1])
    s50, s200 = float(sma50.iloc[-1]), float(sma200.iloc[-1])
    s50_rising = bool(sma50.iloc[-1] > sma50.iloc[-21]) if len(sma50.dropna()) > 21 else True
    above_50 = c > s50
    above_200 = c > s200
    fifty_above_200 = s50 > s200
    above_21 = c > float(ema21.iloc[-1])
    hi = float(close.tail(252).max())
    pct_from_high = (hi - c) / hi if hi > 0 else 0.0
    dist = _distribution_days(
        close, volume,
        high=index_ohlcv.get("High"), low=index_ohlcv.get("Low"),
    )

    trend_ok = above_50 and fifty_above_200 and s50_rising and above_200

    if trend_ok and dist < DIST_UNDER_PRESSURE:
        regime = "confirmed_uptrend"
    elif trend_ok:
        # Heavy distribution with an INTACT trend is "under pressure", not a
        # correction: IBD's market pulse only flips to "market in correction"
        # on price damage (indexes undercutting key levels). The C55 backtest
        # audit caught the old mapping calling 124 of 140 "correction" days
        # while SPY sat within 3% of its high, purely because the
        # distribution count crossed the threshold — capping exposure at 20%
        # through most of a +19.5% SPY year.
        regime = "uptrend_under_pressure"
    elif above_200 and not (c < s200 and s50 < s200):
        # above the 200DMA but the clean trend is broken: losing the 50-day
        # is the price damage that makes it a correction; otherwise it is
        # still only pressure.
        regime = "correction" if not above_50 else "uptrend_under_pressure"
    else:
        regime = "downtrend"

    # Breadth-DIVERGENCE guard (C80): only when the index is AT ITS HIGHS
    # (within 3% of the 52w high) while fewer than 40% of the universe holds its
    # 200DMA — the definition of a narrow distribution top. The near-highs
    # condition is essential: without it the guard fires at post-FTD BOTTOMS
    # where breadth is still rebuilding (the most profitable moment to be long)
    # — both backtest windows collapsed under that unfaithful first cut.
    # Neutral when breadth is unknown.
    if (
        regime == "confirmed_uptrend"
        and breadth_pct_above_200dma is not None
        and breadth_pct_above_200dma < BREADTH_ROT_PCT
        and pct_from_high <= BREADTH_DIVERGENCE_NEAR_HIGH
    ):
        regime = "uptrend_under_pressure"

    # Follow-through day: the MA-derived read above is inherently WEEKS late at
    # bottoms (structure can't recover before price does). O'Neil/Minervini
    # re-enter on the FTD, with pilot-sized buys. A live FTD upgrades a
    # correction/downtrend to a confirmed uptrend at pilot exposure — unless
    # distribution has already piled up again since the confirmation (the
    # distribution count resets at an FTD).
    ftd = None
    exposure_pct = REGIME_EXPOSURE[regime]
    if regime in ("correction", "downtrend"):
        ftd = detect_follow_through(index_ohlcv)
        if ftd is not None and ftd["dist_since_ftd"] < DIST_CORRECTION:
            regime = "confirmed_uptrend"
            exposure_pct = _ftd_exposure(int(ftd["days_since"]), int(ftd["dist_since_ftd"]))
        else:
            ftd = None

    # 0-100 health: trend structure (50) + distribution penalty (30) + drawdown (20).
    health = 0.0
    health += 25 if above_200 else 0
    health += 10 if fifty_above_200 else 0
    health += 8 if above_50 else 0
    health += 7 if above_21 else 0
    health += max(0.0, 30.0 * (1.0 - dist / float(DIST_CORRECTION + 2)))
    health += max(0.0, 20.0 * (1.0 - pct_from_high / 0.15))  # full marks within ~0% of high, 0 at >=15% off
    health = float(max(0.0, min(100.0, health)))

    return {
        "regime": regime,
        "health": round(health, 1),
        "exposure_pct": exposure_pct,
        "distribution_days": dist,
        "above_50dma": above_50,
        "above_200dma": above_200,
        "fifty_above_200": fifty_above_200,
        "pct_from_high": round(float(pct_from_high) * 100, 2),
        "breadth_pct_above_200dma": (
            round(float(breadth_pct_above_200dma), 1)
            if breadth_pct_above_200dma is not None else None
        ),
        "components": {
            "trend_ok": trend_ok, "above_21ema": above_21, "fifty_rising": s50_rising,
            "follow_through": (
                {**ftd, "date": str(ftd["date"].date() if hasattr(ftd["date"], "date") else ftd["date"])}
                if ftd else None
            ),
        },
    }
