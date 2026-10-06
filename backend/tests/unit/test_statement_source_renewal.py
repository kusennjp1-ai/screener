"""Offline renewal proof tests using the real collector and synthetic transport.

The shared collector fixture independently blocks socket connects and curl
performs. Only the pinned vendor's real normalizer and retained local bytes run.
"""
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from datetime import timedelta
import io
import json
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

from app.scripts import export_statement_projection as projector
from app.scripts import verify_statement_source_renewal as renewal
from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from tests.unit import test_financial_statement_batch as fixtures


class TestStatementSourceRenewal(unittest.TestCase):
    def setUp(self):
        self.collector = fixtures.TestFinancialStatementBatch()
        self.collector.setUp()
        self.addCleanup(self.collector.doCleanups)
        self.root = self.collector.root
        self.plan, self.base = fixtures.plan_for(("AMD", "NVDA"))
        self.cohort = self.plan["verified_us_cohort"]
        self.now = fixtures.NOW
        self.current = self.root / "current"
        self.current.mkdir()
        (self.current / "base.json").write_bytes(self.base)
        (self.current / "cohort.json").write_bytes(projector.canonical_bytes(self.cohort))
        self.sha = archive.create_archive(self.current / "archive", base_bytes=self.base,
                                          cohort=self.cohort, now=self.now)
        self.capture("first", symbols=("AMD", "NVDA"))
        self.previous = self.root / "previous"
        shutil.copytree(self.current, self.previous)
        self.previous_sha = self.sha
        self.previous_projection = self.export(self.previous, self.previous_sha, "previous-projection")
        self.now += timedelta(hours=1)

    def capture(self, name, *, symbols=("AMD",), attributes=batch.ATTRIBUTES, mutate=None, seed=False, cached=False):
        self.collector.now = self.now
        fixtures.YfData().cache_get.cache_clear()
        plan = deepcopy(self.plan)
        plan.update(evaluation_time=batch.timestamp(self.now), batch_allowlist=list(symbols),
                    selected=[{"symbol": symbol, "attributes": list(attributes)} for symbol in symbols])
        path = self.root / name
        kwargs = {}
        if cached:
            verified = archive.load_archive(self.current / "archive", self.sha,
                                            base_bytes=self.base, cohort=self.cohort, now=self.now)
            cache_path, cache_sha = archive.export_cache(verified, plan, self.base,
                                                         self.root / f"{name}-cache", now=self.now)
            kwargs.update(cache_manifest=cache_path, cache_sha256=cache_sha)
        acquire = fixtures.capture.acquire_yahoo_value

        def sequential(*args, **kw):
            result = acquire(*args, **kw)
            self.collector.now += timedelta(seconds=1)
            return result

        with patch.object(fixtures.capture, "acquire_yahoo_value", sequential):
            _, code = batch.collect(plan, self.base, path, **kwargs)
        self.assertEqual(code, 0)
        self.now = self.collector.now
        if mutate:
            mutate(path)
        if seed:
            self.sha = archive.seed_retained_acquisitions(
                self.current / "archive", self.sha, artifact_dir=path, plan=plan,
                base_bytes=self.base, now=self.now)
        else:
            self.sha = archive.merge_batch(
                self.current / "archive", self.sha, batch_dir=path,
                summary_sha256=batch.digest_bytes((path / "summary.json").read_bytes()),
                base_bytes=self.base, cohort=self.cohort, now=self.now)
        return path

    def export(self, source=None, sha=None, name="projection"):
        source = source or self.current
        result = projector.export_projection(
            archive_dir=source / "archive", archive_sha256=sha or self.sha,
            base_path=source / "base.json", cohort_path=source / "cohort.json",
            cohort_sha256=batch.digest_bytes((source / "cohort.json").read_bytes()),
            target_base_path=source / "base.json", target_base_sha256=batch.digest_bytes(self.base),
            target_publication_identity="123/1/" + "a" * 64 + "/" + "b" * 64,
            evaluated_at=batch.timestamp(self.now), output_dir=self.root / name)
        return Path(result["projection_path"])

    def verify(self, **changes):
        kwargs = {
            "previous_archive": self.previous, "archive_dir": self.current,
            "previous_projection": self.previous_projection,
            "evaluated_at": batch.timestamp(self.now), **changes}
        if "projection" not in kwargs:
            kwargs["projection"] = self.export()
        return renewal.verify_renewal(**kwargs)

    def rewrite_manifest(self, mutate):
        path = self.current / "archive" / "manifest.json"
        value = fixtures.read(path)
        mutate(value)
        content = batch._json_bytes(value)
        path.write_bytes(content)
        self.sha = batch.digest_bytes(content)

    def rebind_batch(self, path, *, raw_mutation=None, attempt_mutation=None):
        cache = fixtures.read(path / "cache-manifest.json")
        for entry in cache["acquisitions"].values():
            raw_path = path / entry["file"]
            raw = fixtures.read(raw_path)
            if raw_mutation:
                raw_mutation(raw)
            entry["sha256"] = batch.write_json(raw_path, raw)
        cache_sha = batch.write_json(path / "cache-manifest.json", cache)
        journal = fixtures.read(path / "attempts.json")
        if attempt_mutation:
            for attempt in journal["attempts"]:
                attempt_mutation(attempt)
        journal_sha = batch.write_json(path / "attempts.json", journal)
        summary = fixtures.read(path / "summary.json")
        summary.update(cache_manifest_sha256=cache_sha, attempts_sha256=journal_sha)
        batch.write_json(path / "summary.json", summary)

    def test_real_acquisition_partial_renewal_retains_unchanged_receipts_and_bytes(self):
        self.capture("renewal", attributes=("income_stmt",))
        with patch.object(batch, "runtime", side_effect=AssertionError("No provider runtime")), \
                patch.object(fixtures.yf, "Ticker", side_effect=AssertionError("No provider")), \
                patch.object(fixtures.requests.Session, "request", side_effect=AssertionError("No network")):
            report = self.verify()
        self.assertEqual(report["schema_version"], renewal.SCHEMA)
        self.assertEqual(report["status"], "verified")
        self.assertEqual(report["new_receipt_count"], 1)
        self.assertEqual(len(report["renewed_current_receipts"]), 1)
        self.assertEqual(len(report["unchanged_current_receipts"]), 3)
        self.assertEqual(report["preserved"]["receipts"], 4)
        self.assertEqual(report["preserved"]["attempts"], 4)
        receipt = report["new_receipts"][0]
        self.assertEqual((receipt["symbol"], receipt["attribute"]), ("AMD", "income_stmt"))
        self.assertNotEqual(receipt["previous_receipt_sha256"], receipt["receipt_sha256"])
        self.assertLess(batch.clock(receipt["observed_at"]), batch.clock(receipt["getter_completed_at"]))
        self.assertEqual(report["new_receipts_sha256"], projector.content_digest(report["new_receipts"]))
        self.assertEqual(report["previous"]["archive_manifest_sha256"], self.previous_sha)
        self.assertEqual(report["current"]["archive_manifest_sha256"], self.sha)
        self.assertEqual(report, self.verify())

    def test_same_transport_payload_with_new_real_acquisition_is_allowed(self):
        self.capture("renewal")
        report = self.verify()
        previous = fixtures.read(self.previous / "archive" / "manifest.json")
        for receipt in report["new_receipts"]:
            raw = fixtures.read(self.previous / "archive" / "objects" / f"{receipt['previous_receipt_sha256']}.json")
            context = raw["source_acquisition_contexts"][receipt["attribute"]]
            self.assertEqual(receipt["transport_payload_sha256"], context["transport_payload_sha256"])
            self.assertNotEqual(receipt["capture_id"], context["capture_id"])
            self.assertIn(receipt["previous_receipt_sha256"], previous["receipts"])

    def test_identical_inventory_and_evaluation_clock_churn_are_rejected(self):
        self.rewrite_manifest(lambda value: value.update(committed_at=batch.timestamp(self.now)))
        with self.assertRaisesRegex(ValueError, "no genuinely new"):
            self.verify()

    def test_cache_only_batch_does_not_count_as_renewal(self):
        path = self.capture("cached", symbols=("AMD", "NVDA"), cached=True)
        self.assertEqual(fixtures.read(path / "attempts.json")["attempts"], [])
        with self.assertRaisesRegex(ValueError, "no genuinely new"):
            self.verify()

    def test_new_receipts_without_original_journals_are_rejected(self):
        self.capture("seed-only", seed=True)
        with self.assertRaisesRegex(ValueError, "lacks a successful retained acquisition journal"):
            self.verify()

    def test_forged_projection_clock_cannot_refresh_original_receipt(self):
        self.capture("renewal")
        path = self.export()
        projection = fixtures.read(path)
        receipt = projection["receipt_inventory"][0]
        receipt["observed_at"] = batch.timestamp(self.now)
        projection["symbols"][receipt["symbol"]]["source_receipts"][0]["observed_at"] = receipt["observed_at"]
        projection["receipt_inventory_sha256"] = projector.content_digest(projection["receipt_inventory"])
        projection["financial_generation"] = projector.financial_generation(projection)
        forged = self.root / "forged-projection.json"
        forged.write_bytes(projector.canonical_bytes(projection))
        with self.assertRaisesRegex(ValueError, "receipts differ"):
            self.verify(projection=forged)

    def test_prior_object_byte_mutation_is_rejected(self):
        self.capture("renewal")
        old = fixtures.read(self.previous / "archive" / "manifest.json")
        sha = next(iter(old["receipts"]))
        path = self.current / "archive" / "objects" / f"{sha}.json"
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "digest or length"):
            self.verify()

    def test_dropped_prior_receipt_is_rejected_even_with_rehashed_manifest(self):
        self.capture("renewal")
        old = fixtures.read(self.previous / "archive" / "manifest.json")
        sha = old["current"]["AMD/income_stmt"]

        def drop(value):
            del value["receipts"][sha]
            del value["objects"][sha]

        self.rewrite_manifest(drop)
        with self.assertRaisesRegex(ValueError, "dropped or rewrote prior objects"):
            self.verify()

    def test_dropped_prior_attempt_is_rejected_even_if_source_journal_is_retained(self):
        self.capture("renewal")
        old = fixtures.read(self.previous / "archive" / "manifest.json")
        attempt_id = next(iter(old["attempts"]))
        self.rewrite_manifest(lambda value: value["attempts"].pop(attempt_id))
        with self.assertRaisesRegex(ValueError, "dropped or rewrote prior attempts"):
            self.verify()

    def test_prior_receipt_metadata_cannot_be_rewritten(self):
        self.capture("renewal")
        old = fixtures.read(self.previous / "archive" / "manifest.json")
        sha = next(iter(old["receipts"]))
        self.rewrite_manifest(lambda value: value["receipts"][sha].update(caller_note="changed"))
        with self.assertRaisesRegex(ValueError, "dropped or rewrote prior receipts"):
            self.verify()

    def test_raw_getter_completion_must_not_follow_original_attempt_completion(self):
        def mutate(path):
            self.now += timedelta(minutes=1)
            self.rebind_batch(path, raw_mutation=lambda raw: raw.update(getter_completed_at=batch.timestamp(self.now)))

        self.capture("forged-getter", mutate=mutate)
        with self.assertRaisesRegex(ValueError, "original transport/getter/attempt completion"):
            self.verify()

    def test_retained_transport_completion_cannot_be_refreshed(self):
        def mutate(path):
            def raw_mutation(raw):
                for event in raw["transport_events"]:
                    event["completed_at"] = batch.timestamp(batch.clock(raw["getter_completed_at"]))
            self.rebind_batch(path, raw_mutation=raw_mutation)

        self.capture("forged-transport", mutate=mutate)
        with self.assertRaisesRegex(ValueError, "original transport/getter/attempt completion"):
            self.verify()

    def test_new_receipt_original_clock_must_be_strictly_newer_for_same_getter(self):
        merge_time = self.now
        self.now = fixtures.NOW - timedelta(minutes=1)
        self.capture("older-receipt", attributes=("quarterly_income_stmt",),
                     mutate=lambda _: setattr(self, "now", merge_time))
        self.capture("valid-renewal", attributes=("income_stmt",))
        with self.assertRaisesRegex(ValueError, "strictly newer original source clock"):
            self.verify()

    def test_base_and_cohort_byte_binding_is_verified(self):
        self.capture("renewal")
        projection = self.export()
        for filename in ("base.json", "cohort.json"):
            path = self.current / filename
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            try:
                with self.assertRaisesRegex(ValueError, "Input digest mismatch"):
                    self.verify(projection=projection)
            finally:
                path.write_bytes(original)

    def test_projection_inventory_cannot_drop_retained_current_receipts(self):
        self.capture("renewal")
        projection = fixtures.read(self.export())
        projection["receipt_inventory"].pop()
        projection["receipt_inventory_sha256"] = projector.content_digest(projection["receipt_inventory"])
        projection["financial_generation"] = projector.financial_generation(projection)
        path = self.root / "short-projection.json"
        path.write_bytes(projector.canonical_bytes(projection))
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            self.verify(projection=path)

    def test_original_archive_directory_and_explicit_base_paths_are_supported(self):
        self.capture("renewal")
        report = self.verify(previous_archive=self.previous / "archive", archive_dir=self.current / "archive",
                             previous_base=self.previous / "base.json", previous_cohort=self.previous / "cohort.json",
                             base=self.current / "base.json", cohort=self.current / "cohort.json")
        self.assertEqual(report["new_receipt_count"], 2)

    def test_manifest_bound_and_symlinks_fail_closed(self):
        self.capture("renewal")
        projection = self.export()
        with patch.object(archive, "MAX_MANIFEST_BYTES", 1), self.assertRaises(ValueError):
            self.verify(projection=projection)
        linked = self.root / "linked"
        linked.symlink_to(self.current, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            self.verify(archive_dir=linked, projection=projection)

    def test_cli_closed_report_and_rejection_exit(self):
        self.capture("renewal", attributes=("income_stmt",))
        projection = self.export()
        args = ["--previous-archive", str(self.previous), "--archive", str(self.current),
                "--previous-projection", str(self.previous_projection), "--projection", str(projection),
                "--evaluated-at", batch.timestamp(self.now)]
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            self.assertEqual(renewal.main(args), 0)
        report = json.loads(stdout.getvalue())
        self.assertEqual(set(report), {"schema_version", "status", "evaluated_at", "previous", "current",
                                      "preserved", "new_receipt_count", "new_receipts", "new_receipts_sha256",
                                      "journal_sha256", "renewed_current_receipts", "unchanged_current_receipts"})
        self.assertEqual(stdout.getvalue(), projector.canonical_bytes(report).decode() + "\n")
        bad = args.copy()
        bad[bad.index("--archive") + 1] = str(self.previous)
        stderr = io.StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as result:
            renewal.main(bad)
        self.assertEqual(result.exception.code, 2)
        self.assertIn("Statement source renewal rejected:", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
