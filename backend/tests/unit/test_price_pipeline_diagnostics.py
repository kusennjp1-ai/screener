"""Offline stage observations cannot change persistence or chart decisions."""

from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
import json
import socket

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine, event, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.models.stock import StockPrice
from app.models.app_settings import AppSetting
from app.services.cache.price_history_diagnostics import new_observations, observed_coherent_batch
from app.services.cache.price_history_integrity import coherent_history, _coherent_history_decision
from app.services.daily_price_bundle_service import DailyPriceBundleService
from app.services.price_cache_service import PriceCacheService
from app.services.static_daily_price_refresh_service import StaticDailyPriceRefreshService
from app.services.static_site_export_service import StaticSiteExportService
import app.services.price_cache_service as cache_module
import app.services.static_site_export_service as export_module


def prices(dates, closes=None):
    closes = [1.] * len(dates) if closes is None else closes
    return pd.DataFrame({
        "Open": closes, "Close": closes, "High": np.asarray(closes) * 1.01,
        "Low": np.asarray(closes) * .99, "Volume": 1000,
    }, index=pd.DatetimeIndex(dates, name="Date"))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Price diagnostic test attempted external I/O")
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)


@pytest.fixture
def cache_factory():
    engines = []
    def build():
        engine = create_engine("sqlite:///:memory:")
        engines.append(engine)
        StockPrice.__table__.create(engine)
        AppSetting.__table__.create(engine)
        factory = sessionmaker(bind=engine)
        cache = PriceCacheService(redis_client=Mock(), session_factory=factory)
        cache._redis_client = None
        return SimpleNamespace(engine=engine, factory=factory, cache=cache)
    yield build
    for engine in engines:
        engine.dispose()


@pytest.mark.parametrize("ratio,accepted", [
    (.55, False), (np.nextafter(.55, 0), False), (np.nextafter(.55, 1), True),
    (1.8, False), (np.nextafter(1.8, 1), True), (np.nextafter(1.8, 2), False),
])
def test_strict_price_ratio_boundaries_are_identical(ratio, accepted):
    frame = prices(pd.date_range("2026-10-01", periods=2), [1., ratio])
    before = frame.copy(deep=True)
    trace = new_observations("US", "ratio")
    observed = observed_coherent_batch({"A": frame}, trace, "db_prepare")
    assert coherent_history(frame) is accepted
    assert bool(observed) is accepted
    assert _coherent_history_decision(frame) == (
        accepted, None if accepted else "price_discontinuity",
    )
    pd.testing.assert_frame_equal(frame, before)


@pytest.mark.parametrize("broken_observer", [False, True])
def test_predicate_exception_identity_is_not_changed(monkeypatch, broken_observer):
    failure = ValueError("injected numeric conversion failure")
    def fail(*_args, **_kwargs):
        raise failure
    monkeypatch.setattr(np, "isfinite", fail)
    trace = new_observations("US", "exception")
    if broken_observer:
        trace["events"] = SimpleNamespace(append=Mock(side_effect=OSError("diagnostic unavailable")))
    frame = prices(pd.date_range("2026-10-01", periods=2))
    for call in [lambda: coherent_history(frame),
                 lambda: observed_coherent_batch({"A": frame}, trace, "db_prepare")]:
        with pytest.raises(ValueError) as raised:
            call()
        assert raised.value is failure


def test_redis_return_count_is_not_db_commit_count(cache_factory):
    outcomes = []
    for enabled in [False, True]:
        local = cache_factory()
        trace = new_observations("US", "commit") if enabled else None
        frame = prices(pd.date_range("2026-09-01", periods=50))
        result = local.cache.store_batch_in_cache(
            {"A": frame}, **({"observations": trace} if enabled else {}),
        )
        with local.factory() as db:
            count = db.query(func.count(StockPrice.id)).scalar()
        outcomes.append((result, count))
        if enabled:
            assert [e["committed_rows"] for e in trace["events"]
                    if e["stage"] == "db_commit" and e["status"] == "committed"] == [50]
    assert outcomes == [(0, 50), (0, 50)]


