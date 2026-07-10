"""SEPA fundamental bonus: capped add-on, neutral on missing data.

Pins the C43 contract: fundamentals re-rank template passers (bounded +10
bonus on the score) but never touch passes_template, and the 908-harness
path (fundamentals=None) gets bonus 0 so MSCORE is unchanged by construction.
"""
import numpy as np
import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.criteria.fundamental_bonus import (
    MAX_FUNDAMENTAL_BONUS,
    compute_fundamental_bonus,
)
from app.scanners.minervini_scanner import MinerviniScanner


# --- pure function -----------------------------------------------------------

def test_no_fundamentals_is_neutral_zero():
    for payload in (None, {}):
        out = compute_fundamental_bonus(payload)
        assert out["bonus"] == 0.0
        assert out["available"] is False
        assert all(c["met"] is None for c in out["components"].values())


def test_full_house_hits_the_cap_exactly():
    out = compute_fundamental_bonus({
        "code33": True,          # +4.0
        "eps_growth_qq": 45.0,   # +2.5
        "sales_growth_qq": 30.0,  # +1.5
        "roe": 23.4,             # +1.0
        "eps_rating": 92,        # +1.0
    })
    assert out["bonus"] == MAX_FUNDAMENTAL_BONUS == 10.0
    assert out["available"] is True


def test_eps_growth_tiers():
    assert compute_fundamental_bonus({"eps_growth_qq": 40.0})["bonus"] == 2.5
    assert compute_fundamental_bonus({"eps_growth_qq": 39.9})["bonus"] == 1.5
    assert compute_fundamental_bonus({"eps_growth_qq": 25.0})["bonus"] == 1.5
    assert compute_fundamental_bonus({"eps_growth_qq": 24.9})["bonus"] == 0.0


def test_sales_growth_tiers():
    assert compute_fundamental_bonus({"sales_growth_qq": 25.0})["bonus"] == 1.5
    assert compute_fundamental_bonus({"sales_growth_qq": 10.0})["bonus"] == 0.5
    assert compute_fundamental_bonus({"sales_growth_qq": 9.9})["bonus"] == 0.0


def test_roe_threshold_and_fraction_normalization():
    # finviz percent convention
    assert compute_fundamental_bonus({"roe": 17.0})["bonus"] == 1.0
    assert compute_fundamental_bonus({"roe": 16.9})["bonus"] == 0.0
    # legacy yfinance fraction convention (0.234 == 23.4%)
    assert compute_fundamental_bonus({"roe": 0.234})["bonus"] == 1.0
    assert compute_fundamental_bonus({"roe": 0.15})["bonus"] == 0.0


def test_eps_rating_ibd_buy_minimum():
    assert compute_fundamental_bonus({"eps_rating": 80})["bonus"] == 1.0
    assert compute_fundamental_bonus({"eps_rating": 79})["bonus"] == 0.0


def test_code33_false_is_a_measured_miss_not_missing():
    out = compute_fundamental_bonus({"code33": False})
    assert out["bonus"] == 0.0
    assert out["available"] is True
    assert out["components"]["code33"]["met"] is False


def test_garbage_values_are_neutral():
    out = compute_fundamental_bonus({
        "code33": None,
        "eps_growth_qq": "N/A",
        "sales_growth_qq": "",
        "roe": "-",
        "eps_rating": object(),
    })
    assert out["bonus"] == 0.0
    assert out["available"] is False


def test_eps_growth_quarterly_alias_accepted():
    out = compute_fundamental_bonus({"eps_growth_quarterly": 50.0})
    assert out["bonus"] == 2.5


# --- scanner integration -----------------------------------------------------

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


def _uptrend_stock_data(fundamentals=None) -> StockData:
    stock = _frame(np.linspace(10, 100, 540))
    bench = _frame(np.linspace(100, 100.5, 540))
    return StockData(
        symbol="X", price_data=stock, benchmark_data=bench,
        market="US", fundamentals=fundamentals,
    )


def test_scanner_score_unchanged_without_fundamentals():
    """The 908 harness constructs StockData with fundamentals=None: bonus must
    be exactly 0 there (MSCORE frozen-metric neutrality)."""
    res = MinerviniScanner().scan_stock("X", _uptrend_stock_data(fundamentals=None))
    assert res.details["fundamental_bonus"] == 0.0
    assert res.breakdown["fundamental_bonus"] == 0.0


def test_scanner_adds_capped_bonus_and_keeps_template_untouched():
    base = MinerviniScanner().scan_stock("X", _uptrend_stock_data(fundamentals=None))
    boosted = MinerviniScanner().scan_stock("X", _uptrend_stock_data(fundamentals={
        "code33": True, "eps_growth_qq": 45.0, "sales_growth_qq": 30.0,
        "roe": 23.4, "eps_rating": 92,
    }))
    assert boosted.details["passes_template"] == base.details["passes_template"]
    expected = min(100.0, base.score + 10.0)
    assert boosted.score == round(expected, 2)
    assert boosted.details["fundamental_bonus"] == 10.0
    components = boosted.details["full_analysis"]["fundamental_bonus"]["components"]
    assert components["code33"]["points"] == 4.0


def test_scanner_score_clamped_at_100():
    res = MinerviniScanner().scan_stock("X", _uptrend_stock_data(fundamentals={
        "code33": True, "eps_growth_qq": 45.0, "sales_growth_qq": 30.0,
        "roe": 23.4, "eps_rating": 92,
    }))
    assert res.score <= 100.0
