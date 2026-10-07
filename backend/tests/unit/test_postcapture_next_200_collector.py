"""Real next-visit collector/merge/final guard with finite synthetic transports."""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services import statement_retention_budget as retention
from tests.unit import test_financial_statement_batch as fixtures

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("postcapture_next200_collector_test", ROOT / ".github/scripts/run-postcapture-next-200.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
NOW = batch.clock("2026-10-07T03:00:00Z")
JOB_STARTED_AT = "2026-10-07T02:59:00Z"


def forbidden(*args, **kwargs):
    raise AssertionError("No external API, copy or provider is authorized")


@pytest.fixture
def authorization():
    review = runner.preparation.load_review(now=NOW)
    value = {**runner.execution_identity(review), "execution_enabled": True, "expected_run_number": 9}
    context = {"GITHUB_REPOSITORY": runner.REPOSITORY, "GITHUB_REF_NAME": runner.BRANCH,
        "GITHUB_REF": "refs/heads/" + runner.BRANCH, "GITHUB_EVENT_NAME": "push",
        "GITHUB_WORKFLOW_REF": f"{runner.REPOSITORY}/{runner.WORKFLOW}@refs/heads/{runner.BRANCH}",
        "GITHUB_SHA": "c" * 40, "GITHUB_WORKFLOW_SHA": "c" * 40, "GITHUB_RUN_NUMBER": "9",
        "GITHUB_RUN_ID": "40000000000", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "statement-recovery"}
    return review, value, context


def test_disabled_fixture_rejects_before_api_source_copy_or_provider(tmp_path, monkeypatch, authorization):
    review, envelope, _ = authorization
    envelope.update(execution_enabled=False, expected_run_number=None)
    path = tmp_path / "disabled-execution.json"
    digest = batch.write_json(path, envelope)
    monkeypatch.setattr(runner, "EXECUTION_PATH", path)
    monkeypatch.setattr(runner, "EXECUTION_SHA256", digest)
    monkeypatch.setattr(runner, "authenticate_execution", forbidden)
    monkeypatch.setattr(runner, "verify_typed_source", forbidden)
    monkeypatch.setattr(runner.shutil, "copytree", forbidden)
    monkeypatch.setattr(runner.batch, "collect", forbidden)
    monkeypatch.setattr(runner.batch, "utc_now", lambda: NOW)
    monkeypatch.setenv("NEXT_200_EXECUTION_ENABLED", "true")
    monkeypatch.setenv("GITHUB_RUN_NUMBER", "9")
    with pytest.raises(ValueError, match="execution is disabled"):
        runner.run(tmp_path / "missing", tmp_path / "output", job_started_at=batch.timestamp(NOW))
    assert not (tmp_path / "output").exists()
    value, _ = runner.preparation.read_pinned(runner.EXECUTION_PATH, runner.EXECUTION_SHA256)
    assert value["execution_enabled"] is False and value["expected_run_number"] is None


@pytest.mark.parametrize("key,value", [
    ("GITHUB_RUN_NUMBER", "10"), ("GITHUB_RUN_NUMBER", "09"), ("GITHUB_RUN_ATTEMPT", "2"),
    ("GITHUB_EVENT_NAME", "workflow_dispatch"), ("GITHUB_REF_NAME", "main"),
    ("GITHUB_REPOSITORY", "elsewhere/screener"), ("GITHUB_RUN_ID", "37478731832"),
    ("GITHUB_SHA", runner.HISTORICAL_HEADS[0]), ("GITHUB_WORKFLOW_SHA", "a" * 40),
    ("GITHUB_JOB", "offline"),
])
def test_wrong_or_replayed_execution_context_rejected(authorization, key, value):
    review, envelope, context = authorization
    context[key] = value
    with pytest.raises(ValueError):
        runner.validate_execution(envelope, review, now=NOW, context=context)


@pytest.mark.parametrize("offset", [timedelta(days=-1), timedelta(days=1)])
def test_execution_expired_or_early(authorization, offset):
    review, envelope, context = authorization
    with pytest.raises(ValueError, match="finite dispatch window"):
        runner.validate_execution(envelope, review, now=NOW + offset, context=context)


def test_closed_envelope_binds_proposal_source_companion_budget(authorization):
    review, envelope, context = authorization
    runner.validate_execution(envelope, review, now=NOW, context=context)
    for key in envelope:
        if key in {"execution_enabled", "expected_run_number"}:
            continue
        changed = deepcopy(envelope)
        changed[key] = None
        with pytest.raises(ValueError):
            runner.validate_execution(changed, review, now=NOW, context=context)
    changed = {**envelope, "optional_trust_override": True}
    with pytest.raises(ValueError, match="closed"):
        runner.validate_execution(changed, review, now=NOW, context=context)
    for number in (True, "9", None, 0):
        with pytest.raises(ValueError):
            runner.validate_execution({**envelope, "expected_run_number": number}, review, now=NOW, context=context)


def api_fixture():
    run = {"id": 40000000000, "run_number": 9, "run_attempt": 1, "head_sha": "c" * 40,
        "head_branch": runner.BRANCH, "path": runner.WORKFLOW, "event": "push", "status": "in_progress",
        "conclusion": None, "repository": {"full_name": runner.REPOSITORY, "id": 1203919607},
        "head_repository": {"full_name": runner.REPOSITORY, "id": 1203919607}, "workflow_id": 12345,
        "run_started_at": "2026-10-07T02:59:00Z"}
    prior = {**deepcopy(run), "id": 37478731832, "run_number": 4, "head_sha": runner.HISTORICAL_HEADS[0],
             "status": "completed", "conclusion": "failure"}
    inventory = {"total_count": 2, "workflow_runs": [deepcopy(run), deepcopy(prior)]}
    ref = {"ref": "refs/heads/" + runner.BRANCH, "object": {"type": "commit", "sha": "c" * 40}}
    job = {"id": 100, "run_id": run["id"], "run_attempt": 1, "head_sha": run["head_sha"],
        "name": "statement-recovery", "status": "in_progress", "conclusion": None, "runner_id": 101, "started_at": JOB_STARTED_AT,
        "steps": [{"number": 1, "name": "Set up job", "status": "completed", "conclusion": "success",
                   "started_at": JOB_STARTED_AT, "completed_at": JOB_STARTED_AT},
                  {"number": 2, "name": "Start the bounded job clock", "status": "completed", "conclusion": "success",
                   "started_at": JOB_STARTED_AT, "completed_at": "2026-10-07T02:59:01Z"},
                  {"number": 3, "name": "Collect one bounded next-200 visit", "status": "in_progress", "conclusion": None}]}
    def api(endpoint):
        if endpoint.endswith("/actions/workflows/12345"):
            return {"id": 12345, "path": runner.WORKFLOW, "state": "active"}
        if "/jobs?" in endpoint:
            return {"total_count": 1, "jobs": [job]}
        if "/actions/runs?status=" in endpoint:
            active = [deepcopy(run)] if "status=in_progress&" in endpoint else []
            return {"total_count": len(active), "workflow_runs": active}
        if "actions/workflows" in endpoint:
            return inventory
        if endpoint.endswith("/attempts/1"):
            return prior
        if "/actions/runs/" in endpoint:
            return run
        return ref
    return run, prior, inventory, ref, api


def test_live_run_and_branch_authenticate_future_head(authorization):
    _, envelope, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    authenticated = runner.authenticate_execution(envelope, context, now=NOW, job_started_at=JOB_STARTED_AT, api=api)
    assert authenticated["run_number"] == 9
    assert authenticated["previous_run"] == {"id": 37478731832, "attempt": 1,
        "head_sha": runner.HISTORICAL_HEADS[0], "conclusion": "failure"}
    ref["object"]["sha"] = "d" * 40
    with pytest.raises(ValueError, match="no longer current"):
        runner.authenticate_execution(envelope, context, now=NOW, job_started_at=JOB_STARTED_AT, api=api)
    ref["object"]["sha"] = "c" * 40
    run["run_attempt"] = 2
    with pytest.raises(ValueError, match="exact one-shot"):
        runner.authenticate_execution(envelope, context, now=NOW, job_started_at=JOB_STARTED_AT, api=api)


@pytest.mark.parametrize("mutation", ["truncated", "oversized", "missing", "duplicate", "overlap", "newer_prior", "newer_run", "prior_retry", "prior_success", "prior_live"])
def test_complete_inventory_prevents_cold_replay_or_overlapping_work(authorization, mutation):
    _, envelope, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    if mutation == "truncated":
        inventory["total_count"] = 3
    elif mutation == "oversized":
        inventory["total_count"] = 101
    elif mutation == "missing":
        inventory["workflow_runs"] = [deepcopy(prior)]
        inventory["total_count"] = 1
    elif mutation == "duplicate":
        inventory["workflow_runs"].append(deepcopy(prior))
        inventory["total_count"] = 3
    elif mutation in {"overlap", "newer_prior", "newer_run"}:
        extra = deepcopy(prior)
        extra["id"] = 41000000000 if mutation == "newer_run" else 39000000000
        if mutation == "overlap":
            extra.update(status="in_progress", conclusion=None, head_branch="main")
        inventory["workflow_runs"].append(extra)
        inventory["total_count"] = 3
    elif mutation == "prior_retry":
        inventory["workflow_runs"][1]["run_attempt"] = 2
    elif mutation == "prior_success":
        inventory["workflow_runs"][1]["conclusion"] = "success"
    else:
        inventory["workflow_runs"][1]["status"] = "queued"
    with pytest.raises(ValueError):
        runner.authenticate_execution(envelope, context, now=NOW, job_started_at=JOB_STARTED_AT, api=api)


def typed_fixture():
    baseline = runner.preparation.baseline_reader()
    return {"schema_version": "financial-source-postcapture-restore-v1", "kind": "postcapture_validated_recovery",
        "authority": "retained_source_baseline_only", "source": baseline.SOURCE, "companion": {}, "producer_job": {},
        "baseline": {"kind": "postcapture_validated_baseline", "source": baseline.SOURCE,
            "companion_reference": baseline.REFERENCE, "github_success_independently_authenticated": False,
            "provider_work_authorized": False, "publication_authority": "none",
            "producer_execution": {"producer_run_conclusion": "failure", "producer_job_conclusion": "failure"}},
        "publication_authority": "none", "provider_work_authorized": False, "published": False}


def test_typed_baseline_cannot_be_coerced_to_success():
    proof = typed_fixture()
    runner.validate_typed_source(proof)
    for key, value in [("kind", "recovery_archive"), ("kind", "postcapture_validated_baseline"),
                       ("provider_work_authorized", True), ("schema_version", "financial-source-restore-v1")]:
        changed = deepcopy(proof)
        changed[key] = value
        with pytest.raises(ValueError):
            runner.validate_typed_source(changed)
    proof["baseline"]["producer_execution"]["producer_run_conclusion"] = "success"
    with pytest.raises(ValueError, match="failed producer"):
        runner.validate_typed_source(proof)


@pytest.fixture
def finite_cycle():
    harness = fixtures.TestFinancialStatementBatch(methodName="runTest")
    harness.setUp()
    try:
        root = harness.root
        plan, base = fixtures.plan_for(("BBNX", "BHP"))
        harness.reply = lambda symbol, attribute: (200, {"timeseries": {"error": None, "result": []}}) if (symbol, attribute) == ("BHP", "quarterly_income_stmt") else (200, fixtures.body(symbol, attribute))
        summary, code = batch.collect(plan, base, root / "seed")
        assert code == 3 and summary["counts"]["failed_attributes"] == 1
        harness.reply = lambda symbol, attribute: (200, fixtures.body(symbol, attribute))
        source_files = root / "source"
        source_files.mkdir()
        cohort = plan["verified_us_cohort"]
        digest = archive.create_archive(source_files / "archive", base_bytes=base, cohort=cohort, now=harness.now)
        digest = archive.merge_batch(source_files / "archive", digest, batch_dir=root / "seed",
            summary_sha256=batch.digest_bytes((root / "seed/summary.json").read_bytes()), base_bytes=base,
            cohort=cohort, now=harness.now)
        (source_files / "base.json").write_bytes(base)
        batch.write_json(source_files / "cohort.json", cohort)
        companion = root / "companion.zip"
        companion.write_bytes(b"finite direct fixture; no remote certificate authority")
        harness.now = NOW
        current = archive.load_archive(source_files / "archive", digest, base_bytes=base, cohort=cohort, now=NOW)
        plan = {**plan, "evaluation_time": "2026-10-06T16:30:00.000Z", "required_valid_through": "2026-10-08T04:30:00.000Z",
            "selected": [{"symbol": s, "attributes": list(batch.ATTRIBUTES), "targets": ["annual_history"]} for s in ("BBNX", "BHP")]}
        queue, selected = [], []
        for symbol in ("BBNX", "BHP"):
            item = {"symbol": symbol}
            for attribute, prefix in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
                receipt = current.manifest["current"].get(f"{symbol}/{attribute}")
                item[prefix + "_receipt"] = receipt
                item[prefix + "_observed_at"] = current.acquisitions[receipt]["context"]["observed_at"] if receipt else None
            selected.append(item)
            queue.append({"original": item, "retained": {k: v for k, v in item.items() if k != "symbol"}})
        _, cache_sha = archive.export_cache(current, plan, base, root / "cache-check", now=NOW)
        source = {"base_sha256": batch.digest_bytes(base), "cohort_sha256": batch.digest_bytes((source_files / "cohort.json").read_bytes()),
            "archive_manifest_sha256": digest, "companion_artifact_sha256": batch.digest_bytes(companion.read_bytes())}
        attempt = next(item for item in current.manifest["attempts"].values() if item["outcome"] == "failed")
        failure_sha, failure_raw = next((digest, value) for digest, (value, _) in current.objects.items()
            if current.manifest["objects"][digest]["kind"] == "failed_acquisition")
        decision = {"symbol": "BHP", "attribute": "quarterly_income_stmt", "decision_state": "one_visit_reobservation_approved",
            "retry_not_before": None, "attempt_id": attempt["attempt_id"], "attempted_at": attempt["attempted_at"],
            "failure_kind": "empty_getter_result", "outcome": "failed", "journal_sha256": attempt["source_object_sha256"],
            "reobservation": {"request_id": "finite-offline-fixture", "expected_run_number": 9, "maximum_getter_calls": 1,
                "failed_acquisition_sha256": failure_sha,
                "transport_payload_sha256s": [event["transport_payload_sha256"] for event in failure_raw["transport_events"]]}}
        review = SimpleNamespace(plan=plan, queue=queue, selected=selected, contents={"dispatch-admission.json": b'{"execution_enabled":false}\n'},
            admission={"request_id": "finite-offline-fixture"},
            request={"input_source": source, "missing_prior_decisions": [decision], "selected_cache_sha256": cache_sha})
        harness.calls.clear(); harness.tickers.clear(); harness.sleeps.clear()
        fixtures.YfData().cache_get.cache_clear()
        yield SimpleNamespace(harness=harness, root=root, review=review, current=current, source_files=source_files,
            companion=companion, original_manifest=(source_files / "archive/manifest.json").read_bytes())
    finally:
        harness.doCleanups()


def collect_fixture(fixture, guard=retention.StatementRetentionBudget, *, execution_guard=None):
    return runner.collect_cycle(fixture.source_files, fixture.companion, fixture.root / "output", fixture.review,
        typed_fixture(), b'{"execution_enabled":true,"scope":"finite_direct_fixture_only"}\n', {"head_sha": "c" * 40, "run_number": 9},
        job_started_at=batch.timestamp(NOW), check_clock=lambda now: None, now_fn=lambda: NOW, retention_factory=guard,
        execution_guard=execution_guard)


def test_real_collector_renews_three_old_receipts_and_missing_quarter_with_final_guard(finite_cycle):
    fixture = finite_cycle
    checked = []
    class AuditedGuard(retention.StatementRetentionBudget):
        def __init__(self, output, **kwargs):
            assert (output / "archive/.archive.lock").is_file()
            assert all((output / name).is_file() for name in ["source-provenance.json", "companion.zip",
                "dispatch-execution.json", "execution-context.json", "fresh-work.json", "plan.json", "cycle.json"])
            super().__init__(output, **kwargs)
        def verify_final(self):
            result = super().verify_final()
            checked.append(result)
            return result
    result, code = collect_fixture(fixture, AuditedGuard)
    assert code == 0 and len(fixture.harness.calls) == 4
    assert fixture.harness.sleeps == [1.5] * 4
    assert result["acquisition_counts"]["captured_attributes"] == 4
    assert result["acquisition_counts"]["reused_attributes"] == 0
    assert result["cycle"]["schema_version"] == "financial-recovery-cycle-v1"
    assert result["cycle"]["retained_receipts"] == 7 and result["cycle"]["published"] is False
    assert checked and checked[0]["canonical_zip_bytes"] <= checked[0]["compressed_bound_bytes"]
    assert (fixture.source_files / "archive/manifest.json").read_bytes() == fixture.original_manifest
    summary = fixtures.read(fixture.root / "output/batch/summary.json")
    assert summary["schema_version"] == "financial-statement-batch-summary-v1"
    assert summary["statement_getter_calls"] == summary["transport_calls"] == 4
    actual_plan = fixtures.read(fixture.root / "output/batch/plan.json")
    assert actual_plan["caller_retries"] == 0 and actual_plan["acquisition_budget_seconds"] == 1080
    assert actual_plan["maximum_transport_requests"] == 1000 and actual_plan["stop_http_statuses"] == [403, 429]
    work = fixtures.read(fixture.root / "output/fresh-work.json")["getters"]
    assert [x for x in work if x["prior_receipt"] is None] == [
        {"symbol": "BHP", "attribute": "quarterly_income_stmt", "prior_receipt": None, "state": "fresh_work_missing_prior", "retry_decision": "one_visit_reobservation_approved", "retry_not_before": None}]


@pytest.mark.parametrize("status", [403, 429, "transport_error"])
def test_global_provider_error_stop_keeps_real_failure_and_final_guard(finite_cycle, status):
    f = finite_cycle
    f.harness.reply = lambda *args: (status, {}) if isinstance(status, int) else (200, RuntimeError("synthetic transport failure"))
    result, code = collect_fixture(f)
    assert code == 2 and len(f.harness.calls) == 1
    assert result["cycle"]["exit_code"] == 2 and result["cycle"]["published"] is False
    summary = fixtures.read(f.root / "output/batch/summary.json")
    assert summary["provider_stop"] is not None and summary["statement_getter_calls"] == 1
    assert summary["counts"]["not_attempted_attributes"] == 3
    assert result["retention"]["canonical_zip_bytes"] > 0


def test_retention_stop_prevents_first_getter_but_preserves_final_evidence(finite_cycle):
    class StopGetter(retention.StatementRetentionBudget):
        def check(self, stage):
            result = super().check(stage)
            if stage == "getter":
                raise retention.RetentionBudgetExceeded({"stage": stage, "compressed_headroom_bytes": -1})
            return result
    result, code = collect_fixture(finite_cycle, StopGetter)
    assert code == 4 and finite_cycle.harness.calls == finite_cycle.harness.tickers == []
    summary = fixtures.read(finite_cycle.root / "output/batch/summary.json")
    assert summary["execution_stop"]["budget"] == "retention"
    assert summary["counts"]["not_attempted_attributes"] == 4
    assert result["cycle"]["retained_receipts"] == 3 and result["retention"]["canonical_zip_bytes"] > 0


def test_missing_quarter_cannot_be_fabricated_as_prior_or_reuse(finite_cycle):
    f = finite_cycle
    f.review.selected[1]["quarterly_receipt"] = f.review.selected[0]["quarterly_receipt"]
    with pytest.raises(ValueError, match="current receipt changed"):
        collect_fixture(f)
    assert f.harness.calls == [] and not (f.root / "output").exists()


def test_replayed_current_receipt_rejected_before_copy(finite_cycle):
    f = finite_cycle
    f.review.queue[0]["retained"]["annual_receipt"] = "f" * 64
    with pytest.raises(ValueError, match="replayed"):
        collect_fixture(f)
    assert f.harness.calls == [] and not (f.root / "output").exists()


def test_setup_budget_and_last_clock_gate_block_provider(finite_cycle):
    f = finite_cycle
    calls = []
    def exhausted(now):
        calls.append(now)
        if len(calls) == 2:
            raise ValueError("finite clock expired during setup")
    with pytest.raises(ValueError, match="expired during setup"):
        runner.collect_cycle(f.source_files, f.companion, f.root / "output", f.review, typed_fixture(), b'{}',
            {"head_sha": "c" * 40, "run_number": 9}, job_started_at=batch.timestamp(NOW), check_clock=exhausted, now_fn=lambda: NOW)
    assert f.harness.calls == f.harness.tickers == []


def test_final_authentication_time_is_charged_to_acquisition_allowance(finite_cycle):
    f = finite_cycle
    checks = []
    def authentication(now):
        checks.append(now)
        if len(checks) == 2:
            f.harness.now += timedelta(seconds=60)
    _, code = runner.collect_cycle(f.source_files, f.companion, f.root / "output", f.review, typed_fixture(), b'{}',
        {"head_sha": "c" * 40, "run_number": 9}, job_started_at=batch.timestamp(NOW), check_clock=authentication,
        now_fn=lambda: f.harness.now)
    assert code == 0
    actual_plan = fixtures.read(f.root / "output/batch/plan.json")
    assert actual_plan["acquisition_budget_seconds"] == 1020


def test_unselected_retained_provider_stop_is_global(finite_cycle):
    current = finite_cycle.current
    current.manifest["attempts"]["outside-selected-cohort"] = {
        "symbol": "UNSELECTED", "outcome": "provider_blocked", "http_status": 429}
    with pytest.raises(ValueError, match="retained provider/attempt barrier"):
        runner.validate_retained_work(finite_cycle.review, current, now=NOW)
    assert finite_cycle.harness.calls == []


@pytest.mark.parametrize('state', sorted(runner.preparation.MISSING_PRIOR_DECISION_STATES))
@pytest.mark.parametrize('mutation', ['absent_attempt', 'different_journal', 'retimed_attempt', 'journal_reason',
    'removed_failure', 'failure_cause', 'transport_hash', 'transport_status', 'invented_cooldown'])
def test_every_supported_decision_preserves_original_failed_provenance(finite_cycle, state, mutation):
    f = finite_cycle
    decision = f.review.request['missing_prior_decisions'][0]
    scope = decision['reobservation']
    failed_sha = scope['failed_acquisition_sha256']
    decision['decision_state'] = state
    if state == 'retry_decision_required':
        decision.pop('reobservation')
    elif state == 'deferred_for_this_visit':
        decision.pop('reobservation')
        decision['deferral'] = {key: scope[key] for key in ('request_id', 'expected_run_number')}
        decision['deferral']['maximum_getter_calls'] = 0
    # Every supported disposition validates the same retained failure.
    runner.validate_retained_work(f.review, f.current, now=NOW)
    if mutation == 'absent_attempt':
        f.current.manifest['attempts'].pop(decision['attempt_id'])
    elif mutation == 'different_journal':
        decision['journal_sha256'] = 'f' * 64
    elif mutation == 'retimed_attempt':
        decision['attempted_at'] = batch.timestamp(NOW)
    elif mutation == 'journal_reason':
        journal = f.current.objects[decision['journal_sha256']][0]
        next(x for x in journal['attempts'] if x['attempt_id'] == decision['attempt_id'])['failure_kind'] = 'transient_fault'
    elif mutation == 'removed_failure':
        f.current.objects.pop(failed_sha)
    elif mutation == 'failure_cause':
        f.current.objects[failed_sha][0]['failure']['may_include_swallowed_provider_error'] = False
    elif mutation == 'transport_hash':
        f.current.objects[failed_sha][0]['transport_events'][0]['transport_payload_sha256'] = 'f' * 64
    elif mutation == 'transport_status':
        f.current.objects[failed_sha][0]['transport_events'][0]['http_status'] = 429
    else:
        decision['retry_not_before'] = batch.timestamp(NOW)
    with pytest.raises(ValueError):
        runner.validate_retained_work(f.review, f.current, now=NOW)
    assert f.harness.calls == []


@pytest.mark.parametrize('state', ['finite_fixture_authorized', 'approved', 'skip', '', None])
def test_arbitrary_decision_label_cannot_bypass_prior_proof(finite_cycle, state):
    f = finite_cycle
    f.review.request['missing_prior_decisions'][0]['decision_state'] = state
    with pytest.raises(ValueError, match='Unsupported missing-prior'):
        collect_fixture(f)
    assert not (f.root/'output').exists() and f.harness.calls == []


@pytest.mark.parametrize('key,value', [('request_id', 'another-request'), ('expected_run_number', 10),
    ('maximum_getter_calls', 2), ('failed_acquisition_sha256', 'e' * 64), ('transport_payload_sha256s', ['e' * 64])])
def test_reobservation_is_one_getter_for_exact_future_request_run_and_failure(finite_cycle, key, value):
    f = finite_cycle
    f.review.request['missing_prior_decisions'][0]['reobservation'][key] = value
    with pytest.raises(ValueError):
        collect_fixture(f)
    assert not (f.root/'output').exists() and f.harness.calls == []


@pytest.mark.parametrize('stage,after_calls', [('getter', 0), ('getter', 1), ('transport', 0), ('transport', 1)])
def test_uncertain_overlap_stops_real_provider_boundary_and_retains_partial_evidence(finite_cycle, stage, after_calls):
    f = finite_cycle
    def guard(boundary):
        if boundary == stage and len(f.harness.calls) >= after_calls:
            raise ValueError('Synthetic concurrent Static Site provider job')
    result, code = collect_fixture(f, execution_guard=guard)
    assert code == 4 and len(f.harness.calls) == after_calls
    summary = fixtures.read(f.root/'output/batch/summary.json')
    assert summary['execution_stop']['budget'] == 'execution_admission'
    assert summary['execution_stop']['stage'] == stage
    assert summary['provider_stop'] is None
    assert summary['transport_calls'] == after_calls
    assert summary['counts']['captured_attributes'] == after_calls
    assert result['cycle']['retained_receipts'] == 3 + after_calls
    assert result['retention']['canonical_zip_bytes'] > 0
    assert (f.source_files/'archive/manifest.json').read_bytes() == f.original_manifest


@pytest.mark.parametrize('status', runner.overlap.ACTIVE_STATUSES)
@pytest.mark.parametrize('event', ['schedule', 'workflow_dispatch'])
def test_ordinary_static_site_active_or_pending_run_blocks_acquisition(authorization, status, event):
    _, envelope, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    other = {**deepcopy(run), 'id': run['id'] + 1, 'workflow_id': 56789,
        'path': '.github/workflows/static-site.yml', 'event': event, 'head_branch': 'main', 'status': status}
    job = {'id': 200, 'run_id': other['id'], 'run_attempt': 1, 'head_sha': other['head_sha'],
        'name': 'build-market (US)', 'status': status, 'conclusion': None}
    calls = []
    def concurrent(endpoint):
        calls.append(endpoint)
        if f"/actions/runs/{other['id']}/" in endpoint:
            return {'total_count': 1, 'jobs': [job]}
        value = deepcopy(api(endpoint))
        if f'/actions/runs?status={status}&' in endpoint:
            value['workflow_runs'].append(other)
            value['total_count'] += 1
        return value
    with pytest.raises(ValueError, match='Concurrent provider/acquisition workflow'):
        runner.authenticate_execution(envelope, context, now=NOW, job_started_at=JOB_STARTED_AT, api=concurrent)
    assert any(f"/actions/runs/{other['id']}/attempts/1/jobs?" in call for call in calls)


@pytest.mark.parametrize('mutation', ['unknown_workflow', 'wrong_event', 'foreign_repository', 'uncertain_status',
    'current_job_missing', 'current_step_wrong', 'job_head_wrong', 'workflow_disabled', 'api_error'])
def test_overlap_observation_fails_closed_on_unverified_identity_or_status(authorization, mutation):
    _, envelope, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    def uncertain(endpoint):
        value = deepcopy(api(endpoint))
        if '/actions/runs?status=in_progress&' in endpoint:
            item = value['workflow_runs'][0]
            if mutation == 'unknown_workflow': item['path'] = '.github/workflows/ci.yml'
            elif mutation == 'wrong_event': item['event'] = 'workflow_dispatch'
            elif mutation == 'foreign_repository': item['head_repository']['id'] = 123
            elif mutation == 'uncertain_status': item['status'] = 'unknown'
        if '/jobs?' in endpoint:
            if mutation == 'current_job_missing': value = {'total_count': 0, 'jobs': []}
            elif mutation == 'current_step_wrong': value['jobs'][0]['steps'][0]['name'] = 'Upload artifacts'
            elif mutation == 'job_head_wrong': value['jobs'][0]['head_sha'] = 'd' * 40
            elif mutation == 'api_error': raise TimeoutError('synthetic API timeout')
        if endpoint.endswith('/actions/workflows/12345') and mutation == 'workflow_disabled': value['state'] = 'disabled_manually'
        return value
    with pytest.raises((ValueError, TimeoutError)):
        runner.authenticate_execution(envelope, context, now=NOW, job_started_at=JOB_STARTED_AT, api=uncertain)


def test_overlap_complete_pagination_checks_all_pages_without_cancellation():
    calls = []
    def api(endpoint):
        calls.append(endpoint)
        page = int(endpoint.rsplit('page=', 1)[1])
        entries = [{'id': index} for index in range((page - 1) * 100 + 1, min(page * 100, 201) + 1)]
        return {'total_count': 201, 'jobs': entries}
    assert len(runner.overlap.complete(api, 'repos/example/actions/jobs', 'jobs')) == 201
    assert calls == [f'repos/example/actions/jobs?per_page=100&page={i}' for i in (1, 2, 3)]


@pytest.mark.parametrize('mutation', ['truncated', 'count_changed', 'duplicate', 'boolean_count', 'oversized'])
def test_overlap_pagination_rejects_incomplete_or_moving_inventory(mutation):
    def api(endpoint):
        page = int(endpoint.rsplit('page=', 1)[1])
        value = {'total_count': 101, 'jobs': [{'id': i} for i in range((page-1)*100+1, min(page*100,101)+1)]}
        if page == 2:
            if mutation == 'truncated': value['jobs'] = []
            elif mutation == 'count_changed': value['total_count'] = 102
            elif mutation == 'duplicate': value['jobs'] = [{'id': 1}]
            elif mutation == 'boolean_count': value['total_count'] = True
            else: value['total_count'] = runner.overlap.MAX_ITEMS + 1
        return value
    with pytest.raises(ValueError):
        runner.overlap.complete(api, 'repos/example/actions/jobs', 'jobs')


def test_overlap_observation_has_bounded_elapsed_time():
    run, _, _, _, api = api_fixture()
    clock = iter([0, 0, runner.overlap.MAX_OBSERVATION_SECONDS])
    with pytest.raises(ValueError, match='wall-time bound'):
        runner.overlap.observe(api, run, job_started_at=JOB_STARTED_AT, now=NOW, monotonic=lambda: next(clock))


def test_polling_reauthenticates_during_collection_and_checks_clock_between_polls(authorization, monkeypatch, tmp_path):
    review, execution, context = authorization
    observed = []
    ticks = [0.0]
    now = [NOW]
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=NOW)
    monkeypatch.setattr(runner, 'preflight', lambda *args: (review, execution, b'{}', context, authenticated, clock))
    monkeypatch.setattr(runner, 'verify_typed_source', lambda *args: {})
    monkeypatch.setattr(runner, 'authenticate_execution', lambda *args, **kwargs: observed.append(ticks[0]) or deepcopy(authenticated))
    monkeypatch.setattr(runner.time, 'monotonic', lambda: ticks[0])
    monkeypatch.setattr(runner.batch, 'utc_now', lambda: now[0])
    def collect(*args, **kwargs):
        guard = kwargs['execution_guard']
        guard('getter')
        ticks[0] = 5
        guard('transport')
        ticks[0] = 16
        guard('getter')
        assert observed == [0, 16]
        now[0] += timedelta(days=1)
        with pytest.raises(ValueError, match='finalization reserve'):
            guard('transport')
        assert observed == [0, 16]
        return {}, 0
    monkeypatch.setattr(runner, 'collect_cycle', collect)
    assert runner.run(tmp_path/'source', tmp_path/'output', job_started_at=NOW.strftime('%Y-%m-%dT%H:%M:%SZ')) == ({}, 0)


