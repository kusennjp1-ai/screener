"""
Accumulation/Distribution (Acc/Dis) Rating.

Approximates IBD's A–E Accumulation/Distribution Rating, which gauges whether a
stock is under net institutional buying (accumulation) or selling
(distribution) over roughly the trailing 13 weeks, weighting recent action more
heavily.

Methodology (a documented proxy for IBD's proprietary rating):
- Each session gets a directional money-flow multiplier: a close-to-close UP day
  = +1 (accumulation), a DOWN day = -1 (distribution), and an unchanged day
  falls back to the Close Location Value (CLV = ((Close-Low)-(High-Close)) /
  (High-Low), +1 = closed on the high). This follows O'Neil/Minervini: the
  institutional footprint is heavy volume on UP days, not the average intraday
  close-location — a pure-CLV average compressed nearly every name to ~50 ("C").
- Weight each session's multiplier by recency (linear, most recent ~2x the
  oldest) AND volume, and aggregate into a money-flow ratio in [-1, +1].
- Map the ratio onto a 0–99 score and an A–E letter grade:
  A >= 80, B 60-79, C 40-59, D 20-39, E < 20.

Note (scripts/measure_accdis_discrimination.py, measure_udvr_discrimination.py):
even faithfully computed, accumulation is a WEAK entry-timing discriminator on
Minervini's 908 real trades (~+7.6pp entry-vs-control at score>=60, vs VCP-detect
+27.5pp / trend-template ~+30pp / SETUP +52pp) — by the time a name is a Stage-2
setup it is already accumulated, and so is the control. Use it as CONFIRMATION,
not as a primary screen axis.

The calculation is self-contained per stock (no universe needed), so it can run
alongside the per-stock metrics in the scan orchestrator.
"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# 13 weeks of trading sessions (~5 sessions/week).
DEFAULT_PERIOD = 65
# Letter-grade cutoffs on the 0-99 score, mirroring IBD's A-E buckets.
_LETTER_CUTOFFS = ((80, "A"), (60, "B"), (40, "C"), (20, "D"))


def letter_for_score(score: int | float | None) -> Optional[str]:
    """Map a 0-99 Acc/Dis score onto an A-E letter grade."""
    if score is None:
        return None
    for cutoff, letter in _LETTER_CUTOFFS:
        if score >= cutoff:
            return letter
    return "E"


class AccumulationDistributionCalculator:
    """Calculate a 0-99 Accumulation/Distribution score from OHLCV data."""

    def calculate_acc_dis_score(
        self,
        price_data: pd.DataFrame,
        period: int = DEFAULT_PERIOD,
        min_valid_rows: int | None = None,
    ) -> Optional[int]:
        """Return a recency-weighted Acc/Dis score in [0, 99], or None.

        Args:
            price_data: DataFrame with High, Low, Close, Volume columns in
                chronological order (oldest first).
            period: Number of trailing sessions to evaluate (default ~13 weeks).
            min_valid_rows: Minimum number of valid sessions required. Defaults
                to 60% of ``period`` so partial-history names still rate.

        Returns:
            Integer 0-99 (higher = stronger accumulation) or None when there is
            not enough clean data.
        """
        try:
            required_cols = ["High", "Low", "Close", "Volume"]
            if not all(col in price_data.columns for col in required_cols):
                logger.warning(
                    "Missing required columns for Acc/Dis. Need %s", required_cols
                )
                return None

            if len(price_data) < (min_valid_rows or max(1, int(period * 0.6))):
                return None

            recent = price_data.tail(period)
            high = recent["High"].to_numpy(dtype="float64")
            low = recent["Low"].to_numpy(dtype="float64")
            close = recent["Close"].to_numpy(dtype="float64")
            volume = recent["Volume"].to_numpy(dtype="float64")

            span = high - low
            valid = (
                np.isfinite(high)
                & np.isfinite(low)
                & np.isfinite(close)
                & np.isfinite(volume)
                & (volume > 0)
                & (span > 0)
            )

            required_valid = (
                min_valid_rows if min_valid_rows is not None else max(1, int(period * 0.6))
            )
            if int(valid.sum()) < required_valid:
                return None

            # Close Location Value in [-1, +1]; +1 = closed on the high.
            clv = np.zeros_like(close)
            clv[valid] = ((close[valid] - low[valid]) - (high[valid] - close[valid])) / span[valid]

            # O'Neil/Minervini accumulation footprint: institutions push price UP
            # on heavy volume. Score by close-to-close DIRECTION (up day = +1,
            # down day = -1) so up-volume accumulates and down-volume distributes;
            # on unchanged days fall back to the intraday close-location (CLV).
            # The pure-CLV average compressed nearly every name to ~50 ("C") and
            # barely separated Minervini's real entries from a T0-63 control
            # (scripts/measure_accdis_discrimination.py: A 0% / B 8% / C 92%);
            # direction is faithful to IBD's price-and-volume method and spreads
            # the rating. Synthetic flat-close inputs fall through to CLV, so the
            # documented close-location behaviour is preserved.
            change = np.zeros_like(close)
            change[1:] = close[1:] - close[:-1]
            mult = np.where(change > 0, 1.0, np.where(change < 0, -1.0, clv))
            mult = np.where(valid, mult, 0.0)

            # Linear recency weights: oldest valid session ~1x, newest ~2x.
            n = len(recent)
            recency = np.linspace(1.0, 2.0, num=n)
            weights = recency * volume * valid

            denom = weights.sum()
            if denom <= 0:
                return None

            money_flow_ratio = float((mult * weights).sum() / denom)  # [-1, +1]
            money_flow_ratio = max(-1.0, min(1.0, money_flow_ratio))

            score = int(round((money_flow_ratio + 1.0) / 2.0 * 99))
            return max(0, min(99, score))

        except Exception as e:  # pragma: no cover - defensive
            logger.error("Error calculating Acc/Dis score: %s", e, exc_info=True)
            return None
