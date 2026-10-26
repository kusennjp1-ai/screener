import { describe, expect, it } from 'vitest';
import { buildRsRatingHistories } from './rs-rating-history.mjs';
import { AUDIT_VERSION, rankVerifiedUniverse } from '../src/static/qualificationAudit.js';
import fixture from '../src/test/fixtures/leaderChartAapl.json';

function input(count=101) {
  const sessions=fixture.session_calendar.sessions,asOfDate=fixture.as_of_date;
  const charts=Array.from({length:count},(_,symbolIndex)=>({symbol:`S${symbolIndex}`,as_of_date:asOfDate,bars:fixture.bars.map((bar,i)=>({...bar,close:100*(1+(symbolIndex%100)*.0001)**i}))}));
  const rows=rankVerifiedUniverse(charts.map(chart=>{
    const close=chart.bars.at(-1).close;
    const momentum=[63,126,189,252].reduce((sum,lag,i)=>sum+(close/chart.bars.at(-1-lag).close-1)*(i===0?.4:.2),0);
    return {symbol:chart.symbol,market:'US',currency:'USD',current_price:close,technical_audit:{version:AUDIT_VERSION,status:'verified',valid:true,symbol:chart.symbol,as_of_date:asOfDate,errors:[],values:{close,momentum}}};
  }));
  return {rows,charts,sessions,asOfDate};
}
describe('retrospective current-universe RS history',()=>{
  it('uses the same weighted midrank as current audited ratings, including ties',()=>{
    const source=input(),result=buildRsRatingHistories(source);
    expect(result.size).toBe(101);
    for(const row of source.rows){
      const history=result.get(row.symbol);
      expect(history.points.at(-1)).toEqual({time:source.asOfDate,value:row.rs_rating,universe_size:101});
      expect(history.points).toHaveLength(fixture.bars.length-252);
      expect(history.points[0].time).toBe(fixture.bars[252].date);
    }
    expect(result.get('S0').points).toEqual(result.get('S100').points);
  });
  it('never uses a later close to calculate an earlier observation',()=>{
    const source=input(),before=buildRsRatingHistories(source).get('S50').points;
    source.charts[50].bars.at(-1).close*=2;
    const chart=source.charts[50],close=chart.bars.at(-1).close;
    Object.assign(source.rows.find(row=>row.symbol==='S50'),{current_price:close});
    const audit=source.rows.find(row=>row.symbol==='S50').technical_audit;
    audit.values={close,momentum:[63,126,189,252].reduce((sum,lag,i)=>sum+(close/chart.bars.at(-1-lag).close-1)*(i===0?.4:.2),0)};
    source.rows=rankVerifiedUniverse(source.rows);
    const after=buildRsRatingHistories(source).get('S50').points;
    expect(after.slice(0,-1)).toEqual(before.slice(0,-1));expect(after.at(-1).value).not.toBe(before.at(-1).value);
  });
  it('requires 100 eligible daily observations and never compresses a missing session',()=>{
    expect(buildRsRatingHistories(input(99)).size).toBe(0);
    const source=input();source.charts[50].bars.splice(100,1);
    const result=buildRsRatingHistories(source);
    expect(result.has('S50')).toBe(false);
    // Remaining ranks no longer match the canonical current population, so are
    // withheld rather than published as a second contradictory current rating.
    expect(result.size).toBeLessThan(101);
  });
  it('rejects future/mixed publication calendars and duplicate symbols',()=>{
    const source=input();source.sessions=[...source.sessions,'2026-10-26'];
    expect(buildRsRatingHistories(source).size).toBe(0);
    const duplicate=input();duplicate.rows.push(duplicate.rows[0]);expect(buildRsRatingHistories(duplicate).size).toBe(0);
  });
});
