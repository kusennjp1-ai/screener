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
    def test_symbol_failing_mid_computation_contributes_to_no_aggregate(self):
        symbols=[f'S{i}' for i in range(110)]
        records={s:record(s,self.days,missing=100 if i%9==0 else None) for i,s in enumerate(symbols)}
        # S5 alone has a provider-confirmed inception, so a partial contribution would also move the expected denominator.
        records['S5']=record('S5',self.days,inception=int(datetime.fromisoformat(self.days[100]+'T00:00:00+00:00').timestamp()))
        classification={'memberships':{s:module.GROUPS[i%len(module.GROUPS)] for i,s in enumerate(symbols)}}
        absent={s:value for s,value in records.items() if s!='S5'}
        reference=module.build(absent,{},symbols,self.days,self.days[-1],classification)
        original=module.classify_stages;calls=[]
        def stage_failure(*args):
            calls.append(1)
            if len(calls)==6:raise ValueError('synthetic mid-computation failure')
            return original(*args)
        broken={**records,'S5':{key:value for key,value in records['S5'].items() if key!='provenance'}}
        # The first failure is after coverage/above50/new highs and before stages; the second is after every count.
        for name,inputs,patcher in [('stage',records,patch.object(module,'classify_stages',side_effect=stage_failure)),('provenance',broken,patch.object(module,'classify_stages',side_effect=original))]:
            with self.subTest(name),patcher:
                calls.clear();value=module.build(inputs,{},symbols,self.days,self.days[-1],classification)
                self.assertIn('S5',value['errors']);self.assertNotIn('S5',{row['symbol'] for row in value['provenance']})
                self.assertEqual(value['breadth'],reference['breadth']);self.assertEqual(value['sectorBreadth'],reference['sectorBreadth'])
                last=value['breadth'][-1];self.assertEqual(last['coverage'],109);self.assertEqual(last['eligibleUniverse'],110)
                self.assertEqual(sum(last[f'stage{k}'] for k in (1,2,3,4)),last['coverage'])

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

