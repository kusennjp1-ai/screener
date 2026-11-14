"""Central breakout-readiness feature computation for Setup Engine.

This module computes readiness primitives once so scanner/report layers can
reuse a single deterministic implementation.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.analysis.patterns.config import (
    ACTIVITY_ADR_SESSIONS,
    CONTRACTION_ATR_MULTIPLE,
    CONTRACTION_ATR_SESSIONS,
    CONTRACTION_DEPTH_FRACTION,
    CONTRACTION_FINAL_FLOOR_PCT,
    CONTRACTION_LOOKBACK_SESSIONS,
    CONTRACTION_MAX_LEGS,
    CONTRACTION_REPAIR_FRACTION,
    GAP_MOVE_PERCENT,
    LOW_ADR_PERCENT,
    LOW_RANGE_PERCENT,
    PIVOT_ALREADY_CROSSED_PCT,
    PIVOT_BELOW_BASE_HIGH_PCT,
    PRICE_ACTIVITY_SESSIONS,
    SINCE_GAP_MIN_SESSIONS,
    SINCE_GAP_RANGE_PERCENT,
)
from app.analysis.patterns.models import coerce_pattern_candidate
from app.analysis.patterns.technicals import (
    at_new_high,
    average_true_range,
    bollinger_bands,
    rolling_percentile_rank,
    rolling_slope,
)


@dataclass(frozen=True)
class BreakoutReadinessFeatures:
    """Computed readiness primitives consumed by setup_engine payload builders."""

    distance_to_pivot_pct: float | None
    atr14_pct: float | None
    atr14_pct_trend: float | None
    bb_width_pct: float | None
    bb_width_pctile_252: float | None
    volume_vs_50d: float | None
    rs: float | None
    rs_line_new_high: bool
    rs_vs_spy_65d: float | None
    rs_vs_spy_trend_20d: float | None
    # Defaulted so existing constructors that predate the blue-dot signal still
    # build (consistent with bb_squeeze below); production sets it by keyword.
    rs_line_blue_dot: bool = False
    bb_squeeze: bool = False
    quiet_days_10d: int | None = None
    up_down_volume_ratio_10d: float | None = None


@dataclass(frozen=True)
class BreakoutReadinessTraceInputs:
    """Raw intermediate values captured during readiness computation.

    Used by ``build_score_trace()`` to record formula inputs for each field.
    This is opt-in side-channel data — kept separate from
    ``BreakoutReadinessFeatures`` to avoid polluting the value object.
    """

    latest_close: float | None
    latest_atr14: float | None
    latest_bb_upper: float | None
    latest_bb_lower: float | None
    latest_bb_mid: float | None
    latest_volume: float | None
    volume_sma_50: float | None
    pivot_price: float | None
    bb_pctile_window: int
    latest_benchmark_close: float | None
    rs_current: float | None
    rs_252_max: float | None
    rs_65d_ago: float | None


def _resolve_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if column in frame.columns:
        return frame[column]
    lower_map = {str(col).lower(): col for col in frame.columns}
    if column.lower() in lower_map:
        return frame[lower_map[column.lower()]]
    raise KeyError(f"Missing required column '{column}'")


def _last_valid(series: pd.Series) -> float | None:
    valid = series.dropna()
    if valid.empty:
        return None
    return float(valid.iloc[-1])


def _safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator / denominator.replace(0.0, np.nan)


def _compute_readiness_core(
    price_frame: pd.DataFrame,
    *,
    pivot_price: float | None,
    benchmark_close: pd.Series | None = None,
    atr_period: int = 14,
    trend_lookback: int = 20,
    bb_window: int = 20,
    bb_pctile_window: int = 252,
    bb_squeeze_threshold_pctile: float = 20.0,
    volume_sma_window: int = 50,
    volume_ratio_window: int = 10,
    quiet_days_window: int = 10,
    quiet_volume_threshold: float = 0.8,
    rs_lookback: int = 252,
    rs_vs_spy_window: int = 65,
) -> tuple[BreakoutReadinessFeatures, BreakoutReadinessTraceInputs]:
    """Compute readiness features and capture raw trace inputs.

    Returns both the canonical features and the raw intermediates needed
    by ``build_score_trace()`` for formula auditability.
    """

    if not isinstance(price_frame, pd.DataFrame):
        raise ValueError("price_frame must be a pandas DataFrame")

    close = _resolve_series(price_frame, "Close").astype(float)
    high = _resolve_series(price_frame, "High").astype(float)
    low = _resolve_series(price_frame, "Low").astype(float)
    volume = _resolve_series(price_frame, "Volume").astype(float)
    latest_close = _last_valid(close)

    distance_to_pivot_pct: float | None = None
    if (
        pivot_price is not None
        and latest_close is not None
        and float(pivot_price) != 0.0
    ):
        distance_to_pivot_pct = 100.0 * (
            (latest_close - float(pivot_price)) / float(pivot_price)
        )

    atr14 = average_true_range(
        price_frame,
        period=atr_period,
        method="wilder",
    )
    atr14_latest = _last_valid(atr14)

    atr14_pct: float | None = None
    if atr14_latest is not None and latest_close is not None and latest_close != 0.0:
        atr14_pct = 100.0 * (atr14_latest / latest_close)

    atr14_pct_series = _safe_divide(atr14, close.abs()) * 100.0
    atr14_pct_trend = _last_valid(rolling_slope(atr14_pct_series, window=trend_lookback))

    bands = bollinger_bands(close, window=bb_window, stddev=2.0)
    bb_mid = bands["middle"]
    bb_width_pct_series = (
        _safe_divide((bands["upper"] - bands["lower"]), bb_mid.abs()) * 100.0
    )
    bb_width_pct = _last_valid(bb_width_pct_series)
    bb_width_pctile_252 = _last_valid(
        rolling_percentile_rank(bb_width_pct_series, window=bb_pctile_window)
    )
    bb_squeeze = bool(
        bb_width_pctile_252 is not None
        and bb_width_pctile_252 <= float(bb_squeeze_threshold_pctile)
    )

    volume_sma = volume.rolling(window=volume_sma_window, min_periods=volume_sma_window).mean()
    volume_vs_50d = _last_valid(_safe_divide(volume, volume_sma))
    prev_close = close.shift(1)
    up_volume_10d = volume.where(close > prev_close, 0.0).rolling(
        window=volume_ratio_window,
        min_periods=volume_ratio_window,
    ).sum()
    down_volume_10d = volume.where(close < prev_close, 0.0).rolling(
        window=volume_ratio_window,
        min_periods=volume_ratio_window,
    ).sum()
    down_volume_10d_safe = down_volume_10d.where(down_volume_10d > 0.0, 1e-9)
    up_down_volume_ratio_10d = _last_valid(up_volume_10d / down_volume_10d_safe)

    true_range = pd.concat(
        [
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    true_range_pct = _safe_divide(true_range, close.abs()) * 100.0
    quiet_day_mask = (
        volume < (volume_sma * float(quiet_volume_threshold))
    ) & (true_range_pct < atr14_pct_series.abs())
    quiet_days_10d_raw = quiet_day_mask.rolling(
        window=quiet_days_window,
        min_periods=quiet_days_window,
    ).sum()
    quiet_days_10d_val = _last_valid(quiet_days_10d_raw)
    quiet_days_10d = int(quiet_days_10d_val) if quiet_days_10d_val is not None else None

    # Capture raw trace intermediates for volume.
    latest_volume = _last_valid(volume)
    volume_sma_50_val = _last_valid(volume_sma)

    # Capture raw BB intermediates.
    latest_bb_upper = _last_valid(bands["upper"])
    latest_bb_lower = _last_valid(bands["lower"])
    latest_bb_mid = _last_valid(bb_mid)

    rs: float | None = None
    rs_line_new_high = False
    rs_line_blue_dot = False
    rs_vs_spy_65d: float | None = None
    rs_vs_spy_trend_20d: float | None = None

    # Trace intermediates for RS fields.
    latest_benchmark_close: float | None = None
    rs_current: float | None = None
    rs_252_max: float | None = None
    rs_65d_ago: float | None = None

    if benchmark_close is not None:
        aligned_benchmark = benchmark_close.astype(float).reindex(close.index)
        rs_series = _safe_divide(close, aligned_benchmark)

        rs = _last_valid(rs_series)
        rs_current = rs
        latest_benchmark_close = _last_valid(aligned_benchmark)

        rs_vs_spy_65d = _last_valid(
            (_safe_divide(rs_series, rs_series.shift(rs_vs_spy_window)) - 1.0) * 100.0
        )
        rs_vs_spy_trend_20d = _last_valid(
            rolling_slope(rs_series, window=trend_lookback)
        )

        # Evaluate both new-high predicates on one benchmark-aligned frame so RS
        # and price share the same end date — a trailing-NaN benchmark must not let
        # the RS window lead the price window and emit a false blue dot.
        aligned = pd.DataFrame({"rs": rs_series, "price": close}).dropna()
        rs_tail = aligned["rs"].tail(rs_lookback)
        if not rs_tail.empty:
            rs_line_new_high = at_new_high(aligned["rs"], window=rs_lookback)
            # Blue dot: RS line leads price — RS at a new high while price is not.
            rs_line_blue_dot = bool(
                rs_line_new_high and not at_new_high(aligned["price"], window=rs_lookback)
            )
            rs_252_max = float(rs_tail.max())

        # Capture rs value from 65 days ago for trace.
        rs_shifted = rs_series.shift(rs_vs_spy_window).dropna()
        if not rs_shifted.empty:
            rs_65d_ago = float(rs_shifted.iloc[-1])

    features = BreakoutReadinessFeatures(
        distance_to_pivot_pct=distance_to_pivot_pct,
        atr14_pct=atr14_pct,
        atr14_pct_trend=atr14_pct_trend,
        bb_width_pct=bb_width_pct,
        bb_width_pctile_252=bb_width_pctile_252,
        volume_vs_50d=volume_vs_50d,
        rs=rs,
        rs_line_new_high=rs_line_new_high,
        rs_line_blue_dot=rs_line_blue_dot,
        rs_vs_spy_65d=rs_vs_spy_65d,
        rs_vs_spy_trend_20d=rs_vs_spy_trend_20d,
        bb_squeeze=bb_squeeze,
        quiet_days_10d=quiet_days_10d,
        up_down_volume_ratio_10d=up_down_volume_ratio_10d,
    )

    trace_inputs = BreakoutReadinessTraceInputs(
        latest_close=latest_close,
        latest_atr14=atr14_latest,
        latest_bb_upper=latest_bb_upper,
        latest_bb_lower=latest_bb_lower,
        latest_bb_mid=latest_bb_mid,
        latest_volume=latest_volume,
        volume_sma_50=volume_sma_50_val,
        pivot_price=float(pivot_price) if pivot_price is not None else None,
        bb_pctile_window=bb_pctile_window,
        latest_benchmark_close=latest_benchmark_close,
        rs_current=rs_current,
        rs_252_max=rs_252_max,
        rs_65d_ago=rs_65d_ago,
    )

    return features, trace_inputs


def compute_breakout_readiness_features(
    price_frame: pd.DataFrame,
    *,
    pivot_price: float | None,
    benchmark_close: pd.Series | None = None,
    atr_period: int = 14,
    trend_lookback: int = 20,
    bb_window: int = 20,
    bb_pctile_window: int = 252,
    bb_squeeze_threshold_pctile: float = 20.0,
    volume_sma_window: int = 50,
    volume_ratio_window: int = 10,
    quiet_days_window: int = 10,
    quiet_volume_threshold: float = 0.8,
    rs_lookback: int = 252,
    rs_vs_spy_window: int = 65,
) -> BreakoutReadinessFeatures:
    """Compute canonical breakout-readiness fields from OHLCV and benchmark series.

    Formula spec (implemented exactly):
    - distance_to_pivot_pct = 100*(close - pivot)/pivot
    - atr14_pct = 100*ATR14/close
    - atr14_pct_trend = slope(atr14_pct, lookback=20)
    - bb_width_pct = 100*(bb_upper-bb_lower)/bb_mid
    - bb_width_pctile_252 = pct_rank(bb_width_pct[-1], bb_width_pct[-252:])
    - bb_squeeze = bb_width_pctile_252 <= squeeze_threshold
    - volume_vs_50d = vol / SMA(vol,50)
    - up_down_volume_ratio_10d = sum(up_volume,10) / max(sum(down_volume,10), epsilon)
    - quiet_days_10d = count(last 10 where volume dry-up && true range < ATR14%)
    - rs = close/spy_close
    """
    features, _trace = _compute_readiness_core(
        price_frame,
        pivot_price=pivot_price,
        benchmark_close=benchmark_close,
        atr_period=atr_period,
        trend_lookback=trend_lookback,
        bb_window=bb_window,
        bb_pctile_window=bb_pctile_window,
        bb_squeeze_threshold_pctile=bb_squeeze_threshold_pctile,
        volume_sma_window=volume_sma_window,
        volume_ratio_window=volume_ratio_window,
        quiet_days_window=quiet_days_window,
        quiet_volume_threshold=quiet_volume_threshold,
        rs_lookback=rs_lookback,
        rs_vs_spy_window=rs_vs_spy_window,
    )
    return features


def compute_breakout_readiness_features_with_trace(
    price_frame: pd.DataFrame,
    *,
    pivot_price: float | None,
    benchmark_close: pd.Series | None = None,
    atr_period: int = 14,
    trend_lookback: int = 20,
    bb_window: int = 20,
    bb_pctile_window: int = 252,
    bb_squeeze_threshold_pctile: float = 20.0,
    volume_sma_window: int = 50,
    volume_ratio_window: int = 10,
    quiet_days_window: int = 10,
    quiet_volume_threshold: float = 0.8,
    rs_lookback: int = 252,
    rs_vs_spy_window: int = 65,
) -> tuple[BreakoutReadinessFeatures, BreakoutReadinessTraceInputs]:
    """Compute readiness features and return raw trace inputs for auditability.

    Same computation as ``compute_breakout_readiness_features()`` but also
    returns the ``BreakoutReadinessTraceInputs`` side-channel for
    ``build_score_trace()``.
    """
    return _compute_readiness_core(
        price_frame,
        pivot_price=pivot_price,
        benchmark_close=benchmark_close,
        atr_period=atr_period,
        trend_lookback=trend_lookback,
        bb_window=bb_window,
        bb_pctile_window=bb_pctile_window,
        bb_squeeze_threshold_pctile=bb_squeeze_threshold_pctile,
        volume_sma_window=volume_sma_window,
        volume_ratio_window=volume_ratio_window,
        quiet_days_window=quiet_days_window,
        quiet_volume_threshold=quiet_volume_threshold,
        rs_lookback=rs_lookback,
        rs_vs_spy_window=rs_vs_spy_window,
    )


def readiness_features_to_payload_fields(
    features: BreakoutReadinessFeatures,
) -> dict[str, float | int | bool | None]:
    """Convert typed readiness features into setup_engine top-level fields."""
    return {
        "distance_to_pivot_pct": features.distance_to_pivot_pct,
        "atr14_pct": features.atr14_pct,
        "atr14_pct_trend": features.atr14_pct_trend,
        "bb_width_pct": features.bb_width_pct,
        "bb_width_pctile_252": features.bb_width_pctile_252,
        "volume_vs_50d": features.volume_vs_50d,
        "rs": features.rs,
        "rs_line_new_high": features.rs_line_new_high,
        "rs_line_blue_dot": features.rs_line_blue_dot,
        "rs_vs_spy_65d": features.rs_vs_spy_65d,
        "rs_vs_spy_trend_20d": features.rs_vs_spy_trend_20d,
        "bb_squeeze": features.bb_squeeze,
        "quiet_days_10d": features.quiet_days_10d,
        "up_down_volume_ratio_10d": features.up_down_volume_ratio_10d,
    }


# ── Setup diagnostics (round 3 R3c) ─────────────────────────────────
# Three shapes the readiness gates do not see. They are returned for ``explain.diagnostics``
# (the screener appends them to the detectors' own diagnostics) and never fail readiness:
# they are never in ``failed_checks`` and never change ``derived_ready``. A missing or
# unusable input gives no diagnostic: unknown is not a finding.

CONTRACTION_UNCONFIRMED = "contraction_unconfirmed"
PIVOT_ALREADY_CROSSED = "pivot_already_crossed"
PIVOT_BELOW_BASE_HIGH = "pivot_below_base_high"
SETUP_DIAGNOSTICS: tuple[str, ...] = (
    CONTRACTION_UNCONFIRMED,
    PIVOT_ALREADY_CROSSED,
    PIVOT_BELOW_BASE_HIGH,
)


@dataclass(frozen=True)
class DailyBars:
    """Daily bars as plain Python floats, oldest first, dated ``YYYY-MM-DD``.

    The diagnostics below mirror the brief's JavaScript, so they work on plain floats in
    the same operation order (never a pandas sum or mean, whose order can differ).
    """

    dates: tuple[str, ...]
    highs: tuple[float, ...]
    lows: tuple[float, ...]
    closes: tuple[float, ...]

    def __len__(self) -> int:
        return len(self.dates)


def _plain_float(value: object) -> float:
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return math.nan
    return out


def daily_bars_from_frame(price_frame: pd.DataFrame) -> DailyBars | None:
    """The frame's daily bars, or None without a date index or a High/Low/Close column."""
    if not isinstance(price_frame, pd.DataFrame) or not isinstance(price_frame.index, pd.DatetimeIndex):
        return None
    try:
        high = _resolve_series(price_frame, "High")
        low = _resolve_series(price_frame, "Low")
        close = _resolve_series(price_frame, "Close")
    except KeyError:
        return None
    return DailyBars(
        dates=tuple(ts.date().isoformat() for ts in price_frame.index),
        highs=tuple(_plain_float(v) for v in high.tolist()),
        lows=tuple(_plain_float(v) for v in low.tolist()),
        closes=tuple(_plain_float(v) for v in close.tolist()),
    )


