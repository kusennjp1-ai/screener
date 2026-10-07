"""One separately admitted next-200 collector; committed execution is disabled.

The offline preparation proposal is immutable and never grants execution. This
command has no policy path, trust override, retry switch, or publication route.
The small collect_cycle helper accepts finite direct fixtures for offline tests.
"""
from __future__ import annotations

import argparse
from collections import namedtuple
from datetime import timedelta
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.statement_retention_budget import StatementRetentionBudget


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


preparation = module("next200_preparation", "prepare-postcapture-next-200.py")
original = module("next200_original_runner", "run-statement-recovery-cycle.py")
overlap = module("next200_provider_overlap", "next200-provider-overlap.py")
catchup = module("next200_catchup_admission", "next200-catchup-admission.py")
barriers = original.bounded_bridge()
require, closed, sha256 = preparation.require, preparation.closed, preparation.sha256
ROOT = preparation.ROOT
EXECUTION_PATH = preparation.REVIEW_DIRECTORY / "dispatch-execution.json"
EXECUTION_SHA256 = "55c8c330652bd4f5f113670328d7fafb4015903ef195654183d789b927ea80cb"
REPOSITORY = "kusennjp1-ai/screener"
BRANCH = "improve/mandatory-financial-source-recovery"
WORKFLOW = ".github/workflows/financial-statement-recovery.yml"
COMPANION_RECEIPT_SHA256 = "f5e925de47bfe9dc5f00f28b179e6d4e124b24d2f793692390e08177e55f57d5"
HISTORICAL_HEADS = ["4715b218cc25720d1d3be455930554e1e6282136", "28e298ee21ea275629a94e7066ac8835b7654182"]


def execution_identity(review):
    identity = {
        "schema_version": "postcapture-next-200-execution-v2",
        "request_id": review.admission["request_id"],
        "repository": REPOSITORY, "workflow": WORKFLOW, "branch": BRANCH, "event": "push",
        "first_attempt_only": True, "minimum_exclusive_run_id": preparation.SOURCE["companion_run_id"],
        "forbidden_historical_heads": HISTORICAL_HEADS,
        "head_binding": "live_run_and_branch_equal_github_sha_and_workflow_sha",
        "source_kind": "postcapture_validated_recovery", "input_source": preparation.SOURCE,
        "companion_receipt_sha256": COMPANION_RECEIPT_SHA256,
        "proposal_sha256": preparation.REVIEW_FILES["dispatch-admission.json"],
        "review_sha256": preparation.REVIEW_FILES["dispatch-review.json"],
        "collector_plan_sha256": preparation.REVIEW_FILES["collector-plan.json"],
        "retained_queue_sha256": preparation.REVIEW_FILES["retained-queue.json"],
        "original_queue_sha256": preparation.ORIGINAL_QUEUE_SHA256,
        "projection_sha256": preparation.PROJECTION_SHA256,
        "selected_cache_sha256": preparation.CACHE_SHA256,
        "full_cohort_count": 1894, "applicable_count": 1891, "selection_count": 200,
        "existing_selected_receipts": 396, "fresh_work_getters": 400,
        "missing_prior_decisions": review.request["missing_prior_decisions"],
        "consumer_queue_sha256": preparation.REVIEW_FILES["consumer-queue.json"],
        "budget": preparation.BUDGET, "publication_authority": "none",
        "dispatch_not_before": review.admission["dispatch_not_before"],
        "dispatch_not_after": review.admission["dispatch_not_after"],
        "required_valid_through": review.plan["required_valid_through"],
    }
    if isinstance(review, catchup.CatchupReview):
        identity.update(catchup.execution_delta(review))
    return identity