# Round 3 M8a-M8c: five optional breadth keys behind EMIT_R3_MARKET_FIELDS (off until the round-3 UI is on Pages).
def bars_record(symbol,days,closes,highs,lows,volumes,missing=()):
    stamps=[int(datetime.fromisoformat(day+'T16:00:00+00:00').timestamp()) for day in days]
    quote={'open':list(closes),'high':list(highs),'low':list(lows),'close':list(closes),'volume':list(volumes)}
    for index in missing:
        for values in quote.values():values[index]=None
    raw=json.dumps({'chart':{'result':[{'meta':{'symbol':symbol,'firstTradeDate':946684800},'timestamp':stamps,'indicators':{'quote':[quote]}}]}})
    return {'symbol':symbol,'raw':raw,'provenance':{'url':f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}','sha256':module.digest(raw.encode()),'retrieved_at':'2026-10-27T00:00:00+00:00'}}

def designed_universe(n=560,count=110,gap_symbols=0,gap_at=None):
    """Random trends for RS spread, plus designed breakouts, a high-only new high and a cohort member that breaks down."""
    import numpy as np
    days=[day.strftime('%Y-%m-%d') for day in pd.bdate_range('2024-01-01',periods=n)]
    series={}
    for i in range(count):
        rng=np.random.default_rng(100+i);drift=[.0025,0.,-.001][i%3];level=50.;closes=[]
        for _ in range(n):level*=1+drift+rng.normal(0,.012);closes.append(round(level,4))
        series[f'S{i}']={'close':closes,'high':[c*1.005 for c in closes],'low':[c*.99 for c in closes],'volume':[10000]*n,'missing':set()}
    def steady(rate,wiggle):
        return [round(40*(1+rate)**k*(1+.004*np.sin(k/5+wiggle)),4) for k in range(n)]
    # S0..S4 break out 9, 7, 6, 5 and 7 sessions before the last session; S5's high (not its close) makes a new high.
    plans={'S0':(n-10,None),'S1':(n-8,6),'S2':(n-7,3),'S3':(n-6,5),'S4':(n-7,None)}
    for k,(symbol,(b,fail)) in enumerate(plans.items()):
        closes=steady(.003,k);top=max(closes[j]*1.005 for j in range(b-251,b))
        closes[b]=round(top*1.03,4)
        for j in range(b+1,n):closes[j]=round(closes[b]*.995,4)
        highs=[c*1.005 for c in closes];lows=[c*.99 for c in closes];volumes=[10000]*n;volumes[b]=30000
        if fail is not None and b+fail<n:lows[b+fail]=closes[b]*.90
        series[symbol]={'close':closes,'high':highs,'low':lows,'volume':volumes,'missing':{b+2} if symbol=='S4' else set()}
    closes=steady(.003,9);b=n-7;top=max(closes[j]*1.005 for j in range(b-251,b))
    for j in range(b,n):closes[j]=round(top*.99,4)
    highs=[c*1.005 for c in closes];highs[b]=top*1.02
    series['S5']={'close':closes,'high':highs,'low':[c*.99 for c in closes],'volume':[10000]*n,'missing':set()}
    # S6 leads strongly, then falls below its 50-day line within the last 20 sessions.
    closes=steady(.005,3)
    for j in range(n-18,n):closes[j]=round(closes[j-1]*.98,4)
    series['S6']={'close':closes,'high':[c*1.005 for c in closes],'low':[c*.99 for c in closes],'volume':[10000]*n,'missing':set()}
    for i in range(gap_symbols):series[f'S{count-1-i}']['missing'].add(gap_at)
    symbols=[f'S{i}' for i in range(count)]
    records={s:bars_record(s,days,v['close'],v['high'],v['low'],v['volume'],sorted(v['missing'])) for s,v in series.items()}
    return days,symbols,records,series

def replay(series,symbols,n):
    """Independent scalar replay of the five keys from the bars (written apart from the collector, as audit-market-history.py is)."""
    present=lambda s,j:j>=0 and j not in series[s]['missing']
    def good(s,j):return j>=252 and all(present(s,k) for k in range(j-252,j+1))
    def mean(values):return sum(values)/len(values)
    cache={}
    def obs(s,j):
        if (s,j) in cache:return cache[(s,j)]
        if not good(s,j):cache[(s,j)]=None;return None
        v=series[s];c=v['close'];cj=c[j]
        ma=lambda m,lag=0:mean(c[j-lag-m+1:j-lag+1])
        ma50,ma150,ma200=ma(50),ma(150),ma(200)
        high252=max(v['high'][j-251:j+1]);low252=min(v['low'][j-251:j+1]);prior=max(v['high'][j-251:j])
        trend=cj>ma150 and cj>ma200 and ma150>ma200 and ma200>ma(200,21) and ma50>ma150 and ma50>ma200 and cj>ma50 and cj/high252>=.75
        cache[(s,j)]=row={'template30':trend and cj/low252>=1.30,'above50':cj>ma50,'newHigh':v['high'][j]>prior,'newHighClose':cj>prior,
            'momentum':sum((cj/c[j-lag]-1)*w for lag,w in [(63,.4),(126,.2),(189,.2),(252,.2)]),
            'volumeOk':v['volume'][j]>=1.4*mean(v['volume'][j-50:j])}
        return row
    def rs(j):
        rows={s:obs(s,j) for s in symbols if obs(s,j)};order=sorted(rows,key=lambda s:rows[s]['momentum'])
        return {s:1+98*k/max(len(order)-1,1) for k,s in enumerate(order)}
    def sufficient(j):
        observed=sum(1 for s in symbols if obs(s,j));return j>=0 and observed/len(symbols)>=.9 and observed>=100
    def breakout(s,j):
        row=obs(s,j)
        return bool(row) and row['template30'] and row['newHighClose'] and row['volumeOk']
    result={}
    for i in range(n-25,n):
        valid=sufficient(i);then=i-module.LEADER_LOOKBACK_SESSIONS;rank=rs(then)
        members={s for s in symbols if obs(s,then) and obs(s,then)['template30'] and rank[s]>=90 and obs(s,i)}
        cohort=valid and sufficient(then)
        dated=[(s,j) for j in range(i-9,i-4) for s in symbols if breakout(s,j) and all(present(s,k) for k in range(j+1,j+6))]
        failed=[(s,j) for s,j in dated if min(series[s]['low'][j+1:j+6])<=series[s]['close'][j]*(1-module.BREAKOUT_FAILURE_DRAWDOWN)]
        known=all(sufficient(j) for j in range(i-9,i+1))
        result[i]={'rs90Cohort':len(members) if cohort else None,'rs90CohortAbove50':sum(obs(s,i)['above50'] for s in members) if cohort else None,
            'newHighsClose':sum(1 for s in symbols if obs(s,i) and obs(s,i)['newHighClose']) if valid else None,
            'breakoutsEarlyJudged':len(dated) if known else None,'breakoutsEarlyFailed':len(failed) if known else None,'_dated':dated}
    return result

class Clock(datetime):
    @classmethod
    def now(cls,tz=None):return cls(2026,11,15,0,0,tzinfo=timezone.utc)

def stripped(value):
    value=json.loads(module.encode(value))
    for row in value['breadth']:
        for key in module.R3_MARKET_FIELDS:row.pop(key,None)
    for key in module.R3_INDICATOR_POLICY:value['indicator_policy'].pop(key,None)
    return value

class R3MarketFieldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.days,cls.symbols,cls.records,cls.series=designed_universe()
        cls.lines={'off':[],'on':[]}
        with patch.object(module,'datetime',Clock):
            cls.off=module.build(cls.records,{},cls.symbols,cls.days,cls.days[-1],log=cls.lines['off'].append)
            with patch.object(module,'EMIT_R3_MARKET_FIELDS',True):
                cls.on=module.build(cls.records,{},cls.symbols,cls.days,cls.days[-1],log=cls.lines['on'].append)
        cls.replayed=replay(cls.series,cls.symbols,len(cls.days))
    def test_flag_is_off_and_off_writes_no_new_key_or_policy(self):
        self.assertIs(module.EMIT_R3_MARKET_FIELDS,False)
        for row in self.off['breadth']:
            self.assertFalse(set(module.R3_MARKET_FIELDS)&set(row),row['date'])
        self.assertIs(self.off['indicator_policy'],module.INDICATOR_POLICY)
        self.assertFalse(set(module.R3_INDICATOR_POLICY)&set(module.INDICATOR_POLICY))
    def test_off_output_is_the_on_output_without_the_five_keys(self):
        self.assertEqual(module.encode(self.off),module.encode(stripped(self.on)))
        self.assertEqual(set(self.on['indicator_policy']),{*module.INDICATOR_POLICY,*module.R3_INDICATOR_POLICY})
        for row in self.on['breadth']:self.assertTrue(set(module.R3_MARKET_FIELDS)<=set(row),row['date'])
    def test_each_definition_matches_an_independent_replay(self):
        rows=self.on['breadth'];n=len(self.days);self.assertEqual(len(rows),n)
        for i,expected in self.replayed.items():
            for key in module.R3_MARKET_FIELDS:
                with self.subTest(day=self.days[i],key=key):self.assertEqual(rows[i][key],expected[key])
        last=rows[-1];dated={s for s,_ in self.replayed[n-1]['_dated']}
        # S0, S1, S2 and S3 are judged (S1 fails on its 6th later session, outside the five); S4 misses a later bar.
        self.assertTrue({'S0','S1','S2','S3'}<=dated);self.assertNotIn('S4',dated)
        self.assertTrue(0<last['breakoutsEarlyFailed']<last['breakoutsEarlyJudged'])
        self.assertTrue(0<last['rs90CohortAbove50']<last['rs90Cohort']<last['leaderCohort'])
        breakout_day=rows[n-7];self.assertTrue(0<breakout_day['newHighsClose']<breakout_day['newHighs'])
    def test_invariants_hold_on_every_row(self):
        for row in self.on['breadth']:
            with self.subTest(day=row['date']):
                if row['rs90Cohort'] is not None:
                    self.assertLessEqual(row['rs90Cohort'],row['leaderCohort']);self.assertLessEqual(row['rs90CohortAbove50'],row['rs90Cohort'])
                    self.assertLessEqual(row['rs90CohortAbove50'],row['leaderCohortAbove50'])
                if row['newHighsClose'] is not None:self.assertLessEqual(row['newHighsClose'],row['newHighs'])
                if row['breakoutsEarlyJudged'] is not None:self.assertLessEqual(row['breakoutsEarlyFailed'],row['breakoutsEarlyJudged'])
                for key in module.R3_MARKET_FIELDS:self.assertTrue(row[key] is None or (type(row[key]) is int and row[key]>=0),key)
    def test_null_rules_follow_leader_cohort_and_the_early_window(self):
        n=560;gap=280
        days,symbols,records,_=designed_universe(n=n,gap_symbols=12,gap_at=gap)
        with patch.object(module,'EMIT_R3_MARKET_FIELDS',True):rows=module.build(records,{},symbols,days,days[-1])['breadth']
        valid=[row['newHighs'] is not None for row in rows]
        # Twelve missing bars on one session leave 98 of 110 observed for the next 253 sessions.
        self.assertFalse(any(valid[gap:gap+253]));self.assertTrue(valid[gap-1] and all(valid[gap+253:]))
        for i,row in enumerate(rows):
            with self.subTest(day=row['date']):
                self.assertEqual(row['rs90Cohort'] is None,row['leaderCohort'] is None)
                self.assertEqual(row['rs90CohortAbove50'] is None,row['leaderCohortAbove50'] is None)
                self.assertEqual(row['newHighsClose'] is None,not valid[i])
                early_known=i>=9 and all(valid[i-9:i+1])
                self.assertEqual(row['breakoutsEarlyJudged'] is None,not early_known);self.assertEqual(row['breakoutsEarlyFailed'] is None,not early_known)
        back=gap+253
        self.assertTrue(all(rows[i]['breakoutsEarlyJudged'] is None for i in range(back,back+9)))
        self.assertTrue(all(rows[i]['breakoutsEarlyJudged'] is not None and rows[i]['rs90Cohort'] is None for i in range(back+9,back+20)))
        self.assertTrue(all(rows[i]['rs90Cohort'] is not None for i in range(back+20,n)))
        # Too few observed stocks: every key is unknown, never 0.
        with patch.object(module,'EMIT_R3_MARKET_FIELDS',True):
            last=module.build({s:records[s] for s in symbols[:99]},{},symbols,days,days[-1])['breadth'][-1]
        for key in module.R3_MARKET_FIELDS:self.assertIsNone(last[key],key)
    def test_collect_passes_a_log_callback_to_build(self):
        with TemporaryDirectory(prefix='history-r3-log-') as directory:
            source=DailyHistoryTests().current()
            with patch.object(module,'fetch_symbol',side_effect=OSError('offline test')),patch.object(module,'build',return_value=source) as built,patch('builtins.print') as printed:
                module.collect('2026-10-23',[f'S{i}' for i in range(100)],None,Path(directory)/'cache',Path(directory)/'source.json')
                log=built.call_args.kwargs['log'];self.assertTrue(callable(log))
                log('Market history r3 fields test');printed.assert_called_with('Market history r3 fields test',flush=True)
    def test_log_line_prints_the_newest_values_whether_or_not_they_are_written(self):
        last=self.on['breadth'][-1]
        for state,lines in self.lines.items():
            self.assertEqual(lines,[f"Market history r3 fields {self.days[-1]} (emission {state}): "+' '.join(f'{key}={last[key]}' for key in module.R3_MARKET_FIELDS)])
        lines=[];module.build({s:self.records[s] for s in self.symbols[:99]},{},self.symbols,self.days,self.days[-1],log=lines.append)
        self.assertEqual(lines,[f"Market history r3 fields {self.days[-1]} (emission off): "+' '.join(f'{key}=unavailable' for key in module.R3_MARKET_FIELDS)])
        self.assertNotIn('=0 ',lines[0]+' ')

if __name__=='__main__':unittest.main()
