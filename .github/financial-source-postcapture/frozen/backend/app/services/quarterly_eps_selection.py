"""Select a complete reported EPS pair without changing its comparison periods."""

from __future__ import annotations

import math
from typing import Any

import pandas as pd


def select_quarterly_eps_pair_row(
    income: pd.DataFrame,
    preferred_row: Any,
    recent_column: Any,
    comparable_column: Any,
) -> Any:
    """Keep the producer's preferred row when both selected cells are finite.

    Only a missing/nonfinite pair can use another reported Basic/Diluted EPS
    row. Select both endpoints together, never another period or a metric whose
    growth happens to pass a threshold. Currency and cadence remain checked by
    the existing source-evidence contract after selection.
    """
    if preferred_row is None or recent_column is None or comparable_column is None:
        return None

    def complete(row: Any) -> bool:
        try:
            return all(
                math.isfinite(float(income.loc[row, column]))
                for column in (recent_column, comparable_column)
            )
        except (TypeError, ValueError, OverflowError, KeyError):
            return False

    if complete(preferred_row):
        return preferred_row
    for row in income.index:
        if str(row).lower().replace(" ", "") in {"dilutedeps", "basiceps"} and complete(row):
            return row
    # No complete supported alternative: retain the producer's existing
    # missing/nonfinite scalar handling and evidence rejection behavior.
    return preferred_row
