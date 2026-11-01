"""Reference data provenance recorded next to every static market export."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.domain.markets import market_registry
from app.models.provider_snapshot import ProviderSnapshotPointer, ProviderSnapshotRun
from app.models.stock_universe import StockUniverse, UNIVERSE_STATUS_ACTIVE, UNIVERSE_STATUS_INACTIVE_MISSING_SOURCE
from app.services.provider_snapshot_service import ProviderSnapshotService
from app.services.reference_data_freshness import (
    REFERENCE_DATA_SCHEMA,
    load_reference_data,
    reference_data_status,
    snapshot_key_for,
    stale_reference_warning,
)


def _run(published_at):
    return ProviderSnapshotRun(snapshot_key="fundamentals_v1_us", run_mode="publish", status="published",
                               source_revision="fundamentals_v1_us:20260613143433", published_at=published_at,
                               created_at=published_at or datetime(2026, 6, 13, 14, 0))


def test_snapshot_key_matches_provider_snapshot_service_for_every_market():
    for market in market_registry.supported_market_codes():
        assert snapshot_key_for(market) == ProviderSnapshotService.snapshot_key_for_market(market)


def test_june_bundle_on_an_october_session_is_stale_with_its_own_date():
    status = reference_data_status(market="US", snapshot_key="fundamentals_v1_us", run=_run(datetime(2026, 6, 13, 14, 34)),
                                   scan_as_of=date(2026, 10, 30), max_age_days=8, universe_sources={"finviz": 9926})

    assert status == {
        "schema_version": REFERENCE_DATA_SCHEMA,
        "market": "US",
        "snapshot_key": "fundamentals_v1_us",
        "max_age_days": 8,
        "universe_sources": {"finviz": 9926},
        "available": True,
        "as_of_date": "2026-06-13",
        "source_revision": "fundamentals_v1_us:20260613143433",
        "age_days": 139,
        "stale": True,
    }
    assert stale_reference_warning(status) == (
        "US weekly reference data is 139 days old (as of 2026-06-13, limit 8); universe membership and "
        "reference fundamentals are not current."
    )


def test_recent_bundle_is_current_and_missing_bundle_is_unknown_not_fresh():
    current = reference_data_status(market="US", snapshot_key="k", run=_run(datetime(2026, 10, 31, 18, 0)),
                                    scan_as_of=date(2026, 11, 2), max_age_days=8, universe_sources={})
    missing = reference_data_status(market="US", snapshot_key="k", run=None, scan_as_of=date(2026, 11, 2),
                                    max_age_days=8, universe_sources={})

    assert current["stale"] is False and current["age_days"] == 2
    assert stale_reference_warning(current) is None
    assert missing["available"] is False and missing["stale"] is True and missing["age_days"] is None
    assert "unavailable" in stale_reference_warning(missing)


def test_load_reference_data_reads_the_published_pointer_and_active_sources():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    run = _run(datetime(2026, 6, 13, 14, 34))
    db.add(run)
    db.flush()
    db.add(ProviderSnapshotPointer(snapshot_key="fundamentals_v1_us", run_id=run.id))
    db.add_all([
        StockUniverse(symbol="AAPL", market="US", exchange="XNAS", status=UNIVERSE_STATUS_ACTIVE, is_active=True, source="finviz"),
        StockUniverse(symbol="APMD", market="US", exchange="XNAS", status=UNIVERSE_STATUS_ACTIVE, is_active=True,
                      source="nasdaqtrader_symdir"),
        StockUniverse(symbol="GONE", market="US", exchange="XNAS", status=UNIVERSE_STATUS_INACTIVE_MISSING_SOURCE,
                      is_active=False, source="finviz"),
        StockUniverse(symbol="0700.HK", market="HK", exchange="XHKG", status=UNIVERSE_STATUS_ACTIVE, is_active=True, source="hkex"),
    ])
    db.commit()

    status = load_reference_data(db, market="US", snapshot_key="fundamentals_v1_us", scan_as_of=date(2026, 10, 30), max_age_days=8)

    assert status["as_of_date"] == "2026-06-13" and status["stale"] is True
    assert status["universe_sources"] == {"finviz": 1, "nasdaqtrader_symdir": 1}
    db.close()
    engine.dispose()


def test_unreadable_provenance_is_reported_as_unknown_without_poisoning_the_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[StockUniverse.__table__])
    db = sessionmaker(bind=engine)()

    status = load_reference_data(db, market="US", snapshot_key="fundamentals_v1_us", scan_as_of=date(2026, 10, 30), max_age_days=8)

    assert status["available"] is False and status["stale"] is True
    assert status["error"] == "OperationalError: reference provenance could not be read"
    assert db.query(StockUniverse).count() == 0
    db.close()
    engine.dispose()