def validate_execution(value, review, *, now, context):
    if isinstance(review, catchup.CatchupReview):
        catchup.validate_review(review, now=now)
    expected = execution_identity(review)
    closed(value, set(expected) | {"execution_enabled", "expected_run_number"}, "next execution")
    require(all(type(value[k]) is type(v) and batch._json_bytes(value[k]) == batch._json_bytes(v) for k, v in expected.items()),
            "Next execution identity, source, clock, proposal or budget changed")
    require(type(value["execution_enabled"]) is bool, "Execution enabled must be boolean")
    number = value["expected_run_number"]
    if not value["execution_enabled"]:
        require(number is None, "Disabled execution must leave its workflow run number unassigned")
        raise ValueError("Next-200 execution is disabled pending separate one-shot approval")
    require(type(number) is int and number > 0, "One explicit positive workflow run number is required")
    if isinstance(review, catchup.CatchupReview):
        require(number == review.admission["expected_run_number"], "Catch-up workflow run differs from its fixed admission")
    require(context.get("GITHUB_RUN_NUMBER") == str(number), "Wrong one-shot workflow run number")
    require(context.get("GITHUB_RUN_ATTEMPT") == "1", "Only the first attempt is admitted")
    require(batch.clock(value["dispatch_not_before"]) <= now <= batch.clock(value["dispatch_not_after"]),
            "Next-200 execution is outside the finite dispatch window")
    require(context.get("GITHUB_REPOSITORY") == REPOSITORY and context.get("GITHUB_REF_NAME") == BRANCH and
            context.get("GITHUB_REF") == "refs/heads/" + BRANCH and context.get("GITHUB_EVENT_NAME") == "push" and
            context.get("GITHUB_JOB") == overlap.JOB and
            context.get("GITHUB_WORKFLOW_REF") == f"{REPOSITORY}/{WORKFLOW}@refs/heads/{BRANCH}",
            "Unreviewed repository, branch, event or workflow context")
    revision = context.get("GITHUB_SHA", "")
    require(bool(re.fullmatch(r"[a-f0-9]{40}", revision)) and revision not in HISTORICAL_HEADS and
            context.get("GITHUB_WORKFLOW_SHA") == revision, "Future workflow and source heads must agree")
    run_id = context.get("GITHUB_RUN_ID", "")
    require(isinstance(run_id, str) and run_id.isascii() and run_id.isdecimal() and
            int(run_id) > value["minimum_exclusive_run_id"], "Historical or replayed execution run")


def github_api(endpoint, *, timeout=10):
    raw = subprocess.check_output(["gh", "api", endpoint], timeout=timeout)
    require(len(raw) <= 4 * 1024 * 1024, "Execution API response exceeds its bound")
    return json.loads(raw, object_pairs_hook=batch._pairs)


