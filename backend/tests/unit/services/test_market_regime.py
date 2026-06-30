"""Tests for the general-market regime engine (Minervini's first rule)."""
import numpy as np
import pandas as pd

from app.services.market_regime import assess_market_regime


def _index(close: np.ndarray, vol: np.ndarray | None = None) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2023-01-02", periods=n)
    close = np.asarray(close, dtype="float64")
    if vol is None:
        vol = np.full(n, 1_000_000.0)
    return pd.DataFrame(
        {"Open": close, "High": close * 1.002, "Low": close * 0.998, "Close": close, "Volume": vol},
        index=idx,
    )


def test_confirmed_uptrend():
    # steady advance, no distribution -> confirmed uptrend, full exposure
    r = assess_market_regime(_index(np.linspace(300, 460, 300)))
    assert r["regime"] == "confirmed_uptrend"
    assert r["exposure_pct"] == 100
    assert r["above_50dma"] and r["above_200dma"] and r["fifty_above_200"]
    assert r["distribution_days"] <= 1


def test_downtrend():
    # below the 200DMA with 50<200 -> downtrend, zero exposure
    r = assess_market_regime(_index(np.linspace(460, 300, 300)))
    assert r["regime"] == "downtrend"
    assert r["exposure_pct"] == 0


def test_distribution_days_push_uptrend_under_pressure():
    # a rising tape, but recent down-on-volume days pile up -> not fully confirmed
    n = 300
    close = np.linspace(300, 430, n)
    vol = np.full(n, 1_000_000.0)
    # inject 5 distribution days into the last 25 sessions: down >=0.2% on higher vol
    for k in (4, 8, 12, 16, 20):
        i = n - k
        close[i] = close[i - 1] * 0.99      # down ~1%
        vol[i] = vol[i - 1] * 1.5           # on higher volume
    r = assess_market_regime(_index(close, vol))
    assert r["distribution_days"] >= 4
    assert r["regime"] in ("uptrend_under_pressure", "correction")
    assert r["exposure_pct"] < 100


def test_insufficient_data_returns_none():
    r = assess_market_regime(_index(np.linspace(100, 110, 50)))
    assert r["regime"] is None
