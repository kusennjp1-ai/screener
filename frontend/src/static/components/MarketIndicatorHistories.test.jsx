import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme, getContrastRatio } from '@mui/material/styles';
import MarketIndicatorHistories from './MarketIndicatorHistories';
import InstitutionalEvidence from './InstitutionalEvidence';
import BaseCountEvidence from './BaseCountEvidence';
import { researchTheme } from '../theme/tokens';
import { INDICATOR_HISTORY_VERSION } from '../indicatorHistory';
import { entryHistory, ENTRY_HISTORY_VERSION, ENTRY_UNIVERSE, ENTRY_METHODS } from '../entryHistory';
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }) => <div>{children}</div>, LineChart: ({ children }) => <div>{children}</div>, CartesianGrid: () => null, Legend: ({formatter}) => <div data-testid="history-legend">{formatter?.('凡例')}</div>, Line: () => null, Tooltip: ({contentStyle,itemStyle}) => <div data-testid="history-tooltip" style={contentStyle}><span style={itemStyle}>ツールチップ</span></div>, XAxis: ({tick}) => <span data-testid="history-x-axis" style={{color:tick?.fill}}/>, YAxis: ({tick}) => <span data-testid="history-y-axis" style={{color:tick?.fill}}/> }));
const date = '2026-09-29';
describe('market indicator history display', () => {
  it('shows high/low immediately with historical coverage and preserves unavailable provider states', () => {
    render(<MarketIndicatorHistories expectedDate={date} bookEvidence={{ version: 'book-market-v1', as_of_date: date, series: [{ date, newHighs: 4, newLows: 0, coverage: 100, expectedUniverseSize: 1000 }] }}/>);
    expect(screen.getByRole('heading', { name: '52週新高値・新安値' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '52週新高値・新安値の履歴', hidden: true })).toHaveTextContent('100 / 1,000');
    fireEvent.click(screen.getByRole('button', { name: 'Put/Call' }));
    expect(screen.getByText(/再配信を許可された/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分配日' }));
    expect(screen.getByRole('heading', { name: 'S&P 500の通常分配日（推計）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nasdaq総合の通常分配日（推計）' })).toBeInTheDocument();
    expect(screen.getByText(/機関保有の四半期推移/)).toBeInTheDocument();
  });
  it('allows method and approach choice without inventing first-day crossings', () => {
    const snapshot = { version: ENTRY_HISTORY_VERSION, as_of: date, rule_version: 'r', universe_version: ENTRY_UNIVERSE, records: [{ symbol: 'A', market: 'US', price: 98, pivot: 100, distance: -2, methods: Object.fromEntries(ENTRY_METHODS.map(method => [method, { zone: method === 'minervini2' ? 3 : 5, qualified: true, ready: false }])) }] };
    const entry = Object.fromEntries(ENTRY_METHODS.map(method => [method, Object.fromEntries([1, 3, 5].map(approach => [approach, entryHistory([snapshot], date, method, approach)]))]));
    render(<MarketIndicatorHistories expectedDate={date} data={{ version: INDICATOR_HISTORY_VERSION, as_of_date: date, entry }}/>);
    fireEvent.click(screen.getByRole('button', { name: '接近・上抜け' }));
    expect(screen.getByText(/前取引日の記録が揃うまで未確認/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ピボット下の接近幅'), { target: { value: '1' } });
    expect(screen.getByRole('table', { name: '接近・買い範囲・新規上抜けの履歴', hidden: true })).toHaveTextContent('未確認');
    expect(screen.getByText(/接近はピボットの下1%以内/)).toBeInTheDocument();
  });
  it('rejects stale market history', () => {
    render(<MarketIndicatorHistories expectedDate={date} data={{ version: INDICATOR_HISTORY_VERSION, as_of_date: '2026-09-28', highLow: { series: [{ high: 999 }] } }}/>);
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });
  it('renders quarterly and base unknowns safely', () => {
    render(<><InstitutionalEvidence row={{ symbol: 'A' }} date={date}/><BaseCountEvidence row={{ symbol: 'A' }} date={date}/></>);
    expect(screen.getByRole('heading', { name: '四半期の保有報告会社数' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ベース段階の推移（自動推計）' })).toBeInTheDocument();
    expect(screen.getByText(/観測開始前の段階は不明/)).toBeInTheDocument();
  });
});

it.each([['dark','default'],['light','default'],['dark','research'],['light','research']])('uses readable %s %s theme axis/link colors without changing observations', (mode,kind)=>{
 const theme=kind==='research'?createTheme(createTheme({palette:{mode,primary:{main:'#1976d2'}}}),researchTheme(mode)):createTheme({palette:{mode}});
 const evidence={version:'book-market-v1',as_of_date:date,series:[{date,newHighs:72,newLows:178,coverage:4484,expectedUniverseSize:5901}]};
 const original=JSON.stringify(evidence);
 render(<ThemeProvider theme={theme}><MarketIndicatorHistories expectedDate={date} bookEvidence={evidence}/></ThemeProvider>);
 expect(screen.getByTestId('history-x-axis')).toHaveStyle({color:theme.palette.text.secondary});
 expect(screen.getByTestId('history-y-axis')).toHaveStyle({color:theme.palette.text.secondary});
 expect(screen.getByTestId('history-tooltip')).toHaveStyle({backgroundColor:theme.palette.background.paper,color:theme.palette.text.primary});
 expect(screen.getByText('ツールチップ')).toHaveStyle({color:theme.palette.text.primary});
 expect(screen.getByText('凡例')).toHaveStyle({color:theme.palette.text.primary});
 expect(getContrastRatio(theme.palette.text.primary,theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
 const linkColor=mode==='dark'?theme.palette.primary.light:theme.palette.primary.dark;
 expect(screen.getByRole('link',{name:'銘柄を選択 → 履歴'})).toHaveStyle({color:linkColor});
 expect(getContrastRatio(linkColor,theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
 if(kind==='research')expect(getContrastRatio(theme.palette.text.secondary,theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
 const table=screen.getByRole('table',{name:'52週新高値・新安値の履歴',hidden:true});
 expect(table).toHaveTextContent('72');expect(table).toHaveTextContent('178');expect(table).toHaveTextContent('4,484 / 5,901');
 expect(JSON.stringify(evidence)).toBe(original);
});

it('lets keyboard users enter the history table after opening it while preserving every observation', async()=>{
 const user=userEvent.setup();
 const series=Array.from({length:60},(_,index)=>({date:new Date(Date.UTC(2026,7,1+index)).toISOString().slice(0,10),newHighs:index,newLows:0,coverage:4484,expectedUniverseSize:5901}));
 render(<MarketIndicatorHistories expectedDate={date} bookEvidence={{version:'book-market-v1',as_of_date:date,series}}/>);
 const summary=screen.getByText('日付・観測数・値を表で確認（60件）');
 await user.click(summary);
 // user-event's selector omits native summary elements. Model their implicit
 // tab stop explicitly here; actual browser traversal is checked in preview CI.
 summary.tabIndex=0;
 summary.focus();await user.tab();
 const region=screen.getByRole('region',{name:'52週新高値・新安値の履歴表（縦・横にスクロール可能）'});
 expect(region).toHaveFocus();
 const table=within(region).getByRole('table');
 expect(within(table).getAllByRole('row')).toHaveLength(61);
 expect(table).toHaveTextContent('4,484 / 5,901');
});

it.each(['dark','light'])('keeps the %s institutional source readable and both quarterly tables keyboard accessible',async mode=>{
 const theme=createTheme(researchTheme(mode));
 const evidence={source_url:'https://www.sec.gov/13f',observations:[{period:'2026-03-31',manager_count:3276,filing_date_first:'2026-03-31',filing_date_last:'2026-06-28'},{period:'2026-06-30',manager_count:3559,filing_date_first:'2026-07-01',filing_date_last:'2026-08-28'}]};
 const history={symbol:'TSM',as_of_date:date,series:[{date:'2026-03-31',value:3276},{date:'2026-06-30',value:3559}],unit:'社',source:'SEC 13F',scope:'TSM'};
 const original=JSON.stringify(evidence);
 render(<ThemeProvider theme={theme}><InstitutionalEvidence date={date} row={{symbol:'TSM',institutional_evidence:evidence,institutional_holder_history:history}}/></ThemeProvider>);
 const link=screen.getByRole('link',{name:'SEC 13F'}),color=mode==='dark'?theme.palette.primary.light:theme.palette.primary.dark;
 expect(link).toHaveAttribute('href',evidence.source_url);expect(link).toHaveStyle({color});
 expect(getContrastRatio(color,theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
 const user=userEvent.setup();
 const summary=screen.getByText('日付・観測数・値を表で確認（2件）');
 await user.click(summary);summary.tabIndex=0;summary.focus();await user.tab();
 expect(screen.getByRole('region',{name:'四半期の保有報告会社数の履歴表（縦・横にスクロール可能）'})).toHaveFocus();
 await user.tab();
 const current=screen.getByRole('region',{name:'選定に使う直近2期の保有報告（縦・横にスクロール可能）'});
 expect(current).toHaveFocus();expect(current).toHaveTextContent('3,276');expect(current).toHaveTextContent('3,559');
 expect(JSON.stringify(evidence)).toBe(original);
});
