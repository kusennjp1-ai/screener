"""One immutable, reviewed EDF visit; no provider, price refresh or retry policy.

The pins identify a review, not permission to dispatch or publish. In particular
its historical dispatch_approved=false flag is preserved. Live execution also
requires the separately reviewed request and aggregate retention admission.
"""
from __future__ import annotations

import argparse
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
from types import SimpleNamespace
import zipfile

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive

REVIEW_FILES = {
    "dispatch-review.json": "9ab65a7afb2033297b0f286a64de7ad1650fdb64ac9bd77f2def672ac4ed05a0",
    "collector-plan.json": "ba26d363ccc5d4b6623db9ba3388bc6de25e1bd1f77f411b8feeb0a3b4f45485",
    "queue-guard.json": "db45ba1737755601308caea50cb5030ebaff32427fa3484d1cec6557bc218679",
    "earliest-deadline-review-queue.json": "342c1e4a993f0da892ad4affc87197fc7b67f2df3e87485da44ec8d95abb2788",
}
SOURCE = {
    "acquisition_base_sha256": "2524eeac36bcb79d3ebe75f7f57d5672e91e1dafcd80a23d180ae39de867b932",
    "archive_manifest_sha256": "f49657581a65a88a7cdbb920e6650295e5406f3d9da162f4636614951f2fefaa",
    "artifact_id": 11307162746,
    "artifact_name": "financial-statement-recovery-4b27798b9b04528737938bb5844a8d86a704c58d-8",
    "artifact_sha256": "c4b07d50e357fb556fda62c419f0d549a1a7e62fd62dccd3a501d4d563939dbb",
    "cohort_sha256": "36a83c34c33b0158f1d246226d8d538797c6c6e6494669c6feacefa82da12580",
    "head_sha": "4b27798b9b04528737938bb5844a8d86a704c58d",
    "repository": "kusennjp1-ai/screener", "run_attempt": 8, "run_id": 37203329163,
    "workflow": ".github/workflows/financial-statement-recovery.yml",
}
PROJECTION_SHA256 = "a93042a6f6ad40c9bbf0f518bf5580d1a1a014e2fc70380569edcde76c965b9a"
SELECTED_CACHE_SHA256 = "b5e97d773cbb3feede46d83a8103654379426e60ef4d591f5e4ccb1066ea2f17"
EXCLUDED = ["BITU", "ETHE", "SBIT"]
DISPATCH_NOT_AFTER = "2026-10-07T10:21:54.945Z"
ADMISSION_SHA256 = "2459f355409fdbb03a9b9bb936eb2b4b56081dd4e37d9d7d3f7026900857bd5e"
ADMISSION_KEYS = frozenset("schema_version request_id execution_enabled expected_run_number first_attempt_only dispatch_not_before dispatch_not_after input_source review_sha256 collector_plan_sha256 queue_guard_sha256 queue_sha256 selected_cache_sha256 full_cohort_count applicable_count selection_count required_valid_through".split())
REVIEW_KEYS = frozenset("schema_version dispatch_approved main_must_remain source_branch current_source_head workflow trigger input_source collector_plan_file collector_plan_sha256 queue_sha256 projection_sha256 base_sha256 cohort_sha256 required_valid_through selection_count statement_getter_cap transport_request_cap additional_identity_requests acquisition_budget_seconds job_timeout_seconds output_hashes expected_output_name admission future_source_policy".split())
QUEUE_KEYS = frozenset("symbol complete_annual_history reason native annual_refresh_deadline current_annual_only_projection safe_complete_annual_only_subset last_actual_attempt annual_receipt quarterly_receipt annual_observed_at quarterly_observed_at".split())
GUARD_KEYS = frozenset("schema_version publication_authority evaluated_at projection_path projection_sha256 queue_path queue_sha256 full_cohort_count applicable_count excluded quarantined complete_histories unresolved_annual_cases first_deadline last_selected_deadline selection identity_limit".split())
PLAN_KEYS = frozenset("schema_version verified_us_cohort batch_allowlist evaluation_time required_valid_through source_data_as_of selected".split())
IDENTITY_KEYS = frozenset("identifiers_bound_to_financial_receipts identifiers_bound_to_price identity_match_limit market observed_identifiers observed_name registry_identifiers registry_name status symbol".split())


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def closed(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys), f"Malformed closed {label} schema")


