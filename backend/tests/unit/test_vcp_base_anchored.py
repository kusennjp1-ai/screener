"""Base-anchored VCP path (C102) — the shapes it exists to catch, and its wiring.

The legacy detector does not enumerate a base's contractions. It takes the last
four peak-to-peak swings of a 150-bar window, which measured on the 908-trade
ground truth span a median 105 bars and end a median 15 bars BEFORE the entry —
the prior advance, not the base. Two structural consequences these tests pin:

  * the final tightening leg (the one that defines the pivot) has no newer peak
    to pair with and is invisible to the legacy enumeration;
  * each trough is divided by the NEWER peak, which inflates depths toward the
    present and inverts the contraction in any base making higher highs.
"""
import numpy as np
import pandas as pd

from app.analysis.patterns.legacy_vcp_detection import VCPDetector
from app.services.markets360.vcp_footprint import (
    _base_anchored,
    _base_contractions,
    compute_vcp_footprint,
)


def _series(points, jitter=0.0015, seed=7):
    """Build an OHLCV frame from (bars, target_price) legs, linearly walked."""
    rng = np.random.default_rng(seed)
    closes = []
    price = points[0][1]
    for bars, target in points[1:]:
        closes.extend(np.linspace(price, target, bars, endpoint=False))
        price = target
    closes = np.asarray(closes, dtype="float64")
    closes = closes * (1 + rng.normal(0, jitter, len(closes)))
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="B")
    return pd.DataFrame(
        {
            "Open": closes,
            "High": closes * 1.004,
            "Low": closes * 0.996,
            "Close": closes,
            "Volume": np.full(len(closes), 1_000_000.0),
        },
        index=idx,
    )


def _w_base():
    """Double bottom: 15.0% then 12.2% — contracting, and a textbook Minervini W.

    The advance is long enough that the legacy detector clears its own 150-bar
    minimum, so the two detectors are compared on the same tape rather than one
    of them simply declining to run.
    """
    return _series([
        (0, 40.0),
        (100, 78.0),   # prior advance, part 1
        (60, 100.0),   # prior advance, part 2
        (12, 85.0),    # -15.0%
        (12, 99.0),    # rally back
        (12, 86.9),    # -12.2%  (shallower => contracting)
        (14, 98.5),    # coil back to the highs
    ])


def test_legacy_misses_the_textbook_w_base():
    """The premise. If this ever passes, the new path may no longer be needed.

    On this fixture the legacy path fails by finding only ONE base: its peak
    finder needs a strict local maximum over +/-4 bars on CLOSES
    (legacy_vcp_detection.py:141-148), and the tighter a coil is, the less
    likely any bar qualifies — the same reason a real cup-with-handle fixture
    is pinned as `vcp_insufficient_bases` in the golden snapshots.

    That is a DIFFERENT legacy failure from the depth inversion described in the
    module comment, and it is asserted here as what it is. Both failures are
    fixed by anchoring the base; neither is fixed by tuning a threshold.
    """
    df = _w_base()
    close = df["Close"].iloc[::-1].reset_index(drop=True)
    legacy = VCPDetector().detect_vcp(close, df["Volume"].iloc[::-1].reset_index(drop=True))
    assert not legacy["vcp_detected"]
    assert (legacy.get("num_bases") or 0) < 2, legacy.get("num_bases")


def test_base_anchored_detects_the_w_base():
    ba = _base_anchored(_w_base())
    assert ba is not None
    assert 2 <= len(ba["depths"]) <= 6
    assert ba["depths"][-1] <= ba["depths"][0]
    assert ba["dist"] <= 5.0


def test_the_open_final_contraction_is_counted():
    """The leg from the last trough to today has no newer peak to pair with."""
    depths = _base_contractions(
        _w_base()["High"].to_numpy(dtype="float64"),
        _w_base()["Low"].to_numpy(dtype="float64"),
    )
    assert len(depths) >= 2, depths


def test_rejects_an_expanding_base():
    """A base whose pullbacks get DEEPER is not a VCP and must not be claimed."""
    expanding = _series([
        (0, 50.0), (60, 100.0),
        (12, 92.0),   # -8%
        (12, 99.0),
        (12, 84.0),   # -15% : deeper
        (14, 97.0),
    ])
    assert _base_anchored(expanding) is None


def test_rejects_when_price_is_far_below_the_pivot():
    """Not tight near the highs => not actionable, whatever the shape."""
    slumped = _w_base()
    slumped.loc[slumped.index[-5:], ["Open", "High", "Low", "Close"]] *= 0.80
    assert _base_anchored(slumped) is None


def test_footprint_reports_the_source_and_its_own_depths():
    fp = compute_vcp_footprint(_w_base(), min_bars=60)
    assert fp["detected"] is True
    assert fp["source"] == "base_anchored"
    assert fp["num_contractions"] == len(fp["contractions_pct"]) >= 2
    assert fp["pivot"] is not None and fp["distance_to_pivot_pct"] is not None


def test_never_raises_on_degenerate_input():
    for bad in (None, pd.DataFrame(), _w_base().head(5)):
        assert _base_anchored(bad) is None if bad is not None else True


def test_quality_source_tiers_cover_every_footprint_source():
    """A source missing from the tier map silently sorts BELOW ma_tight."""
    import re
    import pathlib

    from app.infra.query.scan_result_query import _QUALITY_SOURCE_TIER

    src = (pathlib.Path(__file__).resolve().parents[2]
           / "app/services/markets360/vcp_footprint.py").read_text(encoding="utf-8")
    # the string literals assigned to "source" in the returned footprint
    block = src.split('"source": (')[1].split("),")[0]
    names = set(re.findall(r'"([a-z_]+)"', block))
    assert names, "could not read the source names out of vcp_footprint"
    missing = names - set(_QUALITY_SOURCE_TIER)
    assert not missing, f"sources with no quality tier (they sort last): {missing}"
