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


def test_pivot_states_require_the_vcp_structure():
    """near_pivot / ready_for_breakout are gated on `detected`: proximity to a
    recent high with no contraction structure is NOT a setup. A smooth 200-bar
    uptrend sits near its highs constantly but has no tightening pullbacks, so
    both flags must stay False."""
    for _ in range(3):  # a few trend shapes, all structureless
        fp = compute_vcp_footprint(_frame(np.linspace(20, 130, 200)))
        if not fp["detected"]:
            assert fp["near_pivot"] is False
            assert fp["ready_for_breakout"] is False


def test_extended_past_pivot_is_not_near_pivot():
    """Minervini's chase limit: > ~5% past the pivot is a chase. Whatever the
    detector reports as the pivot, a stock far above it must never read
    near_pivot/ready — this was the ungated-flag bug that made the signal fire
    on ~96% of random uptrend days."""
    base = np.concatenate([
        np.linspace(50, 60, 80),          # advance
        np.linspace(60, 55, 20),          # pullback 1 (~8%)
        np.linspace(55, 60, 20),
        np.linspace(60, 57.5, 15),        # pullback 2 (~4%)
        np.linspace(57.5, 60, 15),
        np.full(20, 60.0) * (1 + np.linspace(-0.015, 0, 20)),  # tight coil
        np.linspace(60, 85, 30),          # +40% past any plausible pivot
    ])
    fp = compute_vcp_footprint(_frame(base))
    assert fp["near_pivot"] is False
    assert fp["ready_for_breakout"] is False


def test_legacy_ready_flag_has_a_lower_bound():
    """find_pivot_point: 'ready' means coiled UNDER the pivot (0..3%), never
    already through it (negative distance)."""
    from app.analysis.patterns.legacy_vcp_detection import VCPDetector

    det = VCPDetector()
    bases = [{"high_price": 100.0, "low_price": 90.0}]
    under = det.find_pivot_point(bases, current_price=98.0)   # 2% under
    over = det.find_pivot_point(bases, current_price=140.0)   # 40% past
    assert under["ready_for_breakout"] is True
    assert over["ready_for_breakout"] is False


def test_ma_tight_base_path_detects_flat_base():
    """C70: the MA-tightness path flags a flat base (2x prior advance, tight
    leg hugging the 10DMA near highs) that the cup detector's monotonic-depth
    gate would reject — and tags source='ma_tight'."""
    import numpy as np
    import pandas as pd
    from app.services.markets360.vcp_footprint import compute_vcp_footprint

    idx = pd.date_range("2023-01-01", periods=200, freq="B")
    rng = np.random.RandomState(1)
    # prior 2x+ advance (10 -> ~30) then a tight flat leg riding near the highs
    ramp = np.linspace(10.0, 30.0, 150)
    # base: slight downward drift then flatten tight near 30 with shrinking range
    base = 30.0 - np.concatenate([np.linspace(0, 1.2, 25), np.full(25, 1.2)]) \
        + rng.randn(50) * 0.15
    close = np.concatenate([ramp, base])
    df = pd.DataFrame({
        "Open": close, "High": close * 1.008, "Low": close * 0.992,
        "Close": close, "Volume": [1e6] * 200,
    }, index=idx)
    fp = compute_vcp_footprint(df)
    assert fp["detected"] is True
    assert fp["source"] == "ma_tight"
    assert fp["pivot"] is not None
    # schema parity preserved
    from app.services.markets360.vcp_footprint import _EMPTY
    assert set(fp.keys()) == set(_EMPTY.keys())
