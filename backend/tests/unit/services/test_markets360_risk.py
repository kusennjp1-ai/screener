"""Tests for the Markets 360 risk & exit plan."""
import numpy as np
import pandas as pd

from app.services.markets360.risk import compute_risk_plan, MAX_LOSS_PCT, ACCOUNT_RISK_PCT


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
    expected = min(100.0, ACCOUNT_RISK_PCT / (plan["stop_pct"] / 100.0))
    assert abs(plan["position_size_pct"] - round(expected, 1)) < 0.1
    # being stopped costs ~account_risk_pct of the account
    loss_to_account = plan["position_size_pct"] / 100.0 * plan["stop_pct"]
    assert abs(loss_to_account - ACCOUNT_RISK_PCT) < 0.05


def test_targets_are_r_multiples_of_risk():
    plan = compute_risk_plan(_frame(np.linspace(20, 120, 260)))
    entry, risk = plan["entry"], plan["risk_per_share"]
    by_r = {t["r_multiple"]: t for t in plan["targets"]}
    assert abs(by_r[2.0]["price"] - (entry + 2 * risk)) < 0.02
    assert abs(by_r[3.0]["price"] - (entry + 3 * risk)) < 0.02


def test_pivot_entry_is_used_when_supplied():
    plan = compute_risk_plan(_frame(np.linspace(20, 100, 260)), pivot=105.0)
    assert plan["entry"] == 105.0