def _positive(value: float) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def _js_round(value: float) -> int:
    """JavaScript ``Math.round`` (a fraction of one half rounds up), not Python's banker's round."""
    whole = math.floor(value)
    return whole + 1 if value - whole >= 0.5 else whole


def _cents(value: float) -> int:
    return _js_round(value * 100)


def _iso_day(value: object) -> str | None:
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    return value if day.isoformat() == value else None


def _window_start(day: str, timeframe: str) -> str:
    """A weekly label's first calendar day (the label is the W-FRI week's Friday), or the day."""
    if timeframe == "weekly":
        return (date.fromisoformat(day) - timedelta(days=6)).isoformat()
    return day


def pivot_bar_index(
    bars: DailyBars,
    *,
    pivot_price: float | None,
    pivot_date: object,
    timeframe: str | None,
) -> int | None:
    """The index of the bar that formed the pivot, mirroring the brief's ``pivotBar``.

    frontend/src/static/brief/pivotBar.js (frozen) is the rule: for a weekly pattern the
    pivot date labels its week, and the pivot's bar is the latest bar dated within the 7
    calendar days ending on that label whose high equals the pivot in whole cents; for a
    daily pattern it is the bar dated on the pivot date itself, when its high equals the
    pivot in cents. Otherwise None. ``timeframe`` is the primary candidate's own.
    """
    day = _iso_day(pivot_date)
    if (
        day is None
        or timeframe not in ("daily", "weekly")
        or pivot_price is None
        or not _positive(float(pivot_price))
    ):
        return None
    start = _window_start(day, timeframe)
    target = _cents(float(pivot_price))
    for index in range(len(bars) - 1, -1, -1):
        bar_day = bars.dates[index]
        if bar_day > day:
            continue
        if bar_day < start:
            break
        high = bars.highs[index]
        if math.isfinite(high) and _cents(high) == target:
            return index
    return None


