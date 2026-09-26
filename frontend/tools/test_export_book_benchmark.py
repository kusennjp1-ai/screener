"""Network-free validation boundary tests; test data are never exported."""
import copy
from datetime import date, timedelta
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("book_benchmark", Path(__file__).with_name("export-book-benchmark.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BenchmarkValidationTests(unittest.TestCase):
    def setUp(self):
        # Explicit expected sessions test the validator, not an exchange calendar.
        dates = [(date(2024, 1, 1) + timedelta(days=i)).isoformat() for i in range(600)
                 if (date(2024, 1, 1) + timedelta(days=i)).weekday() < 5]
        self.expected = dates
        self.bars = [{"date": d, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1000} for d in dates]

    def check(self, bars):
        module.validate_bars(bars, self.expected, self.expected[-1])

    def test_complete_exact_sessions(self):
        self.check(self.bars)

    def test_gaps_duplicates_stale_and_future(self):
        cases = [self.bars[:200] + self.bars[201:], self.bars + [self.bars[-1]], self.bars[:-1], list(reversed(self.bars))]
        future = copy.deepcopy(self.bars)
        future[-1]["date"] = "2099-01-01"
        cases.append(future)
        for bars in cases:
            with self.subTest(last=bars[-1]["date"]), self.assertRaises(ValueError):
                self.check(bars)

    def test_bad_numeric_and_ohlc_data(self):
        for key, value in [("close", float("nan")), ("high", float("inf")), ("low", 110), ("high", 90), ("volume", 0), ("open", -1)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                bars = copy.deepcopy(self.bars)
                bars[100][key] = value
                self.check(bars)

    def test_requires_real_two_year_extent(self):
        with self.assertRaises(ValueError):
            module.validate_bars(self.bars[-66:], self.expected[-66:], self.expected[-1])


if __name__ == "__main__":
    unittest.main()