def test_overlap_check_time_is_charged_to_existing_acquisition_budget(finite_cycle, monkeypatch):
    f = finite_cycle
    ticks = [1000.0]
    monkeypatch.setattr(batch.time, 'monotonic', lambda: ticks[0])
    def guard(stage):
        ticks[0] += 1081
    result, code = collect_fixture(f, execution_guard=guard)
    assert code == 4 and f.harness.calls == f.harness.tickers == []
    summary = fixtures.read(f.root/'output/batch/summary.json')
    assert summary['execution_stop']['budget'] == 'wall_time'
    assert summary['counts']['not_attempted_attributes'] == 4
    assert result['retention']['canonical_zip_bytes'] > 0


def test_authentication_api_timeout_uses_remaining_allowance(authorization, monkeypatch):
    _, execution, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    ticks = [0.0]
    timeouts = []
    def bounded_api(endpoint, *, timeout):
        timeouts.append(timeout)
        ticks[0] += 0.25
        return api(endpoint)
    monkeypatch.setattr(runner, 'github_api', bounded_api)
    runner.authenticate_execution(execution, context, now=NOW, job_started_at=JOB_STARTED_AT, maximum_seconds=5, monotonic=lambda: ticks[0])
    assert timeouts and max(timeouts) == 5 and min(timeouts) < 5
    assert all(timeout == 5 - index * .25 for index, timeout in enumerate(timeouts))
    ticks[0] = 0
    with pytest.raises(ValueError, match='wall-time bound'):
        runner.authenticate_execution(execution, context, now=NOW, job_started_at=JOB_STARTED_AT, maximum_seconds=.25, monotonic=lambda: ticks[0])


