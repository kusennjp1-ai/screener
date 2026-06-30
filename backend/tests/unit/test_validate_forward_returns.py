"""Tests for the forward-return validation harness (pure logic)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from validate_forward_returns import (  # noqa: E402
    Trade,
    build_scorecard,
    cohort_metrics,
    forward_return,
    max_drawdown,
    quartile_edges,
    quartile_label,
    review_alerts,
    sharpe,
    welch_one_sample_t,
)


def _frame(close):
    close = np.asarray(close, dtype="float64")
    idx = pd.bdate_range("2024-01-01", periods=len(close))
    return pd.DataFrame({"Close": close}, index=idx)


def test_forward_return_basic_and_no_lookahead():
    df = _frame([100, 101, 102, 103, 110])
    as_of = df.index[1]                       # close 101
    assert abs(forward_return(df, as_of, 1) - (102 / 101 - 1) * 100) < 1e-9
    assert abs(forward_return(df, as_of, 3) - (110 / 101 - 1) * 100) < 1e-9
    # not enough future bars -> None
    assert forward_return(df, df.index[-1], 1) is None


def test_max_drawdown_is_bounded_and_correct():
    # +10%, then -50%, then +5%: equity 1.1 -> 0.55 -> 0.5775; peak 1.1
    dd = max_drawdown([10.0, -50.0, 5.0])
    assert dd <= 0.0
    assert dd >= -100.0
    # trough 0.55 vs peak 1.1 = -50%
    assert abs(dd - (-50.0)) < 0.6
    assert max_drawdown([]) == 0.0
    # never produces the old "treat returns as prices" blowup
    assert max_drawdown([0.5, -5.0]) >= -100.0


def test_welch_one_sample_t_sign_and_guards():
    t_pos, p_pos = welch_one_sample_t([2.0, 3.0, 2.5, 3.5, 2.2])
    assert t_pos > 0 and 0.0 <= p_pos <= 1.0
    t_neg, _ = welch_one_sample_t([-2.0, -3.0, -2.5, -3.5])
    assert t_neg < 0
    assert welch_one_sample_t([1.0]) == (None, None)          # n<2
    assert welch_one_sample_t([2.0, 2.0, 2.0]) == (None, None)  # no variance


def test_quartiles():
    edges = quartile_edges([10, 20, 30, 40, 50, 60, 70, 80])
    assert quartile_label(5, edges) == "Q1"
    assert quartile_label(85, edges) == "Q4"
    assert quartile_label(None, edges) is None


def test_sharpe_guards():
    assert sharpe([1.0]) is None
    assert sharpe([2.0, 2.0]) is None
    assert sharpe([1.0, 2.0, 3.0]) is not None


def test_cohort_metrics_shape():
    m = cohort_metrics(excess=[1.0, -0.5, 2.0, 0.3], raw=[5.0, -1.0, 6.0, 2.0])
    assert m["n"] == 4
    assert m["win_rate"] == 75.0           # 3 of 4 excess > 0
    assert m["mean_excess"] is not None
    empty = cohort_metrics([], [])
    assert empty["n"] == 0 and empty["mean_excess"] is None


def test_build_scorecard_and_alerts():
    # stock that beats a flat SPY -> positive excess for the Strong Buy cohort
    win = _frame(np.linspace(100, 140, 60))
    lose = _frame(np.linspace(100, 70, 60))
    spy = _frame(np.linspace(100, 101, 60))
    lookup = {"WIN": win, "LOSE": lose}
    as_of = win.index[30]
    trades = [
        Trade("WIN", as_of, "Strong Buy", 95.0),
        Trade("LOSE", as_of, "Strong Buy", 90.0),
    ]
    sc = build_scorecard(trades, lambda s: lookup.get(s), spy, horizon=21)
    assert sc["horizon"] == 21
    assert sc["baseline"]["n"] == 2
    assert any(k.startswith("Strong Buy|") for k in sc["cohorts"])


def test_review_alert_fires_on_underperforming_buy_cohort():
    sc = {
        "horizon": 21,
        "cohorts": {
            "Strong Buy|Q4": {"n": 8, "mean_excess": -5.0, "win_rate": 30.0},
            "Buy|Q3": {"n": 10, "mean_excess": 3.0, "win_rate": 60.0},  # healthy, no alert
            "Pass|Q1": {"n": 9, "mean_excess": -9.0, "win_rate": 10.0},  # not a buy tier
        },
    }
    alerts = review_alerts(sc)
    assert len(alerts) == 1
    assert "Strong Buy|Q4" in alerts[0]
