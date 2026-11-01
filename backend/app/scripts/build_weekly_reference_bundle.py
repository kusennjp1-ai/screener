"""Build market-scoped weekly fundamentals reference bundles for static-site workflows."""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime
import os
from pathlib import Path
from typing import Any

from app.database import SessionLocal
from app.models.stock_universe import StockUniverse
from app.scripts._runtime import prepare_runtime, repo_root
from app.services.official_market_universe_source_service import (
    OfficialMarketUniverseSourceService,
)
from app.services.official_universe_dispatch import ingest_official_market_snapshot
from app.services.provider_snapshot_service import ProviderSnapshotService
from app.wiring.bootstrap import (
    get_fundamentals_cache,
    get_hybrid_fundamentals_service,
    get_provider_snapshot_service,
    get_stock_universe_service,
)

_WEEKLY_NON_US_YFINANCE_DELAY_PER_TICKER = 0.2
_DEFAULT_FETCH_CHUNK_SIZE = 250


def _default_output_dir() -> Path:
    return repo_root() / ".tmp" / "weekly-reference"


def _default_bundle_name(market: str, published_run) -> str:
    as_of = (published_run.published_at or published_run.created_at).date().isoformat().replace("-", "")
    revision = (published_run.source_revision or "snapshot").replace(":", "-").replace("/", "-")
    return f"weekly-reference-{market.lower()}-{as_of}-{revision}.json.gz"


def _default_latest_manifest_name(market: str) -> str:
    return ProviderSnapshotService.weekly_reference_latest_manifest_name_for_market(market)


def _print_progress(event: dict[str, object]) -> None:
    stage = event.get("stage")
    if stage == "snapshot_fetch_complete":
        print(
            "[snapshot] "
            f"{event['completed_fetches']}/{event['total_fetches']} "
            f"({event['percent_complete']}%) "
            f"{event['exchange']} {event['category']} rows={event['rows']}",
            flush=True,
        )
        return

    if stage == "hydrate_start":
        print(
            "[hydrate] "
            f"starting {event['total_symbols']} symbols in {event['total_chunks']} chunks "
            f"(chunk_size={event['chunk_size']})",
            flush=True,
        )
        return

    if stage == "hydrate_chunk_complete":
        print(
            "[hydrate] "
            f"chunk {event['chunk_index']}/{event['total_chunks']} "
            f"processed {event['processed_symbols']}/{event['total_symbols']} "
            f"({event['percent_complete']}%) "
            f"live_price={event['live_price_symbols']} "
            f"cached_only={event['cached_only_symbols']} "
            f"yahoo_hydrated={event['yahoo_hydrated']} "
            f"missing_prices={event['missing_prices']} "
            f"missing_yahoo={event['missing_yahoo']} "
            f"skipped_yahoo_price={event['skipped_yahoo_price_symbols']} "
            f"skipped_yahoo_fields={event['skipped_yahoo_field_symbols']}",
            flush=True,
        )


def _print_snapshot_publish_summary(snapshot_stats: dict[str, Any]) -> None:
    thresholds = snapshot_stats.get("coverage_thresholds") or {}
    coverage = snapshot_stats.get("coverage") or {}
    if not thresholds or not coverage:
        return
    print(
        "[publish] "
        f"market={thresholds.get('market')} "
        f"coverage={thresholds.get('active_coverage', 0.0):.2%} "
        f"(min={thresholds.get('min_active_coverage', 0.0):.2%}) "
        f"missing_ratio={thresholds.get('missing_ratio', 0.0):.2%} "
        f"(max={thresholds.get('max_missing_ratio', 0.0):.2%}) "
        f"snapshot_rows={coverage.get('snapshot_symbols', 0)} "
        f"active_symbols={coverage.get('active_symbols', 0)}",
        flush=True,
    )


def _configure_weekly_hybrid_service(market: str, hybrid_service: Any) -> None:
    if market == "US" or not hasattr(hybrid_service, "yfinance_delay_per_ticker"):
        return
    hybrid_service.yfinance_delay_per_ticker = _WEEKLY_NON_US_YFINANCE_DELAY_PER_TICKER
    print(
        "Using weekly non-US yfinance per-ticker delay "
        f"{_WEEKLY_NON_US_YFINANCE_DELAY_PER_TICKER:.2f}s for {market}",
        flush=True,
    )


def _print_fundamentals_progress(market: str, completed: float, total: int) -> None:
    total_count = max(int(total), 1)
    completed_count = min(int(completed), total_count)
    percent = (completed_count / total_count) * 100
    print(
        f"[fundamentals] {market} {completed_count}/{total_count} ({percent:.1f}%)",
        flush=True,
    )


_FUNDAMENTALS_STATS_NUMERIC_KEYS = (
    "fundamentals_stored",
    "quarterly_stored",
    "ownership_updated",
    "failed",
    "persisted_symbols",
    "failed_persistence_symbols",
)


def _empty_fundamentals_stats() -> dict[str, Any]:
    stats: dict[str, Any] = {key: 0 for key in _FUNDAMENTALS_STATS_NUMERIC_KEYS}
    stats["provider_error_counts"] = {}
    return stats


