from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pandas as pd
from pandas.testing import assert_frame_equal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.stock import StockPrice
from app.models.stock_universe import StockUniverse
from app.services.cache.price_history_integrity import coherent_history
from app.services.static_daily_price_refresh_service import (
    STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
    STATIC_DAILY_PRICE_REFRESH_PERIOD,
    STATIC_DAILY_PRICE_REFRESH_BATCH_SIZE,
    STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
    STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS,
    StaticDailyPriceRefreshService,
    static_daily_price_refresh_batch_size,
)


IN_KEY_MARKET_PRICE_SYMBOLS = ["^NSEI", "NIFTYBEES.NS", "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS"]
HK_KEY_MARKET_PRICE_SYMBOLS = ["^HSI", "2800.HK", "0700.HK", "3690.HK", "0941.HK"]
US_KEY_MARKET_PRICE_SYMBOLS = [
    "SPY",
    "QQQ",
    "IWM",
    "DX-Y.NYB",
    "SGD=X",
    "BTC-USD",
    "GLD",
    "TLT",
    "^VIX",
]


def _sqlite_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(
        engine,
        tables=[StockUniverse.__table__, StockPrice.__table__],
    )
    return sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )


def _history_frame(end="2026-06-04", periods=60, value=1.0):
    return pd.DataFrame(
        {"Open": value, "High": value, "Low": value, "Close": value,
         "Volume": 1000, "Adj Close": value * 0.9},
        index=pd.bdate_range(end=end, periods=periods, name="Date"),
    )


def _seed_history(db, symbol, *, end=None, frame=None):
    frame = _history_frame(end=end) if frame is None else frame
    for timestamp, row in frame.iterrows():
        db.add(StockPrice(symbol=symbol, date=timestamp.date(), open=float(row.Open),
                          high=float(row.High), low=float(row.Low), close=float(row.Close),
                          volume=int(row.Volume), adj_close=float(row["Adj Close"])))


class _RecordingCache:
    """Real SQLite reads; explicit cache/SQL write spies for service routing."""
    def __init__(self, session_factory, stored_batches):
        self.session_factory = session_factory
        self.stored_batches = stored_batches
        self.redis_frames = {}
        self.db_frames = {}

    def get_many_cached_only(self, symbols, period="2y"):
        assert period == "2y"
        result = {}
        with self.session_factory() as db:
            for symbol in symbols:
                rows = db.query(StockPrice).filter(StockPrice.symbol == symbol).order_by(StockPrice.date).all()
                frame = pd.DataFrame(
                    [{"Open": row.open, "High": row.high, "Low": row.low,
                      "Close": row.close, "Volume": row.volume} for row in rows],
                    index=pd.DatetimeIndex([row.date for row in rows], name="Date"),
                )
                result[symbol] = frame if len(frame) >= 50 and coherent_history(frame) else None
        return result

    def store_batch_in_cache(self, payload, also_store_db=True, market=None, **kwargs):
        assert all(coherent_history(frame) for frame in payload.values())
        self.stored_batches.append({"symbols": sorted(payload), "also_store_db": also_store_db, "market": market})
        self.redis_frames.update({symbol: frame.copy(deep=True) for symbol, frame in payload.items()})
        if also_store_db:
            self._store_batch_in_database(payload, **kwargs)

    def _store_batch_in_database(self, payload, **kwargs):
        assert all(coherent_history(frame) for frame in payload.values())
        self.db_frames.update({symbol: frame.copy(deep=True) for symbol, frame in payload.items()})


