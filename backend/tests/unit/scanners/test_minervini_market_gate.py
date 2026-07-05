"""SEPA rule 1 on the Minervini scanner: never rate 'Buy' against the market.

The Trend Template verdict (passes_template) is market-independent — a setup
is a setup — but the RATING is capped to Watch when the general market is in a
correction/downtrend, mirroring the markets360 scanner's buyable_now gate.
"""
import numpy as np
import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.minervini_scanner import MinerviniScanner


def _frame(close: np.ndarray, vol_mult: float = 1.0) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2022-01-03", periods=n)
    close = np.asarray(close, dtype="float64")
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * 1.005
    low = np.minimum(open_, close) * 0.995
    vol = np.full(n, 1_000_000.0) * vol_mult
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


def _leader(n: int = 540) -> pd.DataFrame:
    """A clean Stage-2 leader: strong 1y advance, still near its highs."""
    return _frame(np.linspace(20, 130, n))


def test_template_leader_in_healthy_market_is_a_buy():
    bench = _frame(np.linspace(300, 460, 540))  # index in its own Stage 2
    res = MinerviniScanner().scan_stock("LEAD", StockData(
        symbol="LEAD", price_data=_leader(), benchmark_data=bench, market="US"))
    assert res.details["market_uptrend"] is True
    if res.details["passes_template"]:
        assert res.rating in ("Strong Buy", "Buy")


def test_same_leader_in_a_downtrending_market_is_capped_to_watch():
    """SEPA rule 1: identical stock, but the index is in a downtrend — the
    template still passes (setup is intact) while the rating caps at Watch."""
    bench = _frame(np.linspace(460, 300, 540))  # index below falling MAs
    res = MinerviniScanner().scan_stock("LEAD", StockData(
        symbol="LEAD", price_data=_leader(), benchmark_data=bench, market="US"))
    assert res.details["market_regime"] == "downtrend"
    assert res.details["market_uptrend"] is False
    assert res.rating not in ("Strong Buy", "Buy")
    # the watchlist verdict is market-independent
    assert res.passes == res.details["passes_template"]


def test_short_benchmark_leaves_the_rating_ungated():
    """Unknown regime (benchmark too short to assess) must never block."""
    bench = _frame(np.linspace(100, 104, 540))
    short_bench = bench.tail(150)  # < 200 sessions -> regime None
    stock = _leader()
    res = MinerviniScanner().scan_stock("LEAD", StockData(
        symbol="LEAD", price_data=stock, benchmark_data=short_bench, market="US"))
    assert res.details["market_uptrend"] is None
    if res.details.get("passes_template"):
        assert res.rating in ("Strong Buy", "Buy")
