"""Unit tests for the SMR (Sales/Margins/ROE) rating service."""

from __future__ import annotations

from app.services.smr_rating_service import SMRRatingService, letter_for_score


def test_best_and_worst_of_universe():
    components = {
        f"S{i}": {"sales_growth": i * 5.0, "profit_margin": i * 2.0, "roe": i * 3.0}
        for i in range(11)
    }
    ratings = SMRRatingService().calculate_ratings(components)
    assert ratings["S10"] >= 90 and letter_for_score(ratings["S10"]) == "A"
    assert ratings["S0"] <= 10 and letter_for_score(ratings["S0"]) == "E"


def test_partial_components_average_over_present_fields():
    ratings = SMRRatingService().calculate_ratings(
        {
            "A": {"sales_growth": 100.0, "profit_margin": None, "roe": None},
            "B": {"sales_growth": 10.0, "profit_margin": 5.0, "roe": 5.0},
            "C": {"sales_growth": 50.0, "profit_margin": 50.0, "roe": 50.0},
        }
    )
    # A is ranked on sales_growth alone (its only present component) and, as the
    # top of a three-name universe, lands at the highest available percentile.
    assert ratings["A"] == max(ratings.values())
    assert ratings["A"] == 67


def test_symbol_with_no_usable_component_is_omitted():
    ratings = SMRRatingService().calculate_ratings(
        {"Z": {"sales_growth": None, "profit_margin": None, "roe": None}}
    )
    assert ratings == {}


def test_empty_universe():
    assert SMRRatingService().calculate_ratings({}) == {}


def test_ratings_are_within_bounds():
    components = {
        f"S{i}": {"sales_growth": float(i), "profit_margin": float(-i), "roe": float(i % 3)}
        for i in range(50)
    }
    ratings = SMRRatingService().calculate_ratings(components)
    assert ratings
    assert all(0 <= score <= 99 for score in ratings.values())