def test_last_overlap_poll_cannot_take_finalization_reserve(authorization, monkeypatch, tmp_path):
    review, execution, context = authorization
    job_start = NOW - timedelta(seconds=1078)
    maximums = []
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=job_start)
    monkeypatch.setattr(runner.time, 'monotonic', lambda: 0.0)
    monkeypatch.setattr(runner, 'preflight', lambda *args: (review, execution, b'{}', context, authenticated, clock))
    monkeypatch.setattr(runner, 'verify_typed_source', lambda *args: {})
    monkeypatch.setattr(runner.batch, 'utc_now', lambda: NOW)
    monkeypatch.setattr(runner, 'authenticate_execution', lambda *args, **kwargs: maximums.append(kwargs['maximum_seconds']) or deepcopy(authenticated))
    def collect(*args, **kwargs):
        kwargs['check_clock'](NOW)
        kwargs['execution_guard']('getter')
        assert maximums == [2, 2]
        return {}, 0
    monkeypatch.setattr(runner, 'collect_cycle', collect)
    runner.run(tmp_path/'source', tmp_path/'output', job_started_at=job_start.strftime('%Y-%m-%dT%H:%M:%SZ'))


def execution_clock_fixture(review, execution, context, *, job_start, admitted_at=NOW, admitted_tick=0.0, platform_start=None):
    started = job_start.strftime('%Y-%m-%dT%H:%M:%SZ') if not job_start.microsecond else batch.timestamp(job_start)
    platform = batch.timestamp(job_start if platform_start is None else platform_start)
    authenticated = {'authenticated_at': batch.timestamp(admitted_at), 'job_started_at': started,
        'platform_job_started_at': platform, 'run_started_at': platform,
        'run_id': int(context['GITHUB_RUN_ID']), 'run_number': execution['expected_run_number'], 'run_attempt': 1,
        'head_sha': context['GITHUB_SHA'], 'workflow': runner.WORKFLOW, 'repository': runner.REPOSITORY,
        'branch': runner.BRANCH, 'event': 'push', 'previous_run': {'id': runner.preparation.SOURCE['source_run_id']},
        'provider_overlap': {'job_started_at': started, 'platform_job_started_at': platform, 'run_started_at': platform,
            'current_job_id': 100, 'current_step_number': 3, 'current_step_name': 'Collect one bounded next-200 visit',
            'job_clock_step_started_at': started, 'job_clock_step_completed_at': started}}
    clock = runner._ExecutionClock(execution, review, context, authenticated, job_started_at=started,
                                   admitted_at=admitted_at, admitted_tick=admitted_tick)
    return authenticated, clock