def _merge_fundamentals_stats(
    accumulator: dict[str, Any],
    chunk_stats: dict[str, Any] | None,
) -> None:
    if not chunk_stats:
        return
    for key in _FUNDAMENTALS_STATS_NUMERIC_KEYS:
        accumulator[key] = int(accumulator.get(key, 0) or 0) + int(
            chunk_stats.get(key, 0) or 0
        )
    chunk_errors = chunk_stats.get("provider_error_counts") or {}
    if chunk_errors:
        bucket = accumulator.setdefault("provider_error_counts", {})
        for key, value in chunk_errors.items():
            bucket[key] = int(bucket.get(key, 0) or 0) + int(value or 0)


def _as_nonnegative_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(parsed, 0)


def _published_run_is_incomplete_partial_seed(
    provider_snapshot_service: Any, db, snapshot_key: str
) -> bool:
    published_run = provider_snapshot_service.get_published_run(db, snapshot_key=snapshot_key)
    if published_run is None or not published_run.coverage_stats_json:
        return False
    try:
        coverage = json.loads(published_run.coverage_stats_json)
    except (TypeError, ValueError):
        return False
    if not coverage.get("partial_run"):
        return False

    missing_active_symbols = _as_nonnegative_int(coverage.get("missing_active_symbols"))
    if missing_active_symbols is not None:
        return missing_active_symbols > 0

    active_symbols = _as_nonnegative_int(coverage.get("active_symbols"))
    snapshot_symbols = _as_nonnegative_int(coverage.get("snapshot_symbols"))
    if active_symbols is not None and snapshot_symbols is not None:
        return snapshot_symbols < active_symbols

    covered_active_symbols = _as_nonnegative_int(coverage.get("covered_active_symbols"))
    if active_symbols is not None and covered_active_symbols is not None:
        return covered_active_symbols < active_symbols

    return False


def _write_step_summary(market: str, summary: dict[str, Any]) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    snapshot_stats = summary.get("snapshot_publish") or {}
    thresholds = snapshot_stats.get("coverage_thresholds") or {}
    coverage = snapshot_stats.get("coverage") or {}
    fundamentals_stats = summary.get("fundamentals_refresh") or {}
    export_stats = summary.get("export") or {}
    provider_error_counts = fundamentals_stats.get("provider_error_counts") or {}

    lines = [
        f"## Weekly Reference Bundle: {market}",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| Coverage gate market | {thresholds.get('market', market)} |",
        f"| Active coverage | {thresholds.get('active_coverage', 0.0):.2%} |",
        f"| Minimum coverage | {thresholds.get('min_active_coverage', 0.0):.2%} |",
        f"| Missing ratio | {thresholds.get('missing_ratio', 0.0):.2%} |",
        f"| Maximum missing ratio | {thresholds.get('max_missing_ratio', 0.0):.2%} |",
        f"| Snapshot rows | {coverage.get('snapshot_symbols', 0)} |",
        f"| Active symbols | {coverage.get('active_symbols', 0)} |",
        f"| Persisted symbols | {fundamentals_stats.get('persisted_symbols', 'n/a')} |",
        f"| Failed persistence symbols | {fundamentals_stats.get('failed_persistence_symbols', 0)} |",
        f"| Failed fetch/store symbols | {fundamentals_stats.get('failed', 0)} |",
        f"| Bundle rows exported | {export_stats.get('rows', 0)} |",
    ]
    if provider_error_counts:
        lines.extend(
            [
                "",
                "| Provider error bucket | Count |",
                "| --- | --- |",
            ]
        )
        for key, value in sorted(provider_error_counts.items()):
            lines.append(f"| `{key}` | {value} |")
    lines.extend(["", ""])

    with Path(summary_path).open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def _raise_publish_blocked(
    *,
    market: str,
    summary: dict[str, Any],
    snapshot_stats: dict[str, Any],
) -> None:
    _write_step_summary(market, summary)
    raise RuntimeError(
        "Weekly fundamentals snapshot did not publish: "
        f"{snapshot_stats.get('warnings') or 'coverage gate blocked publish'}"
    )