@pytest.mark.parametrize("failure_stage", ["second_insert", "commit"])
def test_transaction_rollback_preserves_no_partial_rows(cache_factory, failure_stage):
    outcomes = []
    for enabled in [False, True]:
        local = cache_factory()
        trace = new_observations("US", "rollback") if enabled else None
        inserts = 0
        def fail_insert(_conn, _cursor, statement, _parameters, _context, _many):
            nonlocal inserts
            if statement.startswith("INSERT"):
                inserts += 1
                if failure_stage == "second_insert" and inserts == 2:
                    raise SQLAlchemyError("PRIVATE_FAILURE_TEXT")
        event.listen(local.engine, "before_cursor_execute", fail_insert)
        if failure_stage == "commit":
            event.listen(local.factory, "before_commit",
                         lambda _session: (_ for _ in ()).throw(SQLAlchemyError("PRIVATE_FAILURE_TEXT")))
        frame = prices(pd.date_range("2026-01-01", periods=250))
        result = local.cache._store_batch_in_database(
            {"A": frame}, **({"observations": trace} if enabled else {}),
        )
        with local.factory() as db:
            count = db.query(func.count(StockPrice.id)).scalar()
        outcomes.append((result, count))
        if enabled:
            assert any(e["stage"] == "db_rollback" and e["status"] == "returned" for e in trace["events"])
            assert next(e for e in trace["events"] if e["stage"]=="db_commit" and e["status"]=="failed")["committed_rows"] is None
            assert not any(e.get("status") == "committed" for e in trace["events"])
            assert "PRIVATE_FAILURE_TEXT" not in json.dumps(trace)
    assert outcomes == [(None, 0), (None, 0)]


@pytest.mark.parametrize("failure_stage", ["session", "rollback", "close"])
def test_database_boundary_exceptions_keep_original_identity(failure_stage):
    failure = RuntimeError("original boundary exception")
    frame = prices(pd.date_range("2026-10-01", periods=2))
    for enabled in (False, True):
        db = Mock()
        factory = Mock(return_value=db)
        if failure_stage == "session":
            factory.side_effect = failure
        else:
            db.query.side_effect = ValueError("initial database write failure")
            if failure_stage == "rollback":
                db.rollback.side_effect = failure
            else:
                db.close.side_effect = failure
        cache = PriceCacheService(redis_client=Mock(), session_factory=factory)
        trace = new_observations("US", "boundary") if enabled else None
        with pytest.raises(RuntimeError) as raised:
            cache._store_batch_in_database(
                {"A": frame}, **({"observations": trace} if enabled else {}),
            )
        assert raised.value is failure
        if enabled:
            assert any(e["stage"] == f"db_{failure_stage}" and e["status"] == "raised"
                       for e in trace["events"])
            assert not any(e.get("status") == "committed" for e in trace["events"])


