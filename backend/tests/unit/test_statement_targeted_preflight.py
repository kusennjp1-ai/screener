"""Offline adversarial target selection; no collector/provider imports or calls."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import json
import hashlib

import pytest

from app.scripts.prepare_statement_targeted_preflight import prepare, receipt_bound_attempt, select_due_targets, validate_request
from app.services import statement_refresh_planning as planning

NOW = datetime(2026, 10, 16, 9, tzinfo=timezone.utc)
TARGETS = ["eps", "sales", "annual_history"]


def request():
    return {"schema_version": "financial-targeted-recovery-preflight-request-v1",
        "created_at": "2026-10-16T08:59:00Z", "expires_at": "2026-10-16T10:00:00Z",
        "source": {"run_id": 1, "run_attempt": 1, "head_sha": "1" * 40, "artifact_id": 2,
            "artifact_sha256": "2" * 64, "archive_manifest_sha256": "3" * 64,
            "base_sha256": "4" * 64, "cohort_sha256": "5" * 64},
        "base_sha256": "6" * 64, "cohort_sha256": "7" * 64,
        "selection": [{"symbol": "AAOI", "targets": TARGETS.copy()}, {"symbol": "NVDA", "targets": TARGETS.copy()}],
        "limits": {"max_symbols": 2, "max_statement_getter_calls": 4},
        "publication_authority": "none", "provider_execution": False, "financial_admission": False}


def item(symbol, *, state="ready", targets=TARGETS):
    return planning.WorkItem(symbol, tuple(planning.Requirement(target, "original_receipt_expired", state,
        due_since=NOW-timedelta(days=1), attributes=planning.STATEMENT_ATTRIBUTES if target == "annual_history"
        else ("quarterly_income_stmt",)) for target in targets), NOW-timedelta(days=4))


def plan():
    # These named cases sit beyond the normal 200 prefix, in a pre-existing order
    # that deliberately differs from both the request and alphabetical order.
    before = tuple(item(f"X{n}") for n in range(200))
    work = before + (item("NVDA"), item("FUTU", state="retry_decision_required"), item("AAOI"))
    return planning.StatementRefreshPlan(tuple(i.symbol for i in work), "US", NOW, NOW, len(work), work, before,
        {}, "available", None, (), None)


def test_filters_complete_due_queue_without_reordering_or_changing_full_cohort():
    current = plan()
    result = select_due_targets(current, validate_request(request(), now=NOW))
    assert result.symbols == ("NVDA", "AAOI")
    assert result.eligible_symbols is current.eligible_symbols
    assert result.required_work is current.required_work
    assert result.eligible_count == 203
    assert current.symbols == tuple(f"X{n}" for n in range(200))
    assert [i.ready_targets for i in result.batch] == [tuple(TARGETS), tuple(TARGETS)]


@pytest.mark.parametrize("state", ["retry_decision_required", "cooldown", "provider_stopped", "blocked", "in_flight"])
def test_never_selects_held_requested_target(state):
    current = plan()
    work = tuple(item("NVDA", state=state) if i.symbol == "NVDA" else i for i in current.required_work)
    with pytest.raises(ValueError, match="independently due"):
        select_due_targets(replace(current, required_work=work), validate_request(request(), now=NOW))


def test_explicit_quarterly_target_subset_does_not_enable_held_annual_target():
    current = plan()
    nvda = item("NVDA")
    nvda = replace(nvda, requirements=nvda.requirements[:2] + (replace(nvda.requirements[2], state="retry_decision_required"),))
    current = replace(current, required_work=tuple(nvda if i.symbol == "NVDA" else i for i in current.required_work))
    value = request(); value["selection"][1]["targets"] = ["eps", "sales"]
    result = select_due_targets(current, validate_request(value, now=NOW))
    assert result.batch[0].attributes == ("quarterly_income_stmt",)
    assert result.batch[0].ready_targets == ("eps", "sales")
    assert next(i for i in result.required_work if i.symbol == "NVDA").requirements[2].state == "retry_decision_required"


@pytest.mark.parametrize("due", [None, NOW+timedelta(seconds=1)])
def test_no_missing_or_future_expiry_is_promoted_to_due_work(due):
    current = plan()
    nvda = item("NVDA")
    nvda = replace(nvda, requirements=tuple(replace(r, due_since=due) for r in nvda.requirements))
    with pytest.raises(ValueError, match="independently due"):
        select_due_targets(replace(current, required_work=tuple(nvda if i.symbol == "NVDA" else i for i in current.required_work)),
            validate_request(request(), now=NOW))


@pytest.mark.parametrize("changes", [{"provider_state": "stopped"}, {"invalid_receipts": ("OTHER:annual_history",)}])
def test_global_provider_stop_and_unrelated_invalid_receipts_fail_closed(changes):
    with pytest.raises(ValueError, match="Provider stop or invalid receipt"):
        select_due_targets(replace(plan(), **changes), validate_request(request(), now=NOW))


@pytest.mark.parametrize("field,value", [("publication_authority", "publish"), ("provider_execution", True),
    ("financial_admission", True), ("provider_execution", 0), ("created_at", "2026-10-16T09:01:00Z"),
    ("expires_at", "2026-10-16T09:00:00Z"), ("expires_at", "2026-10-17T09:00:00Z")])
def test_request_cannot_grant_authority_or_reuse_expired_intent(field, value):
    value_request = request(); value_request[field] = value
    with pytest.raises(ValueError):
        validate_request(value_request, now=NOW)


@pytest.mark.parametrize("mutate", [
    lambda r: r.update(retry_decisions={}),
    lambda r: r["limits"].update(max_symbols=200),
    lambda r: r["limits"].update(max_statement_getter_calls=400),
    lambda r: r["limits"].update(max_symbols=True),
    lambda r: r["selection"][0].update(symbol="FUTU"),
    lambda r: r["selection"][0].update(symbol="NVDA"),
    lambda r: r["selection"][0].update(targets=["annual_history", "eps"]),
    lambda r: r["selection"][0].update(targets=["rating"]),
    lambda r: r["selection"][0].update(targets=["eps", "eps"]),
    lambda r: r["source"].update(run_id=True),
    lambda r: r["source"].update(artifact_sha256="A" * 64),
])
def test_closed_target_request_rejects_expanded_scope_and_ambiguous_controls(mutate):
    value = deepcopy(request()); mutate(value)
    with pytest.raises(ValueError):
        validate_request(value, now=NOW)


def journal_fixture():
    entry={"attempt_id":"actual-attempt","symbol":"NVDA","attribute":"income_stmt","attributes":["income_stmt"],
        "outcome":"succeeded","capture_id":"original-capture","attempted_at":"2026-10-06T14:26:53.709Z", "completed_at":"2026-10-06T14:26:53.993Z"}
    receipt={"symbol":"NVDA","attribute":"income_stmt","capture_id":"original-capture","observed_at":"2026-10-06T14:26:53.966Z"}
    return SimpleNamespace(manifest={"receipts":{"r":receipt},"attempts":{"actual-attempt":{**entry,"source_object_sha256":"j"}}},
        objects={"j":({"attempts":[entry]},b"retained-original-journal")},
        acquisitions={"r":{"raw":{"getter_completed_at":"2026-10-06T14:26:53.989Z"}}})


def test_exact_original_attempt_is_bound_to_capture_and_all_original_clocks():
    latest, original=receipt_bound_attempt(journal_fixture(),symbol="NVDA",attribute="income_stmt",receipt_sha="r",now=NOW)
    assert latest["attempt_id"] == original["attempt_id"] == "actual-attempt"
    assert original["capture_id"] == "original-capture"


@pytest.mark.parametrize("field,value", [("capture_id","different-capture"),("symbol","AAOI"),("attribute","quarterly_income_stmt"),
    ("attributes",["quarterly_income_stmt","income_stmt"]),("outcome","failed"),
    ("attempted_at","2026-10-06T14:26:53.980Z"),("completed_at","2026-10-06T14:26:53.970Z"),
    ("completed_at","2026-10-17T00:00:00Z")])
def test_receipt_audit_rejects_pairing_success_with_different_capture_or_invalid_clocks(field,value):
    original=journal_fixture();original.objects["j"][0]["attempts"][0][field]=value
    with pytest.raises(ValueError,match="exact original receipt"):
        receipt_bound_attempt(original,symbol="NVDA",attribute="income_stmt",receipt_sha="r",now=NOW)


@pytest.mark.parametrize("location", ["source", "base"])
def test_target_output_cannot_write_inside_immutable_inputs(tmp_path, location):
    source=tmp_path/"source";source.mkdir();current=tmp_path/"current";current.mkdir()
    output=(source if location == "source" else current)/"result"
    with pytest.raises(ValueError,match="separate from inputs"):
        prepare(source_files=source,base_path=current/"base.json",cohort_path=current/"cohort.json",
            request_path=tmp_path/"request.json",output=output,now=NOW)
    assert not output.exists()


def test_parent_traversal_cannot_bypass_output_input_separation(tmp_path):
    source=tmp_path/"source";source.mkdir();other=tmp_path/"other";other.mkdir()
    with pytest.raises(ValueError,match="Parent traversal"):
        prepare(source_files=source,base_path=tmp_path/"current/base.json",cohort_path=tmp_path/"current/cohort.json",
            request_path=tmp_path/"request.json",output=other/".."/"source"/"archive"/"result",now=NOW)
    assert not (source/"archive").exists()


def test_direct_target_cli_cannot_bypass_current_base_anti_rollback(tmp_path):
    source=tmp_path/"source";source.mkdir();current=tmp_path/"current";current.mkdir()
    def write(path,value):
        content=json.dumps(value).encode();path.write_bytes(content);return hashlib.sha256(content).hexdigest()
    old_base_sha=write(source/"base.json",{"as_of_date":"2026-10-15","market":"US","rows":[{"symbol":"NVDA"},{"symbol":"AAOI"}]})
    old_cohort_sha=write(source/"cohort.json",{"symbols":["NVDA","AAOI"],"base_artifact_sha256":old_base_sha})
    new_base_sha=write(current/"base.json",{"as_of_date":"2026-10-14","market":"US","rows":[{"symbol":"NVDA"},{"symbol":"AAOI"}]})
    new_cohort_sha=write(current/"cohort.json",{"symbols":["NVDA","AAOI"],"base_artifact_sha256":new_base_sha})
    value=request();value["source"].update(base_sha256=old_base_sha,cohort_sha256=old_cohort_sha)
    value.update(base_sha256=new_base_sha,cohort_sha256=new_cohort_sha);write(tmp_path/"request.json",value)
    with pytest.raises(ValueError,match="predates"):
        prepare(source_files=source,base_path=current/"base.json",cohort_path=current/"cohort.json",
            request_path=tmp_path/"request.json",output=tmp_path/"result",now=NOW)
    assert not (tmp_path/"result").exists()