def test_static_daily_price_refresh_service_fetches_stale_and_no_history_groups() -> None:
    session_factory = _sqlite_session_factory()

    with session_factory() as db:
        db.add_all(
            [
                StockUniverse(symbol="OLD.NS", market="IN", is_active=True, market_cap=100.0),
                StockUniverse(symbol="NEW.NS", market="IN", is_active=True, market_cap=90.0),
            ]
        )
        _seed_history(db, "OLD.NS", end="2026-06-03")
        db.commit()

    fetch_calls: list[dict] = []
    stored_batches: list[dict] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append(
                {
                    "symbols": list(symbols),
                    "period": period,
                    "start_batch_size": start_batch_size,
                    "market": market,
                }
            )
            return {
                symbol: {"price_data": _history_frame(end="2026-06-04", periods=7), "has_error": False}
                for symbol in symbols
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=_RecordingCache(session_factory, stored_batches),
        fetcher=_FakeFetcher(),
        batch_size_for_market=lambda market: 25,
        sleep=lambda _seconds: None,
    )

    result = service.refresh(as_of_date=date(2026, 6, 4), market="IN")

    assert fetch_calls == [
        {
            "symbols": ["OLD.NS"],
            "period": STATIC_DAILY_PRICE_REFRESH_PERIOD,
            "start_batch_size": 25,
            "market": "IN",
        },
        {
            "symbols": ["NEW.NS", *IN_KEY_MARKET_PRICE_SYMBOLS],
            "period": STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            "start_batch_size": 25,
            "market": "IN",
        },
    ]
    assert stored_batches == [
        {"symbols": ["OLD.NS"], "also_store_db": False, "market": "IN"},
        {
            "symbols": ["HDFCBANK.NS", "NEW.NS", "NIFTYBEES.NS", "RELIANCE.NS", "TCS.NS", "^NSEI"],
            "also_store_db": True,
            "market": "IN",
        },
    ]
    assert result["stale_symbols"] == 1
    assert result["key_market_symbols"] == len(IN_KEY_MARKET_PRICE_SYMBOLS)
    assert result["no_history_symbols"] == 6
    assert result["yahoo_fetched_symbols"] == 7
    assert len(service._price_cache.redis_frames["OLD.NS"]) == 61
    assert_frame_equal(service._price_cache.db_frames["OLD.NS"],
                       _history_frame(end="2026-06-04", periods=7))


def test_static_daily_price_refresh_service_filters_to_selected_market() -> None:
    session_factory = _sqlite_session_factory()

    with session_factory() as db:
        db.add_all(
            [
                StockUniverse(symbol="0700.HK", market="HK", is_active=True, market_cap=100.0),
                StockUniverse(symbol="9988.HK", market="HK", is_active=True, market_cap=90.0),
                StockUniverse(symbol="AAPL", market="US", is_active=True, market_cap=120.0),
                StockUniverse(symbol="BAD-W", market="HK", is_active=True, market_cap=80.0),
            ]
        )
        for symbol in ("0700.HK", "AAPL"):
            _seed_history(db, symbol, end="2026-04-01")
        db.commit()

    fetch_calls: list[dict] = []
    stored_batches: list[dict] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append(
                {
                    "symbols": list(symbols),
                    "period": period,
                    "start_batch_size": start_batch_size,
                    "market": market,
                }
            )
            return {
                symbol: {"price_data": _history_frame(end="2026-04-02", periods=7), "has_error": False}
                for symbol in symbols
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=_RecordingCache(session_factory, stored_batches),
        fetcher=_FakeFetcher(),
        batch_size_for_market=lambda _market: 25,
        sleep=lambda _seconds: None,
    )

    result = service.refresh(as_of_date=date(2026, 4, 2), market="HK")

    assert result["market"] == "HK"
    assert result["total_active_symbols"] == 3
    assert result["supported_symbols"] == 6
    assert result["key_market_symbols"] == len(HK_KEY_MARKET_PRICE_SYMBOLS)
    assert result["skipped_unsupported_symbols"] == 1
    assert fetch_calls == [
        {
            "symbols": ["0700.HK"],
            "period": STATIC_DAILY_PRICE_REFRESH_PERIOD,
            "start_batch_size": 25,
            "market": "HK",
        },
        {
            "symbols": ["9988.HK", "^HSI", "2800.HK", "3690.HK", "0941.HK"],
            "period": STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            "start_batch_size": 25,
            "market": "HK",
        },
    ]
    assert stored_batches == [
        {"symbols": ["0700.HK"], "also_store_db": False, "market": "HK"},
        {
            "symbols": ["0941.HK", "2800.HK", "3690.HK", "9988.HK", "^HSI"],
            "also_store_db": True,
            "market": "HK",
        },
    ]
    assert len(service._price_cache.redis_frames["0700.HK"]) == 61
    assert_frame_equal(service._price_cache.db_frames["0700.HK"],
                       _history_frame(end="2026-04-02", periods=7))


