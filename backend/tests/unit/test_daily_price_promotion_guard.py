"""Offline publisher-boundary regression; runnable with stdlib unittest."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.scripts import publish_daily_price_bundle as publisher


class DailyPricePromotionGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bundle = self.root / "daily-price-us-20261005.json.gz"
        self.manifest = self.root / "daily-price-latest-us.json"
        self.previous_manifest = self.root / "previous-manifest.json"
        self.bundle.write_bytes(b"local candidate bytes; no provider data fetched")
        # Declared metadata of the Oct 2 source imported by run 37399803339.
        # Its bundle bytes were not archived, so do not fabricate their OHLCV.
        self.previous_metadata = {
            "schema_version": "daily-price-manifest-v1", "market": "US",
            "as_of_date": "2026-10-02", "bar_period": "2y",
            "bundle_asset_name": "daily-price-us-20261002.json.gz",
            "min_symbol_coverage": 0.9, "allow_stale_complete": False,
            "symbol_count": 10477, "symbol_universe_count": 10511,
            "missing_symbol_count": 34, "stale_symbol_count": 316,
            "covered_symbol_count": 10161, "symbol_coverage": 0.966702,
        }
        self.previous_manifest.write_text(json.dumps(self.previous_metadata), encoding="utf-8")
        self.remote = {
            "daily-price-us-20261002.json.gz": b"previous Oct 2 authoritative bundle",
            self.bundle.name: b"previous authoritative bundle",
            self.manifest.name: self.previous_manifest.read_bytes(),
        }
        self.prior = self.remote.copy()
        self.operations = []

    def candidate(self, **overrides):
        value = {
            "schema_version": "daily-price-manifest-v1",
            "market": "US",
            "as_of_date": "2026-10-05",
            "bar_period": "2y",
            "bundle_asset_name": self.bundle.name,
            "sha256": hashlib.sha256(self.bundle.read_bytes()).hexdigest(),
            "require_complete": True,
            "symbol_scope": "active_market",
            "symbol_universe_count": 10,
            "symbol_count": 10,
            "missing_symbol_count": 0,
            "stale_symbol_count": 0,
            "covered_symbol_count": 10,
            "symbol_coverage": 1.0,
            "min_symbol_coverage": None,
            "allow_stale_complete": False,
        }
        value.update(overrides)
        self.manifest.write_text(json.dumps(value), encoding="utf-8")
        return value

    def fake_gh(self, args, *, check):
        self.assertTrue(check)
        self.assertEqual(args[:4], ["gh", "release", "upload", "daily-price-data"])
        self.assertEqual(args[5:], ["--clobber"])
        asset = Path(args[4])
        # Model the destructive part of gh --clobber, as well as its upload.
        self.operations.append(("delete", asset.name))
        self.remote.pop(asset.name, None)
        self.operations.append(("upload", asset.name))
        self.remote[asset.name] = asset.read_bytes()

    def promote(self, *, mode="full"):
        publisher.publish_daily_price_bundle(
            bundle_path=self.bundle, manifest_path=self.manifest, mode=mode,
            previous_manifest_path=self.previous_manifest,
        )

    def assert_rejected_without_writes(self, *, mode="full", reason):
        paths = (self.bundle, self.manifest, self.previous_manifest)
        local_before = tuple(path.read_bytes() for path in paths)
        with patch.object(publisher.subprocess, "run", side_effect=self.fake_gh) as command:
            with self.assertRaisesRegex(ValueError, reason):
                self.promote(mode=mode)
            command.assert_not_called()
        self.assertEqual(self.operations, [])
        self.assertEqual(self.remote, self.prior)
        self.assertEqual(local_before, tuple(path.read_bytes() for path in paths))

    def test_incident_1190_of_9926_cannot_upload_or_delete(self):
        # Exact recorded source-release counts from run 37399803339. The old
        # exporter did not include the two new declaration fields at all.
        value = self.candidate(
            symbol_universe_count=9926, symbol_count=5464,
            missing_symbol_count=4462, stale_symbol_count=4274,
            covered_symbol_count=1190, symbol_coverage=0.119887,
            min_symbol_coverage=None,
        )
        del value["require_complete"]
        del value["symbol_scope"]
        self.manifest.write_text(json.dumps(value), encoding="utf-8")
        self.assert_rejected_without_writes(reason="No enforced source coverage policy")

    def test_fast_candidate_is_rejected_even_if_coverage_is_complete(self):
        self.candidate()
        self.assert_rejected_without_writes(mode="prices_only", reason="Only a full refresh")

    def test_partial_candidate_cannot_use_subset_as_full_denominator(self):
        self.candidate(symbol_scope="selected_symbols")
        self.assert_rejected_without_writes(reason="Partial or unknown symbol scope")

    def test_unenforced_floor_is_not_a_promotion_policy(self):
        self.candidate(require_complete=False, min_symbol_coverage=0.9)
        self.assert_rejected_without_writes(reason="No enforced source coverage policy")

    def test_declared_source_floor_blocks_degraded_candidate(self):
        self.candidate(
            min_symbol_coverage=0.9, symbol_count=8, missing_symbol_count=2,
            covered_symbol_count=8, symbol_coverage=0.8,
        )
        self.assert_rejected_without_writes(reason="8/10 is below declared floor")

    def test_stale_histories_do_not_count_under_fresh_policy(self):
        self.candidate(stale_symbol_count=1, covered_symbol_count=9, symbol_coverage=0.9)
        self.assert_rejected_without_writes(reason="9/10 is below declared floor")

    def test_default_require_complete_policy_passes(self):
        value = self.candidate()
        self.assertEqual(publisher.validate_promotion(value, mode="full"), 1.)
        self.assert_rejected_without_writes(reason="Legacy direct publication is disabled")

    def test_default_policy_remains_declared_for_the_next_promotion(self):
        self.candidate()
        self.previous_manifest.write_bytes(self.manifest.read_bytes())
        self.assert_rejected_without_writes(reason="Legacy direct publication is disabled")

    def test_existing_cn_history_policy_passes_with_stale_histories(self):
        self.bundle = self.root / "daily-price-cn-20261005.json.gz"
        self.bundle.write_bytes(b"CN candidate fixture")
        self.manifest = self.root / "daily-price-latest-cn.json"
        self.previous_metadata.update(market="CN", allow_stale_complete=True)
        self.previous_manifest.write_text(json.dumps(self.previous_metadata), encoding="utf-8")
        self.candidate(
            market="CN", min_symbol_coverage=0.9, allow_stale_complete=True,
            symbol_count=9, missing_symbol_count=1, stale_symbol_count=8,
            covered_symbol_count=9, symbol_coverage=0.9,
        )
        self.assertEqual(publisher.validate_promotion(json.loads(self.manifest.read_text()), mode="full"), .9)
        self.assert_rejected_without_writes(reason="Legacy direct publication is disabled")

    def test_previous_fresh_policy_cannot_be_weakened(self):
        for override in ({"min_symbol_coverage": 0.1}, {"allow_stale_complete": True}):
            with self.subTest(override=override):
                self.candidate(**override)
                self.assert_rejected_without_writes(reason="weakens the previous")

    def test_unknown_previous_policy_fails_closed(self):
        self.previous_metadata["min_symbol_coverage"] = None
        self.previous_manifest.write_text(json.dumps(self.previous_metadata), encoding="utf-8")
        self.candidate()
        self.assert_rejected_without_writes(reason="Previous source coverage policy is unknown")

    def test_invalid_coverage_evidence_fails_closed(self):
        for override in (
            {"min_symbol_coverage": 0}, {"min_symbol_coverage": float("nan")},
            {"covered_symbol_count": 11}, {"symbol_coverage": 0.99},
            {"symbol_scope": None}, {"allow_stale_complete": "false"},
        ):
            with self.subTest(override=override):
                self.candidate(**override)
                self.assert_rejected_without_writes(reason="policy|coverage|scope")

    def test_wrong_bundle_bytes_cannot_clobber_release(self):
        self.candidate()
        self.bundle.write_bytes(b"changed after manifest was generated")
        self.assert_rejected_without_writes(reason="does not match")


if __name__ == "__main__":
    unittest.main()
