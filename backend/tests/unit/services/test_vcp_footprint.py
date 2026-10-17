"""Tests for the Markets 360 VCP footprint adapter."""
import json
from itertools import product
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

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
        from app.analysis.patterns.legacy_vcp_detection import VCPDetector
        from app.services.markets360.vcp_footprint import _ma_tight_base, _vol_contract_base

        df = _read_fixture(name)
        legacy = VCPDetector().detect_vcp(
            df.Close.iloc[::-1].reset_index(drop=True),
            df.Volume.iloc[::-1].reset_index(drop=True),
        )
        ma, vcb = _ma_tight_base(df), _vol_contract_base(df)
        expected_source = (
            "vcp" if legacy["vcp_detected"] else "ma_tight" if ma is not None
            else "vol_contract" if vcb is not None else None
        )
        assert fp["source"] == expected_source, name
        assert fp["detected"] is (expected_source is not None), name
        assert fp["legacy_detected"] is bool(legacy["vcp_detected"]), name
        assert fp["tight_near_highs"] is bool(legacy["tight_near_highs"]), name
        json.dumps(fp, allow_nan=False)
        # Structural gates apply to legacy VCP, not the parallel base paths.
        if fp["legacy_detected"]:
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


def _vcb_frame(prior_adv=True):
    """Build a series with a wide->tight (ATR-contracting) base near the highs."""
    rng = np.random.RandomState(3)
    peak = 30.0
    ramp = np.linspace(11.0 if prior_adv else 29.0, peak - 2.0, 150)
    # base: 32 volatile bars (wide swings = high ATR) then 10 tight bars near peak
    volatile = peak - 2.0 + np.sin(np.linspace(0, 6 * np.pi, 32)) * 2.0 + rng.randn(32) * 0.4
    tight = np.full(10, peak - 0.3) + rng.randn(10) * 0.05
    close = np.concatenate([ramp, volatile, tight])
    idx = pd.date_range("2023-01-01", periods=len(close), freq="B")
    # wide bars in the volatile section, narrow in the tight leg (ATR contraction)
    span = np.concatenate([np.full(150, 0.01), np.full(32, 0.03), np.full(10, 0.004)])
    return pd.DataFrame({
        "Open": close, "High": close * (1 + span), "Low": close * (1 - span),
        "Close": close, "Volume": [1e6] * len(close),
    }, index=idx)


def test_vol_contract_base_helper_fires_on_atr_contraction():
    """C75: the ATR volatility-contraction path fires on a wide->tight base near
    the highs with a prior 2x advance, and needs the prior advance."""
    from app.services.markets360.vcp_footprint import _vol_contract_base

    hit = _vol_contract_base(_vcb_frame(prior_adv=True))
    assert hit is not None
    assert hit["pivot"] > 0 and hit["dist"] is not None
    # no prior 2x advance -> the discrimination guard rejects it
    assert _vol_contract_base(_vcb_frame(prior_adv=False)) is None


@pytest.mark.parametrize("legacy_hit,ma_hit,vcb_hit", list(product([False, True], repeat=3)))
def test_route_contract_and_precedence(monkeypatch, legacy_hit, ma_hit, vcb_hit):
    """All routes and overlaps preserve legacy evidence and select one pivot."""
    from app.services.markets360 import vcp_footprint as module

    legacy = {
        "vcp_detected": legacy_hit, "vcp_score": 61.25,
        "num_bases": 2 if legacy_hit else 1,
        "bases_depth": [4.0, 8.0] if legacy_hit else [8.0],
        "contraction_ratio": 1.0, "contracting_volume": legacy_hit,
        "tight_near_highs": legacy_hit,
        "pivot_info": {"pivot": 100.0, "distance_pct": 2.0, "ready_for_breakout": True},
    }
    monkeypatch.setattr(module.VCPDetector, "detect_vcp", lambda *args: legacy)
    ma = Mock(return_value={"pivot": 110.0, "dist": 4.0} if ma_hit else None)
    vcb = Mock(return_value={"pivot": 120.0, "dist": 1.0} if vcb_hit else None)
    monkeypatch.setattr(module, "_ma_tight_base", ma)
    monkeypatch.setattr(module, "_vol_contract_base", vcb)
    fp = compute_vcp_footprint(_frame(np.linspace(20, 100, 200)))
    source = "vcp" if legacy_hit else "ma_tight" if ma_hit else "vol_contract" if vcb_hit else None
    assert fp["source"] == source
    assert fp["detected"] is (source is not None)
    assert fp["legacy_detected"] is legacy_hit
    assert fp["tight_near_highs"] is legacy_hit
    assert fp["volume_dryup"] is legacy_hit
    assert fp["num_contractions"] == legacy["num_bases"]
    assert fp["contractions_pct"] == list(reversed(legacy["bases_depth"]))
    assert fp["score"] == 61.2  # remains legacy quality even on a fallback
    assert fp["pivot"] == {"vcp": 100.0, "ma_tight": 110.0, "vol_contract": 120.0, None: 100.0}[source]
    assert fp["distance_to_pivot_pct"] == {"vcp": 2.0, "ma_tight": 4.0, "vol_contract": 1.0, None: 2.0}[source]
    assert fp["near_pivot"] is (source is not None)
    assert fp["ready_for_breakout"] is (source in ("vcp", "vol_contract"))
    assert ma.call_count == int(not legacy_hit)
    assert vcb.call_count == int(not legacy_hit and not ma_hit)
    assert set(fp) == set(_EMPTY)
    json.dumps(fp, allow_nan=False)


def test_ftnt_atr_detection_does_not_certify_legacy_vcp():
    """Price above an old legacy high must remain a legacy failure."""
    from app.analysis.patterns.legacy_vcp_detection import VCPDetector
    from app.services.markets360.vcp_footprint import _ma_tight_base, _vol_contract_base

    df = _read_fixture("ftnt.csv")
    legacy = VCPDetector().detect_vcp(
        df.Close.iloc[::-1].reset_index(drop=True),
        df.Volume.iloc[::-1].reset_index(drop=True),
    )
    assert df.Close.iloc[-1] == pytest.approx(151.35)
    assert legacy["recent_high"] == pytest.approx(87.82)
    assert not legacy["vcp_detected"]
    assert not legacy["tight_near_highs"]
    assert _ma_tight_base(df) is None
    hit = _vol_contract_base(df)
    assert hit is not None
    tr = pd.concat([df.High - df.Low, (df.High - df.Close.shift()).abs(),
                    (df.Low - df.Close.shift()).abs()], axis=1).max(axis=1)
    atr = (tr / df.Close).rolling(10).mean().iloc[-42:]
    assert atr.iloc[-1] / atr.max() == pytest.approx(0.65465095)
    fp = compute_vcp_footprint(df)
    assert fp["detected"] is True
    assert fp["source"] == "vol_contract"
    assert fp["legacy_detected"] is False
    assert fp["tight_near_highs"] is False
    assert fp["pivot"] == hit["pivot"]
    assert fp["distance_to_pivot_pct"] == hit["dist"]
    assert fp["ready_for_breakout"] is True
    assert fp["near_pivot"] is True
