"""Regression tests for the legacy VCP detector's contraction checks.

Locks the calibration fixes made after measuring the detector against Mark
Minervini's real trade ideas (it had flagged 0% of them):
  * the volume "drying up" check must read the SAME segment as the price base
    (start_idx..end_idx); the old code sliced it backwards into an always-empty
    range, so volume contraction passed for nobody, and
  * it must test the right DIRECTION (oldest contraction carries the most
    volume, newest the least) with tolerance, not a strict all()-monotonic on
    the wrong end, and
  * 2-contraction VCPs are admitted (min_bases default = 2).
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


def test_depth_contraction_tolerates_one_noisy_step():
    """0.6 threshold: 2 of 3 tightening pullbacks should still count."""
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