@pytest.mark.parametrize('stage', ['getter', 'transport'])
def test_genuine_1110_admission_continues_past_cutoff_but_preserves_420_second_reserve(authorization, monkeypatch, tmp_path, stage):
    review, execution, context = authorization
    admitted = batch.clock('2026-10-07T11:10:00Z')
    now, ticks, limits = [admitted], [0.0], []
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=admitted, admitted_at=admitted)
    monkeypatch.setattr(runner.time, 'monotonic', lambda: ticks[0])
    monkeypatch.setattr(runner.batch, 'utc_now', lambda: now[0])
    monkeypatch.setattr(runner, 'preflight', lambda *args: (review, execution, b'{}', context, authenticated, clock))
    monkeypatch.setattr(runner, 'verify_typed_source', lambda *args: {})
    monkeypatch.setattr(runner, 'authenticate_execution', lambda *args, **kwargs: limits.append(kwargs['maximum_seconds']) or deepcopy(authenticated))
    def collect(*args, **kwargs):
        guard = kwargs['execution_guard']
        guard(stage)
        now[0] = batch.clock(execution['dispatch_not_after']) + timedelta(milliseconds=1)
        ticks[0] = (now[0] - admitted).total_seconds()
        guard(stage)  # This is valid ongoing acquisition, not a new admission.
        now[0] = admitted + timedelta(seconds=1079, milliseconds=999)
        ticks[0] = 1079.999
        guard(stage)
        assert 0 < limits[-1] <= .001000001
        now[0] = admitted + timedelta(seconds=1080)
        ticks[0] = 1080
        with pytest.raises(ValueError, match='finalization reserve'):
            guard(stage)
        assert now[0] == batch.clock('2026-10-07T11:28:00Z')
        assert now[0] + timedelta(seconds=420) == admitted + timedelta(seconds=1500)
        return {}, 0
    monkeypatch.setattr(runner, 'collect_cycle', collect)
    runner.run(tmp_path/'source', tmp_path/'output', job_started_at=admitted.strftime('%Y-%m-%dT%H:%M:%SZ'))