def pivot_already_crossed(bars: DailyBars, *, pivot_price: float, pivot_index: int | None) -> bool:
    """A close more than PIVOT_ALREADY_CROSSED_PCT above the pivot on a bar after the pivot's bar."""
    if pivot_index is None or not _positive(float(pivot_price)):
        return False
    line = float(pivot_price) * (1 + PIVOT_ALREADY_CROSSED_PCT / 100)
    return any(
        math.isfinite(close) and close > line
        for close in bars.closes[pivot_index + 1:]
    )


def pivot_below_base_high(
    bars: DailyBars,
    *,
    pivot_price: float,
    pivot_index: int | None,
    base_start: object,
    timeframe: str | None,
) -> bool:
    """The pivot more than PIVOT_BELOW_BASE_HIGH_PCT under the base's high.

    The base's high is the highest daily high from the base's first bar (``base_start``:
    a weekly label counts from its week's first calendar day) to the pivot's own bar.
    Unknown (no pivot bar, no start, no bar in the window or a missing high) is False.
    """
    start = _iso_day(base_start)
    if (
        pivot_index is None
        or start is None
        or timeframe not in ("daily", "weekly")
        or not _positive(float(pivot_price))
    ):
        return False
    first = _window_start(start, timeframe)
    window = [
        bars.highs[i] for i in range(pivot_index + 1) if bars.dates[i] >= first
    ]
    if not window or not all(_positive(high) for high in window):
        return False
    return float(pivot_price) < max(window) * (1 - PIVOT_BELOW_BASE_HIGH_PCT / 100)