def read_pinned(path, expected_sha256, maximum=16 * 1024 * 1024):
    path = archive._safe(path)
    require(path.is_file() and path.stat().st_size <= maximum, f"Missing or oversized pinned input: {path.name}")
    content = path.read_bytes()
    require(sha256(content) == expected_sha256, f"Pinned input bytes changed: {path.name}")
    return json.loads(content, object_pairs_hook=batch._pairs), content


def check_dispatch_clock(review, *, now):
    evaluated = batch.clock(review.plan["evaluation_time"])
    latest = batch.clock(DISPATCH_NOT_AFTER)
    require(evaluated <= now <= latest, "Bounded refresh dispatch time is outside the reviewed bound")
    require(latest + timedelta(seconds=review.request["job_timeout_seconds"]) ==
            batch.clock(review.guard["first_deadline"]), "Dispatch bound no longer reserves job finalization")
    require(batch.clock(review.plan["required_valid_through"]) - evaluated == timedelta(hours=36),
            "Bounded refresh requires the exact reviewed 36-hour horizon")


def load_review(reviewed_plan, *, now):
    """Load pinned siblings only; descriptive review paths never select input."""
    reviewed_plan = archive._safe(reviewed_plan)
    require(reviewed_plan.name == "dispatch-review.json", "Only the single reviewed dispatch envelope is supported")
    values, contents = {}, {}
    for name, expected in REVIEW_FILES.items():
        values[name], contents[name] = read_pinned(reviewed_plan.parent / name, expected)
    request, plan, guard, queue = (values[name] for name in (
        "dispatch-review.json", "collector-plan.json", "queue-guard.json", "earliest-deadline-review-queue.json"))
    closed(request, REVIEW_KEYS, "dispatch review")
    closed(request["input_source"], SOURCE, "source identity")
    require(request["input_source"] == SOURCE, "Original source identity changed")
    require(request["schema_version"] == "financial-statement-refresh-review-v1" and
            request["dispatch_approved"] is False, "Historical review is not a live dispatch authorization")
    require(request["current_source_head"] == SOURCE["head_sha"] and
            request["source_branch"] == "improve/mandatory-financial-source-recovery" and
            request["workflow"] == SOURCE["workflow"], "Reviewed source producer changed")
    fixed = {"collector_plan_file": "collector-plan.json", "collector_plan_sha256": REVIEW_FILES["collector-plan.json"],
             "queue_sha256": REVIEW_FILES["earliest-deadline-review-queue.json"], "projection_sha256": PROJECTION_SHA256,
             "base_sha256": SOURCE["acquisition_base_sha256"], "cohort_sha256": SOURCE["cohort_sha256"],
             "selection_count": 200, "statement_getter_cap": 400, "transport_request_cap": 1000,
             "additional_identity_requests": 0, "acquisition_budget_seconds": 1080, "job_timeout_seconds": 1500}
    require(all(type(request.get(k)) is type(v) and request[k] == v for k, v in fixed.items()),
            "Reviewed request bounds or input hashes changed")
    closed(plan, PLAN_KEYS, "collector plan")
    closed(guard, GUARD_KEYS, "queue guard")
    require(guard["schema_version"] == "bounded-refresh-queue-review-v1" and guard["publication_authority"] == "none" and
            guard["queue_sha256"] == request["queue_sha256"] and guard["projection_sha256"] == PROJECTION_SHA256,
            "Reviewed queue/projection binding changed")
    require(guard["excluded"] == EXCLUDED and guard["quarantined"] == [] and
            guard["full_cohort_count"] == 1894 and guard["applicable_count"] == 1891 and
            guard["complete_histories"] == 1801 and guard["unresolved_annual_cases"] == 90,
            "Reviewed applicability or quarantine changed")
    require(isinstance(queue, list) and len(queue) == 1891 and len({x.get("symbol") for x in queue}) == 1891,
            "Full reviewed applicability queue is required")
    for entry in queue:
        closed(entry, QUEUE_KEYS, "queue entry")
        require(batch.canonical_symbol(entry["symbol"]) and type(entry["complete_annual_history"]) is bool,
                "Malformed queue identity or availability")
    require(sum(entry["complete_annual_history"] for entry in queue) == guard["complete_histories"],
            "Full reviewed queue availability changed")
    sorted_queue = sorted(queue, key=lambda x: (not x["complete_annual_history"], x["annual_refresh_deadline"] or "9999",
                                               x["last_actual_attempt"] or "", x["symbol"]))
    require(queue == sorted_queue, "Earliest-deadline queue order changed")
    selected = queue[:200]
    require(all(x["complete_annual_history"] and x["annual_receipt"] and x["quarterly_receipt"] for x in selected),
            "The reviewed visit must contain 200 complete histories")
    require(len(guard["selection"]) == 200, "Reviewed selection size changed")
    for entry, checked in zip(selected, guard["selection"]):
        closed(checked, QUEUE_KEYS | {"identity", "applicability"}, "selected identity guard")
        require({k: checked[k] for k in QUEUE_KEYS} == entry, "Selected review differs from the full EDF queue")
        identity, applicable = checked["identity"], checked["applicability"]
        closed(identity, IDENTITY_KEYS, "retained ticker identity")
        require(identity["symbol"] == entry["symbol"] and identity["market"] == "US" and
                identity["status"] == "ticker_only" and identity["identifiers_bound_to_price"] is False and
                identity["identifiers_bound_to_financial_receipts"] is False and
                identity["observed_identifiers"] == {} and identity["registry_identifiers"] == {} and
                identity["registry_name"] is None, "Identity conflict or unsupported issuer assertion")
        require(applicable == {"version": "financial-instrument-applicability-v1", "status": "unverified",
                               "instrument_class": "unknown", "reason": "instrument_type_unverified",
                               "identity_binding": "unverified"}, "Selected identity is quarantined or not applicable")
    symbols = [entry["symbol"] for entry in selected]
    require(symbols[:4] == ["NVDA", "AMD", "VIRT", "A"] and symbols[-1] == "BBIO", "Exact reviewed visit changed")
    require(plan["selected"] == [{"symbol": symbol, "attributes": list(batch.ATTRIBUTES), "targets": ["annual_history"]}
                                 for symbol in symbols] and plan["batch_allowlist"] == symbols,
            "Plan must use both ordered getters and only annual_history for the exact EDF visit")
    require(plan["evaluation_time"] == guard["evaluated_at"] and
            plan["required_valid_through"] == request["required_valid_through"], "Reviewed plan clocks changed")
    require(guard["first_deadline"] == selected[0]["annual_refresh_deadline"] and
            guard["last_selected_deadline"] == selected[-1]["annual_refresh_deadline"], "Reviewed EDF deadlines changed")
    review = SimpleNamespace(request=request, plan=plan, guard=guard, queue=queue, contents=contents)
    check_dispatch_clock(review, now=now)
    return review


