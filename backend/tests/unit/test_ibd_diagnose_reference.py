"""Unit tests for the pure helpers of the IBD-50 reference diagnostic."""

from __future__ import annotations

from datetime import date

from app.scripts.ibd_diagnose_reference import _gate_failures, _nearest_reference
from app.services.ibd_calibration import Gates


def test_gate_failures_passes_a_clean_leader():
    row = {
        "composite_rating": 97,
        "rs_rating": 92,
        "ibd_group_rank": 20,
        "week_52_high_distance": -5,
    }
    assert _gate_failures(row, Gates()) == []


def test_gate_failures_flags_each_failing_gate():
    row = {
        "composite_rating": 80,   # < 90
        "rs_rating": 70,          # < 85
        "ibd_group_rank": 150,    # > 120
        "week_52_high_distance": -40,  # < -15
    }
    fails = _gate_failures(row, Gates())
    assert any(f.startswith("composite") for f in fails)
    assert any(f.startswith("rs") for f in fails)
    assert any(f.startswith("group") for f in fails)
    assert any(f.startswith("highdist") for f in fails)


def test_gate_failures_treats_missing_composite_as_fail_but_missing_highdist_as_pass():
    row = {"composite_rating": None, "rs_rating": 99, "ibd_group_rank": 5,
           "week_52_high_distance": None}
    fails = _gate_failures(row, Gates())
    assert fails == ["composite<90"]  # only composite fails; absent hi-dist is lenient


def test_nearest_reference_picks_closest_within_gap():
    refs = {
        "2026-06-13": "older",
        "2026-06-20": "closest",
        "2026-07-01": "too_far",
    }
    assert _nearest_reference(refs, date(2026, 6, 22), max_gap_days=7) == "closest"


def test_nearest_reference_returns_none_when_all_outside_gap():
    refs = {"2026-05-01": "x"}
    assert _nearest_reference(refs, date(2026, 6, 22), max_gap_days=7) is None
