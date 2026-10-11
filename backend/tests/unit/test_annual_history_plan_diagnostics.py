"""Offline CLI diagnostics; every provider response is a synthetic fixture.

The diagnostics explain unknowns without authorizing a native annual history,
changing acquisition scope or weakening source verification.
"""
from contextlib import redirect_stdout
from datetime import timedelta
import io
import json
import unittest
from unittest.mock import patch

from app.scripts.manage_statement_archive import main
from app.services import statement_artifact_archive as archive
from tests.unit import test_export_statement_projection as original
from tests.unit import test_financial_statement_batch as fixtures


class TestAnnualHistoryPlanDiagnostics(unittest.TestCase):
    def setup_source(self, *, currency="USD", basic=False, mutate=None):
        body = fixtures.body

        def source(symbol, attribute, **kwargs):
            annual = attribute == "income_stmt"
            value = body(symbol, attribute, **{**kwargs,
                "currency": currency if annual else "USD", "basic": basic if annual else False})
            if annual and mutate:
                mutate(value)
            return value

        test = original.TestExportStatementProjection()
        self.addCleanup(test.doCleanups)
        with patch.object(fixtures, "body", source):
            test.setUp()
        return test

    def report(self, test, *, now=None):
        now = now or test.now
        verified = archive.load_archive(test.archive, test.archive_sha,
            base_bytes=test.base, cohort=test.cohort, now=now)
        planned, expected_plan, _ = archive.plan_archive(verified,
            base_bytes=test.base, cohort=test.cohort, now=now)
        before = {path: path.read_bytes() for path in test.archive.rglob("*") if path.is_file()}
        output = test.root / "diagnostic-plan"
        with redirect_stdout(io.StringIO()):
            code = main(["plan", "--archive", str(test.archive), "--archive-sha256", test.archive_sha,
                "--base", str(test.root / "base.json"), "--cohort", str(test.root / "cohort.json"),
                "--now", fixtures.batch.timestamp(now), "--output-directory", str(output)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads((output / "plan.json").read_bytes()), expected_plan)
        self.assertEqual(before, {path: path.read_bytes() for path in test.archive.rglob("*") if path.is_file()})
        report = json.loads((output / "report.json").read_bytes())
        self.assertEqual(report["cause_counts"], planned.cause_counts)
        self.assertEqual(report["annual_history_source_reasons"]["AMD"], "fetch_gap")
        self.assertEqual(report["annual_history_source_reasons"]["VIRT"], "fetch_gap")
        return report

    def test_usd_availability_and_absent_receipts_are_distinct(self):
        report = self.report(self.setup_source())
        self.assertEqual(report["annual_history_source_reasons"]["NVDA"], "available")
        self.assertNotIn("NVDA", [item["symbol"] for item in report["required_work"]])

    def test_non_usd_policy_limit_is_not_reported_only_as_missing_periods(self):
        report = self.report(self.setup_source(currency="CAD"))
        self.assertEqual(report["annual_history_source_reasons"]["NVDA"], "unsupported_currency")
        item = next(item for item in report["required_work"] if item["symbol"] == "NVDA")
        annual = next(r for r in item["requirements"] if r["target"] == "annual_history")
        self.assertEqual(annual["cause"], "annual_history_source_period_missing")
        self.assertEqual(annual["state"], "retry_decision_required")
        self.assertNotIn("NVDA", [item["symbol"] for item in report["batch"]])

    def test_mixed_currency_remains_unsupported(self):
        def mixed(value):
            value["timeseries"]["result"][0]["annualDilutedEPS"][0]["currencyCode"] = "EUR"

        report = self.report(self.setup_source(currency="CAD", mutate=mixed))
        self.assertEqual(report["annual_history_source_reasons"]["NVDA"], "unsupported_currency")

    def test_missing_diluted_value_is_distinct_from_currency_policy(self):
        def missing(value):
            value["timeseries"]["result"][0]["annualDilutedEPS"][1]["reportedValue"]["raw"] = None

        report = self.report(self.setup_source(mutate=missing))
        self.assertEqual(report["annual_history_source_reasons"]["NVDA"], "insufficient_annual_eps_points")

    def test_basic_eps_cannot_authorize_annual_history(self):
        report = self.report(self.setup_source(basic=True))
        self.assertEqual(report["annual_history_source_reasons"]["NVDA"], "unsupported_eps_basis")

    def test_expired_receipt_reports_current_reason_without_resetting_clock(self):
        test = self.setup_source(currency="CAD")
        report = self.report(test, now=test.now + timedelta(hours=73))
        self.assertEqual(report["annual_history_source_reasons"]["NVDA"], "stale_source")

    def test_wrong_provider_symbol_cannot_supply_annual_history(self):
        collector = fixtures.TestFinancialStatementBatch()
        self.addCleanup(collector.doCleanups)
        collector.setUp()
        collector.plan, collector.base = fixtures.plan_for(("NVDA",), attributes=("income_stmt",))

        def wrong_issuer(symbol, attribute):
            value = fixtures.body(symbol, attribute, currency="CAD")
            for row in value["timeseries"]["result"]:
                row["meta"]["symbol"] = ["OTHER"]
            return 200, value

        collector.reply = wrong_issuer
        _, code = collector.run_batch()
        self.assertEqual(code, 3)
        self.assertEqual(collector.result()["financial_history"]["annual"], [])
        self.assertEqual(collector.result()["history_source_diagnostics"]["reasons"]["annual"], "fetch_gap")
