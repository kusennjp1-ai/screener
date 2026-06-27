"""
Markets 360 — chart overlay assembly.

Standalone serializers that turn an OHLCV DataFrame (+ benchmark) into the
overlay payloads the Markets 360 chart renders: candles, moving-average stack,
SPY overlay, earnings markers, MM360 color bands, staged buy-point annotations,
VCP boxes, the earnings (fair-value) line, the RS line with blue dots, and the
RPR pane line. These reuse only pure, shared calculators so the module stays
decoupled from the screener pipeline. Every function is defensive: bad/short
data yields an empty overlay rather than an exception.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from app.analysis.patterns.legacy_vcp_detection import VCPDetector
from app.analysis.patterns.rs_line import blue_dot_series, compute_rs_line
from app.services.minervini_bands import calculate_bands

logger = logging.getLogger(__name__)


# Moving averages shown in the legend (matches the MM360 daily template:
# a fast ~21 MA, the 50, and the long 150/200 trend stack).
MA_SET = (21, 50, 150, 200)


def window_cutoff(index: pd.Index, days: int) -> Optional[pd.Timestamp]:
    if index is None or len(index) == 0:
        return None
    last = pd.Timestamp(index[-1])
    return last - pd.Timedelta(days=days)


def serialize_bars(df: pd.DataFrame, days: int) -> List[Dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    cutoff = window_cutoff(df.index, days)
    frame = df[df.index >= cutoff] if cutoff is not None else df
    out: List[Dict[str, Any]] = []
    for ts, row in frame.iterrows():
        try:
            out.append({
                "date": pd.Timestamp(ts).strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out


def serialize_moving_averages(df: pd.DataFrame, days: int) -> Dict[str, List[Dict[str, Any]]]:
    """Per-MA date-anchored series for the legend stack (21/50/150/200)."""
    if df is None or getattr(df, "empty", True) or "Close" not in df.columns:
        return {}
    close = df["Close"]
    cutoff = window_cutoff(df.index, days)
    out: Dict[str, List[Dict[str, Any]]] = {}
    for period in MA_SET:
        if len(close) < period:
            continue
        ma = close.rolling(period).mean()
        ma_win = ma[ma.index >= cutoff] if cutoff is not None else ma
        out[f"ma{period}"] = [
            {"time": pd.Timestamp(ts).strftime("%Y-%m-%d"), "value": round(float(v), 2)}
            for ts, v in ma_win.dropna().items()
        ]
    return out


def serialize_overlay(df: Optional[pd.DataFrame], days: int) -> List[Dict[str, Any]]:
    """A benchmark/price line normalized only by date window (SPY overlay)."""
    if df is None or getattr(df, "empty", True) or "Close" not in df.columns:
        return []
    cutoff = window_cutoff(df.index, days)
    win = df[df.index >= cutoff] if cutoff is not None else df
    return [
        {"time": pd.Timestamp(ts).strftime("%Y-%m-%d"), "value": round(float(row["Close"]), 2)}
        for ts, row in win.iterrows()
    ]


def serialize_rs_line(
    df: pd.DataFrame, benchmark_df: Optional[pd.DataFrame], days: int
) -> tuple[List[Dict[str, Any]], List[str]]:
    """RS line (stock/benchmark, normalized) + blue-dot new-RS-high dates."""
    if (
        df is None or getattr(df, "empty", True)
        or benchmark_df is None or getattr(benchmark_df, "empty", True)
        or "Close" not in benchmark_df.columns
    ):
        return [], []
    try:
        rs_full = compute_rs_line(df["Close"], benchmark_df["Close"], normalize=True)
        blue_full = blue_dot_series(df["Close"], benchmark_df["Close"])
    except Exception:  # noqa: BLE001
        return [], []
    cutoff = window_cutoff(rs_full.index, days)
    rs_win = rs_full[rs_full.index >= cutoff].dropna() if cutoff is not None else rs_full.dropna()
    blue_win = blue_full[(blue_full.index >= cutoff) & blue_full] if cutoff is not None else blue_full[blue_full]
    rs_line = [
        {"time": pd.Timestamp(ts).strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for ts, v in rs_win.items()
    ]
    blue_dots = [pd.Timestamp(ts).strftime("%Y-%m-%d") for ts in blue_win.index]
    return rs_line, blue_dots


def serialize_rpr_pane(df: pd.DataFrame, benchmark_df: Optional[pd.DataFrame], days: int) -> List[Dict[str, Any]]:
    """RPR plotted as a 0–99 line over time for the bottom pane.

    A rolling relative-strength reading vs. the benchmark mapped onto 0–99 so it
    matches the RPR chip. Uses a 63-day (one quarter) relative return, smoothed,
    then squashed through a logistic into the 0–99 band.
    """
    if df is None or getattr(df, "empty", True) or "Close" not in df.columns:
        return []
    close = df["Close"]
    if len(close) < 70:
        return []
    bench = None
    if benchmark_df is not None and not getattr(benchmark_df, "empty", True) and "Close" in benchmark_df.columns:
        bench = benchmark_df["Close"].reindex(close.index).ffill()

    win = 63
    stock_ret = close.pct_change(win) * 100.0
    rel = stock_ret
    if bench is not None:
        rel = stock_ret - bench.pct_change(win) * 100.0
    rel = rel.rolling(5).mean()
    # Logistic squash: 0% rel -> ~55, +25% -> ~85, -25% -> ~20.
    rpr = 1.0 / (1.0 + np.exp(-rel / 12.0)) * 99.0

    cutoff = window_cutoff(close.index, days)
    rpr_win = rpr[rpr.index >= cutoff] if cutoff is not None else rpr
    return [
        {"time": pd.Timestamp(ts).strftime("%Y-%m-%d"), "value": round(float(v), 1)}
        for ts, v in rpr_win.dropna().items()
    ]


def compute_chart_bands(df: pd.DataFrame, benchmark_df: Optional[pd.DataFrame]) -> Dict[str, Any]:
    if df is None or getattr(df, "empty", True) or "Close" not in df.columns:
        return {}
    try:
        bench_close = None
        if benchmark_df is not None and not getattr(benchmark_df, "empty", True) and "Close" in benchmark_df.columns:
            bench_close = benchmark_df["Close"]
        return calculate_bands(df, benchmark_close=bench_close, with_history=True)
    except Exception:  # noqa: BLE001
        logger.warning("markets360 band computation failed", exc_info=True)
        return {}


def compute_buy_points(df: pd.DataFrame, days: int, max_points: int = 3) -> List[Dict[str, Any]]:
    """Staged buy annotations (alert/ready/buy_point/sepa_buy_point) per VCP base.

    Port of the MM360-style approximation: for each recent VCP base, find the
    breakout bar through the pivot and emit the breakout (SEPA when Stage-2 +
    volume), plus a ``buy_ready`` (<=3% below pivot) and ``buy_alert`` (3–8%
    below) lead-in. Each annotation carries the base low for stop estimation.
    """
    if df is None or getattr(df, "empty", True) or "Close" not in df.columns:
        return []
    try:
        close = df["Close"].reset_index(drop=True)
        high = df["High"].reset_index(drop=True) if "High" in df.columns else close
        low = df["Low"].reset_index(drop=True) if "Low" in df.columns else close
        vol = df["Volume"].reset_index(drop=True) if "Volume" in df.columns else None
        dates = list(df.index)
        n = len(close)
        if n < 60:
            return []
        sma50, sma150, sma200 = close.rolling(50).mean(), close.rolling(150).mean(), close.rolling(200).mean()
        avgvol = vol.rolling(50).mean() if vol is not None else None

        bases = VCPDetector().find_consolidation_bases(close[::-1].reset_index(drop=True))
        anns: List[Dict[str, Any]] = []
        seen: set[int] = set()
        for base in bases:
            pivot = float(base["high_price"])
            base_low = float(base.get("low_price", np.nan))
            base_recent = (n - 1) - int(base["start_idx"])
            if pivot <= 0 or not (0 <= base_recent < n):
                continue
            breakout = next(
                (i for i in range(base_recent + 1, n)
                 if float(close.iloc[i]) > pivot and float(close.iloc[i - 1]) <= pivot),
                None,
            )
            if breakout is None or breakout in seen:
                continue
            seen.add(breakout)
            i = breakout

            def _ok(s):
                return not pd.isna(s.iloc[i])

            stage2 = (
                _ok(sma50) and _ok(sma150) and _ok(sma200)
                and float(close.iloc[i]) > float(sma50.iloc[i]) > float(sma150.iloc[i]) > float(sma200.iloc[i])
            )
            vol_ok = (
                avgvol is not None and not pd.isna(avgvol.iloc[i]) and float(avgvol.iloc[i]) > 0
                and float(vol.iloc[i]) >= 1.5 * float(avgvol.iloc[i])
            )
            anns.append({
                "idx": i,
                "type": "sepa_buy_point" if (stage2 and vol_ok) else "buy_point",
                "price": round(pivot, 2),
                "base_low": round(base_low, 2) if np.isfinite(base_low) else None,
            })
            lo = max(base_recent - 10, 0)
            for j in range(i - 1, lo - 1, -1):
                cj = float(close.iloc[j])
                if cj <= pivot and (pivot - cj) / pivot <= 0.03:
                    anns.append({"idx": j, "type": "buy_ready", "price": round(pivot, 2)})
                    break
            for k in range(i - 1, lo - 1, -1):
                ck = float(close.iloc[k])
                if ck <= pivot and 0.03 < (pivot - ck) / pivot <= 0.08:
                    anns.append({"idx": k, "type": "buy_alert", "price": round(pivot, 2)})
                    break

        breakout_idxs = sorted(
            (a["idx"] for a in anns if a["type"] in ("buy_point", "sepa_buy_point")),
            reverse=True,
        )[:max_points]
        keep_floor = min(breakout_idxs) - 15 if breakout_idxs else 0
        cutoff = window_cutoff(df.index, days)
        out = []
        for a in anns:
            if a["idx"] < keep_floor:
                continue
            ts = dates[a["idx"]]
            if cutoff is not None and pd.Timestamp(ts) < cutoff:
                continue
            entry = {"time": pd.Timestamp(ts).strftime("%Y-%m-%d"), "type": a["type"], "price": a["price"]}
            if a.get("base_low") is not None:
                entry["base_low"] = a["base_low"]
            out.append(entry)
        out.sort(key=lambda a: a["time"])
        return out
    except Exception:  # noqa: BLE001
        logger.warning("markets360 buy-point computation failed", exc_info=True)
        return []


def compute_vcp_boxes(df: pd.DataFrame, days: int, max_boxes: int = 1) -> List[Dict[str, Any]]:
    if df is None or getattr(df, "empty", True) or "Close" not in df.columns:
        return []
    try:
        dates_rev = list(df.index[::-1])
        bases = VCPDetector().find_consolidation_bases(df["Close"][::-1].reset_index(drop=True))
    except Exception:  # noqa: BLE001
        return []
    cutoff = window_cutoff(df.index, days)
    boxes: List[Dict[str, Any]] = []
    for base in bases[:max_boxes]:
        try:
            start_idx, end_idx = int(base["start_idx"]), int(base["end_idx"])
            if not (0 <= start_idx < len(dates_rev)) or not (0 <= end_idx < len(dates_rev)):
                continue
            end_ts = pd.Timestamp(dates_rev[start_idx])
            if cutoff is not None and end_ts < cutoff:
                continue
            boxes.append({
                "start": pd.Timestamp(dates_rev[end_idx]).strftime("%Y-%m-%d"),
                "end": end_ts.strftime("%Y-%m-%d"),
                "high": round(float(base["high_price"]), 2),
                "low": round(float(base["low_price"]), 2),
            })
        except (KeyError, ValueError, TypeError):
            continue
    return boxes


def earnings_markers(earnings_dates: Optional[List[str]], df: pd.DataFrame, days: int) -> List[Dict[str, Any]]:
    """Green 'E' markers for report dates that fall inside the display window."""
    if not earnings_dates or df is None or getattr(df, "empty", True):
        return []
    cutoff = window_cutoff(df.index, days)
    out: List[Dict[str, Any]] = []
    for d in earnings_dates:
        try:
            ts = pd.Timestamp(d)
        except (ValueError, TypeError):
            continue
        if cutoff is not None and ts < cutoff:
            continue
        out.append({"time": ts.strftime("%Y-%m-%d"), "label": "E"})
    return out
