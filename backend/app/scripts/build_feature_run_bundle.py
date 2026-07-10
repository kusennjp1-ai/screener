"""Export the latest PUBLISHED feature run as a portable bundle.

The static-site fast price publish runs in a fresh CI database that has no
feature runs, but ``export_static_site --prices-only`` re-exports against the
latest *published* run. The full nightly build calls this script to dump that
run (run metadata + every StockFeatureDaily row + the pointer key) to a
gzipped JSON asset; the fast job imports it with
``import_feature_run_bundle.py`` before exporting.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from app.database import SessionLocal
from app.infra.db.models.feature_store import (
    FeatureRun,
    FeatureRunPointer,
    StockFeatureDaily,
)
from app.scripts._runtime import prepare_runtime

FEATURE_RUN_BUNDLE_SCHEMA_VERSION = "feature-run-bundle-v1"


def _pointer_key(market: str) -> str:
    return f"latest_published_market:{market.upper()}"


def build_bundle(market: str, output_dir: Path) -> dict:
    market = market.upper()
    output_dir.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db:
        pointer = (
            db.query(FeatureRunPointer)
            .filter(FeatureRunPointer.key == _pointer_key(market))
            .one_or_none()
        )
        if pointer is None:
            return {"status": "no_published_run", "market": market}
        run = db.get(FeatureRun, pointer.run_id)
        if run is None:
            return {"status": "no_published_run", "market": market}

        rows = (
            db.query(StockFeatureDaily)
            .filter(StockFeatureDaily.run_id == run.id)
            .order_by(StockFeatureDaily.symbol.asc())
            .all()
        )

        payload = {
            "schema_version": FEATURE_RUN_BUNDLE_SCHEMA_VERSION,
            "market": market,
            "pointer_key": _pointer_key(market),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "run": {
                "as_of_date": run.as_of_date.isoformat(),
                "run_type": run.run_type,
                "code_version": run.code_version,
                "config_json": run.config_json,
                "stats_json": run.stats_json,
                "published_at": run.published_at.isoformat() if run.published_at else None,
            },
            "rows": [
                {
                    "symbol": row.symbol,
                    "as_of_date": row.as_of_date.isoformat(),
                    "composite_score": row.composite_score,
                    "overall_rating": row.overall_rating,
                    "passes_count": row.passes_count,
                    "details_json": row.details_json,
                }
                for row in rows
            ],
        }

    market_lower = market.lower()
    bundle_name = f"feature-run-{market_lower}-{payload['run']['as_of_date']}.json.gz"
    bundle_path = output_dir / bundle_name
    bundle_path.write_bytes(
        gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    )

    manifest = {
        "schema_version": FEATURE_RUN_BUNDLE_SCHEMA_VERSION,
        "market": market,
        "bundle_asset_name": bundle_name,
        "as_of_date": payload["run"]["as_of_date"],
        "row_count": len(payload["rows"]),
        "sha256": hashlib.sha256(bundle_path.read_bytes()).hexdigest(),
        "generated_at": payload["generated_at"],
    }
    manifest_path = output_dir / f"feature-run-latest-{market_lower}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return {
        "status": "built",
        "market": market,
        "as_of_date": manifest["as_of_date"],
        "row_count": manifest["row_count"],
        "bundle_path": str(bundle_path),
        "manifest_path": str(manifest_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", required=True, help="Market code (e.g. US).")
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to receive the bundle + manifest.",
    )
    args = parser.parse_args()

    prepare_runtime()
    result = build_bundle(args.market, Path(args.output_dir))
    print("Feature-run bundle build result:")
    for key, value in result.items():
        print(f"  - {key}: {value}")
    return 0 if result.get("status") == "built" else 1


if __name__ == "__main__":
    raise SystemExit(main())
