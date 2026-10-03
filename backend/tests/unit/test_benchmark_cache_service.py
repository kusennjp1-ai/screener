import pickle
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pandas as pd
import pytest

from app.models.stock import StockPrice

from app.services.benchmark_cache_service import BenchmarkCacheService
import app.services.benchmark_cache_service as benchmark_cache_module


def _benchmark_history(close, session="2026-04-10"):
    return pd.DataFrame(
        {"Open": [close], "High": [close * 1.01], "Low": [close * .99],
         "Close": [close], "Volume": [1000.]},
        index=pd.DatetimeIndex([session], name="Date"),
    )


def test_get_benchmark_symbol_supports_all_markets():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)

    assert service.get_benchmark_symbol("US") == "SPY"
    assert service.get_benchmark_symbol("HK") == "^HSI"
    assert service.get_benchmark_symbol("JP") == "^N225"
    assert service.get_benchmark_symbol("TW") == "^TWII"


def test_non_us_candidates_do_not_include_spy():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)

    assert "SPY" not in service.get_benchmark_candidates("HK")
    assert "SPY" not in service.get_benchmark_candidates("JP")
    assert "SPY" not in service.get_benchmark_candidates("TW")


def test_get_spy_data_delegates_to_market_api():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)

    captured = {}

    def fake_get_benchmark_data(*, market, period, force_refresh):
        captured["market"] = market
        captured["period"] = period
        captured["force_refresh"] = force_refresh
        return "ok"

    service.get_benchmark_data = fake_get_benchmark_data  # type: ignore[assignment]
    result = service.get_spy_data(period="1y", force_refresh=True)

    assert result == "ok"
    assert captured == {"market": "US", "period": "1y", "force_refresh": True}


def test_market_scoped_redis_keys_are_deterministic():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)

    data_key = service._redis_data_key("^N225", "2y", market="JP")
    lock_key = service._redis_lock_key("^N225", "2y", market="JP")

    assert data_key == "benchmark:JP:^N225:2y"
    assert lock_key == "benchmark:JP:^N225:2y:lock"


def test_fetch_and_cache_benchmark_without_redis_fetches_directly_and_persists():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    service._redis_client = None

    calls = {"wait": 0, "store_db": 0}
    data = _benchmark_history(100.)

    def fail_if_wait(*args, **kwargs):
        calls["wait"] += 1
        raise AssertionError("wait path must not run when redis is unavailable")

    def fake_store_db(*, benchmark_symbol, data):
        calls["store_db"] += 1
        assert benchmark_symbol == "^HSI"
        assert not data.empty

    service._wait_for_cache = fail_if_wait  # type: ignore[assignment]
    service._store_in_database = fake_store_db  # type: ignore[assignment]
    service._fetch_from_yfinance = lambda benchmark_symbol, period: data  # type: ignore[assignment]

    result = service._fetch_and_cache_benchmark("^HSI", "HK", "2y")

    assert result is data
    assert calls["wait"] == 0
    assert calls["store_db"] == 1


def test_get_benchmark_data_uses_fallback_when_primary_fails():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    service._redis_client = None

    calls = []
    fallback_df = _benchmark_history(1.)

    def fake_fetch(symbol, period):
        calls.append(symbol)
        if symbol == "^HSI":
            return pd.DataFrame()
        if symbol == "2800.HK":
            return fallback_df
        return pd.DataFrame()

    service._fetch_from_yfinance = fake_fetch  # type: ignore[assignment]
    service._store_in_database = lambda **kwargs: None  # type: ignore[assignment]

    result = service.get_benchmark_data(market="HK", period="2y", force_refresh=True)

    assert calls[:2] == ["^HSI", "2800.HK"]
    assert result is fallback_df


