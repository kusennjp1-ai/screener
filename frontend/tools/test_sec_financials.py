import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("sec_financials", Path(__file__).with_name("sec-financials.py"))
sec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sec)

def facts(entries):
    return {"cik": 1, "facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": entries}}}}}

def entry(**kw):
    return dict({"start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "form": "10-Q", "val": 1.5}, **kw)

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

if __name__ == "__main__":
    unittest.main()
