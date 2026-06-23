"""Unit tests for the IBD-style Composite Rating service."""

from __future__ import annotations

from app.services.composite_rating_service import (
    CompositeRatingService,
    group_strength_from_rank,
)


def test_group_strength_inverts_rank():
    assert group_strength_from_rank(1) == 99.0
    assert group_strength_from_rank(197) == 0.0
    assert group_strength_from_rank(None) is None
    # Clamps out-of-range ranks.
    assert group_strength_from_rank(0) == 99.0
    assert group_strength_from_rank(500) == 0.0


def test_best_and_worst_of_universe():
    rows = {
        f"C{i}": {
            "eps_rating": i * 9,
            "rs_rating": i * 9,
            "ibd_group_rank": 197 - i * 19,
            "smr_rating": i * 9,
            "acc_dis_rating": i * 9,
        }
        for i in range(11)
    }
    ratings = CompositeRatingService().calculate_ratings(rows)
    assert ratings["C10"] >= 90
    assert 1 <= ratings["C0"] <= 10


def test_eps_and_rs_dominate_the_blend():
    rows = {
        "strong_eps_rs": {
            "eps_rating": 99,
            "rs_rating": 99,
            "ibd_group_rank": 100,
            "smr_rating": 1,
            "acc_dis_rating": 1,
        },
        "strong_smr_acc": {
            "eps_rating": 1,
            "rs_rating": 1,
            "ibd_group_rank": 100,
            "smr_rating": 99,
            "acc_dis_rating": 99,
        },
    }
    ratings = CompositeRatingService().calculate_ratings(rows)
    assert ratings["strong_eps_rs"] > ratings["strong_smr_acc"]


def test_partial_components_do_not_zero_out_a_stock():
    ratings = CompositeRatingService().calculate_ratings(
        {"X": {"eps_rating": 80, "rs_rating": None, "ibd_group_rank": None,
               "smr_rating": None, "acc_dis_rating": None}}
    )
    assert "X" in ratings


def test_ratings_are_within_1_to_99():
    rows = {
        f"C{i}": {
            "eps_rating": i % 100,
            "rs_rating": (i * 3) % 100,
            "ibd_group_rank": (i % 197) + 1,
            "smr_rating": (i * 7) % 100,
            "acc_dis_rating": (i * 5) % 100,
        }
        for i in range(60)
    }
    ratings = CompositeRatingService().calculate_ratings(rows)
    assert ratings
    assert all(1 <= score <= 99 for score in ratings.values())


def test_with_scores_rating_matches_calculate_ratings_and_exposes_raw():
    rows = {
        f"C{i}": {"eps_rating": i * 9, "rs_rating": i * 9, "ibd_group_rank": 1 + i,
                  "smr_rating": i * 9, "acc_dis_rating": i * 9}
        for i in range(11)
    }
    svc = CompositeRatingService()
    ratings = svc.calculate_ratings(rows)
    scored = svc.calculate_with_scores(rows)
    assert {s: e["rating"] for s, e in scored.items()} == ratings
    # Raw scores have full resolution and order the same way as the components.
    raw = svc.raw_scores(rows)
    assert raw["C10"] > raw["C0"]
    assert all(isinstance(e["score"], float) for e in scored.values())


def test_empty_universe():
    assert CompositeRatingService().calculate_ratings({}) == {}