def test_get_benchmark_data_prefers_cached_fallback_before_primary_network_fetch():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    service._redis_client = None

    fallback_df = _benchmark_history(1.)
    calls = []

    def fake_get_from_db(*, benchmark_symbol, period, market):
        if benchmark_symbol == "2800.HK":
            return fallback_df
        return None

    def fake_fetch(*, benchmark_symbol, market, period):
        calls.append(benchmark_symbol)
        return pd.DataFrame()

    service._get_from_database = fake_get_from_db  # type: ignore[assignment]
    service._is_data_fresh = lambda data, market="US", max_age_hours=24: True  # type: ignore[assignment]
    service._fetch_and_cache_benchmark = fake_fetch  # type: ignore[assignment]

    result = service.get_benchmark_data(market="HK", period="2y", force_refresh=False)

    assert result is fallback_df
    assert calls == []


def test_get_benchmark_data_skips_stale_redis_hit():
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    service._redis_client = None

    stale_df = _benchmark_history(1., "2026-04-01")
    fresh_df = _benchmark_history(2.)

    def fake_get_from_redis(*, benchmark_symbol, period, market="US"):
        assert market == "HK"
        if benchmark_symbol == "^HSI":
            return stale_df
        return None

    def fake_get_from_db(*, benchmark_symbol, period, market):
        if benchmark_symbol == "2800.HK":
            return fresh_df
        return None

    def fake_is_fresh(data, market="US", max_age_hours=24):
        return data is fresh_df

    service._get_from_redis = fake_get_from_redis  # type: ignore[assignment]
    service._get_from_database = fake_get_from_db  # type: ignore[assignment]
    service._is_data_fresh = fake_is_fresh  # type: ignore[assignment]

    result = service.get_benchmark_data(market="HK", period="2y", force_refresh=False)

    assert result is fresh_df


def test_is_data_fresh_fallback_allows_weekend_without_calendar(monkeypatch):
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    data = _benchmark_history(100.)  # Friday
    service._market_calendar.last_completed_trading_day = lambda market: None  # type: ignore[method-assign]

    monkeypatch.setattr(
        pd.Timestamp,
        "utcnow",
        lambda: pd.Timestamp(datetime(2026, 4, 12, 12, 0), tz="UTC"),
    )

    assert service._is_data_fresh(data, market="HK") is True


def test_is_data_fresh_uses_us_market_hours_fallback_when_calendar_unavailable(monkeypatch):
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    data = _benchmark_history(100.)  # Friday
    service._market_calendar.last_completed_trading_day = lambda market: (_ for _ in ()).throw(RuntimeError("no calendar"))  # type: ignore[method-assign]

    monkeypatch.setattr(
        benchmark_cache_module,
        "get_eastern_now",
        lambda: datetime.fromisoformat("2026-04-13T10:00:00-04:00"),  # Monday, market open
    )
    monkeypatch.setattr(benchmark_cache_module, "is_market_open", lambda _dt=None: True)
    monkeypatch.setattr(
        benchmark_cache_module,
        "get_last_trading_day",
        lambda d=None: pd.Timestamp("2026-04-10").date(),
    )
    monkeypatch.setattr(benchmark_cache_module, "is_trading_day", lambda d=None: True)

    assert service._is_data_fresh(data, market="US") is True


def test_is_data_fresh_us_fallback_premarket_uses_previous_trading_day(monkeypatch):
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    data = _benchmark_history(100.)  # Friday close
    service._market_calendar.last_completed_trading_day = lambda market: (_ for _ in ()).throw(RuntimeError("no calendar"))  # type: ignore[method-assign]

    monkeypatch.setattr(
        benchmark_cache_module,
        "get_eastern_now",
        lambda: datetime.fromisoformat("2026-04-13T08:00:00-04:00"),  # Monday pre-market
    )
    monkeypatch.setattr(benchmark_cache_module, "is_market_open", lambda _dt=None: False)
    monkeypatch.setattr(benchmark_cache_module, "is_trading_day", lambda d=None: True)
    monkeypatch.setattr(
        benchmark_cache_module,
        "get_last_trading_day",
        lambda d=None: pd.Timestamp("2026-04-10").date(),
    )

    assert service._is_data_fresh(data, market="US") is True