def authenticate_execution(value, context, *, now, job_started_at, api=None, maximum_seconds=60, monotonic=time.monotonic):
    require(batch.finite(maximum_seconds) and 0 < maximum_seconds <= 60, "Unbounded execution authentication")
    deadline = monotonic() + maximum_seconds
    supplied_api = api
    def api(endpoint):
        remaining = deadline - monotonic()
        require(remaining > 0, "Execution authentication exhausted its wall-time bound")
        result = supplied_api(endpoint) if supplied_api is not None else github_api(endpoint, timeout=min(10, remaining))
        require(monotonic() < deadline, "Execution authentication exhausted its wall-time bound")
        return result
    run = api(f"repos/{REPOSITORY}/actions/runs/{context['GITHUB_RUN_ID']}")
    require(type(run.get("id")) is int and run["id"] == int(context["GITHUB_RUN_ID"]) and
            type(run.get("run_number")) is int and run["run_number"] == value["expected_run_number"] and
            type(run.get("run_attempt")) is int and run["run_attempt"] == 1 and
            run.get("head_sha") == context["GITHUB_SHA"] and run.get("head_branch") == BRANCH and
            run.get("path") == WORKFLOW and run.get("event") == "push" and run.get("status") == "in_progress" and
            run.get("conclusion") is None and run.get("repository", {}).get("full_name") == REPOSITORY and
            run.get("head_repository", {}).get("full_name") == REPOSITORY and
            run.get("repository", {}).get("id") == run.get("head_repository", {}).get("id") == 1203919607 and
            type(run.get("workflow_id")) is int and run["workflow_id"] > 0,
            "Live GitHub run does not authenticate this exact one-shot execution")
    require(batch.clock(value["dispatch_not_before"]) <= batch.clock(run.get("run_started_at")) <= now,
            "Live run start is outside the reviewed window")
    inventory = api(f"repos/{REPOSITORY}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100")
    require(type(inventory.get("total_count")) is int and 0 <= inventory["total_count"] <= 100 and
            isinstance(inventory.get("workflow_runs"), list) and
            len(inventory["workflow_runs"]) == inventory["total_count"],
            "Incomplete or oversized recovery-run inventory")
    runs = inventory["workflow_runs"]
    require(all(isinstance(item, dict) and type(item.get("id")) is int and item["id"] > 0 for item in runs) and
            len({item["id"] for item in runs}) == len(runs), "Duplicate or malformed recovery-run inventory")
    seen_current, previous = [], []
    for item in runs:
        require(item.get("path") == WORKFLOW and item.get("event") == "push" and
                item.get("workflow_id") == run["workflow_id"] and
                item.get("repository", {}).get("full_name") == item.get("head_repository", {}).get("full_name") == REPOSITORY and
                item.get("repository", {}).get("id") == item.get("head_repository", {}).get("id") == 1203919607,
                "Unexpected recovery workflow or repository in complete inventory")
        if item["id"] == run["id"]:
            seen_current.append(item)
            require(all(item.get(k) == run.get(k) for k in ("run_attempt", "run_number", "head_sha", "head_branch", "status", "conclusion")),
                    "Current recovery inventory contradicts the live run")
        else:
            require(item.get("status") != "in_progress", "Another recovery execution is live; overlapping acquisition forbidden")
            if item.get("head_branch") == BRANCH:
                require(item["id"] < run["id"], "A newer recovery execution exists; source progress cannot be rolled back")
                previous.append(item)
    require(len(seen_current) == 1 and previous, "Missing current or prior source in complete recovery inventory")
    prior = max(previous, key=lambda item: item["id"])
    require(prior["id"] == preparation.SOURCE["source_run_id"] and prior.get("run_attempt") == 1 and
            prior.get("head_sha") == HISTORICAL_HEADS[0] and prior.get("status") == "completed" and
            prior.get("conclusion") == "failure", "Latest prior recovery is not the exact retained failed producer")
    terminal = api(f"repos/{REPOSITORY}/actions/runs/{prior['id']}/attempts/1")
    require(all(terminal.get(k) == prior.get(k) for k in ("id", "run_attempt", "head_sha", "head_branch", "path",
            "event", "workflow_id", "status", "conclusion", "repository", "head_repository")),
            "Exact retained predecessor attempt differs from recovery inventory")
    ref = api(f"repos/{REPOSITORY}/git/ref/heads/{BRANCH}")
    require(ref.get("ref") == "refs/heads/" + BRANCH and ref.get("object", {}).get("type") == "commit" and
            ref["object"].get("sha") == context["GITHUB_SHA"], "Execution source head is no longer current")
    provider_overlap = overlap.observe(api, run, job_started_at=job_started_at, now=now)
    return {"run_id": run["id"], "run_number": run["run_number"], "run_attempt": 1,
            "head_sha": run["head_sha"], "workflow": WORKFLOW, "repository": REPOSITORY,
            "branch": BRANCH, "event": "push", "authenticated_at": batch.timestamp(now),
            "job_started_at": job_started_at,
            "platform_job_started_at": provider_overlap["platform_job_started_at"], "run_started_at": run["run_started_at"],
            "recovery_inventory_count": len(runs), "recovery_inventory_sha256": sha256(batch._json_bytes(inventory)),
            "previous_run": {"id": prior["id"], "attempt": 1, "head_sha": prior["head_sha"], "conclusion": "failure"},
            "provider_overlap": provider_overlap}


def _execution_binding(execution, review, context, authenticated):
    keys = ("GITHUB_REPOSITORY", "GITHUB_REF_NAME", "GITHUB_REF", "GITHUB_EVENT_NAME", "GITHUB_JOB",
            "GITHUB_WORKFLOW_REF", "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_RUN_NUMBER",
            "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID")
    return sha256(batch._json_bytes({"execution": execution, "identity": execution_identity(review),
        "context": {key: context.get(key) for key in keys}, "authenticated": authenticated}))


# Private immutable in-process proof. Neither CLI nor environment can provide
# an earlier admission instant or a replacement monotonic start.
_AdmittedStart = namedtuple("_AdmittedStart", "admitted_at job_started_at platform_job_started_at monotonic_deadline binding_sha256")


