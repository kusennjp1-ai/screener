"""Tests for planning the US universe from the official listing directory."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.us_listing_directory import parse_directory
from app.services.us_reference_universe import clean_listing_name, plan_us_universe, prior_rows_from_universe

NASDAQ_LISTED = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
QBTS|D-Wave Quantum Inc. - Common Stock|G|N|N|100|N|N
APMD|Apnimed, Inc. - Common Stock|G|N|N|100|N|N
NEWW|Newco Acquisition Corp - Warrant|S|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
ZXZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N
File Creation Time: 1030202618:01|||||||
"""

OTHER_LISTED = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. Class B|N|BRK.B|N|100|N|BRK.B
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
NEWARCA|New Arca ETF|P|NEWARCA|Y|100|N|NEWARCA
ET|Energy Transfer LP Common Units|TXSE|ET|N|100|N|ET
ADIG|ADI Global Distribution Inc. Common Stock|N|ADIG|N|100|N|ADIG
UNITX|Legacy Corp Units|N|UNITX|N|100|N|UNITX
File Creation Time: 1030202618:01||||||
"""

PRIOR = {
    "AAPL": {"exchange": "XNAS", "name": "Apple Inc", "sector": "Technology", "industry": "Consumer Electronics", "market_cap": 3.1e12},
    "QBTS": {"exchange": "XNYS", "name": "D-Wave Quantum Inc", "sector": "Technology", "industry": "Computer Hardware", "market_cap": 5e9},
    "BRK-B": {"exchange": "XNYS", "name": "Berkshire Hathaway Inc", "sector": "Financial", "industry": "Insurance - Diversified", "market_cap": 1e12},
    "SPY": {"exchange": "XNYS", "name": "SPDR S&P 500 ETF Trust", "sector": "Financial", "industry": "Exchange Traded Fund", "market_cap": None},
    "ET": {"exchange": "XNYS", "name": "Energy Transfer LP", "sector": "Energy", "industry": "Oil & Gas Midstream", "market_cap": 6e10},
    "UNITX": {"exchange": "XNYS", "name": "Legacy Corp", "sector": "Financial", "industry": "Shell Companies", "market_cap": 1e8},
    "GONE": {"exchange": "XNAS", "name": "Delisted Co", "sector": "Healthcare", "industry": "Biotechnology", "market_cap": 1e7},
    "ZXZZT": {"exchange": "XNAS", "name": "Test", "sector": "", "industry": "", "market_cap": None},
}


def _plan():
    directory = parse_directory(nasdaq_listed=NASDAQ_LISTED, other_listed=OTHER_LISTED)
    return plan_us_universe(directory, PRIOR)


def test_still_listed_symbols_keep_prior_reference_fields():
    rows = {row.symbol: row for row in _plan().rows}

    assert rows["AAPL"].name == "Apple Inc"
    assert (rows["AAPL"].sector, rows["AAPL"].industry) == ("Technology", "Consumer Electronics")
    assert rows["AAPL"].market_cap == 3.1e12
    assert rows["AAPL"].change == "kept"
    # Prior non-equity lines stay for continuity instead of churning.
    assert rows["UNITX"].security_class == "unit" and rows["UNITX"].change == "kept"


def test_unmodelled_venues_keep_prior_identity_and_core_moves_apply():
    plan = _plan()
    rows = {row.symbol: row for row in plan.rows}

    assert rows["SPY"].exchange == "XNYS" and rows["SPY"].is_etf
    assert rows["ET"].exchange == "XNYS"
    assert rows["BRK-B"].exchange == "XNYS"
    assert rows["QBTS"].exchange == "XNAS"
    assert plan.report["exchange_moves"] == {"XNYS->XNAS": {"count": 1, "examples": ["QBTS"]}}
    assert plan.report["kept_prior_identity_on_unmodelled_venue"] == {"NYSEARCA": 1, "TXSE": 1}


def test_new_listings_are_core_exchange_equities_and_funds_only():
    plan = _plan()
    added = {row.symbol: row for row in plan.rows if row.change == "added"}

    assert set(added) == {"ADIG", "APMD", "QQQ"}
    assert added["APMD"].name == "Apnimed, Inc."
    assert added["APMD"].exchange == "XNAS" and added["APMD"].sector == ""
    assert added["ADIG"].name == "ADI Global Distribution Inc."
    assert added["QQQ"].is_etf and added["QQQ"].exchange == "XNAS"
    assert plan.report["skipped_new_listings"] == {"new_etf_on_NYSEARCA": 1, "new_warrant": 1}
    assert plan.report["added_by_class"] == {"common": 2, "etf": 1}


def test_unlisted_and_test_symbols_are_reported_for_removal():
    plan = _plan()

    assert plan.removed == ("GONE", "ZXZZT")
    assert plan.report["removed"] == 2
    assert plan.report["prior_active"] == len(PRIOR)
    assert plan.report["planned_active"] == len(plan.rows) == 9
    assert plan.report["file_created_at"]["otherlisted.txt"] == "2026-10-30T18:01"


def test_prior_rows_index_orm_objects_and_dicts():
    orm = SimpleNamespace(symbol="AAPL", exchange="XNAS", name="Apple Inc", sector="Technology", industry="X", market_cap=1.0)

    assert prior_rows_from_universe([orm, {"symbol": "IBM", "exchange": "XNYS"}]) == {
        "AAPL": {"exchange": "XNAS", "name": "Apple Inc", "sector": "Technology", "industry": "X", "market_cap": 1.0},
        "IBM": {"exchange": "XNYS", "name": None, "sector": None, "industry": None, "market_cap": None},
    }


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Apple Inc. - Common Stock", "Apple Inc."),
        ("Accelevation Holdings Corp. - Class A ordinary shares", "Accelevation Holdings Corp."),
        ("ADI Global Distribution Inc. Common Stock", "ADI Global Distribution Inc."),
        ("Federal Agricultural Mortgage Corporation Common Stock", "Federal Agricultural Mortgage Corporation"),
        ("Alibaba Group Holding Limited American Depositary Shares", "Alibaba Group Holding Limited American Depositary Shares"),
        ("Common Stock", "Common Stock"),
    ],
)
def test_clean_listing_name(raw, expected):
    assert clean_listing_name(raw) == expected
