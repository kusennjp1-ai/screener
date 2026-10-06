from copy import deepcopy
from datetime import date, datetime
import base64
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from app.scripts.stage_daily_price_source import GitHubStore, encoded, promote, sha
from app.services.close_price_contract import CloseSession


class FakeStore(GitHubStore):
    repository = "owner/repo"
    ref = "data/daily-price-pointers"
    path = "daily-price-latest-us.json"

    def __init__(self, capture):
        self.pointer = deepcopy(capture)
        self.assets = {"old-immutable.gz": b"prior exact bytes"}
        self.operations = []
        self.race = False
        self.upload_failure = False
        self.main_sha = "c" * 40
        self.main_ref = "refs/heads/main"
        self.policy = {"schema_version": "daily-price-promotion-rollout-v1", "enabled": True,
            "pointer_ref": self.ref, "pointer_path": self.path}
        self.api_reads = []
        self.advance_during_policy_read = False
        self.advance_during_upload = False
        self.disable_during_upload = False

    def api(self, endpoint, payload=None):
        assert payload is None, "Authority checks must only read"
        self.api_reads.append(endpoint)
        if endpoint == f"repos/{self.repository}/git/ref/heads/main":
            return {"ref": self.main_ref, "object": {"type": "commit", "sha": self.main_sha}}
        assert endpoint == f"repos/{self.repository}/contents/.github/daily-price-promotion.json?ref={'c' * 40}"
        raw = encoded(self.policy)
        if self.advance_during_policy_read:
            self.main_sha = "d" * 40
        return {"encoding": "base64", "type": "file", "content": base64.b64encode(raw).decode(),
            "sha": hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()}

    def capture(self):
        return deepcopy(self.pointer)

    def immutable(self, path, name, expected):
        self.authority_reads_before_upload = len(self.api_reads)
        self.operations.append("immutable")
        if self.upload_failure:
            raise OSError("upload failed")
        data = Path(path).read_bytes()
        if name in self.assets and self.assets[name] != data:
            raise ValueError("immutable collision")
        self.assets[name] = data
        if self.race:
            self.pointer["content_sha"] = "concurrent winner"
        if self.advance_during_upload:
            self.main_sha = "d" * 40
        if self.disable_during_upload:
            self.policy["enabled"] = False

    def replace_pointer(self, capture, manifest, pre_write_check=lambda: None):
        if self.capture() != capture:
            raise ValueError("predecessor changed")
        pre_write_check()
        self.authority_reads_before_pointer = len(self.api_reads)
        self.operations.append("pointer")
        self.pointer["manifest"] = deepcopy(manifest)


class StagedPriceSourceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.bundle = self.root / "candidate.gz"; self.manifest = self.root / "manifest.json"
        self.now = datetime.fromisoformat("2026-10-05T20:20:00+00:00")
        self.session = CloseSession(date(2026, 10, 5), datetime.fromisoformat("2026-10-05T20:00:00+00:00"),
            datetime.fromisoformat("2026-10-05T20:05:00+00:00"), datetime.fromisoformat("2026-10-05T21:00:00+00:00"))
        prior = {"AAA": "XNYS"}
        self.capture = {"schema_version": "daily-price-predecessor-v1", "repository": "owner/repo", "ref": "data/daily-price-pointers", "path": "daily-price-latest-us.json", "content_sha": "a" * 40, "manifest_sha256": "b" * 64,
            "manifest": {"schema_version": "daily-price-manifest-v1", "market": "US", "bar_period": "2y", "generated_at": "2026-10-02T20:10:00Z", "as_of_date": "2026-10-02", "min_symbol_coverage": .9, "allow_stale_complete": False,
                "required_cohort": prior, "required_cohort_sha256": sha(encoded(prior)), "nontrading_exclusions": []}}
        self.data = {"schema_version": "daily-price-bundle-v1", "market": "US", "as_of_date": "2026-10-05", "generated_at": "2026-10-05T20:10:00Z", "source_revision": "fixture:1", "bar_period": "2y", "require_complete": True,
            "symbol_scope": "active_market", "symbol_count": 2, "symbol_universe_count": 2, "missing_symbol_count": 0, "stale_symbol_count": 0, "covered_symbol_count": 2, "symbol_coverage": 1., "min_symbol_coverage": 1., "allow_stale_complete": False,
            "rows": [{"symbol": s, "exchange": e, "prices": [{"date": "2026-10-05", "open": 12., "high": 13., "low": 11., "close": 12.5, "volume": 100}]} for s, e in (("AAA", "NYSE"), ("BBB", "NASDAQ"))]}
        self.downstream = {"schema_version": "daily-source-downstream-v1", "as_of_date": "2026-10-05", "quality_passed": True,
            "rows": [{"symbol": s, "market": "US", "exchange": e, "as_of_date": "2026-10-05", "current_price": 12.5, "adv_usd": 30_000_000, "chart_as_of": "2026-10-05", "chart_last_date": "2026-10-05", "chart_close": 12.5} for s, e in (("AAA", "XNYS"), ("BBB", "XNAS"))]}
        self.store = FakeStore(self.capture)
        self.save()

    def save(self):
        self.bundle.write_bytes(gzip.compress(encoded(self.data)))
        self.metadata = {k: v for k, v in self.data.items() if k != "rows"}
        self.metadata.update(schema_version="daily-price-manifest-v1", sha256=sha(self.bundle.read_bytes()))
        self.manifest.write_bytes(encoded(self.metadata))

    def run_promotion(self, **overrides):
        return promote(store=self.store, capture=self.capture, bundle_path=self.bundle, manifest_path=self.manifest,
            downstream=self.downstream, session=self.session, now=self.now,
            **({'controller_sha': 'c' * 40, 'controller_ref': 'refs/heads/main',
                'clock': lambda: self.now, 'session_resolver': lambda now: self.session.session} | overrides))

    def test_healthy_candidate_is_immutable_then_conditionally_pointed(self):
        result = self.run_promotion(); value = result['manifest']
        self.assertEqual(self.store.operations, ["immutable", "pointer"])
        self.assertEqual(self.store.assets["old-immutable.gz"], b"prior exact bytes")
        self.assertIn(value["sha256"], value["bundle_asset_name"])
        self.assertEqual(value["required_cohort"], {"AAA": "XNYS", "BBB": "XNAS"})
        self.assertEqual(value["previous_manifest_sha256"], self.capture["manifest_sha256"])
        self.assertNotIn('deadline_exceeded', value['close_audit'])
        self.assertFalse(result['publication_receipt']['deadline_exceeded'])
        self.assertEqual(self.store.authority_reads_before_upload, 3)
        self.assertEqual(self.store.authority_reads_before_pointer, 6)
        self.assertEqual(value['controller_authority']['commit'], 'c' * 40)
        self.assertEqual(result['publication_receipt']['controller_authority'], value['controller_authority'])

    def test_newer_main_controller_blocks_before_immutable_upload(self):
        self.store.main_sha = 'd' * 40
        with self.assertRaisesRegex(ValueError, 'Current main controller advanced'):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])
        self.assertEqual(self.store.pointer, self.capture)

    def test_main_advance_during_upload_preserves_predecessor(self):
        self.store.advance_during_upload = True
        with self.assertRaisesRegex(ValueError, 'Current main controller advanced'):
            self.run_promotion()
        self.assertEqual(self.store.operations, ['immutable'])
        self.assertEqual(self.store.pointer, self.capture)
        self.assertEqual(self.store.assets['old-immutable.gz'], b'prior exact bytes')

    def test_disabled_current_rollout_blocks_before_upload(self):
        self.store.policy['enabled'] = False
        with self.assertRaisesRegex(ValueError, 'rollout is disabled'):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_disabled_rollout_during_upload_preserves_predecessor(self):
        self.store.disable_during_upload = True
        with self.assertRaisesRegex(ValueError, 'rollout is disabled'):
            self.run_promotion()
        self.assertEqual(self.store.operations, ['immutable'])
        self.assertEqual(self.store.pointer, self.capture)

    def test_main_change_during_policy_read_cannot_authorize_upload(self):
        self.store.advance_during_policy_read = True
        with self.assertRaisesRegex(ValueError, 'Current main controller advanced'):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_other_ref_or_unbound_controller_cannot_authorize_upload(self):
        for args in ({'controller_ref': 'refs/heads/review'}, {'controller_ref': 'refs/tags/main'},
                     {'controller_sha': 'c' * 7}, {'controller_sha': ''}):
            with self.subTest(args=args), self.assertRaisesRegex(ValueError, 'exact main controller'):
                self.run_promotion(**args)
        self.assertEqual(self.store.api_reads, [])
        self.assertEqual(self.store.operations, [])

    def test_current_rollout_schema_and_pointer_must_match(self):
        original = deepcopy(self.store.policy)
        for key, value in (('schema_version', 'unknown'), ('enabled', 'true'),
                           ('pointer_ref', 'another-ref'), ('pointer_path', 'other.json')):
            self.store.policy = original | {key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_unverifiable_current_authority_does_not_upload(self):
        with patch.object(self.store, 'api', side_effect=OSError('main read unavailable')):
            with self.assertRaises(OSError):
                self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_rollout_file_git_blob_is_verified(self):
        head = {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': 'c' * 40}}
        policy = {'encoding': 'base64', 'type': 'file', 'content': base64.b64encode(encoded(self.store.policy)).decode(), 'sha': 'wrong'}
        with patch.object(self.store, 'api', side_effect=[head, policy]):
            with self.assertRaisesRegex(ValueError, 'Git object disagree'):
                self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_current_close_with_short_history_does_not_claim_technical_eligibility(self):
        # These fixture sources have one valid daily bar, not 252. Downstream's
        # unchanged aggregate gate can pass while this member's criteria stay
        # unavailable. Close admission must not convert that into acquisition
        # failure or rewrite the technical audit to valid.
        self.downstream["rows"][0]["technical_audit"] = {"valid": False, "bars": 1, "errors": ["252営業日分の日足が不足"]}
        original = deepcopy(self.downstream)
        value = self.run_promotion()['manifest']
        self.assertEqual(value["close_audit"]["fresh_count"], 2)
        self.assertEqual(self.downstream, original)

    def test_no_downstream_gate_means_no_upload(self):
        self.downstream["quality_passed"] = False
        with self.assertRaisesRegex(ValueError, "quality"):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_prior_liquid_member_cannot_disappear_when_new_price_is_missing(self):
        self.downstream["rows"].pop(0)
        with self.assertRaisesRegex(ValueError, "protected prior"):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_lost_liquidity_does_not_remove_prior_member(self):
        self.downstream["rows"][0]["adv_usd"] = None
        value = self.run_promotion()['manifest']
        self.assertIn("AAA", value["required_cohort"])

    def test_price_date_or_identity_mismatch_cannot_upload(self):
        for field, value in (("chart_as_of", "2026-10-02"), ("chart_last_date", "2026-10-02"), ("current_price", 20.), ("chart_close", 20.), ("exchange", "XNAS")):
            with self.subTest(field=field):
                original = deepcopy(self.downstream)
                self.downstream["rows"][0][field] = value
                with self.assertRaises(ValueError): self.run_promotion()
                self.assertEqual(self.store.operations, [])
                self.downstream = original

    def test_unknown_or_changed_prior_cohort_cannot_authorize(self):
        self.capture["manifest"]["required_cohort"] = {}
        self.store.pointer = deepcopy(self.capture)
        with self.assertRaisesRegex(ValueError, "cohort"):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_undocumented_nontrading_exclusion_is_not_accepted(self):
        self.capture["manifest"]["nontrading_exclusions"] = ["AAA"]
        self.store.pointer = deepcopy(self.capture)
        with self.assertRaisesRegex(ValueError, "dated-evidence"):
            self.run_promotion()

    def test_declared_counts_cannot_hide_stale_source(self):
        self.data["rows"][0]["prices"][-1]["date"] = "2026-10-02"; self.save()
        with self.assertRaisesRegex(ValueError, "fresh count"):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_mutated_bundle_fails_before_upload(self):
        self.bundle.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "bytes changed"):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_superseded_predecessor_fails_before_upload(self):
        self.store.pointer["content_sha"] = "new"
        with self.assertRaisesRegex(ValueError, "Predecessor"):
            self.run_promotion()
        self.assertEqual(self.store.operations, [])

    def test_race_after_upload_leaves_only_unreferenced_immutable_candidate(self):
        self.store.race = True
        with self.assertRaisesRegex(ValueError, "predecessor"):
            self.run_promotion()
        self.assertEqual(self.store.operations, ["immutable"])
        self.assertEqual(self.store.assets["old-immutable.gz"], b"prior exact bytes")
        self.assertEqual(self.store.pointer["manifest"], self.capture["manifest"])

    def test_upload_failure_leaves_previous_pointer(self):
        self.store.upload_failure = True
        with self.assertRaises(OSError): self.run_promotion()
        self.assertEqual(self.store.pointer, self.capture)

    def test_real_adapter_put_requires_expected_git_blob(self):
        store = GitHubStore("owner/repo", "data/daily-price-pointers", "daily-price-latest-us.json")
        manifest = {"as_of_date": "2026-10-05"}
        after = {**self.capture, "manifest_sha256": sha(encoded(manifest))}
        with patch.object(store, "capture", side_effect=[self.capture, after]), patch.object(store, "api", return_value={}) as api:
            store.replace_pointer(self.capture, manifest)
        payload = api.call_args.args[1]
        self.assertEqual(payload["sha"], self.capture["content_sha"])
        self.assertEqual(payload["branch"], store.ref)

    def test_deadline_is_measured_after_verified_pointer_readback(self):
        self.now = datetime.fromisoformat('2026-10-05T20:59:59+00:00')
        clocks = iter([datetime.fromisoformat('2026-10-05T21:00:30+00:00'), datetime.fromisoformat('2026-10-05T21:01:00+00:00')])
        result = self.run_promotion(clock=lambda: next(clocks))
        self.assertFalse(result['manifest']['close_audit']['validation_deadline_exceeded'])
        self.assertTrue(result['publication_receipt']['deadline_exceeded'])
        self.assertEqual(result['publication_receipt']['verified_pointer_at'], '2026-10-05T21:01:00+00:00')

    def test_session_advance_during_upload_prevents_pointer_write(self):
        later = datetime.fromisoformat('2026-10-06T20:05:00+00:00')
        with self.assertRaisesRegex(ValueError, 'Completed session advanced'):
            self.run_promotion(clock=lambda: later, session_resolver=lambda now: date(2026, 10, 6))
        self.assertEqual(self.store.operations, ['immutable'])
        self.assertEqual(self.store.pointer, self.capture)

    def test_clock_rollback_before_write_leaves_prior_pointer(self):
        with self.assertRaisesRegex(ValueError, 'clock rolled back'):
            self.run_promotion(clock=lambda: datetime.fromisoformat('2026-10-05T20:19:00+00:00'))
        self.assertEqual(self.store.operations, ['immutable'])
        self.assertEqual(self.store.pointer, self.capture)


if __name__ == "__main__":
    unittest.main()
