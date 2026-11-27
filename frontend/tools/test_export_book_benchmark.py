"""Network-free validation boundary tests; test data are never exported."""
import copy
from datetime import date, timedelta
import importlib.util
from pathlib import Path
import unittest

# Load the offline calendar stack once, before any test patches sys.modules:
# patch.dict removes modules first imported inside it, and numpy 2 cannot be
# imported a second time in one process.
try:
    import pandas_market_calendars  # noqa: F401
except ImportError:
    pass

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


class SameSessionRetentionTests(unittest.TestCase):
    """Network-free: a fake provider, an injected clock and sleep (nothing really waits)."""
    TARGET = date(2026, 10, 16)
    NOW = None

    def setUp(self):
        import json
        import tempfile
        from datetime import datetime, timezone
        import pandas_market_calendars as mcal
        self.json, self.mcal = json, mcal
        self.NOW = datetime(2026, 10, 17, tzinfo=timezone.utc)
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.lines, self.sleeps, self.requests = [], [], []

    def tearDown(self):
        self.directory.cleanup()

    def provider(self, outcomes, close=101.0, multi=False):
        """outcomes: per request True (a full series) or False (no prices); the last outcome repeats.

        The frame is duck-typed (only what fetch_benchmark reads), so the test does not
        depend on how a pandas/numpy release builds frames or column indexes."""
        from datetime import datetime, time
        from types import SimpleNamespace
        class Frame:
            def __init__(self, rows, levels):
                self.rows, self.empty = rows, not rows
                self.columns = SimpleNamespace(nlevels=levels, get_level_values=lambda level: ["SPY"] * 5)
            def xs(self, key, axis, level):
                assert (key, axis, level) == ("SPY", 1, -1)
                return Frame(self.rows, 1)
            def iterrows(self):
                return iter(self.rows)
        def download(symbol, start, end, **kwargs):
            self.requests.append((symbol, start, end))
            if not outcomes[min(len(self.requests), len(outcomes)) - 1]:
                return None
            days = self.mcal.get_calendar("NYSE").schedule(start_date=start, end_date=date.fromisoformat(end) - timedelta(days=1)).index
            rows = [(datetime.combine(day.date(), time()), {"Open": 100.0, "High": 102.0, "Low": 99.0, "Close": 101.0, "Volume": 1000.0}) for day in days]
            rows[-1][1]["Close"] = close
            return Frame(rows, 2 if multi else 1)
        return SimpleNamespace(download=download, __version__="test-provider")

    def series(self, target, close=101.0):
        """The bytes the exporter itself writes for a valid series of target."""
        payload = module.fetch_benchmark(target, self.mcal, self.provider([True], close), self.NOW)
        path = self.root / "series.tmp.json"
        module.write_benchmark(path, payload)
        raw = path.read_bytes()
        path.unlink()
        self.requests.clear()
        return raw

    def manifest(self, as_of):
        (self.root / "manifest.json").write_text(self.json.dumps({"as_of_date": as_of}))

    def export(self, yf, **options):
        return module.export_or_unavailable(self.root, yf=yf, clock=lambda: self.NOW, sleep=self.sleeps.append,
                                            log=self.lines.append, **options)

    def benchmark(self):
        return (self.root / "book-benchmark.json").read_bytes()

    def test_failed_request_keeps_same_session_validated_file_byte_for_byte(self):
        import os
        from unittest.mock import patch
        self.manifest("2026-10-16")
        original = self.series(self.TARGET)
        (self.root / "book-benchmark.json").write_bytes(original)
        summary = self.root / "summary.md"
        with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
            result = self.export(self.provider([False]))
        self.assertEqual(self.benchmark(), original)
        self.assertTrue(result["retained_same_session"])
        self.assertEqual((result["as_of_date"], result["bars"]), ("2026-10-16", len(self.json.loads(original)["bars"])))
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.sleeps, [])
        kept = [line for line in self.lines if "kept this same session's validated SPY unchanged" in line]
        self.assertEqual(len(kept), 1)
        self.assertIn(self.json.loads(original)["generated_at"], kept[0])
        self.assertIn("yfinance test-provider", kept[0])
        self.assertIn("kept this same session's validated SPY unchanged", summary.read_text())
        self.assertNotIn("::warning::", summary.read_text())

    def test_previous_session_file_is_never_kept(self):
        self.manifest("2026-10-16")
        (self.root / "book-benchmark.json").write_bytes(self.series(date(2026, 10, 15)))
        result = self.export(self.provider([False]), retries=2, interval=7)
        self.assertEqual(result["unavailable"], True)
        written = self.json.loads(self.benchmark())
        self.assertEqual((written["as_of_date"], written["bars"], written["unavailable"]), ("2026-10-16", [], True))
        self.assertIn("no SPY prices", written["error"])
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(self.sleeps, [7, 7])
        self.assertTrue(any("is for 2026-10-15, not 2026-10-16" in line for line in self.lines))
        self.assertFalse(any("kept this same session" in line for line in self.lines))

    def test_same_session_file_that_fails_validation_or_is_unavailable_is_not_kept(self):
        self.manifest("2026-10-16")
        valid = self.json.loads(self.series(self.TARGET))
        gap = {**valid, "bars": valid["bars"][:100] + valid["bars"][101:]}
        stale_last = {**valid, "bars": valid["bars"][:-1]}
        inconsistent = self.json.loads(self.json.dumps(valid))
        inconsistent["bars"][-1]["low"] = 200
        unavailable = {"schema_version": "book-benchmark-v1", "symbol": "SPY", "as_of_date": "2026-10-16", "bars": [], "unavailable": True, "error": "earlier"}
        other_symbol = {**valid, "symbol": "QQQ"}
        for name, payload in [("gap", gap), ("stale last bar", stale_last), ("inconsistent", inconsistent),
                              ("unavailable", unavailable), ("other symbol", other_symbol), ("not json", None)]:
            with self.subTest(name=name):
                self.lines.clear(); self.requests.clear(); self.sleeps.clear()
                raw = b"{not json" if payload is None else self.json.dumps(payload).encode()
                (self.root / "book-benchmark.json").write_bytes(raw)
                result = self.export(self.provider([False]), retries=0)
                self.assertEqual(result["unavailable"], True)
                self.assertEqual(self.json.loads(self.benchmark())["bars"], [])
                self.assertEqual(self.sleeps, [])
                self.assertTrue(any(line.startswith("No same-session SPY file can be kept") for line in self.lines))

    def test_success_replaces_the_file_and_logs_both_last_bars(self):
        self.manifest("2026-10-16")
        earlier = self.series(self.TARGET, close=101.0)
        for close, expected in [(101.0, "last bar identical"), (101.5, "last bar differs in close")]:
            with self.subTest(close=close):
                self.lines.clear(); self.requests.clear()
                (self.root / "book-benchmark.json").write_bytes(earlier)
                result = self.export(self.provider([True], close=close, multi=True))
                written = self.json.loads(self.benchmark())
                self.assertNotIn("retained_same_session", result)
                self.assertEqual(written["bars"][-1]["close"], close)
                self.assertNotEqual(written["generated_at"], self.json.loads(earlier)["generated_at"])
                comparison = [line for line in self.lines if "SPY same-session comparison 2026-10-16" in line]
                self.assertEqual(len(comparison), 1)
                self.assertIn(expected, comparison[0])
                self.assertIn("close 101.0", comparison[0])
                self.assertIn(f"close {close}", comparison[0])
                self.assertEqual(comparison[0].startswith("::warning::"), close != 101.0)
                self.assertIn(f"{0 if close == 101.0 else 1} of {len(written['bars'])} common bars differ", comparison[0])
        # No comparison without an earlier same-session file.
        self.lines.clear()
        (self.root / "book-benchmark.json").unlink()
        self.export(self.provider([True]))
        self.assertFalse(any("comparison" in line for line in self.lines))

    def test_retries_stop_after_nine_and_a_later_success_is_written(self):
        self.manifest("2026-10-16")
        result = self.export(self.provider([False]))
        self.assertEqual(result["unavailable"], True)
        self.assertEqual(len(self.requests), 10)
        self.assertEqual(self.sleeps, [600] * 9)
        self.requests.clear(); self.sleeps.clear()
        result = self.export(self.provider([False, False, True]))
        self.assertEqual((result["as_of_date"], len(self.requests), self.sleeps), ("2026-10-16", 3, [600, 600]))
        self.assertEqual(self.json.loads(self.benchmark())["bars"][-1]["date"], "2026-10-16")

    def test_calendar_preconditions_fail_at_once_without_requests(self):
        for as_of in ["2026-10-17", "2026-10-19"]:  # a Saturday; a session that has not closed at NOW
            with self.subTest(as_of=as_of):
                self.requests.clear(); self.sleeps.clear()
                self.manifest(as_of)
                result = self.export(self.provider([True]))
                self.assertEqual((result["unavailable"], result["as_of_date"]), (True, as_of))
                self.assertEqual((self.requests, self.sleeps), ([], []))

    def test_early_target_request_needs_no_manifest_and_writes_only_its_output(self):
        output = self.root / "early" / "book-benchmark.json"
        result = module.prefetch_benchmark(self.TARGET, output, yf=self.provider([False, True]), clock=lambda: self.NOW,
                                           sleep=self.sleeps.append, log=self.lines.append, interval=900,
                                           deadline=self.NOW + timedelta(hours=1))
        self.assertEqual((result["requests"], self.sleeps), (2, [900]))
        payload = self.json.loads(output.read_bytes())
        self.assertEqual((payload["as_of_date"], payload["bars"][-1]["date"]), ("2026-10-16", "2026-10-16"))
        self.assertEqual(sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*")), ["early", "early/book-benchmark.json"])

    def test_early_target_retries_only_until_the_new_york_deadline(self):
        from datetime import datetime, timezone
        # 18:30 New York time: the default 19:45 deadline comes before the end of the 90-minute window.
        clock = [datetime(2026, 10, 16, 22, 30, tzinfo=timezone.utc)]
        def sleep(seconds):
            self.sleeps.append(seconds)
            clock[0] += timedelta(seconds=seconds)
        output = self.root / "early.json"
        with self.assertRaises(module.ProviderUnavailable):
            module.prefetch_benchmark(self.TARGET, output, yf=self.provider([False]), clock=lambda: clock[0], sleep=sleep, log=self.lines.append)
        self.assertEqual(len(self.requests), 6)  # 18:30, 18:45, ... 19:45 New York time
        self.assertEqual(clock[0], datetime(2026, 10, 16, 23, 45, tzinfo=timezone.utc))
        self.assertFalse(output.exists())
        # A request after the deadline is made once and never repeated.
        self.requests.clear(); self.sleeps.clear()
        clock[0] = datetime(2026, 10, 17, 2, 0, tzinfo=timezone.utc)
        with self.assertRaises(module.ProviderUnavailable):
            module.prefetch_benchmark(self.TARGET, output, yf=self.provider([False]), clock=lambda: clock[0], sleep=sleep, log=self.lines.append)
        self.assertEqual((len(self.requests), self.sleeps), (1, []))
        # An unclosed session is refused before any request.
        self.requests.clear()
        with self.assertRaisesRegex(ValueError, "has not closed yet"):
            module.prefetch_benchmark(date(2026, 10, 19), output, yf=self.provider([True]), clock=lambda: clock[0], sleep=sleep, log=self.lines.append)
        self.assertEqual(self.requests, [])

    def test_early_target_retries_stop_ninety_minutes_after_the_first_request(self):
        from datetime import datetime, timezone
        # 2026-11-27 closed early at 13:00 New York time; 19:45 is far away, so the window decides.
        clock = [datetime(2026, 11, 27, 18, 5, tzinfo=timezone.utc)]
        def sleep(seconds):
            self.sleeps.append(seconds)
            clock[0] += timedelta(seconds=seconds)
        with self.assertRaises(module.ProviderUnavailable):
            module.prefetch_benchmark(date(2026, 11, 27), self.root / "early.json", yf=self.provider([False]),
                                      clock=lambda: clock[0], sleep=sleep, log=self.lines.append)
        self.assertEqual(module.EARLY_RETRY_WINDOW, timedelta(minutes=90))
        self.assertEqual(len(self.requests), 7)  # first request + 90 minutes at 15-minute spacing
        self.assertEqual(clock[0], datetime(2026, 11, 27, 19, 35, tzinfo=timezone.utc))
        self.assertFalse((self.root / "early.json").exists())

    def test_a_malformed_earlier_file_never_fails_a_successful_export(self):
        self.manifest("2026-10-16")
        valid = self.json.loads(self.series(self.TARGET))
        valid["bars"][0]["date"] = ["not", "hashable"]
        (self.root / "book-benchmark.json").write_text(self.json.dumps(valid))
        result = self.export(self.provider([True]))
        self.assertNotIn("unavailable", result)
        self.assertEqual(self.json.loads(self.benchmark())["bars"][-1]["date"], "2026-10-16")
        self.assertTrue(any("comparison could not be made" in line for line in self.lines))

    def test_early_file_is_placed_only_for_the_same_validated_session(self):
        early = self.root / "early.json"
        early.write_bytes(self.series(self.TARGET))
        destination = self.root / "book-benchmark.json"
        place = lambda: module.place_prefetched(self.root, early, clock=lambda: self.NOW, log=self.lines.append)
        self.manifest("2026-10-15")
        self.assertFalse(place())
        self.assertFalse(destination.exists())
        self.assertIn("is for 2026-10-16, not 2026-10-15", self.lines[-1])
        self.manifest("2026-10-16")
        self.assertTrue(place())
        self.assertEqual(destination.read_bytes(), early.read_bytes())
        self.assertFalse(place())
        self.assertIn("already exists", self.lines[-1])
        destination.unlink()
        early.write_bytes(self.json.dumps({**self.json.loads(early.read_bytes()), "bars": []}).encode())
        self.assertFalse(place())
        self.assertFalse(destination.exists())

    def test_cli_rejects_mixed_modes(self):
        import subprocess
        import sys
        for args in [["--target", "2026-10-16"], ["--output", "x.json"], ["--target", "2026-10-16", "--output", "x.json", "--allow-unavailable"],
                     ["--target", "2026-10-16", "--output", "x.json", "--place", "y.json"], ["--place", "y.json", "--allow-unavailable"],
                     ["--calendar-only", "--evaluated-at", "2026-10-17T00:00:00Z", "--target", "2026-10-16"], ["--target", "16 Oct", "--output", "x.json"]]:
            with self.subTest(args=args):
                result = subprocess.run([sys.executable, str(Path(module.__file__)), "--root", str(self.root), *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("error:", result.stderr)

if __name__ == "__main__":
    unittest.main()
