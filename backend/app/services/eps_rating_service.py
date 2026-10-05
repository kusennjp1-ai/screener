"""
EPS Rating Service for IBD-style earnings quality score calculation.

Calculates an EPS Rating (0-99 percentile) that measures earnings quality by combining:
- Long-term growth (5-year CAGR) - 40% weight
- Short-term acceleration (recent 2 quarters YoY growth) - 50% weight
- Acceleration bonus (reward for accelerating growth) - 10% weight

Formula:
    raw_score = 0.40 * CAGR_5yr + 0.50 * avg(Q1_YoY, Q2_YoY) + 0.10 * (Q1_YoY - Q2_YoY)
"""
import logging
from datetime import date, datetime
import math
import re
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

from .quarterly_eps_selection import select_quarterly_eps_pair_row

logger = logging.getLogger(__name__)


def _source_input(column: Any, value: Any) -> Dict[str, Any]:
    """Keep original statement labels; do not infer dates from year labels."""
    period_end = None
    if isinstance(column, (date, datetime, pd.Timestamp)) or (
        isinstance(column, str) and re.match(r"^\d{4}-\d{2}-\d{2}(?:$|[ T])", column)
    ):
        try:
            timestamp = pd.Timestamp(column)
            if pd.notna(timestamp):
                period_end = timestamp.date().isoformat()
        except (TypeError, ValueError, OverflowError):
            pass
    return {"column": str(column), "period_end": period_end, "value": float(value)}


