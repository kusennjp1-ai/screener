"""Offline, bounded summaries of private price traces; never price admission.

Only fixed reason codes and counts reach Actions logs. The full event trace
remains in runner temporary storage, outside all existing artifact paths.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys

MAX_TRACE_BYTES = 128 * 1024 * 1024
MAX_LOG_BYTES = 64 * 1024
STAGES = frozenset(("seed_input", "seed_sync", "seed_prepare", "seed_batch", "cache_prepare", "db_prepare",
                    "db_commit", "db_session", "db_row_prepare", "db_rollback", "db_close", "refresh_fetch",
                    "refresh_coverage", "cache_read", "cache_read_aborted", "chart_snapshot", "chart_display",
                    "chart_serialize", "chart_output", "prior_link"))
STATUSES = frozenset(("parsed", "hash_observation_unavailable", "accepted", "rejected", "predicate_error",
                      "committed", "failed", "received", "missing_response", "omitted", "nonempty",
                      "matched", "context_mismatch", "unavailable", "success", "up_to_date",
                      "live_only", "missing_manifest", "error", "hit", "miss", "staged", "skipped",
                      "prepared", "raised", "started", "returned", "not_attempted_no_coherent_history",
                      "attempted", "not_needed", "fresh", "stale", "no_history", "unsupported",
                      "no_rows_in_window", "insufficient_rows", "incoherent_history", "bulk_read_error",
                      "network_error", "invalid_manifest", "missing_bundle", "checksum_mismatch"))
REJECTIONS = frozenset(("empty_history", "missing_columns", "nonfinite_values", "invalid_index",
                       "price_discontinuity", "invalid_ohlcv", "no_rows_in_window", "insufficient_rows",
                       "incoherent_history", "bulk_read_error", "no_serializable_bars"))
OMISSION_REASONS = frozenset(("no_rows_in_window", "insufficient_rows", "incoherent_history",
                             "bulk_read_error", "no_serializable_bars"))
FAILURE_KINDS = frozenset(("no_price_data", "rate_limit", "transient", "circuit_open"))


@dataclass(frozen=True)
class StaticCIContext:
    root: Path
    run_id: str
    market: str = "US"

    @property
    def path(self):
        return self.root / "diagnostics/us/cache-only-chart-omissions.json"


def static_ci_context(market, *, output_dir=None):
    """Select limited CI observations, never authenticate or admit price data.

    Keep this out of the common runtime and the frozen workflow: CI hold runs
    skip both producer CLIs entirely. Local, PR, workflow_run and non-US calls
    retain their existing explicit opt-in behavior.
    """
    try:
        env = os.environ
        repository = "kusennjp1-ai/screener"
        if (market != "US" or env.get("GITHUB_ACTIONS") != "true"
                or env.get("GITHUB_REPOSITORY") != repository
                or env.get("GITHUB_WORKFLOW_REF") != repository + "/.github/workflows/static-site.yml@refs/heads/main"
                or env.get("GITHUB_REF") != "refs/heads/main"
                or env.get("GITHUB_JOB") != "build-market"
                or env.get("GITHUB_EVENT_NAME") not in {"schedule", "workflow_dispatch"}):
            return None
        run, attempt = env.get("GITHUB_RUN_ID", ""), env.get("GITHUB_RUN_ATTEMPT", "")
        if not all(re.fullmatch(r"[1-9][0-9]{0,19}", value) for value in (run, attempt)):
            return None
        sha = _hex(env.get("GITHUB_SHA"), 40)
        if sha is None or env.get("GITHUB_WORKFLOW_SHA") != sha:
            return None
        repository_root = Path(__file__).resolve().parents[3]
        checkout = subprocess.run(["git", "-C", str(repository_root), "rev-parse", "HEAD"],
                                  check=True, capture_output=True, text=True, timeout=5).stdout.strip()
        if checkout != sha:
            return None
        temporary = Path(env.get("RUNNER_TEMP", ""))
        if not temporary.is_absolute():
            return None
        unresolved = temporary / "price-pipeline"
        if any(path.is_symlink() for path in (unresolved, *unresolved.parents)):
            return None
        root = unresolved.resolve()
        if not root.is_relative_to(temporary.resolve()):
            return None
        public_roots = [repository_root, *(Path(path) for path in (
            "/tmp/static-data", "/tmp/daily-price", "/tmp/daily-price-promotion", "/tmp/feature-run-out",
        ))]
        if output_dir is not None:
            public_roots.append(Path(output_dir).resolve())
        if any(root.is_relative_to(public) or public.is_relative_to(root)
               for public in (path.resolve() for path in public_roots)):
            return None
        return StaticCIContext(root=root, run_id=f"{repository}:{run}:{attempt}:US:{checkout}")
    except Exception:
        # Observation setup is best effort and must not affect source admission.
        return None


def prior_binding(context):
    try:
        _, trace = read_trace(context.path, run_id=context.run_id, market=context.market)
        return verified_binding(trace)
    except Exception:
        return None


def log_private_trace(context):
    """Bounded, fixed-code aggregate only; preserve the producer's outcome."""
    try:
        report, trace = read_trace(context.path, run_id=context.run_id, market=context.market)
        body = json.dumps(summarize(report, trace), sort_keys=True)
        body = body if len(body.encode()) <= MAX_LOG_BYTES else "log_budget_exceeded"
    except Exception:
        body = "unavailable_or_unbound"
    try:
        print("Price pipeline summary: " + body)
    except Exception:
        pass  # Even a broken log stream must not replace the original failure.


