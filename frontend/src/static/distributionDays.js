// Basic distribution rule, not IBD's editorial count (stalling is not inferred).
// Primary definition: https://shop.investors.com/Images/promotional/Wizards-QA.pdf
// Expiry reference: https://www.investors.com/how-to-invest/investors-corner/how-to-spot-major-stock-market-tops/
export const DISTRIBUTION_METHOD = 'index-down-strictly-over-0.2-higher-volume-age25-high5-v1';
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

/** Pure causal calculation. Complete independent session coverage is required. */
export function distributionDays({ symbol, bars, sessions, asOfDate, halfDays = [] } = {}) {
  const unavailable = reason => ({symbol, available:false, reason, points:[], events:[], method:DISTRIBUTION_METHOD});
  if (!['^GSPC','^IXIC'].includes(symbol) || !day(asOfDate) || !Array.isArray(bars) || !Array.isArray(sessions)) return unavailable('指数・日付・取引日を確認できません。');
  const calendar = sessions.filter(value => value <= asOfDate);
  if (calendar.length < 26 || calendar.some((value,index)=>!day(value)||(index>0&&value<=calendar[index-1])) || calendar.at(-1)!==asOfDate) return unavailable('連続した26営業日以上の取引日を確認できません。');
  const input = bars.filter(bar=>bar?.date<=asOfDate);
  if (input.length!==calendar.length || input.some((bar,index)=>bar.date!==calendar[index] || !['open','high','low','close','volume'].every(key=>positive(bar[key])) || bar.high<Math.max(bar.open,bar.close,bar.low) || bar.low>Math.min(bar.open,bar.close))) return unavailable('指数OHLCVに欠測・重複・不正値があります。ゼロ件とは扱いません。');
  const events=[],points=[], half=new Set(halfDays);
  for(let index=0;index<input.length;index++) {
    const bar=input[index],previous=input[index-1];
    for(const event of events.filter(event=>event.state==='active')) {
      const age=index-event.sessionIndex;
      // The DD itself is age 0. After 25 subsequent sessions it expires.
      // Expiry precedes a rally on that same already-expired session.
      if(age>=25){event.state='expired';event.removedDate=bar.date;event.removal='25営業日経過';}
      else if(bar.high>=event.close*1.05){event.state='rallied';event.removedDate=bar.date;event.removal='後日の高値が分配日終値から5%以上上昇';}
    }
    // Do not round a 0.1999% decline into a 0.2% threshold crossing. Exact
    // equality is excluded by the primary source's "more than 0.2%" wording.
    const decline=previous ? (previous.close-bar.close)/previous.close : null;
    const detected=previous && decline>0.002+1e-12 && bar.volume>previous.volume;
    if(detected) events.push({date:bar.date,sessionIndex:index,close:bar.close,changePct:-decline*100,volumeRatio:bar.volume/previous.volume,state:'active',removedDate:null,removal:null,comparisonNote:half.has(previous.date)?'前営業日は短縮取引。出来高比較に注意':null});
    const complete=index>=25;
    points.push({date:bar.date,value:complete?events.filter(event=>event.state==='active').length:null,distribution:Boolean(detected),reason:complete?null:'25営業日の候補日と前日比較に必要な履歴が不足'});
  }
  return {symbol,available:true,method:DISTRIBUTION_METHOD,points,events:events.map(({sessionIndex,...event})=>({...event,ageSessions:input.length-1-sessionIndex})),latest:points.at(-1)};
}
