#!/usr/bin/env python3
"""Execute an explicitly bound, <=200-symbol artifact-only Yahoo statement plan.

Run from backend: python -m app.scripts.capture_financial_statement_batch
--plan PLAN.json --base-artifact research-index.json --output-dir NEW_DIRECTORY.
Use --dry-run to validate without creating provider objects or output files.
Resume with --cache-manifest PREVIOUS/cache-manifest.json and its trusted
--cache-sha256. Resume never changes an original acquisition time. This CLI
neither selects work nor writes database/publication/workflow artifacts.
"""
import argparse
import json
from pathlib import Path

from app.services.financial_statement_batch import (
    DEFAULT_ACQUISITION_BUDGET_SECONDS, DEFAULT_MAX_TRANSPORT_REQUESTS, MAX_BASE_BYTES, collect, read_json,
)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--base-artifact", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cache-manifest", type=Path)
    parser.add_argument("--cache-sha256")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--acquisition-budget-seconds", type=float, default=DEFAULT_ACQUISITION_BUDGET_SECONDS)
    parser.add_argument("--max-statement-getter-calls", type=int, default=400)
    parser.add_argument("--max-transport-requests", type=int, default=DEFAULT_MAX_TRANSPORT_REQUESTS)
    args = parser.parse_args(argv)
    try:
        plan, _ = read_json(args.plan)
        _, base_bytes = read_json(args.base_artifact, MAX_BASE_BYTES)
        summary, code = collect(plan, base_bytes, args.output_dir, cache_manifest=args.cache_manifest,
                                cache_sha256=args.cache_sha256, dry_run=args.dry_run,
                                acquisition_budget_seconds=args.acquisition_budget_seconds,
                                max_statement_getter_calls=args.max_statement_getter_calls,
                                max_transport_requests=args.max_transport_requests)
    except (ValueError, RuntimeError, OSError) as exc:
        # Exception type, never provider text which may contain credentials.
        print(json.dumps({"status": "rejected_or_failed", "error_type": type(exc).__name__}))
        return 3
    print(json.dumps(summary if args.dry_run else {"summary_file": str(args.output_dir / "summary.json"),
                     "exit_code": code, "counts": summary["counts"], "symbol_status_counts": summary["symbol_status_counts"]}, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
