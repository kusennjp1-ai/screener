"""Portable tests of preview provenance and the network-boundary validator."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import shlex
from types import SimpleNamespace
import unittest
from urllib.parse import urlsplit

spec = importlib.util.spec_from_file_location("offline_check", Path(__file__).with_name("price-pilot-offline-check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class OfflineHarnessTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.env = {
            "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REPOSITORY": "example/screener", "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_RUN_ID": "12345", "GITHUB_RUN_NUMBER": "9", "GITHUB_RUN_ATTEMPT": "2",
            "GITHUB_SHA": self.sha, "GITHUB_WORKFLOW_SHA": self.sha,
            "PRICE_PILOT_EXPECTED_SHA": self.sha,
            "GITHUB_REF": f"refs/heads/{check.BRANCH}", "GITHUB_REF_NAME": check.BRANCH,
            "GITHUB_WORKFLOW_REF": f"example/screener/{check.WORKFLOW_PATH}@refs/heads/{check.BRANCH}",
        }

    def test_exact_attempt_and_sha_are_retained_without_capture_authority(self):
        value = check.provenance(self.env, self.sha, True)
        self.assertEqual(value["run_attempt"], "2")
        self.assertEqual(value["sha"], self.sha)
        self.assertEqual(value["run_attempt_url"], "https://github.com/example/screener/actions/runs/12345/attempts/2")
        self.assertFalse(value["capture_approved"])
        self.assertFalse(value["publication_authority"])
        self.assertFalse(value["global_provider_budget_verified"])

    def test_exact_branch_push_can_discover_a_new_workflow(self):
        self.env["GITHUB_EVENT_NAME"] = "push"
        self.assertEqual(check.provenance(self.env, self.sha, True)["event"], "push")

    def test_every_binding_is_required(self):
        for key in self.env:
            with self.subTest(key=key):
                env = self.env.copy()
                del env[key]
                with self.assertRaises(ValueError):
                    check.provenance(env, self.sha, True)

    def test_main_tags_unexpected_events_and_workflows_are_rejected(self):
        for key, bad in (
            ("GITHUB_REF", "refs/heads/main"), ("GITHUB_REF", "refs/tags/preview"),
            ("GITHUB_REF_NAME", "main"), ("GITHUB_EVENT_NAME", "schedule"),
            ("GITHUB_EVENT_NAME", "pull_request_target"), ("GITHUB_ACTIONS", "false"),
            ("GITHUB_WORKFLOW_REF", "example/screener/.github/workflows/other.yml@refs/heads/main"),
            ("GITHUB_REPOSITORY", "wrong owner/repo"), ("GITHUB_SERVER_URL", "https://example.org"),
        ):
            with self.subTest(key=key, bad=bad):
                env = {**self.env, key: bad}
                with self.assertRaises(ValueError):
                    check.provenance(env, self.sha, True)

    def test_mismatched_shas_and_dirty_checkout_are_rejected(self):
        for key in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "PRICE_PILOT_EXPECTED_SHA"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                check.provenance({**self.env, key: "b" * 40}, self.sha, True)
        with self.assertRaises(ValueError):
            check.provenance(self.env, self.sha, False)

    def test_invalid_run_identities_are_rejected(self):
        for key in ("GITHUB_RUN_ID", "GITHUB_RUN_NUMBER", "GITHUB_RUN_ATTEMPT"):
            for bad in ("0", "-1", "1.0", "01", "one"):
                with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                    check.provenance({**self.env, key: bad}, self.sha, True)

    def test_only_loopback_is_accepted(self):
        check.assert_disconnected(["lo"])
        for interfaces in ([], ["eth0"], ["lo", "eth0"], ["lo", "wlan0"]):
            with self.subTest(interfaces=interfaces), self.assertRaises(ValueError):
                check.assert_disconnected(interfaces)

    def test_required_database_import_configuration_is_inert_and_exact(self):
        env={'DATABASE_URL':check.OFFLINE_DATABASE_URL,'REDIS_ENABLED':'false'}
        settings=SimpleNamespace(database_url=check.OFFLINE_DATABASE_URL,redis_enabled=False)
        check.assert_inert_configuration(env,settings)
        parsed=urlsplit(check.OFFLINE_DATABASE_URL)
        self.assertIsNone(parsed.username)
        self.assertIsNone(parsed.password)
        self.assertIsNone(parsed.port)
        self.assertEqual(parsed.hostname,'price-pilot-unused.invalid')
        for bad in (None,'','postgresql://localhost/real','postgresql://user:password@db.example/real',
                    'postgresql://user:password@price-pilot-unused.invalid/price_pilot_unused'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                check.assert_inert_configuration({**env,'DATABASE_URL':bad})
        with self.assertRaises(ValueError):
            check.assert_inert_configuration(env,SimpleNamespace(database_url='different',redis_enabled=False))
        with self.assertRaises(ValueError):
            check.assert_inert_configuration({**env,'REDIS_ENABLED':'true'})

    def test_database_url_is_supplied_only_to_disconnected_test_container(self):
        shell=Path(__file__).with_name('price-pilot-offline.sh').read_text()
        before, test=shell.split('docker create --name "$test_name" --network none',1)
        self.assertNotIn('DATABASE_URL',before)
        command=test.split('# Inspect the actual launched configuration',1)[0]
        self.assertIn('DATABASE_URL='+check.OFFLINE_DATABASE_URL,shlex.split(command))
        self.assertEqual(shell.count('DATABASE_URL='),1)
        dockerfile=Path(__file__).with_name('price-pilot-offline.Dockerfile').read_text()
        self.assertNotIn('DATABASE_URL',dockerfile)

    def test_actual_container_network_mode_and_port_exposure_are_checked(self):
        records = [{"Name": f"test-{n}", "Id": str(n), "Image": "sha256:test",
                    "HostConfig": {"NetworkMode": "none", "PortBindings": {}}} for n in range(3)]
        self.assertEqual(len(check.inspect_containers(records)), 3)
        for index in range(3):
            for field, bad in (("NetworkMode", "bridge"), ("NetworkMode", "host"),
                               ("PortBindings", {"6379/tcp": [{"HostPort": "6379"}]})):
                mutated = deepcopy(records)
                mutated[index]["HostConfig"][field] = bad
                with self.subTest(index=index, field=field, bad=bad), self.assertRaises(ValueError):
                    check.inspect_containers(mutated)
        with self.assertRaises(ValueError):
            check.inspect_containers(records[:2])


if __name__ == "__main__":
    unittest.main(verbosity=2)