@pytest.mark.parametrize('offset,reason', [(0, 'retry decisions are required'), (1, 'finite dispatch window')])
def test_first_real_preflight_cannot_backdate_admission_with_an_older_job_clock(authorization, monkeypatch, offset, reason):
    review, execution, context = authorization
    now = batch.clock(execution['dispatch_not_after']) + timedelta(milliseconds=offset)
    monkeypatch.setattr(runner.batch, 'utc_now', lambda: now)
    monkeypatch.setattr(runner.preparation, 'load_review', lambda **kwargs: review)
    monkeypatch.setattr(runner.preparation, 'read_pinned', lambda *args: (execution, b'finite-local-envelope'))
    monkeypatch.setattr(runner, 'authenticate_execution', forbidden)
    monkeypatch.setattr(runner.subprocess, 'check_output', forbidden)
    for name, value in context.items(): monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=reason):
        runner.preflight('2026-10-07T11:10:00Z')
    import inspect
    assert list(inspect.signature(runner.preflight).parameters) == ['job_started_at']


@pytest.mark.parametrize('mutation', ['future_start', 'retimed_start', 'retimed_admission', 'changed_head', 'changed_source'])
def test_active_clock_rejects_future_or_changed_start_and_identity(authorization, monkeypatch, mutation):
    review, execution, context = authorization
    monkeypatch.setattr(runner.time, 'monotonic', lambda: 0.0)
    if mutation == 'future_start':
        with pytest.raises(ValueError, match='future'):
            execution_clock_fixture(review, execution, context, job_start=NOW + timedelta(seconds=1))
        return
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=NOW)
    if mutation == 'retimed_start': authenticated['job_started_at'] = batch.timestamp(NOW + timedelta(seconds=1))
    elif mutation == 'retimed_admission': authenticated['authenticated_at'] = batch.timestamp(NOW - timedelta(seconds=1))
    elif mutation == 'changed_head': context['GITHUB_SHA'] = 'd' * 40
    else: execution['input_source'] = {**execution['input_source'], 'source_run_id': 123}
    with pytest.raises(ValueError, match='Immutable admitted'):
        clock.remaining(NOW)


