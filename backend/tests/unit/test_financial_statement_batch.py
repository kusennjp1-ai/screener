"""Offline bounded collector tests using the pinned vendor's real normalizer.

Every provider transport is synthetic; socket connect and curl perform are
blocked independently so a fixture mistake cannot call Yahoo.
"""
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import curl_cffi
from curl_cffi import requests
import pandas as pd
import yfinance as yf
from yfinance.data import YfData

from app.services import financial_source_capture as capture
from app.services import financial_statement_batch as batch
from app.services.financial_source_evidence import FINANCIAL_FIELDS, validate_envelope
from app.scripts.capture_financial_statement_batch import main

NOW = datetime(2026, 10, 4, 12, 0, 0, tzinfo=timezone.utc)


def read(path):
    return json.loads(path.read_text())


def body(symbol, attribute, *, quarters=6, currency="USD", basic=False, negative=False):
    annual = attribute == "income_stmt"
    prefix = "annual" if annual else "quarterly"
    periods = (["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"]
               if annual else ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"][:quarters])
    eps = [5., 4., 3., 2., 1.] if annual else [6., 5., 4., 3., 2., 1.][:quarters]
    if negative:
        eps[-1] = -1.
        if not annual:
            eps[-2] = -2.
    return {"timeseries": {"error": None, "result": [
        {"meta": {"symbol": [symbol], "type": [prefix + metric]},
         "timestamp": [int(pd.Timestamp(period, tz="UTC").timestamp()) for period in periods],
         prefix + metric: [{"asOfDate": period, "currencyCode": currency, "reportedValue": {"raw": value}}
                           for period, value in zip(periods, values)]}
        for metric, values in [("BasicEPS" if basic else "DilutedEPS", eps), ("TotalRevenue", [1000. + v * 100 for v in eps])]
    ]}}


def plan_for(symbols=("NVDA", "AMD", "VIRT"), attributes=None):
    base = {"as_of_date": "2026-10-02", "rows": [{"symbol": symbol, "market": "US"} for symbol in symbols]}
    encoded = json.dumps(base).encode()
    plan = {"schema_version": batch.PLAN_SCHEMA,
            "verified_us_cohort": {"symbols": list(symbols), "base_artifact_sha256": batch.digest_bytes(encoded)},
            "evaluation_time": batch.timestamp(NOW), "source_data_as_of": "2026-10-02", "batch_allowlist": list(symbols),
            "selected": [{"symbol": symbol, "attributes": list(attributes or batch.ATTRIBUTES)} for symbol in symbols]}
    return plan, encoded


class TestFinancialStatementBatch(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(TemporaryDirectory(prefix="bounded-statement-test-")))
        self.now = NOW
        self.calls, self.tickers, self.sleeps, self.timeouts = [], [], [], []
        self.reply = lambda symbol, attribute: (200, body(symbol, attribute))
        self.plan, self.base = plan_for()
        self.output = self.root / "first"
        self.patch(batch, "utc_now", lambda: self.now)
        self.patch(capture, "_utc_now", lambda: self.now)
        self.patch(batch.time, "sleep", self.sleeps.append)
        self.patch(YfData, "_get_cookie_and_crumb", lambda self, *a, **k: ("synthetic-secret-crumb", "basic"))
        self.patch(socket.socket, "connect", self.forbidden)
        self.patch(socket.socket, "connect_ex", self.forbidden)
        self.patch(curl_cffi.Curl, "perform", self.forbidden)
        def transport(session, method, url, *args, **kwargs):
            identity = capture._request_identity(url, kwargs.get("params"))
            assert identity is not None and identity[0] in batch.ATTRIBUTES
            self.calls.append(identity)
            self.timeouts.append(kwargs["timeout"])
            status, payload = self.reply(identity[1], identity[0])
            if isinstance(payload, Exception):
                raise payload
            text = json.dumps(payload)
            return SimpleNamespace(status_code=status, url=url, text=text, content=text.encode(),
                                   json=lambda: json.loads(text), raise_for_status=lambda: None)
        self.patch(requests.Session, "request", transport)
        ticker = yf.Ticker
        def ticker_factory(symbol, **kwargs):
            self.tickers.append(symbol)
            return ticker(symbol, **kwargs)
        self.patch(yf, "Ticker", ticker_factory)
        YfData().cache_get.cache_clear()
        self.addCleanup(lambda: YfData().cache_get.cache_clear())

    def patch(self, target, name, value):
        self.stack.enter_context(patch.object(target, name, value))

    @staticmethod
    def forbidden(*args, **kwargs):
        raise AssertionError("Network forbidden in offline collector tests")

    def run_batch(self, **kwargs):
        return batch.collect(self.plan, self.base, self.output, **kwargs)

    def test_first_provider_admission_runs_once_after_all_initial_setup(self):
        stages = []
        class Guard:
            def check(self, stage):
                stages.append(stage)
        def admit():
            self.assertEqual(stages, ["initial", "getter"])
            self.assertEqual(self.calls, [])
            self.assertEqual(self.tickers, [])
            self.assertTrue((self.output / "plan.json").exists())
            stages.append("admitted")
        result, code = self.run_batch(retention_guard=Guard(), before_first_provider=admit)
        self.assertEqual(code, 0)
        self.assertEqual(stages.count("admitted"), 1)
        self.assertEqual(len(self.calls), 6)

    def test_first_provider_admission_failure_constructs_no_provider(self):
        def reject():
            raise ValueError("Expired admission")
        with patch.object(batch, "make_session") as session:
            with self.assertRaisesRegex(ValueError, "Expired admission"):
                self.run_batch(before_first_provider=reject)
        session.assert_not_called()
        self.assertEqual(self.tickers, [])
        self.assertEqual(self.calls, [])

    def test_first_provider_admission_is_not_called_for_dry_run(self):
        with patch.object(batch, "make_session") as session, patch("builtins.print") as admit:
            _, code = self.run_batch(dry_run=True, before_first_provider=admit)
        self.assertEqual(code, 0)
        admit.assert_not_called()
        session.assert_not_called()

    def test_first_provider_admission_time_cannot_reset_acquisition_deadline(self):
        monotonic = [10.0]
        def admit():
            monotonic[0] = 12.0
        with patch.object(batch.time, "monotonic", lambda: monotonic[0]), patch.object(batch, "make_session") as session:
            with self.assertRaisesRegex(batch.InvalidPlan, "budget exhausted before first provider"):
                self.run_batch(acquisition_budget_seconds=1, before_first_provider=admit)
        session.assert_not_called()
        self.assertEqual(self.calls, [])

    def result(self, symbol="NVDA"):
        return read(self.output / "results" / f"{symbol}.json")

    def resume(self, directory="resumed"):
        cache = self.output / "cache-manifest.json"
        sha = batch.digest_bytes(cache.read_bytes())
        self.output = self.root / directory
        self.calls.clear()
        self.tickers.clear()
        YfData().cache_get.cache_clear()
        return self.run_batch(cache_manifest=cache, cache_sha256=sha)

    def test_dry_run_constructs_nothing(self):
        summary, code = self.run_batch(dry_run=True)
        self.assertEqual(code, 0)
        self.assertEqual(summary["maximum_statement_getter_calls"], 6)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.calls, [])
        self.assertEqual(self.tickers, [])

    def test_cli_rejects_before_provider_construction(self):
        plan_file, base_file = self.root / "plan.json", self.root / "base.json"
        base_file.write_bytes(self.base)
        self.plan["selected"][0]["symbol"] = "nvda"
        batch.write_json(plan_file, self.plan)
        self.assertEqual(main(["--plan", str(plan_file), "--base-artifact", str(base_file), "--output-dir", str(self.output)]), 3)
        self.assertEqual(self.tickers, [])
        self.assertFalse(self.output.exists())

    def test_plan_bounds_identity_and_explicit_allowlist(self):
        mutations = [
            lambda p: p["selected"].append(deepcopy(p["selected"][0])),
            lambda p: p["selected"][0].update(symbol="BRK.B"),
            lambda p: p["selected"][0].update(symbol="US0378331005"),
            lambda p: p["selected"][0].update(symbol="0700.HK"),
            lambda p: p["selected"][0].update(symbol=" NVDA"),
            lambda p: p["selected"][0].update(symbol="EVIL"),
            lambda p: p["selected"][0].update(attributes=["info"]),
            lambda p: p["selected"][0].update(attributes=["income_stmt", "income_stmt"]),
            lambda p: p["verified_us_cohort"].update(base_artifact_sha256="0" * 64),
            lambda p: p.update(source_data_as_of="2026-10-01"),
            lambda p: p.update(evaluation_time="2026-10-04T12:00:00"),
            lambda p: p.pop("batch_allowlist"),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                plan = deepcopy(self.plan)
                mutate(plan)
                with self.assertRaises(batch.InvalidPlan):
                    batch.collect(plan, self.base, self.output)
        oversized, data = plan_for(tuple(f"S{i}" for i in range(201)))
        with self.assertRaises(batch.InvalidPlan):
            batch.collect(oversized, data, self.output)
        foreign = json.loads(self.base)
        foreign["rows"][0]["market"] = "CA"
        encoded = json.dumps(foreign).encode()
        self.plan["verified_us_cohort"]["base_artifact_sha256"] = batch.digest_bytes(encoded)
        with self.assertRaises(batch.InvalidPlan):
            batch.collect(self.plan, encoded, self.output)
        self.assertEqual(self.tickers, [])

    def test_success_uses_exact_two_getters_original_clocks_and_source_proof(self):
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(self.sleeps, [1.5] * 6)
        self.assertEqual(summary["counts"]["captured_attributes"], 6)
        self.assertEqual(summary["counts"]["annual_history_available"], 3)
        self.assertFalse(summary["capture_completion_is_source_availability"])
        for symbol in ("NVDA", "AMD", "VIRT"):
            result = self.result(symbol)
            self.assertEqual(result["status"], "captured")
            payload = read(self.output / result["envelope_file"])
            envelope = validate_envelope(payload["financial_source_evidence"])
            self.assertEqual(len(envelope["captures"]), 2)
            self.assertEqual(len(result["financial_current"]["p"]), 7)
            history = result["financial_history"]
            self.assertEqual(history["retrieved_at"], batch.timestamp(NOW))
            self.assertEqual(history["annual"][-4:][0]["eps"], 2)
            self.assertEqual(history["annual"][-1]["eps"], 5)
            self.assertEqual(history["quarterly"][-1]["eps"], 6)
            self.assertIsNone(history["source_publication_date"])
            self.assertFalse(history["point_in_time"])
        for path in (self.output / "transport").glob("*.json"):
            text = path.read_text()
            event = json.loads(text)
            self.assertNotIn("?", event["endpoint"])
            self.assertNotIn("synthetic-secret", text)
            self.assertNotIn("content", event)
            self.assertNotIn("headers", event)

    def test_cap_200_results_stay_bounded(self):
        self.plan, self.base = plan_for(tuple(f"S{i}" for i in range(200)))
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        self.assertEqual(summary["statement_getter_calls"], 400)
        self.assertEqual(len(self.calls), 400)
        self.assertLess((self.output / "summary.json").stat().st_size, 100000)
        self.assertEqual(len(list((self.output / "results").glob("*.json"))), 200)
        self.assertLess(max(path.stat().st_size for path in self.output.rglob("*.json")), batch.MAX_ARTIFACT_BYTES)

    def assert_stop(self, status, exception=False):
        self.reply = lambda *a: (status, RuntimeError("synthetic transport failure secret-token") if exception else {"error": "synthetic"})
        acquire = capture.acquire_yahoo_value
        blocked = []
        def swallowed(ticker, attribute, **kwargs):
            try:
                acquire(ticker, attribute, **kwargs)
            except Exception:
                pass
            try:
                ticker.session.get("https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/NVDA?type=quarterlyTotalRevenue")
            except Exception as exc:
                blocked.append(type(exc).__name__)
            return pd.DataFrame(), {}
        self.patch(capture, "acquire_yahoo_value", swallowed)
        summary, code = self.run_batch()
        self.assertEqual(code, 2)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(blocked, ["ProviderStopped"])
        self.assertEqual(self.tickers, ["NVDA"])
        self.assertEqual(summary["counts"]["not_attempted_attributes"], 5)
        self.assertEqual(self.result("AMD")["attributes"]["income_stmt"]["status"], "not_attempted_after_provider_stop")
        for file in self.output.rglob("*.json"):
            self.assertNotIn("secret-token", file.read_text())

    def test_403_stops_before_hidden_retry(self):
        self.assert_stop(403)

    def test_429_stops_before_hidden_retry(self):
        self.assert_stop(429)

    def test_transport_exception_stops_before_hidden_retry(self):
        self.assert_stop(None, exception=True)

    def test_prior_symbol_is_committed_before_later_failure_then_resumes(self):
        def reply(symbol, attribute):
            if symbol == "AMD":
                self.assertTrue((self.output / "results/NVDA.json").is_file())
                self.assertTrue((self.output / "envelopes/NVDA.json").is_file())
                return 429, {"error": "synthetic"}
            return 200, body(symbol, attribute)
        self.reply = reply
        summary, code = self.run_batch()
        self.assertEqual(code, 2)
        first = self.output
        original = read(first / "acquisitions/NVDA-income_stmt.json")
        original_envelope = read(first / "envelopes/NVDA.json")
        self.reply = lambda symbol, attribute: (200, body(symbol, attribute))
        self.now += timedelta(hours=1)
        resumed, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 4)
        self.assertNotIn("NVDA", self.tickers)
        self.assertEqual(resumed["counts"]["reused_attributes"], 2)
        self.assertEqual(read(self.output / "acquisitions/NVDA-income_stmt.json"), original)
        self.assertEqual(read(first / "envelopes/NVDA.json"), original_envelope)
        self.assertEqual(self.result()["financial_history"]["retrieved_at"], batch.timestamp(NOW))

    def test_cache_reuses_fresh_attributes_without_constructing_provider(self):
        self.run_batch()
        first = self.output
        self.now += timedelta(hours=2)
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(self.tickers, [])
        self.assertEqual(self.calls, [])
        self.assertEqual(summary["counts"]["reused_attributes"], 6)
        for path in (first / "acquisitions").glob("*.json"):
            self.assertEqual(path.read_bytes(), (self.output / "acquisitions" / path.name).read_bytes())

    def test_annual_72h_expiry_refetches_only_annual_quarter_keeps_7d_clock(self):
        self.run_batch()
        self.now += timedelta(hours=72, milliseconds=1)
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [("income_stmt", symbol) for symbol in ("NVDA", "AMD", "VIRT")])
        self.assertEqual(summary["counts"]["reused_attributes"], 3)
        result = self.result()
        self.assertEqual(result["attributes"]["quarterly_income_stmt"]["observed_at"], batch.timestamp(NOW))
        self.assertEqual(result["financial_history"]["retrieved_at"], batch.timestamp(self.now))
        self.assertEqual(result["financial_history"]["quarterly"], [])
        self.assertEqual(result["history_source_diagnostics"]["reasons"]["quarterly"], "stale_source")

    def test_all_stale_receipts_refetch(self):
        self.run_batch()
        self.now += timedelta(days=7, milliseconds=1)
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(summary["counts"].get("reused_attributes", 0), 0)

    def test_cache_hash_identity_or_asof_mismatch_fails_before_provider(self):
        self.run_batch()
        cache = self.output / "cache-manifest.json"
        index = read(cache)
        original = deepcopy(index)
        self.tickers.clear()
        self.calls.clear()
        for kind in ("file_hash", "receipt_id", "base", "asof", "manifest_hash"):
            with self.subTest(kind=kind):
                index = deepcopy(original)
                if kind == "file_hash":
                    index["acquisitions"]["NVDA/income_stmt"]["sha256"] = "0" * 64
                if kind == "receipt_id":
                    index["acquisitions"]["NVDA/income_stmt"]["capture_id"] = "wrong"
                if kind == "base":
                    index["binding"]["base_artifact_sha256"] = "invalid"
                if kind == "asof":
                    index["binding"]["source_data_as_of"] = "2026-02-31"
                batch.write_json(cache, index)
                sha = "0" * 64 if kind == "manifest_hash" else batch.digest_bytes(cache.read_bytes())
                with self.assertRaises(batch.InvalidCache):
                    batch.collect(self.plan, self.base, self.root / kind, cache_manifest=cache, cache_sha256=sha)
        self.assertEqual(self.tickers, [])
        self.assertEqual(self.calls, [])

    def test_cache_crosses_snapshot_preserving_origin_and_rebinding_results(self):
        self.run_batch()
        first = self.output
        origin = deepcopy(read(first / "cache-manifest.json")["binding"])
        base = json.loads(self.base)
        base["as_of_date"] = "2026-10-03"
        base["rows"].append({"symbol": "MSFT", "market": "US"})
        self.base = json.dumps(base).encode()
        self.plan["verified_us_cohort"]["base_artifact_sha256"] = batch.digest_bytes(self.base)
        self.plan["verified_us_cohort"]["symbols"].append("MSFT")
        self.plan["source_data_as_of"] = "2026-10-03"
        self.now += timedelta(hours=1)
        self.plan["evaluation_time"] = batch.timestamp(self.now)
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.tickers, [])
        self.assertEqual(summary["base_artifact_sha256"], batch.digest_bytes(self.base))
        self.assertEqual(self.result()["financial_history"]["as_of_date"], "2026-10-03")
        self.assertEqual(self.result()["financial_history"]["retrieved_at"], batch.timestamp(NOW))
        self.assertEqual(self.result()["financial_current"]["a"], "2026-10-03")
        manifest = read(self.output / "cache-manifest.json")
        self.assertNotEqual(manifest["binding"], origin)
        self.assertTrue(all(entry["origin_binding"] == origin for entry in manifest["acquisitions"].values()))
        self.assertTrue(all(path.read_bytes() == (self.output / "acquisitions" / path.name).read_bytes()
                            for path in (first / "acquisitions").glob("*.json")))

    def test_new_plan_period_revalidation_rejects_inapplicable_cache(self):
        self.run_batch()
        cache = self.output / "cache-manifest.json"
        sha = batch.digest_bytes(cache.read_bytes())
        base = json.loads(self.base)
        base["as_of_date"] = "2026-05-01"
        self.base = json.dumps(base).encode()
        self.plan["source_data_as_of"] = base["as_of_date"]
        self.plan["verified_us_cohort"]["base_artifact_sha256"] = batch.digest_bytes(self.base)
        self.tickers.clear()
        with self.assertRaises(batch.InvalidCache):
            batch.collect(self.plan, self.base, self.root / "new-asof", cache_manifest=cache, cache_sha256=sha)
        self.assertEqual(self.tickers, [])

    def test_pilot_cache_conversion_is_pure_and_keeps_original_bytes(self):
        self.run_batch()
        files = {path: path.read_bytes() for path in (self.output / "acquisitions").glob("*.json")}
        self.calls.clear()
        self.tickers.clear()
        manifest = batch.index_retained_acquisitions(self.output, self.plan, self.base, now=self.now)
        self.assertEqual(len(manifest["acquisitions"]), 6)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.tickers, [])
        self.assertTrue(all(path.read_bytes() == content for path, content in files.items()))
        self.assertTrue(all(entry["observed_at"] == batch.timestamp(NOW) for entry in manifest["acquisitions"].values()))

    def test_history_renewal_refreshes_both_receipts_before_expiry_across_snapshot(self):
        self.run_batch()
        original = self.output
        self.now += timedelta(hours=71)
        self.plan["evaluation_time"] = batch.timestamp(self.now)
        self.plan["required_valid_through"] = batch.timestamp(self.now+timedelta(hours=2))
        for item in self.plan["selected"]:
            item["targets"] = ["annual_history"]
        base = json.loads(self.base)
        base["as_of_date"] = "2026-10-03"
        self.base = json.dumps(base).encode()
        self.plan["source_data_as_of"] = "2026-10-03"
        self.plan["verified_us_cohort"]["base_artifact_sha256"] = batch.digest_bytes(self.base)
        summary, code = self.resume("early-renewal")
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(summary["counts"]["reused_attributes"], 0)
        for attribute in batch.ATTRIBUTES:
            result = self.result()["attributes"][attribute]
            self.assertEqual(result["previous_cache_state"], "renewal_due")
            self.assertEqual(result["required_validity"]["state"], "current")
            self.assertEqual(result["required_validity"]["source_max_age_seconds"], 72*3600)
            self.assertEqual(result["observed_at"], batch.timestamp(self.now))
            self.assertEqual(read(original / "acquisitions" / f"NVDA-{attribute}.json")["source_acquisition_contexts"][attribute]["observed_at"], batch.timestamp(NOW))
        self.assertEqual(self.result()["financial_history"]["retrieved_at"], batch.timestamp(self.now))
        self.assertEqual(self.result()["financial_current"]["a"], "2026-10-03")
        self.now += timedelta(hours=2)
        self.plan["evaluation_time"] = batch.timestamp(self.now)
        self.plan["required_valid_through"] = batch.timestamp(self.now+timedelta(hours=2))
        summary, code = self.resume("next-renewal")
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(summary["counts"]["reused_attributes"], 6)
        self.assertEqual(self.result()["financial_history"]["retrieved_at"], batch.timestamp(NOW+timedelta(hours=71)))

    def test_proof_only_horizon_keeps_quarter_seven_day_policy(self):
        self.run_batch()
        self.now += timedelta(hours=71)
        self.plan["evaluation_time"] = batch.timestamp(self.now)
        self.plan["required_valid_through"] = batch.timestamp(self.now+timedelta(hours=2))
        for item in self.plan["selected"]:
            item.update(attributes=["quarterly_income_stmt"], targets=["eps", "sales"])
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.result()["attributes"]["quarterly_income_stmt"]["required_validity"]["source_max_age_seconds"], 7*86400)
        self.assertEqual(summary["counts"]["reused_attributes"], 6)

    def test_malformed_or_impossible_validity_intent_rejects_before_provider(self):
        variants = []
        for mutate in (
            lambda p: p.update(required_valid_through="2026-10-04T12:00:00"),
            lambda p: p.update(required_valid_through="2026-10-04T11:59:59Z"),
            lambda p: p.update(required_valid_through=batch.timestamp(NOW+timedelta(hours=73))),
            lambda p: p["selected"][0].update(targets=["info"]),
            lambda p: p["selected"][0].update(targets=["annual_history"], attributes=["income_stmt"]),
        ):
            variant = deepcopy(self.plan)
            mutate(variant)
            variants.append(variant)
        for variant in variants:
            with self.assertRaises(batch.InvalidPlan):
                batch.collect(variant, self.base, self.output)
        self.assertEqual(self.tickers, [])

    def test_cache_context_hash_and_frame_mismatch_fail_closed(self):
        self.run_batch()
        raw = read(self.output / "acquisitions/NVDA-income_stmt.json")
        for mutate in (lambda r: r["source_acquisition_contexts"]["income_stmt"].update(symbol="AMD"),
                       lambda r: r["source_acquisition_contexts"]["income_stmt"].update(raw_payload_sha256="0" * 64),
                       lambda r: r["original_frame_cells"]["rows"][0]["values"].__setitem__(0, 99),
                       lambda r: r["transport_events"][0].update(transport_payload_sha256="0" * 64)):
            changed = deepcopy(raw)
            mutate(changed)
            with self.assertRaises(batch.InvalidCache):
                batch.validate_acquisition(changed, "NVDA", "income_stmt", now=self.now, as_of=batch.day("2026-10-02"))

    def test_normalization_failure_preserves_raw_and_cache_for_resume(self):
        runtime = batch.runtime
        def components():
            values = list(runtime())
            def failing(*args, **kwargs):
                self.assertTrue((self.output / "acquisitions/NVDA-quarterly_income_stmt.json").is_file())
                self.assertTrue((self.output / "acquisitions/NVDA-income_stmt.json").is_file())
                raise ValueError("synthetic arithmetic failure")
            values[4] = failing
            return tuple(values)
        with patch.object(batch, "runtime", components):
            summary, code = self.run_batch()
        self.assertEqual(code, 3)
        self.assertEqual(summary["symbol_status_counts"], {"normalization_failed": 3})
        self.assertEqual(len(read(self.output / "cache-manifest.json")["acquisitions"]), 6)
        self.assertFalse((self.output / "envelopes").exists())
        resumed, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(resumed["counts"]["reused_attributes"], 6)

    def test_partial_same_symbol_resume_keeps_first_receipt(self):
        self.reply = lambda symbol, attribute: (403, {}) if attribute == "income_stmt" else (200, body(symbol, attribute))
        self.run_batch()
        first = read(self.output / "acquisitions/NVDA-quarterly_income_stmt.json")
        self.reply = lambda symbol, attribute: (200, body(symbol, attribute))
        self.now += timedelta(hours=1)
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 5)
        self.assertEqual(read(self.output / "acquisitions/NVDA-quarterly_income_stmt.json"), first)
        self.assertEqual(self.result()["financial_history"]["retrieved_at"], batch.timestamp(NOW))

    def test_true_five_quarter_shortfall_is_not_fetch_gap(self):
        self.reply = lambda symbol, attribute: (200, body(symbol, attribute, quarters=5))
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        self.assertEqual(self.result()["source_diagnostics"]["fields"]["eps_q2_yoy"], "insufficient_reported_quarters_missing_sixth_point")
        self.assertNotIn("fetch_gap", self.result()["source_diagnostics"]["fields"].values())
        self.assertEqual(summary["counts"]["captured_attributes"], 6)

    def test_missing_receipt_is_fetch_failure_with_raw_preserved(self):
        acquire = capture.acquire_yahoo_value
        def missing(ticker, attribute, **kwargs):
            frame, contexts = acquire(ticker, attribute, **kwargs)
            return frame, {} if attribute == "quarterly_income_stmt" else contexts
        self.patch(capture, "acquire_yahoo_value", missing)
        summary, code = self.run_batch()
        self.assertEqual(code, 3)
        self.assertEqual(self.result()["source_diagnostics"]["fields"]["eps_q2_yoy"], "fetch_gap")
        self.assertEqual(len(list((self.output / "acquisitions").glob("*.json"))), 6)
        self.assertEqual(summary["counts"]["failed_attributes"], 3)

    def test_nonpositive_base_is_source_valid_semantic_unknown(self):
        self.reply = lambda symbol, attribute: (200, body(symbol, attribute, negative=True))
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        result = self.result()
        self.assertEqual(result["source_diagnostics"]["fields"]["eps_growth_yy"], "nonpositive_comparison_base")
        self.assertIn(str(FINANCIAL_FIELDS.index("eps_growth_yy")), result["financial_current"]["p"])
        self.assertEqual(result["financial_history"]["quarterly"][0]["eps"], -1.)
        self.assertGreater(summary["source_reason_counts"]["nonpositive_comparison_base"], 0)
        self.assertGreater(summary["counts"]["source_reference_field_proofs"], 0)
        self.assertEqual(summary["counts"]["source_valid_field_proofs"],
                         summary["counts"]["current_comparable_field_proofs"] + summary["counts"]["source_reference_field_proofs"])

    def test_complete_annual_source_is_distinct_from_positive_base_comparability(self):
        def mixed(symbol, attribute):
            payload = body(symbol, attribute)
            if attribute == "income_stmt" and symbol == "NVDA":
                payload["timeseries"]["result"][0]["annualDilutedEPS"][-2]["reportedValue"]["raw"] = -1.
            if attribute == "income_stmt" and symbol == "VIRT":
                for row in payload["timeseries"]["result"]:
                    key = row["meta"]["type"][0]
                    row[key] = row[key][:3]
                    row["timestamp"] = row["timestamp"][:3]
            return 200, payload
        self.reply = mixed
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        self.assertEqual(summary["counts"]["annual_history_complete"], 2)
        self.assertEqual(summary["counts"]["annual_growth_comparable"], 1)
        self.assertEqual(summary["counts"]["annual_growth_nonpositive_base"], 1)
        self.assertEqual(summary["counts"]["annual_history_available"], 1)  # Legacy comparable-growth alias.

    def test_zero_base_is_semantic_limitation_without_inventing_a_scalar(self):
        def zero(symbol, attribute):
            payload = body(symbol, attribute)
            if attribute == "quarterly_income_stmt":
                payload["timeseries"]["result"][0]["quarterlyDilutedEPS"][-2]["reportedValue"]["raw"] = 0.
            return 200, payload
        self.reply = zero
        _, code = self.run_batch()
        self.assertEqual(code, 0)
        result = self.result()
        self.assertEqual(result["source_diagnostics"]["fields"]["eps_growth_yy"], "nonpositive_comparison_base")
        payload = read(self.output / result["envelope_file"])
        self.assertIsNone(payload["eps_growth_yy"])
        self.assertNotIn(str(FINANCIAL_FIELDS.index("eps_growth_yy")), result["financial_current"]["p"])

    def test_short_annual_history_remains_insufficient_without_filling_years(self):
        def short(symbol, attribute):
            payload = body(symbol, attribute)
            if attribute == "income_stmt":
                for row in payload["timeseries"]["result"]:
                    key = row["meta"]["type"][0]
                    row[key] = row[key][:3]
                    row["timestamp"] = row["timestamp"][:3]
            return 200, payload
        self.reply = short
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.result()["financial_history"]["annual"]), 3)
        self.assertEqual(self.result()["source_diagnostics"]["annual_history"], "insufficient_annual_eps_points")
        self.assertEqual(summary["counts"]["annual_history_available"], 0)

    def test_exact_cache_expiry_boundaries_remain_reusable(self):
        self.run_batch()
        raw_a = read(self.output / "acquisitions/NVDA-income_stmt.json")
        raw_q = read(self.output / "acquisitions/NVDA-quarterly_income_stmt.json")
        for attribute, raw, hours in (("income_stmt", raw_a, 72), ("quarterly_income_stmt", raw_q, 168)):
            self.assertEqual(batch.validate_acquisition(raw, "NVDA", attribute,
                now=NOW+timedelta(hours=hours), as_of=batch.day("2026-10-02"))[2], "current")
            self.assertEqual(batch.validate_acquisition(raw, "NVDA", attribute,
                now=NOW+timedelta(hours=hours, milliseconds=1), as_of=batch.day("2026-10-02"))[2], "stale_source")

    def test_annual_basic_and_nonusd_are_explicitly_unsupported(self):
        for kind in ("basic", "nonusd"):
            with self.subTest(kind=kind):
                self.output = self.root / kind
                YfData().cache_get.cache_clear()
                self.reply = lambda symbol, attribute: (200, body(symbol, attribute,
                    basic=kind == "basic" and attribute == "income_stmt", currency="EUR" if kind == "nonusd" and attribute == "income_stmt" else "USD"))
                _, code = self.run_batch()
                self.assertEqual(code, 0)
                result = self.result()
                self.assertEqual(result["financial_history"]["annual"], [])
                self.assertEqual(result["source_diagnostics"]["annual_history"], "unsupported_eps_basis" if kind == "basic" else "unsupported_currency")

    def test_future_or_stale_reporting_period_is_not_current(self):
        def future(symbol, attribute):
            payload = body(symbol, attribute)
            if attribute == "income_stmt":
                for row in payload["timeseries"]["result"]:
                    metric = row["meta"]["type"][0]
                    row[metric][0]["asOfDate"] = "2026-12-31"
                    row["timestamp"][0] = int(pd.Timestamp("2026-12-31", tz="UTC").timestamp())
            return 200, payload
        self.reply = future
        _, code = self.run_batch()
        self.assertEqual(code, 3)
        self.assertEqual(self.result()["financial_history"]["annual"], [])
        self.assertEqual(self.result()["attributes"]["income_stmt"]["failure"]["kind"], "invalid_captured_evidence")
        self.assertTrue((self.output / "acquisitions/NVDA-income_stmt.json").is_file())

    def test_resume_preserves_noncanonical_original_artifact_bytes_and_hash(self):
        self.run_batch()
        raw_file = self.output / "acquisitions/NVDA-income_stmt.json"
        original_bytes = json.dumps(read(raw_file), separators=(",", ":")).encode() + b"\n\n"
        raw_file.write_bytes(original_bytes)
        manifest = batch.index_retained_acquisitions(self.output, self.plan, self.base, now=self.now)
        batch.write_json(self.output / "cache-manifest.json", manifest)
        _, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual((self.output / "acquisitions/NVDA-income_stmt.json").read_bytes(), original_bytes)
        entry = read(self.output / "cache-manifest.json")["acquisitions"]["NVDA/income_stmt"]
        self.assertEqual(entry["sha256"], batch.digest_bytes(original_bytes))
        self.assertEqual(self.calls, [])

    def test_attempt_journal_is_in_flight_before_getter_and_bound_when_complete(self):
        acquire = capture.acquire_yahoo_value
        def inspect_journal(ticker, attribute, **kwargs):
            journal = read(self.output / "attempts.json")
            attempt = journal["attempts"][-1]
            self.assertEqual(attempt["outcome"], "in_flight")
            self.assertEqual(attempt["symbol"], ticker.ticker)
            self.assertEqual(attempt["attributes"], [attribute])
            self.assertEqual(journal["plan_sha256"], batch.digest_bytes((self.output / "plan.json").read_bytes()))
            return acquire(ticker, attribute, **kwargs)
        self.patch(capture, "acquire_yahoo_value", inspect_journal)
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        journal = read(self.output / "attempts.json")
        self.assertEqual(len(journal["attempts"]), 6)
        self.assertEqual(len(set(item["attempt_id"] for item in journal["attempts"])), 6)
        self.assertTrue(all(item["outcome"] == "succeeded" for item in journal["attempts"]))
        self.assertEqual(summary["attempts_sha256"], batch.digest_bytes((self.output / "attempts.json").read_bytes()))

    def test_interruption_keeps_prior_success_and_in_flight_attempt(self):
        acquire = capture.acquire_yahoo_value
        def interrupted(ticker, attribute, **kwargs):
            if ticker.ticker == "AMD":
                raise KeyboardInterrupt()
            return acquire(ticker, attribute, **kwargs)
        self.patch(capture, "acquire_yahoo_value", interrupted)
        with self.assertRaises(KeyboardInterrupt):
            self.run_batch()
        journal = read(self.output / "attempts.json")
        self.assertEqual([item["outcome"] for item in journal["attempts"]], ["succeeded", "succeeded", "in_flight"])
        self.assertEqual(journal["attempts"][-1]["symbol"], "AMD")
        self.assertEqual(len(read(self.output / "cache-manifest.json")["acquisitions"]), 2)
        self.assertEqual(self.result()["status"], "captured")

    def test_getter_budget_preserves_symbols_and_does_not_block_provider_on_resume(self):
        summary, code = self.run_batch(max_statement_getter_calls=2)
        self.assertEqual(code, 4)
        self.assertIsNone(summary["provider_stop"])
        self.assertEqual(summary["execution_stop"]["budget"], "statement_getters")
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.result()["status"], "captured")
        self.assertEqual(self.result("AMD")["attributes"]["income_stmt"]["status"], "not_attempted_after_budget_stop")
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(summary["counts"]["reused_attributes"], 2)

    def test_transport_budget_flushes_partial_evidence_without_provider_block(self):
        summary, code = self.run_batch(max_transport_requests=2)
        self.assertEqual(code, 4)
        self.assertEqual(len(self.calls), 2)
        self.assertIsNone(summary["provider_stop"])
        self.assertEqual(summary["execution_stop"]["budget"], "transport_requests")
        self.assertEqual(len(read(self.output / "cache-manifest.json")["acquisitions"]), 2)
        self.assertEqual(self.result()["status"], "captured")
        self.assertEqual(self.result("AMD")["attributes"]["quarterly_income_stmt"]["status"], "budget_stopped")
        summary, code = self.resume()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 4)

    def test_wall_deadline_caps_each_transport_and_flushes_results(self):
        elapsed = [0.0]
        self.patch(batch.time, "monotonic", lambda: elapsed[0])
        def reply(symbol, attribute):
            elapsed[0] += 1
            return 200, body(symbol, attribute)
        self.reply = reply
        summary, code = self.run_batch(acquisition_budget_seconds=2)
        self.assertEqual(code, 4)
        self.assertEqual(self.timeouts, [2, 1])
        self.assertEqual(len(self.calls), 2)
        self.assertIsNone(summary["provider_stop"])
        self.assertEqual(summary["execution_stop"]["budget"], "wall_time")
        self.assertEqual(self.result()["status"], "captured")
        self.assertEqual(len(read(self.output / "cache-manifest.json")["acquisitions"]), 2)
        self.assertTrue((self.output / "summary.json").is_file())

    def test_timeout_at_deadline_is_budget_exhaustion_not_provider_denial(self):
        elapsed = [0.0]
        self.patch(batch.time, "monotonic", lambda: elapsed[0])
        def reply(symbol, attribute):
            elapsed[0] = 2
            return None, TimeoutError("synthetic request timed out")
        self.reply = reply
        summary, code = self.run_batch(acquisition_budget_seconds=2)
        self.assertEqual(code, 4)
        self.assertEqual(len(self.calls), 1)
        self.assertIsNone(summary["provider_stop"])
        self.assertEqual(summary["execution_stop"]["budget"], "wall_time")
        self.assertEqual(summary["counts"]["failed_attributes"], 0)
        self.assertEqual(summary["counts"]["budget_stopped_attributes"], 1)

    def test_invalid_budgets_reject_before_provider(self):
        for kwargs in ({"acquisition_budget_seconds": 0}, {"acquisition_budget_seconds": float("nan")},
                       {"max_statement_getter_calls": 401}, {"max_statement_getter_calls": True},
                       {"max_transport_requests": 0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(batch.InvalidPlan):
                self.run_batch(**kwargs)
        self.assertEqual(self.tickers, [])
        self.assertFalse(self.output.exists())

    def test_selected_attribute_limits_provider_requests(self):
        self.plan, self.base = plan_for(attributes=["income_stmt"])
        summary, code = self.run_batch()
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [("income_stmt", symbol) for symbol in ("NVDA", "AMD", "VIRT")])
        self.assertEqual(summary["statement_getter_calls"], 3)
        self.assertEqual(self.result()["source_diagnostics"]["fields"]["eps_q2_yoy"], "fetch_gap")


if __name__ == "__main__":
    unittest.main()
