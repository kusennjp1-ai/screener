"""Unit tests for PriceCacheWarmupStore payload handling."""

from __future__ import annotations

import json
from inspect import signature
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.services.cache.price_cache_warmup import (
    PriceCacheWarmupStore,
    evaluate_warmup_metadata,
)


@pytest.fixture(autouse=True)
def _disable_receipt_test_redis(monkeypatch):
    monkeypatch.setattr("app.services.price_cache_service.get_redis_client", lambda: None)


class _FakeRedis:
    def __init__(self, payload: str | None = None):
        self.payload = payload
        self.last_set_key = None
        self.last_set_ttl = None
        self.last_set_value = None

    def get(self, _key):
        return self.payload

    def setex(self, key, ttl, value):
        self.last_set_key = key
        self.last_set_ttl = ttl
        self.last_set_value = value
        self.payload = value


def test_get_warmup_metadata_ignores_non_mapping_payload():
    logger = MagicMock()
    redis_client = _FakeRedis(payload=json.dumps(["unexpected", "shape"]))
    store = PriceCacheWarmupStore(
        logger=logger,
        redis_client=redis_client,
        metadata_key="cache:warmup:metadata",
        heartbeat_key="cache:warmup:heartbeat",
    )

    assert store.get_warmup_metadata() is None
    logger.warning.assert_called_once()


def test_complete_warmup_heartbeat_preserves_progress_fields():
    logger = MagicMock()
    redis_client = _FakeRedis(
        payload=json.dumps(
            {
                "status": "running",
                "current": 3,
                "total": 10,
                "percent": 30.0,
                "updated_at": "2026-04-08T00:00:00",
            }
        )
    )
    store = PriceCacheWarmupStore(
        logger=logger,
        redis_client=redis_client,
        metadata_key="cache:warmup:metadata",
        heartbeat_key="cache:warmup:heartbeat",
    )

    store.complete_warmup_heartbeat("completed")

    # Bead asia.9.2: heartbeat key is now per-market scoped; with no market
    # explicitly passed, the key is suffixed with ":shared".
    assert redis_client.last_set_key == "cache:warmup:heartbeat:shared"
    assert redis_client.last_set_ttl == 3600
    saved_payload = json.loads(redis_client.last_set_value)
    assert saved_payload["status"] == "completed"
    assert saved_payload["current"] == 3
    assert saved_payload["total"] == 10
    assert saved_payload["percent"] == 100.0


def test_evaluate_warmup_metadata_reports_partial_progress():
    readiness = evaluate_warmup_metadata(
        {
            "status": "partial",
            "count": "19",
            "total": "31",
            "completed_at": "2026-06-09T08:00:00",
        },
        context="same-day breadth run",
        now=datetime(2026, 6, 9, 9, 0, 0),
    )

    assert readiness.ready is False
    assert readiness.count == 19
    assert readiness.total == 31
    assert readiness.percent == pytest.approx(61.2903)
    assert readiness.summary == "partial, 19/31"
    assert (
        readiness.reason
        == "Cache warmup not complete for same-day breadth run (partial, 19/31)"
    )


def test_evaluate_warmup_metadata_does_not_own_workflow_partial_thresholds():
    assert "allow_partial_min_coverage" not in signature(evaluate_warmup_metadata).parameters


def test_evaluate_warmup_metadata_keeps_current_partial_not_ready():
    readiness = evaluate_warmup_metadata(
        {
            "status": "partial",
            "count": 1081,
            "total": 1969,
            "completed_at": "2026-06-09T08:00:00",
        },
        context="same-day group ranking run",
        now=datetime(2026, 6, 9, 9, 0, 0),
    )

    assert readiness.ready is False
    assert readiness.status == "partial"
    assert readiness.metadata_current is True
    assert not hasattr(readiness, "fresh")
    assert readiness.percent == pytest.approx(54.901)


def test_evaluate_warmup_metadata_rejects_stale_partial_even_above_minimum():
    readiness = evaluate_warmup_metadata(
        {
            "status": "partial",
            "count": 1081,
            "total": 1969,
            "completed_at": "2026-06-08T08:00:00",
        },
        context="same-day group ranking run",
        max_age=timedelta(hours=12),
        now=datetime(2026, 6, 9, 8, 1, 0),
    )

    assert readiness.ready is False
    assert readiness.reason == "Cache warmup metadata is stale for same-day group ranking run"