@pytest.mark.parametrize('which', ['wall_backward', 'monotonic_backward', 'monotonic_deadline'])
def test_actual_wall_and_monotonic_clocks_cannot_extend_the_visit(authorization, monkeypatch, which):
    review, execution, context = authorization
    ticks = [100.0]
    monkeypatch.setattr(runner.time, 'monotonic', lambda: ticks[0])
    _, clock = execution_clock_fixture(review, execution, context, job_start=NOW, admitted_tick=100)
    ticks[0] = 101
    clock.remaining(NOW + timedelta(seconds=1))
    if which == 'wall_backward':
        now, ticks[0] = NOW, 102
    elif which == 'monotonic_backward':
        now, ticks[0] = NOW + timedelta(seconds=2), 100.999
    else:
        # A stalled/slower wall clock never extends the monotonic allowance.
        now, ticks[0] = NOW + timedelta(seconds=2), 1180
    with pytest.raises(ValueError, match='clock moved backward|finalization reserve'):
        clock.remaining(now)


@pytest.mark.parametrize('started,valid', [
    ('2026-10-07T02:59:00Z', True),
    ('2026-10-07T02:59:01Z', True),
    ('2026-10-07T02:59:01.999Z', False),
    ('2026-10-07T02:59:02.000Z', False),
    ('2026-10-07T02:58:59.999Z', False),
    ('2026-10-07T03:00:00.001Z', False),
])
def test_job_clock_binds_original_step_with_only_api_precision_interval(authorization, started, valid):
    _, execution, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    if valid:
        proof = runner.authenticate_execution(execution, context, now=NOW, job_started_at=started, api=api)
        assert proof['job_started_at'] == proof['provider_overlap']['job_started_at'] == started
        assert runner.original.bounded_acquisition_budget(started, now=NOW) == 1080 - (NOW - batch.clock(started)).total_seconds()
    else:
        with pytest.raises(ValueError, match='Job-start clock'):
            runner.authenticate_execution(execution, context, now=NOW, job_started_at=started, api=api)


