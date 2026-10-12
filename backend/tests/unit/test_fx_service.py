"""Unit tests for the FX service (T3).

Covers the three-tier lookup chain (memo / Redis / DB / fetcher), the
USD identity short-circuit, and the FXQuote → metadata serialisation
that fundamentals storage consumes.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import time
from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.services.fx_service import (
    FXQuote,
    FXService,
    MARKET_CURRENCY_MAP,
    SUPPORTED_CURRENCIES,
    currency_for_market,
    default_currency_for_market,
)


# --- currency_for_market ---------------------------------------------------

class TestCurrencyForMarket:
    def test_default_currency_for_market_is_explicit_fallback_name(self):
        assert default_currency_for_market("US") == "USD"
        assert default_currency_for_market("HK") == "HKD"

    def test_known_markets(self):
        assert currency_for_market("US") == "USD"
        assert currency_for_market("HK") == "HKD"
        assert currency_for_market("IN") == "INR"
        assert currency_for_market("JP") == "JPY"
        assert currency_for_market("KR") == "KRW"
        assert currency_for_market("TW") == "TWD"
        assert currency_for_market("CN") == "CNY"
        assert currency_for_market("SG") == "SGD"
        assert currency_for_market("CA") == "CAD"
        assert currency_for_market("DE") == "EUR"

    def test_case_insensitive_and_trimmed(self):
        assert currency_for_market("  hk  ") == "HKD"
        assert currency_for_market("jp") == "JPY"

    def test_unknown_or_none_defaults_to_usd(self):
        assert currency_for_market(None) == "USD"
        assert currency_for_market("") == "USD"
        assert currency_for_market("XX") == "USD"

    def test_supported_set_matches_map(self):
        from app.domain.markets.catalog import get_market_catalog

        catalog = get_market_catalog()
        expected = frozenset(
            currency
            for market in catalog.supported_market_codes()
            for currency in catalog.get(market).supported_currencies
        )

        assert SUPPORTED_CURRENCIES == expected

    def test_agrees_with_security_master_defaults(self):
        """Fallback defaults mirror SecurityMaster's boot-time defaults.

        Row-level FX must use StockUniverse.currency instead of this map.
        """
        from app.services import security_master_service as sm
        for market, currency in MARKET_CURRENCY_MAP.items():
            sm_currency, _tz = sm._MARKET_DEFAULTS[market]
            assert sm_currency == currency, (
                f"Market {market!r}: fx_service says {currency!r}, "
                f"security_master says {sm_currency!r}."
            )
        assert set(MARKET_CURRENCY_MAP.keys()) == set(sm._MARKET_DEFAULTS.keys())

    def test_default_currency_map_comes_from_market_catalog(self):
        from app.domain.markets.catalog import get_market_catalog

        catalog = get_market_catalog()
        assert MARKET_CURRENCY_MAP == {
            market: catalog.get(market).default_currency
            for market in catalog.supported_market_codes()
        }

    def test_market_currency_fallback_is_not_used_by_fundamentals_cache_service(self):
        service_source = (
            Path(__file__).resolve().parents[2]
            / "app"
            / "services"
            / "fundamentals_cache_service.py"
        ).read_text()

        assert "currency_for_market" not in service_source


# --- FXQuote ---------------------------------------------------------------

class TestFXQuoteSerialisation:
    def test_metadata_roundtrip_keys(self):
        quote = FXQuote(
            from_currency="HKD", to_currency="USD",
            rate=0.128, as_of_date=date(2026, 4, 12), source="yfinance",
        )
        meta = quote.to_metadata()
        assert meta == {
            "from_currency": "HKD",
            "to_currency": "USD",
            "rate": 0.128,
            "as_of_date": "2026-04-12",
            "source": "yfinance",
        }


# --- FXService -------------------------------------------------------------

def _make_service(rate_fetcher=None, db_rows=None):
    """Return an FXService wired with mocks and no Redis/DB."""
    fake_db = MagicMock()
    # _read_database uses .order_by().first(); stub accordingly. None = no
    # persisted rate, forces the fetcher path.
    fake_db.query.return_value.filter.return_value.order_by.return_value.first.return_value = db_rows
    return FXService(
        rate_fetcher=rate_fetcher or (lambda c: None),
        session_factory=lambda: fake_db,
        redis_client=None,
    )


class TestUSDIdentity:
    def test_usd_returns_identity_quote_without_fetcher(self):
        fetcher = MagicMock()
        svc = _make_service(rate_fetcher=fetcher)
        quote = svc.get_usd_rate("USD")
        assert quote is not None
        assert quote.rate == 1.0
        assert quote.source == FXService.SOURCE_IDENTITY
        fetcher.assert_not_called()


@pytest.fixture(params=[date(2026, 6, 8), date(2026, 6, 14)], ids=["weekday", "weekend"])
def fx_clock(monkeypatch, request):
    """Exercise stale/fresh contracts independently of the execution date."""
    import app.services.fx_service as fx_module

    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls.fromordinal(request.param.toordinal())

    monkeypatch.setattr(fx_module, "date", FixedDate)
    return FixedDate.today()


class TestLookupChain:
    def test_fetcher_called_when_cache_and_db_empty(self):
        calls = []

        def fetcher(currency):
            calls.append(currency)
            return 0.128

        svc = _make_service(rate_fetcher=fetcher)
        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.rate == 0.128
        assert quote.source == FXService.SOURCE_FETCHER
        assert calls == ["HKD"]

    def test_memo_short_circuits_repeat_call(self):
        calls = []

        def fetcher(currency):
            calls.append(currency)
            return 0.128

        svc = _make_service(rate_fetcher=fetcher)
        svc.get_usd_rate("HKD")
        svc.get_usd_rate("HKD")
        svc.get_usd_rate("HKD")
        assert calls == ["HKD"]  # fetcher hit exactly once

    def test_missing_rate_returns_none(self):
        svc = _make_service(rate_fetcher=lambda c: None)
        assert svc.get_usd_rate("HKD") is None

    def test_fetcher_tuple_uses_market_date(self):
        market_date = date(2026, 4, 10)
        svc = _make_service(rate_fetcher=lambda c: (0.128, market_date))
        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.rate == 0.128
        assert quote.as_of_date == market_date
        assert quote.source == FXService.SOURCE_FETCHER

    def test_fetcher_tuple_can_provide_explicit_source(self):
        market_date = date(2026, 4, 10)
        svc = _make_service(rate_fetcher=lambda c: (0.128, market_date, "ecb"))
        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.source == "ecb"

    def test_stale_database_quote_does_not_block_fresh_fetch(self, fx_clock):
        stale_row = MagicMock()
        stale_row.from_currency = "HKD"
        stale_row.to_currency = "USD"
        stale_row.rate = 0.12
        stale_row.as_of_date = FXService._latest_trading_close(fx_clock) - timedelta(days=1)
        stale_row.source = "yfinance"
        calls = []

        def fetcher(currency):
            calls.append(currency)
            return 0.128

        svc = _make_service(rate_fetcher=fetcher, db_rows=stale_row)
        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.rate == 0.128
        assert quote.source == FXService.SOURCE_FETCHER
        assert quote.as_of_date == fx_clock
        assert calls == ["HKD"]

    def test_stale_database_quote_is_fallback_when_fetch_unavailable(self, fx_clock):
        stale_row = MagicMock()
        stale_row.from_currency = "HKD"
        stale_row.to_currency = "USD"
        stale_row.rate = 0.12
        stale_row.as_of_date = FXService._latest_trading_close(fx_clock) - timedelta(days=1)
        stale_row.source = "yfinance"
        svc = _make_service(rate_fetcher=lambda c: None, db_rows=stale_row)
        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.rate == 0.12
        assert quote.source == "yfinance"

    def test_stale_database_fallback_suppresses_repeated_live_fetches(self, fx_clock):
        stale_row = MagicMock()
        stale_row.from_currency = "JPY"
        stale_row.to_currency = "USD"
        stale_row.rate = 0.0064
        stale_row.as_of_date = FXService._latest_trading_close(fx_clock) - timedelta(days=1)
        stale_row.source = "yfinance"
        calls = []

        def fetcher(currency):
            calls.append(currency)
            return None

        svc = _make_service(rate_fetcher=fetcher, db_rows=stale_row)

        first = svc.get_usd_rate("JPY")
        second = svc.get_usd_rate("JPY")
        third = svc.get_usd_rate("JPY")

        assert first is not None and first.rate == 0.0064
        assert second is not None and second.rate == 0.0064
        assert third is not None and third.rate == 0.0064
        assert calls == ["JPY"]

    def test_quote_one_day_ahead_of_system_date_is_fresh(self, monkeypatch):
        import app.services.fx_service as fx_module

        class _UtcMonday(date):
            @classmethod
            def today(cls):
                return cls(2026, 6, 8)  # Monday in UTC

        monkeypatch.setattr(fx_module, "date", _UtcMonday)

        calls = []

        def fetcher(currency):
            calls.append(currency)
            return 0.0065

        svc = _make_service(rate_fetcher=fetcher)
        svc._memo["JPY"] = FXQuote(
            from_currency="JPY",
            to_currency="USD",
            rate=0.0064,
            as_of_date=_UtcMonday(2026, 6, 9),  # Tuesday in JP/TW/HK local time
            source="yfinance",
        )

        quote = svc.get_usd_rate("JPY")

        assert quote is not None
        assert quote.rate == 0.0064
        assert calls == []

    def test_stale_fetch_suppression_still_accepts_fresh_redis_quote(self, monkeypatch, fx_clock):
        stale_quote = FXQuote(
            from_currency="JPY",
            to_currency="USD",
            rate=0.0064,
            as_of_date=FXService._latest_trading_close(fx_clock) - timedelta(days=1),
            source="yfinance",
        )
        fresh_quote = FXQuote(
            from_currency="JPY",
            to_currency="USD",
            rate=0.0065,
            as_of_date=fx_clock,
            source="yfinance",
        )
        calls = []

        def fetcher(currency):
            calls.append(currency)
            return None

        svc = _make_service(rate_fetcher=fetcher)
        svc._memo["JPY"] = stale_quote
        svc._stale_fallback_retry_after["JPY"] = (
            stale_quote,
            time.monotonic() + 60,
            svc._latest_trading_close(fx_clock),
        )
        monkeypatch.setattr(svc, "_read_redis", lambda _currency: fresh_quote)

        quote = svc.get_usd_rate("JPY")

        assert quote is fresh_quote
        assert calls == []
        assert "JPY" not in svc._stale_fallback_retry_after

    def test_database_source_is_preserved_on_rehydrate(self):
        db_row = MagicMock()
        db_row.from_currency = "HKD"
        db_row.to_currency = "USD"
        db_row.rate = 0.128
        db_row.as_of_date = date.today()
        db_row.source = "yfinance"
        svc = _make_service(rate_fetcher=lambda c: 999, db_rows=db_row)
        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.source == "yfinance"

    def test_latest_trading_close_rolls_weekend_to_friday(self):
        svc = _make_service()
        assert svc._latest_trading_close(date(2026, 4, 11)) == date(2026, 4, 10)
        assert svc._latest_trading_close(date(2026, 4, 12)) == date(2026, 4, 10)

    def test_weekend_uses_friday_quote_without_refetch(self, monkeypatch):
        import app.services.fx_service as fx_module

        class _Sunday(date):
            @classmethod
            def today(cls):
                return cls(2026, 4, 12)  # Sunday

        monkeypatch.setattr(fx_module, "date", _Sunday)

        fetcher = MagicMock(return_value=0.128)
        svc = _make_service(rate_fetcher=fetcher)
        svc._memo["HKD"] = FXQuote(
            from_currency="HKD",
            to_currency="USD",
            rate=0.127,
            as_of_date=_Sunday(2026, 4, 10),  # Friday close
            source="yfinance",
        )

        quote = svc.get_usd_rate("HKD")
        assert quote is not None
        assert quote.rate == 0.127
        fetcher.assert_not_called()


class TestPersistence:
    def test_postgres_persist_uses_atomic_upsert(self):
        fake_db = MagicMock()
        fake_bind = MagicMock()
        fake_bind.dialect.name = "postgresql"
        fake_db.get_bind.return_value = fake_bind
        svc = FXService(
            rate_fetcher=lambda c: None,
            session_factory=lambda: fake_db,
            redis_client=None,
        )
        quote = FXQuote(
            from_currency="JPY",
            to_currency="USD",
            rate=0.0062,
            as_of_date=date(2026, 4, 30),
            source="yfinance",
        )

        svc._persist_database(quote)

        fake_db.add.assert_not_called()
        fake_db.execute.assert_called_once()
        statement = fake_db.execute.call_args.args[0]
        compiled = str(statement.compile(dialect=postgresql.dialect()))
        assert "ON CONFLICT ON CONSTRAINT uq_fx_rates_currency_date_source" in compiled
        assert "DO UPDATE SET rate = excluded.rate" in compiled
        fake_db.commit.assert_called_once()
        fake_db.close.assert_called_once()


class TestConvertToUSD:
    def test_usd_amount_unchanged(self):
        svc = _make_service()
        usd, quote = svc.convert_to_usd(1_000_000, "USD")
        assert usd == 1_000_000
        assert quote is not None
        assert quote.rate == 1.0

    def test_non_usd_amount_scaled(self):
        svc = _make_service(rate_fetcher=lambda c: 0.13)
        usd, quote = svc.convert_to_usd(1_000_000, "HKD")
        assert usd == pytest.approx(130_000)
        assert quote.from_currency == "HKD"

    def test_none_amount_returns_none(self):
        svc = _make_service(rate_fetcher=lambda c: 0.13)
        usd, quote = svc.convert_to_usd(None, "HKD")
        assert usd is None
        assert quote is None

    def test_missing_rate_returns_none_pair(self):
        svc = _make_service(rate_fetcher=lambda c: None)
        usd, quote = svc.convert_to_usd(1_000, "HKD")
        assert usd is None and quote is None

    def test_none_currency_returns_none_pair(self):
        svc = _make_service()
        usd, quote = svc.convert_to_usd(1_000, None)
        assert usd is None and quote is None


class TestInputNormalisation:
    def test_case_insensitive(self):
        svc = _make_service(rate_fetcher=lambda c: 0.128)
        quote = svc.get_usd_rate("hkd")
        assert quote is not None
        assert quote.from_currency == "HKD"

    def test_whitespace_handled(self):
        svc = _make_service(rate_fetcher=lambda c: 0.128)
        quote = svc.get_usd_rate("  HKD  ")
        assert quote is not None
        assert quote.from_currency == "HKD"

    def test_empty_string_returns_none(self):
        svc = _make_service(rate_fetcher=lambda c: 0.128)
        assert svc.get_usd_rate("") is None


class TestPrefetch:
    def test_prefetch_warms_memo_and_skips_unavailable(self):
        rates = {"HKD": 0.128, "JPY": 0.0065, "TWD": None}
        svc = _make_service(rate_fetcher=lambda c: rates.get(c))
        quotes = svc.prefetch(["HKD", "JPY", "TWD", "USD"])
        assert set(quotes.keys()) == {"HKD", "JPY", "USD"}
        # Subsequent lookup must not re-fetch.
        calls = []
        svc._rate_fetcher = lambda c: (calls.append(c), 999)[1]
        svc.get_usd_rate("HKD")
        assert calls == []


@pytest.mark.parametrize("cooldown", [False, True], ids=["fetch-unavailable", "retry-suppressed"])
def test_stale_fallback_keeps_newest_observed_quote(monkeypatch, fx_clock, cooldown):
    """An older Redis entry must never replace a newer memo or its date."""
    latest_close = FXService._latest_trading_close(fx_clock)
    older = FXQuote("JPY", "USD", 0.0060, latest_close - timedelta(days=3), "older-cache")
    newer = FXQuote("JPY", "USD", 0.0065, latest_close - timedelta(days=1), "newer-cache")
    fetcher = MagicMock(return_value=None)
    svc = _make_service(rate_fetcher=fetcher)
    svc._memo["JPY"] = newer
    monkeypatch.setattr(svc, "_read_redis", lambda _: older)
    write = MagicMock()
    monkeypatch.setattr(svc, "_write_redis", write)
    if cooldown:
        svc._stale_fallback_retry_after["JPY"] = (older, time.monotonic() + 60, latest_close)

    amount, quote = svc.convert_to_usd(1_000_000, "JPY")

    assert quote is newer
    assert amount == 6500
    assert quote.as_of_date == latest_close - timedelta(days=1)
    assert not svc._is_fresh_quote_date(quote.as_of_date, today=fx_clock, latest_close=latest_close)
    if cooldown:
        fetcher.assert_not_called()
    else:
        fetcher.assert_called_once_with("JPY")
        write.assert_called_once_with(newer)


@pytest.mark.parametrize("tier", ["redis", "database"])
def test_retry_cooldown_accepts_newer_stale_cache_quote(monkeypatch, fx_clock, tier):
    """Cooldown suppresses upstream retries, not newly available cached evidence."""
    latest_close = FXService._latest_trading_close(fx_clock)
    older = FXQuote("JPY", "USD", 0.0060, latest_close - timedelta(days=3), "old")
    newer = FXQuote("JPY", "USD", 0.0065, latest_close - timedelta(days=1), tier)
    fetcher = MagicMock(return_value=None)
    svc = _make_service(rate_fetcher=fetcher)
    svc._memo["JPY"] = older
    deadline = time.monotonic() + 60
    svc._stale_fallback_retry_after["JPY"] = (older, deadline, latest_close)
    monkeypatch.setattr(svc, "_read_redis", lambda _: newer if tier == "redis" else None)
    monkeypatch.setattr(svc, "_read_database", lambda _: newer if tier == "database" else None)

    assert svc.get_usd_rate("JPY") is newer
    assert svc.get_usd_rate("JPY") is newer
    fetcher.assert_not_called()
    assert svc._stale_fallback_retry_after["JPY"][1] == deadline


@pytest.mark.parametrize("boundary", ["retry-deadline", "trading-day-change"])
def test_stale_fallback_is_retried_when_suppression_boundary_changes(monkeypatch, boundary):
    import app.services.fx_service as fx_module

    clock = {"today": date(2026, 6, 8), "monotonic": 100.0}

    class MovingDate(date):
        @classmethod
        def today(cls):
            return clock["today"]

    monkeypatch.setattr(fx_module, "date", MovingDate)
    monkeypatch.setattr(fx_module.time, "monotonic", lambda: clock["monotonic"])
    old = FXQuote("JPY", "USD", 0.0060, date(2026, 6, 4), "old-cache")
    fetcher = MagicMock(side_effect=[None, 0.0065])
    svc = _make_service(rate_fetcher=fetcher)
    monkeypatch.setattr(svc, "_read_redis", lambda _: old)
    monkeypatch.setattr(svc, "_read_database", lambda _: None)
    monkeypatch.setattr(svc, "_write_redis", MagicMock())
    persist = MagicMock()
    monkeypatch.setattr(svc, "_persist_database", persist)

    assert svc.get_usd_rate("JPY") is old
    deadline = svc._stale_fallback_retry_after["JPY"][1]
    clock["monotonic"] = deadline - 1
    assert svc.get_usd_rate("JPY") is old
    fetcher.assert_called_once_with("JPY")

    if boundary == "retry-deadline":
        clock["monotonic"] = deadline
    else:
        clock["today"] = date(2026, 6, 9)
        assert clock["monotonic"] < deadline

    quote = svc.get_usd_rate("JPY")
    assert fetcher.call_count == 2
    assert [call.args for call in fetcher.call_args_list] == [("JPY",), ("JPY",)]
    assert quote.rate == 0.0065
    assert quote.as_of_date == clock["today"]
    assert "JPY" not in svc._stale_fallback_retry_after
    persist.assert_called_once_with(quote)
    assert svc.get_usd_rate("JPY") is quote
    assert fetcher.call_count == 2
