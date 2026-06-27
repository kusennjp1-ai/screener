"""Tests for the Markets 360 band-calibration harness pure functions.

The harness compares our color bands to a real MM360 screenshot and grid-searches
the band tunables. These tests cover the deterministic pieces (pixel
classification, time bucketing, agreement scoring) so the tool itself is trusted
when it is later pointed at real LLY data.
"""
import importlib.util
from pathlib import Path

import numpy as np

_SPEC = importlib.util.spec_from_file_location(
    "m360_cal",
    Path(__file__).resolve().parents[3] / "scripts" / "markets360_band_calibration.py",
)
cal = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cal)


def test_classify_colors():
    assert cal._classify(20, 20, 20) == cal.BG       # black background
    assert cal._classify(40, 160, 60) == cal.GREEN   # strong green
    assert cal._classify(180, 50, 50) == cal.RED     # strong red
    assert cal._classify(170, 150, 40) == cal.AMBER  # amber (R~G, low B)


def test_bucket_maps_states_and_majority_votes():
    states = ["buy"] * 6 + ["sell"] * 6
    out = cal._bucket(states, 2)
    assert out == cal.GREEN + cal.RED
    assert cal._bucket([], 4) == cal.BG * 4
    # transition/neutral/medium collapse to amber
    assert cal._bucket(["transition"] * 4, 1) == cal.AMBER


def test_score_exact_and_coarse():
    real = {"B": "GGRR"}
    ours = {"B": "GGGR"}   # 3/4 exact; coarse groups amber w/ green so still 3/4 here
    s = cal.score(real, ours)
    assert s["B"]["exact"] == 75.0
    assert s["B"]["coarse"] == 75.0


def test_score_coarse_groups_amber_with_green():
    # amber vs green should count as agreeing under the coarse (g/r) metric.
    real = {"B": "AAØ".replace("Ø", cal.RED)}
    ours = {"B": "GG" + cal.RED}
    s = cal.score(real, ours)
    assert s["B"]["coarse"] == 100.0
    assert s["B"]["exact"] < 100.0  # amber != green exactly


def test_extract_image_bands_on_synthetic_strip(tmp_path):
    from PIL import Image

    # Build a tiny image with three solid band rows at the harness' y-bounds.
    img = np.zeros((200, 120, 3), dtype=np.uint8)
    img[93:111, 10:110] = (40, 160, 60)    # Pressure -> green
    img[127:147, 10:110] = (180, 50, 50)   # BuyRisk -> red
    img[160:178, 10:110] = (170, 150, 40)  # TPR -> amber
    p = tmp_path / "synthetic.png"
    Image.fromarray(img).save(p)

    bands = cal.extract_image_bands(str(p), n_buckets=10)
    assert set(bands["Pressure"]) == {cal.GREEN}
    assert set(bands["BuyRisk"]) == {cal.RED}
    assert set(bands["TPR"]) == {cal.AMBER}