class _ExecutionClock:
    def __init__(self, execution, review, context, authenticated, *, job_started_at, admitted_at, admitted_tick):
        validate_execution(execution, review, now=admitted_at, context=context)
        overlap.job_clock(job_started_at)
        require(authenticated.get("authenticated_at") == batch.timestamp(admitted_at) and
                authenticated.get("job_started_at") == job_started_at and
                authenticated.get("provider_overlap", {}).get("job_started_at") == job_started_at,
                "Admission or original job-start evidence changed")
        platform_start = authenticated.get("platform_job_started_at")
        require(platform_start == authenticated.get("provider_overlap", {}).get("platform_job_started_at") and
                authenticated.get("run_started_at") == authenticated.get("provider_overlap", {}).get("run_started_at") and
                batch.clock(authenticated.get("run_started_at")) <= batch.clock(platform_start) <= admitted_at and
                batch.clock(platform_start) < batch.clock(job_started_at) + timedelta(seconds=1),
                "Missing, future or inconsistent authenticated platform job start")
        # The platform timeout starts before the first YAML clock. Never borrow
        # its setup gap from the 420-second finalization/upload reserve.
        allowance = min(original.bounded_acquisition_budget(job_started_at, now=admitted_at),
                        original.bounded_acquisition_budget(platform_start, now=admitted_at))
        self._start = _AdmittedStart(admitted_at, job_started_at, platform_start, admitted_tick + allowance,
                                    _execution_binding(execution, review, context, authenticated))
        self._execution, self._review, self._context, self._authenticated = execution, review, context, authenticated
        self._last_time, self._last_tick = admitted_at, admitted_tick

    @property
    def acquisition_deadline(self):
        return self._start.monotonic_deadline

    def confirm_authentication(self, checked):
        keys = ("run_id", "run_number", "run_attempt", "head_sha", "workflow", "repository", "branch", "event",
                "job_started_at", "platform_job_started_at", "run_started_at", "previous_run")
        job_keys = ("current_job_id", "current_step_number", "current_step_name", "job_started_at",
                    "platform_job_started_at", "run_started_at", "job_clock_step_started_at", "job_clock_step_completed_at")
        require(isinstance(checked, dict) and all(key in checked and key in self._authenticated and
                batch._json_bytes(checked[key]) == batch._json_bytes(self._authenticated[key]) for key in keys),
                "Authenticated execution identity changed during acquisition")
        fresh, original_job = checked.get("provider_overlap"), self._authenticated.get("provider_overlap")
        require(isinstance(fresh, dict) and isinstance(original_job, dict) and all(key in fresh and key in original_job and
                batch._json_bytes(fresh[key]) == batch._json_bytes(original_job[key]) for key in job_keys),
                "Authenticated job, step or clock identity changed during acquisition")

    def remaining(self, now):
        start = self._start
        require(_execution_binding(self._execution, self._review, self._context, self._authenticated) == start.binding_sha256,
                "Immutable admitted execution, source, identity or start changed")
        # Revalidate the same genuinely admitted instant, not a caller-selected
        # past time. The dispatch cutoff is a start deadline, not a getter limit.
        validate_execution(self._execution, self._review, now=start.admitted_at, context=self._context)
        tick = time.monotonic()
        require(now >= self._last_time and tick >= self._last_tick, "Execution clock moved backward")
        wall_remaining = original.bounded_acquisition_budget(start.job_started_at, now=now)
        platform_remaining = original.bounded_acquisition_budget(start.platform_job_started_at, now=now)
        remaining = min(wall_remaining, platform_remaining, start.monotonic_deadline - tick)
        require(remaining > 0, "Acquisition deadline reached; finalization reserve is retained")
        self._last_time, self._last_tick = now, tick
        return remaining


def preflight(job_started_at):
    admitted_tick = time.monotonic()
    now = batch.utc_now()
    review = catchup.load_optional_review(now=now)
    if review is None:
        review = preparation.load_review(now=now)
        execution, content = preparation.read_pinned(EXECUTION_PATH, EXECUTION_SHA256)
    else:
        execution = {**execution_identity(review), "execution_enabled": True,
                     "expected_run_number": review.admission["expected_run_number"]}
        content = batch._json_bytes(execution)
    context = dict(os.environ)
    validate_execution(execution, review, now=now, context=context)
    preparation.require_retry_decisions(review, expected_run_number=execution["expected_run_number"])
    original.bounded_acquisition_budget(job_started_at, now=now)
    checkout = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, timeout=30).decode().strip()
    require(checkout == context["GITHUB_SHA"], "Local checkout differs from the authenticated workflow head")
    subprocess.run(["git", "diff", "--quiet", "HEAD", "--"], cwd=ROOT, check=True, timeout=30)
    remaining = original.bounded_acquisition_budget(job_started_at, now=batch.utc_now())
    authenticated = authenticate_execution(execution, context, now=now, job_started_at=job_started_at,
                                           maximum_seconds=min(60, remaining))
    clock = _ExecutionClock(execution, review, context, authenticated, job_started_at=job_started_at,
                            admitted_at=now, admitted_tick=admitted_tick)
    clock.remaining(batch.utc_now())
    return review, execution, content, context, authenticated, clock