def load_admission(reviewed_plan, review, *, now, dry_run):
    admission, content = read_pinned(Path(reviewed_plan).parent / "dispatch-admission.json", ADMISSION_SHA256)
    validate_admission(admission, review, now=now, dry_run=dry_run, execution_context=os.environ)
    return admission, content


def validate_admission(admission, review, *, now, dry_run, execution_context):
    """Only the committed envelope can enable work; no flag/env bypass exists."""
    closed(admission, ADMISSION_KEYS, "bounded dispatch admission")
    expected = {"schema_version": "financial-statement-bounded-refresh-admission-v1",
                "request_id": "original-37203329163-attempt-8-first-200-20261006",
                "first_attempt_only": True, "dispatch_not_before": review.plan["evaluation_time"],
                "dispatch_not_after": DISPATCH_NOT_AFTER, "input_source": SOURCE,
                "review_sha256": REVIEW_FILES["dispatch-review.json"],
                "collector_plan_sha256": REVIEW_FILES["collector-plan.json"],
                "queue_guard_sha256": REVIEW_FILES["queue-guard.json"],
                "queue_sha256": REVIEW_FILES["earliest-deadline-review-queue.json"],
                "selected_cache_sha256": SELECTED_CACHE_SHA256,
                "full_cohort_count": 1894, "applicable_count": 1891, "selection_count": 200,
                "required_valid_through": review.plan["required_valid_through"]}
    require(all(type(admission.get(k)) is type(v) and admission[k] == v for k, v in expected.items()) and
            type(admission["execution_enabled"]) is bool, "Bounded admission request identity or scope changed")
    expected_number = admission["expected_run_number"]
    if admission["execution_enabled"]:
        require(type(expected_number) is int and expected_number > 0,
                "Enabled admission requires one explicit positive workflow run number")
        run_number = execution_context.get("GITHUB_RUN_NUMBER")
        # Workflow run numbers advance for each new push; attempt=1 alone does
        # not prevent a second push from repeating this same reviewed visit.
        require(isinstance(run_number, str) and run_number.isascii() and run_number.isdecimal() and
                run_number == str(expected_number), "Workflow run number differs from the single reviewed dispatch")
    else:
        require(expected_number is None, "Disabled admission must leave the workflow run number unassigned")
    check_dispatch_clock(review, now=now)
    if dry_run:
        return
    require(admission["execution_enabled"] is True, "Bounded refresh execution is disabled pending separate dispatch approval")
    require(execution_context.get("GITHUB_RUN_ATTEMPT") == "1", "Bounded refresh permits only a first attempt, never an automatic retry")
    require(execution_context.get("GITHUB_REPOSITORY") == SOURCE["repository"] and
            execution_context.get("GITHUB_REF_NAME") == review.request["source_branch"] and
            execution_context.get("GITHUB_EVENT_NAME") == "push", "Unreviewed bounded refresh execution context")
    run_id = execution_context.get("GITHUB_RUN_ID", "")
    require(run_id.isascii() and run_id.isdecimal() and int(run_id) > SOURCE["run_id"], "Stale bounded refresh execution")


