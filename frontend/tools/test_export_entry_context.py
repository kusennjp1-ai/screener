import importlib.util
from pathlib import Path
from datetime import date
import unittest
spec = importlib.util.spec_from_file_location('entry_context',Path(__file__).with_name('export-entry-context.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class CalendarTest(unittest.TestCase):
    def test_single_future_date_only(self):
        now=date(2026,9,26)
        self.assertEqual(module.normalize_earnings({'Earnings Date':[date(2026,10,20)]},now),'2026-10-20')
        for values in [[],['2026-02-30'],['2026-09-25'],['2027-12-01'],['2026-10-20','2026-10-21']]:
            self.assertIsNone(module.normalize_earnings({'Earnings Date':values},now))
    def test_targets_add_brief_near_rows_after_qualified(self):
        row = lambda symbol, **methods: {'symbol': symbol, 'methods': methods}
        audit = {'results': [row('NEAR', minervini={'qualified': False, 'failed': 1, 'unknown': 0}), row('IBD', ibd={'qualified': True}),
                 row('OPEN', minervini={'qualified': False, 'failed': 1, 'unknown': 1}), row('QUAL', minervini={'qualified': True, 'failed': 0, 'unknown': 0})]}
        self.assertEqual(module.target_symbols(audit), ['IBD', 'QUAL', 'NEAR'])

if __name__=='__main__': unittest.main()
