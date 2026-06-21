"""Unit tests for the Accumulation/Distribution rating calculator."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.scanners.criteria.accumulation_distribution import (
    AccumulationDistributionCalculator,
    letter_for_score,
)


def _ohlcv(close_loc: float, n: int = 70, vol: float = 1_000_000.0) -> pd.DataFrame:
    """Build OHLCV where each session closes at ``close_loc`` of its range.

    close_loc=1.0 closes on the high (accumulation), 0.0 on the low
    (distribution), 0.5 at the midpoint (neutral).
    """
    low = np.full(n, 100.0)
    high = low + 2.0
    close = low + close_loc * (high - low)
    return pd.DataFrame({"High": high, "Low": low, "Close": close, "Volume": [vol] * n})


def test_persistent_accumulation_scores_top():
    score = AccumulationDistributionCalculator().calculate_acc_dis_score(_ohlcv(1.0))
    assert score is not None and score >= 95
    assert letter_for_score(score) == "A"


def test_persistent_distribution_scores_bottom():
    score = AccumulationDistributionCalculator().calculate_acc_dis_score(_ohlcv(0.0))
    assert score is not None and score <= 5
    assert letter_for_score(score) == "E"


def test_neutral_action_scores_middle():
    score = AccumulationDistributionCalculator().calculate_acc_dis_score(_ohlcv(0.5))
    assert score is not None and 45 <= score <= 55
    assert letter_for_score(score) == "C"


def test_recent_accumulation_is_weighted_more_heavily():
    calc = AccumulationDistributionCalculator()
    neutral = calc.calculate_acc_dis_score(_ohlcv(0.5))
    df = _ohlcv(0.5)
    df.loc[df.index[-20:], "Close"] = df["High"]  # last 20 sessions accumulate
    assert calc.calculate_acc_dis_score(df) > neutral


def test_insufficient_history_returns_none():
    assert AccumulationDistributionCalculator().calculate_acc_dis_score(_ohlcv(1.0, n=5)) is None


def test_zero_range_sessions_return_none():
    flat = pd.DataFrame(
        {"High": [100.0] * 70, "Low": [100.0] * 70, "Close": [100.0] * 70, "Volume": [1e6] * 70}
    )
    assert AccumulationDistributionCalculator().calculate_acc_dis_score(flat) is None


def test_missing_columns_return_none():
    df = pd.DataFrame({"High": [1.0] * 70, "Low": [0.0] * 70, "Close": [0.5] * 70})
    assert AccumulationDistributionCalculator().calculate_acc_dis_score(df) is None


def test_letter_buckets():
    assert [letter_for_score(s) for s in (85, 70, 50, 30, 10)] == ["A", "B", "C", "D", "E"]
    assert letter_for_score(None) is None
