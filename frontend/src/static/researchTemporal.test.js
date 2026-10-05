import { expect, it } from 'vitest';
import { prepareResearchBundle, researchBundleCurrent, researchBundleTemporal } from './researchPreprocess';
import { createResearchReceiver, researchPackets } from './researchWorkerPackets';
import { prepareSessionCurrent, prepareSessionIntervals, sessionCurrentFromIntervals } from './researchPresentation';
import { prepareReadinessTimeline, prepareReadinessBoundaries, readinessTimelineFromBoundaries } from './entryReadiness';
import { buildPortfolioPlan } from './portfolioPlan';
import { withFinancialProof } from './testFinancialFixture';

const date = '2026-09-25', now = Date.parse('2026-09-26T10:00:00Z');
const calendar = (from, until, asOf = date) => ({ as_of_date:asOf, calendar:{ latest_completed_session:asOf, evaluated_at:new Date(from).toISOString(), valid_until:new Date(until).toISOString() } });
const fixture = () => [
  withFinancialProof({symbol:'A',market:'US',eps_growth_yy:30,entry_evidence:calendar(now-100,now+100)},now,date),
  withFinancialProof({symbol:'B',market:'US',entry_evidence:{...calendar(now+200,now+300),earnings:{checked_at:new Date(now-72*3600000+400).toISOString()}}},now,date),
  withFinancialProof({symbol:'C',market:'US',entry_evidence:calendar(now-1000,now+1000,'2026-09-24')},now,date),
];
const deliver = bundle => {
  const receive=createResearchReceiver();let result;
  for (const packet of researchPackets(bundle)) result=receive(structuredClone(packet)) || result;
  return result;
};

it('queries cloned calendar intervals at inclusive starts, exclusive ends, gaps and clock rollback',()=>{
  const rows=fixture();
  const intervals=structuredClone(prepareSessionIntervals(rows,date));
  expect(intervals).toEqual([[now-100,now+100],[now+200,now+300]]);
  const current=sessionCurrentFromIntervals(intervals,date);
  for(const [offset,expected] of [[-101,false],[-100,true],[99,true],[100,false],[101,false],[199,false],[200,true],[299,true],[300,false],[301,false],[-100,true]]) {
    expect(current(now+offset)).toBe(expected);
    expect(current(now+offset)).toBe(prepareSessionCurrent(rows,date)(now+offset));
  }
  expect(current(NaN)).toBe(false);
  expect(current(Date.parse('2026-09-25T02:00:00Z'))).toBe(false);
  expect(prepareSessionIntervals(rows,undefined)).toEqual([]);
  expect(sessionCurrentFromIntervals(intervals,{toString:42})(now)).toBe(false);
});

it('retains every boundary, including nonselected rows, malformed sources and the exact 72-hour edge',()=>{
  const rows=fixture();
  rows.push({entry_evidence:{calendar:{evaluated_at:'invalid',valid_until:null},earnings:{checked_at:'invalid'}}});
  const boundaries=structuredClone(prepareReadinessBoundaries(rows));
  const timeline=readinessTimelineFromBoundaries(boundaries);
  expect(boundaries).toContain(now+401);
  expect(timeline(now+400)).toBe(timeline(now+399));
  expect(timeline(now+401)).toBe(timeline(now+400)+1);
  for(const boundary of boundaries) for(const offset of [-1,0,1]) expect(timeline(boundary+offset)).toBe(prepareReadinessTimeline(rows)(boundary+offset));
  const after=timeline(now+401);
  expect(timeline(now-1001)).toBeLessThan(after);
});

it('derives indices after projection and binds packet metadata to the newly assembled row set',()=>{
  const rows=fixture();
  rows[0].financial_current.p['1'][5]=now+100;
  const payload={as_of_date:date,rows,temporal:{date,session_intervals:[[0,Number.MAX_SAFE_INTEGER]],readiness_boundaries:[]}};
  const bundle=prepareResearchBundle([payload],date,{now,generation:'one',evaluationEpoch:4});
  const result=deliver(bundle), temporal=researchBundleTemporal(result);
  expect(temporal.rows).toBe(result.rows);
  expect(temporal.rows).not.toBe(bundle.rows);
  expect(temporal.session_intervals).toEqual(prepareSessionIntervals(result.rows,date));
  expect(temporal.readiness_boundaries).toEqual(prepareReadinessBoundaries(result.rows));
  const complete=[...researchPackets(bundle)].at(-1);
  expect(complete.temporal).not.toHaveProperty('rows');
  expect(JSON.stringify(complete.temporal).length).toBeLessThan(600);
  expect(researchBundleCurrent(result,now+100,'one')).toBe(true);
  expect(researchBundleCurrent(result,now+101,'one')).toBe(false);
  expect(researchBundleCurrent(result,now-1,'one')).toBe(false);
  expect(researchBundleCurrent(result,now,'two')).toBe(false);
  expect(researchBundleTemporal({...result,rows:[...result.rows]})).toBeNull();
  expect(researchBundleTemporal({...result,date:'2026-09-24'})).toBeNull();
  expect(researchBundleTemporal({...result,temporal:undefined})).toBeNull();
  expect(researchBundleTemporal({...result,temporal:{...temporal,session_intervals:undefined}})).toBeNull();
  expect(researchBundleTemporal(deliver({...bundle,rows:[...bundle.rows]}))).toBeNull();
});

it('rebuilds indices for refreshed evidence and produces the same portfolio decisions before and after every boundary',()=>{
  const bundle=prepareResearchBundle([{as_of_date:date,rows:fixture()}],date,{now,generation:'one',evaluationEpoch:4});
  // Three New York calendar days after the snapshot forces the portfolio's
  // freshness path to consult the supplied session selector.
  const later=now+2*86400000;
  const altered=bundle.rows.map(row=>({...row,entry_evidence:calendar(later+1000,later+2000)}));
  const next=deliver(prepareResearchBundle([{as_of_date:date,rows:altered,temporal:bundle.temporal}],date,{now:now+101,generation:'two',evaluationEpoch:5}));
  expect(next).toMatchObject({generation:'two',evaluation_epoch:5,evaluated_at:now+101});
  const temporal=researchBundleTemporal(next);
  expect(temporal.session_intervals).toEqual([[later+1000,later+2000]]);
  const current=sessionCurrentFromIntervals(temporal.session_intervals,date);
  for(const offset of [999,1000,1001,1999,2000,2001,999]) {
    const time=later+offset, plan=buildPortfolioPlan(next.rows,date,100000,time,next.prepared,current);
    expect(plan).toEqual(buildPortfolioPlan(next.rows,date,100000,time,next.prepared));
    expect(plan.blockers.includes('分析基準日を最新の取引日と照合してください')).toBe(offset<1000 || offset>=2000);
  }
});
