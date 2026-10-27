import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateLongHistory} from '../src/static/marketLongHistory.js';
import {SECTORS} from '../src/static/sectorDefinitions.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const number = (value,digits=1) => Number.isFinite(value) ? value.toLocaleString('ja-JP',{maximumFractionDigits:digits}) : '未確認';
const names = Object.fromEntries(SECTORS.map(([,label,symbol])=>[symbol,label]));
const groups = ['1440/dark','1440/light','390/dark','390/light'];
const compact = value => typeof value === 'string' ? value.replace(/\s/g,'') : null;
function windowMonths(points,months,asOf) {
  const end = new Date(asOf+'T00:00:00Z'), start = new Date(end);
  start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth()-months);
  start.setUTCDate(Math.min(end.getUTCDate(),new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate()));
  const from = start.toISOString().slice(0,10);
  return points.filter(point=>point.date>=from&&point.date<=asOf);
}
function readout(observed,point,values,label) {
  assert(observed?.date===point.date,label+': observation date differs');
  const expected = point.date + values.map(([name,value,unit,digits=1])=>`${name} ${number(value,digits)}${Number.isFinite(value)?unit:''}`).join('');
  assert.equal(compact(observed.readout),compact(expected),label+': numeric readout differs from authenticated source');
}

// This validates the immutable capture's source/observation consistency. The
// publication controller separately authenticates the producer and inventory.
export function validateMarketHistoryEvidence(report) {
  const source = report.market_history_source;
  assert(source && sha(source.market_series_sha256) && sha(source.history_source_sha256) && typeof source.raw_text==='string' && Buffer.byteLength(source.raw_text)>0 && Buffer.byteLength(source.raw_text)<=8*1024*1024,'Missing/bounded market source evidence');
  assert.equal(hash(source.raw_text),source.history_source_sha256,'Market history source bytes differ from digest');
  const history = validateLongHistory(JSON.parse(source.raw_text),report.data.as_of_date);
  const five = windowMonths(history.breadth,60,report.data.as_of_date),two = windowMonths(history.breadth,24,history.as_of_date),frames = history.sectorRotation.frames;
  const techGroup = history.sectorBreadth?.find(group=>group.sector==='Technology');
  assert(techGroup,'Missing Technology source');
  const tech = windowMonths(techGroup.points,24,history.as_of_date),sp = new Map(history.sp500.map(point=>[point.date,point.close]));
  assert(five.length>=1200 && two.length>=500 && frames.length>=250 && frames[0].ranks.length===11 && tech.length===two.length,'Source does not cover required 5-year/2-year/1-year windows');
  const calendar = history.calendar.sessions.map(date=>({date}));
  assert(five[0].date===windowMonths(calendar,60,report.data.as_of_date)[0]?.date && two[0].date===windowMonths(calendar,24,history.as_of_date)[0]?.date,'Source begins after the requested calendar period');
  const oneYear = new Date(history.as_of_date+'T00:00:00Z');oneYear.setUTCFullYear(oneYear.getUTCFullYear()-1);
  assert(Date.parse(frames[0].date)<=oneYear.getTime()+7*864e5 && frames.at(-1).date===history.as_of_date,'Sector animation does not span a calendar year');
  assert(Array.isArray(report.market_history_cases)&&report.market_history_cases.length===4,'Missing market history viewport/theme cases');
  const identities = report.market_history_cases.map(row=>`${row.viewport?.width}/${row.theme}`).sort();
  assert.deepEqual(identities,[...groups].sort(),'Duplicate/missing market history case');
  for (const row of report.market_history_cases) {
    const label = `Market history ${row.viewport.width}/${row.theme}`;
    assert(!Object.hasOwn(row,'error') && row.viewport.height===(row.viewport.width===1440?900:844) && row.observed_theme===row.theme && row.as_of_date===history.as_of_date,label+': incomplete actual viewport/theme/source date');
    assert(row.highlow?.months===60 && row.highlow.count===five.length && row.highlow.secondary_axis===true,label+': high/low range or S&P 500 axis missing');
    for (const [key,point] of [['first',five[0]],['last',five.at(-1)]]) readout(row.highlow[key],point,[['新高値',point.newHighs,'銘柄'],['新安値',point.newLows,'銘柄'],['S&P 500（右軸）',sp.get(point.date)??null,'pt']],`${label}/${key}`);
    const breadth = row.breadth;
    assert(breadth?.months===24 && breadth.count===two.length && breadth.firstDate===two[0].date && breadth.lastDate===two.at(-1).date,label+': breadth range differs');
    readout(breadth.leader_first,two[0],[['先導株数（価格条件）',two[0].leaderCount,'銘柄']],label+'/leaders');
    readout(breadth.technology_first,tech[0],[['50日線上',tech[0].above50Percent,'%']],label+'/Technology');
    readout(breadth.ratio_first,two[0],[['4%騰落・10日レシオ',two[0].ratio_10day,'倍',2]],label+'/ratio');
    const rotation = row.rotation, dates = frames.map(frame=>frame.date);
    assert(rotation?.count===frames.length && rotation.firstDate===dates[0] && rotation.lastDate===dates.at(-1),label+': rotation calendar differs');
    assert(rotation.initial_stopped===true && rotation.scrub_stopped===true && rotation.scrub_date===dates[0],label+': rotation initial/scrub pause missing');
    assert(dates.indexOf(rotation.played_date)>0 && dates.indexOf(rotation.paused_date)>=dates.indexOf(rotation.played_date) && rotation.paused_end_date===rotation.paused_date && Number.isFinite(rotation.pause_observed_ms)&&rotation.pause_observed_ms>=1000,label+': playback did not advance or pause was not observed');
    assert(Array.isArray(rotation.firstRanks)&&rotation.firstRanks.length===11,label+': missing sector ranks');
    for (const [i,expected] of frames[0].ranks.entries()) {
      const actual=rotation.firstRanks[i];
      assert(actual?.symbol===expected.symbol && actual.rank===expected.rank && actual.relativeIndex===expected.relativeIndex,label+': rank source differs');
      assert.equal(actual.text,`${expected.rank}位 ${names[expected.symbol]} ${expected.symbol} 相対価格指数 ${number(expected.relativeIndex,2)}`,label+': rendered rank/index differs');
    }
    assert(Array.isArray(rotation.reduced_transitions)&&rotation.reduced_transitions.length===11&&rotation.reduced_transitions.every(value=>value==='0s'),label+': reduced motion not honored');
    const bars=row.old_sector_bars;
    const existingCount=SECTORS.length+1; // Existing market list includes Unknown, unlike the 11-ETF animation.
    assert(bars?.count===existingCount && Array.isArray(bars.positions)&&bars.positions.length===existingCount,label+': missing existing sector rows');
    assert(bars.positions.every((item,i)=>['static','relative'].includes(item.position)&&Number.isFinite(item.top)&&Number.isFinite(item.height)&&item.height>0&&(!i||item.top>=bars.positions[i-1].top+bars.positions[i-1].height-1)),label+': existing sector rows overlap or became absolute');
    assert(row.old_sector_table===true && row.horizontal_overflow===false,label+': existing table or page geometry failed');
  }
  return true;
}
