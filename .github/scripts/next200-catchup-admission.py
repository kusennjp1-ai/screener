"""One disabled overdue catch-up route; historical seeds never confer freshness.

This controller accepts one committed, hash-pinned instance only. There is no
CLI/environment override and no current instance. Early-refresh validation is
unchanged. Every admitted getter still uses actual execution/capture clocks.
"""
from copy import deepcopy
from datetime import timedelta
import hashlib
import importlib.util
import json
from pathlib import Path
from types import MappingProxyType, SimpleNamespace

from app.services import financial_statement_batch as batch

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / ".github/bounded-refresh-next-200"
CONTROL = DIRECTORY / "catchup-control.json"
CONTROL_SHA256 = "3126d34f4fecb9ffe3726b806d791068fdc33f11b335125f875991bace4a8b4a"
SEED_REVIEW = DIRECTORY / "catchup-seed-review.json"
SEED_REVIEW_SHA256 = "ae7f4dd8fe42c9473eed60eb65bf14015e419553f050269d526db82982f9fb77"
MODE = "overdue_catchup"
MAX_WINDOW = timedelta(minutes=30)
HORIZON = timedelta(hours=36)

spec = importlib.util.spec_from_file_location("catchup_historical_preparation", Path(__file__).with_name("prepare-postcapture-next-200.py"))
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)
require, closed, sha256 = preparation.require, preparation.closed, preparation.sha256


def _clock(text):
    value = batch.clock(text)
    require(batch.timestamp(value) == text, "Catch-up clocks must be explicit UTC milliseconds")
    return value


def historical_seed():
    """Validate old provenance at its own pinned planning time, never at now."""
    plan, _ = preparation.read_pinned(DIRECTORY / "collector-plan.json", preparation.REVIEW_FILES["collector-plan.json"])
    seed = preparation.load_review(now=batch.clock(plan["evaluation_time"]))
    fixed, _ = preparation.read_pinned(SEED_REVIEW, SEED_REVIEW_SHA256)
    require(fixed["schema_version"] == "next200-catchup-fixed-seed-v1" and
            fixed["archive_manifest_sha256"] == preparation.SOURCE["archive_manifest_sha256"], "Catch-up fixed source changed")
    return seed, fixed


def validate_control(value):
    closed(value, {"schema_version", "execution_enabled", "admission", "prior_dispositions"}, "catch-up control")
    require(value["schema_version"] == "next200-catchup-control-v1" and type(value["execution_enabled"]) is bool,
            "Invalid catch-up control mode")
    choices = value["prior_dispositions"]
    require(isinstance(choices, list) and len(choices) == len(preparation.MISSING_PRIORS), "Four explicit catch-up dispositions required")
    for choice, original in zip(choices, preparation.MISSING_PRIORS):
        closed(choice, {"symbol", "attribute", "decision"}, "catch-up prior disposition")
        require(all(choice[key] == original[key] for key in ("symbol", "attribute")) and
                isinstance(choice["decision"], str) and choice["decision"] in {"pending", "reobserve_once", "defer_symbol"},
                "Unreviewed catch-up prior disposition")
    if not value["execution_enabled"]:
        require(value["admission"] is None and all(c["decision"] == "pending" for c in choices),
                "Disabled catch-up must leave admission unassigned and decisions pending")
        return False
    require(all(c["decision"] != "pending" for c in choices), "Pending catch-up dispositions block execution")
    admission = value["admission"]
    closed(admission, {"request_id", "expected_run_number", "evaluation_time", "dispatch_not_after", "seed_review_sha256"}, "catch-up admission")
    require(isinstance(admission["request_id"], str) and admission["request_id"].startswith("postcapture-overdue-") and
            len(admission["request_id"]) <= 128 and type(admission["expected_run_number"]) is int and
            admission["expected_run_number"] > 0 and admission["seed_review_sha256"] == SEED_REVIEW_SHA256,
            "Catch-up must bind one request/run and the exact historical seed")
    return True


