"""Unit tests for the IBD reference-list loader."""

from __future__ import annotations

import json

import pytest

from app.services.ibd_reference import (
    load_reference_lists,
    parse_reference,
)


def test_parse_reference_accepts_dicts_and_bare_strings():
    ref = parse_reference(
        {
            "as_of_date": "2026-06-18",
            "list_type": "ibd50",
            "constituents": [
                {"symbol": "fix", "composite": 99},
                "crdo",
                {"symbol": "  alab  "},
            ],
        }
    )
    assert ref.symbols == ("FIX", "CRDO", "ALAB")  # normalised + ordered
    assert ref.symbol_set == {"FIX", "CRDO", "ALAB"}
    assert ref.market == "US"


def test_parse_reference_dedupes_symbols():
    ref = parse_reference(
        {"as_of_date": "2026-06-18", "constituents": ["AAA", "aaa", "BBB"]}
    )
    assert ref.symbols == ("AAA", "BBB")


def test_parse_reference_requires_date_and_symbols():
    with pytest.raises(ValueError):
        parse_reference({"constituents": ["AAA"]})
    with pytest.raises(ValueError):
        parse_reference({"as_of_date": "2026-06-18", "constituents": []})


def test_load_reference_lists_skips_template_and_filters_type(tmp_path):
    ibd50 = tmp_path / "ibd50"
    ibd50.mkdir()
    (ibd50 / "2026-06-18.json").write_text(
        json.dumps({"as_of_date": "2026-06-18", "list_type": "ibd50", "constituents": ["FIX"]}),
        encoding="utf-8",
    )
    (ibd50 / "TEMPLATE.json").write_text(
        json.dumps({"as_of_date": "YYYY", "constituents": ["X"]}), encoding="utf-8"
    )
    leaderboard = tmp_path / "leaderboard"
    leaderboard.mkdir()
    (leaderboard / "2026-06-18.json").write_text(
        json.dumps({"as_of_date": "2026-06-18", "list_type": "leaderboard", "constituents": ["AMD"]}),
        encoding="utf-8",
    )

    ibd_only = load_reference_lists(tmp_path, list_type="ibd50")
    assert set(ibd_only) == {"2026-06-18"}
    assert ibd_only["2026-06-18"].symbols == ("FIX",)

    everything = load_reference_lists(tmp_path)
    # Both list types share the date key; the loader keeps one per date, but the
    # template is always skipped.
    assert "2026-06-18" in everything


def test_load_reference_lists_missing_dir_returns_empty(tmp_path):
    assert load_reference_lists(tmp_path / "nope") == {}