def _atr_percent(bars: DailyBars) -> list[float | None]:
    """ATR20 as a % of each bar's close, as bookTechnicalEvidence.js ``atrPercent`` sums it."""
    n = len(bars)
    out: list[float | None] = [None] * n
    highs, lows, closes = bars.highs, bars.lows, bars.closes

    def true_range(i: int) -> float:
        if i:
            return max(highs[i], closes[i - 1]) - min(lows[i], closes[i - 1])
        return highs[i] - lows[i]

    total = 0.0
    for i in range(n):
        total += true_range(i)
        if i >= CONTRACTION_ATR_SESSIONS:
            total -= true_range(i - CONTRACTION_ATR_SESSIONS)
        if i >= CONTRACTION_ATR_SESSIONS - 1:
            out[i] = total / CONTRACTION_ATR_SESSIONS / closes[i] * 100
    return out


def _setup_base_anchor(bars: DailyBars, candidate: Mapping[str, object] | None) -> int | None:
    """The brief's ``setupBase``: the highest high (first of equals) of the primary's dates."""
    if candidate is None:
        return None
    start_date = _iso_day(candidate.get("start_date"))
    if start_date is None:
        return None
    n = len(bars)
    start = next((i for i in range(n) if bars.dates[i] >= start_date), -1)
    if start < 0:
        return None
    end = n - 1
    end_date = _iso_day(candidate.get("end_date"))
    if end_date is not None:
        while end > start and bars.dates[end] > end_date:
            end -= 1
    if end <= start:
        return None
    anchor = start
    for i in range(start, end + 1):
        if bars.highs[i] > bars.highs[anchor]:
            anchor = i
    return anchor if anchor < n - 1 else None