def _code(value, allowed):
    return value if isinstance(value, str) and value in allowed else "unclassified"


def _hex(value, length):
    return value if isinstance(value, str) and re.fullmatch(rf"[a-f0-9]{{{length}}}", value) else None


def _day(value):
    try:
        return value if isinstance(value, str) and date.fromisoformat(value).isoformat() == value else None
    except ValueError:
        return None


def _revision(value, market):
    prefix = f"daily_prices_{str(market).lower()}:"
    if not isinstance(value, str) or not re.fullmatch(re.escape(prefix) + r"[0-9]{14}", value):
        return None
    try:
        datetime.strptime(value[len(prefix):], "%Y%m%d%H%M%S")
        return value
    except ValueError:
        return None


def read_trace(path, *, run_id, market):
    if (not path.is_file() or any(p.is_symlink() for p in (path, *path.parents))
            or path.stat().st_size > MAX_TRACE_BYTES):
        raise ValueError("missing_or_oversize_trace")
    report = json.loads(path.read_text())
    trace = report.get("pipeline_observations", {})
    if (report.get("schema_version") != "cache-only-chart-omissions-v1"
            or report.get("market") != market or trace.get("market") != market
            or trace.get("schema_version") != "price-pipeline-observations-v1"
            or trace.get("run_id") != run_id or not isinstance(trace.get("events"), list)):
        raise ValueError("trace_context_mismatch")
    return report, trace


def verified_binding(trace):
    value = trace.get("input") or {}
    sha256, revision = _hex(value.get("sha256"), 64), _revision(value.get("source_revision"), trace.get("market"))
    if (sha256 and revision and value.get("market") == trace.get("market")
            and value.get("hash_basis") == "local_file_after_parse"
            and value.get("download_hash_verified") is True):
        return sha256, revision
    return None


def summarize(report, trace):
    source = trace.get("input") or {}
    counts = {}
    for event in trace["events"]:
        if not isinstance(event, dict):
            event = {}
        stage = _code(event.get("stage"), STAGES)
        source_code = _code(event["source"], {"seed_import", "refresh"}) if "source" in event else "unspecified"
        sources = counts.setdefault(stage, {"by_source": {}})["by_source"]
        group = sources.setdefault(source_code, {"events": 0, "status_counts": Counter(),
                                                 "rejection_counts": Counter(), "reason_counts": Counter(),
                                                 "failure_kind_counts": Counter()})
        group["events"] += 1
        group["status_counts"][_code(event["status"], STATUSES) if "status" in event else "not_recorded"] += 1
        for field, allowed in [("rejection", REJECTIONS), ("reason", OMISSION_REASONS), ("failure_kind", FAILURE_KINDS)]:
            if event.get(field) is not None:
                group[field + "_counts"][_code(event[field], allowed)] += 1
        if stage == "db_commit":
            for key in ("committed_rows_known_sum", "committed_rows_unknown_events",
                        "committed_rows_not_recorded_events", "committed_rows_unconfirmed_events"):
                group.setdefault(key, 0)
            rows = event.get("committed_rows")
            if "committed_rows" not in event:
                group["committed_rows_not_recorded_events"] += 1
            elif rows is None:
                group["committed_rows_unknown_events"] += 1
            elif event.get("status") == "committed" and type(rows) is int and rows >= 0:
                group["committed_rows_known_sum"] += rows
            else:
                group["committed_rows_unconfirmed_events"] += 1
    omission_counts = report.get("counts_by_reason") or {}
    return {"schema_version": "price-pipeline-log-summary-v1", "publication_authority": "none",
            "market": trace["market"], "run_id": trace["run_id"],
            "export_completed": report.get("export_completed") if type(report.get("export_completed")) is bool else None,
            "chart_bundle_started": report.get("chart_bundle_started") if type(report.get("chart_bundle_started")) is bool else None,
            "omission_counts_by_reason": {key: omission_counts.get(key) if type(omission_counts.get(key)) is int and omission_counts[key] >= 0 else None for key in sorted(OMISSION_REASONS)},
            "input": {"sha256": _hex(source.get("sha256"), 64),
                      "source_revision": _revision(source.get("source_revision"), trace["market"]),
                      "as_of_date": _day(source.get("as_of_date")),
                      "hash_basis": _code(source.get("hash_basis"), {"manifest_metadata", "local_file_after_parse"}),
                      "download_hash_verified": source.get("download_hash_verified") is True},
            "verified_seed_binding_available": verified_binding(trace) is not None,
            "counts_are_per_stage_observations_not_global_coverage": True,
            "stages": counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("binding", "summary"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--market", choices=("US",), required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    path = Path(args.root) / "diagnostics" / args.market.lower() / "cache-only-chart-omissions.json"
    try:
        report, trace = read_trace(path, run_id=args.run_id, market=args.market)
        if args.command == "binding":
            binding = verified_binding(trace)
            if binding:
                print("\n".join(binding))
        else:
            text = json.dumps(summarize(report, trace), sort_keys=True)
            print("Price pipeline summary: " + (text if len(text.encode()) <= MAX_LOG_BYTES else "log_budget_exceeded"))
    except Exception:
        # No raw errors or source fields, and no change to the producer's exit.
        if args.command == "summary":
            print("Price pipeline summary: unavailable_or_unbound")
    return 0


if __name__ == "__main__":
    sys.exit(main())
