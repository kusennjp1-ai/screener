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

it('binds the VCP lab to exactly the same measured intervals as the SVG and resets on identity change',()=>{
 const measured = buildBookTechnicalEvidence(fixture.row,fixture,fixture.as_of_date);
 const {container,rerender}=render(<LeaderEvidenceChart {...props} technicalEvidence={measured} chartIdentity="first"/>);
 const first=measured.vcp.legs[0];
 const button=screen.getByRole('button',{name:'C1 の収縮区間を表示'});
 expect(button).toHaveTextContent(first.depthPct.toFixed(1));
 fireEvent.click(button);
 expect(button).toHaveAttribute('aria-pressed','true');
 const dates=[...container.querySelectorAll('[data-close]')].map(node=>node.dataset.date);
 expect(dates).toContain(first.startDate);expect(dates).toContain(first.endDate);
 expect(container.querySelector('[data-vcp-leg="1"]')).toHaveAttribute('data-selected','true');
 expect(container.querySelector('.chart-contraction-detail')).toHaveTextContent(first.startDate);
 fireEvent.click(screen.getByRole('button',{name:'週足',exact:true}));
 expect(screen.queryByRole('button',{name:'C1 の収縮区間を表示'})).not.toBeInTheDocument();
 rerender(<LeaderEvidenceChart {...props} technicalEvidence={measured} chartIdentity="second"/>);
 expect(container.querySelectorAll('[data-close]')).toHaveLength(63);
 expect(container.querySelector('[data-vcp-leg][data-selected="true"]')).toBeNull();
});

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
    expect(screen.getByTestId('svg-stop-example')).toHaveAttribute('data-price','323');
    expect(screen.getByTestId('svg-stop-example').getAttribute('y1')).toBe(screen.getByTestId('svg-stop-example').getAttribute('y2'));
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
    fireEvent.change(screen.getByRole('combobox',{name:'表示期間'}),{target:{value:'21'}});
    expect(container.querySelectorAll('[data-close]')).toHaveLength(21);
    fireEvent.keyDown(container.querySelector('svg'),{key:'ArrowLeft'});
    expect(container.querySelector('svg').getAttribute('aria-label')).not.toBe(initial);
    fireEvent.click(screen.getByRole('button',{name:'週足',exact:true}));
    expect(screen.getByRole('button',{name:'週足',exact:true})).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByText('操作',{selector:'summary'}));
    expect(screen.getByRole('button',{name:'VCP注記'})).toBeDisabled();
    expect(container.textContent).toContain('直前10週');
    fireEvent.click(screen.getByRole('button',{name:'日足',exact:true}));
    expect(container.querySelectorAll('[data-close]')).toHaveLength(63);
  });
  it('clears viewport and old annotation when publication identity changes', () => {
    const {container,rerender}=render(<LeaderEvidenceChart {...props} chartIdentity="one"/>);
    fireEvent.change(screen.getByRole('combobox',{name:'表示期間'}),{target:{value:'21'}});
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
  it.each([300,360,420])('respects the expanded fitted height %spx on the real SVG and date axis', height => {
    const {container}=render(<LeaderEvidenceChart {...props} expanded height={height} compactResearchChrome/>);
    const svg=container.querySelector('svg[data-chart-plot]');
    expect(svg).toHaveAttribute('data-chart-symbol',fixture.symbol);
    expect(svg).toHaveAttribute('data-chart-asof',fixture.as_of_date);
    expect(svg).toHaveStyle({height:`${height}px`});
    expect(svg.getAttribute('viewBox').split(' ').at(-1)).toBe(String(height));
    const axis=svg.querySelector('[data-chart-date-axis]');
    expect(axis.querySelector('rect')).toHaveAttribute('height','24');
    expect(axis.querySelector('line')).toHaveAttribute('y1',String(height-24));
    expect(axis.querySelectorAll('text')).toHaveLength(3);
    for(const text of axis.querySelectorAll('text'))expect(text).toHaveAttribute('font-size','11');
    const rsPoints=svg.querySelector('[data-series="rs"]').getAttribute('points').split(' ').map(p=>Number(p.split(',')[1]));
    expect(Math.min(...rsPoints)).toBeGreaterThan(height*.72+22);
    expect(Math.max(...rsPoints)).toBeLessThan(height-24);
  });
  it('packs mobile ranges into one select without losing 44px period and viewport controls', () => {
    const {container}=render(<LeaderEvidenceChart {...props}/>);
    const select=screen.getByRole('combobox',{name:'表示期間'});
    expect([...select.options].map(option=>option.text)).toEqual(['任意期間','1か月','3か月','6か月','1年']);
    for(const [value,count] of [['21',21],['63',63],['126',126],['252',252]]){
      fireEvent.change(select,{target:{value}});expect(container.querySelectorAll('[data-close]')).toHaveLength(Math.min(count,fixture.bars.length));
    }
    fireEvent.click(screen.getByText('操作',{selector:'summary'}));
    fireEvent.click(screen.getByRole('button',{name:'表示期間を拡大'}));expect(select).toHaveValue('');
    fireEvent.change(select,{target:{value:'63'}});expect(select).toHaveValue('63');
    const caption=container.querySelector('.leader-svg-caption-mobile');
    expect(caption.children).toHaveLength(2);expect(caption).toHaveTextContent(`最終バー ${fixture.as_of_date} 終値`);
    expect(container.textContent).toContain('50/150/200日線・直前50日出来高平均');
    for(const name of ['日足','週足','表示期間を拡大','表示期間を縮小','過去の期間へ','新しい期間へ','リセット','VCP注記'])expect(screen.getByRole('button',{name,exact:true})).toBeInTheDocument();
  });
  it.each([{compact:true,height:220},{compact:true,height:240},{expanded:true,height:300},{expanded:true,height:420},{height:390}])('separates three crowded VCP labels within the unchanged pane %j', layout => {
    const legs=Array.from({length:6},(_,index)=>({startDate:fixture.bars.at(-10).date,endDate:fixture.as_of_date,peakDate:fixture.bars.at(-10).date,lowDate:fixture.bars.at(-3+index%3).date,high:fixture.bars.at(-10).high,low:fixture.bars.at(-1).low,depthPct:6.5+index/10,sessions:10}));
    const evidence={version:BOOK_TECHNICAL_VERSION,valid:true,symbol:fixture.symbol,as_of_date:fixture.as_of_date,vcp:{legs}};
    const {container}=render(<LeaderEvidenceChart {...props} {...layout} technicalEvidence={evidence}/>);
    const svg=container.querySelector('svg'),pane=svg.querySelector('clipPath rect');
    const bounds={x:+pane.getAttribute('x'),y:+pane.getAttribute('y'),width:+pane.getAttribute('width'),height:+pane.getAttribute('height')};
    const boxes=[...svg.querySelectorAll('[data-vcp-label-box]')].map(node=>Object.fromEntries(['x','y','width','height'].map(key=>[key,+node.getAttribute(key)])));
    expect(boxes).toHaveLength(3);
    expect([...svg.querySelectorAll('[data-vcp-leg]')].map(node=>node.dataset.vcpLeg)).toEqual(['4','5','6']);
    for(const [index,box] of boxes.entries()){
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);expect(box.y+box.height).toBeLessThanOrEqual(bounds.y+bounds.height);
      if(index)expect(box.y).toBeGreaterThanOrEqual(boxes[index-1].y+boxes[index-1].height+4);
      const group=svg.querySelector(`[data-vcp-leg="${index+4}"]`),point=group.querySelector('circle');
      expect(group.querySelector('[data-vcp-leader]').getAttribute('d').endsWith(`L${point.getAttribute('cx')} ${point.getAttribute('cy')}`)).toBe(true);
      expect(group.querySelector('text')).toHaveTextContent(`C${index+4} ${(6.8+index/10).toFixed(1)}%`);
    }
    const originalBars=[...svg.querySelectorAll('[data-close]')].map(node=>node.outerHTML),originalAxis=pane.outerHTML;
    if(!layout.compact){
      expect(container.querySelectorAll('.leader-vcp-table tbody tr')).toHaveLength(6);
      fireEvent.click(screen.getByRole('button',{name:'VCP注記'}));
      expect(svg.querySelectorAll('[data-vcp-label-box]')).toHaveLength(0);
      expect([...svg.querySelectorAll('[data-close]')].map(node=>node.outerHTML)).toEqual(originalBars);
      expect(svg.querySelector('clipPath rect').outerHTML).toBe(originalAxis);
    }
  });
  it.each([{}, {expanded:true,height:300}, {compact:true,height:220}])('withholds an unbound RS line in every renderer surface %j without changing prices', layout => {
    const {container,rerender}=render(<LeaderEvidenceChart {...props} {...layout}/>);
    const rs=container.querySelector('[data-series="rs"]').getAttribute('points');
    const bars=[...container.querySelectorAll('[data-close]')].map(node=>node.dataset.close);
    for(const benchmarkSymbol of [undefined,null,'','   ']){
      rerender(<LeaderEvidenceChart {...props} {...layout} benchmarkSymbol={benchmarkSymbol}/>);
      expect(container.querySelector('[data-series="rs"]')).toBeNull();
      expect(container.textContent).toContain('RS線の比較対象が未確認（データなし）');
      expect([...container.querySelectorAll('[data-close]')].map(node=>node.dataset.close)).toEqual(bars);
    }
    rerender(<LeaderEvidenceChart {...props} {...layout}/>);
    expect(container.querySelector('[data-series="rs"]').getAttribute('points')).toBe(rs);
  });
  it('shows missing RS as data absent without a fake line', () => {
    const {container}=render(<LeaderEvidenceChart {...props} rsLineData={[]}/>);
    expect(container.querySelector('[data-pane="rs"]')).toHaveTextContent('データなし');
    expect(container.querySelectorAll('[data-series="rs"]')).toHaveLength(0);
  });
});
