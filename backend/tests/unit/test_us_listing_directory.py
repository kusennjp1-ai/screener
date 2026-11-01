"""Offline tests for the NASDAQ Trader symbol directory parser."""

from __future__ import annotations

import pytest

from app.services.us_listing_directory import (
    equity_candidates,
    parse_directory,
    parse_nasdaq_listed,
    parse_other_listed,
)

NASDAQ_LISTED = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
ASML|ASML Holding N.V. - New York Registry Shares|Q|N|N|100|N|N
BABA|Alibaba Group - American Depositary Shares|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
ACAHU|Acme Acquisition Corp - Units|S|N|N|100|N|N
ACAHW|Acme Acquisition Corp - Warrant|S|N|N|100|N|N
ACAHR|Acme Acquisition Corp - Rights|S|N|N|100|N|N
ZXZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N
DFCT|Deficient Co - Class A Common Stock|S|N|D|100|N|N
FITBP|Fifth Third Bancorp - Depositary Shares each representing 1/40th interest in a share of Series A Preferred|Q|N|N|100|N|N
File Creation Time: 1031202618:01|||||||
"""

OTHER_LISTED = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. Class B|N|BRK.B|N|100|N|BRK.B
IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM
EPD|Enterprise Products Partners L.P. Common Units representing Limited Partner Interests|N|EPD|N|100|N|EPD
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
IMO|Imperial Oil Limited Common Stock|A|IMO|N|100|N|IMO
ABR$D|Arbor Realty Trust 6.375% Series D Cumulative Redeemable Preferred Stock|N|ABRpD|N|100|N|ABR-D
XYZ.WS|XYZ Corp Warrants|N|XYZ.WS|N|100|N|XYZ/WS
XYZ.U|XYZ Corp Units|N|XYZ.U|N|100|N|XYZ=
TBB|AT&T Inc. 5.35% Global Notes due 2066|N|TBB|N|100|N|TBB
VXX|iPath Series B S&P 500 VIX Short-Term Futures ETN|Z|VXX|N|100|N|VXX
File Creation Time: 1031202618:01|||||||
"""


def test_nasdaq_listed_classifies_equity_and_non_equity_lines():
    listings, created_at = parse_nasdaq_listed(NASDAQ_LISTED)
    by_symbol = {listing.symbol: listing for listing in listings}

    assert created_at == "2026-10-31T18:01"
    assert by_symbol["AAPL"].security_class == "common"
    assert by_symbol["ASML"].security_class == "common"
    assert by_symbol["BABA"].security_class == "adr"
    assert by_symbol["QQQ"].security_class == "etf" and by_symbol["QQQ"].is_etf
    assert by_symbol["ACAHU"].security_class == "unit"
    assert by_symbol["ACAHW"].security_class == "warrant"
    assert by_symbol["ACAHR"].security_class == "right"
    assert by_symbol["ZXZZT"].security_class == "test"
    assert by_symbol["FITBP"].security_class == "preferred"
    # A compliance deficiency does not delist a company; keep it and record why.
    assert by_symbol["DFCT"].security_class == "common"
    assert by_symbol["DFCT"].financial_status == "D"
    assert all(listing.exchange == "NASDAQ" for listing in listings)


def test_other_listed_maps_exchanges_and_canonicalizes_share_classes():
    listings, _ = parse_other_listed(OTHER_LISTED)
    by_symbol = {listing.symbol: listing for listing in listings}

    assert by_symbol["BRK-B"].source_symbol == "BRK.B"
    assert by_symbol["BRK-B"].exchange == "NYSE"
    assert by_symbol["BRK-B"].security_class == "common"
    assert by_symbol["IMO"].exchange == "AMEX"
    # MLP common units are listed equity, unlike SPAC units.
    assert by_symbol["EPD"].security_class == "common"
    assert by_symbol["XYZ.U"].security_class == "unit"
    assert by_symbol["XYZ.WS"].security_class == "warrant"
    assert by_symbol["ABR$D"].security_class == "preferred_or_special"
    assert by_symbol["TBB"].security_class == "note"
    assert by_symbol["SPY"].exchange == "NYSEARCA" and by_symbol["SPY"].security_class == "etf"
    assert by_symbol["VXX"].exchange == "BATS" and by_symbol["VXX"].security_class == "etn"
    assert by_symbol["VXX"].is_etf


def test_equity_candidates_are_core_exchange_common_stock_and_adrs():
    directory = parse_directory(nasdaq_listed=NASDAQ_LISTED, other_listed=OTHER_LISTED)

    assert [listing.symbol for listing in equity_candidates(directory)] == [
        "AAPL", "ASML", "BABA", "BRK-B", "DFCT", "EPD", "IBM", "IMO",
    ]
    assert directory.file_created_at == {
        "nasdaqlisted.txt": "2026-10-31T18:01",
        "otherlisted.txt": "2026-10-31T18:01",
    }
    assert directory.duplicate_symbols == ()
    assert directory.class_counts()["NYSEARCA:etf"] == 1


