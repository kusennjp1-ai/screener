"""Offline NVDA/AAOI due-target review. Never acquires, retries, admits or publishes."""
from __future__ import annotations

import argparse
from dataclasses import asdict, replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services import statement_refresh_planning as planning

SCHEMA = "financial-targeted-recovery-preflight-request-v1"
TARGETS = ("eps", "sales", "annual_history")
SYMBOLS = frozenset(("NVDA", "AAOI"))


def exact(value, fields, label):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError(f"Invalid closed {label}")


def validate_request(request, *, now):
    exact(request, ("schema_version", "created_at", "expires_at", "source", "base_sha256", "cohort_sha256",
                    "selection", "limits", "publication_authority", "provider_execution", "financial_admission"), "target request")
    if (request["schema_version"] != SCHEMA or request["publication_authority"] != "none"
            or request["provider_execution"] is not False or request["financial_admission"] is not False):
        raise ValueError("Preflight grants no acquisition or publication authority")
    created, expires = batch.clock(request["created_at"]), batch.clock(request["expires_at"])
    if not created <= now < expires or not timedelta(0) < expires-created <= timedelta(hours=2):
        raise ValueError("A new finite current preflight request is required")
    source = request["source"]
    exact(source, ("run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256", "archive_manifest_sha256",
                   "base_sha256", "cohort_sha256"), "retained source identity")
    for key in ("run_id", "run_attempt", "artifact_id"):
        if type(source[key]) is not int or source[key] <= 0:
            raise ValueError("Invalid retained source attempt")
    import re
    if not isinstance(source["head_sha"], str) or not re.fullmatch(r"[a-f0-9]{40}", source["head_sha"]):
        raise ValueError("Invalid retained source code identity")
    for container, keys in ((source, ("artifact_sha256", "archive_manifest_sha256", "base_sha256", "cohort_sha256")),
                            (request, ("base_sha256", "cohort_sha256"))):
        for key in keys:
            archive._sha(container[key])
    exact(request["limits"], ("max_symbols", "max_statement_getter_calls"), "target limits")
    if (request["limits"] != {"max_symbols": 2, "max_statement_getter_calls": 4}
            or any(type(v) is not int for v in request["limits"].values())):
        raise ValueError("Target preflight is bounded to two symbols and four getters")
    selection = request["selection"]
    if not isinstance(selection, list) or len(selection) != 2:
        raise ValueError("Explicit NVDA and AAOI selection is required")
    selected = {}
    for entry in selection:
        exact(entry, ("symbol", "targets"), "target selection")
        if entry["symbol"] not in SYMBOLS or entry["symbol"] in selected:
            raise ValueError("Only the two reviewed named symbols are supported")
        targets = entry["targets"]
        if not isinstance(targets, list) or not targets or targets != [target for target in TARGETS if target in targets]:
            raise ValueError("Only explicit canonical financial targets are supported")
        selected[entry["symbol"]] = tuple(targets)
    return selected


def select_due_targets(planned, selected):
    """Filter the complete planner queue, never sort, waive holds or add work."""
    if planned.provider_state != "available" or planned.invalid_receipts:
        raise ValueError("Provider stop or invalid receipt blocks targeted planning")
    if set(selected) != SYMBOLS or not SYMBOLS <= set(planned.eligible_symbols):
        raise ValueError("Target selection differs from the complete verified cohort")
    chosen = []
    for item in planned.required_work:
        if item.symbol not in selected:
            continue
        requested = selected[item.symbol]
        requirements = tuple(r for r in item.requirements if r.target in requested)
        if (tuple(r.target for r in requirements) != requested
                or any(r.state != "ready" or r.due_since is None or r.due_since > planned.evaluated_at for r in requirements)):
            raise ValueError(f"Target is not independently due and unblocked: {item.symbol}")
        chosen.append(replace(item, requirements=requirements))
    if len(chosen) != 2 or len({item.symbol for item in chosen}) != 2:
        raise ValueError("Named targets are absent from the existing due queue")
    if sum(len(item.attributes) for item in chosen) > 4:
        raise ValueError("Named target getter bound exceeded")
    return replace(planned, batch=tuple(chosen))


def bound_input(path, expected, maximum=batch.MAX_ARTIFACT_BYTES):
    value, content = archive._read(path, maximum)
    if batch.digest_bytes(content) != expected:
        raise ValueError("Preflight input digest changed")
    return value, content


def serializable(value):
    return json.loads(json.dumps(value, default=lambda item: batch.timestamp(item) if isinstance(item, datetime) else item))


def receipt_bound_attempt(original, *, symbol, attribute, receipt_sha, now):
    """Bind the adapted index back to the exact successful original journal."""
    receipt = original.manifest["receipts"][receipt_sha]
    attempts = [event for event in original.manifest["attempts"].values()
                if event["symbol"] == symbol and attribute in event["attributes"]]
    latest = max(attempts, key=lambda event: (batch.clock(event["attempted_at"]), event["attempt_id"]), default=None)
    if latest is None or latest["outcome"] != "succeeded" or latest.get("http_status") in (403, 429):
        raise ValueError("Named target lacks a receipt-bound successful prior acquisition")
    journal = original.objects[latest["source_object_sha256"]][0]
    entries = [entry for entry in journal.get("attempts", []) if entry.get("attempt_id") == latest["attempt_id"]]
    raw = original.acquisitions[receipt_sha]["raw"]
    if len(entries) != 1:
        raise ValueError("Named target has an ambiguous original journal")
    entry = entries[0]
    if (entry.get("symbol") != symbol or receipt.get("symbol") != symbol
            or entry.get("attribute") != attribute or receipt.get("attribute") != attribute
            or entry.get("attributes") != [attribute] or entry.get("outcome") != "succeeded"
            or entry.get("capture_id") != receipt["capture_id"]
            or not batch.clock(entry["attempted_at"]) <= batch.clock(receipt["observed_at"])
                <= batch.clock(raw["getter_completed_at"]) <= batch.clock(entry["completed_at"]) <= now):
        raise ValueError("Named target journal does not bind its exact original receipt")
    return latest, entry