def test_fractional_step_completion_has_no_extra_second_tolerance(authorization):
    _, execution, context = authorization
    run, prior, inventory, ref, api = api_fixture()
    def fractional(endpoint):
        value = deepcopy(api(endpoint))
        if '/jobs?' in endpoint: value['jobs'][0]['steps'][1]['completed_at'] = '2026-10-07T02:59:01.100Z'
        return value
    runner.authenticate_execution(execution, context, now=NOW, job_started_at='2026-10-07T02:59:01Z', api=fractional)
    with pytest.raises(ValueError, match='Job-start clock'):
        runner.authenticate_execution(execution, context, now=NOW, job_started_at='2026-10-07T02:59:02Z', api=fractional)


def test_actual_retained_github_setup_clock_checkout_shape_is_supported():
    # Exact first three step records from run 37478731832/job 112320966070,
    # first-refresh-run-37478731832/ci-37495003542/artifact/postcapture-reports/companion/api-evidence.json.
    # This is an offline shape fixture; the surrounding current run is synthetic.
    prefix = [
        {'name': 'Set up job', 'status': 'completed', 'conclusion': 'success', 'number': 1,
         'started_at': '2026-10-06T14:24:49Z', 'completed_at': '2026-10-06T14:24:50Z'},
        {'name': 'Start the bounded job clock', 'status': 'completed', 'conclusion': 'success', 'number': 2,
         'started_at': '2026-10-06T14:24:50Z', 'completed_at': '2026-10-06T14:24:50Z'},
        {'name': 'Run actions/checkout@v4', 'status': 'completed', 'conclusion': 'success', 'number': 3,
         'started_at': '2026-10-06T14:24:50Z', 'completed_at': '2026-10-06T14:24:53Z'},
    ]
    run, _, _, _, api = api_fixture()
    run['run_started_at'] = '2026-10-06T14:24:48Z'
    def actual_shape(endpoint):
        value = deepcopy(api(endpoint))
        if '/jobs?' in endpoint:
            value['jobs'][0].update(started_at=run['run_started_at'], steps=prefix + [
                {'name': 'Collect one bounded next-200 visit', 'status': 'in_progress', 'conclusion': None, 'number': 4}])
        return value
    result = runner.overlap.observe(actual_shape, run, job_started_at='2026-10-06T14:24:50Z',
                                    now=batch.clock('2026-10-06T14:25:55Z'))
    assert result['current_step_number'] == 4 and result['job_started_at'] == '2026-10-06T14:24:50Z'


@pytest.mark.parametrize('mutation', ['absent_setup', 'failed_setup', 'unreviewed_work', 'out_of_order', 'future_setup', 'clock_incomplete'])
def test_original_clock_allows_only_successful_platform_setup_before_it(authorization, mutation):
    _, execution, context = authorization
    run, _, _, _, api = api_fixture()
    def changed(endpoint):
        value = deepcopy(api(endpoint))
        if '/jobs?' in endpoint:
            steps = value['jobs'][0]['steps']
            if mutation == 'absent_setup': steps.pop(0)
            elif mutation == 'failed_setup': steps[0]['conclusion'] = 'failure'
            elif mutation == 'unreviewed_work': steps[0]['name'] = 'Fetch provider before clock'
            elif mutation == 'out_of_order': steps[0], steps[1] = steps[1], steps[0]
            elif mutation == 'future_setup': steps[0]['completed_at'] = '2026-10-07T03:00:01Z'
            else: steps[1].update(status='queued', conclusion=None)
        return value
    with pytest.raises(ValueError):
        runner.authenticate_execution(execution, context, now=NOW, job_started_at=JOB_STARTED_AT, api=changed)


