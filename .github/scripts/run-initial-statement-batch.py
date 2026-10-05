"""One bounded bootstrap from the reviewed pilot; never repeat a cold batch."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

from app.services.financial_statement_batch import collect, index_retained_acquisitions, write_json
from app.services.statement_refresh_planning import export_statement_batch_plan, plan_statement_refresh


def prepare_inputs(inputs, restored, output, *, now):
    base_bytes = (inputs / "base.json").read_bytes()
    base = json.loads(base_bytes)
    cohort = json.loads((inputs / "cohort.json").read_bytes())
    if hashlib.sha256(base_bytes).hexdigest() != cohort.get("base_artifact_sha256"):
        raise ValueError("Verified cohort and base bytes disagree")
    provenance = json.loads((restored / "restored.json").read_bytes())
    if (provenance.get("kind") != "reviewed_pilot" or provenance.get("run_id") != 37196464126
            or provenance.get("head_sha") != "b08a9ccaf842da6e172744429fc036d888bd020c"
            or provenance.get("artifact_sha256") != "96673847ade01f667e5efd4645574ed89a7c2a4fe4c67e2c91b1f1f1dcbd463d"):
        raise ValueError("Bootstrap requires the reviewed pilot; subsequent batches require the cumulative archive adapter")
    # Missing planner status does not claim a missing vendor value. The executor
    # validates/reuses the actual pilot cache before making any provider request.
    planned = plan_statement_refresh(eligible_symbols=cohort["symbols"], market="US", now=now,
                                     statuses={}, attempts=())
    plan = export_statement_batch_plan(planned, base_artifact_sha256=cohort["base_artifact_sha256"],
                                      source_data_as_of=base["as_of_date"], batch_allowlist=planned.symbols)
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "base.json", base)
    # Preserve exact original base bytes because the plan binds those bytes.
    (output / "base.json").write_bytes(base_bytes)
    write_json(output / "cohort.json", cohort)
    write_json(output / "plan.json", plan)
    write_json(output / "source-provenance.json", provenance)
    seed = output / "retained-pilot"
    shutil.copytree(restored / "files" / "acquisitions", seed / "acquisitions")
    manifest = index_retained_acquisitions(seed, plan, base_bytes, now=now)
    manifest_sha = write_json(seed / "cache-manifest.json", manifest)
    return plan, base_bytes, seed / "cache-manifest.json", manifest_sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--restored", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    plan, base, cache, sha = prepare_inputs(args.inputs, args.restored, args.output,
                                          now=datetime.now(timezone.utc))
    summary, code = collect(plan, base, args.output / "batch", cache_manifest=cache, cache_sha256=sha,
                            dry_run=args.dry_run, acquisition_budget_seconds=1080,
                            max_statement_getter_calls=400, max_transport_requests=1000)
    print(json.dumps(summary, allow_nan=False, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