def test_evaluate_warmup_metadata_rejects_stale_completed_metadata():
    readiness = evaluate_warmup_metadata(
        {
            "status": "completed",
            "count": 31,
            "total": 31,
            "completed_at": "2026-06-08T08:00:00",
        },
        context="same-day group ranking run",
        max_age=timedelta(hours=12),
        now=datetime(2026, 6, 9, 8, 1, 0),
    )

    assert readiness.ready is False
    assert readiness.reason == "Cache warmup metadata is stale for same-day group ranking run"


def test_evaluate_warmup_metadata_rejects_completed_missing_completed_at():
    readiness = evaluate_warmup_metadata(
        {
            "status": "completed",
            "count": 31,
            "total": 31,
        },
        context="same-day group ranking run",
        max_age=timedelta(hours=12),
        now=datetime(2026, 6, 9, 8, 1, 0),
    )

    assert readiness.ready is False
    assert (
        readiness.reason
        == "Cache warmup metadata timestamp is missing for same-day group ranking run"
    )


def _price_receipt_factory():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.models.stock import StockPrice

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[StockPrice.__table__])
    return sessionmaker(bind=engine, expire_on_commit=False)


def _price_receipt_history():
    import pandas as pd

    return pd.DataFrame(
        {
            "Open": [100.0, 101.0], "High": [102.0, 103.0],
            "Low": [99.0, 100.0], "Close": [101.0, 102.0],
            "Volume": [1000, 1100], "Adj Close": [101.0, 102.0],
        },
        index=pd.to_datetime(["2026-10-05", "2026-10-06"]),
    )


def test_price_receipt_counts_committed_rows_without_redis():
    from app.models.stock import StockPrice
    from app.services.price_cache_service import PriceCacheService

    factory = _price_receipt_factory()
    cache = PriceCacheService(redis_client=None, session_factory=factory)
    data = _price_receipt_history()
    # Preserve the legacy public return as a Redis-only integer.
    assert cache.store_batch_in_cache({"TEST": data}) == 0
    receipt = cache.store_batch_in_cache_with_receipt({"TEST": data}, market="US")
    assert receipt.complete
    assert receipt.submitted_symbols == receipt.persisted_symbols == ("TEST",)
    assert receipt.submitted_rows == receipt.persisted_rows == 2
    with factory() as db:
        assert db.query(StockPrice).filter(StockPrice.symbol == "TEST").count() == 2


def test_price_receipt_excludes_incoherent_history_without_mutating_inputs():
    import pandas as pd
    from app.models.stock import StockPrice
    from app.services.price_cache_service import PriceCacheService

    factory = _price_receipt_factory()
    cache = PriceCacheService(redis_client=None, session_factory=factory)
    good = _price_receipt_history()
    bad = good.copy()
    bad.iloc[0, bad.columns.get_loc("High")] = 90.0
    original_good, original_bad = good.copy(deep=True), bad.copy(deep=True)
    receipt = cache.persist_price_batch({"GOOD": good, "BAD": bad})
    assert receipt.submitted_symbols == ("GOOD", "BAD")
    assert receipt.accepted_symbols == receipt.persisted_symbols == ("GOOD",)
    assert receipt.submitted_rows == 4
    assert receipt.persisted_rows == 2
    assert receipt.rejected_symbols == {"BAD": "incoherent_history"}
    assert not receipt.complete
    pd.testing.assert_frame_equal(good, original_good)
    pd.testing.assert_frame_equal(bad, original_bad)
    with factory() as db:
        assert db.query(StockPrice).filter(StockPrice.symbol == "BAD").count() == 0


@pytest.mark.parametrize("invalid_adjusted_close", ["not-a-number", float("inf"), "nan"])
def test_price_receipt_rejects_the_whole_symbol_on_row_preparation_error(invalid_adjusted_close):
    from app.models.stock import StockPrice
    from app.services.price_cache_service import PriceCacheService

    factory = _price_receipt_factory()
    cache = PriceCacheService(redis_client=None, session_factory=factory)
    data = _price_receipt_history()
    data["Adj Close"] = [101.0, invalid_adjusted_close]
    receipt = cache.persist_price_batch({"TEST": data})
    assert receipt.accepted_symbols == receipt.persisted_symbols == ()
    assert receipt.persisted_rows == 0
    assert receipt.rejected_symbols == {"TEST": "row_preparation_failed:ValueError"}
    with factory() as db:
        assert db.query(StockPrice).count() == 0