def test_whole_second_producer_is_conservative_against_fractional_step_start(authorization):
    _, execution, context = authorization
    run, _, _, _, api = api_fixture()
    def fractional_start(endpoint):
        value = deepcopy(api(endpoint))
        if '/jobs?' in endpoint: value['jobs'][0]['steps'][1]['started_at'] = '2026-10-07T02:59:00.999Z'
        return value
    proof = runner.authenticate_execution(execution, context, now=NOW, job_started_at=JOB_STARTED_AT, api=fractional_start)
    assert proof['job_started_at'] == JOB_STARTED_AT
    assert runner.original.bounded_acquisition_budget(proof['job_started_at'], now=NOW) == 1020
    with pytest.raises(ValueError, match='Job-start clock'):
        runner.authenticate_execution(execution, context, now=NOW, job_started_at='2026-10-07T02:58:59Z', api=fractional_start)


@pytest.mark.parametrize('setup_seconds', [0, 2, 60, 300])
def test_platform_setup_gap_is_charged_without_retiming_original_job_token(authorization, monkeypatch, setup_seconds):
    review, execution, context = authorization
    admitted = batch.clock('2026-10-07T11:10:00Z')
    platform = admitted - timedelta(seconds=setup_seconds)
    ticks = [1000.0]
    monkeypatch.setattr(runner.time, 'monotonic', lambda: ticks[0])
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=admitted, admitted_at=admitted,
        admitted_tick=1000, platform_start=platform)
    assert authenticated['job_started_at'] == '2026-10-07T11:10:00Z'
    assert clock.remaining(admitted) == 1080 - setup_seconds
    assert clock.acquisition_deadline == 2080 - setup_seconds
    end = platform + timedelta(seconds=1080)
    ticks[0] = clock.acquisition_deadline - .001
    assert 0 < clock.remaining(end - timedelta(milliseconds=1)) <= .001000001
    ticks[0] = clock.acquisition_deadline
    with pytest.raises(ValueError, match='finalization reserve'):
        clock.remaining(end)
    assert end + timedelta(seconds=420) == platform + timedelta(seconds=1500)
    if setup_seconds == 2:
        assert end == batch.clock('2026-10-07T11:27:58Z')
        assert platform + timedelta(seconds=1500) == batch.clock('2026-10-07T11:34:58Z')


@pytest.mark.parametrize('mutation', ['missing', 'future', 'before_run', 'after_clock', 'changed_after_admission'])
def test_platform_start_must_be_genuine_consistent_and_immutable(authorization, monkeypatch, mutation):
    review, execution, context = authorization
    monkeypatch.setattr(runner.time, 'monotonic', lambda: 0.0)
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=NOW)
    if mutation == 'changed_after_admission':
        authenticated['platform_job_started_at'] = batch.timestamp(NOW - timedelta(seconds=2))
        with pytest.raises(ValueError, match='Immutable admitted'):
            clock.remaining(NOW)
        return
    if mutation == 'missing': authenticated.pop('platform_job_started_at')
    elif mutation == 'future':
        authenticated['platform_job_started_at'] = authenticated['provider_overlap']['platform_job_started_at'] = batch.timestamp(NOW + timedelta(seconds=1))
    elif mutation == 'before_run':
        authenticated['platform_job_started_at'] = authenticated['provider_overlap']['platform_job_started_at'] = batch.timestamp(NOW - timedelta(seconds=1))
    else:
        authenticated['platform_job_started_at'] = authenticated['provider_overlap']['platform_job_started_at'] = batch.timestamp(NOW + timedelta(seconds=2))
        authenticated['authenticated_at'] = batch.timestamp(NOW + timedelta(seconds=3))
    with pytest.raises(ValueError):
        runner._ExecutionClock(execution, review, context, authenticated, job_started_at=NOW.strftime('%Y-%m-%dT%H:%M:%SZ'),
            admitted_at=NOW + timedelta(seconds=3) if mutation == 'after_clock' else NOW, admitted_tick=0)


@pytest.mark.parametrize('guard_deadline,request_tick,stop_tick,timeout', [(2078.0, 2076.0, 2078.0, 2.0), (9999.0, 2079.0, 2080.0, 1.0)])
def test_guard_deadline_can_shorten_but_never_extend_real_http_timeout(finite_cycle, monkeypatch, guard_deadline, request_tick, stop_tick, timeout):
    f = finite_cycle
    f.harness.timeouts.clear()
    ticks = [1000.0]
    monkeypatch.setattr(batch.time, 'monotonic', lambda: ticks[0])
    def guard(stage):
        if ticks[0] == 1000: ticks[0] = request_tick
        return guard_deadline
    def reply(symbol, attribute):
        ticks[0] = stop_tick
        return 200, fixtures.body(symbol, attribute)
    f.harness.reply = reply
    result, code = collect_fixture(f, execution_guard=guard)
    assert code == 4 and len(f.harness.calls) == 1
    assert f.harness.timeouts == [timeout]
    assert result['retention']['canonical_zip_bytes'] > 0
    summary = fixtures.read(f.root/'output/batch/summary.json')
    assert summary['execution_stop']['budget'] == 'wall_time'
    assert (f.source_files/'archive/manifest.json').read_bytes() == f.original_manifest


@pytest.mark.parametrize('platform', [None, '2026-10-07T03:00:01Z', '2026-10-07T02:58:59Z'])
def test_live_api_platform_start_cannot_be_missing_future_or_before_the_run(authorization, platform):
    _, execution, context = authorization
    run, _, _, _, api = api_fixture()
    def changed(endpoint):
        value = deepcopy(api(endpoint))
        if '/jobs?' in endpoint: value['jobs'][0]['started_at'] = platform
        return value
    with pytest.raises(ValueError):
        runner.authenticate_execution(execution, context, now=NOW, job_started_at=JOB_STARTED_AT, api=changed)


@pytest.mark.parametrize('field,value', [('current_job_id', 999), ('current_step_number', 4),
    ('current_step_name', 'Require exact one-shot next-200 admission'),
    ('platform_job_started_at', '2026-10-07T02:59:00Z')])
def test_reauthentication_cannot_replace_the_admitted_job_step_or_clock(authorization, monkeypatch, field, value):
    review, execution, context = authorization
    authenticated, clock = execution_clock_fixture(review, execution, context, job_start=NOW)
    fresh = deepcopy(authenticated)
    fresh['authenticated_at'] = batch.timestamp(NOW + timedelta(seconds=20))
    fresh['recovery_inventory_count'] = 42
    clock.confirm_authentication(fresh)  # New observation clocks and inventory are permitted.
    fresh['provider_overlap'][field] = value
    with pytest.raises(ValueError, match='job, step or clock identity'):
        clock.confirm_authentication(fresh)
