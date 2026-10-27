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
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

SECTORS = ['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY']
GROUPS=['Basic Materials','Communication Services','Consumer Cyclical','Consumer Defensive','Energy','Financial','Healthcare','Industrials','Real Estate','Technology','Utilities','Unknown']
FIELDS = ('open','high','low','close','volume')
def digest(raw): return hashlib.sha256(raw).hexdigest()
def encode(value): return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
def years_before(day,years):
    try:return day.replace(year=day.year-years)
    except ValueError:return day.replace(year=day.year-years,day=28)

def latest_response_day(record):
    value = json.loads(record['raw'])['chart']['result'][0]
    if value['meta']['symbol'].upper() != record['symbol'].upper():
        raise ValueError('Cached provider symbol mismatch')
    stamps = value.get('timestamp') or []
    if not stamps:return None
    quote=value['indicators']['quote'][0]
    bar={field:quote[field][-1] for field in FIELDS}
    if any(type(bar[field]) not in (int,float) or not math.isfinite(bar[field]) or (bar[field] < 0 if field=='volume' else bar[field] <= 0) for field in FIELDS):return None
    if bar['high']<max(bar['open'],bar['low'],bar['close']) or bar['low']>min(bar['open'],bar['high'],bar['close']):return None
    return datetime.fromtimestamp(stamps[-1], ZoneInfo('America/New_York')).date().isoformat()


def fetch_symbol(symbol, target, start, cache, cache_max_age_minutes=60):
    key = hashlib.sha256(f'{symbol}/{start}/{target}'.encode()).hexdigest()
    path = cache / f'{key}.json'
    if path.exists():
        saved = json.loads(path.read_bytes())
        if saved['symbol'] != symbol or saved['as_of_date'] != target or digest(saved['raw'].encode()) != saved['provenance']['sha256']:
            raise ValueError('Invalid cached history identity/hash')
        age = (datetime.now(timezone.utc)-datetime.fromisoformat(saved['provenance']['retrieved_at'])).total_seconds()
        # A response received before the provider exposed the final session must
        # never poison all later retries for this target. Recheck recent closes
        # periodically too, so same-day exchange/provider corrections can arrive.
        if 0 <= age <= cache_max_age_minutes*60 and latest_response_day(saved) == target:
            return saved
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
            atomic_write(path, encode(result))
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

