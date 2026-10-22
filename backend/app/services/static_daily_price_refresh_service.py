"""Static-site daily price refresh orchestration."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Callable

import pandas as pd

from app.models.stock import StockPrice
from app.models.stock_universe import StockUniverse
from app.services.bulk_data_fetcher import BulkDataFetcher
from app.services.cache.price_history_integrity import coherent_history, requires_full_history
from app.services.price_history_coverage import classify_price_history
from app.services.cache.price_history_diagnostics import (
    observe, observe_fetch_failure, observe_missing_responses, scoped,
)
from app.services.price_refresh_planning import (
    NO_HISTORY_PRICE_BOOTSTRAP_PERIOD,
    STALE_PRICE_TOP_UP_PERIOD,
)
from app.domain.providers.price_symbol_support import split_supported_price_symbols
from app.domain.markets.key_markets import key_market_price_symbols


STATIC_DAILY_PRICE_REFRESH_PERIOD = STALE_PRICE_TOP_UP_PERIOD
STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD = NO_HISTORY_PRICE_BOOTSTRAP_PERIOD
STATIC_DAILY_PRICE_REFRESH_BATCH_SIZE = 250

# Markets where Yahoo's 429 backoff windows are long enough that a single
# refresh pass routinely leaves a tail of rate-limited symbols. For these
# markets we wait ``STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS`` after the main
# loop and replay only the symbols whose failure looks transient, in a
# smaller batch (``STATIC_RATE_LIMITED_RETRY_BATCH_SIZE``).
STATIC_RATE_LIMITED_RETRY_MARKETS = frozenset({"IN"})
STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS = 300
STATIC_RATE_LIMITED_RETRY_BATCH_SIZE = 25
def static_daily_price_refresh_batch_size(market: str | None) -> int:
    if market:
        from app.services.rate_budget_policy import get_rate_budget_policy

        return get_rate_budget_policy().get_batch_size("yfinance", market)
    return STATIC_DAILY_PRICE_REFRESH_BATCH_SIZE


def _iter_chunks(items: list[str], chunk_size: int) -> list[list[str]]:
    return [items[index:index + chunk_size] for index in range(0, len(items), chunk_size)]


def _is_rate_limit_failure(payload: dict[str, Any]) -> bool:
    if not payload.get("has_error"):
        return False
    error = str(payload.get("error") or "").lower()
    if not error:
        return False
    indicators = ("rate", "429", "too many", "limit", "throttl")
    return any(token in error for token in indicators)


def _key_market_price_symbols(market: str | None) -> list[str]:
    return list(key_market_price_symbols(market))


def _dedupe_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in symbols:
        symbol = str(raw or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        result.append(symbol)
    return result


class StaticDailyPriceRefreshService:
    """Refresh price rows needed by the static-site snapshot build."""

    def __init__(
        self,
        *,
        session_factory,
        price_cache,
        fetcher: BulkDataFetcher,
        batch_size_for_market: Callable[[str | None], int] = static_daily_price_refresh_batch_size,
        sleep: Callable[[float], None] | None = None,
        observations: dict | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._price_cache = price_cache
        self._fetcher = fetcher
        self._batch_size_for_market = batch_size_for_market
        if sleep is None:
            import time

            sleep = time.sleep
        self._sleep = sleep
        self._observations = observations
        self._full_history_attempted: set[str] = set()

    def refresh(
        self,
        *,
        as_of_date: date,
        market: str | None = None,
        symbols: list[str] | None = None,
    ) -> dict[str, Any]:
        """Refresh price rows; ``symbols`` narrows the candidate set.

        The fast post-close publish passes the chart-relevant subset (top of
        the published feature run + key markets) — fresh closes only surface
        through chart payloads there, and refreshing the full ~10k universe
        cost 52 of its 84 pipeline minutes (C57 measurement).
        """
        self._full_history_attempted.clear()
        with self._session_factory() as db:
            if symbols is not None:
                active_symbols = list(symbols)
            else:
                query = (
                    db.query(StockUniverse.symbol)
                    .filter(StockUniverse.is_active.is_(True))
                    .order_by(StockUniverse.market_cap.desc().nullslast(), StockUniverse.symbol.asc())
                )
                if market is not None:
                    query = query.filter(StockUniverse.market == market)
                active_symbols = [symbol for symbol, in query.all()]
            key_market_symbols = _key_market_price_symbols(market)
            refresh_candidates = _dedupe_symbols(active_symbols + key_market_symbols)
            supported_symbols, skipped_symbols = split_supported_price_symbols(refresh_candidates)
            coverage = classify_price_history(
                db,
                symbols=supported_symbols,
                as_of_date=as_of_date,
            )

        db_fresh_symbols = list(coverage.fresh)
        stale_symbols = list(coverage.stale)
        no_history_symbols = list(coverage.no_history)
        if self._observations is not None:
            for status, symbols_in_group in (
                ("fresh", coverage.fresh), ("stale", coverage.stale),
                ("no_history", coverage.no_history), ("unsupported", skipped_symbols),
            ):
                for symbol in symbols_in_group:
                    observe(self._observations, "refresh_coverage", symbol=symbol,
                            status=status, as_of_date=as_of_date)

        if not stale_symbols and not no_history_symbols:
            print(
                f"[static-daily prices] Database already has fresh price rows for "
                f"{len(db_fresh_symbols):,} supported symbols as of {as_of_date}.",
                flush=True,
            )
            return {
                "status": "skipped",
                "market": market,
                "as_of_date": as_of_date.isoformat(),
                "total_active_symbols": len(active_symbols),
                "supported_symbols": len(supported_symbols),
                "key_market_symbols": len(key_market_symbols),
                "db_fresh_symbols": len(db_fresh_symbols),
                "stale_symbols": len(stale_symbols),
                "no_history_symbols": len(no_history_symbols),
                "skipped_unsupported_symbols": len(skipped_symbols),
                "yahoo_fetched_symbols": 0,
                "yahoo_failed_symbols": 0,
            }

        batch_size = self._batch_size_for_market(market)
        total_batches = (
            (len(stale_symbols) + batch_size - 1) // batch_size
            + (len(no_history_symbols) + batch_size - 1) // batch_size
        )

        print(
            f"[static-daily prices] Refreshing {len(stale_symbols):,} stale and "
            f"{len(no_history_symbols):,} no-history symbols in {total_batches} batches for {as_of_date} "
            f"(DB fresh: {len(db_fresh_symbols):,}, unsupported skipped: {len(skipped_symbols):,}).",
            flush=True,
        )

        stale_refreshed, stale_failed, stale_rate_limited = self._fetch_and_store(
            stale_symbols,
            period=STATIC_DAILY_PRICE_REFRESH_PERIOD,
            batch_size=batch_size,
            market=market,
        )
        bootstrap_refreshed, bootstrap_failed, bootstrap_rate_limited = self._fetch_and_store(
            no_history_symbols,
            period=STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            batch_size=batch_size,
            market=market,
        )
        refreshed = stale_refreshed + bootstrap_refreshed
        failed = stale_failed + bootstrap_failed
        retry_stats = self._retry_rate_limited_failures(
            market=market,
            rate_limited_symbols_by_period={
                STATIC_DAILY_PRICE_REFRESH_PERIOD: stale_rate_limited,
                STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD: bootstrap_rate_limited,
            },
        )
        refreshed += retry_stats["recovered"]
        failed -= retry_stats["recovered"]

        return {
            "status": "completed",
            "market": market,
            "as_of_date": as_of_date.isoformat(),
            "total_active_symbols": len(active_symbols),
            "supported_symbols": len(supported_symbols),
            "key_market_symbols": len(key_market_symbols),
            "db_fresh_symbols": len(db_fresh_symbols),
            "stale_symbols": len(stale_symbols),
            "no_history_symbols": len(no_history_symbols),
            "skipped_unsupported_symbols": len(skipped_symbols),
            "yahoo_fetched_symbols": refreshed,
            "yahoo_failed_symbols": failed,
            "rate_limited_retry": retry_stats,
        }

    def _fetch_and_store(
        self,
        symbols: list[str],
        *,
        period: str,
        batch_size: int,
        market: str | None,
    ) -> tuple[int, int, list[str]]:
        refreshed_count = 0
        failed_count = 0
        rate_limited: list[str] = []
        total_symbols = len(symbols)
        if not symbols:
            return 0, 0, []
        total_group_batches = (total_symbols + batch_size - 1) // batch_size
        for batch_index, batch_symbols in enumerate(
            _iter_chunks(symbols, batch_size),
            start=1,
        ):
            processed_before = refreshed_count + failed_count
            print(
                f"[static-daily prices] Batch {batch_index}/{total_group_batches}: "
                f"{processed_before:,}/{total_symbols:,} processed, fetching "
                f"{len(batch_symbols):,} symbols from Yahoo ({period}).",
                flush=True,
            )
            trace = scoped(self._observations, source="refresh", batch=batch_index, period=period)
            try:
                batch_results = self._fetcher.fetch_prices_in_batches(
                    batch_symbols,
                    period=period,
                    start_batch_size=batch_size,
                    market=market,
                )
            except Exception as error:
                for symbol in batch_symbols:
                    observe(trace, "refresh_fetch", symbol=symbol, status="raised",
                            exception_type=type(error).__name__)
                raise
            observe_missing_responses(trace, batch_symbols, batch_results)
            batch_results = self._guard_incremental_results(
                batch_symbols, batch_results, period=period,
                batch_size=batch_size, market=market, observations=trace,
            )
            batch_to_store: dict[str, Any] = {}
            db_batch_to_store: dict[str, Any] = {}
            for symbol, payload in batch_results.items():
                price_data = payload.get("price_data")
                if not payload.get("has_error") and price_data is not None and not price_data.empty:
                    observe(trace, "refresh_fetch", symbol=symbol, frame=price_data, status="received")
                    batch_to_store[symbol] = price_data
                    db_batch_to_store[symbol] = payload.get("_db_price_data", price_data)
                    refreshed_count += 1
                else:
                    observe_fetch_failure(trace, symbol, payload)
                    failed_count += 1
                    if not payload.get("full_history_attempted") and _is_rate_limit_failure(payload):
                        rate_limited.append(symbol)
            if batch_to_store:
                self._store_validated_batch(
                    batch_to_store, db_batch_to_store, market=market, observations=trace,
                )
            print(
                f"[static-daily prices] Batch {batch_index}/{total_group_batches} complete: "
                f"{refreshed_count + failed_count:,}/{total_symbols:,} processed, "
                f"{refreshed_count:,} refreshed, {failed_count:,} failed.",
                flush=True,
            )
        return refreshed_count, failed_count, rate_limited

    def _store_validated_batch(self, cache_data, db_data, *, market, observations=None):
        kwargs = {"observations": observations} if self._observations is not None else {}
        if any(db_data[symbol] is not frame for symbol, frame in cache_data.items()):
            # DB cache reads omit Adj Close. Do not overwrite untouched provider
            # fields with values synthesized by concatenating the cached frame.
            self._price_cache.store_batch_in_cache(
                cache_data, also_store_db=False, market=market, **kwargs,
            )
            self._price_cache._store_batch_in_database(db_data, **kwargs)
        else:
            self._price_cache.store_batch_in_cache(
                cache_data, also_store_db=True, market=market, **kwargs,
            )

    def _guard_incremental_results(
        self, symbols, results, *, period, batch_size, market, observations=None,
    ):
        """Validate selected top-ups before either cache can be overwritten.

        This does not expand refresh selection or declare short listings fit
        for publication. A full-history retry is bounded to one per symbol per
        refresh, and must replace every known session in the cache's 2y window.
        """
        # Provider responses cannot add symbols outside the requested batch.
        results = {symbol: results[symbol] for symbol in symbols if symbol in results}
        if period != STATIC_DAILY_PRICE_REFRESH_PERIOD:
            return results
        received = {
            symbol: payload for symbol, payload in results.items()
            if not payload.get("has_error") and payload.get("price_data") is not None
            and not payload["price_data"].empty
        }
        if not received:
            return results

        def reject(symbol, reason):
            results[symbol] = {
                "has_error": True, "price_data": None, "error": reason,
                "full_history_attempted": symbol in self._full_history_attempted,
            }
            observe(observations, "cache_prepare", symbol=symbol,
                    status="rejected", rejection=reason)

        try:
            cached = self._price_cache.get_many_cached_only(
                list(received), period=STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
            )
        except Exception:
            for symbol in received:
                reject(symbol, "cached_history_read_failed")
            return results

        fallback = []
        for symbol, payload in received.items():
            previous, recent = cached.get(symbol), payload["price_data"]
            try:
                needs_full = requires_full_history(previous, recent)
                if not needs_full:
                    left, right = previous.copy(), recent.copy()
                    left.index = pd.to_datetime(left.index).tz_localize(None)
                    right.index = pd.to_datetime(right.index).tz_localize(None)
                    merged = pd.concat([left, right])
                    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
                    # Cached SQL histories omit Adj Close. Do not introduce a
                    # partial optional price column into the full Redis history.
                    if "Adj Close" not in previous.columns and "Adj Close" in merged.columns:
                        merged = merged.drop(columns=["Adj Close"])
                    # Keep full history in Redis as well as validating DB upserts.
                    if coherent_history(merged):
                        results[symbol] = {
                            **payload, "price_data": merged, "_db_price_data": recent,
                        }
                        continue
            except Exception:
                # A malformed or hidden cache is not permission to write a delta.
                pass
            if symbol in self._full_history_attempted:
                reject(symbol, "full_history_retry_exhausted")
            else:
                fallback.append(symbol)
        if not fallback:
            return results

        # Cached-only reads intentionally hide short/incoherent histories.
        # Read dates, not an invented cleaned history, so a full response cannot
        # leave an omitted corrupt row behind in the upsert-only database.
        try:
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=730)
            required = {
                symbol: set(pd.to_datetime(received[symbol]["price_data"].index)
                            .tz_localize(None).normalize())
                for symbol in fallback
            }
            with self._session_factory() as db:
                rows = db.query(StockPrice.symbol, StockPrice.date).filter(
                    StockPrice.symbol.in_(fallback),
                    StockPrice.date >= start_date,
                    StockPrice.date <= end_date,
                ).all()
            for symbol, row_date in rows:
                required[symbol].add(pd.Timestamp(row_date).normalize())
        except Exception:
            for symbol in fallback:
                reject(symbol, "retained_history_dates_unavailable")
            return results

        self._full_history_attempted.update(fallback)
        trace = scoped(observations, period=STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
                       source="refresh")
        try:
            full_results = self._fetcher.fetch_prices_in_batches(
                fallback, period=STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
                start_batch_size=batch_size, market=market,
            )
        except Exception:
            for symbol in fallback:
                reject(symbol, "full_history_fetch_failed")
            return results
        observe_missing_responses(trace, fallback, full_results)
        for symbol in fallback:
            payload = full_results.get(symbol, {})
            frame = payload.get("price_data")
            try:
                valid = not payload.get("has_error") and coherent_history(frame)
                supplied = (set(pd.to_datetime(frame.index).tz_localize(None).normalize())
                            if valid else set())
                valid = valid and required[symbol].issubset(supplied)
            except Exception:
                valid = False
            if not valid:
                reject(symbol, "full_history_invalid_or_incomplete")
                continue
            results[symbol] = {**payload, "full_history_attempted": True}
            observe(trace, "refresh_fetch", symbol=symbol, frame=frame, status="received")
        return results

    def _retry_rate_limited_failures(
        self,
        *,
        market: str | None,
        rate_limited_symbols_by_period: dict[str, list[str]],
    ) -> dict[str, Any]:
        skipped_payload: dict[str, Any] = {
            "attempted": 0,
            "recovered": 0,
            "still_failed": 0,
            "wait_seconds": 0,
            "batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
        }
        retry_groups = [
            (period, sorted(set(symbols)))
            for period, symbols in rate_limited_symbols_by_period.items()
            if symbols
        ]
        attempted = sum(len(symbols) for _period, symbols in retry_groups)
        if not attempted:
            return skipped_payload
        normalized = (market or "").upper()
        if normalized not in STATIC_RATE_LIMITED_RETRY_MARKETS:
            print(
                f"[static-daily prices] Skipping rate-limited retry for market={normalized or 'shared'}: "
                f"{attempted} symbols looked throttled but market is outside the retry allowlist.",
                flush=True,
            )
            return skipped_payload

        print(
            f"[static-daily prices:{normalized}] Yahoo flagged {attempted} symbols as rate-limited; "
            f"waiting {STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS}s then retrying with batch size "
            f"{STATIC_RATE_LIMITED_RETRY_BATCH_SIZE}.",
            flush=True,
        )
        self._sleep(STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS)

        recovered = 0
        for period, unique_symbols in retry_groups:
            retry_results = self._fetcher.fetch_prices_in_batches(
                unique_symbols,
                period=period,
                start_batch_size=STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
                market=market,
            )
            retry_results = self._guard_incremental_results(
                unique_symbols, retry_results, period=period,
                batch_size=STATIC_RATE_LIMITED_RETRY_BATCH_SIZE, market=market,
                observations=self._observations,
            )
            recovered_payload: dict[str, Any] = {}
            recovered_db_payload: dict[str, Any] = {}
            for symbol, payload in retry_results.items():
                price_data = payload.get("price_data")
                if not payload.get("has_error") and price_data is not None and not price_data.empty:
                    recovered_payload[symbol] = price_data
                    recovered_db_payload[symbol] = payload.get("_db_price_data", price_data)
                    recovered += 1
            if recovered_payload:
                self._store_validated_batch(
                    recovered_payload, recovered_db_payload, market=market,
                    observations=self._observations,
                )
        still_failed = attempted - recovered
        print(
            f"[static-daily prices:{normalized}] Rate-limited retry complete: "
            f"{recovered}/{attempted} recovered, {still_failed} still failed.",
            flush=True,
        )
        return {
            "attempted": attempted,
            "recovered": recovered,
            "still_failed": still_failed,
            "wait_seconds": STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS,
            "batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
        }