def verify_original_inputs(review, base_bytes, cohort_bytes, provenance):
    require(sha256(base_bytes) == SOURCE["acquisition_base_sha256"] and sha256(cohort_bytes) == SOURCE["cohort_sha256"],
            "Original base/cohort bytes changed; public price regeneration is forbidden")
    cohort = json.loads(cohort_bytes, object_pairs_hook=batch._pairs)
    require(review.plan["verified_us_cohort"] == cohort and len(cohort["symbols"]) == 1894,
            "The full original 1,894-symbol cohort must be retained")
    require(set(cohort["symbols"]) - set(EXCLUDED) == {x["symbol"] for x in review.queue},
            "Only the reviewed three-fund applicability exclusions are permitted")
    expected = {"schema_version": "financial-source-restore-v1", "kind": "recovery_archive",
                **{k: SOURCE[k] for k in ("repository", "run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256")}}
    require(provenance == expected, "Bounded refresh original restored source changed or predecessor is stale")
    batch.validate_plan(review.plan, base_bytes)
    return cohort


def audit_global_barriers(current):
    """No selected-cohort filter may hide an old stop, missing or crash journal."""
    attempts = current.manifest.get("attempts")
    batches = current.manifest.get("batches")
    require(isinstance(attempts, dict) and isinstance(batches, dict), "Missing retained attempt/batch barrier index")
    for event in attempts.values():
        require(event.get("outcome") not in {"in_flight", "budget_stopped", "provider_blocked"} and
                event.get("http_status") not in (403, 429), "Unresolved retained provider/attempt barrier")
    for digest, (value, _) in current.objects.items():
        kind = current.manifest["objects"][digest]["kind"]
        if kind == "attempt_journal":
            require(isinstance(value.get("attempts"), list), "Missing original attempt journal")
            require(digest in batches, "Original attempt journal lacks retained batch reconciliation")
            for original in value["attempts"]:
                require(original.get("outcome") not in {"in_flight", "budget_stopped", "provider_blocked"} and
                        original.get("http_status") not in (403, 429), "Unresolved original attempt barrier")
                indexed = attempts.get(original.get("attempt_id"))
                require(indexed is not None and indexed == archive._adapt_attempt(original, digest),
                        "Original attempt is absent from the retained barrier index")
        if kind == "batch_summary":
            require("provider_stop" in value and "execution_stop" in value and
                    value["provider_stop"] is None and value["execution_stop"] is None,
                    "Missing or unresolved retained batch barrier")
        if kind in {"acquisition", "failed_acquisition"}:
            require(isinstance(value.get("transport_events"), list), "Missing original transport barrier evidence")
            failure = value.get("failure")
            if failure is not None:
                # Existing empty 200s remain source gaps. A failed transport,
                # unknown failure or restart intent cannot become retry consent.
                require(isinstance(failure, dict) and failure.get("kind") == "empty_getter_result",
                        "Unresolved retained acquisition failure barrier")
            for event in value["transport_events"]:
                require(isinstance(event, dict) and event.get("http_status") not in (403, 429) and
                        event.get("detected_http_status") not in (403, 429) and
                        not event.get("exception") and not event.get("error_type"),
                        "Unresolved retained transport barrier")
    for journal_sha, record in batches.items():
        require("provider_stop" in record and "execution_stop" in record and record["provider_stop"] is None and
                record["execution_stop"] is None and record.get("summary_sha256") in current.objects,
                "Missing or unresolved retained batch reconciliation")
        require(journal_sha in current.objects and current.manifest["objects"][journal_sha]["kind"] == "attempt_journal" and
                current.manifest["objects"][record["summary_sha256"]]["kind"] == "batch_summary",
                "Missing original journal/summary barrier evidence")
        summary = current.objects[record["summary_sha256"]][0]
        require(summary.get("attempts_sha256") == journal_sha and
                summary.get("plan_sha256") == record.get("plan_sha256") and
                summary.get("cache_manifest_sha256") == record.get("cache_sha256"),
                "Retained batch barrier reconciliation differs from original summary")


