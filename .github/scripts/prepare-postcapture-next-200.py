"""Offline preparation of one exact postcapture next-200 visit.

This is not a collector or dispatch entry point. Its committed admission is
always disabled, and the production restore registry is empty. Finite offline
fixtures exercise preparation without granting source or publication authority.
Neither environment variables nor command-line arguments can activate a visit.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from datetime import timedelta
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import socket
from types import SimpleNamespace
from unittest.mock import patch

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.statement_retention_budget import StatementRetentionBudget

ROOT = Path(__file__).resolve().parents[2]
REVIEW_DIRECTORY = ROOT / ".github/bounded-refresh-next-200"
REVIEW_FILES = {'dispatch-review.json': '68ec4c15542851dd305baf5176a85e423c6d1d005d9b90253acad9d3a1e63d2a', 'retained-queue.json': 'b0b9eacb04bbe864f55798060ec9c2e47cdfa56a417c738b8dc078526f31060a', 'consumer-queue.json': '8ea15a9b5e8d24691c86cd1d2adf478c55a88c2dff0ea77a456d9c51fab23e38', 'dispatch-admission.json': '1b09c2b113207ae1c508ff8739545887e5bc70eb1e8fa547e1f958113540595d', 'collector-plan.json': 'dc6c7eb01230c5086d5400e91ff41d2bd52bece3a8c0b68ff1a8f380fd6ae8be'}
ORIGINAL_QUEUE_SHA256 = "342c1e4a993f0da892ad4affc87197fc7b67f2df3e87485da44ec8d95abb2788"
PROJECTION_SHA256 = "17c959817367ee02e8809f913a484b055a03024dc2dd91f976555f5765027d18"
CACHE_SHA256 = "025cd5dec973bc4cdca3eb42c6cbe385548ddfb727a022db889a70f85b521f04"
SOURCE = {
    "source_run_id": 37478731832, "source_run_attempt": 1,
    "source_artifact_sha256": "266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd",
    "archive_manifest_sha256": "2593d2c737724da007a72091b7b85d6007530e0fb6fc7e4e0765d75692b007d0",
    "base_sha256": "2524eeac36bcb79d3ebe75f7f57d5672e91e1dafcd80a23d180ae39de867b932",
    "cohort_sha256": "36a83c34c33b0158f1d246226d8d538797c6c6e6494669c6feacefa82da12580",
    "companion_run_id": 37495003542, "companion_run_attempt": 1, "companion_artifact_id": 11426862690,
    "companion_artifact_sha256": "f63ecbe50b61b49666abdfaa6bf2f30605a7ddb31af82d8a2e20da3ca1859d23",
}
BUDGET = {"max_symbols": 200, "statement_getters": 400, "transport_requests": 1000,
          "acquisition_seconds": 1080, "job_seconds": 1500, "finalization_reserve_seconds": 420,
          "minimum_getter_pause_seconds": 1.5, "caller_retries": 0, "additional_identity_requests": 0}
EXCLUDED = ["BITU", "ETHE", "SBIT"]
MISSING_PRIORS = [{'symbol': 'BHP', 'attribute': 'quarterly_income_stmt', 'decision_state': 'retry_decision_required', 'retry_not_before': None, 'attempt_id': '979692aa-d1c9-452c-bbaa-c0216f68d9b3:0079', 'attempted_at': '2026-10-04T12:32:22.155Z', 'failure_kind': 'empty_getter_result', 'outcome': 'failed', 'journal_sha256': '303132487ca6f0ab749faeebdbb9981fdfdc2e9ea4cb69160f8934c3e3b5e3e7'}, {'symbol': 'BTI', 'attribute': 'quarterly_income_stmt', 'decision_state': 'retry_decision_required', 'retry_not_before': None, 'attempt_id': '979692aa-d1c9-452c-bbaa-c0216f68d9b3:0195', 'attempted_at': '2026-10-04T12:35:35.059Z', 'failure_kind': 'empty_getter_result', 'outcome': 'failed', 'journal_sha256': '303132487ca6f0ab749faeebdbb9981fdfdc2e9ea4cb69160f8934c3e3b5e3e7'}, {'symbol': 'BXDC', 'attribute': 'income_stmt', 'decision_state': 'retry_decision_required', 'retry_not_before': None, 'attempt_id': '979692aa-d1c9-452c-bbaa-c0216f68d9b3:0218', 'attempted_at': '2026-10-04T12:36:13.231Z', 'failure_kind': 'empty_getter_result', 'outcome': 'failed', 'journal_sha256': '303132487ca6f0ab749faeebdbb9981fdfdc2e9ea4cb69160f8934c3e3b5e3e7'}, {'symbol': 'CCEP', 'attribute': 'quarterly_income_stmt', 'decision_state': 'retry_decision_required', 'retry_not_before': None, 'attempt_id': '979692aa-d1c9-452c-bbaa-c0216f68d9b3:0283', 'attempted_at': '2026-10-04T12:38:01.411Z', 'failure_kind': 'empty_getter_result', 'outcome': 'failed', 'journal_sha256': '303132487ca6f0ab749faeebdbb9981fdfdc2e9ea4cb69160f8934c3e3b5e3e7'}]
MISSING_PRIOR_KEYS = frozenset((x["symbol"], x["attribute"]) for x in MISSING_PRIORS)
QUEUE_KEYS = frozenset("symbol complete_annual_history reason native annual_refresh_deadline current_annual_only_projection safe_complete_annual_only_subset last_actual_attempt annual_receipt quarterly_receipt annual_observed_at quarterly_observed_at".split())
RETAINED_KEYS = frozenset("annual_receipt quarterly_receipt annual_observed_at quarterly_observed_at".split())
PLAN_KEYS = frozenset("schema_version verified_us_cohort batch_allowlist evaluation_time required_valid_through source_data_as_of selected".split())
REVIEW_KEYS = frozenset("schema_version dispatch_approved publication_authority input_source collector_plan_sha256 retained_queue_sha256 original_queue_sha256 projection_sha256 full_cohort_count applicable_count excluded original_complete_histories already_refreshed_symbols fresh_receipt_count remaining_complete_histories unresolved_annual_cases selection_count first_symbol last_symbol first_deadline last_deadline missing_prior_decisions consumer_queue_sha256 source_evaluation_time budget selected_cache_sha256 required_valid_through source_observation_start source_observation_end source_job_status companion_status selection_rule aggregate_authorization".split())
ADMISSION_KEYS = frozenset("schema_version request_id execution_enabled expected_run_number first_attempt_only dispatch_not_before dispatch_not_after review_sha256 collector_plan_sha256 retained_queue_sha256 consumer_queue_sha256 selected_cache_sha256 input_source selection_count required_valid_through budget publication_authority".split())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def closed(value, keys, name):
    require(isinstance(value, dict) and set(value) == set(keys), f"Malformed closed {name} schema")


def read_pinned(path, digest, maximum=16 * 1024 * 1024):
    path = archive._safe(path)
    require(path.is_file() and path.stat().st_size <= maximum, f"Missing or oversized input: {path.name}")
    raw = path.read_bytes()
    require(sha256(raw) == digest, f"Pinned bytes changed: {path.name}")
    return json.loads(raw, object_pairs_hook=batch._pairs), raw


def load_review(*, now):
    values, contents = {}, {}
    for name, digest in REVIEW_FILES.items():
        values[name], contents[name] = read_pinned(REVIEW_DIRECTORY / name, digest)
    original, _ = read_pinned(ROOT / ".github/bounded-refresh-first-200/earliest-deadline-review-queue.json", ORIGINAL_QUEUE_SHA256)
    request, admission, plan, queue = (values[name] for name in
        ("dispatch-review.json", "dispatch-admission.json", "collector-plan.json", "retained-queue.json"))
    closed(request, REVIEW_KEYS, "next review")
    closed(admission, ADMISSION_KEYS, "next admission")
    closed(plan, PLAN_KEYS, "next plan")
    require(request["schema_version"] == "postcapture-next-200-review-v2" and request["dispatch_approved"] is False and
            request["publication_authority"] == "none" and request["aggregate_authorization"] is False,
            "Offline review cannot authorize acquisition or publication")
    require(admission["schema_version"] == "postcapture-next-200-admission-proposal-v2" and
            admission["execution_enabled"] is False and admission["expected_run_number"] is None and
            admission["first_attempt_only"] is True and admission["publication_authority"] == "none",
            "Next admission must remain disabled with no assigned workflow run")
    for value in (request, admission):
        require(value["input_source"] == SOURCE and value["budget"] == BUDGET, "Source identity or bounded budget changed")
        require(value["collector_plan_sha256"] == REVIEW_FILES["collector-plan.json"] and
                value["retained_queue_sha256"] == REVIEW_FILES["retained-queue.json"] and
                value["consumer_queue_sha256"] == REVIEW_FILES["consumer-queue.json"] and
                value["selected_cache_sha256"] == CACHE_SHA256 and value["selection_count"] == 200,
                "Exact next visit content binding changed")
        require(value["required_valid_through"] == plan["required_valid_through"], "Validity horizon binding changed")
    require(admission["review_sha256"] == REVIEW_FILES["dispatch-review.json"] and
            request["original_queue_sha256"] == ORIGINAL_QUEUE_SHA256 and request["projection_sha256"] == PROJECTION_SHA256,
            "Review, original queue or projection binding changed")
    require(request["full_cohort_count"] == 1894 and request["applicable_count"] == 1891 and
            request["excluded"] == EXCLUDED and request["original_complete_histories"] == 1801 and
            request["already_refreshed_symbols"] == 200 and request["fresh_receipt_count"] == 400 and
            request["remaining_complete_histories"] == 1601 and request["unresolved_annual_cases"] == 90,
            "Original cohort or renewal denominator changed")
    require(isinstance(queue, list) and len(queue) == 1891 and len({x["original"]["symbol"] for x in queue}) == 1891,
            "Full exact retained queue is required")
    require([x["original"] for x in queue] == original, "Original complete-history classification or EDF order changed")
    for index, entry in enumerate(queue):
        closed(entry, {"original", "retained", "already_refreshed", "identity", "applicability"}, "retained queue entry")
        closed(entry["original"], QUEUE_KEYS, "original queue entry")
        closed(entry["retained"], RETAINED_KEYS, "retained receipts")
        require(entry["already_refreshed"] is (index < 200), "Already-refreshed prefix changed")
        identity = entry["identity"]
        require(identity["symbol"] == entry["original"]["symbol"] and identity["market"] == "US" and
                identity["status"] == "ticker_only" and identity["identifiers_bound_to_price"] is False and
                identity["identifiers_bound_to_financial_receipts"] is False and
                entry["applicability"]["status"] == "unverified", "Identity assertion or financial applicability changed")
    obligations = validate_consumer_queue(values["consumer-queue.json"], queue, plan, request)
    selected = [{**next(x["original"] for x in queue if x["original"]["symbol"] == row["symbol"]),
                 "consumer_deadline": row["consumer_deadline"]} for row in obligations[:200]]
    symbols = [x["symbol"] for x in selected]
    require(len(symbols) == 200 and symbols[0] == request["first_symbol"] == "ADP" and
            symbols[-1] == request["last_symbol"] == "CMS", "Exact ADP through CMS selection changed")
    missing = {(x["symbol"], attribute) for x in selected for attribute, prefix in
               (("quarterly_income_stmt", "quarterly"), ("income_stmt", "annual")) if x[prefix + "_receipt"] is None}
    require(missing == MISSING_PRIOR_KEYS and request["missing_prior_decisions"] == MISSING_PRIORS,
            "Exact four missing priors and unresolved retry decisions must be preserved")
    require(plan["batch_allowlist"] == symbols and plan["selected"] == [
        {"symbol": symbol, "attributes": list(batch.ATTRIBUTES), "targets": ["annual_history"]} for symbol in symbols],
        "Both ordered getters and only annual_history are required")
    require(len(plan["verified_us_cohort"]["symbols"]) == 1894 and
            set(plan["verified_us_cohort"]["symbols"]) - set(EXCLUDED) == {x["symbol"] for x in original} and
            plan["source_data_as_of"] == "2026-10-02", "Original price cohort changed")
    evaluated, valid = (batch.clock(plan[key]) for key in ("evaluation_time", "required_valid_through"))
    require(valid - evaluated == timedelta(hours=36), "Exact 36-hour horizon required")
    require(admission["dispatch_not_before"] == plan["evaluation_time"] and
            evaluated <= now <= batch.clock(admission["dispatch_not_after"]), "Preparation is outside finite review window")
    require(batch.clock(admission["dispatch_not_after"]) + timedelta(seconds=1500) ==
            batch.clock(selected[0]["consumer_deadline"]), "Finalization is not reserved before selected expiry")
    require(request["first_deadline"] == selected[0]["consumer_deadline"] and
            request["last_deadline"] == selected[-1]["consumer_deadline"], "Selected original deadline changed")
    return SimpleNamespace(request=request, admission=admission, plan=plan, queue=queue, selected=selected, contents=contents)


def validate_consumer_queue(value, retained_queue, plan, request):
    """Keep frozen consumer obligations, including overdue/partial histories."""
    closed(value, {"schema_version", "projection_sha256", "source_evaluated_at", "planning_evaluated_at",
                   "required_valid_through", "ordering", "selection_rule", "rows"}, "consumer queue")
    require(value["schema_version"] == "consumer-expiry-owned-queue-proposal-v1" and
            value["projection_sha256"] == PROJECTION_SHA256 and
            value["source_evaluated_at"] == request["source_evaluation_time"] == "2026-10-06T21:47:36.426Z" and
            value["planning_evaluated_at"] == plan["evaluation_time"] and
            value["required_valid_through"] == plan["required_valid_through"] and
            value["selection_rule"] == request["selection_rule"], "Consumer queue bindings changed")
    rows, source = value["rows"], {x["original"]["symbol"]: x for x in retained_queue}
    require(isinstance(rows, list) and len(rows) == len(source) and
            {r["symbol"] for r in rows} == set(source), "Complete applicable consumer queue required")
    anchor, through = batch.clock(value["source_evaluated_at"]), batch.clock(value["required_valid_through"])
    keys = frozenset("symbol consumer_deadline consumer_timer history_deadlines obligation_kind history_reason annual_complete_at_source annual_growth_at_source history_valid_now annual_complete_now work_reason last_actual_attempt original_complete_annual_history already_refreshed_diagnostic_only history_diagnostics financial_identity instrument_applicability source_receipts owned_source_row_sha256".split())
    for row in rows:
        closed(row, keys, "consumer row")
        entry = source[row["symbol"]]
        require(row["financial_identity"] == entry["identity"] and
                row["instrument_applicability"] == entry["applicability"] and
                row["last_actual_attempt"] == entry["original"]["last_actual_attempt"],
                "Consumer source identity or actual attempt changed")
        receipts = {r["attribute"]: r for r in row["source_receipts"]}
        require(len(receipts) == len(row["source_receipts"]) and set(receipts) <= set(batch.ATTRIBUTES),
                "Malformed consumer source receipts")
        for attribute, prefix in (("quarterly_income_stmt", "quarterly"), ("income_stmt", "annual")):
            receipt = receipts.get(attribute, {})
            require(receipt.get("receipt_sha256") == entry["retained"][prefix + "_receipt"] and
                    receipt.get("observed_at") == entry["retained"][prefix + "_observed_at"],
                    "Consumer receipt or source clock changed")
        deadline, timer = row["consumer_deadline"], row["consumer_timer"]
        require((deadline is None) == (timer is None), "Unknown deadlines must remain null")
        if deadline is not None:
            require(isinstance(deadline, str) and isinstance(timer, str) and
                    batch.clock(timer) == batch.clock(deadline) + timedelta(milliseconds=1) and
                    batch.clock(timer) > anchor, "Consumer inclusive expiry clock changed")
    def order(row):
        deadline, attempt = row["consumer_deadline"], row["last_actual_attempt"]
        return (deadline is None, batch.clock(deadline) if deadline is not None else anchor,
                attempt is not None, batch.clock(attempt) if attempt is not None else anchor, row["symbol"])
    require(rows == sorted(rows, key=order), "Consumer EDF/attempt/symbol order changed")
    return [row for row in rows if row["consumer_timer"] is not None and batch.clock(row["consumer_timer"]) <= through]


MISSING_PRIOR_DECISION_STATES = frozenset({"retry_decision_required", "one_visit_reobservation_approved", "deferred_for_this_visit"})
MISSING_PRIOR_DECISION_KEYS = frozenset(MISSING_PRIORS[0])


def validate_retry_decision(decision):
    """A future disposition never erases or relabels the original empty result.

    The committed loader still pins the exact unresolved MISSING_PRIORS above.
    Supporting an approval shape here does not admit that shape in production.
    """
    require(isinstance(decision, dict) and type(decision.get("decision_state")) is str and
            decision["decision_state"] in MISSING_PRIOR_DECISION_STATES,
            "Unsupported missing-prior decision state")
    approved = decision["decision_state"] == "one_visit_reobservation_approved"
    deferred = decision["decision_state"] == "deferred_for_this_visit"
    closed(decision, MISSING_PRIOR_DECISION_KEYS | ({"reobservation"} if approved else {"deferral"} if deferred else set()), "missing-prior decision")
    require(decision["retry_not_before"] is None and decision["outcome"] == "failed" and
            decision["failure_kind"] == "empty_getter_result", "Original missing-prior failure or null cooldown changed")
    require(batch.canonical_symbol(decision["symbol"]) and decision["attribute"] in batch.ATTRIBUTES,
            "Missing-prior symbol or attribute is invalid")
    require(isinstance(decision["attempt_id"], str) and decision["attempt_id"] and
            isinstance(decision["journal_sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", decision["journal_sha256"]),
            "Missing-prior attempt/journal binding is required")
    batch.clock(decision["attempted_at"])
    if approved:
        scope = decision["reobservation"]
        closed(scope, {"request_id", "expected_run_number", "maximum_getter_calls", "failed_acquisition_sha256",
                       "transport_payload_sha256s"}, "one-visit reobservation")
        require(isinstance(scope["request_id"], str) and scope["request_id"] and
                type(scope["expected_run_number"]) is int and scope["expected_run_number"] > 0 and
                type(scope["maximum_getter_calls"]) is int and scope["maximum_getter_calls"] == 1,
                "Reobservation must bind one request, run and getter")
        require(isinstance(scope["failed_acquisition_sha256"], str) and
                re.fullmatch(r"[a-f0-9]{64}", scope["failed_acquisition_sha256"]) and
                isinstance(scope["transport_payload_sha256s"], list) and scope["transport_payload_sha256s"] and
                all(isinstance(x, str) and re.fullmatch(r"[a-f0-9]{64}", x) for x in scope["transport_payload_sha256s"]),
                "Reobservation must bind the failed object and original transport hashes")
    if deferred:
        scope = decision["deferral"]
        closed(scope, {"request_id", "expected_run_number", "maximum_getter_calls"}, "one-visit deferral")
        require(isinstance(scope["request_id"], str) and scope["request_id"] and
                type(scope["expected_run_number"]) is int and scope["expected_run_number"] > 0 and
                type(scope["maximum_getter_calls"]) is int and scope["maximum_getter_calls"] == 0,
                "Deferral must bind one request/run and authorize zero getters")


def require_retry_decisions(review, *, expected_run_number=None):
    decisions = review.request["missing_prior_decisions"]
    for decision in decisions:
        validate_retry_decision(decision)
    allow_deferral = getattr(review, "mode", None) == "overdue_catchup"
    allowed = {"one_visit_reobservation_approved", "deferred_for_this_visit"} if allow_deferral else {"one_visit_reobservation_approved"}
    require(all(x["decision_state"] in allowed for x in decisions),
            "Exact missing-prior retry decisions are required before acquisition")
    require(len({(x["symbol"], x["attribute"]) for x in decisions}) == len(decisions),
            "Duplicate missing-prior decisions")
    for decision in decisions:
        deferred = decision["decision_state"] == "deferred_for_this_visit"
        scope = decision["deferral" if deferred else "reobservation"]
        if deferred:
            require(decision["symbol"] not in review.plan["batch_allowlist"], "Deferred symbol remains selected")
        require(scope["request_id"] == review.admission["request_id"] and
                type(expected_run_number) is int and scope["expected_run_number"] == expected_run_number,
                "Missing-prior reobservation belongs to another request or run")


def validate_current(review, current, projection, *, now):
    require(current.sha256 == SOURCE["archive_manifest_sha256"] and
            projection["bindings"]["archive_manifest_sha256"] == current.sha256 and
            projection["bindings"]["acquisition_base_sha256"] == SOURCE["base_sha256"] and
            projection["bindings"]["cohort_sha256"] == SOURCE["cohort_sha256"], "Current archive/projection binding changed")
    require(set(projection["symbols"]) == set(review.plan["verified_us_cohort"]["symbols"]), "Projection cohort changed")
    require(sorted(s for s, p in projection["symbols"].items() if p["instrument_applicability"]["status"] == "not_applicable") == EXCLUDED,
            "Only original reviewed funds can be excluded")
    fresh = []
    for entry in review.queue:
        original, retained = entry["original"], entry["retained"]
        symbol = original["symbol"]
        projected = projection["symbols"][symbol]
        require(projected["financial_identity"] == entry["identity"] and
                projected["instrument_applicability"] == entry["applicability"], "Projection identity guard changed")
        projected_receipts = {x["attribute"]: x for x in projected["source_receipts"]}
        for attribute, prefix in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
            prior, receipt = original[prefix + "_receipt"], retained[prefix + "_receipt"]
            require(current.manifest["current"].get(f"{symbol}/{attribute}") == receipt, "Full queue current receipt changed")
            require((prior is None) == (original[prefix + "_observed_at"] is None), "Prior absence or clock changed")
            if prior is not None:
                require(prior in current.acquisitions and current.acquisitions[prior]["context"]["observed_at"] ==
                        original[prefix + "_observed_at"], "Original historical receipt was lost or retimed")
            if receipt is None:
                require(prefix + "_observed_at" in retained and retained[prefix + "_observed_at"] is None and
                        attribute not in projected_receipts, "Absent receipt was fabricated")
            else:
                require(receipt in current.acquisitions and
                        current.acquisitions[receipt]["context"]["observed_at"] == retained[prefix + "_observed_at"] and
                        projected_receipts.get(attribute, {}).get("receipt_sha256") == receipt and
                        projected_receipts[attribute]["observed_at"] == retained[prefix + "_observed_at"],
                        "Receipt transport clock or projection source changed")
            if entry["already_refreshed"]:
                require(receipt is not None and receipt != prior, "Genuine first-200 renewal is missing")
                fresh.append(retained[prefix + "_observed_at"])
            else:
                require(receipt == prior and retained[prefix + "_observed_at"] == original[prefix + "_observed_at"],
                        "Unselected source was changed")
    require(len(fresh) == 400 and min(fresh) == review.request["source_observation_start"] and
            max(fresh) == review.request["source_observation_end"], "Actual 400-receipt observation span changed")
    work = []
    for item, entry in zip(review.plan["selected"], review.selected):
        for attribute, prefix in (("quarterly_income_stmt", "quarterly"), ("income_stmt", "annual")):
            receipt = entry[prefix + "_receipt"]
            if receipt is None:
                require((item["symbol"], attribute) in MISSING_PRIOR_KEYS, "Unexpected selected receipt absence")
                state = "fresh_work_missing_prior"
            else:
                validity = batch.required_validity_state(current.acquisitions[receipt]["raw"], item["symbol"], attribute,
                                                         item, review.plan, now=now)
                require(validity["state"] != "current", "Selected getter no longer requires genuine renewal")
                state = "fresh_work_outside_required_horizon"
            work.append({"symbol": item["symbol"], "attribute": attribute, "prior_receipt": receipt, "state": state,
                         **({"retry_decision": "retry_decision_required", "retry_not_before": None} if receipt is None else {"required_validity_state": validity["state"]})})
    return work


def baseline_reader():
    path = Path(__file__).with_name("verify-postcapture-statement-baseline.py")
    spec = importlib.util.spec_from_file_location("next200_baseline_reader", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def deny_network(*args, **kwargs):
    raise AssertionError("Provider/network activity is forbidden during offline next-200 preparation")


def prepare_stage(source_zip, source_files, companion_zip, projection_path, output, *, now, restore_policy=None):
    """Direct finite fixtures may verify inactive policy; the CLI exposes no override."""
    import curl_cffi
    import yfinance
    with ExitStack() as stack:
        for target, name in ((socket.socket, "connect"), (socket.socket, "connect_ex"),
                             (socket, "create_connection"), (curl_cffi.Curl, "perform"), (yfinance, "Ticker")):
            stack.enter_context(patch.object(target, name, deny_network))
        review = load_review(now=now)
        source_files, output = archive._safe(source_files), archive._safe(output)
        require(not output.exists() and source_files not in output.parents and output not in source_files.parents,
                "Stage must be new and separate from immutable source")
        require(ROOT not in output.parents, "Actual stage must remain outside the repository")
        proof = baseline_reader().verify_baseline(source_zip, source_files, companion_zip, policy=restore_policy, now=now)
        require(proof.get("schema_version") == "financial-source-postcapture-baseline-v1" and
                proof.get("kind") == "postcapture_validated_baseline" and
                proof.get("publication_authority") == "none" and proof.get("provider_work_authorized") is False and
                proof.get("github_success_independently_authenticated") is False,
                "Only the explicit offline typed baseline proof is supported")
        projection, _ = read_pinned(projection_path, PROJECTION_SHA256, maximum=64 * 1024 * 1024)
        base_bytes, cohort_bytes = ((source_files / name).read_bytes() for name in ("base.json", "cohort.json"))
        require(sha256(base_bytes) == SOURCE["base_sha256"] and sha256(cohort_bytes) == SOURCE["cohort_sha256"],
                "Original base or cohort bytes changed")
        cohort = json.loads(cohort_bytes, object_pairs_hook=batch._pairs)
        require(cohort == review.plan["verified_us_cohort"], "Plan cohort differs from original bytes")
        batch.validate_plan(review.plan, base_bytes)
        current = archive.load_archive(source_files / "archive", SOURCE["archive_manifest_sha256"],
                                       base_bytes=base_bytes, cohort=cohort, now=now)
        work = validate_current(review, current, projection, now=now)
        output.mkdir(parents=True, exist_ok=False)
        shutil.copytree(source_files / "archive", output / "archive")
        (output / "base.json").write_bytes(base_bytes)
        (output / "cohort.json").write_bytes(cohort_bytes)
        for name, content in review.contents.items():
            (output / name).write_bytes(content)
        (output / "plan.json").write_bytes(review.contents["collector-plan.json"])
        shutil.copyfile(companion_zip, output / "companion.zip")
        require(sha256((output / "companion.zip").read_bytes()) == SOURCE["companion_artifact_sha256"],
                "Companion ZIP changed while staging")
        batch.write_json(output / "restore-proof.json", proof)
        batch.write_json(output / "fresh-work.json", {"schema_version": "postcapture-next-200-fresh-work-v1", "getters": work})
        batch.write_json(output / "cycle.json", {"schema_version": "financial-recovery-cycle-v1", "phase": "prepared",
            "dry_run": True, "archive_manifest_sha256": current.sha256,
            "base_artifact_sha256": SOURCE["base_sha256"], "published": False})
        current = archive.load_archive(output / "archive", SOURCE["archive_manifest_sha256"],
                                       base_bytes=base_bytes, cohort=cohort, now=now)
        cache, cache_sha = archive.export_cache(current, review.plan, base_bytes, output / "selected-cache", now=now)
        require(cache_sha == CACHE_SHA256, "Selected original cache changed")
        cache_value = json.loads(cache.read_bytes(), object_pairs_hook=batch._pairs)
        require(len(cache_value["acquisitions"]) == 396 and all(f"{s}/{a}" not in
                cache_value["acquisitions"] for s, a in MISSING_PRIOR_KEYS), "Missing quarterly prior was synthesized")
        archive.prepare_writer_lock(output / "archive")
        guard = StatementRetentionBudget(output, selected_symbols=200, max_transport_requests=1000)
        reservation = guard.check("initial")
        # A second boundary verifies the lock and final metadata were included
        # before the unchanged guard froze its retained-member inventory.
        require(guard.check("getter") == {**reservation, "stage": "getter"}, "Final metadata changed after initial guard")
        require(sha256((source_files / "archive/manifest.json").read_bytes()) == SOURCE["archive_manifest_sha256"],
                "Original source manifest changed")
        return {"schema_version": "postcapture-next-200-stage-proof-v1", "scope": "offline_exact_next_visit_only",
            "stage": str(output), "provider_calls": 0, "network_calls": 0, "dispatch_approved": False,
            "review_evaluation_time": review.plan["evaluation_time"],
            "validation_evaluation_time": batch.timestamp(now),
            "execution_enabled": False, "expected_run_number": None, "published": False,
            "production_authentication_proven": False, "restore_policy_fixture": restore_policy is not None,
            "input_source": SOURCE, "metadata_sha256": REVIEW_FILES, "projection_sha256": PROJECTION_SHA256,
            "restore_proof_sha256": sha256((output / "restore-proof.json").read_bytes()),
            "selected_cache_sha256": cache_sha, "selected_count": 200, "first_symbol": "ADP", "last_symbol": "CMS",
            "existing_selected_receipts": 396, "fresh_work_getters": len(work), "missing_prior_decisions": MISSING_PRIORS,
            "archive_objects_verified": len(current.manifest["objects"]), "original_manifest_preserved": True,
            "lock_created_before_initial_guard": True, "budget": BUDGET, "reservation": reservation,
            "limits": ["Inactive finite offline preparation; no dispatch or publication authority.",
                       "Production typed restoration still requires independently authenticated finite admission.",
                       "Only this visit is measured; later visits and future archive growth are not certified."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-zip", type=Path, required=True)
    parser.add_argument("--source-files", type=Path, required=True)
    parser.add_argument("--companion-zip", type=Path, required=True)
    parser.add_argument("--projection", type=Path, required=True)
    parser.add_argument("--output-stage", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_stage(args.source_zip, args.source_files, args.companion_zip,
                                  args.projection, args.output_stage, now=batch.utc_now()), sort_keys=True))
