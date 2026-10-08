"""Static-site daily price refresh orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

from app.models.stock import StockPrice
from app.models.stock_universe import StockUniverse
from app.services.bulk_data_fetcher import BulkDataFetcher
from app.services.price_history_coverage import classify_price_history
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


@dataclass
class StaticPriceFetchOutcome:
    fetched_symbols: set[str] = field(default_factory=set)
    persisted_symbols: set[str] = field(default_factory=set)
    failed_symbols: dict[str, str] = field(default_factory=dict)
    rate_limited_symbols: list[str] = field(default_factory=list)
    unexpected_result_symbols: set[str] = field(default_factory=set)
    submitted_rows: int = 0
    persisted_rows: int = 0

    def add(self, other: "StaticPriceFetchOutcome") -> None:
        self.fetched_symbols.update(other.fetched_symbols)
        self.persisted_symbols.update(other.persisted_symbols)
        self.failed_symbols.update(other.failed_symbols)
        self.rate_limited_symbols.extend(other.rate_limited_symbols)
        self.unexpected_result_symbols.update(other.unexpected_result_symbols)
        self.submitted_rows += other.submitted_rows
        self.persisted_rows += other.persisted_rows


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
    ) -> None:
        self._session_factory = session_factory
        self._price_cache = price_cache
        self._fetcher = fetcher
        self._batch_size_for_market = batch_size_for_market
        if sleep is None:
            import time

            sleep = time.sleep
        self._sleep = sleep

    def _target_session_symbols(self, symbols: list[str], as_of_date: date) -> set[str]:
        """Read exact persisted sessions; a later session alone is insufficient."""
        present: set[str] = set()
        with self._session_factory() as db:
            for chunk in _iter_chunks(symbols, 500):
                rows = (
                    db.query(StockPrice.symbol)
                    .filter(StockPrice.symbol.in_(chunk), StockPrice.date == as_of_date)
                    .distinct()
                    .all()
                )
                present.update(symbol for symbol, in rows)
        return present

    def refresh(
        self,
        *,
        as_of_date: date,
        market: str | None = None,
        symbols: list[str] | None = None,
    ) -> dict[str, Any]:
        """Refresh the selected published cohort and report committed coverage."""
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
            coverage = classify_price_history(db, symbols=supported_symbols, as_of_date=as_of_date)

        initial_target_symbols = self._target_session_symbols(supported_symbols, as_of_date)
        db_fresh_symbols = [symbol for symbol in supported_symbols if symbol in initial_target_symbols]
        no_history_symbols = list(coverage.no_history)
        no_history_set = set(no_history_symbols)
        stale_symbols = [
            symbol for symbol in supported_symbols
            if symbol not in initial_target_symbols and symbol not in no_history_set
        ]
        requested_symbols = stale_symbols + no_history_symbols
        outcome = StaticPriceFetchOutcome()
        retry_stats = {
            "attempted": 0, "recovered": 0, "still_failed": 0, "wait_seconds": 0,
            "batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
        }
        if requested_symbols:
            batch_size = self._batch_size_for_market(market)
            print(
                f"[static-daily prices] Refreshing {len(stale_symbols):,} stale and "
                f"{len(no_history_symbols):,} no-history symbols for {as_of_date} "
                f"(exact-session DB fresh: {len(db_fresh_symbols):,}).",
                flush=True,
            )
            stale_outcome = self._fetch_and_store(
                stale_symbols, period=STATIC_DAILY_PRICE_REFRESH_PERIOD,
                batch_size=batch_size, market=market,
            )
            bootstrap_outcome = self._fetch_and_store(
                no_history_symbols, period=STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD,
                batch_size=batch_size, market=market,
            )
            outcome.add(stale_outcome)
            outcome.add(bootstrap_outcome)
            retry_stats, retry_outcome = self._retry_rate_limited_failures(
                market=market, as_of_date=as_of_date,
                rate_limited_symbols_by_period={
                    STATIC_DAILY_PRICE_REFRESH_PERIOD: stale_outcome.rate_limited_symbols,
                    STATIC_DAILY_PRICE_BOOTSTRAP_PERIOD: bootstrap_outcome.rate_limited_symbols,
                },
            )
            outcome.add(retry_outcome)
        target_symbols = self._target_session_symbols(supported_symbols, as_of_date)
        missing_target = [symbol for symbol in supported_symbols if symbol not in target_symbols]
        for symbol in requested_symbols:
            if symbol in target_symbols:
                outcome.failed_symbols.pop(symbol, None)
            else:
                outcome.failed_symbols.setdefault(symbol, "target_session_missing")
        return {
            "status": "partial" if missing_target else ("completed" if requested_symbols else "skipped"),
            "market": market,
            "as_of_date": as_of_date.isoformat(),
            "total_active_symbols": len(active_symbols),
            "supported_symbols": len(supported_symbols),
            "key_market_symbols": len(key_market_symbols),
            "db_fresh_symbols": len(db_fresh_symbols),
            "stale_symbols": len(stale_symbols),
            "no_history_symbols": len(no_history_symbols),
            "skipped_unsupported_symbols": len(skipped_symbols),
            "selected_symbol_ids": list(supported_symbols),
            "requested_symbols": len(requested_symbols),
            "requested_symbol_ids": requested_symbols,
            "fetched_symbol_ids": sorted(outcome.fetched_symbols),
            "persisted_symbol_ids": sorted(outcome.persisted_symbols),
            "target_session_symbol_ids": [
                symbol for symbol in supported_symbols if symbol in target_symbols
            ],
            "yahoo_fetched_symbols": len(outcome.fetched_symbols),
            "yahoo_persisted_symbols": len(outcome.persisted_symbols),
            "yahoo_failed_symbols": len(outcome.failed_symbols),
            "submitted_rows": outcome.submitted_rows,
            "persisted_rows": outcome.persisted_rows,
            "target_session_symbols": len(target_symbols),
            "target_session_coverage": len(target_symbols) / len(supported_symbols) if supported_symbols else None,
            "missing_target_symbols": missing_target,
            "failure_details": dict(outcome.failed_symbols),
            "unexpected_result_symbols": sorted(outcome.unexpected_result_symbols),
            "rate_limited_retry": retry_stats,
        }

    def _fetch_and_store(
        self,
        symbols: list[str],
        *,
        period: str,
        batch_size: int,
        market: str | None,
    ) -> StaticPriceFetchOutcome:
        outcome = StaticPriceFetchOutcome()
        for batch_index, batch_symbols in enumerate(_iter_chunks(symbols, batch_size), start=1):
            print(
                f"[static-daily prices] Batch {batch_index}: fetching "
                f"{len(batch_symbols):,} requested symbols from Yahoo ({period}).",
                flush=True,
            )
            batch_results = self._fetcher.fetch_prices_in_batches(
                batch_symbols, period=period, start_batch_size=batch_size, market=market,
            )
            outcome.unexpected_result_symbols.update(set(batch_results) - set(batch_symbols))
            batch_to_store: dict[str, Any] = {}
            for symbol in batch_symbols:
                payload = batch_results.get(symbol)
                if payload is None:
                    outcome.failed_symbols[symbol] = "provider_result_missing"
                    continue
                price_data = payload.get("price_data")
                if not payload.get("has_error") and price_data is not None and not price_data.empty:
                    batch_to_store[symbol] = price_data
                    outcome.fetched_symbols.add(symbol)
                else:
                    outcome.failed_symbols[symbol] = str(payload.get("error") or "empty_provider_history")
                    if _is_rate_limit_failure(payload):
                        outcome.rate_limited_symbols.append(symbol)
            if batch_to_store:
                receipt = self._price_cache.store_batch_in_cache_with_receipt(batch_to_store, market=market)
                outcome.persisted_symbols.update(receipt.persisted_symbols)
                outcome.failed_symbols.update(receipt.rejected_symbols)
                outcome.submitted_rows += receipt.submitted_rows
                outcome.persisted_rows += receipt.persisted_rows
            print(
                f"[static-daily prices] Batch {batch_index} complete: "
                f"{len(outcome.fetched_symbols):,} fetched, "
                f"{len(outcome.persisted_symbols):,} committed, "
                f"{len(outcome.failed_symbols):,} failed.",
                flush=True,
            )
        return outcome

    def _retry_rate_limited_failures(
        self,
        *,
        market: str | None,
        as_of_date: date,
        rate_limited_symbols_by_period: dict[str, list[str]],
    ) -> tuple[dict[str, Any], StaticPriceFetchOutcome]:
        outcome = StaticPriceFetchOutcome()
        stats: dict[str, Any] = {
            "attempted": 0, "recovered": 0, "still_failed": 0, "wait_seconds": 0,
            "batch_size": STATIC_RATE_LIMITED_RETRY_BATCH_SIZE,
        }
        retry_groups = [
            (period, sorted(set(symbols)))
            for period, symbols in rate_limited_symbols_by_period.items() if symbols
        ]
        attempted = sum(len(symbols) for _period, symbols in retry_groups)
        if not attempted or (market or "").upper() not in STATIC_RATE_LIMITED_RETRY_MARKETS:
            return stats, outcome
        self._sleep(STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS)
        retry_symbols: list[str] = []
        for period, unique_symbols in retry_groups:
            retry_symbols.extend(unique_symbols)
            outcome.add(self._fetch_and_store(
                unique_symbols, period=period,
                batch_size=STATIC_RATE_LIMITED_RETRY_BATCH_SIZE, market=market,
            ))
        target_symbols = self._target_session_symbols(retry_symbols, as_of_date)
        recovered_symbols = outcome.persisted_symbols & target_symbols
        stats.update(
            attempted=attempted, recovered=len(recovered_symbols),
            still_failed=attempted - len(recovered_symbols),
            wait_seconds=STATIC_RATE_LIMITED_RETRY_WAIT_SECONDS,
        )
        return stats, outcome