def test_is_data_fresh_us_fallback_after_close_requires_same_day(monkeypatch):
    service = BenchmarkCacheService(redis_client=None, session_factory=lambda: None)
    stale_data = _benchmark_history(100.)  # Friday close
    service._market_calendar.last_completed_trading_day = lambda market: (_ for _ in ()).throw(RuntimeError("no calendar"))  # type: ignore[method-assign]

    monkeypatch.setattr(
        benchmark_cache_module,
        "get_eastern_now",
        lambda: datetime.fromisoformat("2026-04-13T17:30:00-04:00"),  # Monday after close buffer
    )
    monkeypatch.setattr(benchmark_cache_module, "is_market_open", lambda _dt=None: False)
    monkeypatch.setattr(benchmark_cache_module, "is_trading_day", lambda d=None: True)
    monkeypatch.setattr(
        benchmark_cache_module,
        "get_last_trading_day",
        lambda d=None: pd.Timestamp("2026-04-10").date(),
    )

    assert service._is_data_fresh(stale_data, market="US") is False


# These cases use complete OHLCV, so freshness cannot mask corrupt cached data.


@pytest.fixture
def benchmark_history():
    sessions = pd.bdate_range(end=date.today(), periods=120, name="Date")
    close = pd.Series([100. + i * .1 for i in range(120)], index=sessions)
    return pd.DataFrame({
        "Open": close, "High": close * 1.01, "Low": close * .99,
        "Close": close, "Volume": 1000.,
    })


@pytest.fixture(params=["bad_bar", "discontinuity", "missing_column", "nonnumeric", "wrong_type"])
def malformed_history(request, benchmark_history):
    data = benchmark_history.copy()
    if request.param == "bad_bar":
        data.iloc[30, data.columns.get_loc("High")] = 1
    elif request.param == "discontinuity":
        data.loc[data.index[-30:], ["Open", "High", "Low", "Close"]] /= 10
    elif request.param == "missing_column":
        data = data.drop(columns="Open")
    elif request.param == "nonnumeric":
        data["Close"] = "broken"
    else:
        data = {"Close": [100.]}
    return data


def test_benchmark_redis_read_rejects_malformed_payload(malformed_history):
    redis = Mock()
    redis.get.return_value = pickle.dumps(malformed_history)
    service = BenchmarkCacheService(redis_client=redis)

    assert service._get_from_redis("SPY", "2y", "US") is None

    redis.setex.assert_not_called()


def test_benchmark_storage_rejects_malformed_payload_without_changing_artifacts(malformed_history):
    redis = Mock()
    database = Mock()
    service = BenchmarkCacheService(redis_client=redis, session_factory=database)

    service._store_in_redis("SPY", "2y", malformed_history)
    service._store_in_database("SPY", malformed_history)

    redis.setex.assert_not_called()
    database.assert_not_called()


@pytest.mark.parametrize("coordination", ["no_redis", "lock_acquired", "lock_timeout"])
def test_benchmark_fetch_rejects_malformed_payload_and_releases_lock(
    monkeypatch, malformed_history, coordination,
):
    redis = Mock()
    redis.set.return_value = coordination == "lock_acquired"
    service = BenchmarkCacheService(redis_client=redis)
    if coordination == "no_redis":
        service._redis_client = None
    service.LOCK_TIMEOUT_SECONDS = 0
    fetch = Mock(return_value=malformed_history)
    store_redis, store_database = Mock(), Mock()
    monkeypatch.setattr(service, "_fetch_from_yfinance", fetch)
    monkeypatch.setattr(service, "_store_in_redis", store_redis)
    monkeypatch.setattr(service, "_store_in_database", store_database)

    assert service._fetch_and_cache_benchmark("SPY", "US", "2y") is None

    fetch.assert_called_once_with("SPY", "2y")
    store_redis.assert_not_called()
    store_database.assert_not_called()
    if coordination == "lock_acquired":
        redis.delete.assert_called_once_with(service._redis_lock_key("SPY", "2y", "US"))
    else:
        redis.delete.assert_not_called()


