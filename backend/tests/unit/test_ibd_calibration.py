"""Unit tests for the IBD-50 calibration harness."""

from __future__ import annotations

from app.services.ibd_calibration import (
    DEFAULT_GATES,
    Gates,
    calibrate,
    evaluate,
    overlap_metrics,
    select_leaders,
)


def _row(symbol, *, eps, rs, group, smr, acc, high_dist=-5.0):
    return {
        "symbol": symbol,
        "eps_rating": eps,
        "rs_rating": rs,
        "ibd_group_rank": group,
        "smr_rating": smr,
        "acc_dis_rating": acc,
        "week_52_high_distance": high_dist,
    }


def _strong_universe(n=60):
    # Descending strength: L0 strongest .. L{n-1} weakest.
    rows = []
    for i in range(n):
        strength = max(1, 99 - i)
        rows.append(
            _row(
                f"L{i}",
                eps=strength,
                rs=strength,
                group=min(197, 1 + i * 3),
                smr=strength,
                acc=strength,
            )
        )
    return rows


# Composite gate is a percentile, so it is only meaningful over a large
# universe. These tests isolate ranking/gating with an open composite gate; the
# strict production composite_min=95 is exercised against real data, not here.
_OPEN = Gates(composite_min=0, rs_min=0, group_max=197, high_dist_min=-100.0)


def test_select_leaders_ranks_and_caps():
    leaders = select_leaders(_strong_universe(60), gates=_OPEN, limit=10)
    assert len(leaders) == 10
    # Strongest names lead the list.
    assert leaders[0] == "L0"
    assert leaders == [f"L{i}" for i in range(10)]


def test_gates_exclude_weak_and_extended_names():
    gates = Gates(composite_min=0, rs_min=85, group_max=60, high_dist_min=-15.0)
    rows = [
        _row("GOOD", eps=99, rs=95, group=10, smr=90, acc=90, high_dist=-5),
        _row("WEAK_RS", eps=99, rs=70, group=10, smr=90, acc=90),          # rs gate
        _row("BAD_GROUP", eps=99, rs=95, group=120, smr=90, acc=90),       # group gate
        _row("EXTENDED", eps=99, rs=95, group=10, smr=90, acc=90, high_dist=-40),  # high-dist gate
    ]
    leaders = select_leaders(rows, gates=gates)
    assert leaders == ["GOOD"]


def test_overlap_metrics_known_values():
    metrics = overlap_metrics(["A", "B", "C", "D"], ["A", "B", "E"])
    assert metrics["overlap"] == 2
    assert metrics["precision"] == 0.5          # 2 of 4 predicted
    assert round(metrics["recall"], 4) == 0.6667  # 2 of 3 truth
    assert round(metrics["jaccard"], 4) == 0.4   # 2 of 5 union


def test_overlap_metrics_empty_inputs():
    metrics = overlap_metrics([], [])
    assert metrics["overlap"] == 0
    assert metrics["precision"] == 0.0
    assert metrics["recall"] == 0.0


def test_evaluate_aggregates_over_weeks():
    rows = _strong_universe(60)
    truth = {f"L{i}" for i in range(10)}  # screener's top-10 are the truth
    result = evaluate(
        {"2026-06-12": rows, "2026-06-18": rows},
        {"2026-06-12": truth, "2026-06-18": truth},
        gates=_OPEN,
        limit=10,
    )
    assert result["weeks"] == ["2026-06-12", "2026-06-18"]
    # Perfect overlap each week → mean recall 1.0.
    assert result["mean"]["recall"] == 1.0
    assert result["mean"]["precision"] == 1.0


def test_calibrate_prefers_config_matching_truth():
    # Truth = stocks that are strong on SMR/Acc but weak on EPS/RS, so a blend
    # that up-weights SMR/Acc should recall them better than the EPS/RS-heavy
    # default.
    rows = []
    truth = set()
    for i in range(20):
        # "smr_acc_leaders": low eps/rs, high smr/acc
        sym = f"SA{i}"
        rows.append(_row(sym, eps=20, rs=88, group=10, smr=99 - i, acc=99 - i))
        truth.add(sym)
    for i in range(20):
        # "eps_rs_leaders": high eps/rs, low smr/acc — should NOT be in truth
        rows.append(_row(f"ER{i}", eps=99 - i, rs=99 - i, group=10, smr=10, acc=10))

    rows_by_week = {"w": rows}
    truth_by_week = {"w": truth}

    weight_grid = [
        {"eps_rating": 0.40, "rs_rating": 0.40, "group_strength": 0.10, "smr_rating": 0.05, "acc_dis_rating": 0.05},
        {"eps_rating": 0.10, "rs_rating": 0.10, "group_strength": 0.10, "smr_rating": 0.35, "acc_dis_rating": 0.35},
    ]
    gate_grid = [Gates(composite_min=50, rs_min=80, group_max=100)]

    result = calibrate(
        rows_by_week,
        truth_by_week,
        weight_grid=weight_grid,
        gate_grid=gate_grid,
        limit=20,
        objective="recall",
    )
    best_weights = result["best"]["weights"]
    # The SMR/Acc-heavy blend should win.
    assert best_weights["smr_rating"] > best_weights["eps_rating"]
    assert result["best"]["mean"]["recall"] > 0.5


def test_calibrate_default_grids_run():
    rows = _strong_universe(60)
    truth = {f"L{i}" for i in range(20)}
    result = calibrate({"w": rows}, {"w": truth}, limit=50, objective="recall")
    assert result["evaluated"] > 0
    assert result["best"] is not None
    assert len(result["leaderboard"]) <= 10
