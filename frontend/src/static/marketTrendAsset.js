const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

import { validateLongHistory } from './marketLongHistory.js';
import { FOLLOW_THROUGH_STATES, FOLLOW_THROUGH_EVENTS } from './followThroughDay.js';
const count=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Light shape check of the exporter's follow-through record. Older publications omit it entirely.
function followThroughValid(value,asOfDate){
 if(!plain(value)||typeof value.method!=='string')return false;
 if(value.available===false)return typeof value.reason==='string'&&value.reason.length>0;
 if(value.available!==true||!validDay(value.asOf)||value.asOf>asOfDate||!FOLLOW_THROUGH_STATES.includes(value.state))return false;
 const on=date=>validDay(date)&&date<=value.asOf, {peak,low,attempt,ftd}=value;
 if(peak!==null&&!(plain(peak)&&on(peak.date)&&finite(peak.close)&&peak.close>0))return false;
 if(low!==null&&!(plain(low)&&on(low.date)&&finite(low.low)&&low.low>0))return false;
 if(value.declinePct!==null&&!(finite(value.declinePct)&&value.declinePct>=0))return false;
 if('peakAtWindowStart' in value&&typeof value.peakAtWindowStart!=='boolean')return false;
 if(attempt!==null&&!(plain(attempt)&&on(attempt.startDate)&&Number.isSafeInteger(attempt.day)&&attempt.day>0))return false;
 if(ftd!==null&&!(plain(ftd)&&on(ftd.date)&&Number.isSafeInteger(ftd.attemptDay)&&ftd.attemptDay>0&&finite(ftd.gainPct)&&finite(ftd.volumeRatio)&&ftd.volumeRatio>0&&count(ftd.sessionsSince)&&(ftd.distributionSince===null||count(ftd.distributionSince))))return false;
 if(value.failedDate!==null&&!on(value.failedDate))return false;
 if(['confirmed','ftd_failed'].includes(value.state)&&!ftd)return false;
 if(value.state==='ftd_failed'&&!value.failedDate)return false;
 if(['rally_attempt','attempt_expired'].includes(value.state)&&!attempt)return false;
 return Array.isArray(value.events)&&value.events.every((event,i)=>plain(event)&&FOLLOW_THROUGH_EVENTS.includes(event.type)&&on(event.date)&&(!i||event.date>=value.events[i-1].date));
}
// The validator's English check keys are diagnostics; a reader sees a short Japanese category (first match wins).
const CHECK_LABELS=[[/retrieval date/,'取得日時'],[/identity\/date/,'出典・基準日'],[/provenance|acquisition error/,'取得元の記録'],[/sector|classification/,'セクター集計'],
 [/population|universe/,'対象銘柄集合'],[/calendar|session/,'取引カレンダー'],[/coverage/,'観測範囲']];
export function longHistoryCheck(error){
 const message=String(error?.message||error);
 if(!message.startsWith('長期市場履歴: '))return {key:message,label:'データ形式'};
 const key=message.slice('長期市場履歴: '.length);
 return {key,label:CHECK_LABELS.find(([pattern])=>pattern.test(key))?.[1]||'集計値の整合'};
}
// An index's chart closes (round 2, plan §2.3): at most 300 points, strictly increasing days up to the analysis date,
// positive closes, and the last days of the same bars as its distribution series (points). Older assets lack it.
export const INDEX_CLOSES_MAX=300;
function closesValid(closes,points,asOfDate){
 if(!Array.isArray(closes)||!closes.length||closes.length>INDEX_CLOSES_MAX||closes.length>points.length)return false;
 const days=points.slice(-closes.length);
 return closes.every((point,i)=>plain(point)&&validDay(point.date)&&point.date<=asOfDate&&(!i||point.date>closes[i-1].date)&&finite(point.close)&&point.close>0&&days[i]?.date===point.date);
}
// A malformed optional field is withdrawn with a reason; it never blanks the distribution count beside it.
// Like lastObserved, a judgement belongs to its own index: computed on the same bars, so dated on their last point.
function readIndex(index,asOfDate){
 const out={...index},points=Array.isArray(index.points)?index.points:[];
 const ownBars=value=>value?.available!==true||(points.length>0&&points.at(-1)?.date===value.asOf);
 if('followThrough' in index&&!(followThroughValid(index.followThrough,asOfDate)&&ownBars(index.followThrough)))out.followThrough={available:false,method:typeof index.followThrough?.method==='string'?index.followThrough.method:null,reason:'フォロースルー判定の形式を確認できません。'};
 if('lastObserved' in index&&index.lastObserved!==null){
  const last=points.filter(point=>count(point?.value)).at(-1),observed=index.lastObserved;
  if(!(plain(observed)&&validDay(observed.date)&&observed.date<=asOfDate&&count(observed.value)&&last?.date===observed.date&&last.value===observed.value))delete out.lastObserved;
 }
 // Malformed closes are withdrawn alone (the market tab then has no S&P／Nasdaq switch); the counts beside them stay.
 if('closes' in index&&!closesValid(index.closes,points,asOfDate)){delete out.closes;out.closes_error='指数の終値の形式を確認できません。';}
 return out;
}
export function readMarketTrends(value,entry){
 if(value?.schema_version!=='market-trends-v1'||value.market!=='US'||value.as_of_date!==entry.as_of_date)throw Error('市場推移の基準日が一致しません。');
 for(const points of [value.breadth?.points,value.put_call?.points,...(value.indices||[]).map(index=>index.points)]){
  if(!Array.isArray(points)||points.some((point,i)=>!validDay(point?.date)||point.date>entry.as_of_date||(i>0&&point.date<=points[i-1].date)))throw Error('市場推移の取引日を確認できません。');
 }
 if(value.indices?.length!==2||value.indices[0]?.symbol!=='^GSPC'||value.indices[1]?.symbol!=='^IXIC')throw Error('指数を識別できません。');
 const result={...value,indices:value.indices.map(index=>readIndex(index,entry.as_of_date))};
 if(value.long_history){
  // No upper bound on retrieved_at here, deliberately: the series carries no publication instant (its bytes are
  // clock-independent so a replay is identical) and a device clock is not one. The build bounds retrieved_at by
  // its evaluation instant (selectRuntimeLongHistorySource, verifyLongHistorySource) and the series is hash-pinned.
  // Every other check runs, including the lower bound: never retrieved before the capture's own observation date.
  try{validateLongHistory(value.long_history,entry.as_of_date,Infinity);}
  catch(error){
   // Only the long history is withdrawn; distribution days and follow-through stay usable.
   // The English key stays available for diagnosis (long_history_error_key), never in the sentence.
   const check=longHistoryCheck(error);
   delete result.long_history;
   result.long_history_error=`長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: ${check.label}）。`;
   result.long_history_error_key=check.key;
  }
 }
 return result;
}
