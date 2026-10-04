"""Cumulative artifact/plan/cache/collector replay; every transport is mocked."""
from copy import deepcopy
from datetime import timedelta
from contextlib import redirect_stdout
import io
import json
import unittest
from unittest.mock import patch

from app.services import statement_artifact_archive as archive
from app.services import financial_statement_batch as batch
from app.scripts.manage_statement_archive import main as archive_cli
from tests.unit import test_financial_statement_batch as fixtures
from tests.unit.test_financial_statement_batch import NOW, body, plan_for, read


class TestStatementArtifactArchive(unittest.TestCase):
    def setUp(self):
        self.collector = fixtures.TestFinancialStatementBatch()
        self.collector.setUp()
        self.addCleanup(self.collector.doCleanups)
        self.root = self.collector.root
        self.directory = self.root / "archive"
        self.plan, self.base = plan_for(("AMD", "NVDA", "VIRT", "AAPL", "MSFT", "META"))
        self.cohort = self.plan["verified_us_cohort"]
        self.now = NOW
        self.sha = archive.create_archive(self.directory, base_bytes=self.base, cohort=self.cohort, now=self.now)

    def load(self):
        return archive.load_archive(self.directory, self.sha, base_bytes=self.base, cohort=self.cohort, now=self.now)

    def next_plan(self, **kwargs):
        return archive.plan_archive(self.load(), base_bytes=self.base, cohort=self.cohort, now=self.now, **kwargs)

    def capture(self, count=2, name="batch", **kwargs):
        planned, plan, projections = self.next_plan(batch_limit=count, **kwargs)
        path, cache_sha = archive.export_cache(self.load(), plan, self.base, self.root / (name + "-cache"), now=self.now)
        self.collector.now = self.now
        fixtures.YfData().cache_get.cache_clear()
        summary, code = batch.collect(plan, self.base, self.root / name, cache_manifest=path, cache_sha256=cache_sha)
        self.now = self.collector.now
        self.sha = archive.merge_batch(self.directory, self.sha, batch_dir=self.root / name,
            summary_sha256=batch.digest_bytes((self.root / name / "summary.json").read_bytes()),
            base_bytes=self.base, cohort=self.cohort, now=self.now)
        return planned, summary, code

    def test_three_batches_retain_unselected_and_next_price_generation(self):
        selected, snapshots = [], []
        for index in range(3):
            planned, summary, code = self.capture(name=f"batch-{index}")
            self.assertEqual(code, 0)
            selected.extend(planned.symbols)
            current = self.load()
            self.assertEqual(len(current.manifest["current"]), (index + 1) * 4)
            snapshots.append({sha: data[1] for sha, data in current.objects.items()})
        self.assertEqual(len(set(selected)), 6)
        self.assertEqual(self.next_plan()[0].symbols, ())
        self.assertTrue(all(self.load().objects[sha][1] == content for sha, content in snapshots[0].items()))
        base = json.loads(self.base)
        base["as_of_date"] = "2026-10-03"
        base["rows"].append({"symbol": "GOOG", "market": "US"})
        self.base = json.dumps(base).encode()
        self.cohort = {"symbols": [row["symbol"] for row in base["rows"]], "base_artifact_sha256": batch.digest_bytes(self.base)}
        self.now += timedelta(hours=1)
        planned, _, projected = self.next_plan()
        self.assertEqual(planned.symbols, ("GOOG",))
        self.assertTrue(all(item["financial_current"]["a"] == "2026-10-03" for item in projected.values()))
        self.assertTrue(all(item["financial_history"]["retrieved_at"] == batch.timestamp(NOW) for item in projected.values()))
        self.assertEqual(len(self.load().manifest["receipts"]), 12)

    def test_renewal_keeps_old_receipts_and_original_bytes(self):
        self.capture(count=6)
        old = self.load()
        self.now += timedelta(hours=66)
        planned, _, code = self.capture(count=6, name="renewal", refresh_through=self.now + timedelta(hours=12))
        self.assertEqual(code, 0)
        self.assertEqual(len(planned.symbols), 6)
        latest = self.load()
        self.assertEqual(len(latest.manifest["receipts"]), 24)
        self.assertTrue(all(latest.objects[sha][1] == content for sha, (_, content) in old.objects.items()))
        self.assertEqual(self.next_plan(refresh_through=self.now + timedelta(hours=12))[0].symbols, ())

    def test_expired_success_is_new_work_without_retry_decision(self):
        self.capture(count=6)
        self.now += timedelta(days=8)
        planned = self.next_plan()[0]
        self.assertEqual(len(planned.symbols), 6)
        self.assertTrue(all(r.state == "ready" for item in planned.batch for r in item.requirements))

    def test_real_sequential_getter_clocks_do_not_suppress_history_maintenance(self):
        acquire = fixtures.capture.acquire_yahoo_value
        def sequential(*args, **kwargs):
            result = acquire(*args, **kwargs)
            self.collector.now += timedelta(seconds=2)
            return result
        with patch.object(fixtures.capture, "acquire_yahoo_value", sequential):
            self.capture(count=6)
        self.now += timedelta(hours=66)
        planned = self.next_plan(refresh_through=self.now + timedelta(hours=12))[0]
        self.assertEqual(len(planned.symbols), 6)
        self.assertTrue(all(any(r.target == "annual_history" and r.state == "ready" for r in item.requirements) for item in planned.batch))
        self.now += timedelta(days=8)
        expired = self.next_plan()[0]
        self.assertEqual(len(expired.symbols), 6)
        self.assertTrue(all(any(r.target == "annual_history" and r.state == "ready" for r in item.requirements) for item in expired.batch))

    def test_missing_sixth_quarter_does_not_repeat_mandatory_acquisition(self):
        self.collector.reply = lambda symbol, attribute: (200, body(symbol, attribute, quarters=5))
        self.capture(count=6)
        planned, _, projections = self.next_plan()
        self.assertFalse(planned.symbols)
        self.assertTrue(all(item["source_diagnostics"]["fields"]["eps_q2_yoy"] == "insufficient_reported_quarters_missing_sixth_point" for item in projections.values()))

    def test_nonpositive_proved_is_acquired_and_not_growth(self):
        self.collector.reply = lambda symbol, attribute: (200, body(symbol, attribute, negative=True))
        self.capture(count=6)
        planned, _, _ = self.next_plan()
        self.assertFalse(planned.symbols)
        self.assertEqual(planned.cause_counts["eps_nonpositive_proved"], 6)

    def test_missing_annual_points_require_explicit_retry_decision(self):
        def short(symbol, attribute):
            payload = body(symbol, attribute)
            if attribute == "income_stmt":
                for row in payload["timeseries"]["result"]:
                    key = row["meta"]["type"][0]
                    row[key], row["timestamp"] = row[key][:3], row["timestamp"][:3]
            return 200, payload
        self.collector.reply = short
        self.capture(count=6)
        planned = self.next_plan()[0]
        self.assertFalse(planned.symbols)
        self.assertTrue(all(r.state == "retry_decision_required" for item in planned.required_work for r in item.requirements))
        deadline = self.now + timedelta(hours=1)
        decisions = {event["attempt_id"]: batch.timestamp(deadline) for event in self.load().manifest["attempts"].values()}
        self.assertFalse(self.next_plan(retry_decisions=decisions)[0].symbols)
        self.now = deadline
        self.assertEqual(len(self.next_plan(retry_decisions=decisions)[0].symbols), 6)
        self.directory = self.root / "seeded-only"
        self.sha = archive.create_archive(self.directory, base_bytes=self.base, cohort=self.cohort, now=self.now)
        self.sha = archive.seed_retained_acquisitions(self.directory, self.sha, artifact_dir=self.root / "batch",
            plan=self.plan, base_bytes=self.base, now=self.now)
        seeded = self.load()
        self.assertFalse(seeded.manifest["attempts"])
        rechecks = {f"{symbol}/annual_history": {
            "receipt_id": seeded.manifest["receipts"][seeded.manifest["current"][f"{symbol}/income_stmt"]]["capture_id"],
            "recheck_after": batch.timestamp(deadline)} for symbol in self.cohort["symbols"]}
        self.assertEqual(len(self.next_plan(source_rechecks=rechecks)[0].symbols), 6)
        next(iter(rechecks.values()))["receipt_id"] = "unbound"
        with self.assertRaises(archive.InvalidArchive):
            self.next_plan(source_rechecks=rechecks)

    def test_zero_or_small_denominator_is_source_limited_without_missing_period_claim(self):
        for baseline in (0, 0.01):
            with self.subTest(baseline=baseline):
                def response(symbol, attribute):
                    payload = body(symbol, attribute)
                    if attribute == "quarterly_income_stmt":
                        payload["timeseries"]["result"][0]["quarterlyDilutedEPS"][4]["reportedValue"]["raw"] = baseline
                    return 200, payload
                self.collector.reply = response
                self.directory = self.root / f"limited-{baseline}"
                self.sha = archive.create_archive(self.directory, base_bytes=self.base, cohort=self.cohort, now=self.now)
                self.capture(count=6, name=f"limited-batch-{baseline}")
                current = self.load()
                symbol = self.cohort["symbols"][0]
                acquisitions = {a: current.acquisitions[current.manifest["current"][f"{symbol}/{a}"]] for a in batch.ATTRIBUTES}
                status, projection = archive.project_symbol(symbol, acquisitions, now=self.now, as_of="2026-10-02")
                self.assertEqual(status.eps.state, "source_limited")
                self.assertEqual(status.eps.source_reason, "nonpositive_comparison_base" if baseline == 0 else "comparison_base_below_minimum")
                field = str(fixtures.FINANCIAL_FIELDS.index("eps_growth_yy"))
                self.assertNotIn(field, projection["financial_current"]["p"])
                self.assertIsNone(projection["envelope"]["eps_growth_yy"])
                self.assertFalse(self.next_plan()[0].symbols)

    def test_annual_period_expiry_becomes_due_inside_receipt_72h(self):
        def response(symbol, attribute):
            payload = body(symbol, attribute)
            if attribute == "income_stmt":
                periods = ["2025-04-02", "2024-04-02", "2023-04-02", "2022-04-02", "2021-04-02"]
                for row in payload["timeseries"]["result"]:
                    key = row["meta"]["type"][0]
                    for item, period in zip(row[key], periods):
                        item["asOfDate"] = period
                    row["timestamp"] = [int(fixtures.pd.Timestamp(period, tz="UTC").timestamp()) for period in periods]
            return 200, payload
        self.collector.reply = response
        self.capture(count=6)
        self.assertFalse(self.next_plan()[0].symbols)
        self.now += timedelta(days=1)
        planned, _, projections = self.next_plan()
        self.assertEqual(len(planned.symbols), 6)
        self.assertTrue(all(item["source_diagnostics"]["annual_history"] == "stale_reporting_period" for item in projections.values()))
        self.assertTrue(all(any(r.target == "annual_history" and r.state == "ready" for r in item.requirements) for item in planned.batch))

    def test_global_403_survives_ticker_leaving_cohort(self):
        self.collector.reply = lambda *args: (403, {})
        _, summary, code = self.capture(count=2)
        self.assertEqual(code, 2)
        offending = next(iter(self.load().manifest["attempts"].values()))["symbol"]
        self.cohort = {**self.cohort, "symbols": [s for s in self.cohort["symbols"] if s != offending]}
        planned = self.next_plan()[0]
        self.assertEqual(planned.provider_state, "provider_retry_decision_required")
        self.assertFalse(planned.symbols)
        self.assertTrue(self.load().manifest["attempts"])

    def test_global_429_requires_explicit_bound_retry_and_resume(self):
        self.collector.reply = lambda *args: (429, {})
        self.capture(count=2)
        event = next(iter(self.load().manifest["attempts"].values()))
        deadline = self.now + timedelta(hours=1)
        decisions = {event["attempt_id"]: batch.timestamp(deadline)}
        self.assertEqual(self.next_plan(retry_decisions=decisions)[0].provider_state, "provider_cooldown")
        self.now = deadline
        self.assertEqual(self.next_plan(retry_decisions=decisions)[0].provider_state, "provider_resume_required")
        resumed = self.next_plan(retry_decisions=decisions,
            provider_resume=archive.planning.ProviderResume(event["attempt_id"], self.now))[0]
        self.assertEqual(resumed.provider_state, "available")
        self.assertTrue(resumed.symbols)

    def test_crash_journal_retains_inflight_and_never_marks_later_symbols(self):
        _, plan, _ = self.next_plan(batch_limit=2)
        directory = self.root / "crashed"
        with patch.object(fixtures.capture, "acquire_yahoo_value", side_effect=SystemExit("simulated process death")):
            with self.assertRaises(SystemExit):
                batch.collect(plan, self.base, directory)
        self.sha = archive.merge_batch(self.directory, self.sha, batch_dir=directory,
            plan_sha256=batch.digest_bytes((directory / "plan.json").read_bytes()),
            attempts_sha256=batch.digest_bytes((directory / "attempts.json").read_bytes()),
            cache_sha256=batch.digest_bytes((directory / "cache-manifest.json").read_bytes()),
            base_bytes=self.base, cohort=self.cohort, now=self.now)
        current = self.load()
        self.assertEqual(len(current.manifest["attempts"]), 1)
        event = next(iter(current.manifest["attempts"].values()))
        self.assertEqual(event["outcome"], "in_flight")
        planned = self.next_plan()[0]
        self.assertNotIn(event["symbol"], planned.symbols)
        self.assertEqual(len(planned.symbols), 5)

    def test_rewritten_attempt_flag_is_rejected_even_with_rehashed_manifest(self):
        self.capture(count=2)
        value = deepcopy(self.load().manifest)
        next(iter(value["attempts"].values()))["outcome"] = "failed"
        content = batch._json_bytes(value)
        (self.directory / "manifest.json").write_bytes(content)
        self.sha = batch.digest_bytes(content)
        with self.assertRaises(archive.InvalidArchive):
            self.load()

    def test_history_oldest_included_receipt_owns_clock(self):
        self.capture(count=2)
        current = self.load()
        symbol = next(iter(current.manifest["current"])).split("/")[0]
        acquisitions = {attribute: current.acquisitions[current.manifest["current"][f"{symbol}/{attribute}"]]
                        for attribute in batch.ATTRIBUTES}
        status, projection = archive.project_symbol(symbol, acquisitions, now=self.now, as_of="2026-10-02")
        included = projection["history_source_diagnostics"]["original_receipts"]
        self.assertEqual(status.annual_history.receipt.observed_at,
            min(batch.clock(item["observed_at"]) for item in included))

    def test_cli_plans_full_cohort_before_bounded_allowlist(self):
        base_path, cohort_path = self.root / "base.json", self.root / "cohort.json"
        base_path.write_bytes(self.base)
        cohort_path.write_text(json.dumps(self.cohort))
        output = self.root / "cli-plan"
        with redirect_stdout(io.StringIO()) as stdout:
            code = archive_cli(["plan", "--archive", str(self.directory), "--archive-sha256", self.sha,
                "--base", str(base_path), "--cohort", str(cohort_path), "--now", batch.timestamp(self.now),
                "--batch-limit", "2", "--output-directory", str(output)])
        self.assertEqual(code, 0)
        result = json.loads(stdout.getvalue())
        exported = read(output / "plan.json")
        self.assertEqual(result["eligible_count"], 6)
        self.assertEqual(len(exported["batch_allowlist"]), 2)
        self.assertEqual(len(exported["verified_us_cohort"]["symbols"]), 6)

    def test_failed_atomic_replace_keeps_previous_manifest_and_audit_objects(self):
        old = (self.directory / "manifest.json").read_bytes()
        _, plan, _ = self.next_plan(batch_limit=2)
        batch.collect(plan, self.base, self.root / "batch")
        summary_sha = batch.digest_bytes((self.root / "batch/summary.json").read_bytes())
        with patch.object(archive.os, "replace", side_effect=OSError("simulated interrupted commit")):
            with self.assertRaises(OSError):
                archive.merge_batch(self.directory, self.sha, batch_dir=self.root / "batch", summary_sha256=summary_sha,
                    base_bytes=self.base, cohort=self.cohort, now=self.now)
        self.assertEqual((self.directory / "manifest.json").read_bytes(), old)
        self.assertFalse(self.load().manifest["receipts"])
        self.assertTrue(list((self.directory / "objects").glob("*.json")))
        # Retrying the same explicitly hash-bound batch safely reuses orphans.
        self.sha = archive.merge_batch(self.directory, self.sha, batch_dir=self.root / "batch",
            summary_sha256=summary_sha,
            base_bytes=self.base, cohort=self.cohort, now=self.now)
        self.assertEqual(len(self.load().manifest["receipts"]), 4)

    def test_nonregular_input_and_naive_evaluation_are_rejected(self):
        with self.assertRaises(ValueError):
            archive.verify_base(self.base, self.cohort, now=self.now.replace(tzinfo=None))
        fifo = self.root / "unreadable-fifo"
        archive.os.mkfifo(fifo)
        with self.assertRaises(archive.InvalidArchive):
            archive._read(fifo)

    def test_budget_stop_does_not_mark_unattempted_symbols(self):
        planned, plan, _ = self.next_plan(batch_limit=6)
        summary, code = batch.collect(plan, self.base, self.root / "budget", max_statement_getter_calls=1)
        self.assertEqual(code, 4)
        self.sha = archive.merge_batch(self.directory, self.sha, batch_dir=self.root / "budget",
            summary_sha256=batch.digest_bytes((self.root / "budget/summary.json").read_bytes()),
            base_bytes=self.base, cohort=self.cohort, now=self.now)
        next_plan = self.next_plan()[0]
        self.assertEqual(next_plan.provider_state, "available")
        self.assertTrue(set(planned.symbols[1:]) <= set(next_plan.symbols))
        self.assertEqual(len(self.load().manifest["attempts"]), 1)

    def test_corruption_wrong_sha_and_symlinks_fail_closed(self):
        self.capture(count=2)
        current = self.load()
        with self.assertRaises(archive.InvalidArchive):
            archive.load_archive(self.directory, "0" * 64, base_bytes=self.base, cohort=self.cohort, now=self.now)
        sha = next(iter(current.manifest["receipts"]))
        path = self.directory / "objects" / f"{sha}.json"
        raw = path.read_bytes()
        path.write_bytes(raw + b" ")
        with self.assertRaises(archive.InvalidArchive):
            self.load()
        path.write_bytes(raw)
        target = self.root / "outside.json"
        target.write_bytes(raw)
        path.unlink()
        path.symlink_to(target)
        with self.assertRaises(archive.InvalidArchive):
            self.load()

    def test_future_original_completion_is_rejected_before_commit(self):
        self.capture(count=2)
        cache_path = self.root / "batch/cache-manifest.json"
        cache = read(cache_path)
        entry = next(iter(cache["acquisitions"].values()))
        path = cache_path.parent / entry["file"]
        raw = read(path)
        raw["getter_completed_at"] = batch.timestamp(self.now + timedelta(days=1))
        entry["sha256"] = batch.write_json(path, raw)
        cache_sha = batch.write_json(cache_path, cache)
        directory = self.root / "future-import"
        sha = archive.create_archive(directory, base_bytes=self.base, cohort=self.cohort, now=self.now)
        with self.assertRaises(archive.InvalidArchive):
            archive.import_cache(directory, sha, cache_manifest=cache_path, cache_sha256=cache_sha,
                plan=read(self.root / "batch/plan.json"), base_bytes=self.base, now=self.now)
        self.assertEqual(batch.digest_bytes((directory / "manifest.json").read_bytes()), sha)

    def test_cache_export_rejects_traversal_symlink_and_preserves_exact_bytes(self):
        self.capture(count=2)
        planned, plan, _ = self.next_plan()
        selected = list(self.load().manifest["current"])[0].split("/")[0]
        plan["selected"] = [{"symbol": selected, "attributes": list(batch.ATTRIBUTES)}]
        plan["batch_allowlist"] = [selected]
        path, sha = archive.export_cache(self.load(), plan, self.base, self.root / "view", now=self.now)
        index = read(path)
        for entry in index["acquisitions"].values():
            self.assertEqual((path.parent / entry["file"]).read_bytes(), self.load().objects[entry["sha256"]][1])
        entry = next(iter(index["acquisitions"].values()))
        entry["file"] = "../outside.json"
        batch.write_json(path, index)
        with self.assertRaises(archive.InvalidArchive):
            archive.import_cache(self.directory, self.sha, cache_manifest=path,
                cache_sha256=batch.digest_bytes(path.read_bytes()), plan=plan, base_bytes=self.base, now=self.now)

    def test_unselected_and_out_of_cohort_receipts_remain_audited(self):
        self.capture(count=2)
        current = self.load()
        kept = set(current.manifest["receipts"])
        retired = current.manifest["receipts"][next(iter(kept))]["symbol"]
        self.cohort = {**self.cohort, "symbols": [s for s in self.cohort["symbols"] if s != retired]}
        self.assertNotIn(retired, self.next_plan()[0].symbols)
        self.assertEqual(kept, set(self.load().manifest["receipts"]))

    def test_capacity_and_concurrent_generation_fail_without_manifest_swap(self):
        old = (self.directory / "manifest.json").read_bytes()
        with patch.object(archive, "MAX_OBJECTS", 0):
            with self.assertRaises(archive.InvalidArchive):
                self.capture(count=2)
        self.assertEqual((self.directory / "manifest.json").read_bytes(), old)
        with self.assertRaises(archive.InvalidArchive):
            archive._commit(self.directory, self.load().manifest, {}, "0" * 64)


if __name__ == "__main__":
    unittest.main()
