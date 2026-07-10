"""Mechanics tests for the fixed trade-idea ground-truth harness.

These pin the harness's own correctness (no look-ahead, deterministic
aggregation, frozen table columns) — NOT the screener's scores. The metric
COLUMNS are part of the frozen contract: changing them breaks cross-cycle
comparability and must be a deliberate, documented decision.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(_SCRIPTS))

import validate_trade_ideas as harness  # noqa: E402


def _frame(n=300, start="2021-01-04", trend=0.001, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, periods=n)
    close = 50 * np.cumprod(1 + trend + rng.normal(0, 0.005, n))
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * 1.01
    low = np.minimum(open_, close) * 0.99
    vol = rng.integers(8e5, 1.2e6, n).astype(float)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol},
        index=idx,
    )


def test_insufficient_history_returns_none():
    df = _frame(n=120)
    assert harness.evaluate_idea(df, None, df.index[-1]) is None


def test_no_look_ahead_future_rows_do_not_change_t0_result():
    """The T0 evaluation must be identical whether or not future bars exist —
    except FIRE±5, whose window legitimately extends 5 bars past T0."""
    df = _frame(n=320)
    spy = _frame(n=320, trend=0.0004, seed=11)
    t0 = df.index[260]
    full = harness.evaluate_idea(df, spy, t0)
    # Keep 5 bars after T0 so the FIRE forward window is identical, drop the rest.
    truncated = harness.evaluate_idea(df.iloc[:266], spy.iloc[:266], t0)
    assert full is not None and truncated is not None
    assert full == truncated


def test_aggregate_handles_none_and_percentages():
    rows = [
        {"tt": True, "s2": True, "setup": False, "rs70": None, "fire": True,
         "score": 80.0, "gate": None},
        {"tt": False, "s2": True, "setup": True, "rs70": True, "fire": False,
         "score": 60.0, "gate": True},
    ]
    agg = harness.aggregate(rows, attempted=4)
    assert agg["n"] == 2
    assert agg["cov_pct"] == 50.0
    assert agg["tt_pct"] == 50.0
    assert agg["s2_pct"] == 100.0
    assert agg["rs70_pct"] == 100.0  # None excluded from the denominator
    assert agg["mscore"] == 70.0


def test_frozen_table_columns():
    """The report header is a frozen contract — see docs/SPEC.md §Validation."""
    agg = harness.aggregate([], attempted=0)
    table = harness.render_table(agg, {})
    assert table.splitlines()[0] == (
        "| year | n | COV% | TT% | S2% | SETUP% | RS70% | FIRE±5% | MSCORE | GATE% |"
    )


def test_control_row_rendered_when_present():
    agg = harness.aggregate([], attempted=0)
    table = harness.render_table(agg, {}, control=agg)
    assert "CONTROL (T0−63)" in table


def test_evaluate_idea_without_benchmark_skips_tt_and_gate():
    df = _frame(n=320)
    ev = harness.evaluate_idea(df, None, df.index[-1])
    assert ev is not None
    assert ev["tt"] is None and ev["rs70"] is None and ev["gate"] is None
    assert isinstance(ev["setup"], bool)
