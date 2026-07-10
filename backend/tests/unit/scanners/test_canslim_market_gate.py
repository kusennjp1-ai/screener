"""O'Neil's M on the CANSLIM scanner: never rate 'Buy' against the market.

Mirrors the Minervini SEPA rule-1 gate: the score keeps measuring the setup
(C-A-N-S-L-I), but the RATING caps at Watch when the general market is in a
correction/downtrend. An unknown regime (no/short benchmark) never blocks.
"""
import numpy as np
import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.canslim_scanner import CANSLIMScanner


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


def _growth_stock_data(bench: pd.DataFrame) -> StockData:
    return StockData(
        symbol="GRW",
        price_data=_frame(np.linspace(20, 130, 540)),
        benchmark_data=bench,
        market="US",
        quarterly_growth={
            "eps_growth_qq": 45.0, "sales_growth_qq": 30.0,
            "eps_growth_yy": 30.0, "sales_growth_yy": 25.0,
            "recent_quarter_date": None, "previous_quarter_date": None,
        },
        fundamentals={"institutional_ownership": 55.0},
    )


# --- pure rating gate ---------------------------------------------------------

def _strong_details(**overrides):
    d = {"eps_growth_qq": 45.0, "rs_rating": 90}
    d.update(overrides)
    return d


def test_rating_gate_caps_buys_in_a_downtrend():
    scanner = CANSLIMScanner()
    assert scanner.calculate_rating(85, _strong_details(market_uptrend=True)) == "Strong Buy"
    assert scanner.calculate_rating(85, _strong_details(market_uptrend=False)) == "Watch"
    assert scanner.calculate_rating(72, _strong_details(market_uptrend=False)) == "Watch"


def test_unknown_market_never_blocks():
    scanner = CANSLIMScanner()
    assert scanner.calculate_rating(85, _strong_details(market_uptrend=None)) == "Strong Buy"
    assert scanner.calculate_rating(85, _strong_details()) == "Strong Buy"


def test_sub_buy_scores_unaffected_by_the_gate():
    scanner = CANSLIMScanner()
    assert scanner.calculate_rating(65, _strong_details(market_uptrend=False)) == "Watch"
    assert scanner.calculate_rating(30, _strong_details(market_uptrend=False)) == "Pass"


# --- scan-level wiring --------------------------------------------------------

def test_scan_stock_populates_market_fields_and_gates_in_downtrend():
    bench = _frame(np.linspace(460, 300, 540))  # index below falling MAs
    res = CANSLIMScanner().scan_stock("GRW", _growth_stock_data(bench))
    assert res.details["market_regime"] == "downtrend"
    assert res.details["market_uptrend"] is False
    assert res.rating not in ("Strong Buy", "Buy")


def test_scan_stock_in_healthy_market_is_ungated():
    bench = _frame(np.linspace(300, 460, 540))
    res = CANSLIMScanner().scan_stock("GRW", _growth_stock_data(bench))
    assert res.details["market_uptrend"] is True
    # the same synthetic setup must not be capped by the market gate
    assert res.rating in ("Strong Buy", "Buy", "Watch", "Pass")
    if res.score >= 70:
        assert res.rating in ("Strong Buy", "Buy")
