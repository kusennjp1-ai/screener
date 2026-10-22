from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
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
from app.services.price_cache_service import PriceCacheService
from app.services.cache.price_history_diagnostics import new_observations


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
        _store_batch_in_database=MagicMock(),
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
    price_cache._store_batch_in_database.assert_called_once()
    price_cache.store_batch_in_cache.assert_not_called()
    db.close()



_AUTHENTIC_PRICE_SAMPLES = {
    "run513_aa": (
        "e267a190da2856e4e262f34c7e6a1529faf8aa141f4b8952659c0348b49d5032",
        "5a766e59a2312c1a5cafab19102986f88ec78e23d8e7f1f042420331048c8606",
        "daily_prices_us:20261021040119",
    ),
    "run517_eog_invalid": (
        "35e4c8ecf97e9346aa7a2cccb5990c9477dbd05a81643b8d5b56f698386fad0f",
        "d287958656f8a1dd85e0fbf64ec997ebf384d549a21713bc448e017e260fbde7",
        "daily_prices_us:20261021001336",
    ),
}


def _authentic_price_sample(name):
    path = Path(__file__).parents[1] / "fixtures" / f"daily_price_{name}_sample.json"
    content = path.read_bytes()
    fixture_sha, source_sha, revision = _AUTHENTIC_PRICE_SAMPLES[name]
    assert hashlib.sha256(content).hexdigest() == fixture_sha
    fixture = json.loads(content)
    assert fixture["provenance"]["source_bundle_sha256"] == source_sha
    assert fixture["provenance"]["source_as_of_date"] == "2026-10-20"
    assert fixture["provenance"]["source_revision"] == revision
    bundle = fixture["bundle"]
    assert bundle["source_revision"] == revision
    assert bundle["as_of_date"] == bundle["rows"][0]["prices"][-1]["date"] == "2026-10-20"
    assert bundle["market"] == "US" and bundle["bar_period"] == "2y"
    assert bundle["symbol_count"] == len(bundle["rows"]) == 1
    assert len(bundle["rows"][0]["prices"]) == 3
    return bundle


class _ForbiddenRedis:
    """No network cache is needed for these real database persistence tests."""
    def __getattr__(self, name):
        raise AssertionError(f"Unexpected Redis access: {name}")


@pytest.fixture
def persistence_bundle_database(tmp_path):
    # File-backed SQLite plus an independent read engine verifies committed
    # rows, not merely an ORM identity map or a shared in-memory connection.
    url = f"sqlite:///{tmp_path / 'price-import.sqlite'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine, tables=[StockPrice.__table__, AppSetting.__table__])
    sessions = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    service = DailyPriceBundleService(price_cache=PriceCacheService(
        redis_client=_ForbiddenRedis(), session_factory=sessions,
    ))
    try:
        yield url, engine, sessions, service
    finally:
        engine.dispose()


def _committed_prices(url):
    reader_engine = create_engine(url)
    try:
        with sessionmaker(bind=reader_engine)() as db:
            rows = db.query(StockPrice).order_by(StockPrice.symbol, StockPrice.date).all()
            prices = [dict(symbol=row.symbol, date=row.date.isoformat(), open=row.open,
                           high=row.high, low=row.low, close=row.close,
                           adj_close=row.adj_close, volume=row.volume) for row in rows]
            ids = [row.id for row in rows]
            state = db.query(AppSetting).filter(
                AppSetting.key == DailyPriceBundleService.sync_state_key("US")
            ).first()
            return prices, ids, json.loads(state.value) if state else None
    finally:
        reader_engine.dispose()