def verify_typed_source(restored):
    """Reauthenticate the separate restore route; never trust saved JSON alone."""
    restored = archive._safe(restored)
    paths = {"sourceZipPath": str(restored / "source.zip"), "sourceDirectory": str(restored / "files"),
             "certificateZipPath": str(restored / "companion.zip")}
    script = "import {verifyRestoredPostcaptureSource} from './.github/scripts/restore-postcapture-statement-source.mjs'; process.stdout.write(JSON.stringify(verifyRestoredPostcaptureSource(JSON.parse(process.argv[1]))));"
    raw = subprocess.check_output(["node", "--input-type=module", "-e", script, json.dumps(paths)], cwd=ROOT, timeout=300)
    require(len(raw) <= 16 * 1024 * 1024, "Typed source provenance exceeds bound")
    proof = json.loads(raw, object_pairs_hook=batch._pairs)
    validate_typed_source(proof)
    saved, _ = archive._read(restored / "restored.json")
    require(saved == proof, "Saved typed source differs from independently authenticated restoration")
    return proof


def validate_typed_source(proof):
    closed(proof, {"schema_version", "kind", "authority", "source", "companion", "producer_job", "baseline",
                   "publication_authority", "provider_work_authorized", "published"}, "typed restore provenance")
    baseline = preparation.baseline_reader()
    require(proof["schema_version"] == "financial-source-postcapture-restore-v1" and
            proof["kind"] == "postcapture_validated_recovery" and proof["source"] == baseline.SOURCE and
            proof["authority"] == "retained_source_baseline_only" and proof["publication_authority"] == "none" and
            proof["provider_work_authorized"] is False and proof["published"] is False,
            "Typed failed producer cannot be coerced into an ordinary successful source")
    prior = proof["baseline"]
    require(prior.get("kind") == "postcapture_validated_baseline" and prior.get("source") == baseline.SOURCE and
            prior.get("companion_reference") == baseline.REFERENCE and
            prior.get("github_success_independently_authenticated") is False and
            prior.get("provider_work_authorized") is False and prior.get("publication_authority") == "none" and
            prior.get("producer_execution", {}).get("producer_run_conclusion") == "failure" and
            prior.get("producer_execution", {}).get("producer_job_conclusion") == "failure",
            "Original failed producer outcome or separate companion binding changed")
    # The JS verifier above validates the full certification, API and code closure.