def _leg_measurement_valid(bars: DailyBars, start: int, end: int) -> bool:
    """bookTechnicalEvidence.js ``measuredLeg``'s checks: a peak at the start, a later low, a depth."""
    highs = bars.highs[start:end + 1]
    lows = bars.lows[start:end + 1]
    low = min(lows)
    low_index = lows.index(low)
    peak_high = highs[0]
    depth = (peak_high - low) / peak_high * 100
    return peak_high == max(highs) and low_index > 0 and depth > 0


def contraction_measurements_valid(
    bars: DailyBars,
    primary_candidate: Mapping[str, object] | None,
) -> bool | None:
    """Whether the brief's automatic contraction measurement finds a valid sequence.

    A port of frontend/src/static/bookTechnicalEvidence.js (``automaticLegs``, ``setupBase``,
    ``contractions``; 独自近似), constants pinned to its VCP_METHOD. The base starts at the
    Setup Engine's base (the highest high between the primary's start and end dates, as the
    payload publishes them; the brief takes the first candidate of the primary's pattern, and
    the exporter's published evidence has that base whenever the recalculation is current),
    or else, with no such candidate, at the highest swing
    high a 1.5×ATR20 zigzag confirms in the last 150 sessions. From there a zigzag finds each
    contraction until the price first trades above the base high. Valid means 2 to 6
    contractions, each with its peak at its start, a later low and a positive depth: the
    chart's 「収縮は未確認」 is the False case. None when a bar's high, low or close is
    missing or not positive, or there are fewer than ATR20's sessions (unknown).
    """
    n = len(bars)
    if n < CONTRACTION_ATR_SESSIONS or not all(
        _positive(bars.highs[i]) and _positive(bars.lows[i]) and _positive(bars.closes[i])
        for i in range(n)
    ):
        return None
    highs, lows = bars.highs, bars.lows
    atr = _atr_percent(bars)
    first_atr = next((v for v in atr if v is not None), None)

    def floor_at(i: int) -> float:
        value = atr[i] if atr[i] is not None else (first_atr if first_atr is not None else 0)
        return CONTRACTION_ATR_MULTIPLE * value

    def drop(h: int, l: int) -> float:
        return (highs[h] - lows[l]) / highs[h] * 100

    def rise(l: int, i: int) -> float:
        return (highs[i] - lows[l]) / lows[l] * 100

    anchor = _setup_base_anchor(bars, primary_candidate)
    if anchor is None:
        # Pass 1: confirmed swing highs with the ATR threshold; the base high is the highest.
        mode, ext = "up", max(0, n - CONTRACTION_LOOKBACK_SESSIONS)
        for i in range(ext + 1, n):
            if mode == "up":
                if highs[i] > highs[ext]:
                    ext = i
                elif drop(ext, i) >= floor_at(ext):
                    if anchor is None or highs[ext] > highs[anchor]:
                        anchor = ext
                    mode, ext = "down", i
            elif lows[i] < lows[ext]:
                ext = i
            elif rise(ext, i) >= floor_at(ext):
                mode, ext = "up", i
    if anchor is None:
        return False
    # The base ends where the price first trades above its high.
    stop = anchor + 1
    while stop < n and highs[stop] <= highs[anchor]:
        stop += 1

    legs: list[tuple[int, int, float]] = []

    def push(a: int, b: int) -> None:
        # The same decline: merge back while the new low undercuts the previous one's low.
        while legs and lows[b] < lows[legs[-1][1]] and highs[a] <= highs[legs[-1][0]]:
            a = legs.pop()[0]
        if legs:
            prev_a, prev_b, _ = legs[-1]
            if highs[a] < lows[prev_b] + CONTRACTION_REPAIR_FRACTION * (highs[prev_a] - lows[prev_b]):
                return
        legs.append((a, b, drop(a, b)))

    mode, hi, lo = "down", anchor, None
    for i in range(anchor + 1, stop):
        if mode == "down":
            if lo is None or lows[i] < lows[lo]:
                lo = i
            elif rise(lo, i) >= max(floor_at(lo), CONTRACTION_DEPTH_FRACTION * drop(hi, lo)):
                push(hi, lo)
                mode, hi, lo = "up", i, None
        elif highs[i] > highs[hi]:
            hi = i
        elif drop(hi, i) >= max(
            floor_at(hi), CONTRACTION_DEPTH_FRACTION * legs[-1][2] if legs else 0
        ):
            mode, lo = "down", i
    if mode == "down" and lo is not None:
        push(hi, lo)
    elif mode == "up":
        # The final contraction: only the noise floor (1.5%, or one ATR20 when larger).
        low = None
        for j in range(hi + 1, stop):
            if low is None or lows[j] < lows[low]:
                low = j
        if low is not None and drop(hi, low) >= max(
            CONTRACTION_FINAL_FLOOR_PCT, atr[hi] if atr[hi] is not None else 0
        ):
            push(hi, low)

    kept = legs[-CONTRACTION_MAX_LEGS:]
    if not 2 <= len(kept) <= CONTRACTION_MAX_LEGS:
        return False
    return all(_leg_measurement_valid(bars, a, b) for a, b, _ in kept)