def _import_authentic_sample(tmp_path, sessions, service, name):
    bundle = _authentic_price_sample(name)
    before = json.dumps(bundle, sort_keys=True)
    path = tmp_path / f"{name}.json"
    path.write_text(before, encoding="utf-8")
    observations = new_observations("US", run_id="importer-persistence-test")
    with sessions() as db:
        result = service.import_daily_price_bundle(
            db, input_path=path, warm_redis_symbols=0, observations=observations,
        )
    assert path.read_text(encoding="utf-8") == before
    assert json.dumps(_authentic_price_sample(name), sort_keys=True) == before
    assert observations["input"]["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    # The small derived fixture is not the original full downloaded bundle.
    assert observations["input"]["download_hash_verified"] is False
    assert observations["input"]["as_of_date"] == bundle["as_of_date"]
    assert observations["input"]["source_revision"] == bundle["source_revision"]
    return bundle, result, observations["events"]


def test_import_authentic_run513_commits_exact_prices_and_idempotent_upserts(
    tmp_path, persistence_bundle_database,
):
    url, _, sessions, service = persistence_bundle_database
    bundle, result, events = _import_authentic_sample(tmp_path, sessions, service, "run513_aa")
    expected = [dict(symbol="AA", **bar) for bar in bundle["rows"][0]["prices"]]
    actual, row_ids, state = _committed_prices(url)
    assert actual == expected
    assert len(row_ids) == len(set(row_ids)) == 3
    assert state["source_revision"] == bundle["source_revision"]
    assert state["as_of_date"] == "2026-10-20" and state["bar_period"] == "2y"
    assert result["redis_warmed_symbols"] == 0
    assert any(event["stage"] == "db_commit" and event["status"] == "committed"
               and event["committed_rows"] == 3 and event["insert_rows"] == 3 for event in events)

    _, _, replay_events = _import_authentic_sample(tmp_path, sessions, service, "run513_aa")
    replayed, replayed_ids, _ = _committed_prices(url)
    assert replayed == expected and replayed_ids == row_ids
    assert any(event["stage"] == "db_commit" and event["status"] == "committed"
               and event["update_rows"] == 3 and event["insert_rows"] == 0 for event in replay_events)


def test_import_authentic_invalid_eog_rejects_whole_history_without_partial_rows(
    tmp_path, persistence_bundle_database,
):
    url, _, sessions, service = persistence_bundle_database
    _import_authentic_sample(tmp_path, sessions, service, "run513_aa")
    before, before_ids, _ = _committed_prices(url)
    bundle, _, events = _import_authentic_sample(tmp_path, sessions, service, "run517_eog_invalid")
    last_bar = bundle["rows"][0]["prices"][-1]
    assert last_bar["open"] > last_bar["high"]  # Genuine source defect, not an edited price.
    actual, actual_ids, _ = _committed_prices(url)
    assert actual == before and actual_ids == before_ids
    assert not any(row["symbol"] == "EOG" for row in actual)
    assert any(event["stage"] == "db_prepare" and event["symbol"] == "EOG"
               and event["status"] == "rejected" and event["rejection"] == "invalid_ohlcv"
               for event in events)
    assert any(event["stage"] == "db_commit" and event["status"] == "not_attempted_no_coherent_history"
               for event in events)


def test_import_real_sqlite_failure_rolls_back_preceding_inserts(
    tmp_path, persistence_bundle_database,
):
    url, engine, sessions, service = persistence_bundle_database
    first = _authentic_price_sample("run513_aa")["rows"][0]["prices"][0]
    with sessions() as db:
        db.add(StockPrice(symbol="AA", **{
            **first, "date": date.fromisoformat(first["date"]),
        }))
        db.commit()
    before, before_ids, _ = _committed_prices(url)
    # A real database constraint fails on the final authentic row. Earlier
    # inserts in the same mixed insert/update batch must roll back, while the
    # previously committed row survives. The writer itself is not mocked.
    with engine.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TRIGGER reject_final_sample_bar BEFORE INSERT ON stock_prices
            WHEN NEW.symbol = 'AA' AND NEW.date = '2026-10-20'
            BEGIN SELECT RAISE(ABORT, 'intentional persistence regression test'); END
        """)
    _, _, events = _import_authentic_sample(tmp_path, sessions, service, "run513_aa")
    actual, row_ids, _ = _committed_prices(url)
    assert actual == before and row_ids == before_ids and len(actual) == 1
    assert any(event["stage"] == "db_commit" and event["status"] == "failed"
               and event["exception_type"] == "IntegrityError" for event in events)
    assert any(event["stage"] == "db_rollback" and event["status"] == "returned" for event in events)
    # Import counters and sync metadata are not commit evidence: the existing
    # writer swallows this write failure after rollback. Readback is decisive.
