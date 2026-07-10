"""passes_template = the published 8 Trend Template conditions, nothing more.

Pins the canonicalization: a slow-grinding advance that satisfies every
published condition passes the template even when the 60-day regression
classifier reads it as 'sideways' (Stage 2 is the label the 8 conditions
jointly define, not a 9th veto). The regression stage remains a score/detail
overlay.
"""
import numpy as np
import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.minervini_scanner import MinerviniScanner


def _frame(close: np.ndarray) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2022-01-03", periods=n)
    close = np.asarray(close, dtype="float64")
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * 1.005
    low = np.minimum(open_, close) * 0.995
    vol = np.full(n, 1_000_000.0)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


def _scan(stock, bench):
    return MinerviniScanner().scan_stock("X", StockData(
        symbol="X", price_data=stock, benchmark_data=bench, market="US"))


def test_slow_grind_passing_all_8_conditions_passes_template():
    """+40% over a year then a gentle +2%/60d grind near highs: every published
    condition holds (MA stack, 52w position, RS>=70 vs a flat index) even when
    the 60-day regression slope reads 'sideways'."""
    n = 540
    # a big year (10 -> 100), then a slow +2.9%/70-session drift near the highs:
    # the 60-day regression slope (~0.04%/day) reads 'sideways' (< the 0.05%
    # 'uptrend' threshold) while every published condition still holds.
    advance = np.linspace(10, 100, n - 70)
    grind = np.linspace(100, 102.9, 70)
    stock = _frame(np.concatenate([advance, grind]))
    bench = _frame(np.linspace(100, 100.5, n))  # flat index -> stock is the leader

    res = _scan(stock, bench)
    d = res.details
    assert d["ma_alignment"] is True
    assert d["above_52w_low_pct"] >= 30
    assert d["from_52w_high_pct"] >= -25
    assert d["rs_rating"] >= 70
    assert d["passes_template"] is True  # no 9th veto
    # the regression stage read is still reported as an overlay
    assert "stage" in d


def test_broken_ma_stack_still_fails_the_template():
    """Canonicalization must not weaken the template: a declining stock fails."""
    stock = _frame(np.linspace(130, 60, 540))
    bench = _frame(np.linspace(100, 104, 540))
    res = _scan(stock, bench)
    assert res.details["passes_template"] is False