def _first_candidate(candidates: Sequence[Mapping[str, object]], pattern: str | None) -> Mapping[str, object] | None:
    if not pattern:
        return None
    return next((c for c in candidates if isinstance(c, Mapping) and c.get("pattern") == pattern), None)


def _selected_candidate(
    candidates: Sequence[Mapping[str, object]],
    *,
    pattern: str | None,
    pivot_price: float | None,
    pivot_date: object,
) -> Mapping[str, object] | None:
    if not pattern:
        return None
    return next(
        (
            c for c in candidates
            if isinstance(c, Mapping)
            and c.get("pattern") == pattern
            and c.get("pivot_price") == pivot_price
            and c.get("pivot_date") == pivot_date
        ),
        None,
    )


def setup_diagnostics(
    price_frame: pd.DataFrame,
    *,
    pattern_primary: str | None,
    pivot_price: float | None,
    pivot_date: object,
    candidates: Sequence[Mapping[str, object]],
) -> tuple[str, ...]:
    """The setup diagnostics that hold, in SETUP_DIAGNOSTICS order (round 3 R3c).

    - ``contraction_unconfirmed``: the brief's automatic contraction measurement finds no
      valid sequence (its chart shows 「収縮は未確認」); see ``contraction_measurements_valid``.
      The brief also requires certified bars to draw them; this reads the engine's own bars.
    - ``pivot_already_crossed``: a close more than PIVOT_ALREADY_CROSSED_PCT above the pivot on
      a bar after the pivot's own bar (``pivot_bar_index``, the brief's pivotBar rule).
    - ``pivot_below_base_high``: the pivot more than PIVOT_BELOW_BASE_HIGH_PCT under the
      highest high from the selected primary candidate's base start (a cup's left lip, else
      its start date) to the pivot's own bar.
    """
    bars = daily_bars_from_frame(price_frame)
    if bars is None or not len(bars):
        return ()
    # The candidates as the payload publishes them (``se_candidates``, which the brief reads):
    # normalization lifts each detector's dates (a cup's handle, a run's start) to start_date.
    published: list[Mapping[str, object]] = []
    for candidate in candidates:
        try:
            published.append(coerce_pattern_candidate(candidate, default_timeframe="daily"))
        except (TypeError, ValueError):
            continue
    candidates = published
    found: list[str] = []
    pivot = float(pivot_price) if pivot_price is not None and math.isfinite(float(pivot_price)) else None

    first = _first_candidate(candidates, pattern_primary)
    if contraction_measurements_valid(bars, first) is False:
        found.append(CONTRACTION_UNCONFIRMED)

    selected = _selected_candidate(
        candidates, pattern=pattern_primary, pivot_price=pivot_price, pivot_date=pivot_date,
    )
    timeframe = selected.get("timeframe") if selected is not None else None
    timeframe = timeframe if isinstance(timeframe, str) else None
    pivot_index = (
        pivot_bar_index(bars, pivot_price=pivot, pivot_date=pivot_date, timeframe=timeframe)
        if pivot is not None
        else None
    )
    if pivot is not None and pivot_already_crossed(bars, pivot_price=pivot, pivot_index=pivot_index):
        found.append(PIVOT_ALREADY_CROSSED)
    if selected is not None and pivot is not None:
        metrics = selected.get("metrics")
        lip = metrics.get("left_lip_date") if isinstance(metrics, Mapping) else None
        base_start = lip if _iso_day(lip) is not None else selected.get("start_date")
        if pivot_below_base_high(
            bars, pivot_price=pivot, pivot_index=pivot_index,
            base_start=base_start, timeframe=timeframe,
        ):
            found.append(PIVOT_BELOW_BASE_HIGH)
    return tuple(found)