def test_later_seed_batch_exception_keeps_earlier_commit_and_same_exception(cache_factory, tmp_path):
    payload = {"schema_version":"daily-price-bundle-v1", "market":"US",
               "as_of_date":"2026-10-16", "bar_period":"2y", "source_revision":"fixed-seed",
               "symbol_count":201, "rows":[
        {"symbol":f"S{i:03}", "prices":[{"date":"2026-10-16","open":1.,"high":1.01,
                                      "low":.99,"close":1.,"adj_close":1.,"volume":1000}]}
        for i in range(201)]}
    path = tmp_path / "fixed-seed.json"
    path.write_text(json.dumps(payload))
    counts = []
    failure = RuntimeError("injected second seed batch failure")
    for enabled in [False, True]:
        local = cache_factory()
        service = DailyPriceBundleService(price_cache=local.cache)
        store = local.cache._store_batch_in_database
        calls = 0
        def interrupted(batch, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise failure
            return store(batch, **kwargs)
        local.cache._store_batch_in_database = interrupted
        trace = new_observations("US", "seed") if enabled else None
        with local.factory() as db, pytest.raises(RuntimeError) as raised:
            service.import_daily_price_bundle(db, input_path=path, warm_redis_symbols=0,
                                             **({"observations":trace} if enabled else {}))
        assert raised.value is failure
        with local.factory() as db:
            counts.append(db.query(func.count(StockPrice.id)).scalar())
        assert calls == 2
        if enabled:
            assert len(trace["input"]["sha256"]) == 64
            assert trace["input"]["download_hash_verified"] is False
            assert [e["committed_rows"] for e in trace["events"] if e.get("status")=="committed"] == [100]
            assert next(e for e in trace["events"] if e["stage"]=="seed_batch" and e["status"]=="raised")["unattempted_batches"] == 1
    assert counts == [100, 100]


def test_swallowed_middle_seed_rollback_keeps_input_counts_distinct_from_commits(cache_factory, tmp_path):
    payload = {"schema_version":"daily-price-bundle-v1","market":"US","as_of_date":"2026-10-16",
               "bar_period":"2y","source_revision":"fixed-seed","symbol_count":201,"rows":[
        {"symbol":f"S{i:03}","prices":[{"date":"2026-10-16","open":1.,"high":1.01,
                                     "low":.99,"close":1.,"adj_close":1.,"volume":1000}]}
        for i in range(201)]}
    path = tmp_path/"seed.json"; path.write_text(json.dumps(payload))
    outcomes = []
    for enabled in [False, True]:
        local = cache_factory()
        service = DailyPriceBundleService(price_cache=local.cache)
        store = local.cache._store_batch_in_database
        calls = 0
        def fail_commit(_session):
            raise SQLAlchemyError("injected middle batch rollback")
        def interrupted(batch, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                event.listen(local.factory, "before_commit", fail_commit)
                try:
                    return store(batch, **kwargs)
                finally:
                    event.remove(local.factory, "before_commit", fail_commit)
            return store(batch, **kwargs)
        local.cache._store_batch_in_database = interrupted
        trace = new_observations("US", "seed") if enabled else None
        with local.factory() as db:
            stats = service.import_daily_price_bundle(
                db,input_path=path,warm_redis_symbols=0,
                **({"observations":trace} if enabled else {}),
            )
        with local.factory() as db:
            persisted = db.query(func.count(StockPrice.id)).scalar()
        outcomes.append((stats["imported_rows"],stats["imported_symbols"],persisted,calls))
        if enabled:
            assert sum(e["committed_rows"] for e in trace["events"] if e.get("status")=="committed") == 101
            assert sum(e["stage"]=="db_rollback" for e in trace["events"]) == 1
    assert outcomes == [(201,201,101,3),(201,201,101,3)]


def test_up_to_date_sync_metadata_is_not_a_reverified_download():
    result = {"status":"up_to_date","manifest":{
        "market":"US","as_of_date":"2026-10-16","source_revision":"fixed-seed",
        "sha256":"a"*64,"bar_period":"2y","symbol_count":1,
    }}
    outcomes = []
    for enabled in [False,True]:
        service = DailyPriceBundleService(price_cache=Mock())
        service.get_import_state = Mock(return_value={})
        service.import_daily_price_bundle = Mock(side_effect=AssertionError("unexpected import"))
        github = Mock()
        github.fetch_latest_bundle.return_value = dict(result)
        trace = new_observations("US","up-to-date") if enabled else None
        outcomes.append(service.sync_from_github(
            Mock(),market="US",github_sync_service=github,
            **({"observations":trace} if enabled else {}),
        ))
        service.import_daily_price_bundle.assert_not_called()
        if enabled:
            assert trace["input"]["hash_basis"] == "manifest_metadata"
            assert trace["input"]["download_hash_verified"] is False
    assert outcomes[0] == outcomes[1]


@pytest.mark.parametrize("include_end,expected_count", [(False, 49), (True, 50)])
def test_730_day_window_and_49_50_read_boundary(cache_factory, monkeypatch, include_end, expected_count):
    local = cache_factory()
    end = date(2026, 10, 20)
    start = end - timedelta(days=730)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 20, 12)
    monkeypatch.setattr(cache_module, "datetime", Clock)
    dates = [start-timedelta(days=1), start]
    dates += [end-timedelta(days=i) for i in range(48, 0, -1)]
    if include_end:
        dates.append(end)
    dates.append(end+timedelta(days=1))
    local.cache._store_batch_in_database({"A":prices(dates)})
    queries = []
    event.listen(local.engine, "before_cursor_execute",
                 lambda _c,_u,statement,parameters,_x,_m: queries.append((statement,parameters)))
    plain = local.cache.get_many_cached_only(["A"])
    first_queries = list(queries); queries.clear()
    trace = new_observations("US", "window")
    observed = local.cache.get_many_cached_only(["A"], observations=trace)
    assert queries == first_queries
    if expected_count == 49:
        assert plain["A"] is observed["A"] is None
    else:
        pd.testing.assert_frame_equal(plain["A"], observed["A"])
    observation = next(e for e in trace["events"] if e["stage"]=="cache_read")
    assert observation["row_count"] == expected_count
    assert observation["min_date"] == start.isoformat()
    assert observation["start_date"] == start.isoformat()
    assert observation["end_date"] == end.isoformat()


@pytest.mark.parametrize("timezone", [None, "UTC", "America/New_York"])
def test_snapshot_and_exact_450_day_display_boundary_reuse_same_cutoff(monkeypatch, timezone):
    now = pd.Timestamp("2026-10-20T12:34:56Z")
    cutoff = now - pd.Timedelta(days=450)
    indexes = [cutoff-pd.Timedelta(microseconds=1), cutoff, cutoff+pd.Timedelta(microseconds=1),
               pd.Timestamp("2026-10-16T00:00:00Z"), pd.Timestamp("2026-10-17T12:00:00Z")]
    index = pd.DatetimeIndex(indexes)
    index = index.tz_localize(None) if timezone is None else index.tz_convert(timezone)
    data = prices(index)
    before = data.copy(deep=True)
    clock = Mock(return_value=now)
    monkeypatch.setattr(export_module, "pd", SimpleNamespace(
        Timestamp=SimpleNamespace(now=clock), Timedelta=pd.Timedelta,
    ))
    service = StaticSiteExportService.__new__(StaticSiteExportService)
    bounded = service._chart_history_through(data, date(2026,10,16))
    assert len(bounded) == 4
    plain = service._serialize_chart_bars(bounded)
    trace = new_observations("US", "display")
    observed = service._serialize_chart_bars(bounded, observations=trace)
    assert observed == plain and len(plain) == 3
    assert clock.call_count == 2  # once per real serialization, no diagnostic reread
    assert trace["events"][0]["row_count"] == 3
    pd.testing.assert_frame_equal(data, before)


def test_refresh_fetch_result_and_error_classifier_are_observational():
    frame = prices(pd.date_range("2026-10-01", periods=2))
    response = {"OK":{"has_error":False,"price_data":frame},
                "RATE":{"has_error":True,"error":"429 too many requests"},
                "NONE":{"has_error":True,"error":"no price data"}}
    calls = []
    for enabled in [False, True]:
        fetcher = Mock()
        fetcher.fetch_prices_in_batches.return_value = response
        cache = Mock()
        trace = new_observations("US", "fetch") if enabled else None
        service = StaticDailyPriceRefreshService(
            session_factory=Mock(),price_cache=cache,fetcher=fetcher,observations=trace,
        )
        result = service._fetch_and_store(["OK","RATE","NONE","MISSING"],
                                          period="2y",batch_size=4,market="US")
        calls.append((result, fetcher.mock_calls))
        assert cache.store_batch_in_cache.call_args.args[0] == {"OK":frame}
        if enabled:
            kinds = {e["symbol"]:e.get("failure_kind") for e in trace["events"]}
            assert kinds["RATE"] == "rate_limit"
            assert kinds["NONE"] == "no_price_data"
            assert kinds["MISSING"] == "transient"
    assert calls[0] == calls[1]
