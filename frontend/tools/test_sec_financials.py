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

# Round 3 (D3): the 独自計算・参考 fiscal-Q4 EPS, emission off. A calendar-year filer: Q1-Q3 in 10-Qs, the year in its 10-K.
SHARES_TAG = "WeightedAverageNumberOfDilutedSharesOutstanding"
REF_QUARTERS = (("01-01", "03-31"), ("04-01", "06-30"), ("07-01", "09-30"))
# Q1-Q3 net income and weighted diluted shares, the annual weighted count as a filer reports it (an integer), the
# Q1-Q3 diluted EPS as reported (rounded to the cent) and the Q4 net income.
REF_YEAR = {"ni": (100e6, 110e6, 120e6, 140e6), "shares": (100e6, 101e6, 102e6, 101_509_589), "eps": (1.00, 1.09, 1.18)}

def ref_q4_shares(spec):
    """The expected Q4 weighted shares: (annual x 365 - Q1 x 90 - Q2 x 91 - Q3 x 92) / 92 days."""
    q1, q2, q3, annual = spec["shares"]
    return (annual * 365 - (q1 * 90 + q2 * 91 + q3 * 92)) / 92

def ref_payload(years, numerators=("NetIncomeLoss",), reported_q4=(), shares=True):
    """companyfacts for {year: spec} (REF_YEAR's shape). Each numerator tag carries the same net income; a year in
    `reported_q4` also tags its Q4 net income, Q4 shares and Q4 EPS in the 10-K. Revenue keeps the record available."""
    concepts = {}
    def add(tag, unit, row):
        concepts.setdefault(tag, {"units": {}})["units"].setdefault(unit, []).append(row)
    for year, spec in years.items():
        for q, (s, e) in enumerate(REF_QUARTERS):
            end = f"{year}-{e}"
            row = lambda val: {"start": f"{year}-{s}", "end": end, "val": val, "filed": (sec.date.fromisoformat(end) + sec.timedelta(days=30)).isoformat(), "form": "10-Q", "accn": f"q-{end}"}
            for tag in numerators:
                add(tag, "USD", row(spec["ni"][q]))
            if shares:
                add(SHARES_TAG, "shares", row(spec["shares"][q]))
            if spec["eps"][q] is not None:
                add("EarningsPerShareDiluted", "USD/shares", row(spec["eps"][q]))
            add("Revenues", "USD", row(1000 + q))
        tenk = lambda start, val: {"start": start, "end": f"{year}-12-31", "val": val, "filed": f"{year + 1}-02-20", "form": "10-K", "accn": f"k-{year}"}
        for tag in numerators:
            add(tag, "USD", tenk(f"{year}-01-01", sum(spec["ni"])))
        if shares:
            add(SHARES_TAG, "shares", tenk(f"{year}-01-01", spec["shares"][3]))
        add("EarningsPerShareDiluted", "USD/shares", tenk(f"{year}-01-01", spec.get("annual_eps", 4.6)))
        add("Revenues", "USD", tenk(f"{year}-01-01", 4100))
        if year in reported_q4:
            for tag in numerators:
                add(tag, "USD", tenk(f"{year}-10-01", spec["ni"][3]))
            if shares:
                add(SHARES_TAG, "shares", tenk(f"{year}-10-01", spec["q4_shares"]))
            add("EarningsPerShareDiluted", "USD/shares", tenk(f"{year}-10-01", spec["q4_eps"]))
    return {"cik": 1, "facts": {"us-gaap": concepts}}

def drop(payload, tag, end, start=None):
    """The payload without the tag's facts ending on `end` (only the one starting on `start`, when given)."""
    for rows in payload["facts"]["us-gaap"][tag]["units"].values():
        rows[:] = [r for r in rows if not (r["end"] == end and (start is None or r["start"] == start))]
    return payload

