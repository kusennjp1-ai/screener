"""Ingest the official US listing directory through the shared pipeline."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.stock_universe import StockUniverse, UNIVERSE_STATUS_ACTIVE, UNIVERSE_STATUS_INACTIVE_MISSING_SOURCE
from app.services.stock_universe_service import StockUniverseService
from app.services.us_listing_directory import parse_directory
from app.services.us_official_universe_ingestion_adapter import (
    US_OFFICIAL_SOURCE_NAME,
    us_official_universe_ingestion_adapter,
    us_universe_canonicalizer,
)
from app.services.us_reference_universe import plan_us_universe, prior_rows_from_universe

NASDAQ_LISTED = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
APMD|Apnimed, Inc. - Common Stock|G|N|N|100|N|N
File Creation Time: 1030202618:01|||||||
"""
OTHER_LISTED = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
File Creation Time: 1030202618:01||||||
"""


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autocommit=False, autoflush=False)()
    session.add_all([
        StockUniverse(symbol="AAPL", name="Apple Inc", market="US", exchange="XNAS", sector="Technology",
                      industry="Consumer Electronics", market_cap=3.1e12, status=UNIVERSE_STATUS_ACTIVE, is_active=True,
                      source="finviz"),
        StockUniverse(symbol="SPY", name="SPDR S&P 500 ETF Trust", market="US", exchange="XNYS", sector="Financial",
                      industry="Exchange Traded Fund", status=UNIVERSE_STATUS_ACTIVE, is_active=True, source="finviz"),
        StockUniverse(symbol="GONE", name="Delisted Co", market="US", exchange="XNAS", sector="Healthcare",
                      industry="Biotechnology", status=UNIVERSE_STATUS_ACTIVE, is_active=True, source="finviz"),
    ])
    session.commit()
    yield session
    session.close()
    engine.dispose()


def _plan(db):
    prior = prior_rows_from_universe(db.query(StockUniverse).filter(StockUniverse.active_filter()).all())
    directory = parse_directory(nasdaq_listed=NASDAQ_LISTED, other_listed=OTHER_LISTED)
    return plan_us_universe(directory, prior)


def test_official_ingest_keeps_identity_and_adds_new_listing(db):
    service = StockUniverseService()
    plan = _plan(db)

    stats = service.ingest_us_official_snapshot_rows(
        db,
        rows=[row.as_ingest_row() for row in plan.rows],
        snapshot_id="nasdaqtrader-symdir-2026-10-30",
        snapshot_as_of="2026-10-30",
        source_metadata={"file_created_at": plan.report["file_created_at"]},
    )
    rows = {row.symbol: row for row in db.query(StockUniverse).all()}

    assert stats["added"] == 1
    assert rows["AAPL"].name == "Apple Inc"
    assert (rows["AAPL"].sector, rows["AAPL"].industry) == ("Technology", "Consumer Electronics")
    assert rows["SPY"].exchange == "XNYS"
    assert rows["APMD"].exchange == "XNAS" and rows["APMD"].name == "Apnimed, Inc."
    assert rows["APMD"].status == UNIVERSE_STATUS_ACTIVE
    # Without a same-source baseline the pipeline removes nothing by itself.
    assert rows["GONE"].status == UNIVERSE_STATUS_ACTIVE


def test_explicit_removals_apply_within_bounds(db):
    service = StockUniverseService()
    plan = _plan(db)

    with pytest.raises(RuntimeError, match="exceed the reviewed bound"):
        service.deactivate_us_symbols_missing_from_official(db, symbols=plan.removed, prior_active_count=3, snapshot_id="s1")
    assert db.query(StockUniverse).filter_by(symbol="GONE").one().status == UNIVERSE_STATUS_ACTIVE

    summary = service.deactivate_us_symbols_missing_from_official(db, symbols=plan.removed, prior_active_count=100, snapshot_id="s1")

    assert summary["applied"] and summary["deactivated"] == 1 and summary["removed_percent"] == 1.0
    gone = db.query(StockUniverse).filter_by(symbol="GONE").one()
    assert gone.status == UNIVERSE_STATUS_INACTIVE_MISSING_SOURCE and not gone.is_active


def test_us_router_keeps_finviz_sources_on_the_finviz_adapter():
    finviz = us_universe_canonicalizer.canonicalize_rows(
        [{"symbol": "IBM", "name": "IBM", "exchange": "NYSE"}], source_name="finviz", snapshot_id="f1")
    official = us_universe_canonicalizer.canonicalize_rows(
        [{"symbol": "IBM", "name": "IBM", "exchange": "XNYS"}], source_name=US_OFFICIAL_SOURCE_NAME, snapshot_id="o1")

    assert finviz.canonical_rows[0].lifecycle.status_reason == "Present in Finviz universe sync"
    assert official.canonical_rows[0].lifecycle.status_reason == "Present in NASDAQ Trader symbol directory"
    assert official.canonical_rows[0].mic == "XNYS"
    with pytest.raises(ValueError, match="Unapproved US official listing source"):
        us_official_universe_ingestion_adapter.canonicalize_rows([], source_name="finviz", snapshot_id="x")