def validate_retained_work(review, current, *, now):
    """The pinned queue is enough; the large offline projection is not executed."""
    barriers.audit_global_barriers(current)
    for entry in review.queue:
        symbol = entry["original"]["symbol"]
        for attribute, prefix in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
            retained = entry["retained"]
            receipt = retained[prefix + "_receipt"]
            require(current.manifest["current"].get(f"{symbol}/{attribute}") == receipt,
                    "Retained queue current receipt changed or source was replayed")
            require((receipt is None) == (retained[prefix + "_observed_at"] is None), "Absent receipt has an observation clock")
            if receipt is not None:
                require(current.acquisitions[receipt]["context"]["observed_at"] == retained[prefix + "_observed_at"],
                        "Retained receipt observation clock changed")
    for decision in review.request["missing_prior_decisions"]:
        preparation.validate_retry_decision(decision)
        attempt = current.manifest["attempts"].get(decision["attempt_id"])
        require(attempt is not None and attempt["symbol"] == decision["symbol"] and
                attempt["attributes"] == [decision["attribute"]] and attempt["outcome"] == "failed" and
                attempt["attempted_at"] == decision["attempted_at"] and attempt.get("retry_not_before") is None and
                attempt["source_object_sha256"] == decision["journal_sha256"], "Missing-prior attempt provenance changed")
        journal, journal_bytes = current.objects[decision["journal_sha256"]]
        require(sha256(journal_bytes) == decision["journal_sha256"] and
                json.loads(journal_bytes, object_pairs_hook=batch._pairs) == journal,
                "Missing-prior original journal bytes changed")
        failures = [x for x in journal["attempts"] if x["attempt_id"] == decision["attempt_id"]]
        require(len(failures) == 1, "Missing-prior original journal is absent or ambiguous")
        failed = failures[0]
        require(failed.get("failure_kind") == decision["failure_kind"] == "empty_getter_result" and
                all(failed.get(key) == decision[key] for key in ("symbol", "attribute", "attempt_id", "attempted_at", "outcome")) and
                failed.get("attributes") == [decision["attribute"]] and failed.get("http_status") is None and
                failed.get("retry_not_before") is None and attempt.get("http_status") is None and
                failed.get("acquisition_file") == f"acquisitions/{decision['symbol']}-{decision['attribute']}.json",
                "Missing-prior failure reason, original identity or null status changed")
        started, completed = batch.clock(failed["attempted_at"]), batch.clock(failed["completed_at"])
        require(started <= completed <= now, "Missing-prior terminal attempt clock changed")
        candidates = [(digest, value) for digest, (value, _) in current.objects.items()
            if current.manifest["objects"][digest]["kind"] == "failed_acquisition" and
            value.get("symbol") == decision["symbol"] and value.get("attribute") == decision["attribute"] and
            started <= batch.clock(value.get("getter_completed_at")) <= completed]
        require(len(candidates) == 1, "Missing-prior failed acquisition is absent or ambiguous")
        failure_sha, raw = candidates[0]
        failure_bytes = current.objects[failure_sha][1]
        require(sha256(failure_bytes) == failure_sha and json.loads(failure_bytes, object_pairs_hook=batch._pairs) == raw,
                "Missing-prior failed-acquisition bytes changed")
        require(raw.get("failure") == {"kind": "empty_getter_result", "may_include_swallowed_provider_error": True} and
                raw.get("source_acquisition_contexts") == {} and raw.get("point_in_time") is False and
                raw.get("full_http_bodies_archived") is False and raw.get("source_publication_date") is None and
                raw.get("source_publication_date_status") == "unknown" and
                raw.get("original_frame_cells") == {"format": "original-yfinance-frame-cells-v1", "columns": [], "rows": []},
                "Missing-prior empty getter evidence or unresolved cause changed")
        events = raw.get("transport_events")
        require(isinstance(events, list) and events, "Missing-prior transport evidence is absent")
        for event in events:
            require(event.get("symbol") == decision["symbol"] and event.get("attribute") == decision["attribute"] and
                    type(event.get("http_status")) is int and event["http_status"] == 200 and event.get("method") == "GET" and
                    event.get("source_subset_status") == "unrecognized_or_out_of_bounds" and
                    isinstance(event.get("transport_payload_sha256"), str) and
                    re.fullmatch(r"[a-f0-9]{64}", event["transport_payload_sha256"]) and
                    type(event.get("transport_payload_bytes")) is int and event["transport_payload_bytes"] > 0 and
                    started <= batch.clock(event.get("started_at")) <= batch.clock(event.get("completed_at")) <= completed,
                    "Missing-prior original HTTP 200 transport evidence changed")
        if decision["decision_state"] == "one_visit_reobservation_approved":
            scope = decision["reobservation"]
            require(scope["failed_acquisition_sha256"] == failure_sha and
                    scope["transport_payload_sha256s"] == [event["transport_payload_sha256"] for event in events],
                    "Missing-prior decision failed-object or transport binding changed")
    work = []
    for item, selected in zip(review.plan["selected"], review.selected):
        require(item["symbol"] == selected["symbol"], "Selected work order changed")
        for attribute, prefix in (("quarterly_income_stmt", "quarterly"), ("income_stmt", "annual")):
            receipt = selected[prefix + "_receipt"]
            require(current.manifest["current"].get(f"{item['symbol']}/{attribute}") == receipt,
                    "Selected current receipt changed")
            if receipt is None:
                require((item["symbol"], attribute) in {(x["symbol"], x["attribute"]) for x in review.request["missing_prior_decisions"]},
                        "Unexpected missing prior receipt")
                state = "fresh_work_missing_prior"
            else:
                validity = batch.required_validity_state(current.acquisitions[receipt]["raw"], item["symbol"], attribute,
                                                         item, review.plan, now=now)
                require(validity["state"] != "current", "Selected work must not be treated as reusable")
                state = "fresh_work_outside_required_horizon"
            work.append({"symbol": item["symbol"], "attribute": attribute, "prior_receipt": receipt, "state": state,
                         **({"retry_decision": next(x["decision_state"] for x in review.request["missing_prior_decisions"] if (x["symbol"], x["attribute"]) == (item["symbol"], attribute)), "retry_not_before": None} if receipt is None else {"required_validity_state": validity["state"]})})
    require(len(work) == 2 * len(review.plan["selected"]), "Selected work is incomplete")
    return work


