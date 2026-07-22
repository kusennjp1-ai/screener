"""Tests for the Markets 360 risk & exit plan."""
import numpy as np
import pandas as pd

from app.services.markets360.risk import (
    compute_risk_plan,
    r_multiple_targets,
    MAX_LOSS_PCT,
    MAX_POSITION_PCT,
    ACCOUNT_RISK_PCT,
)


def _frame(close: np.ndarray) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2023-01-02", periods=n)
    close = np.asarray(close, dtype="float64")
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * 1.01
    low = np.minimum(open_, close) * 0.99
    vol = np.full(n, 1_000_000.0)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx
    )


def test_insufficient_data_returns_empty():
    plan = compute_risk_plan(_frame(np.linspace(10, 12, 5)))
    assert plan["entry"] is None and plan["stop_loss"] is None


def test_none_input_is_safe():
    plan = compute_risk_plan(None)
    assert plan["targets"] == []


def test_stop_never_exceeds_the_max_loss_cap():
    """A name in a steep recent run-up (its 15-bar low sits far below the entry,
    outside the 8% cap) stops at the hard cap, and the loss equals the cap."""
    n = 260
    # slow base, then a sharp final acceleration so the recent swing low is >8% down
    close = np.concatenate([np.linspace(20, 80, n - 15), np.linspace(82, 120, 15)])
    plan = compute_risk_plan(_frame(close))
    assert plan["stop_pct"] <= MAX_LOSS_PCT * 100 + 1e-6
    assert plan["stop_basis"] == "max_loss_cap"
    assert abs(plan["stop_pct"] - MAX_LOSS_PCT * 100) < 0.5


def test_tight_base_uses_the_base_low_for_a_smaller_stop():
    """When the recent base low sits just under the entry (inside the 8% cap), the
    stop tightens to the base low and risk shrinks below the cap."""
    n = 260
    close = np.concatenate([np.linspace(20, 100, n - 12), np.full(12, 100.0) * (1 + np.linspace(-0.02, 0, 12))])
    plan = compute_risk_plan(_frame(close))
    assert plan["stop_basis"] == "base_low"
    assert plan["stop_pct"] < MAX_LOSS_PCT * 100


def test_position_size_is_stop_defined():
    """Allocation = account-risk / stop%, so a wider stop -> a smaller position,
    and a stop-out costs ~account_risk_pct of equity."""
    plan = compute_risk_plan(_frame(np.linspace(20, 120, 260)))
    expected = min(MAX_POSITION_PCT, ACCOUNT_RISK_PCT / (plan["stop_pct"] / 100.0))
    assert abs(plan["position_size_pct"] - round(expected, 1)) < 0.1
    # this fixture's stop is wide enough that the cap does not bite, so being
    # stopped costs ~account_risk_pct of the account
    assert plan["position_size_pct"] < MAX_POSITION_PCT
    loss_to_account = plan["position_size_pct"] / 100.0 * plan["stop_pct"]
    assert abs(loss_to_account - ACCOUNT_RISK_PCT) < 0.05


def test_position_size_is_capped_for_very_tight_stops():
    """A very tight stop must NOT imply a huge single-name bet — the size caps at
    MAX_POSITION_PCT and being stopped then costs LESS than the account risk."""
    # Flat frame -> base-low stop ~1% -> uncapped size would be ~125% of capital.
    idx = pd.date_range("2024-01-01", periods=60, freq="B")
    df = pd.DataFrame(
        {"Close": [100.0] * 60, "Low": [99.0] * 60, "High": [100.5] * 60}, index=idx
    )
    plan = compute_risk_plan(df)
    assert plan["position_size_pct"] == MAX_POSITION_PCT
    loss_to_account = plan["position_size_pct"] / 100.0 * plan["stop_pct"]
    assert loss_to_account < ACCOUNT_RISK_PCT


def test_targets_are_r_multiples_of_risk():
    plan = compute_risk_plan(_frame(np.linspace(20, 120, 260)))
    entry, risk = plan["entry"], plan["risk_per_share"]
    by_r = {t["r_multiple"]: t for t in plan["targets"]}
    assert abs(by_r[2.0]["price"] - (entry + 2 * risk)) < 0.02
    assert abs(by_r[3.0]["price"] - (entry + 3 * risk)) < 0.02


def test_pivot_entry_is_used_when_supplied():
    plan = compute_risk_plan(_frame(np.linspace(20, 100, 260)), pivot=105.0)
    assert plan["entry"] == 105.0


def test_r_multiple_targets_formula():
    t = r_multiple_targets(100.0, 92.0)            # risk = 8, stop_pct = 8%
    by_r = {x["r_multiple"]: x for x in t}
    assert by_r[2.0]["price"] == 116.0             # 100 + 2*8
    assert by_r[3.0]["price"] == 124.0             # 100 + 3*8
    assert by_r[2.0]["gain_pct"] == 16.0           # 2 * 8%


def test_r_multiple_targets_empty_when_risk_nonpositive():
    assert r_multiple_targets(100.0, 100.0) == []  # stop at entry -> no targets
    assert r_multiple_targets(100.0, 110.0) == []  # stop above entry
    assert r_multiple_targets(None, 90.0) == []


class TestProgressiveRisk:
    """C61-validated progressive risk: 2x account heat only in confirmed uptrends."""

    def test_regime_scaling(self):
        from app.services.markets360.risk import (
            ACCOUNT_RISK_PCT,
            ACCOUNT_RISK_PCT_CONFIRMED,
            account_risk_pct_for_regime,
        )
        assert account_risk_pct_for_regime("confirmed_uptrend") == ACCOUNT_RISK_PCT_CONFIRMED
        for other in ("uptrend_under_pressure", "correction", "downtrend", None):
            assert account_risk_pct_for_regime(other) == ACCOUNT_RISK_PCT

    def test_plan_carries_risk_pct_and_size_scales(self):
        import pandas as pd
        from app.services.markets360.risk import compute_risk_plan

        idx = pd.date_range("2024-01-01", periods=60, freq="B")
        # Low = 92 -> an 8% stop (the hard cap), wide enough that the 1.25% base
        # size is well under MAX_POSITION_PCT, so the 2x scaling is visible.
        df = pd.DataFrame(
            {"Close": [100.0] * 60, "Low": [92.0] * 60, "High": [101.0] * 60},
            index=idx,
        )
        base = compute_risk_plan(df, account_risk_pct=1.25)
        double = compute_risk_plan(df, account_risk_pct=2.5)
        assert base["account_risk_pct"] == 1.25
        assert double["account_risk_pct"] == 2.5
        # same stop distance -> suggested size doubles, but never past the cap
        # (both values are independently rounded to 0.1, so allow that much slack)
        assert abs(double["position_size_pct"] - min(MAX_POSITION_PCT, base["position_size_pct"] * 2)) <= 0.2
