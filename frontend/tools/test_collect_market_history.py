import importlib.util
from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
import pandas as pd

spec=importlib.util.spec_from_file_location('history_collector',Path(__file__).with_name('collect-market-history.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def record(symbol,days,missing=None,inception=946684800):
    stamps=[int(datetime.fromisoformat(day+'T16:00:00+00:00').timestamp()) for day in days]
    closes=[100+i*.2 for i in range(len(days))]
    quote={key:[(c+1 if key=='high' else c-1 if key=='low' else 10000 if key=='volume' else c) for c in closes] for key in module.FIELDS}
    if missing is not None:
        for values in quote.values():values[missing]=None
    raw=json.dumps({'chart':{'result':[{'meta':{'symbol':symbol,'firstTradeDate':inception},'timestamp':stamps,'indicators':{'quote':[quote]}}]}})
    return {'symbol':symbol,'raw':raw,'provenance':{'url':f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}','sha256':module.digest(raw.encode()),'retrieved_at':'2026-10-27T00:00:00+00:00'}}

class HistoryTests(unittest.TestCase):
    def setUp(self):self.days=[day.strftime('%Y-%m-%d') for day in pd.bdate_range('2024-01-01',periods=530)]
    def test_missing_session_does_not_become_multiday_return(self):
        frame,_=module.parse_series(record('A',self.days,missing=400),self.days)
        self.assertTrue(pd.isna(frame.loc[self.days[400],'close']))
        self.assertEqual(frame.close.rolling(253,min_periods=253).count().iloc[-1],252)
    def test_duplicate_source_date_rejected(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):module.parse_series(record('A',[*self.days,self.days[-1]]),self.days)
    def test_ipo_not_communication_failure(self):
        symbols=[f'S{i}' for i in range(101)]
        records={s:record(s,self.days) for s in symbols[:-1]}
        records[symbols[-1]]=record(symbols[-1],self.days,inception=int(datetime.fromisoformat(self.days[400]+'T00:00:00+00:00').timestamp()))
        value=module.build(records,{},symbols,self.days,self.days[-1]);last=value['breadth'][-1]
        self.assertEqual(last['eligibleUniverse'],100);self.assertEqual(last['coverage'],100)
        del records[symbols[-1]]
        last=module.build(records,{},symbols,self.days,self.days[-1])['breadth'][-1]
        self.assertEqual(last['eligibleUniverse'],101);self.assertEqual(last['coverage'],100)
    def test_low_coverage_is_unknown_not_zero(self):
        symbols=[f'S{i}' for i in range(120)]
        records={s:record(s,self.days) for s in symbols[:100]}
        last=module.build(records,{},symbols,self.days,self.days[-1])['breadth'][-1]
        self.assertIsNone(last['newHighs']);self.assertIsNone(last['leaderCount']);self.assertIsNone(last['ratio_10day'])
    def test_no_down_movers_does_not_make_infinite_ratio(self):
        symbols=[f'S{i}' for i in range(100)]
        value=module.build({s:record(s,self.days) for s in symbols},{},symbols,self.days,self.days[-1])
        self.assertEqual(value['breadth'][-1]['stocks_down_4pct'],0)
        self.assertIsNone(value['breadth'][-1]['ratio_10day'])
    def test_sector_frames_require_all_etfs_and_equal_values_share_rank(self):
        symbols=[f'S{i}' for i in range(100)]
        records={s:record(s,self.days) for s in [*symbols,'SPY',*module.SECTORS]}
        value=module.build(records,{},symbols,self.days,self.days[-1])
        self.assertGreater(len(value['sectorRotation']['frames']),250)
        self.assertTrue(all(row['rank']==1 for row in value['sectorRotation']['frames'][-1]['ranks']))
        del records['XLK']
        self.assertEqual(module.build(records,{},symbols,self.days,self.days[-1])['sectorRotation']['frames'],[])

if __name__=='__main__':unittest.main()