def write_cycle_metadata(output, *, review, provenance, execution_bytes, authenticated, work,
                         base, cohort_bytes, companion_zip, digest):
    """Write the exact pre-guard metadata; also usable for offline capacity measurement.

    This helper does not authorize execution or copy an archive. Callers must
    label fixture measurements separately; real collection authenticates first.
    """
    cohort = json.loads(cohort_bytes, object_pairs_hook=batch._pairs)
    source = review.request["input_source"]
    (output / "base.json").write_bytes(base)
    (output / "cohort.json").write_bytes(cohort_bytes)
    for name, content in review.contents.items():
        (output / name).write_bytes(content)
    (output / "dispatch-execution.json").write_bytes(execution_bytes)
    batch.write_json(output / "execution-context.json", authenticated)
    batch.write_json(output / "source-provenance.json", provenance)
    batch.write_json(output / "fresh-work.json", {"schema_version": "postcapture-next-200-fresh-work-v1", "getters": work})
    batch.write_json(output / "plan.json", review.plan)
    if Path(companion_zip).resolve() != (output / "companion.zip").resolve():
        shutil.copyfile(companion_zip, output / "companion.zip")
    require(sha256((output / "companion.zip").read_bytes()) == source["companion_artifact_sha256"], "Companion bytes changed")
    batch.write_json(output / "cycle.json", {"schema_version": "financial-recovery-cycle-v1", "phase": "prepared",
        "dry_run": False, "archive_manifest_sha256": digest,
        "base_artifact_sha256": cohort["base_artifact_sha256"], "published": False})


def collect_cycle(source_files, companion_zip, output, review, provenance, execution_bytes, authenticated,
                  *, job_started_at, check_clock, now_fn=batch.utc_now, retention_factory=StatementRetentionBudget,
                  execution_guard=None):
    """Admitted cycle core. Direct small fixtures use real archive/collector/guard."""
    now = now_fn()
    check_clock(now)
    original.bounded_acquisition_budget(job_started_at, now=now)
    preparation.require_retry_decisions(review, expected_run_number=authenticated.get("run_number"))
    source_files, output = archive._safe(source_files), archive._safe(output)
    require(not output.exists() and source_files not in output.parents and output not in source_files.parents,
            "Output must be new and separate from immutable source")
    base = (source_files / "base.json").read_bytes()
    cohort_bytes = (source_files / "cohort.json").read_bytes()
    cohort = json.loads(cohort_bytes, object_pairs_hook=batch._pairs)
    source = review.request["input_source"]
    require(sha256(base) == source["base_sha256"] and sha256(cohort_bytes) == source["cohort_sha256"] and
            cohort == review.plan["verified_us_cohort"], "Original base or full cohort bytes changed")
    batch.validate_plan(review.plan, base)
    current = archive.load_archive(source_files / "archive", source["archive_manifest_sha256"],
                                   base_bytes=base, cohort=cohort, now=now)
    work = validate_retained_work(review, current, now=now)
    output.mkdir(parents=True, exist_ok=False)
    destination = output / "archive"
    shutil.copytree(source_files / "archive", destination)
    digest = current.sha256
    write_cycle_metadata(output, review=review, provenance=provenance, execution_bytes=execution_bytes,
        authenticated=authenticated, work=work, base=base, cohort_bytes=cohort_bytes,
        companion_zip=companion_zip, digest=digest)
    current = archive.load_archive(destination, digest, base_bytes=base, cohort=cohort, now=now)
    cache, cache_sha = archive.export_cache(current, review.plan, base, output / "selected-cache", now=now)
    require(cache_sha == review.request["selected_cache_sha256"], "Selected original cache changed")
    cache_value, _ = archive._read(cache)
    expected_cache = {f"{x['symbol']}/{x['attribute']}" for x in work if x["prior_receipt"] is not None}
    require(set(cache_value["acquisitions"]) == expected_cache, "Missing quarterly prior was synthesized as reuse")
    archive.prepare_writer_lock(destination)
    guard = retention_factory(output, selected_symbols=200, max_transport_requests=1000)
    guard.check("initial")
    check_clock(now_fn())
    # Charge the last authentication calls as setup too, after they complete.
    ready = now_fn()
    allowance = original.bounded_acquisition_budget(job_started_at, now=ready)
    result, code = batch.collect(review.plan, base, output / "batch", cache_manifest=cache, cache_sha256=cache_sha,
        acquisition_budget_seconds=allowance, max_statement_getter_calls=400, max_transport_requests=1000,
        retention_guard=guard, execution_guard=execution_guard)
    require(result["counts"]["reused_attributes"] == 0, "Reviewed fresh work was unexpectedly reused")
    guard.before_merge()
    next_digest = archive.merge_batch(destination, digest, batch_dir=output / "batch",
        summary_sha256=sha256((output / "batch/summary.json").read_bytes()), base_bytes=base, cohort=cohort,
        now=now_fn(), maximum_manifest_bytes=guard.maximum_manifest_bytes)
    checked = archive.load_archive(destination, next_digest, base_bytes=base, cohort=cohort, now=now_fn())
    cycle = {"schema_version": "financial-recovery-cycle-v1", "phase": "completed", "dry_run": False,
        "code_revision": authenticated["head_sha"], "source_data_as_of": json.loads(base)["as_of_date"],
        "base_artifact_sha256": cohort["base_artifact_sha256"], "previous_archive_manifest_sha256": digest,
        "archive_manifest_sha256": next_digest, "retained_receipts": len(checked.manifest["receipts"]),
        "retained_symbols": len({x["symbol"] for x in checked.manifest["receipts"].values()}),
        "selected_symbols": len(review.plan["selected"]), "provider_state_before": "available",
        "exit_code": code, "published": False}
    cycle_sha = batch.write_json(output / "cycle.json", cycle)
    guard.authorize_finalization(archive_manifest_sha256=next_digest, cycle_sha256=cycle_sha,
                                archive_object_sha256s=checked.manifest["objects"])
    report = guard.verify_final()
    require(sha256((source_files / "archive/manifest.json").read_bytes()) == digest, "Immutable source manifest changed")
    return {"cycle": cycle, "acquisition_counts": result["counts"], "retention": report}, code


