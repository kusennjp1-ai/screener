"""Offline archive init/seed/plan/cache/merge. This CLI never calls providers."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime
import json
from pathlib import Path

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "seed", "plan", "cache", "merge"))
    parser.add_argument("--archive", required=True)
    parser.add_argument("--archive-sha256")
    parser.add_argument("--base", required=True)
    parser.add_argument("--cohort", required=True)
    parser.add_argument("--now", required=True, help="Explicit RFC3339 evaluation time")
    parser.add_argument("--plan", help="Bounded seed or collector plan JSON")
    parser.add_argument("--input-directory", help="Reviewed pilot or completed/interrupted collector output")
    parser.add_argument("--output-directory", help="New plan or cache output directory")
    parser.add_argument("--batch-limit", type=int, default=200)
    parser.add_argument("--refresh-through")
    parser.add_argument("--retry-decisions", help="JSON mapping actual attempt IDs to explicit retry deadlines")
    parser.add_argument("--source-rechecks", help="JSON mapping SYMBOL/target to receipt_id and recheck_after")
    parser.add_argument("--provider-resume", help="JSON with blocked_attempt_id and decided_at")
    parser.add_argument("--summary-sha256")
    parser.add_argument("--plan-sha256")
    parser.add_argument("--attempts-sha256")
    parser.add_argument("--cache-sha256")
    args = parser.parse_args(argv)
    try:
        _, base = archive._read(args.base, batch.MAX_BASE_BYTES)
        cohort, _ = archive._read(args.cohort)
        now = batch.clock(args.now)
        binding = archive.verify_base(base, cohort, now=now)
        if args.command == "init":
            sha = archive.create_archive(args.archive, base_bytes=base, cohort=cohort, now=now)
            print(json.dumps({"archive_manifest_sha256": sha}))
            return 0
        current = archive.load_archive(args.archive, args.archive_sha256, base_bytes=base, cohort=cohort, now=now)
        if args.command == "plan":
            decisions = archive._read(args.retry_decisions)[0] if args.retry_decisions else None
            rechecks = archive._read(args.source_rechecks)[0] if args.source_rechecks else None
            resume = archive._read(args.provider_resume)[0] if args.provider_resume else None
            if resume:
                resume = archive.planning.ProviderResume(resume["blocked_attempt_id"], batch.clock(resume["decided_at"]))
            planned, exported, _ = archive.plan_archive(current, base_bytes=base, cohort=cohort, now=now,
                batch_limit=args.batch_limit, refresh_through=batch.clock(args.refresh_through) if args.refresh_through else None,
                retry_decisions=decisions, source_rechecks=rechecks, provider_resume=resume)
            if not args.output_directory:
                parser.error("plan requires --output-directory")
            output = archive._safe(args.output_directory)
            if output.exists():
                raise archive.InvalidArchive("Plan output must be new")
            report = asdict(planned)
            serialized = json.loads(json.dumps(report, default=lambda v: batch.timestamp(v) if isinstance(v, datetime) else v))
            archive._write_immutable(output / "plan.json", batch._json_bytes(exported))
            archive._write_immutable(output / "report.json", batch._json_bytes(serialized))
            print(json.dumps({"selected_symbols": list(planned.symbols), "eligible_count": planned.eligible_count,
                              "provider_state": planned.provider_state, "plan_sha256": batch.digest_bytes(batch._json_bytes(exported))}))
            return 0
        if args.command in {"seed", "cache"}:
            if not args.plan:
                parser.error("seed/cache requires --plan")
            plan = archive._read(args.plan)[0]
            if (plan["verified_us_cohort"]["base_artifact_sha256"] != binding["base_artifact_sha256"]
                    or set(plan["verified_us_cohort"]["symbols"]) != set(cohort["symbols"])):
                raise archive.InvalidArchive("Plan differs from explicit current cohort")
            if args.command == "seed":
                if not args.input_directory:
                    parser.error("seed requires --input-directory")
                sha = archive.seed_retained_acquisitions(args.archive, args.archive_sha256,
                    artifact_dir=args.input_directory, plan=plan, base_bytes=base, now=now)
                print(json.dumps({"archive_manifest_sha256": sha}))
            else:
                if not args.output_directory:
                    parser.error("cache requires --output-directory")
                path, sha = archive.export_cache(current, plan, base, args.output_directory, now=now)
                print(json.dumps({"cache_manifest": str(path), "cache_manifest_sha256": sha}))
            return 0
        if not args.input_directory:
            parser.error("merge requires --input-directory")
        sha = archive.merge_batch(args.archive, args.archive_sha256, batch_dir=args.input_directory,
            summary_sha256=args.summary_sha256, plan_sha256=args.plan_sha256,
            attempts_sha256=args.attempts_sha256, cache_sha256=args.cache_sha256,
            base_bytes=base, cohort=cohort, now=now)
        print(json.dumps({"archive_manifest_sha256": sha}))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f"Archive operation rejected: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
