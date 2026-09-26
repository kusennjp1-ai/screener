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

if __name__ == "__main__":
    unittest.main()