def reference(payload, as_of="2026-03-01"):
    record = sec.normalize(payload, "ZZQ", 1, as_of, "2026-03-01T10:00:00.000Z")
    return sec.q4_eps_reference(payload, as_of, sec.series(payload, "eps", as_of), sec.trim_cutoff(record["quarterly"]))

class Q4EpsReference(unittest.TestCase):
    """The reference fiscal-Q4 EPS (plan §5 D3): exact Q4 net income over approximate Q4 diluted shares, never in quarterly.eps."""

    def test_a_tiling_year_gives_q4_net_income_over_q4_diluted_shares(self):
        entries, samples, refusals = reference(ref_payload({2025: REF_YEAR}))
        self.assertEqual(entries, [{"end": "2025-12-31", "start": "2025-10-01", "value": round(140e6 / ref_q4_shares(REF_YEAR), 4), "method": "q4-ni-over-q4-diluted-shares-v1",
            "numerator": {"tag": "NetIncomeLoss", "components": ["k-2025", "q-2025-03-31", "q-2025-06-30", "q-2025-09-30"]},
            "shares": {"tag": SHARES_TAG, "components": ["k-2025", "q-2025-03-31", "q-2025-06-30", "q-2025-09-30"]}}])
        self.assertEqual(entries[0]["value"], 1.3592)
        self.assertAlmostEqual(ref_q4_shares(REF_YEAR), 103e6, delta=1)
        self.assertEqual(refusals, sec.Counter())
        # Q1-Q3: net income / weighted shares against the reported EPS, one sample each; no Q4 EPS is reported.
        self.assertEqual(samples, {"q4": [], "q1_q3": [(1.0, 1.0), (1.0891, 1.09), (1.1765, 1.18)]})

    def test_the_numerator_tags_are_tried_in_order_and_the_tag_used_is_recorded(self):
        tags = sec.Q4_REFERENCE_NUMERATOR_TAGS
        self.assertEqual(tags, ("NetIncomeLossAvailableToCommonStockholdersDiluted", "NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLoss"))
        self.assertEqual(reference(ref_payload({2025: REF_YEAR}, numerators=tags))[0][0]["numerator"]["tag"], tags[0])
        # The diluted tag without its annual value, or with a broken chain, falls back to the next tag that tiles.
        for broken in (lambda p: drop(p, tags[0], "2025-12-31"), lambda p: drop(p, tags[0], "2025-06-30")):
            entries, _, refusals = reference(broken(ref_payload({2025: REF_YEAR}, numerators=tags)))
            self.assertEqual((entries[0]["numerator"]["tag"], entries[0]["value"], refusals), (tags[1], 1.3592, sec.Counter()))
        self.assertEqual(reference(ref_payload({2025: REF_YEAR}, numerators=tags[2:]))[0][0]["numerator"]["tag"], "NetIncomeLoss")

    def test_q4_shares_outside_the_band_read_as_a_split(self):
        # The 10-K restates the year for a 2-for-1 split while the 10-Qs stay pre-split; or the remainder is negative.
        for annual in (2 * 101_509_589, 50_000_000):
            spec = dict(REF_YEAR, shares=(*REF_YEAR["shares"][:3], annual))
            entries, samples, refusals = reference(ref_payload({2025: spec}))
            self.assertEqual((entries, refusals), ([], sec.Counter({"split_band": 1})), annual)
            self.assertEqual(len(samples["q1_q3"]), 3)
        self.assertEqual(sec.Q4_REFERENCE_SHARE_BAND, 0.10)

    def test_a_missing_or_misaligned_fact_stays_unknown(self):
        cases = {
            "no_shares": [lambda p: drop(p, SHARES_TAG, "2025-06-30"), lambda p: drop(p, SHARES_TAG, "2025-12-31")],
            # The fiscal year is still known from its annual EPS and share count.
            "no_numerator": [lambda p: drop(p, "NetIncomeLoss", "2025-12-31")],
            "no_tiling": [lambda p: drop(p, "NetIncomeLoss", "2025-06-30"),
                lambda p: (drop(p, SHARES_TAG, "2025-06-30"), p["facts"]["us-gaap"][SHARES_TAG]["units"]["shares"].append(
                    {"start": "2025-04-02", "end": "2025-06-30", "val": 101e6, "filed": "2025-07-30", "form": "10-Q", "accn": "q-2025-06-30"}))[1]],
        }
        for reason, mutations in cases.items():
            for mutate in mutations:
                payload = ref_payload({2025: REF_YEAR})
                mutate(payload)
                entries, _, refusals = reference(payload)
                self.assertEqual((entries, refusals), ([], sec.Counter({reason: 1})), reason)
        # A filer that tags no weighted diluted shares at all.
        self.assertEqual(reference(ref_payload({2025: REF_YEAR}, shares=False))[2], sec.Counter({"no_shares": 1}))

    def test_a_loss_quarter_where_diluted_equals_basic_gives_a_negative_reference(self):
        # Q4 is a loss: its diluted count equals basic (anti-dilution), below Q1-Q3's diluted counts but within the band.
        q4_shares = 99_500_000
        annual = round((100e6 * 90 + 101e6 * 91 + 102e6 * 92 + q4_shares * 92) / 365)
        spec = dict(REF_YEAR, ni=(100e6, 110e6, 120e6, -60e6), shares=(100e6, 101e6, 102e6, annual))
        entries, _, refusals = reference(ref_payload({2025: spec}))
        self.assertEqual(refusals, sec.Counter())
        self.assertEqual(entries[0]["value"], round(-60e6 / ref_q4_shares(spec), 4))
        self.assertLess(entries[0]["value"], 0)
        self.assertAlmostEqual(entries[0]["value"], -60e6 / q4_shares, places=3)

    def test_a_q1_q3_check_failure_stays_unknown_but_is_still_sampled(self):
        off = dict(REF_YEAR, eps=(1.00, 1.30, 1.18))
        entries, samples, refusals = reference(ref_payload({2025: off}))
        self.assertEqual((entries, refusals), ([], sec.Counter({"check_failed": 1})))
        # Sampled before the check: the failing quarter's own pair is in the Q1-Q3 accuracy.
        self.assertIn((1.0891, 1.30), samples["q1_q3"])
        missing = reference(ref_payload({2025: dict(REF_YEAR, eps=(1.00, None, 1.18))}))
        self.assertEqual((missing[0], missing[2], len(missing[1]["q1_q3"])), ([], sec.Counter({"check_failed": 1}), 2))
        # A net income of 0 fails the check (there is nothing to compare against).
        zero = reference(ref_payload({2025: dict(REF_YEAR, ni=(0, 110e6, 120e6, 140e6), eps=(0.0, 1.09, 1.18))}))
        self.assertEqual((zero[0], zero[2]), ([], sec.Counter({"check_failed": 1})))
        # Within 2% passes: 1.09 x 101M = 110.09M against 110M.
        self.assertEqual(sec.Q4_REFERENCE_CHECK_TOLERANCE, 0.02)

    def test_a_filer_that_tags_its_q4_eps_gets_no_entry_and_contributes_a_q4_sample(self):
        spec = dict(REF_YEAR, q4_shares=103e6, q4_eps=1.36)
        payload = ref_payload({2025: spec}, reported_q4=(2025,))
        entries, samples, refusals = reference(payload)
        self.assertEqual((entries, refusals), ([], sec.Counter()))
        # The reported Q4 net income and shares are set aside: the reference is still the annual remainder.
        self.assertEqual(samples["q4"], [(1.3592, 1.36)])
        self.assertEqual(len(samples["q1_q3"]), 3)
        record = sec.normalize(payload, "ZZQ", 1, "2026-03-01")
        self.assertEqual(record["quarterly"]["eps"][-1]["end"], "2025-12-31")

    def test_entries_stay_in_the_record_window_and_the_newest_are_kept(self):
        payload = ref_payload({year: REF_YEAR for year in range(2019, 2026)})
        entries, samples, refusals = reference(payload)
        # The record's cutoff is 2022-12-27 (TRIM_DAYS before the newest end, 2025-12-31): older years are neither entries nor refusals.
        self.assertEqual([e["end"] for e in entries], ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"])
        self.assertEqual(refusals, sec.Counter())
        self.assertEqual(len(samples["q1_q3"]), 21)
        from unittest.mock import patch
        with patch.object(sec, "Q4_REFERENCE_MAX", 2):
            self.assertEqual([e["end"] for e in reference(payload)[0]], ["2024-12-31", "2025-12-31"])
        # The window, not the cap, bounds the entries; a refused year before the window is not tallied.
        old = ref_payload({**{year: REF_YEAR for year in range(2019, 2026)}, 2020: dict(REF_YEAR, eps=(1.00, 1.30, 1.18))})
        with patch.object(sec, "Q4_REFERENCE_MAX", 10):
            entries, _, refusals = reference(old)
        self.assertEqual(([e["end"] for e in entries], refusals), (["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"], sec.Counter()))
        self.assertEqual(sec.Q4_REFERENCE_MAX, 4)
        # Without a cutoff (a record with neither EPS nor revenue) nothing is trimmed but the cap.
        self.assertEqual(len(sec.q4_eps_reference(payload, "2026-03-01", sec.series(payload, "eps", "2026-03-01"))[0]), 4)

    def test_quarterly_eps_is_never_filled_and_tags_are_unchanged(self):
        payload = ref_payload({2025: REF_YEAR}, numerators=sec.Q4_REFERENCE_NUMERATOR_TAGS)
        record = sec.normalize(payload, "ZZQ", 1, "2026-03-01")
        self.assertEqual([p["end"] for p in record["quarterly"]["eps"]], ["2025-03-31", "2025-06-30", "2025-09-30"])
        self.assertEqual(sorted(record["quarterly"]), sorted(sec.TAGS))
        listed = {tag for tags, _ in sec.TAGS.values() for tag in tags}
        self.assertNotIn(SHARES_TAG, listed)
        self.assertNotIn("NetIncomeLossAvailableToCommonStockholdersDiluted", listed)
        self.assertNotIn("shares", {unit for _, unit in sec.TAGS.values()})

class Q4EpsReferenceEmission(unittest.TestCase):
    """Emission off: every written record is byte-identical to today's; the computation runs apart from normalize."""

    def fetch(self, payload, **kw):
        from unittest.mock import patch
        with patch.object(sec, "now_iso", lambda: "2026-03-01T10:00:00.000Z"):
            return sec.fetch_symbol("ZZQ", {"ZZQ": 1}, "2026-03-01", get=lambda url: payload, **kw)

    def base(self, payload):
        return sec.normalize(payload, "ZZQ", 1, "2026-03-01", "2026-03-01T10:00:00.000Z")

    def test_emission_off_writes_the_record_byte_identical_with_or_without_share_facts(self):
        import json
        self.assertIs(sec.Q4_EPS_REFERENCE_EMIT, False)
        dump = lambda value: json.dumps(value, ensure_ascii=False, allow_nan=False)
        with_shares = ref_payload({year: REF_YEAR for year in range(2022, 2026)}, numerators=("NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersDiluted"))
        without = ref_payload({year: REF_YEAR for year in range(2022, 2026)}, shares=False)
        expected = dump(self.base(without))
        tallied = []
        self.assertEqual(dump(self.fetch(with_shares, q4_reference=lambda *args: tallied.append(args))), expected)
        self.assertEqual(dump(self.fetch(without)), expected)
        # The reference was computed (4 entries) and only tallied.
        self.assertEqual(len(tallied[0][0]), 4)
        self.assertNotIn("q4EpsReference", dump(self.fetch(with_shares)))

    def test_emission_on_attaches_exactly_the_entries(self):
        from unittest.mock import patch
        payload = ref_payload({2025: REF_YEAR})
        with patch.object(sec, "Q4_EPS_REFERENCE_EMIT", True):
            record = self.fetch(payload)
        entries = record.pop("q4EpsReference")
        self.assertEqual(record, self.base(payload))
        self.assertEqual(len(entries), 1)
        self.assertEqual(sorted(entries[0]), ["end", "method", "numerator", "shares", "start", "value"])
        self.assertEqual((sorted(entries[0]["numerator"]), sorted(entries[0]["shares"])), (["components", "tag"], ["components", "tag"]))
        self.assertEqual((len(entries[0]["numerator"]["components"]), len(entries[0]["shares"]["components"])), (4, 4))
        # Nothing to attach: the key stays absent even with emission on.
        with patch.object(sec, "Q4_EPS_REFERENCE_EMIT", True):
            self.assertNotIn("q4EpsReference", self.fetch(ref_payload({2025: REF_YEAR}, shares=False)))

    def test_a_raising_computation_leaves_the_record_as_normalize_returned_it_and_is_tallied_as_error(self):
        from unittest.mock import patch
        payload = ref_payload({2025: REF_YEAR})
        def boom(*args, **kwargs):
            raise ZeroDivisionError("injected")
        tallied = []
        with patch.object(sec, "q4_eps_reference", boom), patch.object(sec, "Q4_EPS_REFERENCE_EMIT", True):
            record = self.fetch(payload, q4_reference=lambda *args: tallied.append(args))
            out = sec.collect(["ZZQ"], "2026-03-01", get=lambda url: {"0": {"ticker": "ZZQ", "cik_str": 1}} if url.endswith("company_tickers.json") else payload, sleep=lambda _: None)
        self.assertEqual(record, self.base(payload))
        self.assertEqual(record["status"], "available")
        self.assertEqual(tallied, [([], {"q4": [], "q1_q3": []}, sec.Counter({"error": 1}))])
        self.assertEqual(out["results"]["ZZQ"]["status"], "available")
        self.assertEqual(out["q4_reference"]["refused"]["error"], 1)
        self.assertEqual(out["q4_reference"]["entries"], 0)
        # An unreadable payload never reaches the reference.
        self.assertEqual(self.fetch({"cik": 999, "facts": {}}, q4_reference=lambda *args: tallied.append(args))["reason"], "invalid_payload")
        self.assertEqual(len(tallied), 1)

class Q4EpsReferenceAccuracy(unittest.TestCase):
    """The run's accuracy line: aggregates only, null (never 0) where nothing was measured."""

    def test_the_accuracy_arithmetic(self):
        acc = sec.q4_reference_accuracy
        self.assertEqual(acc([]), {"n": 0, "median_abs_error": None, "within_1c_or_2pct": None, "share": None})
        # Errors 0, 0.03, 0.05, 0.02: the median is 0.025; only the exact one is within 1 cent or 2% of the reported value.
        self.assertEqual(acc([(1.00, 1.00), (1.03, 1.00), (2.05, 2.00), (0.50, 0.52)]), {"n": 4, "median_abs_error": 0.025, "within_1c_or_2pct": 1, "share": 0.25})
        # Exactly 1 cent, and exactly 2% (0.10 of 5.00), are within; a cent and a half on a small EPS is not.
        self.assertEqual(acc([(1.23, 1.22), (5.10, 5.00), (0.115, 0.10)]), {"n": 3, "median_abs_error": 0.015, "within_1c_or_2pct": 2, "share": 0.6667})
        self.assertEqual(acc([(-0.52, -0.50)]), {"n": 1, "median_abs_error": 0.02, "within_1c_or_2pct": 0, "share": 0.0})

    def test_collect_tallies_every_record_read(self):
        payloads = {1: ref_payload({2025: REF_YEAR}), 2: ref_payload({2025: dict(REF_YEAR, q4_shares=103e6, q4_eps=1.36)}, reported_q4=(2025,)),
            3: ref_payload({2025: dict(REF_YEAR, eps=(1.00, 1.30, 1.18))}), 4: ref_payload({2025: REF_YEAR}, shares=False), 5: {"cik": 999, "facts": {}}}
        for cik in payloads:
            payloads[cik]["cik"] = cik if cik != 5 else 999
        def get(url):
            if url.endswith("company_tickers.json"):
                return {str(c): {"ticker": f"S{c}", "cik_str": c} for c in payloads}
            return payloads[int(url.rsplit("CIK", 1)[1].split(".")[0])]
        out = sec.collect([f"S{c}" for c in payloads], "2026-03-01", get=get, sleep=lambda _: None)
        summary = out["q4_reference"]
        self.assertEqual(summary, {"emit": False, "records_with_reference": 1, "entries": 1,
            "refused": {"no_numerator": 0, "no_tiling": 0, "no_shares": 1, "split_band": 0, "check_failed": 1, "not_finite": 0, "error": 0},
            "q4": {"n": 1, "median_abs_error": 0.0008, "within_1c_or_2pct": 1, "share": 1.0},
            "q1_q3": {"n": 9, "median_abs_error": 0.0009, "within_1c_or_2pct": 8, "share": 0.8889}})
        self.assertTrue(all("q4EpsReference" not in r for r in out["results"].values()))
        self.assertNotIn("q4_reference", out["results"]["S1"])

    def test_main_logs_the_line_and_writes_only_the_aggregate_at_file_level(self):
        import contextlib, gzip, io, json, os, sys, tempfile
        from unittest.mock import patch
        payload = ref_payload({2025: REF_YEAR})
        get = lambda url: {"0": {"ticker": "ZZQ", "cik_str": 1}} if url.endswith("company_tickers.json") else payload
        real = sec.collect
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "public/static-data").mkdir(parents=True)
            (root / "public/research-daily.json").write_text(json.dumps({"as_of_date": "2026-03-01", "candidates": {"minervini": [{"symbol": "ZZQ"}]}}), encoding="utf-8")
            summary_path = root / "summary.md"
            out = io.StringIO()
            try:
                os.chdir(directory)
                with patch.object(sec, "collect", lambda symbols, as_of: real(symbols, as_of, get=get, sleep=lambda _: None)), patch.object(sys, "argv", ["sec-financials.py"]), \
                        patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary_path)}), contextlib.redirect_stdout(out):
                    sec.main()
            finally:
                os.chdir(cwd)
            raw = gzip.decompress((root / "public/static-data/book-financials.json.gz").read_bytes())
            written = json.loads(raw)
            step = summary_path.read_text(encoding="utf-8")
        expected = {"emit": False, "records_with_reference": 1, "entries": 1,
            "refused": {"no_numerator": 0, "no_tiling": 0, "no_shares": 0, "split_band": 0, "check_failed": 0, "not_finite": 0, "error": 0},
            "q4": {"n": 0, "median_abs_error": None, "within_1c_or_2pct": None, "share": None},
            "q1_q3": {"n": 3, "median_abs_error": 0.0009, "within_1c_or_2pct": 3, "share": 1.0}}
        self.assertEqual(written["coverage"]["q4_reference"], expected)
        line = f"SEC q4 reference accuracy 2026-03-01: {json.dumps(expected, ensure_ascii=False)}"
        self.assertEqual(sec.q4_reference_line("2026-03-01", expected), line)
        self.assertIn(line, out.getvalue().splitlines())
        self.assertIn(f"- {line}", step.splitlines())
        self.assertIn('"emit": false', line)
        self.assertNotIn(b"q4EpsReference", raw)
        self.assertNotIn("q4_reference", written)
        self.assertNotIn("q4_reference", written["results"]["ZZQ"])
        # The existing coverage keys keep their values beside the new aggregate.
        self.assertEqual({key: written["coverage"][key] for key in ("available", "partial", "unavailable", "q4_revenue_derived")}, {"available": 1, "partial": 0, "unavailable": 0, "q4_revenue_derived": 1})

