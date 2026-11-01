"""Describe how current the weekly reference data behind a static export is.

The daily static export hydrates universe membership and reference
fundamentals (sector, industry, market cap, IPO date, growth inputs) from the
weekly reference bundle. Those values must never be presented as current
when the bundle is old, so every export records the bundle's own as-of date,
its source and its age next to (not inside) the per-market ``freshness``
block. ``freshness`` keys are compared against the trading session by the
post-close watchdog, so a weekly date there would wrongly mark every
publication stale.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Mapping

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.provider_snapshot import ProviderSnapshotPointer, ProviderSnapshotRun
from app.models.stock_universe import StockUniverse

REFERENCE_DATA_SCHEMA = "static-reference-data-v1"


def snapshot_key_for(market: str) -> str:
    """Same key as ProviderSnapshotService.snapshot_key_for_market (tested)."""
    return f"fundamentals_v1_{str(market).strip().lower()}"


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def reference_data_status(
    *,
    market: str,
    snapshot_key: str,
    run: ProviderSnapshotRun | None,
    scan_as_of: date,
    max_age_days: int,
    universe_sources: Mapping[str, int],
) -> dict[str, Any]:
    """Pure summary used by the export and its tests."""
    base: dict[str, Any] = {
        "schema_version": REFERENCE_DATA_SCHEMA,
        "market": market,
        "snapshot_key": snapshot_key,
        "max_age_days": int(max_age_days),
        "universe_sources": dict(sorted(universe_sources.items())),
    }
    as_of = _as_date(run.published_at or run.created_at) if run is not None else None
    if as_of is None:
        return {**base, "available": False, "as_of_date": None, "age_days": None, "stale": True}
    age_days = (scan_as_of - as_of).days
    return {
        **base,
        "available": True,
        "as_of_date": as_of.isoformat(),
        "source_revision": run.source_revision,
        "age_days": age_days,
        "stale": age_days > max_age_days,
    }


def load_reference_data(
    db: Session,
    *,
    market: str,
    snapshot_key: str,
    scan_as_of: date,
    max_age_days: int,
) -> dict[str, Any]:
    try:
        # A savepoint keeps a failed provenance read from aborting the export's
        # surrounding transaction; the failure is reported, never hidden.
        with db.begin_nested():
            pointer = db.query(ProviderSnapshotPointer).filter(ProviderSnapshotPointer.snapshot_key == snapshot_key).first()
            run = None
            if pointer is not None:
                run = db.query(ProviderSnapshotRun).filter(ProviderSnapshotRun.id == pointer.run_id).first()
            sources = (
                db.query(StockUniverse.source, func.count(StockUniverse.id))
                .filter(StockUniverse.market == market, StockUniverse.active_filter())
                .group_by(StockUniverse.source)
                .all()
            )
    except SQLAlchemyError as exc:
        status = reference_data_status(market=market, snapshot_key=snapshot_key, run=None, scan_as_of=scan_as_of,
                                       max_age_days=max_age_days, universe_sources={})
        return {**status, "error": f"{type(exc).__name__}: reference provenance could not be read"}
    return reference_data_status(
        market=market,
        snapshot_key=snapshot_key,
        run=run,
        scan_as_of=scan_as_of,
        max_age_days=max_age_days,
        universe_sources={str(source or "unknown"): int(count) for source, count in sources},
    )


def stale_reference_warning(reference: Mapping[str, Any]) -> str | None:
    if not reference.get("stale"):
        return None
    if not reference.get("available"):
        return (
            f"{reference['market']} weekly reference data is unavailable; universe membership and reference "
            "fundamentals are not current."
        )
    return (
        f"{reference['market']} weekly reference data is {reference['age_days']} days old "
        f"(as of {reference['as_of_date']}, limit {reference['max_age_days']}); universe membership and "
        "reference fundamentals are not current."
    )