def validate_archive(review, current, *, base_bytes, cohort_bytes, provenance, now):
    cohort = verify_original_inputs(review, base_bytes, cohort_bytes, provenance)
    check_dispatch_clock(review, now=now)
    require(current.sha256 == SOURCE["archive_manifest_sha256"], "Bounded refresh predecessor manifest changed")
    audit_global_barriers(current)
    for entry in review.queue:
        symbol = entry["symbol"]
        for attribute, prefix in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
            receipt = entry[prefix + "_receipt"]
            require(current.manifest["current"].get(f"{symbol}/{attribute}") == receipt,
                    "Reviewed queue receipt is missing or a newer receipt changed the predecessor")
            if receipt is not None:
                require(receipt in current.acquisitions and
                        current.acquisitions[receipt]["context"]["observed_at"] == entry[prefix + "_observed_at"],
                        "Reviewed original receipt clock changed")
    # All selected receipts must still require the reviewed horizon. This is
    # an exact one-time visit; it never advances, rotates, or retries a cursor.
    for item, entry in zip(review.plan["selected"], review.guard["selection"]):
        for attribute, key in (("income_stmt", "annual_receipt"), ("quarterly_income_stmt", "quarterly_receipt")):
            raw = current.acquisitions[entry[key]]["raw"]
            state = batch.required_validity_state(raw, item["symbol"], attribute, item, review.plan, now=now)
            require(state["state"] != "current", "Reviewed refresh is no longer due for its fixed validity horizon")
    return SimpleNamespace(eligible_count=len(cohort["symbols"]), symbols=tuple(review.plan["batch_allowlist"]),
                           provider_state="available", invalid_receipts=(),
                           cause_counts={"reviewed_earliest_deadline_visit": 200}, required_work=tuple(review.plan["selected"]))


