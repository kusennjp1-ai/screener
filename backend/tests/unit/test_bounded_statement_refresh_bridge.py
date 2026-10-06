"""Offline regressions for the single pinned EDF visit and legacy recovery.

The repository carries the review bytes, not its retained private archive.
Real source ZIP/receipt replay is a separate local integration check. Provider
construction and all socket/curl transport are blocked in the tests below.
"""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
import shutil
import socket
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import curl_cffi
import yfinance as yf

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from tests.unit import test_financial_statement_batch as fixtures

ROOT = Path(__file__).resolve().parents[3]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / ".github/scripts" / file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


bridge = module("bounded_review_test", "bounded-statement-refresh-plan.py")
runner = module("bounded_runner_test", "run-statement-recovery-cycle.py")
REVIEW = ROOT / ".github/bounded-refresh-first-200/dispatch-review.json"
NOW = batch.clock("2026-10-06T12:00:00.000Z")


def forbidden(*args, **kwargs):
    raise AssertionError("Provider/network forbidden in pinned bridge tests")


class TestBoundedStatementReview(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="bounded-refresh-bridge-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, name in ((socket.socket, "connect"), (socket.socket, "connect_ex"),
                             (curl_cffi.Curl, "perform"), (yf, "Ticker")):
            p = patch.object(target, name, forbidden)
            p.start()
            self.addCleanup(p.stop)
        self.review = bridge.load_review(REVIEW, now=NOW)

    def semantic_review(self, mutate):
        values = {name: json.loads(content) for name, content in self.review.contents.items()}
        mutate(values)
        def read(path, expected, maximum=None):
            return values[path.name], self.review.contents[path.name]
        with patch.object(bridge, "read_pinned", read):
            return bridge.load_review(REVIEW, now=NOW)

    def test_exact_committed_full_queue_and_original_cohort(self):
        review = self.review
        self.assertEqual(len(review.plan["verified_us_cohort"]["symbols"]), 1894)
        self.assertEqual(len(review.queue), 1891)
        self.assertEqual(review.guard["excluded"], ["BITU", "ETHE", "SBIT"])
        self.assertEqual(review.plan["batch_allowlist"][:4], ["NVDA", "AMD", "VIRT", "A"])
        self.assertEqual(review.plan["batch_allowlist"][-1], "BBIO")
        self.assertEqual(len(review.plan["selected"]), 200)
        self.assertTrue(all(item["attributes"] == ["quarterly_income_stmt", "income_stmt"] and
                            item["targets"] == ["annual_history"] for item in review.plan["selected"]))
        self.assertEqual(batch.clock(review.plan["required_valid_through"]) - batch.clock(review.plan["evaluation_time"]),
                         timedelta(hours=36))
        self.assertFalse(review.request["dispatch_approved"])

    def test_every_review_input_is_byte_pinned_and_missing_fails(self):
        for name in bridge.REVIEW_FILES:
            with self.subTest(name=name):
                target = self.root / name
                target.write_bytes(self.review.contents[name])
                bridge.read_pinned(target, bridge.REVIEW_FILES[name])
                target.write_bytes(target.read_bytes() + b" ")
                with self.assertRaisesRegex(ValueError, "bytes changed"):
                    bridge.read_pinned(target, bridge.REVIEW_FILES[name])
                target.unlink()
                with self.assertRaisesRegex(ValueError, "Missing"):
                    bridge.read_pinned(target, bridge.REVIEW_FILES[name])

    def test_closed_schemas_reject_unknown_fields_even_with_trusted_reader(self):
        for name in ("dispatch-review.json", "collector-plan.json", "queue-guard.json"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "closed"):
                self.semantic_review(lambda values: values[name].update(automatic_retry=True))
        with self.assertRaisesRegex(ValueError, "closed"):
            self.semantic_review(lambda v: v["earliest-deadline-review-queue.json"][0].update(rotation=True))

    def test_semantic_source_plan_order_horizon_and_identity_are_checked(self):
        mutations = [
            lambda v: v["dispatch-review.json"]["input_source"].update(run_attempt=9),
            lambda v: v["collector-plan.json"]["selected"][0].update(attributes=["income_stmt"]),
            lambda v: v["collector-plan.json"]["selected"][0].update(targets=["eps"]),
            lambda v: v["collector-plan.json"]["selected"].reverse(),
            lambda v: v["collector-plan.json"].update(required_valid_through="2026-10-07T00:00:00.000Z"),
            lambda v: v["queue-guard.json"].update(excluded=["BITU", "ETHE"]),
            lambda v: v["queue-guard.json"].update(quarantined=["NVDA"]),
            lambda v: v["queue-guard.json"]["selection"][0]["identity"].update(status="verified"),
            lambda v: v["queue-guard.json"]["selection"][0]["identity"].update(identifiers_bound_to_price=True),
            lambda v: v["queue-guard.json"]["selection"][0]["identity"].update(observed_identifiers={"cik": "0001045810"}),
            lambda v: v["queue-guard.json"]["selection"][0]["applicability"].update(status="quarantined"),
            lambda v: v["earliest-deadline-review-queue.json"].reverse(),
            lambda v: v["earliest-deadline-review-queue.json"].pop(),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index), self.assertRaises(ValueError):
                self.semantic_review(mutate)

    def test_source_and_projection_paths_in_review_never_select_files(self):
        review = self.semantic_review(lambda v: v["queue-guard.json"].update(
            projection_path="/not/a/usable/projection", queue_path="/not/a/usable/queue"))
        self.assertEqual(len(review.queue), 1891)

    def test_expired_and_future_review_clock_fail(self):
        for now in (batch.clock(self.review.plan["evaluation_time"]) - timedelta(milliseconds=1),
                    batch.clock(bridge.DISPATCH_NOT_AFTER) + timedelta(milliseconds=1)):
            with self.subTest(now=now), self.assertRaisesRegex(ValueError, "dispatch time"):
                bridge.load_review(REVIEW, now=now)
        bridge.check_dispatch_clock(self.review, now=batch.clock(bridge.DISPATCH_NOT_AFTER))

    def test_disabled_admission_has_no_environment_enable_override(self):
        with patch.dict("os.environ", {"BOUNDED_REFRESH_ENABLE": "true", "EXECUTION_ENABLED": "true"}):
            with self.assertRaisesRegex(ValueError, "execution is disabled"):
                bridge.load_admission(REVIEW, self.review, now=NOW, dry_run=False)
        admission, _ = bridge.load_admission(REVIEW, self.review, now=NOW, dry_run=True)
        self.assertFalse(admission["execution_enabled"])
        self.assertIsNone(admission["expected_run_number"])

    def test_direct_disposable_admission_requires_first_attempt_and_context(self):
        admission = json.loads((REVIEW.parent / "dispatch-admission.json").read_bytes())
        admission["execution_enabled"] = True
        admission["expected_run_number"] = 2719
        context = {"GITHUB_RUN_ATTEMPT": "1", "GITHUB_REPOSITORY": bridge.SOURCE["repository"],
                   "GITHUB_REF_NAME": self.review.request["source_branch"], "GITHUB_EVENT_NAME": "push",
                   "GITHUB_RUN_ID": str(bridge.SOURCE["run_id"] + 1), "GITHUB_RUN_NUMBER": "2719"}
        bridge.validate_admission(admission, self.review, now=NOW, dry_run=False, execution_context=context)
        mutations = [{"GITHUB_RUN_ATTEMPT": "2"}, {"GITHUB_RUN_ATTEMPT": ""},
                     {"GITHUB_EVENT_NAME": "workflow_dispatch"}, {"GITHUB_REF_NAME": "main"},
                     {"GITHUB_REPOSITORY": "other/screener"}, {"GITHUB_RUN_ID": str(bridge.SOURCE["run_id"])}]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                bridge.validate_admission(admission, self.review, now=NOW, dry_run=False,
                                          execution_context={**context, **mutation})
        for field, value in (("automatic_retry", True), ("first_attempt_only", False),
                             ("queue_guard_sha256", "0" * 64), ("execution_enabled", 1)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                bridge.validate_admission({**admission, field: value}, self.review, now=NOW,
                                          dry_run=False, execution_context=context)

    def test_exact_workflow_number_rejects_second_new_push_and_malformed_context(self):
        admission = json.loads((REVIEW.parent / "dispatch-admission.json").read_bytes())
        admission.update(execution_enabled=True, expected_run_number=2719)
        first = {"GITHUB_RUN_ATTEMPT": "1", "GITHUB_REPOSITORY": bridge.SOURCE["repository"],
                 "GITHUB_REF_NAME": self.review.request["source_branch"], "GITHUB_EVENT_NAME": "push",
                 "GITHUB_RUN_ID": str(bridge.SOURCE["run_id"] + 1), "GITHUB_RUN_NUMBER": "2719"}
        bridge.validate_admission(admission, self.review, now=NOW, dry_run=False, execution_context=first)
        second = {**first, "GITHUB_RUN_ID": str(bridge.SOURCE["run_id"] + 2), "GITHUB_RUN_NUMBER": "2720"}
        with self.assertRaisesRegex(ValueError, "single reviewed dispatch"):
            bridge.validate_admission(admission, self.review, now=NOW, dry_run=False, execution_context=second)
        for number in (None, "", "2718", "2720", "02719", "+2719", "2719.0", "２７１９", 2719):
            for dry_run in (False, True):
                with self.subTest(number=number, dry_run=dry_run), self.assertRaisesRegex(ValueError, "run number differs"):
                    bridge.validate_admission(admission, self.review, now=NOW, dry_run=dry_run,
                                              execution_context={**first, "GITHUB_RUN_NUMBER": number})
        missing = {key: value for key, value in first.items() if key != "GITHUB_RUN_NUMBER"}
        with self.assertRaisesRegex(ValueError, "run number differs"):
            bridge.validate_admission(admission, self.review, now=NOW, dry_run=False, execution_context=missing)
        for number in (None, 0, -1, True, 2719.0, "2719"):
            with self.subTest(expected_number=number), self.assertRaisesRegex(ValueError, "positive workflow run number"):
                bridge.validate_admission({**admission, "expected_run_number": number}, self.review, now=NOW,
                                          dry_run=False, execution_context=first)
        with self.assertRaisesRegex(ValueError, "Disabled admission"):
            bridge.validate_admission({**admission, "execution_enabled": False}, self.review,
                                      now=NOW, dry_run=True, execution_context=first)

    def test_disabled_runner_never_reads_source_or_constructs_provider(self):
        inputs = self.root / "inputs"
        inputs.mkdir()
        (inputs / "base.json").write_bytes(b"{}")
        (inputs / "cohort.json").write_bytes(b"{}")
        with patch.object(runner, "datetime", SimpleNamespace(now=lambda tz: NOW)), \
             self.assertRaisesRegex(ValueError, "execution is disabled"):
            runner.run(inputs, self.root / "missing-source", self.root / "output", reviewed_plan=REVIEW,
                       job_started_at=batch.timestamp(NOW))
        self.assertFalse((self.root / "output").exists())

    def test_bounded_job_clock_is_required_before_source_staging(self):
        inputs = self.root / "inputs"
        inputs.mkdir()
        (inputs / "base.json").write_bytes(b"{}")
        (inputs / "cohort.json").write_bytes(b"{}")
        for started in (None, "", "not-rfc3339", batch.timestamp(NOW + timedelta(seconds=1)),
                        batch.timestamp(NOW - timedelta(seconds=1080))):
            with self.subTest(started=started), patch.object(runner, "datetime", SimpleNamespace(now=lambda tz: NOW)), \
                 patch.object(runner, "bounded_bridge", side_effect=AssertionError("No staging before clock admission")), \
                 self.assertRaises(ValueError):
                runner.run(inputs, self.root / "missing-source", self.root / "output", reviewed_plan=REVIEW,
                           job_started_at=started, dry_run=True)
        self.assertFalse((self.root / "output").exists())

    def test_bounded_job_budget_charges_elapsed_setup_and_keeps_finalization_reserve(self):
        for elapsed, expected in ((0, 1080), (60, 1020), (420, 660), (1079.5, 0.5)):
            with self.subTest(elapsed=elapsed):
                allowance = runner.bounded_acquisition_budget(batch.timestamp(NOW - timedelta(seconds=elapsed)), now=NOW)
                self.assertEqual(allowance, expected)
                self.assertGreaterEqual(1500 - elapsed - allowance, 420)
        for elapsed in (1080, 1081, 1500):
            with self.subTest(elapsed=elapsed), self.assertRaisesRegex(ValueError, "exhausted"):
                runner.bounded_acquisition_budget(batch.timestamp(NOW - timedelta(seconds=elapsed)), now=NOW)

    def test_input_bytes_full_cohort_and_predecessor_are_required(self):
        review = deepcopy(self.review)
        base = json.dumps({"as_of_date": "2026-10-02", "rows": [
            {"symbol": s, "market": "US"} for s in review.plan["verified_us_cohort"]["symbols"]]}).encode()
        cohort = deepcopy(review.plan["verified_us_cohort"])
        cohort["base_artifact_sha256"] = bridge.sha256(base)
        cohort_bytes = json.dumps(cohort).encode()
        review.plan["verified_us_cohort"] = cohort
        source = {**bridge.SOURCE, "acquisition_base_sha256": bridge.sha256(base), "cohort_sha256": bridge.sha256(cohort_bytes)}
        provenance = {"schema_version": "financial-source-restore-v1", "kind": "recovery_archive", **{
            k: source[k] for k in ("repository", "run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256")}}
        with patch.object(bridge, "SOURCE", source):
            bridge.verify_original_inputs(review, base, cohort_bytes, provenance)
            for bad_base, bad_cohort, bad_source in ((base + b" ", cohort_bytes, provenance),
                    (base, cohort_bytes + b" ", provenance), (base, cohort_bytes, {**provenance, "run_attempt": 7}),
                    (base, cohort_bytes, {**provenance, "artifact_id": 1})):
                with self.assertRaises(ValueError):
                    bridge.verify_original_inputs(review, bad_base, bad_cohort, bad_source)
            review.plan["verified_us_cohort"]["symbols"] = review.plan["verified_us_cohort"]["symbols"][:200]
            with self.assertRaisesRegex(ValueError, "full original"):
                bridge.verify_original_inputs(review, base, cohort_bytes, provenance)

    def test_every_queue_receipt_and_clock_is_bound_to_current_archive(self):
        acquisitions, current = {}, {}
        for entry in self.review.queue:
            for attribute, prefix in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
                digest = entry[prefix + "_receipt"]
                if digest is not None:
                    current[f"{entry['symbol']}/{attribute}"] = digest
                    acquisitions[digest] = {"context": {"observed_at": entry[prefix + "_observed_at"]}, "raw": {}}
        retained = SimpleNamespace(sha256=bridge.SOURCE["archive_manifest_sha256"], acquisitions=acquisitions,
                                   manifest={"current": current, "attempts": {}, "objects": {}, "batches": {}}, objects={})
        kwargs = {"base_bytes": b"", "cohort_bytes": b"", "provenance": {}, "now": NOW}
        with patch.object(bridge, "verify_original_inputs", return_value=self.review.plan["verified_us_cohort"]), \
             patch.object(batch, "required_validity_state", return_value={"state": "stale_source"}):
            planned = bridge.validate_archive(self.review, retained, **kwargs)
            self.assertEqual(len(planned.symbols), 200)
            # An unselected receipt is also part of predecessor validation.
            key = f"{self.review.queue[500]['symbol']}/income_stmt"
            previous = current[key]
            current[key] = "0" * 64
            with self.assertRaisesRegex(ValueError, "queue receipt"):
                bridge.validate_archive(self.review, retained, **kwargs)
            current[key] = previous
            acquisitions[previous]["context"]["observed_at"] = "2026-10-06T00:00:00.000Z"
            with self.assertRaisesRegex(ValueError, "receipt clock"):
                bridge.validate_archive(self.review, retained, **kwargs)
            retained.sha256 = "1" * 64
            with self.assertRaisesRegex(ValueError, "predecessor manifest"):
                bridge.validate_archive(self.review, retained, **kwargs)

    def test_global_barriers_include_symbols_outside_selected_and_current_cohort(self):
        for event in ({"outcome": "in_flight"}, {"outcome": "budget_stopped"},
                      {"outcome": "provider_blocked"}, {"outcome": "succeeded", "http_status": 403},
                      {"outcome": "failed", "http_status": 429}):
            retained = SimpleNamespace(manifest={"attempts": {"old": {"symbol": "OLD", **event}}, "batches": {}}, objects={})
            with self.subTest(event=event), self.assertRaisesRegex(ValueError, "barrier"):
                bridge.audit_global_barriers(retained)

    def test_missing_journal_summary_or_unresolved_transport_cannot_hide_barrier(self):
        examples = [("attempt_journal", {"attempts": [{"attempt_id": "unindexed", "outcome": "succeeded"}]}),
                    ("attempt_journal", {}), ("batch_summary", {"provider_stop": None}),
                    ("batch_summary", {"provider_stop": None, "execution_stop": {"kind": "stop"}}),
                    ("failed_acquisition", {"failure": {"kind": "getter_exception"}, "transport_events": []}),
                    ("acquisition", {"failure": None, "transport_events": [{"detected_http_status": 429}]}),
                    ("acquisition", {"failure": None, "transport_events": [{"error_type": "Timeout"}]}),
                    ("acquisition", {"failure": None})]
        for kind, value in examples:
            retained = SimpleNamespace(manifest={"attempts": {}, "batches": {}, "objects": {"sha": {"kind": kind}}},
                                       objects={"sha": (value, b"")})
            with self.subTest(kind=kind, value=value), self.assertRaises(ValueError):
                bridge.audit_global_barriers(retained)
        retained = SimpleNamespace(manifest={"attempts": {}, "batches": {}, "objects": {"sha": {"kind": "failed_acquisition"}}},
            objects={"sha": ({"failure": {"kind": "empty_getter_result"}, "transport_events": [{"http_status": 200}]}, b"")})
        bridge.audit_global_barriers(retained)

    def test_retained_zip_requires_exact_extracted_bytes_and_no_extra_members(self):
        root = self.root / "source"
        (root / "files").mkdir(parents=True)
        (root / "files/base.json").write_bytes(b"original bytes")
        with zipfile.ZipFile(root / "source.zip", "w") as source:
            source.writestr("base.json", b"original bytes")
        pinned = {**bridge.SOURCE, "artifact_sha256": bridge.sha256((root / "source.zip").read_bytes())}
        with patch.object(bridge, "SOURCE", pinned):
            bridge.verify_source_zip(root)
            (root / "files/base.json").write_bytes(b"different data")
            with self.assertRaisesRegex(ValueError, "differs from original"):
                bridge.verify_source_zip(root)
            (root / "files/base.json").write_bytes(b"original bytes")
            (root / "files/unbound.json").write_bytes(b"extra")
            with self.assertRaisesRegex(ValueError, "Unbound files"):
                bridge.verify_source_zip(root)
            (root / "files/unbound.json").unlink()
            (root / "source.zip").write_bytes(b"changed ZIP")
            with self.assertRaisesRegex(ValueError, "ZIP bytes changed"):
                bridge.verify_source_zip(root)

    def test_pinned_zip_cannot_use_unsafe_paths(self):
        root = self.root / "source"
        (root / "files").mkdir(parents=True)
        with zipfile.ZipFile(root / "source.zip", "w") as source:
            source.writestr("../outside.json", b"bad")
        pinned = {**bridge.SOURCE, "artifact_sha256": bridge.sha256((root / "source.zip").read_bytes())}
        with patch.object(bridge, "SOURCE", pinned), self.assertRaisesRegex(ValueError, "Unsafe"):
            bridge.verify_source_zip(root)


class TestLegacyRecoveryStillWorks(unittest.TestCase):
    def setUp(self):
        self.collector = fixtures.TestFinancialStatementBatch()
        self.collector.setUp()
        self.addCleanup(self.collector.doCleanups)
        self.root = self.collector.root
        self.plan, self.base = self.collector.plan, self.collector.base
        self.cohort = self.plan["verified_us_cohort"]
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        (self.inputs / "base.json").write_bytes(self.base)
        batch.write_json(self.inputs / "cohort.json", self.cohort)
        self.restored = self.root / "restored"
        files = self.restored / "files"
        files.mkdir(parents=True)
        self.sha = archive.create_archive(files / "archive", base_bytes=self.base, cohort=self.cohort, now=fixtures.NOW)
        batch.write_json(self.restored / "restored.json", {"kind": "recovery_archive"})
        batch.write_json(files / "cycle.json", {"schema_version": "financial-recovery-cycle-v1",
            "phase": "completed", "archive_manifest_sha256": self.sha})

    def test_legacy_dry_run_keeps_original_planner_and_zero_provider_calls(self):
        with patch.object(runner, "datetime", SimpleNamespace(now=lambda tz: fixtures.NOW)):
            self.assertEqual(runner.run(self.inputs, self.restored, self.root / "output", dry_run=True), 0)
        self.assertEqual(self.collector.calls, [])
        self.assertEqual(self.collector.tickers, [])
        self.assertEqual(fixtures.read(self.root / "output/cycle.json")["selected_symbols"], 3)

    def test_bounded_runner_rechecks_job_allowance_after_expensive_staging(self):
        cohort_bytes = (self.inputs / "cohort.json").read_bytes()
        review = SimpleNamespace(plan=self.plan, contents={})
        planned = SimpleNamespace(eligible_count=3, symbols=tuple(self.plan["batch_allowlist"]),
                                  provider_state="available", invalid_receipts=(), cause_counts={}, required_work=())
        cache = {"schema_version": batch.CACHE_SCHEMA,
                 "binding": archive.verify_base(self.base, self.cohort, now=fixtures.NOW), "acquisitions": {}}
        helper = SimpleNamespace(load_review=lambda *a, **k: review,
            load_admission=lambda *a, **k: ({}, b"{}"),
            verify_restored_source=lambda *a, **k: (self.base, cohort_bytes),
            validate_archive=lambda *a, **k: planned, check_dispatch_clock=lambda *a, **k: None,
            SELECTED_CACHE_SHA256=batch.digest_bytes(batch._json_bytes(cache)))
        original_collect = batch.collect
        for staging_seconds in (200, 1000):
            calls = []
            ready = fixtures.NOW + timedelta(seconds=staging_seconds)
            clocks = iter((fixtures.NOW, ready, ready))
            def collect(*args, **kwargs):
                calls.append(kwargs["acquisition_budget_seconds"])
                return original_collect(*args, **kwargs)
            with self.subTest(staging_seconds=staging_seconds), \
                 patch.object(runner, "bounded_bridge", return_value=helper), \
                 patch.object(runner, "datetime", SimpleNamespace(now=lambda tz: next(clocks))), \
                 patch.object(batch, "collect", collect):
                args = (self.inputs, self.restored, self.root / f"bounded-output-{staging_seconds}")
                kwargs = {"dry_run": True, "reviewed_plan": REVIEW,
                          "job_started_at": batch.timestamp(fixtures.NOW - timedelta(seconds=100))}
                if staging_seconds == 200:
                    self.assertEqual(runner.run(*args, **kwargs), 0)
                    self.assertEqual(calls, [780])
                else:
                    with self.assertRaisesRegex(ValueError, "setup exhausted"):
                        runner.run(*args, **kwargs)
                    self.assertEqual(calls, [])
        self.assertEqual(self.collector.calls, [])
        self.assertEqual(self.collector.tickers, [])

    def test_legacy_prepared_cycle_still_reconciles_partial_journal(self):
        batch.collect(self.plan, self.base, self.collector.output)
        source = self.restored / "files"
        shutil.copytree(self.collector.output, source / "batch")
        (source / "batch/summary.json").unlink()
        (source / "base.json").write_bytes(self.base)
        batch.write_json(source / "cohort.json", self.cohort)
        batch.write_json(source / "cycle.json", {"schema_version": "financial-recovery-cycle-v1",
            "phase": "prepared", "archive_manifest_sha256": self.sha})
        self.collector.calls.clear()
        with patch.object(runner, "datetime", SimpleNamespace(now=lambda tz: fixtures.NOW)):
            self.assertEqual(runner.run(self.inputs, self.restored, self.root / "output", dry_run=True), 0)
        cycle = fixtures.read(self.root / "output/cycle.json")
        self.assertEqual(cycle["retained_receipts"], 6)
        self.assertEqual(cycle["selected_symbols"], 0)
        self.assertEqual(self.collector.calls, [])