def run(restored, output, *, job_started_at):
    review, execution, content, context, authenticated, clock = preflight(job_started_at)
    require(job_started_at == authenticated.get("job_started_at"), "Original authenticated job-start token changed")
    provenance = verify_typed_source(restored)
    def check_clock(now):
        remaining = clock.remaining(now)
        # An intervening partial run or changed head must still fail at the
        # actual acquisition boundary, after restore and retention scans.
        checked = authenticate_execution(execution, context, now=now, job_started_at=job_started_at,
                                         maximum_seconds=min(60, remaining))
        clock.confirm_authentication(checked)
        clock.remaining(batch.utc_now())
    last_observation = None
    def execution_guard(stage):
        nonlocal last_observation
        now = batch.utc_now()
        remaining = clock.remaining(now)
        elapsed = time.monotonic()
        if last_observation is None or elapsed - last_observation >= overlap.POLL_SECONDS:
            # Reauthenticate the current job and observe all active repository
            # work during collection. Polling cannot be a shared workflow lock.
            checked = authenticate_execution(execution, context, now=now, job_started_at=job_started_at,
                                             maximum_seconds=min(60, remaining))
            clock.confirm_authentication(checked)
            last_observation = time.monotonic()
            clock.remaining(batch.utc_now())
        return clock.acquisition_deadline
    return collect_cycle(Path(restored) / "files", Path(restored) / "companion.zip", output, review, provenance,
                         content, authenticated, job_started_at=job_started_at, check_clock=check_clock,
                         execution_guard=execution_guard)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("preflight", help="Reject unadmitted runs before restoration or acquisition")
    check.add_argument("--job-started-at", required=True)
    collect = sub.add_parser("collect", help="Collect exactly the separately admitted next visit")
    collect.add_argument("--restored", required=True, type=Path)
    collect.add_argument("--output", required=True, type=Path)
    collect.add_argument("--job-started-at", required=True)
    args = parser.parse_args()
    if args.command == "preflight":
        *_, authenticated, _clock = preflight(args.job_started_at)
        print(json.dumps({"schema_version": "postcapture-next-200-preflight-v1", **authenticated,
                          "published": False}, sort_keys=True))
    else:
        result, code = run(args.restored, args.output, job_started_at=args.job_started_at)
        print(json.dumps(result, sort_keys=True))
        raise SystemExit(code)
