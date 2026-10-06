"""Coverage-policy validation and retired direct-publication entry point.

Collection and shard checkpoints remain independent. This guard checks the
exporter's declared coverage contract, not individual OHLCV validity.
"""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import subprocess
from typing import Any


def validate_promotion(manifest: dict[str, Any], *, mode: str) -> float:
    """Fail closed before any release write when promotion lacks proof."""
    if mode != "full":
        raise ValueError("Only a full refresh may promote an authoritative daily-price bundle")
    if manifest.get("require_complete") is not True:
        raise ValueError("No enforced source coverage policy; preserve the previous release")
    if manifest.get("symbol_scope") != "active_market":
        raise ValueError("Partial or unknown symbol scope cannot replace the market snapshot")

    # Reuse export_daily_price_bundle's existing --require-complete semantics.
    # In particular, omitted min_symbol_coverage means 100%, not a new US floor.
    floor = manifest.get("min_symbol_coverage")
    floor = 1.0 if floor is None else floor
    if (
        type(floor) not in (int, float)
        or not math.isfinite(floor)
        or not 0 < floor <= 1
    ):
        raise ValueError("Source coverage policy must declare a finite, positive floor")
    allow_stale = manifest.get("allow_stale_complete")
    if type(allow_stale) is not bool:
        raise ValueError("Source policy must explicitly state whether stale histories count")

    counts = {}
    for key in (
        "symbol_universe_count", "symbol_count", "missing_symbol_count",
        "stale_symbol_count", "covered_symbol_count",
    ):
        value = manifest.get(key)
        if type(value) is not int or value < 0:
            raise ValueError(f"Invalid source coverage count: {key}")
        counts[key] = value
    universe = counts["symbol_universe_count"]
    represented = counts["symbol_count"]
    stale = counts["stale_symbol_count"]
    covered = represented if allow_stale else represented - stale
    if (
        universe == 0
        or represented + counts["missing_symbol_count"] != universe
        or stale > represented
        or covered != counts["covered_symbol_count"]
    ):
        raise ValueError("Inconsistent source coverage counts")
    ratio = covered / universe
    declared_ratio = manifest.get("symbol_coverage")
    if (
        type(declared_ratio) not in (int, float)
        or not math.isfinite(declared_ratio)
        or abs(declared_ratio - round(ratio, 6)) > 0.0000005
    ):
        raise ValueError("Declared source coverage disagrees with counts")
    if ratio < floor:
        raise ValueError(f"Source coverage {covered}/{universe} is below declared floor {floor}")
    return float(floor)


def publish_daily_price_bundle(
    *, bundle_path: Path, manifest_path: Path, previous_manifest_path: Path, mode: str,
) -> None:
    """Validate everything before the first GitHub upload (including clobber)."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("Daily price manifest must be an object")
    floor = validate_promotion(manifest, mode=mode)
    previous = json.loads(previous_manifest_path.read_text(encoding="utf-8"))
    if not isinstance(previous, dict) or previous.get("schema_version") != "daily-price-manifest-v1":
        raise ValueError("Previous authoritative manifest is missing or unsupported")
    previous_floor = previous.get("min_symbol_coverage")
    # Legacy manifests do not record require_complete, so an omitted floor
    # there cannot be assumed to mean 100% (or any enforced policy).
    if previous_floor is None and previous.get("require_complete") is True:
        previous_floor = 1.0
    if (
        type(previous_floor) not in (int, float)
        or not math.isfinite(previous_floor)
        or not 0 < previous_floor <= 1
        or type(previous.get("allow_stale_complete")) is not bool
    ):
        raise ValueError("Previous source coverage policy is unknown; review required")
    if floor < previous_floor or (
        not previous["allow_stale_complete"] and manifest["allow_stale_complete"]
    ):
        raise ValueError("Candidate weakens the previous source coverage policy")
    if (
        manifest.get("schema_version") != "daily-price-manifest-v1"
        or manifest.get("bar_period") != "2y"
    ):
        raise ValueError("Unsupported daily price manifest contract")
    market = manifest.get("market")
    if (
        not isinstance(market, str) or len(market) != 2 or not market.isascii()
        or not market.isalpha() or not market.isupper()
    ):
        raise ValueError("Invalid daily price market")
    as_of = date.fromisoformat(manifest["as_of_date"])
    if previous.get("market") != market or as_of < date.fromisoformat(previous["as_of_date"]):
        raise ValueError("Candidate market/date cannot replace the previous snapshot")
    expected_bundle = f"daily-price-{market.lower()}-{as_of:%Y%m%d}.json.gz"
    if (
        bundle_path.name != expected_bundle
        or manifest.get("bundle_asset_name") != expected_bundle
        or manifest_path.name != f"daily-price-latest-{market.lower()}.json"
    ):
        raise ValueError("Only canonical market snapshot assets may be promoted")
    with bundle_path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest.get("sha256"):
        raise ValueError("Daily price bundle does not match the candidate manifest")

    raise ValueError("Legacy direct publication is disabled; use staged downstream validation and the conditional Git pointer")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--previous-manifest", required=True, type=Path)
    parser.add_argument("--mode", required=True, choices=("full", "prices_only"))
    args = parser.parse_args()
    publish_daily_price_bundle(
        bundle_path=args.bundle, manifest_path=args.manifest,
        previous_manifest_path=args.previous_manifest, mode=args.mode,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
