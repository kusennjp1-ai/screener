import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("sec_financials", Path(__file__).with_name("sec-financials.py"))
sec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sec)

def facts(entries):
    return {"cik": 1, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": entries}}}}}

def entry(**kw):
    return dict({"start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "form": "10-Q", "val": 1.5, "accn": "0000000001-25-000001"}, **kw)

class PointInTimeFacts(unittest.TestCase):
    def test_future_restatement_is_not_used(self):
        f = facts([entry(), entry(filed="2026-01-01", val=99)])
        self.assertEqual(sec.series(f, "eps", "2025-06-01")[0]["value"], 1.5)

    def test_no_invented_q4_eps(self):
        f = facts([entry(), entry(start="2025-01-01", end="2025-12-31", filed="2026-02-01", form="10-K", val=10)])
        self.assertEqual(len(sec.series(f, "eps", "2026-03-01")), 1)
        self.assertEqual(len(sec.series(f, "eps", "2026-03-01", annual=True)), 1)

    def test_missing_dates_nonfinite_and_conflicting_values_are_not_selected(self):
        for rows in [[entry(filed=None)], [entry(val=True)], [entry(val=float("nan"))], [entry(), entry(val=2)]]:
            self.assertEqual(sec.series(facts(rows), "eps", "2026-03-01"), [])

    def test_does_not_silently_use_other_currency(self):
        f = {"facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"EUR/shares": [entry()]}}}}}
        self.assertEqual(sec.series(f, "eps", "2026-03-01"), [])

    def test_identity_and_analysis_date(self):
        with self.assertRaises(ValueError):
            sec.normalize(facts([entry()]), "TEST", 2, "2026-03-01")

def flow(tag, rows):
    return {"cik": 1, "facts": {"us-gaap": {tag: {"units": {"USD": rows}}}}}

def quarter(start, end, val, filed, form="10-Q", accn=None):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": form, "accn": accn or f"q-{end}"}

FY = [quarter("2025-01-01", "2025-03-31", 100, "2025-05-01"), quarter("2025-04-01", "2025-06-30", 110, "2025-08-01"),
      quarter("2025-07-01", "2025-09-30", 120, "2025-11-01"), quarter("2025-01-01", "2025-12-31", 470, "2026-02-15", form="10-K", accn="fy-2025")]

class DerivedFourthQuarter(unittest.TestCase):
    def test_revenue_q4_is_the_fiscal_year_minus_three_reported_quarters(self):
        result = sec.normalize(dict(flow("Revenues", FY), cik=1), "T", 1, "2026-03-01")["quarterly"]["revenue"]
        q4 = result[-1]
        self.assertEqual((q4["start"], q4["end"], q4["value"]), ("2025-10-01", "2025-12-31", 140))
        self.assertEqual(q4["derived"], sec.DERIVED_Q4)
        self.assertEqual(q4["components"][0], "fy-2025")
        self.assertEqual(q4["filed"], "2026-02-15")

    def test_no_derivation_with_a_gap_a_mixed_concept_or_before_the_10k_is_filed(self):
        gap = [FY[0], FY[2], FY[3]]
        self.assertFalse(any(p["derived"] for p in sec.normalize(dict(flow("Revenues", gap), cik=1), "T", 1, "2026-03-01")["quarterly"]["revenue"]))
        early = sec.normalize(dict(flow("Revenues", FY), cik=1), "T", 1, "2026-01-15")["quarterly"]["revenue"]
        self.assertFalse(any(p["derived"] for p in early))
        mixed = {"cik": 1, "facts": {"us-gaap": {"Revenues": {"units": {"USD": FY[:3]}}, "SalesRevenueNet": {"units": {"USD": FY[3:]}}}}}
        self.assertFalse(any(p["derived"] for p in sec.normalize(mixed, "T", 1, "2026-03-01")["quarterly"]["revenue"]))

    def test_no_derivation_when_a_source_filing_is_unnamed(self):
        rows = [dict(q) for q in FY]; rows[1]["accn"] = None
        self.assertFalse(any(p["derived"] for p in sec.normalize(dict(flow("Revenues", rows), cik=1), "T", 1, "2026-03-01")["quarterly"]["revenue"]))

    def test_eps_is_never_derived_from_the_annual_value(self):
        eps = [dict(q, val=q["val"] / 100) for q in FY]
        f = {"cik": 1, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": eps}}}}}
        self.assertEqual([p["end"] for p in sec.normalize(f, "T", 1, "2026-03-01")["quarterly"]["eps"]], ["2025-03-31", "2025-06-30", "2025-09-30"])

class SecAccess(unittest.TestCase):
    def test_user_agent_comes_from_the_environment(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {"SEC_USER_AGENT": "Ops ops@example.org"}):
            self.assertEqual(sec.user_agent(), "Ops ops@example.org")
        with patch.dict(os.environ, {"SEC_USER_AGENT": ""}):
            self.assertEqual(sec.user_agent(), sec.DEFAULT_USER_AGENT)

    def test_transient_errors_are_retried_and_permanent_ones_are_not(self):
        import io
        from urllib.error import HTTPError
        calls, waits = [], []
        def opener(statuses):
            def call(req, timeout):
                calls.append(req.full_url)
                status = statuses.pop(0)
                if status != 200:
                    raise HTTPError(req.full_url, status, "x", {}, None)
                return io.BytesIO(b'{"ok": true}')
            return call
        self.assertEqual(sec.get_json("https://data.sec.gov/a", sleep=waits.append, opener=opener([503, 429, 200])), {"ok": True})
        self.assertEqual((len(calls), waits), (3, [1, 2]))
        with self.assertRaises(HTTPError):
            sec.get_json("https://data.sec.gov/b", sleep=waits.append, opener=opener([404]))

    def test_failed_symbols_get_one_more_pass_and_stay_unknown_when_it_fails_again(self):
        from urllib.error import URLError
        facts = lambda cik: {"cik": cik, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": [entry(accn=f"a-{cik}")]}}}}}
        attempts = {}
        def get(url):
            if url.endswith("company_tickers.json"):
                attempts["map"] = attempts.get("map", 0) + 1
                if attempts["map"] == 1:
                    raise URLError("down")
                return {"0": {"ticker": "AAA", "cik_str": 1}, "1": {"ticker": "BBB", "cik_str": 2}, "2": {"ticker": "CCC", "cik_str": 3}}
            cik = int(url.rsplit("CIK", 1)[1].split(".")[0])
            attempts[cik] = attempts.get(cik, 0) + 1
            if cik == 2 and attempts[cik] == 1 or cik == 3:
                raise URLError("reset")
            return facts(cik)
        waits = []
        out = sec.collect(["AAA", "BBB", "CCC", "ZZZ"], "2026-10-02", get=get, sleep=waits.append)
        self.assertEqual(attempts["map"], 2)
        self.assertEqual(list(out["results"]), ["AAA", "BBB", "CCC", "ZZZ"])
        self.assertEqual(out["results"]["BBB"]["status"], "partial")
        self.assertEqual(out["results"]["CCC"]["status"], "unavailable")
        self.assertEqual(out["results"]["CCC"]["reason"], "transient")
        self.assertEqual(out["results"]["ZZZ"]["error"], "SEC識別子未取得")
        self.assertEqual(out["results"]["ZZZ"]["reason"], "no_cik")
        self.assertEqual(out["second_pass"], {"retried": 2, "recovered": 1})
        self.assertEqual((attempts[1], attempts[2], attempts[3]), (1, 2, 2))
        self.assertIn(sec.SECOND_PASS_DELAY_SECONDS, waits)
        self.assertEqual(out["errors"], [])
        for result in out["results"].values():
            self.assertEqual(result["schema_version"], 2)
            self.assertRegex(result["retrieved_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

    def test_permanent_failures_are_classified_and_not_retried(self):
        from urllib.error import HTTPError
        calls = {}
        def get(url):
            if url.endswith("company_tickers.json"):
                return {"0": {"ticker": "GONE", "cik_str": 4}, "1": {"ticker": "FPI", "cik_str": 5}, "2": {"ticker": "BAD", "cik_str": 6}, "3": {"ticker": "BRK-B", "cik_str": 7}}
            cik = int(url.rsplit("CIK", 1)[1].split(".")[0])
            calls[cik] = calls.get(cik, 0) + 1
            if cik == 4:
                raise HTTPError(url, 404, "Not Found", {}, None)
            if cik == 5:
                return {"cik": 5, "facts": {"ifrs-full": {"Revenue": {"units": {"USD": [{"form": "20-F", "val": 1}] * 3 + [{"form": "6-K", "val": 1}]}}},
                                            "dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": [{"form": "20-F/A", "val": 1}, {"form": "DEF 14A", "val": 1}]}}}}}
            if cik == 6:
                return {"cik": 999, "facts": {}}
            return facts([entry(accn="brk")]) | {"cik": 7}
        out = sec.collect(["GONE", "FPI", "BAD", "BRK.B", "NONE"], "2026-10-02", get=get, sleep=lambda _: None)
        reasons = {symbol: result.get("reason") for symbol, result in out["results"].items()}
        self.assertEqual(reasons, {"GONE": "no_companyfacts", "FPI": "no_quarterly", "BAD": "invalid_payload", "BRK.B": None, "NONE": "no_cik"})
        self.assertEqual(out["results"]["FPI"]["forms"], ["20-F", "20-F/A", "6-K"])
        self.assertEqual(out["results"]["BRK.B"]["status"], "partial")
        self.assertEqual(out["second_pass"], {"retried": 0, "recovered": 0})
        self.assertEqual(calls, {4: 1, 5: 1, 6: 1, 7: 1})
        self.assertTrue(out["results"]["GONE"]["error"].startswith(sec.TRANSIENT_ERROR))
        cover = sec.coverage(out["results"], 7, 5, ["GONE", "FPI", "OTHER"])
        self.assertEqual((cover["truncated"], cover["brief_listed"], cover["brief_fetched"]), (2, 3, 2))
        self.assertEqual(cover["reasons"], {"no_cik": 1, "no_companyfacts": 1, "no_quarterly": 1, "transient": 0, "invalid_payload": 1})

    def test_targets_put_every_brief_row_before_the_ranked_lists(self):
        daily = {"as_of_date": "2026-10-30", "candidates": {"minervini2": [{"symbol": "GGG"}], "minervini": [{"symbol": "AAA"}], "ibd": [{"symbol": "BBB"}, {"symbol": "AAA"}]}}
        row = lambda symbol, **minervini: {"symbol": symbol, "methods": {"minervini": minervini}}
        audit = {"as_of_date": "2026-10-30", "results": [row("CCC", qualified=False, failed=1, unknown=0), row("AAA", qualified=True, failed=0, unknown=0),
                 row("DDD", qualified=True, failed=0, unknown=0), row("EEE", qualified=False, failed=1, unknown=1), row("FFF", qualified=False, failed=2, unknown=0)]}
        self.assertEqual(sec.target_symbols(daily, audit), ["AAA", "DDD", "CCC", "GGG", "BBB"])
        self.assertEqual(sec.target_symbols(daily, {**audit, "as_of_date": "2026-10-29"}), ["AAA", "GGG", "BBB"])
        self.assertEqual(sec.target_symbols(daily, None), ["AAA", "GGG", "BBB"])
        self.assertEqual(sec.MAX_SYMBOLS, 1500)
        many = [f"S{i}" for i in range(2000)]
        self.assertEqual(len(sec.requested(many, 5000)), 1500)
        self.assertEqual(sec.requested(many, 3), ["S0", "S1", "S2"])
        self.assertEqual(sec.requested(many, -1), [])

class RateAndTransfer(unittest.TestCase):
    def test_limiter_allows_at_most_five_calls_in_any_second_across_four_threads(self):
        import threading
        # Every thread asks at the same fake instant; the granted slots are the request times.
        lock = threading.Lock()
        limiter = sec.RateLimiter(sec.sec_rate({}), clock=lambda: 100.0, sleep=lambda seconds: None)
        slots = []
        def worker():
            for _ in range(10):
                slot = limiter.wait()
                with lock:
                    slots.append(slot)
        threads = [threading.Thread(target=worker) for _ in range(4)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        slots.sort()
        self.assertEqual(len(slots), 40)
        for i, start in enumerate(slots):
            self.assertLessEqual(sum(start <= s < start + 1 for s in slots), 5)
        self.assertAlmostEqual(slots[-1] - slots[0], 39 * 0.2)

    def test_limiter_sleeps_until_its_slot_and_rate_is_capped(self):
        now, waits = [0.0], []
        def sleep(seconds):
            waits.append(round(seconds, 6)); now[0] += seconds
        limiter = sec.RateLimiter(5, clock=lambda: now[0], sleep=sleep)
        for _ in range(3): limiter.wait()
        self.assertEqual(waits, [0.2, 0.2])
        self.assertEqual(sec.sec_rate({}), 5.0)
        self.assertEqual(sec.sec_rate({"SEC_MAX_RPS": "50"}), 8.0)
        self.assertEqual(sec.sec_rate({"SEC_MAX_RPS": "2"}), 2.0)
        for bad in ("0", "-1", "nan", "x"):
            self.assertEqual(sec.sec_rate({"SEC_MAX_RPS": bad}), 5.0)

    def test_gzip_responses_are_decoded_and_every_attempt_takes_a_slot(self):
        import gzip, io
        class Response(io.BytesIO):
            def __init__(self, body, encoding=None):
                super().__init__(gzip.compress(body) if encoding == "gzip" else body)
                self.headers = {"Content-Encoding": encoding} if encoding else {}
        class Counter:
            calls = 0
            def wait(self): Counter.calls += 1
        seen = []
        def opener(req, timeout):
            seen.append(req.get_header("Accept-encoding"))
            return Response(b'{"ok": 1}', "gzip")
        self.assertEqual(sec.get_json("https://data.sec.gov/x", opener=opener, limiter=Counter()), {"ok": 1})
        self.assertEqual(sec.get_json("https://data.sec.gov/y", opener=lambda req, timeout: Response(b'{"ok": 2}'), limiter=Counter()), {"ok": 2})
        self.assertEqual(seen, ["gzip"])
        self.assertEqual(Counter.calls, 2)

    def test_output_is_deterministic_gzip_and_replaces_the_legacy_raw_file(self):
        import gzip, json, tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "book-financials.json").write_text("{}", encoding="utf-8")
            sec.write_output(root, {"as_of_date": "2026-10-02", "results": {"A": {"symbol": "A"}}})
            first = (root / "book-financials.json.gz").read_bytes()
            sec.write_output(root, {"as_of_date": "2026-10-02", "results": {"A": {"symbol": "A"}}})
            self.assertEqual(first, (root / "book-financials.json.gz").read_bytes())
            self.assertFalse((root / "book-financials.json").exists())
            self.assertEqual(json.loads(gzip.decompress(first))["results"]["A"], {"symbol": "A"})

    def test_tags_match_the_browser_admission(self):
        import json, re
        text = (Path(__file__).parent.parent / "src/static/bookFinancialAdmission.js").read_text(encoding="utf-8")
        browser = json.loads(re.search(r"SEC_FIELD_TAGS = Object\.freeze\((\{.*?\})\);", text).group(1))
        self.assertEqual(browser, {key: [tags, unit] for key, (tags, unit) in sec.TAGS.items()})

def seven_years():
    """Seven fiscal years of 10-Q quarters (Q1-Q3) and 10-K annual totals, 2019-2025."""
    from datetime import date, timedelta
    rows = []
    for year in range(2019, 2026):
        for q, (s, e) in enumerate([("01-01", "03-31"), ("04-01", "06-30"), ("07-01", "09-30")]):
            end = f"{year}-{e}"
            rows.append({"start": f"{year}-{s}", "end": end, "val": 100 + q, "filed": (date.fromisoformat(end) + timedelta(days=30)).isoformat(), "form": "10-Q", "accn": f"q-{end}"})
        rows.append({"start": f"{year}-01-01", "end": f"{year}-12-31", "val": 500, "filed": f"{year + 1}-02-20", "form": "10-K", "accn": f"fy-{year}"})
    return rows

class WallClockBudget(unittest.TestCase):
    """A hanging data.sec.gov never outlasts the job: one budget bounds the whole run."""

    def clock(self, start=0.0):
        now = [start]
        return now, (lambda: now[0])

    def test_budget_comes_from_the_environment_within_bounds(self):
        self.assertEqual(sec.sec_deadline_seconds({}), 900)
        self.assertEqual(sec.sec_deadline_seconds({"SEC_DEADLINE_SECONDS": "300"}), 300)
        self.assertEqual(sec.sec_deadline_seconds({"SEC_DEADLINE_SECONDS": "99999"}), 3600)
        for bad in ("0", "-5", "nan", "inf", "x"):
            self.assertEqual(sec.sec_deadline_seconds({"SEC_DEADLINE_SECONDS": bad}), 900)

    def test_no_attempt_or_backoff_starts_after_the_deadline_and_a_socket_wait_never_runs_past_it(self):
        from urllib.error import URLError
        now, clock = self.clock()
        deadline = sec.Deadline(10, clock=clock)
        class Free:
            def wait(self): return 0
        timeouts = []
        def slow(req, timeout):
            timeouts.append(timeout)
            now[0] += timeout
            raise URLError("timed out")
        with self.assertRaises(sec.DeadlineExceeded):
            sec.get_json("https://data.sec.gov/a", sleep=lambda seconds: now.__setitem__(0, now[0] + seconds), opener=slow, limiter=Free(), deadline=deadline)
        # The first wait is clamped to the 10 s left; no backoff or second attempt follows.
        self.assertEqual(timeouts, [10.0])
        calls = []
        with self.assertRaises(sec.DeadlineExceeded):
            sec.get_json("https://data.sec.gov/b", opener=lambda req, timeout: calls.append(1), limiter=Free(), deadline=deadline)
        self.assertEqual(calls, [])

    def test_symbols_not_reached_in_time_stay_transient_and_the_second_pass_is_skipped(self):
        from urllib.error import URLError
        now, clock = self.clock()
        deadline = sec.Deadline(300, clock=clock)
        names = [f"S{i:02d}" for i in range(12)]
        calls = []
        def get(url):
            if url.endswith("company_tickers.json"):
                return {str(i): {"ticker": name, "cik_str": i + 1} for i, name in enumerate(names)}
            calls.append(url)
            now[0] += 93  # three 30 s timeouts and the 1 s + 2 s backoff
            raise URLError("timed out")
        waits = []
        out = sec.collect(names, "2026-10-02", get=get, sleep=waits.append, workers=1, deadline=deadline)
        self.assertEqual(len(calls), 4)  # requests started at 0, 93, 186 and 279 s
        self.assertEqual({r["reason"] for r in out["results"].values()}, {"transient"})
        unreached = [s for s, r in out["results"].items() if sec.DEADLINE_ERROR in r["error"]]
        self.assertEqual(unreached, names[4:])
        self.assertEqual(out["second_pass"], {"retried": 0, "recovered": 0, "skipped": "deadline"})
        self.assertNotIn(sec.SECOND_PASS_DELAY_SECONDS, waits)
        self.assertEqual(out["deadline"], {"seconds": 300, "expired": True, "unreached": 8})
        self.assertEqual(sec.coverage(out["results"], 12, 12)["reasons"]["transient"], 12)

    def test_a_broad_failure_is_not_retried_but_a_few_failures_are(self):
        from urllib.error import URLError
        names = [f"B{i:02d}" for i in range(30)]
        tickers = {str(i): {"ticker": name, "cik_str": i + 1} for i, name in enumerate(names)}
        calls = []
        def get(url):
            if url.endswith("company_tickers.json"):
                return tickers
            calls.append(url)
            raise URLError("reset")
        out = sec.collect(names, "2026-10-02", get=get, sleep=lambda _: None)
        self.assertEqual(len(calls), 30)
        self.assertEqual(out["second_pass"], {"retried": 0, "recovered": 0, "skipped": "broad_failure"})
        self.assertEqual(out["deadline"]["unreached"], 0)
        self.assertFalse(out["deadline"]["expired"])

class PublishedWindow(unittest.TestCase):
    def test_trim_keeps_the_rule_window_after_deriving_from_the_full_series(self):
        rows = seven_years()
        facts = {"cik": 1, "facts": {"us-gaap": {"Revenues": {"units": {"USD": rows}},
            "EarningsPerShareDiluted": {"units": {"USD/shares": [dict(r, val=r["val"] / 100) for r in rows]}},
            "InventoryNet": {"units": {"USD": [{"end": f"{y}-12-31", "val": 7, "filed": f"{y + 1}-02-20", "form": "10-K", "accn": f"inv-{y}"} for y in range(2018, 2026)]}}}}}
        result = sec.normalize(facts, "T", 1, "2026-03-01", "2026-03-01T10:00:00.000Z")
        revenue, eps = result["quarterly"]["revenue"], result["quarterly"]["eps"]
        cutoff = (sec.date.fromisoformat("2025-12-31") - sec.timedelta(days=sec.TRIM_DAYS)).isoformat()
        self.assertEqual(cutoff, "2022-12-27")
        self.assertTrue(all(p["end"] >= cutoff for key in sec.TAGS for p in result["quarterly"][key]))
        self.assertEqual((len(revenue), len(eps), len(result["quarterly"]["inventory"])), (13, 9, 4))
        # The 2022 Q4 needs the 2022 Q1-Q3 filings, which lie outside the window:
        # derivation used the full series and only the result was trimmed.
        self.assertEqual([p["end"] for p in revenue if p["derived"]], ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"])
        self.assertEqual(revenue[-1]["value"], 500 - 303)
        self.assertEqual(revenue[0]["components"], ["fy-2022", "q-2022-03-31", "q-2022-06-30", "q-2022-09-30"])
        # Annual EPS is untouched: the annual record compares every prior year.
        self.assertEqual(len(result["annualEps"]), 7)
        self.assertTrue(all(p["start"] is None for p in result["quarterly"]["inventory"]))
        self.assertEqual((result["schema_version"], result["retrieved_at"], result["status"]), (2, "2026-03-01T10:00:00.000Z", "available"))

    def test_facts_without_a_named_filing_are_not_used(self):
        self.assertEqual(sec.series(facts([entry(accn=None)]), "eps", "2026-03-01"), [])
        self.assertEqual(len(sec.series(facts([entry(accn="0001-25-1")]), "eps", "2026-03-01")), 1)

class InvalidPayloadCause(unittest.TestCase):
    """An invalid_payload record says what failed and which CIK came back (plan DT1); retries are unchanged."""

    def fetch(self, payload):
        return sec.fetch_symbol("BAD", {"BAD": 6}, "2026-10-02", get=lambda url: payload)

    def test_a_cik_mismatch_records_both_ciks(self):
        record = self.fetch({"cik": 999, "facts": {}})
        self.assertEqual((record["status"], record["reason"]), ("unavailable", "invalid_payload"))
        self.assertEqual(record["invalid_detail"], {"class": "PayloadMismatch", "message": "companyfacts cik does not match the requested cik", "requested_cik": 6, "received_cik": 999})
        self.assertEqual(sec.invalid_cause(record), "cik_mismatch")

    def test_another_exception_records_its_class_and_a_short_message(self):
        record = self.fetch({"cik": 6, "facts": []})
        detail = record["invalid_detail"]
        self.assertEqual((detail["class"], detail["requested_cik"], detail["received_cik"]), ("AttributeError", 6, 6))
        self.assertIn("has no attribute", detail["message"])
        self.assertEqual(sec.invalid_cause(record), "AttributeError")
        # A payload that is not an object names no CIK it received.
        self.assertIsNone(self.fetch(["not", "an", "object"])["invalid_detail"]["received_cik"])

    def test_a_cik_written_as_digits_is_the_same_cik(self):
        # companyfacts may write the CIK as text (zero-padded or not): the same number is the same filer.
        for written in ("0000000006", "6"):
            record = self.fetch({"cik": written, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": [entry()]}}}}})
            self.assertEqual((record["status"], record["cik"]), ("partial", 6), written)

    def test_a_different_or_unreadable_cik_still_fails(self):
        different = self.fetch({"cik": "0000000999", "facts": {}})
        self.assertEqual(different["invalid_detail"], {"class": "PayloadMismatch", "message": "companyfacts cik does not match the requested cik", "requested_cik": 6, "received_cik": 999})
        self.assertEqual(sec.invalid_cause(different), "cik_mismatch")
        # Missing, null, a float, a bool, a signed, spaced or non-ASCII number, or 11 digits: never the requested CIK.
        for payload in ({"facts": {}}, {"cik": None, "facts": {}}, {"cik": 6.0, "facts": {}}, {"cik": True, "facts": {}}, {"cik": "+6", "facts": {}},
                        {"cik": " 6", "facts": {}}, {"cik": "6\n", "facts": {}}, {"cik": "\uff16", "facts": {}}, {"cik": "00000000006", "facts": {}}, {"cik": "6_0", "facts": {}}):
            record = self.fetch(payload)
            self.assertEqual((record["reason"], record["invalid_detail"]["class"], record["invalid_detail"]["received_cik"]), ("invalid_payload", "PayloadMismatch", None), repr(payload))
            self.assertEqual(sorted(record["invalid_detail"]), ["class", "message", "received_cik", "requested_cik"])
        one = sec.fetch_symbol("ONE", {"ONE": 1}, "2026-10-02", get=lambda url: {"cik": True, "facts": {}})
        self.assertEqual(one["reason"], "invalid_payload")

    def test_the_run_counts_how_payloads_wrote_their_cik_and_never_writes_it(self):
        payloads = {1: {"cik": 1, "facts": {}}, 2: {"cik": "0000000002", "facts": {}}, 3: {"facts": {}}}
        def get(url):
            if url.endswith("company_tickers.json"):
                return {"0": {"ticker": "AAA", "cik_str": 1}, "1": {"ticker": "BBB", "cik_str": 2}, "2": {"ticker": "CCC", "cik_str": 3}}
            return payloads[int(url.rsplit("CIK", 1)[1].split(".")[0])]
        out = sec.collect(["AAA", "BBB", "CCC"], "2026-10-02", get=get, sleep=lambda s: None)
        self.assertEqual(out["payload_cik"], {"digits:no_quarterly": 1, "int:no_quarterly": 1, "missing:invalid_payload": 1})
        self.assertNotIn("payload_cik", out["results"]["CCC"])

    def test_the_message_carries_no_url_address_header_or_user_agent_and_stays_short(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {"SEC_USER_AGENT": "Ops Desk ops@example.org"}):
            text = sec.safe_message("failed for Ops Desk ops@example.org at https://data.sec.gov/x?k=1 Authorization: Bearer abc\nnext " + "x" * 400, "ValueError")
        for secret in ("ops@example.org", "Ops Desk", "https://", "Bearer", "\n"):
            self.assertNotIn(secret, text)
        self.assertLessEqual(len(text), sec.INVALID_MESSAGE_MAX)
        self.assertEqual(sec.safe_message("", "KeyError"), "KeyError")

    def test_counts_by_cause_and_the_first_ten_symbols(self):
        results = {f"S{i:02d}": {"reason": "invalid_payload", "invalid_detail": {"class": "PayloadMismatch", "message": "m", "requested_cik": 1, "received_cik": 2 if i % 2 else 1}} for i in range(12)}
        results["OK"] = {"status": "available", "quarterly": {"revenue": [{"derived": False}]}}
        results["OLD"] = {"reason": "invalid_payload"}
        summary = sec.invalid_summary(results)
        self.assertEqual(summary["count"], 13)
        self.assertEqual(summary["by_cause"], {"PayloadMismatch": 6, "cik_mismatch": 6, "unrecorded": 1})
        self.assertEqual(summary["symbols"], [f"S{i:02d}" for i in range(10)])
        self.assertEqual(sec.coverage(results, 14, 14)["invalid_payload_by_cause"], summary["by_cause"])

def annual_entry(start, end, val, accn, filed=None):
    return {"start": start, "end": end, "val": val, "filed": filed or f"{int(end[:4]) + 1}-02-20", "form": "10-K", "accn": accn}

class SameConceptFourthQuarter(unittest.TestCase):
    """A Q4 comes from the annual value of the quarterly series' own concept (audit2 earnings/q4tag.py)."""

    def mixed_tags(self, legacy=True):
        quarters = []
        for year in (2023, 2024, 2025, 2026):
            for s, e, f in ((f"{year}-01-01", f"{year}-03-31", f"{year}-05-01"), (f"{year}-04-01", f"{year}-06-30", f"{year}-08-01"), (f"{year}-07-01", f"{year}-09-30", f"{year}-10-30")):
                if e <= "2026-09-30":
                    quarters.append(quarter(s, e, 100 + (year - 2023) * 20, f, accn=f"q-{e}"))
        asc606 = [annual_entry(f"{y}-01-01", f"{y}-12-31", 500 + (y - 2023) * 80, f"k-{y}") for y in (2023, 2024, 2025)]
        # The 10-K also tags the legacy total, whose annual history is longer (tagged since before 2018).
        legacy_total = [annual_entry(f"{y}-01-01", f"{y}-12-31", 520 + (y - 2016) * 80, f"k-{y}") for y in range(2016, 2026)]
        concepts = {"RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": quarters + asc606}},
                    "EarningsPerShareDiluted": {"units": {"USD/shares": [dict(q, val=1.0) for q in quarters]}}}
        if legacy:
            concepts["Revenues"] = {"units": {"USD": legacy_total}}
        return {"cik": 7, "facts": {"us-gaap": concepts}}

    def test_a_legacy_annual_total_under_another_concept_no_longer_blocks_the_derivation(self):
        for legacy in (True, False):
            record = sec.normalize(self.mixed_tags(legacy), "ZZT", 7, "2026-11-04", "2026-11-04T20:00:00.000Z")
            revenue = record["quarterly"]["revenue"]
            derived = [p for p in revenue if p["derived"]]
            self.assertEqual([p["end"] for p in derived], ["2023-12-31", "2024-12-31", "2025-12-31"])
            self.assertEqual({p["tag"] for p in revenue}, {"RevenueFromContractWithCustomerExcludingAssessedTax"})
            self.assertEqual(derived[-1]["value"], 660 - 3 * 140)
            self.assertEqual(derived[-1]["components"][0], "k-2025")
            self.assertEqual(record["derivation_gaps"], [])
            # EPS is never derived: its fiscal fourth quarters stay absent.
            self.assertFalse(any(p["end"].endswith("12-31") for p in record["quarterly"]["eps"]))

class DerivationGaps(unittest.TestCase):
    """Each fiscal year whose Q4 stays unknown is listed with why (tag_mismatch, broken_chain, no_annual)."""

    def gaps(self, concepts, as_of="2026-03-01"):
        return sec.normalize({"cik": 1, "facts": {"us-gaap": concepts}}, "T", 1, as_of)["derivation_gaps"]

    def test_each_reason(self):
        eps = {"EarningsPerShareDiluted": {"units": {"USD/shares": [dict(q, val=1.0) for q in FY]}}}
        self.assertEqual(self.gaps({"Revenues": {"units": {"USD": FY[:3]}}, "SalesRevenueNet": {"units": {"USD": FY[3:]}}}),
            [{"fiscal_year": 2025, "metric": "revenue", "reason": "tag_mismatch"}])
        self.assertEqual(self.gaps({"Revenues": {"units": {"USD": [FY[0], FY[2], FY[3]]}}}), [{"fiscal_year": 2025, "metric": "revenue", "reason": "broken_chain"}])
        # The fiscal year is known from the annual EPS only: the revenue has no annual value at all.
        self.assertEqual(self.gaps({"Revenues": {"units": {"USD": FY[:3]}}, **eps}), [{"fiscal_year": 2025, "metric": "revenue", "reason": "no_annual"}])
        net = {"NetIncomeLoss": {"units": {"USD": [FY[0], FY[2], FY[3]]}}}
        self.assertEqual(self.gaps({"Revenues": {"units": {"USD": FY}}, **net}), [{"fiscal_year": 2025, "metric": "netIncome", "reason": "broken_chain"}])

    def test_no_gap_when_derived_before_the_10k_or_for_eps(self):
        self.assertEqual(self.gaps({"Revenues": {"units": {"USD": FY}}}), [])
        # Before the 10-K is filed the fiscal year has no annual value yet: nothing is missing.
        self.assertEqual(self.gaps({"Revenues": {"units": {"USD": FY}}}, as_of="2026-01-15"), [])
        eps_only = {"EarningsPerShareDiluted": {"units": {"USD/shares": [dict(q, val=q["val"] / 100) for q in FY]}}}
        self.assertEqual(self.gaps(eps_only), [])

    def test_a_bank_without_a_revenue_concept_is_flagged_not_gapped(self):
        """audit2 earnings/bank.py: EPS and net income in standard tags, revenue as net interest income."""
        q, ni = [], []
        for year in (2024, 2025):
            for s, e, f in ((f"{year}-01-01", f"{year}-03-31", f"{year}-05-01"), (f"{year}-04-01", f"{year}-06-30", f"{year}-08-01"), (f"{year}-07-01", f"{year}-09-30", f"{year}-10-30")):
                q.append(quarter(s, e, 1.5, f, accn=f"q-{e}")); ni.append(quarter(s, e, 100, f, accn=f"q-{e}"))
        annual = lambda value: [annual_entry(f"{y}-01-01", f"{y}-12-31", value, f"k-{y}") for y in (2024, 2025)]
        facts = {"cik": 9, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": q + annual(6.5)}}, "NetIncomeLoss": {"units": {"USD": ni + annual(450)}},
                 "InterestIncomeExpenseNet": {"units": {"USD": ni + annual(1700)}}}}}
        record = sec.normalize(facts, "ZZBK", 9, "2026-03-01")
        self.assertEqual((record["status"], record["quarterly"]["revenue"]), ("partial", []))
        self.assertEqual([p["end"] for p in record["quarterly"]["netIncome"] if p["derived"]], ["2024-12-31", "2025-12-31"])
        self.assertEqual(record["derivation_gaps"], [])
        self.assertEqual(sec.coverage({"ZZBK": record}, 1, 1)["no_revenue_concept"], 1)

class WiderTargets(unittest.TestCase):
    """Recently listed and strong rows join the targets after today's listed rows (plan DT8)."""

    def history(self, root, snapshots):
        import gzip, hashlib, json
        refs = []
        for as_of, records in snapshots:
            raw = gzip.compress(json.dumps({"as_of": as_of, "records": records}).encode())
            path = f"candidate-history/{as_of}-{hashlib.sha256(raw).hexdigest()[:16]}.json.gz"
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_bytes(raw)
            refs.append({"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "as_of": as_of})
        (root / sec.HISTORY_INDEX).write_text(json.dumps({"schema_version": 1, "snapshots": refs}))

    def test_order_listed_then_recent_then_ranked_then_strong(self):
        import tempfile
        record = lambda symbol, state, rules: {"symbol": symbol, "market": "US", "methods": {"minervini": {"state": state, "rules": [[r, None, None] for r in rules]}}}
        old = [record("OLD", "pass", ["pass"] * 9)]
        days = [f"2026-10-{d:02d}" for d in range(1, 13)]
        snapshots = [(days[0], old)] + [(day, [record("AAA", "pass", ["pass"] * 9)]) for day in days[1:10]] + [(days[10], [record("WWW", "fail", ["fail"] + ["pass"] * 8), record("UNK", "fail", ["fail", "unknown"] + ["pass"] * 7), record("TWO", "fail", ["fail", "fail"] + ["pass"] * 7)])]
        audit_row = lambda symbol, rs, unknown, qualified=False, failed=2: {"symbol": symbol, "methods": {"minervini": {"qualified": qualified, "failed": failed, "unknown": unknown, "rules": [{"label": "RS 推計 ≥ 70（公開日足の共通母集団）", "value": rs}]}}}
        audit = {"as_of_date": days[11], "results": [audit_row("AAA", 90, 0, True, 0), audit_row("RSA", 85, 1), audit_row("RSB", 79.9, 0), audit_row("RSC", 95, 2), audit_row("WWW", 88, 0)]}
        daily = {"as_of_date": days[11], "candidates": {"minervini": [{"symbol": "RNK"}]}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.history(root, snapshots)
            recent = sec.recent_listed(root, days[11])
            self.assertEqual(recent, {"symbols": ["AAA", "WWW"], "sessions": 10})
            self.assertEqual(sec.target_symbols(daily, audit, recent), ["AAA", "WWW", "RNK", "RSA"])
            # A snapshot on or after the analysis date is not a past publication.
            self.assertEqual(sec.recent_listed(root, days[10])["symbols"], ["OLD", "AAA"])
            # Without today's audit nothing is listed and no strong row is known; recent rows still come first.
            self.assertEqual(sec.target_symbols(daily, None, recent), ["AAA", "WWW", "RNK"])
            # A changed snapshot is never read: the recent rows are skipped and the skip is logged.
            path = next((root / "candidate-history").glob("2026-10-11-*.json.gz"))
            path.write_bytes(b"tampered")
            logged = []
            self.assertIsNone(sec.recent_listed(root, days[11], log=lambda *args, **kwargs: logged.append(args[0])))
            self.assertIn("skipped", logged[0])
        with tempfile.TemporaryDirectory() as directory:
            logged = []
            self.assertIsNone(sec.recent_listed(Path(directory), days[11], log=lambda *args, **kwargs: logged.append(args[0])))
            self.assertEqual(len(logged), 1)
        # A strong row far from the template (three failed conditions) is not a target.
        far = {"as_of_date": days[11], "results": [audit_row("FAR", 95, 0, False, 3), audit_row("NEAR", 95, 0, False, 2)]}
        self.assertEqual(sec.strong_rows(far, days[11]), ["NEAR"])
        self.assertEqual(sec.STRONG_MAX_FAILED, 2)
        # Listed-first order and the cap are unchanged.
        self.assertEqual(sec.MAX_SYMBOLS, 1500)
        self.assertEqual(sec.target_symbols({"as_of_date": "2026-10-30", "candidates": {}}, {"as_of_date": "2026-10-30", "results": [audit_row("LST", 50, 0, True, 0)]}, {"symbols": ["LST", "REC"]}), ["LST", "REC"])

    def test_strong_rows_beyond_the_limit_are_best_effort_never_truncation(self):
        """Listed rows within MAX_SYMBOLS but listed plus strong rows above it: nothing listed is cut, so no truncation
        (and no daily coverage warning); the strong rows left out are counted apart."""
        audit_row = lambda symbol, rs, qualified: {"symbol": symbol, "methods": {"minervini": {"qualified": qualified, "failed": 0 if qualified else 1, "unknown": 0 if qualified else 1,
            "rules": [{"label": "RS 推計 ≥ 70（公開日足の共通母集団）", "value": rs}]}}}
        listed = [f"L{i}" for i in range(1400)]
        strong = [f"S{i}" for i in range(300)]
        audit = {"as_of_date": "2026-11-05", "results": [audit_row(s, 90, True) for s in listed] + [audit_row(s, 90, False) for s in strong]}
        daily = {"as_of_date": "2026-11-05", "candidates": {}}
        core = sec.core_targets(daily, audit, None)
        ordered = sec.target_symbols(daily, audit, None)
        symbols = sec.requested(ordered, sec.MAX_SYMBOLS)
        self.assertEqual((len(core), len(ordered), len(symbols)), (1400, 1700, 1500))
        counts = sec.target_counts(core, ordered, symbols)
        self.assertEqual(counts, {"eligible": 1500, "truncated": 0, "strong_rows_requested": 100, "strong_rows_unfetched": 200})
        cover = sec.coverage({}, counts["eligible"], len(symbols), listed)
        self.assertEqual((cover["eligible"], cover["requested"], cover["truncated"]), (1500, 1500, 0))
        # A limit that cuts listed rows is truncation, counted over the listed, recent and ranked targets only.
        few = sec.requested(ordered, 1000)
        self.assertEqual(sec.target_counts(core, ordered, few), {"eligible": 1400, "truncated": 400, "strong_rows_requested": 0, "strong_rows_unfetched": 300})
        self.assertEqual(sec.coverage({}, 1400, len(few), listed)["truncated"], 400)

ADMIT_SCRIPT = """
import { admitBookFinancials } from './src/static/bookFinancialAdmission.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { asOfDate, evaluatedAt, results } = JSON.parse(input);
const admitted = Object.fromEntries(Object.entries(results).map(([key, value]) => {
  const symbol = value.symbol;
  return [key, admitBookFinancials(value, { symbol, asOfDate, evaluatedAt: Date.parse(evaluatedAt), row: { symbol, market: 'US' } }) === value];
}));
console.log(JSON.stringify(admitted));
"""

class BrowserAdmission(unittest.TestCase):
    """What this tool writes is exactly what the export, the carry overlay and the gate admit."""

    @unittest.skipUnless(__import__("shutil").which("node"), "node runs src/static/bookFinancialAdmission.js")
    def test_every_written_record_passes_the_browser_admission(self):
        import copy, json, subprocess
        from unittest.mock import patch
        from urllib.error import HTTPError, URLError
        rows = seven_years()
        full = {"cik": 1, "facts": {"us-gaap": {"Revenues": {"units": {"USD": rows}},
            "NetIncomeLoss": {"units": {"USD": [dict(r, val=r["val"] / 10) for r in rows]}},
            "EarningsPerShareDiluted": {"units": {"USD/shares": [dict(r, val=r["val"] / 100) for r in rows]}},
            "InventoryNet": {"units": {"USD": [{"end": f"{y}-12-31", "val": 7, "filed": f"{y + 1}-02-20", "form": "10-K", "accn": f"inv-{y}"} for y in range(2018, 2026)]}}}}}
        tickers = {"FULL": 1, "GONE": 4, "FPI": 5, "BAD": 6, "DOWN": 8}
        def get(url):
            if url.endswith("company_tickers.json"):
                return {str(i): {"ticker": t, "cik_str": c} for i, (t, c) in enumerate(tickers.items())}
            cik = int(url.rsplit("CIK", 1)[1].split(".")[0])
            if cik == 4:
                raise HTTPError(url, 404, "Not Found", {}, None)
            if cik == 5:
                return {"cik": 5, "facts": {"ifrs-full": {"Revenue": {"units": {"USD": [{"form": "20-F", "val": 1}, {"form": "6-K", "val": 1}]}}}}}
            if cik == 6:
                return {"cik": 999, "facts": {}}
            if cik == 8:
                raise URLError("reset")
            return full
        with patch.object(sec, "now_iso", lambda: "2026-03-02T10:00:00.000Z"):
            out = sec.collect([*tickers, "NONE"], "2026-03-02", get=get, sleep=lambda _: None)
        results = out["results"]
        self.assertEqual({s: r.get("reason") for s, r in results.items()},
            {"FULL": None, "GONE": "no_companyfacts", "FPI": "no_quarterly", "BAD": "invalid_payload", "DOWN": "transient", "NONE": "no_cik"})
        self.assertTrue(any(p["derived"] for p in results["FULL"]["quarterly"]["revenue"]))
        # One mutation proves the check is live: a fact filed after the as-of date is refused.
        future = copy.deepcopy(results["FULL"])
        future["quarterly"]["eps"][-1]["filed"] = "2026-03-03"
        cases = {**results, "FUTURE": future}
        payload = json.dumps({"asOfDate": "2026-03-02", "evaluatedAt": "2026-03-02T12:00:00.000Z", "results": cases}, allow_nan=False)
        run = subprocess.run(["node", "--input-type=module", "-e", ADMIT_SCRIPT], input=payload, cwd=Path(__file__).parent.parent,
            capture_output=True, text=True, check=True, timeout=60)
        self.assertEqual(json.loads(run.stdout), {**{symbol: True for symbol in results}, "FUTURE": False})

if __name__ == "__main__":
    unittest.main()