def test_static_daily_price_refresh_batch_size_uses_market_policy(monkeypatch) -> None:
    import app.services.rate_budget_policy as rate_budget_policy

    calls = []

    class _FakePolicy:
        def get_batch_size(self, provider, market):
            calls.append((provider, market))
            return 31

    monkeypatch.setattr(rate_budget_policy, "get_rate_budget_policy", lambda: _FakePolicy())

    assert static_daily_price_refresh_batch_size("IN") == 31
    assert calls == [("yfinance", "IN")]
    assert static_daily_price_refresh_batch_size(None) == STATIC_DAILY_PRICE_REFRESH_BATCH_SIZE


def test_static_daily_price_refresh_includes_us_key_market_data_symbols() -> None:
    session_factory = _sqlite_session_factory()

    fetch_calls: list[dict] = []
    stored_batches: list[dict] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append(
                {
                    "symbols": list(symbols),
                    "period": period,
                    "start_batch_size": start_batch_size,
                    "market": market,
                }
            )
            return {
                symbol: {"price_data": _history_frame(), "has_error": False}
                for symbol in symbols
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=_RecordingCache(session_factory, stored_batches),
        fetcher=_FakeFetcher(),
        batch_size_for_market=lambda _market: 25,
        sleep=lambda _seconds: None,
    )

    result = service.refresh(as_of_date=date(2026, 6, 4), market="US")

    assert fetch_calls == [
        {
            "symbols": US_KEY_MARKET_PRICE_SYMBOLS,
            "period": STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            "start_batch_size": 25,
            "market": "US",
        },
    ]
    assert stored_batches == [
        {
            "symbols": ["BTC-USD", "DX-Y.NYB", "GLD", "IWM", "QQQ", "SGD=X", "SPY", "TLT", "^VIX"],
            "also_store_db": True,
            "market": "US",
        },
    ]
    assert result["total_active_symbols"] == 0
    assert result["key_market_symbols"] == len(US_KEY_MARKET_PRICE_SYMBOLS)
    assert result["no_history_symbols"] == len(US_KEY_MARKET_PRICE_SYMBOLS)
    assert result["yahoo_fetched_symbols"] == len(US_KEY_MARKET_PRICE_SYMBOLS)


def _seed_in_universe(session_factory) -> None:
    with session_factory() as db:
        db.add_all(
            [
                StockUniverse(symbol="RELIANCE.NS", market="IN", is_active=True, market_cap=300.0),
                StockUniverse(symbol="TCS.NS", market="IN", is_active=True, market_cap=200.0),
                StockUniverse(symbol="INFY.NS", market="IN", is_active=True, market_cap=100.0),
            ]
        )
        for symbol in ("RELIANCE.NS", "TCS.NS", "INFY.NS"):
            _seed_history(db, symbol, end="2026-04-01")
        db.commit()


