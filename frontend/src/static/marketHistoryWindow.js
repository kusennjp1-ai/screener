// The long history's display window (the long-run explorer's and the market trend chart's period buttons). Only the lazily
// loaded market screen draws those charts, so this lives apart from marketLongHistory.js (which re-exports it) and Today's
// entry chunk does not ship it.
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function historyWindow(points,months,asOfDate){
 if(!day(asOfDate)||!Number.isSafeInteger(months)||months<1||months>60)return [];
 const end=new Date(`${asOfDate}T00:00:00Z`),cutoff=new Date(end);
 cutoff.setUTCDate(1);cutoff.setUTCMonth(cutoff.getUTCMonth()-months);
 cutoff.setUTCDate(Math.min(end.getUTCDate(),new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate()));
 const from=cutoff.toISOString().slice(0,10);
 return (points||[]).filter(point=>day(point.date)&&point.date>=from&&point.date<=asOfDate);
}
