// Synthetic unit observations only. Never imported by the capture producer or
// used as publication evidence. Weekday dates are a compact test calendar.
import {createHash} from 'node:crypto';
import {SECTORS} from '../src/static/sectorDefinitions.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const num=(value,digits=1)=>value.toLocaleString('ja-JP',{maximumFractionDigits:digits});
export function marketEvidenceFixture(asOf='2026-10-21') {
 const end=new Date(asOf+'T00:00:00Z'),start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-5);
 const dates=[];for(const date=new Date(start);date<=end;date.setUTCDate(date.getUTCDate()+1))if(![0,6].includes(date.getUTCDay()))dates.push(date.toISOString().slice(0,10));
 const cutoff=years=>{const date=new Date(end);date.setUTCFullYear(date.getUTCFullYear()-years);return date.toISOString().slice(0,10);};
 const breadth=dates.map((date,i)=>({date,coverage:100,eligibleUniverse:100,universe:100,coveragePercent:100,above50:50,above50Percent:50,newHighs:2,newLows:3,leaderCount:4,stocks_up_4pct:6,stocks_down_4pct:3,ratio_10day:i<9?null:2}));
 const symbols=Array.from({length:100},(_,i)=>`S${i}`),etfs=SECTORS.map(([,label,symbol])=>symbol),retrieved=new Date(end.getTime()+864e5).toISOString();
 const ranks=etfs.map((symbol,i)=>({symbol,rank:i+1,relativeIndex:120-i}));
 const frames=dates.filter(date=>date>=cutoff(1)).map(date=>({date,ranks})),two=breadth.filter(row=>row.date>=cutoff(2));
 const history={schema_version:'market-long-history-v1',market:'US',as_of_date:asOf,retrieved_at:retrieved,
  universe:{basis:'current-published-universe-retrospective',historical_membership_verified:false,historical_fundamentals_verified:false,symbols,sha256:sha(JSON.stringify(symbols))},
  calendar:{provider:'pandas_market_calendars:NYSE',sessions:dates},breadth,sp500:dates.map(date=>({date,close:5000})),
  provenance:[...symbols,'^GSPC','SPY',...etfs].map(symbol=>({symbol,url:`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,sha256:'a'.repeat(64),retrieved_at:retrieved})),
  classification:{basis:'current-published-gics-sector-retrospective',as_of_date:asOf,source_sha256:'b'.repeat(64),memberships_sha256:'c'.repeat(64),memberships:Object.fromEntries(symbols.map(symbol=>[symbol,'Technology']))},
  sectorBreadth:[{sector:'Technology',universe:100,points:two.map(({date,coverage,eligibleUniverse,above50,above50Percent,leaderCount})=>({date,coverage,eligibleUniverse,above50,above50Percent,leaderCount}))}],sectorRotation:{lookback_sessions:126,frames}};
 const raw=JSON.stringify(history)+'\n',source={market_series_sha256:'d'.repeat(64),history_source_sha256:sha(raw),raw_text:raw};
 const readout=(date,name,value,unit)=>({date,readout:`${date}${name} ${num(value)}${unit}`});
 const highlow=date=>({date,readout:`${date}新高値 2銘柄新安値 3銘柄S&P 500（右軸） 5,000pt`});
 const names=Object.fromEntries(SECTORS.map(([,label,symbol])=>[symbol,label]));
 const cases=[1440,390].flatMap(width=>['dark','light'].map(theme=>({viewport:{width,height:width===1440?900:844},theme,observed_theme:theme,as_of_date:asOf,
  highlow:{months:60,count:breadth.length,first:highlow(dates[0]),last:highlow(dates.at(-1)),secondary_axis:true},
  breadth:{months:24,count:two.length,firstDate:two[0].date,lastDate:two.at(-1).date,leader_first:readout(two[0].date,'先導株数（価格条件）',4,'銘柄'),technology_first:readout(two[0].date,'50日線上',50,'%'),ratio_first:readout(two[0].date,'4%騰落・10日レシオ',2,'倍')},
  rotation:{count:frames.length,firstDate:frames[0].date,lastDate:frames.at(-1).date,firstRanks:ranks.map(row=>({...row,text:`${row.rank}位 ${names[row.symbol]} ${row.symbol} 相対価格指数 ${num(row.relativeIndex,2)}`})),initial_stopped:true,played_date:frames[1].date,paused_date:frames[2].date,paused_end_date:frames[2].date,pause_observed_ms:1000,scrub_stopped:true,scrub_date:frames[0].date,reduced_transitions:Array(11).fill('0s')},
  old_sector_bars:{count:12,positions:Array.from({length:12},(_,i)=>({position:'static',top:i*50,height:50}))},old_sector_table:true,horizontal_overflow:false})));
 return {data:{as_of_date:asOf},market_history_source:source,market_history_cases:cases};
}