def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('xb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def published_universe(root):
    """Read the just-compiled daily audit and its exact chart/classification data.

    The compiler independently checks source bars and the NYSE calendar before
    setting a valid audit. The six-year collector then refetches and calculates
    history from original provider responses; it never extrapolates this audit.
    """
    root = Path(root).resolve()
    def read(relative):
        original = root/relative
        path = original.resolve()
        if not path.is_relative_to(root) or original.is_symlink() or any(parent.is_symlink() for parent in original.parents if parent != root):
            raise ValueError('Unsafe published history input')
        return json.loads(path.read_bytes())
    manifest = read('manifest.json')
    entry = manifest.get('markets', {}).get('US', manifest)
    target = entry['as_of_date']
    audit_bytes = (root.parent/'qualification-audit.json').read_bytes()
    audit = json.loads(audit_bytes)
    if audit.get('as_of_date') != target or audit.get('version') != 'ohlcv-v2-session-calendar':
        raise ValueError('Current independently verified chart audit is required')
    for item in audit['results']:
        evidence=item.get('audit',{})
        if evidence.get('symbol')!=item.get('symbol') or evidence.get('as_of_date')!=target or evidence.get('version')!=audit['version']:
            raise ValueError('Published audit result identity/date mismatch')
        if evidence.get('valid') is True and (evidence.get('status')!='verified' or evidence.get('errors')!=[]):
            raise ValueError('Published audit certification is inconsistent')
    symbols = sorted(item['symbol'] for item in audit['results'] if item.get('audit', {}).get('valid') is True)
    if len(symbols) < 100 or len(set(symbols)) != len(symbols):
        raise ValueError('Published verified chart universe is missing or duplicated')
    index = read(entry['assets']['charts']['path'])
    chart_paths = {item['symbol']: item['path'] for item in index['symbols']}
    scan = read(entry['pages']['scan']['path'])
    sources = [entry['pages']['scan']['path'], *[chunk['path'] for chunk in scan.get('chunks', [])]]
    row_sectors = {}
    for relative in sources:
        document = read(relative)
        if document.get('as_of_date') != target:
            raise ValueError('Published classification snapshot date mismatch')
        for row in document.get('rows', document.get('initial_rows', [])):
            sector = row.get('gics_sector')
            if row['symbol'] in row_sectors and row_sectors[row['symbol']] != sector:
                raise ValueError('Conflicting published sector classification')
            row_sectors[row['symbol']] = sector
    memberships = {}
    for symbol in symbols:
        chart = read(chart_paths[symbol])
        if chart.get('symbol') != symbol or chart.get('as_of_date') != target or not chart.get('bars') or chart['bars'][-1]['date'] != target:
            raise ValueError('Published chart does not match its daily audit')
        sector = row_sectors.get(symbol)
        sector = 'Financial' if sector == 'Financial Services' else sector
        memberships[symbol] = sector if sector in GROUPS else 'Unknown'
    source_inputs = [{'path': relative, 'sha256': digest((root/relative).read_bytes())} for relative in sources]
    classification = {'as_of_date': target, 'basis': 'current-published-gics-sector-retrospective',
                      'source_sha256': digest(encode(source_inputs)), 'source_inputs': source_inputs,
                      'verified_universe_sha256': digest(audit_bytes), 'memberships_sha256': digest(encode(memberships)), 'memberships': memberships}
    return target, symbols, classification


def require_current(result):
    """No date-only success: every main timeline needs a real final observation."""
    target = result['as_of_date']
    breadth = result['breadth'][-1] if result['breadth'] else {}
    if breadth.get('date') != target or any(breadth.get(key) is None for key in ('above50', 'newHighs', 'newLows', 'leaderCount')):
        raise ValueError('Latest completed session fails long-history 90% coverage / 100-stock RS gate')
    index = result['sp500'][-1] if result['sp500'] else {}
    if index.get('date') != target or not isinstance(index.get('close'), (int, float)) or not math.isfinite(index['close']) or index['close'] <= 0:
        raise ValueError('Latest completed S&P 500 close is not available')
    frames = result['sectorRotation']['frames']
    if not frames or frames[-1]['date'] != target or len(frames[-1]['ranks']) != len(SECTORS):
        raise ValueError('Latest completed session lacks all 11 sector ETF ranks')
    if result.get('sectorBreadth') and any(not group['points'] or group['points'][-1]['date'] != target for group in result['sectorBreadth']):
        raise ValueError('Sector breadth has not reached the completed session')


def collect(target, symbols, classification, cache, output, workers=3, allow_unavailable=False, report=None, cache_max_age_minutes=60):
    import pandas_market_calendars as mcal
    started=time.monotonic();target_day=date.fromisoformat(target);start=target_day-timedelta(days=365*6+45)
    schedule=mcal.get_calendar('NYSE').schedule(start_date=start,end_date=target_day)
    if schedule.empty or schedule.index[-1].date()!=target_day or schedule.iloc[-1].market_close.to_pydatetime()>datetime.now(timezone.utc): raise ValueError('Target must be a completed NYSE session')
    sessions=[str(day.date()) for day in schedule.index]
    if len(symbols)<100 or len(set(symbols))!=len(symbols):raise ValueError('Published chart universe is missing or duplicated')
    destination=Path(output)
    if destination.exists():
        previous=json.loads(destination.read_bytes())
        if previous.get('schema_version')!='market-long-history-v1' or previous.get('market')!='US' or previous.get('as_of_date','')>target:raise ValueError('Existing history identity/date is invalid; refusing rollback')
    cache=Path(cache);cache.mkdir(parents=True,exist_ok=True);records={};errors={};total=len(set([*symbols,'^GSPC','SPY',*SECTORS]))
    print(json.dumps({'start':start.isoformat(),'end':target,'symbols':len(symbols),'sessions':len(sessions)}),flush=True)
    def one(symbol):
        try: return symbol,fetch_symbol(symbol,target,start.isoformat(),cache,cache_max_age_minutes),None
        except Exception as error: return symbol,None,str(error)
    with ThreadPoolExecutor(max_workers=max(1,min(3,workers))) as pool:
        for i,(symbol,record,error) in enumerate(pool.map(one,list(dict.fromkeys(['^GSPC','SPY',*SECTORS,*symbols]))),1):
            if record: records[symbol]=record
            else: errors[symbol]=error
            if i%100==0 or i==total: print(json.dumps({'done':i,'total':total,'errors':len(errors)}),flush=True)
    result=build(records,errors,symbols,sessions,target,classification)
    result['calendar']['version']=mcal.__version__
    valid=[r for r in result['breadth'] if r['newHighs'] is not None]
    summary={'target':target,'output':str(destination),'symbols':len(symbols),'failures':len(result['errors']),'valid_breadth_sessions':len(valid),'first_valid':valid[0]['date'] if valid else None,'last_valid':valid[-1]['date'] if valid else None,'sector_frames':len(result['sectorRotation']['frames']),'elapsed_seconds':round(time.monotonic()-started,3)}
    try:require_current(result)
    except ValueError as error:
        summary.update({'updated':False,'reason':str(error),'retained_as_of_date':json.loads(destination.read_bytes())['as_of_date'] if destination.exists() else None})
        if report:atomic_write(report,encode(summary)+b'\n')
        print(json.dumps(summary),flush=True)
        if not allow_unavailable:raise
        return summary
    atomic_write(destination,encode(result)+b'\n')
    summary.update({'updated':True,'sha256':digest(destination.read_bytes())})
    if report:atomic_write(report,encode(summary)+b'\n')
    print(json.dumps(summary),flush=True)
    return summary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--as-of');parser.add_argument('--universe-dir');parser.add_argument('--root')
    parser.add_argument('--cache',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--workers',type=int,default=3);parser.add_argument('--allow-unavailable',action='store_true')
    parser.add_argument('--report');parser.add_argument('--cache-max-age-minutes',type=int,default=60)
    args=parser.parse_args()
    if args.root:
        if args.universe_dir:parser.error('Choose --root or --universe-dir')
        target,symbols,classification=published_universe(args.root)
        if args.as_of and args.as_of!=target:raise ValueError('Requested history date differs from the compiled daily universe')
    else:
        if not args.as_of or not args.universe_dir:parser.error('--root or both --as-of and --universe-dir are required')
        target=args.as_of
        documents=[json.loads(p.read_bytes()) for p in Path(args.universe_dir).glob('*.json')]
        charts=[document.get('payload') for document in documents if isinstance(document,dict)]
        symbols=sorted({chart['symbol'] for chart in charts if isinstance(chart,dict) and chart.get('as_of_date')==target and isinstance(chart.get('bars'),list)})
        classification_bytes=(Path(args.universe_dir)/'rows.json').read_bytes()
        classification_rows=json.loads(classification_bytes)
        memberships={row['symbol']:('Financial' if row.get('gics_sector')=='Financial Services' else row.get('gics_sector')) for row in classification_rows if row.get('symbol') in symbols}
        memberships={symbol:memberships.get(symbol) if memberships.get(symbol) in GROUPS else 'Unknown' for symbol in symbols}
        classification={'as_of_date':target,'basis':'current-published-gics-sector-retrospective','source_sha256':digest(classification_bytes),'memberships_sha256':digest(encode(memberships)),'memberships':memberships}
    collect(target,symbols,classification,args.cache,args.output,args.workers,args.allow_unavailable,args.report,args.cache_max_age_minutes)

if __name__=='__main__':main()