def _binding(review):
    return sha256(batch._json_bytes({"mode": review.mode, "instance": review.instance,
        "plan": review.plan, "request": review.request, "admission": review.admission,
        "selected": review.selected, "seed": review.historical_seed, "existing_selected_receipts": review.existing_selected_receipts,
        "contents": {name: sha256(raw) for name, raw in review.contents.items()}}))


def _sealed(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _sealed(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_sealed(item) for item in value)
    return value


def validate_review(review, *, now):
    require(isinstance(review, CatchupReview) and review.mode == MODE and
            review.queue is review._sealed_queue and
            _binding(review) == review.binding_sha256, "Catch-up review/source/clock binding changed")
    start, end = (_clock(review.admission[key]) for key in ("dispatch_not_before", "dispatch_not_after"))
    require(start <= now <= end, "Catch-up is outside its finite admission window")
    require(timedelta(0) < end - start <= MAX_WINDOW and
            _clock(review.plan["required_valid_through"]) - start == HORIZON,
            "Catch-up window or validity horizon changed")


class CatchupReview(SimpleNamespace):
    pass


def build_review(value, *, now):
    require(validate_control(value), "Catch-up execution is disabled; no admission instance is assigned")
    seed, fixed = historical_seed()
    instance = deepcopy(value)
    admission = instance["admission"]
    start, end = (_clock(admission[key]) for key in ("evaluation_time", "dispatch_not_after"))
    require(start <= now <= end and timedelta(0) < end - start <= MAX_WINDOW,
            "Catch-up is outside its finite admission window")
    require(batch.clock(seed.request["source_evaluation_time"]) <= batch.clock(seed.plan["evaluation_time"]) <= start,
            "Catch-up planning clock predates its historical seed")
    rows = json.loads(seed.contents["consumer-queue.json"], object_pairs_hook=batch._pairs)["rows"]
    deferred = sorted(c["symbol"] for c in instance["prior_dispositions"] if c["decision"] == "defer_symbol")
    due = [r for r in rows if r["consumer_timer"] is not None and batch.clock(r["consumer_timer"]) <= start + HORIZON]
    selected = [r for r in due if r["symbol"] not in deferred][:200]
    require(len(selected) == 200 and any(batch.clock(r["consumer_timer"]) <= start for r in selected),
            "Catch-up requires actual overdue obligations, not an early-refresh relabel")
    symbols = [r["symbol"] for r in selected]
    cache = fixed["cache_by_deferred_symbols"].get(",".join(deferred))
    require(cache is not None and hashlib.sha256(json.dumps(symbols, separators=(",", ":")).encode()).hexdigest() == cache["selection_sha256"],
            "Catch-up selection is outside the finite reviewed alternatives")
    plan = deepcopy(seed.plan)
    plan.update(evaluation_time=admission["evaluation_time"], required_valid_through=batch.timestamp(start + HORIZON),
                batch_allowlist=symbols, selected=[{"symbol": s, "attributes": list(batch.ATTRIBUTES), "targets": ["annual_history"]} for s in symbols])
    priors = []
    for choice, original, evidence in zip(instance["prior_dispositions"], preparation.MISSING_PRIORS, fixed["failed_priors"]):
        require(all(original[key] == evidence[key] for key in ("symbol", "attribute")), "Fixed original failure identity changed")
        item = deepcopy(original)
        scope = {"request_id": admission["request_id"], "expected_run_number": admission["expected_run_number"]}
        if choice["decision"] == "reobserve_once":
            require(item["symbol"] in symbols, "Reobservation is outside this visit")
            item.update(decision_state="one_visit_reobservation_approved", reobservation={**scope, "maximum_getter_calls": 1,
                "failed_acquisition_sha256": evidence["failed_acquisition_sha256"], "transport_payload_sha256s": evidence["transport_payload_sha256s"]})
        else:
            require(item["symbol"] not in symbols, "Deferred symbol cannot enter this visit")
            item.update(decision_state="deferred_for_this_visit", deferral={**scope, "maximum_getter_calls": 0})
        priors.append(item)
    current_admission = {"schema_version": "postcapture-next-200-catchup-admission-v1", "admission_mode": MODE,
        "request_id": admission["request_id"], "execution_enabled": True, "expected_run_number": admission["expected_run_number"],
        "dispatch_not_before": admission["evaluation_time"], "dispatch_not_after": admission["dispatch_not_after"],
        "publication_authority": "none", "freshness_authority": "newly_observed_receipts_only"}
    request = deepcopy(seed.request)
    request.update(schema_version="postcapture-next-200-catchup-review-v1", admission_mode=MODE,
                   missing_prior_decisions=priors, selected_cache_sha256=cache["sha256"],
                   first_symbol=symbols[0], last_symbol=symbols[-1], first_deadline=selected[0]["consumer_deadline"],
                   last_deadline=selected[-1]["consumer_deadline"], required_valid_through=plan["required_valid_through"])
    request["selection_rule"] = "First 200 historical source-owned obligations through the current horizon, excluding only explicitly deferred original cases; completeness and prior refreshed status are not filters."
    request["collector_plan_sha256"] = sha256(batch._json_bytes(plan))
    contents = dict(seed.contents)
    for name in ("collector-plan.json", "dispatch-review.json", "dispatch-admission.json"):
        contents["historical-" + name] = contents[name]
    contents.update({"collector-plan.json": batch._json_bytes(plan), "dispatch-review.json": batch._json_bytes(request),
                     "dispatch-admission.json": batch._json_bytes(current_admission)})
    by_symbol = {r["original"]["symbol"]: r for r in seed.queue}
    queue = _sealed(seed.queue)
    review = CatchupReview(mode=MODE, instance=instance, plan=plan, request=request, admission=current_admission,
        queue=queue, _sealed_queue=queue, selected=[{"symbol": symbol, **by_symbol[symbol]["retained"], "consumer_deadline": row["consumer_deadline"]}
            for symbol, row in zip(symbols, selected)], contents=contents,
        historical_seed={"kind": "historical_selection_and_lineage_only", "review_sha256": preparation.REVIEW_FILES["dispatch-review.json"],
            "seed_review_sha256": SEED_REVIEW_SHA256, "evaluation_time": seed.plan["evaluation_time"],
            "source_evaluated_at": seed.request["source_evaluation_time"], "first_original_deadline": seed.request["first_deadline"],
            "current_validity_attested": False}, existing_selected_receipts=cache["receipt_count"])
    review.binding_sha256 = _binding(review)
    validate_review(review, now=now)
    preparation.require_retry_decisions(review, expected_run_number=admission["expected_run_number"])
    return review


def execution_delta(review):
    require(isinstance(review, CatchupReview), "Unrecognized catch-up review")
    return {"schema_version": "postcapture-next-200-execution-v3", "admission_mode": MODE,
        "historical_seed": review.historical_seed, "freshness_authority": "newly_observed_receipts_only",
        "deferred_symbols": sorted(x["symbol"] for x in review.request["missing_prior_decisions"] if x["decision_state"] == "deferred_for_this_visit"),
        "proposal_sha256": sha256(review.contents["dispatch-admission.json"]), "review_sha256": sha256(review.contents["dispatch-review.json"]),
        "collector_plan_sha256": sha256(review.contents["collector-plan.json"]),
        "selected_cache_sha256": review.request["selected_cache_sha256"], "existing_selected_receipts": review.existing_selected_receipts}


def load_optional_review(*, now):
    control, _ = preparation.read_pinned(CONTROL, CONTROL_SHA256)
    if not validate_control(control):
        return None
    return build_review(control, now=now)
