"""Annualization must honor fiscal-year spacing, not observation count."""
import pytest

from app.services.eps_rating_service import EPSRatingService


def test_gap_in_fiscal_history_uses_elapsed_calendar_years():
    rate, count = EPSRatingService().calculate_5yr_cagr(
        [(2025, 8.0), (2024, 5.0), (2021, 2.0), (2019, 1.0)]
    )
    assert rate == pytest.approx(41.42)
    assert count == 4


def test_contiguous_fiscal_history_keeps_standard_cagr():
    rate, count = EPSRatingService().calculate_5yr_cagr(
        [(2025, 8.0), (2024, 4.0), (2023, 2.0), (2022, 1.0)]
    )
    assert rate == 100.0
    assert count == 4


@pytest.mark.parametrize("history", [
    [(2025, 8.0), (2025, 1.0)],
    [(2024, 8.0), (2025, 1.0)],
    [(2025, 8.0), (2023, 4.0), (2024, 1.0)],
])
def test_duplicate_or_unordered_fiscal_years_are_not_rated(history):
    assert EPSRatingService().calculate_5yr_cagr(history) == (None, 0)
