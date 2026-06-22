"""Loader for IBD ground-truth reference lists.

The calibration harness compares the screener's leadership list against IBD's
actual published leaders. Those lists are transcribed (from the weekly IBD 50 /
Leaderboard) into JSON files under ``data/ibd_reference/<list_type>/`` — one file
per week — and loaded here.

File schema (``data/ibd_reference/ibd50/2026-06-18.json``)::

    {
      "as_of_date": "2026-06-18",
      "list_type": "ibd50",
      "market": "US",
      "source": "IBD 50 weekly (investors.com)",
      "constituents": [
        {"symbol": "ANAB", "composite": 99, "eps": 99, "rs": 97,
         "smr": "A", "acc_dis": "B", "group_rank": 12},
        {"symbol": "FIX"}
      ]
    }

Only ``symbol`` is required per constituent; the optional ratings let future
work calibrate against IBD's own ratings, not just membership.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ReferenceList:
    """One week's IBD reference list."""

    as_of_date: str
    list_type: str
    market: str
    symbols: tuple[str, ...]
    source: str | None = None
    constituents: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    @property
    def symbol_set(self) -> set[str]:
        return set(self.symbols)


def _normalize_symbol(symbol: Any) -> str | None:
    if symbol is None:
        return None
    text = str(symbol).strip().upper()
    return text or None


def parse_reference(payload: dict[str, Any]) -> ReferenceList:
    """Parse a reference payload into a ReferenceList, validating required keys."""
    as_of_date = str(payload.get("as_of_date") or "").strip()
    if not as_of_date:
        raise ValueError("Reference list is missing 'as_of_date'")

    raw_constituents = payload.get("constituents") or []
    if not isinstance(raw_constituents, list):
        raise ValueError("'constituents' must be a list")

    symbols: list[str] = []
    constituents: list[dict[str, Any]] = []
    for entry in raw_constituents:
        if isinstance(entry, str):
            entry = {"symbol": entry}
        if not isinstance(entry, dict):
            continue
        symbol = _normalize_symbol(entry.get("symbol"))
        if symbol is None:
            continue
        symbols.append(symbol)
        constituents.append({**entry, "symbol": symbol})

    if not symbols:
        raise ValueError(f"Reference list {as_of_date} has no usable symbols")

    return ReferenceList(
        as_of_date=as_of_date,
        list_type=str(payload.get("list_type") or "ibd50"),
        market=str(payload.get("market") or "US").upper(),
        symbols=tuple(dict.fromkeys(symbols)),  # de-dupe, preserve order
        source=payload.get("source"),
        constituents=tuple(constituents),
    )


def load_reference_file(path: str | Path) -> ReferenceList:
    """Load and parse a single reference JSON file."""
    with Path(path).open("r", encoding="utf-8") as handle:
        return parse_reference(json.load(handle))


def load_reference_lists(
    directory: str | Path,
    *,
    list_type: str | None = None,
) -> dict[str, ReferenceList]:
    """Load every ``*.json`` reference under ``directory`` (recursively).

    Returns ``{as_of_date: ReferenceList}``. Template files (named ``TEMPLATE``)
    are skipped. When ``list_type`` is given, only matching lists are returned.
    """
    root = Path(directory)
    if not root.exists():
        return {}

    results: dict[str, ReferenceList] = {}
    for path in sorted(root.rglob("*.json")):
        if path.stem.upper() == "TEMPLATE":
            continue
        try:
            reference = load_reference_file(path)
        except (ValueError, json.JSONDecodeError):
            continue
        if list_type is not None and reference.list_type != list_type:
            continue
        results[reference.as_of_date] = reference
    return results
