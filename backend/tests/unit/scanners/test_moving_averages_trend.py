"""Tests for the Minervini 200-DMA trend criterion (rising, not +1%)."""
from app.scanners.criteria.moving_averages import MovingAverageAnalyzer


def _analyzer():
    return MovingAverageAnalyzer()


def test_slowly_rising_200dma_counts_as_trending_up():
    """A 200-DMA that rises even slightly over the month is 'trending up' — the
    authentic Minervini criterion. The old +1% threshold wrongly rejected this."""
    a = _analyzer()
    # +0.3% over the month: rising, but below the old 1% gate
    r = a.check_200ma_trend(ma_200_current=100.3, ma_200_month_ago=100.0)
    assert r["trending_up"] is True
    assert r["meets_minervini"] is True
    assert r["status"] == "rising"


def test_flat_200dma_is_not_trending_up():
    a = _analyzer()
    r = a.check_200ma_trend(ma_200_current=100.0, ma_200_month_ago=100.0)
    assert r["trending_up"] is False
    assert r["status"] == "flat_or_declining"


def test_declining_200dma_is_not_trending_up():
    a = _analyzer()
    r = a.check_200ma_trend(ma_200_current=98.0, ma_200_month_ago=100.0)
    assert r["trending_up"] is False


def test_custom_threshold_still_honored():
    """A caller can still demand a steeper slope via min_increase_pct."""
    a = _analyzer()
    r = a.check_200ma_trend(100.5, 100.0, min_increase_pct=1.0)
    assert r["trending_up"] is False    # +0.5% < required +1%
    r2 = a.check_200ma_trend(102.0, 100.0, min_increase_pct=1.0)
    assert r2["trending_up"] is True    # +2% > +1%


def test_insufficient_data_guarded():
    a = _analyzer()
    r = a.check_200ma_trend(100.0, 0.0)
    assert r["trending_up"] is False
    assert r["status"] == "insufficient_data"


# -- W3.2: RS period weights are configurable --------------------------------
def test_rs_periods_default_and_override():
    from app.scanners.criteria.relative_strength import RelativeStrengthCalculator
    default = RelativeStrengthCalculator()
    assert default.PERIODS[63] == 0.40
    custom = RelativeStrengthCalculator(periods={63: 0.5, 252: 0.5})
    assert custom.PERIODS == {63: 0.5, 252: 0.5}
    # overriding the instance must not mutate the class default
    assert RelativeStrengthCalculator().PERIODS[63] == 0.40