def test_price_receipt_reports_zero_for_transaction_rollback():
    from app.models.stock import StockPrice
    from app.services.price_cache_service import PriceCacheService

    factory = _price_receipt_factory()
    def failing_factory():
        db = factory()
        db.commit = MagicMock(side_effect=RuntimeError("synthetic commit failure"))
        return db

    cache = PriceCacheService(redis_client=None, session_factory=failing_factory)
    receipt = cache.store_batch_in_cache_with_receipt(
        {"FIRST": _price_receipt_history(), "SECOND": _price_receipt_history()}, market="US",
    )
    assert receipt.accepted_symbols == ("FIRST", "SECOND")
    assert receipt.persisted_symbols == ()
    assert receipt.persisted_rows == 0
    assert set(receipt.rejected_symbols) == {"FIRST", "SECOND"}
    with factory() as db:
        assert db.query(StockPrice).count() == 0


@pytest.mark.parametrize("adjusted_mode", ["null", "nan", "absent"])
def test_price_receipt_preserves_unknown_adjustments_and_cached_history(adjusted_mode, tmp_path):
    import pandas as pd
    from app.models.stock import StockPrice
    from app.services.price_cache_service import PriceCacheService

    factory = _price_receipt_factory()
    cache = PriceCacheService(redis_client=None, session_factory=factory)
    data = pd.concat([_price_receipt_history().iloc[[0]]] * 60, ignore_index=True)
    data.index = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=60)
    if adjusted_mode == "absent":
        data = data.drop(columns=["Adj Close"])
    else:
        data["Adj Close"] = None if adjusted_mode == "null" else float("nan")
    original = data.copy(deep=True)
    receipt = cache.persist_price_batch({"TEST": data})
    assert receipt.complete
    assert receipt.submitted_symbols == receipt.accepted_symbols == receipt.persisted_symbols == ("TEST",)
    assert receipt.submitted_rows == receipt.persisted_rows == 60
    assert receipt.rejected_symbols == {}
    with factory() as db:
        persisted = db.query(StockPrice).filter(StockPrice.symbol == "TEST").all()
        assert len(persisted) == 60
        assert all(row.adj_close is None for row in persisted)
        assert all(row.close == 101.0 for row in persisted)
    cached, last_date = cache._get_from_database("TEST", "max")
    assert cached is not None
    assert last_date == data.index[-1].date()
    pd.testing.assert_frame_equal(
        cached, data[["Open", "High", "Low", "Close", "Volume"]],
        check_names=False, check_freq=False, check_dtype=False,
    )
    pd.testing.assert_frame_equal(data, original)

    # Exercise the real bundle exporter/importer with exported SQL NULL values.
    from app.database import Base
    from app.models.app_settings import AppSetting
    from app.models.stock_universe import StockUniverse
    from app.services.daily_price_bundle_service import DailyPriceBundleService

    bundle_service = DailyPriceBundleService(price_cache=cache)
    bundle_path = tmp_path / "synthetic-null-adjustments.json"
    with factory() as db:
        Base.metadata.create_all(db.get_bind(), tables=[StockUniverse.__table__])
        db.add(StockUniverse(
            symbol="TEST", market="US", exchange="NASDAQ", is_active=True, status="active",
        ))
        db.commit()
        exported = bundle_service.export_daily_price_bundle(
            db, market="US", output_path=bundle_path, bundle_asset_name=bundle_path.name,
            as_of_date=data.index[-1].date(), symbols=["TEST"], require_complete=True,
        )
    assert exported["rows"] == 60
    payload = bundle_service._read_bundle_payload(bundle_path)
    assert all(bar["adj_close"] is None for bar in payload["rows"][0]["prices"])
    imported_factory = _price_receipt_factory()
    imported_cache = PriceCacheService(redis_client=None, session_factory=imported_factory)
    imported_service = DailyPriceBundleService(price_cache=imported_cache)
    with imported_factory() as db:
        Base.metadata.create_all(db.get_bind(), tables=[AppSetting.__table__])
        imported = imported_service.import_daily_price_bundle(
            db, input_path=bundle_path, warm_redis_symbols=0,
        )
        assert imported["status"] == "success"
        assert imported["import_state_advanced"] is True
        assert imported["submitted_rows"] == imported["imported_rows"] == 60
        assert imported["imported_symbols"] == 1
        assert imported["rejected_symbols"] == {}
        restored = db.query(StockPrice).filter(StockPrice.symbol == "TEST").all()
        assert len(restored) == 60
        assert all(row.adj_close is None and row.close == 101.0 for row in restored)
