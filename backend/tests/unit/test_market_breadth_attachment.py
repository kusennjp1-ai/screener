"""Tests for scan-level market-breadth attachment (C80 breadth-regime guard)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.data_preparation import DataPreparationLayer


def _frame(above_200dma: bool, n: int = 260) -> pd.DataFrame:
    # rising series ends above its 200DMA; a late slump drops it below.
    close = np.linspace(80, 120, n)
    if not above_200dma:
        close = np.concatenate([close[:-10], np.full(10, 80.0)])
    idx = pd.bdate_range("2024-01-02", periods=n)
    return pd.DataFrame(
        {"Open": close, "High": close * 1.01, "Low": close * 0.99,
         "Close": close, "Volume": np.full(n, 1e6)}, index=idx)


def _item(sym: str, above: bool, market: str = "US") -> StockData:
    return StockData(symbol=sym, price_data=_frame(above),
                     benchmark_data=pd.DataFrame(), market=market)


def _attach(items: list[StockData]) -> None:
    layer = DataPreparationLayer.__new__(DataPreparationLayer)  # no ctor deps needed
    layer._attach_market_breadth({it.symbol: it for it in items})


def test_breadth_attached_when_universe_is_large_enough():
    items = [_item(f"A{i}", above=i % 5 != 0) for i in range(60)]  # 80% above
    _attach(items)
    assert items[0].market_breadth_pct_above_200dma == 80.0
    assert all(it.market_breadth_pct_above_200dma == 80.0 for it in items)


def test_small_scan_leaves_breadth_none():
    """A hand-picked scan below the representativeness floor must stay neutral."""
    items = [_item(f"B{i}", above=False) for i in range(10)]
    _attach(items)
    assert all(it.market_breadth_pct_above_200dma is None for it in items)


def test_breadth_is_per_market():
    items = [_item(f"U{i}", above=True, market="US") for i in range(55)] + \
            [_item(f"J{i}", above=False, market="JP") for i in range(55)]
    _attach(items)
    us = [it for it in items if it.market == "US"]
    jp = [it for it in items if it.market == "JP"]
    assert us[0].market_breadth_pct_above_200dma == 100.0
    assert jp[0].market_breadth_pct_above_200dma == 0.0


def test_short_history_symbols_are_excluded_from_the_denominator():
    ok = [_item(f"C{i}", above=True) for i in range(55)]
    stub = StockData(symbol="SHORT", price_data=_frame(True, n=50),
                     benchmark_data=pd.DataFrame(), market="US")
    items = ok + [stub]
    _attach(items)
    assert ok[0].market_breadth_pct_above_200dma == 100.0
