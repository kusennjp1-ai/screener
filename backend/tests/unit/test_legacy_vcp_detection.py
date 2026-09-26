"""Regression tests for VCP inference, not complete book certification.

Verify chronology, small final contractions, positive durations and mandatory
volume evidence independently of scores calibrated to historic trade ideas.
"""

import pandas as pd

from app.analysis.patterns.legacy_vcp_detection import VCPDetector


def _bases():
    # Most-recent-first; start_idx = more-recent peak (lower index),
    # end_idx = older peak (higher index) — the real ordering.
    return [
        {"start_idx": 0, "end_idx": 10, "high_price": 120, "low_price": 113, "depth_pct": 6},
        {"start_idx": 30, "end_idx": 40, "high_price": 115, "low_price": 101, "depth_pct": 12},
        {"start_idx": 60, "end_idx": 70, "high_price": 110, "low_price": 86, "depth_pct": 22},
    ]


def test_default_min_bases_admits_two_contraction_vcp():
    assert VCPDetector().min_bases == 2


def test_volume_contraction_detects_drying_up_volume():
    det = VCPDetector()
    vols = pd.Series([0.0] * 100)
    vols.iloc[0:11] = 700_000      # newest base -> lowest volume
    vols.iloc[30:41] = 1_100_000   # middle
    vols.iloc[60:71] = 1_800_000   # oldest base -> highest volume

    contracting, score = det.check_volume_contraction(_bases(), vols)
    assert contracting is True
    assert score > 0


def test_volume_contraction_rejects_flat_volume():
    det = VCPDetector()
    flat = pd.Series([1_000_000.0] * 100)
    contracting, _ = det.check_volume_contraction(_bases(), flat)
    assert contracting is False


def test_volume_segments_are_not_empty():
    """The base/volume slice must overlap the data (the original 0%-volume bug
    sliced iloc[end_idx:start_idx+1], i.e. high->low, an always-empty range)."""
    det = VCPDetector()
    # Volume present only inside the (correct) base segments; if the slice were
    # still inverted, base_volumes would be empty and this would be False.
    vols = pd.Series([0.0] * 100)
    vols.iloc[0:11] = 500_000
    vols.iloc[30:41] = 900_000
    vols.iloc[60:71] = 1_500_000
    contracting, score = det.check_volume_contraction(_bases(), vols)
    assert (contracting, score) != (False, 0.0)


def test_depth_contraction_accepts_ordered_tightening():
    """All chronological legs tighten; no score may replace this evidence."""
    det = VCPDetector()
    bases = [
        {"start_idx": 0, "end_idx": 10, "high_price": 120, "low_price": 113, "depth_pct": 6},
        {"start_idx": 30, "end_idx": 40, "high_price": 115, "low_price": 104, "depth_pct": 10},
        {"start_idx": 60, "end_idx": 70, "high_price": 110, "low_price": 96, "depth_pct": 13},
        {"start_idx": 80, "end_idx": 90, "high_price": 108, "low_price": 84, "depth_pct": 22},
    ]
    contracting, _, ratio = det.check_contracting_volatility(bases)
    assert contracting is True
    assert ratio >= 0.6


def test_book_search_can_retain_six_contractions(monkeypatch):
    det = VCPDetector()
    assert det.max_bases == 6
    prices = pd.Series([100.0] * 150)
    peaks = [5, 20, 35, 50, 65, 80, 95]
    for i, depth in enumerate([3, 5, 9, 15, 24, 35]):
        prices.iloc[peaks[i] + 5] = 100 - depth
    monkeypatch.setattr(det, "_find_peaks", lambda _: peaks)
    bases = det.find_consolidation_bases(prices)
    assert len(bases) == 6
    assert bases[0]["depth_pct"] == 3
    assert all(b["duration"] == 15 for b in bases)


def test_pullback_depth_uses_older_starting_peak_not_recovery(monkeypatch):
    det = VCPDetector()
    prices = pd.Series([100.0] * 150)
    prices.iloc[5] = 110  # subsequent recovery must not inflate the old decline
    prices.iloc[10] = 97
    monkeypatch.setattr(det, "_find_peaks", lambda _: [5, 20])
    base = det.find_consolidation_bases(prices)[0]
    assert base["high_price"] == 100
    assert base["depth_pct"] == 3
    assert base["duration"] == 15


def test_expanding_intermediate_leg_is_not_strict_contraction():
    bases = [{"depth_pct": depth} for depth in [3, 8, 6, 20]]
    contracting, _, ratio = VCPDetector().check_contracting_volatility(bases)
    assert ratio == 2 / 3
    assert contracting is False


def test_missing_volume_segment_cannot_be_skipped():
    import numpy as np
    volumes = pd.Series([1_000_000.0] * 100)
    volumes.iloc[0:11] = 500_000
    volumes.iloc[30:41] = np.nan
    assert VCPDetector().check_volume_contraction(_bases(), volumes) == (False, 0.0)


def test_price_above_old_high_is_not_coiled_below_pivot():
    assert VCPDetector().check_tightness_near_highs(140, 120)[0] is False


def test_candidate_requires_volume_and_right_edge_evidence(monkeypatch):
    det = VCPDetector()
    bases = [
        {"start_idx": 0, "end_idx": 10, "high_price": 120, "low_price": 116.4, "depth_pct": 3},
        {"start_idx": 30, "end_idx": 40, "high_price": 120, "low_price": 112.8, "depth_pct": 6},
    ]
    monkeypatch.setattr(det, "find_consolidation_bases", lambda _: bases)
    prices = pd.Series([119.0] * 150)
    # With all price checks favourable, absence of volume must still veto.
    assert not det.detect_vcp(prices)["vcp_detected"]
    flat = pd.Series([1_000_000.0] * 150)
    assert not det.detect_vcp(prices, flat)["vcp_detected"]
    drying = pd.Series([1_500_000.0] * 150)
    drying.iloc[:11] = 500_000
    drying.iloc[30:41] = 1_000_000
    result = det.detect_vcp(prices, drying)
    assert result["vcp_detected"]
    assert result["right_edge_volume_ratio"] < 1
    assert result["evidence_scope"] == "close_based_inference_not_book_certification"
    # Heavy immediate-right-edge selling cannot be hidden by base averages.
    drying.iloc[:5] = 3_000_000
    assert not det.detect_vcp(prices, drying)["vcp_detected"]