def test_duplicate_symbol_across_files_is_kept_once_and_reported():
    other = OTHER_LISTED.replace("IBM|International", "AAPL|Duplicate", 1)
    directory = parse_directory(nasdaq_listed=NASDAQ_LISTED, other_listed=other)

    assert directory.duplicate_symbols == ("AAPL",)
    assert directory.by_symbol()["AAPL"].exchange == "NASDAQ"


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (NASDAQ_LISTED.replace("Security Name", "Name", 1), "Unexpected nasdaqlisted.txt header"),
        (NASDAQ_LISTED.replace("File Creation Time: 1031202618:01|||||||\n", ""), "File Creation Time"),
        (NASDAQ_LISTED.replace("AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N", "AAPL|Apple|Q|N"), "has 4 fields"),
        ("", "empty or truncated"),
    ],
)
def test_format_changes_fail_closed(text, message):
    with pytest.raises(ValueError, match=message):
        parse_nasdaq_listed(text)


def test_unknown_other_listed_exchange_code_fails_closed():
    changed = OTHER_LISTED.replace("Common Stock|A|IMO|", "Common Stock|Q|IMO|", 1)
    assert changed != OTHER_LISTED
    with pytest.raises(ValueError, match="Unknown otherlisted.txt exchange code 'Q'"):
        parse_other_listed(changed)


def test_reference_comparison_reports_membership_exchange_and_cohort_changes(tmp_path):
    import gzip
    import json

    from app.scripts.compare_us_reference_sources import compare, main

    bundle = {
        "as_of_date": "2026-06-13",
        "universe": [
            {"symbol": "AAPL", "exchange": "XNAS", "is_active": True},
            {"symbol": "IBM", "exchange": "XNYS", "is_active": True},
            {"symbol": "SPY", "exchange": "XASE", "is_active": True},
            {"symbol": "GONE", "exchange": "XNYS", "is_active": True},
            {"symbol": "OLD", "exchange": "XNYS", "is_active": False},
        ],
        "snapshot": {"rows": [{"symbol": "AAPL"}, {"symbol": "IBM"}]},
    }
    sec = {"fields": ["cik", "name", "ticker", "exchange"],
           "data": [[320193, "Apple", "AAPL", "Nasdaq"], [1067983, "Berkshire", "BRK.B", "NYSE"], [1, "Gone", "GONE", "OTC"]]}
    manifest = {"required_cohort": {"AAPL": "XNAS", "SPY": "XASE", "GONE": "XNYS"}}

    report = compare(bundle=bundle, nasdaq_listed=NASDAQ_LISTED, other_listed=OTHER_LISTED, sec_tickers=sec, daily_manifest=manifest)

    assert report["bundle"]["active_universe"] == 4
    diff = report["bundle_vs_official"]
    assert diff["bundle_symbols_by_official_class"] == {"NASDAQ:common": 1, "NYSE:common": 1, "NYSEARCA:etf": 1, "missing": 1}
    assert diff["missing_examples"] == ["GONE"]
    assert diff["exchange_changes"] == {"XASE->ARCX": {"count": 1, "examples": ["SPY"]}}
    assert diff["new_equity_candidates"] == 6
    assert report["sec"]["missing_bundle_symbols_sec_exchange"] == {"OTC": 1}
    assert report["required_cohort"]["absent_examples"] == ["GONE"]
    assert report["required_cohort"]["exchange_change_examples"] == ["SPY"]

    paths = {}
    for name, value in {"bundle.json.gz": bundle, "sec.json": sec, "manifest.json": manifest}.items():
        paths[name] = tmp_path / name
        raw = json.dumps(value).encode()
        paths[name].write_bytes(gzip.compress(raw) if name.endswith(".gz") else raw)
    (tmp_path / "nasdaq.txt").write_text(NASDAQ_LISTED)
    (tmp_path / "other.txt").write_text(OTHER_LISTED)
    assert main(["--bundle", str(paths["bundle.json.gz"]), "--nasdaq-listed", str(tmp_path / "nasdaq.txt"),
                 "--other-listed", str(tmp_path / "other.txt"), "--sec-tickers-exchange", str(paths["sec.json"]),
                 "--daily-price-manifest", str(paths["manifest.json"]), "--output", str(tmp_path / "report.json"),
                 "--summary", str(tmp_path / "summary.md")]) == 0
    assert json.loads((tmp_path / "report.json").read_text()) == report
    assert "Bundle symbols missing from official: 1" in (tmp_path / "summary.md").read_text()
