"""Offline correction adapter coverage using authentic synthetic receipts."""
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from datetime import timedelta
import io
import json
import unittest
from unittest.mock import patch

from app.scripts import export_statement_projection as exporter
from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.financial_source_evidence import FINANCIAL_FIELDS, validate_envelope
from tests.unit import test_financial_statement_batch as fixtures


class TestExportStatementProjection(unittest.TestCase):
    def setUp(self):
        self.collector = fixtures.TestFinancialStatementBatch()
        self.collector.setUp()
        self.addCleanup(self.collector.doCleanups)
        self.root = self.collector.root
        plan, content = fixtures.plan_for(("NVDA", "AMD", "VIRT"))
        base = json.loads(content)
        for row in base["rows"]:
            row.update(current_price=123.5, adv_usd=20000000,
                       annual_eps_growth_3y=[900, 900, 900], eps_growth_yy=999,
                       eps_growth_annual=999, roe=999, eps_rating=99,
                       financial_history={"annual": [{"eps": 999}]})
        self.base = exporter.canonical_bytes(base)
        plan["verified_us_cohort"]["base_artifact_sha256"] = batch.digest_bytes(self.base)
        plan["batch_allowlist"] = ["NVDA"]
        plan["selected"] = [{"symbol": "NVDA", "attributes": list(batch.ATTRIBUTES)}]
        self.cohort = plan["verified_us_cohort"]
        acquire = fixtures.capture.acquire_yahoo_value

        def sequential(*args, **kwargs):
            result = acquire(*args, **kwargs)
            self.collector.now += timedelta(seconds=2)
            return result

        with patch.object(fixtures.capture, "acquire_yahoo_value", sequential):
            _, code = batch.collect(plan, self.base, self.root / "capture")
        self.assertEqual(code, 0)
        self.now = self.collector.now
        self.archive = self.root / "archive"
        initial = archive.create_archive(self.archive, base_bytes=self.base,
                                         cohort=self.cohort, now=self.now)
        self.archive_sha = archive.seed_retained_acquisitions(
            self.archive, initial, artifact_dir=self.root / "capture", plan=plan,
            base_bytes=self.base, now=self.now)
        (self.root / "base.json").write_bytes(self.base)
        (self.root / "cohort.json").write_bytes(exporter.canonical_bytes(self.cohort))
        (self.root / "target-base.json").write_bytes(self.base)
        self.kwargs = {
            "archive_dir": self.archive, "archive_sha256": self.archive_sha,
            "base_path": self.root / "base.json", "cohort_path": self.root / "cohort.json",
            "cohort_sha256": batch.digest_bytes((self.root / "cohort.json").read_bytes()),
            "target_base_path": self.root / "target-base.json",
            "target_base_sha256": batch.digest_bytes(self.base),
            "target_publication_identity": "123/1/" + "a" * 64 + "/" + "b" * 64,
            "evaluated_at": batch.timestamp(self.now), "output_dir": self.root / "projection",
        }

    def export(self, **changes):
        summary = exporter.export_projection(**{**self.kwargs, **changes})
        from pathlib import Path
        content = Path(summary["projection_path"]).read_bytes()
        self.assertEqual(batch.digest_bytes(content), summary["projection_sha256"])
        return json.loads(content), summary

    def target(self, value):
        content = exporter.canonical_bytes(value)
        self.kwargs["target_base_path"].write_bytes(content)
        self.kwargs["target_base_sha256"] = batch.digest_bytes(content)

    def test_original_distinct_receipt_clocks_and_all_explicit_owners(self):
        projection, summary = self.export()
        self.assertEqual(summary["symbol_count"], 3)
        self.assertEqual(projection["schema_version"], exporter.SCHEMA)
        self.assertEqual(projection["knowledge_basis"], exporter.KNOWLEDGE_BASIS)
        self.assertFalse(projection["point_in_time"])
        self.assertIsNone(projection["source_publication_date"])
        nvda = projection["symbols"]["NVDA"]
        self.assertEqual(set(nvda["financial_values"]), set(exporter.OWNED_FIELDS))
        self.assertEqual(nvda["as_of_date"], "2026-10-02")
        receipts = {entry["attribute"]: entry for entry in nvda["source_receipts"]}
        quarter, annual = receipts["quarterly_income_stmt"], receipts["income_stmt"]
        self.assertEqual(quarter["observed_at"], batch.timestamp(fixtures.NOW))
        self.assertEqual(annual["observed_at"], batch.timestamp(fixtures.NOW + timedelta(seconds=2)))
        self.assertEqual(nvda["financial_history"]["retrieved_at"], quarter["observed_at"])
        evidence = validate_envelope(nvda["financial_source_evidence"])
        for field, attribute in (("eps_growth_yy", "quarterly_income_stmt"), ("eps_5yr_cagr", "income_stmt")):
            self.assertEqual(evidence["fields"][field]["observed_at"], receipts[attribute]["observed_at"])
            self.assertEqual(evidence["fields"][field]["capture_id"], receipts[attribute]["capture_id"])
        self.assertEqual(projection["receipt_inventory_sha256"], exporter.content_digest(projection["receipt_inventory"]))
        self.assertEqual(nvda["financial_values"]["eps_growth_annual"], nvda["financial_values"]["eps_growth_yy"])
        self.assertIsNone(nvda["financial_values"]["roe"])
        self.assertIsNone(nvda["financial_values"]["annual_eps_growth_3y"])

    def test_missing_symbols_remain_explicit_unknown_without_old_fallback(self):
        projection, _ = self.export()
        self.assertEqual(set(projection["symbols"]), set(self.cohort["symbols"]))
        for name in ("AMD", "VIRT"):
            item = projection["symbols"][name]
            self.assertTrue(all(item["financial_values"][field] is None for field in FINANCIAL_FIELDS))
            self.assertIsNone(item["financial_values"]["eps_growth_annual"])
            self.assertEqual(item["source_receipts"], [])
            self.assertEqual(item["financial_current"]["p"], {})
            self.assertEqual(item["financial_source_evidence"]["fields"], {})
            self.assertEqual(item["financial_history"]["annual"], [])
            self.assertEqual(item["financial_history"]["quarterly"], [])
            self.assertEqual(item["history_source_diagnostics"]["reasons"]["annual"], "fetch_gap")
            self.assertEqual(item["instrument_applicability"]["status"], "unverified")
            self.assertEqual(item["financial_identity"]["status"], "ticker_only")
            self.assertEqual(item["financial_identity"]["registry_identifiers"], {})
            self.assertFalse(item["financial_identity"]["identifiers_bound_to_financial_receipts"])

    def test_only_three_reviewed_fund_records_have_known_applicability(self):
        records = exporter.instrument_registry()
        self.assertEqual(set(records), {"BITU", "SBIT", "ETHE"})
        self.assertEqual(records["BITU"]["cusip"], "74349Y704")
        self.assertEqual(records["SBIT"]["cusip"], "74349Y563")
        self.assertEqual(records["ETHE"]["cik"], "0001725210")
        self.assertEqual(records["ETHE"]["cusip"], "389638107")
        self.assertEqual(records["ETHE"]["isin"], "US3896381072")
        applicability, identity = exporter.instrument_context("BITU", records, {})
        self.assertEqual(applicability["status"], "quarantined")
        self.assertEqual(applicability["identity_conflicts"], ["market_conflict", "missing_product_name"])
        self.assertIsNone(identity["observed_name"])
        self.assertEqual(identity["registry_name"], "ProShares Ultra Bitcoin ETF")
        self.assertEqual(identity["registry_identifiers"], {"cusip": "74349Y704"})
        self.assertFalse(identity["identifiers_bound_to_price"])
        _, identity = exporter.instrument_context("BITU", records, {"name": "Actual published name"})
        self.assertEqual(identity["observed_name"], "Actual published name")
        self.assertEqual(identity["registry_name"], "ProShares Ultra Bitcoin ETF")

    def test_name_and_actual_identifier_conflicts_are_quarantined(self):
        records = exporter.instrument_registry()
        matching = {"symbol": "BITU", "market": "US", "company_name": "  PROSHARES  ULTRA BITCOIN ETF "}
        matched, _ = exporter.instrument_context("BITU", records, matching)
        self.assertEqual(matched["status"], "not_applicable")
        self.assertEqual(matched["identity_binding"], "ticker_name_only")
        identified, identity = exporter.instrument_context("BITU", records, {**matching, "cusip": "74349Y704"})
        self.assertEqual(identified["identity_binding"], "ticker_name_and_available_identifiers")
        self.assertEqual(identity["observed_identifiers"], {"cusip": "74349Y704"})
        for altered, expected in (
            ({"company_name": "Different issuer"}, "product_name_conflict"),
            ({"cusip": "000000000"}, "cusip_conflict"),
            ({"market": "CA"}, "market_conflict"),
            ({"symbol": "OTHER"}, "symbol_conflict"),
            ({"financial_identity": {"observed_name": "Legacy issuer"}}, "product_name_conflict"),
        ):
            with self.subTest(altered=altered):
                quarantined, _ = exporter.instrument_context("BITU", records, {**matching, **altered})
                self.assertEqual(quarantined["status"], "quarantined")
                self.assertIn(expected, quarantined["identity_conflicts"])
        # Registry IDs carried in public metadata never become observed IDs.
        unbound, _ = exporter.instrument_context("BITU", records, {
            **matching, "financial_identity": {"registry_identifiers": {"cusip": "000000000"}}})
        self.assertEqual(unbound["status"], "not_applicable")
        self.assertEqual(unbound["matched_identifiers"], [])

    def test_quarantine_clears_current_growth_and_history(self):
        projection, _ = self.export()
        item = deepcopy(projection["symbols"]["NVDA"])
        exporter.apply_instrument_context(item, "BITU", exporter.instrument_registry(),
                                          target_row={"symbol": "BITU", "market": "US"},
                                          now=self.now, as_of="2026-10-02")
        self.assertEqual(item["instrument_applicability"]["status"], "quarantined")
        self.assertTrue(all(value is None for value in item["financial_values"].values()))
        self.assertEqual(item["financial_current"]["p"], {})
        self.assertEqual(item["financial_history"]["annual"], [])
        self.assertEqual(item["financial_history"]["quarterly"], [])
        self.assertEqual(item["source_diagnostics"]["annual_history"], "instrument_identity_conflict")

    def test_reviewed_funds_never_have_current_growth_or_retained_history(self):
        plan, content = fixtures.plan_for(("BITU", "SBIT", "ETHE", "NVDA"))
        base = json.loads(content)
        for row in base["rows"]:
            if row["symbol"] in exporter.instrument_registry():
                row["company_name"] = exporter.instrument_registry()[row["symbol"]]["name"]
            row.update(current_price=30, adv_usd=50000000, eps_growth_yy=999,
                       annual_eps_growth_3y=[99, 99, 99], financial_history={"annual": [{"eps": 999}]})
        content = exporter.canonical_bytes(base)
        plan["verified_us_cohort"]["base_artifact_sha256"] = batch.digest_bytes(content)
        fixtures.YfData().cache_get.cache_clear()
        _, code = batch.collect(plan, content, self.root / "fund-capture")
        self.assertEqual(code, 0)
        archive_path = self.root / "fund-archive"
        sha = archive.create_archive(archive_path, base_bytes=content, cohort=plan["verified_us_cohort"], now=self.now)
        sha = archive.seed_retained_acquisitions(archive_path, sha, artifact_dir=self.root / "fund-capture",
                                               plan=plan, base_bytes=content, now=self.now)
        self.kwargs["base_path"].write_bytes(content)
        self.target(base)
        self.kwargs["cohort_path"].write_bytes(exporter.canonical_bytes(plan["verified_us_cohort"]))
        projection, _ = self.export(archive_dir=archive_path, archive_sha256=sha,
                                   cohort_sha256=batch.digest_bytes(self.kwargs["cohort_path"].read_bytes()))
        self.assertEqual(set(projection["symbols"]), {"BITU", "SBIT", "ETHE", "NVDA"})
        for symbol in ("BITU", "SBIT", "ETHE"):
            item = projection["symbols"][symbol]
            self.assertEqual(item["instrument_applicability"]["status"], "not_applicable")
            self.assertTrue(all(value is None for value in item["financial_values"].values()))
            self.assertEqual(item["financial_current"]["p"], {})
            self.assertNotIn("0", item["financial_current"]["r"])
            self.assertEqual(item["financial_history"]["annual"], [])
            self.assertEqual(item["financial_history"]["quarterly"], [])
            self.assertIsNone(item["financial_history"]["retrieved_at"])
            self.assertEqual(item["source_diagnostics"]["annual_history"], "not_applicable")
            self.assertEqual(len(item["source_receipts"]), 2)
            self.assertTrue(item["financial_source_evidence"]["fields"])
        self.assertTrue(projection["symbols"]["NVDA"]["financial_current"]["p"])

    def test_replays_frames_without_cached_results_or_any_provider(self):
        cached = self.root / "capture" / "results" / "NVDA.json"
        cached.write_text('{"eps_growth_yy":123456,"financial_current":{"r":"0000000000000000"}}')
        with patch.object(batch, "runtime", side_effect=AssertionError("Provider runtime forbidden")), \
                patch.object(fixtures.yf, "Ticker", side_effect=AssertionError("Provider forbidden")), \
                patch.object(fixtures.requests.Session, "request", side_effect=AssertionError("Network forbidden")):
            projection, _ = self.export()
        self.assertEqual(projection["symbols"]["NVDA"]["financial_values"]["eps_growth_yy"], 200)

    def test_missing_annual_source_cannot_resurrect_base_history_or_growth(self):
        plan, _ = fixtures.plan_for(tuple(self.cohort["symbols"]))
        plan["verified_us_cohort"] = self.cohort
        plan["batch_allowlist"] = ["NVDA"]
        plan["selected"] = [{"symbol": "NVDA", "attributes": ["quarterly_income_stmt"]}]
        directory = self.root / "quarter-only-archive"
        sha = archive.create_archive(directory, base_bytes=self.base, cohort=self.cohort, now=self.now)
        inputs = self.root / "quarter-only-input"
        (inputs / "acquisitions").mkdir(parents=True)
        filename = "NVDA-quarterly_income_stmt.json"
        (inputs / "acquisitions" / filename).write_bytes((self.root / "capture" / "acquisitions" / filename).read_bytes())
        sha = archive.seed_retained_acquisitions(directory, sha, artifact_dir=inputs,
                                               plan=plan, base_bytes=self.base, now=self.now)
        projection, _ = self.export(archive_dir=directory, archive_sha256=sha)
        item = projection["symbols"]["NVDA"]
        self.assertEqual(item["financial_values"]["eps_growth_yy"], 200)
        self.assertIsNone(item["financial_values"]["annual_eps_growth_3y"])
        self.assertIsNone(item["financial_values"]["eps_5yr_cagr"])
        self.assertEqual(item["financial_history"]["annual"], [])
        self.assertEqual(item["history_source_diagnostics"]["reasons"]["annual"], "fetch_gap")
        self.assertEqual([item["attribute"] for item in item["source_receipts"]], ["quarterly_income_stmt"])

    def test_digest_and_publication_identity_rejections(self):
        for key in ("archive_sha256", "cohort_sha256", "target_base_sha256"):
            for value in ("0" * 64, "ABC", None):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.export(**{key: value})
        for value in ("", "current", "123/0/" + "a" * 64 + "/" + "b" * 64):
            with self.subTest(identity=value), self.assertRaises(ValueError):
                self.export(target_publication_identity=value)
        self.assertFalse(self.kwargs["output_dir"].exists())

    def test_acquisition_base_bytes_cannot_be_rewritten(self):
        changed = json.loads(self.base)
        changed["rows"][0]["current_price"] = 1000
        self.kwargs["base_path"].write_bytes(exporter.canonical_bytes(changed))
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            self.export()

    def test_exact_full_base_identity_and_price_inputs_survive_consumer_changes(self):
        first, _ = self.export()
        changed = json.loads(self.base)
        changed["financial_generation"] = "consumer-only-generation"
        changed["generated_at"] = "2026-10-04T12:01:00Z"
        changed["rows"].reverse()
        for row in changed["rows"]:
            row["eps_growth_yy"] = None
            row["canslim_score"] = None
            row["financial_current"] = {"t": 1, "p": {}}
            row["new_consumer_metadata"] = {"technical_detail": "visible"}
        self.target(changed)
        second, _ = self.export()
        self.assertNotEqual(first["bindings"]["target_base_sha256"], second["bindings"]["target_base_sha256"])
        self.assertEqual(first["bindings"]["acquisition_base_sha256"], second["bindings"]["acquisition_base_sha256"])
        self.assertEqual(first["financial_generation"], second["financial_generation"])

    def test_target_price_liquidity_date_market_or_full_universe_change_is_rejected(self):
        mutations = (
            lambda value: value["rows"][0].update(current_price=123.51),
            lambda value: value["rows"][0].update(adv_usd=20000001),
            lambda value: value["rows"][2].update(current_price=1),
            lambda value: value["rows"][0].update(market="CA"),
            lambda value: value.update(market="CA"),
            lambda value: value["rows"][0].update(as_of_date="2026-10-01"),
            lambda value: value.update(as_of_date="2026-10-03"),
            lambda value: value["rows"].pop(),
            lambda value: value["rows"].append({"symbol": "AAPL", "market": "US"}),
            lambda value: value["rows"][0].pop("adv_usd"),
        )
        for mutate in mutations:
            changed = json.loads(self.base)
            mutate(changed)
            self.target(changed)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                self.export()

    def test_original_additional_nonfinancial_inputs_cannot_change(self):
        contract, _ = exporter.policy_identity()
        original = json.loads(self.base)
        original["rows"][0]["unrecognized_price_alias"] = 987
        target = deepcopy(original)
        target["rows"][0]["unrecognized_price_alias"] = 988
        with self.assertRaisesRegex(ValueError, "price/liquidity"):
            exporter.verify_target_base(original, target, contract)

    def test_reduced_acquisition_base_can_bind_full_published_research_index(self):
        original = json.loads(self.base)
        original.update(schema_version="financial-recovery-base-v1", source={"observed_at": "2026-10-04T11:00:00Z"},
                        liquidity={"min_price_usd": 10, "min_average_dollar_volume": 20000000})
        target = {"market": "US", "as_of_date": original["as_of_date"], "rows": deepcopy(original["rows"])}
        for row in target["rows"]:
            row["rs_rating"] = 95
        contract, _ = exporter.policy_identity()
        exporter.verify_target_base(original, target, contract)

    def test_full_noncohort_identity_is_checked(self):
        # The original acquisition cohort need not include every base symbol.
        cohort = {**self.cohort, "symbols": ["NVDA"]}
        self.kwargs["cohort_path"].write_bytes(exporter.canonical_bytes(cohort))
        self.kwargs["cohort_sha256"] = batch.digest_bytes(self.kwargs["cohort_path"].read_bytes())
        self.export()
        changed = json.loads(self.base)
        changed["rows"][2]["current_price"] = 0
        self.target(changed)
        with self.assertRaisesRegex(ValueError, "price/liquidity"):
            self.export()

    def test_rebuild_and_evaluation_clock_cannot_manufacture_generation(self):
        first, one = self.export()
        with patch.object(fixtures.capture, "_utc_now", return_value=self.now + timedelta(days=99)):
            repeated, two = self.export()
        self.assertEqual(first, repeated)
        self.assertEqual(one, two)
        later, three = self.export(evaluated_at=batch.timestamp(self.now + timedelta(hours=1)))
        self.assertEqual(first["financial_generation"], later["financial_generation"])
        self.assertNotEqual(one["projection_sha256"], three["projection_sha256"])
        self.assertNotEqual(first["symbols"]["NVDA"]["financial_current"]["t"], later["symbols"]["NVDA"]["financial_current"]["t"])

    def test_archive_wrapper_timestamp_is_not_financial_progress(self):
        first, _ = self.export()
        path = self.archive / "manifest.json"
        manifest = json.loads(path.read_bytes())
        manifest["committed_at"] = batch.timestamp(self.now + timedelta(minutes=1))
        path.write_bytes(exporter.canonical_bytes(manifest))
        later, _ = self.export(archive_sha256=batch.digest_bytes(path.read_bytes()),
                               evaluated_at=batch.timestamp(self.now + timedelta(hours=1)))
        self.assertEqual(first["financial_generation"], later["financial_generation"])
        self.assertNotEqual(first["bindings"]["archive_manifest_sha256"], later["bindings"]["archive_manifest_sha256"])

    def test_expired_source_recomputes_unavailable_without_clock_extension(self):
        first, _ = self.export()
        later, _ = self.export(evaluated_at=batch.timestamp(self.now + timedelta(days=8)))
        old, expired = first["symbols"]["NVDA"], later["symbols"]["NVDA"]
        self.assertEqual(old["source_receipts"], expired["source_receipts"])
        self.assertEqual(expired["financial_current"]["r"][FINANCIAL_FIELDS.index("eps_growth_yy")], "7")
        self.assertEqual(expired["financial_current"]["p"], {})
        self.assertEqual(expired["financial_history"]["annual"], [])
        self.assertEqual(expired["financial_history"]["quarterly"], [])
        self.assertEqual(expired["history_source_diagnostics"]["reasons"]["annual"], "stale_source")
        self.assertNotEqual(first["financial_generation"], later["financial_generation"])

    def test_history_expiry_is_not_extended_by_current_quarter_proof(self):
        projection, _ = self.export(evaluated_at=batch.timestamp(self.now + timedelta(days=4)))
        item = projection["symbols"]["NVDA"]
        self.assertEqual(item["financial_current"]["r"][FINANCIAL_FIELDS.index("eps_growth_yy")], "0")
        self.assertEqual(item["financial_history"]["annual"], [])
        self.assertEqual(item["financial_history"]["quarterly"], [])
        self.assertEqual(item["history_source_diagnostics"]["reasons"], {"annual": "stale_source", "quarterly": "stale_source"})

    def test_generation_binds_receipts_projection_content_and_policy(self):
        original, _ = self.export()
        for mutate in (
            lambda value: value["policy"].update(projector_sha256="f" * 64),
            lambda value: value["symbols"]["NVDA"]["financial_values"].update(eps_growth_yy=1),
            lambda value: value["receipt_inventory"][0].update(capture_id="fresh-original-receipt"),
            lambda value: value["receipt_inventory"][0].update(observed_at="2026-10-04T12:01:00Z"),
        ):
            altered = deepcopy(original)
            mutate(altered)
            self.assertNotEqual(exporter.financial_generation(altered), original["financial_generation"])

    def test_original_base_must_match_archive_binding(self):
        altered = json.loads(self.base)
        altered["rows"][0]["current_price"] = 200
        data = exporter.canonical_bytes(altered)
        self.kwargs["base_path"].write_bytes(data)
        self.target(altered)
        cohort = {**self.cohort, "base_artifact_sha256": batch.digest_bytes(data)}
        self.kwargs["cohort_path"].write_bytes(exporter.canonical_bytes(cohort))
        self.kwargs["cohort_sha256"] = batch.digest_bytes(self.kwargs["cohort_path"].read_bytes())
        with self.assertRaisesRegex(ValueError, "original acquisition base"):
            self.export()

    def test_cli_emits_machine_readable_content_addressed_summary(self):
        flags = {"archive": "archive_dir", "archive-sha256": "archive_sha256", "base": "base_path",
                 "cohort": "cohort_path", "cohort-sha256": "cohort_sha256", "target-base": "target_base_path",
                 "target-base-sha256": "target_base_sha256", "target-publication-identity": "target_publication_identity",
                 "evaluated-at": "evaluated_at", "output-dir": "output_dir"}
        arguments = [item for flag, key in flags.items() for item in (f"--{flag}", str(self.kwargs[key]))]
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(exporter.main(arguments), 0)
        summary = json.loads(output.getvalue())
        self.assertTrue(summary["projection_path"].endswith(f"statement-projection-{summary['projection_sha256']}.json"))
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as rejected:
            exporter.main([*arguments, "--archive-sha256", "0" * 64])
        self.assertEqual(rejected.exception.code, 2)

    def test_symlink_input_and_output_are_rejected(self):
        alias = self.root / "alias-base.json"
        alias.symlink_to(self.kwargs["base_path"])
        with self.assertRaisesRegex(ValueError, "Symlinks|Unreadable"):
            self.export(base_path=alias)
        directory = self.root / "alias-directory"
        directory.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            self.export(output_dir=directory / "unsafe")


if __name__ == "__main__":
    unittest.main()
