"""Regression tests for Weinstein stage detection.

These pin the orientation contract: the analyzer is fed *most-recent-first*
price series (as both callers do), and a clean uptrend must read as Stage 2.
A sign-inverted price-trend regression previously demoted strong Stage-2
leaders to Stage 3, so the backtest caught almost none of Minervini's winners.
"""
import numpy as np
import pandas as pd

from app.scanners.criteria.stage_analysis import WeinsteinstageAnalyzer


def _uptrend_chrono(n=320, start=50.0, end=200.0):
    """A steady chronological (oldest-first) uptrend."""
    return pd.Series(np.linspace(start, end, n))


def test_price_trend_uptrend_on_most_recent_first_input():
    analyzer = WeinsteinstageAnalyzer()
    chrono = _uptrend_chrono()
    most_recent_first = chrono[::-1].reset_index(drop=True)

    # The series rises over time, so as-of-today it is an uptrend regardless of
    # which end we index from; the analyzer must not invert the slope.
    assert analyzer.calculate_price_trend(most_recent_first, lookback=60) == "uptrend"


def test_price_trend_downtrend_on_most_recent_first_input():
    analyzer = WeinsteinstageAnalyzer()
    chrono = _uptrend_chrono(start=200.0, end=50.0)  # declining
    most_recent_first = chrono[::-1].reset_index(drop=True)

    assert analyzer.calculate_price_trend(most_recent_first, lookback=60) == "downtrend"


def test_clean_uptrend_classifies_as_stage_2():
    analyzer = WeinsteinstageAnalyzer()
    chrono = _uptrend_chrono()
    ma_200_chrono = chrono.rolling(window=200, min_periods=200).mean()

    current_price = float(chrono.iloc[-1])
    ma_200 = float(ma_200_chrono.iloc[-1])
    prices = chrono[::-1].reset_index(drop=True)          # most-recent-first
    ma_200_series = ma_200_chrono[::-1].reset_index(drop=True)
    volumes = pd.Series(np.full(len(chrono), 1_000_000))[::-1].reset_index(drop=True)

    result = analyzer.determine_stage(current_price, ma_200, ma_200_series, prices, volumes)

    assert current_price > ma_200  # sanity: price above the 200-day MA
    assert result["price_trend"] == "uptrend"
    assert result["ma_200_trend"] == "rising"
    assert result["stage"] == 2