def verify_source_zip(restored):
    """Bind extracted retained files to the original complete immutable ZIP."""
    restored = archive._safe(restored)
    zip_path = archive._safe(restored / "source.zip")
    require(zip_path.is_file() and zip_path.stat().st_size <= 128 * 1024 * 1024 and
            sha256(zip_path.read_bytes()) == SOURCE["artifact_sha256"], "Original retained ZIP bytes changed")
    root = archive._safe(restored / "files")
    names, total = set(), 0
    with zipfile.ZipFile(zip_path) as source:
        require(len(source.infolist()) <= 30000, "Retained ZIP member bound exceeded")
        for member in source.infolist():
            path = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            require(not path.is_absolute() and "\\" not in member.filename and
                    all(part not in {"", ".", ".."} for part in member.filename.rstrip("/").split("/")) and
                    member.filename not in names and not stat.S_ISLNK(mode) and
                    (not stat.S_IFMT(mode) or stat.S_ISREG(mode) or stat.S_ISDIR(mode)), "Unsafe retained ZIP member")
            names.add(member.filename)
            total += member.file_size
            require(member.file_size <= 32 * 1024 * 1024 and total <= 512 * 1024 * 1024,
                    "Retained ZIP expansion bound exceeded")
            target = archive._safe(root / member.filename)
            if member.is_dir():
                require(target.is_dir(), "Missing retained source directory")
            else:
                require(target.is_file() and target.stat().st_size == member.file_size and
                        target.read_bytes() == source.read(member), "Extracted source differs from original retained ZIP")
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if archive._safe(path).is_file()}
    require(actual == {name for name in names if not name.endswith("/")}, "Unbound files in restored source")


def verify_restored_source(review, restored, *, now):
    """Verify the complete predecessor before creating any new cycle output."""
    verify_source_zip(restored)
    files = restored / "files"
    base_bytes, cohort_bytes = ((files / name).read_bytes() for name in ("base.json", "cohort.json"))
    provenance = archive._read(restored / "restored.json")[0]
    cohort = verify_original_inputs(review, base_bytes, cohort_bytes, provenance)
    cycle = archive._read(files / "cycle.json")[0]
    require(cycle.get("schema_version") == "financial-recovery-cycle-v1" and cycle.get("phase") == "completed" and
            cycle.get("dry_run") is False and cycle.get("published") is False and
            cycle.get("archive_manifest_sha256") == SOURCE["archive_manifest_sha256"] and
            cycle.get("base_artifact_sha256") == SOURCE["acquisition_base_sha256"] and
            cycle.get("code_revision") == SOURCE["head_sha"], "Unresolved or changed retained source cycle")
    current = archive.load_archive(files / "archive", SOURCE["archive_manifest_sha256"], base_bytes=base_bytes, cohort=cohort, now=now)
    validate_archive(review, current, base_bytes=base_bytes, cohort_bytes=cohort_bytes, provenance=provenance, now=now)
    return base_bytes, cohort_bytes


def prepare_inputs(reviewed_plan, restored, output, *, now):
    """Replace price/cohort regeneration with a checked exact-byte copy."""
    review = load_review(reviewed_plan, now=now)
    load_admission(reviewed_plan, review, now=now, dry_run=True)
    base_bytes, cohort_bytes = verify_restored_source(review, restored, now=now)
    output = archive._safe(output)
    output.mkdir(parents=True, exist_ok=False)
    (output / "base.json").write_bytes(base_bytes)
    (output / "cohort.json").write_bytes(cohort_bytes)
    return {"base_sha256": sha256(base_bytes), "cohort_sha256": sha256(cohort_bytes),
            "full_cohort_count": len(review.plan["verified_us_cohort"]["symbols"]), "applicable_count": len(review.queue), "selected_count": 200,
            "dispatch_not_after": DISPATCH_NOT_AFTER, "published": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reviewed-plan", required=True, type=Path)
    parser.add_argument("--restored", required=True, type=Path)
    parser.add_argument("--output-inputs", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare_inputs(args.reviewed_plan, args.restored, args.output_inputs, now=batch.utc_now()), sort_keys=True))
