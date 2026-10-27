import importlib.util
from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
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

class DailyHistoryTests(unittest.TestCase):
    def current(self):
        day='2026-10-23'
        return {'schema_version':'market-long-history-v1','market':'US','as_of_date':day,'errors':{},'calendar':{},
                'breadth':[{'date':day,'above50':90,'newHighs':2,'newLows':1,'leaderCount':8}],
                'sp500':[{'date':day,'close':6000.0}],
                'sectorRotation':{'frames':[{'date':day,'ranks':[{'symbol':symbol} for symbol in module.SECTORS]}]},
                'sectorBreadth':[{'points':[{'date':day}]}]}
    def test_current_requires_actual_final_values_on_every_main_timeline(self):
        module.require_current(self.current())
        for field in ('breadth','sp500','rotation','sector'):
            value=self.current()
            if field=='breadth':value['breadth'][-1]['newHighs']=None
            if field=='sp500':value['sp500'][-1]['date']='2026-10-22'
            if field=='rotation':value['sectorRotation']['frames'][-1]['ranks'].pop()
            if field=='sector':value['sectorBreadth'][0]['points'][-1]['date']='2026-10-22'
            with self.assertRaises(ValueError):module.require_current(value)
    def test_failed_refresh_preserves_source_bytes_and_reports_stale_observation(self):
        with TemporaryDirectory(prefix='history-daily-') as directory:
            output=Path(directory)/'source.json';report=Path(directory)/'report.json'
            previous=self.current();previous['as_of_date']='2026-10-22';before=module.encode(previous)+b'\n';output.write_bytes(before)
            failed=self.current();failed['breadth'][0]['newHighs']=None
            with patch.object(module,'fetch_symbol',side_effect=OSError('offline test')),patch.object(module,'build',return_value=failed):
                result=module.collect('2026-10-23',[f'S{i}' for i in range(100)],None,Path(directory)/'cache',output,allow_unavailable=True,report=report)
            self.assertFalse(result['updated']);self.assertEqual(result['retained_as_of_date'],'2026-10-22')
            self.assertEqual(output.read_bytes(),before);self.assertEqual(json.loads(report.read_bytes()),result)
    def test_success_replaces_source_only_after_readiness_and_keeps_raw_digest(self):
        with TemporaryDirectory(prefix='history-daily-') as directory:
            output=Path(directory)/'source.json';source=self.current()
            with patch.object(module,'fetch_symbol',side_effect=OSError('offline test')),patch.object(module,'build',return_value=source):
                result=module.collect('2026-10-23',[f'S{i}' for i in range(100)],None,Path(directory)/'cache',output)
            self.assertTrue(result['updated']);self.assertEqual(result['sha256'],module.digest(output.read_bytes()))
            self.assertEqual(json.loads(output.read_bytes())['as_of_date'],'2026-10-23')
    def test_completed_session_calendar_handles_short_close_and_rejects_open_or_holiday(self):
        class Clock(datetime):
            @classmethod
            def now(cls,tz=None):return cls(2026,11,27,17,59,tzinfo=timezone.utc)
        with TemporaryDirectory(prefix='history-calendar-') as directory,patch.object(module,'datetime',Clock):
            with self.assertRaisesRegex(ValueError,'completed NYSE'):
                module.collect('2026-11-27',[f'S{i}' for i in range(100)],None,directory,Path(directory)/'source.json')
            with self.assertRaisesRegex(ValueError,'completed NYSE'):
                module.collect('2026-11-26',[f'S{i}' for i in range(100)],None,directory,Path(directory)/'source.json')
    def test_incomplete_cached_close_is_refetched_instead_of_poisoning_retries(self):
        with TemporaryDirectory(prefix='history-cache-') as directory:
            target='2026-10-23';start='2026-10-01';cached=record('SYNTH',['2026-10-22'])
            cached['as_of_date']=target;cached['provenance']['retrieved_at']=datetime.now(timezone.utc).isoformat()
            cache=Path(directory);key=module.digest(f'SYNTH/{start}/{target}'.encode());(cache/f'{key}.json').write_bytes(module.encode(cached))
            # Any HTTP call proves the missing target was not accepted as ready.
            with patch.object(module.urllib.request,'urlopen',side_effect=ValueError('fresh request')) as fetch:
                with self.assertRaisesRegex(ValueError,'fresh request'):module.fetch_symbol('SYNTH',target,start,cache)
                self.assertEqual(fetch.call_count,1)
    def test_invalid_last_bar_is_not_an_eligible_retry_cache_hit(self):
        self.assertIsNone(module.latest_response_day(record('A',['2026-10-23'],missing=0)))

    def test_published_universe_uses_current_audit_and_dated_scan_classification(self):
        with TemporaryDirectory(prefix='history-universe-') as directory:
            root=Path(directory)/'static-data';root.mkdir()
            symbols=[f'S{i}' for i in range(100)];day='2026-10-23'
            audit={'version':'ohlcv-v2-session-calendar','as_of_date':day,'results':[{'symbol':s,'audit':{'symbol':s,'version':'ohlcv-v2-session-calendar','as_of_date':day,'valid':True,'status':'verified','errors':[]}} for s in symbols]}
            (root.parent/'qualification-audit.json').write_bytes(module.encode(audit))
            manifest={'markets':{'US':{'as_of_date':day,'assets':{'charts':{'path':'charts.json'}},'pages':{'scan':{'path':'scan.json'}}}}}
            (root/'manifest.json').write_bytes(module.encode(manifest));(root/'charts.json').write_bytes(module.encode({'symbols':[{'symbol':s,'path':s+'.json'} for s in symbols]}))
            scan={'as_of_date':day,'initial_rows':[{'symbol':s,'gics_sector':'Technology' if s!='S0' else 'Financial Services'} for s in symbols]}
            (root/'scan.json').write_bytes(module.encode(scan))
            for symbol in symbols:(root/(symbol+'.json')).write_bytes(module.encode({'symbol':symbol,'as_of_date':day,'bars':[{'date':day}]}))
            target,chosen,classification=module.published_universe(root)
            self.assertEqual(target,day);self.assertEqual(chosen,sorted(symbols));self.assertEqual(classification['memberships']['S0'],'Financial')
            self.assertEqual(classification['memberships']['S1'],'Technology')
            self.assertEqual(classification['source_inputs'][0]['sha256'],module.digest((root/'scan.json').read_bytes()))
            audit['results'][0]['audit']['as_of_date']='2026-10-22';(root.parent/'qualification-audit.json').write_bytes(module.encode(audit))
            with self.assertRaisesRegex(ValueError,'identity/date'):module.published_universe(root)

if __name__=='__main__':unittest.main()
