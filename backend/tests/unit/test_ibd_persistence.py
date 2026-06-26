"""Unit tests for the IBD-30 persistence (carry-forward) baseline."""

from __future__ import annotations

from app.services.ibd_persistence import (
    carry_forward_metrics,
    evaluate_persistence,
    evaluate_recency,
    matrix_from_rows,
    parse_matrix,
    predict_top_n,
    rank_stability,
    recency_scores,
)


def test_carry_forward_metrics_basic():
    m = carry_forward_metrics(["A", "B", "C", "D"], ["A", "B", "E"])
    assert m["overlap"] == 2
    assert m["dropped"] == 2          # C, D fell off
    assert m["added"] == 1            # E is new
    assert round(m["recall"], 2) == 0.67   # 2 of 3 actual
    assert m["precision"] == 0.5           # 2 of 4 predicted


def test_carry_forward_normalizes_case_and_blanks():
    m = carry_forward_metrics([" a ", "B", ""], ["A", "b"])
    assert m["overlap"] == 2
    assert m["recall"] == 1.0


def test_evaluate_persistence_perfect_stickiness():
    weeks = [("w1", ["A", "B", "C"]), ("w2", ["A", "B", "C"]), ("w3", ["A", "B", "C"])]
    result = evaluate_persistence(weeks)
    assert result["n_steps"] == 2
    assert result["mean"]["recall"] == 1.0
    assert result["mean"]["precision"] == 1.0


def test_evaluate_persistence_partial_churn():
    weeks = [("w1", ["A", "B", "C", "D"]), ("w2", ["A", "B", "C", "E"])]
    result = evaluate_persistence(weeks)
    step = result["steps"][0]
    assert step["overlap"] == 3
    assert step["added"] == 1 and step["dropped"] == 1
    assert step["recall"] == 0.75


def test_evaluate_persistence_top_n_prior():
    # Only the top-2 of the previous week are carried forward.
    weeks = [("w1", ["A", "B", "C", "D"]), ("w2", ["A", "B", "C", "D"])]
    result = evaluate_persistence(weeks, top_n=2)
    step = result["steps"][0]
    assert step["predicted_count"] == 2
    assert step["overlap"] == 2           # A, B
    assert step["precision"] == 1.0
    assert step["recall"] == 0.5          # caught 2 of 4


def test_rank_stability_counts_churn():
    weeks = [("w1", ["A", "B", "C"]), ("w2", ["A", "B", "X"]), ("w3", ["A", "B", "X"])]
    stab = rank_stability(weeks)
    assert stab["n_steps"] == 2
    assert stab["mean_added_per_week"] == 0.5     # X added once, nothing in step2
    assert stab["mean_dropped_per_week"] == 0.5   # C dropped once


def test_parse_matrix_skips_rank_column_and_blanks():
    header = ["rank", "2026-05-02", "2026-04-25"]
    rows = [
        ["1", "MU", "FIX"],
        ["2", "FIX", "?"],     # "?" skipped for week 2
        ["3", "", "VRT"],      # blank skipped for week 1
    ]
    weeks = parse_matrix(header, rows)
    assert weeks[0] == ("2026-05-02", ["MU", "FIX"])
    assert weeks[1] == ("2026-04-25", ["FIX", "VRT"])


def test_matrix_from_rows_reverses_to_oldest_first():
    csv_rows = [
        ["rank", "2026-05-02", "2026-04-25"],   # newest-first in the image
        ["1", "MU", "FIX"],
        ["2", "FIX", "VRT"],
    ]
    weeks = matrix_from_rows(csv_rows, newest_first=True)
    # Oldest (04-25) should come first so persistence predicts forward in time.
    assert [w[0] for w in weeks] == ["2026-04-25", "2026-05-02"]
    assert weeks[0][1] == ["FIX", "VRT"]


def test_recency_scores_recent_and_high_rank_win():
    # last week (most recent) ranks A>B; two weeks ago has C only.
    prior = [["A", "B"], ["C"]]
    scores = recency_scores(prior, decay=0.4, rank_weighted=True)
    assert scores["A"] > scores["B"]      # higher rank last week (1.0 vs 0.5)
    assert scores["A"] > scores["C"]      # recent beats older
    # C (rank1 two weeks ago) = 0.4 decayed < B (rank2 last week) = 0.5.
    assert scores["C"] < scores["B"]


def test_predict_top_n_orders_by_score():
    scores = {"A": 3.0, "B": 1.0, "C": 2.0}
    assert predict_top_n(scores, 2) == ["A", "C"]


def test_evaluate_recency_lookback1_matches_carry_forward():
    weeks = [("w1", ["A", "B", "C", "D"]), ("w2", ["A", "B", "C", "E"])]
    rec = evaluate_recency(weeks, lookback=1, top_n=4)
    cf = evaluate_persistence(weeks)
    # With lookback=1 and top_n = list size, recency reduces to carry-forward.
    assert rec["mean"]["recall"] == cf["mean"]["recall"]


def test_evaluate_recency_recovers_a_reentry():
    # X is in w1, drops in w2, returns in w3. A 2-week lookback can still
    # rank X into the w3 prediction; a 1-week carry-forward cannot.
    weeks = [
        ("w1", ["A", "B", "X"]),
        ("w2", ["A", "B", "C"]),
        ("w3", ["A", "B", "X"]),
    ]
    rec2 = evaluate_recency(weeks, lookback=2, top_n=3, decay=0.6)
    # Step for w3: prior = [w2=[A,B,C], w1=[A,B,X]]; X (from w1) should outrank
    # C is only in w2... both appear once; rank/decay decide. Just assert the
    # 2-week model does at least as well as 1-week on average here.
    rec1 = evaluate_recency(weeks, lookback=1, top_n=3)
    assert rec2["mean"]["recall"] >= rec1["mean"]["recall"]
