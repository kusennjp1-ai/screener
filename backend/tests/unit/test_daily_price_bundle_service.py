from __future__ import annotations

import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.app_settings import AppSetting
from app.models.stock import StockPrice
from app.models.stock_universe import StockUniverse, UNIVERSE_STATUS_ACTIVE
from app.services.daily_price_bundle_service import DailyPriceBundleService
from app.services.price_cache_service import PriceCacheService, PricePersistenceReceipt


@pytest.fixture(autouse=True)
def _disable_receipt_test_redis(monkeypatch):
    monkeypatch.setattr("app.services.price_cache_service.get_redis_client", lambda: None)


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)


def _stock_row(symbol: str, market: str, exchange: str, market_cap: float) -> StockUniverse:
    return StockUniverse(
        symbol=symbol,
        market=market,
        exchange=exchange,
        is_active=True,
        status=UNIVERSE_STATUS_ACTIVE,
        status_reason="active",
        market_cap=market_cap,
    )


def _price_row(symbol: str, day: date, close: float) -> StockPrice:
    return StockPrice(
        symbol=symbol,
        date=day,
        open=close - 1,
        high=close + 1,
        low=close - 2,
        close=close,
        adj_close=close - 0.5,
        volume=1_000_000,
    )


def _make_service(session_factory):
    return DailyPriceBundleService(
        price_cache=PriceCacheService(redis_client=None, session_factory=session_factory),
    )


def test_daily_price_bundle_round_trips_and_preserves_other_market_rows(tmp_path):
    export_session_factory = _make_session()
    export_db = export_session_factory()
    export_db.add_all(
        [
            _stock_row("AAPL", "US", "NASDAQ", 1000.0),
            _stock_row("MSFT", "US", "NASDAQ", 900.0),
            _stock_row("0700.HK", "HK", "XHKG", 800.0),
            _price_row("AAPL", date(2026, 4, 17), 100.0),
            _price_row("AAPL", date(2026, 4, 18), 101.0),
            _price_row("MSFT", date(2026, 4, 18), 202.0),
            _price_row("0700.HK", date(2026, 4, 18), 300.0),
        ]
    )
    export_db.commit()

    service = _make_service(export_session_factory)
    bundle_path = tmp_path / "daily-price-us-20260418.json.gz"
    manifest_path = tmp_path / "daily-price-latest-us.json"

    export_stats = service.export_daily_price_bundle(
        export_db,
        market="US",
        output_path=bundle_path,
        bundle_asset_name=bundle_path.name,
        latest_manifest_path=manifest_path,
        as_of_date=date(2026, 4, 18),
    )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert export_stats["market"] == "US"
    assert export_stats["bar_period"] == "2y"
    assert export_stats["symbol_count"] == 2
    assert manifest["market"] == "US"
    assert manifest["bar_period"] == "2y"
    assert manifest["symbol_count"] == 2

    import_session_factory = _make_session()
    import_db = import_session_factory()
    import_db.add_all(
        [
            _stock_row("AAPL", "US", "NASDAQ", 1000.0),
            _stock_row("MSFT", "US", "NASDAQ", 900.0),
            _stock_row("0700.HK", "HK", "XHKG", 800.0),
            _price_row("0700.HK", date(2026, 4, 18), 300.0),
        ]
    )
    import_db.commit()

    import_service = _make_service(import_session_factory)
    import_stats = import_service.import_daily_price_bundle(
        import_db,
        input_path=bundle_path,
        warm_redis_symbols=0,
    )

    assert import_stats["market"] == "US"
    assert import_stats["imported_symbols"] == 2
    assert import_stats["imported_rows"] == 3
    assert import_db.query(StockPrice).filter(StockPrice.symbol == "0700.HK").count() == 1
    assert import_db.query(StockPrice).filter(StockPrice.symbol == "AAPL").count() == 2
    assert import_db.query(StockPrice).filter(StockPrice.symbol == "MSFT").count() == 1

    sync_state = import_db.query(AppSetting).filter(
        AppSetting.key == import_service.sync_state_key("US")
    ).one()
    sync_payload = json.loads(sync_state.value)
    assert sync_payload["market"] == "US"
    assert sync_payload["as_of_date"] == "2026-04-18"
    assert sync_payload["bar_period"] == "2y"

    row_count_before = import_db.query(StockPrice).count()
    import_service.import_daily_price_bundle(
        import_db,
        input_path=bundle_path,
        warm_redis_symbols=0,
    )
    assert import_db.query(StockPrice).count() == row_count_before

    export_db.close()
    import_db.close()


