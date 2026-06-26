"""IBD-30 persistence (carry-forward) baseline.

IBD's weekly momentum/RS leaderboards are *sticky*: most names carry over from
one week to the next. So before reaching for the screener's Composite Rating,
the strongest cheap predictor of *this* week's list is simply *last* week's list
(optionally filtered to names that still look like leaders).

This module quantifies that. Given a sequence of weekly lists it measures, for
each step, how well week ``t-1`` predicts week ``t`` (carry-forward), and the
mean across all steps — the persistence baseline any model must beat.

Everything here is pure (no I/O, no DB) and works on the IBD-30 reference matrix
alone — it needs no screener features, so it is fully unit-testable and runnable
offline.
"""
from __future__ import annotations

from typing import Iterable, Mapping, Sequence


def carry_forward_metrics(
    predicted: Iterable[str],
    actual: Iterable[str],
) -> dict[str, float | int]:
    """Score a carry-forward prediction (predict ``actual`` using ``predicted``)."""
    p = {s.strip().upper() for s in predicted if s and s.strip()}
    a = {s.strip().upper() for s in actual if s and s.strip()}
    overlap = len(p & a)
    recall = overlap / len(a) if a else 0.0
    precision = overlap / len(p) if p else 0.0
    union = len(p | a)
    jaccard = overlap / union if union else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    return {
        "predicted_count": len(p),
        "actual_count": len(a),
        "overlap": overlap,
        "added": len(a - p),       # names new to the list this week (churn in)
        "dropped": len(p - a),     # names that fell off (churn out)
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "jaccard": round(jaccard, 4),
        "f1": round(f1, 4),
    }


def evaluate_persistence(
    weeks: Sequence[tuple[str, Sequence[str]]],
    *,
    top_n: int | None = None,
) -> dict[str, object]:
    """Measure week-over-week carry-forward across an ordered list of weeks.

    Args:
        weeks: ``[(week_label, [tickers...]), ...]`` ordered oldest-to-newest.
            Each ticker list is assumed to be in rank order.
        top_n: if set, only the first ``top_n`` names of the *previous* week are
            carried forward (a "keep only the strongest" prior).

    Returns per-step metrics and the mean recall/precision/jaccard/f1.
    """
    steps: list[dict[str, object]] = []
    for t in range(1, len(weeks)):
        prev_label, prev_list = weeks[t - 1]
        curr_label, curr_list = weeks[t]
        predicted = list(prev_list[:top_n]) if top_n else list(prev_list)
        metrics = carry_forward_metrics(predicted, curr_list)
        steps.append({"week": curr_label, "from": prev_label, **metrics})

    mean: dict[str, float] = {}
    if steps:
        for key in ("recall", "precision", "jaccard", "f1"):
            mean[key] = round(sum(float(s[key]) for s in steps) / len(steps), 4)
    return {"steps": steps, "mean": mean, "n_steps": len(steps)}


def rank_stability(
    weeks: Sequence[tuple[str, Sequence[str]]],
) -> dict[str, object]:
    """Average churn per step: how many names enter/leave the list each week.

    A low churn (few added/dropped) means the list is highly persistent and the
    carry-forward baseline is hard to beat.
    """
    added: list[int] = []
    dropped: list[int] = []
    for t in range(1, len(weeks)):
        prev = {s.strip().upper() for s in weeks[t - 1][1] if s and s.strip()}
        curr = {s.strip().upper() for s in weeks[t][1] if s and s.strip()}
        added.append(len(curr - prev))
        dropped.append(len(prev - curr))
    n = len(added)
    return {
        "mean_added_per_week": round(sum(added) / n, 2) if n else 0.0,
        "mean_dropped_per_week": round(sum(dropped) / n, 2) if n else 0.0,
        "n_steps": n,
    }


def parse_matrix(
    header: Sequence[str],
    rows: Sequence[Sequence[str]],
) -> list[tuple[str, list[str]]]:
    """Parse a rank x week matrix into ordered weekly lists.

    Args:
        header: week labels, one per column (column 0 may be a rank label that
            is ignored if it is empty/"rank").
        rows: each row is one rank's tickers across the weeks (row order = rank).

    Returns ``[(week_label, [ticker by rank...]), ...]`` in header column order.
    Empty / "?" cells are skipped so partial transcriptions still work.
    """
    # Detect a leading rank column (non-week first header like "rank"/"").
    start = 0
    if header and (not header[0].strip() or header[0].strip().lower() in {"rank", "#"}):
        start = 1

    weeks: list[tuple[str, list[str]]] = []
    for col in range(start, len(header)):
        label = header[col].strip()
        tickers: list[str] = []
        for row in rows:
            if col < len(row):
                cell = row[col].strip().upper()
                if cell and cell != "?":
                    tickers.append(cell)
        weeks.append((label, tickers))
    return weeks


def matrix_from_rows(
    csv_rows: Sequence[Sequence[str]],
    *,
    newest_first: bool = True,
) -> list[tuple[str, list[str]]]:
    """Build oldest-to-newest weekly lists from raw CSV rows (header + data).

    ``newest_first`` reflects the IBD-30 image layout where the leftmost column
    is the most recent week; the result is reversed to oldest-to-newest so
    ``evaluate_persistence`` predicts forward in time.
    """
    if not csv_rows:
        return []
    weeks = parse_matrix(csv_rows[0], csv_rows[1:])
    if newest_first:
        weeks = list(reversed(weeks))
    return weeks
