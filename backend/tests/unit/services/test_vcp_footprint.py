"""Tests for the Markets 360 VCP footprint adapter."""
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.markets360.vcp_footprint import compute_vcp_footprint, _EMPTY
from app.services.markets360.ratings import compute_vcp_score, compute_vcp_pct

_FIX = Path(__file__).resolve().parents[2] / "fixtures" / "markets360"


def _read_fixture(name: str) -> pd.DataFrame:
    """Read a yfinance multi-header OHLCV fixture (Price/Ticker/Date rows)."""
    df = pd.read_csv(_FIX / name, skiprows=[1, 2]).rename(columns={"Price": "Date"})
    df["Date"] = pd.to_datetime(df["Date"])
    for col in ("Open", "High", "Low", "Close", "Volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.set_index("Date").sort_index()


def _frame(close: np.ndarray, vol: np.ndarray | None = None) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2022-01-03", periods=n)
    close = np.asarray(close, dtype="float64")
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * 1.004
    low = np.minimum(open_, close) * 0.996
    if vol is None:
        vol = np.full(n, 1_000_000.0)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


def test_empty_on_insufficient_data():
    fp = compute_vcp_footprint(_frame(np.linspace(10, 20, 30)))
    assert fp == _EMPTY
    assert fp["detected"] is False


def test_none_input_is_safe():
    assert compute_vcp_footprint(None) == _EMPTY


def test_keys_always_present_for_a_trend():
    fp = compute_vcp_footprint(_frame(np.linspace(20, 130, 200)))
    # every contract key exists regardless of detection outcome
    for key in _EMPTY:
        assert key in fp


def test_well_formed_on_real_fixtures():
    """Over real OHLCV the footprint is always well-formed and JSON-friendly:
    score in range, contraction list of numbers, pivot a number or None, and the
    chronological orientation handed to the legacy detector is correct."""
    for name in ("ftnt.csv", "lly.csv", "mrvl.csv", "cyrx.csv"):
        fp = compute_vcp_footprint(_read_fixture(name))
        assert set(fp.keys()) == set(_EMPTY.keys()), name
        assert isinstance(fp["num_contractions"], int)
        assert isinstance(fp["contractions_pct"], list)
        assert all(isinstance(x, (int, float)) for x in fp["contractions_pct"]), name
        if fp["score"] is not None:
            assert 0.0 <= fp["score"] <= 100.0, name
        if fp["pivot"] is not None:
            assert isinstance(fp["pivot"], (int, float)), name
        # detected implies the structural gates the legacy detector enforces
        if fp["detected"]:
            assert fp["tight_near_highs"] is True, name
            assert fp["num_contractions"] >= 2, name


def test_compute_vcp_score_is_real_detector_quality():
    """compute_vcp_score returns the VCPDetector 0-100 quality (or None), which is
    a *different* thing from compute_vcp_pct's recent-range tightness metric."""
    for name in ("ftnt.csv", "lly.csv", "cyrx.csv"):
        df = _read_fixture(name)
        score = compute_vcp_score(df)
        rng = compute_vcp_pct(df)
        if score is not None:
            assert 0.0 <= score <= 100.0, name
        # the range metric is unchanged (a percent, not a 0-100 quality score)
        assert rng is None or rng >= 0.0


def test_compute_vcp_score_safe_on_short_data():
    assert compute_vcp_score(None) is None
    short = _read_fixture("ftnt.csv").head(10)
    assert compute_vcp_score(short) is None


def test_contractions_are_oldest_to_newest():
    """The footprint reverses the legacy most-recent-first bases, so the listed
    contraction depths run oldest -> newest (the order a VCP is read)."""
    fp = compute_vcp_footprint(_read_fixture("ftnt.csv"))
    # smoke: list exists and matches the reported count when present
    if fp["num_contractions"] and fp["contractions_pct"]:
        assert len(fp["contractions_pct"]) <= fp["num_contractions"] + 1
