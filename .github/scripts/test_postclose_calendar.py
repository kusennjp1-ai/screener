import importlib.util
from datetime import datetime
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('postclose_calendar', Path(__file__).with_name('postclose-calendar.py'))
calendar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calendar)


class PostcloseCalendarTests(unittest.TestCase):
    def at(self, value):
        return calendar.calendar_at(datetime.fromisoformat(value.replace('Z', '+00:00')))

    def test_summer_close_and_two_minute_boundary(self):
        self.assertEqual(self.at('2026-10-27T20:01:59Z')['target_session'], '2026-10-26')
        value = self.at('2026-10-27T20:02:00Z')
        self.assertEqual(value['target_session'], '2026-10-27')
        self.assertEqual(value['target_close'], '2026-10-27T20:00:00Z')

    def test_winter_close_after_dst_transition(self):
        self.assertEqual(self.at('2026-11-02T20:59:59Z')['target_session'], '2026-10-30')
        value = self.at('2026-11-02T21:02:00Z')
        self.assertEqual(value['target_session'], '2026-11-02')
        self.assertEqual(value['target_close'], '2026-11-02T21:00:00Z')

    def test_spring_dst_and_weekend(self):
        value = self.at('2026-03-09T20:02:00Z')
        self.assertEqual(value['target_session'], '2026-03-09')
        self.assertEqual(value['target_close'], '2026-03-09T20:00:00Z')
        weekend = self.at('2026-03-08T20:02:00Z')
        self.assertEqual(weekend['target_session'], '2026-03-06')
        self.assertEqual(weekend['next_close'], '2026-03-09T20:00:00Z')

    def test_thanksgiving_and_early_close(self):
        self.assertEqual(self.at('2026-11-26T23:00:00Z')['target_session'], '2026-11-25')
        self.assertEqual(self.at('2026-11-27T18:01:59Z')['target_session'], '2026-11-25')
        value = self.at('2026-11-27T18:02:00Z')
        self.assertEqual(value['target_session'], '2026-11-27')
        self.assertEqual(value['target_close'], '2026-11-27T18:00:00Z')

    def test_christmas_eve_and_new_year(self):
        self.assertEqual(self.at('2026-12-24T18:02:00Z')['target_session'], '2026-12-24')
        self.assertEqual(self.at('2026-12-25T23:00:00Z')['target_session'], '2026-12-24')
        self.assertEqual(self.at('2027-01-01T23:00:00Z')['target_session'], '2026-12-31')

    def test_naive_clock_rejected(self):
        with self.assertRaises(ValueError):
            calendar.calendar_at(datetime(2026, 10, 27, 22))


if __name__ == '__main__':
    unittest.main()
