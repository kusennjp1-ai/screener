"""Import a feature-run bundle and publish its pointer.

Counterpart of ``build_feature_run_bundle.py``: loads the dumped run
(metadata + StockFeatureDaily rows) into the local database and points
``latest_published_market:<MARKET>`` at it, so ``export_static_site
--prices-only`` can re-export the previous full build's scan against fresh
prices in a fresh CI database.
"""

from __future__ import annotations

import argparse
import gzip
import json
from datetime import date, datetime, timezone
from pathlib import Path

from app.database import SessionLocal
from app.infra.db.models.feature_store import (
    FeatureRun,
    FeatureRunPointer,
    StockFeatureDaily,
)
from app.scripts._runtime import prepare_runtime

IMPORT_BATCH_SIZE = 500


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def import_bundle(input_path: Path) -> dict:
    raw = input_path.read_bytes()
    if input_path.suffix == ".gz" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    payload = json.loads(raw.decode("utf-8"))

    market = str(payload.get("market") or "").upper()
    pointer_key = payload.get("pointer_key") or f"latest_published_market:{market}"
    run_meta = payload.get("run") or {}
    rows = payload.get("rows") or []
    as_of = _parse_date(run_meta["as_of_date"])

    with SessionLocal() as db:
        # Idempotency: if the pointer already targets a run with this as-of
        # date and row count, the bundle is already imported.
        pointer = (
            db.query(FeatureRunPointer)
            .filter(FeatureRunPointer.key == pointer_key)
            .one_or_none()
        )
        if pointer is not None:
            existing = db.get(FeatureRun, pointer.run_id)
            if existing is not None and existing.as_of_date == as_of:
                existing_rows = (
                    db.query(StockFeatureDaily)
                    .filter(StockFeatureDaily.run_id == existing.id)
                    .count()
                )
                if existing_rows == len(rows):
                    return {
                        "status": "up_to_date",
                        "market": market,
                        "run_id": existing.id,
                        "as_of_date": as_of.isoformat(),
                        "row_count": existing_rows,
                    }

        now = datetime.now(timezone.utc)
        run = FeatureRun(
            as_of_date=as_of,
            run_type=run_meta.get("run_type") or "daily_snapshot",
            status="published",
            completed_at=now,
            published_at=now,
            code_version=run_meta.get("code_version"),
            config_json=run_meta.get("config_json"),
            stats_json=run_meta.get("stats_json"),
        )
        db.add(run)
        db.flush()  # assign run.id

        for offset in range(0, len(rows), IMPORT_BATCH_SIZE):
            db.bulk_insert_mappings(
                StockFeatureDaily,
                [
                    {
                        "run_id": run.id,
                        "symbol": row["symbol"],
                        "as_of_date": _parse_date(row["as_of_date"]),
                        "composite_score": row.get("composite_score"),
                        "overall_rating": row.get("overall_rating"),
                        "passes_count": row.get("passes_count"),
                        "details_json": row.get("details_json"),
                    }
                    for row in rows[offset:offset + IMPORT_BATCH_SIZE]
                ],
            )

        if pointer is None:
            db.add(FeatureRunPointer(key=pointer_key, run_id=run.id))
        else:
            pointer.run_id = run.id
        db.commit()

        return {
            "status": "imported",
            "market": market,
            "run_id": run.id,
            "as_of_date": as_of.isoformat(),
            "row_count": len(rows),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to the bundle (.json.gz).")
    args = parser.parse_args()

    prepare_runtime()
    result = import_bundle(Path(args.input))
    print("Feature-run bundle import result:")
    for key, value in result.items():
        print(f"  - {key}: {value}")
    return 0 if result.get("status") in ("imported", "up_to_date") else 1


if __name__ == "__main__":
    raise SystemExit(main())
