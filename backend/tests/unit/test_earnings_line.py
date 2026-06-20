"""Tests for the shared earnings-line (収益ライン) computation.

Locks the IBD-style behaviour: a smooth line (geometric interpolation, no
quarterly step jumps), a projected right edge (no flat tail), and no line at all
for a perpetually unprofitable name (no forward EPS available).
"""
import numpy as np
import pandas as pd

from app.services.earnings_line import compute_earnings_line


def _pairs(values, start="2024-03-31"):
    q = pd.date_range(start, periods=len(values), freq="QE")
    return [(d.strftime("%Y-%m-%d"), float(v)) for d, v in zip(q, values)]


def test_turnaround_line_is_smooth_and_not_flat_tailed():
    idx = pd.date_range("2024-06-01", periods=400, freq="B")
    close = np.linspace(300, 2000, 400)
    res = compute_earnings_line(idx, close, _pairs([0.2, 0.4, 0.9, 2.2, 2.5, 3.0, 3.0, 3.6]))
    assert res is not None
    line = res["line"]
    finite = line[np.isfinite(line)]
    assert finite.size > 50

    # Smooth: no large day-to-day jumps (the old linear-TTM line stepped hard).
    jumps = np.abs(np.diff(finite) / finite[:-1])
    assert float(np.nanmax(jumps)) < 0.05  # < 5% per day

    # Right edge is projected, not flat-held.
    assert abs(float(finite[-1] - finite[-2])) > 0


def test_perpetually_unprofitable_returns_none():
    idx = pd.date_range("2024-06-01", periods=400, freq="B")
    close = np.linspace(50, 120, 400)
    # All-negative quarterly EPS -> TTM never positive -> no fair-value line.
    res = compute_earnings_line(idx, close, _pairs([-0.5, -0.4, -0.6, -0.3, -0.5, -0.4, -0.6, -0.3]))
    assert res is None


def test_line_tracks_price_order_of_magnitude():
    idx = pd.date_range("2024-01-01", periods=500, freq="B")
    close = np.linspace(20, 120, 500)
    res = compute_earnings_line(idx, close, _pairs([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]))
    assert res is not None
    finite = res["line"][np.isfinite(res["line"])]
    assert finite.min() > 0
    assert finite.max() <= close.max() * 3  # price-scaled, not raw $/share