def test_static_daily_price_refresh_retries_rate_limited_failures() -> None:
    session_factory = _sqlite_session_factory()
    _seed_in_universe(session_factory)

    fetch_calls: list[dict] = []
    stored_batches: list[dict] = []
    sleeps: list[float] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append(
                {
                    "symbols": list(symbols),
                    "period": period,
                    "start_batch_size": start_batch_size,
                    "market": market,
                }
            )
            if len(fetch_calls) == 1:
                return {
                    "RELIANCE.NS": {
                        "price_data": _history_frame(end="2026-04-02", periods=7),
                        "has_error": False,
                    },
                    "TCS.NS": {
                        "price_data": None,
                        "has_error": True,
                        "error": "Too Many Requests (429)",
                    },
                    "INFY.NS": {
                        "price_data": None,
                        "has_error": True,
                        "error": "delisted: no price data",
                    },
                }
            if period == STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD:
                return {
                    symbol: {"price_data": _history_frame(end="2026-04-02", periods=7), "has_error": False}
                    for symbol in symbols
                }
            return {
                "TCS.NS": {
                    "price_data": _history_frame(end="2026-04-02", periods=7),
                    "has_error": False,
                },
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=_RecordingCache(session_factory, stored_batches),
        fetcher=_FakeFetcher(),
        sleep=lambda seconds: sleeps.append(seconds),
    )

    result = service.refresh(as_of_date=date(2026, 4, 2), market="IN")

    assert sleeps == [STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS]
    assert len(fetch_calls) == 3
    assert fetch_calls[1]["symbols"] == ["^NSEI", "NIFTYBEES.NS", "HDFCBANK.NS"]
    assert fetch_calls[2]["symbols"] == ["TCS.NS"]
    assert fetch_calls[2]["start_batch_size"] == STATIC_RATE_LIMITED_RETRY_BATCH_SIZE
    assert fetch_calls[2]["market"] == "IN"
    stored_symbols = {symbol for batch in stored_batches for symbol in batch["symbols"]}
    assert stored_symbols == {"RELIANCE.NS", "TCS.NS", "^NSEI", "NIFTYBEES.NS", "HDFCBANK.NS"}
    assert result["rate_limited_retry"] == {
        "attempted": 1,
        "recovered": 1,
        "still_failed": 0,
        "wait_seconds": STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS,
        "batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
    }
    assert result["key_market_symbols"] == len(IN_KEY_MARKET_PRICE_SYMBOLS)
    assert result["yahoo_fetched_symbols"] == 5
    assert result["yahoo_failed_symbols"] == 1


def test_static_daily_price_refresh_retries_no_history_rate_limits_with_bootstrap_period() -> None:
    session_factory = _sqlite_session_factory()

    with session_factory() as db:
        db.add(StockUniverse(symbol="NEW.NS", market="IN", is_active=True, market_cap=100.0))
        db.commit()

    fetch_calls: list[dict] = []
    stored_batches: list[dict] = []
    sleeps: list[float] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append(
                {
                    "symbols": list(symbols),
                    "period": period,
                    "start_batch_size": start_batch_size,
                    "market": market,
                }
            )
            if len(fetch_calls) == 1:
                return {
                    "NEW.NS": {
                        "price_data": None,
                        "has_error": True,
                        "error": "Too Many Requests (429)",
                    },
                }
            return {
                "NEW.NS": {
                    "price_data": _history_frame(),
                    "has_error": False,
                },
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=_RecordingCache(session_factory, stored_batches),
        fetcher=_FakeFetcher(),
        batch_size_for_market=lambda _market: 25,
        sleep=lambda seconds: sleeps.append(seconds),
    )

    result = service.refresh(as_of_date=date(2026, 6, 4), market="IN")

    assert sleeps == [STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS]
    assert fetch_calls == [
        {
            "symbols": ["NEW.NS", *IN_KEY_MARKET_PRICE_SYMBOLS],
            "period": STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            "start_batch_size": 25,
            "market": "IN",
        },
        {
            "symbols": ["NEW.NS"],
            "period": STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            "start_batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
            "market": "IN",
        },
    ]
    assert stored_batches == [
        {"symbols": ["NEW.NS"], "also_store_db": True, "market": "IN"},
    ]
    assert result["key_market_symbols"] == len(IN_KEY_MARKET_PRICE_SYMBOLS)
    assert result["no_history_symbols"] == 6
    assert result["rate_limited_retry"]["recovered"] == 1
    assert result["yahoo_fetched_symbols"] == 1
    assert result["yahoo_failed_symbols"] == 0


