"""Unit tests for the Markets 360 screener and the ETF classifier."""
import numpy as np
import pandas as pd

from app.scanners.markets360_scanner import Markets360Scanner
from app.scanners.base_screener import StockData
from app.services.security_type import classify_is_etf


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


def test_scanner_passes_a_stage2_leader():
    """A stock in a clean Stage-2 advance, strongly outperforming a flat market,
    is flagged as a buyable SEPA leader (passes, Strong Buy/Buy)."""
    n = 540
    stock = _frame(np.linspace(20, 130, n))            # steady leader
    bench = _frame(np.linspace(100, 104, n))           # ~flat S&P
    data = StockData(symbol="LEAD", price_data=stock, benchmark_data=bench, market="US")

    res = Markets360Scanner().scan_stock("LEAD", data)
    assert res.screener_name == "markets360"
    assert res.details["tpr_state"] == "strong"
    assert res.passes is True
    assert res.rating in ("Strong Buy", "Buy")
    assert 0 <= res.score <= 100


def test_rpr_uses_authentic_percentile_when_universe_supplied():
    """With the orchestrator's universe outperformance list attached, RPR is a
    percentile rank against it — not the hand-calibrated fallback curve. A
    leader beating every universe name reads 9x+; the same leader ranked
    against a universe of even stronger names reads low."""
    n = 540
    stock = _frame(np.linspace(20, 130, n))
    bench = _frame(np.linspace(100, 104, n))
    scanner = Markets360Scanner()

    weak_universe = {"weighted": [-20.0, -5.0, 0.0, 5.0, 10.0, 20.0]}
    strong_universe = {"weighted": [400.0, 500.0, 600.0, 700.0, 800.0, 900.0]}

    top = scanner.scan_stock("LEAD", StockData(
        symbol="LEAD", price_data=stock, benchmark_data=bench, market="US",
        rs_universe_performances=weak_universe))
    bottom = scanner.scan_stock("LEAD", StockData(
        symbol="LEAD", price_data=stock, benchmark_data=bench, market="US",
        rs_universe_performances=strong_universe))
    assert top.details["rpr"] >= 90
    assert bottom.details["rpr"] <= 10
    # and the two calls prove the universe (not the curve) drove the number
    assert top.details["rpr"] != bottom.details["rpr"]


def test_market_regime_caps_a_leader_in_a_bad_market():
    """Same Stage-2 leader: in a confirmed-uptrend market it is buyable (Buy/Strong
    Buy); in a downtrending market the setup still passes (watchlist) but the rating
    is capped to Watch and buyable_now is False — Minervini's market-timing rule."""
    n = 540
    stock = _frame(np.linspace(20, 130, n))
    healthy = _frame(np.linspace(300, 460, n))      # market in its own Stage 2
    broken = _frame(np.linspace(460, 300, n))       # market downtrend

    up = Markets360Scanner().scan_stock(
        "LEAD", StockData(symbol="LEAD", price_data=stock, benchmark_data=healthy, market="US"))
    down = Markets360Scanner().scan_stock(
        "LEAD", StockData(symbol="LEAD", price_data=stock, benchmark_data=broken, market="US"))

    assert up.passes is True and down.passes is True            # watchlist unchanged
    assert up.details["buyable_now"] is True
    assert down.details["buyable_now"] is False
    assert up.rating in ("Strong Buy", "Buy")
    assert down.rating == "Watch"                                # capped by market timing
    assert down.details["market_regime"] == "downtrend"


def test_scanner_rejects_a_downtrend():
    n = 540
    stock = _frame(np.linspace(130, 40, n))            # broken downtrend
    bench = _frame(np.linspace(100, 120, n))
    data = StockData(symbol="DOWN", price_data=stock, benchmark_data=bench, market="US")

    res = Markets360Scanner().scan_stock("DOWN", data)
    assert res.passes is False
    assert res.details["tpr_state"] == "weak"


def test_scanner_weekly_timeframe_runs():
    n = 760
    stock = _frame(np.linspace(20, 150, n))
    bench = _frame(np.linspace(100, 105, n))
    data = StockData(symbol="WK", price_data=stock, benchmark_data=bench, market="US")

    res = Markets360Scanner().scan_stock("WK", data, {"timeframe": "weekly"})
    assert res.details["timeframe"] == "weekly"
    assert res.details["tpr_state"] in ("strong", "transition", "weak")


def test_scanner_insufficient_data():
    short = _frame(np.linspace(10, 20, 50))
    data = StockData(symbol="SHORT", price_data=short, benchmark_data=short, market="US")
    res = Markets360Scanner().scan_stock("SHORT", data)
    assert res.rating == "Insufficient Data"
    assert res.passes is False


def test_etf_classifier():
    assert classify_is_etf("SPY") is True
    assert classify_is_etf("QQQ", "Invesco QQQ Trust") is True
    assert classify_is_etf("ZZZZ", name="iShares Biotechnology ETF") is True
    assert classify_is_etf("ZZZZ", source_type="ETF") is True
    assert classify_is_etf("LLY", name="Eli Lilly & Co.") is False
    assert classify_is_etf("MSFT", name="Microsoft Corp.", source_type="stock") is False
