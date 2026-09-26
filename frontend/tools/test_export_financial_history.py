import importlib.util
from pathlib import Path
import unittest
import pandas as pd
spec = importlib.util.spec_from_file_location('history', Path(__file__).with_name('export-financial-history.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HistoryTest(unittest.TestCase):
    def test_no_fabrication_and_no_future_periods(self):
        frame = pd.DataFrame({pd.Timestamp('2025-12-31'): [float('nan'), 100], pd.Timestamp('2026-12-31'): [9, 500]}, index=['DilutedEPS','TotalRevenue'])
        rows = module.normalize_frame(frame, '2026-09-25')
        self.assertEqual(rows, [{'end':'2025-12-31','eps':None,'revenue':100.,'netIncome':None}])
        self.assertIsNone(module.number(True))
        self.assertIsNone(module.number(float('inf')))

if __name__ == '__main__': unittest.main()