def test_static_daily_price_refresh_skips_retry_for_non_in_markets() -> None:
    session_factory = _sqlite_session_factory()

    with session_factory() as db:
        db.add(StockUniverse(symbol="0700.HK", market="HK", is_active=True, market_cap=100.0))
        db.add(
            StockPrice(
                symbol="0700.HK",
                date=date(2026, 4, 1),
                open=1.0,
                high=1.0,
                low=1.0,
                close=1.0,
                volume=1000,
            )
        )
        db.commit()

    fetch_calls: list[dict] = []
    sleeps: list[float] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append({"symbols": list(symbols), "market": market})
            return {
                symbol: {
                    "price_data": None,
                    "has_error": True,
                    "error": "429 rate limited",
                }
                for symbol in symbols
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=SimpleNamespace(store_batch_in_cache=lambda *_args, **_kwargs: None),
        fetcher=_FakeFetcher(),
        sleep=lambda seconds: sleeps.append(seconds),
    )

    result = service.refresh(as_of_date=date(2026, 4, 2), market="HK")

    assert len(fetch_calls) == 2
    assert fetch_calls[1]["symbols"] == ["^HSI", "2800.HK", "3690.HK", "0941.HK"]
    assert sleeps == []
    assert result["rate_limited_retry"] == {
        "attempted": 0,
        "recovered": 0,
        "still_failed": 0,
        "wait_seconds": 0,
        "batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
    }


def test_static_daily_price_refresh_skips_retry_when_no_rate_limited_failures() -> None:
    session_factory = _sqlite_session_factory()
    _seed_in_universe(session_factory)

    fetch_calls: list[dict] = []
    sleeps: list[float] = []

    class _FakeFetcher:
        def fetch_prices_in_batches(self, symbols, period="2y", start_batch_size=None, market=None):
            fetch_calls.append({"symbols": list(symbols)})
            return {
                symbol: {
                    "price_data": None,
                    "has_error": True,
                    "error": "delisted: no price data",
                }
                for symbol in symbols
            }

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory,
        price_cache=SimpleNamespace(store_batch_in_cache=lambda *_args, **_kwargs: None),
        fetcher=_FakeFetcher(),
        sleep=lambda seconds: sleeps.append(seconds),
    )

    result = service.refresh(as_of_date=date(2026, 4, 2), market="IN")

    assert len(fetch_calls) == 2
    assert sleeps == []
    assert result["rate_limited_retry"]["attempted"] == 0
    assert result["key_market_symbols"] == len(IN_KEY_MARKET_PRICE_SYMBOLS)
    assert result["yahoo_failed_symbols"] == 6


def _guard_frames(value=100.0):
    end = pd.Timestamp.today().normalize()
    previous_end = end - pd.offsets.BDay(1)
    old = _history_frame(end=previous_end, periods=60, value=100.0)
    recent = _history_frame(end=end, periods=7, value=value)
    full = _history_frame(end=end, periods=len(old.index.union(recent.index)), value=value)
    return old, recent, full


def _guard_fixture(old, responses):
    """Use the normally imported service and its real SQLite date query."""
    session_factory = _sqlite_session_factory()
    with session_factory() as db:
        _seed_history(db, "A", frame=old)
        db.commit()
    calls, stored = [], []
    cache = _RecordingCache(session_factory, stored)

    class _Fetcher:
        def fetch_prices_in_batches(self, symbols, **kwargs):
            calls.append((list(symbols), kwargs["period"]))
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

    service = StaticDailyPriceRefreshService(
        session_factory=session_factory, price_cache=cache, fetcher=_Fetcher(), sleep=lambda _: None,
    )
    return service, cache, calls, stored, session_factory


