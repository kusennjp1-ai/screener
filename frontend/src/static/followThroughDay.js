// Follow-through day (O'Neil's bottom confirmation), this app's own causal reading of the index bars.
// Constants mirror backend/app/services/market_regime.py (FTD_MIN_GAIN, FTD_MIN_DAY, FTD_MAX_DAY, FTD_MIN_DECLINE).
// Unlike the backend's 120-session lowest-low anchor, a forward state machine follows the latest
// peak-to-trough leg, so a later pullback is assessed instead of being hidden behind an older low.
export const FOLLOW_THROUGH_METHOD = 'rally-attempt-gain1.2-day4-15-decline6-v1';
export const FTD_MIN_GAIN = 0.012, FTD_MIN_DAY = 4, FTD_MAX_DAY = 15, FTD_MIN_DECLINE = 0.06;
export const FOLLOW_THROUGH_STATES = ['no_correction','correction','rally_attempt','attempt_expired','confirmed','ftd_failed'];
export const FOLLOW_THROUGH_EVENTS = ['correction_start','rally_attempt','attempt_failed','attempt_expired','ftd','ftd_failed','low_undercut','recovered'];
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

/**
 * Pure causal state machine over bars already validated by distributionDays (same bars, same last date).
 * The leg's decline is the backend formula: peak close -> close of the lowest-low session after the peak.
 * distributionEvents (from distributionDays on the same bars) give the post-FTD count; absent stays null.
 */
export function followThroughDay({ symbol, bars, asOfDate, distributionEvents } = {}) {
  const unavailable = reason => ({available:false, method:FOLLOW_THROUGH_METHOD, reason});
  if (!['^GSPC','^IXIC'].includes(symbol) || !day(asOfDate) || !Array.isArray(bars)) return unavailable('指数・日付を確認できません。');
  const input = bars.filter(bar=>bar?.date<=asOfDate);
  if (!input.length || input.at(-1).date!==asOfDate || input.some((bar,index)=>!day(bar.date) || (index>0&&bar.date<=input[index-1].date) || !['open','high','low','close','volume'].every(key=>positive(bar[key])) || bar.high<Math.max(bar.open,bar.close,bar.low) || bar.low>Math.min(bar.open,bar.close))) return unavailable('指数OHLCVに欠測・重複・不正値があります。未判定とし、判定済みとは扱いません。');
  const events=[], at=index=>input[index].date;
  // peak: highest close of the current leg; low: lowest low strictly after it (first occurrence, as numpy argmin).
  // leg: the correction a standing FTD confirmed, kept so a failed FTD resumes tracking from the same peak.
  let state='no_correction', peak=0, low=null, attempt=null, ftd=null, failed=null, leg=null;
  const lowest=(from,to)=>{let found=null;for(let index=from;index<=to;index++)if(found===null||input[index].low<input[found].low)found=index;return found;};
  const decline=()=>low===null?null:(input[peak].close-input[low].close)/input[peak].close;
  const trackDrawdown=index=>{
    if(input[index].close>input[peak].close){peak=index;low=null;return false;}
    if(low===null||input[index].low<input[low].low)low=index;
    return decline()>=FTD_MIN_DECLINE;
  };
  const startCorrection=index=>{state='correction';attempt=null;ftd=null;failed=null;leg=null;events.push({type:'correction_start',date:at(index),peakDate:at(peak),declinePct:100*decline()});};
  for (let index=1; index<input.length; index++) {
    const bar=input[index], previous=input[index-1];
    if (state==='confirmed') {
      // Backend circuit breaker: any later close under the FTD session's low.
      if (bar.close<input[ftd.index].low) {
        if (input[peak].close<=input[leg.peak].close) peak=leg.peak;
        low=lowest(peak+1,index);state='ftd_failed';failed=index;leg=null;
        events.push({type:'ftd_failed',date:bar.date,ftdDate:at(ftd.index)});
        continue;
      }
      // Confirmed through later new highs until a new >=6% leg from the post-FTD peak.
      if (trackDrawdown(index)) startCorrection(index);
      continue;
    }
    if (state==='no_correction') { if (trackDrawdown(index)) startCorrection(index); continue; }
    // correction / rally_attempt / attempt_expired / ftd_failed: the leg's low is the rally low.
    if (bar.low<input[low].low) {
      if (attempt) events.push({type:'attempt_failed',date:bar.date,startDate:at(attempt.start),day:index-attempt.start+1});
      else if (state==='ftd_failed') events.push({type:'low_undercut',date:bar.date});
      low=index;attempt=null;ftd=null;failed=null;state='correction';
      continue;
    }
    if (state==='rally_attempt') {
      const attemptDay=index-attempt.start+1, gain=bar.close/previous.close-1;
      if (attemptDay>=FTD_MIN_DAY && attemptDay<=FTD_MAX_DAY && gain>=FTD_MIN_GAIN && bar.volume>previous.volume) {
        ftd={index,attemptDay,gainPct:gain*100,volumeRatio:bar.volume/previous.volume};leg={peak,low};
        events.push({type:'ftd',date:bar.date,attemptDay,gainPct:ftd.gainPct,volumeRatio:ftd.volumeRatio,lowDate:at(low)});
        state='confirmed';attempt=null;peak=index;low=null;
        continue;
      }
    }
    if (bar.close>input[peak].close) {
      events.push({type:'recovered',date:bar.date,peakDate:at(peak)});
      state='no_correction';peak=index;low=null;attempt=null;ftd=null;failed=null;
      continue;
    }
    // Day 1 is the first up close after the rally low; a low set by the failing session itself can start a new attempt.
    if ((state==='correction' || (state==='ftd_failed'&&low===failed)) && bar.close>previous.close) {
      state='rally_attempt';attempt={start:index};ftd=null;failed=null;
      events.push({type:'rally_attempt',date:bar.date,lowDate:at(low)});
      continue;
    }
    if (state==='rally_attempt' && index-attempt.start+1>FTD_MAX_DAY) {
      state='attempt_expired';
      events.push({type:'attempt_expired',date:bar.date,startDate:at(attempt.start)});
    }
  }
  const last=input.length-1, ftdDate=ftd?at(ftd.index):null;
  return {available:true, method:FOLLOW_THROUGH_METHOD, asOf:asOfDate, state,
    peak:{date:at(peak),close:input[peak].close},
    low:low===null?null:{date:at(low),low:input[low].low},
    declinePct:low===null?null:100*decline(),
    attempt:attempt?{startDate:at(attempt.start),day:last-attempt.start+1}:null,
    ftd:ftd?{date:ftdDate,attemptDay:ftd.attemptDay,gainPct:ftd.gainPct,volumeRatio:ftd.volumeRatio,sessionsSince:last-ftd.index,
      distributionSince:Array.isArray(distributionEvents)?distributionEvents.filter(event=>event.date>ftdDate&&event.state==='active').length:null}:null,
    failedDate:state==='ftd_failed'?at(failed):null,
    events};
}
