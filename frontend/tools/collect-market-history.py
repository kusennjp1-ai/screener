"""Resumable, provenance-bearing retrospective history for the published universe.

This does not reconstruct historical membership or historical fundamentals.
Raw responses stay in --cache; published aggregates retain every response digest.
The ordinary daily price/financial quality gates are independent and unchanged.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

SECTORS = ['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY']
GROUPS=['Basic Materials','Communication Services','Consumer Cyclical','Consumer Defensive','Energy','Financial','Healthcare','Industrials','Real Estate','Technology','Utilities','Unknown']
FIELDS = ('open','high','low','close','volume')
def digest(raw): return hashlib.sha256(raw).hexdigest()
def encode(value): return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
def years_before(day,years):
    try:return day.replace(year=day.year-years)
    except ValueError:return day.replace(year=day.year-years,day=28)

def fetch_symbol(symbol, target, start, cache):
    key = hashlib.sha256(f'{symbol}/{start}/{target}'.encode()).hexdigest()
    path = cache / f'{key}.json'
    if path.exists():
        saved = json.loads(path.read_bytes())
        if saved['symbol'] == symbol and saved['as_of_date'] == target and digest(saved['raw'].encode()) == saved['provenance']['sha256']:
            return saved
        raise ValueError('Invalid cached history identity/hash')
    first = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
    last = int(datetime.fromisoformat(target).replace(tzinfo=timezone.utc).timestamp()) + 86400
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?period1={first}&period2={last}&interval=1d'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'}), timeout=40) as response:
                raw = response.read()
            value = json.loads(raw)['chart']['result'][0]
            if value['meta']['symbol'].upper() != symbol.upper(): raise ValueError('Provider symbol mismatch')
            result = {'symbol':symbol,'as_of_date':target,'raw':raw.decode(), 'provenance':{'url':url,'sha256':digest(raw),'retrieved_at':datetime.now(timezone.utc).isoformat()}}
            path.write_bytes(encode(result))
            time.sleep(.15)
            return result
        except urllib.error.HTTPError as error:
            if error.code not in (429,500,502,503,504): raise
            if attempt == 2: raise
            time.sleep(8 * (attempt+1))
        except (TimeoutError, OSError):
            if attempt == 2: raise
            time.sleep(3 * (attempt+1))

def parse_series(record, sessions):
    """Align to the independent calendar; bad/missing rows remain NaN."""
    import pandas as pd
    import numpy as np
    value = json.loads(record['raw'])['chart']['result'][0]
    quote = value['indicators']['quote'][0]
    rows, seen = {}, set()
    for i, stamp in enumerate(value.get('timestamp', [])):
        day = datetime.fromtimestamp(stamp, ZoneInfo('America/New_York')).date().isoformat()
        if day in seen: raise ValueError('Duplicate source session')
        seen.add(day)
        if day not in sessions: continue
        bar = {key: quote[key][i] for key in FIELDS}
        if any(type(bar[key]) not in (int,float) or not math.isfinite(bar[key]) or bar[key] <= 0 for key in FIELDS[:4]): continue
        if type(bar['volume']) not in (int,float) or not math.isfinite(bar['volume']) or bar['volume'] < 0: continue
        if bar['high'] < max(bar['open'],bar['close'],bar['low']) or bar['low'] > min(bar['open'],bar['close']): continue
        rows[day] = bar
    frame = pd.DataFrame.from_dict(rows, orient='index').reindex(sessions, columns=FIELDS).astype(float)
    # An extreme discontinuity invalidates its rolling windows; do not silently
    # turn a split/ambiguous provider observation into a breakout or RS signal.
    change = frame.close / frame.close.shift(1)
    ambiguous=(change >= 1.8) | (change <= .55)
    frame.loc[ambiguous, :] = np.nan
    return frame, {**value['meta'],'excluded_extreme_dates':list(frame.index[ambiguous])}

def build(records, errors, symbols, sessions, target, classification=None):
    import numpy as np
    import pandas as pd
    count = len(sessions)
    covered = np.zeros(count, dtype=int)
    expected = np.full(count, len(symbols), dtype=int)
    above = np.zeros(count, dtype=int); highs = above.copy(); lows = above.copy()
    ups = above.copy(); downs = above.copy()
    momentum = np.full((count,len(symbols)), np.nan)
    template = np.zeros((count,len(symbols)), dtype=bool)
    memberships=(classification or {}).get('memberships',{})
    group_columns={group:[i for i,symbol in enumerate(symbols) if memberships.get(symbol,'Unknown')==group] for group in GROUPS}
    group_data={group:{'coverage':np.zeros(count,dtype=int),'eligibleUniverse':np.full(count,len(columns),dtype=int),'above50':np.zeros(count,dtype=int)} for group,columns in group_columns.items()}
    provenance, parse_errors = [], {}
    for column, symbol in enumerate(symbols):
        record = records.get(symbol)
        if record is None: continue
        try:
            f, meta = parse_series(record, sessions)
            # Only provider-confirmed inception can remove a not-yet-listed
            # member from historical eligibility. Failed fetches remain unknown.
            stamp = meta.get('firstTradeDate')
            eligible_history = np.ones(count,dtype=bool)
            if isinstance(stamp,(int,float)) and stamp > 0:
                inception = datetime.fromtimestamp(stamp,timezone.utc).date().isoformat()
                eligible = np.array([day >= inception for day in sessions])
                eligible_history=pd.Series(eligible).rolling(253,min_periods=253).sum().fillna(0).to_numpy() >= 253
                expected -= (~eligible_history).astype(int)
            c=f.close; good=c.rolling(253,min_periods=253).count().eq(253).to_numpy() & eligible_history
            sma=lambda n,lag=0:c.rolling(n,min_periods=n).mean().shift(lag)
            high=f.high.rolling(252,min_periods=252).max(); low=f.low.rolling(252,min_periods=252).min()
            ma50,ma150,ma200=sma(50),sma(150),sma(200)
            covered += good
            above += good & (c>ma50).to_numpy()
            group=group_data[memberships.get(symbol,'Unknown')]
            group['eligibleUniverse']-=(~eligible_history).astype(int)
            group['coverage']+=good
            group['above50']+=good & (c>ma50).to_numpy()
            highs += good & (f.high > f.high.shift(1).rolling(251,min_periods=251).max()).to_numpy()
            lows += good & (f.low < f.low.shift(1).rolling(251,min_periods=251).min()).to_numpy()
            change=c/c.shift(1)-1
            ups += good & (change>=.04).to_numpy(); downs += good & (change<=-.04).to_numpy()
            momentum[:,column]=sum((c/c.shift(lag)-1)*weight for lag,weight in [(63,.4),(126,.2),(189,.2),(252,.2)]).where(good).to_numpy()
            template[:,column]=(good & ((c>ma150)&(c>ma200)&(ma150>ma200)&(ma200>sma(200,21))&(ma50>ma150)&(ma50>ma200)&(c>ma50)&(c/low>=1.25)&(c/high>=.75)).to_numpy())
            provenance.append({'symbol':symbol,'first_trade_date':meta.get('firstTradeDate'),'valid_bars':int(c.count()),'excluded_extreme_dates':meta['excluded_extreme_dates'], **record['provenance']})
        except Exception as error: parse_errors[symbol]=str(error)
    ranks=pd.DataFrame(momentum).rank(axis=1,method='average',ascending=True)
    eligible_rs=np.isfinite(momentum).sum(axis=1)
    rs=1+98*(ranks.to_numpy()-1)/np.maximum(eligible_rs[:,None]-1,1)
    leaders=(template & (rs>=70)).sum(axis=1)
    for group,columns in group_columns.items():group_data[group]['leaderCount']=(template[:,columns] & (rs[:,columns]>=70)).sum(axis=1)
    sufficient=(expected>0)&(covered/np.maximum(expected,1)>=.9)&(eligible_rs>=100)
    up10=pd.Series(np.where(sufficient,ups,np.nan)).rolling(10,min_periods=10).sum().to_numpy()
    down10=pd.Series(np.where(sufficient,downs,np.nan)).rolling(10,min_periods=10).sum().to_numpy()
    # Include warmup observations so every displayed five-year ratio can be
    # independently checked against its ten consecutive constituent sessions.
    start=(years_before(date.fromisoformat(target),5)-timedelta(days=20)).isoformat()
    points=[]
    for i,day in enumerate(sessions):
        if day < start: continue
        valid=bool(sufficient[i]); val=lambda array:int(array[i]) if valid else None
        points.append({'date':day,'coverage':int(covered[i]),'universe':len(symbols),'eligibleUniverse':int(expected[i]),'coveragePercent':round(float(covered[i]/max(expected[i],1)*100),3),
            'above50':val(above),'above50Percent':float(above[i]/covered[i]*100) if valid else None,'newHighs':val(highs),'newLows':val(lows),'leaderCount':val(leaders),
            'stocks_up_4pct':val(ups),'stocks_down_4pct':val(downs),'ratio_10day':float(up10[i]/down10[i]) if len(points)>=9 and np.isfinite(up10[i]) and np.isfinite(down10[i]) and down10[i]>0 else None,
            'reason':None if valid else '独立カレンダーに沿う253日足の観測率90%またはRS母集団100銘柄を満たしません。'})
    index=[]; sector_series={}; extra_provenance=[]
    for symbol in ['^GSPC','SPY',*SECTORS]:
        if symbol not in records: continue
        f,meta=parse_series(records[symbol],sessions)
        if symbol=='^GSPC': index=[{'date':day,'close':float(c) if math.isfinite(c) else None} for day,c in f.close.items() if day>=start]
        else: sector_series[symbol]=f.close
        extra_provenance.append({'symbol':symbol,**records[symbol]['provenance']})
    frames=[]
    if set(['SPY',*SECTORS]) <= set(sector_series):
        relative=pd.DataFrame({symbol:(100*(sector_series[symbol]/sector_series['SPY'])/(sector_series[symbol].shift(126)/sector_series['SPY'].shift(126))).where((sector_series[symbol].notna()&sector_series['SPY'].notna()).rolling(127,min_periods=127).sum().eq(127)) for symbol in SECTORS})
        year_start=years_before(date.fromisoformat(target),1).isoformat()
        for day,row in relative.iterrows():
            if day < year_start: continue
            complete=all(math.isfinite(v) and v>0 for v in row)
            ordered=sorted(row.items(),key=lambda item:(-item[1],item[0])) if complete else []
            ranks={value:1+sum(other>value for other in row) for _,value in ordered}
            frames.append({'date':day,'ranks':[{'symbol':symbol,'rank':ranks[value],'relativeIndex':float(value)} for symbol,value in ordered]})
    sector_breadth=[]
    group_start=years_before(date.fromisoformat(target),2).isoformat()
    for group,arrays in group_data.items():
        series=[]
        for i,day in enumerate(sessions):
            if day<group_start:continue
            eligible=int(arrays['eligibleUniverse'][i]);observed=int(arrays['coverage'][i]);valid=eligible>0 and observed/eligible>=.9 and bool(sufficient[i])
            above50=int(arrays['above50'][i]) if valid else None
            series.append({'date':day,'coverage':observed,'eligibleUniverse':eligible,'above50':above50,'above50Percent':above50/observed*100 if valid else None,'leaderCount':int(arrays['leaderCount'][i]) if valid else None})
        sector_breadth.append({'sector':group,'universe':len(group_columns[group]),'points':series})
    return {'schema_version':'market-long-history-v1','market':'US','as_of_date':target,'retrieved_at':datetime.now(timezone.utc).isoformat(),
        'price_policy':{'basis':'split-adjusted-close-no-dividend','ambiguous_daily_ratio_at_least':1.8,'ambiguous_daily_ratio_at_most':.55,'rolling_sessions':253,'minimum_coverage':.9,'unknown_inception':'retained in expected denominator','extreme_move_limitation':'A real extreme move can also be excluded; no split/corporate-action certification is claimed.'},
        'universe':{'basis':'current-published-universe-retrospective','symbols':symbols,'sha256':digest(encode(symbols)),'historical_membership_verified':False,'historical_fundamentals_verified':False},
        'calendar':{'provider':'pandas_market_calendars:NYSE','sessions':sessions},'breadth':points,'sp500':index,'sectorRotation':{'lookback_sessions':126,'classification':'11 Select Sector SPDR ETF proxies; not official IBD industry groups or ratings','frames':frames},
        'classification':classification,'sectorBreadth':sector_breadth if classification else [],'provenance':provenance+extra_provenance,'errors':{**errors,**parse_errors}}

def main():
    import pandas_market_calendars as mcal
    parser=argparse.ArgumentParser();parser.add_argument('--as-of',required=True);parser.add_argument('--universe-dir',required=True);parser.add_argument('--cache',required=True);parser.add_argument('--output',required=True);parser.add_argument('--workers',type=int,default=3);args=parser.parse_args()
    target=date.fromisoformat(args.as_of);start=target-timedelta(days=365*6+45)
    schedule=mcal.get_calendar('NYSE').schedule(start_date=start,end_date=target)
    if schedule.empty or schedule.index[-1].date()!=target or schedule.iloc[-1].market_close.to_pydatetime()>datetime.now(timezone.utc): raise ValueError('Target must be a completed NYSE session')
    sessions=[str(day.date()) for day in schedule.index]
    documents=[json.loads(p.read_bytes()) for p in Path(args.universe_dir).glob('*.json')]
    charts=[document.get('payload') for document in documents if isinstance(document,dict)]
    symbols=sorted({chart['symbol'] for chart in charts if isinstance(chart,dict) and chart.get('as_of_date')==args.as_of and isinstance(chart.get('bars'),list)})
    if len(symbols)<100: raise ValueError('Published chart universe is missing or mismatched')
    del documents,charts
    cache=Path(args.cache);cache.mkdir(parents=True,exist_ok=True);records={};errors={};total=len(symbols)+13
    print(json.dumps({'start':start.isoformat(),'end':args.as_of,'symbols':len(symbols),'sessions':len(sessions)}),flush=True)
    def one(symbol):
        try: return symbol,fetch_symbol(symbol,args.as_of,start.isoformat(),cache),None
        except Exception as error: return symbol,None,str(error)
    with ThreadPoolExecutor(max_workers=max(1,min(3,args.workers))) as pool:
        for i,(symbol,record,error) in enumerate(pool.map(one,['^GSPC','SPY',*SECTORS,*symbols]),1):
            if record: records[symbol]=record
            else: errors[symbol]=error
            if i%100==0 or i==total: print(json.dumps({'done':i,'total':total,'errors':len(errors)}),flush=True)
    classification_bytes=(Path(args.universe_dir)/'rows.json').read_bytes()
    classification_rows=json.loads(classification_bytes)
    memberships={row['symbol']:('Financial' if row.get('gics_sector')=='Financial Services' else row.get('gics_sector')) for row in classification_rows if row.get('symbol') in symbols}
    memberships={symbol:memberships.get(symbol) if memberships.get(symbol) in GROUPS else 'Unknown' for symbol in symbols}
    classification={'as_of_date':args.as_of,'basis':'current-published-gics-sector-retrospective','source_sha256':digest(classification_bytes),'memberships_sha256':digest(encode(memberships)),'memberships':memberships}
    result=build(records,errors,symbols,sessions,args.as_of,classification)
    result['calendar']['version']=mcal.__version__
    path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(encode(result)+b'\n')
    valid=[r for r in result['breadth'] if r['newHighs'] is not None]
    print(json.dumps({'output':str(path),'symbols':len(symbols),'failures':len(result['errors']),'valid_breadth_sessions':len(valid),'first_valid':valid[0]['date'] if valid else None,'last_valid':valid[-1]['date'] if valid else None,'sector_frames':len(result['sectorRotation']['frames'])}),flush=True)

if __name__=='__main__':main()
