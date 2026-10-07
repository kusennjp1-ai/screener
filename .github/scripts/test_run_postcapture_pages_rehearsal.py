import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
import json
import shutil

spec = importlib.util.spec_from_file_location("rehearsal_supervisor", Path(__file__).with_name("run-postcapture-pages-rehearsal.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
collector_spec = importlib.util.spec_from_file_location("rehearsal_reports", Path(__file__).with_name("collect-postcapture-pages-reports.py"))
collector = importlib.util.module_from_spec(collector_spec)
collector_spec.loader.exec_module(collector)


def disabled_checkout(directory: Path) -> Path:
    """Model the diagnostic checkout without inheriting a live renewal phase."""
    root = Path(__file__).resolve().parents[2]
    checkout = directory / "checkout"
    for name in collector.CONTROL_HASHES:
        destination = checkout / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, destination)
    contracts = checkout / "contracts"
    contracts.mkdir()
    (contracts / "financial_source_postcapture_trust_v1.json").write_text(json.dumps({
        "schema_version": "financial-source-postcapture-trust-v1",
        "reviewed_requests": [],
    }))
    (contracts / "financial_source_renewal_v1.json").write_text(json.dumps({
        "schema_version": "financial-source-renewal-policy-v1",
        "publication_enabled": False,
        "reviewed_controllers": [],
        "reviewed_consumer_transitions": [],
    }))
    return checkout


class SupervisorTests(unittest.TestCase):
    def test_process_and_job_deadlines_preserve_upload_margin(self):
        self.assertEqual(module.remaining_budget(100, 100), 5700)
        self.assertEqual(module.remaining_budget(100, 100 + 20 * 60), 80 * 60)
        for now in (6100, 6101):
            with self.subTest(now=now), self.assertRaises(ValueError):
                module.remaining_budget(100, now)
        for start in (0, -1, 101):
            with self.subTest(start=start), self.assertRaises(ValueError):
                module.remaining_budget(start, 100)

    def test_stages_reject_known_insufficient_budget_without_extending_caps(self):
        self.assertEqual(module.stage_budget("publish", 100, 100 + 10 * 60), 90 * 60)
        with self.assertRaisesRegex(ValueError, "Insufficient remaining publish"):
            module.stage_budget("publish", 100, 100 + 10 * 60 + 1)
        self.assertEqual(module.stage_budget("seal", 100, 100 + 25 * 60), 75 * 60)
        self.assertEqual(module.stage_budget("carry", 100, 100 + 70 * 60), 30 * 60)

    def test_authenticated_job_clock_includes_runner_initialization(self):
        evidence = {"caller": {"job": {"started_at": "2026-10-06T17:00:00Z"}}}
        from datetime import datetime, timezone
        job = datetime(2026, 10, 6, 17, tzinfo=timezone.utc).timestamp()
        self.assertEqual(module.actual_job_start(job + 75, evidence), job)
        self.assertEqual(module.actual_job_start(job - 2, evidence), job - 2)
        evidence["caller"]["job"]["started_at"] = "2026-10-06T17:00:00"
        with self.assertRaises(ValueError):
            module.actual_job_start(job, evidence)

    def test_network_namespace_and_credentials_fail_closed(self):
        module.require_network_isolation("net:[1]", "net:[2]", {"PATH": "/bin"})
        for old, new in (("", "net:[2]"), ("net:[1]", ""), ("net:[1]", "net:[1]")):
            with self.subTest(old=old, new=new), self.assertRaises(ValueError):
                module.require_network_isolation(old, new, {})
        for name in ("GH_TOKEN", "GITHUB_TOKEN", "SEC_USER_AGENT", "PROVIDER_API_KEY", "AWS_ACCESS_TOKEN"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.require_network_isolation("net:[1]", "net:[2]", {name: "test-only"})

    def test_success_and_failure_are_durable_and_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            for code in (0, 7):
                output = Path(directory) / str(code)
                result = module.run_supervised([sys.executable, "-c", f"print('bounded test');raise SystemExit({code})"],
                                               output=output, seconds=5, environment={}, heartbeat_seconds=.01)
                self.assertEqual(result["status"], "passed" if code == 0 else "failed")
                self.assertEqual(result["exit_code"], code)
                self.assertIsNone(result["stop_reason"])
                self.assertTrue((output / "supervisor.json").is_file())
                self.assertEqual(len(result["console_sha256"]), 64)

    def test_timeout_stops_the_process_group_and_retains_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            result = module.run_supervised([sys.executable, "-c", "import time;time.sleep(20)"],
                                           output=Path(directory) / "run", seconds=.05, environment={}, heartbeat_seconds=.01)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["stop_reason"], "process_deadline")
            self.assertLess(result["elapsed_seconds"], 3)

    def test_report_collection_preserves_production_controls(self):
        root = Path(__file__).resolve().parents[2]
        for name, expected in collector.CONTROL_HASHES.items():
            with self.subTest(live_control=name):
                self.assertFalse((root / name).is_symlink())
                self.assertEqual(collector.sha(root / name), expected)
        with tempfile.TemporaryDirectory() as directory:
            checkout = disabled_checkout(Path(directory))
            self.assertEqual(collector.verify_controls(checkout), collector.CONTROL_HASHES)
            for name in collector.CONTROL_HASHES:
                with self.subTest(changed_control=name):
                    path = checkout / name
                    original = path.read_bytes()
                    path.write_bytes(original + b" ")
                    with self.assertRaisesRegex(ValueError, "live control changed"):
                        collector.verify_controls(checkout)
                    path.write_bytes(original)

    def test_report_collection_rejects_production_authority(self):
        for name, field, value in (
            ("financial_source_postcapture_trust_v1.json", "reviewed_requests", [{"test_only": True}]),
            ("financial_source_renewal_v1.json", "reviewed_controllers", [{"test_only": True}]),
            ("financial_source_renewal_v1.json", "reviewed_consumer_transitions", [{"test_only": True}]),
            ("financial_source_renewal_v1.json", "publication_enabled", True),
        ):
            with self.subTest(authority=field), tempfile.TemporaryDirectory() as directory:
                checkout = disabled_checkout(Path(directory))
                path = checkout / "contracts" / name
                control = json.loads(path.read_text())
                control[field] = value
                path.write_text(json.dumps(control))
                with self.assertRaisesRegex(ValueError, "production source or renewal authority"):
                    collector.verify_controls(checkout)

    def test_report_collection_rejects_escaped_renewal_controls(self):
        for name in ("request", "candidate", "release"):
            with self.subTest(control=name), tempfile.TemporaryDirectory() as directory:
                checkout = disabled_checkout(Path(directory))
                (checkout / f".github/financial-source-renewal-{name}.json").write_text("{}")
                with self.assertRaisesRegex(ValueError, "escaped"):
                    collector.verify_controls(checkout)

    def test_report_allowlist_excludes_pages_and_refuses_links(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            checkout = disabled_checkout(temp)
            source = temp / "postcapture-pages-fixture"
            source.mkdir()
            (source / "report.json").write_text('{"status":"failed"}')
            (source / "publication.json").write_text('{"not_a_report":true}')
            result = collector.collect(temp, temp / "reports", checkout)
            self.assertEqual(list(result["files"]), ["postcapture-pages-fixture/report.json"])
            self.assertEqual(result["errors"], [])
            (source / "report.json").unlink()
            (source / "report.json").symlink_to(source / "publication.json")
            linked = collector.collect(temp, temp / "linked-reports", checkout)
            self.assertEqual(linked["files"], {})
            self.assertEqual(linked["errors"], ["Unsafe or over-limit diagnostic report: postcapture-pages-fixture/report.json"])

    def test_workflow_limits_network_scope_and_required_ci_runs_the_reader_boundary(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/financial-postcapture-pages-rehearsal.yml").read_text()
        for text in ("contents: read", "actions: read", "timeout-minutes: 110", "node-version: '22'", "python-version: '3.11'",
                     "persist-credentials: false", "unshare --net", "env -i", "postcapture-pages-reports/"):
            self.assertIn(text, workflow)
        for text in ("pages: write", "contents: write", "actions: write", "id-token: write", "deploy-pages", "schedule:", "secrets."):
            self.assertNotIn(text, workflow)
        self.assertEqual(workflow.count("GH_TOKEN:"), 3)
        for offline in workflow.split("- name: Rehearse actual renewal")[1:]:
            self.assertNotIn("github.token", offline.split("- name: Preserve bounded", 1)[0])
        for stage in ("seal", "publish", "carry"):
            self.assertIn(f"--stage {stage}", workflow)
        self.assertEqual(workflow.count("timeout-minutes: 110"), 3)
        self.assertEqual(workflow.count("--checkpoint-sha256"), 2)
        normal = (root / ".github/workflows/ci.yml").read_text()
        for test in ("verify-postcapture-correction-source.test.mjs", "financial-postcapture-renewal.test.mjs", "verify-postcapture-correction-archive.test.py", "financial-renewal-evaluation.test.mjs"):
            self.assertIn(test, normal)

    def test_report_collection_retains_both_complete_targets_and_binding_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            checkout = disabled_checkout(temp)
            source = temp / "postcapture-pages-fixture"
            source.mkdir()
            names = ("request-target-base.json", "certified-target-base.json", "target-base-binding.json", "target-base-comparison.json")
            for name in names:
                (source / name).write_text(json.dumps({"diagnostic": name, "rows": [{"symbol": "NVDA", "price": 123}]}))
            result = collector.collect(temp, temp / "reports", checkout)
            self.assertEqual(len(result["files"]), 4)
            self.assertEqual(result["errors"], [])
            for name in names:
                self.assertEqual((temp / "reports/postcapture-pages-fixture" / name).read_bytes(), (source / name).read_bytes())


if __name__ == "__main__":
    unittest.main()