def prepare(*, source_files, base_path, cohort_path, request_path, output, now):
    if any(".." in Path(path).parts for path in (source_files, base_path, cohort_path, request_path, output)):
        raise ValueError("Parent traversal is not permitted in preflight paths")
    output = archive._safe(output)
    roots = [archive._safe(source_files), archive._safe(base_path).parent, archive._safe(cohort_path).parent,
             Path(__file__).resolve().parents[3]]
    if output.exists() or any(output == root or output in root.parents or root in output.parents for root in roots):
        raise ValueError("Target preflight output must be new and separate from inputs and controller")
    request, request_bytes = archive._read(request_path, 16384)
    selected = validate_request(request, now=now)
    source = request["source"]
    old_base_value, old_base = bound_input(source_files / "base.json", source["base_sha256"], batch.MAX_BASE_BYTES)
    old_cohort, _ = bound_input(source_files / "cohort.json", source["cohort_sha256"])
    base, base_bytes = bound_input(base_path, request["base_sha256"], batch.MAX_BASE_BYTES)
    cohort, _ = bound_input(cohort_path, request["cohort_sha256"])
    if cohort.get("symbols") != old_cohort.get("symbols"):
        raise ValueError("Target preflight must preserve the complete original cohort and order")
    if batch.day(base["as_of_date"]) < batch.day(old_base_value["as_of_date"]):
        raise ValueError("Target price input predates the original acquisition base")
    root = source_files / "archive"
    original = archive.load_archive(root, source["archive_manifest_sha256"], base_bytes=old_base, cohort=old_cohort, now=now)
    if original.manifest["binding"] != archive.verify_base(old_base, old_cohort, now=now):
        raise ValueError("Retained archive differs from its original source binding")
    planned, _, _ = archive.plan_archive(original, base_bytes=base_bytes, cohort=cohort, now=now, batch_limit=200)
    targeted = select_due_targets(planned, selected)
    exported = planning.export_statement_batch_plan(targeted, base_artifact_sha256=cohort["base_artifact_sha256"],
        source_data_as_of=base["as_of_date"], batch_allowlist=targeted.symbols)
    exported["verified_us_cohort"] = cohort
    batch.validate_plan(exported, base_bytes)
    receipt_audit = []
    for item in targeted.batch:
        attributes = []
        for attribute in item.attributes:
            receipt_sha = original.manifest["current"].get(f"{item.symbol}/{attribute}")
            if receipt_sha is None:
                raise ValueError("Named due work must retain its actual original receipt")
            receipt = original.manifest["receipts"][receipt_sha]
            latest, journal = receipt_bound_attempt(original, symbol=item.symbol, attribute=attribute, receipt_sha=receipt_sha, now=now)
            attributes.append({"attribute": attribute, "receipt_sha256": receipt_sha,
                "capture_id": receipt["capture_id"], "observed_at": receipt["observed_at"],
                "attempt_id": latest["attempt_id"], "attempted_at": latest["attempted_at"],
                "completed_at": journal["completed_at"], "attempt_object_sha256": latest["source_object_sha256"]})
        receipt_audit.append({"symbol": item.symbol, "targets": list(item.ready_targets), "attributes": attributes,
            "requirements": serializable([asdict(r) for r in item.requirements])})
    report = serializable(asdict(planned))
    audit = {"schema_version": "financial-targeted-recovery-offline-preflight-v1",
        "evaluated_at": batch.timestamp(now), "expires_at": request["expires_at"],
        "publication_authority": "none", "provider_execution": False, "financial_admission": False,
        "current_remote_continuity_verified": False,
        "required_next_gate": "authenticate_latest_serial_recovery_attempt_and_review_current_execution_plan",
        "request_sha256": batch.digest_bytes(request_bytes), "source": source,
        "base_sha256": request["base_sha256"], "cohort_sha256": request["cohort_sha256"],
        "full_cohort_count": len(cohort["symbols"]), "default_batch_limit": 200,
        "limits": request["limits"], "selected_symbols": list(targeted.symbols),
        "selection": receipt_audit, "retry_decisions": [], "source_rechecks": [], "provider_resume": None,
        "plan_sha256": batch.digest_bytes(batch._json_bytes(exported)),
        "full_plan_report_sha256": batch.digest_bytes(batch._json_bytes(report))}
    for name, value in (("plan.json", exported), ("full-plan-report.json", report), ("preflight.json", audit)):
        archive._write_immutable(output / name, batch._json_bytes(value))
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("source-files", "base", "cohort", "request", "output"):
        parser.add_argument(f"--{flag}", required=True, type=Path)
    args = parser.parse_args()
    result = prepare(source_files=args.source_files, base_path=args.base, cohort_path=args.cohort,
        request_path=args.request, output=args.output, now=datetime.now(timezone.utc))
    print(json.dumps({"selected_symbols": result["selected_symbols"], "provider_execution": False,
                      "publication_authority": "none"}))


if __name__ == "__main__":
    main()
