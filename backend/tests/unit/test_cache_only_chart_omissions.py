"""Opt-in diagnostics observe existing cache/chart decisions without I/O changes."""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
import socket

import pandas as pd
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.stock import StockPrice
from app.services.price_cache_service import PriceCacheService
from app.services.static_site_export_service import StaticSiteExportService
import app.services.static_site_export_service as export_module


@pytest.fixture
def cached_prices(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    StockPrice.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    redis = Mock()
    service = PriceCacheService(redis_client=redis, session_factory=factory)
    queries = []

    @event.listens_for(engine, "before_cursor_execute")
    def record_query(_conn, _cursor, statement, parameters, _context, _many):
        queries.append((statement, parameters))

    def forbidden(*_args, **_kwargs):
        pytest.fail("Cache-only diagnostics attempted external I/O or a cache write")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    for name in (
        "_fetch_direct_historical_data", "_fetch_full_and_cache",
        "_store_recent_in_redis", "_store_in_database", "store_batch_in_cache",
    ):
        monkeypatch.setattr(service, name, forbidden)

    def seed(symbol, count, *, invalid=False, age=0, close=100.0):
        end = date.today() - timedelta(days=age)
        with factory() as db:
            db.add_all([
                StockPrice(
                    symbol=symbol, date=end - timedelta(days=count - index - 1),
                    open=close, high=close - 1 if invalid else close + 1,
                    low=close - 1, close=close, volume=1000,
                )
                for index in range(count)
            ])
            db.commit()

    yield SimpleNamespace(service=service, seed=seed, queries=queries, engine=engine,
                          factory=factory, redis=redis)
    redis.assert_not_called()
    assert not redis.mock_calls
    engine.dispose()


@pytest.mark.parametrize(
    "count,invalid,reason",
    [(0, False, "no_rows_in_window"), (49, False, "insufficient_rows"),
     (50, False, None), (60, False, None), (50, True, "incoherent_history")],
)
def test_cache_reasons_preserve_results_queries_and_50_row_boundary(
    cached_prices, count, invalid, reason,
):
    cache = cached_prices
    cache.seed("TEST", count, invalid=invalid)
    cache.queries.clear()
    plain = cache.service.get_many_cached_only(["TEST"])
    plain_queries = list(cache.queries)
    cache.queries.clear()
    reasons = {"TEST": "previous_failure", "UNRELATED": "untouched"}
    observed = cache.service.get_many_cached_only(["TEST"], miss_reasons=reasons)

    assert cache.queries == plain_queries
    assert len(cache.queries) == 1
    assert observed.keys() == plain.keys() == {"TEST"}
    assert reasons == {"UNRELATED": "untouched", **({"TEST": reason} if reason else {})}
    if reason:
        assert observed["TEST"] is plain["TEST"] is None
    else:
        pd.testing.assert_frame_equal(observed["TEST"], plain["TEST"])
        assert len(observed["TEST"]) == count


@pytest.mark.parametrize("period,missing", [("1y", True), ("2y", False), ("unknown", False)])
def test_no_rows_reason_means_requested_window_not_absence_from_database(cached_prices, period, missing):
    cache = cached_prices
    cache.seed("OLD", 50, age=500)
    reasons = {}
    result = cache.service.get_many_cached_only(["OLD"], period=period, miss_reasons=reasons)
    assert (result["OLD"] is None) is missing
    assert reasons == ({"OLD": "no_rows_in_window"} if missing else {})


@pytest.mark.parametrize("failed_chunk", [2, 3])
def test_later_chunk_failure_overwrites_all_reasons_like_existing_all_none_result(
    cached_prices, monkeypatch, failed_chunk,
):
    cache = cached_prices
    cache.seed("HIT", 50)
    cache.seed("SHORT", 49)
    monkeypatch.setattr(settings, "price_cache_db_chunk_size", 1)
    count = 0

    @event.listens_for(cache.engine, "before_cursor_execute")
    def fail_later_query(*_args):
        nonlocal count
        count += 1
        if count == failed_chunk:
            raise SQLAlchemyError("simulated local read failure")

    symbols = ["HIT", "SHORT", "UNREAD"]
    plain = cache.service.get_many_cached_only(symbols)
    assert count == failed_chunk
    count = 0
    reasons = {"HIT": "stale", "UNRELATED": "untouched"}
    observed = cache.service.get_many_cached_only(symbols, miss_reasons=reasons)
    assert count == failed_chunk
    assert observed == plain == dict.fromkeys(symbols)
    assert reasons == {**dict.fromkeys(symbols, "bulk_read_error"), "UNRELATED": "untouched"}


def test_empty_input_never_opens_session(cached_prices, monkeypatch):
    factory = Mock(side_effect=AssertionError("unexpected session"))
    monkeypatch.setattr(cached_prices.service, "_session_factory", factory)
    reasons = {"UNRELATED": "untouched"}
    assert cached_prices.service.get_many_cached_only([], miss_reasons=reasons) == {}
    assert reasons == {"UNRELATED": "untouched"}
    factory.assert_not_called()


def test_default_path_preserves_existing_database_call_signature(cached_prices, monkeypatch):
    read = Mock(return_value={"MISSING": (None, None)})
    monkeypatch.setattr(cached_prices.service, "_get_many_from_database", read)
    assert cached_prices.service.get_many_cached_only(["MISSING"], "5y") == {"MISSING": None}
    read.assert_called_once_with(["MISSING"], "5y")


@pytest.mark.parametrize("failure_stage", ["benchmark", "directory"])
def test_chart_attempt_clears_previous_reasons_even_when_setup_fails(
    cached_prices, monkeypatch, tmp_path, failure_stage,
):
    omissions = {"US": {"OLD": "insufficient_rows"}, "HK": {"OTHER": "no_rows_in_window"}}
    monkeypatch.setattr(export_module, "get_price_cache", lambda: cached_prices.service)
    monkeypatch.setattr(export_module, "get_fundamentals_cache", lambda: Mock())
    monkeypatch.setattr(export_module, "get_benchmark_cache", lambda: Mock())
    service = StaticSiteExportService(cached_prices.factory, chart_omissions=omissions)
    failure = RuntimeError("simulated local setup failure")

    def fail(*_args, **_kwargs):
        raise failure

    if failure_stage == "benchmark":
        monkeypatch.setattr(service, "_get_market_benchmark_history", fail)
    else:
        monkeypatch.setattr(type(tmp_path), "mkdir", fail)
    run = SimpleNamespace(config_json={"universe": {"market": "US"}}, as_of_date=date.today())
    with pytest.raises(RuntimeError) as raised:
        service._export_chart_bundle(output_dir=tmp_path, generated_at="2026-10-14T00:00:00Z", run=run, rows=[])
    assert raised.value is failure
    assert omissions == {"US": {}, "HK": {"OTHER": "no_rows_in_window"}}


def test_chart_diagnostics_cover_all_passes_without_changing_any_published_bytes(
    cached_prices, monkeypatch, tmp_path,
):
    cache = cached_prices
    for symbol in ("PRIMARY_OK", "PRESET_OK", "GROUP_OK", "COVERAGE_OK"):
        cache.seed(symbol, 50)
    cache.seed("PRESET_MISS", 49)
    cache.seed("GROUP_MISS", 50, invalid=True)
    cache.seed("SERIALIZE_MISS", 50, close=77.0)
    monkeypatch.setattr(export_module, "STATIC_CHART_LIMIT", 1)
    monkeypatch.setattr(export_module, "STATIC_CHART_LOOKUP_BATCH_SIZE", 1)
    monkeypatch.setattr(export_module, "get_preset_chart_symbols", lambda *_args: {"PRESET_MISS", "PRESET_OK"})
    monkeypatch.setattr(export_module, "get_price_cache", lambda: cache.service)
    fundamentals = Mock()
    fundamentals.get_many_cached_only.side_effect = lambda symbols: dict.fromkeys(symbols)
    monkeypatch.setattr(export_module, "get_fundamentals_cache", lambda: fundamentals)
    monkeypatch.setattr(export_module, "get_benchmark_cache", lambda: Mock())
    rows = [SimpleNamespace(symbol=symbol) for symbol in (
        "PRIMARY_MISS", "PRIMARY_OK", "COVERAGE_MISS", "COVERAGE_OK", "SERIALIZE_MISS",
    )]
    run = SimpleNamespace(config_json={"universe": {"market": "US"}}, as_of_date=date.today())
    groups = {"available": True, "payload": {"group_details": {"group": {
        "current_rank": 1, "stocks": [{"symbol": "GROUP_MISS"}, {"symbol": "GROUP_OK"}],
    }}}}
    omissions = {"US": {"STALE": "previous_run"}, "HK": {"UNCHANGED": "no_rows_in_window"}}

    def export(destination, sink):
        service = StaticSiteExportService(cache.factory, chart_omissions=sink)
        monkeypatch.setattr(service, "_get_market_benchmark_history", lambda *_a, **_k: ("SPY", pd.DataFrame()))
        monkeypatch.setattr(service, "_serialize_scan_row", lambda row: {"symbol": row.symbol})
        # Keep this test focused on chart selection/serialization, without the
        # optional drawing engines or financial-source lookups.
        for name, result in (
            ("_serialize_rs_line", ([], [])), ("_compute_buy_points", []),
            ("_compute_chart_bands", {}), ("_compute_m360_signals", {}),
            ("_compute_trend_template", {}), ("_compute_vcp_boxes", []),
            ("_compute_eps_line", []),
        ):
            monkeypatch.setattr(service, name, lambda *_a, _result=result, **_k: _result.copy() if isinstance(_result, dict) else _result)
        serialize = service._serialize_chart_bars
        monkeypatch.setattr(service, "_serialize_chart_bars", lambda frame:
                            [] if frame is not None and frame["Close"].iloc[0] == 77.0 else serialize(frame))
        return service._export_chart_bundle(
            output_dir=destination, generated_at="2026-10-14T00:00:00Z", run=run, rows=rows,
            serialized_rows=[{"symbol": row.symbol} for row in rows], groups_payload=groups,
        )

    cache.queries.clear()
    plain = export(tmp_path / "plain", None)
    plain_queries = list(cache.queries)
    plain_fundamental_calls = list(fundamentals.mock_calls)
    cache.queries.clear()
    fundamentals.reset_mock()
    observed = export(tmp_path / "observed", omissions)

    assert observed == plain
    assert cache.queries == plain_queries
    assert fundamentals.mock_calls == plain_fundamental_calls
    assert omissions == {"US": {
        "PRIMARY_MISS": "no_rows_in_window", "PRESET_MISS": "insufficient_rows",
        "GROUP_MISS": "incoherent_history", "COVERAGE_MISS": "no_rows_in_window",
        "SERIALIZE_MISS": "no_serializable_bars",
    }, "HK": {"UNCHANGED": "no_rows_in_window"}}
    assert set(plain["skipped_symbols"]) == set(omissions["US"])
    assert plain["symbols_total"] == 4
    files = lambda root: {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*.json")}
    assert files(tmp_path / "plain") == files(tmp_path / "observed")
