"""Sync the latest daily GitHub price bundle into the local runtime database."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.database import SessionLocal
from app.scripts._runtime import prepare_runtime
from app.services.daily_price_bundle_service import DailyPriceBundleService
from app.services.cache.price_history_diagnostics import new_observations
from app.wiring.bootstrap import get_daily_price_bundle_service


NON_FATAL_SYNC_STATUSES = {"success", "up_to_date", "live_only", "missing_manifest"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--market",
        required=True,
        choices=list(DailyPriceBundleService.DAILY_PRICE_SUPPORTED_MARKETS),
        help="Market code to sync from the GitHub daily price release.",
    )
    parser.add_argument(
        "--warm-redis-symbols",
        type=int,
        default=None,
        help="Override the number of imported symbols to warm back into Redis immediately.",
    )
    parser.add_argument(
        "--allow-stale",
        action="store_true",
        help="Import a stale GitHub bundle as a baseline before refreshing daily prices.",
    )
    parser.add_argument("--chart-diagnostics-output-dir", default=None,
                        help="Add seed stages to the existing chart omission sidecar.")
    parser.add_argument("--price-diagnostic-run-id", default=None)
    args = parser.parse_args()

    observations = (new_observations(args.market, args.price_diagnostic_run_id)
                    if args.chart_diagnostics_output_dir else None)
    try:
        prepare_runtime()
        service = get_daily_price_bundle_service()

        with SessionLocal() as db:
            result = service.sync_from_github(
                db,
                market=args.market,
                warm_redis_symbols=args.warm_redis_symbols,
                allow_stale=args.allow_stale,
                **({"observations": observations} if observations is not None else {}),
            )
    finally:
        if observations is not None:
            try:
                from app.scripts.export_static_site import _try_write_chart_omission_diagnostics

                _try_write_chart_omission_diagnostics(
                    Path(args.chart_diagnostics_output_dir), args.market, {},
                    export_completed=False, pipeline_observations=observations,
                )
            except Exception:
                pass  # Diagnostic setup must not mask the original sync outcome.

    print("Daily GitHub price sync result:")
    for key, value in result.items():
        print(f"  - {key}: {value}")

    return 0 if result.get("status") in NON_FATAL_SYNC_STATUSES else 1


if __name__ == "__main__":
    raise SystemExit(main())