def test_export_daily_price_bundle_can_filter_to_shard_symbols(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    db.add_all(
        [
            _stock_row("000001.SZ", "CN", "SZSE", 1000.0),
            _stock_row("000002.SZ", "CN", "SZSE", 900.0),
            _stock_row("600000.SS", "CN", "SSE", 800.0),
            _price_row("000001.SZ", date(2026, 5, 8), 10.0),
            _price_row("000002.SZ", date(2026, 5, 8), 20.0),
            _price_row("600000.SS", date(2026, 5, 8), 30.0),
        ]
    )
    db.commit()

    service = _make_service(session_factory)
    bundle_path = tmp_path / "daily-price-cn-20260508-shard-2-of-2.json.gz"
    manifest_path = tmp_path / "daily-price-cn-20260508-shard-2-of-2.manifest.json"

    stats = service.export_daily_price_bundle(
        db,
        market="CN",
        output_path=bundle_path,
        bundle_asset_name=bundle_path.name,
        latest_manifest_path=manifest_path,
        as_of_date=date(2026, 5, 8),
        symbols=["000002.SZ", "600000.SS"],
    )

    payload = service._read_bundle_payload(bundle_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert stats["market"] == "CN"
    assert stats["symbol_count"] == 2
    assert [row["symbol"] for row in payload["rows"]] == ["000002.SZ", "600000.SS"]
    assert manifest["symbol_count"] == 2

    db.close()


def test_export_daily_price_bundle_can_require_complete_symbol_coverage(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    db.add_all(
        [
            _stock_row("000001.SZ", "CN", "SZSE", 1000.0),
            _stock_row("000002.SZ", "CN", "SZSE", 900.0),
            _price_row("000001.SZ", date(2026, 5, 8), 10.0),
            _price_row("000002.SZ", date(2026, 5, 7), 20.0),
        ]
    )
    db.commit()

    service = _make_service(session_factory)

    with pytest.raises(ValueError, match="Missing 1 CN symbols"):
        service.export_daily_price_bundle(
            db,
            market="CN",
            output_path=tmp_path / "daily-price-cn-20260508.json.gz",
            bundle_asset_name="daily-price-cn-20260508.json.gz",
            latest_manifest_path=tmp_path / "daily-price-latest-cn.json",
            as_of_date=date(2026, 5, 8),
            require_complete=True,
        )

    db.close()


def test_export_daily_price_bundle_can_allow_stale_rows_when_complete_required(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    db.add_all(
        [
            _stock_row("000001.SZ", "CN", "SZSE", 1000.0),
            _stock_row("000004.SZ", "CN", "SZSE", 900.0),
            _price_row("000001.SZ", date(2026, 5, 8), 10.0),
            _price_row("000004.SZ", date(2026, 4, 27), 20.0),
        ]
    )
    db.commit()

    service = _make_service(session_factory)
    bundle_path = tmp_path / "daily-price-cn-20260508.json.gz"

    stats = service.export_daily_price_bundle(
        db,
        market="CN",
        output_path=bundle_path,
        bundle_asset_name=bundle_path.name,
        latest_manifest_path=tmp_path / "daily-price-latest-cn.json",
        as_of_date=date(2026, 5, 8),
        require_complete=True,
        allow_stale_complete=True,
    )

    payload = service._read_bundle_payload(bundle_path)

    assert stats["symbol_count"] == 2
    assert stats["stale_symbol_count"] == 1
    assert [row["symbol"] for row in payload["rows"]] == ["000001.SZ", "000004.SZ"]

    db.close()


def test_export_daily_price_bundle_allows_missing_rows_at_coverage_threshold(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    symbols = [f"00000{index}.SZ" for index in range(10)]
    db.add_all(
        [_stock_row(symbol, "CN", "SZSE", 1000.0 - index) for index, symbol in enumerate(symbols)]
        + [
            _price_row(symbol, date(2026, 5, 8), 10.0 + index)
            for index, symbol in enumerate(symbols[:-1])
        ]
    )
    db.commit()

    service = _make_service(session_factory)
    bundle_path = tmp_path / "daily-price-cn-20260508.json.gz"
    manifest_path = tmp_path / "daily-price-latest-cn.json"

    stats = service.export_daily_price_bundle(
        db,
        market="CN",
        output_path=bundle_path,
        bundle_asset_name=bundle_path.name,
        latest_manifest_path=manifest_path,
        as_of_date=date(2026, 5, 8),
        require_complete=True,
        allow_stale_complete=True,
        min_symbol_coverage=0.9,
    )

    payload = service._read_bundle_payload(bundle_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert stats["symbol_universe_count"] == 10
    assert stats["covered_symbol_count"] == 9
    assert stats["symbol_coverage"] == 0.9
    assert stats["min_symbol_coverage"] == 0.9
    assert payload["symbol_coverage"] == 0.9
    assert manifest["symbol_coverage"] == 0.9

    db.close()


def test_export_daily_price_bundle_fails_below_coverage_threshold(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    symbols = [f"00000{index}.SZ" for index in range(10)]
    db.add_all(
        [_stock_row(symbol, "CN", "SZSE", 1000.0 - index) for index, symbol in enumerate(symbols)]
        + [
            _price_row(symbol, date(2026, 5, 8), 10.0 + index)
            for index, symbol in enumerate(symbols[:8])
        ]
    )
    db.commit()

    service = _make_service(session_factory)

    with pytest.raises(ValueError, match="coverage 80.00% is below required 90.00%"):
        service.export_daily_price_bundle(
            db,
            market="CN",
            output_path=tmp_path / "daily-price-cn-20260508.json.gz",
            bundle_asset_name="daily-price-cn-20260508.json.gz",
            latest_manifest_path=tmp_path / "daily-price-latest-cn.json",
            as_of_date=date(2026, 5, 8),
            require_complete=True,
            allow_stale_complete=True,
            min_symbol_coverage=0.9,
        )

    db.close()


def test_export_daily_price_bundle_rejects_non_finite_coverage_threshold(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    db.add_all(
        [
            _stock_row("000001.SZ", "CN", "SZSE", 1000.0),
            _price_row("000001.SZ", date(2026, 5, 8), 10.0),
        ]
    )
    db.commit()

    service = _make_service(session_factory)

    with pytest.raises(ValueError, match="min_symbol_coverage must be between 0 and 1"):
        service.export_daily_price_bundle(
            db,
            market="CN",
            output_path=tmp_path / "daily-price-cn-20260508.json.gz",
            bundle_asset_name="daily-price-cn-20260508.json.gz",
            latest_manifest_path=tmp_path / "daily-price-latest-cn.json",
            as_of_date=date(2026, 5, 8),
            min_symbol_coverage=float("nan"),
        )

    db.close()


def test_sync_from_github_up_to_date_exposes_manifest_metadata():
    session_factory = _make_session()
    db = session_factory()
    service = _make_service(session_factory)

    result = service.sync_from_github(
        db,
        market="US",
        github_sync_service=SimpleNamespace(
            fetch_latest_bundle=lambda **kwargs: {
                "status": "up_to_date",
                "manifest": {
                    "market": "US",
                    "as_of_date": "2026-04-18",
                    "source_revision": "daily_prices_us:20260418120000",
                    "bundle_asset_name": "daily-price-us-20260418.json.gz",
                    "bar_period": "2y",
                    "symbol_count": 2,
                },
                "bundle_path": None,
                "bundle_asset_name": "daily-price-us-20260418.json.gz",
                "source_revision": "daily_prices_us:20260418120000",
            }
        ),
    )

    assert result["status"] == "up_to_date"
    assert result["as_of_date"] == "2026-04-18"
    assert result["bar_period"] == "2y"
    assert result["symbol_count"] == 2
    db.close()


def test_sync_from_github_passes_allow_stale_to_release_sync_service():
    session_factory = _make_session()
    db = session_factory()
    service = _make_service(session_factory)
    captured_kwargs = {}

    def _fetch_latest_bundle(**kwargs):
        captured_kwargs.update(kwargs)
        return {
            "status": "missing_manifest",
            "manifest": None,
            "bundle_path": None,
            "bundle_asset_name": None,
            "source_revision": None,
        }

    result = service.sync_from_github(
        db,
        market="US",
        allow_stale=True,
        github_sync_service=SimpleNamespace(fetch_latest_bundle=_fetch_latest_bundle),
    )

    assert result["status"] == "missing_manifest"
    assert captured_kwargs["allow_stale"] is True
    db.close()


def test_sync_from_github_rejects_manifest_market_mismatch():
    session_factory = _make_session()
    db = session_factory()
    service = _make_service(session_factory)

    result = service.sync_from_github(
        db,
        market="US",
        github_sync_service=SimpleNamespace(
            fetch_latest_bundle=lambda **kwargs: {
                "status": "up_to_date",
                "manifest": {
                    "market": "HK",
                    "as_of_date": "2026-04-18",
                    "source_revision": "daily_prices_hk:20260418120000",
                    "bundle_asset_name": "daily-price-hk-20260418.json.gz",
                    "bar_period": "2y",
                    "symbol_count": 2,
                },
                "bundle_path": None,
                "bundle_asset_name": "daily-price-hk-20260418.json.gz",
                "source_revision": "daily_prices_hk:20260418120000",
            }
        ),
    )

    assert result["status"] == "invalid_manifest"
    assert "does not match requested market" in str(result["error"])
    db.close()


def test_import_daily_price_bundle_skips_redis_warm_for_two_year_bundle(tmp_path):
    session_factory = _make_session()
    db = session_factory()
    db.add(_stock_row("AAPL", "US", "NASDAQ", 1000.0))
    db.commit()

    price_cache = SimpleNamespace(
        persist_price_batch=MagicMock(return_value=PricePersistenceReceipt(
            submitted_symbols=("AAPL",), accepted_symbols=("AAPL",),
            persisted_symbols=("AAPL",), submitted_rows=1, persisted_rows=1,
        )),
        store_batch_in_cache=MagicMock(return_value=1),
    )
    service = DailyPriceBundleService(price_cache=price_cache)
    bundle_path = tmp_path / "daily-price-us.json"
    bundle_path.write_text(
        json.dumps(
            {
                "schema_version": service.DAILY_PRICE_BUNDLE_SCHEMA_VERSION,
                "market": "US",
                "generated_at": "2026-04-18T12:00:00Z",
                "as_of_date": "2026-04-18",
                "bar_period": service.DAILY_PRICE_BAR_PERIOD,
                "source_revision": "daily_prices_us:20260418120000",
                "symbol_count": 1,
                "rows": [
                    {
                        "symbol": "AAPL",
                        "prices": [
                            {
                                "date": "2026-04-18",
                                "open": 100.0,
                                "high": 101.0,
                                "low": 99.0,
                                "close": 100.5,
                                "adj_close": 100.0,
                                "volume": 1_000_000,
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = service.import_daily_price_bundle(
        db,
        input_path=bundle_path,
        warm_redis_symbols=1,
    )

    assert result["redis_warmed_symbols"] == 0
    price_cache.persist_price_batch.assert_called_once()
    price_cache.store_batch_in_cache.assert_not_called()
    db.close()


def _write_receipt_bundle(tmp_path, service, rows):
    path = tmp_path / "synthetic-price-bundle.json"
    path.write_text(json.dumps({
        "schema_version": service.DAILY_PRICE_BUNDLE_SCHEMA_VERSION,
        "market": "US", "as_of_date": "2026-10-06",
        "bar_period": service.DAILY_PRICE_BAR_PERIOD,
        "source_revision": "synthetic:new", "symbol_count": len(rows), "rows": rows,
    }), encoding="utf-8")
    return path


def _receipt_bundle_row(symbol, *, high=102.0):
    return {"symbol": symbol, "prices": [{
        "date": "2026-10-06", "open": 100.0, "high": high, "low": 99.0,
        "close": 101.0, "adj_close": 101.0, "volume": 1000,
    }]}


def _seed_receipt_import_state(service, db):
    service._upsert_import_state(
        db, market="US", source_revision="synthetic:previous",
        as_of_date="2026-10-05", symbol_count=1, bar_period=service.DAILY_PRICE_BAR_PERIOD,
    )


def test_import_receipt_reports_rejection_without_advancing_source_revision(tmp_path):
    factory = _make_session()
    db = factory()
    service = _make_service(factory)
    _seed_receipt_import_state(service, db)
    path = _write_receipt_bundle(
        tmp_path, service, [_receipt_bundle_row("GOOD"), _receipt_bundle_row("BAD", high=90.0)],
    )
    result = service.import_daily_price_bundle(db, input_path=path, warm_redis_symbols=0)
    assert result["status"] == "partial"
    assert result["submitted_symbols"] == 2
    assert result["submitted_rows"] == 2
    assert result["imported_symbols"] == result["imported_rows"] == 1
    assert result["rejected_symbols"] == {"BAD": "incoherent_history"}
    assert result["target_session_symbols"] == 1
    assert result["missing_target_symbols"] == ["BAD"]
    assert result["import_state_advanced"] is False
    assert service.get_import_state(db, "US")["source_revision"] == "synthetic:previous"
    assert db.query(StockPrice).filter(StockPrice.symbol == "GOOD").count() == 1
    assert db.query(StockPrice).filter(StockPrice.symbol == "BAD").count() == 0
    db.close()


def test_import_receipt_preserves_previous_state_on_commit_rollback(tmp_path):
    factory = _make_session()
    db = factory()
    service = _make_service(factory)
    _seed_receipt_import_state(service, db)
    def failing_factory():
        session = factory()
        session.commit = MagicMock(side_effect=RuntimeError("synthetic commit failure"))
        return session
    service.price_cache = PriceCacheService(redis_client=None, session_factory=failing_factory)
    path = _write_receipt_bundle(
        tmp_path, service, [_receipt_bundle_row("FIRST"), _receipt_bundle_row("SECOND")],
    )
    result = service.import_daily_price_bundle(db, input_path=path, warm_redis_symbols=0)
    assert result["status"] == "partial"
    assert result["accepted_symbols"] == 2
    assert result["imported_symbols"] == result["imported_rows"] == 0
    assert set(result["rejected_symbols"]) == {"FIRST", "SECOND"}
    assert service.get_import_state(db, "US")["source_revision"] == "synthetic:previous"
    assert db.query(StockPrice).count() == 0
    db.close()


def test_import_receipt_rejects_duplicate_normalized_symbols(tmp_path):
    factory = _make_session()
    db = factory()
    service = _make_service(factory)
    _seed_receipt_import_state(service, db)
    path = _write_receipt_bundle(
        tmp_path, service, [_receipt_bundle_row("TEST"), _receipt_bundle_row(" test ")],
    )
    result = service.import_daily_price_bundle(db, input_path=path, warm_redis_symbols=0)
    assert result["submitted_symbols"] == result["submitted_rows"] == 2
    assert result["imported_symbols"] == result["imported_rows"] == 0
    assert result["rejected_symbols"] == {"TEST": "duplicate_bundle_symbol"}
    assert service.get_import_state(db, "US")["source_revision"] == "synthetic:previous"
    assert db.query(StockPrice).count() == 0
    db.close()


def test_import_receipt_reports_committed_earlier_chunk_when_later_chunk_rolls_back(tmp_path):
    factory = _make_session()
    db = factory()
    service = _make_service(factory)
    _seed_receipt_import_state(service, db)
    calls = []
    def second_chunk_fails():
        session = factory()
        calls.append(session)
        if len(calls) == 2:
            session.commit = MagicMock(side_effect=RuntimeError("synthetic later-chunk failure"))
        return session
    service.price_cache = PriceCacheService(redis_client=None, session_factory=second_chunk_fails)
    rows = [_receipt_bundle_row(f"TEST{index:03}") for index in range(101)]
    path = _write_receipt_bundle(tmp_path, service, rows)
    result = service.import_daily_price_bundle(db, input_path=path, warm_redis_symbols=0)
    assert len(calls) == 2
    assert result["status"] == "partial"
    assert result["submitted_symbols"] == result["submitted_rows"] == 101
    assert result["imported_symbols"] == result["imported_rows"] == 100
    assert result["rejected_symbols"] == {"TEST100": "database_write_failed:RuntimeError"}
    assert result["target_session_symbols"] == 100
    assert result["missing_target_symbols"] == ["TEST100"]
    assert service.get_import_state(db, "US")["source_revision"] == "synthetic:previous"
    assert db.query(StockPrice).count() == 100
    db.close()