# ── Pinned price (round 3 R3a) ──────────────────────────────────────
# A failing readiness check, ``price_pinned``: the brief's low-activity rule
# (frontend/src/static/priceActivity.js, round 3 R2(a)) ported with the same constants, so
# the Setup Engine never calls ready a row the brief shows as 低変動・監視のみ. The screener
# passes it with the caller's failed checks (``pre_existing_failed_checks``), never as an
# 11th gate. Fewer than PRICE_ACTIVITY_SESSIONS bars, or a rule whose figures are missing,
# is never pinned: missing data is never a failure.

PRICE_PINNED = "price_pinned"


@dataclass(frozen=True)
class PriceActivity:
    """priceActivity.js's decision: ``low`` (its ``lowRange``) and the first rule that holds."""

    low: bool
    reason: str | None  # 'range60', 'since_gap', 'adr' or None


def _adr20_pct(bars: DailyBars) -> float | None:
    """priceActivity.js ``adr20``: the mean of (high ÷ low − 1) over the last N bars, in %."""
    n = len(bars)
    if n < ACTIVITY_ADR_SESSIONS:
        return None
    total = 0
    for i in range(n - ACTIVITY_ADR_SESSIONS, n):
        high, low = bars.highs[i], bars.lows[i]
        if not (_positive(high) and _positive(low) and high >= low):
            return None
        total = total + (high / low - 1)
    return total / ACTIVITY_ADR_SESSIONS * 100