def _build_us_bundle(
    db,
    *,
    provider_snapshot_service,
    stock_universe_service,
    market: str,
    output_dir: Path,
    bundle_name: str | None,
    latest_manifest_name: str,
) -> dict[str, Any]:
    snapshot_key = ProviderSnapshotService.snapshot_key_for_market(market)

    print("Starting stock universe refresh from Finviz...", flush=True)
    universe_stats = stock_universe_service.populate_universe(db)
    print(f"Universe refresh complete: {universe_stats}", flush=True)

    print("Starting published fundamentals snapshot build from Finviz...", flush=True)
    snapshot_stats = provider_snapshot_service.create_snapshot_run(
        db,
        run_mode="publish",
        snapshot_key=snapshot_key,
        market=market,
        publish=True,
        progress_callback=_print_progress,
        show_finviz_progress=True,
    )
    summary = {
        "output_dir": output_dir,
        "universe_refresh": universe_stats,
        "snapshot_publish": snapshot_stats,
    }
    if not snapshot_stats.get("published"):
        _raise_publish_blocked(
            market=market,
            summary=summary,
            snapshot_stats=snapshot_stats,
        )
    _print_snapshot_publish_summary(snapshot_stats)

    # Yahoo hydration writes market_cap / growth metrics / eps_rating / ipo_date
    # into stock_fundamentals so `export_weekly_reference_bundle` can merge them
    # into the Finviz snapshot. Without this, the US bundle carries only what
    # Finviz's screener returned, which regularly omits market_cap for delisted
    # tickers and partial responses. The Asia bundle path gets this implicitly
    # via `hybrid_service.fetch_fundamentals_batch`.
    print("Starting Yahoo hydration for US published snapshot...", flush=True)
    hydrate_stats = provider_snapshot_service.hydrate_published_snapshot(
        db,
        snapshot_key=snapshot_key,
        progress_callback=_print_progress,
    )
    summary["fundamentals_hydrate"] = hydrate_stats
    print(f"Hydration complete: {hydrate_stats}", flush=True)

    published_run = provider_snapshot_service.get_published_run(db, snapshot_key=snapshot_key)
    if published_run is None:
        raise RuntimeError("Published weekly fundamentals snapshot was not found after publish")

    resolved_bundle_name = bundle_name or _default_bundle_name(market, published_run)
    bundle_path = output_dir / resolved_bundle_name
    latest_manifest_path = output_dir / latest_manifest_name
    export_stats = provider_snapshot_service.export_weekly_reference_bundle(
        db,
        output_path=bundle_path,
        bundle_asset_name=resolved_bundle_name,
        latest_manifest_path=latest_manifest_path,
        snapshot_key=snapshot_key,
        market=market,
    )

    summary.update(
        {
            "bundle": bundle_path,
            "latest_manifest": latest_manifest_path,
            "export": export_stats,
        }
    )
    return summary


def _run_chunked_fundamentals_refresh(
    *,
    hybrid_service: Any,
    fundamentals_cache: Any,
    market: str,
    symbols: list[str],
    market_by_symbol: dict[str, str],
    chunk_size: int,
    max_runtime_seconds: float,
) -> tuple[dict[str, Any], list[str], bool]:
    """Fetch + persist fundamentals in chunks, honouring an optional wall-clock budget.

    Returns ``(stats, attempted_symbols, deadline_hit)``. When the budget is
    exhausted, the loop exits cleanly between chunks so anything already
    persisted survives in the cache and DB. Skipped symbols inherit whatever
    data was previously hydrated from the prior weekly bundle.
    """
    stats = _empty_fundamentals_stats()
    attempted_symbols: list[str] = []
    deadline_hit = False
    if not symbols:
        return stats, attempted_symbols, deadline_hit

    chunk_size = max(1, int(chunk_size))
    total = len(symbols)
    chunks_total = math.ceil(total / chunk_size)
    deadline = (
        time.monotonic() + float(max_runtime_seconds)
        if max_runtime_seconds and max_runtime_seconds > 0
        else None
    )

    for chunk_index in range(chunks_total):
        if deadline is not None and time.monotonic() >= deadline:
            deadline_hit = True
            print(
                f"[fundamentals] {market} deadline reached before chunk "
                f"{chunk_index + 1}/{chunks_total}; stopping with "
                f"{len(attempted_symbols)}/{total} symbols attempted",
                flush=True,
            )
            break

        chunk = symbols[chunk_index * chunk_size : (chunk_index + 1) * chunk_size]
        if not chunk:
            break
        chunk_market_by_symbol = {s: market_by_symbol[s] for s in chunk if s in market_by_symbol}
        attempted_so_far = len(attempted_symbols)

        def _chunk_progress_cb(completed: float, _chunk_total: int) -> None:
            _print_fundamentals_progress(market, attempted_so_far + int(completed), total)

        chunk_data = hybrid_service.fetch_fundamentals_batch(
            chunk,
            include_technicals=True,
            include_finviz=False,
            progress_callback=_chunk_progress_cb,
            market_by_symbol=chunk_market_by_symbol,
        )
        chunk_stats = hybrid_service.store_all_caches(
            chunk_data,
            fundamentals_cache,
            session_factory=SessionLocal,
            include_quarterly=True,
            market_by_symbol=chunk_market_by_symbol,
        )
        _merge_fundamentals_stats(stats, chunk_stats)
        attempted_symbols.extend(chunk)
        print(
            f"[fundamentals] {market} chunk {chunk_index + 1}/{chunks_total} "
            f"persisted={(chunk_stats or {}).get('persisted_symbols', 0)} "
            f"failed={(chunk_stats or {}).get('failed', 0)}",
            flush=True,
        )

    return stats, attempted_symbols, deadline_hit


_US_DIRECTORY_FETCH_ATTEMPTS = 3


