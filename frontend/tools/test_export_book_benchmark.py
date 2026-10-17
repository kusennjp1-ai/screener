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



class SessionCalendarExportTests(unittest.TestCase):
    def test_calendar_is_provider_derived_with_holidays_and_special_closure(self):
        import tempfile
        import pandas_market_calendars as mcal
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = module.export_session_calendar(root, {}, mcal, date(2026, 10, 16), datetime(2026, 10, 17, tzinfo=timezone.utc))
            self.assertNotIn('2025-01-09', result['sessions'])
            self.assertNotIn('2025-12-25', result['sessions'])
            self.assertIn('2025-11-28', result['sessions'])
            self.assertEqual(result['sessions'][-1], '2026-10-16')
            self.assertEqual(result['provider'], 'pandas_market_calendars')
            self.assertTrue((root / 'trading-calendar.json').is_file())

    def test_calendar_widens_for_old_price_dates_but_never_adopts_their_gaps(self):
        import tempfile
        import json
        import pandas_market_calendars as mcal
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'charts-index.json').write_text(json.dumps({'symbols': [{'path': 'stock.json'}]}))
            (root / 'stock.json').write_text(json.dumps({'bars': [{'date': '2023-01-03'}, {'date': '2026-10-16'}]}))
            manifest = {'markets': {'US': {'assets': {'charts': {'path': 'charts-index.json'}}}}}
            result = module.export_session_calendar(root, manifest, mcal, date(2026, 10, 16), datetime(2026, 10, 17, tzinfo=timezone.utc))
            self.assertEqual(result['range_start'], '2023-01-03')
            self.assertIn('2023-01-04', result['sessions'])
            self.assertGreater(len(result['sessions']), 900)

    def test_calendar_survives_missing_spy_prices(self):
        import tempfile
        import json
        import sys
        from unittest.mock import patch
        import pandas_market_calendars as mcal
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'as_of_date': '2026-10-16'}))
            fake_yf = SimpleNamespace(download=lambda *args, **kwargs: None)
            with patch.dict(sys.modules, {'yfinance': fake_yf}):
                with self.assertRaisesRegex(ValueError, 'no SPY prices'):
                    module.export_benchmark(root)
            calendar = json.loads((root / 'trading-calendar.json').read_text())
            self.assertEqual(calendar['provider_version'], mcal.__version__)
            self.assertGreater(len(calendar['sessions']), 400)

    def test_rejects_non_session_and_unclosed_target(self):
        import tempfile
        import pandas_market_calendars as mcal
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as directory:
            for target, now in [(date(2026, 10, 17), datetime(2026, 10, 18, tzinfo=timezone.utc)),
                                (date(2026, 10, 16), datetime(2026, 10, 16, 12, tzinfo=timezone.utc))]:
                with self.subTest(target=target), self.assertRaises(ValueError):
                    module.export_session_calendar(Path(directory), {}, mcal, target, now)
            self.assertFalse((Path(directory) / 'trading-calendar.json').exists())

if __name__ == "__main__":
    unittest.main()
