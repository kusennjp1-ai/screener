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

class OfflineCalendarCandidateTests(unittest.TestCase):
    def test_candidate_only_derivation_is_replayable_without_price_provider(self):
        import hashlib
        import json
        import shutil
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "authenticated-source"
            source.mkdir()
            (source / "manifest.json").write_text(json.dumps({"as_of_date": "2026-10-16", "markets": {"US": {
                "as_of_date": "2026-10-16", "assets": {"charts": {"path": "charts.json"}}}}}))
            (source / "charts.json").write_text(json.dumps({"symbols": [{"path": "TEST.json"}]}))
            (source / "TEST.json").write_text(json.dumps({"bars": [{"date": "2023-01-03", "close": 17}]}))
            (source / "book-benchmark.json").write_bytes(b'{"bars":[],"unavailable":true,"original":true}\n')
            (source / "trading-calendar.json.tmp").write_bytes(b"existing authenticated temporary-name data")
            inventory = lambda root: {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()}
            original = inventory(source)
            candidate = Path(directory) / "candidate"
            replay = Path(directory) / "independent-replay"
            shutil.copytree(source, candidate)
            shutil.copytree(source, replay)
            with patch.dict("sys.modules", {"yfinance": None}), patch("socket.create_connection", side_effect=AssertionError("network forbidden")):
                first = module.export_calendar_only(candidate, "2026-10-17T00:00:00Z")
                second = module.export_calendar_only(replay, "2026-10-17T00:00:00Z")
            self.assertEqual(first, second)
            self.assertEqual(inventory(candidate), inventory(replay))
            self.assertEqual(inventory(source), original)
            self.assertEqual({k: v for k, v in inventory(candidate).items() if k != "trading-calendar.json"}, original)
            self.assertEqual(set(inventory(candidate)) - set(original), {"trading-calendar.json"})
            self.assertEqual(first["generated_at"], "2026-10-17T00:00:00+00:00")
            self.assertNotIn("2025-01-09", first["sessions"])
            self.assertIn("2025-11-28", first["sessions"])
            self.assertEqual((candidate / "trading-calendar.json").read_bytes(), (replay / "trading-calendar.json").read_bytes())

    def test_fixed_temporary_symlink_is_not_followed_or_removed(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text(json.dumps({"as_of_date": "2026-10-16"}))
            target = root / "untouched.txt"
            target.write_bytes(b"original")
            temporary = root / "trading-calendar.json.tmp"
            temporary.symlink_to(target)
            module.export_calendar_only(root, "2026-10-17T00:00:00Z")
            self.assertEqual(target.read_bytes(), b"original")
            self.assertTrue(temporary.is_symlink())
            self.assertFalse(list(root.glob(".trading-calendar-*.tmp")))
            self.assertEqual((root / "trading-calendar.json").stat().st_mode & 0o777, 0o644)

    def test_rejects_ambiguous_clock_or_price_date_without_writing(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = {"as_of_date": "2026-10-16", "markets": {"US": {"as_of_date": "2026-10-16"}}}
            (root / "manifest.json").write_text(json.dumps(manifest))
            for when in ["2026-10-17", "not-a-time", "2999-01-01T00:00:00Z", "2026-10-16T12:00:00Z"]:
                with self.subTest(when=when), self.assertRaises(ValueError):
                    module.export_calendar_only(root, when)
                self.assertFalse((root / "trading-calendar.json").exists())
            manifest["markets"]["US"]["as_of_date"] = "2026-10-15"
            (root / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "dates disagree"):
                module.export_calendar_only(root, "2026-10-17T00:00:00Z")
            self.assertFalse((root / "trading-calendar.json").exists())

    def test_calendar_cli_requires_fixed_clock_and_never_uses_unavailable_fallback(self):
        import subprocess
        import sys
        for args in [["--calendar-only"], ["--calendar-only", "--evaluated-at", "2026-10-17T00:00:00Z", "--allow-unavailable"],
                     ["--evaluated-at", "2026-10-17T00:00:00Z"]]:
            with self.subTest(args=args):
                result = subprocess.run([sys.executable, str(Path(module.__file__)), *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("error:", result.stderr)

if __name__ == "__main__":
    unittest.main()
