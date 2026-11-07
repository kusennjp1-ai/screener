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


# ── Round 2: a sideways base above a rising 200-day line is stage 2 ──────────


def _textbook_vcp(weeks=7, depths=(15, 8, 4), advance=250, daily=0.0035):
    """250 sessions of +0.35%/day, then a contracting base ending 1% under its high.

    The same series as the audit's stage probe (audit2/sepa/stage-probe-output.txt):
    with weeks=7 and depths 15/8/4 the 200-day line rises about 5% over 19 bars and
    the 60-bar slope is 0.043%/day, which the 0.05%/day rule reads as sideways.
    """
    closes, price = [], 50.0
    for _ in range(advance):
        price *= 1 + daily
        closes.append(price)
    top, length = price, weeks * 5
    segment = length // len(depths)
    for depth in depths:
        for j in range(segment):
            closes.append(top * (1 - depth / 100 * np.sin(np.pi * j / segment)))
    closes[-1] = top * 0.99
    return pd.Series(closes)


def _stage_of(chrono, *, with_structure=True, highs=None):
    analyzer = WeinsteinstageAnalyzer()
    ma_200_chrono = chrono.rolling(window=200, min_periods=200).mean()
    highs = chrono * 1.005 if highs is None else highs
    extra = dict(
        ma_150=float(chrono.rolling(150).mean().iloc[-1]),
        high_52w=float(highs.tail(252).max()),
    ) if with_structure else {}
    return analyzer.determine_stage(
        float(chrono.iloc[-1]),
        float(ma_200_chrono.iloc[-1]),
        ma_200_chrono[::-1].reset_index(drop=True),
        chrono[::-1].reset_index(drop=True),
        **extra,
    )


def test_the_audit_probe_vector_is_a_stage_2_base():
    result = _stage_of(_textbook_vcp())
    assert result["ma_200_trend"] == "rising"
    assert result["price_trend"] == "sideways"
    assert result["stage"] == 2


def test_without_the_structure_inputs_the_classification_is_unchanged():
    # Callers that pass only the four original inputs (the market-history replay, the
    # technical API) keep the earlier rule: a sideways stretch above a rising line is 3.
    assert _stage_of(_textbook_vcp(), with_structure=False)["stage"] == 3


def test_a_sideways_stretch_above_a_flat_or_falling_200_day_line_is_stage_3():
    flat = pd.Series([100 + np.sin(i / 7) for i in range(400)])
    result = _stage_of(flat)
    assert result["ma_200_trend"] == "flat"
    assert result["stage"] in (1, 3)
    # Above the flat line it is a top, never a stage-2 base.
    above = pd.Series([100 + 0.002 * i if i < 300 else 101.5 + np.sin(i / 5) * 0.3 for i in range(400)])
    topping = _stage_of(above)
    assert topping["ma_200_trend"] in ("flat", "falling")
    assert topping["stage"] != 2


def test_a_close_under_the_150_day_line_with_swings_is_stage_3():
    base = _textbook_vcp(weeks=10, depths=(20, 10, 5)).tolist()
    # Swing around the 150-day line, between it and the still-rising 200-day line.
    sma150 = float(pd.Series(base).rolling(150).mean().iloc[-1])
    sma200 = float(pd.Series(base).rolling(200).mean().iloc[-1])
    middle = (sma150 + sma200) / 2
    chrono = pd.Series(base + [middle * (1 + 0.012 * np.sin(i / 2)) for i in range(25)])
    for _ in range(5):  # settle the last close between the two lines it moves
        chrono.iloc[-1] = (chrono.rolling(150).mean().iloc[-1] + chrono.rolling(200).mean().iloc[-1]) / 2
    result = _stage_of(chrono)
    last = float(chrono.iloc[-1])
    assert float(chrono.rolling(200).mean().iloc[-1]) < last < float(chrono.rolling(150).mean().iloc[-1])
    assert result["ma_200_trend"] == "rising"
    assert result["price_trend"] != "uptrend"
    assert result["stage"] == 3


def test_a_sideways_stretch_far_from_the_52_week_high_is_not_a_base():
    chrono = _textbook_vcp()
    # The same closes, but a 52-week high 40% above the last close (a spike in the window).
    highs = chrono * 1.005
    highs.iloc[-100] = float(chrono.iloc[-1]) * 1.4
    assert _stage_of(chrono, highs=highs)["stage"] == 3


def test_a_base_with_fewer_than_252_bars_reads_its_high_over_the_bars_there_are():
    # The same 230-session vector as briefChartModel.test.js ('reads the 52-week high over the
    # bars there are'): 195 sessions at +0.35%/day, then a base contracting 15/8/4%. The scanner
    # takes the High of the last 252 sessions or of as many as exist (tail(252).max()), and the
    # stock view takes the same window, so both read stage 2 (base) here.
    closes, price = [], 50.0
    for _ in range(195):
        price *= 1.0035
        closes.append(price)
    top = price
    for depth in (15, 8, 4):
        for j in range(11):
            closes.append(top * (1 - depth / 100 * np.sin(np.pi * j / 11)))
    while len(closes) < 230:
        closes.append(top * 0.99)
    closes[-1] = top * 0.99
    chrono = pd.Series(closes)
    assert len(chrono) == 230
    result = _stage_of(chrono)
    assert result["ma_200_trend"] == "rising"
    assert result["price_trend"] == "sideways"
    assert result["stage"] == 2
