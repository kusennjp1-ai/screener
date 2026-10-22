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

    @staticmethod
    def bars(as_of='2026-10-16'):
        import pandas as pd
        return [{'date': d.date().isoformat(), 'open':100., 'high':102., 'low':99., 'close':101., 'volume':1000} for d in pd.bdate_range(end=as_of, periods=260)]

    @staticmethod
    def unavailable():
        # Exact envelope shape recorded by the failed 2026-10-17 main run.
        return {'schema_version':'book-benchmark-v1','symbol':'SPY','as_of_date':'2026-10-16',
                'bars':[],'unavailable':True,'error':'Invalid SPY OHLC at 2026-10-16',
                'generated_at':'2026-10-17T01:32:28.081303+00:00'}

    def test_explicit_unavailable_benchmark_never_creates_prices(self):
        from copy import deepcopy
        payload=self.unavailable(); original=deepcopy(payload)
        self.assertIsNone(module.benchmark_frame(payload,'2026-10-16'))
        self.assertEqual(payload,original)
        with self.assertRaises(KeyError): module.frame(payload['bars'])  # original failure reproduced

    def test_valid_benchmark_retains_exact_frame(self):
        import pandas as pd
        bars=self.bars()
        payload={**self.unavailable(),'bars':bars,'unavailable':False}
        pd.testing.assert_frame_equal(module.benchmark_frame(payload,'2026-10-16'),module.frame(bars))

    def test_unavailable_is_not_a_general_malformed_input_escape(self):
        mutations=[{'symbol':'QQQ'},{'as_of_date':'2026-10-15'},{'schema_version':'other'},
                   {'bars':self.bars()},{'error':''},{'error':None},{'unavailable':False}]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with self.assertRaises((ValueError,KeyError)):
                    module.benchmark_frame({**self.unavailable(),**mutation},'2026-10-16')
        bars=self.bars();bars[-1]['high']=90
        with self.assertRaisesRegex(ValueError,'Incoherent'):
            module.benchmark_frame({**self.unavailable(),'bars':bars,'unavailable':False},'2026-10-16')

    def test_unavailable_main_clears_every_derived_surface_without_scanner_or_relative_returns(self):
        self.assert_unavailable_main('2026-10-16', self.unavailable())

    def test_oct19_optional_benchmark_finishes_with_unknown_setups(self):
        # Regression for main run 39342318461: only the reported failure
        # envelope is modeled; the stock history is synthetic, not its artifact.
        self.assert_unavailable_main('2026-10-19', {
            'schema_version':'book-benchmark-v1', 'symbol':'SPY',
            'as_of_date':'2026-10-19', 'bars':[], 'unavailable':True,
            'error':'Invalid SPY OHLC at 2026-10-19',
        })

    def assert_unavailable_main(self, as_of, benchmark):
        import json, tempfile
        bars=self.bars(as_of)
        class LocalPool:
            def __init__(self, max_workers, initializer, initargs): initializer(*initargs)
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def map(self, function, tasks, chunksize): return map(function,tasks)
        row={'symbol':'OWNED','current_price':101,'eps_rating':90,'financial_current':{'unchanged':True},
             'se_pivot_price':120,'vcp_pivot':120,'se_setup_ready':True,'vcp_detected':True,
             'rs_rating':99,'ma_200':80,'passes_template':True,'rating':'Buy','execution_state':'ready',
             'risk_plan':{'entry':120},'signal':'buy','method_summary':{'qualified':True},'setup_engine':{'old':True},
             'setup_recalculation':{'status':'calculated','input_sha256':'old'}}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            files={'manifest.json':{'markets':{'US':{'pages':{'scan':{'path':'scan.json'}},'assets':{'charts':{'path':'charts.json'}}}}},
                   'scan.json':{'as_of_date':as_of,'initial_rows':[row],'chunks':[{'path':'chunk.json'}]},
                   'chunk.json':{'rows':[row]},'charts.json':{'symbols':[{'symbol':'OWNED','path':'OWNED.json'}]},
                   'OWNED.json':{'symbol':'OWNED','as_of_date':as_of,'bars':bars,'stock_data':row,
                                 'signal':'buy','risk_plan':{'entry':120},'vcp_boxes':[{'old':True}]},
                   'book-benchmark.json':benchmark}
            for name,value in files.items(): (root/name).write_text(json.dumps(value))
            benchmark_bytes=(root/'book-benchmark.json').read_bytes()
            with patch.object(module,'ROOT',root), patch.object(module.sys,'argv',['recalculate']), patch.object(module,'ProcessPoolExecutor',LocalPool), \
                 patch.object(module.SetupEngineScanner,'scan_stock',side_effect=AssertionError('scanner must not run')) as scanner, \
                 patch.object(module,'RelativeStrengthCalculator',side_effect=AssertionError('relative calculations must not run')) as relative:
                module.main(); scanner.assert_not_called();relative.assert_not_called()
            rows=[json.loads((root/'scan.json').read_text())['initial_rows'][0],json.loads((root/'chunk.json').read_text())['rows'][0],json.loads((root/'OWNED.json').read_text())['stock_data']]
            self.assertEqual(rows[0],rows[1]);self.assertEqual(rows[0],rows[2])
            for result in rows:
                self.assertEqual(result['setup_recalculation']['status'],'unavailable')
                self.assertEqual(result['setup_recalculation']['as_of_date'],as_of)
                self.assertIn('SPY benchmark unavailable',result['setup_recalculation']['reason'])
                for key in ['se_pivot_price','vcp_pivot','rs_rating','ma_200','passes_template','rating','execution_state','risk_plan','signal']: self.assertIsNone(result[key],key)
                self.assertFalse(result['se_setup_ready']);self.assertFalse(result['vcp_detected'])
                self.assertNotIn('method_summary',result);self.assertNotIn('setup_engine',result)
                self.assertEqual(result['current_price'],101);self.assertEqual(result['financial_current'],row['financial_current']);self.assertEqual(result['eps_rating'],90)
            chart=json.loads((root/'OWNED.json').read_text());self.assertEqual(chart['bars'],bars)
            self.assertEqual(chart['as_of_date'],as_of)
            self.assertIsNone(chart['signal']);self.assertIsNone(chart['risk_plan']);self.assertEqual(chart['vcp_boxes'],[])
            self.assertEqual((root/'book-benchmark.json').read_bytes(),benchmark_bytes)
            report=json.loads((root/'setup-recalculation-report.json').read_text());self.assertEqual(report['results'][0]['status'],'unavailable')
            self.assertEqual(report['as_of_date'],as_of)
            # Even a preseeded calculated cache with matching current hashes must
            # never restore a qualifying row while the benchmark is unavailable.
            cached={**rows[0], 'rs_rating':99, 'se_setup_ready':True}
            cached['setup_recalculation']={**cached['setup_recalculation'],'status':'calculated'}
            scan=json.loads((root/'scan.json').read_text());scan['initial_rows']=[cached]
            (root/'scan.json').write_text(json.dumps(scan));(root/'chunk.json').write_text(json.dumps({'rows':[cached]}))
            with patch.object(module,'ROOT',root), patch.object(module.sys,'argv',['recalculate']), patch.object(module,'ProcessPoolExecutor',LocalPool):
                module.main()
            refreshed=json.loads((root/'scan.json').read_text())['initial_rows'][0]
            self.assertEqual(refreshed['setup_recalculation']['status'],'unavailable')
            self.assertIsNone(refreshed['rs_rating']);self.assertFalse(refreshed['se_setup_ready'])



if __name__=='__main__':unittest.main()
