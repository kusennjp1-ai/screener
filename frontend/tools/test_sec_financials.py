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

if __name__ == "__main__":
    unittest.main()
