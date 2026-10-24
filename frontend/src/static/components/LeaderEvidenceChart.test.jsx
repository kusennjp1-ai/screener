import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LeaderEvidenceChart from './LeaderEvidenceChart';
import { leaderChartModel, precedingVolumeMean, seriesPaths } from './leaderChartModel';
import { transformToCandlestickData } from '../../components/Charts/candlestickData';
import { buildBookTechnicalEvidence, BOOK_TECHNICAL_VERSION } from '../bookTechnicalEvidence';
import fixture from '../../test/fixtures/leaderChartAapl.json';
afterEach(cleanup);
const options = { bars:fixture.bars,symbol:fixture.symbol,date:fixture.as_of_date,rsLine:fixture.rs_line };
const props = { symbol:fixture.symbol,date:fixture.as_of_date,priceData:fixture.bars,rsLineData:fixture.rs_line,benchmarkSymbol:fixture.benchmark_symbol,row:fixture.row,payload:fixture,smallScreen:true,pivotPrice:340,buyCeiling:357,stopPrice:323 };

describe('unchanged historical chart data and calculation contracts', () => {
  it.each(['daily','weekly'])('reuses exact existing %s OHLC/MA conversion without mutation', timeframe => {
    const before = structuredClone(fixture),actual=leaderChartModel({...options,timeframe});
    const expected=transformToCandlestickData(fixture.bars,timeframe,{includeEMA:false});
    expect(actual.candlesticks).toEqual(expected.candlesticks);
    for(const key of ['sma50','sma150','sma200','volume'])expect(actual[key]).toEqual(expected[key]);
    expect(fixture).toEqual(before);
  });
  it('excludes the current bar and never invents partial volume averages', () => {
    const volume=Array.from({length:53},(_,i)=>({time:String(i),value:i===50?10000:i+1}));
    const avg=precedingVolumeMean(volume);
    expect(avg).toHaveLength(3);expect(avg[0]).toEqual({time:'50',value:25.5});
    expect(avg[1].value).toBe(volume.slice(1,51).reduce((sum,p)=>sum+p.value,0)/50);
    expect(precedingVolumeMean(volume.slice(0,50))).toEqual([]);
  });
  it('matches the actual last-session audited volume ratio without display rounding', () => {
    const model=leaderChartModel(options),last=fixture.bars.at(-1);
    expect(model.volumeMean.at(-1).time).toBe(last.date);
    expect(last.volume/model.volumeMean.at(-1).value).toBe(fixture.row.technical_audit.values.volumeRatio);
  });
  it.each(['missing','badOHLC','outOfOrder','wrongLast'])('rejects %s prices rather than repairing them', kind => {
    const bars=structuredClone(fixture.bars);
    if(kind==='missing')bars.length=0;
    if(kind==='badOHLC')bars[3].low=bars[3].high+1;
    if(kind==='outOfOrder')bars[3].date=bars[2].date;
    if(kind==='wrongLast')bars.pop();
    expect(leaderChartModel({...options,bars}).error).toBeTruthy();
  });
  it('uses supplied RS values unchanged, not RS percentile or a new normalization', () => {
    const model=leaderChartModel(options);
    expect(model.rs).toEqual(fixture.rs_line);
    const weekly=leaderChartModel({...options,timeframe:'weekly'}),dates=new Set(weekly.candlesticks.map(p=>p.time));
    expect(weekly.rs).toEqual(fixture.rs_line.filter(p=>dates.has(p.time)));
  });
  it.each([null,[],[{time:'2000-01-01',value:8}],[{time:fixture.as_of_date,value:null}],[{time:fixture.as_of_date,value:0}],[{time:fixture.as_of_date,value:-1}]])('keeps invalid/missing RS absent', rsLine => {
    expect(leaderChartModel({...options,rsLine}).rs).toEqual([]);
  });
  it('splits an RS path at a missing session without forward fill', () => {
    const bars=[{time:'a'},{time:'b'},{time:'c'}];
    expect(seriesPaths([{time:'a',value:3},{time:'c',value:8}],bars,i=>i,v=>v)).toEqual(['0,3','2,8']);
  });
});
describe('self-drawn SVG evidence and controls', () => {
  it('uses three common-time SVG panes and no canvas or remote assets', () => {
    const {container}=render(<LeaderEvidenceChart {...props}/>);
    expect(container.querySelector('canvas')).toBeNull();expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect([...container.querySelectorAll('[data-pane]')].map(p=>p.dataset.pane)).toEqual(['price','volume','rs']);
    expect(container.querySelectorAll('image,script,link')).toHaveLength(0);
    expect(screen.getByTestId('svg-canonical-buy-zone')).toHaveAttribute('data-pivot','340');
    expect(screen.getByTestId('svg-canonical-buy-zone')).toHaveAttribute('data-upper','357');
  });
  it('never substitutes inferred VCP highs for a missing canonical buy level', () => {
    const technicalEvidence={version:BOOK_TECHNICAL_VERSION,valid:true,symbol:fixture.symbol,as_of_date:fixture.as_of_date,vcp:{legs:[{startDate:fixture.bars.at(-4).date,endDate:fixture.as_of_date,peakDate:fixture.bars.at(-4).date,lowDate:fixture.bars.at(-2).date,high:999,low:330,depthPct:66,sessions:3}]}};
    const {container}=render(<LeaderEvidenceChart {...props} pivotPrice={null} buyCeiling={null} technicalEvidence={technicalEvidence}/>);
    expect(screen.queryByTestId('svg-canonical-buy-zone')).toBeNull();
    expect(container.textContent).toContain('共通ピボット データなし');
    expect(container.textContent).toContain('推定');
  });
  it('reuses measured VCP legs with full periods/depths and does not force three contractions', () => {
    const evidence=buildBookTechnicalEvidence(fixture.row,fixture,fixture.as_of_date);
    expect(evidence.valid).toBe(true);
    const {container}=render(<LeaderEvidenceChart {...props} technicalEvidence={evidence}/>);
    const table=container.querySelector('.leader-vcp-table');
    for(const leg of evidence.vcp.legs){expect(table.textContent).toContain(leg.startDate);expect(table.textContent).toContain(leg.depthPct.toFixed(2)+'%');}
    expect(table.querySelectorAll('tbody tr')).toHaveLength(evidence.vcp.legs.length);
  });
  it('supports daily/weekly, ranges, zoom and keyboard period movement', () => {
    const {container}=render(<LeaderEvidenceChart {...props}/>);
    const initial=container.querySelector('svg').getAttribute('aria-label');
    fireEvent.click(screen.getByRole('button',{name:'1か月',exact:true}));
    expect(container.querySelectorAll('[data-close]')).toHaveLength(21);
    fireEvent.keyDown(container.querySelector('svg'),{key:'ArrowLeft'});
    expect(container.querySelector('svg').getAttribute('aria-label')).not.toBe(initial);
    fireEvent.click(screen.getByRole('button',{name:'週足',exact:true}));
    expect(screen.getByRole('button',{name:'週足',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('button',{name:'VCP注記'})).toBeDisabled();
    expect(container.textContent).toContain('直前10週');
    fireEvent.click(screen.getByRole('button',{name:'日足',exact:true}));
    expect(container.querySelectorAll('[data-close]')).toHaveLength(63);
  });
  it('clears viewport and old annotation when publication identity changes', () => {
    const {container,rerender}=render(<LeaderEvidenceChart {...props} chartIdentity="one"/>);
    fireEvent.click(screen.getByRole('button',{name:'1か月',exact:true}));
    expect(container.querySelectorAll('[data-close]')).toHaveLength(21);
    rerender(<LeaderEvidenceChart {...props} chartIdentity="two"/>);
    expect(container.querySelectorAll('[data-close]')).toHaveLength(63);
  });
  it('updates the shared compact comparison period without stale state', () => {
    const {container,rerender}=render(<LeaderEvidenceChart {...props} compact comparisonSessions={63}/>);
    expect(container.querySelectorAll('[data-close]')).toHaveLength(63);
    rerender(<LeaderEvidenceChart {...props} compact comparisonSessions={21}/>);
    expect(container.querySelectorAll('[data-close]')).toHaveLength(21);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
  it('hides buy levels and estimated VCP when an existing history warning applies', () => {
    const bars=structuredClone(fixture.bars);
    for(const key of ['open','high','low','close'])bars[10][key]*=3;
    const {container}=render(<LeaderEvidenceChart {...props} priceData={bars}/>);
    expect(screen.queryByTestId('svg-canonical-buy-zone')).toBeNull();
    expect(screen.queryByTestId('svg-stop-example')).toBeNull();
    expect(container.querySelectorAll('[data-vcp-leg]')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('価格断絶');
  });
  it('shows missing RS as data absent without a fake line', () => {
    const {container}=render(<LeaderEvidenceChart {...props} rsLineData={[]}/>);
    expect(container.querySelector('[data-pane="rs"]')).toHaveTextContent('データなし');
    expect(container.querySelectorAll('[data-series="rs"]')).toHaveLength(0);
  });
});