class EPSRatingService:
    """
    Service for calculating IBD-style EPS Ratings.

    The EPS Rating measures earnings quality by combining:
    - CAGR (5-year compound annual growth rate) - 40% weight
    - Recent quarterly YoY growth - 50% weight
    - Acceleration bonus - 10% weight
    """

    # Weights for composite score
    ALPHA = 0.40  # 5-year CAGR weight
    BETA = 0.50   # Quarterly avg weight
    GAMMA = 0.10  # Acceleration bonus

    # Capping thresholds for extreme values
    MAX_GROWTH_PCT = 500.0   # Cap extreme growth at 500%
    MIN_GROWTH_PCT = -100.0  # Floor at -100%

    def extract_annual_eps_history(
        self,
        annual_income_stmt: pd.DataFrame,
        *,
        source_context: Optional[Dict[str, Any]] = None,
    ) -> List[Tuple[int, float]]:
        """
        Extract annual EPS values from yfinance income_stmt DataFrame.

        Args:
            annual_income_stmt: DataFrame from ticker.income_stmt (annual)
            source_context: Optional output sink for the exact rows/columns,
                captured before dates are reduced to fiscal years.

        Returns:
            List of (year, eps_value) tuples sorted by year descending (most recent first)
        """
        if annual_income_stmt is None or annual_income_stmt.empty:
            return []

        try:
            # Find EPS row (Diluted EPS preferred)
            eps_row = None
            for idx in annual_income_stmt.index:
                idx_str = str(idx).lower()
                if 'diluted eps' in idx_str or 'dilutedeps' in idx_str:
                    eps_row = idx
                    break

            if eps_row is None:
                for idx in annual_income_stmt.index:
                    idx_str = str(idx).lower()
                    if 'basic eps' in idx_str or 'basiceps' in idx_str:
                        eps_row = idx
                        break

            if eps_row is None:
                logger.debug("No EPS row found in annual income statement")
                return []

            # Extract EPS values by year
            eps_history = []
            source_inputs = []
            for col in annual_income_stmt.columns:
                try:
                    year = col.year if hasattr(col, 'year') else int(str(col)[:4])
                    eps_value = annual_income_stmt.loc[eps_row, col]

                    if pd.notna(eps_value):
                        eps_history.append((year, float(eps_value)))
                        if source_context is not None:
                            source_inputs.append({"year": year, **_source_input(col, eps_value)})
                except Exception as e:
                    logger.debug(f"Error extracting EPS for column {col}: {e}")
                    continue

            # Sort by year descending (most recent first)
            eps_history.sort(key=lambda x: x[0], reverse=True)
            if source_context is not None:
                # Match the stable year-only sort, including duplicate-year
                # behavior, rather than silently sorting by full date here.
                source_inputs.sort(key=lambda item: item["year"], reverse=True)
                source_context.update(metric=str(eps_row), source_inputs=source_inputs)

            return eps_history

        except Exception as e:
            logger.debug(f"Error extracting annual EPS history: {e}")
            return []

    def calculate_5yr_cagr(self, annual_eps: List[Tuple[int, float]]) -> Tuple[Optional[float], int]:
        """
        Calculate 5-year compound annual growth rate from annual EPS data.

        CAGR = ((end_value / start_value) ^ (1/n)) - 1

        Args:
            annual_eps: List of (year, eps_value) tuples sorted by year descending

        Returns:
            Tuple of (cagr_percentage, years_available)
        """
        if not annual_eps or len(annual_eps) < 2:
            return None, 0

        # Get start and end values
        years_available = min(len(annual_eps), 5)

        # Most recent value (end)
        end_value = annual_eps[0][1]

        # Value from n years ago (start)
        start_idx = years_available - 1
        start_value = annual_eps[start_idx][1]
        # Fiscal observations may have gaps. Four observations spanning six
        # calendar years must not be annualized as if only three years passed.
        fiscal_years = [year for year, _ in annual_eps[:years_available]]
        if any(newer <= older for newer, older in zip(fiscal_years, fiscal_years[1:])):
            return None, 0
        elapsed_years = fiscal_years[0] - fiscal_years[-1]

        # Handle edge cases
        if start_value is None or end_value is None:
            return None, 0

        # For negative to positive or very small denominators
        if abs(start_value) < 0.01:
            # If earnings went from near-zero to positive, that's strong growth
            if end_value > 0.5:
                return min(self.MAX_GROWTH_PCT, 100.0), years_available
            return None, years_available

        try:
            # Standard CAGR calculation
            if start_value > 0 and end_value > 0:
                # Both positive: standard CAGR
                ratio = end_value / start_value
                cagr = (pow(ratio, 1.0 / elapsed_years) - 1) * 100
            elif start_value < 0 and end_value > 0:
                # Turnaround: went from loss to profit
                # Calculate improvement rate
                improvement = (end_value - start_value) / abs(start_value)
                cagr = min(improvement * 20, self.MAX_GROWTH_PCT)  # Scale and cap
            elif start_value > 0 and end_value < 0:
                # Deterioration: went from profit to loss
                cagr = max(-100.0, -50.0)  # Significant penalty
            else:
                # Both negative: check if losses are improving
                if abs(end_value) < abs(start_value):
                    # Losses shrinking
                    improvement = (abs(start_value) - abs(end_value)) / abs(start_value)
                    cagr = improvement * 50  # Moderate bonus
                else:
                    # Losses growing
                    cagr = -25.0  # Penalty

            # Cap extreme values
            cagr = max(self.MIN_GROWTH_PCT, min(self.MAX_GROWTH_PCT, cagr))

            return round(cagr, 2), years_available

        except Exception as e:
            logger.debug(f"Error calculating CAGR: {e}")
            return None, 0

    def extract_quarterly_yoy_growth(
        self,
        quarterly_income_stmt: pd.DataFrame,
        *,
        source_context: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Optional[float], Optional[float]]:
        """
        Extract most recent 2 quarters' YoY EPS growth from quarterly income statement.

        Args:
            quarterly_income_stmt: DataFrame from ticker.quarterly_income_stmt
            source_context: Optional field-keyed output sink for selected inputs.

        Returns:
            Tuple of (q1_yoy_growth, q2_yoy_growth) as percentages
        """
        if quarterly_income_stmt is None or quarterly_income_stmt.empty:
            return None, None

        if quarterly_income_stmt.shape[1] < 5:
            # Need at least 5 quarters for 2 YoY comparisons
            return None, None

        try:
            # Find EPS row
            eps_row = None
            for idx in quarterly_income_stmt.index:
                idx_str = str(idx).lower()
                if 'diluted eps' in idx_str or 'dilutedeps' in idx_str:
                    eps_row = idx
                    break

            if eps_row is None:
                for idx in quarterly_income_stmt.index:
                    idx_str = str(idx).lower()
                    if 'basic eps' in idx_str or 'basiceps' in idx_str:
                        eps_row = idx
                        break

            if eps_row is None:
                return None, None

            # Columns are ordered most recent first
            q1_yoy = None
            q2_yoy = None

            # Q1 YoY: Compare col[0] to col[4] (most recent vs same quarter last year)
            q1_row = select_quarterly_eps_pair_row(
                quarterly_income_stmt, eps_row,
                quarterly_income_stmt.columns[0], quarterly_income_stmt.columns[4],
            )
            if q1_row is not None:
                recent_q1 = quarterly_income_stmt.loc[q1_row, quarterly_income_stmt.columns[0]]
                year_ago_q1 = quarterly_income_stmt.loc[q1_row, quarterly_income_stmt.columns[4]]

                if pd.notna(recent_q1) and pd.notna(year_ago_q1) and abs(year_ago_q1) > 0.01:
                    q1_yoy = ((recent_q1 - year_ago_q1) / abs(year_ago_q1)) * 100
                    q1_yoy = max(self.MIN_GROWTH_PCT, min(self.MAX_GROWTH_PCT, q1_yoy))
                    q1_yoy = round(q1_yoy, 2)
                    if source_context is not None:
                        context = self._quarterly_source_context(
                            q1_row,
                            quarterly_income_stmt.columns[0], recent_q1,
                            quarterly_income_stmt.columns[4], year_ago_q1,
                            column_positions=[0, 4],
                            statement_columns=quarterly_income_stmt.columns,
                        )
                        if context is not None:
                            source_context["eps_q1_yoy"] = context

            # Q2 YoY: Compare col[1] to col[5] (prior quarter vs same quarter last year)
            q2_row = select_quarterly_eps_pair_row(
                quarterly_income_stmt, eps_row,
                quarterly_income_stmt.columns[1], quarterly_income_stmt.columns[5],
            ) if quarterly_income_stmt.shape[1] >= 6 else None
            if q2_row is not None:
                recent_q2 = quarterly_income_stmt.loc[q2_row, quarterly_income_stmt.columns[1]]
                year_ago_q2 = quarterly_income_stmt.loc[q2_row, quarterly_income_stmt.columns[5]]

                if pd.notna(recent_q2) and pd.notna(year_ago_q2) and abs(year_ago_q2) > 0.01:
                    q2_yoy = ((recent_q2 - year_ago_q2) / abs(year_ago_q2)) * 100
                    q2_yoy = max(self.MIN_GROWTH_PCT, min(self.MAX_GROWTH_PCT, q2_yoy))
                    q2_yoy = round(q2_yoy, 2)
                    if source_context is not None:
                        context = self._quarterly_source_context(
                            q2_row,
                            quarterly_income_stmt.columns[1], recent_q2,
                            quarterly_income_stmt.columns[5], year_ago_q2,
                            column_positions=[1, 5],
                            statement_columns=quarterly_income_stmt.columns,
                        )
                        if context is not None:
                            source_context["eps_q2_yoy"] = context

            return q1_yoy, q2_yoy

        except Exception as e:
            logger.debug(f"Error extracting quarterly YoY growth: {e}")
            if source_context is not None:
                source_context.clear()
            return None, None

    def _quarterly_source_context(
        self,
        metric: Any,
        recent_column: Any,
        recent_value: Any,
        comparable_column: Any,
        comparable_value: Any,
        *,
        column_positions: List[int],
        statement_columns: Any,
    ) -> Optional[Dict[str, Any]]:
        inputs = [
            _source_input(recent_column, recent_value),
            _source_input(comparable_column, comparable_value),
        ]
        if not all(math.isfinite(item["value"]) for item in inputs):
            return None
        periods = [item["period_end"] for item in inputs]
        selected_columns = statement_columns[column_positions[0]:column_positions[1] + 1]
        statement_periods = [_source_input(column, 0)["period_end"] for column in selected_columns]
        gaps = []
        if all(statement_periods):
            dates = [date.fromisoformat(period) for period in statement_periods]
            gaps = [(left - right).days for left, right in zip(dates, dates[1:])]
        cadence = "unknown"
        if gaps:
            if all(70 <= gap <= 110 for gap in gaps):
                cadence = "quarterly"
            elif all(150 <= gap <= 210 for gap in gaps):
                cadence = "semiannual"
            elif all(330 <= gap <= 400 for gap in gaps):
                cadence = "annual"
            else:
                cadence = "irregular"
        gap_days = (date.fromisoformat(periods[0]) - date.fromisoformat(periods[1])).days if all(periods) else None
        is_quarterly_yoy = cadence == "quarterly" and gap_days is not None and 330 <= gap_days <= 400
        return {
            "metric": str(metric),
            "period_end": periods[0],
            "comparable_period_end": periods[1],
            "period_status": "supplied" if all(periods) else "not_supplied",
            "cadence": cadence,
            "basis": "quarterly_eps_yoy/v1" if is_quarterly_yoy else "positional_eps_growth/v1",
            "reference_gap_days": gap_days,
            "statement_periods": statement_periods,
            "statement_gap_days": gaps,
            "periods_used": periods,
            "source_inputs": inputs,
            "column_positions": column_positions,
            "algorithm": "eps-rating-quarterly-yoy-v1" if is_quarterly_yoy else "eps-rating-positional-growth-v1",
            "minimum_absolute_baseline": 0.01,
            "clipping": {"minimum": self.MIN_GROWTH_PCT, "maximum": self.MAX_GROWTH_PCT},
            "rounding": {"decimal_places": 2},
        }

    def _cagr_source_context(self, annual_context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        inputs = annual_context.get("source_inputs", [])[:5]
        if len(inputs) < 2 or not all(math.isfinite(item["value"]) for item in inputs):
            return None
        periods = [item["period_end"] for item in inputs]
        start_value, end_value = inputs[-1]["value"], inputs[0]["value"]
        if abs(start_value) < 0.01:
            calculation_method = "near_zero_to_positive"
        elif start_value > 0 and end_value > 0:
            calculation_method = "positive_cagr"
        elif start_value < 0 and end_value > 0:
            calculation_method = "loss_to_profit_improvement_times_20"
        elif start_value > 0 and end_value < 0:
            calculation_method = "profit_to_loss_minus_50"
        elif abs(end_value) < abs(start_value):
            calculation_method = "loss_shrinking_improvement_times_50"
        else:
            calculation_method = "loss_growing_minus_25"
        return {
            "metric": annual_context["metric"],
            "period_end": periods[0],
            "comparable_period_end": periods[-1],
            "period_status": "supplied" if all(periods) else "not_supplied",
            "cadence": "annual",
            "basis": "annual_eps_cagr/v1",
            "periods_used": periods,
            "source_inputs": inputs,
            "algorithm": "eps-rating-cagr-v1",
            "selection_rule": "stable_fiscal_year_descending_first_up_to_5",
            "elapsed_years": inputs[0]["year"] - inputs[-1]["year"],
            "elapsed_year_rule": "latest_fiscal_year_minus_earliest_selected_fiscal_year",
            "requires_strictly_descending_years": True,
            "calculation_method": calculation_method,
            "clipping": {"minimum": self.MIN_GROWTH_PCT, "maximum": self.MAX_GROWTH_PCT},
            "rounding": {"decimal_places": 2},
        }

    def calculate_raw_score(
        self,
        cagr_5yr: Optional[float],
        q1_yoy: Optional[float],
        q2_yoy: Optional[float]
    ) -> Optional[float]:
        """
        Calculate raw composite EPS score before percentile ranking.

        Formula:
            raw_score = ALPHA * CAGR_5yr + BETA * avg(Q1_YoY, Q2_YoY) + GAMMA * (Q1_YoY - Q2_YoY)

        Where:
            ALPHA = 0.40 (5-year CAGR weight)
            BETA = 0.50 (quarterly avg weight)
            GAMMA = 0.10 (acceleration bonus)

        Args:
            cagr_5yr: 5-year CAGR percentage
            q1_yoy: Most recent quarter YoY growth percentage
            q2_yoy: Prior quarter YoY growth percentage

        Returns:
            Raw score (unbounded, will be percentile-ranked later)
        """
        # Need at least quarterly data
        if q1_yoy is None and q2_yoy is None:
            return None

        # Calculate quarterly average
        if q1_yoy is not None and q2_yoy is not None:
            quarterly_avg = (q1_yoy + q2_yoy) / 2
            acceleration = q1_yoy - q2_yoy
        elif q1_yoy is not None:
            quarterly_avg = q1_yoy
            acceleration = 0
        else:
            quarterly_avg = q2_yoy
            acceleration = 0

        # Use CAGR if available, otherwise use quarterly as proxy
        cagr_component = cagr_5yr if cagr_5yr is not None else quarterly_avg

        # Calculate raw score
        raw_score = (
            self.ALPHA * cagr_component +
            self.BETA * quarterly_avg +
            self.GAMMA * acceleration
        )

        return round(raw_score, 2)

    def calculate_eps_rating_data(
        self,
        annual_income_stmt: pd.DataFrame,
        quarterly_income_stmt: pd.DataFrame,
        *,
        include_source_context: bool = False,
    ) -> Dict:
        """
        Calculate all EPS rating components for a single stock.

        Args:
            annual_income_stmt: DataFrame from ticker.income_stmt
            quarterly_income_stmt: DataFrame from ticker.quarterly_income_stmt
            include_source_context: Add private field-keyed selected-input
                metadata, without source acquisition or calculation timestamps.

        Returns:
            Dict with all EPS rating fields:
            {
                'eps_5yr_cagr': float or None,
                'eps_q1_yoy': float or None,
                'eps_q2_yoy': float or None,
                'eps_raw_score': float or None,
                'eps_years_available': int
            }
        """
        result = {
            'eps_5yr_cagr': None,
            'eps_q1_yoy': None,
            'eps_q2_yoy': None,
            'eps_raw_score': None,
            'eps_years_available': 0
        }
        contexts: Dict[str, Any] = {}
        annual_context: Dict[str, Any] = {}

        # Extract annual EPS history and calculate CAGR
        if include_source_context:
            annual_eps = self.extract_annual_eps_history(annual_income_stmt, source_context=annual_context)
        else:
            annual_eps = self.extract_annual_eps_history(annual_income_stmt)
        cagr, years = self.calculate_5yr_cagr(annual_eps)
        result['eps_5yr_cagr'] = cagr
        result['eps_years_available'] = years
        if include_source_context and cagr is not None and math.isfinite(cagr):
            context = self._cagr_source_context(annual_context)
            if context is not None:
                contexts['eps_5yr_cagr'] = context

        # Extract quarterly YoY growth
        if include_source_context:
            quarterly_context: Dict[str, Any] = {}
            q1_yoy, q2_yoy = self.extract_quarterly_yoy_growth(
                quarterly_income_stmt, source_context=quarterly_context,
            )
            contexts.update(quarterly_context)
        else:
            q1_yoy, q2_yoy = self.extract_quarterly_yoy_growth(quarterly_income_stmt)
        result['eps_q1_yoy'] = q1_yoy
        result['eps_q2_yoy'] = q2_yoy

        # Calculate raw score
        raw_score = self.calculate_raw_score(cagr, q1_yoy, q2_yoy)
        result['eps_raw_score'] = raw_score

        if include_source_context:
            if raw_score is not None and math.isfinite(raw_score):
                input_fields = [
                    field for field in ('eps_5yr_cagr', 'eps_q1_yoy', 'eps_q2_yoy')
                    if result[field] is not None
                ]
                contexts['eps_raw_score'] = {
                    "provenance_kind": "derived",
                    "metric": "eps_raw_score",
                    "period_end": None,
                    "comparable_period_end": None,
                    "period_status": "dependency_defined",
                    "cadence": "mixed" if cagr is not None else "quarterly",
                    "basis": "eps_raw_score/v1",
                    "periods_used": list(dict.fromkeys(
                        period for field in input_fields
                        for period in contexts.get(field, {}).get("periods_used", [])
                    )),
                    "input_fields": input_fields,
                    "source_inputs": [{"field": field, "value": result[field]} for field in input_fields],
                    "algorithm": "eps-rating-raw-score-v1",
                    "weights": {"cagr": self.ALPHA, "quarterly_average": self.BETA, "acceleration": self.GAMMA},
                    "cagr_component_source": "eps_5yr_cagr" if cagr is not None else "quarterly_average",
                    "acceleration_enabled": q1_yoy is not None and q2_yoy is not None,
                    "rounding": {"decimal_places": 2},
                }
            result['_financial_source_context'] = contexts

        return result

    def calculate_percentile_ranks(
        self,
        raw_scores: Dict[str, float]
    ) -> Dict[str, int]:
        """
        Calculate percentile ranks (0-99) for all stocks based on raw scores.

        Args:
            raw_scores: Dict mapping symbol to raw_score

        Returns:
            Dict mapping symbol to eps_rating (0-99)
        """
        if not raw_scores:
            return {}

        # Filter out None values
        valid_scores = {
            symbol: score
            for symbol, score in raw_scores.items()
            if score is not None
        }

        if not valid_scores:
            return {}

        # Convert to numpy array for percentile calculation
        symbols = list(valid_scores.keys())
        scores = np.array([valid_scores[s] for s in symbols])

        # Calculate percentile for each score
        # scipy.stats.percentileofscore gives percentile (0-100), we want 0-99
        ratings = {}
        for i, symbol in enumerate(symbols):
            # Count how many scores are below this one
            below = np.sum(scores < scores[i])
            equal = np.sum(scores == scores[i])

            # Percentile: percentage of values that fall below
            # Using 'weak' method: strictly less than
            percentile = (below + 0.5 * (equal - 1)) / len(scores) * 100

            # Convert to 0-99 scale
            eps_rating = min(99, max(0, int(percentile)))
            ratings[symbol] = eps_rating

        return ratings
