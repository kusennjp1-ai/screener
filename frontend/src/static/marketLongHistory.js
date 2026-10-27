const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const number=value=>typeof value==='number'&&Number.isFinite(value);
const assert=(value,message)=>{if(!value)throw Error(`長期市場履歴: ${message}`);};
export const SECTOR_ETFS=['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY'];
export function historyWindow(points,months,asOfDate){
 if(!day(asOfDate)||!Number.isSafeInteger(months)||months<1||months>60)return [];
 const end=new Date(`${asOfDate}T00:00:00Z`),cutoff=new Date(end);
 cutoff.setUTCDate(1);cutoff.setUTCMonth(cutoff.getUTCMonth()-months);
 cutoff.setUTCDate(Math.min(end.getUTCDate(),new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate()));
 const from=cutoff.toISOString().slice(0,10);
 return (points||[]).filter(point=>day(point.date)&&point.date>=from&&point.date<=asOfDate);
}
export function validateLongHistory(source,asOfDate){
 assert(source?.schema_version==='market-long-history-v1'&&source.market==='US'&&day(source.as_of_date)&&source.as_of_date<=asOfDate,'source identity/date');
 assert(Number.isFinite(Date.parse(source.retrieved_at))&&source.retrieved_at.slice(0,10)>=source.as_of_date&&Date.parse(source.retrieved_at)<=Date.now(),'source retrieval date');
 assert(source.universe?.basis==='current-published-universe-retrospective'&&source.universe.historical_membership_verified===false&&source.universe.historical_fundamentals_verified===false,'historical population');
 const symbols=source.universe.symbols;
 assert(Array.isArray(symbols)&&symbols.length>=100&&new Set(symbols).size===symbols.length&&symbols.every(s=>typeof s==='string'&&s.length>0),'universe');
 assert(/^[a-f0-9]{64}$/.test(source.universe.sha256||''),'universe digest');
 assert(Array.isArray(source.calendar?.sessions)&&source.calendar.provider==='pandas_market_calendars:NYSE','independent calendar');
 const sessions=new Set(source.calendar.sessions);
 const sessionPositions=new Map(source.calendar.sessions.map((date,i)=>[date,i]));
 assert(sessions.size===source.calendar.sessions.length&&source.calendar.sessions.every((date,i)=>day(date)&&date<=source.as_of_date&&(!i||date>source.calendar.sessions[i-1])),'calendar ordering');
 const dates=points=>assert(Array.isArray(points)&&points.every((p,i)=>day(p?.date)&&sessions.has(p.date)&&p.date<=source.as_of_date&&(!i||p.date>points[i-1].date)),'ordered sessions');
 dates(source.breadth);dates(source.sp500);dates(source.sectorRotation?.frames);
 assert(Array.isArray(source.provenance)&&source.provenance.length>0,'provenance');
 const evidence=new Set();
 for(const p of source.provenance){
  let url;try{url=new URL(p.url);}catch{throw Error('長期市場履歴: invalid provenance URL');}
  assert(url.protocol==='https:'&&url.hostname==='query1.finance.yahoo.com'&&decodeURIComponent(url.pathname)===`/v8/finance/chart/${p.symbol}`&&/^[a-f0-9]{64}$/.test(p.sha256||'')&&Number.isFinite(Date.parse(p.retrieved_at))&&p.retrieved_at.slice(0,10)>=source.as_of_date&&Date.parse(p.retrieved_at)<=Date.parse(source.retrieved_at),'response provenance');
  assert(!evidence.has(p.symbol),'duplicate provenance');evidence.add(p.symbol);
 }
 assert(source.sp500.length===0||evidence.has('^GSPC'),'index provenance');
 assert(symbols.every(symbol=>evidence.has(symbol)||(typeof source.errors?.[symbol]==='string'&&source.errors[symbol].length>0)),'stock response provenance or explicit acquisition error');
 const provenStocks=symbols.filter(symbol=>evidence.has(symbol)).length;
 for(const row of source.sp500)assert(row.close===null||(number(row.close)&&row.close>0),'index close');
 for(const [i,row] of source.breadth.entries()){
  assert(!i||sessionPositions.get(row.date)===sessionPositions.get(source.breadth[i-1].date)+1,'breadth missing calendar session');
  assert(count(row.coverage)&&row.universe===symbols.length&&count(row.eligibleUniverse)&&row.eligibleUniverse<=row.universe&&row.coverage<=row.eligibleUniverse&&row.coverage<=provenStocks,'coverage');
  const sufficient=row.eligibleUniverse>0&&row.coverage/row.eligibleUniverse>=.9&&row.coverage>=100;
  for(const key of ['above50','newHighs','newLows','leaderCount','stocks_up_4pct','stocks_down_4pct'])assert(row[key]===null||(sufficient&&count(row[key])&&row[key]<=row.coverage),'count/coverage gate');
  assert(row.above50Percent===null||(row.above50!==null&&number(row.above50Percent)&&Math.abs(row.above50Percent-100*row.above50/row.coverage)<1e-7),'breadth denominator');
  assert(row.ratio_10day===null||(number(row.ratio_10day)&&row.ratio_10day>=0),'ratio');
  assert(number(row.coveragePercent)&&Math.abs(row.coveragePercent-100*row.coverage/Math.max(row.eligibleUniverse,1))<.001,'coverage percent');
  assert(i>=9||row.ratio_10day===null,'ratio warmup');
  if(i>=9&&row.ratio_10day!==null){
   const window=source.breadth.slice(i-9,i+1),up=window.reduce((sum,p)=>sum+p.stocks_up_4pct,0),down=window.reduce((sum,p)=>sum+p.stocks_down_4pct,0);
   assert(window.every(p=>count(p.stocks_up_4pct)&&count(p.stocks_down_4pct))&&down>0&&Math.abs(row.ratio_10day-up/down)<1e-10,'10-session ratio numerator/denominator');
  }
 }
 if(source.sectorBreadth?.length){
  assert(source.classification?.basis==='current-published-gics-sector-retrospective'&&source.classification.as_of_date===source.as_of_date&&/^[a-f0-9]{64}$/.test(source.classification.source_sha256||'')&&/^[a-f0-9]{64}$/.test(source.classification.memberships_sha256||''),'classification provenance');
  assert(Object.keys(source.classification.memberships||{}).length===symbols.length&&symbols.every(symbol=>typeof source.classification.memberships[symbol]==='string'),'classification membership');
  assert(new Set(source.sectorBreadth.map(group=>group.sector)).size===source.sectorBreadth.length,'duplicate sector breadth');
  assert(Object.values(source.classification.memberships).every(sector=>source.sectorBreadth.some(group=>group.sector===sector)),'unrepresented sector membership');
  const globalByDate=new Map(source.breadth.map(row=>[row.date,row]));
  const groupDates=source.sectorBreadth[0].points.map(row=>row.date);
  for(const group of source.sectorBreadth){
   dates(group.points);
   assert(group.points.length===groupDates.length&&group.points.every((row,i)=>row.date===groupDates[i]&&(!i||sessionPositions.get(row.date)===sessionPositions.get(group.points[i-1].date)+1)),'sector calendar alignment');
   assert(group.universe===symbols.filter(symbol=>source.classification.memberships[symbol]===group.sector).length,'sector membership size');
   for(const row of group.points){
    const global=globalByDate.get(row.date);assert(global,'missing global sector session');
    assert(count(row.coverage)&&count(row.eligibleUniverse)&&row.coverage<=row.eligibleUniverse&&row.eligibleUniverse<=group.universe,'sector coverage');
    for(const key of ['above50','leaderCount'])assert(row[key]===null||(count(row[key])&&row[key]<=row.coverage&&row.eligibleUniverse>0&&row.coverage/row.eligibleUniverse>=.9),'sector count/coverage');
    assert(row.above50===null||global.above50!==null,'sector global coverage gate');
    assert(row.leaderCount===null||global.leaderCount!==null,'sector global RS gate');
    assert(row.above50Percent===null||(row.above50!==null&&number(row.above50Percent)&&Math.abs(row.above50Percent-100*row.above50/row.coverage)<1e-7),'sector denominator');
   }
  }
  for(let i=0;i<groupDates.length;i++){
   const rows=source.sectorBreadth.map(group=>group.points[i]),global=globalByDate.get(groupDates[i]);
   for(const key of ['coverage','eligibleUniverse','above50','leaderCount'])if(rows.every(row=>row[key]!==null))assert(rows.reduce((sum,row)=>sum+row[key],0)===global[key],'sector sum differs from global');
  }
 }
 assert(source.sectorRotation.lookback_sessions===126,'sector lookback');
 for(const frame of source.sectorRotation.frames){
  assert(Array.isArray(frame.ranks)&&(frame.ranks.length===0||frame.ranks.length===11),'complete sector frame');
  assert(new Set(frame.ranks.map(row=>row.symbol)).size===frame.ranks.length,'sector duplicates');
  for(const row of frame.ranks)assert(SECTOR_ETFS.includes(row.symbol)&&evidence.has(row.symbol)&&evidence.has('SPY')&&number(row.relativeIndex)&&row.relativeIndex>0&&row.rank===1+frame.ranks.filter(other=>other.relativeIndex>row.relativeIndex).length,'sector identity/rank');
 }
 return source;
}