class Q4EpsReferenceBrowserAdmission(unittest.TestCase):
    """Round 3 D3 (P4): the browser admission takes the reference this tool writes with emission on, and mirrors its constants."""

    def source(self):
        return (Path(__file__).parent.parent / "src/static/bookFinancialAdmission.js").read_text(encoding="utf-8")

    def test_the_method_tags_and_cap_match_the_browser_admission(self):
        import json, re
        text = self.source()
        self.assertEqual(json.loads(re.search(r"SEC_Q4_REFERENCE_TAGS = Object\.freeze\((\{.*?\})\);", text).group(1)),
            {"numerator": list(sec.Q4_REFERENCE_NUMERATOR_TAGS), "shares": list(sec.Q4_REFERENCE_SHARE_TAGS)})
        self.assertEqual(re.search(r"SEC_Q4_REFERENCE_METHOD = '([^']+)';", text).group(1), sec.Q4_REFERENCE_METHOD)
        self.assertEqual(int(re.search(r"SEC_Q4_REFERENCE_MAX = (\d+);", text).group(1)), sec.Q4_REFERENCE_MAX)
        # The units the browser never needs: the numerator is USD (as netIncome) and the shares are a count.
        self.assertEqual((sec.Q4_REFERENCE_NUMERATOR_UNIT, sec.Q4_REFERENCE_SHARE_UNIT), ("USD", "shares"))

    @unittest.skipUnless(__import__("shutil").which("node"), "node runs src/static/bookFinancialAdmission.js")
    def test_a_record_written_with_emission_on_passes_the_browser_admission(self):
        import copy, json, subprocess
        from unittest.mock import patch
        payload = ref_payload({year: REF_YEAR for year in range(2022, 2026)}, numerators=sec.Q4_REFERENCE_NUMERATOR_TAGS)
        with patch.object(sec, "now_iso", lambda: "2026-03-01T10:00:00.000Z"), patch.object(sec, "Q4_EPS_REFERENCE_EMIT", True):
            record = sec.fetch_symbol("ZZQ", {"ZZQ": 1}, "2026-03-01", get=lambda url: payload)
        with patch.object(sec, "now_iso", lambda: "2026-03-01T10:00:00.000Z"):
            plain = sec.fetch_symbol("ZZQ", {"ZZQ": 1}, "2026-03-01", get=lambda url: payload)
        self.assertEqual([e["end"] for e in record["q4EpsReference"]], ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"])
        self.assertNotIn("q4EpsReference", plain)
        # Mutations that the admission must refuse (as 'keys'): another method, a reported EPS shadowed, five entries.
        method = copy.deepcopy(record); method["q4EpsReference"][-1]["method"] = "q4-other-v1"
        shadow = copy.deepcopy(record); shadow["q4EpsReference"][-1].update(end=record["quarterly"]["eps"][-1]["end"], start=record["quarterly"]["eps"][-1]["start"])
        shadow["q4EpsReference"].sort(key=lambda e: e["end"])
        many = copy.deepcopy(record); many["q4EpsReference"].insert(0, dict(record["q4EpsReference"][0], end="2021-12-31", start="2021-10-01"))
        cases = {"REF": record, "PLAIN": plain, "METHOD": method, "SHADOW": shadow, "MANY": many}
        payload_json = json.dumps({"asOfDate": "2026-03-01", "evaluatedAt": "2026-03-01T12:00:00.000Z", "results": cases}, allow_nan=False)
        run = subprocess.run(["node", "--input-type=module", "-e", ADMIT_SCRIPT], input=payload_json, cwd=Path(__file__).parent.parent,
            capture_output=True, text=True, check=True, timeout=60)
        self.assertEqual(json.loads(run.stdout), {"REF": True, "PLAIN": True, "METHOD": False, "SHADOW": False, "MANY": False})

if __name__ == "__main__":
    unittest.main()