def _since_gap_pinned(bars: DailyBars) -> bool:
    """priceActivity.js ``largestGap`` and its since-gap rule.

    The largest one-day close-to-close move into each of the last PRICE_ACTIVITY_SESSIONS bars
    (the first of equal moves), when it is at least GAP_MOVE_PERCENT; pinned when at least
    SINCE_GAP_MIN_SESSIONS sessions follow it and their high/low range stays under
    SINCE_GAP_RANGE_PERCENT. Unknown (fewer than 61 bars, a missing close in the window, a
    missing high or low after the gap) is not pinned.
    """
    n = len(bars)
    first = n - PRICE_ACTIVITY_SESSIONS
    if first < 1:
        return False
    at, pct = -1, 0.0
    for i in range(first, n):
        close, previous = bars.closes[i], bars.closes[i - 1]
        if not (_positive(close) and _positive(previous)):
            return False
        move = (close / previous - 1) * 100
        if abs(move) > abs(pct):
            at, pct = i, move
    if at < 0 or not abs(pct) >= GAP_MOVE_PERCENT:
        return False
    after = range(at + 1, n)
    sessions = len(after)
    if not sessions or not all(
        _positive(bars.highs[i]) and _positive(bars.lows[i]) and bars.highs[i] >= bars.lows[i]
        for i in after
    ):
        return False
    range_pct = (max(bars.highs[i] for i in after) / min(bars.lows[i] for i in after) - 1) * 100
    return sessions >= SINCE_GAP_MIN_SESSIONS and range_pct < SINCE_GAP_RANGE_PERCENT


def price_activity(bars: DailyBars | None) -> PriceActivity:
    """priceActivity.js's ``lowRange`` and ``reason`` (round 3 R2(a)), on the same rules:

    (i) a PRICE_ACTIVITY_SESSIONS-session range under LOW_RANGE_PERCENT ('range60');
    (ii) since the largest gap, a range under SINCE_GAP_RANGE_PERCENT over at least
    SINCE_GAP_MIN_SESSIONS sessions ('since_gap'); (iii) ADR20 under LOW_ADR_PERCENT ('adr').
    The first that holds is the reason. Fewer than PRICE_ACTIVITY_SESSIONS bars: never low.
    """
    if bars is None or len(bars) < PRICE_ACTIVITY_SESSIONS:
        return PriceActivity(low=False, reason=None)
    n = len(bars)
    recent = range(n - PRICE_ACTIVITY_SESSIONS, n)
    narrow = all(_positive(bars.highs[i]) and _positive(bars.lows[i]) for i in recent) and (
        (max(bars.highs[i] for i in recent) / min(bars.lows[i] for i in recent) - 1) * 100
        < LOW_RANGE_PERCENT
    )
    if narrow:
        return PriceActivity(low=True, reason="range60")
    if _since_gap_pinned(bars):
        return PriceActivity(low=True, reason="since_gap")
    adr = _adr20_pct(bars)
    if adr is not None and adr < LOW_ADR_PERCENT:
        return PriceActivity(low=True, reason="adr")
    return PriceActivity(low=False, reason=None)


def price_pinned(price_frame: pd.DataFrame) -> bool:
    """True when the brief's low-activity rule holds on these daily bars (``price_pinned``)."""
    return price_activity(daily_bars_from_frame(price_frame)).low
