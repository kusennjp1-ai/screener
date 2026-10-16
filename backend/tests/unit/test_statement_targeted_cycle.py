"""Offline execution boundary tests; injected collectors and forbidden sockets."""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services import statement_retention_budget as retention
from tests.unit import test_financial_statement_batch as fixtures

SPEC = importlib.util.spec_from_file_location("targeted_cycle", Path(__file__).resolve().parents[3] / ".github/scripts/run-statement-targeted-cycle.py")
cycle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cycle)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    return batch.write_json(path, value)


@pytest.fixture
def case(monkeypatch):
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    h = fixtures.TestFinancialStatementBatch(methodName="runTest")
    h.setUp()
    try:
        # A full 1,894-member original cohort. The two targets are outside the
        # unchanged default 200 prefix, and an unrelated successful AMD stays.
        symbols = tuple(f"X{i:04d}" for i in range(1891)) + ("NVDA", "AAOI", "AMD")
        plan, base = fixtures.plan_for(symbols)
        plan["selected"] = [item for item in plan["selected"] if item["symbol"] in ("NVDA", "AAOI", "AMD")]
        plan["batch_allowlist"] = [item["symbol"] for item in plan["selected"]]
        h.plan, h.base = plan, base
        summary, code = h.run_batch()
        assert code == 0
        restored, inputs = h.root / "restored", h.root / "inputs"
        files = restored / "files"
        files.mkdir(parents=True)
        inputs.mkdir()
        (files / "base.json").write_bytes(base)
        cohort_sha = write(files / "cohort.json", plan["verified_us_cohort"])
        sha = archive.create_archive(files / "archive", base_bytes=base, cohort=plan["verified_us_cohort"], now=h.now)
        sha = archive.merge_batch(files / "archive", sha, batch_dir=h.output,
            summary_sha256=batch.digest_bytes((h.output / "summary.json").read_bytes()),
            base_bytes=base, cohort=plan["verified_us_cohort"], now=h.now)
        old = archive.load_archive(files / "archive", sha, base_bytes=base, cohort=plan["verified_us_cohort"], now=h.now)
        # Match Actions' missing hidden archive lock. This must be staged before
        # the frozen guard inventory, never forgiven after finalization.
        (files / "archive/.archive.lock").unlink()
        write(files / "cycle.json", {"schema_version": "financial-recovery-cycle-v1", "phase": "completed",
            "dry_run": False, "published": False, "archive_manifest_sha256": sha})
        h.now += timedelta(days=12)
        current_base = json.loads(base)
        current_base["as_of_date"] = "2026-10-15"
        base_sha = write(inputs / "base.json", current_base)
        current_cohort = {"symbols": list(symbols), "base_artifact_sha256": base_sha}
        current_cohort_sha = write(inputs / "cohort.json", current_cohort)
        source = {"run_id": 41, "run_attempt": 1, "head_sha": "1" * 40, "artifact_id": 42,
            "artifact_sha256": "2" * 64, "archive_manifest_sha256": sha,
            "base_sha256": batch.digest_bytes(base), "cohort_sha256": cohort_sha}
        price = {"run_id": 51, "run_attempt": 1, "head_sha": "3" * 40, "artifact_id": 52,
            "artifact_sha256": "4" * 64, "companion_id": 53, "companion_sha256": "5" * 64,
            "manifest_sha256": "6" * 64, "research_sha256": "7" * 64}
        request = {"schema_version": cycle.REQUEST_SCHEMA, "operation_id": "targeted-nvda-aaoi-offline-test",
            "created_at": batch.timestamp(h.now - timedelta(minutes=1)), "expires_at": batch.timestamp(h.now + timedelta(hours=1)),
            "controller": {"parent_sha": "8" * 40, "parent_tree": "9" * 40}, "expected_run_number": 5,
            "source": source, "price_source": price, "limits": dict(cycle.LIMITS), "selection": [],
            "publication_authority": "none", "financial_admission": False}
        for symbol in ("NVDA", "AAOI"):
            receipts = []
            for attribute in batch.ATTRIBUTES:
                receipt_sha = old.manifest["current"][f"{symbol}/{attribute}"]
                event, _ = cycle.receipt_bound_attempt(old, symbol=symbol, attribute=attribute, receipt_sha=receipt_sha, now=h.now)
                receipts.append({"attribute": attribute, "receipt_sha256": receipt_sha, "attempt_id": event["attempt_id"],
                                 "attempt_object_sha256": event["source_object_sha256"]})
            request["selection"].append({"symbol": symbol, "targets": list(cycle.TARGETS), "receipts": receipts})
        request_path = h.root / "durable/request.json"
        request_sha = write(request_path, request)
        (inputs / "request.json").write_bytes(request_path.read_bytes())
        invocation = {"schema_version": cycle.INVOCATION_SCHEMA, "request_sha256": request_sha,
            "authenticated_at": batch.timestamp(h.now), "repository": cycle.REPOSITORY, "workflow": cycle.WORKFLOW,
            "event": "push", "branch": cycle.BRANCH, "run_id": 61, "run_attempt": 1, "run_number": 5,
            "head_sha": "a" * 40, "controller_parent_sha": "8" * 40, "controller_parent_tree": "9" * 40,
            "source": source, "price_source": price, "base_sha256": base_sha, "cohort_sha256": current_cohort_sha,
            "publication_authority": "none", "financial_admission": False}
        write(inputs / "invocation.json", invocation)
        write(restored / "restored.json", {"schema_version": "financial-source-restore-v1", "kind": "recovery_archive",
            "repository": cycle.REPOSITORY, **{key: source[key] for key in ("run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256")}})
        for key, value in {"GITHUB_REPOSITORY": cycle.REPOSITORY, "GITHUB_EVENT_NAME": "push", "GITHUB_REF_NAME": cycle.BRANCH,
            "GITHUB_RUN_ID": "61", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_RUN_NUMBER": "5", "GITHUB_SHA": "a" * 40}.items():
            monkeypatch.setenv(key, value)
        h.calls.clear()
        h.tickers.clear()
        fixtures.YfData().cache_get.cache_clear()
        c = SimpleNamespace(h=h, inputs=inputs, restored=restored, files=files, request=request, request_path=request_path,
            invocation=invocation, output=h.root / "result", source=old, now=h.now, job_started_at=batch.timestamp(h.now - timedelta(seconds=60)))
        def run(collector=None, now_fn=None, authenticator=None):
            return cycle.run(c.inputs, c.restored, c.output, request_path=c.request_path, job_started_at=c.job_started_at,
                collector=collector or batch.collect, now_fn=now_fn or (lambda: c.h.now),
                authenticator=authenticator or (lambda: {**c.invocation, "authenticated_at": batch.timestamp(c.h.now)}))
        c.run = run
        yield c
    finally:
        h.doCleanups()


def update_request(case):
    digest = write(case.request_path, case.request)
    (case.inputs / "request.json").write_bytes(case.request_path.read_bytes())
    case.invocation["request_sha256"] = digest
    write(case.inputs / "invocation.json", case.invocation)


def test_full_cycle_uses_only_four_getters_and_retains_complete_source(case, capsys):
    seen = []
    def injected(plan, base, output, **kwargs):
        seen.append((plan, kwargs))
        return batch.collect(plan, base, output, **kwargs)
    assert case.run(collector=injected) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["full_cohort_count"] == 1894
    assert result["selected_symbol_names"] == ["AAOI", "NVDA"]
    assert result["published"] is False and result["financial_admission"] is False
    assert result["retention"]["actual_actions_artifact_readback_required"] is True
    assert len(case.h.calls) == 4 and case.h.tickers == ["AAOI", "NVDA"]
    plan, args = seen[0]
    assert len(plan["verified_us_cohort"]["symbols"]) == 1894
    assert [item["symbol"] for item in plan["selected"]] == ["AAOI", "NVDA"]
    assert args["acquisition_budget_seconds"] == 1020
    assert args["max_statement_getter_calls"] == 4 and args["max_transport_requests"] == 1000
    assert args["dry_run"] is False
    for name in ("base.json", "cohort.json", "cycle.json"):
        assert (case.output / "original-input" / name).read_bytes() == (case.files / name).read_bytes()
    for name in ("base.json", "cohort.json"):
        assert (case.output / name).read_bytes() == (case.inputs / name).read_bytes()
    final = archive.load_archive(case.output / "archive", result["archive_manifest_sha256"],
        base_bytes=(case.output / "base.json").read_bytes(), cohort=fixtures.read(case.output / "cohort.json"), now=case.h.now)
    assert len(final.manifest["receipts"]) == 10
    for sha, (_, content) in case.source.objects.items():
        assert final.objects[sha][1] == content
    assert final.manifest["current"]["AMD/income_stmt"] == case.source.manifest["current"]["AMD/income_stmt"]
    assert final.manifest["binding"]["base_artifact_sha256"] == case.invocation["base_sha256"]
    assert fixtures.read(case.output / "batch/plan.json")["caller_retries"] == 0
    # Restored input stays immutable; only the new output owns a lock.
    assert not (case.files / "archive/.archive.lock").exists()
    assert (case.output / "archive/.archive.lock").read_bytes() == b""


@pytest.mark.parametrize("mutation", [
    lambda r: r.update(schema_version="financial-targeted-recovery-preflight-request-v1"),
    lambda r: r.update(expires_at=r["created_at"]),
    lambda r: r.update(provider_execution=True),
    lambda r: r.update(operation_id="generic-operation"),
    lambda r: r.update(expected_run_number=2**53),
    lambda r: r.update(created_at="2026-10-16T11:59:00+00:00"),
    lambda r: r["selection"].reverse(),
    lambda r: r["selection"][0]["receipts"][0].update(attempt_id="x" * 101),
    lambda r: r.update(retry_decisions={}),
    lambda r: r.update(financial_admission=True),
    lambda r: r.update(publication_authority="publish"),
    lambda r: r["limits"].update(max_statement_getter_calls=5),
    lambda r: r["limits"].update(max_transport_requests=1001),
    lambda r: r["limits"].update(caller_retries=1),
    lambda r: r["limits"].update(max_symbols=True),
    lambda r: r["selection"][0].update(symbol="FUTU"),
    lambda r: r["selection"][0]["receipts"][0].update(receipt_sha256="f" * 64),
    lambda r: r["selection"][0]["receipts"][0].update(attempt_id="different"),
    lambda r: r["selection"][0]["receipts"][0].update(attempt_object_sha256="f" * 64),
])
def test_invalid_authority_or_receipt_is_rejected_before_collector(case, mutation):
    mutation(case.request)
    update_request(case)
    def forbidden(*args, **kwargs):
        pytest.fail("Collector must not be invoked")
    with pytest.raises(ValueError):
        case.run(collector=forbidden)
    assert case.h.calls == case.h.tickers == []
    assert not case.output.exists()


@pytest.mark.parametrize("mutation", [
    lambda i: i.update(run_attempt=2), lambda i: i.update(run_number=6), lambda i: i.update(head_sha="f" * 40),
    lambda i: i.update(source={**i["source"], "run_attempt": True}),
    lambda i: i.update(event="workflow_dispatch"), lambda i: i.update(request_sha256="f" * 64),
    lambda i: i.update(controller_parent_tree="f" * 40), lambda i: i.update(financial_admission=0),
    lambda i: i.update(authenticated_at="2026-10-16T11:57:59.000Z"),
    lambda i: i.update(authenticated_at="2026-10-16T12:00:01.000Z"),
])
def test_invocation_cannot_be_stale_replayed_or_detached_from_actual_run(case, mutation):
    mutation(case.invocation)
    write(case.inputs / "invocation.json", case.invocation)
    with pytest.raises(ValueError):
        case.run(collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.h.calls == case.h.tickers == []
    assert not case.output.exists()


@pytest.mark.parametrize("filename", ["base.json", "cohort.json", "request.json"])
def test_changed_input_bytes_fail_closed(case, filename):
    with (case.inputs / filename).open("ab") as stream:
        stream.write(b" ")
    with pytest.raises(ValueError):
        case.run(collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert not case.output.exists()


def test_current_cohort_cannot_drop_or_reorder_any_original_name(case):
    current = fixtures.read(case.inputs / "cohort.json")
    current["symbols"] = current["symbols"][1:]
    case.invocation["cohort_sha256"] = write(case.inputs / "cohort.json", current)
    write(case.inputs / "invocation.json", case.invocation)
    with pytest.raises(ValueError, match="complete original cohort"):
        case.run()
    assert case.h.calls == []


@pytest.mark.parametrize("elapsed", [1080, 1501, -1])
def test_job_clock_never_uses_the_420_second_finalization_reserve(case, elapsed):
    case.job_started_at = batch.timestamp(case.now - timedelta(seconds=elapsed))
    with pytest.raises(ValueError):
        case.run(collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert not case.output.exists()


def test_expiry_must_cover_the_full_remaining_acquisition_allowance(case):
    case.request["expires_at"] = batch.timestamp(case.now + timedelta(seconds=1000))
    update_request(case)
    with pytest.raises(ValueError, match="cover the bounded acquisition"):
        case.run(collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.h.calls == []
    assert fixtures.read(case.output / "cycle.json")["phase"] == "prepared"


def test_slow_preparation_uses_real_fresh_recheck_without_rewriting_initial_invocation(case):
    initial = (case.inputs / "invocation.json").read_bytes()
    calls = []
    def authenticate():
        # The parent is called only after full-source/cache/lock preparation.
        assert (case.output / "selected-cache/cache-manifest.json").exists()
        assert (case.output / "archive/.archive.lock").exists()
        assert not (case.output / "provider-invocation.json").exists()
        case.h.now += timedelta(seconds=130)
        calls.append(case.h.now)
        return {**case.invocation, "authenticated_at": batch.timestamp(case.h.now)}
    assert case.run(authenticator=authenticate) == 0
    assert len(calls) == 1
    assert (case.inputs / "invocation.json").read_bytes() == initial
    assert (case.output / "invocation.json").read_bytes() == initial
    assert fixtures.read(case.output / "provider-invocation.json")["authenticated_at"] == batch.timestamp(calls[0])
    assert fixtures.read(case.output / "batch/plan.json")["acquisition_budget_seconds"] == 890


@pytest.mark.parametrize("mutation", ["request", "base", "archive", "receipt", "unowned", "expired", "initial_invocation", "provider_invocation"])
def test_every_getter_rechecks_current_inputs_and_retained_bytes(case, mutation):
    reached = []
    def injected(plan, base, output, **kwargs):
        reached.append(True)
        if mutation == "expired":
            case.h.now += timedelta(hours=2)
        else:
            paths = {"request": case.request_path, "base": case.inputs / "base.json",
                     "archive": case.output / "archive/manifest.json",
                     "receipt": case.output / "archive/objects" / (next(iter(case.source.manifest["receipts"])) + ".json"),
                     "unowned": case.output / "unowned.json",
                     "initial_invocation": case.inputs / "invocation.json",
                     "provider_invocation": case.output / "provider-invocation.json"}
            with paths[mutation].open("ab") as stream:
                stream.write(b" ")
        kwargs["retention_guard"].check("getter")
        pytest.fail("Mutation must reject before getter")
    with pytest.raises(ValueError):
        case.run(collector=injected)
    assert reached == [True]
    assert case.h.calls == []


@pytest.mark.parametrize("status", [403, 429])
def test_provider_stop_is_retained_without_retry_or_second_symbol(case, status):
    case.h.reply = lambda *args: (status, {"error": "mock blocked"})
    assert case.run() == 2
    assert len(case.h.calls) == 1
    summary = fixtures.read(case.output / "batch/summary.json")
    assert summary["provider_stop"]["http_status"] == status
    assert summary["statement_getter_calls"] == 1
    assert set(summary["results"]) == {"NVDA", "AAOI"}
    completed = fixtures.read(case.output / "cycle.json")
    assert completed["phase"] == "completed" and completed["exit_code"] == 2
    assert completed["retained_receipts"] == 6


def test_existing_guard_reproduces_old_late_archive_lock_failure(case):
    # Freeze before the writer-owned lock exists, as the previous caller did.
    root = case.files
    guard = retention.StatementRetentionBudget(root, selected_symbols=2)
    guard.check("initial")
    guard.before_merge()
    cycle.prepare_archive_lock(root / "archive")
    guard.authorize_finalization(archive_manifest_sha256=case.source.sha256,
        cycle_sha256=batch.digest_bytes((root / "cycle.json").read_bytes()), archive_object_sha256s=case.source.manifest["objects"])
    with pytest.raises(retention.RetentionIntegrityError, match="Unowned retained source addition"):
        guard.verify_final()


@pytest.mark.parametrize("kind", ["content", "symlink", "hardlink"])
def test_lock_preparation_never_trusts_an_unexpected_file(case, kind):
    path = case.files / "archive/.archive.lock"
    if kind == "content":
        path.write_bytes(b"unexpected")
    elif kind == "symlink":
        path.symlink_to(case.files / "base.json")
    else:
        import os
        os.link(case.files / "base.json", path)
    with pytest.raises(ValueError):
        cycle.prepare_archive_lock(path.parent)


def test_execution_cannot_change_the_reviewed_three_target_scope(case):
    for entry in case.request["selection"]:
        entry["targets"] = ["eps", "sales"]
        entry["receipts"] = entry["receipts"][:1]
    update_request(case)
    with pytest.raises(ValueError, match="canonical financial targets"):
        case.run(collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.h.calls == []
    assert not case.output.exists()


@pytest.mark.parametrize("kind", ["provider_stopped", "invalid_receipt", "retry_decision_required", "not_due"])
def test_caller_does_not_override_full_planner_holds(case, monkeypatch, kind):
    from dataclasses import replace
    original = archive.plan_archive
    def planned(*args, **kwargs):
        current, exported, projections = original(*args, **kwargs)
        if kind == "provider_stopped":
            current = replace(current, provider_state="stopped")
        elif kind == "invalid_receipt":
            current = replace(current, invalid_receipts=("AMD:annual_history",))
        else:
            work = []
            for item in current.required_work:
                if item.symbol == "NVDA":
                    item = replace(item, requirements=tuple(replace(r, state="retry_decision_required")
                        if kind == "retry_decision_required" else replace(r, due_since=case.now + timedelta(seconds=1))
                        for r in item.requirements))
                work.append(item)
            current = replace(current, required_work=tuple(work))
        return current, exported, projections
    monkeypatch.setattr(archive, "plan_archive", planned)
    with pytest.raises(ValueError):
        case.run(collector=lambda *a, **k: pytest.fail("No collector is authorized"))
    assert not case.output.exists()
    assert case.h.calls == []


def test_request_mutation_after_first_getter_keeps_actual_attempt_and_stops(case):
    acquire = fixtures.capture.acquire_yahoo_value
    def first_then_mutate(*args, **kwargs):
        value = acquire(*args, **kwargs)
        with case.request_path.open("ab") as stream:
            stream.write(b" ")
        return value
    case.h.patch(fixtures.capture, "acquire_yahoo_value", first_then_mutate)
    with pytest.raises(ValueError, match="digest changed"):
        case.run()
    assert len(case.h.calls) == 1
    journal = fixtures.read(case.output / "batch/attempts.json")
    assert len(journal["attempts"]) == 1
    assert journal["attempts"][0]["outcome"] == "succeeded"
    assert fixtures.read(case.output / "cycle.json")["phase"] == "prepared"
    assert (case.output / "batch" / journal["attempts"][0]["acquisition_file"]).exists()


@pytest.mark.parametrize("field,value", [
    ("base_sha256", "f" * 64), ("cohort_sha256", "f" * 64),
    ("request_sha256", "f" * 64), ("head_sha", "f" * 40),
    ("run_id", 62), ("run_attempt", 2), ("controller_parent_tree", "f" * 40),
    ("publication_authority", "publish"), ("financial_admission", True),
])
def test_reauthentication_cannot_change_any_prepared_binding(case, field, value):
    response = deepcopy(case.invocation)
    response[field] = value
    with pytest.raises(ValueError):
        case.run(authenticator=lambda: response, collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.h.calls == []
    assert not (case.output / "provider-invocation.json").exists()


def test_reauthentication_rejects_stale_response_before_collection(case):
    def authenticate():
        case.h.now += timedelta(seconds=121)
        return deepcopy(case.invocation)
    with pytest.raises(ValueError, match="stale"):
        case.run(authenticator=authenticate, collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.h.calls == []
    assert not (case.output / "provider-invocation.json").exists()


def test_actual_guard_time_still_counts_against_fresh_provider_authentication(case):
    calls = []
    def now():
        calls.append(True)
        return case.now + timedelta(seconds=121 if len(calls) > 3 else 0)
    with pytest.raises(ValueError, match="stale"):
        case.run(now_fn=now, collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.h.calls == []
    assert (case.output / "provider-invocation.json").exists()


def test_reauthentication_does_not_extend_expired_original_request(case):
    request_bytes = case.request_path.read_bytes()
    def authenticate():
        case.h.now += timedelta(hours=1)
        return {**case.invocation, "authenticated_at": batch.timestamp(case.h.now)}
    with pytest.raises(ValueError, match="current and finite"):
        case.run(authenticator=authenticate, collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert case.request_path.read_bytes() == request_bytes
    assert case.h.calls == []
    assert not (case.output / "provider-invocation.json").exists()


def test_default_authenticator_uses_only_fixed_parent_marker(monkeypatch):
    import io
    writes = []
    def write_marker(fd, data):
        writes.append((fd, data))
        return len(data)
    monkeypatch.setattr(cycle.os, "write", write_marker)
    monkeypatch.setattr(cycle.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(b'{"fixture":"invocation"}\n')))
    assert cycle.authenticate_provider() == {"fixture": "invocation"}
    assert writes == [(3, b"recheck\n")]


@pytest.mark.parametrize("response", [b"", b"{}", b"[]\n", b'{"a":1,"a":2}\n', b"x" * 32768 + b"\n"])
def test_default_authenticator_rejects_absent_ambiguous_or_unbounded_response(monkeypatch, response):
    import io
    monkeypatch.setattr(cycle.os, "write", lambda fd, data: len(data))
    monkeypatch.setattr(cycle.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(response)))
    with pytest.raises(ValueError):
        cycle.authenticate_provider()


def test_direct_cli_without_parent_authentication_pipe_fails_closed(monkeypatch):
    def unavailable(*args):
        raise OSError("No controller authentication pipe")
    monkeypatch.setattr(cycle.os, "write", unavailable)
    with pytest.raises(OSError, match="authentication pipe"):
        cycle.authenticate_provider()


@pytest.mark.parametrize("key", ["GH_TOKEN", "GITHUB_TOKEN"])
def test_provider_process_rejects_accidentally_inherited_authentication_token(case, monkeypatch, key):
    monkeypatch.setenv(key, "dummy-test-value")
    with pytest.raises(ValueError, match="must not inherit authentication credentials"):
        case.run(collector=lambda *a, **k: pytest.fail("Unexpected collector"))
    assert not case.output.exists()
    assert case.h.calls == []
