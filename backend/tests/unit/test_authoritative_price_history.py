"""Offline regressions for cache authority through real consumer boundaries."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, call

import pandas as pd
import pytest

import app.scanners.data_preparation as preparation_module
import app.services.yfinance_service as yfinance_module
from app.domain.common.errors import DataFetchError
from app.domain.scanning.models import ScanResultItemDomain
from app.scanners.base_screener import DataRequirements
from app.scanners.data_preparation import DataPreparationLayer
from app.scanners.scan_orchestrator import ScanOrchestrator
from app.services.benchmark_cache_service import BenchmarkCacheService
from app.services.cache.price_history_integrity import coherent_history
from app.services.price_cache_service import PriceCacheService
from app.services.static_site_export_service import StaticSiteExportService
from app.services.yfinance_service import YFinanceService

# Unit conftest replaces these methods for unrelated scanner tests. Keep the
# production methods so these regressions exercise the actual preparation flow.
_PREPARE_DATA = DataPreparationLayer.prepare_data
_PREPARE_DATA_BULK = DataPreparationLayer.prepare_data_bulk


@pytest.fixture(autouse=True)
def real_preparation_without_network(monkeypatch, _stub_external_data):
    monkeypatch.setattr(DataPreparationLayer, "prepare_data", _PREPARE_DATA)
    monkeypatch.setattr(DataPreparationLayer, "prepare_data_bulk", _PREPARE_DATA_BULK)
    connect = Mock(side_effect=AssertionError("Network is forbidden in this regression"))
    monkeypatch.setattr("socket.socket.connect", connect)
    yield
    connect.assert_not_called()


@pytest.fixture
def histories():
    # More than 252 bars: an invalid result cannot hide behind insufficient data.
    dates = pd.bdate_range(end=date.today(), periods=302, name="Date")
    close = pd.Series([10 + i * .01 for i in range(302)], index=dates)
    full = pd.DataFrame({
        "Open": close, "High": close * 1.01, "Low": close * .99,
        "Close": close, "Volume": 1000.,
    })
    cached = full.iloc[:300].copy()
    cached[["Open", "High", "Low", "Close"]] *= 10
    return cached, full


def _candidate(full, outcome):
    if outcome == "valid":
        return full
    if outcome == "incoherent":
        invalid = full.copy()
        invalid.iloc[30, invalid.columns.get_loc("High")] = 1
        assert not coherent_history(invalid)
        return invalid
    if outcome == "missing_known_session":
        incomplete = full.drop(full.index[30])
        assert coherent_history(incomplete)
        return incomplete
    if outcome == "not_found":
        return full.iloc[:0]
    if outcome == "provider_failure":
        return RuntimeError("Provider unavailable")
    raise AssertionError(outcome)


def _services(monkeypatch, histories, outcome="valid", cache_miss=False):
    cached, full = histories
    service = YFinanceService(rate_limiter=Mock(), eps_rating_service=Mock())
    price_cache = PriceCacheService(redis_client=Mock())
    monkeypatch.setattr(
        price_cache, "_get_from_database",
        Mock(return_value=(None, None) if cache_miss else (cached, cached.index[-1].date())),
    )
    monkeypatch.setattr(price_cache, "_is_data_fresh", Mock(return_value=False))
    monkeypatch.setattr(price_cache, "_is_intraday_data_stale", Mock(return_value=False))
    monkeypatch.setattr(price_cache, "_store_recent_in_redis", Mock())
    monkeypatch.setattr(price_cache, "_store_in_database", Mock())
    candidate = _candidate(full, outcome)
    ticker = Mock()

    def history(*, period, **kwargs):
        result = full.iloc[-3:] if period == "7d" else candidate
        if isinstance(result, Exception):
            raise result
        return result

    ticker.history.side_effect = history
    monkeypatch.setattr(yfinance_module.yf, "Ticker", Mock(return_value=ticker))
    # The cache's intentional use_cache=False provider call still executes the
    # real wrapper, with the same controlled ticker and rate limiter.
    monkeypatch.setattr(yfinance_module, "YFinanceService", lambda: service)
    monkeypatch.setattr("app.wiring.bootstrap.get_price_cache", lambda: price_cache)
    return service, price_cache, ticker


def _layer(monkeypatch, service, cache, benchmark=None):
    monkeypatch.setattr(preparation_module, "get_yfinance_service", lambda: service)
    monkeypatch.setattr(preparation_module, "get_rate_limiter", lambda: Mock())
    layer = DataPreparationLayer(
        price_cache=cache, benchmark_cache=benchmark or Mock(), fundamentals_cache=Mock(),
    )
    layer._resolve_identity = lambda symbol: SimpleNamespace(
        normalized_symbol=symbol, canonical_symbol=symbol, market="US",
        exchange="NASDAQ", currency="USD", timezone="America/New_York", local_code=symbol,
    )
    return layer


def _assert_provider_calls(ticker, symbol, periods):
    symbols = [symbol] * len(periods) if isinstance(symbol, str) else symbol
    assert yfinance_module.yf.Ticker.call_args_list == [call(item) for item in symbols]
    assert yfinance_module.yf.Ticker.call_count == len(periods)
    assert ticker.history.call_args_list == [
        call(period=period, interval="1d", auto_adjust=False, actions=True)
        for period in periods
    ]


@pytest.mark.parametrize("outcome", ["incoherent", "missing_known_session", "provider_failure"])
def test_wrapper_honors_rejected_or_failed_daily_refresh(monkeypatch, histories, outcome):
    service, cache, ticker = _services(monkeypatch, histories, outcome)

    assert service.get_historical_data("AMD", period="2y") is None

    _assert_provider_calls(ticker, "AMD", ["7d", "2y"])
    assert service._rate_limiter.wait.call_count == 2
    cache._store_recent_in_redis.assert_not_called()
    cache._store_in_database.assert_not_called()


@pytest.mark.parametrize("outcome", ["valid", "not_found", "provider_failure"])
def test_true_cache_miss_fetches_once_inside_cache(monkeypatch, histories, outcome):
    service, cache, ticker = _services(monkeypatch, histories, outcome, cache_miss=True)

    result = service.get_historical_data("AMD", period="2y")

    _assert_provider_calls(ticker, "AMD", ["2y"])
    if outcome == "valid":
        pd.testing.assert_frame_equal(result, histories[1])
        cache._store_recent_in_redis.assert_called_once()
        cache._store_in_database.assert_called_once()
    else:
        assert result is None
        cache._store_recent_in_redis.assert_not_called()
        cache._store_in_database.assert_not_called()


def test_valid_daily_cache_hit_does_not_fetch_or_rate_limit(monkeypatch, histories):
    service, cache, ticker = _services(monkeypatch, histories)
    cache._is_data_fresh.return_value = True

    pd.testing.assert_frame_equal(service.get_historical_data("AMD", period="2y"), histories[0])

    ticker.history.assert_not_called()
    service._rate_limiter.wait.assert_not_called()


@pytest.mark.parametrize("period", ["1y", "2y", "5y", "max"])
def test_daily_cache_error_never_becomes_direct_request(monkeypatch, period):
    service = YFinanceService(rate_limiter=Mock(), eps_rating_service=Mock())
    cache = Mock()
    cache.get_historical_data.side_effect = RuntimeError("Cache unavailable")
    monkeypatch.setattr("app.wiring.bootstrap.get_price_cache", lambda: cache)
    ticker_factory = Mock()
    monkeypatch.setattr(yfinance_module.yf, "Ticker", ticker_factory)

    assert service.get_historical_data("AMD", period=period) is None

    cache.get_historical_data.assert_called_once_with("AMD", period=period)
    ticker_factory.assert_not_called()
    service._rate_limiter.wait.assert_not_called()


@pytest.mark.parametrize("fetch_kwargs", [
    {"period": "2y", "use_cache": False},
    {"period": "1mo"},
    {"period": "2y", "interval": "1wk"},
])
def test_explicit_or_unsupported_direct_requests_keep_provider_contract(monkeypatch, histories, fetch_kwargs):
    from app.config import settings

    service = YFinanceService(rate_limiter=Mock(), eps_rating_service=Mock())
    cache_getter = Mock(side_effect=AssertionError("Direct request must not enter cache"))
    monkeypatch.setattr("app.wiring.bootstrap.get_price_cache", cache_getter)
    ticker = Mock()
    ticker.history.return_value = histories[1]
    monkeypatch.setattr(yfinance_module.yf, "Ticker", Mock(return_value=ticker))

    assert service.get_historical_data("AMD", **fetch_kwargs) is histories[1]

    cache_getter.assert_not_called()
    service._rate_limiter.wait.assert_called_once_with(
        "yfinance", min_interval_s=1.0 / settings.yfinance_rate_limit,
    )
    ticker.history.assert_called_once_with(
        period=fetch_kwargs["period"], interval=fetch_kwargs.get("interval", "1d"),
        auto_adjust=False, actions=True,
    )


@pytest.mark.parametrize("outcome", ["incoherent", "missing_known_session", "provider_failure", "valid"])
@pytest.mark.parametrize("allow_partial", [True, False])
def test_single_preparation_uses_authoritative_cache_result(monkeypatch, histories, outcome, allow_partial):
    service, cache, ticker = _services(monkeypatch, histories, outcome)
    layer = _layer(monkeypatch, service, cache)
    if outcome != "valid" and not allow_partial:
        with pytest.raises(DataFetchError) as raised:
            layer.prepare_data("AMD", DataRequirements(), allow_partial=False)
        result = raised.value.partial_data
        assert "price_data" in raised.value.errors
    else:
        result = layer.prepare_data("AMD", DataRequirements(), allow_partial=allow_partial)

    _assert_provider_calls(ticker, "AMD", ["7d", "2y"])
    if outcome == "valid":
        pd.testing.assert_frame_equal(result.price_data, histories[1])
        assert not result.fetch_errors
    else:
        assert result.price_data.empty
        assert "price_data" in result.fetch_errors
        cache._store_recent_in_redis.assert_not_called()
        cache._store_in_database.assert_not_called()


@pytest.mark.parametrize("outcome", ["incoherent", "provider_failure", "not_found", "valid"])
@pytest.mark.parametrize("batch_only", [False, True])
def test_bulk_preparation_keeps_real_batch_result_without_single_retry(
    monkeypatch, histories, outcome, batch_only,
):
    from app.services.bulk_data_fetcher import BulkDataFetcher

    service, cache, ticker = _services(monkeypatch, histories)
    cache._redis_client = None
    monkeypatch.setattr(cache, "_get_many_from_database", Mock(return_value={"AMD": (None, None)}))
    monkeypatch.setattr(cache, "_active_market_by_symbol", Mock(return_value={"AMD": "US"}))
    monkeypatch.setattr(cache, "_store_batch_in_cache_for_market", Mock())
    candidate = _candidate(histories[1], outcome)
    batch_fetch = Mock(return_value={"AMD": {
        "has_error": outcome == "provider_failure",
        "price_data": None if isinstance(candidate, Exception) else candidate,
    }})
    monkeypatch.setattr(BulkDataFetcher, "fetch_prices_in_batches", batch_fetch)
    monkeypatch.setattr(preparation_module.app_settings, "scan_freshness_gate_enabled", True)
    layer = _layer(monkeypatch, service, cache)

    result = layer.prepare_data_bulk(
        ["AMD"], DataRequirements(), batch_only_prices=batch_only,
    )["AMD"]

    batch_fetch.assert_called_once_with(["AMD"], period="2y", market="US")
    ticker.history.assert_not_called()
    cache._get_from_database.assert_not_called()
    if outcome == "valid":
        pd.testing.assert_frame_equal(result.price_data, histories[1])
        assert not result.fetch_errors
    else:
        assert result.price_data.empty
        assert "price_data" in result.fetch_errors
        cache._store_batch_in_cache_for_market.assert_not_called()


def test_bulk_cached_only_miss_does_not_enable_provider_fallback(monkeypatch, histories):
    service, cache, ticker = _services(monkeypatch, histories)
    monkeypatch.setattr(cache, "get_many_cached_only", Mock(return_value={"AMD": None}))
    monkeypatch.setattr(cache, "get_many", Mock())
    monkeypatch.setattr(preparation_module.app_settings, "scan_freshness_gate_enabled", False)
    layer = _layer(monkeypatch, service, cache)

    with pytest.raises(DataFetchError) as raised:
        layer.prepare_data_bulk(["AMD"], DataRequirements(), allow_partial=False)

    assert raised.value.partial_data["AMD"].price_data.empty
    cache.get_many_cached_only.assert_called_once_with(["AMD"], period="2y")
    cache.get_many.assert_not_called()
    ticker.history.assert_not_called()


@pytest.mark.parametrize("outcome", ["incoherent", "missing_known_session", "provider_failure", "valid"])
def test_static_batch_benchmark_result_reaches_export_as_valid_or_unknown(monkeypatch, histories, outcome):
    service, cache, ticker = _services(monkeypatch, histories, outcome)
    benchmark = BenchmarkCacheService(redis_client=None)
    benchmark._redis_client = None
    # Use the real benchmark candidate selection, wrapper and cache refresh;
    # only prior benchmark storage and database writes are isolated.
    monkeypatch.setattr(benchmark, "_get_from_database", Mock(return_value=None))
    monkeypatch.setattr(benchmark, "_store_in_database", Mock())
    monkeypatch.setattr(cache, "get_many", Mock(return_value={"AMD": histories[1]}))
    monkeypatch.setattr(preparation_module.app_settings, "scan_freshness_gate_enabled", True)
    layer = _layer(monkeypatch, service, cache, benchmark)

    result = layer.prepare_data_bulk(
        ["AMD"], DataRequirements(needs_benchmark=True),
        batch_only_prices=True, batch_only_fundamentals=True,
    )["AMD"]
    regime = ScanOrchestrator.__new__(ScanOrchestrator)._assess_regime(result)
    domain = ScanResultItemDomain(
        symbol="AMD", composite_score=72., rating="Watch", current_price=13.,
        screener_outputs={}, screeners_run=["minervini"], composite_method="weighted_average",
        screeners_passed=1, screeners_total=1, extended_fields=regime,
    )
    exported = StaticSiteExportService.__new__(StaticSiteExportService)._serialize_scan_row(domain)

    # Candidate fallback is preserved, but neither symbol gets a raw retry.
    symbols = ["SPY", "SPY"] if outcome == "valid" else ["SPY", "SPY", "IVV", "IVV"]
    _assert_provider_calls(ticker, symbols, ["7d", "2y"] * (len(symbols) // 2))
    pd.testing.assert_frame_equal(result.price_data, histories[1])
    if outcome == "valid":
        pd.testing.assert_frame_equal(result.benchmark_data, histories[1])
        assert result.benchmark_symbol == "SPY"
        assert not result.fetch_errors
        assert exported["market_regime"] == "confirmed_uptrend"
        assert exported["market_exposure_pct"] == 100
        benchmark._store_in_database.assert_called_once()
    else:
        assert result.benchmark_data.empty
        assert "benchmark_data" in result.fetch_errors
        assert regime == {}
        assert exported["market_regime"] is None
        assert exported["market_exposure_pct"] is None
        benchmark._store_in_database.assert_not_called()
        cache._store_in_database.assert_not_called()
        cache._store_recent_in_redis.assert_not_called()


@pytest.mark.parametrize("has_cached_history", [False, True])
def test_bulk_honors_inactive_symbol_cache_policy(monkeypatch, histories, has_cached_history):
    from app.services.bulk_data_fetcher import BulkDataFetcher

    service, cache, ticker = _services(monkeypatch, histories)
    cache._redis_client = None
    cached = histories[0] if has_cached_history else None
    last_date = cached.index[-1].date() if cached is not None else None
    monkeypatch.setattr(cache, "_get_many_from_database", Mock(return_value={"AMD": (cached, last_date)}))
    monkeypatch.setattr(cache, "_active_market_by_symbol", Mock(return_value={}))
    batch_fetch = Mock()
    monkeypatch.setattr(BulkDataFetcher, "fetch_prices_in_batches", batch_fetch)
    monkeypatch.setattr(preparation_module.app_settings, "scan_freshness_gate_enabled", True)
    layer = _layer(monkeypatch, service, cache)

    result = layer.prepare_data_bulk(["AMD"], DataRequirements())["AMD"]

    batch_fetch.assert_not_called()
    ticker.history.assert_not_called()
    if has_cached_history:
        pd.testing.assert_frame_equal(result.price_data, cached)
        assert not result.fetch_errors
    else:
        assert result.price_data.empty
        assert "price_data" in result.fetch_errors
