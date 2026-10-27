"""Independent scalar replay against retained provider responses (no collector import)."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--cache',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    source_bytes=Path(args.source).read_bytes();source=json.loads(source_bytes)
    calendar=source['calendar']['sessions'];positions={day:i for i,day in enumerate(calendar)}
    import pandas_market_calendars as mcal
    independent=[str(stamp.date()) for stamp in mcal.get_calendar('NYSE').schedule(start_date=calendar[0],end_date=source['as_of_date']).index]
    assert independent==calendar and mcal.__version__==source['calendar']['version']
    universe=set(source['universe']['symbols']);provenance={row['symbol']:row for row in source['provenance']}
    points={row['date']:row for row in source['breadth']}
    sample=sorted({source['breadth'][15]['date'],source['breadth'][len(source['breadth'])//2]['date'],source['breadth'][-1]['date']})
    if source.get('sectorBreadth'):
        series=source['sectorBreadth'][0]['points']
        sample=sorted({*sample,series[0]['date'],series[len(series)//2]['date']})
    wanted=sorted({calendar[j] for day in sample for j in range(positions[day]-9,positions[day]+1)})
    observations={day:[] for day in wanted};expected={day:len(universe) for day in wanted};sector_prices={};checked=0
    cache_by_hash={}
    for path in Path(args.cache).glob('*.json'):
        record=json.loads(path.read_bytes());cache_by_hash[record['provenance']['sha256']]=path
    for symbol,proof in provenance.items():
        record=json.loads(cache_by_hash[proof['sha256']].read_bytes());raw=record['raw'].encode()
        assert hashlib.sha256(raw).hexdigest()==proof['sha256'] and record['symbol']==symbol
        result=json.loads(raw)['chart']['result'][0];quote=result['indicators']['quote'][0]
        rows={};seen=set()
        for i,stamp in enumerate(result['timestamp']):
            day=datetime.fromtimestamp(stamp,ZoneInfo('America/New_York')).date().isoformat()
            assert day not in seen;seen.add(day)
            if day not in positions:continue
            values=[quote[key][i] for key in ('open','high','low','close','volume')]
            if not all(type(v) in (int,float) and math.isfinite(v) and (v>0 if k<4 else v>=0) for k,v in enumerate(values)):continue
            o,h,l,c,v=values
            if h<max(o,l,c) or l>min(o,h,c):continue
            rows[day]={'open':o,'high':h,'low':l,'close':c,'volume':v}
        invalid=set()
        for day,row in rows.items():
            previous=rows.get(calendar[positions[day]-1]) if positions[day]>0 else None
            if previous and (row['close']/previous['close']>=1.8 or row['close']/previous['close']<=.55):invalid.add(day)
        rows={day:row for day,row in rows.items() if day not in invalid}
        if symbol not in universe:sector_prices[symbol]=rows;continue
        stamp=result['meta'].get('firstTradeDate')
        inception=datetime.fromtimestamp(stamp,timezone.utc).date().isoformat() if isinstance(stamp,(int,float)) and stamp>0 else None
        for day in wanted:
            at=positions[day];window=calendar[at-252:at+1]
            if inception and window[0]<inception:expected[day]-=1;continue
            if any(date not in rows for date in window):continue
            bars=[rows[date] for date in window];closes=[row['close'] for row in bars];c=closes[-1]
            avg=lambda n,lag=0:sum(closes[len(closes)-n-lag:len(closes)-lag])/n
            ma50,ma150,ma200=avg(50),avg(150),avg(200)
            year=bars[-252:]
            momentum=sum((c/closes[-1-lag]-1)*weight for lag,weight in [(63,.4),(126,.2),(189,.2),(252,.2)])
            observations[day].append({'symbol':symbol,'momentum':momentum,'above50':c>ma50,'newHighs':bars[-1]['high']>max(row['high'] for row in bars[-252:-1]),'newLows':bars[-1]['low']<min(row['low'] for row in bars[-252:-1]),
              'stocks_up_4pct':c/closes[-2]-1>=.04,'stocks_down_4pct':c/closes[-2]-1<=-.04,
              'template':c>ma150 and c>ma200 and ma150>ma200 and ma200>avg(200,21) and ma50>ma150 and ma50>ma200 and c>ma50 and c/min(row['low'] for row in year)>=1.25 and c/max(row['high'] for row in year)>=.75})
        checked+=1
    result={}
    for day in wanted:
        rows=observations[day];valid=expected[day]>0 and len(rows)/expected[day]>=.9 and len(rows)>=100
        aggregate={'coverage':len(rows),'eligibleUniverse':expected[day]}
        for key in ('above50','newHighs','newLows','stocks_up_4pct','stocks_down_4pct'):aggregate[key]=sum(row[key] for row in rows) if valid else None
        values=sorted(row['momentum'] for row in rows);ranks={}
        for i,value in enumerate(values):ranks.setdefault(value,[]).append(i)
        aggregate['leaderCount']=sum(row['template'] and 1+98*(sum(ranks[row['momentum']])/len(ranks[row['momentum']]))/(len(rows)-1)>=70 for row in rows) if valid else None
        result[day]=aggregate
        if day in points:
            for key,value in aggregate.items():assert points[day][key]==value,(day,key,points[day][key],value)
    for day in sample:
        window=[result[calendar[j]] for j in range(positions[day]-9,positions[day]+1)]
        available=all(row['stocks_up_4pct'] is not None and row['stocks_down_4pct'] is not None for row in window)
        down=sum(row['stocks_down_4pct'] for row in window) if available else 0
        ratio=sum(row['stocks_up_4pct'] for row in window)/down if down>0 else None
        assert points[day]['ratio_10day']==ratio,(day,'ratio',points[day]['ratio_10day'],ratio)
    sector_checks=0
    for frame in source['sectorRotation']['frames']:
        at=positions[frame['date']];dates=calendar[at-126:at+1];values={}
        for symbol in ['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY']:
            if any(day not in sector_prices.get(symbol,{}) or day not in sector_prices.get('SPY',{}) for day in dates):continue
            values[symbol]=100*(sector_prices[symbol][dates[-1]]['close']/sector_prices['SPY'][dates[-1]]['close'])/(sector_prices[symbol][dates[0]]['close']/sector_prices['SPY'][dates[0]]['close'])
        assert len(frame['ranks'])==(11 if len(values)==11 else 0)
        for row in frame['ranks']:
            assert abs(row['relativeIndex']-values[row['symbol']])<1e-9
            assert row['rank']==1+sum(value>values[row['symbol']] for value in values.values())
            sector_checks+=1
    group_checks=0
    for group in source.get('sectorBreadth',[]):
        available={row['date']:row for row in group['points']}
        for day in sample:
            if day not in available:continue
            observed=[row for row in observations[day] if source['classification']['memberships'][row['symbol']]==group['sector']]
            point=available[day];assert point['coverage']==len(observed)
            if point['above50'] is not None:assert point['above50']==sum(row['above50'] for row in observed)
            if point['leaderCount'] is not None:
                all_values=sorted(row['momentum'] for row in observations[day]);rankmap={}
                for i,value in enumerate(all_values):rankmap.setdefault(value,[]).append(i)
                assert point['leaderCount']==sum(row['template'] and 1+98*(sum(rankmap[row['momentum']])/len(rankmap[row['momentum']]))/(len(all_values)-1)>=70 for row in observed)
            group_checks+=1
    report={'source_sha256':hashlib.sha256(source_bytes).hexdigest(),'independent_scalar_replay':True,'independent_calendar':mcal.__version__,'checked_stock_response_hashes':checked,'sample_dates':sample,'verified_stock_aggregate_dates':len(wanted),'verified_sector_values_and_ranks':sector_checks,'verified_sector_breadth_samples':group_checks,'results':{day:result[day] for day in sample}}
    Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True)

if __name__=='__main__':main()