def _decode_directory_bytes(content: bytes) -> tuple[str, str]:
    """Decode a directory file; symbols are ASCII, names may not be UTF-8.

    Latin-1 maps every byte, so a stray non-UTF-8 issuer name never aborts
    the weekly build, and the encoding actually used is recorded.
    """
    try:
        return content.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return content.decode("latin-1"), "latin-1"


def _fetch_us_listing_directory() -> tuple[Any, dict[str, Any]]:
    """Download both NASDAQ Trader files and parse them (fails closed)."""
    import hashlib

    import requests

    from app.config import settings
    from app.services.us_listing_directory import parse_directory

    texts: dict[str, str] = {}
    metadata: dict[str, Any] = {"source_urls": [], "sha256": {}, "fetched_at": datetime.utcnow().isoformat() + "Z"}
    for name, url in (("nasdaqlisted.txt", settings.us_nasdaq_listed_url), ("otherlisted.txt", settings.us_other_listed_url)):
        last_error: Exception | None = None
        for attempt in range(1, _US_DIRECTORY_FETCH_ATTEMPTS + 1):
            try:
                response = requests.get(
                    url,
                    headers={"User-Agent": settings.universe_source_user_agent},
                    timeout=settings.universe_source_timeout_seconds,
                )
                response.raise_for_status()
                texts[name], metadata.setdefault("encoding", {})[name] = _decode_directory_bytes(response.content)
                metadata["source_urls"].append(url)
                metadata["sha256"][name] = hashlib.sha256(response.content).hexdigest()
                break
            except requests.RequestException as exc:
                last_error = exc
                if attempt < _US_DIRECTORY_FETCH_ATTEMPTS:
                    time.sleep(5 * attempt)
        else:
            raise RuntimeError(f"Unable to download {name} from {url}: {last_error}")
    directory = parse_directory(nasdaq_listed=texts["nasdaqlisted.txt"], other_listed=texts["otherlisted.txt"])
    metadata["file_created_at"] = dict(directory.file_created_at)
    return directory, metadata


def _prior_snapshot_payloads(db, provider_snapshot_service, snapshot_key: str) -> dict[str, dict[str, Any]]:
    """Normalized payloads of the seeded prior bundle, read only for immutable facts."""
    from app.models.provider_snapshot import ProviderSnapshotRow

    run = provider_snapshot_service.get_published_run(db, snapshot_key=snapshot_key)
    if run is None:
        return {}
    payloads: dict[str, dict[str, Any]] = {}
    for row in db.query(ProviderSnapshotRow).filter(ProviderSnapshotRow.run_id == run.id).all():
        try:
            payloads[row.symbol] = json.loads(row.normalized_payload_json)
        except (TypeError, ValueError):
            continue
    return payloads


def _purge_market_fundamentals(db, fundamentals_cache, *, market: str, symbols: list[str]) -> int:
    """Remove seeded fundamentals so fields this run cannot fetch stay unknown.

    The fundamentals store only overwrites fields present in a new payload, so
    a seeded prior-bundle row would otherwise leak old values (market cap,
    growth, ownership) into a freshly dated snapshot.
    """
    from app.models.stock import StockFundamental

    removed = 0
    for start in range(0, len(symbols), 500):
        chunk = symbols[start : start + 500]
        removed += (
            db.query(StockFundamental)
            .filter(StockFundamental.symbol.in_(chunk))
            .delete(synchronize_session=False)
        )
        for symbol in chunk:
            fundamentals_cache.invalidate_cache(symbol, market=market)
    db.commit()
    return removed


