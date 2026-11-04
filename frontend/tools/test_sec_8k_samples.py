import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("sec_8k_samples", Path(__file__).with_name("sec-8k-samples.py"))
samples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samples)


def point(end, start=None):
    return {"end": end, "start": start, "filed": end, "value": 1.0, "tag": "EarningsPerShareDiluted", "unit": "USD/shares", "accession": "a", "form": "10-Q", "derived": False}


def record(cik, quarter_ends, fiscal_year_end, status="available"):
    return {"status": status, "cik": cik, "quarterly": {"eps": [point(end) for end in quarter_ends]}, "annualEps": [point(fiscal_year_end)]}


SUBMISSIONS = {"filings": {"recent": {
    "form": ["8-K", "10-K", "8-K", "8-K", "8-K"],
    "items": ["2.02,9.01", "", "5.02", "2.02,9.01", "2.02"],
    "filingDate": ["2026-05-05", "2026-02-25", "2026-02-11", "2026-02-10", "2025-11-04"],
    "accessionNumber": ["0001-26-000009", "0001-26-000004", "0001-26-000003", "0001-26-000002", "0001-25-000020"],
}}}


class EightKSamples(unittest.TestCase):
    def test_only_fiscal_years_without_a_reported_q4_eps_are_sampled(self):
        book = {"as_of_date": "2026-03-01", "results": {
            "GAP": record(1, ["2025-03-31", "2025-06-30", "2025-09-30"], "2025-12-31"),
            "TAGGED": record(2, ["2025-09-30", "2025-12-31"], "2025-12-31"),
            "OLD": record(3, ["2024-09-30"], "2024-12-31"),
            "NONE": {"status": "unavailable", "reason": "no_quarterly"}}}
        self.assertEqual(samples.q4_eps_gaps(book), [{"symbol": "GAP", "cik": 1, "fiscal_year_end": "2025-12-31"}])
        self.assertEqual(samples.q4_eps_gaps(book, 0), [])

    def test_the_first_item_202_release_after_the_fiscal_year_end_is_chosen(self):
        self.assertEqual(samples.earnings_release(SUBMISSIONS, "2025-12-31", "2026-03-01"), ("2026-02-10", "0001-26-000002"))
        self.assertIsNone(samples.earnings_release(SUBMISSIONS, "2025-12-31", "2026-02-01"))
        self.assertEqual(samples.earnings_release(SUBMISSIONS, "2026-03-31", "2026-06-01"), ("2026-05-05", "0001-26-000009"))

    def test_exhibit_991_is_identified_by_name_only(self):
        index = lambda *names: {"directory": {"item": [{"name": name} for name in names]}}
        self.assertEqual(samples.exhibit_name(index("0001-index.htm", "q42025ex991.htm", "R1.htm")), "q42025ex991.htm")
        self.assertEqual(samples.exhibit_name(index("d123dex991.htm", "exhibit99-1.htm")), "d123dex991.htm")
        self.assertEqual(samples.exhibit_name(index("ex-99_1.htm")), "ex-99_1.htm")
        self.assertIsNone(samples.exhibit_name(index("ex9910.htm", "ex992.htm", "ex991.jpg")))

    def test_collect_uses_at_most_three_requests_per_symbol_and_saves_outside_public(self):
        calls = []
        def get_json(url):
            calls.append(url)
            return SUBMISSIONS if "submissions" in url else {"directory": {"item": [{"name": "ex991.htm"}]}}
        def get_document(url):
            calls.append(url)
            return b"<html>Three Months Ended</html>"
        with tempfile.TemporaryDirectory() as directory:
            manifest = samples.collect([{"symbol": "GAP", "cik": 1, "fiscal_year_end": "2025-12-31"}, {"symbol": "LATE", "cik": 2, "fiscal_year_end": "2026-12-31"}],
                                       "2026-03-01", directory, get_json, get_document)
            self.assertEqual([s["status"] for s in manifest["samples"]], ["saved", "not_found"])
            self.assertEqual(calls, ["https://data.sec.gov/submissions/CIK0000000001.json", "https://www.sec.gov/Archives/edgar/data/1/000126000002/index.json",
                                     "https://www.sec.gov/Archives/edgar/data/1/000126000002/ex991.htm", "https://data.sec.gov/submissions/CIK0000000002.json"])
            saved = manifest["samples"][0]
            self.assertEqual((saved["filed"], saved["bytes"]), ("2026-02-10", 31))
            self.assertEqual((Path(directory) / saved["file"]).read_bytes(), b"<html>Three Months Ended</html>")
            self.assertEqual(json.loads((Path(directory) / "manifest.json").read_text(encoding="utf-8"))["purpose"].split(";")[1].strip(), "not published")

    def test_document_requests_take_a_limiter_slot_and_reject_oversized_bodies(self):
        import io
        class Response(io.BytesIO):
            headers = {}
        class Limiter:
            calls = 0
            def wait(self): Limiter.calls += 1
        self.assertEqual(samples.get_bytes("https://www.sec.gov/x", opener=lambda req, timeout: Response(b"ok"), limiter=Limiter()), b"ok")
        with self.assertRaises(ValueError):
            samples.get_bytes("https://www.sec.gov/y", opener=lambda req, timeout: Response(b"x" * (samples.MAX_DOCUMENT_BYTES + 1)), limiter=Limiter())
        self.assertEqual(Limiter.calls, 2)


if __name__ == "__main__":
    unittest.main()