@pytest.mark.parametrize("coordination", ["lock_acquired", "lock_timeout"])
def test_benchmark_valid_fetch_survives_coordination(monkeypatch, benchmark_history, coordination):
    redis = Mock()
    redis.set.return_value = coordination == "lock_acquired"
    service = BenchmarkCacheService(redis_client=redis)
    service.LOCK_TIMEOUT_SECONDS = 0
    monkeypatch.setattr(service, "_fetch_from_yfinance", Mock(return_value=benchmark_history))
    store_redis, store_database = Mock(), Mock()
    monkeypatch.setattr(service, "_store_in_redis", store_redis)
    monkeypatch.setattr(service, "_store_in_database", store_database)

    result = service._fetch_and_cache_benchmark("SPY", "US", "2y")

    assert result is benchmark_history
    store_database.assert_called_once()
    assert store_redis.call_count == (1 if coordination == "lock_acquired" else 0)
    assert redis.delete.call_count == (1 if coordination == "lock_acquired" else 0)


@pytest.mark.parametrize("valid", [False, True])
def test_benchmark_waiter_validates_redis_before_returning(monkeypatch, benchmark_history, valid):
    data = benchmark_history.copy()
    if not valid:
        data.iloc[30, data.columns.get_loc("High")] = 1
    redis = Mock()
    redis.get.return_value = pickle.dumps(data)
    service = BenchmarkCacheService(redis_client=redis)
    fetch = Mock(return_value=None)
    monkeypatch.setattr(service, "_fetch_from_yfinance", fetch)
    monkeypatch.setattr(
        benchmark_cache_module, "time",
        SimpleNamespace(time=Mock(side_effect=[0, 0, 2]), sleep=Mock()),
    )

    result = service._wait_for_cache("SPY", "2y", "US", max_wait_seconds=1)

    if valid:
        pd.testing.assert_frame_equal(result, data)
        fetch.assert_not_called()
    else:
        assert result is None
        fetch.assert_called_once_with("SPY", "2y")


@pytest.mark.parametrize("valid", [False, True])
def test_benchmark_database_read_checks_persisted_ohlcv(db_session, benchmark_history, valid):
    data = benchmark_history.copy()
    if not valid:
        data.iloc[30, data.columns.get_loc("High")] = 1
    db_session.add_all([
        StockPrice(
            symbol="SPY", date=session.date(), open=row.Open, high=row.High,
            low=row.Low, close=row.Close, volume=int(row.Volume), adj_close=row.Close,
        )
        for session, row in data.iterrows()
    ])
    db_session.commit()
    service = BenchmarkCacheService(redis_client=Mock())

    result = service._get_from_database("SPY", "2y")

    if valid:
        pd.testing.assert_frame_equal(result, data, check_dtype=False, check_freq=False)
    else:
        assert result is None
    assert db_session.query(StockPrice).filter(StockPrice.symbol == "SPY").count() == len(data)


def test_benchmark_storage_round_trip_preserves_valid_history(db_session, benchmark_history):
    redis = Mock()
    stored = {}
    redis.setex.side_effect = lambda key, ttl, value: stored.__setitem__(key, value)
    redis.get.side_effect = stored.get
    service = BenchmarkCacheService(redis_client=redis)

    service._store_in_redis("SPY", "2y", benchmark_history)
    service._store_in_database("SPY", benchmark_history)

    pd.testing.assert_frame_equal(service._get_from_redis("SPY", "2y", "US"), benchmark_history)
    pd.testing.assert_frame_equal(
        service._get_from_database("SPY", "2y"), benchmark_history,
        check_dtype=False, check_freq=False,
    )
    assert db_session.query(StockPrice).filter(StockPrice.symbol == "SPY").count() == len(benchmark_history)
