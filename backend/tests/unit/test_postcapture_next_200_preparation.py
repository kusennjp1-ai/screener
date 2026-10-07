"""Finite offline next-visit checks; every provider and network path is denied."""
from copy import deepcopy
from datetime import timedelta
import importlib.util
import json
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import curl_cffi
import yfinance

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("postcapture_next_200_test", ROOT / ".github/scripts/prepare-postcapture-next-200.py")
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)
NOW = prep.batch.clock("2026-10-07T03:00:00Z")


def forbidden(*args, **kwargs):
    raise AssertionError("Provider/network forbidden in next-200 tests")


class TestNext200Preparation(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="postcapture-next-200-tests-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, name in ((socket.socket, "connect"), (socket.socket, "connect_ex"),
                             (socket, "create_connection"), (curl_cffi.Curl, "perform"), (yfinance, "Ticker")):
            mock = patch.object(target, name, forbidden)
            mock.start()
            self.addCleanup(mock.stop)
        self.review = prep.load_review(now=NOW)

    def semantic_review(self, change):
        values = {name: json.loads(content) for name, content in self.review.contents.items()}
        change(values)
        read = prep.read_pinned
        def modified(path, digest, maximum=None):
            if path.parent == prep.REVIEW_DIRECTORY:
                return values[path.name], self.review.contents[path.name]
            return read(path, digest)
        with patch.object(prep, "read_pinned", modified):
            return prep.load_review(now=NOW)

    def source_fixture(self):
        manifest = {"current": {}, "receipts": {}}
        acquisitions = {}
        projection = {"bindings": {"archive_manifest_sha256": prep.SOURCE["archive_manifest_sha256"],
            "acquisition_base_sha256": prep.SOURCE["base_sha256"], "cohort_sha256": prep.SOURCE["cohort_sha256"]}, "symbols": {}}
        for entry in self.review.queue:
            original, retained = entry["original"], entry["retained"]
            symbol = original["symbol"]
            row = {"financial_identity": entry["identity"], "instrument_applicability": entry["applicability"], "source_receipts": []}
            for attr, prefix in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
                prior, receipt = original[prefix + "_receipt"], retained[prefix + "_receipt"]
                if prior:
                    acquisitions[prior] = {"context": {"observed_at": original[prefix + "_observed_at"]}, "raw": {}}
                if receipt:
                    acquisitions[receipt] = {"context": {"observed_at": retained[prefix + "_observed_at"]}, "raw": {}}
                    manifest["current"][symbol + "/" + attr] = receipt
                    row["source_receipts"].append({"attribute": attr, "receipt_sha256": receipt,
                                                    "observed_at": retained[prefix + "_observed_at"]})
            projection["symbols"][symbol] = row
        for symbol in prep.EXCLUDED:
            projection["symbols"][symbol] = {"instrument_applicability": {"status": "not_applicable"}}
        return SimpleNamespace(sha256=prep.SOURCE["archive_manifest_sha256"], manifest=manifest,
                               acquisitions=acquisitions), projection

    def checked_source(self, review=None, current=None, projection=None):
        if current is None:
            current, projection = self.source_fixture()
        with patch.object(prep.batch, "required_validity_state", return_value={"state": "renewal_required"}):
            return prep.validate_current(review or self.review, current, projection, now=NOW)

    def test_exact_finite_plan_and_disabled_admission(self):
        review = self.review
        self.assertEqual(len(review.queue), 1891)
        self.assertEqual(len(review.plan["verified_us_cohort"]["symbols"]), 1894)
        self.assertEqual(review.plan["batch_allowlist"][0], "ADP")
        self.assertEqual(review.plan["batch_allowlist"][-1], "CMS")
        self.assertEqual(len(review.plan["selected"]), 200)
        self.assertEqual(prep.batch.clock(review.plan["required_valid_through"]) -
                         prep.batch.clock(review.plan["evaluation_time"]), timedelta(hours=36))
        self.assertFalse(review.admission["execution_enabled"])
        self.assertIsNone(review.admission["expected_run_number"])
        self.assertEqual(review.request["budget"], prep.BUDGET)
        self.assertEqual(review.request["missing_prior_decisions"], prep.MISSING_PRIORS)

    def test_every_metadata_file_is_exact_byte_pinned(self):
        for name, digest in prep.REVIEW_FILES.items():
            with self.subTest(name=name):
                path = self.root / name
                path.write_bytes(self.review.contents[name])
                prep.read_pinned(path, digest)
                path.write_bytes(path.read_bytes() + b" ")
                with self.assertRaisesRegex(ValueError, "Pinned bytes changed"):
                    prep.read_pinned(path, digest)

    def test_closed_review_plan_admission_and_queue(self):
        for name in ("dispatch-review.json", "collector-plan.json", "dispatch-admission.json"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "closed"):
                self.semantic_review(lambda v: v[name].update(trust_override=True))
        with self.assertRaisesRegex(ValueError, "closed"):
            self.semantic_review(lambda v: v["retained-queue.json"][0].update(retry=True))

    def test_no_activation_scope_budget_horizon_or_identity_mutation(self):
        mutations = [
            lambda v: v["dispatch-admission.json"].update(execution_enabled=True, expected_run_number=5),
            lambda v: v["dispatch-admission.json"].update(expected_run_number=5),
            lambda v: v["dispatch-review.json"].update(dispatch_approved=True),
            lambda v: v["dispatch-review.json"].update(aggregate_authorization=True),
            lambda v: v["dispatch-review.json"]["input_source"].update(source_run_id=1),
            lambda v: v["dispatch-review.json"]["budget"].update(transport_requests=1001),
            lambda v: v["dispatch-review.json"].update(excluded=["BITU", "ETHE"]),
            lambda v: v["collector-plan.json"]["selected"][0].update(attributes=["income_stmt"]),
            lambda v: v["collector-plan.json"].update(required_valid_through="2026-10-08T05:30:00Z"),
            lambda v: v["retained-queue.json"].reverse(),
            lambda v: v["retained-queue.json"][200].update(already_refreshed=True),
            lambda v: v["retained-queue.json"][200]["identity"].update(status="verified"),
            lambda v: v["retained-queue.json"][200]["original"].update(complete_annual_history=False),
            lambda v: v["dispatch-review.json"].update(missing_prior_decisions=[]),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index), self.assertRaises(ValueError):
                self.semantic_review(mutate)

    def test_current_whole_queue_and_fresh_work_include_exact_four_missing_priors(self):
        work = self.checked_source()
        self.assertEqual(len(work), 400)
        missing = [x for x in work if x["prior_receipt"] is None]
        self.assertEqual([x["symbol"] for x in missing], ["BHP", "BTI", "BXDC", "CCEP"])
        self.assertEqual({(x["symbol"], x["attribute"]) for x in missing}, prep.MISSING_PRIOR_KEYS)
        self.assertTrue(all(x["retry_decision"] == "retry_decision_required" and x["retry_not_before"] is None for x in missing))
        self.assertTrue(all(x["state"].startswith("fresh_work_") for x in work))

    def test_full_queue_reconciliation_rejects_loss_retiming_and_fabricated_receipts(self):
        for mutate in (
            lambda c, p: c.manifest["current"].update({"COKE/income_stmt": "0" * 64}),
            lambda c, p: c.acquisitions.pop(self.review.queue[0]["original"]["annual_receipt"]),
            lambda c, p: c.acquisitions[self.review.queue[200]["retained"]["annual_receipt"]]["context"].update(observed_at="2026-10-06T18:00:00Z"),
            lambda c, p: c.manifest["current"].update({"BHP/quarterly_income_stmt": "0" * 64}),
            lambda c, p: p["symbols"]["BHP"]["source_receipts"].append({"attribute": "quarterly_income_stmt", "receipt_sha256": "0" * 64}),
            lambda c, p: p["bindings"].update(archive_manifest_sha256="0" * 64),
        ):
            current, projection = self.source_fixture()
            mutate(current, projection)
            with self.assertRaises(ValueError):
                self.checked_source(current=current, projection=projection)

    def test_current_receipt_cannot_be_refetched_as_due(self):
        current, projection = self.source_fixture()
        with patch.object(prep.batch, "required_validity_state", return_value={"state": "current"}), \
             self.assertRaisesRegex(ValueError, "no longer requires"):
            prep.validate_current(self.review, current, projection, now=NOW)

    def test_finite_preparation_window_has_no_clock_reset(self):
        for time in (prep.batch.clock(self.review.plan["evaluation_time"]) - timedelta(milliseconds=1),
                     prep.batch.clock(self.review.admission["dispatch_not_after"]) + timedelta(milliseconds=1)):
            with self.assertRaisesRegex(ValueError, "finite review window"):
                prep.load_review(now=time)

    def test_disabled_restore_policy_fails_before_stage_creation(self):
        policy = deepcopy(prep.baseline_reader().POLICY)
        policy.update(restore_enabled=False, reviewed_requests=[])
        output = self.root / "stage"
        with patch.dict("os.environ", {"EXECUTION_ENABLED": "true", "RESTORE_ENABLED": "true"}), \
             self.assertRaisesRegex(ValueError, "disabled or not independently admitted"):
            prep.prepare_stage(self.root / "source.zip", self.root / "source", self.root / "companion.zip",
                               self.root / "projection.json", output, now=NOW, restore_policy=policy)
        self.assertFalse(output.exists())

    def test_enabled_restore_policy_validates_companion_before_stage_creation(self):
        policy = deepcopy(prep.baseline_reader().POLICY)
        policy.update(restore_enabled=True, reviewed_requests=[json.loads(
            (ROOT / ".github/scripts/fixtures/postcapture-restore-review.fixture.json").read_bytes())])
        output = self.root / "stage"
        companion = self.root / "companion.zip"
        companion.write_bytes(b"invalid companion")
        with self.assertRaisesRegex(ValueError, "Exact companion ZIP length/hash mismatch"):
            prep.prepare_stage(self.root / "source.zip", self.root / "source", companion,
                               self.root / "projection.json", output, now=NOW, restore_policy=policy)
        self.assertFalse(output.exists())

    def test_preparation_blocks_accidental_provider_use_before_output(self):
        def malicious_reader(*args, **kwargs):
            return yfinance.Ticker("ADP")
        output = self.root / "stage"
        with patch.object(prep, "baseline_reader", return_value=SimpleNamespace(verify_baseline=malicious_reader)), \
             self.assertRaisesRegex(AssertionError, "forbidden during offline"):
            prep.prepare_stage(self.root / "source.zip", self.root / "source", self.root / "companion.zip",
                               self.root / "projection.json", output, now=NOW)
        self.assertFalse(output.exists())

    def test_stage_cannot_overwrite_original_source_or_repository(self):
        for output in (self.root, self.root / "source/stage", ROOT / "new-stage"):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, "Stage|stage"):
                prep.prepare_stage(self.root / "source.zip", self.root / "source", self.root / "companion.zip",
                                   self.root / "projection.json", output, now=NOW)


if __name__ == "__main__":
    unittest.main()
