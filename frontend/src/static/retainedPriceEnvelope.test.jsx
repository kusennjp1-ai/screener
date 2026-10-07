import {render,screen,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ThemeProvider,createTheme} from '@mui/material/styles';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ResearchChart from './components/ResearchChart';
import CandidateCharts from './components/CandidateCharts';
import StaticChartViewerModal from './StaticChartViewerModal';
import {researchCsv} from './researchEngine';
import {filterRanked} from './researchPresentation';

const fetchPayload=vi.hoisted(()=>vi.fn());
vi.mock('./chartClient',()=>({fetchStaticChartPayload:fetchPayload,staticChartKeys:{payload:(symbol,path)=>['chart',symbol,path]}}));
vi.mock('../components/Charts/CandlestickChart',()=>({default:()=> <div data-testid="rendered-candles"/>}));
const target='2026-10-05';
const row={symbol:'STALE',company_name:'Stale historical reference',market:'US',currency:'USD',as_of_date:target,
  current_price:null,adv_usd:null,rs_rating:null,se_pivot_price:null,vcp_pivot:null,se_setup_ready:false,
  chart_path:'retained-price-charts/original.json',technical_audit:{version:'ohlcv-v1',symbol:'STALE',as_of_date:target,valid:false,
    errors:['最終日足が分析日と不一致'],values:{}},setup_recalculation:{status:'unavailable',as_of_date:target}};
const chart={symbol:'STALE',market:'US',as_of_date:target,generated_at:'2026-10-04T13:00:00Z',stock_data:row,
  bars:[{date:'2026-10-02',open:900,high:960,low:899,close:954.32,volume:1000000}],
  retained_price_history:{observation_date:'2026-10-02',original_as_of_date:'2026-10-02',target_as_of_date:target}};
function wrap(element){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>
  <ThemeProvider theme={createTheme()}>{element}</ThemeProvider></QueryClientProvider>);}
beforeEach(()=>{
  fetchPayload.mockResolvedValue(chart);
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
  vi.stubGlobal('IntersectionObserver',class{constructor(cb){this.cb=cb;}observe(){this.cb([{isIntersecting:true}]);}disconnect(){}});
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});

it('inline approved chart rejects old bars inside a new analysis envelope',async()=>{
  wrap(<ResearchChart symbol="STALE" date={target} entry={{path:row.chart_path}} row={row} method="minervini"/>);
  expect(await screen.findByText('チャートを取得できません。')).toBeInTheDocument();
  expect(screen.queryByTestId('rendered-candles')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('954.32');
});
it('comparison card withholds the old close and explains unavailable current history',async()=>{
  wrap(<CandidateCharts ordered={[{row,assessment:{passed:0,total:9}}]} date={target} method="minervini"
    market={{state:'unknown'}} now={Date.parse('2026-10-06T22:00:00Z')} onSelect={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('最終日足が分析日と不一致');
  expect(screen.queryByTestId('rendered-candles')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('954.32');
});
it('expanded mobile header says price unverified and never labels the old close as current',async()=>{
  wrap(<StaticChartViewerModal open onClose={vi.fn()} initialSymbol="STALE" date={target} generation="test"
    chartIndex={{as_of_date:target,symbols:[{symbol:'STALE',path:row.chart_path}]}} researchRows={[row]}
    method="minervini" now={Date.parse('2026-10-06T22:00:00Z')}/>);
  expect(await screen.findByText('チャートデータの読み込みに失敗しました。')).toBeInTheDocument();
  expect(screen.getByTestId('expanded-chart-header')).toHaveTextContent('価格未確認');
  expect(document.body).not.toHaveTextContent('954.32');
  expect(screen.queryByTestId('rendered-candles')).not.toBeInTheDocument();
});
it('CSV keeps analysis date but leaves daily price, RS and pivot blank',()=>{
  const [header,line]=researchCsv([{row}], 'minervini', target, Date.parse('2026-10-06T22:00:00Z')).split('\r\n');
  const names=header.split(',').map(x=>x.slice(1,-1)),values=line.split(',').map(x=>x.slice(1,-1));
  expect(values[names.indexOf('as_of_date')]).toBe(target);
  for(const field of ['daily_price','rs_estimate','pivot'])expect(values[names.indexOf(field)]).toBe('');
  expect(values[names.indexOf('qualified')]).toBe('false');
});
const eqr={...row,symbol:'EQR',company_name:'Equity Residential Properties Trust',exchange:'XNYS',chart_path:null,
  technical_audit:{version:'ohlcv-v1',symbol:'EQR',as_of_date:target,bars:0,valid:false,errors:['日足データ未配信'],values:{}},
  price_quarantine:{status:'unverified_observation',observation_date:null,target_as_of_date:target,reason:'undated_price_without_chart'}};
it('EQR missing-chart detail withholds the unsupported original63.66 and makes no provider request',()=>{
  wrap(<ResearchChart symbol="EQR" date={target} row={eqr} method="minervini"/>);
  expect(screen.getByText('この銘柄のチャートは未配信です。')).toBeInTheDocument();
  expect(fetchPayload).not.toHaveBeenCalled();expect(document.body).not.toHaveTextContent('63.66');
});
it('EQR mobile header remains price-unverified without inventing a chart observation',()=>{
  wrap(<StaticChartViewerModal open onClose={vi.fn()} initialSymbol="EQR" date={target} generation="test"
    chartIndex={{as_of_date:target,symbols:[{symbol:'EQR',path:null}]}} researchRows={[eqr]} method="minervini"
    now={Date.parse('2026-10-06T22:00:00Z')}/>);
  expect(screen.getByTestId('expanded-chart-header')).toHaveTextContent('価格未確認');
  expect(document.body).not.toHaveTextContent('63.66');expect(fetchPayload).not.toHaveBeenCalled();
});
it('EQR CSV and liquid filters cannot expose the undated price/ADV as current',()=>{
  const clock=Date.parse('2026-10-06T22:00:00Z');
  const original={...eqr,current_price:63.65999984741211,adv_usd:196594975};
  expect(filterRanked([{row:original}],{liquidOnly:true})).toHaveLength(1);
  expect(filterRanked([{row:eqr}],{liquidOnly:true})).toHaveLength(0);
  const [header,line]=researchCsv([{row:eqr}],'minervini',target,clock).split('\r\n');
  const names=header.split(',').map(x=>x.slice(1,-1)),values=line.split(',').map(x=>x.slice(1,-1));
  for(const field of ['daily_price','rs_estimate','pivot'])expect(values[names.indexOf(field)]).toBe('');
  expect(values[names.indexOf('qualified')]).toBe('false');expect(line).not.toContain('63.659');
  expect(eqr.price_quarantine.observation_date).toBeNull();
});