def test_static_incremental_guard_stores_full_redis_but_only_provider_sql_rows():
    old, recent, _ = _guard_frames()
    originals = [frame.copy(deep=True) for frame in (old, recent)]
    service, cache, calls, stored, sessions = _guard_fixture(
        old, [{"A": {"price_data": recent, "has_error": False}}],
    )
    assert service._fetch_and_store(["A"], period="7d", batch_size=25, market="US") == (1, 0, [])
    assert calls == [(["A"], "7d")]
    assert len(cache.redis_frames["A"]) == len(old.index.union(recent.index))
    assert stored == [{"symbols": ["A"], "also_store_db": False, "market": "US"}]
    assert_frame_equal(cache.db_frames["A"], recent)
    # Existing SQL Adj Close is not re-created from a cached frame that lacks it.
    with sessions() as db:
        assert db.query(StockPrice).filter(StockPrice.symbol == "A").first().adj_close == 90.0
    assert "Adj Close" not in cache.redis_frames["A"]
    assert not cache.redis_frames["A"].isna().any().any()
    for actual, before in zip((old, recent), originals):
        assert_frame_equal(actual, before)


def test_static_incremental_guard_fetches_complete_historical_correction_once():
    old, recent, full = _guard_frames(value=101.0)
    before = full.copy(deep=True)
    service, cache, calls, _, _ = _guard_fixture(old, [
        {"A": {"price_data": recent, "has_error": False}},
        {"A": {"price_data": full, "has_error": False}},
    ])
    assert service._fetch_and_store(["A"], period="7d", batch_size=25, market="US") == (1, 0, [])
    assert calls == [(["A"], "7d"), (["A"], "2y")]
    assert_frame_equal(cache.db_frames["A"], full)
    assert_frame_equal(full, before)


def test_static_incremental_guard_real_sql_dates_preserve_hidden_invalid_row():
    old, recent, full = _guard_frames()
    old.iloc[0, old.columns.get_loc("High")] = 1.0
    # Cached-only hides this frame. The real SQLite date query must still
    # discover its first date and reject an otherwise coherent partial repair.
    service, cache, calls, stored, sessions = _guard_fixture(old, [
        {"A": {"price_data": recent, "has_error": False}},
        {"A": {"price_data": full.iloc[1:].copy(), "has_error": False}},
    ])
    assert cache.get_many_cached_only(["A"])["A"] is None
    assert service._fetch_and_store(["A"], period="7d", batch_size=25, market="US") == (0, 1, [])
    assert calls == [(["A"], "7d"), (["A"], "2y")]
    assert stored == [] and cache.db_frames == {}
    with sessions() as db:
        rows = db.query(StockPrice).filter(StockPrice.symbol == "A").order_by(StockPrice.date).all()
        assert len(rows) == len(old) and rows[0].high == 1.0


def test_static_incremental_guard_real_sql_short_listing_is_not_padded():
    old, recent, full = _guard_frames()
    old = old.iloc[-20:].copy()
    full = full.loc[old.index.union(recent.index)].copy()
    service, cache, calls, _, _ = _guard_fixture(old, [
        {"A": {"price_data": recent, "has_error": False}},
        {"A": {"price_data": full, "has_error": False}},
    ])
    assert cache.get_many_cached_only(["A"])["A"] is None
    assert service._fetch_and_store(["A"], period="7d", batch_size=25, market="US") == (1, 0, [])
    assert calls == [(["A"], "7d"), (["A"], "2y")]
    assert len(cache.db_frames["A"]) == len(full) < 50
    assert_frame_equal(cache.db_frames["A"], full)


def test_static_incremental_guard_full_fallback_failure_survives_retry_without_second_full():
    old, recent, _ = _guard_frames(value=40.0)
    service, cache, calls, stored, _ = _guard_fixture(old, [
        {"A": {"price_data": recent, "has_error": False}},
        {"A": {"has_error": True, "error": "429"}},
        {"A": {"price_data": recent, "has_error": False}},
    ])
    assert service._fetch_and_store(["A"], period="7d", batch_size=25, market="IN") == (0, 1, [])
    result = service._retry_rate_limited_failures(
        market="IN", rate_limited_symbols_by_period={"7d": ["A"]},
    )
    assert result["recovered"] == 0 and result["still_failed"] == 1
    assert calls == [(["A"], "7d"), (["A"], "2y"), (["A"], "7d")]
    assert stored == [] and cache.db_frames == {}

