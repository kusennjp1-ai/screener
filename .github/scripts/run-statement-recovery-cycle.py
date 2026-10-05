"""Restore, plan and execute one bounded source cycle; never publish or write DBs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def seed_plan(base, cohort, symbols, now):
    selected = [symbol for symbol in symbols if symbol in cohort["symbols"]]
    return {"schema_version": batch.PLAN_SCHEMA, "verified_us_cohort": cohort,
            "batch_allowlist": selected, "evaluation_time": batch.timestamp(now),
            "source_data_as_of": json.loads(base)["as_of_date"],
            "selected": [{"symbol": symbol, "attributes": list(batch.ATTRIBUTES),
                          "targets": ["eps", "sales", "annual_history"]} for symbol in selected]}


def restore_archive(restored, destination, *, base, cohort, now):
    provenance = archive._read(restored / "restored.json")[0]
    files = restored / "files"
    if provenance.get("kind") == "recovery_archive" and (files / "cycle.json").is_file():
        cycle = archive._read(files / "cycle.json")[0]
        if cycle.get("schema_version") != "financial-recovery-cycle-v1":
            raise ValueError("Unsupported recovery cycle")
        digest = cycle["archive_manifest_sha256"]
        archive.load_archive(files / "archive", digest, base_bytes=base, cohort=cohort, now=now)
        shutil.copytree(files / "archive", destination)
        if cycle.get("phase") == "prepared" and (files / "batch").is_dir():
            old_base = (files / "base.json").read_bytes()
            old_cohort = archive._read(files / "cohort.json")[0]
            partial = files / "batch"
            bindings = ({"summary_sha256": file_hash(partial / "summary.json")}
                        if (partial / "summary.json").is_file() else {
                            "plan_sha256": file_hash(partial / "plan.json"),
                            "attempts_sha256": file_hash(partial / "attempts.json"),
                            "cache_sha256": file_hash(partial / "cache-manifest.json")})
            digest = archive.merge_batch(destination, digest, batch_dir=partial, **bindings,
                base_bytes=old_base, cohort=old_cohort, now=now)
        return digest, provenance
    if provenance.get("kind") == "recovery_archive":
        # Import the first already-verified 200-symbol bootstrap once, retaining
        # its complete pilot seed as well as every newly captured source.
        old_base = (files / "base.json").read_bytes()
        old_cohort = archive._read(files / "cohort.json")[0]
        if not (files / "batch" / "summary.json").is_file() or not (files / "retained-pilot").is_dir():
            raise ValueError("Prior recovery artifact has no cumulative archive or bootstrap evidence")
        digest = archive.create_archive(destination, base_bytes=old_base, cohort=old_cohort, now=now)
        plan = seed_plan(old_base, old_cohort, ("NVDA", "AMD", "VIRT"), now)
        digest = archive.seed_retained_acquisitions(destination, digest,
            artifact_dir=files / "retained-pilot", plan=plan, base_bytes=old_base, now=now)
        digest = archive.merge_batch(destination, digest, batch_dir=files / "batch",
            summary_sha256=file_hash(files / "batch" / "summary.json"),
            base_bytes=old_base, cohort=old_cohort, now=now)
        archive.load_archive(destination, digest, base_bytes=base, cohort=cohort, now=now)
        return digest, provenance
    if provenance.get("kind") != "reviewed_pilot":
        raise ValueError("Unsupported restored source")
    digest = archive.create_archive(destination, base_bytes=base, cohort=cohort, now=now)
    plan = seed_plan(base, cohort, ("NVDA", "AMD", "VIRT"), now)
    digest = archive.seed_retained_acquisitions(destination, digest,
        artifact_dir=files, plan=plan, base_bytes=base, now=now)
    return digest, provenance


def run(inputs, restored, output, *, dry_run=False):
    base = (inputs / "base.json").read_bytes()
    cohort = archive._read(inputs / "cohort.json")[0]
    now = datetime.now(timezone.utc)
    archive.verify_base(base, cohort, now=now)
    output.mkdir(parents=True, exist_ok=False)
    (output / "base.json").write_bytes(base)
    batch.write_json(output / "cohort.json", cohort)
    destination = output / "archive"
    digest, provenance = restore_archive(restored, destination, base=base, cohort=cohort, now=now)
    batch.write_json(output / "source-provenance.json", provenance)
    previous_digest = digest
    current = archive.load_archive(destination, digest, base_bytes=base, cohort=cohort, now=now)
    planned, plan, _ = archive.plan_archive(current, base_bytes=base, cohort=cohort, now=now)
    batch.write_json(output / "plan.json", plan)
    report = {"eligible": planned.eligible_count, "selected": len(planned.symbols),
              "symbols": list(planned.symbols), "provider_state": planned.provider_state,
              "invalid_receipts": list(planned.invalid_receipts), "cause_counts": dict(planned.cause_counts),
              "required_work_items": len(planned.required_work)}
    batch.write_json(output / "planning-report.json", report)
    # Preserve the trusted archive identity before any provider work. A crash
    # artifact must reconcile its original attempt journal before continuing.
    batch.write_json(output / "cycle.json", {
        "schema_version": "financial-recovery-cycle-v1", "phase": "prepared",
        "dry_run": dry_run, "archive_manifest_sha256": digest,
        "base_artifact_sha256": cohort["base_artifact_sha256"], "published": False})
    result, code = None, 0
    if planned.symbols:
        cache, cache_sha = archive.export_cache(current, plan, base, output / "selected-cache", now=now)
        result, code = batch.collect(plan, base, output / "batch", cache_manifest=cache, cache_sha256=cache_sha,
                                    dry_run=dry_run, acquisition_budget_seconds=1080,
                                    max_statement_getter_calls=400, max_transport_requests=1000)
        if not dry_run:
            digest = archive.merge_batch(destination, digest, batch_dir=output / "batch",
                summary_sha256=file_hash(output / "batch" / "summary.json"),
                base_bytes=base, cohort=cohort, now=datetime.now(timezone.utc))
    elif planned.provider_state != "available":
        code = 2
    checked = archive.load_archive(destination, digest, base_bytes=base, cohort=cohort,
                                   now=datetime.now(timezone.utc))
    cycle = {"schema_version": "financial-recovery-cycle-v1", "phase": "completed", "dry_run": dry_run,
             "code_revision": os.environ.get("GITHUB_SHA"), "source_data_as_of": json.loads(base)["as_of_date"],
             "base_artifact_sha256": cohort["base_artifact_sha256"],
             "previous_archive_manifest_sha256": previous_digest, "archive_manifest_sha256": digest,
             "retained_receipts": len(checked.manifest["receipts"]),
             "retained_symbols": len({item["symbol"] for item in checked.manifest["receipts"].values()}),
             "selected_symbols": len(planned.symbols), "provider_state_before": planned.provider_state,
             "exit_code": code, "published": False}
    batch.write_json(output / "cycle.json", cycle)
    print(json.dumps({**cycle, "next_batch_first": list(planned.symbols)[:3],
                      "next_batch_last": list(planned.symbols)[-3:],
                      "acquisition_counts": result.get("counts") if result else None}, sort_keys=True))
    return code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--restored", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    raise SystemExit(run(args.inputs, args.restored, args.output, dry_run=args.dry_run))
