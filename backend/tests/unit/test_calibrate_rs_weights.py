"""Tests for the W3.2 RS-weight calibration logic (pure functions)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from calibrate_rs_weights import (  # noqa: E402
    BASELINE,
    HORIZONS,
    decide,
    evaluate_config,
    flag_leaders,
    rs_score,
)


def _series(vals):
    idx = pd.bdate_range("2022-01-03", periods=len(vals))
    return pd.Series(np.asarray(vals, dtype="float64"), index=idx)


def _frame(close):
    close = np.asarray(close, dtype="float64")
    idx = pd.bdate_range("2022-01-03", periods=len(close))
    return pd.DataFrame({"Open": close, "High": close * 1.01, "Low": close * 0.99,
                         "Close": close, "Volume": np.full(len(close), 1e6)}, index=idx)


W = ((63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2))


def test_rs_score_positive_for_outperformer():
    n = 300
    stock = _series(np.linspace(20, 90, n))
    bench = _series(np.linspace(100, 103, n))
    s = rs_score(stock, bench, stock.index[-1], W)
    assert s is not None and s > 0


def test_rs_score_negative_for_laggard():
    n = 300
    stock = _series(np.linspace(100, 104, n))
    bench = _series(np.linspace(100, 160, n))
    assert rs_score(stock, bench, stock.index[-1], W) < 0


def test_rs_score_none_without_history():
    short = _series(np.linspace(10, 11, 30))
    assert rs_score(short, short, short.index[-1], W) is None


def test_flag_leaders_takes_top_fraction():
    scores = {"A": 9.0, "B": 5.0, "C": 1.0, "D": -2.0, "E": None}
    leaders = flag_leaders(scores, 0.5)        # 4 valid -> top 2
    assert leaders == ["A", "B"]
    assert flag_leaders({}, 0.3) == []


def test_decide_accepts_null_when_configs_tie():
    # every config identical -> keep baseline
    same = {h: {"n": 100, "sharpe": 0.2, "win_rate": 55.0} for h in HORIZONS}
    cm = {BASELINE: same, "challenger": dict(same)}
    d = decide(cm)
    assert d["recommended"] == BASELINE
    assert d["beaten_horizons"] == []


def test_decide_picks_clear_winner():
    base = {h: {"n": 100, "sharpe": 0.10, "win_rate": 50.0} for h in HORIZONS}
    better = {h: {"n": 100, "sharpe": 0.40, "win_rate": 60.0} for h in HORIZONS}
    d = decide({BASELINE: base, "challenger": better})
    assert d["recommended"] == "challenger"
    assert len(d["beaten_horizons"]) >= 2


def test_decide_requires_both_sharpe_and_winrate():
    base = {h: {"n": 100, "sharpe": 0.10, "win_rate": 50.0} for h in HORIZONS}
    # higher sharpe but NOT higher win-rate -> not enough, keep baseline
    sharpe_only = {h: {"n": 100, "sharpe": 0.50, "win_rate": 50.0} for h in HORIZONS}
    assert decide({BASELINE: base, "c": sharpe_only})["recommended"] == BASELINE


def test_decide_ignores_small_samples():
    base = {h: {"n": 5, "sharpe": 0.10, "win_rate": 50.0} for h in HORIZONS}
    better = {h: {"n": 5, "sharpe": 0.90, "win_rate": 90.0} for h in HORIZONS}
    # n below min_n -> no horizon counts -> baseline
    assert decide({BASELINE: base, "c": better})["recommended"] == BASELINE


def test_evaluate_config_shape():
    n = 320
    data = {"WIN": _frame(np.linspace(20, 120, n)), "LAG": _frame(np.linspace(100, 90, n))}
    spy = _frame(np.linspace(100, 105, n))
    asof = [spy.index[280]]
    out = evaluate_config(W, data, spy, asof, top_frac=0.5)
    assert set(out.keys()) == set(HORIZONS)
    for h in HORIZONS:
        assert "n" in out[h] and "sharpe" in out[h]
