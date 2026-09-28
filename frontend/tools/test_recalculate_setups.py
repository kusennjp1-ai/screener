import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('recalculate',Path(__file__).with_name('recalculate-setups.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class SetupRecalculationTest(unittest.TestCase):
    def test_numpy_scalars_export_without_losing_false_or_unknown(self):
        import json,numpy as np
        value=json.loads(json.dumps({'ready':np.bool_(False),'pivot':np.float64(100),'unknown':None},default=module.native_scalar))
        self.assertEqual(value,{'ready':False,'pivot':100,'unknown':None})

    def test_clear_removes_all_old_setup_levels_and_decisions(self):
        row={'symbol':'KLAC','se_pivot_price':1700,'se_setup_ready':True,'se_base_depth_pct':20,
             'vcp_pivot':1680,'vcp_ready_for_breakout':True,'method_summary':{'qualified':True},'eps_rating':90}
        module.clear_setup(row)
        self.assertIsNone(row['se_pivot_price']);self.assertIsNone(row['vcp_pivot'])
        self.assertFalse(row['se_setup_ready']);self.assertFalse(row['vcp_ready_for_breakout'])
        self.assertNotIn('method_summary',row);self.assertEqual(row['eps_rating'],90)

    def test_invalid_bar_is_not_fixed_or_discarded(self):
        import pandas as pd
        bars=[{'date':d.date().isoformat(),'open':100.,'high':102.,'low':99.,'close':101.,'volume':1000} for d in pd.bdate_range(end='2026-09-25',periods=260)]
        bars[100]['high']=99
        with self.assertRaisesRegex(ValueError,'Incoherent'):
            module.validate(bars,'2026-09-25')
        self.assertEqual(len(bars),260);self.assertEqual(bars[100]['high'],99)

    def test_error_cannot_resurrect_old_pivot(self):
        row={'symbol':'AMD','se_pivot_price':500,'se_setup_ready':True}
        import pandas as pd
        bars=[{'date':d.date().isoformat(),'open':100.,'high':102.,'low':99.,'close':101.,'volume':1000} for d in pd.bdate_range(end='2026-09-25',periods=260)]
        with patch.object(module.SetupEngineScanner,'scan_stock',side_effect=RuntimeError('detector failed')):
            with self.assertRaises(RuntimeError):module.recalculate(row,bars,module.frame(bars),{'weighted':[]})
        self.assertIsNone(row['se_pivot_price']);self.assertFalse(row['se_setup_ready'])


if __name__=='__main__':unittest.main()