def _build_us_official_bundle(
    db,
    *,
    provider_snapshot_service,
    stock_universe_service,
    output_dir: Path,
    bundle_name: str | None,
    latest_manifest_name: str,
    max_runtime_seconds: float = 0.0,
    fetch_chunk_size: int = _DEFAULT_FETCH_CHUNK_SIZE,
    fetch_directory=_fetch_us_listing_directory,
    fundamentals_cache=None,
    hybrid_service=None,
) -> dict[str, Any]:
    """Build the US bundle from the official listing directory and Yahoo fundamentals.

    No Finviz request is made. The universe is the NASDAQ Trader directory
    merged with the seeded prior universe for identity continuity, removals
    are explicit and bounded, funds carry reference-only rows, and operating
    companies must meet the US coverage minimum on fundamentals fetched in
    this run. Nothing time-varying is inherited from the prior bundle.
    """
    from app.config import settings
    from app.services.us_listing_directory import US_OFFICIAL_SOURCE_NAME
    from app.services.us_reference_universe import (
        carry_immutable_fields,
        fund_reference_payload,
        is_fund,
        plan_us_universe,
        prior_rows_from_universe,
        universe_sector_label,
        us_snapshot_coverage,
    )

    market = "US"
    snapshot_key = ProviderSnapshotService.snapshot_key_for_market(market)
    fundamentals_cache = fundamentals_cache or get_fundamentals_cache()
    hybrid_service = hybrid_service or get_hybrid_fundamentals_service()

    print("Fetching the NASDAQ Trader symbol directory...", flush=True)
    directory, fetch_metadata = fetch_directory()
    prior_universe = (
        db.query(StockUniverse)
        .filter(StockUniverse.active_filter(), StockUniverse.market == market)
        .all()
    )
    prior_rows = prior_rows_from_universe(prior_universe)
    prior_payloads = _prior_snapshot_payloads(db, provider_snapshot_service, snapshot_key)
    plan = plan_us_universe(directory, prior_rows)
    print(f"Universe plan: {json.dumps(plan.report, sort_keys=True, default=str)}", flush=True)

    policy = stock_universe_service._us_official_reconciliation_policy()
    if len(plan.rows) < policy.min_count:
        raise RuntimeError(
            f"Official US universe plan has {len(plan.rows)} rows, below the reviewed minimum {policy.min_count}"
        )

    created_at = directory.file_created_at.get("nasdaqlisted.txt") or ""
    snapshot_as_of = created_at[:10] or None
    snapshot_id = f"nasdaqtrader-symdir-{created_at.replace('-', '').replace(':', '')}"
    universe_stats = stock_universe_service.ingest_us_official_snapshot_rows(
        db,
        rows=[row.as_ingest_row() for row in plan.rows],
        snapshot_id=snapshot_id,
        snapshot_as_of=snapshot_as_of,
        source_metadata=fetch_metadata,
    )
    removal_stats = stock_universe_service.deactivate_us_symbols_missing_from_official(
        db,
        symbols=plan.removed,
        prior_active_count=len(prior_rows),
        snapshot_id=snapshot_id,
    )
    print(f"Universe ingest: {universe_stats.get('added')} added, removals {removal_stats}", flush=True)

    active_rows = (
        db.query(StockUniverse)
        .filter(StockUniverse.active_filter(), StockUniverse.market == market)
        .order_by(StockUniverse.symbol.asc())
        .all()
    )
    planned = {row.symbol: row for row in plan.rows}
    fund_symbols = {row.symbol for row in active_rows if is_fund(planned.get(row.symbol))}
    equity_symbols = [row.symbol for row in active_rows if row.symbol not in fund_symbols]

    purged = _purge_market_fundamentals(db, fundamentals_cache, market=market, symbols=[row.symbol for row in active_rows])
    print(f"Purged {purged} seeded US fundamentals rows before the fresh fetch", flush=True)

    print(f"Starting Yahoo fundamentals refresh for {len(equity_symbols)} US operating companies...", flush=True)
    fundamentals_stats, attempted_symbols, deadline_hit = _run_chunked_fundamentals_refresh(
        hybrid_service=hybrid_service,
        fundamentals_cache=fundamentals_cache,
        market=market,
        symbols=equity_symbols,
        market_by_symbol={symbol: market for symbol in equity_symbols},
        chunk_size=fetch_chunk_size,
        max_runtime_seconds=max_runtime_seconds,
    )
    print(f"Fundamentals refresh complete: {fundamentals_stats}", flush=True)

    fresh = fundamentals_cache.get_many(equity_symbols) if equity_symbols else {}
    snapshot_rows = []
    fresh_equities = 0
    classification_filled = 0
    for row in active_rows:
        if row.symbol in fund_symbols:
            payload = fund_reference_payload(symbol=row.symbol, name=row.name or "", sector=row.sector or "",
                                             industry=row.industry or "")
        else:
            payload = dict(fresh.get(row.symbol) or {})
            if not payload:
                continue
            fresh_equities += 1
            payload = carry_immutable_fields(payload, prior_payloads.get(row.symbol))
            payload.setdefault("company_name", row.name)
            if not row.sector and payload.get("sector"):
                row.sector = universe_sector_label(payload["sector"])
                classification_filled += 1
            if not row.industry and payload.get("industry"):
                row.industry = payload["industry"]
            payload.setdefault("sector", row.sector)
            payload.setdefault("industry", row.industry)
        snapshot_rows.append(
            provider_snapshot_service.build_market_snapshot_row(
                market=market,
                symbol=row.symbol,
                exchange=row.exchange,
                normalized_payload=payload,
                raw_payload=None,
            )
        )
    db.commit()

    coverage_stats, warnings, equity_ok = us_snapshot_coverage(
        active_symbols=len(active_rows),
        fund_symbols=len(fund_symbols),
        fresh_equity_symbols=fresh_equities,
        min_equity_coverage=float(settings.provider_snapshot_min_active_coverage_us),
    )
    coverage_stats.update({
        "attempted_symbols": len(attempted_symbols),
        "skipped_due_to_deadline": len(equity_symbols) - len(attempted_symbols) if deadline_hit else 0,
        "partial_run": bool(deadline_hit),
        "classification_filled_from_fundamentals": classification_filled,
        "universe_source": {
            "source": US_OFFICIAL_SOURCE_NAME,
            "file_created_at": fetch_metadata.get("file_created_at"),
            "sha256": fetch_metadata.get("sha256"),
            "plan": {key: plan.report[key] for key in (
                "prior_active", "planned_active", "kept", "added", "removed", "added_by_class",
                "kept_prior_identity_on_unmodelled_venue", "skipped_new_listings")},
            "removal": removal_stats,
        },
        "fundamentals_source": "yfinance",
    })
    if deadline_hit:
        warnings.append("Weekly US fetch deadline reached; partial US snapshots are never published.")
    if fundamentals_stats.get("failed"):
        warnings.append(f"{fundamentals_stats['failed']} US symbols failed during the Yahoo fundamentals refresh")

    source_revision = f"{snapshot_key}:{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    snapshot_stats = provider_snapshot_service.publish_market_snapshot_run(
        db,
        snapshot_key=snapshot_key,
        market=market,
        source_revision=source_revision,
        rows=snapshot_rows,
        coverage_stats=coverage_stats,
        warnings=warnings,
        publish=equity_ok and not deadline_hit,
    )
    summary = {
        "output_dir": output_dir,
        "universe_refresh": {**universe_stats, "removal": removal_stats},
        "fundamentals_refresh": fundamentals_stats,
        "snapshot_publish": snapshot_stats,
    }
    if not snapshot_stats.get("published"):
        _raise_publish_blocked(market=market, summary=summary, snapshot_stats=snapshot_stats)
    _print_snapshot_publish_summary(snapshot_stats)

    published_run = provider_snapshot_service.get_published_run(db, snapshot_key=snapshot_key)
    if published_run is None:
        raise RuntimeError("Published weekly fundamentals snapshot for US was not found")
    resolved_bundle_name = bundle_name or _default_bundle_name(market, published_run)
    bundle_path = output_dir / resolved_bundle_name
    latest_manifest_path = output_dir / latest_manifest_name
    export_stats = provider_snapshot_service.export_weekly_reference_bundle(
        db,
        output_path=bundle_path,
        bundle_asset_name=resolved_bundle_name,
        latest_manifest_path=latest_manifest_path,
        snapshot_key=snapshot_key,
        market=market,
    )
    summary.update({"bundle": bundle_path, "latest_manifest": latest_manifest_path, "export": export_stats})
    return summary


