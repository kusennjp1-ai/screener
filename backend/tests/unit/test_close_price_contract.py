"""Offline admission and real XNYS calendar regression for close+60m target."""
from copy import deepcopy
from datetime import date, datetime
import hashlib
import json
import unittest

from app.services.close_price_contract import CloseSession, audit_required_closes
from app.services.market_calendar_service import MarketCalendarService


def instant(value):
    return datetime.fromisoformat(value)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class CloseSessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.calendar = MarketCalendarService()

    def test_actual_nyse_dst_and_early_closes(self):
        # NYSE 2026 calendar: Nov 27 and Dec 24 close at 13:00 ET.
        for day, close in (
            ("2026-03-06", "2026-03-06T21:00:00+00:00"),
            ("2026-03-09", "2026-03-09T20:00:00+00:00"),
            ("2026-10-30", "2026-10-30T20:00:00+00:00"),
            ("2026-11-02", "2026-11-02T21:00:00+00:00"),
            ("2026-11-27", "2026-11-27T18:00:00+00:00"),
            ("2026-12-24", "2026-12-24T18:00:00+00:00"),
        ):
            with self.subTest(day=day):
                session = CloseSession.for_us(date.fromisoformat(day), self.calendar)
                self.assertEqual(session.close_at, instant(close))
                self.assertEqual((session.deadline_at - session.close_at).total_seconds(), 3600)

    def test_holidays_and_weekends_cannot_create_deadlines(self):
        for day in ("2026-07-03", "2026-11-26", "2026-12-25", "2026-10-03"):
            with self.subTest(day=day), self.assertRaisesRegex(ValueError, "not a US trading session"):
                CloseSession.for_us(date.fromisoformat(day), self.calendar)

    def test_collection_and_deadline_boundaries(self):
        session = CloseSession.for_us(date(2026, 10, 5), self.calendar)
        self.assertFalse(session.status(instant("2026-10-05T20:04:59+00:00"))["eligible_to_collect"])
        self.assertTrue(session.status(instant("2026-10-05T20:05:00+00:00"))["eligible_to_collect"])
        self.assertFalse(session.status(instant("2026-10-05T21:00:00+00:00"))["deadline_exceeded"])
        self.assertTrue(session.status(instant("2026-10-05T21:00:01+00:00"))["deadline_exceeded"])
        with self.assertRaisesRegex(ValueError, "timezone"):
            session.status(datetime(2026, 10, 5, 21))

    def test_calendar_failure_has_no_weekday_fallback(self):
        class BrokenCalendar:
            def session_close(self, market, session):
                raise RuntimeError("calendar unavailable")
        with self.assertRaisesRegex(RuntimeError, "calendar unavailable"):
            CloseSession.for_us(date(2026, 10, 5), BrokenCalendar())


class RequiredCloseTests(unittest.TestCase):
    def setUp(self):
        self.session = CloseSession.for_us(date(2026, 10, 5), MarketCalendarService())
        self.cohort = {"AAA": "NYSE", "BBB": "NASDAQ"}
        self.bundle = {
            "schema_version": "daily-price-bundle-v1", "market": "US", "as_of_date": "2026-10-05",
            "bar_period": "2y", "generated_at": "2026-10-05T20:10:00Z", "source_revision": "fixture:1",
            "rows": [{"symbol": symbol, "exchange": exchange, "prices": [
                {"date": "2026-10-02", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
                {"date": "2026-10-05", "open": 11, "high": 13, "low": 10, "close": 12, "volume": 110},
            ]} for symbol, exchange in self.cohort.items()],
        }
        self.manifest = {key: value for key, value in self.bundle.items() if key != "rows"}
        self.manifest["schema_version"] = "daily-price-manifest-v1"

    def audit(self, **overrides):
        args = dict(bundle=self.bundle, manifest=self.manifest, required_cohort=self.cohort,
                    required_cohort_sha256=digest(self.cohort), session=self.session,
                    now=instant("2026-10-05T20:15:00+00:00"), previous_session=date(2026, 10, 2))
        return audit_required_closes(**(args | overrides))

    def test_complete_required_cohort_passes(self):
        report = self.audit()
        self.assertEqual(report["fresh_count"], 2)
        self.assertFalse(report["deadline_exceeded"])
        self.assertEqual(len(report["close_observations_sha256"]), 64)

    def test_late_success_is_reported_as_late_not_as_sla_success(self):
        self.assertTrue(self.audit(now=instant("2026-10-05T21:01:00+00:00"))["deadline_exceeded"])

    def test_partial_rows_cannot_shrink_the_required_cohort(self):
        self.bundle["rows"].pop()
        with self.assertRaisesRegex(ValueError, "cohort incomplete"):
            self.audit()
        with self.assertRaisesRegex(ValueError, "pinned identity"):
            self.audit(required_cohort={"AAA": "NYSE"})

    def test_rejects_date_identity_clock_and_ohlcv_mismatches(self):
        cases = [
            (lambda b: b.update(as_of_date="2026-10-02"), "as_of_date"),
            (lambda b: b.update(source_revision="other"), "identity"),
            (lambda b: b.update(generated_at="2026-10-05T20:11:00Z"), "clocks"),
            (lambda b: b["rows"].append(deepcopy(b["rows"][0])), "Duplicate"),
            (lambda b: b["rows"][0].update(exchange="NASDAQ"), "Exchange"),
            (lambda b: b["rows"][0]["prices"].pop(), "stale"),
            (lambda b: b["rows"][0]["prices"][1].update(date="2026-10-06"), "future"),
            (lambda b: b["rows"][0]["prices"].reverse(), "Unordered"),
            (lambda b: b["rows"][0]["prices"][1].update(volume=float("nan")), "number"),
            (lambda b: b["rows"][0]["prices"][1].update(volume=True), "number"),
            (lambda b: b["rows"][0]["prices"][1].update(close=0), "envelope"),
            (lambda b: b["rows"][0]["prices"][1].update(close=15), "envelope"),
            (lambda b: b["rows"][0]["prices"][1].update(close=25, high=26), "adjustment continuity"),
        ]
        for mutate, reason in cases:
            with self.subTest(reason=reason):
                bundle = deepcopy(self.bundle)
                mutate(bundle)
                with self.assertRaisesRegex(ValueError, reason):
                    self.audit(bundle=bundle)

    def test_bad_clocks_or_regression_fail_closed(self):
        for clock in ("2026-10-05T20:04:00Z", "2026-10-05T20:16:00Z", "2026-10-05T20:10:00"):
            self.bundle["generated_at"] = self.manifest["generated_at"] = clock
            with self.subTest(clock=clock), self.assertRaises(ValueError):
                self.audit()
        with self.assertRaisesRegex(ValueError, "window"):
            self.audit(now=instant("2026-10-05T20:04:00+00:00"))
        with self.assertRaisesRegex(ValueError, "regress"):
            self.audit(previous_session=date(2026, 10, 6))


if __name__ == "__main__":
    unittest.main()
