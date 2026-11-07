import importlib.util
from pathlib import Path
import unittest
import pandas as pd
spec = importlib.util.spec_from_file_location('history', Path(__file__).with_name('export-financial-history.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HistoryTest(unittest.TestCase):
    def test_does_not_require_the_missing_history_before_fetching_it(self):
        self.assertTrue(module.needs_history({'methods':{'ibd':{'qualified':False,'rules':[{'label':'RS','state':'pass'},{'label':'直近3年の EPS 成長履歴が揃う','state':'unknown'}]}}}))
        self.assertFalse(module.needs_history({'methods':{'ibd':{'rules':[]}}}))
    def test_no_fabrication_and_no_future_periods(self):
        frame = pd.DataFrame({pd.Timestamp('2025-12-31'): [float('nan'), 100], pd.Timestamp('2026-12-31'): [9, 500]}, index=['DilutedEPS','TotalRevenue'])
        rows = module.normalize_frame(frame, '2026-09-25')
        self.assertEqual(rows, [{'end':'2025-12-31','eps':None,'revenue':100.,'netIncome':None}])
        self.assertIsNone(module.number(True))
        self.assertIsNone(module.number(float('inf')))

    def test_every_provider_call_takes_a_one_second_slot_and_depth_is_measured(self):
        now, waits, calls = [0.0], [], []
        def sleep(seconds):
            waits.append(round(seconds, 6)); now[0] += seconds
        limiter = module.RateLimiter(module.YAHOO_RPS, clock=lambda: now[0], sleep=sleep)
        frame = lambda n: pd.DataFrame({pd.Timestamp(f'2025-{m:02d}-28'): [1.0] for m in range(1, n + 1)}, index=['DilutedEPS'])
        class Ticker:
            def __init__(self, symbol): self.symbol = symbol
            def get_income_stmt(self, freq):
                calls.append((self.symbol, freq, now[0])); return frame(5 if self.symbol == 'AAA' else 8) if freq == 'quarterly' else frame(1)
            def get_info(self):
                calls.append((self.symbol, 'info', now[0]))
                if self.symbol == 'CCC': raise RuntimeError('blocked')
                return {'financialCurrency': 'USD'}
        results = module.collect(['AAA', 'BBB', 'CCC'], '2026-09-25', Ticker, limiter)
        times = [t for *_, t in calls]
        self.assertEqual(len(calls), 9)
        self.assertTrue(all(b - a >= 1.0 - 1e-9 for a, b in zip(times, times[1:])))
        self.assertEqual(results['CCC']['status'], 'unavailable')
        self.assertEqual(module.quarterly_depth(results), {'0': 0, '1-4': 0, '5': 1, '6-7': 0, '8+': 2})
        self.assertEqual([module.depth_bucket(n) for n in (0, 4, 5, 6, 7, 8)], ['0', '1-4', '5', '6-7', '6-7', '8+'])
        self.assertEqual(set(module.coverage(results, 3, 3)), {'eligible', 'requested', 'available', 'four_annual_eps'})

    def test_listed_rows_without_sec_quarters_come_first(self):
        row = lambda symbol, qualified=False, failed=2, unknown=0: {'symbol': symbol, 'methods': {'minervini': {'qualified': qualified, 'failed': failed, 'unknown': unknown}}}
        audit = {'as_of_date': '2026-11-04', 'results': [row('AAA', True, 0), row('BBB', True, 0), row('CCC', False, 1, 0), row('DDD', False, 1, 0), row('EEE', False, 1, 1), row('FFF', False, 3, 0)]}
        sec = {'as_of_date': '2026-11-04', 'results': {'AAA': {'status': 'available'}, 'BBB': {'status': 'unavailable', 'reason': 'no_cik'}, 'CCC': {'status': 'partial'}, 'EEE': {'status': 'unavailable'}}}
        # DDD is listed and absent from the SEC file; EEE lacks SEC quarters but is not listed (one unknown).
        self.assertEqual(module.ordered_targets(audit, sec), (['BBB', 'DDD', 'AAA', 'CCC'], 2))
        # Another day's SEC file, or none, keeps the audit order.
        self.assertEqual(module.ordered_targets(audit, {**sec, 'as_of_date': '2026-11-03'}), (['AAA', 'BBB', 'CCC', 'DDD'], 0))
        self.assertEqual(module.ordered_targets(audit, None), (['AAA', 'BBB', 'CCC', 'DDD'], 0))

if __name__ == '__main__': unittest.main()
