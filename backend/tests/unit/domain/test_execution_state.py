"""Unit tests for the execution-state decision tree and the State Cap.

These exercise the pure ``compute_execution_state`` / ``apply_execution_cap``
functions in isolation (no orchestrator, no I/O). Coverage targets:
  * one case per state,
  * the top-down priority order (a broken/invalid base is never reported as a
    Breakout even if its pivot band would otherwise match),
  * the cap only ever lowers a rating and records a reason.
"""
from app.domain.scanning.models import RatingCategory
from app.domain.scanning.scoring import (
    ExecutionState,
    apply_execution_cap,
    compute_execution_state,
)


def _state(**overrides) -> ExecutionState:
    """compute_execution_state for a healthy near-pivot base, with overrides.

    Defaults describe a Stage-2 stock sitting ~1% above a pivot with confirmed
    volume (a Breakout); individual tests override just the fields they probe.
    """
    base = dict(
        price=101.0,
        sma50=90.0,
        sma200=70.0,
        pivot=100.0,
        contraction_low=92.0,
        volume_ratio=2.0,
    )
    base.update(overrides)
    return compute_execution_state(**base)


# --- one case per state -----------------------------------------------------

def test_invalid_when_price_below_bearish_ma_stack():
    assert _state(price=60.0, sma50=70.0, sma200=80.0) is ExecutionState.INVALID


def test_damaged_when_below_50day():
    # Bullish stack (sma50 > sma200) but price lost the 50-day.
    assert _state(price=85.0, sma50=90.0, sma200=70.0) is ExecutionState.DAMAGED


def test_damaged_when_undercuts_contraction_low():
    # Above the 50-day, but below the recent contraction low.
    assert (
        _state(price=88.0, sma50=85.0, contraction_low=90.0)
        is ExecutionState.DAMAGED
    )


def test_overextended_via_sma200_distance():
    # >100% above the 200-day -> overextended even though price is at the pivot.
    assert (
        _state(price=150.0, sma50=120.0, sma200=70.0, pivot=150.0)
        is ExecutionState.OVEREXTENDED
    )


def test_overextended_via_pivot_distance():
    # 12% above the pivot, but not parabolic vs the 200-day.
    assert _state(price=112.0, pivot=100.0) is ExecutionState.OVEREXTENDED


def test_extended_5_to_10_pct_above_pivot():
    assert _state(price=107.0, pivot=100.0) is ExecutionState.EXTENDED


def test_early_post_breakout_3_to_5_pct_above_pivot():
    assert _state(price=104.0, pivot=100.0) is ExecutionState.EARLY_POST_BREAKOUT


def test_early_post_breakout_when_volume_unconfirmed():
    # 0-3% above the pivot but volume below 1.5x -> not a confirmed breakout.
    assert (
        _state(price=101.0, pivot=100.0, volume_ratio=1.0)
        is ExecutionState.EARLY_POST_BREAKOUT
    )


def test_breakout_within_3_pct_with_volume_confirmed():
    assert (
        _state(price=101.0, pivot=100.0, volume_ratio=1.6)
        is ExecutionState.BREAKOUT
    )


def test_pre_breakout_below_pivot():
    assert _state(price=97.0, pivot=100.0) is ExecutionState.PRE_BREAKOUT


def test_pre_breakout_when_no_pivot_but_structure_intact():
    assert _state(pivot=None) is ExecutionState.PRE_BREAKOUT


def test_unknown_when_core_inputs_missing():
    assert _state(price=None) is ExecutionState.UNKNOWN
    assert _state(sma200=None) is ExecutionState.UNKNOWN


# --- priority order ---------------------------------------------------------

def test_invalid_takes_priority_over_pivot_band():
    # Bearish stack AND sitting right at a pivot with confirmed volume: the
    # broken structure must win over the would-be Breakout.
    assert (
        compute_execution_state(
            price=60.0, sma50=70.0, sma200=80.0,
            pivot=60.0, contraction_low=None, volume_ratio=5.0,
        )
        is ExecutionState.INVALID
    )


def test_damaged_takes_priority_over_breakout_band():
    # Pivot sits below the 50-day, price is 1% above that pivot with big volume,
    # but price is still below the 50-day -> Damaged, not Breakout.
    assert (
        compute_execution_state(
            price=88.0, sma50=90.0, sma200=70.0,
            pivot=87.0, contraction_low=None, volume_ratio=5.0,
        )
        is ExecutionState.DAMAGED
    )


# --- State Cap --------------------------------------------------------------

def test_cap_overextended_forces_pass():
    cap = apply_execution_cap(RatingCategory.STRONG_BUY, ExecutionState.OVEREXTENDED)
    assert cap.rating is RatingCategory.PASS
    assert cap.capped is True
    assert "overextended" in cap.reason


def test_cap_extended_to_watch():
    cap = apply_execution_cap(RatingCategory.STRONG_BUY, ExecutionState.EXTENDED)
    assert cap.rating is RatingCategory.WATCH
    assert cap.capped is True


def test_cap_early_post_to_buy():
    cap = apply_execution_cap(RatingCategory.STRONG_BUY, ExecutionState.EARLY_POST_BREAKOUT)
    assert cap.rating is RatingCategory.BUY
    assert cap.capped is True


def test_breakout_and_pre_breakout_are_uncapped():
    for state in (ExecutionState.BREAKOUT, ExecutionState.PRE_BREAKOUT):
        cap = apply_execution_cap(RatingCategory.STRONG_BUY, state)
        assert cap.rating is RatingCategory.STRONG_BUY
        assert cap.capped is False
        assert cap.reason is None


def test_cap_never_upgrades():
    # A WATCH rating under an Extended ceiling (WATCH) stays WATCH, uncapped.
    cap = apply_execution_cap(RatingCategory.WATCH, ExecutionState.EXTENDED)
    assert cap.rating is RatingCategory.WATCH
    assert cap.capped is False


def test_unknown_state_is_pass_through():
    cap = apply_execution_cap(RatingCategory.STRONG_BUY, ExecutionState.UNKNOWN)
    assert cap.rating is RatingCategory.STRONG_BUY
    assert cap.capped is False