def _build_asia_bundle(
    db,
    *,
    provider_snapshot_service,
    stock_universe_service,
    market: str,
    output_dir: Path,
    bundle_name: str | None,
    latest_manifest_name: str,
    max_runtime_seconds: float = 0.0,
    fetch_chunk_size: int = _DEFAULT_FETCH_CHUNK_SIZE,
    allow_partial_publish: bool = False,
    resume_partial_seed: bool = False,
) -> dict[str, Any]:
    snapshot_key = ProviderSnapshotService.snapshot_key_for_market(market)
    official_source_service = OfficialMarketUniverseSourceService()
    fundamentals_cache = get_fundamentals_cache()
    hybrid_service = get_hybrid_fundamentals_service()
    _configure_weekly_hybrid_service(market, hybrid_service)

    print(f"Starting official universe refresh for {market}...", flush=True)
    stale_universe = False
    universe_error: str | None = None
    try:
        official_snapshot = official_source_service.fetch_market_snapshot(market)
        universe_stats = ingest_official_market_snapshot(
            db, stock_universe_service, official_snapshot
        )
        print(f"Universe refresh complete: {universe_stats}", flush=True)
    except Exception as exc:
        if not allow_partial_publish:
            raise
        # The shared official ingestion dispatch may have raised mid-transaction
        # (after bulk_save_objects but before commit), leaving the session in
        # a doomed state. Roll back before the seeded-rows query so we don't
        # mask the original error with a PendingRollbackError. The rollback
        # also reverts any partial bulk-insert, so the seeded-count below
        # reflects only rows that pre-existed this run.
        try:
            db.rollback()
        except Exception:  # pragma: no cover - defensive; rollback failures fall through
            pass
        # Assumption: the ``Seed prior weekly reference bundle`` step in
        # weekly-reference-data.yml is the only writer of CN rows in the
        # CI Postgres before this script runs, so any active rows present
        # here came from ``import_weekly_reference_bundle``. The rollback
        # above guarantees no partially-ingested rows survive. Long-running
        # deployments without a fresh Postgres should not rely on this
        # rescue path without first verifying that prior rows reflect the
        # intended baseline.
        seeded_count = (
            db.query(StockUniverse)
            .filter(
                StockUniverse.active_filter(),
                StockUniverse.market == market,
            )
            .count()
        )
        if seeded_count == 0:
            raise
        stale_universe = True
        universe_error = str(exc)
        universe_stats = {
            "stale_universe": True,
            "error": universe_error,
            "fallback_rows": seeded_count,
        }
        print(
            f"[universe] {market} official fetch failed ({universe_error}); "
            f"falling back to {seeded_count} seeded prior-week rows",
            flush=True,
        )

    active_rows = (
        db.query(StockUniverse)
        .filter(
            StockUniverse.active_filter(),
            StockUniverse.market == market,
        )
        .order_by(StockUniverse.symbol.asc())
        .all()
    )
    if not active_rows:
        raise RuntimeError(f"No active {market} universe rows found after official-source ingest")

    symbols = [row.symbol for row in active_rows]
    market_by_symbol = {row.symbol: market for row in active_rows}
    seeded_symbols: list[str] = []
    if resume_partial_seed and _published_run_is_incomplete_partial_seed(
        provider_snapshot_service, db, snapshot_key
    ):
        seeded_payloads = fundamentals_cache.get_many(symbols)
        seeded_symbols = [symbol for symbol in symbols if seeded_payloads.get(symbol)]
        if seeded_symbols:
            print(
                f"[fundamentals] {market} resuming partial seed: "
                f"skipping {len(seeded_symbols)} cached symbols and fetching "
                f"{len(symbols) - len(seeded_symbols)} remaining symbols",
                flush=True,
            )
    seeded_symbol_set = set(seeded_symbols)
    fetch_symbols = [symbol for symbol in symbols if symbol not in seeded_symbol_set]

    print(f"Starting hybrid fundamentals refresh for {market}...", flush=True)
    fundamentals_stats, attempted_symbols, deadline_hit = _run_chunked_fundamentals_refresh(
        hybrid_service=hybrid_service,
        fundamentals_cache=fundamentals_cache,
        market=market,
        symbols=fetch_symbols,
        market_by_symbol=market_by_symbol,
        chunk_size=fetch_chunk_size,
        max_runtime_seconds=max_runtime_seconds,
    )
    attempted_symbol_set = set(attempted_symbols)
    skipped_symbols = [s for s in fetch_symbols if s not in attempted_symbol_set]
    print(f"Fundamentals refresh complete: {fundamentals_stats}", flush=True)

    cached_fundamentals = fundamentals_cache.get_many(symbols)
    snapshot_rows = []
    for row in active_rows:
        payload = dict(cached_fundamentals.get(row.symbol) or {})
        if not payload:
            continue
        payload.setdefault("company_name", row.name)
        payload.setdefault("sector", row.sector)
        payload.setdefault("industry", row.industry)
        payload.setdefault("market_cap", row.market_cap)
        snapshot_rows.append(
            provider_snapshot_service.build_market_snapshot_row(
                market=market,
                symbol=row.symbol,
                exchange=row.exchange,
                normalized_payload=payload,
                raw_payload=None,
            )
        )

    coverage_stats = {
        "active_symbols": len(symbols),
        "snapshot_symbols": len(snapshot_rows),
        "covered_active_symbols": len(snapshot_rows),
        "missing_active_symbols": max(len(symbols) - len(snapshot_rows), 0),
        "attempted_symbols": len(attempted_symbols),
        "seeded_symbols": len(seeded_symbols),
        "fetch_symbols": len(fetch_symbols),
        "skipped_due_to_deadline": len(skipped_symbols) if deadline_hit else 0,
        "partial_run": deadline_hit or stale_universe,
        "stale_universe": stale_universe,
    }
    warnings: list[str] = []
    if stale_universe:
        warnings.append(
            f"Official {market} universe fetch failed ({universe_error}); "
            f"reused {len(symbols)} seeded prior-week rows."
        )
    if fundamentals_stats.get("failed"):
        warnings.append(
            f"{fundamentals_stats['failed']} symbols failed during {market} hybrid fundamentals refresh"
        )
    if fundamentals_stats.get("failed_persistence_symbols"):
        warnings.append(
            f"{fundamentals_stats['failed_persistence_symbols']} symbols failed to persist during "
            f"{market} hybrid fundamentals refresh"
        )
    if deadline_hit:
        warnings.append(
            f"Weekly fetch deadline reached after {len(attempted_symbols)}/{len(symbols)} "
            f"{market} symbols ({len(seeded_symbols)} seeded); "
            f"{len(skipped_symbols)} symbols inherit prior-bundle data."
        )
        if not allow_partial_publish:
            warnings.append(
                "Partial publish disabled; blocking publish because the weekly fetch deadline was reached."
            )

    source_revision = f"{snapshot_key}:{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    publish = not (deadline_hit and not allow_partial_publish)
    snapshot_stats = provider_snapshot_service.publish_market_snapshot_run(
        db,
        snapshot_key=snapshot_key,
        market=market,
        source_revision=source_revision,
        rows=snapshot_rows,
        coverage_stats=coverage_stats,
        warnings=warnings,
        publish=publish,
        force_publish=bool(allow_partial_publish and (deadline_hit or stale_universe)),
    )
    summary = {
        "output_dir": output_dir,
        "universe_refresh": universe_stats,
        "fundamentals_refresh": fundamentals_stats,
        "snapshot_publish": snapshot_stats,
    }
    if not snapshot_stats.get("published"):
        _raise_publish_blocked(
            market=market,
            summary=summary,
            snapshot_stats=snapshot_stats,
        )
    _print_snapshot_publish_summary(snapshot_stats)

    published_run = provider_snapshot_service.get_published_run(db, snapshot_key=snapshot_key)
    if published_run is None:
        raise RuntimeError(f"Published weekly fundamentals snapshot for {market} was not found")

    resolved_bundle_name = bundle_name or _default_bundle_name(market, published_run)
    bundle_path = output_dir / resolved_bundle_name
    latest_manifest_path = output_dir / latest_manifest_name
    export_stats = provider_snapshot_service.export_weekly_reference_bundle(
        db,
        output_path=bundle_path,
        bundle_asset_name=resolved_bundle_name,
        latest_manifest_path=latest_manifest_path,
        snapshot_key=snapshot_key,
        market=market,
    )

    summary.update(
        {
            "bundle": bundle_path,
            "latest_manifest": latest_manifest_path,
            "export": export_stats,
        }
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--market",
        required=True,
        choices=list(ProviderSnapshotService.SNAPSHOT_KEY_FUNDAMENTALS_BY_MARKET),
        help="Market code to build the weekly reference bundle for.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(_default_output_dir()),
        help="Directory to receive the generated bundle and latest manifest.",
    )
    parser.add_argument(
        "--bundle-name",
        default=None,
        help="Bundle asset filename. Defaults to weekly-reference-<market>-<YYYYMMDD>-<revision>.json.gz",
    )
    parser.add_argument(
        "--latest-manifest-name",
        default=None,
        help="Filename for the latest-pointer manifest JSON. Defaults to the market-scoped name.",
    )
    parser.add_argument(
        "--max-runtime-minutes",
        type=float,
        default=0.0,
        help=(
            "Soft wall-clock budget for the fundamentals refresh phase. "
            "When > 0, the Asia path fetches in chunks and exits cleanly "
            "between chunks once the budget is exhausted. The deadline is "
            "checked before each chunk; leave at least one chunk's runtime "
            "of headroom under the GitHub Actions 6-hour job cap."
        ),
    )
    parser.add_argument(
        "--fetch-chunk-size",
        type=int,
        default=_DEFAULT_FETCH_CHUNK_SIZE,
        help=(
            "Number of symbols processed per chunk when --max-runtime-minutes "
            f"is set (default {_DEFAULT_FETCH_CHUNK_SIZE})."
        ),
    )
    parser.add_argument(
        "--allow-partial-publish",
        action="store_true",
        help=(
            "Allow partial publish in two scenarios: (a) --max-runtime-minutes "
            "triggers an early exit between fundamentals chunks, or (b) the "
            "official market-universe fetch fails and prior-week seeded "
            "universe rows are available. The snapshot is force-published "
            "even if the coverage gate would otherwise block. Skipped symbols "
            "inherit the prior weekly bundle's data; the manifest records "
            "partial_run=True with a deadline or stale_universe warning."
        ),
    )
    parser.add_argument(
        "--resume-partial-seed",
        action="store_true",
        help=(
            "When the seeded prior bundle is marked partial_run=True, skip symbols "
            "already present in the hydrated fundamentals cache and fetch only the "
            "remaining symbols. Intended for initial CN bootstrap continuation."
        ),
    )
    parser.add_argument(
        "--us-source",
        choices=("official", "finviz"),
        default="official",
        help=(
            "US universe source. 'official' (default) uses the NASDAQ Trader symbol "
            "directory and Yahoo fundamentals; 'finviz' is the legacy screener path, "
            "blocked from GitHub-hosted runners since October 2026."
        ),
    )
    args = parser.parse_args()

    prepare_runtime()
    provider_snapshot_service = get_provider_snapshot_service()
    stock_universe_service = get_stock_universe_service()

    market = args.market.upper()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    latest_manifest_name = args.latest_manifest_name or _default_latest_manifest_name(market)

    with SessionLocal() as db:
        if market == "US" and args.us_source == "official":
            summary = _build_us_official_bundle(
                db,
                provider_snapshot_service=provider_snapshot_service,
                stock_universe_service=stock_universe_service,
                output_dir=output_dir,
                bundle_name=args.bundle_name,
                latest_manifest_name=latest_manifest_name,
                max_runtime_seconds=max(0.0, float(args.max_runtime_minutes)) * 60.0,
                fetch_chunk_size=max(1, int(args.fetch_chunk_size)),
            )
        elif market == "US":
            summary = _build_us_bundle(
                db,
                provider_snapshot_service=provider_snapshot_service,
                stock_universe_service=stock_universe_service,
                market=market,
                output_dir=output_dir,
                bundle_name=args.bundle_name,
                latest_manifest_name=latest_manifest_name,
            )
        else:
            summary = _build_asia_bundle(
                db,
                provider_snapshot_service=provider_snapshot_service,
                stock_universe_service=stock_universe_service,
                market=market,
                output_dir=output_dir,
                bundle_name=args.bundle_name,
                latest_manifest_name=latest_manifest_name,
                max_runtime_seconds=max(0.0, float(args.max_runtime_minutes)) * 60.0,
                fetch_chunk_size=max(1, int(args.fetch_chunk_size)),
                allow_partial_publish=bool(args.allow_partial_publish),
                resume_partial_seed=bool(args.resume_partial_seed),
            )

    _write_step_summary(market, summary)
    print(f"Weekly reference bundle complete for {market}:")
    for key, value in summary.items():
        print(f"  - {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
